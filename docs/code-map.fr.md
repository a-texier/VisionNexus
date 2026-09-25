---
app: suite
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [navigation dans le code, desktop, lanceur, registre, ajouter une app, checklist]
sources: [desktop/src, desktop/ui, desktop/scripts, launcher.py, _lib/launcher_engine.py, _lib/plugin_registry.py, rebuild_all.py, docs/docs_manifest.json]
---

# Carte du code

## Par où commencer la lecture du code de bureau

Lisez ces fichiers dans cet ordre pour comprendre le lanceur :

1. `desktop/src/catalog.ts` : les listes `APPS` et `SERVICES`, les deux structures de données que tout le reste parcourt.
2. `desktop/src/settings.ts` : le fichier de réglages, ses valeurs par défaut et `isValid()`.
3. `desktop/src/sshLauncher.ts` : comment une commande de lancement est construite, comment les ports sont lus, comment un tunnel est ouvert et surveillé.
4. `desktop/src/main.ts` : le processus main. Lisez-le par fonctionnalité, dans cet ordre : arrêt des processus et journaux en haut, ports et chemin natif, onglets et dispositions, sous-apps de l'Orchestrator, services, puis les gestionnaires IPC, `cv:launch` et les crochets de démarrage et de sortie à la fin.
5. `desktop/ui/catalog.html` : l'accueil du lanceur, une seule page de HTML, CSS et script sans étape de build.
6. `desktop/src/services.ts` et `desktop/src/docFiles.ts` : la logique pure des ressources de calcul et des pages de documentation, toutes deux testées unitairement.

## Où modifier le flux de lancement, les ports ou les tunnels

La séquence de lancement est le gestionnaire `cv:launch` de `main.ts` ; la ligne de commande qu'il démarre et les fonctions d'aide pour les ports et la disponibilité sont dans `sshLauncher.ts` (`launchApp`, `waitForPorts`, `openTunnel`, `watchTunnel`, `waitUntilReady`, `waitUntilBackendReady`, `findBusyLocalPorts`). Les règles de messages de tunnel sont dans `tunnelClassify.ts`, avec des tests dans `tunnelClassify.test.ts` : ajoutez une ligne de test pour chaque nouveau message ssh que vous classez. Les délais sont des littéraux aux points d'appel de `cv:launch` (60 s, 60 s, 120 s) et des constantes pour les services (`SERVICE_START_TIMEOUT_MS`). Pour changer ce que le lanceur imprime ou la façon dont les ports sont choisis, modifiez plutôt le moteur Python (voir plus bas).

## Où modifier le catalogue, les tuiles ou les réglages

Une tuile vient d'une entrée de `APPS` dans `catalog.ts` (id, libellé, icône, ports, position `x` et `y`, couleur, `supportsNativeMount`, `standalone`), construite par `buildTiles()` dans `catalog.html`. Les flèches entre tuiles et le cadre qui les entoure sont dessinés à la main dans le SVG en haut du corps de la page, et le texte du cadre est la clé `suiteFrameLabel` de `ui/i18n.js`. Les champs de réglages sont le panneau `#right` de `catalog.html`, enregistrés par le gestionnaire `saveBtn` ; ajoutez un nouveau réglage dans `LauncherSettings` et `DEFAULTS` (`settings.ts`), dans le panneau, dans la commande de lancement s'il doit atteindre le lanceur, et dans `isValid()` s'il est obligatoire. Chaque chaîne visible passe par `ui/i18n.js` (`CV_I18N`, clés avec des valeurs `fr` et `en`).

## Où modifier les onglets, les dispositions ou les fenêtres détachées

Onglets, volets et fenêtres détachées sont dans `main.ts` : `createAppTab`, `closeTab`, `detachTab`, `dockTab`, `applyLayout`, `slotBoundsFor`, `setLayoutMode` et les gestionnaires `cv:*dock*`. Leur côté renderer est dans `catalog.html` : `renderTabStrip`, les fonctions de composition (`enterCompose`, `renderComposeSquares`), `renderSplitHandles` et `slotRects`, qui reflète `slotBoundsFor` et doit rester identique à lui. Les raccourcis clavier installés dans chaque vue d'app (Ctrl+B, rechargement en cas de dépendances Vite périmées, rechargement après un chargement échoué) sont dans `installAppViewShortcuts()`. La gestion des fenêtres surgissantes et des liens est `denyPopupsOpenExternal()` et `openLocalUrlInVisionNexus()`.

## Où modifier les ressources de calcul

La liste des ressources est `SERVICES` dans `catalog.ts`. Leur machine à états et leurs constructeurs de messages sont dans `services.ts` avec des tests dans `services.test.ts` ; la gestion des processus (`startService`, `stopService`, `failService`, `pollServiceIndex`) est dans `main.ts`. La carte est `buildServiceCard()` et `updateServiceCard()` dans `catalog.html`, le texte de description est la clé i18n désignée par `descKey`. Le pont utilisé par la fenêtre Documentation est `docsSearch`, `docsIndexStatus` et `docsSync` dans `main.ts`, exposé par `preloadDocs.ts`.

## Où modifier la fenêtre Documentation

La fenêtre est `ui/docs.html` : onglets, liste des applications, onglets de pages et le point d'entrée `openDoc()` utilisé par les liens et les résultats de recherche. Le rendu markdown et les ancres de titres sont dans `ui/doc-render.js` (avec `ui/vendor/marked.min.js` embarqué, rafraîchi par `npm run vendor-marked`), l'onglet **Demander a la doc** est `ui/ask.js` avec ses fonctions pures dans `ui/ask-render.js`. La liste des entrées et la lecture des pages sont `cv:list-app-docs`, `readAppDocs`, `readBundledDocs` dans `main.ts` et `docFiles.ts`. La copie faite à la construction est `scripts/copy-docs.js`. Changer la numérotation des titres impose de modifier ensemble `docs_lib.py`, `doc-render.js` et le chunker du Docs Assistant, puis la fixture de `tools/docs/fixtures/`.

## Où modifier le moteur du lanceur et le registre

Tout ce qui concerne une machine cible est dans `_lib/launcher_engine.py` : `APP_REGISTRY` (une entrée par clé), `_WS_SUBDIRS`, l'allocation des ports (`find_free_port`, `_acquire_port_lock`), le registre d'instances (`register_instance`, `load_instances`), la résolution de Python (`find_python`, `find_python_from_conda_path`), la gestion des processus (`_kill_tree`, `_popen_kwargs`) et `launch_app()`, qui les enchaîne. Le point d'entrée en ligne de commande est `launcher.py`. La découverte des plugins est `_lib/plugin_registry.py`, avec des tests dans `_lib/tests/`. L'Orchestrator construit sa propre table de lanceur à partir de `APP_REGISTRY` : une modification du registre l'atteint donc sans autre édition.

## Où modifier le tutoriel

La visite du lanceur est `ui/tour.js` : un petit moteur (`CvTour` : projecteur, bulle, clavier) et la liste d'étapes `NEXUS_STEPS` (en français, chaque étape nommant un sélecteur CSS à mettre en évidence) avec ses textes anglais `EN_STEPS`, indexés par id d'étape. Les étapes ciblent des éléments par id ou attribut `data-`, donc renommer l'un d'eux dans `catalog.html` casse son étape. La progression est enregistrée par `cv:get-tutorial` et `cv:set-tutorial` sous la clé `nexus`. Les applications ont leurs propres visites ; leur moteur est une copie portable distincte dans leurs frontends, et il lit le même état par `__CV_NATIVE_MOUNT__`.

## Carte des modules

Les tableaux listent chaque fichier source avec son rôle. Cette page est tenue à la main ; mettez-la à jour quand un fichier est ajouté, déplacé ou supprimé.

### desktop/src

| Fichier | Rôle |
|---|---|
| `main.ts` | Processus main : fenêtres, onglets, dispositions, lancement, ports, services, sous-apps de l'Orchestrator, liste de documentation, IPC, arrêt |
| `catalog.ts` | Définitions de `APPS` et `SERVICES` |
| `settings.ts` | Fichier de réglages, état des tutoriels, `isValid()` |
| `sshLauncher.ts` | Commande de lancement, lecture des ports, tunnel, sondes de disponibilité |
| `tunnelClassify.ts` | Verdict pour une ligne de stderr du tunnel ssh |
| `services.ts` | Machine à états des ressources de calcul, validation IPC, conversion des réponses, relais HTTP |
| `imageProtocol.ts` | Le protocole `app-image://`, cache et repli HTTP |
| `workspacePaths.ts` | Conversion de chemin Linux vers Windows ou partage pour « ouvrir dans l'explorateur » |
| `docFiles.ts` | Chargement du manifest, frontmatter, choix de page par langue, tri |
| `preloadCatalog.ts`, `preloadDocs.ts`, `preloadApp.ts` | Les trois surfaces `contextBridge` |
| `*.test.ts` | Tests unitaires exécutés par `npm test` (`node --test`) |

### desktop/ui, scripts et assets

| Fichier | Rôle |
|---|---|
| `ui/catalog.html` | Accueil du lanceur, barre d'onglets, panneau des ports, réglages, ressources de calcul |
| `ui/docs.html` | Fenêtre Documentation |
| `ui/i18n.js` | Dictionnaire français et anglais de la coquille |
| `ui/tour.js` | Moteur et script du tutoriel interactif |
| `ui/ask.js`, `ui/ask-render.js` | Onglet **Demander a la doc** et ses fonctions de surlignage |
| `ui/doc-render.js`, `ui/vendor/marked.min.js` | Rendu markdown avec ancres `h-<n>` |
| `scripts/copy-docs.js` | Copie le manifest et les pages dans `docs-bundle/` avant l'empaquetage |
| `scripts/check-heading-ids.js` | Vérifie le viewer par rapport à la fixture partagée des titres |
| `assets/` | Icônes `icon_<app>.png`, `logo.png`, `app.ico` |

### Lanceur et outils

| Fichier | Rôle |
|---|---|
| `launcher.py` | Point d'entrée en ligne de commande du lanceur |
| `_lib/launcher_engine.py` | Registre, ports, workspaces, processus, `launch_app()` |
| `_lib/plugin_registry.py` | Découverte et chargement des plugins de `plugins/` |
| `rebuild_all.py` | Installe et construit tous les frontends et l'app de bureau |
| `docs/docs_manifest.json` | Sources documentées et jeu de neuf pages |
| `tools/docs/` | Lint de la documentation (`lint_docs.py`), générateurs (`gen_api_docs.py`, `gen_code_map.py`) et règles de rédaction (`DOC_STYLE.md`) |

## Ajouter une nouvelle app à la suite

Ajouter une app touche quatre endroits : l'app elle-même, le registre du lanceur, le catalogue de bureau et la documentation. Le branchement à l'Orchestrator est facultatif et séparé. Prenez une petite app existante comme référence : `Optuna_App` ou `DVC_App` montrent chaque fichier cité ci-dessous. Les étapes sont ordonnées pour que l'app soit lançable après l'étape 3.

### Préparer l'app

Créez `<Nom>_App/` à la racine du dépôt avec un `backend/` (FastAPI, module `backend.main:app`) et un `frontend/` (Vite et React). Suivez le [contrat du backend](api-reference.fr.md#contrat-attendu-de-tout-backend-dapplication) :

- `backend/config.py` lit `BACKEND_PORT`, les variables de workspace et d'utilisateur que vous nommerez dans le registre, et construit ses origines CORS à partir de la variable de port du frontend.
- `backend/main.py` expose `GET /health` et inclut ses routeurs ; les routeurs facultatifs sont `/api/workspace/users` et `/api/docs`.
- `frontend/vite.config.ts` lit `VITE_BACKEND_PORT` et `VITE_FRONTEND_PORT`, proxifie `/api`, et règle `host` et `allowedHosts` pour que le tunnel fonctionne.
- Ne stockez de données que sous le dossier du workspace, jamais dans le dossier de l'app.
- Lisez `?lang=` pour la langue de départ.
- Ajoutez un `launcher.py` seulement si vous voulez un usage autonome ; VisionNexus n'en a pas besoin.

### Enregistrer l'app dans le lanceur

Dans `_lib/launcher_engine.py`, ajoutez une entrée à `APP_REGISTRY` sous une clé courte et unique (cette clé est le préfixe du workspace, la valeur de `--app` et l'id de la tuile) :

```python
"myapp": {
    "label": "MyApp_App",
    "app_root": _CV / "MyApp_App",
    "backend_module": "backend.main:app",
    "backend_cwd": None,
    "frontend_dir": "frontend",
    "base_backend_port": 8069,
    "base_frontend_port": 5181,
    "default_workspace": str(_WS_DEFAULT / "default_myapp"),
    "workspace_env": "MYAPP_WORKSPACE",
    "user_env": "MYAPP_USER",
    "frontend_port_env": "MYAPP_FRONTEND_PORT",
    "extra_env": {},
},
```

Choisissez des ports de base absents du [tableau des ports](configuration.fr.md#ports-de-base-de-chaque-application), ajoutez la clé à `_WS_SUBDIRS` (avec les sous-dossiers que le lanceur doit créer, ou une liste vide), et ajoutez le dossier du frontend à `FRONTENDS` dans `rebuild_all.py`. Pour un service backend seul, mettez `frontend_dir` et `base_frontend_port` à `None`. Testez avec `python launcher.py --app myapp --workspace <dossier> --user <nom>` : les lignes `[config]` doivent montrer les deux ports et `/health` doit répondre.

### Ajouter l'app au catalogue

Dans `desktop/src/catalog.ts`, ajoutez à `APPS` un `AppDef` avec la même clé comme `id`, les mêmes ports que le registre, un `label`, une `icon` (un PNG de 256 px nommé `icon_myapp.png` dans `desktop/assets/`), une position `x` et `y` et une couleur. Mettez `supportsNativeMount: true` seulement si l'app implémente le chemin natif. Dans `ui/catalog.html`, dessinez les flèches de la nouvelle position dans le SVG du schéma, et mettez à jour `suiteFrameLabel` dans `ui/i18n.js` si le nombre d'apps de la suite dans le cadre change. Reconstruisez et vérifiez la tuile avec `npm run build` et `npm start`. La fenêtre Documentation et les filtres de **Demander a la doc** reprennent automatiquement la nouvelle entrée depuis `APPS`.

### Documenter l'app

Créez `MyApp_App/docs/` avec les neuf pages en anglais et en français, en suivant les règles de rédaction de `tools/docs/DOC_STYLE.md`, puis ajoutez la source à `docs/docs_manifest.json` :

```json
{ "id": "myapp", "dir": "MyApp_App", "indexed": true }
```

Générez les tableaux d'endpoints et la carte des modules avec `python tools/docs/gen_api_docs.py --app myapp --static` et `python tools/docs/gen_code_map.py --app myapp`, et vérifiez le résultat avec `python tools/docs/lint_docs.py --app myapp`. Le Docs Assistant indexe les pages à sa prochaine synchronisation, `copy-docs.js` les embarque dans la prochaine construction, et les questions de référence de `Docs_Assistant_App/tests/golden.json` peuvent être étendues pour les couvrir.

### Connecter l'app à l'Orchestrator

Cette étape est facultative : une app fonctionne et est documentée sans elle. Pour qu'un graphe pilote l'app, ajoutez-lui les endpoints `/api/orchestrator/` (voir `Optuna_App/backend/api/orchestrator.py`), son URL dans `APP_URLS` (`Orchestrator_App/backend/config.py`), une entrée dans `_KEY_TO_APP_ID` (`graph_runner.py`) pour qu'elle puisse être lancée automatiquement depuis le registre, et un type de nœud comme décrit dans la [carte du code de l'Orchestrator](../Orchestrator_App/docs/code-map.fr.md). Une app ne doit jamais dépendre de la présence de l'Orchestrator.

### Vérifier le résultat

Avant de fusionner, vérifiez chaque point :

- [ ] `python launcher.py --app myapp ...` imprime deux lignes `[config]` et `/health` répond.
- [ ] La tuile est cliquable une fois les réglages complets, et l'onglet s'ouvre après le lancement.
- [ ] Deux utilisateurs peuvent lancer l'app en même temps sans collision de ports.
- [ ] L'onglet affiche la bonne langue quand le lanceur est réglé sur `fr`.
- [ ] `python tools/docs/lint_docs.py --all` ne signale aucune erreur.
- [ ] `npm run build` et `npm test` passent dans `desktop/`.

## Ajouter une ressource de calcul à la suite

Une ressource de calcul est un service backend seul allumé depuis le catalogue. Enregistrez-la dans `APP_REGISTRY` avec `frontend_dir`, `base_frontend_port` et `frontend_port_env` à `None`, ajoutez sa clé de workspace à `_WS_SUBDIRS`, et ajoutez un `ServiceDef` à `SERVICES` dans `desktop/src/catalog.ts` (id, libellé, icône, `backendPort` indicatif et une `descKey` i18n définie dans `ui/i18n.js`). La carte, l'interrupteur, la machine à états et l'onglet de journal viennent sans effort. Une fenêtre qui a besoin du service doit passer par un pont IPC dédié dans `main.ts`, comme le fait la fenêtre Documentation pour `docs`, car le renderer ne doit jamais connaître le port. Sa source de documentation s'ajoute à `docs/docs_manifest.json` comme celle d'une app.
