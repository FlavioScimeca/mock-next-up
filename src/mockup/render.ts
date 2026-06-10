import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env, getDebugDir } from "../config/env";
import { MockupError } from "./errors";
import { generateOutputFilename } from "./filenames";
import { runRenderPipeline } from "./pipeline";
import { RenderProgress } from "./progress";
import { ensureSharpReady } from "./sharp-init";
import { loadTemplate } from "./template";
import type { RenderOptions, RenderResult } from "./types";

export async function renderMockup(options: RenderOptions): Promise<RenderResult> {
  await ensureSharpReady();
  const { templateId, designPath, debug = false } = options;
  const startedAt = Date.now();
  const progress = new RenderProgress();

  progress.step("start", { templateId, designPath, debug });

  const template = await loadTemplate(templateId);

  progress.step("load-template", {
    templateId: template.id,
    templateDir: template.dir,
    canvas: `${template.config.canvas.width}x${template.config.canvas.height}`,
  });

  const outputPath = options.outputPath
    ? options.outputPath
    : join(env.outputsDir, generateOutputFilename(templateId));

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

    await writeFile(outputPath, finalBuffer);
    if (debug) {
      await writeFile(join(getDebugDir(), "final.png"), finalBuffer);
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
