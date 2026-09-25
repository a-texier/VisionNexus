---
app: docs
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [chunker, sqlite, fts5, embeddings, rrf, synchronisation, index de départ, lanceur, pont desktop]
sources: [Docs_Assistant_App/backend/main.py, Docs_Assistant_App/backend/schemas.py, Docs_Assistant_App/backend/config.py, Docs_Assistant_App/backend/core/sources.py, Docs_Assistant_App/backend/core/chunker.py, Docs_Assistant_App/backend/core/store.py, Docs_Assistant_App/backend/core/sync.py, Docs_Assistant_App/backend/core/search.py, Docs_Assistant_App/backend/core/rerank.py, Docs_Assistant_App/backend/core/embedder.py, Docs_Assistant_App/scripts/evaluate.py, Docs_Assistant_App/scripts/evaluate_typed.py, desktop/src/services.ts, desktop/src/main.ts]
---

# Architecture

## Vue d'ensemble des composants

Le Docs Assistant est un service FastAPI sans frontend, fait de six petits modules sous `backend/core/` et d'une fine couche HTTP dans `backend/main.py`.

```text
docs/docs_manifest.json + <dir>/docs/*.md (+ plugins/<p>/docs/<dir>/)
        |  sources.py       découvre les pages, lit le frontmatter, calcule les empreintes
        v
   chunker.py               corps de page -> passages ordonnés (chemin de titres, ordinal, clé de paire)
        |
        v
   store.py  (SQLite, WAL)  fichiers, passages, embeddings, table FTS5, Snapshot immuable
        ^                          ^
   sync.py                  search.py
   scan -> découpage ->     mots-clés (FTS5) + vecteurs (produit matriciel) -> RRF
   embeddings manquants         -> rerank.py (règles de rang, langue, pertinence, confiance) -> résultats
        |                   ^
        |                   |
   embedder.py  (E5, transformers, chargement à la demande, hors ligne)
```

`create_app()` construit au démarrage un ensemble `Services` : réglages, store, embedder, gestionnaire de synchronisation et service de recherche. Il installe l'index de départ si nécessaire, puis lance une synchronisation dans un thread d'arrière-plan pour que `/health` réponde immédiatement, avant qu'aucun modèle soit chargé. Les requêtes lisent un `Snapshot` de l'index que le gestionnaire de synchronisation remplace d'un bloc : une recherche ne voit donc jamais un index à moitié écrit.

Le service ne génère jamais de texte. Il stocke des sections existantes et les renvoie.

## Découverte des sources de documentation

`sources.py` lit `docs/docs_manifest.json` sous `DOCS_ASSISTANT_DOCS_ROOT` (par défaut le parent de `Docs_Assistant_App/`) et renvoie un `DocFile` par page de chaque source avec `indexed: true`. Le dossier des pages est `docs_relpath(source)` : le `docs_path` de la source quand elle en a un (`docs` pour la suite, dont le `dir` vaut `.`), sinon `<dir>/docs`. Seuls les fichiers `*.md` de premier niveau sont lus, puis `plugins/<plugin>/docs/<dir>/*.md`, dans l'ordre trié pour que le résultat soit déterministe.

Le module n'importe rien de `tools/`, si bien que le service tourne dans un bundle sans ce dossier ; il porte son propre petit analyseur de frontmatter. L'analyseur est tolérant : une ligne invalide est ignorée, une page sans bloc de frontmatter fermé est prise entière, et les clés manquantes se rabattent sur le jeu de pages du manifest (`doc_type`, `audience`), sur le nom de fichier (`lang` d'après `.fr.md`) et sur le premier H1 (`title`). Un `DocFile` porte le chemin relatif au dépôt, une empreinte SHA-256, la date de modification, le corps sans frontmatter et le `app_label`. Ce nom est le titre du README de la source dans la même langue (à défaut dans l'autre langue, puis l'identifiant de la source) ; il entre dans l'empreinte, si bien que renommer une app réindexe ses pages. Les fichiers qui ne sont pas en UTF-8 sont ignorés avec un avertissement.

## Chunker

`chunk_document(body, app, doc_name, title, app_label)` est déterministe et indépendant du modèle. Il numérote les titres avec la règle partagée `h-<n>` (titres ATX comptés à partir de 0, blocs de code exclus), qui doit rester identique à celle du viewer et de `tools/docs/docs_lib.py`. Les étapes sont :

1. Analyser le corps en blocs (titre, paragraphe, liste, tableau, code), chacun avec son texte brut (cibles de liens, emphase, HTML et marqueurs de liste retirés, mots du code et des cellules de tableau conservés) et son nombre de mots.
2. Regrouper les blocs en sections qui commencent aux titres de niveau 1 à 3.
3. Fusionner les sections de moins de `MIN_WORDS` (60) avec la suivante, et une petite queue finale avec la précédente.
4. Empaqueter chaque groupe en parties d'au plus `MAX_WORDS` (300) : un paragraphe ou une liste trop long est coupé aux frontières de ligne, puis de phrase ; les blocs de code et les tableaux restent entiers ; une partie ne se termine jamais sur un titre ; les parties consécutives d'une même section se recouvrent de `OVERLAP_WORDS` (35) mots, mais jamais d'une section à l'autre.
5. Construire le `Chunk` : `text` (markdown brut, pour l'affichage), `embed_text` (un en-tête, puis le corps en texte brut : l'en-tête est le nom de l'app, le titre de la page et le chemin de titres reliés par ` > `, par exemple `Training App - Workflows > ...`, et le nom de l'app est omis quand le titre le contient déjà), `chunk_hash` (SHA-256 de `embed_text`), `heading_path`, `heading_idx` (le titre d'ancrage, qui est le titre propre de la section même quand une courte introduction de H1 a été fusionnée avec elle), `part` (1..n quand la section a été coupée) et `pair_key` (`<app>/<doc>#<heading_idx>`).

`pair_key` relie un passage français à son jumeau anglais : les deux fichiers d'une page doivent donc avoir des suites de titres identiques.

## Schéma du stockage

`store.py` garde tout dans un seul fichier SQLite en mode WAL, avec une connexion par thread et un unique verrou d'écriture. Chaque écriture passe par `transaction()` (`BEGIN IMMEDIATE`). Les embeddings sont stockés dans la table `embeddings`, une ligne par empreinte de passage et par modèle.

| Table | Contenu |
|---|---|
| `meta` | Clé et valeur : `schema_version`, `model_id`, `dim`, `last_sync_at`, `last_sync_seconds`, `seed_used` |
| `files` | Une ligne par page : chemin, sha256, mtime, app, lang, audience, doc_type, doc_name, title, `app_label` |
| `chunks` | Une ligne par passage : chemin du fichier, `ord`, `heading_path` (JSON), `heading_idx`, `part`, `pair_key`, `text`, `embed_text`, `chunk_hash`, et les attributs de page copiés pour le filtrage |
| `embeddings` | Clé primaire `(chunk_hash, model_id)` : dimension et vecteur sous forme d'octets float32 petit-boutiste |
| `chunks_fts` | Table FTS5 sur `text`, `title`, `heading_path`, `tags`, `app` (le nom de l'app) avec le tokenizer `unicode61 remove_diacritics 2`, `chunk_id` non indexé |

Les vecteurs sont normalisés L2 : la similarité cosinus est donc un produit scalaire. Ils sont indexés par empreinte de contenu et par modèle, pas par identifiant de passage, ce qui rend gratuits un fichier déplacé ou un passage inchangé. La ligne FTS est écrite dans la même transaction que son passage, si bien qu'un passage n'existe jamais sans elle. `load_snapshot()` construit un `Snapshot` immuable : les métadonnées de chaque passage, les identifiants des passages qui ont un vecteur, la matrice float32 contiguë alignée sur eux, les langues disponibles par `pair_key` et les noms d'app (`files.app_label` par identifiant de source), que le classement utilise pour reconnaître une app nommée dans une question. BM25 utilise les poids de colonnes `(1.0, 1.5, 3.0, 2.0, 2.0, 0.0)` pour le texte, le titre, le chemin de titres, les tags, l'app et l'identifiant.

La structure porte `SCHEMA_VERSION`, stockée dans `meta` (actuellement `2` : le nom de l'app fait partie du texte indexé et `files.app_label` existe). Ouvrir une base dont le `schema_version` diffère supprime `chunks_fts`, `chunks`, `files`, `embeddings` et `meta` avant de les recréer, car l'index est une donnée dérivée : la première synchronisation le reconstruit depuis les pages, en quelques secondes sur un GPU. Un index de départ construit avec une autre version de schéma n'est pas installé, il faut donc relancer `scripts/build_seed.py` après tout changement de version.

## Synchronisation

`SyncManager.start()` lance un thread d'arrière-plan (`docs-sync`) et renvoie faux si un thread tourne déjà, ce qui rend l'appel idempotent. `_run()` traverse les phases `scanning`, `chunking` et `embedding` :

1. `scan_sources()` lit chaque page ; un manifest illisible termine l'exécution avec `last_error`.
2. Avec `rebuild=True`, `clear_all()` vide d'abord les passages, les fichiers et les embeddings. Si le `model_id` enregistré diffère du modèle courant, les vecteurs des autres modèles sont supprimés.
3. Les fichiers dont le SHA-256 diffère de `files` sont redécoupés et remplacés, chacun dans une transaction ; les fichiers disparus sont retirés.
4. Le snapshot est rafraîchi, si bien que la recherche par mots-clés voit les nouveaux passages avant qu'aucun embedding existe.
5. `_embed_missing()` calcule, par lots de 64 triés par longueur, uniquement les `chunk_hash` sans vecteur pour le modèle ; les échecs sont enregistrés dans `last_error` et laissent l'index utilisable par mots-clés.
6. Les embeddings orphelins sont supprimés, le snapshot est rafraîchi de nouveau, et `last_sync_at` et `last_sync_seconds` sont enregistrés.

Le thread appelle ensuite `warm_model_blocking()` pour charger le modèle. `status()` expose l'état et un objet `progress` avec la phase, `files_total`, `files_done`, `chunks_to_embed` et `chunks_embedded`, que le programme de bureau transforme en affichage **Indexation n/N**. `install_seed()` s'exécute avant la première synchronisation : il copie `data/seed_index.sqlite` vers le workspace seulement si la cible n'existe pas et si l'index de départ a les mêmes `model_id` et `schema_version` (lus sans modifier l'index de départ), par un fichier temporaire et un renommage.

## Pipeline de recherche

`SearchService.search()` prend des `SearchParams` (`q`, `lang`, `apps`, `audience`, `k`, `prefer` (`fr`, `en` ou `auto`, `auto` par défaut), `ui_lang` (`en` par défaut), et `method` pour l'évaluation). Il normalise les espaces, extrait les termes (minuscules, sans mots vides, 16 au plus) et détecte la langue de la question. Une requête de moins de deux caractères, ou sans aucun terme, ne renvoie aucun résultat immédiatement : `intent` et `confidence` restent `null`, il n'y a pas de `notice`, et `mode` vaut `hybrid` quand le modèle est chargé et que l'index a des vecteurs. Puis :

1. **Résolution de la langue** : `detect_lang()` compte les mots vides français et anglais et les lettres accentuées, et renvoie `fr`, `en`, ou `null` en cas d'égalité ou quand rien ne tranche (un mot-clé seul). La langue d'affichage `prefer` est celle demandée quand elle vaut `fr` ou `en`, sinon la langue détectée, sinon `ui_lang`. La langue détectée est renvoyée dans `lang_detected`.
2. **Liste vectorielle**, sauf si seuls les mots-clés ont été demandés ou si le côté vectoriel est indisponible (fichiers du modèle absents, modèle en cours de chargement, aucun vecteur, ou exception) : embedding de la requête avec le préfixe `query:`, produit matriciel avec le snapshot, conservation des lignes autorisées (langue, apps, public où `both` correspond à user et dev), tri par score puis identifiant, 50 premiers, en gardant le cosinus de chacun. Si le modèle n'est pas chargé, `warm_model()` démarre son chargement en arrière-plan, et la réponse porte un `notice` et `mode: "keyword"`. Le mode ne devient `hybrid` qu'une fois cette recherche exécutée.
3. **Liste par mots-clés** : `build_match()` met chaque terme entre guillemets et les relie par OR, en ajoutant une forme préfixe pour les termes de six caractères ou plus ; `keyword_hits()` renvoie les 400 meilleurs par BM25, filtrés jusqu'à 50.
4. **Fusion** : `rrf_fuse()` ajoute `1 / (60 + rang)` par liste.
5. **Reclassement** (`rerank.py`) : `profile_query()` calcule l'`intent` et les apps nommées dans la question, puis `factor()` multiplie chaque score fusionné. Sauf si l'intention est `dev`, les passages des pages `api-reference` et `code-map`, et dans une moindre mesure des pages `readme`, sont multipliés par un facteur inférieur à 1 ; les passages d'une app nommée sont multipliés par un facteur supérieur à 1. L'intention `dev` vient d'un élément qui ressemble à du code (un chemin, un nom en `snake_case` ou en majuscules, un nom de fichier, du camelCase) ou de mots comme endpoint, API, module, fonction, schéma, IPC, "how does" ou "where is". Une app est nommée par son nom sans le suffixe `App` (`Dataset Explorer`),, par un mot distinctif de ce nom, par une orthographe française proche (`orchestrateur` atteint Orchestrator) ou par un alias (`entrainement` pour Training). `RankConfig` donne à chaque règle un exposant de force où 0 la désactive, ce qui permet de les isoler dans les mesures.
6. **Score** : le score reclassé est divisé par la meilleure valeur possible pour les listes utilisées, plafonné à 1 et arrondi ; il reste relatif au rang.
7. **Déduplication** : avec `lang=both`, un passage par `pair_key`, dans la langue `prefer` résolue quand elle existe, en gardant le meilleur score fusionné des deux jumeaux.
8. **Plafond par fichier** de deux passages, puis troncature à `k` (1 à 30).
9. **Construction des résultats** : métadonnées, un extrait de 320 caractères au plus (les phrases qui partagent le plus de mots de la requête), le score vectoriel et le rang par mots-clés pour le débogage, `other_lang` quand le jumeau existe, et `relevance`.
10. **Pertinence et confiance** : `relevance()` projette le cosinus de façon linéaire entre deux bornes mesurées pour le modèle (`_COSINE_RANGE`, calibré pour `intfloat/multilingual-e5-small` seulement) et le borne à 0..1 ; elle vaut `null` pour un autre modèle ou un passage sans cosinus. `confidence()` se calcule sur le meilleur cosinus des résultats renvoyés : `high` à partir du seuil du modèle, ou pour une requête d'au plus deux termes dont le premier résultat est dans les trois premiers par mots-clés, `low` sinon, et `null` pour une réponse par mots-clés seuls, vide, ou d'un modèle non calibré. Une confiance faible ne retire aucun résultat.

Un problème de modèle ne lève jamais d'erreur : il devient un `notice` et une réponse par mots-clés seuls.

## Embedder

`E5Embedder` n'utilise que `transformers` (pas de `sentence_transformers`). Les fichiers sont vérifiés par `missing_files()` avant tout chargement. `load()` importe `torch` et `transformers` à la demande, charge le tokenizer et le modèle avec `local_files_only=True`, place le modèle sur le périphérique demandé ou sur CUDA quand il est disponible, et enregistre la dimension d'après la configuration du modèle (aussi lue dans `config.json` avant le chargement, pour l'état de l'index). Les textes reçoivent le préfixe `passage: ` ou `query: `, sont tokenisés sur 512 jetons au plus par lots de 32, moyennés sur le masque d'attention et normalisés L2. L'encodage prend un verrou, si bien que des recherches concurrentes et une synchronisation ne s'entrelacent pas sur le modèle. `load_error` garde le dernier échec pour l'état de l'index.

## Intégration au lanceur

Le service est enregistré dans `_lib/launcher_engine.py` sous la clé `docs` : `backend_module` `backend.main:app`, `frontend_dir` et `base_frontend_port` à `None`, port de backend de base 8068, les variables `DOCS_ASSISTANT_WORKSPACE` et `DOCS_ASSISTANT_USER`, et les variables de mode hors ligne et de télémétrie dans `extra_env`. Faute de frontend, le lanceur force le mode backend seul et imprime `[config] frontend = none`, que VisionNexus n'accepte que pour les ressources de calcul. La liste des sous-dossiers de workspace pour `docs` est vide : le service crée lui-même son `index.sqlite`.

## Pont avec l'app de bureau

L'onglet **Demander a la doc** n'atteint jamais le service. `desktop/src/main.ts` garde un descripteur par ressource de calcul avec son état (`off`, `starting`, `ready`, `stopping`, `error`), sa cible et son port, et expose `cv:docs-search`, `cv:docs-index-status`, `cv:docs-sync` et les canaux de démarrage et d'arrêt. Une recherche est validée selon les mêmes limites que le service (dont `prefer`, `auto` par défaut, et `uiLang`, `en` par défaut, envoyé au service sous le nom `ui_lang`), transmise à `POST /search` sur `127.0.0.1:<port>` avec un délai de 10 secondes, et la réponse est convertie de façon défensive (champs inconnus retirés, chaînes tronquées, indices vérifiés) pour qu'une réponse mal formée ne puisse pas casser la page. La progression de l'indexation vient d'une interrogation de `GET /index/status` toutes les 1,5 secondes pendant une synchronisation ou tant que le modèle se charge, et toutes les 15 secondes sinon. La fenêtre utilise le même état pour répéter une recherche par mots-clés seuls dès que `model_loaded` passe à vrai. Les échecs du lanceur sont stockés avec une clé i18n et ses paramètres, pour que la fenêtre les affiche dans sa langue, avec les deux dernières lignes de la sortie du lanceur quand le port n'a jamais été annoncé ou que le processus s'est arrêté ; ce texte brut n'est pas traduit. Les contrats sont dans la [référence API](api-reference.fr.md) et, pour le côté IPC, dans la [référence API](../../docs/api-reference.fr.md#canaux-de-la-fenêtre-documentation) de VisionNexus.

## Évaluation : questions de référence et questions typées

`tests/golden.json` contient des questions de référence avec la section qui doit répondre à chacune (`app`, `doc`, `heading_idx`, un extrait du titre anglais). Chacune a `q_lang` et `search_lang` ; quand ils diffèrent, la question est inter-langues. `tests/test_golden.py` vérifie, sans modèle, que chaque section attendue existe toujours au même numéro de titre dans les deux langues. `scripts/evaluate.py` mesure la qualité avec le vrai modèle : il copie la documentation dans un dossier temporaire, construit l'index, et affiche top-1, top-3 et top-5 pour la recherche hybride, vectorielle seule et par mots-clés seule, globalement et par langue, public et inter-langues, plus le temps de construction, le temps de resynchronisation et la latence. Un résultat est correct quand le passage renvoyé couvre le titre attendu, quelle que soit la partie d'une longue section. `--verbose` liste les questions non classées en premier. Quand une question échoue, le remède est en général de donner à la section un titre qui nomme son sujet et une première phrase qui dit de quoi elle parle, pas de changer le classement.

`tests/typed_questions.json` et `scripts/evaluate_typed.py` la complètent avec un critère plus souple, plus proche de ce que les utilisateurs tapent. Chaque question a une catégorie (`howto`, `trouble`, `concept`, `dev`, `kw` pour les mots-clés, `typo`, `exact` pour les identifiants exacts, ou `oos` pour une question hors sujet sans bonne réponse), sa langue, les identifiants d'app acceptés et les types de page acceptés (`null` signifie n'importe lequel). Un premier résultat est acceptable quand son app et son type de page figurent dans ces listes, quelle que soit la section. Les questions sont réparties en deux jeux : `diagnostic`, utilisé pour comprendre les échecs, et `validation`, un jeu mis de côté qui n'est pas examiné question par question pendant le réglage du classement, et qui montre donc si un changement se généralise. Lancez-le avec le vrai modèle :

```text
python scripts/evaluate_typed.py [--set diagnostic|validation|all] [--verbose] [--model <id>]
```

Pour chaque jeu, il affiche top-1 et top-3 par mode de langue (`both`, le défaut ; `same`, le filtre est la langue de la question ; `cross`, le filtre est l'autre langue), puis pour les méthodes vectorielle seule et par mots-clés seule, le top-1 par catégorie, et la séparation de la confiance : combien de questions réelles et combien de questions hors sujet reçoivent une confiance faible. `--verbose` liste les questions dont le premier résultat n'est pas acceptable, avec la page renvoyée. `tests/test_rerank.py` couvre les règles, la détection de langue, `relevance()`, `confidence()` et la migration du schéma sans modèle.

## Invariants à ne pas casser

- Le chunker doit être déterministe et indépendant du modèle, et son `heading_idx` doit égaler la règle `h-<n>` du viewer et du lint.
- Les deux fichiers de langue d'une page doivent garder la même suite de titres, sinon les liens entre jumeaux et la déduplication par langue cassent.
- Un passage n'existe jamais sans sa ligne FTS, et les lignes d'un fichier sont remplacées dans une seule transaction.
- Les lecteurs n'utilisent qu'un `Snapshot` immuable ; il est remplacé d'un bloc.
- Rien n'est téléchargé à l'exécution ; un problème de modèle dégrade vers la recherche par mots-clés et jamais vers une réponse d'erreur.
- Changer le modèle ou la version du schéma rend l'index de départ inutilisable, et changer les paramètres du chunker ou le texte indexé (comme le nom de l'app) le rend périmé : reconstruisez-le avec `scripts/build_seed.py`.
- Les règles de rang restent légères : elles nuancent l'ordre et ne retirent jamais un résultat. Un changement de ces règles, ou des bornes de cosinus calibrées d'un modèle, se vérifie avec `scripts/evaluate.py` et avec le jeu `validation` de `scripts/evaluate_typed.py`.
