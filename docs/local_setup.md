# Local Setup — HQG Dashboard

This repo has two main parts:
- `frontend/` for the React Router UI
- `backend/` for the API and its PostgreSQL database

Sign-in uses the real UConn CAS server. For account-free automated tests, see
[Tests](#4-tests) and the [offline test guide](../../hqg-engine/docs/offline-testing.md).

## Prerequisites
- Docker with Compose: https://docs.docker.com/get-started/get-docker/
- Node.js 20 + npm for the frontend: https://nodejs.org/en/download
- Python 3.12, only to run the API or its tests outside Docker

## 1) API and database

Make a new `.env` file in the repo root:
```bash
cp .env.example .env
```

Edit `.env` for local development:
```ini
POSTGRES_PASSWORD=localdev
FRONTEND_BASE_URL=http://localhost:5173
PUBLIC_API_URL=
APP_ENV=dev
```

- With `PUBLIC_API_URL` empty, the API expects browsers to reach it through the Vite
  dev server's `/api` proxy, as the AWS development stack did. CAS then returns
  sign-ins to `http://localhost:5173/api/auth/callback`.
- `APP_ENV=dev` issues session cookies for the current host, without `Secure`.

Start the API and database:
```bash
docker network create hqg_network 2>/dev/null || true
docker compose up -d --build
curl http://localhost:5000/health
```

The API applies database migrations and creates its session signing key when it starts.

### Seed data (required on first run)
Seeding loads the sample strategies and makes your NetID an admin:
```bash
docker compose exec api python -m hqg_dashboard seed --admin-netid YOUR_NETID --skip-backtests
```

To also run the sample backtests, start the [backtester](#3-backtester) and replace
`--skip-backtests` with `--backtester-url http://hqg-backtester:8005`. If the backtester
is unreachable or blocked, strategies still seed and backtests are skipped with a
summary at the end. Seeding again resets the sample strategies' files and backtests,
but keeps their sharing settings.

### Useful commands
```bash
docker compose logs -f api                         # API logs
docker compose exec db psql -U hqg hqg_dashboard   # database shell
docker compose exec api python -m hqg_dashboard --help
docker compose down                                # stop; keeps the data
docker compose down -v                             # stop and delete the database
```

## 2) Frontend

### Install dependencies
From root:
```bash
npm install
```

### Configure environment
Make a new `.env` file.
```bash
cp frontend/.env.example frontend/.env
```

Edit `frontend/.env`:
```ini
CORE_API_URL=http://localhost:5000
IS_PROD=0
```

- `CORE_API_URL` is where the Vite dev server proxies `/api`.
- `IS_PROD=0` keeps local proxy behavior (`/api` and `/backtester-api`) for development.
- Restart `npm run dev` after changing `frontend/.env`; its automatic restart can keep
  the old values.

### Run the dev server
```bash
npm run dev
```

Open `http://localhost:5173`.

## 3) Backtester

The hqg-backtester repo is required for backtests. It is recommended to follow a
similar file structure:

```text
hqg/
├── hqg-dashboard/
└── hqg-backtester/
```

Clone the backtester:

```bash
git clone https://github.com/Husky-Quantitative-Group/hqg-backtester.git
cd hqg-backtester
```

To have the backtester verify dashboard sessions, set `HQG_DASH_JWKS_URL` in its `.env`
to the dashboard's key set. Both containers are on `hqg_network`:

```ini
HQG_DASH_JWKS_URL=http://hqg-dashboard-api:5000/.well-known/jwks.json
```

Run the backtester:

```bash
docker compose up --build
```

The API should be available at http://localhost:8005

Set the backtester URL in `frontend/.env` so the Vite proxy can reach it:

```ini
BACKTESTER_URL=http://localhost:8005
```

## 4) Tests

The API tests need a disposable PostgreSQL database; its name must contain `test`.
They make no other network connections.

```bash
docker run -d --name hqg-dashboard-test-db -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=hqg -e POSTGRES_PASSWORD=hqg -e POSTGRES_DB=hqg_test postgres:17

cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql://hqg:hqg@127.0.0.1:55432/hqg_test .venv/bin/python -m pytest

.venv/bin/ruff format --check . && .venv/bin/ruff check .   # formatting and lint
```

To run the API itself outside Docker, install `requirements.txt`, export the settings
from `.env` with a `DATABASE_URL`, and run:

```bash
uvicorn --factory hqg_dashboard.app:create_app --port 5000 --reload
```

## Engine accounts and readiness

The engine connects to the dashboard only over HTTPS, and the dashboard allows
execution only while two readiness checks pass over HTTPS: one for account control and
one for the website. Locally, `dev/local-https` provides the HTTPS: an nginx container
on `hqg_network` that serves this API as `https://hqg-dashboard-https` and a build of
the frontend as `https://hqg-dashboard-https:8443`, with certificates from a local
certificate authority it creates on first start. Start it:

```bash
docker compose -f dev/local-https/compose.yaml up -d --build
```

Choose account and engine UUIDs and a service secret (`openssl rand -hex 32`), and
configure these settings in `.env`:

```ini
CONTROL_READINESS_TOKEN=<service secret>
CONTROL_READINESS_URL=https://hqg-dashboard-https/internal/v1/accounts/<account-UUID>/readiness
WEBSITE_READINESS_URL=https://hqg-dashboard-https:8443/
COMPOSE_FILE=docker-compose.yml:dev/local-https/api.compose.yaml
```

Locally, the control check calls this API's own readiness endpoint; in prod it goes
through hqg-platform (see [prod_deployment.md](./prod_deployment.md#engine-accounts)).
`COMPOSE_FILE` adds `dev/local-https/api.compose.yaml`, which makes the API trust the
local certificate authority. Keep `FRONTEND_BASE_URL` set to the login/CORS origin.
Missing or failed readiness checks prevent execution. The API makes both checks
directly, never through an outbound proxy such as `HTTPS_PROXY`.

Apply the settings and provision the account, reading the secret from the setting:

```bash
docker compose up -d
docker compose exec api python -m hqg_dashboard provision-account \
  --secret-env CONTROL_READINESS_TOKEN \
  --account-id <account-UUID> --engine-id <engine-UUID> --netid <your-NetID>
```

This creates the account record; it does not start an engine. Existing accounts
are not overwritten. Accounts start paused; add `--allow-live` to grant live control.

Start the engine using the [engine README](../../hqg-engine/README.md), with the same
account UUID, engine UUID and service secret (its `DASHBOARD_SYNC_SECRET`), and these
settings in its `.env`. The second adds `dev/local-https/engine.compose.yaml`, which
makes the engine trust the local certificate authority:

```ini
DASHBOARD_SYNC_URL=https://hqg-dashboard-https
COMPOSE_FILE=compose.yaml:../hqg-dashboard/dev/local-https/engine.compose.yaml
```

Sign in through CAS and enter the account UUID in the Engine page; `ENGINE_ACCOUNT_ID`
is an optional default. With both modes paused and reconciled, register a saved
strategy version, wait for acknowledgement, configure allocations, and explicitly
Resume the intended mode.

Before replacing a provider, stop the old process and wait at least 15 seconds
after its last heartbeat, then run:

```bash
docker compose exec api python -m hqg_dashboard authorize-replacement \
  --account-id <account-UUID> --actor <maintainer-NetID>
```

Configuration and registered packages are retained. Start the replacement, wait
for reconciliation and explicitly Resume again.

Stop/reconcile both modes before `docker compose down`, which retains history.
`down -v` deletes the dashboard database.
