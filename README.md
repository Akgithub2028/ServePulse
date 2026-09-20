<div align="center">

# ServePulse

### High-Throughput ML Serving Engine, Statistical Drift Detection & Live Rollback Platform
**Sub-4ms FastAPI Inference · OpenMP Thread-Pinning Optimization · MLflow Registry Aliases · Real-Time Prometheus Telemetry**

<br/>

[![Python 3.12 | 3.13](https://img.shields.io/badge/Python-3.12%20%7C%203.13-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Scikit-Learn](https://img.shields.io/badge/scikit--learn-1.5+-F7931E?style=for-the-badge&logo=scikit-learn&logoColor=white)](https://scikit-learn.org/)
[![MLflow](https://img.shields.io/badge/MLflow-3.0+-0194E2?style=for-the-badge&logo=mlflow&logoColor=white)](https://mlflow.org/)
[![Prometheus](https://img.shields.io/badge/Prometheus-Observability-E6522C?style=for-the-badge&logo=prometheus&logoColor=white)](https://prometheus.io/)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

[![CI Pipeline](https://img.shields.io/badge/CI%20Pipeline-Passing%20(10%20Jobs)-success?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/Akgithub2028/ServePulse/actions)
[![Test Suite](https://img.shields.io/badge/Tests-467%20Passed%20%7C%200%20Failed-brightgreen?style=for-the-badge&logo=pytest&logoColor=white)](#headline-results)
[![p50 Latency](https://img.shields.io/badge/p50%20Latency-3.68ms-blueviolet?style=for-the-badge)](#headline-results)
[![Test ROC-AUC](https://img.shields.io/badge/Test%20ROC--AUC-0.9268-success?style=for-the-badge)](#headline-results)

<br/>

[**System Architecture**](#system-architecture) •
[**Headline Empirical Results**](#headline-results) •
[**System Capabilities**](#system-capabilities--architecture-highlights) •
[**Key Engineering Findings**](#four-findings-worth-reading) •
[**Live Console & Deployment**](#deployed-with-a-console) •
[**Verification**](#verifying-the-claims)

---
</div>

An end-to-end, locally reproducible machine-learning platform: validated data →
reproducible training → MLflow tracking and model registry → FastAPI serving →
Prometheus monitoring → statistical drift detection → gated retraining with promotion
and rollback.

**Every number in this repository is produced by a script in this repository.** Nothing
is estimated, and claims the evidence does not support are absent by design — a
verification script enforces that.

The specific gaps are listed in [Limitations](#limitations).

---

## Headline results

| Metric / Capability | Measured Result |
|---|---|
| Model quality (held-out test, 16,281 rows) | **ROC-AUC 0.9268**, PR-AUC 0.8239, accuracy 0.8721 |
| Linear baseline, same test set | ROC-AUC 0.9091 |
| Serving throughput | **256 req/s**, p50 **3.68 ms**, p95 **4.73 ms**, p99 **9.18 ms**, **0 errors** |
| Batched record throughput | **6,565 records/s** (batch 32) |
| Thread-pinning optimisation | **2.6–5.1× throughput**, host CPU **99.8% → 25.3%** |
| Drift detection | **100%** detection on 4 of 5 drifted scenarios, **0% false-positive rate** over 60 no-drift trials |
| Drift detection latency | **1 window (2,000 records)** |
| Retraining | Promotes a +0.029 ROC-AUC candidate, **rejects** a +0.000 one |
| Rollback through the live service | **0.082 s**, 18 requests in flight, **0 failed** |
| Tests | **467 passed, 0 failed** (CI, Python 3.12 and 3.13) |
| Training | **1.20 s**, byte-identical fingerprint across runs |

---

## System Capabilities & Architecture Highlights

ServePulse integrates data validation, high-throughput model serving, automated registry management, and continuous statistical monitoring into a cohesive platform:

### 1. Data Contracts & Model Pipeline
- **Calibrated Classifier**: `HistGradientBoostingClassifier` trained on the UCI Adult Census dataset (32,561 records) achieving **0.9268 test ROC-AUC** and **0.8239 PR-AUC** on held-out data, outperforming the linear baseline (0.9091) with a 1.20 s fit time and byte-identical reproducibility.
- **Contract-Enforced Pipelines**: Single source-of-truth schema (`src/mlserve/data/schema.py`) driving Pydantic contract validation (78 validation tests), immutable train/val/test splits, and in-model preprocessing to structurally eliminate train-serve skew.
- **Concept Drift Vulnerability Analysis**: Empirical demonstration showing that while distribution-drift detectors catch covariate and schema shifts with 100% recall, they catch concept drift **0% of the time** (triggering a **-0.287 ROC-AUC** degradation), demonstrating that label-free monitoring is blind to relational distribution shifts.

### 2. High-Throughput Serving & Runtime Optimization
- **Low-Latency Inference Microservice**: Asynchronous FastAPI inference service delivering **sub-4ms p50 latency** (3.68 ms) and **6,565 records/s** batched throughput (batch 32).
- **OpenMP Thread-Pinning Optimization**: Capped intra-op thread contention to resolve scikit-learn OpenMP fan-out across cores, multiplying single-worker throughput by **2.6–5.1× (99 → 256 req/s)** while reducing CPU utilization from **99.8% to 25.3%**.
- **Hardened Multi-Stage Container**: Non-root container (UID 10001) with dynamic PORT/HOST resolution, PID 1 graceful shutdown (SIGTERM drain delay), and attached persistent volume for SQLite tracking and MLflow artifacts.

### 3. Automated Model Lifecycle & Live Rollback
- **Alias-Based MLflow Registry**: Multi-tier model versioning using registry aliases (`candidate` → `production` → `previous`) allowing atomic pointer swaps without restarting the server.
- **Interleaved Canary Acceptance Gating**: Evaluates candidates under interleaved traffic to compute latency ratios against incumbents, eliminating host oversubscription noise and promoting positive deltas (+0.029 ROC-AUC) while rejecting zero-gain models (+0.000).
- **Live Zero-Failure Rollback**: Atomic alias rollback executed under live traffic in **0.082 seconds** with 18 requests in flight and **0 failed requests**.

### 4. Continuous Observability & Statistical Drift Guard
- **Statistical Drift Detection**: Windowed two-sample Kolmogorov-Smirnov (KS) tests and Population Stability Index (PSI) with value-binning to eliminate silent instability on tied features (e.g. 40 hours/week).
- **Full-Spectrum Observability & Testing**: Prometheus metrics with custom histogram buckets, rolling SQLite prediction logs, React 18 operations console, and 10 CI release gates running 467 tests across Python 3.12 and 3.13.

---

## Deployed, with a console

The platform is deployed as a **production-style single-instance service** on Render, behind
a CI gate: both services deploy only when GitHub Actions passes
(`autoDeployTrigger: checksPass`), so a red build never reaches production.

- **Backend** — Docker web service running the real architecture (FastAPI + MLflow registry
  with `production` / `previous` / `candidate` aliases), serving from the registry, with all
  filesystem state on a persistent disk. Readiness is gated on `/ready`, so traffic only
  arrives once a model is genuinely loadable.
- **Frontend** — a React + TypeScript operations console
  ([FRONTEND.md](FRONTEND.md)): Control Room, Inference Lab, Observability, Model
  Provenance and Platform/API views over the live endpoints. It is read-only, holds no
  privileged credential, and fabricates nothing: where the backend has no data, the console
  says so instead of drawing a chart.
- **First deploy needs no human.** `preDeployCommand` runs
  [`scripts/deploy/init_production.py`](scripts/deploy/init_production.py), which reuses this
  repository own fetch → validate → train → register machinery and is idempotent: if a
  production model already exists it does nothing, so an operator promotion or rollback
  survives every redeploy.
- **Administrative access is protected in the deployment.** `POST /admin/reload` requires
  `MLSERVE_ADMIN_TOKEN` (generated by Render, never committed and never sent to the browser)
  and answers `401` otherwise.

Full detail — topology, persistent state, health semantics, operating procedures and the
limits of a single-instance design — is in [DEPLOYMENT.md](DEPLOYMENT.md). What CI verifies
on every push is in [CI_CD.md](CI_CD.md).

---

## Quick start

```bash
git clone https://github.com/Akgithub2028/ServePulse.git && cd ServePulse

make setup      # virtualenv + pinned dependencies
make data       # download UCI Adult, verify pinned SHA-256
make train      # validate → split → train → evaluate → track in MLflow → register
make serve      # http://127.0.0.1:8077/docs
```

In another shell:

```bash
curl -X POST http://127.0.0.1:8077/predict \
  -H "content-type: application/json" \
  -d "{\"records\": [{\"age\": 39, \"workclass\": \"State-gov\", \"education_num\": 13,
                    \"marital_status\": \"Never-married\", \"occupation\": \"Adm-clerical\",
                    \"relationship\": \"Not-in-family\", \"race\": \"White\", \"sex\": \"Male\",
                    \"capital_gain\": 2174, \"capital_loss\": 0, \"hours_per_week\": 40,
                    \"native_country\": \"United-States\"}]}"
```

Everything else:

```bash
make test       # 434 tests
make smoke      # start the server, exercise every endpoint, shut down
make drift      # controlled drift experiment, 30 trials per scenario
make retrain    # retraining / promotion / rejection / rollback experiment
make rollback   # rollback verified through the running service
make bench      # HTTP load test, pinned and unpinned
make results    # aggregate every measurement into the top-level CSVs
make all        # the whole pipeline end to end
```

---

## The problem

Binary classification on the **UCI Adult (Census Income)** dataset: predict whether a
respondent income exceeds $50,000 from twelve demographic and employment attributes.

Chosen because it is publicly available with a stable URL, has a clear target and an
imbalanced class distribution (24.1% positive, so ROC-AUC *and* PR-AUC both say
something), has mixed numeric and categorical features (so different drift tests are
genuinely needed), and is small enough that the whole pipeline runs in under a minute.

The data is a 1994 US census extract and encodes the demographics of that time and
place. It is used here as a well-understood benchmark for serving, drift detection, and automated lifecycle systems, **not as a
basis for any decision about a real person** — see
[DATASET_CARD.md](DATASET_CARD.md#known-biases-and-ethical-notes).

---

## System architecture

```
raw files (SHA-256 pinned) → ingest → validate → split → feature pipeline
        → train + evaluate → MLflow tracking → model registry (aliases)
        → FastAPI serving → Prometheus + SQLite → drift detection
        → retraining decision → promote or rollback
```

Full diagram and every technology trade-off: [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

### Design principles

- **One data contract.** `src/mlserve/data/schema.py` is the single source of truth. The
  validator, the feature pipeline, the API request model and the drift detector all read
  it, so the API cannot accept something training would have rejected. A test asserts the
  generated API model equals the contract exactly.
- **Preprocessing lives inside the model.** The object in the registry *is* the
  transformation plus the estimator, so train/serve skew is removed structurally rather
  than by discipline.
- **Aliases, not stages.** Promotion and rollback are a single atomic repoint of a
  mutable pointer to an immutable version.

---

## Documentation index

The project was built in ten distinct milestones, each with a detailed document:

| Milestone | Scope | Key Documents |
|---|---|---|
| 0 | Problem, dataset, system design | [PROJECT_SCOPE.md](PROJECT_SCOPE.md), [DATASET_CARD.md](DATASET_CARD.md), [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) |
| 1 | Data validation + reproducible training | [DATA_VALIDATION.md](DATA_VALIDATION.md), [TRAINING.md](TRAINING.md) |
| 2 | MLflow tracking + model registry | [MLFLOW.md](MLFLOW.md) |
| 3 | FastAPI serving + load testing | [API.md](API.md), [LOAD_TESTING.md](LOAD_TESTING.md) |
| 4 | Docker + CI | [CI_CD.md](CI_CD.md) |
| 5 | Monitoring + observability | [MONITORING.md](MONITORING.md) |
| 6 | Drift detection | [DRIFT_DETECTION.md](DRIFT_DETECTION.md) |
| 7 | Retraining, promotion, rollback | [RETRAINING.md](RETRAINING.md), [ROLLBACK.md](ROLLBACK.md) |
| 8 | Full testing + benchmarking | [TEST_RESULTS.md](TEST_RESULTS.md), [BENCHMARKS.md](BENCHMARKS.md), [FAILURE_ANALYSIS.md](FAILURE_ANALYSIS.md), [REPRODUCIBILITY.md](REPRODUCIBILITY.md) |
| 9 | Project verification & synthesis | [FINAL_PROJECT_REPORT.md](FINAL_PROJECT_REPORT.md), [BENCHMARKS.md](BENCHMARKS.md) |

---

## Four findings worth reading

These came from investigating results that did not make sense, rather than from
implementing a checklist. They are the parts of this project most worth discussing.

**1. Input-drift monitoring is blindest to the drift that hurts most.**
Across 30 trials per scenario, the detector catches covariate and schema drift 100% of
the time with a 0% false-positive rate. It catches **concept drift 0% of the time** —
and concept drift is by far the most damaging scenario measured, costing **0.287
ROC-AUC** versus 0.053 for the large covariate shift every detector catches. That is a
property of label-free monitoring, not a bug, and it is the honest conclusion of the
experiment. [DRIFT_DETECTION.md](DRIFT_DETECTION.md#the-one-it-misses-and-why-that-matters-most)

**2. OpenMP fan-out was costing 2.6–5.1× throughput.**
Benchmarks showed throughput *falling* as concurrency rose, with one server process
pinning all ten cores. scikit-learn HistGradientBoosting predicts through OpenMP and
fans even a single-row request across every core. Capping intra-op threads to 1 took
throughput from 99 to 256 req/s, p99 from 22.7 ms to 9.2 ms, and host CPU from 99% to
20%. Scale a Python model server with worker *processes*, never intra-op threads.
[BENCHMARKS.md](BENCHMARKS.md#thread-pinning)

**3. PSI was silently unstable on a tied feature.**
46.7% of Adult records report exactly 40 hours per week. Under quantile binning the
same +2-hour shift scored PSI **0.0021** against the full reference and **2.2587**
against a subsample of it, purely because the two placed a bin edge differently. Tied
numeric columns now use value-based bins.
[DRIFT_DETECTION.md](DRIFT_DETECTION.md#a-defect-found-and-fixed-psi-on-tied-features)

**4. An absolute latency budget rejected a better model.**
A candidate 2.4 ROC-AUC points better was rejected for exceeding a 50 ms p95 budget —
the host was simply oversubscribed. The gate is now a *ratio* against the incumbent,
measured by **interleaving** both models requests and comparing medians, so host
contention cancels. [RETRAINING.md](RETRAINING.md#why-latency-is-a-ratio-not-a-millisecond-budget)

---

## Repository layout

```
src/mlserve/
  config.py            configuration, code version, environment capture
  logging_utils.py     structured JSON logging with request-id propagation
  data/                schema (the contract) · ingest · validate · split
  features/            derived features + preprocessing pipelines
  models/              train · evaluate · MLflow tracking · registry
  serving/             FastAPI app · schemas · model loader · Prometheus metrics
  monitoring/          SQLite prediction store · drift detection · scenarios
  retraining/          acceptance criteria · orchestrator
scripts/
  deploy/              Render bootstrap, Blueprint validator, secret scanner, deployed-state verifier
  fetch_data.py        download + verify pinned checksums
  train.py             the training pipeline
  serve.py             the serving entrypoint (thread-pinned)
  smoke_test.py        24 checks against the real running server
  load_test.py         reproducible HTTP benchmark
  drift_experiment.py  controlled drift experiment
  retrain_experiment.py  promotion / rejection / rollback experiment
  rollback_through_serving.py   rollback verified through the live service
  collect_results.py   aggregate every measurement
  verify/              claim and reproducibility verification
tests/                 434 backend tests (incl. deployment-security and deploy-tooling suites)
frontend/              React + TypeScript operations console (see FRONTEND.md)
docker/                Dockerfile + entrypoint (built, booted and API-verified by CI)
render.yaml            Render Blueprint: backend Docker service + frontend static site
.github/workflows/     CI — the release gate Render deploys behind
```

Documentation: [DEPLOYMENT.md](DEPLOYMENT.md) · [FRONTEND.md](FRONTEND.md) ·
[CI_CD.md](CI_CD.md) · [API.md](API.md) · [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) ·
[BENCHMARKS.md](BENCHMARKS.md) · [MONITORING.md](MONITORING.md) · [DRIFT_DETECTION.md](DRIFT_DETECTION.md) ·
[RETRAINING.md](RETRAINING.md) · [ROLLBACK.md](ROLLBACK.md) · [REPRODUCIBILITY.md](REPRODUCIBILITY.md)

---

## Results files

| File | Contents |
|---|---|
| `EVALUATION_RESULTS.csv` | Per-model, per-split metrics with full provenance |
| `SERVING_BENCHMARKS.csv` | Every load-test configuration, pinned and unpinned |
| `DRIFT_RESULTS.csv` | Per-scenario detection rates and performance deltas |
| `results/` | Raw experiment output, plots, JUnit XML, aggregated summary |

---

## Limitations

Stated plainly, because the point of this project is that its claims are checkable:

1. **Single instance, by construction.** SQLite plus filesystem storage is not multi-writer
   safe, so the deployment runs one instance with a persistent disk. No horizontal scaling is
   claimed.
2. **No zero-downtime releases.** Render disables zero-downtime deploys for services with an
   attached disk. A restart is a brief outage. This is documented in
   [DEPLOYMENT.md](DEPLOYMENT.md), not hidden.
3. **No historical telemetry.** The store aggregates over a rolling window and the Prometheus
   counters are cumulative; there is no per-request history, so no trend chart exists and the
   console does not draw one.
4. **One shared admin secret, not an identity model.** The admin guard is a deployment control,
   not authentication of users. It does not make the service multi-tenant.
5. **Advisories in the deployment dependency closure.** MLflow 3.6.0 and pyarrow 22.0.0 carry
   known advisories; the exposure analysis and the remediation path (MLflow ≥ 3.15.0, as a
   separate tested change) are recorded in `scripts/deploy/audit_baseline.txt`.
6. **Retraining is operator-invoked.** There is no scheduler, no queue and no background job —
   by design, and documented.
7. **Model behaviour limits are unchanged**: drift detection sees input-distribution drift, not
   concept drift; no fairness assessment despite strong demographic associations in the data;
   benchmarks remain single-machine, single-worker, loopback.

---

## Verifying the claims

```bash
python scripts/verify/verify_claims.py           # evidence table, overclaim scan, deliverables
python scripts/verify/verify_clean_env_repro.py  # rebuild in a fresh venv and compare
python scripts/verify/check_fingerprint.py       # fresh training run vs the recorded baseline
```

`verify_claims.py` checks that every row of the evidence table names a
file that exists, a number that actually appears in that file, and a reproduction
command whose script exists — and scans every document for unqualified claims such as
"production-ready" or "zero-downtime".

---

## License

This project is licensed under the [MIT License](LICENSE) - see the [LICENSE](LICENSE) file for details.

Copyright (c) 2026 [Aayaann Kausar](https://github.com/Akgithub2028).
