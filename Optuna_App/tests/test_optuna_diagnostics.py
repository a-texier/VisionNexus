import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import yaml
import optuna

from backend.api.orchestrator import _decoded_output as orchestrator_decoded_output
from backend.api.studies import (
    _distribution_contract,
    _effective_state,
    _legacy_log_diagnostic,
    _parameter_importance_contract,
    _recover_legacy_artifacts,
    _stale_trial_evidence,
    _study_search_space,
)
from backend.core.optuna_runner import _decoded_output as runner_decoded_output


class FakeTrial:
    def __init__(self, *, number=0, state="FAIL", params=None, started=None, completed=None):
        self.number = number
        self.state = SimpleNamespace(name=state)
        self.params = params or {}
        self.user_attrs = {}
        self.intermediate_values = {}
        self.datetime_start = started
        self.datetime_complete = completed


class OutputDecodingTests(unittest.TestCase):
    def test_invalid_utf8_is_replaced_without_losing_surrounding_stdout(self):
        raw = b"epoch 10\nmap50=0.985\x81\n"
        for decode in (orchestrator_decoded_output, runner_decoded_output):
            text = decode(raw)
            self.assertIn("map50=0.985", text)
            self.assertIn("\ufffd", text)


class HistoricalDiagnosticsTests(unittest.TestCase):
    def test_stale_running_is_read_only_effective_interruption(self):
        trial = FakeTrial(
            state="RUNNING",
            started=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2),
        )
        before = dict(trial.user_attrs)
        with patch("backend.api.studies._is_active_here", return_value=False):
            self.assertEqual(_effective_state(trial, trial.user_attrs, "study"), "INTERRUPTED")
        self.assertEqual(trial.state.name, "RUNNING")
        self.assertEqual(trial.user_attrs, before)

    def test_recovers_metrics_and_weights_from_matching_ultralytics_artifacts(self):
        params = {"lr0": 0.001, "mosaic": 0.2, "scale": 0.3}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "train-1"
            weights = run_dir / "weights"
            weights.mkdir(parents=True)
            (run_dir / "args.yaml").write_text(yaml.safe_dump(params), encoding="utf-8")
            (run_dir / "results.csv").write_text(
                "epoch,metrics/mAP50(B),metrics/mAP50-95(B)\n"
                "10,0.985,0.82709\n",
                encoding="utf-8",
            )
            (weights / "best.pt").write_bytes(b"weights")
            completed = datetime.fromtimestamp((run_dir / "results.csv").stat().st_mtime)
            trial = FakeTrial(params=params, completed=completed)

            recovered = _recover_legacy_artifacts(trial, root)

            self.assertEqual(recovered["recovery_status"], "recovered_unofficial")
            self.assertEqual(recovered["metrics"], {"map50": 0.985, "map5095": 0.82709})
            self.assertTrue(recovered["best_weights"].endswith("best.pt"))

    def test_recovers_legacy_dataset_failure_from_log(self):
        completed = datetime(2026, 8, 29, 19, 35, 13)
        trial = FakeTrial(number=2, state="PRUNED", completed=completed)
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "optuna_backend_20260829.log"
            log.write_text(
                "2026-08-29 19:35:13 WARNING trial 2 échoué\n"
                "ultralytics.trainer.get_dataset\ncheck_det_dataset\n",
                encoding="utf-8",
            )
            diagnostic = _legacy_log_diagnostic(trial, Path(tmp))

        self.assertIsNotNone(diagnostic)
        self.assertEqual(diagnostic["code"], "legacy_dataset_load_failure")

    def test_stale_windows_trial_reports_observed_files_and_workers_hypothesis(self):
        trial = FakeTrial(number=0, state="RUNNING")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            trial_dir = root / "hpo_runs" / "study" / "trial_0000"
            trial_dir.mkdir(parents=True)
            (trial_dir / "args.yaml").write_text("workers: 8\nbatch: 16\n", encoding="utf-8")
            with patch("backend.api.studies.WORKSPACE", root), patch("backend.api.studies.os.name", "nt"):
                evidence = _stale_trial_evidence(trial, "study")

        self.assertEqual(evidence["evidence"]["workers"], 8)
        self.assertFalse(evidence["evidence"]["files"]["results.csv"])
        self.assertIn("Interprétation probabiliste", evidence["reason"])
        self.assertIn("workers=0", evidence["action"])


class StudyAnalysisContractTests(unittest.TestCase):
    def test_log_distribution_and_best_value_are_serialized_explicitly(self):
        distribution = optuna.distributions.FloatDistribution(1e-5, 1e-1, log=True)
        result = _distribution_contract("lr0", distribution, {"lr0": 0.001})

        self.assertEqual(result["type"], "float")
        self.assertEqual(result["low"], 1e-5)
        self.assertEqual(result["high"], 1e-1)
        self.assertTrue(result["log"])
        self.assertEqual(result["best_value"], 0.001)

    def test_study_search_space_and_fanova_use_complete_trials(self):
        study = optuna.create_study(direction="maximize")

        def objective(trial):
            lr0 = trial.suggest_float("lr0", 1e-5, 1e-1, log=True)
            mosaic = trial.suggest_float("mosaic", 0.0, 1.0)
            return 0.7 - abs(lr0 - 0.002) * 2 + mosaic * 0.01

        study.optimize(objective, n_trials=8)
        space = _study_search_space(study, study.best_params)
        importances, error, method = _parameter_importance_contract(study)

        self.assertEqual({item["name"] for item in space}, {"lr0", "mosaic"})
        self.assertTrue(next(item for item in space if item["name"] == "lr0")["log"])
        self.assertIsNone(error)
        self.assertIn("fANOVA", method)
        self.assertIsNotNone(importances)
        self.assertAlmostEqual(sum(importances.values()), 1.0, places=6)


if __name__ == "__main__":
    unittest.main()
