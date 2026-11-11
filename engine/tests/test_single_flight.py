"""Deduplicación de pedidos en curso (`cached_entry`): una sola llamada real y ningún bloqueo. `asyncio.timeout` en cada
test: si algo quedara esperando para siempre, falla en vez de colgar la suite."""
import asyncio

import pytest

from app.services import cache as cache_module
from app.services.cache import MemoryCache, cached_entry

LIMIT_S = 2


def run(coro):
    async def bounded():
        async with asyncio.timeout(LIMIT_S):
            await coro
    asyncio.run(bounded())
    assert cache_module._inflight == {}  # nunca queda basura


class Upstream:
    def __init__(self, fail: Exception | None = None):
        self.calls = 0
        self.release = asyncio.Event()
        self.fail = fail

    async def __call__(self):
        self.calls += 1
        await self.release.wait()
        if self.fail:
            raise self.fail
        return {"n": self.calls}


def ask(cache, up):
    return cached_entry(cache, "k", "p", 60, up)


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


def test_diez_pedidos_iguales_hacen_una_sola_llamada():
    async def go():
        cache, up = MemoryCache(), Upstream()
        tasks = [asyncio.create_task(ask(cache, up)) for _ in range(10)]
        await settle()
        up.release.set()
        results = await asyncio.gather(*tasks)
        assert up.calls == 1
        assert {id(e) for e, _ in results} == {id(results[0][0])}  # la misma respuesta para todos
        assert [hit for _, hit in results].count(False) == 1  # solo el primero cuenta como llamada real
    run(go())


def test_si_cancelan_al_primero_los_demas_no_se_cuelgan():
    """El caso del timeout de 4 s de una API no crítica: antes los demás esperaban para siempre (deadlock)."""
    async def go():
        cache, up = MemoryCache(), Upstream()
        first = asyncio.create_task(ask(cache, up))
        await settle()
        others = [asyncio.create_task(ask(cache, up)) for _ in range(3)]
        await settle()
        first.cancel()
        await settle()
        up.release.set()
        results = await asyncio.gather(*others)
        assert up.calls == 1 and all(e.value == {"n": 1} for e, _ in results)
        with pytest.raises(asyncio.CancelledError):
            await first
    run(go())


def test_si_cancelan_a_uno_que_espera_no_afecta_a_nadie():
    async def go():
        cache, up = MemoryCache(), Upstream()
        tasks = [asyncio.create_task(ask(cache, up)) for _ in range(3)]
        await settle()
        tasks[1].cancel()
        await settle()
        up.release.set()
        assert (await tasks[0])[0].value == {"n": 1}
        assert (await tasks[2])[0].value == {"n": 1}
    run(go())


def test_si_cancelan_a_todos_la_respuesta_igual_queda_en_cache():
    async def go():
        cache, up = MemoryCache(), Upstream()
        t = asyncio.create_task(ask(cache, up))
        await settle()
        t.cancel()
        await settle()
        up.release.set()
        await settle()
        entry, hit = await ask(cache, up)
        assert hit and entry.value == {"n": 1} and up.calls == 1
    run(go())


def test_un_error_llega_a_todos_y_el_siguiente_reintenta():
    async def go():
        cache, up = MemoryCache(), Upstream(fail=ValueError("boom"))
        tasks = [asyncio.create_task(ask(cache, up)) for _ in range(5)]
        await settle()
        up.release.set()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        assert up.calls == 1 and all(isinstance(r, ValueError) for r in results)
        up.fail = None
        entry, hit = await ask(cache, up)  # el error no se guardó
        assert not hit and up.calls == 2 and entry.value == {"n": 2}
    run(go())


def test_claves_distintas_no_se_esperan_entre_si():
    async def go():
        cache, slow, fast = MemoryCache(), Upstream(), Upstream()
        fast.release.set()
        stuck = asyncio.create_task(cached_entry(cache, "a", "p", 60, slow))
        await settle()
        entry, _ = await cached_entry(cache, "b", "p", 60, fast)
        assert entry.value == {"n": 1}
        slow.release.set()
        await stuck
    run(go())


def test_miles_de_pedidos_con_timeouts_al_azar_terminan_todos():
    async def go():
        cache, up = MemoryCache(), Upstream()

        async def client(i: int):
            try:
                async with asyncio.timeout(0.001 if i % 3 == 0 else 1):
                    return await ask(cache, up)
            except TimeoutError:
                return None

        tasks = [asyncio.create_task(client(i)) for i in range(3000)]
        await asyncio.sleep(0.01)
        up.release.set()
        results = await asyncio.gather(*tasks)
        assert up.calls == 1
        assert sum(r is not None for r in results) == 2000
    run(go())
