# SYSTEMS_AND_NETWORKS_MODEL.md

This document defines the **Systems and Networks Model** for the MMS
platform.

While individual assets represent physical equipment, infrastructure
within a facility is typically organized into **systems** and
**distribution networks**.

This model provides a way to represent:

• engineering systems\
• distribution networks\
• infrastructure groupings\
• energy and material flows\
• system-level maintenance and analytics

The Systems and Networks model complements the **Asset Relationship
Graph** and enables MMS to represent entire infrastructure systems
rather than isolated equipment.

------------------------------------------------------------------------

# 1. Core Concept

A **System** represents a logical grouping of infrastructure components
that collectively provide a service.

Examples:

Chilled Water System\
Heating System\
Electrical Distribution System\
Air Distribution System\
Domestic Water System

Assets operate **within systems**, and systems themselves may contain
subsystems or networks.

------------------------------------------------------------------------

# 2. Systems vs Networks

The MMS platform distinguishes between:

System\
Network

### System

A logical infrastructure function.

Examples:

Cooling System\
Heating System\
Ventilation System\
Electrical System

### Network

A physical distribution topology through which a medium flows.

Examples:

Chilled Water Loop\
Air Duct Network\
Electrical Feeder Network\
Hot Water Loop

A system may contain multiple networks.

Example:

Cooling System └ Chilled Water Network └ Cooling Tower Circuit

------------------------------------------------------------------------

# 3. System Node

Graph Node:

System

Attributes:

system_id\
name\
description\
system_type

Example:

System name: Chilled Water System

------------------------------------------------------------------------

# 4. Network Node

Graph Node:

Network

Attributes:

network_id\
name\
medium_type\
description

Example:

Network name: Chilled Water Loop A medium_type: water

------------------------------------------------------------------------

# 5. Relationship Structure

Systems and networks connect to assets through graph relationships.

Example:

(:System)-\[:HAS_NETWORK\]-\>(:Network)

(:Network)-\[:CONTAINS_ASSET\]-\>(:Asset)

(:Asset)-\[:PART_OF_SYSTEM\]-\>(:System)

------------------------------------------------------------------------

# 6. Example System Topology

Example cooling system graph:

ChilledWaterSystem └ HAS_NETWORK ChilledWaterLoop

ChilledWaterLoop ├ CONTAINS_ASSET Chiller_1 ├ CONTAINS_ASSET Pump_1 └
CONTAINS_ASSET HeatExchanger_1

HeatExchanger_1 └ FEEDS AHU_3

AHU_3 └ SERVES Building_A

------------------------------------------------------------------------

# 7. Multi-System Assets

Some assets may participate in multiple systems.

Example:

Heat Exchanger

Connected to:

Cooling System\
Heating System

Graph example:

HeatExchanger_1 ├ PART_OF_SYSTEM CoolingSystem └ PART_OF_SYSTEM
HeatingSystem

------------------------------------------------------------------------

# 8. Network Medium Types

Networks represent the flow of a medium.

Examples:

water\
air\
steam\
electricity\
refrigerant

This attribute allows energy flow analysis.

Example:

Network medium_type: electricity

------------------------------------------------------------------------

# 9. System-Level Telemetry

Systems may also have telemetry streams.

Example:

CoolingSystem └ system_power_stream

This enables analytics such as:

total system power\
system efficiency\
system load

------------------------------------------------------------------------

# 10. System-Level Maintenance

Maintenance activities may target entire systems rather than individual
assets.

Examples:

Cooling system inspection\
Electrical system load testing\
Air distribution balancing

These work orders reference the **system node**.

------------------------------------------------------------------------

# 11. System Boundaries

Systems define engineering boundaries within a precinct.

Example:

Building_A Cooling System\
Central Plant Cooling System

Boundaries allow analytics such as:

system-level energy consumption\
system reliability metrics

------------------------------------------------------------------------

# 12. Relationship with Asset Classes

Asset Classes may specify typical systems they belong to.

Example:

Pump

Typical Systems:

Cooling System\
Heating System\
Water Distribution System

This allows automated topology validation.

------------------------------------------------------------------------

# 13. Impact Analysis

Systems allow system-wide impact analysis.

Example query:

If Pump_4 fails Which network loses flow?

Which buildings lose cooling?

Graph traversal:

Pump_4 → ChilledWaterLoop → CoolingSystem → AHUs → Buildings

------------------------------------------------------------------------

# 14. Energy Flow Modelling

Networks define the path for energy transfer.

Example:

Electric Network → supplies Cooling System

Cooling System → produces Cooling Energy

This allows calculation of:

system efficiency\
energy intensity\
system losses

------------------------------------------------------------------------

# 15. Precinct-Level Modelling

Large facilities may include multiple systems operating across the
precinct.

Example:

Central Cooling Plant\
District Heating System\
Electrical Distribution Grid

Systems may span multiple buildings.

------------------------------------------------------------------------

# 16. Future Extensions

The systems model may evolve to support:

digital twin simulation\
control strategy modelling\
system optimisation algorithms\
load balancing across systems

------------------------------------------------------------------------

# 17. Summary

The Systems and Networks Model enables MMS to represent infrastructure
at the **system level rather than the individual asset level**.

It provides:

• engineering system structure\
• distribution network modelling\
• infrastructure grouping\
• system-level telemetry\
• system-level maintenance

Together with the Asset Relationship Graph, it forms the foundation of
the MMS infrastructure knowledge graph.
