import { getSharp } from "./sharp-client.js";

export async function applyOpacity(
  input: Buffer | string,
  opacity: number,
): Promise<Buffer> {
  const sharp = getSharp();
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round(data[i] * opacity);
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();
}
