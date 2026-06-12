import { getSharp } from "../platform/sharp/client.js";
import type { CompositeBlendMode } from "./types.js";

export function toCompositeBlend(blend: string): CompositeBlendMode {
  if (
    blend === "multiply" ||
    blend === "screen" ||
    blend === "overlay" ||
    blend === "soft-light" ||
    blend === "over"
  ) {
    return blend;
  }

  return "over";
}

export async function premultiplyLayer(input: Buffer): Promise<Buffer> {
  const sharp = getSharp();
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    data[i] = Math.round((data[i] * alpha) / 255);
    data[i + 1] = Math.round((data[i + 1] * alpha) / 255);
    data[i + 2] = Math.round((data[i + 2] * alpha) / 255);
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export async function applyLuminanceAwareMask(
  effectLayer: Buffer,
  designLayer: Buffer,
  mode: "shadow" | "highlight",
): Promise<Buffer> {
  const sharp = getSharp();
  const effect = await sharp(effectLayer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const design = await sharp(designLayer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    effect.info.width !== design.info.width ||
    effect.info.height !== design.info.height
  ) {
    throw new Error("Effect and design layers must match dimensions");
  }

  const { data } = effect;
  const designData = design.data;

  for (let i = 0; i < data.length; i += 4) {
    const designAlpha = designData[i + 3];
    if (designAlpha === 0) {
      data[i + 3] = 0;
      continue;
    }

    const lum = luminance(designData[i], designData[i + 1], designData[i + 2]);
    const normalized = lum / 255;
    const weight =
      mode === "shadow"
        ? 0.35 + 0.65 * (1 - normalized)
        : 0.35 + 0.65 * normalized;

    data[i + 3] = Math.round((data[i + 3] * weight * designAlpha) / 255);
  }

  return sharp(data, {
    raw: {
      width: effect.info.width,
      height: effect.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}
