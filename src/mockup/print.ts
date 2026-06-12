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

function isPrintColorDefault(options?: PrintConfig): boolean {
  return (
    (options?.brightness ?? 1) === 1 &&
    (options?.saturation ?? 1) === 1 &&
    (options?.contrast ?? 1) === 1 &&
    (options?.blackLift ?? 0) === 0
  );
}

function applyContrastAndBlackLift(
  data: Buffer,
  contrast: number,
  blackLift: number,
): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];

    if (alpha === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }

    let r = Math.round((data[i] - 128) * contrast + 128);
    let g = Math.round((data[i + 1] - 128) * contrast + 128);
    let b = Math.round((data[i + 2] - 128) * contrast + 128);

    data[i] = Math.min(255, Math.max(0, r + blackLift));
    data[i + 1] = Math.min(255, Math.max(0, g + blackLift));
    data[i + 2] = Math.min(255, Math.max(0, b + blackLift));
  }
}

export function hasPrintColorAdjustment(options?: PrintConfig): boolean {
  return !isPrintColorDefault(options);
}

export async function adjustPrintColor(
  input: Buffer,
  options?: PrintConfig,
): Promise<Buffer> {
  if (isPrintColorDefault(options)) {
    return input;
  }

  const sharp = getSharp();
  const brightness = options?.brightness ?? 1;
  const saturation = options?.saturation ?? 1;
  const contrast = options?.contrast ?? 1;
  const blackLift = options?.blackLift ?? 0;

  const modulated = await sharp(input)
    .ensureAlpha()
    .modulate({ brightness, saturation })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const output = Buffer.from(modulated.data);
  applyContrastAndBlackLift(output, contrast, blackLift);

  return sharp(output, {
    raw: {
      width: modulated.info.width,
      height: modulated.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

export async function applyEdgeSpread(
  input: Buffer,
  spread: number,
): Promise<Buffer> {
  if (spread <= 0) {
    return input;
  }

  const sharp = getSharp();
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const radius = Math.min(2, Math.round(spread));
  const source = Buffer.from(data);
  const expanded = Buffer.from(data);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (source[index + 3] > 0) {
        continue;
      }

      let maxNeighborAlpha = 0;
      let sampleR = 0;
      let sampleG = 0;
      let sampleB = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }
          const neighborIndex = (ny * width + nx) * 4;
          const neighborAlpha = source[neighborIndex + 3];
          if (neighborAlpha > maxNeighborAlpha) {
            maxNeighborAlpha = neighborAlpha;
            sampleR = source[neighborIndex];
            sampleG = source[neighborIndex + 1];
            sampleB = source[neighborIndex + 2];
          }
        }
      }

      if (maxNeighborAlpha > 0) {
        expanded[index] = sampleR;
        expanded[index + 1] = sampleG;
        expanded[index + 2] = sampleB;
        expanded[index + 3] = Math.round(maxNeighborAlpha * 0.35);
      }
    }
  }

  return sharp(expanded, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
