# Measurement Graph Schema (Logical)

Telemetry flow graph used by the analytics slice:

`Asset -> Measurement Stream -> Baseline -> Alert`

- **Asset**: source equipment identifier (`asset_id`).
- **Measurement Stream**: tuples in `telemetry_values` identified by `(asset_id, measurement_type)`.
- **Baseline**: rolling 1-hour aggregate in `analytics_baselines`.
- **Alert**: anomaly event in `analytics_alerts` when `|z_score| > 3`.
