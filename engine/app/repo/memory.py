"""Repositorio en memoria: tests y desarrollo sin base de datos. Misma semántica que Postgres."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.domain.models import OfferSet, TripRequest
from app.optimizer.price_advice import PriceStats, percentiles
from app.repo.base import NON_TERMINAL, RunLimits, RunRecord, build_offer_set, check_limits, offer_key


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MemoryRepository:
    def __init__(self):
        self.runs: dict[str, dict] = {}
        self.client_errors: list[dict] = []
        self.offers: dict[tuple[str, str, str], dict] = {}
        self.itineraries: dict[str, list[dict]] = {}
        self.usage: list[dict] = []
        self.shares: dict[str, dict] = {}

    async def create_run(self, req: TripRequest, mode: str, user_id: str | None,
                         limits: RunLimits | None = None) -> str:
        if limits:
            hour_ago = _now() - timedelta(hours=1)
            mine = [r for r in self.runs.values() if r["user_id"] == user_id]
            check_limits(limits, sum(r["status"] in NON_TERMINAL for r in self.runs.values()),
                         sum(r["status"] in NON_TERMINAL for r in mine), sum(r["created_at"] >= hour_ago for r in mine))
        rid = str(uuid.uuid4())
        self.runs[rid] = {
            "id": rid, "user_id": user_id, "status": "queued", "mode": mode,
            "request": req, "summary": {}, "error": None,
            "timings": {"queued": _now().isoformat()}, "created_at": _now(), "updated_at": _now(),
        }
        return rid

    async def get_run(self, run_id: str) -> RunRecord | None:
        r = self.runs.get(run_id)
        if r is None:
            return None
        return RunRecord(**{k: v for k, v in r.items() if k not in ("created_at", "updated_at")})

    async def transition(self, run_id, allowed_from, to, *, summary=None, error=None) -> bool:
        r = self.runs.get(run_id)
        if r is None or r["status"] not in allowed_from:
            return False
        r["status"] = to
        r["timings"][to] = _now().isoformat()
        r["updated_at"] = _now()
        if summary is not None:
            r["summary"] = summary
        if error is not None:
            r["error"] = error
        return True

    async def log_client_error(self, user_id, message, digest, path) -> None:
        self.client_errors.append({"user_id": user_id, "message": message, "digest": digest, "path": path})

    async def mark_degraded(self, run_id, kind, reason) -> None:
        r = self.runs[run_id]
        r["summary"] = {**r["summary"], "degraded": {**r["summary"].get("degraded", {}), kind: reason}}

    async def upsert_offers(self, run_id, kind, offers) -> int:
        for o in offers:
            oid, provider = offer_key(kind, o)
            self.offers[(run_id, kind, oid)] = {"provider": provider, "payload": o.model_dump(mode="json")}
        return len(offers)

    async def load_offers(self, run_id) -> OfferSet:
        return build_offer_set(
            (kind, row["payload"]) for (rid, kind, _), row in sorted(self.offers.items()) if rid == run_id
        )

    async def save_itineraries(self, run_id, user_id, rows) -> None:
        self.itineraries[run_id] = list(rows)

    async def get_itineraries(self, run_id) -> list[dict]:
        return self.itineraries.get(run_id, [])

    async def flight_price_stats(self, origin: str, destination: str, day: str) -> PriceStats:
        # Misma regla que la función SQL: precios reales de los últimos 30 días, cada (oferta, cotización) una vez.
        limit = _now() - timedelta(days=30)
        obs = {
            (oid, row["payload"]["fetched_at"]): row["payload"]["price_per_pax_minor"]
            for (rid, kind, oid), row in self.offers.items()
            if kind == "flights" and row["provider"] not in ("fixture", "simulado")
            and self.runs.get(rid, {}).get("created_at", limit) > limit and row["payload"].get("fetched_at")
            and row["payload"]["origin"] == origin and row["payload"]["destination"] == destination
            and row["payload"]["depart_at"][:10] == day
        }
        if not obs:
            return PriceStats(0, 0, None, None, None)
        p20, med, p80 = percentiles(list(obs.values()))
        return PriceStats(len({at for _, at in obs}), len(obs), p20, med, p80)

    async def create_share(self, run_id: str, user_id: str) -> str:
        for token, sh in self.shares.items():
            if sh["run_id"] == run_id and sh["user_id"] == user_id:
                return token
        token = str(uuid.uuid4())
        self.shares[token] = {"run_id": run_id, "user_id": user_id, "expires_at": _now() + timedelta(days=30)}
        return token

    async def get_share(self, token: str) -> str | None:
        sh = self.shares.get(token)
        return sh["run_id"] if sh and sh["expires_at"] > _now() and sh["run_id"] in self.runs else None

    async def log_usage(self, run_id, events) -> None:
        self.usage.extend({**e, "run_id": run_id} for e in events)

    async def reap_stale(self, older_than_s: int) -> int:
        limit = _now() - timedelta(seconds=older_than_s)
        n = 0
        for r in self.runs.values():
            if r["status"] in NON_TERMINAL and r["updated_at"] < limit:
                r.update(status="failed", error={"code": "stale_run"}, updated_at=_now())
                n += 1
        return n

    async def purge_older_than(self, days: int) -> int:
        limit = _now() - timedelta(days=days)
        old = [rid for rid, r in self.runs.items() if r["created_at"] < limit]
        for rid in old:
            del self.runs[rid]
            self.itineraries.pop(rid, None)
            self.offers = {k: v for k, v in self.offers.items() if k[0] != rid}
        return len(old)

    async def close(self) -> None:
        return None
