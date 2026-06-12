import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { env } from "../src/config/env.js";
import { listDesignPngs } from "../src/mockup/batch-test.js";
import { withRenderLock } from "../src/mockup/lock.js";
import { renderMockup } from "../src/mockup/render.js";
import { loadTemplate } from "../src/mockup/template.js";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function createBatchOutputDir(prefix: string): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("");
  const time = [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");

  return join(env.outputsDir, `${prefix}-${date}-${time}`);
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

const designPaths = await listDesignPngs();

if (designPaths.length === 0) {
  console.error(
    `[render-test] failed no PNG designs found in ${join(env.projectRoot, "src/assets/designs")}`,
  );
  process.exit(1);
}

const templateId = process.env.TEMPLATE_ID ?? "generic-hang-white";
const template = await loadTemplate(templateId);
const outputExtension =
  template.config.output.format === "jpeg" ? "jpg" : "png";
const outputDir = createBatchOutputDir(`render-test-${templateId}`);

await mkdir(outputDir, { recursive: true });

console.log(`[render-test] templateId=${templateId}`);
console.log(`[render-test] designs=${designPaths.length}`);
console.log(`[render-test] outputFormat=${template.config.output.format}`);
console.log(`[render-test] outputDir=${outputDir}`);

let succeeded = 0;
let failed = 0;

for (const designPath of designPaths) {
  const designName = basename(designPath);
  const outputName = `${stripExtension(designName)}.${outputExtension}`;
  const outputPath = join(outputDir, outputName);

  console.log(`[render-test] rendering design=${designName}`);

  try {
    const result = await withRenderLock(() =>
      renderMockup({
        templateId,
        designPath,
        outputPath,
        debug: true,
      }),
    );

    succeeded += 1;
    console.log(
      `[render-test] success design=${designName} outputPath=${result.outputPath}`,
    );
  } catch (error) {
    failed += 1;
    console.error(`[render-test] failed design=${designName}`, error);
  }
}

console.log(
  `[render-test] complete outputDir=${outputDir} total=${designPaths.length} succeeded=${succeeded} failed=${failed}`,
);

if (failed > 0) {
  process.exit(1);
}
