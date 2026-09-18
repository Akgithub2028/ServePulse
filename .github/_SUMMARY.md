# `.github/` — GitHub automation

Repository automation consumed by GitHub itself.

## Contents

- `workflows/ci.yml` — the single workflow: the release gate that Render deploys behind.

There is no other automation: no issue templates, no CODEOWNERS, no bot configuration.
Deployment is driven entirely by `render.yaml` at the repository root, which Render reads
when the Blueprint is applied.

## Directive paths

| | |
|---|---|
| The pipeline | `workflows/ci.yml` |
| What the pipeline proves | `../CI_CD.md` |
| The deployment it gates | `../render.yaml`, `../DEPLOYMENT.md` |
