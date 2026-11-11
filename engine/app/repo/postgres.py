"""Repositorio Postgres (Supabase). El motor es el ÚNICO escritor de estas tablas.

DATABASE_URL local : postgresql://postgres:postgres@127.0.0.1:55322/postgres
DATABASE_URL prod  : cadena del Session pooler de Supabase (IPv4), con sslmode=require
"""
from __future__ import annotations

from psycopg import AsyncConnection
from psycopg.rows import DictRow, dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.domain.models import OfferSet, TripRequest
from app.repo.base import NON_TERMINAL, RunLimits, RunRecord, build_offer_set, check_limits, offer_key
from app.optimizer.price_advice import PriceStats
from app.services.cache import Entry


def _first(row: DictRow | None) -> DictRow:
    """Consultas que siempre devuelven una fila (agregados, INSERT ... RETURNING)."""
    if row is None:
        raise RuntimeError("la consulta no devolvió filas")
    return row


class PgRepository:
    def __init__(self, dsn: str):
        self.pool = AsyncConnectionPool[AsyncConnection[DictRow]](
            dsn, min_size=1, max_size=10, open=False, connection_class=AsyncConnection[DictRow],
            kwargs={"prepare_threshold": None, "row_factory": dict_row},  # compatible con pooler
        )

    async def open(self) -> "PgRepository":
        await self.pool.open(wait=True, timeout=10)  # falla al arrancar si la DB no responde, no en cada request
        return self

    async def close(self) -> None:
        await self.pool.close()

    async def create_run(self, req: TripRequest, mode: str, user_id: str | None,
                         limits: RunLimits | None = None) -> str:
        async with self.pool.connection() as conn:  # una transacción: el lock vive hasta el commit
            if limits:
                await conn.execute("select pg_advisory_xact_lock(hashtext('search_runs.create'))")
                c = _first(await (
                    await conn.execute(
                        """select count(*) filter (where status = any(%(nt)s::public.run_status[])) as total_active,
                                  count(*) filter (where user_id = %(u)s
                                                     and status = any(%(nt)s::public.run_status[])) as active,
                                  count(*) filter (where user_id = %(u)s
                                                     and created_at > now() - interval '1 hour') as last_hour
                           from public.search_runs
                           where status = any(%(nt)s::public.run_status[])
                              or (user_id = %(u)s and created_at > now() - interval '1 hour')""",
                        {"nt": list(NON_TERMINAL), "u": user_id},
                    )
                ).fetchone())
                check_limits(limits, c["total_active"], c["active"], c["last_hour"])
            tr = _first(await (
                await conn.execute(
                    "insert into public.trip_requests (user_id, case_key, payload) values (%s, %s, %s) returning id",
                    (user_id, req.case_key, Jsonb(req.model_dump(mode="json"))),
                )
            ).fetchone())
            run = _first(await (
                await conn.execute(
                    """insert into public.search_runs (trip_request_id, user_id, mode, timings)
                       values (%s, %s, %s, jsonb_build_object('queued', now())) returning id""",
                    (tr["id"], user_id, mode),
                )
            ).fetchone())
            return str(run["id"])

    async def get_run(self, run_id: str) -> RunRecord | None:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """select r.id, r.user_id, r.status::text as status, r.mode::text as mode,
                              r.summary, r.error, r.timings, t.payload as request
                       from public.search_runs r join public.trip_requests t on t.id = r.trip_request_id
                       where r.id = %s""",
                    (run_id,),
                )
            ).fetchone()
        if row is None:
            return None
        return RunRecord(
            id=str(row["id"]), user_id=str(row["user_id"]) if row["user_id"] else None,
            status=row["status"], mode=row["mode"], request=TripRequest.model_validate(row["request"]),
            summary=row["summary"], error=row["error"], timings=row["timings"],
        )

    async def transition(self, run_id, allowed_from, to, *, summary=None, error=None) -> bool:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """update public.search_runs
                       set status  = %s::public.run_status,
                           summary = coalesce(%s, summary),
                           error   = coalesce(%s, error),
                           timings = timings || jsonb_build_object(%s::text, now())
                       where id = %s and status = any(%s::public.run_status[])
                       returning id""",
                    (to, Jsonb(summary) if summary is not None else None,
                     Jsonb(error) if error is not None else None, to, run_id, list(allowed_from)),
                )
            ).fetchone()
            return row is not None

    async def log_client_error(self, user_id, message, digest, path) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("insert into public.client_errors (user_id, message, digest, path) values (%s, %s, %s, %s)",
                               (user_id, message, digest, path))

    async def mark_degraded(self, run_id, kind, reason) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """update public.search_runs
                   set summary = summary || jsonb_build_object(
                         'degraded', coalesce(summary->'degraded', '{}'::jsonb) || jsonb_build_object(%s::text, %s::text))
                   where id = %s""",
                (kind, reason, run_id),
            )

    async def upsert_offers(self, run_id, kind, offers) -> int:
        rows: dict[str, tuple[str, Jsonb]] = {}  # por oferta: un mismo INSERT no puede tocar dos veces la misma fila
        for o in offers:
            oid, provider = offer_key(kind, o)
            # sin los campos nulos, que es lo que más se repite; al leer, el modelo repone su valor por defecto
            rows[oid] = (provider, Jsonb(o.model_dump(mode="json", exclude_none=True)))
        if not rows:
            return 0
        # Una sola sentencia: un viaje a la base y todo o nada (nunca una corrida a medio guardar).
        async with self.pool.connection() as conn:
            await conn.execute(
                """insert into public.run_offers (run_id, kind, offer_id, provider, payload)
                   select %s::uuid, %s::text, t.* from unnest(%s::text[], %s::text[], %s::jsonb[]) as t
                   on conflict (run_id, kind, offer_id)
                   do update set payload = excluded.payload, provider = excluded.provider""",
                (run_id, kind, list(rows), [p for p, _ in rows.values()], [j for _, j in rows.values()]),
            )
        return len(rows)

    async def load_offers(self, run_id) -> OfferSet:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select kind, payload from public.run_offers where run_id = %s order by kind, offer_id",
                    (run_id,),
                )
            ).fetchall()
        return build_offer_set((r["kind"], r["payload"]) for r in rows)

    async def save_itineraries(self, run_id, user_id, rows) -> None:
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute("delete from public.itineraries where run_id = %s", (run_id,))
                async with conn.cursor() as cur:
                    await cur.executemany(
                        """insert into public.itineraries
                           (run_id, rank, user_id, skeleton_id, total_minor, currency, within_budget, payload)
                           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
                        [(run_id, it["rank"], user_id, it["skeleton_id"], it["total_minor"],
                          it["currency"], it["within_budget"], Jsonb(it)) for it in rows],
                    )

    async def get_itineraries(self, run_id) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select payload from public.itineraries where run_id = %s order by rank", (run_id,)
                )
            ).fetchall()
        return [r["payload"] for r in rows]

    async def flight_price_stats(self, origin: str, destination: str, day: str) -> PriceStats:
        async with self.pool.connection() as conn:
            row = _first(await (
                await conn.execute("select * from public.flight_price_stats(%s, %s, %s)", (origin, destination, day))
            ).fetchone())
        f = lambda v: None if v is None else float(v)  # noqa: E731
        return PriceStats(row["snapshots"], row["observations"], f(row["p20"]), f(row["median"]), f(row["p80"]))

    async def create_share(self, run_id: str, user_id: str) -> str:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """insert into public.shared_itineraries (run_id, created_by) values (%s, %s)
                       on conflict (run_id, created_by) do update set expires_at = now() + interval '30 days'
                       returning token""",
                    (run_id, user_id),
                )
            ).fetchone()
        return str(_first(row)["token"])

    async def get_share(self, token: str) -> str | None:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    "select run_id from public.shared_itineraries where token = %s and expires_at > now()", (token,)
                )
            ).fetchone()
        return None if row is None else str(row["run_id"])

    async def log_usage(self, run_id, events) -> None:
        if not events:
            return
        async with self.pool.connection() as conn, conn.cursor() as cur:
            await cur.executemany(
                """insert into public.api_usage (provider, endpoint, status_code, latency_ms, run_id)
                   values (%s, %s, %s, %s, %s)""",
                [(e["provider"], e["endpoint"], e["status_code"], e["latency_ms"], run_id) for e in events],
            )

    async def purge_older_than(self, days: int) -> int:
        async with self.pool.connection() as conn:  # una transacción: o se borra todo o nada
            return await _purge(conn, days)

    async def reap_stale(self, older_than_s: int) -> int:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    """update public.search_runs
                       set status = 'failed', error = jsonb_build_object('code', 'stale_run')
                       where status = any(%s::public.run_status[])
                         and updated_at < now() - make_interval(secs => %s)
                       returning id""",
                    (list(NON_TERMINAL), older_than_s),
                )
            ).fetchall()
        return len(rows)



async def _purge(conn, days: int) -> int:
    row = await (
        await conn.execute(
            """with gone as (delete from public.trip_requests
                             where created_at < now() - make_interval(days => %s) returning 1)
               select count(*) as n from gone""",
            (days,),
        )
    ).fetchone()
    await conn.execute("delete from public.api_usage where called_at < now() - make_interval(days => %s)", (days,))
    await conn.execute("delete from public.client_errors where created_at < now() - make_interval(days => %s)", (days,))
    # Lo vencido se guarda hasta la retención: es el respaldo del modo histórico si se agota la cuota de un proveedor.
    await conn.execute("delete from public.api_cache where expires_at < now() - make_interval(days => %s)", (days,))
    return int(_first(row)["n"])


class PgCache:
    """Implementación de app.services.cache.Cache sobre la tabla api_cache."""

    def __init__(self, pool: AsyncConnectionPool[AsyncConnection[DictRow]]):
        self.pool = pool

    async def get(self, key: str):
        e = await self.entry(key)
        return None if e is None else e.value

    async def entry(self, key: str, stale_ok: bool = False) -> Entry | None:
        async with self.pool.connection() as conn:
            row = await (
                await conn.execute(
                    """select payload, fetched_at from public.api_cache
                       where cache_key = %s and (%s or expires_at is null or expires_at > now())""",
                    (key, stale_ok),
                )
            ).fetchone()
        return None if row is None else Entry(row["payload"], row["fetched_at"])

    async def set(self, key: str, provider: str, value, ttl_s: int | None, fetched_at=None) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """insert into public.api_cache (cache_key, provider, payload, fetched_at, expires_at)
                   values (%s, %s, %s, coalesce(%s::timestamptz, now()),
                           case when %s::int is null then null else now() + make_interval(secs => %s::int) end)
                   on conflict (cache_key) do update
                   set payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at""",
                (key, provider, Jsonb(value), fetched_at, ttl_s, ttl_s),
            )
