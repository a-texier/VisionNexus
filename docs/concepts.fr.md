---
app: suite
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [suite, workspace, utilisateur, ports, tunnel, chemin natif, plugins, hors ligne, ressource de calcul]
sources: [_lib/launcher_engine.py, _lib/plugin_registry.py, desktop/src/catalog.ts, desktop/src/sshLauncher.ts, desktop/src/imageProtocol.ts, desktop/src/main.ts, docs/docs_manifest.json]
---

# Concepts

## La suite et le rôle de chaque app

La suite est faite d'applications indépendantes qui ne partagent rien à l'exécution en dehors de fichiers et d'appels HTTP. Chacune a son propre backend FastAPI, son propre frontend React et son propre dossier de workspace, et chacune démarre et fonctionne seule. Aucune ne connaît l'existence des autres, à une exception près : l'Orchestrator, qui pilote le reste.


Les apps se passent les données par des fichiers du workspace de l'utilisateur, par exemple un jeu de données exporté que Training lit, et par l'Orchestrator, qui appelle des endpoints dédiés `/api/orchestrator/` de chaque app et présente la chaîne sous forme de graphe. C'est pourquoi chaque app fonctionne encore quand l'Orchestrator ne tourne pas. Ce que fait chaque app est documenté dans ses propres pages, disponibles dans la fenêtre **Documentation**.

## Apps et ressources de calcul

VisionNexus lance deux sortes d'éléments. Une **app** a un frontend et un backend : elle a une tuile dans le schéma, s'ouvre dans un onglet et sa durée de vie est celle de l'onglet. Une **ressource de calcul** n'a qu'un backend : elle a une carte avec un interrupteur dans la section **Ressources de calcul**, n'ouvre jamais d'onglet et reste allumée jusqu'à ce que vous l'éteigniez ou fermiez VisionNexus. Le Docs Assistant, qui alimente la recherche dans la documentation, est pour l'instant la seule ressource de calcul.

Les deux sont démarrées par le même lanceur et suivent la même séquence de démarrage : le lanceur annonce le port réel, VisionNexus ouvre un tunnel si une VM est sélectionnée, puis attend que le backend réponde sur `/health`. La différence tient à la suite : pour une app, VisionNexus attend le frontend et ouvre un onglet ; pour une ressource, il se contente de garder le backend joignable afin que d'autres fenêtres, comme **Demander a la doc**, puissent l'appeler par l'intermédiaire de VisionNexus. Une ressource tourne sur la cible sélectionnée au moment où elle a été allumée et la garde jusqu'à son extinction, même si vous sélectionnez une autre VM entre-temps.

## Workspaces et utilisateurs

Les réglages **Utilisateur** et **Workspace** décident où chaque application range ses données. Pour une application dont la clé de lanceur est `<app>`, le dossier de données est `<workspace>/<app>_<utilisateur>`, par exemple `D:/ws/annotation_alice`. La clé est l'identifiant du lanceur, pas le nom affiché : Dataset Explorer utilise `explorer_alice` et le Docs Assistant utilise `docs_alice`.

Cette convention isole les personnes et les applications : deux utilisateurs qui partagent la même racine de workspace n'écrivent jamais dans le même dossier, et un utilisateur qui fait tourner plusieurs applications obtient un dossier par application. Le lanceur crée le dossier de données et quelques sous-dossiers, l'application crée le reste ; la liste est dans [Configuration](configuration.fr.md#arborescence-du-workspace).

L'identifiant est aussi la clé des réservations de ports et apparaît dans la liste des utilisateurs connectés à l'intérieur des applications. C'est pourquoi les noms génériques comme `unknown`, `user`, `default`, `none`, `null`, `admin` et `test` sont refusés : deux personnes qui les utiliseraient partageraient sans avertissement un workspace et ses bases de données. Quand aucun workspace n'est passé en ligne de commande, le lanceur se replie sur un dossier `All_workspaces` à côté du dépôt ; VisionNexus transmet toujours le workspace de ses réglages.

## Exécution locale et exécution sur VM

VisionNexus exécute la même commande dans les deux modes : `python launcher.py --app <id> --user ... --workspace ... --conda-path ...`. Seul l'endroit où elle s'exécute change. Avec **(local, pas de VM)**, elle s'exécute dans un `cmd.exe` de votre machine Windows. Avec une VM sélectionnée, elle s'exécute sur cette VM via `ssh`, et sa sortie revient dans le panneau **Lancements**.

Chaque chemin des réglages est lu par la machine qui exécute la commande. En mode local, **Workspace**, **Racine Computer_Vision_App** et **Chemin conda** sont des chemins Windows ; en mode VM, ce sont des chemins Linux de la VM. Les onglets d'application parlent toujours à `127.0.0.1` : avec une VM, des tunnels portent ces ports locaux vers les mêmes numéros de ports sur la VM.

Le mode VM sert au travail sur GPU avec des jeux de données trop gros pour un portable, tout en gardant une interface locale. Il change aussi deux choses : les images transitent par le tunnel sauf si le chemin réseau natif est disponible, et les processus vivent sur une machine que vous ne voyez pas, ce qui explique que le panneau **Ports** puisse les y lister et les y tuer.

## Ports, allocation dynamique et tunnels

Chaque app a un port de base pour son backend et un pour son frontend, listés dans [Configuration](configuration.fr.md#ports-de-base-de-chaque-application). Ce sont des points de départ, pas des valeurs fixes. Au lancement, le lanceur balaie vers le haut à partir de la base jusqu'à trouver un port libre sur la machine et non réclamé par une autre instance du registre, sur 200 candidats au plus, puis annonce les ports qu'il a choisis. VisionNexus ne suppose jamais un port : il lit ceux qui sont annoncés. C'est ce qui permet à plusieurs utilisateurs, ou à plusieurs instances d'une même app, de partager une machine.

Avec une VM, VisionNexus ouvre une seconde connexion SSH en simple tunnel (`ssh -N -L port:localhost:port`) pour exactement ces ports, avec le même numéro en local et à distance. Auparavant, il vérifie que ces numéros sont libres sur votre machine Windows, car un port local occupé enverrait votre onglet vers un autre serveur. Le tunnel est ouvert avec `ExitOnForwardFailure`, si bien qu'un forward refusé est signalé au lieu d'être ignoré en silence, et il envoie des messages de maintien de connexion pour qu'une connexion morte soit détectée.

## Le registre d'instances partagé

Chaque lancement écrit une entrée dans un petit fichier JSON, `.run/.instances.json`, à la racine du dépôt sur la machine cible. Une entrée enregistre l'application, l'utilisateur, les deux ports, le workspace, le numéro de processus du lanceur et l'heure de démarrage. Le lanceur le lit pour éviter les ports réclamés par d'autres utilisateurs sur une VM partagée, et supprime les entrées dont le processus n'existe plus.

Un fichier de verrou voisin, `.run/.port_lock`, sérialise l'allocation des ports pour que deux lancements simultanés ne choisissent jamais le même port. Les applications lisent aussi le registre, pour lister les utilisateurs actuellement connectés. VisionNexus le lit pour le panneau **Ports** : un port qui appartient à une entrée sans aucun onglet chez vous s'affiche comme **app active**.

## Le chemin réseau natif


Pour chaque image, le frontend de l'application demande à son propre backend le chemin du fichier sur le partage, puis VisionNexus lit ce fichier directement sur le partage, avec des délais courts et un cache mémoire d'environ 150 Mo. Si une étape échoue (partage injoignable, fichier introuvable, backend qui ne répond pas), l'image est récupérée en HTTP par le tunnel à la place, si bien que vous ne voyez jamais d'image cassée. L'étiquette de l'onglet affiche **SMB** quand le chemin est actif et **HTTP** quand l'application s'est repliée.

Le chemin est considéré comme actif quand l'hôte a répondu au bouton **Tester**, et toujours en mode local, où les fichiers sont lus sur le disque local. Le côté serveur du partage, par exemple le dossier de la VM exposé par un serveur de fichiers, n'est pas créé par VisionNexus et doit déjà exister. La lecture native est tentée à chaque requête : un partage qui disparaît ne fait donc que ralentir les images suivantes.

## Plugins : moteurs d'entraînement, détecteurs et pages supplémentaires

Le cœur de la suite inclut un moteur d'entraînement YOLOX. Un plugin peut ajouter d'autres moteurs ou détecteurs sans que le cœur en dépende. Un plugin est un package Python placé dans le dossier `plugins/` du dépôt : sa simple présence le rend visible, et retirer le dossier le rend de nouveau invisible, sans autre modification.

Un plugin déclare ce qu'il fournit, par exemple un moteur d'entraînement pour Training, Optuna et l'Orchestrator, ou un détecteur pour Inference. Si l'une des bibliothèques dont il a besoin manque, le plugin reste listé mais marqué indisponible, avec la raison, et n'est proposé nulle part. Les interfaces n'affichent un choix de moteur que lorsque plusieurs moteurs sont disponibles ; sans plugin, le choix n'apparaît pas. Un plugin peut aussi ajouter des pages de documentation à une app, affichées après les pages propres de l'app, uniquement là où le plugin est présent. Les contrats sont dans [Architecture](architecture.fr.md#mécanisme-de-plugins).

## Poids de modèles et fonctionnement hors ligne

Les applications ne téléchargent pas de poids de modèles pendant leur exécution. Les poids sont des fichiers que vous placez dans les dossiers des apps qui les utilisent (SAM2, Grounding DINO, CLIP, le modèle d'embeddings du Docs Assistant...), comme le liste [MODEL_WEIGHTS.md](../MODEL_WEIGHTS.fr.md). Cela rend prévisibles les déploiements sur des machines sans accès à Internet, et un fichier manquant produit un message clair au lieu d'un téléchargement silencieux.


## Jeux de documentation et jumeaux de langue


Les deux fichiers d'une page ont la même suite de titres, si bien que chaque section a une jumelle dans l'autre langue. La fenêtre **Documentation** et le Docs Assistant s'appuient sur ce lien pour proposer la même section dans l'autre langue. La liste des sources, des pages et de leur public est conservée dans `docs/docs_manifest.json`.
