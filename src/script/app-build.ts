import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const entrypoint = resolve(root, "src/index.ts");
const outdir = resolve(root, "dist");
const isProduction = process.env.NODE_ENV === "production";

if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true, force: true });
}

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir,
  target: "bun",
  format: "esm",
  minify: isProduction,
  sourcemap: isProduction ? "none" : "linked",
  naming: "[dir]/[name].[ext]",
});

if (!result.success) {
  console.error("Elysia build failed\n");

  for (const message of result.logs) {
    console.error(message);
  }

  process.exit(1);
}

for (const output of result.outputs) {
  console.log(`  ${output.path.replace(`${root}/`, "")}`);
}

console.log(`\nBuilt ${result.outputs.length} file(s) to dist/`);
