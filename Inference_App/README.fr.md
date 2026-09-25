*[Read in English](README.md)*

# VisionNexus Inference App

Application publique et compacte pour exécuter un modèle YOLO sur une image,
une vidéo ou un dossier d'images.

## Fonctions

- lecture de `png`, `jpg`, `jpeg`, `bmp`, `tif`, `webp`, `mp4`, `avi`, `mov`,
  `mkv` et `webm` ;
- inférence YOLO pure, sans tracker imposé ;
- détection multi-objet avec ByteTrack facultatif ;
- suivi mono-objet : clic sur une détection YOLO, puis suivi CSRT OpenCV ;
- évaluation détection : mAP50, mAP50–95, courbe PR, courbe F1 et matrice de
  confusion ;
- benchmark séparé du temps détecteur, du temps tracker et du pipeline complet ;
- configuration YAML par workspace ;
- intégration au lanceur VisionNexusElectron et au nœud Inference de
  l'Orchestrator.

YOLOX est le moteur natif. D'autres moteurs peuvent être ajoutés par le registre
de plugins sans modifier cette application.

## Lancement

Depuis la racine `Computer_Vision_App` :

```powershell
python launcher.py --app inference --workspace C:\VisionNexusWorkspaces --user alice
```

Le backend utilise le port 8065 et le frontend le port 5177 par défaut. Le
lanceur commun choisit automatiquement d'autres ports en cas de conflit.

## Organisation

```text
Inference_App/
  backend/
    main.py                 API FastAPI
    inference_core/
      media.py              lecture média
      detectors.py          YOLOX + contrat de plugins
      bytetrack.py          association MOT optionnelle
      runner.py             inférence, MOT et SOT/CSRT
      evaluation.py         métriques et plots détection
  config/defaults.yaml      réglages documentés
  frontend/                 interface React/Vite
  docs/                     architecture et intégration
  tests/                    tests unitaires
```

## Tests

```powershell
pytest Inference_App/tests -q
cd Inference_App/frontend
npm run build
```

