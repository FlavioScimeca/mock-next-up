import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { getDebugDir } from "../config/env";
import { MockupError } from "./errors";
import { applyAlphaMask, luminanceToAlphaMask } from "./mask";
import { applyOpacity } from "./opacity";
import { loadTemplate } from "./template";
import type { LoadedTemplate } from "./types";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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
  const file = Bun.file(designPath);
  if (!(await file.exists())) {
    throw new MockupError(
      "MISSING_DESIGN",
      "design file is required",
      400,
    );
  }

  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isPng = PNG_SIGNATURE.every((byte, index) => header[index] === byte);

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
}): Promise<Buffer> {
  const { template, designPath, debug } = options;
  const { canvas, layers } = template.config;

  await validateDesignIsPng(designPath);

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

  const resizedDesign = await sharp(designPath)
    .resize(placement.resizedWidth, placement.resizedHeight, {
      fit: "inside",
    })
    .png()
    .toBuffer();

  await writeDebugImage(debug, "resized-design.png", resizedDesign);

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

  const maskedDesign = await applyAlphaMask(designCanvas, alphaMask);
  await writeDebugImage(debug, "masked-design.png", maskedDesign);

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
    const shadowWithOpacity = await applyOpacity(
      template.paths.shadow,
      layers.shadow.opacity,
    );
    const maskedShadow = await applyAlphaMask(shadowWithOpacity, alphaMask);
    await writeDebugImage(debug, "masked-shadow.png", maskedShadow);
    composites.push({
      input: maskedShadow,
      blend: "multiply",
    });
  }

  if (layers.highlight.enabled) {
    const highlightWithOpacity = await applyOpacity(
      template.paths.highlight,
      layers.highlight.opacity,
    );
    const maskedHighlight = await applyAlphaMask(
      highlightWithOpacity,
      alphaMask,
    );
    await writeDebugImage(debug, "masked-highlight.png", maskedHighlight);
    composites.push({
      input: maskedHighlight,
      blend: "screen",
    });
  }

  return sharp(template.paths.base).composite(composites).png().toBuffer();
}
