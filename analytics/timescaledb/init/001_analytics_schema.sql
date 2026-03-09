CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetry_values (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  asset_id TEXT NOT NULL,
  measurement_type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL
);

SELECT create_hypertable('telemetry_values', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_telemetry_asset_type_ts
  ON telemetry_values (asset_id, measurement_type, ts DESC);

CREATE TABLE IF NOT EXISTS analytics_baselines (
  asset_id TEXT NOT NULL,
  measurement_type TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  mean_value DOUBLE PRECISION NOT NULL,
  stddev_value DOUBLE PRECISION NOT NULL,
  sample_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset_id, measurement_type)
);

CREATE TABLE IF NOT EXISTS analytics_alerts (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ts TIMESTAMPTZ NOT NULL,
  asset_id TEXT NOT NULL,
  measurement_type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  baseline_mean DOUBLE PRECISION NOT NULL,
  baseline_stddev DOUBLE PRECISION NOT NULL,
  z_score DOUBLE PRECISION NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_analytics_alerts_created_at
  ON analytics_alerts (created_at DESC);
