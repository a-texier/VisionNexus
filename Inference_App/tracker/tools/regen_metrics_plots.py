##########################################
# Project  : VisionNexus
# File     : tools/regen_metrics_plots.py
# Author   : VisionNexus contributors
# Obj  : Regenerate metric plots from a saved benchmark.json (no re-run).
#
# Usage :
#   python tools/regen_metrics_plots.py <run_dir_or_benchmark.json>
#       Regenerate every plot from the stored metrics.
#
#   python tools/regen_metrics_plots.py <run_dir_or_benchmark.json> --ver <file.ver>
#       One-shot bridge for OLD benchmark.json produced before GT-size capture :
#       rebuild the per-detection GT diagonal (det_gt_diag) and the GT diagonal
#       population (gt_diags) from the .ver annotations, persist them back into
#       benchmark.json, then regenerate the plots (incl. the size-band plots).
#
# Once a benchmark.json has been enriched (or produced by an up-to-date run) it
# is self-sufficient : no .ver is needed anymore.
##########################################

import argparse
import json
import math
import sys
from pathlib import Path

# Rendre le package utils importable quand on lance depuis n'importe ou.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from utils.metrics import (  # noqa: E402
    compact_metrics,
    dump_benchmark_json,
    generate_metrics_plots,
    relabel_metrics_at_iou,
)


def _resolve_benchmark_json(arg: str) -> Path:
    """Accepte le run_dir, le dossier benchmark/, ou le benchmark.json direct."""
    p = Path(arg)
    if p.is_file():
        return p
    for cand in (p / "benchmark.json", p / "benchmark" / "benchmark.json"):
        if cand.is_file():
            return cand
    raise FileNotFoundError(f"benchmark.json introuvable a partir de : {arg}")


def _parse_ver(path: Path) -> dict:
    """Lit un .ver -> {frame_id (int) : [(gt_id, x1, y1, x2, y2), ...]}.

    Format ligne : frame gt_id x1 y1 x2 y2 cls ...
    """
    out: dict[int, list] = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            t = line.split()
            if len(t) < 6:
                continue
            try:
                frame = int(t[0])
                gid = int(t[1])
                x1, y1, x2, y2 = (float(v) for v in t[2:6])
            except ValueError:
                continue
            out.setdefault(frame, []).append((gid, x1, y1, x2, y2))
    return out


def _diag(box) -> float:
    _gid, x1, y1, x2, y2 = box
    return math.hypot(x2 - x1, y2 - y1)


def _find_offset(active, n_gt_per_frame, ver) -> int:
    """Trouve l'offset o tel que ver[abs_frame + o] recouvre exactement les GT.

    Les .ver sont numerotes a partir de 1 ; les runs utilisent l'index absolu de
    la sequence. On evalue une plage d'offsets et on garde, parmi ceux qui
    reproduisent EXACTEMENT la sequence de comptes GT par frame, celui de plus
    petit module (l'offset vrai est en general 0 ou +/-1). Sur une sequence
    mono-cible, la taille du drone varie lentement : un residu de quelques
    frames ne change pas l'appartenance aux bandes de taille.
    """
    scored = []  # (bad, |o|, o)
    for o in range(-30, 31):
        bad = sum(
            1
            for absf, ngt in zip(active, n_gt_per_frame, strict=False)
            if len(ver.get(absf + o, [])) != ngt
        )
        scored.append((bad, abs(o), o))
    scored.sort()  # bad croissant, puis |o| croissant
    best_bad, _, best_o = scored[0]
    exact = [o for bad, _, o in scored if bad == 0]
    if best_bad != 0:
        print(f"  [warn] offset non exact (mismatchs={best_bad}) -> offset={best_o}")
    elif len(exact) > 1:
        print(
            f"  [info] offsets exacts multiples {sorted(exact)} -> retenu {best_o} "
            "(plus petit module ; decalage sans impact sur les bandes de taille)"
        )
    return best_o


def _enrich_with_ver(data: dict, ver_path: Path) -> None:
    """Reconstruit det_gt_diag + gt_diags dans data['mot'] depuis un .ver.

    Le tracker est mono-cible sur ces sequences (1 GT/frame) : chaque TP d'une
    frame recoit la diagonale du GT de cette frame. La reconstruction reproduit
    l'ordre exact de det_scores/det_labels (par frame : TP puis FP) ; on le
    verifie en comparant les labels reconstruits a mot['det_labels'].
    """
    mot = data.get("mot", {})
    active = list(mot.get("active_frames", []))
    tp_pf = list(mot.get("per_frame_tp", []))
    fp_pf = list(mot.get("per_frame_fp", []))
    ngt_pf = list(mot.get("n_gt_per_frame", []))
    if not active or len(active) != len(tp_pf):
        raise ValueError("active_frames / per_frame_tp incoherents dans benchmark.json")

    ver = _parse_ver(ver_path)
    offset = _find_offset(active, ngt_pf, ver)

    det_gt_diag: list[float] = []
    gt_diags: list[float] = []
    labels_rebuilt: list[int] = []

    for idx, absf in enumerate(active):
        boxes = ver.get(absf + offset, [])
        diags_here = sorted((_diag(b) for b in boxes), reverse=True)
        gt_diags.extend(diags_here)

        n_tp = int(tp_pf[idx])
        n_fp = int(fp_pf[idx])
        # TP : plus grandes diagonales de la frame (mono-cible -> non ambigu).
        tp_diags = diags_here[:n_tp]
        while len(tp_diags) < n_tp:
            tp_diags.append(-1.0)
        for d in tp_diags:
            det_gt_diag.append(d)
            labels_rebuilt.append(1)
        for _ in range(n_fp):
            det_gt_diag.append(-1.0)
            labels_rebuilt.append(0)

    labels_ref = list(mot.get("det_labels", []))
    if labels_rebuilt != labels_ref:
        raise ValueError(
            "Reconstruction incoherente : labels reconstruits != det_labels "
            f"({len(labels_rebuilt)} vs {len(labels_ref)}). Verifier le .ver / offset."
        )
    if len(gt_diags) != int(mot.get("n_gt", -1)):
        print(f"  [warn] gt_diags={len(gt_diags)} != n_gt={mot.get('n_gt')} (GT hors run possible)")

    mot["det_gt_diag"] = det_gt_diag
    mot["gt_diags"] = gt_diags
    in_band = sum(1 for d in gt_diags if 15.0 <= d <= 40.0)
    print(
        f"  enrichi : {len(det_gt_diag)} detections, {len(gt_diags)} GT "
        f"(dont {in_band} dans 15-40px), offset={offset}"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Regenere les plots depuis benchmark.json")
    ap.add_argument("run", help="run_dir, dossier benchmark/, ou benchmark.json")
    ap.add_argument("--ver", help="fichier .ver (enrichit les diagonales GT si absentes)")
    ap.add_argument(
        "--iou",
        type=float,
        default=None,
        help="seuil IoU pour re-calculer TP/FP a la volee (defaut : celui du run)",
    )
    ap.add_argument(
        "--compact",
        action="store_true",
        help="arrondit les tableaux par-detection et reecrit benchmark.json (~3x plus petit)",
    )
    args = ap.parse_args()

    bm_json = _resolve_benchmark_json(args.run)
    bm_dir = bm_json.parent
    print(f"benchmark.json : {bm_json}")

    data = json.loads(bm_json.read_text(encoding="utf-8"))

    has_size = bool(data.get("mot", {}).get("gt_diags"))
    if args.ver:
        print(f"enrichissement depuis .ver : {args.ver}")
        _enrich_with_ver(data, Path(args.ver))
        compact_metrics(data)
        dump_benchmark_json(data, bm_json)
        print("  benchmark.json mis a jour (det_gt_diag + gt_diags persistes)")
    elif not has_size:
        print(
            "  [info] pas de gt_diags dans benchmark.json : les plots par taille "
            "seront ignores (fournir --ver pour les reconstruire)."
        )

    if args.compact:
        before = bm_json.stat().st_size
        compact_metrics(data)
        dump_benchmark_json(data, bm_json)
        after = bm_json.stat().st_size
        print(f"  benchmark.json compacte : {before / 1e6:.1f} -> {after / 1e6:.1f} Mo")

    if args.iou is not None:
        relabel_metrics_at_iou(data, args.iou)
        print(f"  TP/FP recalcules au seuil IoU = {args.iou}")

    created = generate_metrics_plots(data, data, bm_dir)
    print(f"\n{len(created)} fichier(s) (re)generes dans {bm_dir} :")
    for p in created:
        print("  ", Path(p).name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
