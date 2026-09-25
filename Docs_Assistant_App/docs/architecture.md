---
app: docs
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [chunker, sqlite, fts5, embeddings, rrf, sync, seed, launcher, desktop bridge]
sources: [Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/schemas.py, Docs_Assistant_App/backend/config.py, Docs_Assistant_App/backend/core/sources.py, Docs_Assistant_App/backend/core/chunker.py, Docs_Assistant_App/backend/core/store.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py, Docs_Assistant_App/backend/core/embedder.py, Docs_Assistant_App/scripts/evaluate.py, Docs_Assistant_App/scripts/evaluate_typed.py, desktop/src/services.ts, desktop/src/main.ts]
---

# Architecture

## Components overview

The Docs Assistant is a FastAPI service with no frontend, made of six small modules under `backend/core/` and a thin HTTP layer in `backend/main.py`.

```text
docs/docs_manifest.json + <dir>/docs/*.md (+ plugins/<p>/docs/<dir>/)
        |  sources.py       discovers pages, parses frontmatter, hashes files
        v
   chunker.py               page body -> ordered passages (heading path, ordinal, pair key)
        |
        v
   store.py  (SQLite, WAL)  files, chunks, embeddings, FTS5 table, immutable Snapshot
        ^                          ^
   sync.py                  search.py
   scan -> chunk ->         keywords (FTS5) + vectors (matrix product) -> RRF
   embed missing                -> rerank.py (rank rules, language, relevance, confidence) -> hits
        |                   ^
        |                   |
   embedder.py  (E5, transformers, lazy load, offline)
```

`create_app()` builds a `Services` bundle at start-up: settings, store, embedder, sync manager and search service. It installs the seed index if needed, then starts a synchronization in a background thread so that `/health` answers immediately, before any model is loaded. Requests read a `Snapshot` of the index that the sync manager replaces as a whole, so a search never sees a half-written index.

The service never generates text. It stores existing sections and returns them.

## Documentation sources discovery

`sources.py` reads `docs/docs_manifest.json` under `DOCS_ASSISTANT_DOCS_ROOT` (by default the parent of `Docs_Assistant_App/`) and returns one `DocFile` per page of every source with `indexed: true`. The pages folder is `docs_relpath(source)`: the `docs_path` of the source when it has one (`docs` for the suite, whose `dir` is `.`), otherwise `<dir>/docs`. Only top-level `*.md` files are read, then `plugins/<plugin>/docs/<dir>/*.md`, in sorted order so that the result is deterministic.

The module does not import anything from `tools/`, so the service runs in a bundle without that folder; it carries its own small frontmatter parser. The parser is tolerant: an invalid line is ignored, a page without a closed frontmatter block is taken whole, and missing keys fall back on the page set of the manifest (`doc_type`, `audience`), on the file name (`lang` from `.fr.md`) and on the first H1 (`title`). A `DocFile` carries the repository-relative path, a SHA-256 fingerprint, the modification time, the body without frontmatter and the `app_label`. The label is the title of the README of the source in the same language (falling back on the other language, then on the source id); it is mixed into the fingerprint, so renaming an app re-indexes its pages. Non-UTF-8 files are skipped with a warning.

## Chunker

`chunk_document(body, app, doc_name, title, app_label)` is deterministic and independent of the model. It numbers the headings with the shared `h-<n>` rule (ATX headings counted from 0, code blocks excluded), which must stay identical to the viewer and to `tools/docs/docs_lib.py`. The steps are:

1. Parse the body into blocks (heading, paragraph, list, table, code), each with its plain text (link targets, emphasis, HTML and list markers removed, code and table cell words kept) and word count.
2. Group blocks into sections that start at headings of level 1 to 3.
3. Merge sections under `MIN_WORDS` (60) with the next one, and a final small tail with the previous one.
4. Pack each group into parts of at most `MAX_WORDS` (300): an oversized paragraph or list is split at line, then sentence boundaries; code blocks and tables stay whole; a part never ends on a heading; consecutive parts of one section overlap by `OVERLAP_WORDS` (35) words, but never across sections.
5. Build the `Chunk`: `text` (raw markdown, for display), `embed_text` (a header, then the plain body: the header is the app label, the page title and the heading path joined by ` > `, for example `Training App - Workflows > ...`, and the app label is left out when the title already contains it), `chunk_hash` (SHA-256 of `embed_text`), `heading_path`, `heading_idx` (the anchor heading, which is the section's own heading even when a short H1 intro was merged with it), `part` (1..n when the section was split) and `pair_key` (`<app>/<doc>#<heading_idx>`).

`pair_key` is what links a French passage to its English twin, so both files of a page must have identical heading sequences.

## Store schema

`store.py` keeps everything in one SQLite file in WAL mode, with one connection per thread and a single write lock. Every write goes through `transaction()` (`BEGIN IMMEDIATE`). The embeddings are stored in the `embeddings` table, one row per passage hash and model.

| Table | Content |
|---|---|
| `meta` | Key and value: `schema_version`, `model_id`, `dim`, `last_sync_at`, `last_sync_seconds`, `seed_used` |
| `files` | One row per page: path, sha256, mtime, app, lang, audience, doc_type, doc_name, title, `app_label` |
| `chunks` | One row per passage: file path, `ord`, `heading_path` (JSON), `heading_idx`, `part`, `pair_key`, `text`, `embed_text`, `chunk_hash`, and the page attributes copied for filtering |
| `embeddings` | Primary key `(chunk_hash, model_id)`: dimension and the vector as little-endian float32 bytes |
| `chunks_fts` | FTS5 table over `text`, `title`, `heading_path`, `tags`, `app` (the app label) with the `unicode61 remove_diacritics 2` tokenizer, `chunk_id` unindexed |

Vectors are L2-normalized, so cosine similarity is a dot product. They are keyed by content hash and model, not by chunk id, which is what makes a moved file or an unchanged passage free to reindex. The FTS row is written in the same transaction as its chunk, so a chunk never exists without it. `load_snapshot()` builds an immutable `Snapshot`: the metadata of every chunk, the ids of chunks that have a vector, the contiguous float32 matrix aligned on them, the languages available per `pair_key` and the app labels (`files.app_label` by source id), which the ranking uses to recognize an app named in a question. BM25 uses the column weights `(1.0, 1.5, 3.0, 2.0, 2.0, 0.0)` for text, title, heading path, tags, app and id.

The layout carries `SCHEMA_VERSION`, stored in `meta` (currently `2`: the app label is part of the indexed text and `files.app_label` exists). Opening a database whose `schema_version` differs drops `chunks_fts`, `chunks`, `files`, `embeddings` and `meta` before recreating them, because the index is derived data: the first synchronization rebuilds it from the pages, in a few seconds on a GPU. A seed built with another schema version is not installed, so `scripts/build_seed.py` must be run again after any change of the version.

## Synchronization

`SyncManager.start()` launches one background thread (`docs-sync`) and returns false if one is already running, which makes the call idempotent. `_run()` goes through the phases `scanning`, `chunking` and `embedding`:

1. `scan_sources()` reads every page; an unreadable manifest ends the run with `last_error`.
2. With `rebuild=True`, `clear_all()` empties chunks, files and embeddings first. If the stored `model_id` differs from the current one, vectors of other models are dropped.
3. Files whose SHA-256 differs from `files` are re-chunked and replaced in one transaction each; files that disappeared are removed.
4. The snapshot is refreshed, so keyword search sees the new passages before any embedding exists.
5. `_embed_missing()` embeds, in batches of 64 sorted by length, only the `chunk_hash` values with no vector for the model; failures are recorded in `last_error` and leave the index usable by keywords.
6. Orphan embeddings are deleted, the snapshot is refreshed again, and `last_sync_at` and `last_sync_seconds` are stored.

The thread then calls `warm_model_blocking()` to load the model. `status()` exposes the state and a `progress` object with the phase, `files_total`, `files_done`, `chunks_to_embed` and `chunks_embedded`, which the desktop program turns into the **Indexing n/N** display. `install_seed()` runs before the first sync: it copies `data/seed_index.sqlite` to the workspace only if the target does not exist and the seed has the same `model_id` and `schema_version` (read without modifying the seed), through a temporary file and a rename.

## Search pipeline

`SearchService.search()` takes `SearchParams` (`q`, `lang`, `apps`, `audience`, `k`, `prefer` (`fr`, `en` or `auto`, default `auto`), `ui_lang` (default `en`), and `method` for evaluation). It normalizes whitespace, extracts terms (lowercase, no stop words, at most 16) and detects the language of the question. A query under two characters, or without any term, returns no hit right away: `intent` and `confidence` stay `null`, there is no `notice`, and `mode` is `hybrid` when the model is loaded and the index has vectors. Then:

1. **Language resolution**: `detect_lang()` counts French and English stop words and accented letters and returns `fr`, `en`, or `null` on a tie or when nothing decides (a single keyword). The display language `prefer` is the requested one when it is `fr` or `en`, otherwise the detected language, otherwise `ui_lang`. The detected language is returned as `lang_detected`.
2. **Vector list**, unless keyword-only was requested or the vector side is unavailable (model files missing, model still loading, no vectors yet, or an exception): embed the query with the `query:` prefix, take the matrix product with the snapshot, keep allowed rows (language, apps, audience where `both` matches user and dev), and order by score then id, top 50, keeping the cosine of each. If the model is not loaded, `warm_model()` starts its background load, and the answer carries a `notice` and `mode: "keyword"`. The mode becomes `hybrid` only once the vector search has actually run.
3. **Keyword list**: `build_match()` quotes each term and joins them with OR, adding a prefix form for terms of six characters or more; `keyword_hits()` returns the best 400 by BM25, filtered down to 50.
4. **Fusion**: `rrf_fuse()` adds `1 / (60 + rank)` per list.
5. **Rerank** (`rerank.py`): `profile_query()` computes the `intent` and the apps named in the question, then `factor()` multiplies each fused score. Unless the intent is `dev`, passages of `api-reference` and `code-map` pages, and to a lesser degree of `readme` pages, are multiplied by a factor below 1; passages of a named app are multiplied by a factor above 1. The `dev` intent comes from a code-like token (a path, a `snake_case` or upper-case name, a file name, camelCase) or from words such as endpoint, API, module, function, schema, IPC, "how does" or "where is". An app is named by its label without the `App` suffix (`Dataset Explorer`),, by a distinctive word of it, by a close French spelling (`orchestrateur` reaches Orchestrator) or by an alias (`entrainement` for Training). `RankConfig` gives each rule a strength exponent where 0 disables it, which is how the rules are isolated in measurements.
6. **Score**: the reranked score of a hit is divided by the best possible value for the lists used, capped at 1 and rounded. It stays a rank-relative value.
7. **Deduplication**: with `lang=both`, one passage per `pair_key`, in the resolved `prefer` language when available, keeping the best fused score of the two twins. With `lang` set to `fr` or `en`, only that language was searched.
8. **Per-file cap** of two passages, then truncation to `k` (1 to 30).
9. **Hit construction**: metadata, a snippet (the sentence or sentences of the passage that share the most query words, up to 320 characters), the vector score and keyword rank for debugging, `other_lang` when the twin exists, and `relevance`.
10. **Relevance and confidence**: `relevance()` maps the cosine linearly between two bounds measured for the model (`_COSINE_RANGE`, calibrated only for `intfloat/multilingual-e5-small`) and clips it to 0..1; it is `null` for another model or for a passage with no cosine (found by keywords only). `confidence()` is computed on the best cosine among the returned hits: `high` at or above the threshold of the model, `high` also for a query of at most two terms whose first hit ranks in the top three by keywords, `low` otherwise, and `null` when the answer is keyword-only, empty or the model is not calibrated. A hit list is never emptied because of a low confidence.

Queries never raise for a model problem: any failure of the vector side becomes a `notice` and a keyword-only answer.

## Embedder

`E5Embedder` uses `transformers` alone (no `sentence_transformers`). Files are checked with `missing_files()` before any load. `load()` imports `torch` and `transformers` lazily, loads the tokenizer and model with `local_files_only=True`, moves the model to the requested device or to CUDA when available, and records the dimension from the model configuration (also read from `config.json` before loading, for the index status). Texts are prefixed with `passage: ` or `query: `, tokenized to at most 512 tokens in batches of 32, mean-pooled over the attention mask and L2-normalized. Encoding takes a lock, so concurrent searches and a synchronization do not interleave on the model. `load_error` keeps the last failure for the index status.

## Launcher integration

The service is registered in `_lib/launcher_engine.py` under the key `docs`: `backend_module` `backend.main:app`, `frontend_dir` and `base_frontend_port` at `None`, base backend port 8068, the variables `DOCS_ASSISTANT_WORKSPACE` and `DOCS_ASSISTANT_USER`, and the offline and telemetry variables in `extra_env`. Because there is no frontend, the launcher forces backend-only mode and prints `[config] frontend = none`, which VisionNexus accepts only for compute resources. The workspace subfolder list for `docs` is empty: the service creates its own `index.sqlite`.

## Desktop bridge

The **Ask the docs** tab never reaches the service. `desktop/src/main.ts` keeps one handle per compute resource with its state (`off`, `starting`, `ready`, `stopping`, `error`), its target and its port, and exposes `cv:docs-search`, `cv:docs-index-status`, `cv:docs-sync` and the start and stop channels. A search is validated against the same limits as the service (including `prefer`, default `auto`, and `uiLang`, default `en`, sent to the service as `ui_lang`), forwarded to `POST /search` on `127.0.0.1:<port>` with a 10-second limit, and the answer is mapped defensively (unknown fields dropped, strings truncated, indexes checked) so that a malformed reply cannot break the page. Indexing progress comes from a poll of `GET /index/status` every 1.5 seconds during a synchronization or while the model is still loading, and every 15 seconds otherwise. The window uses the same status to repeat a keyword-only search once `model_loaded` turns true. Failures of the launcher are stored with an i18n key and its parameters, so the window shows them in its own language, and with the last two lines of the launcher output when the port was never announced or the process exited; that raw text is not translated. The contracts are in the [API reference](api-reference.md) and, for the IPC side, in the VisionNexus [API reference](../../docs/api-reference.md#documentation-window-channels).

## Evaluation: golden questions and typed questions

`tests/golden.json` holds reference questions with the section that must answer each (`app`, `doc`, `heading_idx`, an extract of the English heading). Each has `q_lang` and `search_lang`; when they differ, the question is cross-language. `tests/test_golden.py` checks, without a model, that every expected section still exists at the same heading number in both languages. `scripts/evaluate.py` measures the quality with the real model: it copies the documentation to a temporary folder, builds the index, and prints top-1, top-3 and top-5 for hybrid, vector-only and keyword-only search, overall and by language, audience and cross-language, plus build time, re-synchronization time and latency. A hit is correct when the returned passage covers the expected heading, whichever part of a long section it is. `--verbose` lists the questions not answered first. When a question fails, the fix is usually to give the section a title that names its subject and a first sentence that says what it is about, not to change the ranking.

`tests/typed_questions.json` and `scripts/evaluate_typed.py` complement it with a looser criterion, closer to what users type. Each question has a category (`howto`, `trouble`, `concept`, `dev`, `kw` for keywords, `typo`, `exact` for exact identifiers, or `oos` for an out-of-scope question with no right answer), its language, the accepted app ids and the accepted page types (`null` means any). A first hit is acceptable when its app and page type are in those lists, whichever section it is. The questions are split in two sets: `diagnostic`, used to understand failures, and `validation`, a held-out set that is not examined question by question while the ranking is tuned, so it shows whether a change generalizes. Run it with the real model:

```text
python scripts/evaluate_typed.py [--set diagnostic|validation|all] [--verbose] [--model <id>]
```

For each set it prints top-1 and top-3 by language mode (`both`, the default; `same`, the filter is the language of the question; `cross`, the filter is the other language), then for the vector-only and keyword-only methods, top-1 by category, and the confidence separation: how many real questions and how many out-of-scope ones get a low confidence. `--verbose` lists the questions whose first hit is not acceptable, with the page it returned. `tests/test_rerank.py` covers the rules, the language detection, `relevance()`, `confidence()` and the schema migration without a model.

## Invariants

- The chunker must be deterministic and independent of the model, and its `heading_idx` must equal the `h-<n>` rule of the viewer and of the lint.
- Both language files of a page must keep the same heading sequence, or twin links and language deduplication break.
- A chunk never exists without its FTS row, and a file's rows are replaced in one transaction.
- Readers only use an immutable `Snapshot`; it is replaced as a whole.
- Nothing is downloaded at run time; a model problem degrades to keyword search and never to an error response.
- Changing the model or the schema version makes the seed unusable, and changing the chunker parameters or the indexed text (such as the app label) makes it stale: rebuild it with `scripts/build_seed.py`.
- The rank rules stay mild: they nudge the order and never remove a result. A change to them, or to the calibrated cosine bounds of a model, is checked with `scripts/evaluate.py` and with the `validation` set of `scripts/evaluate_typed.py`.
