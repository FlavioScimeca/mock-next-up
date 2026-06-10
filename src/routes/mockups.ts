import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { env } from "../config/env.js";
import { isPngBuffer } from "../lib/png.js";
import { setRequestLog } from "../logging.js";
import { renderTestMockups } from "../mockup/batch-test.js";
import {
  getErrorStatus,
  MockupError,
  toErrorResponse,
} from "../mockup/errors.js";
import { withRenderLock } from "../mockup/lock.js";
import { renderMockup } from "../mockup/render.js";
import { ensureSharpReady } from "../platform/sharp/client.js";

export const mockupRoutes = new Elysia()
  .post(
    "/mockups/render",
    async ({ body, set }) => {
      await ensureSharpReady();

      const templateId = body.templateId?.trim();

      setRequestLog({ mockup: { route: "render", templateId } });

      if (!templateId) {
        set.status = 400;
        setRequestLog({ error: { code: "MISSING_TEMPLATE_ID" } });
        return toErrorResponse(
          new MockupError(
            "MISSING_TEMPLATE_ID",
            "templateId is required",
            400,
          ),
        );
      }

      if (!body.design) {
        set.status = 400;
        setRequestLog({ error: { code: "MISSING_DESIGN" } });
        return toErrorResponse(
          new MockupError("MISSING_DESIGN", "design file is required", 400),
        );
      }

      const designBuffer = Buffer.from(await body.design.arrayBuffer());

      if (
        body.design.type !== "image/png" &&
        !isPngBuffer(designBuffer)
      ) {
        set.status = 415;
        setRequestLog({ error: { code: "UNSUPPORTED_FILE_TYPE" } });
        return toErrorResponse(
          new MockupError(
            "UNSUPPORTED_FILE_TYPE",
            "Only PNG designs are supported",
            415,
          ),
        );
      }

      await mkdir(env.uploadsDir, { recursive: true });
      const uploadPath = join(
        env.uploadsDir,
        `${Date.now()}-${randomBytes(4).toString("hex")}.png`,
      );

      try {
        await writeFile(uploadPath, designBuffer);

        const result = await withRenderLock(() =>
          renderMockup({
            templateId,
            designPath: uploadPath,
          }),
        );

        setRequestLog({
          mockup: {
            outputPath: result.outputPath,
            width: result.width,
            height: result.height,
          },
        });

        return result;
      } catch (error) {
        set.status = getErrorStatus(error);
        if (error instanceof MockupError) {
          setRequestLog({
            error: { code: error.code, message: error.message },
          });
        }
        return toErrorResponse(error);
      } finally {
        try {
          await unlink(uploadPath);
        } catch {
          // Ignore cleanup errors for missing temp files.
        }
      }
    },
    {
      body: t.Object({
        templateId: t.String(),
        design: t.File(),
      }),
    },
  )
  .post(
    "/mockups/test",
    async ({ body, query, set }) => {
      await ensureSharpReady();

      const templateId = body?.templateId ?? query.templateId;
      const debug = parseDebugFlag(body?.debug ?? query.debug);

      setRequestLog({
        mockup: {
          route: "test",
          templateId: templateId ?? "generic-hang-white",
          debug,
        },
      });

      try {
        const result = await renderTestMockups({
          templateId,
          debug,
        });

        setRequestLog({
          mockup: {
            total: result.total,
            succeeded: result.succeeded,
            failed: result.failed,
          },
        });

        return result;
      } catch (error) {
        set.status = getErrorStatus(error);
        if (error instanceof MockupError) {
          setRequestLog({
            error: { code: error.code, message: error.message },
          });
        }
        return toErrorResponse(error);
      }
    },
    {
      body: t.Optional(
        t.Object({
          templateId: t.Optional(t.String()),
          debug: t.Optional(t.Boolean()),
        }),
      ),
      query: t.Optional(
        t.Object({
          templateId: t.Optional(t.String()),
          debug: t.Optional(t.String()),
        }),
      ),
    },
  );

function parseDebugFlag(value: boolean | string | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}
