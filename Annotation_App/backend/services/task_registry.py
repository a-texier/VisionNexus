# ============================================================
# services/task_registry.py
# Registre en memoire pour suivre l'etat des taches
# asynchrones en arriere-plan (ByteTrack, propagation, etc.)
# ============================================================

import threading
from collections import deque
import time
from typing import Optional

# Dictionnaire global des taches : task_id -> dict
_LIVE_QUEUE_MAX = 600   # ~40 s de propagation a 15 f/s

_tasks: dict[str, dict] = {}
_lock = threading.Lock()

# Nombre max de lignes de log conservees par tache (anneau)
_MAX_LOG_LINES = 300


def create_task(task_id: str, name: str) -> dict:
    """
    Enregistre une nouvelle tache avec le statut 'pending'.

    Args:
        task_id: Identifiant unique de la tache (UUID)
        name: Description lisible de la tache

    Returns:
        Dict representant l'etat initial de la tache
    """
    task = {
        "id": task_id,
        "status": "pending",
        "progress": 0,
        "message": name,
        "error": None,
        "result": None,
        "current_frame_id": None,  # ID DB de la frame en cours (pour navigation temps reel)
        "live_frame": None,        # Apercu leger de la frame en cours (voir update_task)
        # File des apercus PAS ENCORE pousses au client. `live_frame` seul est un
        # slot unique ECRASE a chaque frame : la boucle WS ne le relit que toutes
        # les 150 ms alors que la propagation tourne a 5-15 frames/s, donc les
        # frames intercalees disparaissaient sans jamais etre annoncees. Mesure
        # du 2026-09-07 sur 201 frames : 18% des frames traitees n'ont jamais ete
        # poussees (et la proportion empire quand le GPU va plus vite). Cote UI,
        # ces frames restaient marquees "non annotee" (pastille rouge) jusqu'au
        # flush DB suivant ou la fin du run -- l'effet visuel bizarre de la
        # timeline. Cette file conserve TOUS les apercus jusqu'a leur envoi.
        "live_frames_pending": deque(maxlen=_LIVE_QUEUE_MAX),
        "stop_requested": False,   # Arret demande par l'utilisateur
        "pause_requested": False,  # Pause demandee par l'utilisateur
        "logs": [],                # Lignes de log temps reel (memes que le terminal)
    }
    with _lock:
        _tasks[task_id] = task
    return task


def append_log(task_id: str, line: str, also_print: bool = True) -> None:
    """
    Ajoute une ligne de log a une tache (visible en temps reel cote UI) et,
    par defaut, l'imprime aussi dans le terminal serveur. Anneau borne a
    _MAX_LOG_LINES pour eviter la croissance memoire sur les longs runs.
    """
    stamped = f"[{time.strftime('%H:%M:%S')}] {line}"
    if also_print:
        # Console Windows en cp1252 : un caractere non encodable (fleche, emoji)
        # leverait UnicodeEncodeError et ferait ECHOUER toute la tache. On imprime
        # donc de maniere defensive (repli ASCII).
        try:
            print(line)
        except UnicodeEncodeError:
            print(line.encode("ascii", "replace").decode("ascii"))
    with _lock:
        task = _tasks.get(task_id)
        if task is None:
            return
        logs = task.setdefault("logs", [])
        logs.append(stamped)
        if len(logs) > _MAX_LOG_LINES:
            del logs[: len(logs) - _MAX_LOG_LINES]


def format_progress_bar(done: int, total: int, fps: Optional[float] = None,
                        extra: str = "", width: int = 24) -> str:
    """Formate une barre de progression texte homogene pour TOUS les trackers :
        [████████████░░░░░░░░] 62% (111/179) 4.2 fps ETA 16s <extra>
    Les blocs unicode ne sont pas encodables en cp1252 : append_log imprime de
    maniere defensive (repli ASCII) cote terminal, mais le panneau web (UTF-8)
    affiche bien la barre."""
    total = max(int(total), 1)
    done = max(0, min(int(done), total))
    frac = done / total
    filled = int(round(frac * width))
    bar = "█" * filled + "░" * (width - filled)
    parts = [f"[{bar}] {int(frac * 100):3d}% ({done}/{total})"]
    if fps is not None and fps > 0:
        eta = (total - done) / fps
        parts.append(f"{fps:.1f} fps")
        parts.append(f"ETA {eta:.0f}s")
    if extra:
        parts.append("— " + extra)
    return " ".join(parts)


def append_progress(task_id: str, label: str, done: int, total: int,
                    fps: Optional[float] = None, extra: str = "") -> None:
    """Ajoute une ligne de barre de progression prefixee par `label` (ex '[Detect]')."""
    append_log(task_id, f"{label} {format_progress_bar(done, total, fps, extra)}")


def update_task(
    task_id: str,
    status: str,
    progress: int = 0,
    message: str = "",
    error: Optional[str] = None,
    current_frame_id: Optional[int] = None,
    live_frame: Optional[dict] = None,
) -> None:
    """
    Met a jour l'etat d'une tache existante.

    Args:
        task_id: ID de la tache a mettre a jour
        status: Nouvel etat ('pending' | 'running' | 'paused' | 'completed' | 'error')
        progress: Progression en pourcentage (0-100)
        message: Message de statut lisible
        error: Message d'erreur si status == 'error'
        current_frame_id: ID DB de la frame en cours de traitement (navigation temps reel)
        live_frame: Apercu leger de la frame en cours (dict JSON-serialisable, ex:
            {"frame_id":.., "objects":[{"class_id":.., "bbox":[cx,cy,w,h], "polygon":.., "score":..}]}).
            Pousse par le canal WS /ws/tasks/{id} pour un rendu instantane cote client
            SANS dependre du commit DB (les ecritures SAM2/SAMURAI sont groupees par
            lots — cf. tracking.py _write_frame_batch — donc potentiellement pas encore
            en base au moment ou cette frame est affichee).
    """
    with _lock:
        if task_id in _tasks:
            patch = {
                "status": status,
                "progress": progress,
                "message": message,
                "error": error,
            }
            if current_frame_id is not None:
                patch["current_frame_id"] = current_frame_id
            if live_frame is not None:
                patch["live_frame"] = live_frame
            _tasks[task_id].update(patch)
            if live_frame is not None:
                # deque bornee : si aucun client n'ecoute (onglet ferme), on
                # laisse tomber les plus anciens plutot que de gonfler sans fin.
                _tasks[task_id]["live_frames_pending"].append(live_frame)


def drain_live_frames(task_id: str) -> list:
    """Retire et retourne tous les apercus en attente pour cette tache.

    Appele par la boucle WS : elle envoie ainsi CHAQUE frame propagee, meme si
    plusieurs se sont accumulees entre deux tours de boucle. Le cout reseau
    reste negligeable (une bbox ~200 octets, contre 3-15 Ko pour l'image de la
    frame), et surtout il passe par la connexion WS deja ouverte : aucune
    requete HTTP supplementaire, aucun slot de connexion navigateur consomme.
    """
    with _lock:
        task = _tasks.get(task_id)
        if not task:
            return []
        q = task.get("live_frames_pending")
        if not q:
            return []
        items = list(q)
        q.clear()
        return items


def set_task_result(task_id: str, result: dict) -> None:
    """
    Stocke le resultat final d'une tache (ex: anomalies du tracking guide).

    Args:
        task_id: ID de la tache
        result: Dict quelconque a stocker dans le champ 'result'
    """
    with _lock:
        if task_id in _tasks:
            _tasks[task_id]["result"] = result


def get_task(task_id: str) -> Optional[dict]:
    """
    Retourne l'etat d'une tache par son ID, SANS les logs (poll rapide, leger).
    Les logs se recuperent via get_task_logs (poll plus lent + incrementiel).
    La file live_frames_pending est interne au WebSocket : elle contient une
    deque, donc elle ne doit jamais sortir par l'API HTTP /api/tasks/{id}.

    Returns:
        Dict de la tache, ou None si introuvable
    """
    with _lock:
        task = _tasks.get(task_id)
        if not task:
            return None
        d = dict(task)
        d.pop("logs", None)  # logs servis separement pour ne pas alourdir le poll
        d.pop("live_frames_pending", None)
        return d


def get_task_logs(task_id: str, since: int = 0) -> Optional[dict]:
    """
    Retourne les lignes de log a partir de l'index `since` (incrementiel).
    Le client renvoie le `next` recu au poll suivant → ne transfere que le neuf.
    """
    with _lock:
        task = _tasks.get(task_id)
        if not task:
            return None
        logs = task.get("logs", [])
        start = max(0, min(since, len(logs)))
        return {"lines": logs[start:], "next": len(logs)}


def delete_task(task_id: str) -> None:
    """Supprime une tache du registre (nettoyage)."""
    with _lock:
        _tasks.pop(task_id, None)


# ---- Controle pause / stop ----

def request_stop(task_id: str) -> None:
    """Demande l'arret propre d'une tache en cours."""
    with _lock:
        if task_id in _tasks:
            _tasks[task_id]["stop_requested"] = True
            _tasks[task_id]["pause_requested"] = False  # Annuler la pause si active


def request_pause(task_id: str) -> None:
    """Met une tache en pause (la tache verifie le flag dans sa boucle)."""
    with _lock:
        if task_id in _tasks:
            _tasks[task_id]["pause_requested"] = True


def request_resume(task_id: str) -> None:
    """Reprend une tache en pause."""
    with _lock:
        if task_id in _tasks:
            _tasks[task_id]["pause_requested"] = False


def is_stop_requested(task_id: str) -> bool:
    """Retourne True si un arret a ete demande pour cette tache."""
    with _lock:
        task = _tasks.get(task_id)
        return bool(task.get("stop_requested", False)) if task else False


def is_pause_requested(task_id: str) -> bool:
    """Retourne True si une pause a ete demandee pour cette tache."""
    with _lock:
        task = _tasks.get(task_id)
        return bool(task.get("pause_requested", False)) if task else False
