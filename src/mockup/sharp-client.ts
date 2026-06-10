import { createRequire } from "node:module";
import { join } from "node:path";
import type Sharp from "sharp";
import { env } from "../config/env.js";

const require = createRequire(import.meta.url);

let sharpModule: typeof Sharp | null = null;

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

function initVercelSharp(): void {
  const nativeRoot = join(env.projectRoot, "api/sharp-native");
  const libDir = join(nativeRoot, "sharp-libvips-linux-x64", "lib");
  const bindingPath = join(nativeRoot, "sharp-linux-x64", "sharp.node");

  process.env.LD_LIBRARY_PATH = libDir;
  patchSharpBindingModule(require(bindingPath));
  sharpModule = require("sharp") as typeof Sharp;
}

export function initSharp(): void {
  if (sharpModule) {
    return;
  }

  if (env.isVercel) {
    initVercelSharp();
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
