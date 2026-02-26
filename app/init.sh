#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------
RED='\e[31m'
GREEN='\e[32m'
YELLOW='\e[33m'
BOLD='\e[1m'
RESET='\e[0m'

step()  { printf "\n${BOLD}▸ %s${RESET}\n" "$1"; }
ok()    { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
skip()  { printf "  ${YELLOW}—${RESET} %s (skipped)\n" "$1"; }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$1"; }

# ---------------------------------------------------------------------------
# Step 1: Check dependencies
# ---------------------------------------------------------------------------
step "Checking dependencies"

missing=()

if ! command -v node &>/dev/null; then
  missing+=("node v22.x")
elif [[ "$(node -v)" != v22* ]]; then
  fail "node $(node -v) found — v22.x required"
  missing+=("node v22.x")
else
  ok "node $(node -v)"
fi

if ! command -v npm &>/dev/null; then
  missing+=("npm")
else
  ok "npm $(npm -v)"
fi

if ! command -v docker &>/dev/null; then
  missing+=("docker")
else
  ok "docker $(docker --version | head -c 40)"
fi

if ! docker compose version &>/dev/null; then
  missing+=("docker compose v2 (docker compose plugin)")
else
  ok "docker compose $(docker compose version --short)"
fi

if ! command -v git &>/dev/null; then
  missing+=("git")
else
  ok "git $(git --version | awk '{print $3}')"
fi

if (( ${#missing[@]} > 0 )); then
  printf "\n${RED}Missing required tools:${RESET}\n"
  for tool in "${missing[@]}"; do
    printf "  - %s\n" "$tool"
  done
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 2: Set up env files (non-destructive)
# ---------------------------------------------------------------------------
step "Setting up environment files"

for dir in fe api; do
  if [[ -f "./${dir}/.env" ]]; then
    skip "./${dir}/.env already exists"
  else
    cp "./${dir}/.env.copyme" "./${dir}/.env"
    ok "created ./${dir}/.env from .env.copyme"
  fi
done

# Backfill env vars that may be missing from older .env files
if ! grep -q '^LOCAL_EVENT_EMITTER=' ./api/.env; then
  echo 'LOCAL_EVENT_EMITTER=log' >> ./api/.env
  ok "added LOCAL_EVENT_EMITTER=log to api/.env"
fi

# ---------------------------------------------------------------------------
# Step 3: npm install + Prisma generate
# ---------------------------------------------------------------------------
step "Installing Node dependencies"
npm install --no-fund --no-audit
ok "npm install"

step "Generating Prisma client"
npm run prisma:generate-client
ok "prisma generate"

# ---------------------------------------------------------------------------
# Step 4: Docker Compose up + wait for healthy postgres
# ---------------------------------------------------------------------------
step "Starting Docker services"
pushd ./api > /dev/null
docker compose up --detach --quiet-pull --wait --wait-timeout 60
popd > /dev/null
ok "postgres   localhost:5432"
ok "keycloak   localhost:8080"
ok "s3mock     localhost:9090"

# ---------------------------------------------------------------------------
# Step 5: Run migrations
# ---------------------------------------------------------------------------
step "Running database migrations"
npm run api:migrate-local-dev
ok "migrations applied"

# ---------------------------------------------------------------------------
# Step 6: Seed local dev data
# ---------------------------------------------------------------------------
step "Seeding local development data"
pushd ./api > /dev/null
docker compose exec -T db bash -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < seed.sql
popd > /dev/null
ok "seed data loaded (IdP, partner, school year, bundles)"

# ---------------------------------------------------------------------------
# Step 7: Executor setup
# ---------------------------------------------------------------------------
step "Executor setup"

# Detect current setting from api/.env (default: docker)
current_mode="docker"
if grep -qE '^LOCAL_EXECUTOR=python' ./api/.env 2>/dev/null; then
  current_mode="python"
fi

printf "\n"
printf "  ${BOLD}docker${RESET}  — run jobs in a container (simpler, no Python needed)\n"
printf "  ${BOLD}python${RESET}  — run jobs as a subprocess (for developing/debugging executor code)\n"
printf "\n"

while true; do
  read -rp "Executor mode [${current_mode}]: " choice
  choice="${choice:-$current_mode}"
  choice="${choice,,}" # lowercase

  if [[ "$choice" == "docker" || "$choice" == "python" ]]; then
    break
  fi
  echo "Please enter 'docker' or 'python'."
done

if [[ "$choice" == "docker" ]]; then
  echo ""
  docker build -t runway_executor ../executor
  ok "executor Docker image built"
else
  # Check Python 3.10+
  if ! command -v python3 &>/dev/null; then
    fail "python3 not found — Python 3.10+ is required for python executor mode"
    exit 1
  fi
  py_version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  py_major=$(python3 -c 'import sys; print(sys.version_info.major)')
  py_minor=$(python3 -c 'import sys; print(sys.version_info.minor)')
  if (( py_major < 3 || (py_major == 3 && py_minor < 10) )); then
    fail "Python 3.10+ required, found ${py_version}"
    exit 1
  fi
  ok "python3 ${py_version}"

  mkdir -p ../executor/local-run
  pushd ../executor/local-run > /dev/null

  if [[ ! -d venv ]]; then
    python3 -m venv venv
    ok "created virtual environment"
  else
    skip "virtual environment already exists"
  fi

  ./venv/bin/pip install -r ../requirements.txt
  ./venv/bin/pip install -e ..
  ok "pip dependencies installed"

  if [[ ! -d bundles ]]; then
    git clone https://github.com/edanalytics/earthmover_edfi_bundles.git bundles
    ok "cloned earthmover bundles"
  else
    git -C bundles pull --ff-only
    ok "updated earthmover bundles"
  fi

  popd > /dev/null
fi

# Update LOCAL_EXECUTOR in api/.env (in-place, avoids duplicates on re-run)
sed -i "s/^LOCAL_EXECUTOR=.*/LOCAL_EXECUTOR=${choice}/" ./api/.env
ok "LOCAL_EXECUTOR=${choice} set in api/.env"

# ---------------------------------------------------------------------------
# Step 8: Summary
# ---------------------------------------------------------------------------
cat << EOF

${BOLD}Services running (Docker):${RESET}
  postgres   localhost:5432
  keycloak   localhost:8080  (admin/admin)
  s3mock     localhost:9090

${BOLD}Executor mode:${RESET} ${choice}

${BOLD}Next steps:${RESET}
  1. Configure your identity provider (see README for Keycloak setup).
  2. Start the API and frontend in separate terminals:
       npx nx run api:serve
       npx nx run fe:serve
  3. Open http://localhost:4200 in your browser.

To re-run this script after pulling updates:
  ./init.sh

EOF
