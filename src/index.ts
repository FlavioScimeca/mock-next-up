import { Elysia } from "elysia";
import { initLogger, parseError } from "evlog";
import { evlog } from "evlog/elysia";
import { env } from "./config/env";
import { isMockupError, toErrorResponse } from "./mockup/errors";
import { healthRoutes } from "./routes/health";
import { mockupRoutes } from "./routes/mockups";

initLogger({
  env: {
    service: process.env.EVLOG_SERVICE ?? "mock-next-up",
    environment: env.nodeEnv,
  },
});

const app = new Elysia()
  .use(
    evlog({
      exclude: ["/health"],
    }),
  )
  .get("/", () => "Hello World")
  .use(healthRoutes)
  .use(mockupRoutes)
  .onError(({ error, set, code, log }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      log?.set({ validation: { failed: true } });
      return error;
    }

    if (isMockupError(error)) {
      set.status = error.status;
      log?.set({
        error: { code: error.code, message: error.message },
      });
      return toErrorResponse(error);
    }

    const parsed = parseError(error);
    set.status = parsed.status ?? 500;
    log?.set({
      error: {
        code: parsed.code,
        message: parsed.message,
        status: parsed.status,
      },
    });

    return {
      success: false,
      error: parsed.message,
      ...(parsed.why ? { why: parsed.why } : {}),
      ...(parsed.fix ? { fix: parsed.fix } : {}),
      ...(parsed.link ? { link: parsed.link } : {}),
    };
  });

if (env.isDevelopment) {
  app.listen(env.port);

  console.log(`Listening on http://localhost:${env.port} (${env.nodeEnv})`);
}

export const GET = app.handle;
export const POST = app.handle;
export const PATCH = app.handle;
export const DELETE = app.handle;
export const PUT = app.handle;

export type API = typeof app;

export default app;
