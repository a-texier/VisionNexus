# ============================================================
# api/compare.py
# POST /api/compare — métriques côte-à-côte pour N runs sélectionnés
# ============================================================

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.core.mlflow_client import get_client, is_mlflow_running

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["compare"])


class CompareBody(BaseModel):
    run_ids: list[str]


def _require_mlflow():
    if not is_mlflow_running():
        raise HTTPException(503, "Serveur MLflow non disponible")


@router.post("/compare")
def compare_runs(body: CompareBody):
    _require_mlflow()
    if len(body.run_ids) < 2:
        raise HTTPException(400, "Au moins 2 run_ids requis pour comparer")
    if len(body.run_ids) > 10:
        raise HTTPException(400, "Maximum 10 runs comparables à la fois")

    try:
        client = get_client()
        runs: dict[str, dict] = {}

        for run_id in body.run_ids:
            run = client.get_run(run_id)
            metric_history: dict[str, list] = {}
            for key in run.data.metrics:
                history = client.get_metric_history(run_id, key)
                metric_history[key] = [
                    {"step": h.step, "value": h.value}
                    for h in sorted(history, key=lambda h: h.step)
                ]
            runs[run_id] = {
                "run_id":        run.info.run_id,
                "run_name":      run.info.run_name,
                "experiment_id": run.info.experiment_id,
                "status":        run.info.status,
                "start_time":    run.info.start_time,
                "end_time":      run.info.end_time,
                "params":        dict(run.data.params),
                "metrics":       dict(run.data.metrics),
                "metric_history": metric_history,
            }

        all_metric_keys: list[set] = [set(r["metrics"].keys()) for r in runs.values()]
        all_param_keys:  list[set] = [set(r["params"].keys())  for r in runs.values()]

        common_metrics = sorted(set.intersection(*all_metric_keys)) if all_metric_keys else []
        common_params  = sorted(set.intersection(*all_param_keys))  if all_param_keys  else []
        all_metrics    = sorted(set.union(*all_metric_keys))        if all_metric_keys else []
        all_params     = sorted(set.union(*all_param_keys))         if all_param_keys  else []

        return {
            "run_ids":       body.run_ids,
            "runs":          runs,
            "common_metrics": common_metrics,
            "common_params":  common_params,
            "all_metrics":    all_metrics,
            "all_params":     all_params,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("compare_runs error")
        raise HTTPException(500, str(exc))
