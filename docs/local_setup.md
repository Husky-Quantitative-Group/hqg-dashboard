# Local Setup — HQG Dashboard

## Quick start (TL;DR)

```bash
npm run install:all
npm run start:db
npm run dev
```

---

## 1) Prerequisites

* **Docker Desktop** (WSL2 integration on Windows)
* **Node.js + npm**

> Verify: `docker --version` and `node -v`

---

## 2) Clone the repo

```bash
git clone <YOUR_REPO_URL>/hqg-dashboard.git
cd hqg-dashboard
```

---

## 3) Install dependencies

```bash
npm run install:all
```

Installs packages in root, `backend/`, and `frontend/`.

---

## 4) Configure environment

Copy the backend env template and edit values:

```bash
cp backend/example.env backend/.env
```

Fill in missing values

```ini
DATABASE_URL=mongodb://localhost:27017/hqg_dashboard
HQG_STRATEGIES_GITHUB_TOKEN=...
```

HQG_STRATEGIES_GITHUB_TOKEN guide can be found [here](guides/github_tokens.md).

---

## 5) Start MongoDB (Docker)

```bash
npm run start:db
```

* Creates/starts container **`dev-mongo-hqg`** on port **27017**
* Persists data in volume **`hqg-dashboard-mongo-data`**

Verify it’s up:

```bash
docker ps
```

### (Optional) Start Mongo Express UI

```bash
npm run start:db:ui
```

* Creates/starts **`dev-mongo-express-hqg`** on **[http://localhost:8081](http://localhost:8081)**
* Auth: **admin / admin**
* Connects to the `dev-mongo-hqg` container (DB: `hqg_dashboard`)

---

## 6) Run the app in development

```bash
npm run dev
```

Runs **frontend** and **backend** concurrently.

* **Backend**: `http://localhost:5000`
* **Frontend**: `http://localhost:5173`

Open the frontend URL in your browser.

This dev environment will allow you to live test code changes without having to rerun the dev script.

---

## 7) Seed/populate data

```bash
npm run populate:strategies
```

Populate the database with the strategies from [hqg-strategies](https://github.com/Husky-Quantitative-Group/hqg-strategies)

**REQUIRED:** `HQG_STRATEGIES_GITHUB_TOKEN` in `.env`
See [docs/guides/github_tokens.md](guides/github_tokens.md)

---

## 8) Production-ish run (local)

Build the frontend and start the backend:

```bash
npm run prod
```

(Equivalently: `npm run build:frontend` then `npm run start:backend`)

Frontend will be served from the backend. Can be containerized in the future.

---

## 9) Reset the database (destructive)

```bash
npm run reset:db
```

Stops/removes **`dev-mongo-hqg`** and deletes the **`hqg-dashboard-mongo-data`** volume.

---

Happy dashing!