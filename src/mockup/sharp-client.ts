import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Sharp from "sharp";
import { env } from "../config/env.js";

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));

let sharpModule: typeof Sharp | null = null;

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

function loadBindingFromPackageDir(packageDir: string): unknown {
  return createRequire(join(packageDir, "index.cjs"))("./index.cjs");
}

function resolveVercelNativePaths(): {
  sharpPackageDir: string;
  libDir: string;
} {
  const candidates = [
    join(moduleDir, "../native/sharp-native"),
    join(env.projectRoot, "src/native/sharp-native"),
    join(env.projectRoot, "api/sharp-native"),
    join(env.projectRoot, "node_modules/@img"),
  ];

  for (const root of candidates) {
    const sharpPackageDir = join(root, "sharp-linux-x64");
    const libDir = join(root, "sharp-libvips-linux-x64", "lib");

    if (existsSync(join(sharpPackageDir, "index.cjs")) && existsSync(libDir)) {
      return { sharpPackageDir, libDir };
    }
  }

  throw new Error(
    "sharp native binaries not found. Expected src/native/sharp-native on Vercel. Check postinstall-sharp build logs.",
  );
}

function initVercelSharp(): void {
  const { sharpPackageDir, libDir } = resolveVercelNativePaths();

  process.env.LD_LIBRARY_PATH = libDir;
  patchSharpBindingModule(loadBindingFromPackageDir(sharpPackageDir));
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
