# MEASUREMENT_GRAPH_SCHEMA.md

This document defines the **Measurement Graph Schema** for the MMS
system.

It specifies how engineering measurements collected during maintenance
are stored in the Apache AGE graph so that they can support:

-   engineering history
-   trend analysis
-   anomaly detection
-   predictive maintenance
-   digital twin modeling

This schema must remain stable because analytics systems will depend on
it.

------------------------------------------------------------------------

# 1. Design Principles

All measurements originate from operational workflows such as:

-   checklists
-   inspections
-   automated sensors (future)
-   manual technician readings

Measurements must eventually become **graph nodes linked to assets**.

Key principles:

1.  Measurements must be **time series compatible**
2.  Measurements must be **strongly typed**
3.  Units must be explicitly stored
4.  Measurements must link to **maintenance events**
5.  Measurements must allow **trend queries over time**

------------------------------------------------------------------------

# 2. Measurement Flow

Measurements enter the system through the operational workflow:

Checklist Template ↓ Checklist Response ↓ Validated Measurement Record ↓
Graph Measurement Node

The graph node becomes the authoritative historical record.

------------------------------------------------------------------------

# 3. Graph Node Types

The graph introduces several new node types.

Asset nodes already exist.

New node types:

Measurement MaintenanceEvent FailureEvent

------------------------------------------------------------------------

# 4. Measurement Node

Measurement nodes represent individual readings.

Example node:

Measurement

Attributes:

measurement_id asset_graph_id timestamp measurement_type value unit
source work_order_id technician_id

Example:

Measurement { measurement_type: "pump_discharge_pressure" value: 6.2
unit: "bar" timestamp: 2026-03-09T10:30:00Z }

------------------------------------------------------------------------

# 5. Measurement Relationships

Measurement nodes are connected to assets.

Example relationship:

Asset └ HAS_MEASUREMENT └ Measurement

Example graph pattern:

(:Asset)-\[:HAS_MEASUREMENT\]-\>(:Measurement)

------------------------------------------------------------------------

# 6. Maintenance Event Nodes

Maintenance events represent work performed on assets.

Example:

seal replacement bearing lubrication motor replacement

Node attributes:

event_id asset_graph_id event_type timestamp work_order_id technician_id

Graph relationship:

(:Asset)-\[:MAINTENANCE_EVENT\]-\>(:MaintenanceEvent)

------------------------------------------------------------------------

# 7. Failure Event Nodes

Failures represent confirmed breakdown events.

Example:

bearing failure seal leak motor burnout

Attributes:

failure_id asset_graph_id failure_type timestamp work_order_id

Graph relationship:

(:Asset)-\[:FAILURE_EVENT\]-\>(:FailureEvent)

------------------------------------------------------------------------

# 8. Measurement Types

Measurement types should be standardized.

Examples:

pressure temperature vibration current voltage flow_rate speed

Each measurement type should define:

expected unit normal operating range

These definitions may live in a relational table:

measurement_types

------------------------------------------------------------------------

# 9. Time Series Queries

Measurements must support time series analysis.

Example queries:

Last 10 pressure readings for pump

MATCH (a:Asset {asset_graph_id: '123'})
-\[:HAS_MEASUREMENT\]-\>(m:Measurement) WHERE m.measurement_type =
'pressure' RETURN m.timestamp, m.value ORDER BY m.timestamp DESC LIMIT
10

------------------------------------------------------------------------

# 10. Trend Detection

Trend queries may detect degradation patterns.

Example:

pressure decline over time

MATCH (a:Asset)-\[:HAS_MEASUREMENT\]-\>(m:Measurement) WHERE
m.measurement_type = 'pressure' RETURN m.timestamp, m.value ORDER BY
m.timestamp

Analytics engines can analyze this series.

------------------------------------------------------------------------

# 11. Linking Measurements to Maintenance

Measurements must link to maintenance events.

Example pattern:

Asset ├ HAS_MEASUREMENT └ MAINTENANCE_EVENT

This allows analytics such as:

pressure before repair pressure after repair

------------------------------------------------------------------------

# 12. Measurement Sources

Measurements may originate from:

manual technician entry checklist measurement IoT sensors (future)
external monitoring systems

The source field records origin.

Example:

source = "checklist" source = "iot_sensor"

------------------------------------------------------------------------

# 13. Data Retention

Measurement history should not be deleted.

Historical engineering data is extremely valuable for:

predictive maintenance asset lifecycle analysis

------------------------------------------------------------------------

# 14. Future Extensions

The measurement graph may expand to include:

Anomaly nodes Prediction nodes Maintenance recommendations

Example:

(:Asset)-\[:PREDICTED_FAILURE\]-\>(:Prediction)

------------------------------------------------------------------------

# 15. Relationship Summary

Asset ├ HAS_MEASUREMENT → Measurement ├ MAINTENANCE_EVENT →
MaintenanceEvent └ FAILURE_EVENT → FailureEvent

This structure enables a full engineering history of every asset.
