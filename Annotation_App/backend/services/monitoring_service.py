# ============================================================
# services/monitoring_service.py
# Suivi de l'usage reel de l'application, par workspace (donc par utilisateur).
#
# Deux sources complementaires, volontairement separees :
#
#   1. SNAPSHOT (annotation.db) — combien d'annotations existent AUJOURD'HUI,
#      par sequence et par provenance (manuel / SAMURAI / SAM2 / GD / SAM3 / ...).
#      Se calcule a la demande, ne peut pas deriver, et fonctionne
#      retroactivement sur les projets deja annotes.
#
#   2. JOURNAL D'EVENEMENTS (monitoring/events.jsonl) — ce que la base ne peut
#      pas savoir : quelles sorties automatiques ont ete RETOUCHEES a la main,
#      lesquelles ont ete supprimees, combien de temps a dure chaque run.
#      Append-only, une ligne JSON par evenement (ecriture concurrente sure,
#      aucun verrou global, fichier lisible et reparable a la main).
#
# Le monitoring ne doit JAMAIS faire echouer une requete metier : toutes les
# ecritures sont encapsulees et silencieuses en cas d'erreur.
# ============================================================

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

# Provenances connues. 'manual' = trace a la main ; le reste vient d'un modele.
AUTO_SOURCES = {
    "samurai": "SAMURAI",
    "sam2_video": "SAM2 video",
    # Valeur historique : avant la separation, SAMURAI et SAM2 video ecrivaient
    # tous deux 'sam2_tracking'. Conservee pour ne pas perdre l'existant.
    "sam2_tracking": "SAMURAI/SAM2 (avant separation)",
    "sam_point": "SAM2 (point)",
    "sam_auto": "SAM2 (auto)",
    "grounding_dino": "Grounding DINO",
    "sam3": "SAM3",
    "guided_tracking": "Tracking guide",
    "yolo": "YOLO custom",
    "interpolation": "Interpolation",
    "homography": "Homographie",
    "optical_flow": "Flux optique",
}
MANUAL_SOURCES = {"manual", "", None}

_write_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _current_user() -> str:
    return os.environ.get("IA_USER") or os.environ.get("USERNAME") or "inconnu"


def monitoring_dir(workspace: Optional[Path] = None) -> Path:
    if workspace is None:
        from backend.config import WORKSPACE
        workspace = WORKSPACE
    return Path(workspace) / "monitoring"


def events_file(workspace: Optional[Path] = None) -> Path:
    return monitoring_dir(workspace) / "events.jsonl"


# ---- Ecriture d'evenements ----

def record(event: str, **fields: Any) -> None:
    """Ajoute un evenement au journal. Silencieux en cas d'echec (jamais bloquant)."""
    try:
        payload = {"ts": _now(), "user": _current_user(), "event": event}
        payload.update({k: v for k, v in fields.items() if v is not None})
        path = events_file()
        with _write_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass


def record_edit(annotation_id: int, source: Optional[str],
                project_id: Optional[int] = None,
                frame_id: Optional[int] = None) -> None:
    """Retouche manuelle d'une annotation. Le champ `source` porte sa PROVENANCE
    d'origine : c'est ce qui distingue « j'ai corrige une sortie SAMURAI » de
    « j'ai deplace ma propre boite »."""
    record("annotation_edited", annotation_id=annotation_id,
           source=source or "manual", project_id=project_id, frame_id=frame_id)


def record_delete(annotation_id: int, source: Optional[str],
                  project_id: Optional[int] = None,
                  frame_id: Optional[int] = None) -> None:
    """Suppression manuelle. Sur une sortie auto, c'est un signal de fausse alarme."""
    record("annotation_deleted", annotation_id=annotation_id,
           source=source or "manual", project_id=project_id, frame_id=frame_id)


def record_bulk_delete(items: Iterable[tuple], origin: str = "") -> None:
    """Suppression groupee : bloc de piste, piste entiere, plage de frames, NMS.

    `items` = iterable de (annotation_id, source_algorithm, frame_id). Un
    evenement par annotation, comme pour une suppression unitaire : sans ca, une
    piste effacee d'un coup n'apparaissait nulle part dans le monitoring alors
    qu'elle represente souvent le plus gros volume rejete.
    """
    rows = list(items)
    if not rows:
        return
    try:
        stamp = _now()
        user = _current_user()
        lines = []
        for annotation_id, source, frame_id in rows:
            payload = {
                "ts": stamp, "user": user, "event": "annotation_deleted",
                "annotation_id": annotation_id, "source": source or "manual",
            }
            if frame_id is not None:
                payload["frame_id"] = frame_id
            if origin:
                payload["origin"] = origin
            lines.append(json.dumps(payload, ensure_ascii=False))
        path = events_file()
        with _write_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
    except Exception:
        pass


def record_run(algorithm: str, project_id: Optional[int], frames: int,
               created: int, duration_s: float, mode: str = "",
               targets: int = 0, stopped: bool = False) -> None:
    """Fin d'un run automatique (SAMURAI, tracking guide, homographie, flux optique)."""
    record("algo_run", algorithm=algorithm, project_id=project_id,
           frames=frames, created=created, duration_s=round(duration_s, 1),
           mode=mode, targets=targets, stopped=stopped)


# ---- Lecture / agregation ----

def read_events(workspace: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Lit le journal. Les lignes corrompues sont ignorees, pas fatales."""
    path = events_file(workspace)
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except Exception:
        return []
    return out


def _db_path(workspace: Path) -> Path:
    return Path(workspace) / "annotation.db"


def snapshot_from_db(workspace: Path) -> Dict[str, Any]:
    """Compte les annotations existantes par sequence et par provenance.

    Lecture SQLite directe en mode read-only : la fonction sert aussi au script
    de rapport hors ligne, qui n'a ni FastAPI ni SQLModel a disposition.
    """
    db = _db_path(workspace)
    result: Dict[str, Any] = {"projects": [], "totals": {}}
    if not db.exists():
        return result

    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
    except Exception:
        return result

    try:
        rows = conn.execute(
            """
            SELECT p.id            AS project_id,
                   p.name          AS project_name,
                   p.project_type  AS project_type,
                   f.sequence_id   AS sequence_id,
                   COALESCE(s.name, 'Sequence principale') AS sequence_name,
                   -- Chemin du dataset : celui de la sequence, sinon celui du
                   -- projet (imports anterieurs au multi-sequence).
                   COALESCE(s.source_path, p.source_path, '') AS source_path,
                   COALESCE(a.source_algorithm, 'manual')  AS source,
                   COUNT(*)        AS n,
                   COUNT(DISTINCT a.frame_id) AS n_frames
            FROM annotation a
            JOIN frame   f ON f.id = a.frame_id
            JOIN project p ON p.id = f.project_id
            LEFT JOIN sequence s ON s.id = f.sequence_id
            GROUP BY p.id, f.sequence_id, source
            """
        ).fetchall()
    except Exception:
        conn.close()
        return result
    finally:
        try:
            conn.close()
        except Exception:
            pass

    projects: Dict[int, Dict[str, Any]] = {}
    totals: Dict[str, int] = {}
    for r in rows:
        pid = r["project_id"]
        proj = projects.setdefault(pid, {
            "project_id": pid,
            "project_name": r["project_name"],
            "project_type": r["project_type"],
            "sequences": {},
        })
        seq_key = r["sequence_id"] if r["sequence_id"] is not None else 0
        seq = proj["sequences"].setdefault(seq_key, {
            "sequence_id": r["sequence_id"],
            "sequence_name": r["sequence_name"],
            "source_path": r["source_path"] or "",
            "by_source": {},
            "frames_annotated": 0,
            "total": 0,
        })
        source = r["source"] or "manual"
        seq["by_source"][source] = seq["by_source"].get(source, 0) + r["n"]
        seq["total"] += r["n"]
        seq["frames_annotated"] = max(seq["frames_annotated"], r["n_frames"])
        totals[source] = totals.get(source, 0) + r["n"]

    # Enrichissement par sequence : taille reelle, couverture, export.
    # Une sequence de 5000 images avec 100 annotations n'a pas le meme sens
    # qu'une sequence de 120 images entierement annotee.
    seq_meta = _sequence_meta(db)
    for p in projects.values():
        for key, seq in p["sequences"].items():
            meta = seq_meta.get(seq["sequence_id"])
            if meta is None:
                meta = seq_meta.get(None, {})
            seq["frame_count"] = meta.get("frame_count", 0)
            seq["start_index"] = meta.get("start_index", 0)
            seq["last_export_at"] = meta.get("last_export_at")
            seq["last_export_format"] = meta.get("last_export_format")
            # "Terminee" = exportee. Annotee ne suffit pas : tant que le jeu de
            # donnees n'est pas sorti, il n'est pas livrable.
            seq["is_done"] = bool(meta.get("last_export_at"))
            seq["coverage"] = _coverage_blocks(db, seq["sequence_id"],
                                               meta.get("start_index", 0),
                                               meta.get("frame_count", 0))

    result["projects"] = [
        {**p, "sequences": list(p["sequences"].values())}
        for p in projects.values()
    ]
    result["totals"] = totals
    result["timeline"] = _timeline_from_db(db)
    return result


def _sequence_meta(db: Path) -> Dict[Optional[int], Dict[str, Any]]:
    """Taille et statut d'export de chaque sequence, indexe par sequence_id.

    La cle None couvre les frames legacy (importees avant le multi-sequence),
    dont le nombre est compte directement dans la table frame.
    """
    out: Dict[Optional[int], Dict[str, Any]] = {}
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
    except Exception:
        return out
    try:
        # Les colonnes d'export sont recentes et le rapport hors ligne lit des
        # bases qui n'ont jamais vu la migration : on n'interroge que ce qui
        # existe reellement, sinon la requete echouait et on perdait AUSSI le
        # comptage des frames legacy.
        try:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(sequence)")}
        except Exception:
            cols = set()
        has_export = "last_export_at" in cols
        if cols:
            fields = "id, start_index, frame_count"
            if has_export:
                fields += ", last_export_at, last_export_format"
            for r in conn.execute(f"SELECT {fields} FROM sequence").fetchall():
                out[r["id"]] = {
                    "start_index": r["start_index"] or 0,
                    "frame_count": r["frame_count"] or 0,
                    "last_export_at": r["last_export_at"] if has_export else None,
                    "last_export_format": r["last_export_format"] if has_export else None,
                }

        row = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(MIN(frame_index), 0) AS lo "
            "FROM frame WHERE sequence_id IS NULL"
        ).fetchone()
        if row and row["n"]:
            out[None] = {"start_index": row["lo"], "frame_count": row["n"],
                         "last_export_at": None, "last_export_format": None}
    except Exception:
        return out
    finally:
        try:
            conn.close()
        except Exception:
            pass
    return out


def _coverage_blocks(db: Path, sequence_id: Optional[int], start_index: int,
                     frame_count: int, buckets: int = 120) -> List[int]:
    """Couverture d'annotation echantillonnee en `buckets` segments.

    Renvoie, pour chaque segment, le nombre de frames annotees qu'il contient.
    On agrege cote SQL plutot que de renvoyer 5000 frames au navigateur : la
    barre affichee ne fait de toute facon que quelques centaines de pixels.
    """
    if frame_count <= 0:
        return []
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    except Exception:
        return []
    try:
        width = max(1, frame_count / buckets)
        if sequence_id is None:
            rows = conn.execute(
                "SELECT DISTINCT f.frame_index FROM frame f "
                "JOIN annotation a ON a.frame_id = f.id WHERE f.sequence_id IS NULL"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT DISTINCT f.frame_index FROM frame f "
                "JOIN annotation a ON a.frame_id = f.id WHERE f.sequence_id = ?",
                (sequence_id,),
            ).fetchall()
        blocks = [0] * buckets
        for (idx,) in rows:
            b = int((idx - start_index) / width)
            if 0 <= b < buckets:
                blocks[b] += 1
        return blocks
    except Exception:
        return []
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _timeline_from_db(db: Path) -> List[Dict[str, Any]]:
    """Annotations creees par jour et par provenance.

    Vient de annotation.created_at : disponible retroactivement, donc l'historique
    existe des le premier lancement du monitoring, sans attendre le journal.
    """
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
    except Exception:
        return []
    try:
        rows = conn.execute(
            """
            SELECT DATE(created_at) AS day,
                   COALESCE(source_algorithm, 'manual') AS source,
                   COUNT(*) AS n
            FROM annotation
            WHERE created_at IS NOT NULL
            GROUP BY day, source
            ORDER BY day
            """
        ).fetchall()
        return [{"day": r[0], "source": r[1], "count": r[2]} for r in rows if r[0]]
    except Exception:
        return []
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _bucket(source: Optional[str]) -> str:
    """Classe une provenance en 'manual' ou 'auto'."""
    return "manual" if (source or "manual") in MANUAL_SOURCES else "auto"


def aggregate_workspace(workspace: Path) -> Dict[str, Any]:
    """Vue complete d'un workspace : snapshot base + comportement (journal).

    Les retouches et suppressions sont comptees en annotations DISTINCTES :
    corriger dix fois la meme boite reste une boite retouchee.
    """
    workspace = Path(workspace)
    snapshot = snapshot_from_db(workspace)
    events = read_events(workspace)

    edited_auto: set = set()
    edited_manual: set = set()
    deleted_auto: set = set()
    runs: List[Dict[str, Any]] = []
    first_ts: Optional[str] = None
    last_ts: Optional[str] = None
    # frame_id -> nombre d'interventions manuelles (retouche ou suppression).
    # Une frame reprise plusieurs fois signale une sequence difficile.
    frame_touches: Dict[int, int] = {}

    for e in events:
        ts = e.get("ts")
        if ts:
            first_ts = ts if first_ts is None or ts < first_ts else first_ts
            last_ts = ts if last_ts is None or ts > last_ts else last_ts
        kind = e.get("event")
        if kind in ("annotation_edited", "annotation_deleted"):
            fid = e.get("frame_id")
            if fid is not None:
                frame_touches[fid] = frame_touches.get(fid, 0) + 1
        if kind == "annotation_edited":
            aid = e.get("annotation_id")
            if aid is None:
                continue
            (edited_auto if _bucket(e.get("source")) == "auto" else edited_manual).add(aid)
        elif kind == "annotation_deleted":
            if _bucket(e.get("source")) == "auto" and e.get("annotation_id") is not None:
                deleted_auto.add(e["annotation_id"])
        elif kind == "algo_run":
            runs.append(e)

    frames_by_dataset = _frames_to_dataset(workspace, list(frame_touches.keys()))
    rework_by_dataset: Dict[str, Dict[str, Any]] = {}
    for fid, count in frame_touches.items():
        info = frames_by_dataset.get(fid)
        if not info:
            continue
        key = info["source_path"] or info["sequence_name"]
        entry = rework_by_dataset.setdefault(key, {
            "dataset": key,
            "sequence_name": info["sequence_name"],
            "project_name": info["project_name"],
            "frames_touched": 0,
            "frames_multi": 0,
            "touches": 0,
        })
        entry["frames_touched"] += 1
        entry["touches"] += count
        if count > 1:
            entry["frames_multi"] += 1

    totals = snapshot.get("totals", {})
    auto_total = sum(n for s, n in totals.items() if _bucket(s) == "auto")
    manual_total = sum(n for s, n in totals.items() if _bucket(s) == "manual")

    return {
        "workspace": str(workspace),
        "user": _user_from_workspace(workspace),
        "snapshot": snapshot,
        "summary": {
            "annotations_total": auto_total + manual_total,
            "annotations_manual": manual_total,
            "annotations_auto": auto_total,
            "auto_edited": len(edited_auto),
            "auto_deleted": len(deleted_auto),
            "manual_edited": len(edited_manual),
            "by_source": totals,
            "runs": len(runs),
            "run_frames": sum(int(r.get("frames") or 0) for r in runs),
            "run_seconds": round(sum(float(r.get("duration_s") or 0) for r in runs), 1),
            "frames_touched": len(frame_touches),
            "frames_multi_touched": sum(1 for c in frame_touches.values() if c > 1),
            "first_event": first_ts,
            "last_event": last_ts,
        },
        "rework_by_dataset": sorted(
            rework_by_dataset.values(), key=lambda d: -d["touches"]
        ),
        "runs": runs,
    }


def _frames_to_dataset(workspace: Path, frame_ids: List[int]) -> Dict[int, Dict[str, str]]:
    """Rattache des frame_id a leur dataset (chemin source, sequence, projet).

    Le journal ne stocke que le frame_id : resoudre a la lecture evite d'ecrire
    trois champs redondants a chaque retouche.
    """
    if not frame_ids:
        return {}
    db = _db_path(workspace)
    if not db.exists():
        return {}
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
    except Exception:
        return {}

    out: Dict[int, Dict[str, str]] = {}
    try:
        # Requete par lots : SQLite limite le nombre de parametres lies.
        for start in range(0, len(frame_ids), 400):
            chunk = frame_ids[start:start + 400]
            marks = ",".join("?" * len(chunk))
            rows = conn.execute(
                f"""
                SELECT f.id AS frame_id,
                       COALESCE(s.name, 'Sequence principale') AS sequence_name,
                       COALESCE(s.source_path, p.source_path, '') AS source_path,
                       p.name AS project_name
                FROM frame f
                JOIN project p ON p.id = f.project_id
                LEFT JOIN sequence s ON s.id = f.sequence_id
                WHERE f.id IN ({marks})
                """,
                chunk,
            ).fetchall()
            for r in rows:
                out[r["frame_id"]] = {
                    "sequence_name": r["sequence_name"],
                    "source_path": r["source_path"] or "",
                    "project_name": r["project_name"],
                }
    except Exception:
        return out
    finally:
        try:
            conn.close()
        except Exception:
            pass
    return out


def _user_from_workspace(workspace: Path) -> str:
    """Deduit l'utilisateur du nom de dossier : convention <app_id>_<user>
    imposee par le launcher (ex : annotation_alice -> alice)."""
    name = Path(workspace).name
    for prefix in ("annotation_", "annot_"):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def group_by_user(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Regroupe les workspaces par utilisateur, toutes racines confondues.

    Un meme utilisateur peut travailler sous plusieurs racines (wk1/annotation_bob
    et wk2/annotation_bob) : la vue globale doit sommer ses projets, pas les
    presenter comme deux personnes differentes.
    """
    users: Dict[str, Dict[str, Any]] = {}
    for e in entries:
        user = e.get("user") or "inconnu"
        u = users.setdefault(user, {
            "user": user,
            "workspaces": [],
            "roots": [],
            "projects": 0,
            "sequences": 0,
            "annotations_total": 0,
            "annotations_manual": 0,
            "annotations_auto": 0,
            "auto_edited": 0,
            "auto_deleted": 0,
            "sequences_done": 0,
            "by_source": {},
            "runs": 0,
        })
        s = e.get("summary", {})
        u["workspaces"].append(e.get("workspace", ""))
        root = e.get("root")
        if root and root not in u["roots"]:
            u["roots"].append(root)
        projects = e.get("snapshot", {}).get("projects", [])
        u["projects"] += len(projects)
        for p in projects:
            for seq in p.get("sequences", []):
                u["sequences"] += 1
                if seq.get("is_done"):
                    u["sequences_done"] += 1
        u["annotations_total"] += s.get("annotations_total", 0)
        u["annotations_manual"] += s.get("annotations_manual", 0)
        u["annotations_auto"] += s.get("annotations_auto", 0)
        u["auto_edited"] += s.get("auto_edited", 0)
        u["auto_deleted"] += s.get("auto_deleted", 0)
        u["runs"] += s.get("runs", 0)
        for src, n in (s.get("by_source") or {}).items():
            u["by_source"][src] = u["by_source"].get(src, 0) + n
    return sorted(users.values(), key=lambda u: -u["annotations_total"])


def group_by_root(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Agrege par racine partagee (un 'wk'), avec le detail des utilisateurs."""
    roots: Dict[str, Dict[str, Any]] = {}
    for e in entries:
        root = e.get("root") or "?"
        r = roots.setdefault(root, {"root": root, "entries": []})
        r["entries"].append(e)
    out = []
    for root, r in roots.items():
        users = group_by_user(r["entries"])
        out.append({
            "root": root,
            "users": users,
            "annotations_total": sum(u["annotations_total"] for u in users),
            "annotations_manual": sum(u["annotations_manual"] for u in users),
            "annotations_auto": sum(u["annotations_auto"] for u in users),
            "sequences": sum(u["sequences"] for u in users),
            "sequences_done": sum(u["sequences_done"] for u in users),
        })
    return sorted(out, key=lambda r: -r["annotations_total"])


def discover_workspaces(bases: Iterable[str]) -> List[Path]:
    """Trouve les workspaces d'annotation sous une ou plusieurs racines.

    Accepte aussi bien une racine partagee (qui contient annotation_alice,
    annotation_bob, ...) qu'un workspace deja precis.
    """
    found: List[Path] = []
    for base in bases:
        p = Path(base)
        if not p.exists():
            continue
        # Seul annotation.db identifie un workspace. Ne PAS se fier a la presence
        # d'un dossier monitoring/ : le rapport l'ecrit dans la RACINE partagee,
        # qui passerait alors pour un workspace au run suivant — et le rapport
        # se viderait de lui-meme a la deuxieme execution.
        if _db_path(p).exists():
            found.append(p)
            continue
        for child in sorted(p.iterdir()):
            if not child.is_dir():
                continue
            if _db_path(child).exists():
                found.append(child)
    # Dedoublonnage en conservant l'ordre
    seen: set = set()
    unique: List[Path] = []
    for p in found:
        key = str(p.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique
