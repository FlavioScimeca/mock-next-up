import { randomBytes } from "node:crypto";

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function generateOutputFilename(templateId: string): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("");
  const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join(
    "",
  );
  const suffix = randomBytes(2).toString("hex");

  return `${templateId}-${date}-${time}-${suffix}.png`;
}
