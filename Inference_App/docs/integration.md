# Intégration VisionNexus

## VisionNexusElectron

L'identifiant public reste `inference`. Le registre commun pointe vers
`Inference_App/backend/main.py` et `Inference_App/frontend`. Les ports par
défaut restent 8065 et 5177 ; le registre partagé les décale si nécessaire.

Les endpoints essentiels sont :

- `GET /health` ;
- `GET /api/capabilities` ;
- `POST /api/media/inspect` ;
- `POST /api/runs`, puis `GET /api/runs/{id}` ;
- `POST /api/orchestrator/infer` ;
- `POST /api/orchestrator/evaluate`.

## Orchestrator

Le nœud envoie le moteur, le fichier de poids, la source, le mode et les
overrides issus du YAML. Le moteur est toujours explicite ; un checkpoint d'un
plugin n'est jamais interprété comme un checkpoint YOLOX.

Pour une inférence multi-objet avec association :

```json
{
  "sequence_dir": "C:/data/video.mp4",
  "model_path": "C:/models/best.pth",
  "engine": "yolox",
  "model_size": "yolox-s",
  "tracker_mot": "bytetrack",
  "overrides": {"confidence": 0.25, "iou": 0.45}
}
```

## Configuration

`config/defaults.yaml` est le schéma lisible par l'Orchestrator. Dans
l'application, une modification est enregistrée dans `config.yaml` au niveau
du workspace utilisateur : le fichier source du dépôt reste intact.

