"""CLI local: resuelve un caso fixture sin DB ni n8n.

    uv run python -m app.cli orlando_nyc_5pax [--engine brute]
"""
from __future__ import annotations

import argparse
import asyncio
import json

from app.domain.money import fmt
from app.optimizer.finance import build_breakdown
from app.optimizer.skeletons import build_query_plan, generate_skeletons
from app.optimizer.solver import optimize
from app.providers.base import collect_offers
from app.providers.fixture import FixtureProvider


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("case_key")
    ap.add_argument("--engine", choices=["cpsat", "brute"], default="cpsat")
    args = ap.parse_args()

    p = FixtureProvider(args.case_key)
    req = p.trip_request()
    plan = build_query_plan(req, generate_skeletons(req))
    offers = asyncio.run(collect_offers(plan, p))
    res = optimize(req, offers, engine=args.engine)

    print(f"estado: {res.status} | stats: {json.dumps(res.stats)}")
    print(f"consultas mínimas: {len(plan.flights)} vuelos, {len(plan.stays)} estadías, {len(plan.city_days)} ciudad-días")
    for it in res.itineraries:
        print(f"  #{it.rank} {it.skeleton.id:<28} {fmt(it.total_minor):>16}")
    if not res.itineraries:
        return
    best = res.itineraries[0]
    b = build_breakdown(best, req)
    print("\nDesglose del óptimo:")
    for ln in b.lines:
        print(f"  [{ln.category:<11}] {ln.description[:58]:<58} x{ln.quantity:<2} {fmt(ln.total_minor):>14}")
    for cat, v in b.by_category.items():
        print(f"  {cat:<12} {fmt(v):>16}")
    print(f"  {'TOTAL':<12} {fmt(b.total_minor):>16}   por persona: {[fmt(x) for x in b.per_pax_minor]}")
    print("\nDescartes:", json.dumps({k: len(v) for k, v in res.diagnostics["rejections"].items()}))
    print("Esqueletos infactibles:", res.diagnostics["infeasible_skeletons"])


if __name__ == "__main__":
    main()
