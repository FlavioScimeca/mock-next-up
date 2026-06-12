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
  // Dark garments still need the design softened and de-digitalized, but the
  // previous defaults were too destructive for a generic renderer. Keep the
  // default conservative and let specific templates opt into stronger color
  // behavior through explicit config values.
  dark: {
    brightness: 1.02,
    saturation: 0.96,
    contrast: 0.95,
    blackLift: 6,
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
  // Keep this hook as a future extension point, but do not mutate the design
  // automatically. The previous dark-substrate underbase simulation was too
  // opinionated and could make normal POD artwork look muddy or washed out.
  // Real underbase simulation needs a separate, explicit config and better
  // garment-specific tuning.
  void substrate;
  return input;
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
