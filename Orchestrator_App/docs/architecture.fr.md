---
app: orchestrator
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [graph runner, pipeline runner, sse, ports, insights, lineage, plans, react flow]
sources: [Orchestrator_App/backend/config.py, Orchestrator_App/backend/main.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/core/pipeline_runner.py, Orchestrator_App/backend/core/graph_store.py, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/backend/core/proxy_client.py, Orchestrator_App/backend/core/insights.py, Orchestrator_App/backend/core/run_manifest.py, Orchestrator_App/backend/api/lineage.py, Orchestrator_App/backend/core/plan_store.py, Orchestrator_App/backend/core/plan_runner.py, Orchestrator_App/frontend/src/pages/SandgraphPage.tsx, Orchestrator_App/frontend/src/nodes/ports.ts, Orchestrator_App/frontend/src/api/client.ts]
---

# Architecture

## Vue d'ensemble des composants d'Orchestrator App

Orchestrator App est une application a deux etages : un backend FastAPI qui convertit un graphe visuel en pipeline executable et le pilote, et un frontend React construit autour de `@xyflow/react` (l'editeur Sandgraph).

```text
Frontend (React 18 + TypeScript + Vite + @xyflow/react + TanStack Query)
  |-- HTTP /api (axios, client type)  --+
  |-- SSE /api/graphs/{id}/run/{run}/stream (fetch brut, contourne axios) --+--> Proxy Vite --> Backend FastAPI
  `-- liens profonds vers les frontends des sous-applications (Annotation, DVC, MLflow, ...)

Backend (FastAPI, un seul worker uvicorn, aucune couche de persistance hors fichiers JSON)
  |-- api/ : un routeur par domaine (graphs, launcher_api, insights, lineage, plans, engines, ...)
  |-- core/ : graph_runner (graphe -> pipeline), pipeline_runner (executeur DAG async),
  |           graph_store / pipeline_store / plan_store / experiment_store / activity_store (persistance JSON),
  |           app_launcher (lance les processus des sous-applications), proxy_client (appels HTTP aux sous-applications),
  |           insights.py / run_manifest.py (generation du Run Insight et index canonique du run)
  `-- workspace sur disque : graphs/experiments.json, pipelines/*.json, insights/, runs/, plans/, activity.json
```

Le backend ne touche jamais a la propre base de donnees d'une sous-application ; il n'appelle que son API HTTP (`proxy_client`) et scanne deux dossiers fixes du workspace (`explorer_{user}/subsets/`, `annotation_{user}/exports/`) pour decouvrir les sorties existantes du mode FREE. L'etat de run qui doit survivre a une reprise (le moteur d'execution du DAG) vit uniquement dans la memoire du backend (`_active_runs`), jamais sur disque ; tout le reste (graphes, pipelines, plans, activite, insights) est du JSON simple ecrit dans le workspace.

## Démarrage de l'application backend

`backend/main.py` construit l'application FastAPI et monte onze routeurs dans un ordre precis : `health`, `pipelines`, `activity`, `settings`, `experiments`, `graphs`, `launcher_api`, `insights`, `lineage`, `plans`, `engines`. L'ordre compte pour `graphs` : ses routes `/meta/*` doivent se resoudre avant la route parametree `/{graph_id}`.

Le gestionnaire de lifespan initialise le journal HTML de debug (`WORKSPACE/debug.html`), puis appelle `app_launcher.repatch_app_urls()`, qui lit `launcher_state.json` et reinjecte l'URL reelle de chaque session de sous-application dont le port ecoute reellement dans `APP_URLS` / `APP_FRONTEND_URLS`. C'est necessaire apres un reload d'uvicorn : sans cela, `APP_URLS` reviendrait a ses ports par defaut et le proxy perdrait la trace de chaque sous-application deja lancee.

Le CORS, le filtrage du log d'acces (les endpoints d'interrogation comme `GET /api/apps` et `GET /api/graphs` sont retires du log d'acces uvicorn pour le garder lisible sur une longue session) et les deux endpoints directs de workspace (`/api/workspace/users`, `/api/workspace/history`, `/api/workspace/open`) sont aussi definis directement dans `main.py`.

## Types de nœuds et leurs étapes de pipeline

Les ids d'etape suivent la convention `{node_id}__{action}` (double underscore) ; `graph_runner._steps_for_node()` est la seule fonction qui traduit un nœud en une liste d'etapes.

### dataset_source

- `{id}__load` -> `POST Dataset_Explorer_App /api/orchestrator/load-dataset`. La progression live interroge `GET /api/datasets`, appareillee par nom jusqu'a ce que le vrai id soit connu.
- `{id}__embed` -> `POST Dataset_Explorer_App /api/orchestrator/start-embed`, referencant le `dataset_id` renvoye par `load` (jamais juste le nom, car deux datasets peuvent partager un nom).

### explorer (LOCKED seulement ; un nœud FREE ne produit aucune etape)

- Mode manuel (`full_auto=false`) : un point d'arret humain `manual_create`, puis `{id}__export`.
- Mode automatique : `{id}__verifyembed` (point d'arret humain) -> `{id}__subset` (`POST /api/orchestrator/create-subset`) -> `{id}__validatesubset` (point d'arret humain) -> `{id}__export` (`POST /api/orchestrator/export-subset`).
- Apres un export reussi, le frontend rescanne le workspace et rafraichit `available_subsets` sur chaque nœud FREE.

### annotation (LOCKED seulement ; un nœud FREE ne produit aucune etape)

- `{id}__project` -> `POST Annotation_App /api/orchestrator/create-project`, avec `import_path` defini quand un ancetre `dataset_source` fournit un dossier directement (import zero-copie).
- Automatique (`full_auto=true`) : `{id}__auto_annotate`, suivi optionnellement d'un point d'arret humain `review` si `review_before_export` est coche.
- Manuel : un point d'arret humain `annotate`.
- `{id}__exportyolo` (`POST /api/orchestrator/export-yolo`, `reuse_if_exists` defini a l'export choisi au point d'arret manuel) et `{id}__exportver` (`POST /api/orchestrator/export-ver`) s'executent toujours tous les deux apres le point d'arret, pour que les deux formats existent sur disque quel que soit le port aval reellement connecte.

### dvc / mlflow

Aucun des deux types ne genere d'etape : les deux sont de purs observateurs sans aucun port (`NODE_PORTS.dvc` et `.mlflow` valent `{inputs: [], outputs: []}`). `dvc-app` et `mlflow-app` sont quand meme auto-lancees des qu'un nœud de ce type existe dans le graphe (`_needed_app_keys`), independamment de toute arete.

### optuna

- Automatique : `{id}__hpo` (`POST optuna-app /api/orchestrator/hpo`), avec `dataset_path` derive de l'Annotation connectee (directement, ou en remontant les ancetres) et un bloc `trace` pour le tag MLflow.
- Manuel : un point d'arret humain `hpo`.

### training

- Manuel : un point d'arret humain `train`.
- Automatique : `{id}__train` (`POST Training_App /api/orchestrator/train`). `dataset_path` vient de l'export YOLO de l'Annotation connectee ; `model_weights` d'un nœud `model` connecte (fine-tuning) ; `optuna_best` d'un nœud Optuna connecte, sous forme de placeholder `${STEP:...}` quand l'etude tourne automatiquement, ou fusionne au moment de la construction quand l'etude etait manuelle. `hyperparams` fusionne le dictionnaire propre au moteur sur le nœud avec un ensemble fixe de cles plates historiques conservees pour les anciens graphes (`basic_lr_per_img`, `mosaic_prob`, ...).

### inference

- FREE (aucune entree) : un point d'arret humain qui ouvre simplement Inference App.
- LOCKED, manuel (`full_auto=false`) : un point d'arret humain pour une session SOT/MOT interactive.
- LOCKED, automatique, `task=detection` : `{id}__evaluate` (`kind=detection`), un `model.val()` standard sur le split choisi du `data.yaml` de l'Annotation connectee (en preferant le `data.yaml` exact qu'un Training connecte a deja dezippe, puisque l'export brut est un `.zip`).
- LOCKED, automatique, `task=tracking` (defaut) : `{id}__infer`, YOLO seul ou avec ByteTrack, contre une sequence et une verite terrain optionnelle (`.ver` prefere, un split YOLO en repli).

## Validation de la lignée de modèle (moteur et taille)

Les nœuds `model`, `training`, `optuna` et `inference` portent un champ `engine` (vide signifie le moteur par defaut, `yolox`) ; leurs panneaux de configuration sont construits depuis `GET /api/engines`, qui proxifie `/api/capabilities` de Training_App et retombe sur le registre local de plugins quand Training_App ne tourne pas. Aucun nom de moteur n'est jamais code en dur dans le frontend : sans aucun plugin installe, seul YOLOX existe et aucun selecteur de moteur n'est meme affiche.

Avant de construire le pipeline, `_model_lineage_spec()` parcourt chaque nœud atteignable dans une lignee de modele (un nœud `training`, `optuna`, `inference` plus ses ancetres) et leve `GraphConfigError` (remontee en HTTP 400, jamais un echec en cours de run) si deux nœuds de la meme lignee declarent des moteurs differents, ou des tailles differentes des qu'une taille est definie quelque part dans la chaine. Un nœud `model` connecte impose son moteur et sa taille au `training` aval, car un checkpoint ne se recharge qu'avec exactement le moteur et la taille qui l'ont produit.

## Ports typés des nœuds

`frontend/src/nodes/ports.ts` (`NODE_PORTS`) a remplace un ancien dictionnaire par nœud `type cible -> types source acceptes` par un schema par port : chaque nœud declare des `inputs` (a gauche) et des `outputs` (a droite) types, chacun avec un `PortType` qui fixe sa couleur (`dataset`, `subset`, `yolo`, `ver`, `model`, `params`, `metrics`, `any`).

Cela permet a `training` d'exposer trois entrees typees independamment sur le meme nœud (`dataset` depuis `annotation` seulement, `model` depuis `model` seulement, `hpo` depuis `optuna` seulement), et permet a `annotation` d'exposer deux sorties typees (`out_yolo`, `out_ver`) pour que `resolveHandles(srcType, tgtType)` choisisse automatiquement la bonne paire de handles quand une arete est tracee. `exclusiveWith` empeche deux ports du meme nœud d'etre jamais connectes ensemble (`sequence` et `dataset_yolo` d'`inference`) ; `requiresPeer` ne produit qu'un avertissement non bloquant (`gt` d'`inference` sans `sequence`) ; `required` bloque sauvegarder/lancer sauf si le nœud est en mode FREE. `compatibleNodeTypes(fromType, handleType, handleId)` alimente le popup de creation par glissement affiche quand un fil est relache sur un canvas vide.

Rendu : `NodePorts.tsx` dessine la bande d'entrees/sorties en bas d'une carte de nœud ; un port ne s'allume que quand son propre id de handle specifique a une arete, jamais juste parce que le nœud a une arete entrante sur un autre port (un bug corrige : sur `inference`, `dataset_yolo` et `gt` acceptent tous deux une source `annotation`, donc une verification naive par type aurait allume `gt` des que `dataset_yolo` seul etait connecte). `OrthogonalEdge.tsx` est le seul type d'arete utilise sur le canvas ; son trace est calcule par le module pur `routing.ts` (aucune dependance React ou xyflow), qui detecte les nœuds a contourner et choisit le mode `direct`, `zbend` ou `corridor`, en empilant les couloirs paralleles. Un trace se recalcule automatiquement a chaque deplacement de nœud jusqu'a ce qu'un point de passage soit ajoute (double-clic sur l'arete), ce qui bascule cette arete en `routeMode: 'manual'`.

## Architecture SSE

1. `run_graph()` cree un `RunState` dans `pipeline_runner._active_runs` (en memoire, indexe par `run_id`).
2. L'executeur ajoute chaque evenement a `state.events`.
3. `stream_events(run_id)` est un generateur async qui rejoue toute la liste d'evenements depuis le curseur 0 a chaque connexion, pour qu'un client qui se reconnecte ne manque jamais l'historique.
4. `event_generator()` de `graphs.py` consomme ce flux, met a jour `graph_store` (statut d'execution du nœud, apercu `next_label`, regeneration progressive de l'Insight apres une etape significative) et transmet chaque evenement en SSE au client. Il ne sort de la boucle que sur `type == "done"` ; sortir sur un evenement historique "waiting" pendant une relecture apres une reprise etait la cause racine d'un bug de boucle infinie ou le meme point d'arret reapparaissait sans cesse (corrige, voir la page Depannage). Il ne met le statut du graphe a `"waiting"` qu'une fois que le flux lui-meme se termine sans evenement `"done"`, jamais pendant une relecture, pour qu'un historique SSE ne puisse jamais rebasculer un graphe termine en attente.

### Flux du point d'arrêt humain

`_run_step()` met `state.status = "waiting"` et emet un evenement `waiting`, puis retourne sans toucher aux etapes suivantes ; `_execute()` voit `status == "waiting"` et retourne sans lever d'erreur. Le frontend affiche le bandeau "Intervention requise". Cliquer **Terminé -> Continuer** appelle `POST /api/graphs/{id}/resume`, qui marque l'etape en attente `success`, reconstruit le pipeline depuis l'etat courant du graphe (recuperant toute edition faite pendant la pause, y compris un `export_name`/`subset_name` fraichement choisi), et appelle `_execute()` a nouveau. Le frontend reconnecte le flux SSE, qui rejoue tous les evenements depuis le debut.

### Repli en cas de redémarrage serveur

`run_in_memory(run_id)` verifie si le run existe encore dans `_active_runs`. Si une reprise cible un run disparu (le backend a redemarre pendant que le graphe etait en pause), `reset_graph_execution()` s'execute et l'endpoint renvoie un HTTP 410, disant au frontend de se rafraichir plutot que de retenter silencieusement.

### Repli de resynchronisation par interrogation

`_sync_graph_from_run()` s'execute a chaque appel de `list_graphs()` et `get_graph()` pour un graphe avec un `active_run_id`. C'est le filet de securite pour le cas ou le flux SSE ne se connecte jamais avec succes du tout (une erreur transitoire au tout premier essai n'est pas retentee par le client `fetch()` brut du frontend, contrairement a un `EventSource` de navigateur) : il rederive le statut d'execution de chaque nœud directement depuis le `RunState` en memoire de `pipeline_runner`, qui reste la seule source de verite quel que soit le client SSE actuellement attache. Il finalise aussi un run dont le `RunState` a disparu (backend redemarre en cours de run) comme `stopped` plutot que de laisser le graphe `running` pour toujours, et ne valide un statut de graphe `waiting` qu'une fois que le graphe fraichement relu le confirme, pour eviter que le statut clignote entre `waiting` et `running` sur des interrogations successives.

## Flux d'auto-lancement

1. `run_graph()` appelle `_preflight_check()`, qui ne fait confiance qu'aux sessions enregistrees par ce processus Orchestrator (`app_launcher._sessions`) ; une session appartenant a un autre processus sur le meme port par defaut n'est jamais reutilisee, et une URL placeholder (`http://localhost:1`) est posee pour toute application a lancer, pour qu'une sonde de disponibilite ulterieure ne puisse pas reussir faussement contre un processus etranger.
2. Les applications necessaires (`_needed_app_keys()`, qui saute les nœuds FREE sauf `inference`, et inclut toujours `mlflow-app`/`dvc-app` quand leur type de nœud est present) sont lancees **sequentiellement**, dans l'ordre ou le tri topologique du pipeline en a reellement besoin (`_ordered_app_keys()`), en tache de fond. Lancer plusieurs applications en parallele (chacune un uvicorn complet plus un serveur de dev Vite, certaines chargeant des modeles GPU) sature suffisamment le CPU et le disque pour qu'aucune ne reponde avant que la premiere etape du pipeline n'echoue par timeout.
3. Chaque etape appelle quand meme `_wait_for_app(step.app, max_wait=240s)` avant de s'executer, independamment de la sequence de lancement en arriere-plan, et emet un ping de progression environ toutes les douze secondes pour qu'un long demarrage a froid soit visiblement toujours actif plutot que silencieux.
4. `_auto_launch_and_wait()` traite une session dont le port ecoute mais dont `/health` reste muet pendant environ quarante secondes comme une instance figee (un processus perime d'un run anterieur, ou un worker uvicorn zombie apres un reload) et la tue puis la relance, plutot que d'interroger un processus mort pendant le timeout complet de quatre minutes.

## Backend, fichier par fichier

```
backend/
  config.py               WORKSPACE, CURRENT_USER (resolu, jamais un placeholder), APP_URLS, ports, CORS
  main.py                 App FastAPI, lifespan, montage des routeurs, endpoints directs de workspace
  api/
    graphs.py              CRUD sandgraph, run/resume/stop, flux SSE, fork-run, track-mlops,
                            scan workspace-outputs, hub d'artefacts, dvc-commit, webhook annotation-exported
    launcher_api.py         lancement/arret manuel des sous-applications (page Applications)
    insights.py             Run Insight : liste, detail, fichiers de plot, generation a la demande
    lineage.py               graphe de lineage cross-experiences (arbre de fork, instantanes de comparaison)
    plans.py                 Plans d'experiences : CRUD + lancement + statut
    engines.py               GET /api/engines, proxifie depuis Training_App ou le registre local de plugins
    pipelines.py, experiments.py, activity.py, health.py, settings.py   routeurs historiques/secondaires
  core/
    graph_runner.py          traduction graphe -> PipelineDef, validation de lignee de modele, auto-lancement
    pipeline_runner.py       executeur DAG async : ordonnancement depends_on, human_gate, emission d'evenements SSE,
                              resolution des placeholders runtime ${STEP:id.field} et ${RUN_ID}
    graph_store.py           persistance graphs/experiments.json, mlops_status(), etat d'execution des nœuds
    app_launcher.py          lance/arrete les processus des sous-applications, registre de ports partage, etat de session
    proxy_client.py          client HTTP async vers les sous-applications (ping de sante, requete generique)
    pipeline_store.py, experiment_store.py, activity_store.py   persistance JSON secondaire
    insights.py               collecte + generation d'un Run Insight (plots, markdown, metriques stables)
    run_manifest.py           index canonique par run des sorties (WORKSPACE/runs/{run_id}/manifest.json)
    plan_store.py, plan_runner.py   persistance des Plans d'experiences et moteur d'execution pilote par HTTP
  utils/
    native_share.py           traduction chemin UNC Windows -> chemin POSIX, appliquee a la construction du graphe
    debug_logger.py           journal developpeur colorise WORKSPACE/debug.html
  tools/
    migrate_run_manifests.py  reparation hors ligne, en une fois, des anciens Insights en manifestes de run stricts
```

### `graph_runner.py`

Le cerveau du systeme. `_topo_sort()` (algorithme de Kahn) ordonne les nœuds ; `_is_free_node()` decide FREE contre LOCKED (voir [Concepts](concepts.fr.md#nœuds-free-et-locked)) ; `_steps_for_node()` est le constructeur d'etapes par type decrit ci-dessus. `graph_to_pipeline()` parcourt les nœuds ordonnes, saute les FREE (sauf `inference`, qui recoit quand meme un point d'arret humain), et construit `step_node_map` (`step_id -> node_id`), utilise par le frontend pour colorer les nœuds pendant un run.

Plusieurs fonctions resolvent une valeur depuis un ancetre plutot que de faire confiance au propre champ perime du nœud : `_resolve_yolo_dataset()` tolere un export Annotation nomme differemment de `<projet>-yolo` (un export manuel peut utiliser n'importe quel nom) ; `_annotation_yolo_ref()` / `_annotation_ver_output_ref()` renvoient des placeholders `${STEP:...}` pointant vers le chemin exact qu'une etape amont a reellement produit, resolus seulement au moment de l'execution par `pipeline_runner`, plutot qu'une supposition basee sur un nom faite a la construction ; `_optuna_best_ref()` fait de meme pour les best params du HPO.

`_normalized_data()` execute `native_share.normalize_input_path()` sur chaque champ de `_PATH_FIELDS` (`dataset_path`, `model_path`, `sequence_dir`, `annotation_file`) une fois, ici, avant qu'aucune valeur ne quitte le processus Orchestrator ; chaque sous-application ne voit ensuite jamais qu'un chemin qui a du sens sur sa propre machine.

### `pipeline_runner.py`

`_execute()` calcule la profondeur de chaque etape depuis sa chaine `depends_on`, puis lance un niveau de profondeur a la fois avec `asyncio.gather()`, pour que les etapes independantes du meme niveau tournent en parallele. Un echec d'etape marque tout ce qui en depend (transitivement) comme echoue et le saute, sans toucher les branches sans rapport. `_run_step()` resout les placeholders `${STEP:id.field}` et `${RUN_ID}` dans les params de l'etape juste avant d'appeler la sous-application, une fois que chaque etape amont qu'il pourrait referencer a deja produit sa sortie. Les etapes dont l'endpoint correspond a `_LONG` (`/train`, `/infer`, `/evaluate`, `/hpo`, `/start-embed`, `/load-dataset`, `/auto-annotate`, `/create-project`) recoivent un timeout HTTP de 3600 secondes au lieu des 600 par defaut, et `/hpo` met en plus a l'echelle son propre timeout par `n_trials * (per_trial + 120)` puisqu'un endpoint HPO synchrone doit survivre a chaque essai qu'il lance.

Une etape n'est consideree en echec par l'executeur que si l'appel HTTP lui-meme a echoue au niveau transport, **ou** si le corps de reponse est un contrat JSON `{"ok": false, ...}` de la sous-application ; plusieurs sous-applications (par exemple Optuna sur un `data.yaml` manquant, DVC sur un commit rate) renvoient un HTTP 200 avec un echec metier dans le corps, ce qui ressemblerait sinon a une etape verte et reussie. Un cas special (`hpo_succeeded: false` avec `fallback_to_training_defaults: true`) est marque `warning` plutot que `failed`, pour que l'etape Training dependante tourne quand meme sur ses propres defauts configures tandis que l'echec reste visible.

### `graph_store.py`

Persistance JSON simple dans `graphs/experiments.json`. `mlops_status()` derive (ne stocke jamais) le type d'un graphe : `"mlops"` seulement quand un nœud `mlflow` ET un nœud `dvc` sont presents, `"experimental"` sinon, avec un indicateur `tracking_partial` quand un seul des deux existe. `update_node_exec()` utilise un rang de statut (`idle < running < done/warning < failed < waiting`) pour qu'un statut `waiting` puisse remplacer une sous-etape deja `done` (un nœud multi-etapes comme Annotation passant de `project: done` a `annotate: waiting`), tandis que `running`/`done` sont explicitement autorises a retrograder un nœud `waiting` (reprise apres un point d'arret, ou un nœud demarrant sa sous-etape suivante) ; le statut au niveau du graphe est bascule a `"waiting"` exclusivement par l'`event_generator` SSE, jamais par cette fonction, pour qu'une relecture SSE historique ne puisse jamais declencher le bandeau toute seule.

### `app_launcher.py`

Lance le backend (`uvicorn`, sans `--reload`, car le reloader StatReload de Windows a ete constate parfois orpheliner le port ou bloquer tout l'arbre de lancement) et le frontend (`npm run dev`) de chaque sous-application comme des processus independants, chacun dans son propre groupe de processus pour qu'arreter une sous-application ne touche jamais l'arbre de processus propre d'Orchestrator. L'allocation de ports passe par le meme fichier de verrou partage et le meme registre d'instances (`_lib.launcher_engine`) utilise par toutes les autres applications de la suite, pour que deux utilisateurs ou deux applications lancees au meme moment n'entrent jamais en course pour le meme port. `stop_app()` envoie d'abord un signal propre, attend brievement, puis force le kill, et fait enfin un effort de tuer tout ce qui tient encore les ports de l'application en scannant `netstat`/`lsof`, car un kill base sur le pid seul manque un enfant qui s'est detache de son groupe de processus.

## Run Insight et lineage (Git / DVC / MLflow)

Voir [Concepts](concepts.fr.md#run-insight--ce-quun-run-a-laissé-derrière-lui) et [Concepts](concepts.fr.md#lineage--relier-les-runs-à-travers-tout-le-workspace) pour ce qu'un Insight et le graphe de Lineage signifient. Cette section ne couvre que leur implementation.

`collect(graph_id, run_id)` de `core/insights.py` recupere le statut d'entrainement et l'historique par epoch depuis Training_App, les etudes Optuna dont l'attribut utilisateur `run_id` correspond exactement, les runs MLflow tagues `orch_run_id == run_id`, et les commits DVC dont le trailer correspond, tous via des appels `httpx` directs plutot que `proxy_client` (qui tronque les reponses a 4000 caracteres et cassait auparavant la collecte des longues listes de runs et des historiques par epoch). `_build_lineage()` assemble l'objet lineage et la liste de reproductibilite a sept verifications depuis l'etat reel et courant (jamais un defaut "vert" en cache). `generate()` ecrit trois fichiers par run (`insights.json` le paquet complet, `insights.md` un journal lisible par un humain, `metrics.json` un sous-ensemble stable, trie, sans horodatage, prevu pour etre versionne par DVC sans churner a chaque regeneration) plus des plots matplotlib (courbes d'entrainement, un graphique de "gains" de mAP comparant chaque entrainement au premier, un historique Optuna, une timeline Gantt) et des images d'analyse du moteur d'entrainement recuperees (matrice de confusion, courbes PR/F1, distribution des labels), puis appelle `run_manifest.finalize()`.

`core/run_manifest.py` garde `WORKSPACE/runs/{run_id}/manifest.json`, l'index logique d'un run : les fichiers restent dans le workspace propre de chaque sous-application, mais chaque sortie est explicitement rattachee au `run_id` qui l'a produite (`start()` au lancement, `finalize()` a la fin), ecrit atomiquement (fichier temporaire puis `os.replace`) pour qu'un lecteur ne voie jamais un manifeste a moitie ecrit. Une sortie du run d'un fork ne devient jamais implicitement une sortie du parent ; une entree heritee d'une base de fork est enregistree explicitement comme `{"kind": "fork_base", ...}`.

`get_lineage(include_failed=False)` de `api/lineage.py` construit un seul graphe `{nodes, edges}` a travers tous les graphes du workspace. Types de nœud : `source_dataset` (dedupliqué par chemin et nom), `dataset` (le subset qu'un run precis a reellement extrait, dedupliqué par source, subset, requete et version DVC, jamais par le commit du parent, pour qu'un fork non committe garde sa propre identite), `run`, `model` (dedupliqué par chemin), `stage` (un run MLflow, rattache au run de pipeline qui l'a produit) et `artifact`. Par defaut seuls les runs avec un statut terminal et reussi sont montres (la vue "publiee") ; `include_failed=true` inclut aussi les runs echoues/interrompus (la vue "audit"), avec tout ce qui est masque par defaut liste dans `excluded_runs` plutot que silencieusement supprime. `fork_run()` et `track_mlops()` d'`api/graphs.py` completent ce systeme : forker duplique le graphe et enregistre `forked_from` (commit du parent, dataset, version DVC, mAP50, un instantane complet des parametres pour la vue de divergence) sans declencher aucun pull DVC ; `track_mlops()` injecte de facon idempotente le ou les nœuds `mlflow`/`dvc` manquants comme une paire couplee.

## Plans d'expériences

`core/plan_store.py` persiste les plans en JSON simple dans `WORKSPACE/plans/plans.json` ; `core/plan_runner.py` en execute un comme une tache de fond `asyncio.create_task`, mais n'appelle deliberement aucune fonction Python interne directement. A la place, il rejoue exactement la sequence HTTP qu'une personne effectuerait a la main, contre les propres endpoints `http://127.0.0.1:{BACKEND_PORT}` de l'application : dupliquer le graphe de base, appliquer les surcharges nommees sur des ids de nœuds standard (`v1`, `a1`, `t1`) via `_apply_overrides()` (sautant silencieusement un id de nœud que le graphe de base n'a pas), sauvegarder, lancer, interroger toutes les 3 secondes jusqu'a 40 minutes et reprendre automatiquement tout point d'arret rencontre par le run (un plan ne doit jamais rester bloque a attendre un clic), puis generer l'Insight du run et relire son `dvc_version` / `git_commit` / `map50`. Cette reutilisation signifie que chaque garde-fou existant (validation, auto-lancement, statut pilote par SSE) s'applique a une etape de plan exactement comme il le ferait a un run que vous avez lance a la main. Le commit DVC est deliberement laisse de cote : un plan ne produit que des runs, et versionner est une decision manuelle prise apres coup depuis le propre nœud DVC de chaque run.

## Frontend, fichier par fichier

```
frontend/src/
  api/client.ts             chaque appel API type ; BACKEND_BASE vaut toujours '' (meme origine, via
                             le proxy Vite) pour que le SSE ne devienne jamais un fetch cross-origin
  types/api.ts               miroirs TypeScript des schemas Pydantic du backend
  nodes/
    ports.ts                 schema de ports type (NODE_PORTS) et validation des connexions, voir ci-dessus
    routing.ts                moteur de routage orthogonal pur, aucune dependance React/xyflow
    AppNode.tsx               carte generique pour explorer/annotation/dvc/mlflow/optuna/training/inference
    DatasetNode.tsx, ModelNode.tsx   nœuds d'entree (aucune entree, aucune logique FREE/LOCKED)
    NodePorts.tsx, OrthogonalEdge.tsx   bande de ports visuelle et le type d'arete unique
  components/
    NodeConfigPanel.tsx       formulaires de configuration par type de nœud a droite, panneau d'aide
    UserBadge.tsx              widget utilisateur/workspace du pied de page
    docs/                      markdown.ts, MarkdownDoc.tsx : rend les pages docs/*.md, utilise par GuidePage
  pages/
    SandgraphPage.tsx          l'editeur principal : canvas, barre d'outils, barre du haut, client SSE, annuler/retablir,
                                validateGraph(), propagation automatique des aretes, plateau de sous-etapes live
    ExperimentsPage.tsx        liste des graphes + SANDGRAPH_TEMPLATES
    AppsPage.tsx                tableau de bord de lancement/arret des sous-applications
    ActivityPage.tsx            journal brut d'execution
    MLOpsPage.tsx               barre de sous-onglets (Outlet) pour les routes imbriquees /mlops/*
    InsightsPage.tsx, PlansPage.tsx, LineageGraphPage.tsx, GuidePage.tsx   les sous-pages MLOps
    LibraryPage.tsx, PipelinePage.tsx, DashboardPage.tsx   ancien systeme de pipeline, accessible seulement par URL
    AboutPage.tsx                presentation statique de la plateforme (partiellement perimee, preferer cette documentation)
```

### `SandgraphPage.tsx`

`TOOLBOX_NODES` definit les types de nœuds deplacables et leurs `data` par defaut. Annuler/retablir utilise des piles d'historique adossees a des refs (`historyRef`/`futureRef`) plus des refs miroir (`nodesRef`/`edgesRef`) pour eviter les closures perimees dans des callbacks de longue duree. `validateGraph()` applique les regles de ports de `ports.ts` plus une pre-verification moteur/taille de lignee de modele (miroir du `_model_lineage_spec` du backend, pour qu'un graphe casse soit attrape avant l'aller-retour vers le serveur) et est appelee a la fois par `saveMut` et `runMut`. `_propagateAllEdges()` s'execute a la sauvegarde : il copie les noms le long des aretes typees (nom de dataset dans un Dataset Explorer, nom de subset dans un nom de projet Annotation, etc.), n'ecrasant un champ aval que quand sa source amont a reellement change depuis la derniere propagation (suivi avec un champ marqueur cache), pour qu'un nom edite a la main ne soit jamais silencieusement ecrase tant que sa source reste identique.

Le client SSE ouvre un `fetch()` brut vers `/api/graphs/{id}/run/{run_id}/stream`, lit le corps comme un flux, et distribue chaque ligne `data: ` a `_handleSSEEvent()`, qui met a jour le statut du nœud via `stepNodeMap`, ajoute au panneau de log, et rafraichit `available_subsets`/`available_exports` apres une etape d'export reussie. `refreshWorkspaceOutputs()` injecte aussi `has_input` (rederive fraichement depuis `edges` a chaque appel, jamais persiste) dans chaque nœud explorer/annotation.

### `AppNode.tsx`

Le seul composant de carte generique pour chaque nœud de type application. `isFreeMode` est calcule comme `(type === 'explorer' || 'annotation') && data.has_input === false` ; le badge FREE/LOCKED, la liste cliquable des sorties existantes en mode FREE, et les champs caches dans le panneau developpe dependent tous de ce seul booleen. `has_input` arrive dans `data` depuis `SandgraphPage`, n'est lui-meme jamais persiste (retire avant chaque sauvegarde/lancement), et est la seule source de verite pour la distinction FREE/LOCKED dans tout le frontend.

### `vite.config.ts`

Serveur de dev sur le port defini par `VITE_FRONTEND_PORT` ; proxifie `/api/*` vers `http://localhost:${VITE_BACKEND_PORT}` avec un delai de 300 secondes. Le flux SSE d'execution contourne quand meme la mise en tampon de ce proxy en utilisant une URL relative de meme origine (`BACKEND_BASE = ''`) plutot qu'absolue, ce qui est ce qui compte reellement pour qu'il fonctionne sur une adresse LAN, pas le proxy lui-meme.

## `launcher.py` (racine de l'application)

Analyse `--user` (obligatoire) et `--workspace` (obligatoire), plus `--conda-env`, `--backend-port`, `--frontend-port`, `--backend-only`, `--reload`, `--access-log`. Cree la structure du workspace, alloue les ports sous le verrou partage de toute la suite (`_acquire_lock()` / `Computer_Vision_App/.run/.port_lock`), enregistre l'instance, ecrit les variables d'environnement `ORCHESTRATOR_WORKSPACE` / `ORCHESTRATOR_USER` / ports, puis lance `uvicorn` et (sauf `--backend-only`) `npm run dev` comme processus enfants. Un gestionnaire `SIGINT`/`SIGTERM` desenregistre l'instance et tue proprement les deux arbres de processus a la sortie.

## Scénarios de test de développement

Cinq scenarios exercent le mode FREE/LOCKED et la chaine complete du pipeline de bout en bout ; SC1 a SC4 sont aussi proposes comme templates de la page **Expériences**, et leurs instructions pas a pas vivent dans [Procédures](workflows.fr.md#scénarios-de-test--modes-free-et-locked-de-bout-en-bout). SC5 n'est pilote que via `run_all_scenarios.py`, qui lance une instance Orchestrator isolee par utilisateur de test (chacune avec ses propres instances de sous-applications) et lance SC3 en premier (il produit le subset et l'export d'annotation que SC1/SC2 reutilisent), puis SC4, SC1 et SC2 en parallele.

| Scénario | Objectif | Flux |
|---|---|---|
| SC1 | Mode FREE sans dataset | explorer FREE (subset existant) -> Annotation LOCKED -> DVC |
| SC2 | Mode FREE sur Annotation | Annotation FREE (export existant) -> MLflow -> DVC |
| SC3 | Pipeline semi-automatique complet | Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto, SAM3) -> MLflow -> DVC, avec points d'arret humains a chaque etape critique |
| SC4 | Pipeline entierement manuel | Meme chaine que SC3 avec `full_auto=false` ; l'Orchestrator ne fait qu'observer et connecter |
| SC5 | Entrainement en eventail, HPO et DVC | Dataset -> explorer -> Annotation manuelle -> 3 nœuds Training paralleles avec des hyperparametres distincts -> verification MLflow -> Optuna HPO -> un 4e Training utilisant les best params du HPO -> verification MLflow finale -> DVC |

`t_best` dans SC5 derive son `dataset_path` par un parcours en largeur sur ses ancetres : son parent direct est le nœud Optuna, mais le dataset lui-meme n'existe que sur le nœud Annotation plus haut dans la chaine, ce qui est exactement le comportement de remontee d'ancetres que `_dataset_path_from_ancestors()` implemente dans `graph_runner.py`.

## Invariants à ne pas casser

1. **`has_input` est toujours derive des aretes, jamais persiste.** Le recalculer depuis une valeur stockee au lieu de la liste d'aretes live laisserait un nœud FREE deriver silencieusement de sa connectivite reelle.
2. **Les nœuds FREE ne generent jamais d'etape de pipeline**, sauf `inference`, qui recoit quand meme un point d'arret humain pour ouvrir l'application manuellement. `_needed_app_keys()` et `graph_to_pipeline()` doivent rester d'accord sur cette liste d'exclusion.
3. **Les sorties du mode FREE viennent toujours du scan du systeme de fichiers du workspace**, jamais de demander a une sous-application par HTTP ce qu'elle a produit.
4. **`event_generator()` ne sort de la boucle SSE que sur `type == "done"`**, jamais sur `"waiting"` ; sortir sur un evenement historique "waiting" pendant une relecture reintroduit le bug de boucle infinie de point d'arret.
5. **`update_node_exec()` ne retrograde jamais un nœud de `"done"` vers `"waiting"`** de lui-meme ; seul l'`event_generator` SSE, voyant le flux reellement se terminer a un point d'arret en cours, peut mettre le statut au niveau du graphe a `"waiting"`.
6. **`annotation_imports_path` est toujours calcule depuis la structure du workspace** (`WORKSPACE / f"annotation_{CURRENT_USER}" / "imports"`), jamais via un appel HTTP a Annotation_App, car Annotation peut ne pas encore tourner quand Dataset Explorer a besoin de la valeur.
7. **`APP_URLS` / `APP_FRONTEND_URLS` sont des dicts mutables lus par reference partout.** Copier l'un ou l'autre dict casse le patch live que `graph_runner`/`app_launcher` effectuent quand une sous-application est lancee ou que son URL est repatchee apres un reload.
8. **Un chemin UNC est normalise exactement une fois**, a la construction du graphe dans `graph_runner._normalized_data()`, sur les quatre champs de `_PATH_FIELDS`. Normaliser a nouveau en aval, ou sauter un nouveau champ porteur de chemin ajoute a un nœud, reintroduit des erreurs "chemin introuvable" sur le backend Linux.
9. **`_active_runs` est uniquement en memoire.** Une reprise contre un id de run que le backend ne reconnait pas doit declencher `reset_graph_execution()` et un HTTP 410, jamais un echec silencieux ou un blocage.
10. **Une lignee de modele (`model`/`optuna`/`training`/`inference`) doit partager un moteur et, des qu'un nœud la definit, une taille**, verifie a la fois dans le frontend (`validateGraph`) et le backend (`_model_lineage_spec`) avant qu'aucune etape couteuse ne s'execute.
11. **Les nœuds DVC et MLflow n'ont aucun port du tout** (`NODE_PORTS.dvc`/`.mlflow` sont tous deux vides) ; ils ne doivent jamais etre reintroduits comme une etape consommant un type d'artefact amont precis.
12. **Ne jamais lancer `uvicorn backend.main:app` sans `ORCHESTRATOR_WORKSPACE` et `ORCHESTRATOR_USER` definis** par `launcher.py` ; le backend se resoudrait vers le mauvais workspace, ou refuserait carrement de demarrer si aucun vrai nom d'utilisateur ne peut etre trouve.
