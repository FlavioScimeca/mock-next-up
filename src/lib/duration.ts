export function formatDurationMinutes(ms: number): string {
  const minutes = ms / 60_000;
  let rounded = Math.round(minutes * 10) / 10;

  if (rounded === 0 && ms > 0) {
    rounded = Math.round(minutes * 100) / 100;
  }

  const unit = rounded === 1 ? "minute" : "minutes";
  return `${rounded} ${unit}`;
}
