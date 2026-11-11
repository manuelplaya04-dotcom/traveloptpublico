"""Servicio de optimización: lee ofertas de la corrida, resuelve, concilia y persiste."""
from __future__ import annotations

import asyncio
from dataclasses import asdict

from app.domain.models import OfferSet, TripRequest
from app.optimizer.finance import Breakdown, build_breakdown
from app.optimizer.lodging import lodging_options
from app.services.quota_plan import effective_request
from app.optimizer.solver import Itinerary, optimize
from app.repo.base import Repository, RunRecord


def itinerary_to_dict(it: Itinerary, b: Breakdown, pax: int, alternatives: tuple[TripRequest, OfferSet] | None = None) -> dict:
    """`alternatives` (pedido, ofertas) agrega por estadía las opciones de alojamiento para el dashboard por ciudad y
    marca las actividades al aire libre cuyo día no tiene clima (`weather_verified: false`)."""
    forecast_days = {(w.city, w.date) for w in alternatives[1].weather} if alternatives else None

    def activity(a) -> dict:
        out = {**a.model_dump(mode="json"), "cost_minor": a.price_per_pax_minor * pax}
        if forecast_days is not None:
            out["weather_verified"] = not a.outdoor or (a.city, a.date) in forecast_days
        return out

    return {
        "rank": it.rank,
        "skeleton_id": it.skeleton.id,
        "order": list(it.skeleton.order),
        "first_checkin": it.skeleton.first_checkin.isoformat(),
        "nights": dict(zip(it.skeleton.order, it.skeleton.nights)),
        "total_minor": it.total_minor,
        "within_budget": it.within_budget,
        "currency": b.currency,
        "flights": [
            {"leg": f.leg_index, "cost_minor": f.cost_minor, "offer": f.offer.model_dump(mode="json")}
            for f in it.flights
        ],
        "stays": [
            {
                "city": sp.stay.city,
                "check_in": sp.stay.check_in.isoformat(),
                "check_out": sp.stay.check_out.isoformat(),
                "nights": sp.stay.nights,
                "lodging": {
                    "offer_id": sp.lodging.offer.id,
                    "name": sp.lodging.offer.name,
                    "lat": sp.lodging.offer.lat,
                    "lon": sp.lodging.offer.lon,
                    "deeplink": sp.lodging.offer.deeplink,
                    "cost_minor": sp.lodging.cost_minor,
                    "units": [
                        {**sp.lodging.offer.units[j].model_dump(mode="json"), "qty": q}
                        for j, q in sp.lodging.units
                    ],
                },
                "activities": [activity(a) for a in sp.activities.items],
                "transport_cost_minor": sp.transport_cost_minor,
                **({"lodging_options": lodging_options(sp.stay, alternatives[1].lodging, alternatives[0].constraints, pax)}
                   if alternatives else {}),
            }
            for sp in it.stays
        ],
        "breakdown": {
            "lines": [asdict(ln) for ln in b.lines],
            "by_category": b.by_category,
            "total_minor": b.total_minor,
            "per_pax_minor": b.per_pax_minor,
        },
    }


async def run_optimization(repo: Repository, run: RunRecord) -> dict:
    offers = await repo.load_offers(run.id)
    # faltantes no críticos; precios históricos o búsquedas parciales no son faltantes: los datos que hay se usan
    degraded = frozenset(k for k, why in (run.summary or {}).get("degraded", {}).items()
                         if why not in ("quota_historical", "partial_upstream"))
    req = effective_request(run.request, run.summary)  # la misma solicitud que se extrajo (recortes de cuota)
    res = await asyncio.to_thread(optimize, req, offers, "cpsat", degraded)  # CPU-bound fuera del event loop
    rows = [
        itinerary_to_dict(it, build_breakdown(it, req), req.pax, (req, offers))
        for it in res.itineraries
    ]
    await repo.save_itineraries(run.id, run.user_id, rows)
    summary = {
        **(run.summary or {}),
        "result_status": res.status,
        "best_total_minor": rows[0]["total_minor"] if rows else None,
        "budget_gap_minor": res.budget_gap_minor,
        "diagnostics": res.diagnostics,
        "stats": res.stats,
    }
    final = "done" if rows else "infeasible"
    await repo.transition(run.id, {"optimizing"}, final, summary=summary)
    return {"run_id": run.id, "status": final, **summary}
