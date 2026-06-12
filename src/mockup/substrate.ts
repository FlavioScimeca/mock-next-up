import { getSharp } from "../platform/sharp/client.js";
import type { PrintAreaConfig, PrintConfig, PrintSubstrate } from "./types.js";

const SUBSTRATE_DEFAULTS: Record<
  PrintSubstrate,
  Partial<PrintConfig>
> = {
  light: {
    brightness: 1.02,
    saturation: 0.96,
    contrast: 0.95,
    blackLift: 6,
  },
  dark: {
    brightness: 0.92,
    saturation: 0.9,
    contrast: 0.9,
    blackLift: 10,
  },
  color: {
    brightness: 1,
    saturation: 0.94,
    contrast: 0.93,
    blackLift: 8,
  },
};

export function resolveEffectivePrintConfig(
  print?: PrintConfig,
): PrintConfig {
  const substrate = print?.substrate ?? "light";
  const defaults = SUBSTRATE_DEFAULTS[substrate];

  return {
    ...defaults,
    ...print,
    substrate,
  };
}

async function sampleBaseDominantRgb(
  basePath: string,
  printArea: PrintAreaConfig,
): Promise<{ r: number; g: number; b: number }> {
  const sharp = getSharp();
  const { data, info } = await sharp(basePath)
    .extract({
      left: printArea.x,
      top: printArea.y,
      width: printArea.width,
      height: printArea.height,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = data.length / info.channels;

  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }

  return {
    r: Math.round(r / pixels),
    g: Math.round(g / pixels),
    b: Math.round(b / pixels),
  };
}

export async function applySubstrateUnderbase(
  input: Buffer,
  substrate: PrintSubstrate | undefined,
): Promise<Buffer> {
  if (substrate !== "dark") {
    return input;
  }

  const sharp = getSharp();
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) {
      continue;
    }

    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (lum > 200) {
      const underbaseAlpha = Math.round(alpha * 0.55);
      const gray = Math.round(180 + (255 - lum) * 0.15);
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
      data[i + 3] = underbaseAlpha;
    }
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

export async function applyColorSubstrateTint(
  input: Buffer,
  basePath: string,
  printArea: PrintAreaConfig,
  substrate: PrintSubstrate | undefined,
): Promise<Buffer> {
  if (substrate !== "color") {
    return input;
  }

  const dominant = await sampleBaseDominantRgb(basePath, printArea);
  const sharp = getSharp();
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const strength = 0.08;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      continue;
    }

    data[i] = Math.round(data[i] * (1 - strength) + dominant.r * strength);
    data[i + 1] = Math.round(data[i + 1] * (1 - strength) + dominant.g * strength);
    data[i + 2] = Math.round(data[i + 2] * (1 - strength) + dominant.b * strength);
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
