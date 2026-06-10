import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.platform !== "linux") {
  console.log(`postinstall-sharp: skipped (${process.platform})`);
  process.exit(0);
}

const packages = ["sharp-linux-x64", "sharp-libvips-linux-x64"];
const targetRoots = [
  join(root, "src", "native", "sharp-native"),
  join(root, "api", "sharp-native"),
];

for (const targetRoot of targetRoots) {
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
  }

  const sharpLibDir = join(targetRoot, "sharp-linux-x64", "lib");
  const libvipsLibDir = join(targetRoot, "sharp-libvips-linux-x64", "lib");
  const sharpNode = readdirSync(sharpLibDir).find((name) => name.endsWith(".node"));

  if (!sharpNode || !existsSync(libvipsLibDir)) {
    console.error(`postinstall-sharp: invalid layout under ${targetRoot}`);
    process.exit(1);
  }

  console.log(`postinstall-sharp: ready ${targetRoot}`);
}
