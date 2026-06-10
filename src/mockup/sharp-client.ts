import { createRequire } from "node:module";
import { join } from "node:path";
import type Sharp from "sharp";
import { env } from "../config/env";

const require = createRequire(import.meta.url);

let sharpModule: typeof Sharp | null = null;

function loadVercelNativeBinding(): unknown {
  const vendorRoot = join(import.meta.dir, "..", "vendor", "sharp-native");
  const bindingPath = join(vendorRoot, "sharp-linux-x64", "sharp.node");

  return require(bindingPath);
}

function patchSharpBindingModule(binding: unknown): void {
  const sharpPackageJson = require.resolve("sharp/package.json");
  const sharpBindingModule = join(sharpPackageJson, "..", "dist", "sharp.cjs");

  require.cache[sharpBindingModule] = {
    id: sharpBindingModule,
    filename: sharpBindingModule,
    loaded: true,
    exports: binding,
    children: [],
    paths: [],
  } as unknown as NodeModule;
}

export function initSharp(): void {
  if (sharpModule) {
    return;
  }

  if (env.isVercel) {
    patchSharpBindingModule(loadVercelNativeBinding());
  }

  sharpModule = require("sharp") as typeof Sharp;
}

export function getSharp(): typeof Sharp {
  if (!sharpModule) {
    initSharp();
  }

  return sharpModule!;
}
