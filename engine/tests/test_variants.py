"""Fase 3: sensibilidad a restricciones y determinismo (valores usados también en los e2e del frontend)."""
import pytest

from app.optimizer.solver import optimize


def _with(req, **changes):
    r = req.model_copy(deep=True)
    for path, value in changes.items():
        target = r
        *parents, leaf = path.split("__")
        for p in parents:
            target = getattr(target, p)
        setattr(target, leaf, value)
    return r


@pytest.mark.parametrize(
    "changes,status,best,gap",
    [
        ({}, "ok", 2008362, 0),
        ({"constraints__min_bathrooms": 3}, "over_budget", 2163638, 63638),
        ({"budget_minor": 2000000}, "over_budget", 2008362, 8362),
        ({"constraints__max_heavy_rain_prob": 0.6}, "ok", 2008362, 0),
        ({"constraints__max_stops": 0}, "infeasible", None, 0),
    ],
)
def test_constraint_variants(req, offers, changes, status, best, gap):
    res = optimize(_with(req, **changes), offers)
    assert res.status == status
    assert (res.itineraries[0].total_minor if res.itineraries else None) == best
    assert res.budget_gap_minor == gap


def test_rain_threshold_changes_runner_up(req, offers):
    res = optimize(_with(req, constraints__max_heavy_rain_prob=0.6), offers)
    assert res.itineraries[1].total_minor == 2032378  # 07-12 deja de estar vedado


def test_deterministic_schedule(req, offers):
    def schedule():
        best = optimize(req, offers).itineraries[0]
        return [(a.activity_key, a.date) for sp in best.stays for a in sp.activities.items]

    assert schedule() == schedule() == schedule()
