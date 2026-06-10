import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
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

function resolveVercelNativePaths(): { bindingPath: string; libDir: string } {
  const apiRoot = join(env.projectRoot, "api/sharp-native");
  const apiBinding = join(apiRoot, "sharp-linux-x64", "sharp.node");
  const apiLibDir = join(apiRoot, "sharp-libvips-linux-x64", "lib");

  if (existsSync(apiBinding) && existsSync(apiLibDir)) {
    return { bindingPath: apiBinding, libDir: apiLibDir };
  }

  const sharpDir = dirname(require.resolve("@img/sharp-linux-x64/package.json"));
  const libvipsDir = dirname(
    require.resolve("@img/sharp-libvips-linux-x64/package.json"),
  );

  return {
    bindingPath: join(sharpDir, "sharp.node"),
    libDir: join(libvipsDir, "lib"),
  };
}

function initVercelSharp(): void {
  const { bindingPath, libDir } = resolveVercelNativePaths();

  if (!existsSync(bindingPath)) {
    throw new Error(
      `sharp native binding not found at ${bindingPath}. Check Vercel build logs for postinstall-sharp.`,
    );
  }

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
