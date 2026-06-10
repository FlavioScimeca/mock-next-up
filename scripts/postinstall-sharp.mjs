import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.VERCEL) {
  console.log("postinstall-sharp: skipped (local install)");
  process.exit(0);
}

const packages = ["sharp-linux-x64", "sharp-libvips-linux-x64"];
const vendorRoot = join(root, "src", "vendor", "sharp-native");

if (existsSync(vendorRoot)) {
  rmSync(vendorRoot, { recursive: true, force: true });
}

mkdirSync(vendorRoot, { recursive: true });

for (const name of packages) {
  const src = join(root, "node_modules", "@img", name);

  if (!existsSync(src)) {
    console.error(`postinstall-sharp: missing ${src}`);
    process.exit(1);
  }

  cpSync(src, join(vendorRoot, name), { recursive: true });
  console.log(`postinstall-sharp: copied ${name}`);
}
