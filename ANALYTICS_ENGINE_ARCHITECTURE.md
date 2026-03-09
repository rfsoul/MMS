# ANALYTICS_ENGINE_ARCHITECTURE.md

This document defines the **Analytics Engine Architecture** for the MMS
platform.

The analytics engine analyzes telemetry streams and maintenance history
to detect patterns, anomalies, and trends supporting predictive
maintenance and operational insight.

The initial implementation uses **scheduled analytics jobs** rather than
continuous stream processing.

------------------------------------------------------------------------

# 1. Architecture Overview

Data Flow:

Telemetry Streams (TimescaleDB) │ ▼ Analytics Engine │ ├ Baseline
Analysis ├ Trend Detection ├ Anomaly Detection ├ Maintenance Correlation
│ ▼ Analytics Results │ ▼ Alerts / Insights / Maintenance
Recommendations

------------------------------------------------------------------------

# 2. Data Sources

The analytics engine reads from three primary domains.

## Telemetry Data

Stored in **TimescaleDB hypertables**.

Example table:

telemetry_values

Columns:

stream_id timestamp value quality source_timestamp ingest_timestamp

------------------------------------------------------------------------

## Asset Graph Context

Graph queries provide engineering context.

Examples:

asset class asset model system membership asset relationships

------------------------------------------------------------------------

## Maintenance History

Includes:

work_orders maintenance_events failure_events

Used to correlate telemetry behavior with maintenance actions.

------------------------------------------------------------------------

# 3. Analytics Job Scheduling

Example schedule:

hourly → anomaly detection daily → trend analysis weekly → maintenance
correlation monthly → asset class comparison

Jobs may be implemented using cron or background worker services.

------------------------------------------------------------------------

# 4. Baseline Analysis

Baseline analysis determines normal operating ranges.

Example calculation:

mean median standard deviation

over the last 30 days.

Stored in:

analytics_baselines

------------------------------------------------------------------------

# 5. Trend Detection

Trend detection identifies gradual change.

Example:

vibration_stream slope over 14 days.

If slope exceeds threshold → trend alert.

------------------------------------------------------------------------

# 6. Anomaly Detection

Detects values outside expected ranges.

Example rule:

motor_current \> baseline × 1.5

------------------------------------------------------------------------

# 7. Maintenance Correlation

Example pattern:

pressure decline → seal replacement → pressure recovery

These correlations improve predictive alerts.

------------------------------------------------------------------------

# 8. Analytics Results

Results stored as analytics objects.

Example table:

analytics_alerts

Columns:

alert_id asset_id stream_id alert_type confidence timestamp details

Example:

Asset: Pump_1023 Alert: vibration increasing trend Confidence: medium

------------------------------------------------------------------------

# 9. System Impact Analysis

Graph traversal determines affected systems.

Example:

Chiller efficiency decline → affected loops → affected AHUs → affected
buildings

------------------------------------------------------------------------

# 10. Data Aggregation

Use TimescaleDB features:

rolling averages downsampled aggregates time windows

Example:

average vibration over 10 minute intervals.

------------------------------------------------------------------------

# 11. Performance Strategy

Process telemetry by stream batches. Limit queries to recent windows:

last 24 hours last 7 days last 30 days

Cache baseline calculations.

------------------------------------------------------------------------

# 12. Future Extensions

Possible future additions:

machine learning models energy optimization failure probability
modelling predictive maintenance scheduling

------------------------------------------------------------------------

# 13. Example Job

Example vibration trend job:

1.  query vibration telemetry streams
2.  fetch last 14 days data
3.  compute slope
4.  compare with threshold
5.  generate alert

------------------------------------------------------------------------

# 14. Service Responsibilities

The analytics engine service:

runs scheduled jobs queries telemetry data queries graph metadata writes
analytics alerts

The service should remain **read-only for operational data**.

------------------------------------------------------------------------

# 15. Summary

The analytics engine enables:

trend detection anomaly detection maintenance correlation operational
insight

Scheduled analytics jobs provide a robust starting point for predictive
maintenance analytics while keeping system complexity low.
