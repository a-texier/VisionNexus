---
app: docs
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code navigation, backend, chunker, search, store, tests, scripts]
sources: [Docs_Assistant_App/backend, Docs_Assistant_App/scripts, Docs_Assistant_App/tests]
---

# Code map

## Where to start reading the code

Read these files in this order to understand the service:

1. `backend/config.py` and `backend/model_paths.py`: every setting comes from the environment, and the model folder convention lives here.
2. `backend/main.py`: the FastAPI app, the `Services` bundle built in `create_app()`, and the five routes.
3. `backend/core/sources.py`: how the manifest and the pages are discovered.
4. `backend/core/chunker.py`: pages to passages; the core of what gets searched.
5. `backend/core/store.py`: the SQLite schema and the immutable `Snapshot`.
6. `backend/core/sync.py`: the incremental synchronization.
7. `backend/core/search.py`, `backend/core/rerank.py` and `backend/core/embedder.py`: fusion and filters, the rank rules with the language, relevance and confidence signals, and the embedding model.

## Where to change how pages are discovered

Which sources are indexed and where their pages live is decided by `docs_relpath()` and `_candidate_files()` in `backend/core/sources.py`, from `docs/docs_manifest.json`. To change how frontmatter is read, edit `split_frontmatter()` there, and keep it in step with `tools/docs/docs_lib.py` and `desktop/src/docFiles.ts`, which parse the same subset. Plugin pages are added by `_candidate_files()` too.

## Where to change chunking

All chunk sizes are constants at the top of `backend/core/chunker.py` (`MIN_WORDS`, `MAX_WORDS`, `OVERLAP_WORDS`, `_SPLIT_LEVEL`). The text seen by the embedding model is built in `chunk_document()` (`embed_text`), whose header comes from `_header()` and includes the app name (`app_label`, set on each page by `_with_labels()` in `backend/core/sources.py`); the plain-text conversion is `plain_text()`. Any change to these alters the `chunk_hash` values, so every passage is embedded again at the next synchronization, and the seed must be rebuilt. Heading numbering (`scan_headings`) must not change without changing `tools/docs/docs_lib.py` and `desktop/ui/doc-render.js` too.

## Where to change ranking and filters

Fusion parameters are the constants at the top of `backend/core/search.py` (`RRF_K`, `CANDIDATES`, `MAX_PER_FILE`, `SNIPPET_CHARS`, the stop words). What happens after the fusion is in `backend/core/rerank.py`: the rank rules (`RankConfig` with `TABLES_FACTOR`, `README_FACTOR`, `MENTION_FACTOR`, and `factor()`), the developer-question detection (`_DEV_RE`, `_CODE_LIKE_RE`), the way an app is named in a question (`label_aliases()`, `mentioned_apps()`, `EXTRA_ALIASES`), the language detection (`detect_lang()` with its word lists) and the signals shown to users (`relevance()`, `confidence()`, and the per-model cosine bounds and threshold in `_COSINE_RANGE`). A model that is not listed there gets no relevance and no confidence until its bounds are measured. Keyword query building is `query_terms()` and `build_match()`; the FTS column weights are `FTS_WEIGHTS` in `backend/core/store.py`. Filters are `SearchService._allowed()`, twin deduplication is `_dedupe()`, and the per-page cap is `_cap_per_file()`. The request and response shapes are the Pydantic models of `backend/schemas.py`; if you add a field, mirror it in `desktop/src/services.ts` (`validateSearchRequest`, `mapSearchResponse`).

## Where to change the index schema or synchronization

Tables, the snapshot and the seed installer are in `backend/core/store.py`; changing the schema or the indexed text means raising `SCHEMA_VERSION`, which drops existing indexes at start (`Store._migrate()`) and makes existing seeds incompatible. The phases, the batch size (`EMBED_BATCH`) and the background threads are in `backend/core/sync.py`. Status fields exposed to clients are assembled in `index_status()` in `backend/main.py` and summarized in `desktop/src/services.ts` (`summarizeIndexStatus`).

## Where to change the launcher or desktop integration

The registry entry is the `docs` key of `APP_REGISTRY` in `_lib/launcher_engine.py`. The desktop side is `startService()`, `pollServiceIndex()` and the `docs*` functions in `desktop/src/main.ts`, the pure logic in `desktop/src/services.ts`, the catalog entry in `SERVICES` (`desktop/src/catalog.ts`), and the interface in `desktop/ui/ask.js` and `desktop/ui/docs.html`. Texts shown to users are in `desktop/ui/i18n.js`.

## Where to change tests, the seed and the evaluation

Fast tests live in `tests/` and use a fake embedder (`tests/helpers.py`, `tests/conftest.py`); the ones that need the real weights are marked `model` and skip themselves when the weights are absent. Reference questions are in `tests/golden.json`, checked without a model by `tests/test_golden.py` and scored by `scripts/evaluate.py`. Questions written as users type them are in `tests/typed_questions.json` (sets `diagnostic` and `validation`) and scored by `scripts/evaluate_typed.py`; the rank rules, language detection, relevance, confidence and schema migration are covered without a model by `tests/test_rerank.py`. `scripts/build_seed.py` builds `data/seed_index.sqlite` and `scripts/download_model.py` fetches the weights. Regenerate the tables below with `python tools/docs/gen_code_map.py --app docs` after moving or renaming files.

## Module map

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` | Configuration du service : tout vient de l'environnement (pose par le launcher). | `Settings`, `load_settings` |
| `main.py` |  | `Services`, `build_services`, `create_app` |
| `model_paths.py` | Resolution du dossier des poids d'embeddings, hors ligne. | `model_name`, `model_dir`, `missing_files` |
| `schemas.py` | Modeles Pydantic de l'API. | `SearchRequest`, `OtherLang`, `Hit`, `SearchResponse` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `chunker.py` | Decoupage d'une page Markdown en passages, deterministe et independant du modele. | `Heading`, `Chunk`, `scan_headings`, `plain_text`, `count_words`, `chunk_document` |
| `embedder.py` | Embeddings e5 avec transformers seul (sentence_transformers n'est pas requis). | `Embedder`, `E5Embedder` |
| `rerank.py` | Ajustements du classement apres la fusion RRF, et signaux de confiance. | `fold`, `detect_intent`, `label_aliases`, `mentioned_apps`, `RankConfig`, `QueryProfile`, `profile_query`, `factor`, `detect_lang`, `relevance`, `confidence` |
| `search.py` | Recherche hybride : cosinus exact (vecteurs) + BM25 (FTS5), fusion par RRF. | `fold`, `query_terms`, `build_match`, `rrf_fuse`, `make_snippet`, `SearchParams`, `SearchService` |
| `sources.py` | Decouverte des pages de doc a indexer. | `DocFile`, `split_frontmatter`, `split_doc_name`, `load_manifest`, `docs_relpath`, `scan_sources` |
| `store.py` | Index SQLite (WAL) : fichiers, passages, embeddings et table FTS5. | `ChunkMeta`, `Snapshot`, `vec_to_blob`, `blob_to_vec`, `Store`, `peek_meta`, `install_seed` |
| `sync.py` | Synchronisation incrementale des docs vers l'index. | `SyncManager` |
<!-- generated:end -->
