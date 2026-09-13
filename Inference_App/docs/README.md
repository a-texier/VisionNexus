# Documentation - Inference_App

Index thematique. Pour une vue d'ensemble rapide (lancement, structure), voir le
[`README.md`](../README.md) a la racine de l'app.

> **Hors perimetre** : `tracker/trackers/` (BoT-SORT, BoostTrack, ByteTrack,
> OSTrack, deep-person-reid, fast_reid, pytracking, YOLOX, TrackEval) est du code
> tiers vendored, documente par ses propres README/docs upstream. Cette
> documentation ne le couvre pas.

## Table des matieres

| Document | Contenu |
|---|---|
| [`architecture.md`](architecture.md) | Vue d'ensemble app (FastAPI + React + tracker vendored), arborescence, formats de donnees/GT/cameras, flux `run_session`, lancement CLI, API backend, noeud Orchestrator |
| [`algorithms.md`](algorithms.md) | Filtre de Kalman `custom_kalman` (maths), differences ByteTrack/BoT-SORT/BoostTrack, optimisation temps-reel |
| [`state-machine.md`](state-machine.md) | Machine d'etats MOT/SOT (`pipeline/state_machine.py`) : tous les cas, dual-SOT, keepalive |
| [`track-objects.md`](track-objects.md) | Objets track (`Track`, `_TrackAdapter`, `_SotTrack`...) et leur contrat duck-typing |
| [`deployment.md`](deployment.md) | Deploiement air-gap : conteneur Podman, zip standalone, reseau MJPEG (scenarios distribues), build depuis Windows/WSL |
| [`zmq_integration.md`](zmq_integration.md) | Protocole ZMQ binaire configurable via ZMQ (capteur C++ temps reel) |
| [`quality.md`](quality.md) | Chaine qualite du tracker (`quality/quality.py` : ruff, mypy, bandit, pytest) |
| [`developer-reference.md`](developer-reference.md) | Guide developpeur complet, module par module (relocalise depuis `tracker/code_explication/DEVELOPER.md`) |

## Parcours rapides

**Je veux lancer l'app** -> [`README.md`](../README.md) racine (backend + frontend),
puis [`architecture.md`](architecture.md#lancer-en-cli-standalone-hors-app-web)
pour lancer le tracker seul en CLI.

**Je veux comprendre comment le tracker est embarque dans l'app** ->
[`architecture.md`](architecture.md).

**Je veux modifier ou ajouter un tracker/detecteur/camera** ->
[`developer-reference.md`](developer-reference.md) (guides pratiques, section 15),
puis [`algorithms.md`](algorithms.md) pour les maths sous-jacentes.

**Je veux deployer sur la cible embarquee** -> [`deployment.md`](deployment.md).

**Je debug la machine d'etats MOT/SOT (clic ignore, decrochage inattendu...)** ->
[`state-machine.md`](state-machine.md) puis [`track-objects.md`](track-objects.md).

**Je branche un capteur C++ via ZMQ** -> [`zmq_integration.md`](zmq_integration.md).

**Je verifie la qualite avant de commit** -> [`quality.md`](quality.md).
