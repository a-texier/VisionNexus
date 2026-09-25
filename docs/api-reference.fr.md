---
app: suite
doc_type: api-reference
audience: dev
lang: fr
title: Référence API
order: 70
tags: [cli du lanceur, contrat stdout, health, ipc, preload, événements, contrat backend]
sources: [launcher.py, _lib/launcher_engine.py, desktop/src/main.ts, desktop/src/preloadCatalog.ts, desktop/src/preloadDocs.ts, desktop/src/preloadApp.ts, desktop/src/services.ts, desktop/src/sshLauncher.ts]
---

# Référence API

## Conventions

Cette page décrit les interfaces de la couche lanceur : la ligne de commande de `launcher.py`, les lignes qu'il imprime, le contrat HTTP qu'un backend d'application doit respecter, et les canaux IPC du programme de bureau. Les endpoints HTTP de chaque application sont dans la référence API propre à cette application.

Les canaux IPC sont nommés `cv:<action>`. Les requêtes utilisent `ipcRenderer.invoke` et reçoivent leur réponse de `ipcMain.handle` ; un canal en échec ne lève pas d'exception à travers l'IPC mais renvoie `{ok: false, error}` ou une `ServiceError`. Les types de charge utile ci-dessous sont écrits à la façon de TypeScript. `AppDef` et `ServiceDef` sont définis dans `desktop/src/catalog.ts`, `LauncherSettings` et `TutorialState` dans `settings.ts`, `ServiceStatus`, `ServiceError` et `SearchResult` dans `services.ts`, `AppDocEntry` dans `preloadDocs.ts`.

## Ligne de commande du lanceur

```bash
python launcher.py --app <clé> [<clé> ...] --workspace <dossier> --user <nom> [options]
```

| Argument | Obligatoire | Sens |
|---|---|---|
| `--workspace` | oui | Racine des workspaces ; le dossier de données est `<workspace>/<clé>_<utilisateur>` (un chemin relatif est résolu par rapport au dossier courant) |
| `--user` | oui | Nom d'utilisateur de la session |
| `--conda-env` | non | Nom d'environnement cherché dans les dossiers conda habituels, `IA_env` par défaut |
| `--conda-path` | non | Dossier de l'environnement, script `activate` ou exécutable Python ; prioritaire sur `--conda-env` |
| `--backend-only` | non | Ne pas démarrer le frontend (toujours implicite pour `docs`) |
| `--no-reload` | non | Démarrer `uvicorn` sans `--reload` |
| `--backend-port` | non | Port de backend imposé, une seule app ; le lancement échoue s'il est occupé |
| `--frontend-port` | non | Port de frontend imposé, une seule app ; le lancement échoue s'il est occupé |
| `--native-share-host` | non | Définit `NATIVE_SHARE_HOST` pour les backends ; vide signifie HTTP seulement |

Le lanceur se termine avec une erreur si une option de port est combinée avec plusieurs apps. Une fois démarré, il vérifie ses processus toutes les deux secondes et arrête tout si l'un d'eux se termine. Ctrl+C et SIGTERM arrêtent toutes les apps. Les clés `compare`, `3d`, `meshy` et `recon3d` sont enregistrées mais leurs dossiers d'application ne font pas partie de ce dépôt.

## Contrat de sortie standard du lanceur

VisionNexus lit la sortie de `launcher.py` (stdout et stderr) ligne par ligne jusqu'à disposer des ports. Chaque ligne est vidée immédiatement, car un tube la mettrait sinon en mémoire tampon. Le contrat porte sur ces lignes, dans n'importe quel ordre, reconnues sans tenir compte de la casse :

| Ligne | Sens |
|---|---|
| `[config] backend   = http://localhost:<port>` | Port réel du backend |
| `[config] frontend  = http://localhost:<port>` | Port réel du frontend |
| `[config] frontend  = none` | Service backend seul ; accepté uniquement quand l'appelant l'autorise (ressources de calcul) |

Le lanceur imprime aussi `[config] app_id`, `workspace`, `conda`, `python`, `node` et `layout` (`DEV` ou `BUNDLE`), puis `[backend] Starting`, `[backend] Ready on :<port>` (ou `Still starting, continuing anyway...` après 60 secondes), `[frontend] Starting`, et un récapitulatif final avec l'URL de documentation de l'API `http://localhost:<port>/docs`. Ces lignes sont informatives. Rien d'autre ne doit modifier les deux lignes `[config]` : le programme de bureau ignore tout port qu'il n'y a pas lu.

## Contrat attendu de tout backend d'application

Le lanceur et le programme de bureau s'appuient sur un petit contrat ; une app qui le respecte fonctionne avec les deux sans aucune modification de leur part.

- **Point d'entrée** : un module ASGI déclaré dans le registre (`backend.main:app` pour la plupart des apps, `main:app` avec un dossier de travail `backend` pour quelques-unes). Il est démarré par `python -m uvicorn <module> --host 127.0.0.1 --port <BACKEND_PORT>` dans le dossier de l'app, avec `--reload` sauf si `--no-reload` est donné.
- **`GET /health`** : doit répondre dès que le serveur accepte des connexions. VisionNexus l'interroge toutes les 0,8 s et considère prête toute réponse HTTP de statut inférieur à 500. Par convention, il renvoie `{"status": "ok"}`.
- **Port et workspace** : lire `BACKEND_PORT` et les variables de workspace et d'utilisateur de l'app (voir [Configuration](configuration.fr.md#variables-denvironnement-posées-par-le-lanceur)) ; ne jamais coder un port en dur.
- **CORS** : autoriser les origines de frontend `http://localhost:<port du frontend>` et `http://127.0.0.1:<port du frontend>` ; le port du frontend vient de la variable de port de frontend de l'app.
- **Jeton de session** : appeler `_install_session_auth()` juste après le middleware CORS dans `backend/main.py`, qui installe `install_session_auth()` de `_lib/session_auth.py`. Il ajoute les routes `GET /api/_auth/bootstrap` (publique, code à usage unique) et `POST /api/_auth/bootstrap-code` (exige le jeton), laisse `/health` et `/api/health` publiques, et refuse tout le reste sans l'en-tête `X-VN-Token` ou le cookie `vn_<BACKEND_PORT>`. Un frontend qui appelle son backend sur un autre port que la page doit envoyer les identifiants (`credentials: 'include'`). Voir [Sécurité](security.fr.md).
- **Utilisateurs connectés** (optionnel) : `GET /api/workspace/users` renvoyant `[{"user", "workspace"}]` pour les entrées de `IA_INSTANCES_FILE` dont `app` égale `IA_APP_ID`.
- **Documentation intégrée** (optionnel) : un routeur de docs sous `/api/docs` qui liste et sert les pages du jeu de documentation de l'app.
- **Chemin natif** (optionnel) : un endpoint qui renvoie `{"native_path": <chemin ou null>}` pour une image, comme décrit dans [Architecture](architecture.fr.md#protocole-dimages-natif).
- **Frontend** : un projet Vite dont le script `dev` accepte `--port` et `--host`, dont `vite.config.ts` lit `VITE_BACKEND_PORT` et `VITE_FRONTEND_PORT` pour proxifier `/api` vers le backend, et qui lit le paramètre de requête `?lang=en|fr` pour sa langue de départ.
- **Services backend seul** : pas de dossier frontend, `frontend_dir` valant `None` dans le registre, et `frontend = none` dans la sortie du lanceur.

## Canaux de la fenêtre catalogue

La fenêtre catalogue (`ui/catalog.html`) les appelle par `window.cvLauncher`. Tous sont des requêtes `invoke`.

### Lancement et onglets

| Canal | Charge utile | Résultat | Notes |
|---|---|---|---|
| `cv:list-apps` | aucune | `AppDef[]` | Le catalogue des apps |
| `cv:launch` | `appId: string` | `{ok, error?}` | Flux de lancement complet ; réutilise un onglet existant |
| `cv:switch-tab` | `appId: string \| null` | void | `null` affiche l'accueil VisionNexus ; une app détachée reçoit le focus |
| `cv:close-tab` | `appId` | void | Ferme un onglet attaché et tue ses processus |
| `cv:stop-app` | `appId` | void | Arrête un onglet, une fenêtre détachée, un lancement en cours ou une ressource de calcul |
| `cv:detach-tab` | `appId, screenX, screenY` | void | Déplace l'onglet dans sa propre fenêtre |
| `cv:dock-tab` | `appId` | void | Ramène une fenêtre détachée |
| `cv:reorder-tabs` | `order: string[]` | void | Ordre d'affichage des onglets attachés |
| `cv:get-tab-url` | `appId` | `string \| null` | `http://127.0.0.1:<port du frontend>` |
| `cv:copy-tab-url` | `appId` | `boolean` | Copie cette URL dans le presse-papiers |
| `cv:open-tab-in-browser` | `appId` | `boolean` | Ouvre cette URL dans le navigateur du système |
| `cv:open-docs` | aucune | void | Ouvre la fenêtre Documentation |
| `cv:open-logs-folder` | aucune | string | Ouvre le dossier des journaux ; chaîne vide en cas de succès |
| `cv:quit` | aucune | void | Quitte après avoir tout arrêté |
| `cv:toggle-devtools` | aucune | void | Outils de développement de la fenêtre au premier plan |

### Dispositions et composition

| Canal | Charge utile | Résultat | Notes |
|---|---|---|---|
| `cv:report-content-bounds` | `{x, y, width, height}` | void | Rectangle de `#body`, envoyé à chaque redimensionnement |
| `cv:set-shell-overlay` | `open: boolean` | void | Masque ou restaure les vues natives pendant que des surcouches HTML sont ouvertes |
| `cv:set-layout-mode` | `'single' \| 'v2' \| 'h2' \| 'grid4'` | void | Change de disposition en remplissant les volets avec les onglets ouverts |
| `cv:begin-dock-compose` | `mode` | `Rect[]` | Masque les vues et renvoie les rectangles des volets |
| `cv:apply-dock` | `mode, panes: (string \| null)[]` | void | Applique la disposition composée |
| `cv:resize-dock` | `axis: 'x' \| 'y', ratio: number` | void | Ratio borné à 0,2 à 0,8 |
| `cv:cancel-dock` | aucune | void | Restaure la disposition validée |
| `cv:toggle-active-sidebar` | aucune | `boolean` | Masque ou affiche la barre latérale de l'app active |
| `cv:set-subapps-flyout` | `open?: boolean` | void | Conservé par compatibilité : garantit seulement que la vue active est visible |

### Ports et processus

| Canal | Charge utile | Résultat | Notes |
|---|---|---|---|
| `cv:scan-ports` | aucune | `{local: PortRow[], remote: {vm, rows} \| null, known: {port, label}[]}` | `PortRow` vaut `{port, pid, process, user?}` |
| `cv:kill-port` | `target: 'local' \| 'remote', port` | `{ok, failed, error?}` | Tue le processus à l'écoute et son groupe de processus, puis vérifie le port |
| `cv:kill-all` | aucune | `{stopped, ports, failed, error?}` | Arrête tout, puis tue les ports connus |
| `cv:cleanup-vm` | aucune | `{ok, killed, error?}` | Arrête les serveurs de la suite de l'utilisateur sur la VM sélectionnée |

### Réglages, chemin natif et tutoriel

| Canal | Charge utile | Résultat | Notes |
|---|---|---|---|
| `cv:get-settings` | aucune | `LauncherSettings` | |
| `cv:save-settings` | `LauncherSettings` | void | Fusionné avec le fichier enregistré, si bien que `tutorials` n'est jamais effacé |
| `cv:check-mount` | `host: string` | `{ok, shares: string[], error?}` | Teste le TCP 445, liste les partages au mieux, met à jour l'état du chemin natif |
| `cv:get-tutorial` | `key: string` | `TutorialState` | `{launchedOnce, completed}` |
| `cv:set-tutorial` | `key, patch` | `TutorialState` | Fusion partielle |

### Ressources de calcul et sous-apps de l'Orchestrator

| Canal | Charge utile | Résultat | Notes |
|---|---|---|---|
| `cv:list-services` | aucune | `ServiceDef[]` | |
| `cv:get-service-status` | `id` | `ServiceStatus` | |
| `cv:start-service` | `id` | `{ok, error?}` | Idempotent pendant le démarrage ou à l'état prêt |
| `cv:stop-service` | `id` | void | |
| `cv:show-subapps-menu` | aucune | void | Menu natif des sous-apps |
| `cv:open-orchestrator-subapp` | `subAppId` | `{ok, error?}` | Ouvre comme onglet, exige l'état `running` |
| `cv:open-orchestrator-subapp-browser` | `subAppId` | `{ok, error?}` | Ouvre dans le navigateur du système |
| `cv:launch-orchestrator-subapp` | `subAppId` | `{ok, error?}` | `POST /api/apps/launch` |
| `cv:launch-all-orchestrator-subapps` | aucune | `{ok, error?}` | `POST /api/apps/launch-all` |

## Canaux de la fenêtre Documentation

La fenêtre Documentation (`ui/docs.html`) les appelle par `window.cvDocs`. Le service est toujours `docs` ; le renderer ne transmet jamais d'id ni de port.

| Canal | Charge utile | Résultat | Notes |
|---|---|---|---|
| `cv:list-app-docs` | `lang?: 'fr' \| 'en'` | `AppDocEntry[]` | Une entrée par élément documenté, chacune avec `files: AppDocFile[]` |
| `cv:docs-service-status` | aucune | `ServiceStatus` | |
| `cv:docs-service-start` | aucune | `{ok, error?}` | |
| `cv:docs-service-stop` | aucune | void | |
| `cv:docs-search` | `{q, lang?, apps?, audience?, k?, prefer?}` | `{ok: true, result: SearchResult} \| ServiceError` | Validé, puis `POST /search` (délai de 10 s) |
| `cv:docs-index-status` | aucune | `{ok: true, index: IndexSummary} \| ServiceError` | `GET /index/status` |
| `cv:docs-sync` | aucune | `{ok: true, started: boolean} \| ServiceError` | `POST /index/sync` ; utilisé par le bouton **Actualiser l'index** de l'onglet **Demander a la doc** |

Les limites de `SearchRequest` sont appliquées dans `validateSearchRequest()` : `q` fait de 1 à 500 caractères, `lang` vaut `fr`, `en` ou `both`, `audience` vaut `user`, `dev` ou `all`, `prefer` vaut `fr` ou `en`, `k` est un entier de 1 à 30 (8 par défaut), et `apps` compte au plus 20 identifiants qui respectent `^[a-z0-9_-]{1,32}$`. Une `ServiceError` vaut `{ok: false, error, message}` avec `error` parmi `off`, `starting`, `stopping`, `error`, `unreachable`, `timeout`, `http` et `invalid`.

## Pont natif exposé aux onglets d'application

Chaque onglet d'application reçoit `window.__CV_NATIVE_MOUNT__` de `preloadApp.ts`, ainsi que le booléen `window.__ANNOTATION_APP_NATIVE__` conservé pour Annotation. Les frontends doivent traiter l'absence du pont (application ouverte dans un navigateur ordinaire) comme un repli, jamais comme une erreur.

| Membre | Résultat | Notes |
|---|---|---|
| `supported` | `boolean` | Cette app peut tenter le chemin natif |
| `getPathForFile(file)` | `string` | Chemin réel du système d'un fichier ou dossier déposé |
| `openInNativeFileManager(path, mappings?)` | `{ok, path?, error?}` | `cv:open-native-path` ; convertit un chemin Linux en chemin Windows ou de partage avec des paires `{backendRoot, clientRoot}` |
| `selectDirectory()` | `string \| null` | `cv:select-native-directory`, boîte de dialogue native de dossier |
| `getTutorial(key)`, `setTutorial(key, patch)` | `TutorialState` | Mêmes canaux que le catalogue |

## Événements poussés vers les renderers

Le processus main envoie ces messages ; les renderers s'y abonnent par les fonctions `on...` de leur preload.

| Événement | Arguments | Destinataire |
|---|---|---|
| `cv:log` | `appId, line` | Catalogue ; codes ANSI déjà retirés |
| `cv:app-status` | `appId, status, detail` | Catalogue ; `status` vaut `launching`, `running`, `error` ou `closed` |
| `cv:tabs` | `tabs, activeId, layout` | Catalogue ; `layout` vaut `{mode, panes, ratioX, ratioY}` |
| `cv:dock-hint` | `appId \| null` | Catalogue ; une fenêtre détachée survole la barre d'onglets |
| `cv:orchestrator-subapps` | `apps[]` | Catalogue ; `{app_id, label, launched, status, backend_url, frontend_url}` |
| `cv:service-status` | `ServiceStatus` | Catalogue |
| `cv:docs-service-status` | `ServiceStatus` | Chaque fenêtre Documentation ouverte |

## Appels HTTP faits par le programme de bureau

Le programme de bureau appelle lui-même quelques endpoints HTTP, toujours sur `127.0.0.1` par le port local (un tunnel en mode VM).

| Cible | Appel | Rôle |
|---|---|---|
| Tout frontend | `GET /` toutes les 0,8 s | Disponibilité, statut inférieur à 500 |
| Tout backend | `GET /health` toutes les 0,8 s | Disponibilité, statut inférieur à 500 |
| Orchestrator | `GET /api/apps` chaque seconde | Liste et état des sous-applications |
| Orchestrator | `POST /api/apps/launch`, `/api/apps/launch-all`, `/api/apps/stop-all` | Pilotage des sous-applications |
| Docs Assistant | `GET /index/status`, `POST /index/sync`, `POST /search` | État de l'index et recherche, voir la [référence API du Docs Assistant](../Docs_Assistant_App/docs/api-reference.fr.md) |
