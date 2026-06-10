import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "linux") {
  console.log(`postinstall-sharp: skipped (${process.platform})`);
  process.exit(0);
}

const packages = ["sharp-linux-x64", "sharp-libvips-linux-x64"];
const targetRoot = join(root, "api", "sharp-native");

if (existsSync(targetRoot)) {
  rmSync(targetRoot, { recursive: true, force: true });
}

mkdirSync(targetRoot, { recursive: true });

for (const name of packages) {
  const src = join(root, "node_modules", "@img", name);

  if (!existsSync(src)) {
    console.error(`postinstall-sharp: missing ${src}`);
    process.exit(1);
  }

  cpSync(src, join(targetRoot, name), { recursive: true });
  console.log(`postinstall-sharp: copied ${name} -> api/sharp-native/${name}`);
}

const sharpLibDir = join(targetRoot, "sharp-linux-x64", "lib");
const libvipsLibDir = join(targetRoot, "sharp-libvips-linux-x64", "lib");

if (!existsSync(sharpLibDir)) {
  console.error(`postinstall-sharp: missing sharp lib dir ${sharpLibDir}`);
  process.exit(1);
}

const sharpNode = readdirSync(sharpLibDir).find((name) => name.endsWith(".node"));

if (!sharpNode) {
  console.error(
    `postinstall-sharp: no .node binding in ${sharpLibDir}: ${readdirSync(sharpLibDir).join(", ")}`,
  );
  process.exit(1);
}

if (!existsSync(libvipsLibDir)) {
  console.error(`postinstall-sharp: missing libvips lib dir ${libvipsLibDir}`);
  process.exit(1);
}

console.log(`postinstall-sharp: binding=${join(sharpLibDir, sharpNode)}`);
console.log(`postinstall-sharp: libvips=${libvipsLibDir}`);
console.log("postinstall-sharp: ready");
