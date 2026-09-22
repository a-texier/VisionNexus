# ============================================================
# yolox_engine.py -- moteur "yolox" vu a travers le contrat commun
# TrainingEngine (trainer_backend.py).
#
# Rassemble ce que training_service.py et Optuna_App/hpo_trial.py faisaient
# chacun de leur cote (construction de l'Exp, report des hyperparametres,
# choix du checkpoint final), pour que les deux appelants traitent YOLOX et
# les moteurs de plugins exactement de la meme facon.
# ============================================================

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from .yolox_catalog import CATALOG


class YoloxEngine:
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
        self.model_weights = model_weights
        self.stop_flag = stop_flag
        self.on_epoch_end = on_epoch_end
        self.run_dir = Path(output_dir) / run_name

    def train(self) -> dict:
        # Imports tardifs : torch et le yolox vendorise ne sont charges que
        # si ce moteur est reellement utilise.
        from .yolox_dataset import load_data_yaml
        from .yolox_model import build_exp
        from .yolox_trainer import VisionNexusYoloxTrainer

        hp = self.hyperparams
        spec = load_data_yaml(self.data_yaml, "train")
        exp = build_exp(
            self.model_size,
            img_size=int(hp.get("imgsz", 640)),
            num_classes=len(spec.class_names),
        )
        for key, value in hp.items():
            if hasattr(exp, key):
                setattr(exp, key, value)

        trainer = VisionNexusYoloxTrainer(
            exp,
            data_yaml=self.data_yaml,
            run_name=self.run_name,
            output_dir=self.output_dir,
            batch_size=int(hp.get("batch_size", 16)),
            device=str(hp.get("device", "") or ""),
            fp16=bool(hp.get("fp16", False)),
            stop_flag=self.stop_flag,
            on_epoch_end=self.on_epoch_end,
            # Sans fichier de poids, YOLOX part de poids aleatoires.
            resume_ckpt=self.model_weights if Path(self.model_weights or "").is_file() else None,
        )
        trainer.train()

        self.run_dir = Path(trainer.file_name)
        best = self.run_dir / "best_ckpt.pth"
        if not best.exists():
            best = self.run_dir / "last_epoch_ckpt.pth"  # mAP jamais > 0 (run tres court)
        return {
            "run_dir": str(self.run_dir),
            "best_model_path": str(best) if best.exists() else "",
            "last_model_path": str(self.run_dir / "latest_ckpt.pth"),
        }

    @staticmethod
    def load_predictor(weights: str, model_size: str, class_names: list[str], imgsz: int = 640):
        """Renvoie predict(frame_bgr) -> [(x1, y1, x2, y2, conf, cls_id)] en
        coordonnees de l'image d'origine."""
        import torch  # noqa: I001

        # yolox_model pose le chemin du yolox vendorise : il passe en premier.
        from .yolox_model import build_exp, load_checkpoint

        from yolox.data.data_augment import preproc as raw_preproc
        from yolox.utils import postprocess

        exp = build_exp(model_size, img_size=imgsz, num_classes=len(class_names))
        model = exp.get_model()
        load_checkpoint(model, weights)
        model.eval()

        def predict(frame) -> list[tuple]:
            img, ratio = raw_preproc(frame, exp.test_size)
            with torch.no_grad():
                raw = model(torch.from_numpy(img).unsqueeze(0).float())
            out = postprocess(raw, exp.num_classes, exp.test_conf, exp.nmsthre)[0]
            if out is None:
                return []
            return [
                (x1 / ratio, y1 / ratio, x2 / ratio, y2 / ratio, float(obj) * float(cls_conf), int(cls_id))
                for x1, y1, x2, y2, obj, cls_conf, cls_id in out.cpu().numpy()
            ]

        return predict
