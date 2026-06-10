import { Elysia, t } from "elysia";

const app = new Elysia()
  .get("/", () => "Hello World")
  .post("/", ({ body }) => body, {
    body: t.Object({
      name: t.String(),
    }),
  });

if (import.meta.main) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port);
  console.log(`Listening on http://localhost:${port}`);
}

export const GET = app.handle;
export const POST = app.handle;
export const PATCH = app.handle;
export const DELETE = app.handle;
export const PUT = app.handle;

export type API = typeof app;

export default app;
