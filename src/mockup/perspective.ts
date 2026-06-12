import { getSharp } from "../platform/sharp/client.js";
import type { CanvasConfig, Point, PrintAreaConfig } from "./types.js";

type Mat3 = [number, number, number, number, number, number, number, number, number];

function invertMat3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(det) < 1e-8) {
    return null;
  }

  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

function computeHomography(
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point],
): Mat3 | null {
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = src[i];
    const { x: dx, y: dy } = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    B.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    B.push(dy);
  }

  const h = solveLinearSystem8x8(A, B);
  if (!h) {
    return null;
  }

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solveLinearSystem8x8(A: number[][], B: number[]): number[] | null {
  const n = 8;
  const matrix = A.map((row, i) => [...row, B[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(matrix[pivot][col]) < 1e-10) {
      return null;
    }

    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const pivotVal = matrix[col][col];
    for (let j = col; j <= n; j++) {
      matrix[col][j] /= pivotVal;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) {
        continue;
      }
      const factor = matrix[row][col];
      for (let j = col; j <= n; j++) {
        matrix[row][j] -= factor * matrix[col][j];
      }
    }
  }

  return matrix.map((row) => row[n]);
}

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

export function getPrintAreaQuad(printArea: PrintAreaConfig): [Point, Point, Point, Point] {
  if (printArea.quad) {
    return printArea.quad;
  }

  return [
    { x: printArea.x, y: printArea.y },
    { x: printArea.x + printArea.width, y: printArea.y },
    { x: printArea.x + printArea.width, y: printArea.y + printArea.height },
    { x: printArea.x, y: printArea.y + printArea.height },
  ];
}

export function hasPerspectiveWarp(printArea: PrintAreaConfig): boolean {
  return Boolean(printArea.quad);
}

export async function warpDesignToQuad(
  design: Buffer,
  canvas: CanvasConfig,
  placement: {
    left: number;
    top: number;
    resizedWidth: number;
    resizedHeight: number;
  },
  quad: [Point, Point, Point, Point],
): Promise<Buffer> {
  const sharp = getSharp();
  const designResult = await sharp(design)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const src: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: placement.resizedWidth, y: 0 },
    { x: placement.resizedWidth, y: placement.resizedHeight },
    { x: 0, y: placement.resizedHeight },
  ];

  const dst: [Point, Point, Point, Point] = [
    { x: quad[0].x - placement.left, y: quad[0].y - placement.top },
    { x: quad[1].x - placement.left, y: quad[1].y - placement.top },
    { x: quad[2].x - placement.left, y: quad[2].y - placement.top },
    { x: quad[3].x - placement.left, y: quad[3].y - placement.top },
  ];

  const homography = computeHomography(src, dst);
  if (!homography) {
    return design;
  }

  const inverse = invertMat3(homography);
  if (!inverse) {
    return design;
  }

  const localWidth = placement.resizedWidth;
  const localHeight = placement.resizedHeight;
  const output = Buffer.alloc(localWidth * localHeight * 4);
  const source = designResult.data;

  for (let y = 0; y < localHeight; y++) {
    for (let x = 0; x < localWidth; x++) {
      const denom = inverse[6] * x + inverse[7] * y + inverse[8];
      if (Math.abs(denom) < 1e-8) {
        continue;
      }

      const srcX = (inverse[0] * x + inverse[1] * y + inverse[2]) / denom;
      const srcY = (inverse[3] * x + inverse[4] * y + inverse[5]) / denom;
      const [r, g, b, a] = sampleBilinear(
        source,
        designResult.info.width,
        designResult.info.height,
        srcX,
        srcY,
      );
      const outIndex = (y * localWidth + x) * 4;
      output[outIndex] = r;
      output[outIndex + 1] = g;
      output[outIndex + 2] = b;
      output[outIndex + 3] = a;
    }
  }

  const warpedLocal = await sharp(output, {
    raw: { width: localWidth, height: localHeight, channels: 4 },
  })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: warpedLocal, left: placement.left, top: placement.top }])
    .png()
    .toBuffer();
}
