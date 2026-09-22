"""
Plugin Ultralytics de VisionNexus.

Seul endroit du depot autorise a importer `ultralytics`. Ce dossier n'existe
que sur la branche Git `ultralytics` et dans les bundles complets : la
publication de `main` le retire, puis un audit verifie qu'aucun import ni
aucune mention visible ne subsiste ailleurs (voir publish_github.py).

Ce fichier est lu a chaque decouverte par _lib/plugin_registry.py : il ne
doit rien importer, et surtout pas ultralytics lui-meme.
"""

PLUGIN = {
    "label": "Ultralytics",
    "requires": ["ultralytics"],
    "extensions": {
        # Training_App + Optuna_App (et donc les noeuds Training/Optuna de
        # l'Orchestrator).
        "visionnexus.trainer_backends": {
            "ultralytics": "visionnexus_ultralytics.trainer:UltralyticsEngine",
        },
        "visionnexus.detector_backends": {
            "ultralytics": "visionnexus_ultralytics.detector:UltralyticsDetector",
        },
    },
}
