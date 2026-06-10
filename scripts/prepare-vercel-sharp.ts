import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const isVercel = Boolean(process.env.VERCEL);

if (!isVercel) {
  console.log("prepare-vercel-sharp: skipped (set VERCEL=1 on Vercel builds)");
  process.exit(0);
}

const packages = ["sharp-linux-x64", "sharp-libvips-linux-x64"] as const;
const vendorRoot = join(root, "src", "vendor", "sharp-native");

if (existsSync(vendorRoot)) {
  rmSync(vendorRoot, { recursive: true, force: true });
}

mkdirSync(vendorRoot, { recursive: true });

for (const name of packages) {
  const src = join(root, "node_modules", "@img", name);

  if (!existsSync(src)) {
    console.error(`prepare-vercel-sharp: missing ${src}`);
    console.error(
      "Ensure Vercel installCommand installs @img/sharp-linux-x64 and @img/sharp-libvips-linux-x64",
    );
    process.exit(1);
  }

  cpSync(src, join(vendorRoot, name), { recursive: true });
  console.log(`prepare-vercel-sharp: copied ${name}`);
}
