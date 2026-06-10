import { createRequire } from "node:module";
import type Sharp from "sharp";

const require = createRequire(import.meta.url);

let sharpModule: typeof Sharp | null = null;

export function initSharp(): void {
  if (sharpModule) {
    return;
  }

  sharpModule = require("sharp") as typeof Sharp;
}

export function getSharp(): typeof Sharp {
  if (!sharpModule) {
    initSharp();
  }

  return sharpModule!;
}
