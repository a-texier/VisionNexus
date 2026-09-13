# ============================================================
# core/dvc_runner.py
# Wrapper DVC CLI — subprocess vers JSON structuré.
# Toutes les commandes s'exécutent dans DVC_REPO_PATH.
# ============================================================

import json
import logging
import os
import subprocess
from pathlib import Path

from backend.config import DVC_REPO_PATH

logger = logging.getLogger(__name__)


def _run(args: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    """Exécute une commande DVC/git et retourne le résultat.

    IMPORTANT : la commande `dvc` nue est remplacée par `sys.executable -m dvc` —
    le backend est lancé par launcher.py sans le dossier Scripts de l'env conda
    dans le PATH, donc dvc.exe est introuvable alors que le module est installé.
    (Même correctif que MLflow_App, test complet Fable 2026-07.)"""
    import sys as _sys
    if args and args[0] == "dvc":
        args = [_sys.executable, "-m", "dvc"] + args[1:]
    repo = cwd or DVC_REPO_PATH
    try:
        result = subprocess.run(
            args,
            cwd=str(repo),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if check and result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"Exit code {result.returncode}")
        return result
    except FileNotFoundError as exc:
        raise RuntimeError(f"Commande introuvable : {args[0]}") from exc


def repo_exists() -> bool:
    """Vérifie si DVC_REPO_PATH est un repo git+DVC valide."""
    if not DVC_REPO_PATH.exists():
        return False
    git_ok  = (DVC_REPO_PATH / ".git").exists()
    dvc_ok  = (DVC_REPO_PATH / ".dvc").exists()
    return git_ok and dvc_ok


def get_status() -> dict:
    """dvc status --json → dict structuré."""
    if not repo_exists():
        return {"error": "Repo DVC non trouvé", "repo_path": str(DVC_REPO_PATH), "changes": {}}
    try:
        result = _run(["dvc", "status", "--json"], check=False)
        if result.returncode != 0:
            return {"error": result.stderr.strip(), "changes": {}}
        raw = result.stdout.strip()
        changes = json.loads(raw) if raw else {}
        return {"changes": changes, "repo_path": str(DVC_REPO_PATH)}
    except Exception as exc:
        logger.exception("dvc status error")
        return {"error": str(exc), "changes": {}}


# Trailers de lineage poses par l'Orchestrateur dans le message de commit
# (cf. Orchestrator dvc_commit_selected). On les remonte en clair pour traduire
# un commit git brut en information MLOps (quel run, quel dataset, quelle mAP).
_RS, _US, _GS = "\x1e", "\x1f", "\x1d"


def _parse_trailers(raw: str) -> dict:
    """`Key: Value` (separes par _GS) -> dict lineage structure."""
    out: dict = {"mlflow_runs": []}
    for part in (raw or "").split(_GS):
        part = part.strip()
        if not part or ":" not in part:
            continue
        key, _, val = part.partition(":")
        key, val = key.strip().lower(), val.strip()
        if not val:
            continue
        if key == "run-id":
            out["run_id"] = val
        elif key == "graph-id":
            out["graph_id"] = val
        elif key == "graph-name":
            out["graph_name"] = val
        elif key == "dataset":
            out["dataset"] = val
        elif key == "map50":
            out["map50"] = val
        elif key == "mlflow-run":
            out["mlflow_runs"].append(val)
        elif key == "parent-run":
            out["parent_run_id"] = val
    if not out["mlflow_runs"]:
        out.pop("mlflow_runs")
    return out


def get_git_log(n: int = 50) -> list[dict]:
    """git log avec fichiers .dvc touchés + trailers de lineage par commit."""
    if not repo_exists():
        return []
    try:
        # Format robuste : RS ouvre chaque commit, US separe les champs, les noms de
        # fichiers (--name-only) suivent sur des lignes propres. Les trailers (unfold,
        # separes par GS) ne contiennent pas de saut de ligne -> parsing sur.
        fmt = f"{_RS}%H{_US}%an{_US}%ae{_US}%at{_US}%s{_US}%(trailers:unfold,separator={_GS})"
        result = _run([
            "git", "log",
            f"-{n}",
            f"--format={fmt}",
            "--name-only",
            "--diff-filter=ACMD",
            "--", "*.dvc", "dvc.lock",
        ], check=False)
        if result.returncode != 0:
            return []
        commits: list[dict] = []
        for record in result.stdout.split(_RS):
            record = record.strip("\n")
            if not record:
                continue
            lines = record.split("\n")
            header = lines[0]
            fields = header.split(_US)
            if len(fields) < 5:
                continue
            sha, author, email, ts, subject = fields[0], fields[1], fields[2], fields[3], fields[4]
            trailers_raw = fields[5] if len(fields) > 5 else ""
            dvc_files = [ln.strip() for ln in lines[1:]
                         if ln.strip().endswith(".dvc") or ln.strip() == "dvc.lock"]
            try:
                ts_int = int(ts)
            except ValueError:
                ts_int = 0
            lineage = _parse_trailers(trailers_raw)
            graph_id = lineage.get("graph_id")
            if graph_id and not lineage.get("graph_name"):
                snapshot = DVC_REPO_PATH / "graphs" / f"{graph_id}.json"
                try:
                    lineage["graph_name"] = json.loads(snapshot.read_text(encoding="utf-8")).get("name") or graph_id
                except Exception:
                    lineage["graph_name"] = graph_id
            commits.append({
                "hash":      sha,
                "short":     sha[:8],
                "author":    author,
                "email":     email,
                "timestamp": ts_int,
                "subject":   subject,
                "dvc_files": dvc_files,
                "lineage":   lineage,
            })
        return commits
    except Exception:
        logger.exception("git log error")
        return []


def configure_cache_links() -> None:
    """Configure le cache DVC en liens (aucune copie physique working<->cache).

    `cache.type = reflink,hardlink,copy` : dvc essaie d'abord reflink (copy-on-write,
    ReFS/APFS), sinon hardlink (NTFS meme volume), sinon copy en dernier recours.
    Resultat : les fichiers du working dir POINTENT vers le cache au lieu d'en etre
    une 2e copie -> une seule copie physique par blob. `cache.protected = true` (impose
    par les liens) rend les objets read-only pour eviter toute corruption partagee ;
    les datasets versionnes etant immuables, c'est le comportement voulu.
    Idempotent : sans effet si deja configure. N'affecte que les dvc add / checkout
    SUIVANTS (pour relinker l'existant : `dvc checkout --relink`)."""
    if not (DVC_REPO_PATH / ".dvc").exists():
        return
    try:
        _run(["dvc", "config", "cache.type", "reflink,hardlink,copy"], check=False)
        _run(["dvc", "config", "cache.protected", "true"], check=False)
    except Exception:
        logger.exception("dvc cache.type config error")


def relink_cache() -> dict:
    """Re-materialise le working dir en liens vers le cache pour l'existant deja
    committe (`dvc checkout --relink`). Sert a de-dupliquer retroactivement apres
    activation des liens. Best-effort."""
    if not repo_exists():
        return {"ok": False, "error": "Repo DVC non trouve"}
    configure_cache_links()
    try:
        res = _run(["dvc", "checkout", "--relink"], check=False)
        return {"ok": res.returncode == 0, "output": (res.stdout or res.stderr).strip()[:500]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def add_remote(name: str, url: str, default: bool = True) -> dict:
    """Configure un remote DVC (equivalent UI de `dvc remote add`). Pour un remote
    LOCAL (chemin de dossier), cree le dossier au besoin. Rend push/pull possibles
    sans aucune ligne de commande."""
    if not repo_exists():
        return {"ok": False, "error": "Repo DVC non trouve"}
    name = (name or "").strip()
    url = (url or "").strip()
    if not name or not url:
        return {"ok": False, "error": "nom et url/chemin requis"}
    # Remote local (chemin) : creer le dossier cible s'il n'existe pas.
    _remote_schemes = ("s3://", "gs://", "azure://", "ssh://", "http://", "https://", "gdrive://", "webhdfs://")
    if not url.lower().startswith(_remote_schemes):
        try:
            from pathlib import Path as _P
            _P(url).mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            return {"ok": False, "error": f"dossier remote impossible: {exc}"}
    try:
        args = ["dvc", "remote", "add"] + (["-d"] if default else []) + ["-f", name, url]
        res = _run(args, check=False)
        if res.returncode != 0:
            return {"ok": False, "error": (res.stderr or res.stdout).strip()[:300]}
        return {"ok": True, "name": name, "url": url, "default": default}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def get_disk_usage() -> dict:
    """Tailles reelles sur disque : cache DVC vs working dir (datasets+models).
    Sert a MONTRER l'effet des liens (avec liens, working ~= 0 octet 'propre' car
    partage avec le cache). Calcul best-effort (peut etre lent sur gros datasets)."""
    def _size(p: Path) -> int:
        if not p.exists():
            return 0
        if p.is_file():
            return p.stat().st_size
        total = 0
        for f in p.rglob("*"):
            try:
                if f.is_file():
                    total += f.stat().st_size
            except OSError:
                continue
        return total

    if not repo_exists():
        return {"repo_exists": False, "repo_path": str(DVC_REPO_PATH)}
    cache = DVC_REPO_PATH / ".dvc" / "cache"
    working = _size(DVC_REPO_PATH / "datasets") + _size(DVC_REPO_PATH / "models")
    cache_type = ""
    try:
        r = _run(["dvc", "config", "cache.type"], check=False)
        cache_type = r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        pass
    return {
        "repo_exists":     True,
        "repo_path":       str(DVC_REPO_PATH),
        "cache_bytes":     _size(cache),
        "working_bytes":   working,
        "cache_type":      cache_type or "copy (defaut)",
        "linked":          bool(cache_type) and cache_type != "copy",
    }


def get_remotes() -> list[dict]:
    """Remotes DVC configures (`dvc remote list`) -> [{name, url, default}].
    Une liste vide = aucun remote -> push/pull impossibles (etat honnete affiche)."""
    if not repo_exists():
        return []
    # Parse directement .dvc/config (+ config.local) : format configobj DVC avec
    # sections `[remote "NAME"]` (ou `['remote "NAME"']`). Plus robuste que le parsing
    # de la sortie CLI (chemins Windows, tabs/espaces variables).
    import re
    try:
        default = ""
        remotes: dict[str, str] = {}
        for cfg_name in ("config", "config.local"):
            cfg = DVC_REPO_PATH / ".dvc" / cfg_name
            if not cfg.exists():
                continue
            text = cfg.read_text(encoding="utf-8", errors="replace")
            # remote par defaut : `remote = NAME` sous [core]
            dm = re.search(r'(?m)^\s*remote\s*=\s*(\S+)', text)
            if dm:
                default = dm.group(1).strip().strip('"\'')
            # sections remote + leur url
            for m in re.finditer(r'''\[\s*['"]?remote\s+"([^"]+)"['"]?\s*\][^\[]*''', text):
                name = m.group(1)
                um = re.search(r'(?m)^\s*url\s*=\s*(.+)', m.group(0))
                remotes[name] = um.group(1).strip() if um else remotes.get(name, "")
        return [{"name": n, "url": u, "default": n == default} for n, u in remotes.items()]
    except Exception:
        logger.exception("dvc remotes parse error")
        return []


def get_diff(rev_a: str, rev_b: str) -> dict:
    """dvc diff --json rev_a rev_b"""
    if not repo_exists():
        return {"error": "Repo DVC non trouvé"}
    try:
        result = _run(["dvc", "diff", "--json", rev_a, rev_b], check=False)
        if result.returncode != 0:
            return {"error": result.stderr.strip()}
        raw = result.stdout.strip()
        return json.loads(raw) if raw else {}
    except Exception as exc:
        logger.exception("dvc diff error")
        return {"error": str(exc)}


def checkout(rev: str) -> dict:
    """git checkout rev && dvc checkout"""
    if not repo_exists():
        return {"ok": False, "error": "Repo DVC non trouvé"}
    try:
        _run(["git", "checkout", rev])
        _run(["dvc", "checkout"])
        return {"ok": True, "rev": rev}
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc)}


def _parse_dvc_pointer(text: str) -> dict:
    """Parse un fichier .dvc (format YAML : `outs:` liste de {md5,size,path,...}).
    BUG historique : ces fichiers etaient parses avec json.loads -> echec systematique
    (YAML != JSON) -> page Datasets vide + version DVC introuvable. On parse en YAML,
    avec un repli manuel minimal si PyYAML absent."""
    try:
        import yaml  # dependance de dvc, presente dans l'env
        data = yaml.safe_load(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    # Repli manuel : extrait les entrees de `outs:` (md5 + path suffisent).
    outs: list[dict] = []
    cur: dict = {}
    in_outs = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("outs:"):
            in_outs = True
            continue
        if not in_outs or not s:
            continue
        if s.startswith("- "):
            if cur:
                outs.append(cur)
            cur = {}
            s = s[2:].strip()
        if ":" in s:
            k, _, v = s.partition(":")
            cur[k.strip()] = v.strip()
    if cur:
        outs.append(cur)
    return {"outs": outs}


def list_tracked_files() -> list[dict]:
    """Liste les fichiers/dossiers suivis par DVC avec taille et statut."""
    if not repo_exists():
        return []
    try:
        # Chercher tous les fichiers .dvc
        dvc_files = list(DVC_REPO_PATH.rglob("*.dvc"))
        dvc_files = [f for f in dvc_files if ".dvc" not in f.parts[:-1]]  # exclure le dossier .dvc

        # Obtenir le statut une fois
        status_result = _run(["dvc", "status", "--json"], check=False)
        status: dict = {}
        if status_result.returncode == 0 and status_result.stdout.strip():
            status = json.loads(status_result.stdout.strip())

        files: list[dict] = []
        for dvc_file in dvc_files:
            try:
                content = _parse_dvc_pointer(dvc_file.read_text(encoding="utf-8"))
                outs = content.get("outs", [])
                for out in outs:
                    path = out.get("path", "")
                    md5  = out.get("md5", out.get("hash", ""))
                    # `path` dans un .dvc est RELATIF au dossier du .dvc, pas a la
                    # racine du repo (ex. datasets/x.dvc -> path 'x' = datasets/x).
                    full_path = dvc_file.parent / path

                    size_bytes = 0
                    if full_path.is_file():
                        size_bytes = full_path.stat().st_size
                    elif full_path.is_dir():
                        size_bytes = sum(
                            f.stat().st_size
                            for f in full_path.rglob("*")
                            if f.is_file()
                        )

                    # Statut
                    dvc_key = str(dvc_file.relative_to(DVC_REPO_PATH))
                    file_status = "unchanged"
                    if dvc_key in status:
                        file_status = "modified"
                    elif not full_path.exists():
                        file_status = "missing"

                    files.append({
                        "path":          path,
                        "dvc_file":      dvc_key,
                        "md5":           md5[:8] if md5 else None,
                        "size_bytes":    size_bytes,
                        "is_dir":        full_path.is_dir(),
                        "status":        file_status,
                        "exists_locally": full_path.exists(),
                    })
            except Exception:
                continue
        return files
    except Exception as exc:
        logger.exception("list_tracked_files error")
        return []


def get_current_branch() -> str:
    """Retourne la branche git courante."""
    if not repo_exists():
        return "unknown"
    try:
        result = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], check=False)
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"
