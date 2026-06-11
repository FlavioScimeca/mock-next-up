import { constants } from "node:fs";
import { access, mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSharp } from "../platform/sharp/client.js";
import { getDebugDir } from "../config/env.js";
import { isPngHeader } from "../lib/png.js";
import { RenderProgress } from "./progress.js";
import { MockupError } from "./errors.js";
import {
  applyAlphaMask,
  extractAlphaMaskFromLayer,
  luminanceToAlphaMask,
} from "./mask.js";
import { applyOpacity } from "./opacity.js";
import type { LoadedTemplate } from "./types.js";

async function writeDebugImage(
  debug: boolean,
  filename: string,
  buffer: Buffer,
): Promise<void> {
  if (!debug) {
    return;
  }

  const debugDir = getDebugDir();
  await mkdir(debugDir, { recursive: true });
  await writeFile(join(debugDir, filename), buffer);
}

export async function validateDesignIsPng(designPath: string): Promise<void> {
  const sharp = getSharp();

  try {
    await access(designPath, constants.F_OK);
  } catch {
    throw new MockupError(
      "MISSING_DESIGN",
      "design file is required",
      400,
    );
  }

  const header = Buffer.alloc(8);
  const handle = await open(designPath, "r");
  try {
    await handle.read(header, 0, 8, 0);
  } finally {
    await handle.close();
  }

  const isPng = isPngHeader(header);

  if (!isPng) {
    throw new MockupError(
      "UNSUPPORTED_FILE_TYPE",
      "Only PNG designs are supported",
      415,
    );
  }

  const metadata = await sharp(designPath).metadata();
  if (metadata.format !== "png") {
    throw new MockupError(
      "UNSUPPORTED_FILE_TYPE",
      "Only PNG designs are supported",
      415,
    );
  }
}

function computeContainedPlacement(
  designWidth: number,
  designHeight: number,
  template: LoadedTemplate,
): {
  resizedWidth: number;
  resizedHeight: number;
  left: number;
  top: number;
} {
  const { printArea } = template.config;
  const scale = Math.min(
    printArea.width / designWidth,
    printArea.height / designHeight,
  );
  const resizedWidth = Math.max(1, Math.round(designWidth * scale));
  const resizedHeight = Math.max(1, Math.round(designHeight * scale));
  const left = printArea.x + Math.round((printArea.width - resizedWidth) / 2);
  const top = printArea.y + Math.round((printArea.height - resizedHeight) / 2);

  return { resizedWidth, resizedHeight, left, top };
}

export async function runRenderPipeline(options: {
  template: LoadedTemplate;
  designPath: string;
  debug: boolean;
  progress: RenderProgress;
}): Promise<Buffer> {
  const sharp = getSharp();
  const { template, designPath, debug, progress } = options;
  const { canvas, layers } = template.config;

  progress.step("validate-design", { designPath });

  await validateDesignIsPng(designPath);

  progress.step("build-alpha-mask", {
    maskPath: template.paths.mask,
    canvas: `${canvas.width}x${canvas.height}`,
  });

  const alphaMask = await luminanceToAlphaMask(template.paths.mask);

  const designMetadata = await sharp(designPath).metadata();
  const designWidth = designMetadata.width;
  const designHeight = designMetadata.height;

  if (!designWidth || !designHeight) {
    throw new MockupError(
      "RENDER_FAILURE",
      "Render failed: unable to read design dimensions",
      500,
    );
  }

  const placement = computeContainedPlacement(
    designWidth,
    designHeight,
    template,
  );

  progress.step("resize-design", {
    source: `${designWidth}x${designHeight}`,
    target: `${placement.resizedWidth}x${placement.resizedHeight}`,
    printArea: `${template.config.printArea.width}x${template.config.printArea.height}`,
  });

  const resizedDesign = await sharp(designPath)
    .resize(placement.resizedWidth, placement.resizedHeight, {
      fit: "inside",
    })
    .png()
    .toBuffer();

  await writeDebugImage(debug, "resized-design.png", resizedDesign);

  progress.step("place-design-on-canvas", {
    left: placement.left,
    top: placement.top,
    canvas: `${canvas.width}x${canvas.height}`,
  });

  const designCanvas = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: resizedDesign,
        left: placement.left,
        top: placement.top,
      },
    ])
    .png()
    .toBuffer();

  await writeDebugImage(debug, "design-canvas.png", designCanvas);

  progress.step("mask-design");

  const maskedDesign = await applyAlphaMask(designCanvas, alphaMask);
  await writeDebugImage(debug, "masked-design.png", maskedDesign);

  progress.step("extract-design-alpha-mask");

  const designAlphaMask = await extractAlphaMaskFromLayer(maskedDesign);
  await writeDebugImage(debug, "design-alpha-mask.png", designAlphaMask);

  progress.step("composite-base", { basePath: template.paths.base });

  const composites: Array<{
    input: Buffer;
    blend: "over" | "multiply" | "screen";
  }> = [
    {
      input: maskedDesign,
      blend: "over",
    },
  ];

  if (layers.shadow.enabled) {
    progress.step("apply-shadow", {
      blend: layers.shadow.blend,
      opacity: layers.shadow.opacity,
    });

    const shadowWithOpacity = await applyOpacity(
      template.paths.shadow,
      layers.shadow.opacity,
    );
    const clippedShadow = await applyAlphaMask(
      shadowWithOpacity,
      designAlphaMask,
    );
    await writeDebugImage(debug, "clipped-shadow.png", clippedShadow);
    composites.push({
      input: clippedShadow,
      blend: "multiply",
    });
  }

  if (layers.highlight.enabled) {
    progress.step("apply-highlight", {
      blend: layers.highlight.blend,
      opacity: layers.highlight.opacity,
    });

    const highlightWithOpacity = await applyOpacity(
      template.paths.highlight,
      layers.highlight.opacity,
    );
    const clippedHighlight = await applyAlphaMask(
      highlightWithOpacity,
      designAlphaMask,
    );
    await writeDebugImage(debug, "clipped-highlight.png", clippedHighlight);
    composites.push({
      input: clippedHighlight,
      blend: "screen",
    });
  }

  progress.step("encode-final-png", {
    layers: composites.length,
  });

  return sharp(template.paths.base).composite(composites).png().toBuffer();
}
