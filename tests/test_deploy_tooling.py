"""Regression tests for the deployment tooling.

Three tools now gate the production path, and each one is only useful if it actually
fails when it should:

* ``scripts/deploy/validate_blueprint.py`` — must reject a Blueprint that drops the
  single-instance/persistent-disk/readiness-CI-gate invariants, not merely accept the
  committed one.
* ``scripts/deploy/scan_secrets.py`` — must detect credentials, and must not be
  toothless (a placeholder-only scanner that never fires is worse than none).
* ``scripts/verify/check_fingerprint.py`` — must fail on a genuine fingerprint
  mismatch and tolerate the truncated baseline the docs record.

These tests import the tools directly (no network, no services), so they run on every
push. They deliberately do not import ``mlserve``: the deployment tools are standalone
by design so they can run against a remote deployment.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


#: A JWT is only recognisable when its three segments are joined, so the fixture stores the
#: segments separately and joins them at test time.
_JWT_FRAGMENTS = (
    "eyJhbGciOiJIUzI1NiJ9",
    "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
)

# NOTE: every credential sample below is assembled from fragments on purpose. The repository
# scanner treats a literal secret-shaped string anywhere in a tracked file -- including in a
# test that documents the patterns -- as a finding, which is the behaviour we want. Keeping the
# fixtures non-literal is what lets `test_committed_repository_is_clean` be a real assertion
# without teaching the scanner to look the other way.


def _load(name: str, relpath: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relpath)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def blueprint_tool():
    module = _load("deploy_validate_blueprint", "scripts/deploy/validate_blueprint.py")
    module._failures.clear()
    module._checks = 0
    return module


@pytest.fixture(scope="module")
def secret_tool():
    return _load("deploy_scan_secrets", "scripts/deploy/scan_secrets.py")


@pytest.fixture
def blueprint() -> dict:
    return copy.deepcopy(yaml.safe_load((ROOT / "render.yaml").read_text()))


def run_structure(module, doc) -> list[str]:
    module._failures.clear()
    module._checks = 0
    module.validate_structure(doc)
    return list(module._failures)


# --------------------------------------------------------------------- Blueprint --


def test_committed_blueprint_satisfies_every_structural_invariant(blueprint_tool, blueprint):
    assert run_structure(blueprint_tool, blueprint) == []


def test_blueprint_rejects_wildcard_cors(blueprint_tool, blueprint):
    for entry in blueprint["services"][0]["envVars"]:
        if entry["key"] == "MLSERVE_CORS_ORIGINS":
            entry["value"] = "*"
    failures = run_structure(blueprint_tool, blueprint)
    assert any("wildcard" in f for f in failures)


def test_blueprint_rejects_liveness_check_as_readiness_gate(blueprint_tool, blueprint):
    blueprint["services"][0]["healthCheckPath"] = "/health"
    failures = run_structure(blueprint_tool, blueprint)
    assert any("/ready" in f for f in failures)


def test_blueprint_rejects_multi_instance_backend(blueprint_tool, blueprint):
    blueprint["services"][0]["numInstances"] = 3
    failures = run_structure(blueprint_tool, blueprint)
    assert any("single-instance" in f for f in failures)


def test_blueprint_rejects_deploy_path_that_bypasses_ci(blueprint_tool, blueprint):
    blueprint["services"][0]["autoDeployTrigger"] = "commit"
    failures = run_structure(blueprint_tool, blueprint)
    assert any("checksPass" in f for f in failures)


def test_blueprint_rejects_missing_persistent_disk(blueprint_tool, blueprint):
    del blueprint["services"][0]["disk"]
    failures = run_structure(blueprint_tool, blueprint)
    assert any("persistent disk" in f for f in failures)


def test_blueprint_rejects_data_root_that_does_not_match_mount(blueprint_tool, blueprint):
    for entry in blueprint["services"][0]["envVars"]:
        if entry["key"] == "MLSERVE_DATA_ROOT":
            entry["value"] = "/tmp/elsewhere"
    failures = run_structure(blueprint_tool, blueprint)
    assert any("mountPath" in f for f in failures)


def test_blueprint_rejects_hardcoded_admin_token(blueprint_tool, blueprint):
    for entry in blueprint["services"][0]["envVars"]:
        if entry["key"] == "MLSERVE_ADMIN_TOKEN":
            entry.pop("generateValue", None)
            entry["value"] = "hunter2-hunter2-hunter2"
    failures = run_structure(blueprint_tool, blueprint)
    assert any("generateValue" in f for f in failures)


def test_blueprint_rejects_frontend_without_spa_rewrite(blueprint_tool, blueprint):
    blueprint["services"][1]["routes"] = []
    failures = run_structure(blueprint_tool, blueprint)
    assert any("SPA rewrite" in f for f in failures)


def test_official_render_schema_accepts_the_committed_blueprint(blueprint_tool, blueprint):
    """The real Render schema must accept the file we are about to deploy.

    Catches fields Render does not support (for example ``plan``/``region`` on a
    static site, which the schema rejects). Skipped when the schema cannot be
    fetched, so an offline run reports honestly rather than passing vacuously.
    """
    pytest.importorskip("jsonschema")
    blueprint_tool._failures.clear()
    status = blueprint_tool.validate_schema(blueprint)
    if "could not fetch" in status or "not installed" in status:
        pytest.skip(status)
    assert blueprint_tool._failures == [], blueprint_tool._failures
    assert "passed" in status


def test_official_render_schema_rejects_unsupported_static_site_fields(blueprint_tool, blueprint):
    """Regression: a static site must not declare ``plan``/``region``."""
    pytest.importorskip("jsonschema")
    blueprint["services"][1]["plan"] = "free"
    blueprint_tool._failures.clear()
    status = blueprint_tool.validate_schema(blueprint)
    if "could not fetch" in status or "not installed" in status:
        pytest.skip(status)
    assert blueprint_tool._failures, "schema should reject 'plan' on a static site"


# ----------------------------------------------------------------- secret scan --


@pytest.mark.parametrize(
    ("label", "sample"),
    [
        ("GitHub personal access token", "token = 'ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'"),
        ("GitHub fine-grained PAT", "github_pat_" + "11ABCDEFG0aBcDeFgHiJkL_1234567890"),
        ("AWS access key id", "AKIA" + "IOSFODNN7EXAMPLE"),
        ("Private key block", "-----BEGIN " + "RSA PRIVATE KEY-----"),
        ("Slack token", "xoxb-" + "123456789012-abcdefghijkl"),
        ("Google API key", "AIza" + "SyD1234567890abcdefghijklmnopqrstuv"),
        ("Stripe live secret", "sk_live_" + "abcdefghijklmnopqrstuvwx"),
        ("JSON Web Token", ".".join(_JWT_FRAGMENTS)),
    ],
)
def test_every_pattern_matches_its_canonical_sample(secret_tool, label, sample):
    pattern = dict(secret_tool.PATTERNS)[label]
    assert pattern.search(sample), f"{label} pattern is toothless"


def test_assignment_shaped_secret_is_detected(secret_tool):
    line = 'api_key = "' + "s3cr3t-v4lue-that-is-long" + '"'
    assert secret_tool.SECRET_ASSIGNMENT.search(line) is not None


@pytest.mark.parametrize(
    "line",
    [
        'api_key = "your-key-here"',
        'admin_token = "placeholder-value"',
        'password = "changeme-please"',
        'secret_key = "example-secret-value"',
        'admin_token = ""',
    ],
)
def test_placeholders_are_not_reported(secret_tool, line):
    match = secret_tool.SECRET_ASSIGNMENT.search(line)
    assert match is None or secret_tool.is_placeholder(match.group("value"))


def test_committed_repository_is_clean(secret_tool):
    """The real repository (including render.yaml) must pass the gate as committed."""
    assert secret_tool.main() == 0


def test_blueprint_invariant_fires_on_a_hardcoded_admin_token(
    secret_tool, blueprint, monkeypatch, tmp_path
):
    for entry in blueprint["services"][0]["envVars"]:
        if entry["key"] == "MLSERVE_ADMIN_TOKEN":
            entry.pop("generateValue", None)
            entry["value"] = "hardcoded-admin-token-value"

    fake_root = tmp_path
    (fake_root / "render.yaml").write_text(yaml.safe_dump(blueprint))
    monkeypatch.setattr(secret_tool, "REPO_ROOT", fake_root)
    secret_tool._findings.clear()
    secret_tool.check_blueprint()
    assert any("hardcoded value" in f for f in secret_tool._findings)
    secret_tool._findings.clear()


# ----------------------------------------------------------------- fingerprint --


@pytest.fixture(scope="module")
def fingerprint_tool():
    return _load("verify_check_fingerprint", "scripts/verify/check_fingerprint.py")


def test_compare_accepts_truncated_baseline(fingerprint_tool):
    full = "54122c6ae1215984557601e70e885b48e140668effbfbadc5ea9418ca76b797a"
    assert fingerprint_tool.compare(full[:32], full)
    assert fingerprint_tool.compare(full, full)


def test_compare_rejects_a_different_model(fingerprint_tool):
    full = "54122c6ae1215984557601e70e885b48e140668effbfbadc5ea9418ca76b797a"
    other = "0" * 32 + full[32:]
    assert not fingerprint_tool.compare(full, other)
    assert not fingerprint_tool.compare(full[:32], other)


def test_recorded_baseline_is_a_fingerprint(fingerprint_tool):
    expected, source = fingerprint_tool.baseline_fingerprint()
    assert len(expected) >= 32
    assert all(c in "0123456789abcdef" for c in expected)
    assert source


def test_committed_evidence_is_self_consistent(fingerprint_tool):
    """The recorded baseline must match the training summary committed alongside it."""
    expected, _ = fingerprint_tool.baseline_fingerprint()
    observed = fingerprint_tool.observed_fingerprint(fingerprint_tool.DEFAULT_OBSERVED)
    assert fingerprint_tool.compare(expected, observed)


def test_mismatch_exits_non_zero(fingerprint_tool, tmp_path, capsys):
    payload = json.loads(fingerprint_tool.DEFAULT_OBSERVED.read_text())
    payload.setdefault("registered", {}).setdefault("tags", {})["training_fingerprint"] = "f" * 64
    tampered = tmp_path / "summary.json"
    tampered.write_text(json.dumps(payload))
    assert fingerprint_tool.main(["--observed", str(tampered)]) == 1
    assert "FINGERPRINT_CHECK_FAILED" in capsys.readouterr().err


def test_missing_observed_file_is_reported_clearly(fingerprint_tool, tmp_path):
    with pytest.raises(SystemExit) as excinfo:
        fingerprint_tool.observed_fingerprint(tmp_path / "nope.json")
    assert "run scripts/train.py first" in str(excinfo.value)
