import { join } from "node:path";

const projectRoot = join(import.meta.dir, "../..");
const isVercel = Boolean(process.env.VERCEL);

function resolvePath(value: string | undefined, defaultRelative: string): string {
  const relative = value ?? defaultRelative;
  return join(projectRoot, relative);
}

function resolveWritableDir(
  envValue: string | undefined,
  localRelative: string,
  vercelSubdir: string,
): string {
  if (envValue) {
    return join(projectRoot, envValue);
  }

  if (isVercel) {
    return join("/tmp", "mock-next-up", vercelSubdir);
  }

  return join(projectRoot, localRelative);
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  projectRoot,
  nodeEnv,
  isDevelopment: nodeEnv !== "production",
  isProduction: nodeEnv === "production",
  isVercel,
  templatesDir: resolvePath(process.env.TEMPLATES_DIR, "src/assets/templates"),
  designsDir: resolvePath(process.env.DESIGNS_DIR, "src/assets/designs"),
  outputsDir: resolveWritableDir(process.env.OUTPUTS_DIR, "outputs", "outputs"),
  uploadsDir: resolveWritableDir(process.env.UPLOADS_DIR, "uploads", "uploads"),
  port: Number(process.env.PORT) || 3000,
} as const;

export function getDebugDir(): string {
  return join(env.outputsDir, "debug");
}
