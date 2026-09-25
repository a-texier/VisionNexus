---
app: docs
doc_type: configuration
audience: both
lang: en
title: Configuration
order: 40
tags: [environment variables, model weights, offline, device, workspace, port, seed]
sources: [Docs_Assistant_App/backend/config.py, Docs_Assistant_App/backend/model_paths.py, Docs_Assistant_App/backend/main.py, Docs_Assistant_App/scripts/download_model.py, Docs_Assistant_App/scripts/build_seed.py, Docs_Assistant_App/requirements.txt, _lib/launcher_engine.py]
---

# Configuration

## Prerequisites and installation

The Docs Assistant is a Python service; it needs no Node.js and has no frontend. It runs in the conda environment given in the VisionNexus settings, so the packages below must be installed in that environment, on the machine that runs the service (your machine, or the VM).

| Package | Use |
|---|---|
| `fastapi`, `uvicorn`, `pydantic` | The HTTP service |
| `numpy` | Vector search |
| `torch`, `transformers` | The embedding model |
| `huggingface_hub` | Only for the download script |
| `pytest`, `httpx` | Only for the tests |

Install them with `pip install -r Docs_Assistant_App/requirements.txt`, using Python 3.11 or later. The service also needs the documentation to index: the repository it runs from, with its `docs/docs_manifest.json` (see [Documentation sources](#documentation-sources)).

## Environment variables

The service reads its configuration from the environment, which the launcher fills in. You only set them by hand when you start the service without the launcher.

| Variable | Role | Default |
|---|---|---|
| `DOCS_ASSISTANT_WORKSPACE` | Working folder; the index is `<workspace>/index.sqlite` | `Docs_Assistant_App/data/workspace`; the launcher sets `<workspace>/docs_<user>` |
| `DOCS_ASSISTANT_USER` | Session name, shown by the index status | `unknown`; the launcher sets your user |
| `DOCS_ASSISTANT_DOCS_ROOT` | Root of the suite holding `docs/docs_manifest.json` | The parent folder of `Docs_Assistant_App/` |
| `DOCS_ASSISTANT_MODEL` | Embedding model: `intfloat/multilingual-e5-small` or `intfloat/multilingual-e5-base` | `intfloat/multilingual-e5-small` |
| `DOCS_ASSISTANT_MODEL_DIR` | Folder of the model files, instead of `backend/models/<model name>/` | not set |
| `DOCS_ASSISTANT_DEVICE` | Where the model runs: `cuda`, `cpu`... | `cuda` if available, otherwise `cpu` |
| `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE` | Forbid any download | `1` |
| `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK` | Disable telemetry | `1`, set by the launcher |

The launcher also exports `BACKEND_PORT` to every backend, but the Docs Assistant does not read it: the port is the one given to `uvicorn` on its command line.

## Model weights and download script

The service needs the files of one embedding model in `Docs_Assistant_App/backend/models/<model name>/`: `config.json`, the tokenizer files (`tokenizer.json` or `sentencepiece.bpe.model`) and the weights (`model.safetensors`). The default model is `multilingual-e5-small`, about 470 MB with 384-dimensional vectors; `multilingual-e5-base` is about 1.1 GB with 768-dimensional vectors. The weights are not stored in the repository, and [MODEL_WEIGHTS.md](../../MODEL_WEIGHTS.md) lists them with the other weights of the suite.

Download them once, on a machine with internet access, from `Docs_Assistant_App/`:

```bash
python scripts/download_model.py                        # the default small model
python scripts/download_model.py --model intfloat/multilingual-e5-base
python scripts/download_model.py --all                  # both models
```

The script fetches only the files listed above (no ONNX or other formats), checks that nothing is missing and prints the size. It is the only place that is allowed to use the network. On a VM without internet, download on another machine and copy the model folder to the same path on the VM. Without the model the service still starts and searches by keywords only.

## Offline operation

The service never downloads anything while it runs. `main.py` sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` before any library is imported, and the launcher registry adds them again, with the telemetry switches, for `docs`. The model is loaded with `local_files_only`, so a missing or damaged file gives an error message instead of a download attempt. This makes the service safe on machines without internet access, once the weights are in place.

## Device selection

The embedding model runs on the GPU when CUDA is available and on the processor otherwise. Set `DOCS_ASSISTANT_DEVICE` to force `cpu` (for example on a GPU that other jobs need) or a specific `cuda:1`. The device actually used appears in the index status. A processor is enough for searches, which embed one short question each; it is only noticeably slower to index a whole documentation from scratch.

## Workspace and index files

The service writes one SQLite database, `index.sqlite`, in its workspace folder, with the usual `-wal` and `-shm` companion files while it runs. With the launcher the folder is `<workspace>/docs_<user>/`, so each user has an index of their own. The index holds the text of the documentation passages and their vectors; it can be deleted at any time and is rebuilt at the next start (from the seed if there is one). An index written by a version of the service with another index layout is dropped and rebuilt by itself at start, which takes a few seconds on a GPU.

Inside `Docs_Assistant_App/`, the `data/` folder can hold an optional seed index `seed_index.sqlite` (absent from the published repository and the bundles) and, once launched by the launcher, a small `.history.json` listing the workspaces used. The service never writes into the documentation folders.

## Port and launcher options

The base port is 8068; the launcher picks the first free port from there and announces it. The service is launched by VisionNexus like an app, with `--backend-only` implied since its registry entry has no frontend:

```bash
python launcher.py --app docs --workspace <workspace> --user <user>
```

Started by hand from `Docs_Assistant_App/`, without the launcher:

```bash
DOCS_ASSISTANT_WORKSPACE=/tmp/docs_ws python -m uvicorn backend.main:app --port 8068
```

The service listens on all network interfaces of its machine and accepts cross-origin requests from `localhost` and `127.0.0.1` on any port. On a VM, only your tunnel needs to reach it; restrict the port with the VM firewall on a shared network.

## Documentation sources

The service indexes what `docs/docs_manifest.json` lists under `sources` with `indexed` set to true: the eight apps, VisionNexus (`suite`) and the Docs Assistant itself (`docs`). For each source it reads the top-level `.md` files of its documentation folder, which is `<dir>/docs` or the folder named by `docs_path` (`docs` at the repository root for VisionNexus), and the pages that plugins add in `plugins/<plugin>/docs/<dir>/`. Subfolders such as `assets/` are ignored.

Files must be UTF-8; others are skipped with a warning. The frontmatter is read tolerantly: a page with missing keys is still indexed, with the values deduced from its file name and the page set of the manifest. If the manifest cannot be read, the synchronization stops with the error `Sources de doc illisibles` and the last error appears in the index status.

## Building the seed index

The seed index is built with the real model so that a new machine starts with a ready index. From `Docs_Assistant_App/`:

```bash
python scripts/build_seed.py [--model intfloat/multilingual-e5-small] [--docs-root ..] [--output data/seed_index.sqlite] [--device cuda]
```

The script indexes all documentation, compacts the file into a single self-contained SQLite file and replaces `data/seed_index.sqlite`. Build it with the same model as the service will use, since a seed built with another model or another index layout is ignored. Rebuild it after a notable documentation change, after any change of the index layout (the storage schema version) It is a build artifact for internal deployments: keep it out of version control. The publication and bundle scripts never ship it, so a public installation always builds its index on the first start (a few tens of seconds on a GPU).
