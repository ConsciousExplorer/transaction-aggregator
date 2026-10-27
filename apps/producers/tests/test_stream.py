import time
from pathlib import Path

from stream import generate_records_forever, pace_records

SCHEMAS = Path(__file__).resolve().parents[3] / "schemas"


class FakeClock:
    """Fake time: sleep moves the clock forward instead of blocking."""

    def __init__(self, start: float):
        self.now = start
        self.sleeps = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds

    def get_epoch_ms(self) -> int:
        return round(self.now * 1000)


def build_blank_records(count: int) -> list[dict]:
    records = []
    for n in range(count):
        records.append({"n": n, "timestamp": 0})
    return records


def pace_with_clock(clock: FakeClock, records: list[dict], rate: float):
    return pace_records(
        records,
        rate,
        clock=clock.monotonic,
        sleep=clock.sleep,
        now_ms=clock.get_epoch_ms,
    )


def take(records, count: int) -> list[dict]:
    taken = []
    for record in records:
        taken.append(record)
        if len(taken) == count:
            break
    return taken


def test_record_i_goes_out_at_start_plus_i_over_rate():
    clock = FakeClock(start=100.0)
    emitted_at = []

    for _ in pace_with_clock(clock, build_blank_records(5), rate=4):
        emitted_at.append(clock.now)

    assert emitted_at == [100.0, 100.25, 100.5, 100.75, 101.0]


def test_time_spent_downstream_shortens_the_wait_instead_of_drifting():
    clock = FakeClock(start=0.0)
    emitted_at = []

    for _ in pace_with_clock(clock, build_blank_records(4), rate=2):
        emitted_at.append(clock.now)
        clock.now += 0.25

    assert emitted_at == [0.0, 0.5, 1.0, 1.5]
    assert clock.sleeps == [0.25, 0.25, 0.25]


def test_records_behind_schedule_go_out_without_sleeping():
    clock = FakeClock(start=0.0)

    for _ in pace_with_clock(clock, build_blank_records(3), rate=2):
        clock.now += 1.0

    assert clock.sleeps == []


def test_timestamp_is_the_emit_time_in_epoch_ms():
    clock = FakeClock(start=1_791_072_000.0)
    stamped = []

    for record in pace_with_clock(clock, build_blank_records(3), rate=2):
        stamped.append(record["timestamp"])

    assert stamped == [1_791_072_000_000, 1_791_072_000_500, 1_791_072_001_000]


def test_default_stamp_is_the_wall_clock_now():
    before_ms = time.time_ns() // 1_000_000
    records = list(pace_records(build_blank_records(3), rate=1000))
    after_ms = time.time_ns() // 1_000_000

    for record in records:
        assert before_ms <= record["timestamp"] <= after_ms


def test_endless_records_cross_batches_with_unique_transaction_ids():
    # 50 records from batches of 7: eight batches, each with its own seed
    records = take(generate_records_forever(SCHEMAS / "card.avsc", batch_size=7), 50)

    transaction_ids = set()
    for record in records:
        transaction_ids.add(record["transactionId"])
    assert len(records) == 50
    assert len(transaction_ids) == 50
