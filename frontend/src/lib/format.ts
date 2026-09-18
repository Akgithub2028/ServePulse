/** Formatting helpers. Every one of these renders "unknown" rather than guessing. */

export const UNKNOWN = "—";

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function num(value: number | null | undefined, digits = 0): string {
  if (!isNumber(value)) return UNKNOWN;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fixed(value: number | null | undefined, digits = 3): string {
  if (!isNumber(value)) return UNKNOWN;
  return value.toFixed(digits);
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (!isNumber(value)) return UNKNOWN;
  return `${(value * 100).toFixed(digits)}%`;
}

export function ms(value: number | null | undefined, digits = 2): string {
  if (!isNumber(value)) return UNKNOWN;
  if (value < 1) return `${value.toFixed(3)} ms`;
  if (value < 1000) return `${value.toFixed(digits)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function seconds(value: number | null | undefined): string {
  if (!isNumber(value)) return UNKNOWN;
  if (value < 1) return `${(value * 1000).toFixed(0)} ms`;
  return `${value.toFixed(2)} s`;
}

export function bytes(value: number | null | undefined): string {
  if (!isNumber(value)) return UNKNOWN;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Uptime as a compact human duration: 2d 4h, 3h 12m, 42s. */
export function duration(value: number | null | undefined): string {
  if (!isNumber(value)) return UNKNOWN;
  const total = Math.max(0, Math.floor(value));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/** "4s ago" / "in 2m" relative to a reference instant. */
export function relative(from: number | null | undefined, now: number = Date.now()): string {
  if (!isNumber(from)) return UNKNOWN;
  const deltaSeconds = Math.round((now - from) / 1000);
  if (Math.abs(deltaSeconds) < 2) return "just now";
  const suffix = deltaSeconds > 0 ? "ago" : "from now";
  const magnitude = Math.abs(deltaSeconds);
  if (magnitude < 60) return `${magnitude}s ${suffix}`;
  if (magnitude < 3600) return `${Math.round(magnitude / 60)}m ${suffix}`;
  if (magnitude < 86_400) return `${Math.round(magnitude / 3600)}h ${suffix}`;
  return `${Math.round(magnitude / 86_400)}d ${suffix}`;
}

/** Shorten a hash-like identifier for display while keeping it recognisable. */
export function shortId(value: string | null | undefined, length = 12): string {
  if (!value) return UNKNOWN;
  if (value.length <= length) return value;
  return `${value.slice(0, length)}…`;
}

/** An ISO timestamp rendered compactly; invalid input is shown as unknown, not "Invalid Date". */
export function timestamp(value: string | null | undefined): string {
  if (!value) return UNKNOWN;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
