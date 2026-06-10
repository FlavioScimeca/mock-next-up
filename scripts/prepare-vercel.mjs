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
  console.log("prepare-vercel: skipped (not linux)");
  process.exit(0);
}

const vendorRoot = join(root, "api", "vendor");

if (existsSync(vendorRoot)) {
  rmSync(vendorRoot, { recursive: true, force: true });
}

mkdirSync(vendorRoot, { recursive: true });

const wasmSrc = join(root, "node_modules", "@img", "sharp-wasm32");
const assetsSrc = join(root, "src", "assets");

if (!existsSync(wasmSrc)) {
  console.error(`prepare-vercel: missing ${wasmSrc}`);
  process.exit(1);
}

if (!existsSync(assetsSrc)) {
  console.error(`prepare-vercel: missing ${assetsSrc}`);
  process.exit(1);
}

cpSync(wasmSrc, join(vendorRoot, "sharp-wasm32"), { recursive: true });
cpSync(assetsSrc, join(vendorRoot, "assets"), { recursive: true });

const wasmLibDir = join(vendorRoot, "sharp-wasm32", "lib");
const libFiles = readdirSync(wasmLibDir);
const wasmLoader = libFiles.find((name) => name.endsWith(".node.js"));
const wasmBinary = libFiles.find((name) => name.endsWith(".node.wasm"));

if (!wasmLoader || !wasmBinary) {
  console.error(`prepare-vercel: invalid wasm layout in ${wasmLibDir}`);
  process.exit(1);
}

const designsDir = join(vendorRoot, "assets", "designs");
const templateConfig = join(
  vendorRoot,
  "assets/templates/t-shirt/hang/white/v1/config.json",
);

if (!existsSync(designsDir)) {
  console.error(`prepare-vercel: missing ${designsDir}`);
  process.exit(1);
}

if (!existsSync(templateConfig)) {
  console.error(`prepare-vercel: missing ${templateConfig}`);
  process.exit(1);
}

const bindingModule = join(root, "src", "mockup", "sharp-vercel-binding.cjs");
const assetsModule = join(root, "src", "mockup", "sharp-vercel-assets.cjs");

writeFileSync(
  bindingModule,
  `"use strict";
const { join } = require("path");
const { existsSync, readFileSync } = require("fs");

const libDir = join(__dirname, "../../api/vendor/sharp-wasm32/lib");
const wasmBinaryPath = join(libDir, ${JSON.stringify(wasmBinary)});
const wasmLoaderPath = join(libDir, ${JSON.stringify(wasmLoader)});

if (!existsSync(wasmBinaryPath)) {
  throw new Error(\`Missing sharp wasm binary at \${wasmBinaryPath}\`);
}

readFileSync(wasmBinaryPath);
module.exports = require(wasmLoaderPath);
`,
);

writeFileSync(
  assetsModule,
  `"use strict";
const { join } = require("path");
const { existsSync, readFileSync } = require("fs");

const assetsRoot = join(__dirname, "../../api/vendor/assets");
const templateConfig = join(assetsRoot, "templates/t-shirt/hang/white/v1/config.json");
const sampleDesign = join(assetsRoot, "designs/design-01.png");

for (const path of [templateConfig, sampleDesign]) {
  if (!existsSync(path)) {
    throw new Error(\`Missing mockup asset at \${path}\`);
  }
  readFileSync(path);
}

module.exports = { assetsRoot };
`,
);

console.log(`prepare-vercel: wasm=${join(wasmLibDir, wasmLoader)}`);
console.log(`prepare-vercel: assets=${join(vendorRoot, "assets")}`);
console.log("prepare-vercel: ready");
