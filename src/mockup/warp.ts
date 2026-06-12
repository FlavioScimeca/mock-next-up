import { getSharp } from "../platform/sharp/client.js";

function sampleBilinear(
  data: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = clampedX - x0;
  const ty = clampedY - y0;

  const idx = (px: number, py: number) => (py * width + px) * 4;
  const sample = (px: number, py: number) => {
    const i = idx(px, py);
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
  };

  const c00 = sample(x0, y0);
  const c10 = sample(x1, y0);
  const c01 = sample(x0, y1);
  const c11 = sample(x1, y1);

  const channels: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = c00[c] * (1 - tx) + c10[c] * tx;
    const bottom = c01[c] * (1 - tx) + c11[c] * tx;
    channels[c] = Math.round(top * (1 - ty) + bottom * ty);
  }

  return channels;
}

export async function applyDisplacementWarp(
  layer: Buffer,
  displacementPath: string,
  strength: number,
): Promise<Buffer> {
  if (strength <= 0) {
    return layer;
  }

  const sharp = getSharp();
  const layerResult = await sharp(layer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mapResult = await sharp(displacementPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = layerResult.info;
  if (
    mapResult.info.width !== width ||
    mapResult.info.height !== height
  ) {
    throw new Error("Displacement map dimensions must match canvas");
  }

  const source = layerResult.data;
  const map = mapResult.data;
  const output = Buffer.alloc(source.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mapIndex = (y * width + x) * 4;
      const offsetX = ((map[mapIndex] - 128) / 128) * strength;
      const offsetY = ((map[mapIndex + 1] - 128) / 128) * strength;
      const [r, g, b, a] = sampleBilinear(
        source,
        width,
        height,
        x - offsetX,
        y - offsetY,
      );
      const outIndex = mapIndex;
      output[outIndex] = r;
      output[outIndex + 1] = g;
      output[outIndex + 2] = b;
      output[outIndex + 3] = a;
    }
  }

  return sharp(output, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}
