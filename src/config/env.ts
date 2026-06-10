import { join } from "node:path";

const projectRoot = join(import.meta.dir, "../..");

function resolvePath(value: string | undefined, defaultRelative: string): string {
  const relative = value ?? defaultRelative;
  return join(projectRoot, relative);
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  projectRoot,
  nodeEnv,
  isDevelopment: nodeEnv !== "production",
  isProduction: nodeEnv === "production",
  templatesDir: resolvePath(process.env.TEMPLATES_DIR, "src/assets/templates"),
  designsDir: resolvePath(process.env.DESIGNS_DIR, "src/assets/designs"),
  outputsDir: resolvePath(process.env.OUTPUTS_DIR, "outputs"),
  uploadsDir: resolvePath(process.env.UPLOADS_DIR, "uploads"),
  port: Number(process.env.PORT) || 3000,
} as const;

export function getDebugDir(): string {
  return join(env.outputsDir, "debug");
}
