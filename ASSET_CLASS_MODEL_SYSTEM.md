# ASSET_CLASS_MODEL_SYSTEM.md

This document defines the **Asset Class & Asset Model System** for MMS.

The purpose of this system is to provide an engineering structure that
standardizes:

• asset types • expected measurements • maintenance regimes • checklists
• failure modes • predictive analytics inputs

This system forms the **engineering backbone of the platform** and
enables consistent data collection and analysis across very large
facilities.

------------------------------------------------------------------------

# 1. Core Concept

Assets in real facilities are not unique one‑off entities.

They belong to **classes of equipment** with common characteristics.

Example:

Pump_1023 is not just an asset --- it is:

Pump → Centrifugal Pump → Grundfos CR32

This structure allows the system to understand:

• what measurements exist\
• what maintenance tasks are required\
• what failures are expected

------------------------------------------------------------------------

# 2. Asset Hierarchy

The system defines three engineering layers:

Asset Class\
Asset Model\
Asset Instance

Example:

Asset Class\
→ Pump

Asset Model\
→ Grundfos CR32

Asset Instance\
→ Pump_1023

------------------------------------------------------------------------

# 3. Asset Class

Asset Classes represent **general equipment categories**.

Examples:

Pump\
Motor\
Fan\
Valve\
Heat Exchanger\
Chiller\
Air Handling Unit\
Cooling Tower\
Electrical Switchboard

Asset Classes define:

• expected measurement types\
• common maintenance tasks\
• checklist templates\
• failure categories

------------------------------------------------------------------------

# 4. Asset Model

Asset Models represent **specific manufacturer equipment**.

Example:

Asset Class: Pump

Asset Models:

Grundfos CR32\
Wilo Stratos 40\
KSB Etanorm 125

Asset Models define:

• manufacturer specifications\
• design performance values\
• operational limits\
• recommended maintenance schedules

------------------------------------------------------------------------

# 5. Asset Instance

Asset Instances represent **physical equipment in the facility**.

Example:

Pump_1023

Attributes:

asset_id\
asset_model_id\
location\
install_date\
commission_date\
serial_number\
contract_responsibility

Asset Instances connect operational data to the engineering model.

------------------------------------------------------------------------

# 6. Measurement Capabilities

Asset Classes define which **measurement types** may exist.

Example:

Pump

Measurements:

pressure_in\
pressure_out\
flow_rate\
motor_current\
vibration\
temperature

These measurement types allow the system to automatically create
telemetry streams.

------------------------------------------------------------------------

# 7. Measurement Series Integration

Asset Classes connect to MeasurementSeries definitions.

Example graph:

(:AssetClass)-\[:HAS_MEASUREMENT_TYPE\]-\>(:MeasurementType)

Example:

Pump ├ pressure ├ flow_rate └ vibration

When a pump asset is created, the system can automatically provision
measurement streams.

------------------------------------------------------------------------

# 8. Maintenance Templates

Asset Classes also define maintenance regimes.

Example:

Pump

Preventive Maintenance:

Inspect seals\
Check vibration\
Measure pressure differential\
Inspect coupling

These tasks become **checklist templates** attached to work orders.

------------------------------------------------------------------------

# 9. Failure Mode Library

Asset Classes maintain a catalog of expected failures.

Example:

Pump Failure Modes

seal failure\
bearing failure\
cavitation\
impeller wear

Recording failures against these categories allows future analytics.

------------------------------------------------------------------------

# 10. Asset Model Specifications

Asset Models extend the asset class with manufacturer data.

Example:

Grundfos CR32

Specifications:

max_flow_rate\
max_head\
power_rating\
efficiency_curve

This information enables:

• performance comparisons\
• efficiency calculations\
• anomaly detection

------------------------------------------------------------------------

# 11. Graph Relationships

Example graph structure:

(:AssetClass) ├ HAS_MODEL → (:AssetModel) ├ HAS_MEASUREMENT_TYPE →
(:MeasurementType) ├ HAS_PM_TEMPLATE → (:MaintenanceTemplate) └
HAS_FAILURE_MODE → (:FailureMode)

(:AssetInstance) ├ INSTANCE_OF → (:AssetModel) └ LOCATED_AT →
(:Location)

This creates a rich engineering graph.

------------------------------------------------------------------------

# 12. Automatic Provisioning

When an asset instance is created:

1.  Asset Model is selected
2.  Measurement types are inherited
3.  Telemetry streams may be created
4.  Maintenance templates are attached

This dramatically reduces configuration effort.

------------------------------------------------------------------------

# 13. Asset Capability Model

Asset Classes effectively define **equipment capabilities**.

Example:

Pump

Capabilities:

moves fluid\
consumes electrical power\
produces pressure differential

These capabilities allow the graph to reason about system behavior.

------------------------------------------------------------------------

# 14. Integration with Analytics

The Asset Class system allows analytics engines to compare assets.

Example queries:

Which pump model fails most often?

Which motor model runs hottest?

Which chiller model delivers best efficiency?

Without asset classes this analysis is impossible.

------------------------------------------------------------------------

# 15. Future Extensions

The asset class system may expand to include:

performance curves\
energy consumption models\
control strategies\
digital twin parameters

These extensions support advanced analytics and optimization.

------------------------------------------------------------------------

# 16. Summary

The Asset Class & Asset Model system provides:

• standard engineering structure\
• automated measurement configuration\
• consistent maintenance templates\
• failure classification\
• analytics compatibility

This system is essential for scaling the platform across tens of
thousands of assets.
