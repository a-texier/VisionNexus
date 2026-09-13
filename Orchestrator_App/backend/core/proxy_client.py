# ============================================================
# core/proxy_client.py
# Client HTTP async vers chaque app cible.
# ============================================================

import asyncio
import time
import httpx
from backend.config import APP_URLS, APP_FRONTEND_URLS


async def ping(app_name: str) -> dict:
    url = APP_URLS.get(app_name)
    if not url:
        return {"status": "down", "latency_ms": None, "frontend_url": ""}
    try:
        t0 = time.monotonic()
        async with httpx.AsyncClient(timeout=5.0) as c:
            r = await c.get(f"{url}/health")
        latency = round((time.monotonic() - t0) * 1000)
        status = "ok" if r.status_code < 400 else "down"
    except Exception:
        latency = None
        status = "down"
    return {
        "status": status,
        "latency_ms": latency,
        "frontend_url": APP_FRONTEND_URLS.get(app_name, ""),
    }


async def ping_all() -> dict[str, dict]:
    names = list(APP_URLS.keys())
    results = await asyncio.gather(*[ping(n) for n in names])
    return dict(zip(names, results))


async def request(
    app_name: str,
    method: str,
    endpoint: str,
    params: dict,
    timeout: float = 600.0,
) -> dict:
    base_url = APP_URLS.get(app_name)
    if not base_url:
        return {"ok": False, "status_code": 0, "data": f"Unknown app: {app_name}"}

    # endpoint already starts with /api/ or not — we prepend /api if missing
    if not endpoint.startswith("/api"):
        full_endpoint = f"/api{endpoint}" if endpoint.startswith("/") else f"/api/{endpoint}"
    else:
        full_endpoint = endpoint

    full_url = f"{base_url}{full_endpoint}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            m = method.upper()
            if m in ("GET", "DELETE"):
                r = await c.request(m, full_url, params=params or None)
            else:
                r = await c.request(m, full_url, json=params or None)
        ok = r.status_code < 400
        try:
            data = r.json()
            if isinstance(data, (dict, list)):
                import json
                # Les réponses Training contiennent le chemin exact de best.pt et
                # les résultats HPO. Les tronquer rendait le JSON invalide et
                # empêchait ensuite DVC de résoudre les artefacts du run.
                data_str = json.dumps(data)[:100_000]
            else:
                data_str = str(data)[:100_000]
        except Exception:
            data_str = r.text[:100_000]
        return {"ok": ok, "status_code": r.status_code, "data": data_str}
    except Exception as exc:
        return {"ok": False, "status_code": 0, "data": str(exc)}
