import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env, getDebugDir } from "../config/env";
import { logRenderEvent } from "../logging";
import { MockupError } from "./errors";
import { generateOutputFilename } from "./filenames";
import { runRenderPipeline } from "./pipeline";
import { loadTemplate } from "./template";
import type { RenderOptions, RenderResult } from "./types";

export async function renderMockup(options: RenderOptions): Promise<RenderResult> {
  const { templateId, designPath, debug = false } = options;
  const startedAt = Date.now();

  logRenderEvent({ start: true, templateId });

  const template = await loadTemplate(templateId);
  logRenderEvent({ templateDir: template.dir });

  const outputPath = options.outputPath
    ? options.outputPath
    : join(env.outputsDir, generateOutputFilename(templateId));

  await mkdir(env.outputsDir, { recursive: true });
  if (debug) {
    await mkdir(getDebugDir(), { recursive: true });
  }

  let finalBuffer: Buffer;
  try {
    finalBuffer = await runRenderPipeline({
      template,
      designPath,
      debug,
    });
  } catch (error) {
    if (error instanceof MockupError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Unknown render error";
    throw new MockupError("RENDER_FAILURE", `Render failed: ${message}`, 500);
  }

  try {
    await writeFile(outputPath, finalBuffer);
    if (debug) {
      await writeFile(join(getDebugDir(), "final.png"), finalBuffer);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown write error";
    throw new MockupError(
      "OUTPUT_WRITE_FAILURE",
      `Failed to write output: ${message}`,
      500,
    );
  }

  const relativeOutputPath = outputPath.startsWith(env.projectRoot)
    ? outputPath.slice(env.projectRoot.length + 1)
    : outputPath;

  const elapsedMs = Date.now() - startedAt;
  logRenderEvent({
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
