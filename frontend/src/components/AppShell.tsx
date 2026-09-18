import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { API_BASE_URL, API_CONFIGURED } from "../api/client";
import { Badge } from "./ui";

export interface ServiceHeadline {
  tone: "ok" | "warn" | "danger" | "muted";
  label: string;
  detail?: string;
}

export const NAV = [
  { to: "/", index: "01", label: "Control Room", end: true },
  { to: "/inference", index: "02", label: "Inference Lab", end: false },
  { to: "/observability", index: "03", label: "Observability", end: false },
  { to: "/provenance", index: "04", label: "Model Provenance", end: false },
  { to: "/platform", index: "05", label: "Platform / API", end: false },
] as const;

export function AppShell({
  title,
  subtitle,
  headline,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  headline: ServiceHeadline;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ml
          </span>
          <div>
            <div className="brand__name">mlserve</div>
            <div className="brand__sub">income classifier</div>
          </div>
        </div>

        <nav className="nav" aria-label="Sections">
          <span className="nav__label">Console</span>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav__item${isActive ? " nav__item--active" : ""}`}
            >
              <span className="nav__index">{item.index}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__foot">
          <span>Backend</span>
          <code>{API_CONFIGURED ? API_BASE_URL : "not configured"}</code>
          {!API_CONFIGURED && (
            <Badge tone="warn" title="VITE_API_BASE_URL was empty at build time">
              no API URL
            </Badge>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="topbar__meta">
            {actions}
            <Badge tone={headline.tone} title={headline.detail} pulse={headline.tone === "ok"}>
              {headline.label}
            </Badge>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
