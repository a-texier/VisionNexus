# VisionNexus Tracker (vendored)

Pipeline de tracking MOT/SOT pour sequences IR, embarque dans Inference_App et
pilote in-process par le backend (`backend/services/tracker_bridge.py`).

Documentation complete : [`../docs/README.md`](../docs/README.md). En
particulier, [`../docs/architecture.md`](../docs/architecture.md) pour
l'arborescence de ce dossier, le flux `run_session()`, et les scenarios /
commandes de lancement en CLI standalone.

```bash
# Run unique, standalone (hors app web)
python main.py --config config_examples/10_mot_sot_interactive.yaml
```

> **`tracker/trackers/`** (BoT-SORT, BoostTrack, ByteTrack, OSTrack,
> deep-person-reid, fast_reid, pytracking, YOLOX, TrackEval) est du code tiers
> vendored, documente par ses propres README/docs upstream -- ne pas le modifier
> ni le documenter ici.
