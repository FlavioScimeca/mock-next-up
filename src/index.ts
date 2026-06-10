import { Elysia } from "elysia";
import { initLogger } from "evlog";
import { env } from "./config/env";
import { healthRoutes } from "./routes/health";
import { mockupRoutes } from "./routes/mockups";

initLogger({
  env: {
    service: process.env.EVLOG_SERVICE ?? "mock-next-up",
    environment: env.nodeEnv,
  },
});

// const app = new Elysia()
//   .get("/", () => "Hello World")
//   .use(
//     evlog({
//       exclude: ["/health"],
//     }),
//   )
//   .use(healthRoutes)
//   .use(mockupRoutes)
//   .onError(({ error, set, code, log }) => {
//     if (code === "VALIDATION") {
//       set.status = 422;
//       log?.set({ validation: { failed: true } });
//       return error;
//     }

//     if (isMockupError(error)) {
//       set.status = error.status;
//       log?.set({
//         error: { code: error.code, message: error.message },
//       });
//       return toErrorResponse(error);
//     }

//     const parsed = parseError(error);
//     set.status = parsed.status ?? 500;
//     log?.set({
//       error: {
//         code: parsed.code,
//         message: parsed.message,
//         status: parsed.status,
//       },
//     });

//     return {
//       success: false,
//       error: parsed.message,
//       ...(parsed.why ? { why: parsed.why } : {}),
//       ...(parsed.fix ? { fix: parsed.fix } : {}),
//       ...(parsed.link ? { link: parsed.link } : {}),
//     };
//   });

// if (env.isDevelopment) {
//   const port = env.port;
//   app.listen(port);

//   console.log(`Listening on http://localhost:${port} (${env.nodeEnv})`);
// }

const app = new Elysia()
  .get("/", () => "Hello World")
  .use(healthRoutes)
  .use(mockupRoutes);

export const GET = app.handle;
export const POST = app.handle;
export const PATCH = app.handle;
export const DELETE = app.handle;
export const PUT = app.handle;

export type API = typeof app;

export default app;
