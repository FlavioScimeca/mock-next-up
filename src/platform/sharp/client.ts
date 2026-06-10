import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type Sharp from "sharp";
import { env } from "../../config/env.js";

const require = createRequire(import.meta.url);

let sharpModule: typeof Sharp | null = null;
let ready: Promise<void> | null = null;

function patchSharpBindingModule(binding: unknown): void {
  const sharpEntry = require.resolve("sharp");
  const sharpBindingModule = join(dirname(sharpEntry), "sharp.cjs");

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
  const binding = require("./vercel-binding.cjs");

  if (!binding) {
    throw new Error(
      "sharp wasm binding missing. Run prepare-vercel on the Vercel builder (linux).",
    );
  }

  patchSharpBindingModule(binding);
  sharpModule = require("sharp") as typeof Sharp;
}

function initSharp(): void {
  if (sharpModule) {
    return;
  }

  if (env.isVercel) {
    initVercelSharp();
    return;
  }

  sharpModule = require("sharp") as typeof Sharp;
}

export function ensureSharpReady(): Promise<void> {
  if (!ready) {
    ready = Promise.resolve().then(() => {
      initSharp();
    });
  }

  return ready;
}

export function getSharp(): typeof Sharp {
  if (!sharpModule) {
    initSharp();
  }

  return sharpModule!;
}
