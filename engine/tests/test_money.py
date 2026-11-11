import pytest

from app.domain.money import apply_bps, fmt, split_evenly, with_tax


@pytest.mark.parametrize(
    "amount,bps,expected",
    [
        (129500, 1250, 16188),  # 16187.5 -> half-up
        (100, 1250, 13),  # 12.5 -> 13
        (100, 1249, 12),
        (0, 1475, 0),
        (99500, 1475, 14676),  # 14676.25
    ],
)
def test_apply_bps_half_up(amount, bps, expected):
    assert apply_bps(amount, bps) == expected


def test_with_tax():
    assert with_tax(129500, 1250) == 145688


def test_negative_rejected():
    with pytest.raises(ValueError):
        apply_bps(-1, 100)


@pytest.mark.parametrize("total,parts", [(2008362, 5), (1, 3), (0, 4), (999_999_999, 7)])
def test_split_evenly_is_exact(total, parts):
    shares = split_evenly(total, parts)
    assert sum(shares) == total
    assert max(shares) - min(shares) <= 1


def test_fmt():
    assert fmt(2008362) == "USD 20,083.62"
