# ============================================================
# mlflow_logging.py -- log MLflow ROBUSTE et workspace-specific.
#
# Ecrit dans le store SQLITE du workspace MLflow de l'utilisateur
# (sibling `mlflow_<user>/mlflow_data/mlflow.db`) -- AUCUN serveur MLflow,
# AUCUN port -> pas de deconnexion. Le MLflow_App lit ce meme fichier.
#
# 100 % defensif : si mlflow est absent ou echoue, l'entrainement/l'eval
# continue normalement (les erreurs sont avalees et logguees).
#
# Ce module est identique dans Training_App / Evaluation_App / Inference_App
# (chaque app est packagee en standalone -> duplication assumee, comme le
# registre d'instances du launcher).
# ============================================================

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

os.environ.setdefault("MLFLOW_DISABLE_PLUGINS", "1")


def resolve_tracking_uri(workspace: Path, user: str) -> str:
    """URI sqlite du store MLflow de l'utilisateur.
    Priorite : env IA_MLFLOW_TRACKING_URI (injecte par l'orchestrateur) sinon
    sibling `mlflow_<user>/mlflow_data/mlflow.db` a cote du workspace de l'app.
    """
    env = os.environ.get("IA_MLFLOW_TRACKING_URI")
    if env:
        return env
    store = workspace.parent / f"mlflow_{user}" / "mlflow_data"
    store.mkdir(parents=True, exist_ok=True)
    (store / "artifacts").mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{(store / 'mlflow.db').as_posix()}"


class _Run:
    """Poignee minimale et defensive autour d'un run MLflow actif."""
    def __init__(self, mlflow, ok: bool):
        self._mlflow = mlflow
        self.ok = ok

    def log_metrics(self, metrics: dict, step: Optional[int] = None) -> None:
        if not self.ok:
            return
        import re
        clean = {}
        for k, v in metrics.items():
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            # MLflow refuse les caracteres hors [alnum _ - . / space :] dans un nom
            # de metrique (ex. Ultralytics "metrics/mAP50(B)"). Un seul nom invalide
            # faisait echouer TOUT le batch -> run d'eval sans metriques.
            name = re.sub(r"[^0-9A-Za-z_./ :-]", "", str(k)).strip().replace(" ", "_")
            if name:
                clean[name] = fv
        if not clean:
            return
        try:
            self._mlflow.log_metrics(clean, step=step)
        except Exception:
            # Repli defensif : un nom encore problematique ne doit pas tout perdre.
            for name, val in clean.items():
                try:
                    self._mlflow.log_metric(name, val, step=step)
                except Exception:
                    pass

    def log_params(self, params: dict) -> None:
        if not self.ok:
            return
        try:
            self._mlflow.log_params({k: v for k, v in params.items() if v is not None})
        except Exception:
            pass

    def log_artifact(self, path: str, artifact_path: Optional[str] = None) -> None:
        if not self.ok or not path or not Path(path).exists():
            return
        try:
            self._mlflow.log_artifact(path, artifact_path=artifact_path)
        except Exception:
            pass

    def set_tags(self, tags: dict) -> None:
        if not self.ok:
            return
        try:
            self._mlflow.set_tags(tags)
        except Exception:
            pass

    def register_model(self, model_path: str, name: str) -> None:
        """Enregistre un fichier de poids comme artefact + version de modele."""
        if not self.ok or not model_path or not Path(model_path).exists():
            return
        try:
            self._mlflow.log_artifact(model_path, artifact_path="model")
            uri = f"runs:/{self._mlflow.active_run().info.run_id}/model/{Path(model_path).name}"
            self._mlflow.register_model(uri, name)
        except Exception:
            pass

    def finish(self, status: str = "FINISHED") -> None:
        """Cloture le run (imperatif, pour code non structure en `with`)."""
        if not self.ok:
            return
        try:
            self._mlflow.end_run(status=status)
        except Exception:
            pass


def start_run(workspace: Path, user: str, experiment: str, run_name: str,
              params: Optional[dict] = None, tags: Optional[dict] = None) -> "_Run":
    """Version imperative de mlflow_run : ouvre un run, renvoie une poignee.
    Toujours appeler `.finish()` a la fin (jamais levee : 100 % defensif)."""
    try:
        import mlflow  # noqa: E402
        mlflow.set_tracking_uri(resolve_tracking_uri(workspace, user))
        mlflow.set_experiment(experiment)
        mlflow.start_run(run_name=run_name)
    except Exception:
        return _Run(None, ok=False)
    run = _Run(mlflow, ok=True)
    if params:
        run.log_params(params)
    if tags:
        run.set_tags(tags)
    return run


@contextmanager
def mlflow_run(workspace: Path, user: str, experiment: str, run_name: str,
               params: Optional[dict] = None, tags: Optional[dict] = None):
    """Context manager : ouvre un run MLflow (ou un no-op si mlflow indispo)."""
    try:
        import mlflow  # noqa: E402
    except Exception:
        yield _Run(None, ok=False)
        return

    try:
        mlflow.set_tracking_uri(resolve_tracking_uri(workspace, user))
        mlflow.set_experiment(experiment)
        active = mlflow.start_run(run_name=run_name)
    except Exception:
        yield _Run(None, ok=False)
        return

    run = _Run(mlflow, ok=True)
    if params:
        run.log_params(params)
    if tags:
        run.set_tags(tags)
    try:
        yield run
        try:
            mlflow.end_run(status="FINISHED")
        except Exception:
            pass
    except Exception:
        try:
            mlflow.end_run(status="FAILED")
        except Exception:
            pass
        raise
    finally:
        try:
            if mlflow.active_run() is not None:
                mlflow.end_run()
        except Exception:
            pass
    _ = active  # ref
