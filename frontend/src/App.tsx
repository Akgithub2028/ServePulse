import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { API_CONFIGURED } from "./api/client";
import { Alert, SkeletonLines } from "./components/ui";

/**
 * Routing.
 *
 * The Control Room is loaded eagerly because it is the landing view; the other four are
 * code-split, so a visitor who only checks service health never downloads the inference
 * form or the telemetry views.
 */
import ControlRoom from "./views/ControlRoom";

const InferenceLab = lazy(() => import("./views/InferenceLab"));
const Observability = lazy(() => import("./views/Observability"));
const Provenance = lazy(() => import("./views/Provenance"));
const Platform = lazy(() => import("./views/Platform"));

function RouteFallback() {
  return (
    <div className="panel">
      <div className="panel__body">
        <SkeletonLines lines={4} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      {!API_CONFIGURED && (
        <div style={{ padding: "16px 24px 0" }}>
          <Alert tone="warn" title="No backend URL is configured">
            The built bundle has no <code>VITE_API_BASE_URL</code>, so every panel below will
            report that it cannot reach the API. This is a build-time setting: see{" "}
            <code>frontend/.env.example</code>.
          </Alert>
        </div>
      )}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<ControlRoom />} />
          <Route path="/inference" element={<InferenceLab />} />
          <Route path="/observability" element={<Observability />} />
          <Route path="/provenance" element={<Provenance />} />
          <Route path="/platform" element={<Platform />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
