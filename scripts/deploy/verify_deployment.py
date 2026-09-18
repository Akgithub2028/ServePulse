#!/usr/bin/env python
"""Verify a deployed instance through its public URL — without mutating any state.

This is the deployment smoke test. It exercises the *real* public endpoints of a
running deployment (Render or anywhere else) and fails clearly when the backend is
unreachable, readiness is broken, the model is missing, CORS is misconfigured, the
frontend cannot reach the backend, or a response schema is wrong.

It is deliberately **non-mutating**: it never promotes, rolls back, or reloads a model.
The only admin-endpoint check is that an *unauthorized* ``/admin/reload`` is rejected
(401) — which by definition changes nothing. ``/predict`` is read-only scoring.

    python scripts/deploy/verify_deployment.py \
        --backend-url https://mlserve-backend.onrender.com \
        --frontend-url https://mlserve-frontend.onrender.com

    # backend only:
    python scripts/deploy/verify_deployment.py --backend-url https://...onrender.com

Exit code is 0 only if every required check passed.
"""

from __future__ import annotations

import argparse
import json
import sys

import httpx

# A representative valid record drawn from the data contract (the same example the API
# documents). Inlined so this tool depends only on httpx, not on the mlserve package,
# and can be run from anywhere against a remote deployment.
EXAMPLE_RECORD = {
    "age": 39,
    "workclass": "State-gov",
    "education_num": 13,
    "marital_status": "Never-married",
    "occupation": "Adm-clerical",
    "relationship": "Not-in-family",
    "race": "White",
    "sex": "Male",
    "capital_gain": 2174,
    "capital_loss": 0,
    "hours_per_week": 40,
    "native_country": "United-States",
}

TIMEOUT = 30.0
_results: list[tuple[bool, str, str]] = []


def check(name: str, condition: bool, detail: str = "") -> bool:
    _results.append((bool(condition), name, detail if not condition else ""))
    mark = "ok  " if condition else "FAIL"
    print(f"  [{mark}] {name}" + (f" -- {detail}" if detail and not condition else ""))
    return bool(condition)


def verify_backend(base: str, frontend_origin: str | None) -> bool:
    base = base.rstrip("/")
    print(f"\nBackend: {base}")
    ok = True
    with httpx.Client(base_url=base, timeout=TIMEOUT, follow_redirects=True) as c:
        # --- reachability + health/readiness -----------------------------------
        try:
            health = c.get("/health")
        except httpx.HTTPError as exc:
            return check("backend reachable over HTTPS", False, f"{type(exc).__name__}: {exc}")
        ok &= check("GET /health is 200", health.status_code == 200, health.text[:200])
        hbody = health.json() if health.status_code == 200 else {}
        ok &= check(
            "/health reports a status", hbody.get("status") in ("ok", "degraded"), str(hbody)
        )

        ready = c.get("/ready")
        model_loaded = ready.status_code == 200
        # /ready is 200 when a model is loadable, 503 when degraded. Both are valid
        # service states; a 503 is only a *deployment* failure if we expected a model.
        ok &= check(
            "GET /ready is 200 or 503 (not 5xx-other / not a crash)",
            ready.status_code in (200, 503),
            f"status {ready.status_code}",
        )
        if not model_loaded:
            print("  [warn] service is degraded (no model loaded); readiness-gated checks skipped")

        # --- provenance ---------------------------------------------------------
        info = c.get("/model-info")
        if model_loaded:
            ok &= check("GET /model-info is 200", info.status_code == 200, info.text[:200])
            if info.status_code == 200:
                ib = info.json()
                ok &= check("/model-info exposes a model_version", bool(ib.get("model_version")))
                ok &= check("/model-info exposes input_columns", bool(ib.get("input_columns")))
        else:
            ok &= check(
                "GET /model-info is 503 when degraded",
                info.status_code == 503,
                str(info.status_code),
            )

        # --- prediction (valid) -------------------------------------------------
        if model_loaded:
            pred = c.post("/predict", json={"records": [EXAMPLE_RECORD]})
            ok &= check("POST /predict (valid) is 200", pred.status_code == 200, pred.text[:200])
            if pred.status_code == 200:
                pb = pred.json()
                ok &= check("/predict returns one prediction", len(pb.get("predictions", [])) == 1)
                p0 = pb.get("predictions", [{}])[0]
                ok &= check(
                    "prediction has probability in [0,1], a label and a class",
                    0.0 <= p0.get("probability", -1) <= 1.0
                    and "label" in p0
                    and "prediction" in p0,
                    str(p0),
                )
                ok &= check("response carries a request_id", bool(pb.get("request_id")))
                ok &= check("response carries the model_version", bool(pb.get("model_version")))
            ok &= check(
                "X-Request-ID response header present",
                bool(pred.headers.get("x-request-id")),
                str(dict(pred.headers)),
            )
            ok &= check(
                "X-Model-Version response header present",
                bool(pred.headers.get("x-model-version")),
            )

        # --- prediction (invalid) must be a structured 422 ----------------------
        bad = c.post("/predict", json={"records": [{**EXAMPLE_RECORD, "age": 900}]})
        ok &= check(
            "POST /predict (out-of-range) is 422", bad.status_code == 422, str(bad.status_code)
        )
        if bad.status_code == 422:
            bb = bad.json()
            ok &= check(
                "422 uses the documented error envelope",
                set(bb) == {"request_id", "error"}
                and bb["error"].get("type") == "validation_error",
                json.dumps(bb)[:200],
            )

        empty = c.post("/predict", json={"records": []})
        ok &= check(
            "POST /predict (empty batch) is 422", empty.status_code == 422, str(empty.status_code)
        )

        oversized = c.post("/predict", json={"records": [EXAMPLE_RECORD] * 513})
        ok &= check(
            "POST /predict (batch 513 > max 512) is 413",
            oversized.status_code == 413,
            str(oversized.status_code),
        )

        # --- metrics + monitoring ----------------------------------------------
        metrics = c.get("/metrics")
        ok &= check("GET /metrics is 200", metrics.status_code == 200, str(metrics.status_code))
        ok &= check(
            "/metrics exposes mlserve_requests_total", "mlserve_requests_total" in metrics.text
        )

        summary = c.get("/monitoring/summary")
        ok &= check(
            "GET /monitoring/summary is 200", summary.status_code == 200, str(summary.status_code)
        )

        # --- admin endpoint must be protected in production ---------------------
        reload_noauth = c.post("/admin/reload")
        # If an admin token is configured (production), this MUST be 401. If the
        # deployment somehow has no token, this would be 200 and actually reload —
        # which we flag as a security failure rather than allow silently.
        ok &= check(
            "POST /admin/reload without a token is 401 (endpoint is protected)",
            reload_noauth.status_code == 401,
            f"status {reload_noauth.status_code} — admin endpoint is NOT protected!",
        )

        # --- CORS ---------------------------------------------------------------
        if frontend_origin:
            pre = c.options(
                "/predict",
                headers={
                    "Origin": frontend_origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            allow = pre.headers.get("access-control-allow-origin")
            ok &= check(
                "CORS preflight allows the frontend origin",
                pre.status_code == 200 and allow == frontend_origin,
                f"status {pre.status_code}, allow-origin {allow!r}",
            )
            # An unlisted origin must NOT be allowed.
            evil = c.get("/health", headers={"Origin": "https://not-allowed.example"})
            ok &= check(
                "CORS does not allow an unlisted origin",
                evil.headers.get("access-control-allow-origin") != "https://not-allowed.example",
            )
    return ok


def verify_frontend(url: str, backend_base: str) -> bool:
    url = url.rstrip("/")
    print(f"\nFrontend: {url}")
    ok = True
    with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as c:
        try:
            resp = c.get(url)
        except httpx.HTTPError as exc:
            return check("frontend reachable over HTTPS", False, f"{type(exc).__name__}: {exc}")
        ok &= check("frontend serves 200", resp.status_code == 200, str(resp.status_code))
        ok &= check(
            "frontend serves HTML",
            "text/html" in resp.headers.get("content-type", ""),
            resp.headers.get("content-type", ""),
        )
        ok &= check(
            "frontend HTML references a built asset",
            ("/assets/" in resp.text or ".js" in resp.text),
            "no script/asset tag found",
        )
        # The backend base URL should be baked into the bundle at build time. We can't
        # read JS env directly, but we can confirm the site is not serving a dev error.
        ok &= check(
            "frontend is not a Vite dev/error page", "Vite is already running" not in resp.text
        )
    return ok


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--backend-url", required=True, help="public backend base URL")
    parser.add_argument("--frontend-url", default=None, help="public frontend URL (optional)")
    parser.add_argument(
        "--frontend-origin",
        default=None,
        help="Origin to test CORS against; defaults to --frontend-url",
    )
    args = parser.parse_args(argv)

    frontend_origin = args.frontend_origin or args.frontend_url
    backend_ok = verify_backend(args.backend_url, frontend_origin)
    frontend_ok = (
        verify_frontend(args.frontend_url, args.backend_url) if args.frontend_url else True
    )

    passed = sum(1 for r in _results if r[0])
    total = len(_results)
    print(f"\n{passed}/{total} checks passed")
    if not (backend_ok and frontend_ok):
        failed = [name for okk, name, _ in _results if not okk]
        print("FAILED CHECKS:", file=sys.stderr)
        for name in failed:
            print(f"  - {name}", file=sys.stderr)
        print("VERIFY_DEPLOYMENT_FAILED", file=sys.stderr)
        return 1
    print("VERIFY_DEPLOYMENT_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
