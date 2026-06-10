import { join } from "node:path";
import { env } from "../src/config/env";
import { withRenderLock } from "../src/mockup/lock";
import { renderMockup } from "../src/mockup/render";

const designPath = join(env.projectRoot, "src/assets/designs/design-01.png");
const templateId = "generic-hang-white";

console.log(`[render-test] templateId=${templateId}`);
console.log(`[render-test] designPath=${designPath}`);

try {
  const result = await withRenderLock(() =>
    renderMockup({
      templateId,
      designPath,
      debug: true,
    }),
  );

  console.log(`[render-test] success outputPath=${result.outputPath}`);
  console.log(
    `[render-test] dimensions=${result.width}x${result.height}`,
  );
} catch (error) {
  console.error("[render-test] failed", error);
  process.exit(1);
}
