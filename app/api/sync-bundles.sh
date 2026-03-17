#!/usr/bin/env bash
set -euo pipefail

# Sync earthmover bundles from the edanalytics registry into the local DB.
# Idempotent — safe to run repeatedly.
# Usage: bash sync-bundles.sh  (from app/api/ with docker services up)

cd "$(dirname "$0")"

REGISTRY_URL="https://raw.githubusercontent.com/edanalytics/earthmover_edfi_bundles/main/registry.json"

for cmd in curl jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "error: $cmd is required but not installed." >&2
    exit 1
  fi
done

registry=$(curl -fsSL "$REGISTRY_URL")

paths=$(echo "$registry" | jq -r '.assessments[].path')

if [[ -z "$paths" ]]; then
  echo "error: no bundle paths found in registry" >&2
  exit 1
fi

# Build a SQL VALUES clause: ('assessments/FOO'), ('assessments/BAR'), ...
values=""
while IFS= read -r p; do
  # escape single quotes for SQL safety
  p="${p//\'/\'\'}"
  values="${values}('${p}'),"
done <<< "$paths"
values="${values%,}"  # trim trailing comma

sql="
\echo earthmover_bundle
INSERT INTO public.earthmover_bundle (key) VALUES ${values}
ON CONFLICT (key) DO NOTHING;

\echo partner_earthmover_bundle
INSERT INTO public.partner_earthmover_bundle (partner_id, earthmover_bundle_key)
SELECT 'ea', key FROM public.earthmover_bundle
ON CONFLICT (partner_id, earthmover_bundle_key) DO NOTHING;
"

docker compose exec -T db bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<< "$sql"
