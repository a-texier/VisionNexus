# ============================================================
# utils/debug_logger.py
# HTML debug logger — overwritten at each launch.
# Usage:
#   from backend.utils.debug_logger import dbg
#   dbg.info("pipeline_runner", "start_run", "Run started", run_id=run_id)
#   dbg.sse("graphs", "event_generator", "Waiting gate reached", step_id=sid)
# ============================================================

import inspect
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

_COLORS = {
    "info":    ("#58a6ff", "INFO   "),
    "error":   ("#f85149", "ERROR  "),
    "warning": ("#e3b341", "WARNING"),
    "sse":     ("#bc8cff", "SSE    "),
    "gate":    ("#ffb86c", "GATE   "),
    "step":    ("#50fa7b", "STEP   "),
    "http":    ("#8be9fd", "HTTP   "),
    "launch":  ("#a0f0a0", "LAUNCH "),
}

_HTML_HEADER = """\
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Debug — {title}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0d1117;color:#c9d1d9;font-family:'Consolas','Courier New',monospace;font-size:12px;padding:4px 0;overflow-x:hidden}}
#toolbar{{position:fixed;top:0;right:0;left:0;background:#161b22;border-bottom:1px solid #30363d;padding:4px 8px;display:flex;gap:8px;align-items:center;z-index:999;flex-wrap:wrap}}
#search{{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:3px 8px;border-radius:4px;flex:1;min-width:180px;max-width:380px}}
#title{{color:#484f58;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50vw}}
#logs{{margin-top:32px;overflow-x:hidden}}
.r{{display:grid;grid-template-columns:88px 72px 28ch 28ch 1fr;gap:0 8px;padding:1px 8px;border-bottom:1px solid #161b22;line-height:1.5;width:100%;overflow:hidden}}
.r:hover{{background:#161b22}}
.ts{{color:#484f58;white-space:nowrap;overflow:hidden}}
.lv{{font-weight:bold;white-space:nowrap;overflow:hidden}}
.src{{color:#6e7681;overflow:hidden;min-width:0;word-break:break-all}}
.fn{{color:#79c0ff;overflow:hidden;min-width:0;word-break:break-all}}
.msg{{overflow:hidden;min-width:0;word-break:break-word;white-space:pre-wrap;grid-column:span 1}}
.kv{{color:#ffa657;word-break:break-word;white-space:pre-wrap}}
.r.wide .msg{{grid-column:span 1}}
a{{color:inherit;text-decoration:none}}
a:hover{{text-decoration:underline;opacity:.85}}
</style>
</head>
<body>
<div id="toolbar">
  <input id="search" type="text" placeholder="Filtrer (ex: run_id, error, step_id...)" oninput="applyFilter()">
  <span id="title">{title}</span>
  <small style="color:#484f58;margin-left:auto;white-space:nowrap">F5 = refresh &nbsp; Ctrl+End = fin</small>
</div>
<div id="logs">
"""

_HTML_FOOTER = """\
</div>
<script>
function applyFilter(){
  var q=document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('.r').forEach(function(r){
    r.style.display=(!q||r.textContent.toLowerCase().includes(q))?'':'none';
  });
}
document.addEventListener('keydown',function(e){
  if(e.key==='f'&&(e.ctrlKey||e.metaKey)){
    e.preventDefault();document.getElementById('search').focus();
  }
});
</script>
</body>
</html>
"""


class DebugLogger:
    """Write colorized HTML debug entries to WORKSPACE/debug.html.

    All log methods accept positional args  (source, fn, msg)  OR just  (msg)
    with auto-detection of the caller. Extra keyword arguments are rendered as
    key=value pairs in an amber color.

    Example:
        dbg.info("pipeline_runner", "start_run", "run started", run_id="abc123")
        dbg.sse("graphs", "event_generator", "waiting gate", step_id="n1__annotate")
        dbg.error("Launch failed — port busy", port=8060)
    """

    # Cap anti-croissance illimitee : sur une longue session (polls sante, SSE...)
    # le fichier grossissait sans borne -> disque + onglet debug qui rame/gele.
    # Au-dela de MAX_ROWS on repart d'un fichier neuf (header seul).
    MAX_ROWS = 20000

    def __init__(self):
        self._path: Optional[Path] = None
        self._lock = threading.Lock()
        self._enabled = False
        self._title = ""
        self._count = 0

    def init(self, workspace: Path, title: str = "") -> None:
        """Call once at startup. Overwrites any previous debug.html."""
        self._path = workspace / "debug.html"
        self._enabled = True
        self._title = title
        self._count = 0
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        full_title = f"{title} — {ts}" if title else ts
        header = _HTML_HEADER.format(title=full_title)
        try:
            self._path.write_text(header, encoding="utf-8")
        except Exception as exc:
            print(f"[debug_logger] cannot init {self._path}: {exc}")
            self._enabled = False

    # ── Level methods ──────────────────────────────────────────────────────

    def info(self, *args, **kwargs):    self._write("info",    *args, **kwargs)
    def error(self, *args, **kwargs):   self._write("error",   *args, **kwargs)
    def warning(self, *args, **kwargs): self._write("warning", *args, **kwargs)
    def sse(self, *args, **kwargs):     self._write("sse",     *args, **kwargs)
    def gate(self, *args, **kwargs):    self._write("gate",    *args, **kwargs)
    def step(self, *args, **kwargs):    self._write("step",    *args, **kwargs)
    def http(self, *args, **kwargs):    self._write("http",    *args, **kwargs)
    def launch(self, *args, **kwargs):  self._write("launch",  *args, **kwargs)

    # ── Internal ───────────────────────────────────────────────────────────

    def _write(self, level: str, *args, **kwargs) -> None:
        if not self._enabled:
            return
        source_short, source_full, lineno, fn, msg = self._parse_args(args)
        color, label = _COLORS.get(level, ("#c9d1d9", level.upper()[:7].ljust(7)))
        ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]

        # Clickable vscode:// link — opens the exact file:line in VS Code
        if source_full and source_full != "?":
            vscode_url = f"vscode://file/{source_full.replace(chr(92), '/')}:{lineno}"
            src_html = (
                f'<span class="src" title="{_esc(source_full)}">'
                f'<a href="{_esc(vscode_url)}">{_esc(source_short)}</a>'
                f'</span>'
            )
        else:
            src_html = f'<span class="src">{_esc(source_short)}</span>'

        kv_html = ""
        if kwargs:
            parts = [f'<b>{_esc(k)}</b>=<span>{_esc(str(v))}</span>' for k, v in kwargs.items()]
            kv_html = f'<span class="kv">\n  {chr(10).join(parts)}</span>'

        row = (
            f'<div class="r">'
            f'<span class="ts">{ts}</span>'
            f'<span class="lv" style="color:{color}">{label}</span>'
            f'{src_html}'
            f'<span class="fn" title="{_esc(fn)}">{_esc(fn)}</span>'
            f'<span class="msg">{_esc(msg)}{kv_html}</span>'
            f'</div>\n'
        )

        with self._lock:
            # Rotation : au-dela du cap, on repart d'un header neuf (borne le fichier).
            if self._count >= self.MAX_ROWS:
                ts_full = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                title = f"{self._title} — {ts_full} (rotation)" if self._title else f"{ts_full} (rotation)"
                try:
                    self._path.write_text(_HTML_HEADER.format(title=title), encoding="utf-8")
                    self._count = 0
                except Exception:
                    pass
            try:
                with open(self._path, "a", encoding="utf-8") as f:
                    f.write(row)
                self._count += 1
            except Exception:
                pass

    @staticmethod
    def _parse_args(args: tuple) -> tuple[str, str, int, str, str]:
        """Accept (source, fn, msg) or (msg,) with auto-caller detection.
        Returns (source_short, source_full_path, lineno, fn_name, msg)."""
        if len(args) >= 3:
            # Explicit (source, fn, msg) — go up to caller to get real file:line
            frame = inspect.currentframe()
            for _ in range(3):
                if frame and frame.f_back:
                    frame = frame.f_back
            if frame:
                full_path = frame.f_code.co_filename
                lineno    = frame.f_lineno
            else:
                full_path, lineno = "?", 0
            src_str = str(args[0])
            # Show short label provided by caller, but attach real file link
            short = f"{src_str}:{lineno}"
            return short, full_path, lineno, str(args[1]), str(args[2])
        # Auto-detect caller (go up 3 frames: _parse_args → _write → level_method → caller)
        frame = inspect.currentframe()
        for _ in range(3):
            if frame and frame.f_back:
                frame = frame.f_back
        if frame:
            full_path = frame.f_code.co_filename
            lineno    = frame.f_lineno
            fn_name   = frame.f_code.co_name
            short     = f"{Path(full_path).name}:{lineno}"
        else:
            full_path, lineno, fn_name, short = "?", 0, "?", "?"
        msg = str(args[0]) if args else ""
        return short, full_path, lineno, fn_name, msg


def _esc(text: str) -> str:
    return (
        text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


# Module-level singleton
dbg = DebugLogger()
