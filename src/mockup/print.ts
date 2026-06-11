import { getSharp } from "../platform/sharp/client.js";
import type { PrintConfig } from "./types.js";

function premultiplyRgb(data: Buffer): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    data[i] = Math.round((data[i] * alpha) / 255);
    data[i + 1] = Math.round((data[i + 1] * alpha) / 255);
    data[i + 2] = Math.round((data[i + 2] * alpha) / 255);
  }
}

function restoreAlphaAndUnpremultiply(
  data: Buffer,
  originalAlpha: Buffer,
): void {
  for (let i = 0; i < data.length; i += 4) {
    const processedAlpha = data[i + 3];
    const origAlpha = originalAlpha[i + 3];
    const finalAlpha = Math.round((processedAlpha * origAlpha) / 255);
    data[i + 3] = finalAlpha;

    if (finalAlpha > 0) {
      const scale = 255 / finalAlpha;
      data[i] = Math.min(255, Math.round(data[i] * scale));
      data[i + 1] = Math.min(255, Math.round(data[i + 1] * scale));
      data[i + 2] = Math.min(255, Math.round(data[i + 2] * scale));
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
}

export async function simulatePrintRaster(
  input: Buffer,
  width: number,
  height: number,
  options?: PrintConfig,
): Promise<Buffer> {
  if (!options?.rasterize) {
    return input;
  }

  const sharp = getSharp();
  const resolutionScale = options.resolutionScale ?? 0.75;
  const soften = options.soften ?? 0.25;

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const originalAlpha = Buffer.from(data);
  const premultiplied = Buffer.from(data);
  premultiplyRgb(premultiplied);

  const downWidth = Math.max(1, Math.round(width * resolutionScale));
  const downHeight = Math.max(1, Math.round(height * resolutionScale));

  let pipeline = sharp(premultiplied, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .resize(downWidth, downHeight, { kernel: "lanczos3" })
    .resize(info.width, info.height, { kernel: "cubic" });

  if (soften > 0) {
    pipeline = pipeline.blur(soften);
  }

  const processed = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const output = Buffer.from(processed.data);
  restoreAlphaAndUnpremultiply(output, originalAlpha);

  return sharp(output, {
    raw: {
      width: processed.info.width,
      height: processed.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}
