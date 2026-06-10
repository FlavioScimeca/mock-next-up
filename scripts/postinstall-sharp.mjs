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
const wasmEntry = readdirSync(wasmLibDir).find((name) => name.endsWith(".node.js"));

if (!wasmEntry) {
  console.error(`postinstall-sharp: no wasm loader in ${wasmLibDir}`);
  process.exit(1);
}

const bindingModule = join(root, "src", "mockup", "sharp-vercel-binding.cjs");

writeFileSync(
  bindingModule,
  `"use strict";
module.exports = require("../native/sharp-wasm32/lib/${wasmEntry}");
`,
);

console.log(`postinstall-sharp: wasm binding=${join(wasmLibDir, wasmEntry)}`);
console.log(`postinstall-sharp: wrote ${bindingModule}`);
console.log("postinstall-sharp: ready");
