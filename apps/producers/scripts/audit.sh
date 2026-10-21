#!/bin/bash
# Audits the runtime dependencies in uv.lock for known vulnerabilities.
# pip-audit reads no config file, so the allowed advisories live here.

set -eo pipefail

ALLOWED_ADVISORIES=(
  PYSEC-2026-4320 # certifi 2026.7.22, fixed in 2026.10.19
)

cd "$(dirname "$0")/.."

requirements="$(mktemp)"
trap 'rm -f "$requirements"' EXIT

uv export --locked --no-dev --no-emit-project --no-hashes --quiet -o "$requirements"

ignore_flags=()
for advisory in "${ALLOWED_ADVISORIES[@]}"; do
  ignore_flags+=(--ignore-vuln "$advisory")
done

uvx pip-audit@2.10.1 -r "$requirements" "${ignore_flags[@]}"
