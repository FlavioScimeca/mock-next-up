import sharp from "sharp";

export async function luminanceToAlphaMask(maskPath: string): Promise<Buffer> {
  const { data, info } = await sharp(maskPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const output = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const luminance = Math.round(
      (data[i] + data[i + 1] + data[i + 2]) / 3,
    );
    output[i] = 255;
    output[i + 1] = 255;
    output[i + 2] = 255;
    output[i + 3] = luminance;
  }

  return sharp(output, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

export async function applyAlphaMask(
  layer: Buffer,
  alphaMask: Buffer,
): Promise<Buffer> {
  const layerResult = await sharp(layer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const maskResult = await sharp(alphaMask)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    layerResult.info.width !== maskResult.info.width ||
    layerResult.info.height !== maskResult.info.height
  ) {
    throw new Error("Layer and alpha mask dimensions do not match");
  }

  const { data } = layerResult;
  const maskData = maskResult.data;

  for (let i = 3; i < data.length; i += 4) {
    data[i] = Math.round((data[i] * maskData[i]) / 255);
  }

  return sharp(data, {
    raw: {
      width: layerResult.info.width,
      height: layerResult.info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}
