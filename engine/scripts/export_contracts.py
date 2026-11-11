"""Exporta el contrato canónico a JSON Schema (lo consumen el frontend y los tests de contrato).

    uv run python -m scripts.export_contracts
"""
import json
from pathlib import Path

from app.domain.models import OfferSet, TripRequest

OUT = Path(__file__).resolve().parents[2] / "contracts"

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for model in (TripRequest, OfferSet):
        path = OUT / f"{model.__name__}.schema.json"
        path.write_text(json.dumps(model.model_json_schema(), indent=2, ensure_ascii=False), encoding="utf-8")
        print("escrito", path)
