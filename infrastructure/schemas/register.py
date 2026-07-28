#!/usr/bin/env python3
"""One-shot schema registration (ADR-011).

Reads every *.avsc in SCHEMAS_DIR, strips avro-datagen generator annotations
(arg.properties), sets subject compatibility, and registers the cleaned schema
under TopicNameStrategy subjects: <TOPIC_PREFIX>.<file-stem>-value.

Stdlib only — runs on a bare python:alpine image with no pip install.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REGISTRY_URL = os.environ["SCHEMA_REGISTRY_URL"].rstrip("/")
SCHEMAS_DIR = Path(os.environ.get("SCHEMAS_DIR", "/schemas"))
TOPIC_PREFIX = os.environ.get("TOPIC_PREFIX", "transactions")
COMPATIBILITY = os.environ.get("SCHEMA_COMPATIBILITY", "BACKWARD")

CONTENT_TYPE = "application/vnd.schemaregistry.v1+json"

# Generator-only annotations to drop. partitionKey is deliberately NOT here:
# it is a contract property the producers read back from the registry to pick
# the message key (services/producers/src/producer_core.py:resolve_key_fields).
DATAGEN_KEYS = {"arg.properties"}


def strip_datagen(node: Any) -> Any:
    """Recursively drop generator annotation keys from a schema tree."""
    if isinstance(node, dict):
        return {k: strip_datagen(v) for k, v in node.items() if k not in DATAGEN_KEYS}
    if isinstance(node, list):
        return [strip_datagen(v) for v in node]
    return node


def request(method: str, path: str, payload: dict | None = None) -> Any:
    req = urllib.request.Request(
        f"{REGISTRY_URL}{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": CONTENT_TYPE},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def wait_for_registry(deadline_s: int = 60) -> None:
    """Belt-and-braces on top of compose's service_healthy gate."""
    deadline = time.monotonic() + deadline_s
    while True:
        try:
            request("GET", "/subjects")
            return
        except OSError as exc:
            if time.monotonic() >= deadline:
                sys.exit(f"schema registry unreachable after {deadline_s}s: {exc}")
            print(f"waiting for schema registry... ({exc})", flush=True)
            time.sleep(2)


def main() -> None:
    files = sorted(SCHEMAS_DIR.glob("*.avsc"))
    if not files:
        sys.exit(f"no .avsc files found in {SCHEMAS_DIR}")

    wait_for_registry()

    for path in files:
        schema = strip_datagen(json.loads(path.read_text()))
        subject = f"{TOPIC_PREFIX}.{path.stem}-value"

        try:
            # Compatibility first, so it governs from v2 onward; the registry
            # accepts subject-level config before the subject exists.
            request("PUT", f"/config/{subject}", {"compatibility": COMPATIBILITY})

            # Idempotent: re-posting an identical schema returns the existing
            # id without cutting a new version, so re-running this container on
            # every `docker compose up` is safe. An incompatible schema change
            # fails here with HTTP 409.
            result = request(
                "POST",
                f"/subjects/{subject}/versions",
                {"schemaType": "AVRO", "schema": json.dumps(schema)},
            )
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            sys.exit(f"{path.name} -> {subject}: HTTP {exc.code} {body}")

        print(
            f"{path.name} -> {subject}: id={result['id']} ({COMPATIBILITY})",
            flush=True,
        )

    print(f"registered {len(files)} schemas", flush=True)


if __name__ == "__main__":
    main()
