"""Diagnostic lisible des échecs HPO, partagé par les deux moteurs Optuna."""

from __future__ import annotations


def diagnose_failure(raw: str | None) -> dict[str, str]:
    text = (raw or "Erreur non détaillée").strip()
    low = text.lower()
    rules = [
        # Avant les regles YOLO : une trace MLflow contient "model"/"store" et se
        # faisait diagnostiquer en "poids introuvables", ce qui envoyait chercher
        # au mauvais endroit. Cause reelle : le callback MLflow d'Ultralytics.
        (("mlflow", "tracking backend", "maintenance mode"),
         "mlflow_store", "Suivi MLflow en echec (pas le training)",
         "Le trial est mort dans le callback MLflow d'Ultralytics, pas dans YOLO. "
         "MLFLOW_ALLOW_FILE_STORE=true est pose par hpo_trial.py ; si l'erreur persiste, "
         "verifiez MLFLOW_TRACKING_URI dans l'environnement de l'app."),
        (("data.yaml", "dataset", "images not found", "missing path", "does not exist"),
         "dataset_missing", "Dataset introuvable ou mal référencé",
         "Vérifiez le chemin absolu du data.yaml, ses clés path/train/val et l’existence des dossiers images/labels."),
        (("out of memory", "cuda out of memory", "cublas_status_alloc_failed"),
         "cuda_oom", "Mémoire GPU insuffisante",
         "Réduisez batch et imgsz, choisissez un modèle plus petit ou libérez la VRAM avant de relancer."),
        (("cuda", "no kernel image", "driver", "not compiled with cuda"),
         "cuda_unavailable", "CUDA ou pilote GPU indisponible",
         "Vérifiez le pilote NVIDIA et PyTorch/CUDA, ou forcez device=cpu pour diagnostiquer."),
        (("no such file", "weights", ".pt", "model"),
         "model_missing", "Poids ou modèle introuvable",
         "Vérifiez la version YOLO, le chemin du .pt et l’accès au cache de modèles."),
        (("timeout", "timed out"),
         "timeout", "Trial trop long ou bloqué",
         "Réduisez les epochs par trial, contrôlez les processus GPU et augmentez le délai seulement si le training progresse réellement."),
        (("could not convert", "impossible de parser", "rien retourné", "stdout", "résultat json", "result.json"),
         "metric_parse", "Métrique objectif illisible",
         "Le script doit imprimer une valeur numérique en dernière ligne, ou metric_name=<valeur>."),
        (("modulenotfounderror", "importerror", "dependency"),
         "dependency_missing", "Dépendance Python manquante",
         "Installez la dépendance dans IA_env et relancez le trial."),
    ]
    for patterns, code, title, action in rules:
        if any(p in low for p in patterns):
            return {"code": code, "title": title, "reason": text[-2000:], "action": action}
    return {
        "code": "process_error",
        "title": "Le processus du trial a échoué",
        "reason": text[-2000:],
        "action": "Ouvrez le détail du trial et ses logs, corrigez la première erreur technique, puis relancez l’étude.",
    }
