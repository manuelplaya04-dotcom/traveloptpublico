"""Caché de APIs contra Postgres real (tabla api_cache), no la de memoria. Corre si TEST_DATABASE_URL apunta a una base
con las migraciones aplicadas (local: `npx supabase start`, puerto 55322). Sin esa variable se omite."""
import asyncio
import os
import selectors
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.repo.postgres import PgCache, PgRepository
from app.services.cache import cached_entry

DSN = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DSN, reason="sin TEST_DATABASE_URL (Postgres local)")


def _run(test):
    async def go():
        repo = await PgRepository(DSN).open()
        key = f"test-{uuid.uuid4()}"
        try:
            await test(repo, PgCache(repo.pool), key)
        finally:
            async with repo.pool.connection() as conn:
                await conn.execute("delete from public.api_cache where cache_key like %s", (f"{key}%",))
            await repo.close()

    # psycopg async no corre sobre el loop Proactor de Windows (el motor en Render es Linux)
    asyncio.run(go(), loop_factory=lambda: asyncio.SelectorEventLoop(selectors.SelectSelector()))


def test_guarda_en_disco_con_la_misma_fecha_que_ve_quien_pidio():
    async def t(repo, cache, key):
        entry, hit = await cached_entry(cache, key, "p", 3600, lambda: _value({"a": 1}))
        again = await cache.entry(key)
        assert not hit and again is not None and again.value == {"a": 1}
        assert again.fetched_at == entry.fetched_at  # una sola marca de cotización
        assert (await cached_entry(cache, key, "p", 3600, _boom))[1]  # segunda vez: de la caché, sin llamar

    _run(t)


def test_lo_vencido_no_es_fresco_pero_sirve_para_el_modo_historico():
    async def t(repo, cache, key):
        await cache.set(key, "p", {"old": True}, -60)  # venció hace un minuto
        assert await cache.get(key) is None and await cache.entry(key) is None
        stale = await cache.entry(key, stale_ok=True)
        assert stale is not None and stale.value == {"old": True}

    _run(t)


def test_la_retencion_borra_lo_vencido_hace_mas_de_30_dias_y_conserva_el_resto():
    async def t(repo, cache, key):
        old = datetime.now(UTC) - timedelta(days=40)
        await cache.set(f"{key}-viejo", "p", {"x": 1}, -35 * 86400, old)
        await cache.set(f"{key}-reciente", "p", {"x": 2}, -86400)
        await repo.purge_older_than(30)
        assert await cache.entry(f"{key}-viejo", stale_ok=True) is None
        assert await cache.entry(f"{key}-reciente", stale_ok=True) is not None

    _run(t)


async def _value(v):
    return v


async def _boom():
    raise AssertionError("no debería llamar al proveedor")


def test_links_compartidos_en_postgres_real():
    async def t(repo, cache, key):
        from app.providers.fixture import FixtureProvider

        async with repo.pool.connection() as conn:
            uid = (await (await conn.execute(
                "insert into auth.users (id, email) values (gen_random_uuid(), %s) returning id",
                (f"{key}@test.local",))).fetchone())["id"]
        try:
            rid = await repo.create_run(FixtureProvider("orlando_nyc_5pax").trip_request(), "fixture", str(uid))
            token = await repo.create_share(rid, str(uid))
            assert await repo.create_share(rid, str(uid)) == token  # idempotente
            assert await repo.get_share(token) == rid
            assert await repo.get_share(str(uuid.uuid4())) is None
        finally:
            async with repo.pool.connection() as conn:
                await conn.execute("delete from auth.users where id = %s", (uid,))  # cascada: búsqueda y link

    _run(t)


def test_estadistica_de_precios_en_postgres_real():
    async def t(repo, cache, key):
        from datetime import UTC, datetime

        from app.domain.models import FlightOffer
        from app.providers.fixture import FixtureProvider

        req = FixtureProvider("orlando_nyc_5pax").trip_request()
        day = datetime(2031, 3, 3, 9, 0)
        run_ids = []
        try:
            for s in range(3):
                rid = await repo.create_run(req, "hybrid", None)
                run_ids.append(rid)
                await repo.upsert_offers(rid, "flights", [FlightOffer(
                    id=f"{key}-{i}", provider="serpapi_google_flights", origin="QQA", destination="QQB", depart_at=day,
                    arrive_at=day, stops=0, carrier="B6", price_per_pax_minor=10000 * (i + 1), seats_available=9,
                    fetched_at=datetime(2026, 11, 1 + s, tzinfo=UTC)) for i in range(5)])
            st = await repo.flight_price_stats("QQA", "QQB", "2031-03-03")
            assert (st.snapshots, st.observations, st.p20, st.median, st.p80) == (3, 15, 18000.0, 30000.0, 42000.0)
        finally:
            async with repo.pool.connection() as conn:
                await conn.execute("delete from public.search_runs where id = any(%s)", (run_ids,))

    _run(t)


def test_ofertas_en_una_sola_sentencia_sin_nulos_y_con_lectura_identica():
    async def t(repo, cache, key):
        from datetime import datetime

        from app.domain.models import FlightOffer
        from app.providers.fixture import FixtureProvider

        req = FixtureProvider("orlando_nyc_5pax").trip_request()
        day = datetime(2031, 3, 3, 9, 0)
        offer = lambda i, price: FlightOffer(  # noqa: E731
            id=f"{key}-{i}", provider="p", origin="QQA", destination="QQB", depart_at=day, arrive_at=day, stops=0,
            carrier="B6", price_per_pax_minor=price, seats_available=9)
        rid = await repo.create_run(req, "hybrid", None)
        try:
            offers = [offer(i, 1000 + i) for i in range(500)]
            # repetida en la misma tanda: gana la última, sin el error "cannot affect row a second time"
            assert await repo.upsert_offers(rid, "flights", [*offers, offer(0, 9999)]) == 500
            assert await repo.upsert_offers(rid, "flights", [offer(1, 7777)]) == 1  # reintento idempotente
            assert await repo.upsert_offers(rid, "flights", []) == 0
            loaded = {f.id: f for f in (await repo.load_offers(rid)).flights}
            assert len(loaded) == 500
            assert loaded[f"{key}-0"].price_per_pax_minor == 9999 and loaded[f"{key}-1"].price_per_pax_minor == 7777
            assert loaded[f"{key}-2"] == offers[2]  # los nulos no se guardan y al leer vuelven igual
            async with repo.pool.connection() as conn:
                row = await (await conn.execute(
                    "select payload from public.run_offers where run_id = %s limit 1", (rid,))).fetchone()
            assert "deeplink" not in row["payload"] and "fetched_at" not in row["payload"]
        finally:
            async with repo.pool.connection() as conn:
                await conn.execute("delete from public.search_runs where id = %s", (rid,))

    _run(t)


def test_limite_por_conexion_en_postgres_real():
    async def t(repo, cache, key):
        from app.providers.fixture import FixtureProvider
        from app.repo.base import RateLimited, RunLimits

        req = FixtureProvider("orlando_nyc_5pax").trip_request()
        client = uuid.uuid4().hex
        lim = RunLimits(per_user_active=5, per_user_hour=50, total_active=10_000, per_client_hour=2)
        async with repo.pool.connection() as conn:  # sesiones anónimas distintas: un usuario por corrida
            users = [str((await (await conn.execute(
                "insert into auth.users (id, email) values (gen_random_uuid(), %s) returning id",
                (f"{key}-{i}@test.local",))).fetchone())["id"]) for i in range(4)]
        ids = []
        try:
            for u in users[:2]:
                rid = await repo.create_run(req, "fixture", u, lim, client)
                ids.append(rid)
                await repo.transition(rid, {"queued"}, "done")
            with pytest.raises(RateLimited) as exc:
                await repo.create_run(req, "fixture", users[2], lim, client)
            assert exc.value.scope == "client"
            ids.append(await repo.create_run(req, "fixture", users[3], lim, uuid.uuid4().hex))  # otra conexión
            async with repo.pool.connection() as conn:
                n = (await (await conn.execute("select count(*) as n from public.run_clients where client_key = %s",
                                               (client,))).fetchone())["n"]
            assert n == 2
        finally:
            async with repo.pool.connection() as conn:
                await conn.execute("delete from auth.users where id = any(%s::uuid[])", (users,))  # cascada

    _run(t)
