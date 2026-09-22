# Plugins

Le coeur de VisionNexus fournit un moteur d'entrainement YOLOX (Apache-2.0). Un plugin peut y
ajouter d'autres moteurs, sans qu'aucune ligne du coeur n'en depende : les interfaces ne
connaissent que les catalogues que les plugins publient.

## Decouverte

Un plugin est un package Python ordinaire range dans `plugins/` a la racine du depot : **aucune
installation pip du plugin**, sa presence suffit. `_lib/plugin_registry.py` lit le dict `PLUGIN` de
son `__init__.py` :

```python
PLUGIN = {
    "label": "Mon moteur",
    "requires": ["ma_bibliotheque"],   # verifie sans import (find_spec)
    "extensions": {
        "visionnexus.trainer_backends": {"mon_moteur": "mon_plugin.trainer:MonEngine"},
    },
}
```

- `__init__.py` ne doit rien importer : il est lu a chaque decouverte.
- Une cible `module:attribut` n'est importee que lorsqu'elle est demandee ; le module cible doit
  lui-meme rester leger (sa bibliotheque d'entrainement n'est importee que dans `train()`).
- Si une dependance de `requires` manque, le plugin reste liste mais marque indisponible, avec la
  raison, et n'est propose nulle part.
- Un package installe declarant l'entry point du meme groupe est aussi accepte.

## Moteur d'entrainement (`visionnexus.trainer_backends`)

Utilise par Training_App, Optuna_App (trials HPO) et l'Orchestrator (noeuds Model, Training,
Optuna). Contrat : `TrainingEngine` dans
[`trainer_backend.py`](../../Training_App/backend/services/trainer_backend.py) ; reference
complete : le moteur YOLOX, [`yolox_engine.py`](../../Training_App/backend/services/yolox_engine.py)
et son catalogue [`yolox_catalog.py`](../../Training_App/backend/services/yolox_catalog.py).

```python
class MonEngine:
    CATALOG = {...}   # voir ci-dessous

    def __init__(self, *, model_size, data_yaml, run_name, output_dir, hyperparams,
                 model_weights="", stop_flag=None, on_epoch_end=None): ...

    def train(self) -> dict:
        """Bloquant. on_epoch_end({"epoch", "total_epochs", "progress_pct", "loss", "metrics"})
        a chaque epoque, metriques nommees "metrics/mAP50(B)", "metrics/mAP50-95(B)",
        "metrics/precision(B)", "metrics/recall(B)". Renvoie {"run_dir", "best_model_path",
        "last_model_path"} et, en option, "metrics" (revalidation des poids finaux)."""

    @staticmethod
    def load_predictor(weights, model_size, class_names, imgsz=640):
        """Optionnel : predict(frame_bgr) -> [(x1, y1, x2, y2, conf, cls_id)], coordonnees de
        l'image d'origine (cas d'inference de l'historique Training)."""
```

Arret : quand `stop_flag` est arme, le moteur sort de `train()` au plus vite, en levant ce qu'il
veut ; Training_App traite toute sortie survenue apres l'arret comme un arret propre.

### Catalogue

Tout ce que les interfaces affichent d'un moteur vient de `CATALOG` (cles obligatoires :
`CATALOG_KEYS` de `trainer_backend.py`) :

| Cle | Role |
|-----|------|
| `label` | libelle affiche |
| `weights_suffixes` | extensions des poids du moteur ; d'autres poids sont refuses avant lancement |
| `sizes`, `default_size`, `size_prefix` | tailles proposees (le prefixe est retire des boutons) |
| `defaults` | hyperparametres et valeurs par defaut ; une cle absente d'ici est ignoree |
| `groups` | formulaire : groupes de champs `{key, label, type, min, max, step, placeholder}` |
| `keys` | traduction des champs generiques `epochs`, `batch`, `imgsz`, `workers` |
| `hpo_ranges`, `hpo_default_optimize` | plages Optuna et selection par defaut |
| `artifacts`, `train_batches_glob` | plots produits, par categorie (`summary`, `confusion`, `curves`, `labels`, `val_labels`, `val_predictions`), chemins relatifs au dossier du run, du prefere au moins prefere |
| `pretrained_by_default` | poids de depart implicites (texte d'aide des formulaires) |

Les plots declares alimentent la galerie de Training_App, les Insights de l'Orchestrator et le run
MLflow (sous `plots/`) : c'est au moteur de les produire sous les noms qu'il declare.

### Ce que voit l'utilisateur

`GET /api/capabilities` (Training_App) liste les moteurs, leur disponibilite et leurs catalogues.
Une interface n'affiche un choix de moteur que si plusieurs sont disponibles ; sans plugin, seul
YOLOX revient et rien n'apparait. Le moteur d'un run voyage avec ses poids (base, MLflow, reponse
de l'orchestrateur) : des poids ne se rechargent qu'avec leur moteur.

## Detecteur d'inference (`visionnexus.detector_backends`)

Utilise par Inference_App. Le contrat minimal est defini dans
[`detectors.py`](../../Inference_App/backend/inference_core/detectors.py) :

```python
class Detector(Protocol):
    class_names: list[str]

    def predict(self, frame) -> list[Detection]: ...
```

Le constructeur du plugin recoit `model_path`, `model_size`, `class_names`,
`confidence`, `iou`, `imgsz` et `device`. Il peut retourner les objets
`Detection` natifs ou des tuples `(x1, y1, x2, y2, score, class_id,
class_name)`. ByteTrack reste une option du pipeline Inference App et ne fait
pas partie du plugin detecteur.

## Documentation d'un plugin

Un plugin documente ce qu'il ajoute a chaque app dans `plugins/<plugin>/docs/<App>/*.md` (par
exemple `docs/Training_App/`). Le lanceur ajoute ces pages a l'onglet de l'app concernee, a la
suite de sa propre doc, seulement la ou le plugin est present.
