import { useLogger } from "evlog/elysia";

export function setRequestLog(fields: Record<string, unknown>): void {
  try {
    useLogger().set(fields);
  } catch {
    // Outside an HTTP request (e.g. scripts/render-test.ts).
  }
}

export function logRenderEvent(fields: Record<string, unknown>): void {
  setRequestLog({ render: fields });

  if (process.env.NODE_ENV !== "production") {
    console.log("[render]", fields);
  }
}
