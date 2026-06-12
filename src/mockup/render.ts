import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env, getDebugDir } from "../config/env.js";
import { applyRenderConfigOverride } from "./config.js";
import { MockupError } from "./errors.js";
import { generateOutputFilename } from "./filenames.js";
import { runRenderPipeline } from "./pipeline.js";
import { RenderProgress } from "./progress.js";
import { ensureSharpReady, getSharp } from "../platform/sharp/client.js";
import { buildDebugContactSheet } from "./contact-sheet.js";
import {
  loadTemplate,
  validateFabricSplitAssets,
  validateFabricTextureAsset,
  validateWarpAssets,
} from "./template.js";
import type { RenderOptions, RenderResult } from "./types.js";

export async function renderMockup(options: RenderOptions): Promise<RenderResult> {
  await ensureSharpReady();
  const { templateId, designPath, debug = false, configOverride } = options;
  const startedAt = Date.now();
  const progress = new RenderProgress();

  progress.step("start", { templateId, designPath, debug });

  const loadedTemplate = await loadTemplate(templateId);
  const template = {
    ...loadedTemplate,
    config: applyRenderConfigOverride(loadedTemplate.config, configOverride),
  };
  validateFabricSplitAssets(template);
  validateFabricTextureAsset(template);
  validateWarpAssets(template);

  if (configOverride) {
    progress.step("apply-config-override");
  }

  progress.step("load-template", {
    templateId: template.id,
    templateDir: template.dir,
    canvas: `${template.config.canvas.width}x${template.config.canvas.height}`,
  });

  const outputFormat =
    template.config.output.format === "jpeg" ? "jpeg" : "png";

  const outputPath = options.outputPath
    ? options.outputPath
    : join(env.outputsDir, generateOutputFilename(templateId, outputFormat));

  await mkdir(env.outputsDir, { recursive: true });
  if (debug) {
    await mkdir(getDebugDir(), { recursive: true });
    progress.step("prepare-debug-output", { debugDir: getDebugDir() });
  }

  let finalBuffer: Buffer;
  try {
    finalBuffer = await runRenderPipeline({
      template,
      designPath,
      debug,
      progress,
    });
  } catch (error) {
    progress.step("failed", {
      code: error instanceof MockupError ? error.code : "RENDER_FAILURE",
      message: error instanceof Error ? error.message : "Unknown render error",
    });

    if (error instanceof MockupError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Unknown render error";
    throw new MockupError("RENDER_FAILURE", `Render failed: ${message}`, 500);
  }

  const relativeOutputPath = outputPath.startsWith(env.projectRoot)
    ? outputPath.slice(env.projectRoot.length + 1)
    : outputPath;

  try {
    progress.step("write-output", { outputPath: relativeOutputPath });

    const encodedBuffer =
      outputFormat === "jpeg"
        ? await getSharp()(finalBuffer)
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .jpeg({ quality: template.config.output.quality })
            .toBuffer()
        : finalBuffer;

    await writeFile(outputPath, encodedBuffer);
    if (debug) {
      await writeFile(join(getDebugDir(), "final.png"), finalBuffer);
      await buildDebugContactSheet(getDebugDir());
    }
  } catch (error) {
    progress.step("failed", {
      code: "OUTPUT_WRITE_FAILURE",
      message: error instanceof Error ? error.message : "Unknown write error",
    });

    const message =
      error instanceof Error ? error.message : "Unknown write error";
    throw new MockupError(
      "OUTPUT_WRITE_FAILURE",
      `Failed to write output: ${message}`,
      500,
    );
  }

  const elapsedMs = Date.now() - startedAt;

  progress.step("complete", {
    outputPath: relativeOutputPath,
    durationMs: elapsedMs,
    width: template.config.canvas.width,
    height: template.config.canvas.height,
  });

  return {
    success: true,
    templateId,
    outputPath: relativeOutputPath,
    width: template.config.canvas.width,
    height: template.config.canvas.height,
  };
}
