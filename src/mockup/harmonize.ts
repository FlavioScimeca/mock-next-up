import { getSharp } from "../platform/sharp/client.js";
import type { HarmonizeConfig, PrintAreaConfig } from "./types.js";

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

async function extractPrintRegionNoise(
  basePath: string,
  printArea: PrintAreaConfig,
): Promise<Buffer> {
  const sharp = getSharp();
  const extractOptions = {
    left: printArea.x,
    top: printArea.y,
    width: printArea.width,
    height: printArea.height,
  };

  const blurred = await sharp(basePath)
    .extract(extractOptions)
    .blur(2)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const original = await sharp(basePath)
    .extract(extractOptions)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const noise = Buffer.alloc(original.data.length);
  const channels = original.info.channels;

  for (let i = 0; i < original.data.length; i += channels) {
    for (let c = 0; c < 3; c++) {
      noise[i + c] = original.data[i + c] - blurred.data[i + c];
    }
    if (channels === 4) {
      noise[i + 3] = 255;
    }
  }

  return sharp(noise, {
    raw: {
      width: original.info.width,
      height: original.info.height,
      channels,
    },
  })
    .png()
    .toBuffer();
}

export async function applyHarmonization(
  finalBuffer: Buffer,
  basePath: string,
  designAlphaMask: Buffer,
  printArea: PrintAreaConfig,
  config?: HarmonizeConfig,
): Promise<Buffer> {
  const grain = config?.grain ?? 0;
  const colorMatch = config?.colorMatch ?? false;

  if (grain <= 0 && !colorMatch) {
    return finalBuffer;
  }

  const sharp = getSharp();
  let output = finalBuffer;

  if (colorMatch) {
    const baseSample = await sharp(basePath)
      .extract({
        left: printArea.x,
        top: printArea.y,
        width: printArea.width,
        height: printArea.height,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const finalResult = await sharp(output)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const maskResult = await sharp(designAlphaMask)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let baseR = 0;
    let baseG = 0;
    let baseB = 0;
    const basePixels = baseSample.data.length / baseSample.info.channels;
    for (let i = 0; i < baseSample.data.length; i += baseSample.info.channels) {
      baseR += baseSample.data[i];
      baseG += baseSample.data[i + 1];
      baseB += baseSample.data[i + 2];
    }
    baseR /= basePixels;
    baseG /= basePixels;
    baseB /= basePixels;

    const data = finalResult.data;
    const mask = maskResult.data;
    const strength = 0.06;

    for (let i = 0; i < data.length; i += 4) {
      if (mask[i + 3] === 0) {
        continue;
      }

      const lum = luminance(data[i], data[i + 1], data[i + 2]);
      if (lum < 8) {
        continue;
      }

      data[i] = Math.round(data[i] * (1 - strength) + baseR * strength);
      data[i + 1] = Math.round(data[i + 1] * (1 - strength) + baseG * strength);
      data[i + 2] = Math.round(data[i + 2] * (1 - strength) + baseB * strength);
    }

    output = await sharp(data, {
      raw: {
        width: finalResult.info.width,
        height: finalResult.info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  if (grain > 0) {
    const noisePng = await extractPrintRegionNoise(basePath, printArea);
    const meta = await sharp(output).metadata();
    const canvasWidth = meta.width ?? 0;
    const canvasHeight = meta.height ?? 0;

    const grainLayer = await sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: noisePng, left: printArea.x, top: printArea.y },
        { input: designAlphaMask, blend: "dest-in" },
      ])
      .png()
      .toBuffer();

    const grainData = await sharp(grainLayer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const finalResult = await sharp(output)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const amount = grain * 0.5;
    for (let i = 0; i < finalResult.data.length; i += 4) {
      const maskAlpha = grainData.data[i + 3];
      if (maskAlpha === 0) {
        continue;
      }

      const factor = (maskAlpha / 255) * amount;
      finalResult.data[i] = Math.min(
        255,
        Math.max(0, Math.round(finalResult.data[i] + grainData.data[i] * factor)),
      );
      finalResult.data[i + 1] = Math.min(
        255,
        Math.max(
          0,
          Math.round(finalResult.data[i + 1] + grainData.data[i + 1] * factor),
        ),
      );
      finalResult.data[i + 2] = Math.min(
        255,
        Math.max(
          0,
          Math.round(finalResult.data[i + 2] + grainData.data[i + 2] * factor),
        ),
      );
    }

    output = await sharp(finalResult.data, {
      raw: {
        width: finalResult.info.width,
        height: finalResult.info.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();
  }

  return output;
}
