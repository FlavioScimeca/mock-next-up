import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "linux") {
  console.log(`postinstall-sharp: skipped (${process.platform})`);
  process.exit(0);
}

const wasmSrc = join(root, "node_modules", "@img", "sharp-wasm32");

if (!existsSync(wasmSrc)) {
  console.error(`postinstall-sharp: missing ${wasmSrc}`);
  console.error("Add @img/sharp-wasm32 to dependencies for Vercel builds.");
  process.exit(1);
}

const targetRoot = join(root, "src", "native", "sharp-wasm32");

if (existsSync(targetRoot)) {
  rmSync(targetRoot, { recursive: true, force: true });
}

cpSync(wasmSrc, targetRoot, { recursive: true });

const wasmLibDir = join(targetRoot, "lib");
const libFiles = readdirSync(wasmLibDir);
const wasmLoader = libFiles.find((name) => name.endsWith(".node.js"));
const wasmBinary = libFiles.find((name) => name.endsWith(".node.wasm"));

if (!wasmLoader || !wasmBinary) {
  console.error(
    `postinstall-sharp: expected .node.js and .node.wasm in ${wasmLibDir}, got: ${libFiles.join(", ")}`,
  );
  process.exit(1);
}

const bindingModule = join(root, "src", "mockup", "sharp-vercel-binding.cjs");

writeFileSync(
  bindingModule,
  `"use strict";
const { join } = require("path");
const { existsSync, readFileSync } = require("fs");

const libDir = join(__dirname, "../native/sharp-wasm32/lib");
const wasmBinaryPath = join(libDir, ${JSON.stringify(wasmBinary)});
const wasmLoaderPath = join(libDir, ${JSON.stringify(wasmLoader)});

if (!existsSync(wasmBinaryPath)) {
  throw new Error(\`Missing sharp wasm binary at \${wasmBinaryPath}\`);
}

// Vercel's tracer often ships the .node.js loader but drops the .wasm file unless
// it is referenced explicitly from traced source.
readFileSync(wasmBinaryPath);

module.exports = require(wasmLoaderPath);
`,
);

console.log(`postinstall-sharp: wasm loader=${join(wasmLibDir, wasmLoader)}`);
console.log(`postinstall-sharp: wasm binary=${join(wasmLibDir, wasmBinary)}`);
console.log(`postinstall-sharp: wrote ${bindingModule}`);
console.log("postinstall-sharp: ready");
