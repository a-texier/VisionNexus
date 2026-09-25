---
app: docs
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [navigation dans le code, backend, chunker, recherche, stockage, tests, scripts]
sources: [Docs_Assistant_App/backend, Docs_Assistant_App/scripts, Docs_Assistant_App/tests]
---

# Carte du code

## Par où commencer la lecture du code

Lisez ces fichiers dans cet ordre pour comprendre le service :

1. `backend/config.py` et `backend/model_paths.py` : chaque réglage vient de l'environnement, et la convention du dossier du modèle est ici.
2. `backend/main.py` : l'app FastAPI, l'ensemble `Services` construit dans `create_app()`, et les cinq routes.
3. `backend/core/sources.py` : comment le manifest et les pages sont découverts.
4. `backend/core/chunker.py` : des pages aux passages ; le cœur de ce qui est cherché.
5. `backend/core/store.py` : le schéma SQLite et le `Snapshot` immuable.
6. `backend/core/sync.py` : la synchronisation incrémentale.
7. `backend/core/search.py`, `backend/core/rerank.py` et `backend/core/embedder.py` : la fusion et les filtres, les règles de rang avec les signaux de langue, de pertinence et de confiance, et le modèle d'embeddings.

## Où modifier la découverte des pages

Les sources indexées et l'emplacement de leurs pages sont décidés par `docs_relpath()` et `_candidate_files()` dans `backend/core/sources.py`, à partir de `docs/docs_manifest.json`. Pour changer la lecture du frontmatter, modifiez `split_frontmatter()` à cet endroit, et gardez-le aligné sur `tools/docs/docs_lib.py` et `desktop/src/docFiles.ts`, qui analysent le même sous-ensemble. Les pages de plugins sont aussi ajoutées par `_candidate_files()`.

## Où modifier le découpage

Toutes les tailles de passages sont des constantes en haut de `backend/core/chunker.py` (`MIN_WORDS`, `MAX_WORDS`, `OVERLAP_WORDS`, `_SPLIT_LEVEL`). Le texte vu par le modèle d'embeddings est construit dans `chunk_document()` (`embed_text`), dont l'en-tête vient de `_header()` et comprend le nom de l'app (`app_label`, posé sur chaque page par `_with_labels()` dans `backend/core/sources.py`) ; la conversion en texte brut est `plain_text()`. Tout changement ici modifie les valeurs de `chunk_hash` : chaque passage est donc recalculé à la synchronisation suivante, et l'index de départ doit être reconstruit. La numérotation des titres (`scan_headings`) ne doit pas changer sans modifier aussi `tools/docs/docs_lib.py` et `desktop/ui/doc-render.js`.

## Où modifier le classement et les filtres

Les paramètres de fusion sont les constantes en haut de `backend/core/search.py` (`RRF_K`, `CANDIDATES`, `MAX_PER_FILE`, `SNIPPET_CHARS`, les mots vides). Ce qui se passe après la fusion est dans `backend/core/rerank.py` : les règles de rang (`RankConfig` avec `TABLES_FACTOR`, `README_FACTOR`, `MENTION_FACTOR`, et `factor()`), la détection des questions de développeur (`_DEV_RE`, `_CODE_LIKE_RE`), la façon dont une app est nommée dans une question (`label_aliases()`, `mentioned_apps()`, `EXTRA_ALIASES`), la détection de langue (`detect_lang()` et ses listes de mots) et les signaux montrés aux utilisateurs (`relevance()`, `confidence()`, et les bornes de cosinus et le seuil par modèle dans `_COSINE_RANGE`). Un modèle qui n'y figure pas n'a ni pertinence ni confiance tant que ses bornes ne sont pas mesurées. La construction de la requête par mots-clés est `query_terms()` et `build_match()` ; les poids de colonnes FTS sont `FTS_WEIGHTS` dans `backend/core/store.py`. Les filtres sont `SearchService._allowed()`, la déduplication des jumeaux est `_dedupe()`, et le plafond par page est `_cap_per_file()`. Les formes de requête et de réponse sont les modèles Pydantic de `backend/schemas.py` ; si vous ajoutez un champ, reproduisez-le dans `desktop/src/services.ts` (`validateSearchRequest`, `mapSearchResponse`).

## Où modifier le schéma de l'index ou la synchronisation

Les tables, le snapshot et l'installateur d'index de départ sont dans `backend/core/store.py` ; changer le schéma ou le texte indexé implique d'incrémenter `SCHEMA_VERSION`, ce qui supprime les index existants au démarrage (`Store._migrate()`) et rend les index de départ existants incompatibles. Les phases, la taille de lot (`EMBED_BATCH`) et les threads d'arrière-plan sont dans `backend/core/sync.py`. Les champs d'état exposés aux clients sont assemblés dans `index_status()` de `backend/main.py` et résumés dans `desktop/src/services.ts` (`summarizeIndexStatus`).

## Où modifier l'intégration au lanceur ou à l'app de bureau

L'entrée de registre est la clé `docs` de `APP_REGISTRY` dans `_lib/launcher_engine.py`. Le côté bureau est `startService()`, `pollServiceIndex()` et les fonctions `docs*` de `desktop/src/main.ts`, la logique pure dans `desktop/src/services.ts`, l'entrée du catalogue dans `SERVICES` (`desktop/src/catalog.ts`), et l'interface dans `desktop/ui/ask.js` et `desktop/ui/docs.html`. Les textes montrés aux utilisateurs sont dans `desktop/ui/i18n.js`.

## Où modifier les tests, l'index de départ et l'évaluation

Les tests rapides vivent dans `tests/` et utilisent un embedder factice (`tests/helpers.py`, `tests/conftest.py`) ; ceux qui ont besoin des vrais poids sont marqués `model` et s'ignorent quand les poids sont absents. Les questions de référence sont dans `tests/golden.json`, vérifiées sans modèle par `tests/test_golden.py` et notées par `scripts/evaluate.py`. Les questions écrites comme les tapent les utilisateurs sont dans `tests/typed_questions.json` (jeux `diagnostic` et `validation`) et notées par `scripts/evaluate_typed.py` ; les règles de rang, la détection de langue, la pertinence, la confiance et la migration du schéma sont couvertes sans modèle par `tests/test_rerank.py`. `scripts/build_seed.py` construit `data/seed_index.sqlite` et `scripts/download_model.py` récupère les poids. Régénérez les tableaux ci-dessous avec `python tools/docs/gen_code_map.py --app docs` après avoir déplacé ou renommé des fichiers.

## Carte des modules

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
