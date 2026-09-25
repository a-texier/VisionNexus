---
app: suite
doc_type: architecture
audience: dev
lang: fr
title: Architecture
order: 60
tags: [electron, flux de lancement, tunnels, gestionnaire de services, moteur du lanceur, plugins, chaîne de documentation, ipc]
sources: [desktop/src/main.ts, desktop/src/sshLauncher.ts, desktop/src/tunnelClassify.ts, desktop/src/services.ts, desktop/src/imageProtocol.ts, desktop/src/docFiles.ts, desktop/src/preloadCatalog.ts, desktop/src/preloadDocs.ts, desktop/src/preloadApp.ts, desktop/scripts/copy-docs.js, _lib/launcher_engine.py, _lib/plugin_registry.py, launcher.py, docs/docs_manifest.json]
---

# Architecture

## Vue d'ensemble des composants

La suite a trois couches : le lanceur de bureau, le lanceur Python et les applications.

```text
VisionNexus (Electron, desktop/)
  processus main   src/main.ts, sshLauncher.ts, services.ts, imageProtocol.ts, docFiles.ts
  preload          preloadCatalog.ts, preloadApp.ts, preloadDocs.ts   (contextBridge)
  renderers        ui/catalog.html, ui/docs.html, une WebContentsView par onglet d'application
        |
        |  cmd.exe /c  ou  ssh -t <vm>       + un second ssh -N -L pour le tunnel
        v
launcher.py -> _lib/launcher_engine.py  (registre, ports, workspaces, processus)
        |
        v
application : backend uvicorn (127.0.0.1:<port>)  +  serveur de dev Vite (127.0.0.1:<port>)
```

Le programme de bureau ne contient aucune logique d'application. Il démarre `launcher.py`, lit les ports que le lanceur imprime, s'y connecte et affiche les frontends. Le lanceur Python possède tout ce qui concerne la machine cible : quel interpréteur exécute le backend, quels ports sont libres, où vit le workspace. Les applications doivent seulement pouvoir être démarrées par le registre et répondre sur `/health`. Les ressources de calcul passent par la même chaîne avec `--backend-only`.

La documentation est une quatrième pièce transversale : `docs/docs_manifest.json` liste les sources documentées, le programme de bureau lit leurs pages pour la fenêtre Documentation, et le Docs Assistant les indexe.

## Modèle de processus d'Electron

Le processus main (`src/main.ts`) possède toutes les capacités système : processus enfants, fichiers, sockets, boîtes de dialogue et fenêtres. Les renderers sont isolés (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`) et n'atteignent le processus main que par les fonctions que leur script preload expose avec `contextBridge`. Trois scripts preload définissent trois surfaces :

- `preloadCatalog.ts` expose `window.cvLauncher` à `ui/catalog.html` : lancement, onglets, dispositions, ports, réglages, tutoriels, ressources de calcul.
- `preloadDocs.ts` expose `window.cvDocs` à `ui/docs.html` : la liste des pages de documentation, et un pont étroit vers le Docs Assistant.
- `preloadApp.ts` s'exécute dans chaque onglet d'application et expose `__CV_NATIVE_MOUNT__` (prise en charge du chemin natif, chemins de fichiers déposés, état du tutoriel) et l'ancien drapeau `__ANNOTATION_APP_NATIVE__`. Il reçoit l'état du chemin natif par un argument de ligne de commande `--cv-native-status`, car aucun IPC n'est possible avant le chargement de la page.

Tous les appels sont des requêtes `ipcRenderer.invoke` auxquelles répond `ipcMain.handle`, plus sept événements poussés par le processus main (listés dans la [référence API](api-reference.fr.md#événements-poussés-vers-les-renderers)). Les gestionnaires ne lèvent pas d'exception à travers l'IPC : le pont vers le Docs Assistant renvoie à la place des objets `{ok: false, error, message}`.

La fenêtre du catalogue est une fenêtre sans cadre sous Windows, avec une barre du haut dessinée en HTML. Les onglets d'application sont des objets `WebContentsView` empilés dans cette fenêtre, si bien qu'une application garde son état quand elle est masquée. Un verrou d'instance unique fait qu'un second démarrage donne le focus à la fenêtre existante.

## Flux de lancement d'une application

`ipcMain.handle('cv:launch')` dans `main.ts` exécute un lancement. Il réutilise d'abord un onglet existant, vérifie les réglages avec `isValid()` et refuse les identifiants génériques, puis :

1. Ouvre un fichier de journal et prévient le catalogue (`launching`).
2. Appelle `launchApp()` (`sshLauncher.ts`), qui démarre `cmd.exe /c cd /d "<racine>" && python launcher.py --app <id> --user ... --workspace ... --conda-path ...` en local (avec `windowsVerbatimArguments`, car `cmd.exe` analyse les guillemets autrement que Node) ou `ssh -t <vm> "cd '<racine>' && python launcher.py ..."`. `--native-share-host` est ajouté quand un hôte est configuré.
3. Appelle `waitForPorts()`, qui surveille stdout et stderr à la recherche des lignes `[config] backend = http://localhost:N` et `[config] frontend = ...` et se résout quand les deux sont connues (délai de 60 s, `null` en cas de délai dépassé ou d'arrêt prématuré). Elle lit aussi la ligne `[token]` que le lanceur affiche avant ses ports et renvoie le jeton de session avec eux ; `redactLauncherLine()` remplace cette ligne et le lien `[auth] navigateur` par un texte masqué avant journalisation. `rememberToken()` (`sessionTokens.ts`) garde le jeton pour les ports frontend et backend, et `setSessionCookie()` pose le cookie `vn_<port backend>` ; [Sécurité](security.fr.md) décrit tout le trajet du jeton.
4. Avec une VM : `findBusyLocalPorts()` teste les deux ports sur `127.0.0.1`, `describeSshClient()` journalise `ssh -V`, et `openTunnel()` démarre `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L p:localhost:p ... <vm>`. `watchTunnel()` signale les problèmes.
5. `waitUntilReady()` sonde le frontend (60 s) et `waitUntilBackendReady()` sonde `/health` sur le backend (120 s, toute réponse inférieure à 500 compte). Les deux prennent un `AbortSignal` pour que **Stop** annule l'attente immédiatement.
6. Un problème fatal de tunnel enregistré dans `tunnelProblems` interrompt le lancement : le port local répondrait, mais pas à travers le tunnel de ce lancement.
7. `createAppTab()` crée la `WebContentsView` qui charge `http://127.0.0.1:<frontend>?lang=<uiLanguage>` et enregistre l'onglet. L'état devient `running`. Chaque requête de l'onglet vers un port connu reçoit l'en-tête `X-VN-Token` de `installRendererAuth()`, un crochet `webRequest.onBeforeSendHeaders` sur la session par défaut partagée par tous les onglets.

L'état d'un lancement est réparti sur quelques maps : `launchingProcs` (processus vivants avant qu'un onglet n'existe, tués par **Stop**), `launchAbort` (signaux d'annulation), `userStoppedLaunch` (distingue un arrêt utilisateur, rapporté comme `closed`, d'un échec, rapporté comme `error`), puis `dockedTabs` / `detachedTabs` une fois lancé. L'Orchestrator est un cas particulier : après l'ouverture de son onglet, `main.ts` interroge son `/api/apps` chaque seconde (voir plus bas).

## Tunnels et leur classification

Un tunnel est un simple processus `ssh -N -L` ouvert une fois les ports connus, car on ne peut pas ajouter un `-L` à une connexion existante. Il s'exécute avec `ExitOnForwardFailure=yes` : sans cette option, un port local occupé n'imprime que `bind: Address already in use` et ssh continue de tourner, alors que le port continue de répondre à travers un ancien tunnel qui mène ailleurs.

`watchTunnel()` lit le stderr du tunnel et demande à `classifyTunnelLine()` (`tunnelClassify.ts`) un verdict par ligne : bénin (clé d'hôte ajoutée, pseudo-terminal, debug), transitoire ou fatal. L'ordre compte. Une ligne `channel N: open failed` ou `connect failed` concerne une seule connexion forwardée : elle est attendue tant que le backend charge ses modèles, et elle contient aussi `connection refused` ; le transitoire est donc testé avant le fatal et n'interrompt jamais un lancement. Les lignes fatales correspondent à une liste fixe (adresse déjà utilisée, écoute impossible, bind, permission refusée, résolution impossible, connexion refusée, fermée ou expirée, vérification de clé d'hôte échouée). Quand le processus se termine avec un code non nul, les dernières lignes stderr non reconnues sont rejouées, et le code 255 est distingué des autres codes, qui ne peuvent pas venir de ssh lui-même.

## Onglets, dispositions et fenêtres détachées

`dockedTabs` associe un id d'app à un `DockedTab` : libellé, icône, vue, processus, flux de journal, état du chemin natif, ports. `detachTab()` déplace la même `WebContentsView` dans une nouvelle `BrowserWindow`, sans recharger, et `dockTab()` la remet en place ; une fenêtre détachée surveille ses propres événements `move` et se rattache quand son centre haut reste 220 ms au-dessus de la barre d'onglets du catalogue. Les fenêtres détachées reçoivent leur propre AppUserModelID Windows pour avoir chacune leur bouton dans la barre des tâches.

Les dispositions sont calculées dans le processus main. `layoutMode` vaut `single`, `v2`, `h2` ou `grid4`, `paneTabs` contient l'id d'app de chaque volet, et `slotBoundsFor()` dérive les rectangles des bornes de contenu que le renderer rapporte (`cv:report-content-bounds`, mesurées sur `#body`) et de deux ratios de séparation limités à 0,2 à 0,8. `applyLayout()` retire toutes les vues enfants et rajoute celles affectées à un volet. Les vues natives se dessinent toujours au-dessus du HTML de la fenêtre : c'est pourquoi les surcouches (écran de composition, menus, panneau des ports) appellent `cv:set-shell-overlay` pour masquer les vues pendant leur ouverture, et pourquoi la liste des sous-apps de l'Orchestrator est un menu natif.

## Intégration des sous-apps de l'Orchestrator

L'Orchestrator démarre ses propres sous-applications depuis son backend, en dehors de `launchApp()`. Pour les afficher, `main.ts` interroge `GET /api/apps` sur le port du backend de l'Orchestrator chaque seconde tant que son onglet est ouvert, garde la dernière réponse dans `lastSubApps` et la pousse au catalogue (`cv:orchestrator-subapps`). Ouvrir une sous-application (`openOrchestratorSubApp`) exige l'état `running`, vérifie les ports locaux en mode VM, ouvre un tunnel à la demande, attend le frontend et crée un onglet dont l'id commence par `orch_`.

Fermer un tel onglet ne fait que le masquer. Fermer l'onglet Orchestrator demande au backend de tout arrêter (`POST /api/apps/stop-all`, délai de 15 s), puis tue tous les ports que le lanceur connaît, en local et sur la VM, comme filet de sécurité. Les liens ouverts depuis n'importe quelle app qui visent un port de frontend local connu sont routés vers l'onglet correspondant par `openLocalUrlInVisionNexus()` ; les autres liens HTTP vont dans le navigateur du système et aucune nouvelle fenêtre Electron n'est jamais créée.

## Protocole d'images natif

`imageProtocol.ts` enregistre le schéma `app-image://`. Une requête porte `imagePath` (URL qui renvoie `{native_path}`), `fallback` (l'URL HTTP simple de l'image) et éventuellement `nativePath` quand le backend connaît déjà le fichier. Le gestionnaire essaie dans l'ordre : le cache mémoire (LRU, 150 Mo), la lecture native (`fs.readFile` du chemin UNC, délai de 1,5 s, après un délai de 2 s sur la requête `imagePath`), puis le repli HTTP. Il n'essaie le chemin natif que si `setNativeMountAvailable(true)` a été appelé, ce que `main.ts` fait après un **Tester** réussi et toujours pour les lancements locaux. Les réponses provisoires (une image de remplacement marquée `x-frame-missing` ou `no-store`) sont servies mais jamais mises en cache.

Le schéma est générique : il ne sait pas quelle app l'appelle. Une app y participe en exposant un endpoint qui renvoie un chemin natif, un helper frontend qui construit des URL `app-image://` quand `window.__CV_NATIVE_MOUNT__.supported` est vrai, et `supportsNativeMount: true` dans son `AppDef`.

## Gestionnaire de services

Une ressource de calcul est décrite par un `ServiceDef` dans `catalog.ts` (`SERVICES`), séparé de `APPS` pour qu'elle n'obtienne jamais de tuile, d'onglet ni d'entrée de réglages. La machine à états de `services.ts` est pure et testée unitairement : `off` vers `starting` vers `ready` vers `stopping` vers `off`, avec `error` accessible depuis `starting` et `ready`. Un événement sans sens dans l'état courant le laisse inchangé, si bien qu'un double clic sur l'interrupteur est sans effet.

`startService()` dans `main.ts` suit le flux de lancement, avec `--backend-only` et un seul port à forwarder : vérification des réglages, `launchApp()`, `waitForPorts(..., allowNoFrontend=true)` (le lanceur imprime `frontend = none`), contrôle du port occupé, tunnel, puis `waitUntilBackendReady()` avec un délai de 90 s. Il n'attend ni le modèle ni l'index : dès que `/health` répond, le service est `ready`. `failService()` transforme tout échec en état `error` avec un message lisible construit par `startFailureMessage()`, en gardant les deux dernières lignes du lanceur pour expliquer un plantage.

Tant qu'un service est `ready`, `pollServiceIndex()` lit `/index/status` toutes les 1,5 s pendant une synchronisation et toutes les 15 s sinon, le résume avec `summarizeIndexStatus()` et diffuse `cv:service-status`. L'état est partagé par la carte du catalogue et la fenêtre Documentation, qui ne font que demander le démarrage ou l'arrêt. Le renderer n'atteint jamais le service : `docsSearch()` valide la requête (`validateSearchRequest`), la transmet à `POST /search` sur le port local avec un délai de 10 s et convertit la réponse (`mapSearchResponse`). Un service garde la cible sur laquelle il a été démarré jusqu'à son arrêt.

## Arrêt et nettoyage des orphelins

Tuer un arbre de processus n'est pas automatique sous Windows : `cmd.exe` et le processus de rechargement de `uvicorn --reload` laissent des enfants derrière eux. `killProcessTree()` utilise `taskkill /T /F`, et la variante synchrone sert dans `before-quit`, qui est intercepté une fois pour attendre le `stop-all` de l'Orchestrator avant de tuer les arbres, puis redéclenché. Les flux de journal ont un gestionnaire `error` et ne sont jamais écrits après `end()`, si bien qu'un échec de journalisation ne peut pas faire tomber le processus main. À la sortie, les onglets attachés, les onglets détachés, les lancements en cours et les services sont tous tués.

L'action **Tout arreter** (`cv:kill-all`) ajoute un filet fondé sur les ports : elle prend un instantané de `knownPorts()` (onglets, services, sous-apps de l'Orchestrator et registre partagé), arrête tout proprement, puis tue tout ce qui écoute encore sur ces ports, avec `taskkill` en local et des signaux de groupe de processus sur la VM (TERM, puis KILL après une seconde, jamais le groupe 1 ni le groupe propre de la session ssh). Sur la VM, elle relit d'abord le registre partagé et ajoute les entrées du nom d'utilisateur courant. `killPortsRemote()` envoie tous les ports dans une seule session ssh, prend les numéros de processus dans `ss` (avec `lsof` ou `fuser` en repli) et affiche `STILL <port>` pour tout port encore en écoute ; `killPortsLocal()` relit `netstat` après `taskkill`. Les deux renvoient `{ok, failed, error}`, qu'affichent **Tuer** et **Tout arreter**. `cleanupRemoteSuite()`, derrière **Nettoyer la VM**, arrête les processus `node` et `python` de l'utilisateur dont le dossier de travail est sous la racine du dépôt et dont la ligne de commande est un serveur de la suite. `scanLocalPorts()` utilise `netstat` et `tasklist` ; `scanRemotePorts()` exécute une seule commande ssh non interactive qui renvoie ensemble `ss`, `ps` et le fichier de registre.

## Moteur du lanceur et registre

`launcher.py` analyse les arguments et appelle `launch_app()` de `_lib/launcher_engine.py` pour chaque app demandée. Le moteur détecte sa disposition par le contenu : un dossier qui contient l'un des dossiers d'app est la racine du dépôt, quel que soit son nom. `APP_REGISTRY` contient une entrée par clé de lanceur avec la racine de l'app, le module ASGI, le dossier de travail, le dossier du frontend (`None` pour un service backend seul), les ports de base, les noms des variables de workspace, d'utilisateur et de port de frontend, et l'environnement supplémentaire.

`launch_app()` ensuite : construit `<workspace>/<clé>_<utilisateur>` et ses sous-dossiers (`_WS_SUBDIRS`) ; ajoute le workspace à `<app>/data/.history.json` ; sous le verrou de fichier `.run/.port_lock`, lit le registre, choisit des ports libres (`find_free_port` : test de bind sur `0.0.0.0`, exclusif sous Windows, 200 candidats) et enregistre l'instance ; construit l'environnement ; résout l'interpréteur avec `find_python()` ; démarre `python -m uvicorn <module> --host 127.0.0.1 --port N [--reload]` dans le dossier du backend ; attend jusqu'à 60 s que le port soit pris ; démarre `npm run dev -- --port N --host 127.0.0.1` dans le dossier du frontend sauf en mode backend seul ; et imprime le bloc `[config]`. Les processus démarrent dans leur propre session ou groupe de processus pour qu'un Ctrl+C dans le terminal du lanceur ne les tue pas ; le lanceur les arrête lui-même. À l'arrêt, l'instance est désenregistrée, et pour `annotation` un rapport d'usage est régénéré sous `<racine des workspaces>/monitoring/`.

## Mécanisme de plugins

Le cœur fournit un moteur d'entraînement YOLOX (Apache-2.0). Un plugin ajoute des moteurs ou des détecteurs sans qu'aucune ligne du cœur en dépende : les interfaces ne connaissent que les catalogues que les plugins publient.

### Comment un plugin est découvert et ce qu'il déclare

Un plugin est un package Python ordinaire placé sous `plugins/` à la racine du dépôt (ou dans le dossier désigné par `VISIONNEXUS_PLUGINS_DIR`). Aucune installation pip n'est nécessaire : sa présence suffit. `_lib/plugin_registry.py` lit le dict `PLUGIN` de son `__init__.py` :

```python
PLUGIN = {
    "label": "Mon moteur",
    "requires": ["ma_bibliotheque"],     # verifie sans import (find_spec)
    "extensions": {
        "visionnexus.trainer_backends": {"mon_moteur": "mon_plugin.trainer:MonEngine"},
    },
}
```

`__init__.py` ne doit rien importer, car il est lu à chaque découverte. Une cible `module:attribut` n'est importée que lorsqu'elle est demandée, et le module cible doit rester léger : sa bibliothèque d'entraînement est importée dans `train()`. Si un module de `requires` manque, le plugin reste listé mais marqué indisponible avec la raison, et `load_extension()` lève une `RuntimeError` qui dit pourquoi au lieu de se replier en silence. Un package installé qui déclare un entry point du même groupe est aussi accepté. Le registre expose `discover_plugins()`, `extensions_for()`, `load_extension()` et `describe()` (une forme sérialisable pour un endpoint `/api/capabilities`).

### Extension de moteur d'entraînement

Le groupe `visionnexus.trainer_backends` sert Training, Optuna (essais HPO) et l'Orchestrator (nœuds Model, Training et Optuna). Le contrat est `TrainingEngine` dans `Training_App/backend/services/trainer_backend.py` ; l'implémentation de référence est le moteur YOLOX (`yolox_engine.py`, `yolox_catalog.py` dans le même dossier).

```python
class MonEngine:
    CATALOG = {...}

    def __init__(self, *, model_size, data_yaml, run_name, output_dir, hyperparams,
                 model_weights="", stop_flag=None, on_epoch_end=None): ...

    def train(self) -> dict:
        """Bloquant. Appelle on_epoch_end({"epoch", "total_epochs", "progress_pct", "loss",
        "metrics"}) a chaque epoque, avec des metriques nommees "metrics/mAP50(B)",
        "metrics/mAP50-95(B)", "metrics/precision(B)", "metrics/recall(B)". Renvoie
        {"run_dir", "best_model_path", "last_model_path"} et, en option, "metrics"."""

    @staticmethod
    def load_predictor(weights, model_size, class_names, imgsz=640):
        """Optionnel : predict(frame_bgr) -> [(x1, y1, x2, y2, conf, cls_id)]."""
```

Quand `stop_flag` est armé, le moteur sort de `train()` au plus vite, par le moyen qu'il veut ; Training traite toute sortie survenue après l'arrêt comme un arrêt propre. Training expose `GET /api/capabilities` avec les moteurs, leur disponibilité et leurs catalogues, et une interface n'offre un choix de moteur que lorsque plusieurs sont disponibles. Le moteur d'un run voyage avec ses poids (base de données, MLflow, réponse de l'Orchestrator), car des poids ne se rechargent qu'avec leur propre moteur.

### Catalogue de moteur

Tout ce que les interfaces affichent d'un moteur vient de son `CATALOG`, dont les clés obligatoires sont `CATALOG_KEYS` dans `trainer_backend.py`.

| Clé | Rôle |
|---|---|
| `label` | Nom affiché |
| `weights_suffixes` | Extensions des poids ; d'autres poids sont refusés avant le lancement |
| `sizes`, `default_size`, `size_prefix` | Tailles proposées (le préfixe est retiré des boutons) |
| `defaults` | Hyperparamètres et valeurs par défaut ; une clé absente ici est ignorée |
| `groups` | Formulaire : groupes de champs `{key, label, type, min, max, step, placeholder}` |
| `keys` | Traduction des champs génériques `epochs`, `batch`, `imgsz`, `workers` |
| `hpo_ranges`, `hpo_default_optimize` | Plages Optuna et sélection par défaut |
| `artifacts`, `train_batches_glob` | Plots produits par catégorie (`summary`, `confusion`, `curves`, `labels`, `val_labels`, `val_predictions`), chemins relatifs au dossier du run, du préféré au moins préféré |
| `pretrained_by_default` | Poids de départ implicites (texte d'aide des formulaires) |

Les plots déclarés alimentent la galerie de Training, les Insights de l'Orchestrator et le run MLflow (sous `plots/`) : c'est au moteur de les produire sous les noms qu'il déclare.

### Extension de détecteur

Le groupe `visionnexus.detector_backends` sert Inference. Le contrat minimal est dans `Inference_App/backend/inference_core/detectors.py` :

```python
class Detector(Protocol):
    class_names: list[str]

    def predict(self, frame) -> list[Detection]: ...
```

Le constructeur du plugin reçoit `model_path`, `model_size`, `class_names`, `confidence`, `iou`, `imgsz` et `device`, et peut renvoyer des objets `Detection` natifs ou des tuples `(x1, y1, x2, y2, score, class_id, class_name)`. ByteTrack reste une option du pipeline d'Inference et ne fait pas partie du plugin détecteur.

### Documentation d'un plugin

Un plugin documente ce qu'il ajoute à chaque app dans `plugins/<plugin>/docs/<DossierApp>/*.md`. La fenêtre Documentation et le Docs Assistant ajoutent ces pages après les pages propres de l'app, uniquement là où le plugin est présent. La même règle est appliquée par `readPluginDocs()` dans `main.ts`, par `copy-docs.js` et par `sources.py` du Docs Assistant.

## Chaîne de documentation

La liste des sources documentées est `docs/docs_manifest.json` : chaque source a un `id`, un `dir` (le dossier de l'app, `.` pour la suite), un `docs_path` optionnel (le dossier des pages relatif à la racine du dépôt, `docs` pour la suite, sinon `<dir>/docs`) et un drapeau `indexed`. Le même fichier définit le jeu de neuf pages avec le `doc_type`, l'`audience` et l'`order` de chaque page. Il est lu par `tools/docs/` (lint et générateurs), par `docFiles.ts` et `main.ts`, par `copy-docs.js` et par le Docs Assistant.

Les pages sont des fichiers markdown avec un petit frontmatter, en paires `page.md` (anglais) et `page.fr.md` (français). Chaque titre reçoit une ancre `h-<n>` où `n` compte les titres ATX du fichier à partir de 0, blocs de code exclus ; `ui/doc-render.js`, `tools/docs/docs_lib.py` et le chunker du Docs Assistant appliquent tous cette règle, et `npm test` exécute `scripts/check-heading-ids.js` sur une fixture partagée pour garder le viewer et les outils identiques.


## Invariants à ne pas casser

- Ne jamais passer de ports fixes à `launcher.py` depuis le programme de bureau : il doit lire les ports annoncés, ce qui rend possibles plusieurs instances.
- Garder `ExitOnForwardFailure=yes` sur les tunnels, et vérifier les ports locaux avant de les ouvrir.
- Tester les lignes de tunnel transitoires avant les fatales dans `classifyTunnelLine()`.
- Ne jamais écrire dans un flux de journal après `end()`, et garder le gestionnaire `error` sur chaque flux.
- Utiliser `taskkill /T` (ou le groupe de processus sur la VM) pour arrêter un lancement, jamais un simple `kill` du processus enveloppe.
- Garder `APPS` (schéma, onglets, réglages) séparé de `SERVICES` (ressources de calcul).
- La fenêtre Documentation n'atteint jamais directement le Docs Assistant ni son port : tout passe par l'IPC validé.
- Garder identiques les trois implémentations de la numérotation des titres : `docs_lib.py`, `doc-render.js` et le chunker du Docs Assistant.
