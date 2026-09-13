##########################################
# Project  : VisionNexus
# File     : tools/build_all_sequence_dashboard.py
# Author   : VisionNexus contributors
# Obj  : Concatene les benchmark.json de tous les runs d'un dossier en un seul
#        benchmark "all sequences" + dashboard complet (plot/ + html/).
#
# Usage :
#   python tools/build_all_sequence_dashboard.py <dossier_de_runs>
#
# Cherche les sous-dossiers dont le nom contient "run" et qui portent un
# benchmark/benchmark.json, agrege leurs metriques detecteur (scores, tailles
# GT, TP/FP/FN par frame...) et regenere la structure classique dans
#   <dossier>/benchmark_<nom_dossier>_all_sequence/
#       benchmark_all_sequence.json  +  metrics_dashboard.html  +  plot/  +  html/
##########################################

import argparse
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from utils.metrics import (  # noqa: E402
    compact_metrics,
    dump_benchmark_json,
    generate_metrics_plots,
    relabel_metrics_at_iou,
)

# Decalage de frame applique a chaque sequence pour que les frames restent
# uniques une fois concatenees (necessaire au calcul correct des TN).
_FRAME_STRIDE = 10_000_000

# Champs listes concatenes tels quels (alignes par detection ou par frame).
# On suppose des runs homogenes (memes champs, meme version) -> concat directe.
_LIST_KEYS = [
    "det_scores",
    "det_labels",
    "det_gt_diag",
    "det_iou",
    "det_gt_id",
    "gt_diags",
    "n_gt_per_frame",
    "per_frame_tp",
    "per_frame_fp",
    "per_frame_fn",
    "iou_vals",
]
# Champs entiers additionnes.
_SUM_KEYS = [
    "tp",
    "fp",
    "fn",
    "n_gt",
    "n_frames",
    "idsw",
    "n_miss",
    "n_iou_zero",
    "n_iou_sub_thresh",
    "n_decrochages",
    "id_frags",
]


def _find_run_dirs(root: Path) -> list[Path]:
    """Sous-dossiers 'run' portant un benchmark/benchmark.json (ou benchmark.json)."""
    out = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        if "run" not in d.name.lower() or "all_sequence" in d.name.lower():
            continue
        if (d / "benchmark" / "benchmark.json").is_file() or (d / "benchmark.json").is_file():
            out.append(d)
    return out


def _benchmark_json(run_dir: Path) -> Path:
    for cand in (run_dir / "benchmark" / "benchmark.json", run_dir / "benchmark.json"):
        if cand.is_file():
            return cand
    raise FileNotFoundError(run_dir)


def _merge_mode(modes: list[dict], offsets: list[int]) -> dict:
    """Fusionne une liste de sous-dicts de mode (tous les 'mot', ou tous les 'sot')."""
    out: dict = {}
    for key in _LIST_KEYS:
        out[key] = [v for m in modes for v in m.get(key, [])]

    # Frames decalees par sequence pour rester uniques (TN correct).
    out["det_frames"] = []
    out["active_frames"] = []
    for m, off in zip(modes, offsets, strict=False):
        out["det_frames"].extend(int(f) + off for f in m.get("det_frames", []))
        out["active_frames"].extend(int(f) + off for f in m.get("active_frames", []))

    for key in _SUM_KEYS:
        out[key] = sum(int(m.get(key, 0)) for m in modes)

    tp, fp, fn, idsw = out["tp"], out["fp"], out["fn"], out["idsw"]
    n_gt = max(1, out["n_gt"])
    out["mota"] = round(1.0 - (fn + fp + idsw) / n_gt, 4)
    out["idf1"] = round(2 * tp / max(1, 2 * tp + fp + fn), 4)
    out["has_persistent_gt_ids"] = any(m.get("has_persistent_gt_ids") for m in modes)
    out["iou_decrochage"] = next((m["iou_decrochage"] for m in modes if "iou_decrochage" in m), 0.2)
    out["n_losses"] = sum(int(m.get("n_losses", 0)) for m in modes)
    out["n_inits"] = sum(int(m.get("n_inits", 0)) for m in modes)
    # Structures par-frame/par-GT non pertinentes une fois concatenees -> vides
    # (les plots concernes se desactivent proprement).
    for key in (
        "centroid_dists",
        "iou_per_frame",
        "gt_id_track_mapping",
        "gt_id_timeline",
        "per_gt_idsw",
        "gt_ann_frames",
    ):
        out[key] = {}
    return out


def _aggregate(benchmarks: list[dict]) -> dict:
    offsets = [i * _FRAME_STRIDE for i in range(len(benchmarks))]
    has_mot = any(b.get("mot", {}).get("det_scores") for b in benchmarks)
    has_sot = any(b.get("sot", {}).get("n_frames") for b in benchmarks)

    mot = _merge_mode([b.get("mot", {}) for b in benchmarks], offsets)
    sot = _merge_mode([b.get("sot", {}) for b in benchmarks], offsets) if has_sot else {}

    tp = sum(int(b.get("tp", 0)) for b in benchmarks)
    fp = sum(int(b.get("fp", 0)) for b in benchmarks)
    fn = sum(int(b.get("fn", 0)) for b in benchmarks)
    idsw = sum(int(b.get("idsw", 0)) for b in benchmarks)
    n_gt = max(1, sum(int(b.get("n_gt", 0)) for b in benchmarks))

    agg = {
        "run_name": f"ALL ({len(benchmarks)} sequences)",
        "tracker_mot": benchmarks[0].get("tracker_mot"),
        "tracker_sot": benchmarks[0].get("tracker_sot"),
        "n_sequences": len(benchmarks),
        "sequences": [b.get("run_name", "?") for b in benchmarks],
        "n_frames": sum(int(b.get("n_frames", 0)) for b in benchmarks),
        "fps_proc": 0.0,
        "fps_total": 0.0,
        "fps_sequence": benchmarks[0].get("fps_sequence", 10.0),
        "has_gt": True,
        "iou_threshold": benchmarks[0].get("iou_threshold", 0.1),
        "mota": round(1.0 - (fn + fp + idsw) / n_gt, 4),
        "idf1": round(2 * tp / max(1, 2 * tp + fp + fn), 4),
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "idsw": idsw,
        "n_gt": n_gt,
        "mot": mot if has_mot else {},
        "sot": sot,
    }
    return agg


def main() -> int:
    ap = argparse.ArgumentParser(description="Dashboard agrege multi-sequences")
    ap.add_argument("folder", help="dossier contenant les runs (sous-dossiers 'run')")
    ap.add_argument(
        "--iou",
        type=float,
        default=None,
        help="seuil IoU pour re-calculer TP/FP a la volee sur l'agregat",
    )
    args = ap.parse_args()

    root = Path(args.folder).resolve()
    if not root.is_dir():
        print(f"Dossier introuvable : {root}")
        return 1

    run_dirs = _find_run_dirs(root)
    if not run_dirs:
        print(f"Aucun run (sous-dossier 'run' avec benchmark.json) dans {root}")
        return 1

    print(f"{len(run_dirs)} run(s) trouve(s) :")
    benchmarks = []
    for d in run_dirs:
        bj = _benchmark_json(d)
        data = json.loads(bj.read_text(encoding="utf-8"))
        benchmarks.append(data)
        print(f"  - {d.name}  (run_name={data.get('run_name')}, n_gt={data.get('n_gt')})")

    agg = _aggregate(benchmarks)
    if args.iou is not None:
        relabel_metrics_at_iou(agg, args.iou)
        print(f"TP/FP recalcules au seuil IoU = {args.iou}")

    out_dir = root / f"benchmark_{root.name}_all_sequence"
    out_dir.mkdir(parents=True, exist_ok=True)
    compact_metrics(agg)
    dump_benchmark_json(agg, out_dir / "benchmark_all_sequence.json")

    created = generate_metrics_plots(agg, agg, out_dir)
    print(
        f"\nAgrege : {agg['n_gt']} GT sur {agg['n_frames']} frames ({agg['n_sequences']} sequences)"
    )
    print(f"Sortie -> {out_dir}")
    for p in created:
        print("  ", Path(p).name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
