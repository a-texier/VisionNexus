---
app: docs
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, health, index status, sync, rebuild, search]
sources: [Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/schemas.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py]
---

# API reference

## Conventions

The Docs Assistant exposes a small JSON API over HTTP, with interactive documentation (Swagger) at `/docs` on the service port. The port is chosen by the launcher (8068 as a base, see [Configuration](configuration.md#port-and-launcher-options)); VisionNexus reaches it on `127.0.0.1`, through an SSH tunnel when the service runs on a VM. There is no authentication: the service is meant to be reached only through that local port.

Cross-origin requests are accepted from `http://localhost` and `http://127.0.0.1` on any port. Validation errors use HTTP 422 with the body `{"detail": "Requete invalide : <field>: <message> ; ...", "errors": [{"loc", "msg", "type"}]}`. Long operations (synchronization, rebuild) return HTTP 202 immediately and run in a background thread; follow them with `GET /index/status`.

## Endpoint summary

The table lists every route with its source line. It is generated from the code; the following sections describe requests and responses.

<!-- generated:start -->
### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/health` | `health()` | `Docs_Assistant_App/backend/main.py:110` |
| POST | `/index/rebuild` | `index_rebuild()` | `Docs_Assistant_App/backend/main.py:154` |
| GET | `/index/status` | `index_status()` | `Docs_Assistant_App/backend/main.py:121` |
| POST | `/index/sync` | `index_sync()` | `Docs_Assistant_App/backend/main.py:149` |
| POST | `/search` | `search()` | `Docs_Assistant_App/backend/main.py:161` |
<!-- generated:end -->

## Health and index endpoints

`GET /health` always answers quickly, even while the model loads or the index is being built. It returns `{"status": "ok", "model_available", "model_loaded", "index_ready", "syncing"}`: `model_available` is true when the model files are complete on disk, `model_loaded` when the model is in memory, `index_ready` when at least one passage is stored, and `syncing` while a synchronization runs. VisionNexus polls it to decide that the service is ready.

`GET /index/status` describes the index and the model:

| Field | Meaning |
|---|---|
| `model_id`, `dim`, `device` | Embedding model, vector size and device in use (`null` before loading unless requested) |
| `model_available`, `model_loaded` | As in `/health` |
| `message` | Empty, or the reason why the model is unavailable or failed to load |
| `files`, `chunks`, `embedded` | Number of pages, passages, and passages that have a vector for the current model |
| `per_app`, `per_lang` | Passage counts by source id and by language |
| `last_sync` | `{"at", "seconds"}` of the last completed synchronization |
| `syncing` | True while a synchronization runs |
| `progress` | `{"phase", "files_total", "files_done", "chunks_to_embed", "chunks_embedded"}`; `phase` is `idle`, `starting`, `scanning`, `chunking` or `embedding` |
| `last_error` | Last synchronization error, or `null` |
| `seed_used` | True if the index was initialized from the seed |
| `user`, `workspace` | Session user and workspace folder |

`POST /index/sync` starts an incremental synchronization in the background and answers 202 with `{"started": true, "syncing": true}`; if one is already running it answers `{"started": false, "syncing": true}` and starts nothing. `POST /index/rebuild` empties the index and reindexes everything: it answers 202 `{"started": true, "syncing": true}`, or HTTP 409 with `{"detail": "Une synchronisation est deja en cours."}` if a synchronization is running.

## Search endpoint

`POST /search` returns the passages that best answer a question. The request body has these fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `q` | string | required | The question or keywords, at most 500 characters; under 2 characters returns no hit |
| `lang` | `fr`, `en` or `both` | `both` | Languages searched; `fr` or `en` restricts the search to that language |
| `apps` | array of strings | `[]` | Source ids to search (`annotation`, `explorer`, `suite`, `docs`...); empty means all |
| `audience` | `user`, `dev` or `all` | `all` | A page written for `both` matches `user` and `dev` |
| `k` | integer 1 to 30 | 8 | Maximum number of results |
| `prefer` | `fr`, `en` or `auto` | `auto` | Language kept when `lang` is `both` and a section exists in both; `auto` uses the language detected in the question |
| `ui_lang` | `fr` or `en` | `en` | Language used by `auto` when the question does not decide (a single keyword, for example) |

```json
POST /search
{"q": "how do I export to YOLO?", "lang": "both", "apps": ["annotation"], "audience": "all", "k": 8, "prefer": "auto", "ui_lang": "fr"}
```

The response has `mode`, `took_ms`, `terms`, an optional `notice`, `confidence`, `lang_detected`, `intent` and the `hits`:

```json
{"mode": "hybrid", "took_ms": 21.4, "terms": ["export", "yolo"], "notice": null,
 "confidence": "high", "lang_detected": "en", "intent": "none",
 "hits": [{"app": "annotation", "doc": "workflows", "doc_type": "workflows", "audience": "user",
           "lang": "en", "title": "Workflows",
           "heading_path": ["Workflows", "Export the dataset to YOLO, COCO or .ver"],
           "heading_idx": 14, "part": null, "snippet": "Click Export in the top toolbar...",
           "score": 0.97, "relevance": 0.81, "vector_score": 0.89, "keyword_rank": 1,
           "other_lang": {"lang": "fr", "doc": "workflows", "heading_idx": 14}}]}
```

`mode` is `hybrid` (keywords and vectors) or `keyword`; in `keyword` mode `notice` explains why, for example that the model is missing or loading. A query of fewer than 2 characters returns no hit, no `notice`, and a `mode` of `hybrid` when the model is loaded. `terms` are the words extracted from the question, useful to highlight them.

Three top-level fields describe the question. `lang_detected` is `fr` or `en` when the words and accents of the question decide, otherwise `null`; with `prefer` set to `auto`, a section that exists in both languages is returned in that language, or in `ui_lang` when it is `null`. An explicit `prefer` of `fr` or `en` imposes the language, and `lang` set to `fr` or `en` restricts the search to it. `intent` is `dev` when the question looks like a developer question (a code-like token such as a path, a `snake_case` name, an upper-case variable or a file name, or words such as endpoint, API, module, function, schema, IPC, "how does" or "where is"), `none` otherwise, and `null` for a query too short to be searched; outside a `dev` intent the generated reference pages and README pages are ranked slightly lower. `confidence` is `low` when no passage looks close enough to the question (the best cosine similarity is under a threshold measured for the default model), `high` otherwise, and `null` when it cannot be judged: keyword-only mode, no hit, or a model that is not calibrated. A `low` confidence does not remove any hit; a client can use it to warn the user.

In each hit, `heading_idx` is the `h-<n>` number of the section's heading, the anchor to scroll to; `part` is the number of the part when a long section was split, otherwise `null`; `snippet` is up to 320 characters chosen from the passage. `score` is the fusion score between 0 and 1, relative to the best possible fusion score of the query: it says where a hit stands among the others, so the first hit is close to 1 even when the answer is poor. `relevance` is the measurable quality, between 0 and 1, derived from the cosine similarity; it is `null` when the model is not calibrated or when the passage was found by keywords only. `vector_score` (cosine) and `keyword_rank` are debugging values and can be `null`. `other_lang` gives the twin section in the other language when it exists, with the same `doc` and `heading_idx`.

## Errors and limits

- A body that does not match the schema (a missing `q`, a `k` outside 1 to 30, an unknown `lang`, `prefer` or `ui_lang`) answers 422 with the field name in `detail`.
- A model problem never gives an error response: the search falls back to keywords and sets `notice`.
- At most two hits per documentation page are returned, and when `lang` is `both` each section appears once, in the language chosen by `prefer`.
- `POST /index/rebuild` answers 409 while a synchronization runs; `POST /index/sync` does not.
- Answers are computed on an immutable snapshot of the index, so a search made during a synchronization sees either the old or the new state, never a mix.
