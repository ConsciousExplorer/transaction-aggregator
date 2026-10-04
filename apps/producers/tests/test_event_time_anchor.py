from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from avro_datagen import generate

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"
DAY_MS = 86_400_000
HISTORY_DAYS = 548  # 18 months: the schemas' "-548d"
ANCHOR = datetime(2026, 10, 4, tzinfo=UTC)
ANCHOR_MS = int(ANCHOR.timestamp() * 1000)


def test_seeded_card_history_spans_the_18_months_before_the_anchor():
    months = Counter()
    for record in generate(SCHEMAS / "card.avsc", 5_000, seed=7, now=ANCHOR):
        assert ANCHOR_MS - HISTORY_DAYS * DAY_MS <= record["timestamp"] <= ANCHOR_MS
        occurred = datetime.fromtimestamp(record["timestamp"] / 1000, UTC)
        months[(occurred.year, occurred.month)] += 1

    # 2025-04-04 → 2026-10-04 touches 19 calendar months
    assert len(months) == 19
    # Spread evenly: each full month holds about 30/548 ≈ 5.5% of the records
    full_months = sorted(months)[1:-1]
    for month in full_months:
        assert 0.04 <= months[month] / 5_000 <= 0.07, month


def test_same_seed_and_anchor_reproduce_the_same_corpus():
    first = list(generate(SCHEMAS / "card.avsc", 50, seed=11, now=ANCHOR))
    second = list(generate(SCHEMAS / "card.avsc", 50, seed=11, now=ANCHOR))

    assert first == second


def test_another_anchor_keeps_the_ids_and_moves_the_dates():
    # Why replays pin GENERATOR_ANCHOR_DATE beside GENERATOR_SEED: the
    # idempotency key includes occurred_at, so these would be new rows.
    next_day = datetime(2026, 10, 5, tzinfo=UTC)
    today = list(generate(SCHEMAS / "card.avsc", 50, seed=11, now=ANCHOR))
    tomorrow = list(generate(SCHEMAS / "card.avsc", 50, seed=11, now=next_day))

    for first, second in zip(today, tomorrow, strict=True):
        assert first["transactionId"] == second["transactionId"]
        assert abs(second["timestamp"] - first["timestamp"] - DAY_MS) <= 1


def test_every_seed_and_source_draws_from_the_same_customer_pool():
    # The pool is seeded by its own "customers-v1" string, not by the run seed:
    # runs with different seeds, and different sources, share one universe.
    card = {
        r["customerId"]
        for r in generate(SCHEMAS / "card.avsc", 10_000, seed=1, now=ANCHOR)
    }
    eft = {
        r["customerId"]
        for r in generate(SCHEMAS / "eft.avsc", 10_000, seed=2, now=ANCHOR)
    }

    assert len(card | eft) <= 5_000
    # Independent per-run pools would share nothing
    assert len(card & eft) > 3_000
