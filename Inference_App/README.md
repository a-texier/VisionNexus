# Inference App - tracker MOT/SOT unifie (inference, evaluation, acquisition)

App **unifiee** qui enveloppe un tracker generique **MOT/SOT** (multi-objets +
mono-objet cliquable) et le rend pilotable en IHM web, ainsi que comme noeud de
l'**Orchestrator** (MLOps). Le tracker est embarque **une seule fois** et sert
les trois roles suivants :

- **Tracker** : inference live/headless (SOT operateur, rejeu, benchmark).
- **Evaluation** : detection YOLO (`model.val`) ou tracker MOT/SOT avec verite
  terrain (mAP / MOTA / IDF1, journalise dans MLflow).
- **Acquisition** : capture un flux et sauve les images pour constituer un
  dataset a annoter.

**Regle metier unifiee** : verite terrain fournie -> metriques (MOTA/IDF1 ou
mAP) ; pas de verite terrain -> inference + benchmark temps reel seul. Un seul
flux, un seul panneau de resultats.

---

## Architecture

- **Backend** : FastAPI (`backend/main.py`), routers par domaine (session live,
  evaluation, acquisition, export/deploiement, reglages, orchestrateur).
- **Frontend** : React / TypeScript / Vite (une page par onglet : Tracker,
  Evaluation, Acquisition).
- **Tracker** : vendore dans `tracker/`, pipeline MOT/SOT Python autonome,
  pilote **in-process** (pas de sous-processus) via
  `tracker/pipeline/session.run_session()`. Il embarque plusieurs trackers
  tiers a titre de composants interchangeables : **BoT-SORT**, **ByteTrack**,
  **BoostTrack** (MOT), **SAM2**, **DiMP**, **OSTrack** (SOT).

Detail complet : [`docs/architecture.md`](docs/architecture.md).

---

## Fonctionnalites

**Tracker**
- Session live (webcam / flux reseau) ou rejeu d'une sequence locale.
- Mode interactif : clic pour initialiser un SOT, touches clavier, pause,
  enregistrement de la session.
- Sources multiples : dossier d'images, video, flux HTTP MJPEG, flux ZMQ
  (capteur temps reel).
- Rejeu scripte d'une session enregistree (fichier de clics).

**Evaluation**
- Evaluation de la detection YOLO (`model.val`) ou du tracker MOT/SOT complet,
  avec verite terrain.
- Fenetre `[start_frame, stop_frame]` pour retester une zone precise.
- Historique des evaluations et artefacts (graphes, rapports) consultables.

**Acquisition**
- Capture d'un flux (dossier, video, HTTP MJPEG, ZMQ) vers un dataset d'images
  PNG normalisees.
- Suivi du statut de capture en direct.
- Datasets consultables, exportables vers Dataset Explorer / Annotation pour
  fine-tuner un modele.

---

## Lancer

```bash
# Standalone (independant)
python launcher.py --user bob --workspace C:\...\All_workspaces
#   backend  http://localhost:8065   frontend http://localhost:5177   docs /docs

# Backend seul (dev)
uvicorn backend.main:app --host 0.0.0.0 --port 8065 --reload
```

Conda : **IA_env**. Workspace final : `<workspace>/inference_bob/` (runs,
exports, sequences, cmd_send, acquisitions, `user_settings.json`).

---

## Cibles et environnement

Environnement Python dedie (voir `docs/`), deploiement sur machine x86_64 avec
GPU NVIDIA. Lancement via **VisionNexus** (tuile "Inference / Eval").

---

## Documentation

Point d'entree : [`docs/README.md`](docs/README.md) (index thematique complet).

| Sujet | Fichier |
|---|---|
| Architecture (app + tracker vendore), formats de donnees, lancement CLI | [`docs/architecture.md`](docs/architecture.md) |
| Algorithmes de tracking (Kalman, MOT, temps-reel) | [`docs/algorithms.md`](docs/algorithms.md) |
| Machine d'etats MOT/SOT | [`docs/state-machine.md`](docs/state-machine.md) |
| Objets track | [`docs/track-objects.md`](docs/track-objects.md) |
| Deploiement air-gap (conteneur / natif / reseau / WSL) | [`docs/deployment.md`](docs/deployment.md) |
| Integration ZMQ (capteur C++) | [`docs/zmq_integration.md`](docs/zmq_integration.md) |
| Qualite du code (tracker) | [`docs/quality.md`](docs/quality.md) |
| Guide developpeur complet, module par module | [`docs/developer-reference.md`](docs/developer-reference.md) |

> `tracker/trackers/` (BoT-SORT, BoostTrack, ByteTrack, OSTrack,
> deep-person-reid, fast_reid, pytracking, YOLOX, TrackEval) est du code tiers
> vendore : hors perimetre de cette documentation, voir leurs README/docs
> upstream respectifs.
