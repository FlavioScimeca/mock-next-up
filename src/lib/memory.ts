export function formatMemoryBytes(bytes: number): string {
  const normalized = Math.max(0, bytes);
  const units = ["B", "KB", "MB", "GB"] as const;

  let value = normalized;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded =
    value >= 100 || unitIndex === 0
      ? Math.round(value)
      : Math.round(value * 10) / 10;

  return `${rounded} ${units[unitIndex]}`;
}

export function readProcessRss(): number {
  return process.memoryUsage().rss;
}
