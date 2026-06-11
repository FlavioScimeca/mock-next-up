import { join } from "node:path";
import { env } from "../src/config/env.js";
import { listDesignPngs } from "../src/mockup/batch-test.js";
import { withRenderLock } from "../src/mockup/lock.js";
import { renderMockup } from "../src/mockup/render.js";

const designPaths = await listDesignPngs();
const designPath = designPaths[18];

if (!designPath) {
  console.error(
    `[render-test] failed no PNG designs found in ${join(env.projectRoot, "src/assets/designs")}`,
  );
  process.exit(1);
}

const templateId = "generic-hang-white";

console.log(`[render-test] templateId=${templateId}`);
console.log(`[render-test] designPath=${designPath}`);

try {
  const result = await withRenderLock(() =>
    renderMockup({
      templateId,
      designPath,
      debug: true,
      configOverride: {
        design: { opacity: 0.8 },
        fabric: {
          enabled: true,
          textureSource: "shadow",
          textureOpacity: 0.5,
          blend: "multiply",
        },
        layers: {
          shadow: { enabled: true, blend: "multiply", opacity: 0.6 },
          highlight: { enabled: true, blend: "screen", opacity: 0.3 },
        },
      },
    }),
  );

  console.log(`[render-test] success outputPath=${result.outputPath}`);
  console.log(`[render-test] dimensions=${result.width}x${result.height}`);
} catch (error) {
  console.error("[render-test] failed", error);
  process.exit(1);
}
