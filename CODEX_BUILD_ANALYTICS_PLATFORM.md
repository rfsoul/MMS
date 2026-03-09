# Codex Build — Analytics Platform

This repository now includes a minimal working predictive analytics pipeline:

1. **TimescaleDB** stores raw telemetry and analytics outputs.
2. **Analytics engine** computes rolling baselines and anomaly alerts.
3. **Analytics portal** serves a FastAPI dashboard for status, alerts, and telemetry charts.

## Repository structure

```
analytics/
  timescaledb/init/001_analytics_schema.sql
  engine/
    Dockerfile
    requirements.txt
    main.py
  portal/
    Dockerfile
    requirements.txt
    main.py
docker-compose.yml
DATABASE_CONTRACT.md
MEASUREMENT_TYPES.md
MEASUREMENT_GRAPH_SCHEMA.md
ANALYTICS_ENGINE_ARCHITECTURE.md
```

## Run

```bash
docker compose up --build
```

Portal URL: `http://localhost:8080`

## Pipeline behavior

- `telemetry_values` is a Timescale hypertable.
- The engine continuously:
  - seeds demo telemetry (if table is empty),
  - recalculates 1-hour baselines by `(asset_id, measurement_type)`,
  - raises alerts when latest value deviates from baseline by > 3σ.
- The portal displays:
  - system status,
  - recent alerts,
  - recent telemetry points as line charts.
