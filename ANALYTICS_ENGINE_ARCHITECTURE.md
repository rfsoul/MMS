# Analytics Engine Architecture

The analytics engine is a single Python process with a short polling loop.

Loop steps:
1. Ensure demo telemetry exists (seed only when empty).
2. Recompute baselines from the last 1 hour of data.
3. Evaluate latest measurement per stream against baseline.
4. Insert alert when z-score threshold is exceeded.
5. Sleep and repeat.

Design choices:
- Minimal dependencies: `psycopg[binary]` only.
- SQL-driven aggregation for simplicity and transparency.
- Idempotent alerting by checking for same `(asset, type, ts)` before insert.
