# MEASUREMENT_TYPES.md

This document defines the **Measurement Type System** used within the
MMS platform.

Measurement types standardize how engineering measurements are defined,
stored, interpreted, and analyzed across the entire platform.

Without standardized measurement definitions, telemetry and manual
readings quickly become inconsistent and difficult to analyze.

This document establishes the foundation for:

• telemetry streams\
• checklist measurements\
• engineering analytics\
• predictive maintenance\
• energy monitoring

------------------------------------------------------------------------

# 1. Core Concept

A **Measurement Type** represents a specific engineering variable that
can be recorded.

Examples:

pressure\
temperature\
flow_rate\
motor_current\
vibration

Measurement Types define:

• the engineering meaning of a measurement\
• the expected unit\
• valid ranges\
• how the value may be interpreted in analytics

------------------------------------------------------------------------

# 2. Relationship to Assets

Measurement Types are linked to **Asset Classes**.

Example:

Pump

Measurement Types:

pressure_in\
pressure_out\
flow_rate\
motor_current\
vibration

Graph relationship:

(:AssetClass)-\[:HAS_MEASUREMENT_TYPE\]-\>(:MeasurementType)

------------------------------------------------------------------------

# 3. Measurement Type Structure

Each measurement type should include the following attributes.

measurement_type_id\
name\
description\
default_unit\
data_type\
normal_range_min\
normal_range_max\
critical_range_min\
critical_range_max

Example:

MeasurementType

name: pressure_out\
default_unit: bar\
data_type: float

------------------------------------------------------------------------

# 4. Units

Units must be explicitly defined to avoid ambiguity.

Examples:

pressure → bar / kPa\
temperature → °C\
flow_rate → L/s or m³/h\
power → kW\
energy → kWh

The system should allow conversion between compatible units.

------------------------------------------------------------------------

# 5. Data Types

Measurement values may be different data types.

Examples:

float\
integer\
boolean\
enumeration

Example:

valve_position → enumeration (open / closed)

------------------------------------------------------------------------

# 6. Common Measurement Types

The following measurement types are common across many facilities.

Electrical

voltage\
current\
power_kw\
energy_kwh\
power_factor

Thermal

temperature\
delta_t\
thermal_power

Fluid Systems

pressure\
flow_rate\
fluid_temperature

Mechanical

rpm\
vibration\
torque

Environmental

room_temperature\
humidity\
co2_level\
occupancy

------------------------------------------------------------------------

# 7. Integration with Telemetry Streams

Measurement Types are used to define **Telemetry Streams**.

Example:

TelemetryStream

stream_id: chiller_3_power\
measurement_type: power_kw\
unit: kW

Graph relationship:

(:TelemetryStream)-\[:OF_TYPE\]-\>(:MeasurementType)

------------------------------------------------------------------------

# 8. Integration with Manual Measurements

Measurement Types also support manual readings during maintenance.

Example checklist item:

Measure discharge pressure

Measurement Type:

pressure_out

------------------------------------------------------------------------

# 9. Derived Measurements

Some measurements are calculated rather than directly measured.

Examples:

COP (Coefficient of Performance)\
energy_intensity\
efficiency

Derived measurements may use multiple input streams.

Example:

COP = cooling_output_kw / electrical_input_kw

Derived measurements may appear as **virtual telemetry streams**.

------------------------------------------------------------------------

# 10. Validation

Measurement Types allow validation of recorded values.

Example:

temperature

normal range: -20 → 120 °C

If a value falls outside expected limits, the system may:

flag anomaly\
trigger alert\
reject invalid input

------------------------------------------------------------------------

# 11. Analytics Integration

Measurement Types provide the semantic layer required for analytics.

Examples:

trend detection\
anomaly detection\
efficiency calculations

Analytics engines rely on consistent measurement definitions.

------------------------------------------------------------------------

# 12. Example Measurement Type Definition

Example record:

MeasurementType

name: motor_current\
description: electrical current drawn by a motor\
default_unit: A\
data_type: float\
normal_range_min: 0\
normal_range_max: 200

------------------------------------------------------------------------

# 13. Future Extensions

Measurement types may later include:

calibration metadata\
sensor accuracy\
data quality flags\
measurement frequency recommendations

These extensions improve reliability of analytics.

------------------------------------------------------------------------

# 14. Summary

The Measurement Type System ensures that:

• telemetry is standardized\
• engineering meaning is preserved\
• analytics engines receive consistent data\
• asset classes can automatically define measurement capabilities

This system is a foundational component of the MMS engineering data
model.
