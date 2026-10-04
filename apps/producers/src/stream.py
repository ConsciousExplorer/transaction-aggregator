import secrets
import time
from collections.abc import Callable, Iterable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from avro_datagen import generate

BATCH_SIZE = 1000


def epoch_ms_now() -> int:
    return time.time_ns() // 1_000_000


def endless_records(
    schema_path: str | Path, batch_size: int = BATCH_SIZE
) -> Iterator[dict[str, Any]]:
    """Generates records forever, in batches that each get a fresh random seed."""
    while True:
        seed = secrets.randbelow(2**31)
        yield from generate(
            schema_path=schema_path,
            count=batch_size,
            seed=seed,
            now=datetime.now(UTC),
        )


def paced_records(
    records: Iterable[dict[str, Any]],
    rate: float,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    now_ms: Callable[[], int] = epoch_ms_now,
) -> Iterator[dict[str, Any]]:
    """Releases record i at start + i / rate and stamps its timestamp with the emit time."""
    start = clock()
    for i, record in enumerate(records):
        delay = start + i / rate - clock()
        if delay > 0:
            sleep(delay)
        record["timestamp"] = now_ms()
        yield record


def stream_records(schema_path: str | Path, rate: float) -> Iterator[dict[str, Any]]:
    return paced_records(endless_records(schema_path), rate)
