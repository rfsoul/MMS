
# CODEX_BUILD_ANALYTICS_PLATFORM.md

This document defines the build contract for the first working version
of the MMS Analytics Platform.

The goal is to create a runnable Docker-based environment that includes:

1. TimescaleDB telemetry database
2. Analytics Engine service
3. Web Analytics Portal

The system must run locally with a single command.

---

# 1. System Architecture

The system consists of three services.

TimescaleDB
    │
    ▼
Analytics Engine
    │
    ▼
Analytics Web Portal

TimescaleDB stores telemetry data.

The analytics engine periodically analyzes telemetry and produces alerts.

The web portal displays analytics results.

---

# 2. Repository Structure

Create a new top-level directory:

analytics/

Structure:

analytics/
    docker-compose.yml
    timescale/
        init.sql
    analytics-engine/
        Dockerfile
        requirements.txt
        engine.py
        jobs/
            baseline.py
            anomaly.py
            trends.py
    analytics-portal/
        Dockerfile
        app/
            main.py
            templates/
            static/

---

# 3. Docker Compose Requirements

docker-compose.yml must start the following services.

timescaledb

    image: timescale/timescaledb:latest-pg15
    port: 5433
    persistent volume
    init.sql automatically executed

analytics-engine

    Python service
    connects to TimescaleDB
    runs scheduled analytics jobs

analytics-portal

    FastAPI web server
    dashboard for analytics alerts
    telemetry graph viewer

---

# 4. Timescale Schema

The database must contain:

telemetry_values

columns:

stream_id
timestamp
value
quality
source_timestamp
ingest_timestamp

Convert the table to a hypertable.

Example:

SELECT create_hypertable('telemetry_values','timestamp');

---

# 5. Analytics Tables

Create tables for analytics results.

analytics_baselines

stream_id
baseline_mean
baseline_stddev
updated_at

analytics_alerts

alert_id
asset_id
stream_id
alert_type
confidence
timestamp
details

---

# 6. Analytics Engine

Python service responsibilities:

connect to TimescaleDB
run scheduled analytics jobs
store analytics results

Scheduling:

hourly anomaly detection
daily baseline calculation

Example job structure:

jobs/
    baseline.py
    anomaly.py
    trends.py

---

# 7. Web Portal

The analytics portal must provide:

Dashboard page

show active alerts
show analytics engine status

Telemetry viewer

query telemetry_values
plot time series graphs

Alert explorer

list alerts by asset
filter by type

Framework:

FastAPI
Jinja templates
simple chart library (chart.js or similar)

---

# 8. Running the System

The entire platform must run with:

docker compose up

Expected services:

TimescaleDB
Analytics Engine
Analytics Portal

Web portal available at:

http://localhost:8080

---

# 9. Success Criteria

The build is successful if:

TimescaleDB container starts
hypertable is created
analytics engine runs jobs
alerts table populated
web portal shows alerts
telemetry graphs render

---

# 10. Implementation Notes

Use Python for analytics.

Libraries:

psycopg2
pandas
schedule

Keep implementation simple and modular.

Focus on a working analytics pipeline.
