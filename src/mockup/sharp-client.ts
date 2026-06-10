import { createRequire } from "node:module";
import { join } from "node:path";
import type Sharp from "sharp";
import { env } from "../config/env";

const require = createRequire(import.meta.url);

let sharpModule: typeof Sharp | null = null;

function loadWasmSharpBinding(): unknown {
  const wasmPackageJson = require.resolve("@img/sharp-wasm32/package.json");
  const wasmEntry = join(
    wasmPackageJson,
    "..",
    "lib",
    "sharp-wasm32-0.35.0.node.js",
  );

  return require(wasmEntry);
}

/**
 * Sharp on linux-x64 always tries native @img/sharp-linux-x64 first, which fails on
 * Vercel when libvips .so files are not bundled. Force the wasm binding instead.
 */
export function initSharp(): void {
  if (sharpModule) {
    return;
  }

  if (env.isVercel) {
    const wasmBinding = loadWasmSharpBinding();
    const sharpPackageJson = require.resolve("sharp/package.json");
    const sharpBindingModule = join(sharpPackageJson, "..", "dist", "sharp.cjs");

    require.cache[sharpBindingModule] = {
      id: sharpBindingModule,
      filename: sharpBindingModule,
      loaded: true,
      exports: wasmBinding,
      children: [],
      paths: [],
    } as unknown as NodeModule;
  }

  sharpModule = require("sharp") as typeof Sharp;
}

export function getSharp(): typeof Sharp {
  if (!sharpModule) {
    initSharp();
  }

  return sharpModule!;
}
