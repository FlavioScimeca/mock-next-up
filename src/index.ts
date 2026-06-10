import { Elysia } from "elysia";

import { t } from "elysia";

export default new Elysia()
  .get("/", () => "Hello Vercel Function")
  .post("/", ({ body }) => body, {
    body: t.Object({
      name: t.String(),
    }),
  });
