import os
import random
import time
from datetime import datetime, timedelta, timezone

import psycopg

DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@timescaledb:5432/analytics")
POLL_SECONDS = int(os.getenv("ANALYTICS_POLL_SECONDS", "10"))

STREAMS = [
    ("ahu-1", "temperature_c", "C", 21.0, 0.5),
    ("ahu-1", "vibration_mm_s", "mm/s", 2.4, 0.2),
    ("chiller-1", "temperature_c", "C", 6.0, 0.3),
    ("chiller-1", "power_kw", "kW", 130.0, 4.0),
]


def seed_demo_data(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM telemetry_values")
        count = cur.fetchone()[0]
        if count > 0:
            return

        now = datetime.now(timezone.utc)
        for i in range(180):
            ts = now - timedelta(minutes=(180 - i))
            for asset_id, mtype, unit, mean, sigma in STREAMS:
                val = random.gauss(mean, sigma)
                if i % 70 == 0 and mtype == "temperature_c":
                    val += 3.5
                cur.execute(
                    """
                    INSERT INTO telemetry_values (ts, asset_id, measurement_type, value, unit)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (ts, asset_id, mtype, val, unit),
                )
    conn.commit()


def insert_live_point(conn):
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        for asset_id, mtype, unit, mean, sigma in STREAMS:
            val = random.gauss(mean, sigma)
            if random.random() < 0.03:
                val += sigma * 8
            cur.execute(
                """
                INSERT INTO telemetry_values (ts, asset_id, measurement_type, value, unit)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (now, asset_id, mtype, val, unit),
            )
    conn.commit()


def recompute_baselines(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH agg AS (
              SELECT
                asset_id,
                measurement_type,
                MIN(ts) AS window_start,
                MAX(ts) AS window_end,
                AVG(value) AS mean_value,
                COALESCE(NULLIF(STDDEV_SAMP(value), 'NaN'::float8), 0.0) AS stddev_value,
                COUNT(*)::int AS sample_count
              FROM telemetry_values
              WHERE ts >= NOW() - INTERVAL '1 hour'
              GROUP BY asset_id, measurement_type
            )
            INSERT INTO analytics_baselines (
              asset_id, measurement_type, window_start, window_end,
              mean_value, stddev_value, sample_count, updated_at
            )
            SELECT
              asset_id, measurement_type, window_start, window_end,
              mean_value, stddev_value, sample_count, NOW()
            FROM agg
            ON CONFLICT (asset_id, measurement_type)
            DO UPDATE SET
              window_start = EXCLUDED.window_start,
              window_end = EXCLUDED.window_end,
              mean_value = EXCLUDED.mean_value,
              stddev_value = EXCLUDED.stddev_value,
              sample_count = EXCLUDED.sample_count,
              updated_at = NOW()
            """
        )
    conn.commit()


def detect_anomalies(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH latest AS (
              SELECT DISTINCT ON (t.asset_id, t.measurement_type)
                t.asset_id, t.measurement_type, t.ts, t.value
              FROM telemetry_values t
              ORDER BY t.asset_id, t.measurement_type, t.ts DESC
            )
            SELECT
              l.asset_id,
              l.measurement_type,
              l.ts,
              l.value,
              b.mean_value,
              b.stddev_value,
              CASE WHEN b.stddev_value > 0 THEN ABS((l.value - b.mean_value) / b.stddev_value) ELSE 0 END AS z
            FROM latest l
            JOIN analytics_baselines b
              ON b.asset_id = l.asset_id
             AND b.measurement_type = l.measurement_type
            WHERE b.sample_count >= 20
            """
        )
        rows = cur.fetchall()

        for asset_id, mtype, ts, val, mean, stddev, z in rows:
            if z < 3:
                continue
            cur.execute(
                """
                SELECT 1 FROM analytics_alerts
                WHERE asset_id = %s AND measurement_type = %s AND ts = %s
                LIMIT 1
                """,
                (asset_id, mtype, ts),
            )
            if cur.fetchone():
                continue

            severity = "critical" if z >= 5 else "warning"
            message = f"Anomaly detected for {asset_id}/{mtype}: value={val:.2f}, baseline={mean:.2f}, z={z:.2f}"
            cur.execute(
                """
                INSERT INTO analytics_alerts (
                  ts, asset_id, measurement_type, value,
                  baseline_mean, baseline_stddev, z_score,
                  severity, message
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (ts, asset_id, mtype, val, mean, stddev, z, severity, message),
            )
    conn.commit()


def run():
    while True:
        try:
            with psycopg.connect(DB_URL) as conn:
                seed_demo_data(conn)
                insert_live_point(conn)
                recompute_baselines(conn)
                detect_anomalies(conn)
            print("analytics tick complete", flush=True)
        except Exception as exc:
            print(f"analytics tick failed: {exc}", flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    run()
