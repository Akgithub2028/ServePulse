#!/usr/bin/env python
"""Validate render.yaml as a real deployment-configuration gate.

Two layers of validation:

1. **Structural / policy checks** (always run, no network): the Blueprint must encode
   the deployment decisions this project committed to — single instance, readiness
   gated on /ready, persistent disk for filesystem state, an *idempotent* bootstrap as
   preDeployCommand, CI-gated auto-deploy, a generated (never hardcoded) admin secret,
   a non-wildcard CORS allow-list, and a static frontend with SPA rewrite + env-driven
   API base URL. These are the invariants that make the deployment correct and safe.

2. **Official Render JSON-Schema validation** (runs when `jsonschema` is installed and
   the schema is reachable): catches malformed/unknown fields against
   https://render.com/schema/render.yaml.json.

Exits non-zero if any check fails, so CI blocks a bad Blueprint.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
BLUEPRINT = REPO_ROOT / "render.yaml"
RENDER_SCHEMA_URL = "https://render.com/schema/render.yaml.json"

_failures: list[str] = []
_checks = 0


def require(condition: bool, message: str) -> None:
    global _checks
    _checks += 1
    if not condition:
        _failures.append(message)


def _env(env_vars: list[dict], key: str) -> dict | None:
    for e in env_vars or []:
        if e.get("key") == key:
            return e
    return None


def validate_structure(doc: dict) -> None:
    services = doc.get("services")
    require(
        isinstance(services, list) and services,
        "render.yaml must define a non-empty 'services' list",
    )
    if not services:
        return

    backend = next((s for s in services if s.get("runtime") == "docker"), None)
    frontend = next((s for s in services if s.get("runtime") == "static"), None)

    require(backend is not None, "no Docker (backend) web service found")
    require(frontend is not None, "no static (frontend) site found")
    if backend is None or frontend is None:
        return

    # ---- backend service ----------------------------------------------------
    require(backend.get("type") == "web", "backend service type must be 'web'")
    require(bool(backend.get("dockerfilePath")), "backend must declare dockerfilePath")
    dpath = REPO_ROOT / str(backend.get("dockerfilePath", "")).lstrip("./")
    require(
        dpath.exists(), f"backend dockerfilePath does not exist: {backend.get('dockerfilePath')}"
    )
    require(
        backend.get("healthCheckPath") == "/ready",
        "backend healthCheckPath must be /ready (readiness, not /health liveness)",
    )
    require(
        backend.get("numInstances") == 1,
        "backend must be single-instance (SQLite/filesystem state is not multi-writer safe)",
    )
    require(
        backend.get("autoDeployTrigger") == "checksPass",
        "backend autoDeployTrigger must be 'checksPass'",
    )

    disk = backend.get("disk")
    require(
        isinstance(disk, dict) and bool(disk.get("mountPath")),
        "backend must attach a persistent disk with a mountPath",
    )

    pre = backend.get("preDeployCommand")
    require(bool(pre), "backend must define a preDeployCommand bootstrap")
    require(
        "init_production.py" in (pre or ""),
        "preDeployCommand must run the idempotent bootstrap (scripts/deploy/init_production.py)",
    )

    env = backend.get("envVars", [])
    require(
        _env(env, "MLSERVE_DATA_ROOT") is not None,
        "backend must set MLSERVE_DATA_ROOT (persistent state root)",
    )
    data_root = (_env(env, "MLSERVE_DATA_ROOT") or {}).get("value")
    if disk and data_root:
        require(
            data_root == disk.get("mountPath"),
            f"MLSERVE_DATA_ROOT ({data_root}) must equal the disk mountPath ({disk.get('mountPath')})",
        )

    admin = _env(env, "MLSERVE_ADMIN_TOKEN")
    require(admin is not None, "backend must define MLSERVE_ADMIN_TOKEN")
    if admin is not None:
        require(
            admin.get("generateValue") is True and not admin.get("value"),
            "MLSERVE_ADMIN_TOKEN must use generateValue:true and never carry a hardcoded value",
        )

    cors = _env(env, "MLSERVE_CORS_ORIGINS")
    require(cors is not None, "backend must define MLSERVE_CORS_ORIGINS")
    if cors is not None:
        val = str(cors.get("value", ""))
        require(
            val != "*" and val != "",
            "MLSERVE_CORS_ORIGINS must be an explicit allow-list, not a wildcard",
        )

    require(
        (_env(env, "MLSERVE_MODEL_SOURCE") or {}).get("value") == "registry",
        "backend must serve via MLSERVE_MODEL_SOURCE=registry (the real registry architecture)",
    )

    # ---- frontend service ---------------------------------------------------
    require(frontend.get("type") == "web", "frontend service type must be 'web'")
    require(bool(frontend.get("staticPublishPath")), "frontend must declare staticPublishPath")
    require(bool(frontend.get("buildCommand")), "frontend must declare a buildCommand")
    require(
        frontend.get("autoDeployTrigger") == "checksPass",
        "frontend autoDeployTrigger must be 'checksPass'",
    )

    fenv = frontend.get("envVars", [])
    api_base = _env(fenv, "VITE_API_BASE_URL")
    require(api_base is not None, "frontend must set VITE_API_BASE_URL (env-driven backend URL)")
    if api_base is not None:
        require(
            str(api_base.get("value", "")).startswith("https://"),
            "VITE_API_BASE_URL must be an https:// URL",
        )

    routes = frontend.get("routes", [])
    spa = any(r.get("type") == "rewrite" and r.get("destination") == "/index.html" for r in routes)
    require(spa, "frontend must include an SPA rewrite route (/* -> /index.html)")


def _leaf_errors(errors) -> list[str]:
    """Flatten jsonschema errors to the most specific (leaf) messages.

    The official Render schema wraps each service in a five-way ``anyOf``, so one bad
    field produces a cascade: four "not this service type" errors from the branches
    that were never meant to match, plus a misleading root-level
    ``unevaluatedProperties`` complaint that is pure knock-on. Reporting only the leaf
    errors of the branch that came closest gives an actionable message instead.
    """
    messages: list[str] = []
    for err in errors:
        if err.context:
            messages.extend(_leaf_errors(err.context))
        elif err.validator != "unevaluatedProperties":
            loc = "/".join(str(p) for p in err.absolute_path) or "<root>"
            messages.append(f"{loc}: {err.message}")
    seen = set()
    unique = []
    for m in messages:
        if m not in seen:
            seen.add(m)
            unique.append(m)
    return unique


def validate_schema(doc: dict) -> str:
    """Best-effort official JSON-Schema validation. Returns a human-readable status."""
    try:
        import jsonschema
    except ImportError:
        return "jsonschema not installed — skipped official schema validation (structural checks still enforced)"
    try:
        import urllib.request

        with urllib.request.urlopen(RENDER_SCHEMA_URL, timeout=15) as resp:  # noqa: S310
            schema = yaml.safe_load(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        return f"could not fetch Render schema ({type(exc).__name__}) — skipped official schema validation"
    validator_cls = jsonschema.validators.validator_for(
        schema, default=jsonschema.Draft202012Validator
    )
    try:
        validator_cls.check_schema(schema)
    except jsonschema.SchemaError:
        pass  # a remote schema we can't self-check is still worth validating against
    errors = list(validator_cls(schema).iter_errors(doc))
    if errors:
        for m in _leaf_errors(errors):
            _failures.append(f"render.yaml violates the official Render schema -> {m}")
        return f"official schema validation FAILED ({len(errors)} error(s))"
    return "official Render JSON-Schema validation passed"


def main() -> int:
    if not BLUEPRINT.exists():
        print(f"FAIL: {BLUEPRINT} not found", file=sys.stderr)
        return 1
    doc = yaml.safe_load(BLUEPRINT.read_text())
    validate_structure(doc)
    schema_status = validate_schema(doc)

    print(f"render.yaml: {_checks - len(_failures)}/{_checks} structural checks passed")
    print(f"render.yaml: {schema_status}")
    if _failures:
        print("\nBlueprint validation FAILED:", file=sys.stderr)
        for f in _failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("BLUEPRINT_VALIDATION_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
