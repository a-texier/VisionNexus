---
app: dvc
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [fastapi, subprocess, git, cli dvc, liaison cache, trailers lineage, sse]
sources: [DVC_App/backend/main.py, DVC_App/backend/config.py, DVC_App/backend/core/dvc_runner.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/sync.py, DVC_App/backend/api/commits.py, DVC_App/backend/api/datasets.py, Orchestrator_App/backend/api/graphs.py, DVC_App/frontend/src/pages/LineagePage.tsx]
---

# Architecture

## Vue d'ensemble des composants de DVC App

DVC App est un backend FastAPI qui enveloppe les outils en ligne de commande `git` et `dvc` dans des subprocess, transformant leur sortie texte et JSON en reponses structurees, plus un frontend Vite/React. Il n'a aucune base de donnees propre : le repository Git + DVC a `DVC_REPO_PATH` est toute la source de verite, et chaque lecture ré-execute la commande `git`/`dvc` correspondante contre lui plutot que de mettre en cache un etat dans le processus backend.

Comme Optuna App, DVC App expose un routeur `orchestrator.py` et participe reellement a des runs de pipeline, mais pas comme une etape de pipeline lineaire : `graph_runner.py` traite un type de noeud `dvc` comme generant zero etape de pipeline (`return []`), comme `mlflow`. C'est un hub, pas une arete : le propre endpoint de commit de l'Orchestrator appelle le `POST /api/orchestrator/commit` de cette app a la demande depuis l'UI du noeud DVC, pas automatiquement a un point fixe du graphe.

## Le wrapper subprocess : `_run()` et le contournement du PATH pour `dvc`

`backend/core/dvc_runner.py::_run()` est le seul point de passage par lequel chaque fonction backend appelle `git` ou `dvc` : il prend une liste d'arguments, substitue `sys.executable -m dvc` a un argument `dvc` nu en tete (voir *Invariants*, plus bas), execute `subprocess.run(..., cwd=DVC_REPO_PATH, capture_output=True, text=True, encoding="utf-8")`, et leve `RuntimeError(stderr)` sur un code de sortie non nul sauf si `check=False` a ete passe. Chaque fonction de plus haut niveau dans ce fichier (`get_status`, `get_git_log`, `get_diff`, `checkout`, `list_tracked_files`, `get_remotes`, `add_remote`, `get_disk_usage`) est une fine couche d'analyse au-dessus d'un ou plusieurs appels `_run()`, aucune n'ayant d'etat entre les appels.

`repo_exists()` verifie a la fois un sous-dossier `.git` et `.dvc` sous `DVC_REPO_PATH` ; chaque fonction au niveau route qui touche le repository l'appelle d'abord et leve une 503 "Repo DVC non trouvé" si faux, plutot que de laisser un appel `git`/`dvc` contre un repository inexistant echouer avec une erreur moins lisible.

## Creation de commit et trailers de lineage (orchestrator.py)

`POST /api/orchestrator/commit` (`backend/api/orchestrator.py::commit_data()`) est le seul endpoint qui cree un commit, et il est concu pour etre sur a appeler de facon repetee avec la meme selection d'artefacts ou une selection differente :

1. Il verifie d'abord que le repository est un *vrai* repository Git, pas seulement que `.git` existe : `git rev-parse --is-inside-work-tree` attrape un dossier `.git` partiellement supprime (objets presents, `HEAD`/`refs` manquants) qui passerait sinon une verification d'existence naive puis ferait echouer silencieusement chaque commit suivant. Un `.git` casse est supprime et re-initialise plutot que laisse a echouer encore.
2. Pour chaque type d'artefact demande (`dataset_path`, `model_path`, `annotations_path`, `metrics_path`), il copie la source dans `<sub>/<nom>` du repository, en hardlinkant chaque fichier (`os.link`, avec repli sur `copy2` entre volumes) plutot qu'en copiant, pour qu'avec le cache aussi en mode liens, la source, la copie de travail et le cache finissent par partager le meme inode, puis execute `dvc add` dessus. Une source `.zip` (format d'export d'Annotation App) est auto-extraite d'abord.
3. `body.graph_json` et `body.params_json`, quand presents, sont ecrits directement comme fichiers JSON bruts sous `graphs/` et `params/` et `git add`-es, jamais passes par `dvc add` : ce sont de petits fichiers destines a etre diffables par un humain dans l'historique Git.
4. Le message de commit est construit depuis `body.message` plus un bloc de trailers (`Run-Id`, `Graph-Id`, `Graph-Name`, `Parent-Run`, `Dataset`, `mAP50`, une ligne `MLflow-Run` par run correspondant) assemble par l'*appelant*, `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()` : cet endpoint lui-meme ne connait rien des runs, graphes ou MLflow ; il n'accepte qu'une chaine `message` deja formatee.
5. Avant de commiter, il diffe `git status --porcelain` ; si vide, il retourne `{"ok": true, "skipped": true, ...}` sans creer de commit vide, un no-op delibere, pas un chemin d'erreur.

## Analyser les trailers de lineage en sens inverse (dvc_runner.py)

`get_git_log()` lit l'historique avec un format `git log` personnalise qui ouvre chaque commit avec un Record Separator ASCII, separe les champs avec un Unit Separator, et ajoute `%(trailers:unfold,separator=<GS>)`, choisi parce que les valeurs de trailer ne contiennent jamais de saut de ligne, rendant ce format immune aux bugs d'analyse ligne par ligne d'une approche naive face a des sauts de ligne embarques. `_parse_trailers()` decoupe sur le Group Separator et met en minuscule chaque paire `Cle: Valeur` dans la forme `CommitLineage` que le frontend attend (`run_id`, `graph_id`, `graph_name`, `dataset`, `map50`, `mlflow_runs: []`, `parent_run_id`). Quand les trailers d'un commit nomment un `graph_id` mais pas de `graph_name`, `get_git_log()` fait une recherche supplementaire dans `graphs/<graph_id>.json` (ecrit par l'etape 3 ci-dessus, quand ce commit a aussi versionne un instantane de graphe) pour recuperer un nom lisible.

## Liaison du cache, usage disque et remotes

`configure_cache_links()` fixe `dvc config cache.type reflink,hardlink,copy` (DVC essaie chacun dans l'ordre, repliant sur une vraie copie seulement si aucun type de lien n'est disponible sur le systeme de fichiers) et `cache.protected true` (les entrees de cache liees deviennent en lecture seule, puisqu'un inode partage ne doit jamais etre modifie par l'un de ses liens), applique de facon idempotente a chaque commit qui touche DVC, donc cela auto-repare aussi un repository qui date d'avant ce reglage. `relink_cache()` ré-execute `dvc checkout --relink` pour convertir retroactivement un dossier de travail deja copie en liens, pour les repositories qui avaient des fichiers ajoutes avant que la liaison soit configuree. `get_disk_usage()` calcule les tailles reelles en octets en parcourant `.dvc/cache` et `datasets/`+`models/` avec `Path.rglob`, ce qui est une operation genuinement lente, a la demande pour les gros repositories, deliberement pas executee automatiquement, seulement depuis le bouton explicite de la page Sync.

`get_remotes()` n'appelle pas `dvc remote list` ; il parse directement `.dvc/config` et `.dvc/config.local` avec une regex, ce qui est plus robuste face au quoting de chemin Windows et au formatage tab/espace incoherent que l'analyse de la sortie CLI. `add_remote()` est le seul chemin d'ecriture ici qui touche aussi le systeme de fichiers directement (creant une destination de dossier local) avant d'appeler `dvc remote add -f`.

## Diffusion push/pull (sync.py)

`POST /api/push` et `POST /api/pull` retournent une `StreamingResponse` sur `_run_and_stream()`, un generateur async qui lance `dvc push`/`dvc pull` avec `asyncio.create_subprocess_exec` (pas le `_run()` synchrone utilise ailleurs, puisque ceci doit diffuser la sortie ligne par ligne au fur et a mesure plutot que d'attendre la fin) et emet un evenement SSE `log` par ligne de stdout/stderr combines. Il verifie en amont `get_remotes()` avant meme de demarrer le subprocess, emettant un seul evenement `error` clair plutot que de laisser `dvc` echouer avec un message moins lisible quand aucun remote n'existe.

## Structure du frontend et le graphe Lineage

`frontend/src/App.tsx` est une disposition a barre laterale unique avec sept routes : `/` et `/lineage` (`LineagePage`), `/datasets` (`DatasetsPage`, accessible mais absente de la barre laterale), `/history` (`HistoryPage`, accessible mais absente de la barre laterale, liee depuis le panneau de detail de Lineage), `/diff` (`DiffPage`), `/sync` (`SyncPage`) et `/doc` (`DocPage`). `api/client.ts` contient chaque appel type vers le propre backend de cette app ; `LineagePage.tsx` appelle en plus l'Orchestrator directement via `axios` sur `/orchestrator-api/lineage` et `/orchestrator-api/apps`.

`LineagePage.tsx` enveloppe son graphe dans un `LineageErrorBoundary`, une error boundary React (inhabituelle parmi les pages Lineage de la suite), puisqu'un trailer malforme ou une forme de noeud inattendue depuis le payload canonique de l'Orchestrator ferait sinon planter toute la page plutot que de degrader vers un message d'erreur. `build()` fusionne le payload `{nodes, edges}` de l'Orchestrator avec le propre `commitsAPI.list(200)` de cette app (associe aux runs via leur trailer `lineage.run_id`, par `commitByRun`) pour attacher un noeud de version et ses objets suivis sur l'image de chaque run.

## Invariants a ne pas casser

- **Ne jamais appeler l'executable `dvc` nu.** `core/dvc_runner.py::_run()` et `api/sync.py::_dvc_args()` reecrivent tous deux un argument `dvc` en tete vers `sys.executable -m dvc`, car le backend est lance sans le dossier `Scripts/`/`bin/` de l'environnement conda dans son `PATH`. Revenir sur l'une ou l'autre substitution reintroduit des echecs "commande introuvable" identiques a ceux documentes pour le propre correctif analogue de MLflow App.
- **La liaison du cache doit rester idempotente et sure a re-appliquer.** `configure_cache_links()` tourne a chaque commit qui touche DVC precisement pour qu'un repository soit auto-reparant ; elle ne doit jamais supposer qu'elle tourne exactement une fois.
- **Les trailers de lineage sont ecrits une fois, par l'appelant, jamais reconstruits.** `commit_data()` accepte une chaine `message` deja construite ; elle ne doit pas commencer a deviner ou synthetiser des valeurs de trailer elle-meme, et l'analyseur de trailers de `dvc_runner.py` ne doit pas masquer un trailer absent avec une valeur par defaut, puisque [Concepts](concepts.fr.md) documente cette absence comme significative.
- **Un `git status --porcelain` vide doit court-circuiter vers un resultat saute, non erreur.** Traiter "rien a commiter" comme un echec rendrait le noeud DVC de l'Orchestrator inutilisable pour le cas courant de relancer une action de commit sur un artefact deja versionne.
- **L'error boundary de la page Lineage doit rester en place.** La retirer reintroduit un risque de plantage de page entiere depuis toute forme de payload Orchestrator que cette app n'a pas encore ete mise a jour pour gerer.
