/**
 * Hand-built SVG charts.
 *
 * No charting dependency: the console draws two shapes (a distribution and a small
 * amplitude strip) and they are a few dozen lines of SVG each. Hand-rolling them keeps
 * the bundle small, keeps the marks inspectable, and makes it straightforward to render
 * an honest empty state instead of an empty axis.
 *
 * The data is always the backend's: histogram buckets come from the Prometheus exposition
 * (`mlserve_request_latency` / `mlserve_prediction_score`), and nothing is synthesised to
 * fill a chart.
 */

export interface Bucket {
  label: string;
  count: number;
}

/** Horizontal, cumulative-to-per-bucket distribution bars. */
export function DistributionChart({
  buckets,
  height = 168,
  accent = "var(--accent)",
}: {
  buckets: Bucket[];
  height?: number;
  accent?: string;
}) {
  if (buckets.length === 0) return null;
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const slot = 100 / buckets.length;
  const barWidth = slot * 0.66;

  return (
    <svg
      className="chart"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Distribution of observed values by bucket"
      style={{ height }}
    >
      <defs>
        <linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.92" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.28" />
        </linearGradient>
      </defs>

      {/* Three hairlines give the eye a scale without a full axis frame. */}
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          className="chart__grid"
          x1="0"
          x2="100"
          y1={height * fraction}
          y2={height * fraction}
        />
      ))}

      {buckets.map((bucket, index) => {
        const barHeight = (bucket.count / max) * (height - 24);
        const x = index * slot + (slot - barWidth) / 2;
        return (
          <rect
            key={bucket.label}
            className="chart__bar"
            x={x}
            y={height - 20 - barHeight}
            width={barWidth}
            height={Math.max(barHeight, bucket.count > 0 ? 1.5 : 0)}
            rx="0.8"
          >
            <title>{`${bucket.label}: ${bucket.count}`}</title>
          </rect>
        );
      })}

      <line className="chart__grid" x1="0" x2="100" y1={height - 20} y2={height - 20} />
    </svg>
  );
}

/** Labels under a DistributionChart, aligned to the same slots. */
export function BucketAxis({ buckets }: { buckets: Bucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
        marginTop: 4,
      }}
      aria-hidden="true"
    >
      {buckets.map((bucket, index) => (
        <span
          key={bucket.label}
          className="faint mono"
          style={{
            fontSize: "0.625rem",
            textAlign: "center",
            // Thin out labels on narrow bars rather than letting them collide.
            visibility: buckets.length > 8 && index % 2 === 1 ? "hidden" : "visible",
          }}
        >
          {bucket.label}
        </span>
      ))}
    </div>
  );
}

/** Convert cumulative Prometheus buckets into per-bucket counts. */
export function toBuckets(
  cumulative: Array<{ le: number; count: number }>,
  format: (le: number, previousLe: number | null) => string,
): Bucket[] {
  const buckets: Bucket[] = [];
  let previousCount = 0;
  let previousLe: number | null = null;
  for (const bucket of cumulative) {
    buckets.push({
      label: format(bucket.le, previousLe),
      count: Math.max(0, bucket.count - previousCount),
    });
    previousCount = bucket.count;
    previousLe = bucket.le;
  }
  return buckets.filter((bucket, index) => {
    // Drop the trailing +Inf overflow bucket when it is empty: it is a sentinel, not a range.
    if (index !== buckets.length - 1) return true;
    return bucket.count > 0;
  });
}

/** A compact horizontal strip showing recent values; used where a full chart is overkill. */
export function AmplitudeStrip({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  if (values.length === 0) return null;
  const width = 100;
  const height = 26;
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values
    .map((value, index) => `${(index * step).toFixed(2)},${(height - (value / max) * height).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      style={{ height: 52 }}
    >
      <polyline className="chart__line" points={points} />
    </svg>
  );
}
