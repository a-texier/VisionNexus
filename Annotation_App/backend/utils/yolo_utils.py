# ============================================================
# utils/yolo_utils.py
# Lecture et écriture du format d'annotation YOLO.
# Format YOLO : une ligne par objet = "class_id cx cy w h"
# Toutes les coordonnées sont normalisées dans [0, 1].
# ============================================================

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import yaml


def write_yolo_label_file(
    output_path: str,
    annotations: List[Dict],
    class_index_map: Dict[int, int],
) -> None:
    """
    Écrit un fichier d'annotation YOLO (.txt).
    Si la liste d'annotations est vide, crée un fichier vide
    (ce qui est le comportement YOLO correct pour les frames sans objets).

    Args:
        output_path: Chemin de sortie du fichier .txt
        annotations: Liste de dicts avec clés : class_id, cx, cy, width, height
        class_index_map: Mapping id_base_de_données → indice_yolo (0-based)
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    lines = []
    for ann in annotations:
        class_id = ann.get("class_id")
        yolo_index = class_index_map.get(class_id)

        if yolo_index is None:
            continue  # Classe inconnue, on l'ignore

        cx = ann.get("cx", 0.5)
        cy = ann.get("cy", 0.5)
        w = ann.get("width", 0.1)
        h = ann.get("height", 0.1)

        # Vérification des bornes avant écriture
        if not all(0.0 <= v <= 1.0 for v in [cx, cy, w, h]):
            print(f"[yolo_utils] Annotation hors bornes ignorée : {ann}")
            continue

        lines.append(f"{yolo_index} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")

    # Ordre STABLE des lignes : l'ordre des annotations en entree depend des IDs DB
    # (nouveaux a chaque re-annotation) -> sinon le meme dataset re-exporte produit des
    # .txt identiques mais dans un ordre different -> md5 DVC different (faux "nouvelle
    # version"). YOLO se moque de l'ordre des boites ; on trie pour un export reproductible.
    lines.sort()

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        if lines:
            f.write("\n")  # Fin de fichier avec retour à la ligne


def write_yolo_segmentation_label_file(
    output_path: str,
    annotations: List[Dict],
    class_index_map: Dict[int, int],
) -> bool:
    """
    Ecrit un fichier d'annotation YOLO segmentation (.txt).

    Format : "class_id x1 y1 x2 y2 x3 y3 ..." (coordonnees normalisees)

    - Si l'annotation a des points polygone (annotation_type='polygon'), les utilise.
    - Sinon, convertit la bbox en rectangle 4-points (compatible YOLO seg).

    Returns:
        True si au moins une annotation polygone reelle a ete ecrite, False sinon.
    """
    import json as _json

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    lines = []
    has_real_polygon = False

    for ann in annotations:
        class_id = ann.get("class_id")
        yolo_index = class_index_map.get(class_id)
        if yolo_index is None:
            continue

        ann_type = ann.get("annotation_type", "bbox")
        points_raw = ann.get("points")

        if ann_type == "polygon" and points_raw:
            try:
                pts = _json.loads(points_raw) if isinstance(points_raw, str) else points_raw
                if pts and len(pts) >= 3:
                    coords = " ".join(f"{float(p[0]):.6f} {float(p[1]):.6f}" for p in pts)
                    lines.append(f"{yolo_index} {coords}")
                    has_real_polygon = True
                    continue
            except Exception:
                pass  # Fallback sur bbox

        # Conversion bbox → polygone rectangle 4-points
        cx = ann.get("cx", 0.5)
        cy = ann.get("cy", 0.5)
        w  = ann.get("width",  0.1)
        h  = ann.get("height", 0.1)

        # Validation
        if not all(0.0 <= v <= 1.0 for v in [cx, cy, w, h]):
            continue

        x1, y1 = cx - w / 2, cy - h / 2
        x2, y2 = cx + w / 2, cy + h / 2
        # Sens horaire : TL, TR, BR, BL
        lines.append(
            f"{yolo_index} "
            f"{x1:.6f} {y1:.6f} "
            f"{x2:.6f} {y1:.6f} "
            f"{x2:.6f} {y2:.6f} "
            f"{x1:.6f} {y2:.6f}"
        )

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        if lines:
            f.write("\n")

    return has_real_polygon


def read_yolo_label_file(
    label_path: str,
    class_names: List[str],
) -> List[Dict]:
    """
    Lit un fichier d'annotation YOLO et retourne une liste de dicts.

    Args:
        label_path: Chemin du fichier .txt
        class_names: Liste des noms de classes (indice = id YOLO)

    Returns:
        Liste de dicts avec clés : class_index, class_name, cx, cy, width, height
    """
    path = Path(label_path)
    if not path.exists():
        return []

    annotations = []
    with open(label_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            parts = line.split()
            if len(parts) < 5:
                continue

            try:
                class_idx = int(parts[0])
                cx = float(parts[1])
                cy = float(parts[2])
                w = float(parts[3])
                h = float(parts[4])

                class_name = class_names[class_idx] if class_idx < len(class_names) else f"class_{class_idx}"

                annotations.append({
                    "class_index": class_idx,
                    "class_name": class_name,
                    "cx": cx,
                    "cy": cy,
                    "width": w,
                    "height": h,
                })
            except (ValueError, IndexError):
                continue  # Ligne malformée, on l'ignore

    return annotations


def write_data_yaml(
    output_path: str,
    dataset_path: str,
    class_names: List[str],
    train_path: str = "images/train",
    val_path: str = "images/val",
    test_path: Optional[str] = "images/test",
) -> None:
    """
    Génère le fichier data.yaml requis par YOLOv8/YOLO pour l'entraînement.

    Args:
        output_path: Chemin de sortie du fichier YAML
        dataset_path: Chemin racine du dataset (relatif ou absolu)
        class_names: Liste ordonnée des noms de classes
        train_path: Chemin relatif du dossier images d'entraînement
        val_path: Chemin relatif du dossier images de validation
        test_path: Chemin relatif du dossier images de test (optionnel)
    """
    data = {
        "path": dataset_path,
        "train": train_path,
        "val": val_path,
        "nc": len(class_names),
        "names": class_names,
    }

    if test_path:
        data["test"] = test_path

    with open(output_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)


def validate_yolo_coordinates(cx: float, cy: float, w: float, h: float) -> Tuple[bool, str]:
    """
    Valide que les coordonnées YOLO respectent les contraintes :
    - Toutes les valeurs dans [0, 1]
    - La boîte reste à l'intérieur de l'image

    Returns:
        (True, "") si valide, (False, message_erreur) sinon
    """
    for name, val in [("cx", cx), ("cy", cy), ("w", w), ("h", h)]:
        if not (0.0 <= val <= 1.0):
            return False, f"{name}={val:.4f} hors de [0, 1]"

    if cx - w / 2 < 0:
        return False, f"Bord gauche négatif : cx={cx:.4f}, w={w:.4f}"
    if cx + w / 2 > 1:
        return False, f"Bord droit > 1 : cx={cx:.4f}, w={w:.4f}"
    if cy - h / 2 < 0:
        return False, f"Bord supérieur négatif : cy={cy:.4f}, h={h:.4f}"
    if cy + h / 2 > 1:
        return False, f"Bord inférieur > 1 : cy={cy:.4f}, h={h:.4f}"

    return True, ""


def compute_iou(
    box1: Tuple[float, float, float, float],
    box2: Tuple[float, float, float, float],
) -> float:
    """
    Calcule l'IoU (Intersection over Union) entre deux boîtes YOLO normalisées.

    Args:
        box1, box2: Tuples (cx, cy, w, h) normalisés

    Returns:
        Valeur IoU dans [0, 1]
    """
    # Conversion cx,cy,w,h → x1,y1,x2,y2
    def to_xyxy(box):
        cx, cy, w, h = box
        return cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2

    x1_a, y1_a, x2_a, y2_a = to_xyxy(box1)
    x1_b, y1_b, x2_b, y2_b = to_xyxy(box2)

    # Intersection
    xi1 = max(x1_a, x1_b)
    yi1 = max(y1_a, y1_b)
    xi2 = min(x2_a, x2_b)
    yi2 = min(y2_a, y2_b)

    inter_w = max(0.0, xi2 - xi1)
    inter_h = max(0.0, yi2 - yi1)
    inter_area = inter_w * inter_h

    if inter_area == 0:
        return 0.0

    # Union
    area_a = (x2_a - x1_a) * (y2_a - y1_a)
    area_b = (x2_b - x1_b) * (y2_b - y1_b)
    union_area = area_a + area_b - inter_area

    return inter_area / union_area if union_area > 0 else 0.0
