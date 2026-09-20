"""Typed access to configs/config.yaml plus the code-version stamp.

Configuration is loaded once and hashed. The hash goes into every MLflow run, so
"which config produced this number" is answerable without guessing.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = Path(os.environ.get("MLSERVE_CONFIG", "configs/config.yaml"))


def project_root() -> Path:
    """Repository root, resolved from environment, cwd, or file location."""
    if root := os.environ.get("MLSERVE_PROJECT_ROOT"):
        return Path(root).resolve()
    if (Path("/app/configs/config.yaml")).exists():
        return Path("/app")
    if (Path.cwd() / "configs/config.yaml").exists():
        return Path.cwd().resolve()
    candidate = Path(__file__).resolve().parents[2]
    if (candidate / "configs/config.yaml").exists():
        return candidate
    return Path.cwd().resolve()


class Config:
    """Thin dotted-access wrapper over the parsed YAML."""

    def __init__(self, data: dict[str, Any], source: Path):
        self._data = data
        self.source = source

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def get(self, dotted: str, default: Any = None) -> Any:
        node: Any = self._data
        for part in dotted.split("."):
            if not isinstance(node, dict) or part not in node:
                return default
            node = node[part]
        return node

    def require(self, dotted: str) -> Any:
        sentinel = object()
        value = self.get(dotted, sentinel)
        if value is sentinel:
            raise KeyError(f"{dotted} is not defined in {self.source}")
        return value

    def path(self, dotted: str) -> Path:
        """Resolve a configured path against the repository root."""
        value = self.require(dotted)
        p = Path(value)
        return p if p.is_absolute() else project_root() / p

    @property
    def raw(self) -> dict[str, Any]:
        return self._data

    @property
    def digest(self) -> str:
        """Stable hash of the whole configuration."""
        return hashlib.sha256(json.dumps(self._data, sort_keys=True).encode()).hexdigest()[:12]

    @property
    def seed(self) -> int:
        return int(self.require("project.random_seed"))


def _apply_env_overrides(data: dict[str, Any]) -> dict[str, Any]:
    """Overlay deployment-specific environment variables onto the parsed config.

    This is the *only* place runtime environment mutates configuration, and it is
    inert unless the variables are present. A local checkout, a test run, or CI
    (none of which set these variables) therefore resolves to exactly the committed
    ``config.yaml``, and the recorded ``config_digest`` is unchanged. Precedence is
    environment > configuration file. See DEPLOYMENT.md.

    Deliberately *not* handled here: ``PORT``. Render injects a generic ``PORT``
    variable; reading it into config would let a stray ``PORT`` in a dev shell
    silently change behaviour, so the serving entrypoint and container command
    consume it explicitly instead (``serve.py`` / ``docker/entrypoint.sh``).
    """
    serving = data.setdefault("serving", {})

    # Bind address. Containers must listen on 0.0.0.0; local dev stays on loopback.
    if host := os.environ.get("MLSERVE_HOST"):
        serving["host"] = host

    # Production-only controls. Neither is ever committed; both come from the
    # platform's secret/environment configuration.
    if origins := os.environ.get("MLSERVE_CORS_ORIGINS"):
        serving["cors_allow_origins"] = [o.strip() for o in origins.split(",") if o.strip()]
    if token := os.environ.get("MLSERVE_ADMIN_TOKEN"):
        serving["admin_token"] = token

    # Persistent data root. Render's default filesystem is ephemeral; a mounted disk
    # survives restarts and redeploys. When MLSERVE_DATA_ROOT is set, every piece of
    # filesystem-backed state -- MLflow tracking + artefacts, prediction store, model
    # bundle, raw data, results -- is relocated under it as an absolute path, so the
    # deployed service reads and writes the disk instead of the container layer.
    # The local config.yaml (relative paths under the repo) is left untouched.
    if root := os.environ.get("MLSERVE_DATA_ROOT"):
        base = Path(root)
        paths = data.setdefault("paths", {})
        paths["raw_dir"] = str(base / "raw")
        paths["processed_dir"] = str(base / "processed")
        paths["scenario_dir"] = str(base / "scenarios")
        paths["artifact_dir"] = str(base / "artifacts")
        paths["results_dir"] = str(base / "results")
        paths["prediction_db"] = str(base / "predictions.sqlite")
        mlflow = data.setdefault("mlflow", {})
        # Absolute sqlite URI (four slashes) so resolve_tracking_uri keeps it verbatim.
        mlflow["tracking_uri"] = f"sqlite:///{base / 'mlflow.db'}"
        mlflow["artifact_location"] = f"file:{base / 'mlruns'}"

    return data


@lru_cache(maxsize=8)
def _load(path_str: str) -> Config:
    path = Path(path_str)
    if not path.is_absolute():
        path = project_root() / path
    with open(path) as fh:
        data = yaml.safe_load(fh)
    data = _apply_env_overrides(data)
    return Config(data, path)


def load_config(path: str | Path | None = None) -> Config:
    return _load(str(path or DEFAULT_CONFIG_PATH))


def git_commit() -> str:
    """Short git SHA, or 'unavailable' outside a repository. Never raises."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=project_root(),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if out.returncode == 0 and out.stdout.strip():
            dirty = subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=project_root(),
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            suffix = "-dirty" if dirty.stdout.strip() else ""
            return out.stdout.strip() + suffix
    except Exception:
        pass
    return "unavailable"


def code_version() -> str:
    """Content hash of the source tree.

    Git is the right answer when it exists, but this project must stay traceable in a
    plain directory too, so the source tree itself is hashed as a fallback identity.
    """
    src = project_root() / "src"
    h = hashlib.sha256()
    for file in sorted(src.rglob("*.py")):
        h.update(file.relative_to(src).as_posix().encode())
        h.update(file.read_bytes())
    return h.hexdigest()[:12]


@dataclass(frozen=True)
class Environment:
    python_version: str
    platform: str
    processor: str
    packages: dict[str, str]

    def to_dict(self) -> dict:
        return {
            "python_version": self.python_version,
            "platform": self.platform,
            "processor": self.processor,
            **{f"pkg.{k}": v for k, v in self.packages.items()},
        }


TRACKED_PACKAGES = ["numpy", "pandas", "scikit-learn", "scipy", "mlflow", "fastapi", "pydantic"]


def environment_info() -> Environment:
    import importlib.metadata as md

    packages = {}
    for name in TRACKED_PACKAGES:
        try:
            packages[name] = md.version(name)
        except Exception:
            packages[name] = "absent"
    return Environment(
        python_version=sys.version.split()[0],
        platform=platform.platform(),
        processor=platform.machine(),
        packages=packages,
    )
