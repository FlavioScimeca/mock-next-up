import { initSharp } from "./sharp-client.js";

let ready: Promise<void> | null = null;

export function ensureSharpReady(): Promise<void> {
  if (!ready) {
    ready = Promise.resolve().then(() => {
      initSharp();
    });
  }

  return ready;
}
