import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.js";
import { MockupError } from "./errors.js";
import { withRenderLock } from "./lock.js";
import { renderMockup } from "./render.js";
import type { RenderResult } from "./types.js";

export async function listDesignPngs(): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(env.designsDir, { withFileTypes: true });
  } catch {
    throw new MockupError(
      "RENDER_FAILURE",
      `Designs directory not found: ${env.designsDir}`,
      500,
    );
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => join(env.designsDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

export interface TestMockupItemResult {
  design: string;
  designPath: string;
  success: boolean;
  outputPath?: string;
  width?: number;
  height?: number;
  error?: string;
  code?: string;
}

export interface TestMockupsResult {
  success: true;
  templateId: string;
  total: number;
  succeeded: number;
  failed: number;
  results: TestMockupItemResult[];
}

export async function renderTestMockups(options: {
  templateId?: string;
  debug?: boolean;
}): Promise<TestMockupsResult> {
  const templateId = options.templateId?.trim() || "generic-hang-white";
  const designPaths = await listDesignPngs();

  if (designPaths.length === 0) {
    throw new MockupError(
      "RENDER_FAILURE",
      `No PNG designs found in ${env.designsDir}`,
      404,
    );
  }

  console.log(
    `[render-test-batch] templateId=${templateId} designs=${designPaths.length}`,
  );

  const results: TestMockupItemResult[] = [];

  for (const designPath of designPaths) {
    const design = designPath.startsWith(env.projectRoot)
      ? designPath.slice(env.projectRoot.length + 1)
      : designPath;

    try {
      const result = await withRenderLock(() =>
        renderMockup({
          templateId,
          designPath,
          debug: options.debug,
        }),
      );

      results.push(toSuccessItem(design, designPath, result));
    } catch (error) {
      results.push(toFailureItem(design, designPath, error));
    }
  }

  const succeeded = results.filter((item) => item.success).length;

  return {
    success: true,
    templateId,
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

function toSuccessItem(
  design: string,
  designPath: string,
  result: RenderResult,
): TestMockupItemResult {
  return {
    design,
    designPath,
    success: true,
    outputPath: result.outputPath,
    width: result.width,
    height: result.height,
  };
}

function toFailureItem(
  design: string,
  designPath: string,
  error: unknown,
): TestMockupItemResult {
  if (error instanceof MockupError) {
    return {
      design,
      designPath,
      success: false,
      error: error.message,
      code: error.code,
    };
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    design,
    designPath,
    success: false,
    error: message,
    code: "RENDER_FAILURE",
  };
}
