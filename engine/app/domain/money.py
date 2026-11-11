"""Aritmética monetaria exacta.

Regla del proyecto: TODO monto es un int en unidades menores (centavos).
Nunca float para dinero. Las tasas se expresan en basis points (1 bp = 0,01 %).
"""
from __future__ import annotations

BPS = 10_000


def apply_bps(amount_minor: int, bps: int) -> int:
    """Devuelve amount * bps / 10000 redondeado half-up (montos y tasas >= 0)."""
    if amount_minor < 0 or bps < 0:
        raise ValueError("montos y tasas deben ser >= 0")
    return (amount_minor * bps + BPS // 2) // BPS


def with_tax(amount_minor: int, tax_bps: int) -> int:
    """Monto + impuesto, redondeando el impuesto por línea (política única del sistema)."""
    return amount_minor + apply_bps(amount_minor, tax_bps)


def split_evenly(total_minor: int, parts: int) -> list[int]:
    """Prorrateo exacto por el método del mayor resto: sum(resultado) == total_minor."""
    if parts <= 0:
        raise ValueError("parts debe ser > 0")
    base, rem = divmod(total_minor, parts)
    return [base + 1 if i < rem else base for i in range(parts)]


def fmt(amount_minor: int, currency: str = "USD") -> str:
    sign = "-" if amount_minor < 0 else ""
    a = abs(amount_minor)
    return f"{sign}{currency} {a // 100:,}.{a % 100:02d}"
