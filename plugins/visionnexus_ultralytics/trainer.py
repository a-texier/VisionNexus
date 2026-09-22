"""
Moteur d'entrainement "ultralytics" : contrat TrainingEngine de
Training_App/backend/services/trainer_backend.py.

`ultralytics` n'est importe que dans train() et load_predictor() : importer
ce module (pour lire CATALOG) reste gratuit.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import yaml

from .catalog import CATALOG

_MLFLOW_CALLBACK_MODULE = "utils.callbacks.mlflow"
_LOSS_PREFIX = "train/"
# Dossier des poids pre-entraines telecharges ; par defaut a cote des runs.
PRETRAINED_DIR_ENV = "VISIONNEXUS_PRETRAINED_DIR"


class UltralyticsStopped(Exception):
    """Leve depuis un callback quand stop_flag est arme."""


def prepare_data_yaml(data_yaml: str, out_dir: Path) -> str:
    """Copie de data.yaml dont `path` est absolu.

    Ultralytics resout un `path` relatif contre son dossier global de datasets
    (settings datasets_dir), pas contre le dossier du yaml comme le fait
    VisionNexus : un export d'Annotation, deplace ou dezippe ailleurs, ne
    serait pas trouve.
    """
    source = Path(data_yaml)
    cfg = yaml.safe_load(source.read_text(encoding="utf-8")) or {}
    if str(cfg.get("annotation_file", "")).lower().endswith(".ver"):
        raise ValueError(
            "dataset au format .ver : ce moteur ne lit que les labels YOLO .txt "
            "(exporter le dataset en YOLO depuis Annotation_App)."
        )
    root = Path(cfg.get("path") or source.parent)
    if not root.is_absolute():
        root = (source.parent / root).resolve()
    cfg["path"] = str(root)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "data_resolved.yaml"
    target.write_text(yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return str(target)


def pretrained_weights(model_size: str, output_dir: str) -> Path:
    """Chemin des poids pre-entraines COCO d'une taille.

    Un nom nu ("yolo11n.pt") serait telecharge dans le dossier courant du
    processus, qui varie selon le lanceur : on fixe un dossier stable, que
    YOLO() remplit au premier usage puis reutilise.
    """
    base = os.environ.get(PRETRAINED_DIR_ENV, "").strip()
    folder = Path(base) if base else Path(output_dir).parent / "pretrained"
    return folder / f"{model_size}.pt"


@contextmanager
def preserve_cuda_visibility() -> Iterator[None]:
    """Empeche un run CPU de masquer le GPU au reste du processus.

    Ultralytics ecrit CUDA_VISIBLE_DEVICES ("-1" pour device="cpu", "" dans
    d'autres chemins) dans l'environnement du processus et ne le retablit
    pas. Si CUDA s'initialise ensuite, torch ne voit plus aucun GPU : dans
    Training_App, qui enchaine les runs dans un meme processus, tous les runs
    suivants (YOLOX compris) et les predictions echouaient ("Invalid device
    id"). CUDA est donc initialise AVANT, avec la vraie visibilite, et le
    nombre de GPU lu tout de suite : torch ne le fige qu'au premier
    device_count() suivant l'initialisation, et le lirait sinon pendant que
    la variable est modifiee (0 GPU pour le reste du processus). La variable
    est quand meme retablie en sortie pour les sous-processus lances plus tard.
    """
    import torch

    if torch.cuda.is_available():
        torch.cuda.init()
        torch.cuda.device_count()
    before = os.environ.get("CUDA_VISIBLE_DEVICES")
    try:
        yield
    finally:
        if before is None:
            os.environ.pop("CUDA_VISIBLE_DEVICES", None)
        else:
            os.environ["CUDA_VISIBLE_DEVICES"] = before


@contextmanager
def weights_downloaded_into(folder: Path) -> Iterator[None]:
    """Garde dans `folder` les poids qu'Ultralytics telecharge de lui-meme.

    Le controle AMP charge un petit modele au premier entrainement GPU, et
    Ultralytics ecrit un tel telechargement dans le dossier courant du
    processus -- souvent le depot lui-meme, ou un poids n'a rien a faire (le
    packaging des bundles les refuse). Son reglage `weights_dir` ne sert qu'a
    RETROUVER un poids deja present : on le pointe donc sur `folder` (les runs
    suivants n'ont plus rien a telecharger) et on y deplace ce qui a malgre
    tout atterri dans le dossier courant. Le reglage est pose sans passer par
    son setter, pour ne pas reecrire le fichier de configuration global de
    l'utilisateur.
    """
    from ultralytics.utils import SETTINGS

    folder.mkdir(parents=True, exist_ok=True)
    before_setting = SETTINGS.get("weights_dir")
    dict.__setitem__(SETTINGS, "weights_dir", folder)
    cwd = Path.cwd()
    before_files = set(cwd.glob("*.pt"))
    try:
        yield
    finally:
        dict.__setitem__(SETTINGS, "weights_dir", before_setting)
        for stray in set(cwd.glob("*.pt")) - before_files:
            target = folder / stray.name
            try:
                if target.exists():
                    stray.unlink()
                else:
                    stray.replace(target)
            except OSError:
                pass  # fichier verrouille : on le laisse plutot que d'echouer le run


def strip_mlflow_callbacks(trainer) -> None:
    """Retire le callback d'integration MLflow d'Ultralytics.

    Training_App journalise deja le run (avec graph_id/orch_run_id) ; laisse
    actif, ce callback cree un second run MLflow orphelin, dans un store
    runs/mlflow relatif au dossier courant. Il est ajoute a la creation du
    trainer (add_integration_callbacks), pas du modele : le filtrer sur
    YOLO().callbacks ne suffit pas, d'ou ce passage sur trainer.callbacks au
    tout premier evenement, avant que MLflow ne s'initialise
    (on_pretrain_routine_end).
    """
    for event, callbacks in trainer.callbacks.items():
        if event == "on_pretrain_routine_start":
            continue  # liste en cours de parcours ; MLflow n'y est pas inscrit
        callbacks[:] = [
            cb for cb in callbacks
            if not getattr(cb, "__module__", "").endswith(_MLFLOW_CALLBACK_MODULE)
        ]


def epoch_payload(trainer) -> dict:
    """Payload on_epoch_end (meme forme que le moteur YOLOX) depuis un
    BaseTrainer Ultralytics en fin d'epoque (apres validation)."""
    epoch = int(trainer.epoch) + 1
    total = int(trainer.epochs) or epoch
    loss: dict[str, float] = {}
    if getattr(trainer, "tloss", None) is not None:
        for key, value in trainer.label_loss_items(trainer.tloss, prefix="train").items():
            loss[key.removeprefix(_LOSS_PREFIX)] = float(value)
    metrics = {
        str(k).strip(): float(v)
        for k, v in (getattr(trainer, "metrics", None) or {}).items()
        if v is not None
    }
    return {
        "epoch": epoch,
        "total_epochs": total,
        "progress_pct": round(epoch / total * 100, 1),
        "loss": loss,
        "metrics": metrics,
    }


def train_kwargs(hyperparams: dict[str, Any], data_yaml: str, output_dir: str, run_name: str) -> dict:
    """Arguments de YOLO.train() : hyperparametres connus du catalogue,
    device vide = choix automatique d'Ultralytics."""
    kwargs: dict[str, Any] = {
        "data": data_yaml,
        "project": str(output_dir),
        "name": run_name,
        "exist_ok": True,
        "verbose": False,
        "plots": True,
    }
    for key in CATALOG["defaults"]:
        if key in hyperparams and hyperparams[key] not in (None, ""):
            kwargs[key] = hyperparams[key]
    return kwargs


class UltralyticsEngine:
    CATALOG = CATALOG

    def __init__(
        self,
        *,
        model_size: str,
        data_yaml: str,
        run_name: str,
        output_dir: str,
        hyperparams: dict[str, Any],
        model_weights: str = "",
        stop_flag=None,
        on_epoch_end: Callable[[dict], None] | None = None,
    ) -> None:
        self.model_size = model_size
        self.data_yaml = data_yaml
        self.run_name = run_name
        self.output_dir = output_dir
        self.hyperparams = dict(hyperparams)
        self.model_weights = model_weights or str(pretrained_weights(model_size, output_dir))
        self.stop_flag = stop_flag
        self.on_epoch_end = on_epoch_end
        self.run_dir = Path(output_dir) / run_name
        self._last_epoch = 0

    def _check_stop(self, _trainer) -> None:
        if self.stop_flag is not None and self.stop_flag.is_set():
            raise UltralyticsStopped("arret demande")

    def _epoch_end(self, trainer) -> None:
        # Ultralytics rappelle on_fit_epoch_end apres la validation finale de
        # best.pt, avec le numero de la derniere epoque : ce n'est pas une
        # epoque de plus, ses metriques sont renvoyees par train().
        payload = epoch_payload(trainer)
        if payload["epoch"] <= self._last_epoch:
            return
        self._last_epoch = payload["epoch"]
        if self.on_epoch_end is not None:
            self.on_epoch_end(payload)

    def train(self) -> dict:
        from ultralytics import YOLO

        data_yaml = prepare_data_yaml(self.data_yaml, self.run_dir)
        model = YOLO(self.model_weights)
        model.add_callback("on_pretrain_routine_start", strip_mlflow_callbacks)
        model.add_callback("on_train_batch_start", self._check_stop)
        model.add_callback("on_fit_epoch_end", self._epoch_end)

        cache = pretrained_weights(self.model_size, self.output_dir).parent
        with preserve_cuda_visibility(), weights_downloaded_into(cache):
            model.train(**train_kwargs(self.hyperparams, data_yaml, self.output_dir, self.run_name))

        trainer = model.trainer
        self.run_dir = Path(trainer.save_dir)
        best = Path(trainer.best)
        last = Path(trainer.last)
        if not best.is_file():
            best = last
        return {
            "run_dir": str(self.run_dir),
            "best_model_path": str(best) if best.is_file() else "",
            "last_model_path": str(last),
            # Validation finale des poids retenus (best.pt).
            "metrics": epoch_payload(trainer)["metrics"],
        }

    @staticmethod
    def load_predictor(weights: str, model_size: str, class_names: list[str], imgsz: int = 640):
        """predict(frame_bgr) -> [(x1, y1, x2, y2, conf, cls_id)], coordonnees
        de l'image d'origine (meme contrat que le moteur YOLOX)."""
        from ultralytics import YOLO

        model = YOLO(weights)

        def predict(frame) -> list[tuple]:
            with preserve_cuda_visibility():
                result = model.predict(frame, imgsz=imgsz, verbose=False)[0]
            boxes = result.boxes
            if boxes is None or len(boxes) == 0:
                return []
            xyxy = boxes.xyxy.cpu().numpy()
            confs = boxes.conf.cpu().numpy()
            classes = boxes.cls.cpu().numpy()
            return [
                (float(x1), float(y1), float(x2), float(y2), float(c), int(k))
                for (x1, y1, x2, y2), c, k in zip(xyxy, confs, classes, strict=True)
            ]

        return predict
