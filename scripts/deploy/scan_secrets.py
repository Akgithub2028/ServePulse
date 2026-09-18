#!/usr/bin/env python
"""Fail if a credential is committed, or if the deployment config can leak one.

This is the repository's secret gate (run in CI on every push and PR). It is
deliberately self-contained -- no action, no network, no service account -- so it runs
identically on a laptop and in CI, and its rules are reviewable in one file.

Three classes of check:

1. **High-signal credential patterns** in tracked files (GitHub tokens, cloud keys,
   private-key blocks, provider API keys, JWTs).
2. **Assignment-shaped secrets** -- ``api_key = "<16+ chars>"`` -- where the value is
   not an obvious placeholder. Catches the "I'll hardcode it for now" case that the
   pattern list in (1) misses.
3. **Deployment-config invariants** that would leak a secret to the browser: no literal
   value for the admin token in the Blueprint, and no ``VITE_``-prefixed variable
   (Vite inlines those into the public bundle) carrying a secret-shaped value.

    python scripts/deploy/scan_secrets.py
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

#: Paths whose *content* is generated evidence or third-party data rather than source.
SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".pytest_cache",
    ".ruff_cache",
    "__pycache__",
    "mlruns",
}
SKIP_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".pdf",
    ".ico",
    ".woff",
    ".woff2",
    ".lock",
    ".sqlite",
}

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("GitHub personal access token", re.compile(r"ghp_[A-Za-z0-9]{36,}")),
    ("GitHub fine-grained PAT", re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("GitHub OAuth/app token", re.compile(r"gh[osur]_[A-Za-z0-9]{36,}")),
    ("AWS access key id", re.compile(r"AKIA[0-9A-Z]{16}")),
    (
        "Private key block",
        re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"),
    ),
    ("Slack token", re.compile(r"xox[abprs]-[A-Za-z0-9-]{10,}")),
    ("Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{35}")),
    ("Stripe live secret", re.compile(r"sk_live_[A-Za-z0-9]{20,}")),
    (
        "JSON Web Token",
        re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"),
    ),
]

SECRET_ASSIGNMENT = re.compile(r"""(?ix)
    \b(
        api[_-]?key | apikey | secret[_-]?key | client[_-]?secret |
        access[_-]?token | auth[_-]?token | admin[_-]?token |
        password | passwd | private[_-]?key
    )\b
    \s*[:=]\s*
    (?P<quote>["'])(?P<value>[^"'\n]{16,})(?P=quote)
    """)

#: Values that look like a secret but are documentation, a test fixture or a template.
PLACEHOLDER_HINTS = (
    "example",
    "placeholder",
    "changeme",
    "change-me",
    "your-",
    "your_",
    "dummy",
    "redacted",
    "not-a-secret",
    "no-token",
    "unset",
    "<",
    "${",
    "x" * 8,
)

_findings: list[str] = []


def tracked_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=True,
    ).stdout
    files = []
    for raw in out.decode().split("\0"):
        if not raw:
            continue
        path = REPO_ROOT / raw
        if any(part in SKIP_DIRS for part in Path(raw).parts):
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        files.append(path)
    return files


def is_placeholder(value: str) -> bool:
    low = value.lower()
    return any(h in low for h in PLACEHOLDER_HINTS)


def scan_file(path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return
    rel = path.relative_to(REPO_ROOT)
    for lineno, line in enumerate(text.splitlines(), start=1):
        for label, pattern in PATTERNS:
            if pattern.search(line):
                _findings.append(f"{rel}:{lineno}: {label}")
        m = SECRET_ASSIGNMENT.search(line)
        if m and not is_placeholder(m.group("value")):
            _findings.append(f"{rel}:{lineno}: secret-shaped value assigned to '{m.group(1)}'")


def check_blueprint() -> None:
    """The Blueprint must generate the admin token, never carry one."""
    path = REPO_ROOT / "render.yaml"
    if not path.exists():
        return
    try:
        import yaml
    except ImportError:
        _findings.append("render.yaml: PyYAML unavailable, admin-token invariant not checked")
        return
    doc = yaml.safe_load(path.read_text()) or {}
    for service in doc.get("services") or []:
        for entry in service.get("envVars") or []:
            if entry.get("key") != "MLSERVE_ADMIN_TOKEN":
                continue
            if entry.get("value"):
                _findings.append(
                    "render.yaml: MLSERVE_ADMIN_TOKEN has a hardcoded value (must use generateValue: true)"
                )
            elif not entry.get("generateValue"):
                _findings.append(
                    "render.yaml: MLSERVE_ADMIN_TOKEN neither generates nor references a secret"
                )


def check_frontend_env() -> None:
    """Vite inlines VITE_* into the public bundle: those must never be secret-shaped."""
    for candidate in (REPO_ROOT / "render.yaml", REPO_ROOT / ".env.example"):
        if not candidate.exists():
            continue
        for lineno, line in enumerate(candidate.read_text().splitlines(), start=1):
            if "VITE_" not in line:
                continue
            m = re.search(r"(?i)VITE_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|KEY)[A-Z0-9_]*", line)
            if m:
                _findings.append(
                    f"{candidate.name}:{lineno}: {m.group(0)} would be inlined into the public "
                    "frontend bundle — VITE_* variables are not secret"
                )


def main() -> int:
    files = tracked_files()
    for path in files:
        scan_file(path)
    check_blueprint()
    check_frontend_env()

    print(f"scanned {len(files)} tracked files")
    if _findings:
        print("\nSECRET_SCAN_FAILED:", file=sys.stderr)
        for finding in _findings:
            print(f"  - {finding}", file=sys.stderr)
        return 1
    print(
        "SECRET_SCAN_OK: no credentials found in tracked files; deployment config cannot leak one"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
