"""Tests for the deployment/security integration layer.

These cover only the *newly introduced* behaviour -- environment-driven
configuration, the admin-token guard on ``/admin/reload``, and the CORS
allow-list. The existing backend test suite is untouched; nothing here changes
prediction, error, registry, retraining, drift or rollback semantics.

Every test that mutates the process environment or the config cache restores it
afterwards, so the suite stays order-independent.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from mlserve.monitoring.store import PredictionStore
from mlserve.serving.app import create_app
from mlserve.serving.metrics import ServingMetrics

from .conftest import StubLoader, clone_config

# --------------------------------------------------------------------- fixtures


@pytest.fixture
def loaded_client_factory(tmp_path, loaded_model):
    """Build an isolated TestClient with arbitrary config overrides."""

    def _make(overrides: dict | None = None) -> TestClient:
        cfg = clone_config(tmp_path, overrides)
        store = PredictionStore(cfg.path("paths.prediction_db"))
        metrics = ServingMetrics(feature_sample_rate=1.0, seed=0)
        app = create_app(cfg, loader=StubLoader(loaded_model), store=store, metrics=metrics)
        client = TestClient(app)
        client.__enter__()
        client.app_state = app.state.service
        return client

    return _make


# ------------------------------------------------- environment override layer


def test_config_is_inert_without_deployment_env(monkeypatch):
    """No deployment env -> config resolves to the committed file, digest stable."""
    from mlserve import config as config_module

    for var in (
        "MLSERVE_HOST",
        "MLSERVE_CORS_ORIGINS",
        "MLSERVE_ADMIN_TOKEN",
        "MLSERVE_DATA_ROOT",
        "PORT",
    ):
        monkeypatch.delenv(var, raising=False)
    config_module._load.cache_clear()
    try:
        cfg = config_module.load_config()
        # Local defaults from config.yaml, untouched.
        assert str(cfg.require("serving.host")) == "127.0.0.1"
        assert cfg.get("serving.admin_token", "") == ""
        # Paths remain repo-relative, not absolute.
        assert not cfg.require("paths.prediction_db").startswith("/")
    finally:
        config_module._load.cache_clear()


def test_data_root_relocates_all_filesystem_state(monkeypatch):
    from mlserve import config as config_module

    monkeypatch.setenv("MLSERVE_DATA_ROOT", "/var/data")
    config_module._load.cache_clear()
    try:
        cfg = config_module.load_config()
        assert cfg.require("paths.prediction_db") == "/var/data/predictions.sqlite"
        assert cfg.require("paths.raw_dir") == "/var/data/raw"
        assert cfg.require("paths.artifact_dir") == "/var/data/artifacts"
        # Absolute sqlite URI (four slashes) and absolute artifact root.
        assert cfg.require("mlflow.tracking_uri") == "sqlite:////var/data/mlflow.db"
        assert cfg.require("mlflow.artifact_location") == "file:/var/data/mlruns"
        # Config.path() returns the absolute path verbatim, not repo-relative.
        assert str(cfg.path("paths.prediction_db")) == "/var/data/predictions.sqlite"
    finally:
        monkeypatch.delenv("MLSERVE_DATA_ROOT", raising=False)
        config_module._load.cache_clear()


def test_cors_and_admin_env_are_parsed(monkeypatch):
    from mlserve import config as config_module

    monkeypatch.setenv("MLSERVE_CORS_ORIGINS", "https://a.onrender.com, https://b.example")
    monkeypatch.setenv("MLSERVE_ADMIN_TOKEN", "s3cret")
    monkeypatch.setenv("MLSERVE_HOST", "0.0.0.0")
    config_module._load.cache_clear()
    try:
        cfg = config_module.load_config()
        assert cfg.require("serving.cors_allow_origins") == [
            "https://a.onrender.com",
            "https://b.example",
        ]
        assert cfg.require("serving.admin_token") == "s3cret"
        assert cfg.require("serving.host") == "0.0.0.0"
    finally:
        for var in ("MLSERVE_CORS_ORIGINS", "MLSERVE_ADMIN_TOKEN", "MLSERVE_HOST"):
            monkeypatch.delenv(var, raising=False)
        config_module._load.cache_clear()


def test_env_override_changes_the_digest(monkeypatch):
    """A deployment config must be traceable: its digest differs from local."""
    from mlserve import config as config_module

    monkeypatch.delenv("MLSERVE_DATA_ROOT", raising=False)
    config_module._load.cache_clear()
    local_digest = config_module.load_config().digest
    monkeypatch.setenv("MLSERVE_DATA_ROOT", "/var/data")
    config_module._load.cache_clear()
    try:
        deployed_digest = config_module.load_config().digest
    finally:
        monkeypatch.delenv("MLSERVE_DATA_ROOT", raising=False)
        config_module._load.cache_clear()
    assert local_digest != deployed_digest


# --------------------------------------------------------- admin token guard


def test_admin_reload_is_open_when_no_token_configured(loaded_client_factory):
    """Local platform behaviour is preserved: no token set -> reload works."""
    client = loaded_client_factory({"serving.admin_token": ""})
    resp = client.post("/admin/reload")
    assert resp.status_code == 200


def test_admin_reload_requires_token_when_configured(loaded_client_factory):
    client = loaded_client_factory({"serving.admin_token": "s3cret"})
    assert client.post("/admin/reload").status_code == 401
    assert client.post("/admin/reload", headers={"X-Admin-Token": "wrong"}).status_code == 401


def test_admin_reload_accepts_correct_token_via_header(loaded_client_factory):
    client = loaded_client_factory({"serving.admin_token": "s3cret"})
    resp = client.post("/admin/reload", headers={"X-Admin-Token": "s3cret"})
    assert resp.status_code == 200


def test_admin_reload_accepts_correct_token_via_bearer(loaded_client_factory):
    client = loaded_client_factory({"serving.admin_token": "s3cret"})
    resp = client.post("/admin/reload", headers={"Authorization": "Bearer s3cret"})
    assert resp.status_code == 200


def test_admin_denial_is_401_with_error_envelope_and_not_the_token(loaded_client_factory):
    client = loaded_client_factory({"serving.admin_token": "s3cret"})
    resp = client.post("/admin/reload", headers={"X-Admin-Token": "nope"})
    assert resp.status_code == 401
    body = resp.json()
    assert set(body) == {"request_id", "error"}
    assert body["error"]["type"] == "unauthorized"
    # The configured secret must never be echoed back to the caller.
    assert "s3cret" not in resp.text


def test_admin_denial_does_not_reload_the_model(loaded_client_factory):
    client = loaded_client_factory({"serving.admin_token": "s3cret"})
    before = client.app_state.loader.reload_calls
    client.post("/admin/reload")  # denied
    assert client.app_state.loader.reload_calls == before


def test_predict_and_reads_stay_open_when_admin_token_set(loaded_client_factory):
    """The admin token must not affect ordinary prediction/read clients."""
    client = loaded_client_factory({"serving.admin_token": "s3cret"})
    from mlserve.serving.schemas import EXAMPLE_RECORD

    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 200
    assert client.get("/model-info").status_code == 200
    assert client.post("/predict", json={"records": [EXAMPLE_RECORD]}).status_code == 200


# --------------------------------------------------------------------- CORS


def test_cors_allows_listed_origin(loaded_client_factory):
    client = loaded_client_factory({"serving.cors_allow_origins": ["https://fe.onrender.com"]})
    resp = client.get("/health", headers={"Origin": "https://fe.onrender.com"})
    assert resp.headers.get("access-control-allow-origin") == "https://fe.onrender.com"


def test_cors_does_not_allow_unlisted_origin(loaded_client_factory):
    client = loaded_client_factory({"serving.cors_allow_origins": ["https://fe.onrender.com"]})
    resp = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in resp.headers


def test_cors_preflight_allows_admin_token_header(loaded_client_factory):
    client = loaded_client_factory({"serving.cors_allow_origins": ["https://fe.onrender.com"]})
    resp = client.options(
        "/predict",
        headers={
            "Origin": "https://fe.onrender.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-request-id",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://fe.onrender.com"
    allowed = resp.headers.get("access-control-allow-headers", "").lower()
    assert "x-request-id" in allowed


def test_cors_exposes_request_id_and_model_version(loaded_client_factory):
    client = loaded_client_factory({"serving.cors_allow_origins": ["https://fe.onrender.com"]})
    resp = client.get("/health", headers={"Origin": "https://fe.onrender.com"})
    expose = resp.headers.get("access-control-expose-headers", "").lower()
    assert "x-request-id" in expose
    assert "x-model-version" in expose


def test_no_cors_header_without_an_origin(loaded_client_factory):
    """Same-origin / non-browser clients get no CORS header, as before."""
    client = loaded_client_factory({"serving.cors_allow_origins": ["https://fe.onrender.com"]})
    resp = client.get("/health")
    assert "access-control-allow-origin" not in resp.headers
