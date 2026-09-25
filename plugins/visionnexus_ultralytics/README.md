# Plugin Ultralytics

Ajoute Ultralytics comme moteur d'entrainement optionnel des apps VisionNexus, a cote du moteur
YOLOX maison qui reste le moteur par defaut. Le coeur ne depend de rien d'Ultralytics : tout le
code qui l'importe est dans ce dossier.

## Licence

Ultralytics est distribue sous **AGPL-3.0**. Le code de ce dossier en depend directement : il
n'est donc distribue que sous AGPL-3.0, et **n'est pas couvert par la licence commerciale**
decrite dans `COMMERCIAL_LICENSE.md`. C'est la raison pour laquelle il vit dans ce dossier isole,
present uniquement sur la branche `ultralytics` du depot et dans les bundles complets :

| Branche | Contenu | Licences possibles |
|---|---|---|
| `main` | coeur YOLOX, sans ce dossier | AGPL-3.0 ou commerciale |
| `ultralytics` | `main` + `plugins/visionnexus_ultralytics/` | AGPL-3.0 uniquement |

L'ecart entre les deux branches est exactement ce dossier, plus l'encart de licence du README
(`BRANCH_LICENCE.md`). Ceci n'est pas un avis juridique : a faire valider avant toute
redistribution commerciale.

## Activation

Aucune installation du plugin lui-meme : sa presence dans `plugins/` suffit. Il faut seulement que
la bibliotheque soit installee dans l'environnement des apps (le meme env conda que Training_App) :

```bash
pip install ultralytics
```

Sans elle, le plugin reste liste par `/api/capabilities` mais marque indisponible, avec la raison,
et les apps continuent sur YOLOX.

## Ce que le plugin ajoute

| App | Ajout |
|-----|-------|
| Training_App | moteur `ultralytics` : familles YOLOv8 / YOLO11 / YOLO26, poids `.pt`, plots natifs ([docs](docs/Training_App/moteur-ultralytics.md)) |
| Optuna_App | trials HPO sur ce moteur, avec ses propres plages de recherche ([docs](docs/Optuna_App/moteur-ultralytics.md)) |
| Orchestrator_App | choix du moteur sur les noeuds Modele / Training / Optuna ([docs](docs/Orchestrator_App/moteur-ultralytics.md)) |

Ces pages sont ajoutees a l'onglet Documentation de l'app concernee, uniquement quand le plugin
est present.

Le contrat auquel se conforme ce plugin (decouverte, catalogue, plots) est decrit dans
[docs/architecture.md](../../docs/architecture.md#plugin-mechanism) a la racine du depot.

## Structure

```
__init__.py   manifeste PLUGIN (rien d'importe : lu a chaque decouverte)
catalog.py    CATALOG du moteur (tailles, hyperparametres, plages HPO, plots) -- sans ultralytics
trainer.py    UltralyticsEngine : entrainement, arret, metriques par epoque, predicteur
tests/        pytest (catalogue, preparation, vrais runs courts marques slow)
docs/<App>/   pages ajoutees a la doc des apps concernees
```

## A faire (portage)

- Inference_App : detecteur MOT (`visionnexus.detector_backends`) pour le tracking live et
  l'evaluation de poids `.pt`. Tant que ce n'est pas fait, l'Orchestrator refuse un graphe qui
  enverrait des poids Ultralytics vers une Inference.
- Annotation_App : pre-annotation par detection YOLO, via le meme detecteur.

## Tests

```bash
python -m pytest plugins/visionnexus_ultralytics/tests            # tout, dont de vrais runs courts
python -m pytest plugins/visionnexus_ultralytics/tests -m "not slow"
```

Les tests n'utilisent jamais de poids pre-entraines (architecture depuis `yolov8n.yaml`) : aucun
telechargement, aucun acces reseau.
