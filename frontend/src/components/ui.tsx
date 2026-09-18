/**
 * Shared presentation primitives.
 *
 * These exist so that loading, empty, degraded and error states look the same everywhere:
 * an operations console is judged on how legibly it reports bad news, so those states are
 * first-class components rather than ad-hoc paragraphs in each view.
 */
import type { ReactNode } from "react";

export function Panel({
  title,
  hint,
  actions,
  children,
  flush = false,
  className,
}: {
  title?: string;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <header className="panel__head">
          <div className="panel__title">
            {title && <h2>{title}</h2>}
            {hint && <span className="panel__hint">{hint}</span>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={`panel__body${flush ? " panel__body--flush" : ""}`}>{children}</div>
    </section>
  );
}

export type Tone =
  | "neutral"
  | "ok"
  | "warn"
  | "danger"
  | "info"
  | "accent"
  | "violet"
  | "muted";

export function Badge({
  tone = "neutral",
  children,
  pulse = false,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  pulse?: boolean;
  title?: string;
}) {
  const toneClass = tone === "neutral" ? "" : ` badge--${tone}`;
  return (
    <span className={`badge${toneClass}`} title={title}>
      {pulse && <span className="dot dot--pulse" />}
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  foot,
  small = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  small?: boolean;
  tone?: Tone;
}) {
  const colour =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "danger"
          ? "var(--danger)"
          : tone === "accent"
            ? "var(--accent)"
            : undefined;
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value${small ? " stat__value--small" : ""}`} style={{ color: colour }}>
        {value}
        {unit && <span className="stat__unit">{unit}</span>}
      </span>
      {foot && <span className="stat__foot">{foot}</span>}
    </div>
  );
}

export function Skeleton({ width = "100%", height = 12 }: { width?: string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} role="presentation" />;
}

/** A panel-shaped placeholder so loading does not shift the layout. */
export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack--tight" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? "62%" : "100%"} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  icon = "∅",
  action,
}: {
  title: string;
  body: ReactNode;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="state__title">{title}</div>
      <div className="state__body">{body}</div>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  hint,
  action,
}: {
  title: string;
  body: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state" role="alert">
      <div className="state__icon" aria-hidden="true" style={{ color: "var(--danger)" }}>
        !
      </div>
      <div className="state__title">{title}</div>
      <div className="state__body">{body}</div>
      {hint && <div className="state__body faint small mono">{hint}</div>}
      {action}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "ok" | "warn" | "danger";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <span className="dot" style={{ marginTop: 6 }} />
      <div>
        {title && <div className="alert__title">{title}</div>}
        <div className="alert__body">{children}</div>
      </div>
    </div>
  );
}

/** A labelled key/value list. Values are monospace by default because they are identifiers. */
export function KeyValues({
  items,
  plainKeys = [],
}: {
  items: Array<{ key: string; label: string; value: ReactNode }>;
  plainKeys?: string[];
}) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.key} style={{ display: "contents" }}>
          <dt>{item.label}</dt>
          <dd className={plainKeys.includes(item.key) ? "plain" : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BarList({
  items,
  formatValue = (value: number) => String(value),
}: {
  items: Array<{ label: string; value: number; hint?: string }>;
  formatValue?: (value: number) => string;
}) {
  const max = items.reduce((highest, item) => Math.max(highest, item.value), 0);
  return (
    <div>
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span className="bar-row__label" title={item.label}>
            {item.label}
          </span>
          <span className="bar-row__track">
            <span
              className="bar-row__fill"
              style={{ width: max > 0 ? `${Math.max(2, (item.value / max) * 100)}%` : "0%" }}
            />
          </span>
          <span className="bar-row__value">
            {formatValue(item.value)}
            {item.hint && <span className="faint"> {item.hint}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
