import { getSharp } from "../platform/sharp/client.js";

export async function featherAlphaMask(
  mask: Buffer,
  featherPx: number,
): Promise<Buffer> {
  if (featherPx <= 0) {
    return mask;
  }

  const sharp = getSharp();
  const { data, info } = await sharp(mask)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const alphaOnly = Buffer.alloc(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    alphaOnly[j] = data[i + 3];
  }

  const blurred = await sharp(alphaOnly, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .blur(featherPx)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const output = Buffer.from(data);
  const channelStride = blurred.info.channels;
  for (let i = 0, j = 0; i < output.length; i += 4, j++) {
    output[i + 3] = blurred.data[j * channelStride];
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

export async function luminanceToAlphaMask(
  maskPath: string,
  featherPx = 0,
): Promise<Buffer> {
  const sharp = getSharp();
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

  const mask = await sharp(output, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  return featherAlphaMask(mask, featherPx);
}

export async function extractAlphaMaskFromLayer(layer: Buffer): Promise<Buffer> {
  const sharp = getSharp();
  const { data, info } = await sharp(layer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const output = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 4) {
    output[i] = 255;
    output[i + 1] = 255;
    output[i + 2] = 255;
    output[i + 3] = data[i + 3];
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
  const sharp = getSharp();
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
