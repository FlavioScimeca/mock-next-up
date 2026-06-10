import { existsSync, readdirSync } from "node:fs";
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

function loadBindingFromPackageDir(packageDir: string): unknown {
  return createRequire(join(packageDir, "index.cjs"))("./index.cjs");
}

function resolveVercelNativePaths(): {
  sharpPackageDir: string;
  libDir: string;
} {
  const apiSharpDir = join(env.projectRoot, "api/sharp-native/sharp-linux-x64");
  const apiLibDir = join(
    env.projectRoot,
    "api/sharp-native/sharp-libvips-linux-x64/lib",
  );

  if (existsSync(join(apiSharpDir, "index.cjs")) && existsSync(apiLibDir)) {
    return { sharpPackageDir: apiSharpDir, libDir: apiLibDir };
  }

  const sharpPackageDir = dirname(
    require.resolve("@img/sharp-linux-x64/package.json"),
  );
  const libDir = join(
    dirname(require.resolve("@img/sharp-libvips-linux-x64/package.json")),
    "lib",
  );

  return { sharpPackageDir, libDir };
}

function initVercelSharp(): void {
  const { sharpPackageDir, libDir } = resolveVercelNativePaths();

  if (!existsSync(join(sharpPackageDir, "index.cjs"))) {
    const libDirPath = join(sharpPackageDir, "lib");
    const libContents = existsSync(libDirPath)
      ? readdirSync(libDirPath).join(", ")
      : "(missing)";

    throw new Error(
      `sharp native package not found at ${sharpPackageDir} (lib: ${libContents}). Check Vercel build logs for postinstall-sharp.`,
    );
  }

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
