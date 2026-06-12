import { getSharp } from "../platform/sharp/client.js";
import type { FabricConfig } from "./types.js";

function luminance(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
}

function blendMultiplyChannel(
  design: number,
  fabric: number,
  strength: number,
): number {
  const blended = Math.round((design * fabric) / 255);
  return Math.round(design * (1 - strength) + blended * strength);
}

function blendScreenChannel(
  design: number,
  fabric: number,
  strength: number,
): number {
  const blended = Math.round(255 - ((255 - design) * (255 - fabric)) / 255);
  return Math.round(design * (1 - strength) + blended * strength);
}

function blendOverlayChannel(
  design: number,
  fabric: number,
  strength: number,
): number {
  const blended =
    design < 128
      ? Math.round((2 * design * fabric) / 255)
      : Math.round(255 - (2 * (255 - design) * (255 - fabric)) / 255);
  return Math.round(design * (1 - strength) + blended * strength);
}

export function shouldUseEmbeddedFabric(fabric?: FabricConfig): boolean {
  if (!fabric?.enabled) {
    return false;
  }

  if (fabric.embedded !== undefined) {
    return fabric.embedded;
  }

  return fabric.textureSource === "fabricSplit";
}

export async function applyKnockoutFabricBlend(
  printedDesign: Buffer,
  basePath: string,
  options: {
    fabric?: FabricConfig;
    fabricDarkPath?: string;
    fabricLightPath?: string;
  },
): Promise<Buffer> {
  const sharp = getSharp();
  const fabric = options.fabric;
  const blendMode = fabric?.blend ?? "multiply";
  const textureOpacity = fabric?.textureOpacity ?? 0.05;
  const darkOpacity = fabric?.darkOpacity ?? 0.05;
  const lightOpacity = fabric?.lightOpacity ?? 0.05;

  const designResult = await sharp(printedDesign)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const baseResult = await sharp(basePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = designResult.info;
  const output = Buffer.from(designResult.data);
  const base = baseResult.data;

  let darkData: Buffer | undefined;
  let lightData: Buffer | undefined;

  if (options.fabricDarkPath) {
    darkData = (
      await sharp(options.fabricDarkPath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    ).data;
  }

  if (options.fabricLightPath) {
    lightData = (
      await sharp(options.fabricLightPath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
    ).data;
  }

  for (let i = 0; i < output.length; i += 4) {
    const alpha = output[i + 3];
    if (alpha === 0) {
      continue;
    }

    const baseR = base[i];
    const baseG = base[i + 1];
    const baseB = base[i + 2];
    const baseLum = luminance(baseR, baseG, baseB) / 255;

    let r = output[i];
    let g = output[i + 1];
    let b = output[i + 2];

    const embedStrength = 0.35 + baseLum * 0.25;

    if (fabric?.textureSource === "fabricSplit" && darkData && lightData) {
      const darkLum = luminance(darkData[i], darkData[i + 1], darkData[i + 2]);
      const lightLum = luminance(
        lightData[i],
        lightData[i + 1],
        lightData[i + 2],
      );

      r = blendMultiplyChannel(r, darkLum, darkOpacity * embedStrength);
      g = blendMultiplyChannel(g, darkLum, darkOpacity * embedStrength);
      b = blendMultiplyChannel(b, darkLum, darkOpacity * embedStrength);

      r = blendScreenChannel(r, lightLum, lightOpacity * embedStrength);
      g = blendScreenChannel(g, lightLum, lightOpacity * embedStrength);
      b = blendScreenChannel(b, lightLum, lightOpacity * embedStrength);
    } else {
      const blendChannel = (
        design: number,
        fabricChannel: number,
        strength: number,
      ) => {
        if (blendMode === "overlay") {
          return blendOverlayChannel(design, fabricChannel, strength);
        }
        if (blendMode === "soft-light") {
          return blendOverlayChannel(design, fabricChannel, strength * 0.85);
        }
        return blendMultiplyChannel(design, fabricChannel, strength);
      };

      r = blendChannel(r, baseR, textureOpacity * embedStrength);
      g = blendChannel(g, baseG, textureOpacity * embedStrength);
      b = blendChannel(b, baseB, textureOpacity * embedStrength);
    }

    output[i] = r;
    output[i + 1] = g;
    output[i + 2] = b;
  }

  return sharp(output, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
