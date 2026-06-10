import { env } from "../config/env";
import { setRequestLog } from "../logging";

export interface RenderStepEntry {
  step: number;
  name: string;
  info?: Record<string, unknown>;
  at: string;
}

const PATH_KEYS = new Set([
  "designPath",
  "templateDir",
  "maskPath",
  "basePath",
  "outputPath",
  "debugDir",
]);

export class RenderProgress {
  private count = 0;
  readonly steps: RenderStepEntry[] = [];

  step(name: string, info?: Record<string, unknown>): void {
    this.count += 1;

    const entry: RenderStepEntry = {
      step: this.count,
      name,
      info: info ? sanitizeStepInfo(info) : undefined,
      at: new Date().toISOString(),
    };

    this.steps.push(entry);
    this.emit(entry);
  }

  private emit(entry: RenderStepEntry): void {
    const label = `step-${entry.step}`;
    const suffix = entry.info ? ` ${formatStepInfo(entry.info)}` : "";

    if (env.isDevelopment) {
      console.log(`[render] ${label} ${entry.name}${suffix}`);
    }

    const renderLog: Record<string, unknown> = {
      progress: label,
      currentStep: entry.step,
      currentStepName: entry.name,
      ...(entry.info ?? {}),
    };

    if (entry.name === "complete" || entry.name === "failed") {
      renderLog.steps = this.steps.map(({ step, name }) => ({ step, name }));
    }

    setRequestLog({ render: renderLog });
  }
}

function sanitizeStepInfo(
  info: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(info)) {
    if (typeof value === "string" && PATH_KEYS.has(key)) {
      sanitized[key] = toRelativePath(value);
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function toRelativePath(value: string): string {
  if (value.startsWith(env.projectRoot)) {
    return value.slice(env.projectRoot.length + 1);
  }

  return value;
}

function formatStepInfo(info: Record<string, unknown>): string {
  return Object.entries(info)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
