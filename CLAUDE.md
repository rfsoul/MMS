# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MMS is a multi-tenant **Maintenance Management System** with three components:
- **`api/`** — Node.js/Express REST API (port 3001)
- **`web/`** — React 18 + Vite web portal (port 80/5173)
- **`mms-mobile/`** — React Native (Expo) offline-first Android tablet app

## Commands

### Docker (primary development environment)

```bash
# Start full stack (db + api + web)
docker compose up --build

# Background mode
docker compose up --build -d

# View API logs
docker compose logs api

# Run integration test suite against running stack
docker run --rm \
  --network maintenance-system_default \
  -v $(pwd)/test/test-harness.js:/test-harness.js \
  -e API_URL=http://mms-api:3000 \
  node:20-alpine \
  node /test-harness.js
```

### API

```bash
cd api
npm start        # production
npm run dev      # nodemon watch mode
```

### Web

```bash
cd web
npm run dev      # Vite dev server (localhost:5173)
npm run build    # production build
npm run lint     # ESLint
```

### Mobile

```bash
cd mms-mobile
# With Android emulator running:
./start-dev.sh   # sets up adb port forwarding + starts Metro

npm run android  # direct expo run
npm run lint
npm run build:preview     # EAS preview build
npm run build:production  # EAS production build
```

## Architecture

### Multi-Tenancy & Roles

One `companies` table. A single company has `is_help_desk = TRUE` (the Global Help Desk) — its users (`help_desk_agent` role) can see all companies. All other companies are customer-scoped via `company_id`.

Roles: `help_desk_agent` | `admin` | `manager` | `technician` — enforced at route level, not just DB.

### Database

Schema lives entirely in `db/init/01_setup.sql` (59KB). **No migration framework** — schema changes modify this single file and require a container rebuild (`docker compose down && docker compose up --build`).

DB triggers handle: automatic timestamps, status history, constraint enforcement, and blocking work order completion if required checklist items are unanswered.

Apache AGE graph extension models facility hierarchy: `Site → Building → Floor → Space → System → Asset → Component` with edge types `CONTAINS`, `HAS_ASSET`, `PART_OF`, `FEEDS`, `HAS_COMPONENT`.

### API Structure

```
api/src/
├── routes/          # Route definitions (thin — delegate to services)
├── services/        # Business logic per domain
├── middleware/       # Auth (JWT), error handler
├── db/              # pg connection pool
└── pm-scheduler.js  # Cron job for preventive maintenance WO generation
```

Work order status flow: `open → assigned → in_progress → on_hold → completed`
Each transition has a dedicated POST endpoint (`/start`, `/hold`, `/complete`).

### Mobile Offline-First Architecture

The mobile app is **offline-first**:
1. All technician writes go to local SQLite immediately (never blocked by network)
2. An **outbox queue** holds pending server mutations
3. `useSync` hook detects WiFi → drains outbox → pulls latest work orders
4. `expo-background-fetch` drains outbox every ~30s in background
5. Conflict policy: last-write-wins

On first launch, `FirstSyncScreen` shows progress while seeding the local asset database from the server.

Mobile SQLite schema and queries are in `mms-mobile/src/db/`. The sync engine is in `mms-mobile/src/services/`.

### Auth

Auth mode is stored in `system_config` table (`auth_mode`: `internal` or `azure_ad`). Internal auth uses bcrypt + JWT. JWT secret comes from `JWT_SECRET` env var.

### Environment

Copy `env.example` to `.env` for local development. The existing `.env` has dev credentials. Key vars: `DB_PASSWORD`, `JWT_SECRET`, `API_URL`, `CORS_ORIGIN`.

The mobile app bakes `API_URL` in at build time — change it in `mms-mobile/src/utils/config.ts` or the EAS build profile before building for a different environment.

## Key Files

| File | Purpose |
|------|---------|
| `db/init/01_setup.sql` | Entire DB schema — the source of truth |
| `api/src/index.js` | Express app entry, route registration |
| `api/src/pm-scheduler.js` | PM cron job |
| `test/test-harness.js` | ~99 integration tests |
| `docs/MMS_Project_Notes.md` | Architecture notes & API decisions |
| `docker-compose.yml` | Standard full-stack compose |
| `docker-compose_API-DB.yml` | API + DB only (no web) |

## What's Not Yet Built

- Checklist response submission (schema and routes exist, submission flow incomplete)
- IFC/BIM import service (Docker service exists but is commented out)
- Issue and inspection endpoints (DB tables exist)
- Business units, rooms/zones APIs
