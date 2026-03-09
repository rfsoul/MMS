# ASSET_RELATIONSHIP_GRAPH.md

This document defines the **Asset Relationship Graph** used within the
MMS platform.

The asset relationship graph describes how infrastructure components are
connected, how systems interact, and how energy or materials flow
through a facility.

This graph model enables:

• system dependency mapping\
• maintenance impact analysis\
• infrastructure topology modelling\
• energy flow modelling\
• root cause analysis\
• digital twin capability

The asset graph is one of the most important architectural components of
MMS.

------------------------------------------------------------------------

# 1. Core Concept

Traditional maintenance systems treat assets as **independent objects**.

In reality, infrastructure assets exist in **systems of interconnected
components**.

Example:

Pump → supplies → Cooling Loop → feeds → AHU → serves → Building

Understanding these relationships allows the system to determine:

• upstream dependencies\
• downstream impacts\
• system boundaries\
• energy flow

------------------------------------------------------------------------

# 2. Graph Structure

The graph consists primarily of:

Nodes Relationships

### Nodes

Nodes may include:

AssetInstance\
AssetModel\
AssetClass\
Location\
System\
TelemetryStream\
EnergyMeter

### Relationships

Relationships describe how nodes interact.

Example:

(:Asset)-\[:SUPPLIES\]-\>(:Asset)

------------------------------------------------------------------------

# 3. Fundamental Relationship Types

The following relationships define the **core infrastructure topology**.

### CONNECTED_TO

Generic connection between assets.

Example:

Pump CONNECTED_TO Pipe

Used when the exact relationship type is unknown or unimportant.

------------------------------------------------------------------------

### FEEDS

Represents flow of material or medium.

Example:

Pump FEEDS CoolingLoop

Used for:

water\
air\
steam\
fluids

------------------------------------------------------------------------

### SUPPLIES

Represents supply of energy or service.

Example:

Switchboard SUPPLIES Chiller

Used for:

electrical supply\
steam supply\
hot water supply

------------------------------------------------------------------------

### SERVES

Represents delivery of service to an area.

Example:

AHU SERVES Floor_3

Used for:

air conditioning\
heating\
ventilation

------------------------------------------------------------------------

### CONTAINS

Represents spatial containment.

Example:

PlantRoom CONTAINS Chiller

Used for:

location hierarchy.

------------------------------------------------------------------------

### LOCATED_IN

Alternative location relationship.

Example:

Pump LOCATED_IN PlantRoom

------------------------------------------------------------------------

### PART_OF

Defines system membership.

Example:

Pump PART_OF ChilledWaterSystem

Systems may represent:

Cooling systems\
Heating systems\
Electrical systems

------------------------------------------------------------------------

# 4. Energy Flow Relationships

Energy modelling requires additional semantic relationships.

### CONSUMES_POWER

Example:

Chiller CONSUMES_POWER ElectricalSupply

------------------------------------------------------------------------

### PRODUCES_HEAT

Example:

Boiler PRODUCES_HEAT HeatingLoop

------------------------------------------------------------------------

### PRODUCES_COOLING

Example:

Chiller PRODUCES_COOLING ChilledWaterLoop

------------------------------------------------------------------------

### TRANSFERS_ENERGY

Represents heat exchangers or similar assets.

Example:

HeatExchanger TRANSFERS_ENERGY CoolingLoop → HeatingLoop

------------------------------------------------------------------------

# 5. Telemetry Relationships

Telemetry streams connect measurement systems to assets.

Example:

(:Asset)-\[:HAS_STREAM\]-\>(:TelemetryStream)

Telemetry streams represent measurement series stored in TimescaleDB.

------------------------------------------------------------------------

# 6. Maintenance Relationships

Maintenance history is also represented in the graph.

Example:

(:Asset)-\[:MAINTENANCE_EVENT\]-\>(:MaintenanceEvent)

(:Asset)-\[:FAILURE_EVENT\]-\>(:FailureEvent)

------------------------------------------------------------------------

# 7. Example Graph

Example infrastructure graph:

GridMeter └ SUPPLIES MainSwitchboard

MainSwitchboard └ SUPPLIES ChillerPlant

ChillerPlant └ PRODUCES_COOLING ChilledWaterLoop

ChilledWaterLoop └ FEEDS AHU_3

AHU_3 └ SERVES Building_A

------------------------------------------------------------------------

# 8. Impact Analysis

The graph enables queries such as:

If Chiller_2 fails:

Which AHUs lose cooling?

Which buildings are affected?

Which tenants are impacted?

These queries traverse the graph relationships.

------------------------------------------------------------------------

# 9. Root Cause Analysis

Example problem:

Room temperature rising.

Graph traversal:

Room\
→ AHU\
→ Cooling Loop\
→ Chiller

Telemetry analysis may identify the failing component.

------------------------------------------------------------------------

# 10. Integration with Asset Classes

Asset classes may define expected relationships.

Example:

Pump

Expected connections:

FEEDS Pipe\
PART_OF FluidSystem

This allows validation of infrastructure topology.

------------------------------------------------------------------------

# 11. System Boundaries

Systems represent logical infrastructure groups.

Example:

ChilledWaterSystem\
HeatingSystem\
ElectricalDistributionSystem

Assets may belong to multiple systems.

------------------------------------------------------------------------

# 12. Future Extensions

The relationship graph may expand to support:

energy optimisation modelling\
control system relationships\
fault propagation analysis\
digital twin simulations

These capabilities rely on a rich infrastructure graph.

------------------------------------------------------------------------

# 13. Summary

The Asset Relationship Graph provides:

• infrastructure topology\
• system dependency modelling\
• energy flow representation\
• telemetry mapping\
• maintenance impact analysis

It transforms MMS from a simple CMMS into an **infrastructure
intelligence platform**.
