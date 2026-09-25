---
app: suite
doc_type: readme
audience: both
lang: fr
title: VisionNexus
order: 0
tags: [visionnexus, lanceur, suite, catalogue, ssh, apps]
sources: [launcher.py, _lib/launcher_engine.py, desktop/src/main.ts, desktop/src/catalog.ts, desktop/ui/catalog.html]
---

# VisionNexus

## Ce que sont VisionNexus et la suite

VisionNexus est le lanceur de bureau d'une suite modulaire de vision par ordinateur. La suite est un ensemble d'applications indépendantes pour explorer, annoter, entraîner, évaluer et versionner des jeux d'images ; chaque application a son propre backend (FastAPI), son propre frontend (React et Vite) et son propre workspace par utilisateur. VisionNexus est la fenêtre depuis laquelle vous les démarrez, les surveillez et passez de l'une à l'autre.

- **Un catalogue, un clic par app** : le catalogue affiche chaque application sous forme de tuile sur un schéma de flux. Un clic démarre l'application sur votre machine ou sur une machine Linux GPU distante, attend qu'elle réponde, puis l'ouvre dans un onglet de la fenêtre VisionNexus.
- **Local ou distant, même geste** : sans VM sélectionnée, tout s'exécute sur votre machine Windows ; avec une VM sélectionnée, les applications tournent sur la VM (via SSH, sur son GPU) et seule leur interface s'affiche chez vous, à travers des tunnels SSH automatiques.
- **Des réglages saisis une fois** : utilisateur, workspace, racine du dépôt et environnement conda sont enregistrés dans votre profil Windows et réutilisés par chaque lancement.
- **Des ressources de calcul** : les services sans interface, comme le Docs Assistant qui cherche dans cette documentation, s'allument et s'éteignent depuis le même catalogue.
- **Une documentation intégrée** : la fenêtre **Documentation** affiche les pages de chaque app et de la suite, et répond aux questions saisies en langage naturel.

Le lanceur est lui-même un petit programme Electron (le dossier `desktop/`) qui pilote le lanceur Python `launcher.py` du dépôt. Rien ne change pour les applications : chacune peut toujours être démarrée en ligne de commande.

## Les apps de la suite et leur enchaînement

Le catalogue regroupe les applications dans un cadre nommé **Orchestrator + 7 applications**, plus une application autonome placée en dessous.

| App | Rôle dans la suite |
|---|---|
| **Orchestrator** | Éditeur visuel de pipelines qui enchaîne les autres apps en HTTP et les démarre automatiquement |
| **Dataset Explorer** | Explore un jeu d'images avec des embeddings CLIP et sélectionne des sous-ensembles |
| **Annotation** | Annote images et séquences, à la main ou avec l'aide de l'IA, et exporte des jeux de données |
| **Optuna** | Cherche les meilleurs hyperparamètres d'un entraînement |
| **Training** | Entraîne des modèles de détection |
| **Inference** | Exécute un modèle entraîné sur des médias et l'évalue |
| **MLflow** | Suit les expériences et les modèles |
| **DVC** | Versionne jeux de données et sorties avec Git et DVC |

La chaîne typique est Dataset Explorer, puis Annotation, puis Optuna et Training, puis Inference, avec DVC et MLflow qui observent les résultats. L'Orchestrator dessine cette chaîne sous forme de graphe et l'exécute ; chaque app fonctionne aussi seule. Le Docs Assistant n'est pas une app mais une ressource de calcul : il n'a ni onglet ni tuile dans le schéma. Les rôles, les workspaces et la façon dont les apps se parlent sont expliqués dans [Concepts](concepts.fr.md).

## Démarrage rapide en cinq étapes

Ce démarrage rapide suppose que le dépôt est présent sur la machine qui exécutera les applications et que Python et Node.js y sont installés. Les prérequis sont listés dans [Configuration](configuration.fr.md).

1. Lancez `VisionNexusElectron.exe` (ou exécutez `npm start` dans `desktop/`).
2. Dans le panneau **Parametres** à droite, renseignez **Utilisateur**, **Workspace**, **Racine Computer_Vision_App** et **Chemin conda**, puis cliquez sur **Enregistrer**. Le bandeau orange devient vert.
3. Laissez **VM cible** sur **(local, pas de VM)** pour travailler sur cette machine, ou choisissez une VM pour travailler via SSH.
4. Cliquez sur une tuile du schéma, par exemple **Annotation**. Le panneau **Lancements** affiche le journal de démarrage.
5. Quand l'application répond, son onglet apparaît à côté de l'onglet **VisionNexus**. Cliquez sur **Tutoriel** à tout moment pour une visite guidée du lanceur.

## Pages de documentation de VisionNexus

La documentation de la suite est répartie en neuf pages. Chaque application a son propre jeu de neuf pages, accessible depuis la fenêtre **Documentation**.

- [Guide utilisateur](user-guide.fr.md) : la fenêtre VisionNexus écran par écran, du schéma et des onglets au panneau des ports, aux réglages et à la fenêtre Documentation.
- [Procédures](workflows.fr.md) : des tâches complètes en étapes numérotées : premier lancement, exécution en local, travail sur une VM Linux GPU, lecture des images sur un partage réseau, enchaînement d'un pipeline, arrêt de tout.
- [Concepts](concepts.fr.md) : rôles des apps, workspaces et utilisateurs, exécution locale et sur VM, ports et tunnels, chemin réseau natif, plugins et poids hors ligne.
- [Configuration](configuration.fr.md) : prérequis, ligne de commande du lanceur, variables d'environnement, ports, arborescence du workspace, prérequis de la VM, poids de modèles, construction de l'app de bureau.
- [Dépannage](troubleshooting.fr.md) : les problèmes décrits par leur symptôme, avec cause et solution.
- [Sécurité](security.fr.md) : qui peut atteindre une application lancée, serveurs liés à la boucle locale, tunnels SSH, jeton de session de chaque instance, ouverture dans un navigateur externe, et limites de ces protections.
- [Architecture](architecture.fr.md) : le modèle de processus Electron, le flux de lancement, les tunnels, le gestionnaire de services, le moteur du lanceur, le mécanisme de plugins et la chaîne de documentation.
- [Référence API](api-reference.fr.md) : la ligne de commande du lanceur, le contrat de sortie standard, le contrat des backends et les canaux IPC de l'app de bureau.
- [Carte du code](code-map.fr.md) : où vit chaque fonctionnalité et où la modifier, et la checklist pour ajouter une nouvelle app à la suite.
