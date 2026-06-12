import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getSharp } from "../platform/sharp/client.js";
import { env } from "../config/env.js";
import { validateTemplateConfig } from "./config.js";
import { MockupError } from "./errors.js";
import {
  OPTIONAL_FABRIC_FILES,
  OPTIONAL_TEMPLATE_FILES,
  REQUIRED_TEMPLATE_FILES,
  type LoadedTemplate,
} from "./types.js";

let templateIndex: Map<string, string> | null = null;

export function assertSafeTemplateId(templateId: string): void {
  if (!templateId || templateId.includes("/") || templateId.includes("\\") || templateId.includes("..")) {
    throw new MockupError(
      "INVALID_CONFIG",
      "Invalid templateId: must be a safe identifier without path separators",
      400,
    );
  }
}

async function collectTemplateDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = join(dir, entry.name);
    const hasAllRequired = REQUIRED_TEMPLATE_FILES.every((file) =>
      existsSync(join(fullPath, file)),
    );

    if (hasAllRequired) {
      results.push(fullPath);
      continue;
    }

    results.push(...(await collectTemplateDirs(fullPath)));
  }

  return results;
}

async function buildTemplateIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const templateDirs = await collectTemplateDirs(env.templatesDir);

  for (const dir of templateDirs) {
    const configPath = join(dir, "config.json");
    const raw: unknown = JSON.parse(await readFile(configPath, "utf8"));

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new MockupError(
        "INVALID_CONFIG",
        `Invalid template config in ${configPath}`,
        422,
      );
    }

    const id = (raw as Record<string, unknown>).id;
    if (typeof id !== "string" || id.length === 0) {
      throw new MockupError(
        "INVALID_CONFIG",
        `Invalid template config: missing id in ${configPath}`,
        422,
      );
    }

    const config = validateTemplateConfig(raw, id);

    if (index.has(config.id)) {
      throw new MockupError(
        "INVALID_CONFIG",
        `Duplicate template id found: ${config.id}`,
        422,
      );
    }

    index.set(config.id, dir);
  }

  return index;
}

async function getTemplateIndex(): Promise<Map<string, string>> {
  if (!templateIndex) {
    templateIndex = await buildTemplateIndex();
  }
  return templateIndex;
}

async function validateAssetDimensions(
  template: LoadedTemplate,
): Promise<void> {
  const sharp = getSharp();
  const { canvas } = template.config;
  const assets = [
    ["base.png", template.paths.base],
    ["mask.png", template.paths.mask],
    ["shadow.png", template.paths.shadow],
    ["highlight.png", template.paths.highlight],
    ["fabric-dark.png", template.paths.fabricDark],
    ["fabric-light.png", template.paths.fabricLight],
    ["fabric-texture.png", template.paths.fabricTexture],
    ["displacement.png", template.paths.displacement],
  ] as const;

  for (const [name, assetPath] of assets) {
    if (!assetPath) {
      continue;
    }

    const metadata = await sharp(assetPath).metadata();

    if (
      metadata.width !== canvas.width ||
      metadata.height !== canvas.height
    ) {
      throw new MockupError(
        "INVALID_CONFIG",
        `Invalid template config: ${name} dimensions (${metadata.width}x${metadata.height}) do not match canvas (${canvas.width}x${canvas.height})`,
        422,
      );
    }
  }
}

export function validateWarpAssets(template: LoadedTemplate): void {
  if (!template.config.warp?.enabled) {
    return;
  }

  if (!template.paths.displacement) {
    throw new MockupError(
      "MISSING_TEMPLATE_ASSET",
      "Template asset missing: displacement.png required by warp.enabled",
      422,
    );
  }
}

export function validateFabricTextureAsset(template: LoadedTemplate): void {
  if (
    !template.config.fabric?.enabled ||
    template.config.fabric.textureSource !== "fabricTexture"
  ) {
    return;
  }

  if (!template.paths.fabricTexture) {
    throw new MockupError(
      "MISSING_TEMPLATE_ASSET",
      "Template asset missing: fabric-texture.png required by fabric.textureSource=fabricTexture",
      422,
    );
  }
}

export function validateFabricSplitAssets(template: LoadedTemplate): void {
  if (
    !template.config.fabric?.enabled ||
    template.config.fabric?.textureSource !== "fabricSplit"
  ) {
    return;
  }

  if (!template.paths.fabricDark) {
    throw new MockupError(
      "MISSING_TEMPLATE_ASSET",
      "Template asset missing: fabric-dark.png required by fabric.textureSource=fabricSplit",
      422,
    );
  }

  if (!template.paths.fabricLight) {
    throw new MockupError(
      "MISSING_TEMPLATE_ASSET",
      "Template asset missing: fabric-light.png required by fabric.textureSource=fabricSplit",
      422,
    );
  }
}

export async function loadTemplate(templateId: string): Promise<LoadedTemplate> {
  assertSafeTemplateId(templateId);

  const index = await getTemplateIndex();
  const dir = index.get(templateId);

  if (!dir) {
    throw new MockupError(
      "UNKNOWN_TEMPLATE",
      `Template not found: ${templateId}`,
      404,
    );
  }

  for (const file of REQUIRED_TEMPLATE_FILES) {
    const filePath = join(dir, file);
    if (!existsSync(filePath)) {
      throw new MockupError(
        "MISSING_TEMPLATE_ASSET",
        `Template asset missing: ${file}`,
        422,
      );
    }
  }

  const configPath = join(dir, "config.json");
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  const config = validateTemplateConfig(raw, templateId);

  const optionalFabricPaths = Object.fromEntries(
    OPTIONAL_FABRIC_FILES.flatMap((file) => {
      const filePath = join(dir, file);
      if (!existsSync(filePath)) {
        return [];
      }

      const key =
        file === "fabric-dark.png" ? "fabricDark" : "fabricLight";
      return [[key, filePath]];
    }),
  ) as Pick<LoadedTemplate["paths"], "fabricDark" | "fabricLight">;

  const optionalTemplatePaths = Object.fromEntries(
    OPTIONAL_TEMPLATE_FILES.flatMap((file) => {
      const filePath = join(dir, file);
      if (!existsSync(filePath)) {
        return [];
      }

      const key =
        file === "fabric-texture.png" ? "fabricTexture" : "displacement";
      return [[key, filePath]];
    }),
  ) as Pick<LoadedTemplate["paths"], "fabricTexture" | "displacement">;

  const template: LoadedTemplate = {
    id: templateId,
    dir,
    config,
    paths: {
      base: join(dir, "base.png"),
      mask: join(dir, "mask.png"),
      shadow: join(dir, "shadow.png"),
      highlight: join(dir, "highlight.png"),
      config: configPath,
      ...optionalFabricPaths,
      ...optionalTemplatePaths,
    },
  };

  validateFabricSplitAssets(template);
  validateFabricTextureAsset(template);
  validateWarpAssets(template);
  await validateAssetDimensions(template);
  return template;
}

export function resetTemplateIndex(): void {
  templateIndex = null;
}
