# ============================================================
# yolox_trainer.py -- VisionNexusYoloxTrainer, sous-classe de
# yolox.core.trainer.Trainer (vendor/yolox). Remplace le wrapping
# Ultralytics (model.train(**kwargs) + add_callback) par un entrainement
# YOLOX natif branche sur nos propres dataset/metriques/callbacks.
#
# Le Trainer YOLOX vendorise expose deja des points d'ancrage clairs
# (before_train, before_epoch, after_epoch, before_iter, after_iter,
# evaluate_and_save_model) -- pas de boucle a reecrire a la main. Les
# methodes ci-dessous ne sont overridees que la ou le comportement de base
# est specifique a COCO/CUDA/Ultralytics :
#   - __init__ / before_train : le Trainer de base force CUDA
#     ("cuda:{local_rank}" en dur) et un COCODataset -> device configurable,
#     dataset YoloTxtDataset (yolox_dataset.py).
#   - before_iter : ajoute l'arret propre via stop_flag (TrainingStopped),
#     remplace le hack Ultralytics "trainer.epoch = trainer.epochs".
#   - after_iter : identique a la base, sans l'appel exp.random_resize()
#     (hardcode .cuda(), incompatible CPU).
#   - after_epoch : ajoute le callback SSE/MLflow en plus de save_ckpt/eval.
#   - evaluate_and_save_model : detection_metrics.compute_metrics +
#     save_plots + yolox_plots (labels/train_batch au premier appel), au
#     lieu de exp.eval()/COCOEvaluator (pycocotools).
# ============================================================

from __future__ import annotations

import datetime
import sys
import time
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace

import torch

_YOLOX_VENDOR = Path(__file__).resolve().parent.parent / "vendor" / "yolox"
if str(_YOLOX_VENDOR) not in sys.path:
    sys.path.insert(0, str(_YOLOX_VENDOR))

from loguru import logger  # noqa: E402
from yolox.core.trainer import Trainer  # noqa: E402
from yolox.data import (  # noqa: E402
    DataLoader,
    DataPrefetcher,
    InfiniteSampler,
    MosaicDetection,
    TrainTransform,
    ValTransform,
    YoloBatchSampler,
    worker_init_reset_seed,
)
from yolox.utils import ModelEMA, get_model_info, gpu_mem_usage  # noqa: E402

from .detection_metrics import Detection, GroundTruth, compute_metrics, save_plots  # noqa: E402
from .trainer_backend import TrainerStopped  # noqa: E402
from .yolox_dataset import YoloTxtDataset  # noqa: E402
from .yolox_plots import save_dataset_preview_plots, save_val_batch_plots  # noqa: E402

# Nombre d'images de validation gardees pour l'aperçu visuel val_batch0_*.jpg
# (verite terrain / predictions) -- pas tout le val set, juste un coup d'oeil.
_VAL_PREVIEW_N = 16


class TrainingStopped(TrainerStopped):
    """Levee depuis before_iter() quand stop_flag est arme -- arret propre
    (remonte a travers train_in_iter/train_in_epoch/train(), capturee par
    l'appelant dans training_service.py). Sous-classe de TrainerStopped
    (trainer_backend.py) : les appelants attrapent le type de base pour
    rester independants du backend d'entrainement actif."""


def _resolve_device(device: str) -> str:
    if device in ("", "auto", None):
        return "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda" and not torch.cuda.is_available():
        logger.warning("device='cuda' demande mais indisponible -> repli sur cpu")
        return "cpu"
    return device


class VisionNexusYoloxTrainer(Trainer):
    def __init__(
        self,
        exp,
        *,
        data_yaml: str,
        run_name: str,
        output_dir: str,
        batch_size: int = 16,
        device: str = "",
        fp16: bool = False,
        max_labels: int = 120,
        stop_flag=None,
        on_epoch_end: Callable[[dict], None] | None = None,
        resume_ckpt: str | None = None,
    ):
        self.data_yaml = data_yaml
        self.max_labels = max_labels
        self.stop_flag = stop_flag
        self.on_epoch_end = on_epoch_end
        self._eval_plots_dir: Path | None = None
        self._dataset_preview_done = False
        self._last_loss_values: dict = {}

        exp.output_dir = str(output_dir)
        args = SimpleNamespace(
            fp16=fp16,
            batch_size=batch_size,
            experiment_name=run_name,
            occupy=False,
            resume=False,
            ckpt=resume_ckpt,
            start_epoch=None,
            cache=False,
            # "logger" != "wandb" suffit : after_train/save_ckpt de la classe
            # de base testent uniquement l'egalite a "wandb" (tensorboard/wandb
            # eux-memes jamais utilises, before_train/after_iter/evaluate_and_
            # save_model sont overrides et ne construisent ni tblogger ni
            # wandb_logger).
            logger="tensorboard",
        )
        super().__init__(exp, args)
        # Trainer.__init__ force "cuda:{local_rank}" -- on reprend la main.
        self.device = _resolve_device(device)
        self.amp_training = False  # AMP (fp16 autocast) reserve au GPU
        if self.device.startswith("cuda"):
            self.amp_training = fp16

    # ------------------------------------------------------------------ #
    # before_train -- construction modele/optimizer/dataloaders            #
    # ------------------------------------------------------------------ #

    def before_train(self):
        logger.info("VisionNexusYoloxTrainer: device={}", self.device)

        model = self.exp.get_model()
        logger.info("Model Summary: {}", get_model_info(model, self.exp.test_size))
        model.to(self.device)

        self.optimizer = self.exp.get_optimizer(self.args.batch_size)
        model = self.resume_train(model)

        self.no_aug = self.start_epoch >= self.max_epoch - self.exp.no_aug_epochs
        self.train_loader = self._build_train_loader(no_aug=self.no_aug)
        logger.info("init prefetcher...")
        self.prefetcher = DataPrefetcher(self.train_loader)
        self.max_iter = len(self.train_loader)

        self.lr_scheduler = self.exp.get_lr_scheduler(
            self.exp.basic_lr_per_img * self.args.batch_size, self.max_iter
        )

        if self.use_model_ema:
            self.ema_model = ModelEMA(model, 0.9998)
            self.ema_model.updates = self.max_iter * self.start_epoch

        self.model = model
        self.evaluator = (
            None  # remplace par detection_metrics (evaluate_and_save_model)
        )

        logger.info("Training start...")

    def _build_train_loader(self, no_aug: bool) -> DataLoader:
        base_dataset = YoloTxtDataset(
            self.data_yaml,
            split="train",
            img_size=self.exp.input_size,
            preproc=TrainTransform(
                max_labels=50, flip_prob=self.exp.flip_prob, hsv_prob=self.exp.hsv_prob
            ),
        )
        dataset = MosaicDetection(
            base_dataset,
            mosaic=not no_aug,
            img_size=self.exp.input_size,
            preproc=TrainTransform(
                max_labels=self.max_labels,
                flip_prob=self.exp.flip_prob,
                hsv_prob=self.exp.hsv_prob,
            ),
            degrees=self.exp.degrees,
            translate=self.exp.translate,
            mosaic_scale=self.exp.mosaic_scale,
            mixup_scale=self.exp.mixup_scale,
            shear=self.exp.shear,
            enable_mixup=self.exp.enable_mixup,
            mosaic_prob=self.exp.mosaic_prob,
            mixup_prob=self.exp.mixup_prob,
        )
        self.dataset = dataset
        self.class_names = base_dataset.class_names

        sampler = InfiniteSampler(
            len(dataset), seed=self.exp.seed if self.exp.seed else 0
        )
        batch_sampler = YoloBatchSampler(
            sampler=sampler,
            batch_size=self.args.batch_size,
            drop_last=False,
            mosaic=not no_aug,
        )
        return DataLoader(
            dataset,
            num_workers=self.exp.data_num_workers,
            pin_memory=self.device.startswith("cuda"),
            batch_sampler=batch_sampler,
            worker_init_fn=worker_init_reset_seed,
        )

    # ------------------------------------------------------------------ #
    # Boucle -- arret propre + garde CPU sur after_iter                    #
    # ------------------------------------------------------------------ #

    def before_iter(self):
        if self.stop_flag is not None and self.stop_flag.is_set():
            raise TrainingStopped(f"arret demande a l'epoch {self.epoch + 1}")

    def train_one_iter(self):
        iter_start_time = time.time()
        inps, targets = self.prefetcher.next()
        inps = inps.to(self.device)
        targets = targets.to(self.device)
        targets.requires_grad = False
        inps, targets = self.exp.preprocess(inps, targets, self.input_size)
        data_end_time = time.time()

        with torch.cuda.amp.autocast(enabled=self.amp_training):
            outputs = self.model(inps, targets)
        loss = outputs["total_loss"]

        self.optimizer.zero_grad()
        self.scaler.scale(loss).backward()
        self.scaler.step(self.optimizer)
        self.scaler.update()

        if self.use_model_ema:
            self.ema_model.update(self.model)

        lr = self.lr_scheduler.update_lr(self.progress_in_iter + 1)
        for param_group in self.optimizer.param_groups:
            param_group["lr"] = lr

        iter_end_time = time.time()
        self.meter.update(
            iter_time=iter_end_time - iter_start_time,
            data_time=data_end_time - iter_start_time,
            lr=lr,
            **outputs,
        )

    def after_iter(self):
        """Identique a Trainer.after_iter() (log periodique), sans l'appel
        exp.random_resize() -- celui-ci fait .cuda() sans garde CPU."""
        if (self.iter + 1) % self.exp.print_interval == 0:
            left_iters = self.max_iter * self.max_epoch - (self.progress_in_iter + 1)
            eta_seconds = self.meter["iter_time"].global_avg * left_iters
            eta_str = f"ETA: {datetime.timedelta(seconds=int(eta_seconds))}"

            progress_str = f"epoch: {self.epoch + 1}/{self.max_epoch}, iter: {self.iter + 1}/{self.max_iter}"
            loss_meter = self.meter.get_filtered_meter("loss")
            # Capture avant clear_meters() : after_epoch() lit ces valeurs pour
            # le callback SSE/MLflow, et clear_meters() vide le buffer juste
            # apres (print_interval peut valoir 1, donc "apres chaque iter").
            self._last_loss_values = {k: float(v.latest) for k, v in loss_meter.items()}
            loss_str = ", ".join(
                f"{k}: {v:.1f}" for k, v in self._last_loss_values.items()
            )
            time_meter = self.meter.get_filtered_meter("time")
            time_str = ", ".join(f"{k}: {v.avg:.3f}s" for k, v in time_meter.items())

            logger.info(
                "{}, mem: {:.0f}Mb, {}, {}, lr: {:.3e}, {}",
                progress_str,
                gpu_mem_usage() if self.device.startswith("cuda") else 0.0,
                time_str,
                loss_str,
                self.meter["lr"].latest,
                eta_str,
            )
            self.meter.clear_meters()

    # ------------------------------------------------------------------ #
    # after_epoch -- checkpoint + evaluation + callback SSE/MLflow         #
    # ------------------------------------------------------------------ #

    def after_epoch(self):
        self.save_ckpt(ckpt_name="latest")

        metrics: dict = {}
        if (
            self.epoch + 1
        ) % self.exp.eval_interval == 0 or self.epoch + 1 == self.max_epoch:
            metrics = self.evaluate_and_save_model()

        self._append_results_csv(metrics)

        if self.on_epoch_end is not None:
            self.on_epoch_end(
                {
                    "epoch": self.epoch + 1,
                    "total_epochs": self.max_epoch,
                    "progress_pct": round((self.epoch + 1) / self.max_epoch * 100, 1),
                    "loss": dict(self._last_loss_values),
                    "metrics": metrics,
                }
            )

    def _append_results_csv(self, metrics: dict) -> None:
        """Historique par epoch (routers/training.py::metrics_history en lit
        les colonnes) -- meme convention de noms que detection_metrics/MLflow
        (metrics/mAP50(B)...), pas les noms Ultralytics (pertinence limitee
        puisque les pertes YOLOX (iou/l1/conf/cls) n'ont pas d'equivalent
        direct box/cls/dfl)."""
        import csv

        columns = [
            "epoch",
            "metrics/mAP50(B)",
            "metrics/mAP50-95(B)",
            "metrics/precision(B)",
            "metrics/recall(B)",
            "iou_loss",
            "l1_loss",
            "conf_loss",
            "cls_loss",
        ]
        row = {"epoch": self.epoch + 1, **metrics, **self._last_loss_values}
        csv_path = Path(self.file_name) / "results.csv"
        is_new = not csv_path.exists()
        with open(csv_path, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            if is_new:
                writer.writeheader()
            writer.writerow({c: row.get(c, "") for c in columns})

    # ------------------------------------------------------------------ #
    # Evaluation -- detection_metrics (maison) au lieu de COCOEvaluator    #
    # ------------------------------------------------------------------ #

    def evaluate_and_save_model(self) -> dict:
        evalmodel = self.ema_model.ema if self.use_model_ema else self.model
        evalmodel.eval()

        preds_by_image, gts_by_image, preview_samples = self._run_validation(evalmodel)
        result = compute_metrics(preds_by_image, gts_by_image, self.class_names)

        out_dir = Path(self.file_name) / "artifacts"
        out_dir.mkdir(parents=True, exist_ok=True)
        save_plots(result, self.class_names, out_dir)
        # Regenere a chaque eval (pas seulement au premier appel) : les
        # predictions evoluent avec les poids, contrairement a labels.jpg/
        # train_batch0.jpg qui ne dependent que du dataset.
        save_val_batch_plots(preview_samples, self.class_names, out_dir, n_samples=_VAL_PREVIEW_N)
        if not self._dataset_preview_done:
            save_dataset_preview_plots(self.dataset, self.class_names, out_dir)
            self._dataset_preview_done = True

        metrics = {
            "metrics/mAP50(B)": result.map50,
            "metrics/mAP50-95(B)": result.map50_95,
            "metrics/precision(B)": result.mean_precision,
            "metrics/recall(B)": result.mean_recall,
        }

        update_best = result.map50_95 > self.best_ap
        self.best_ap = max(self.best_ap, result.map50_95)
        self.save_ckpt("last_epoch", update_best)
        if self.save_history_ckpt:
            self.save_ckpt(f"epoch_{self.epoch + 1}")

        evalmodel.train()
        return metrics

    def _run_validation(self, model):
        val_dataset = YoloTxtDataset(
            self.data_yaml,
            split="val",
            img_size=self.exp.test_size,
            preproc=ValTransform(),
        )
        preds_by_image: list[list[Detection]] = []
        gts_by_image: list[list[GroundTruth]] = []
        preview_samples: list[tuple] = []
        from yolox.data.data_augment import preproc as raw_preproc
        from yolox.utils import postprocess

        with torch.no_grad():
            for idx in range(len(val_dataset)):
                img, target, img_info, _ = val_dataset.pull_item(idx)
                h, w = img_info
                img_t, ratio = raw_preproc(img, self.exp.test_size)
                img_tensor = (
                    torch.from_numpy(img_t).unsqueeze(0).float().to(self.device)
                )
                raw = model(img_tensor)
                outputs = postprocess(
                    raw, self.exp.num_classes, self.exp.test_conf, self.exp.nmsthre
                )
                out = outputs[0]
                dets: list[Detection] = []
                if out is not None:
                    for x1, y1, x2, y2, obj_conf, cls_conf, cls_id in out.cpu().numpy():
                        dets.append(
                            Detection(
                                box=(x1 / ratio, y1 / ratio, x2 / ratio, y2 / ratio),
                                conf=float(obj_conf) * float(cls_conf),
                                cls_id=int(cls_id),
                            )
                        )
                preds_by_image.append(dets)
                gts = [GroundTruth(box=tuple(t[:4]), cls_id=int(t[4])) for t in target]
                gts_by_image.append(gts)
                if idx < _VAL_PREVIEW_N:
                    preview_samples.append((img.copy(), gts, dets))
        return preds_by_image, gts_by_image, preview_samples
