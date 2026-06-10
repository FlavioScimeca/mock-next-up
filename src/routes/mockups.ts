import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { env } from "../config/env.js";
import { setRequestLog } from "../logging.js";
import {
  getErrorStatus,
  MockupError,
  toErrorResponse,
} from "../mockup/errors.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type RenderDeps = {
  renderMockup: typeof import("../mockup/render.js").renderMockup;
  withRenderLock: typeof import("../mockup/lock.js").withRenderLock;
  renderTestMockups: typeof import("../mockup/batch-test.js").renderTestMockups;
};

let renderDepsPromise: Promise<RenderDeps> | null = null;

function loadRenderDeps(): Promise<RenderDeps> {
  if (!renderDepsPromise) {
    renderDepsPromise = import("../mockup/sharp-init.js")
      .then(({ ensureSharpReady }) => ensureSharpReady())
      .then(() =>
        Promise.all([
          import("../mockup/render.js"),
          import("../mockup/lock.js"),
          import("../mockup/batch-test.js"),
        ]),
      )
      .then(([render, lock, batch]) => ({
        renderMockup: render.renderMockup,
        withRenderLock: lock.withRenderLock,
        renderTestMockups: batch.renderTestMockups,
      }));
  }

  return renderDepsPromise;
}

function isPngBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) {
    return false;
  }

  return PNG_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

export const mockupRoutes = new Elysia()
  .post(
    "/mockups/render",
    async ({ body, set }) => {
      const { renderMockup, withRenderLock } = await loadRenderDeps();
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
      const { renderTestMockups } = await loadRenderDeps();
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
