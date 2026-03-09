# SYSTEM_DOMAIN_MODEL.md

This document defines the **core domain model** of the MMS (Maintenance
Management System).\
It explains the real-world maintenance concepts represented in the
system and how they relate to each other.

AI coding agents must read this document before implementing features.

The goal is to ensure the system is built like a **modern CMMS designed
by experienced maintenance engineers**, not generic CRUD software.

------------------------------------------------------------------------

# 1. Core Philosophy

MMS models **real-world maintenance operations**.

Key principles:

-   Physical infrastructure is represented as a **graph of assets**
-   Operational work is stored in **relational records**
-   All engineering measurements eventually become **historical data in
    the graph**
-   Maintenance flows follow real-world lifecycle processes

The platform combines:

Graph topology + Operational workflows + Historical engineering data.

------------------------------------------------------------------------

# 2. Primary Domain Entities

The MMS domain revolves around these primary entities.

Core maintenance lifecycle:

Issue → Inspection → Work Order → Maintenance Results

Preventive maintenance:

Asset → PM Schedule → Generated Work Orders

Engineering history:

Checklist Measurement → Graph Measurement Node

------------------------------------------------------------------------

# 3. Asset Graph Model

Physical infrastructure is represented as a graph.

Hierarchy example:

Site ├ Building │ ├ Floor │ │ ├ Space │ │ │ ├ System │ │ │ │ ├ Asset │ │
│ │ │ └ Component

Assets are stored in **Apache AGE graph nodes**.

Relationships include:

CONTAINS HAS_ASSET PART_OF HAS_COMPONENT FEEDS

Example dependency:

Chiller FEEDS Air Handling Unit

Graph structure allows:

-   failure propagation analysis
-   dependency mapping
-   engineering system modelling

Relational tables reference graph nodes using:

asset_graph_id

------------------------------------------------------------------------

# 4. Operational Maintenance Entities

Operational data is stored in relational tables.

## Work Order

Represents a maintenance task to be performed.

Attributes include:

-   id
-   company_id
-   asset_graph_id
-   assigned_to
-   priority
-   status
-   created_at
-   completed_at

Lifecycle:

open → assigned → in_progress → on_hold → completed

A work order may contain:

-   tasks
-   checklist responses
-   photos
-   parts used

------------------------------------------------------------------------

## Work Order Tasks

Tasks break a work order into smaller actions.

Example:

Work Order: Service Pump Tasks: - Inspect seals - Measure pressure -
Replace filter

Tasks may require checklist completion.

------------------------------------------------------------------------

## Work Order Photos

Photos capture visual evidence of maintenance work.

Examples:

-   damaged component
-   completed repair
-   inspection result

------------------------------------------------------------------------

# 5. Issue Reporting

Issues represent faults reported by users or technicians.

Source of issues:

-   building occupants
-   help desk staff
-   technicians
-   automated monitoring (future)

Issue lifecycle:

open → assigned → inspecting → follow_up_work → closed

Issues may produce:

Inspection → Work Orders

------------------------------------------------------------------------

# 6. Inspection

An inspection is performed to diagnose an issue.

Inspection results may:

-   resolve the issue
-   generate one or more work orders

Example:

Issue: Air handler making noise

Inspection finds:

-   worn fan belt

Result:

Work Order created to replace belt

------------------------------------------------------------------------

# 7. Preventive Maintenance

Preventive maintenance is scheduled maintenance designed to prevent
failure.

Entity:

PM Schedule

Attributes:

-   asset_graph_id
-   schedule_type
-   interval
-   last_run
-   next_run

Schedule types:

-   calendar based
-   runtime based

PM schedules generate work orders automatically.

Generated work orders are recorded in:

pm_generated_work_orders

------------------------------------------------------------------------

# 8. Checklist System

Checklists capture structured maintenance data.

Three layers:

Template → Asset Checklist → Checklist Response

Templates define:

-   checklist items
-   measurement types
-   acceptable ranges

Example checklist:

Pump Service Checklist

Items:

-   discharge pressure
-   suction pressure
-   vibration level

Responses capture actual measurements.

------------------------------------------------------------------------

# 9. Engineering Measurement Data

All measurements must eventually be stored in the **asset graph**.

Example measurement:

Pump discharge pressure = 6.2 bar

Workflow:

Checklist Response ↓ Maintenance Result Node ↓ Graph storage

Graph storage enables:

-   trend analysis
-   predictive maintenance
-   engineering history

------------------------------------------------------------------------

# 10. Inventory and Parts

The system tracks replacement parts used in maintenance.

Entities:

Part Inventory WorkOrderPart

## Part

Represents a type of component used in maintenance.

Examples:

-   bearing
-   filter
-   seal kit

Attributes:

-   part_number
-   description
-   manufacturer
-   compatible_asset_types

------------------------------------------------------------------------

## Inventory

Tracks quantity of parts available.

Attributes:

-   part_id
-   location
-   quantity_available

------------------------------------------------------------------------

## WorkOrderPart

Records parts consumed during maintenance.

Example:

Work Order: Replace pump seal

Parts used:

Seal kit x1

This supports:

-   inventory tracking
-   cost analysis
-   maintenance planning

------------------------------------------------------------------------

# 11. Asset Requests

Technicians frequently discover assets that are not registered in the
system.

The system supports **asset creation requests**.

Workflow:

Technician discovers asset ↓ Creates Asset Request ↓ Manager reviews
request ↓ Request approved ↓ Asset node created in graph

Asset Request attributes:

-   asset description
-   location
-   photos
-   technician notes
-   proposed asset type

Once approved:

resolved_asset_graph_id links request to graph node.

------------------------------------------------------------------------

# 12. Reporter Model

Issues may originate from reporters.

Reporter examples:

-   building occupant
-   help desk operator
-   technician

Reporters may not be full system users.

Reporter attributes:

-   name
-   contact info
-   organization

------------------------------------------------------------------------

# 13. Company and Multi-Tenancy

The system is multi-tenant.

Entities:

Company User

Roles include:

-   admin
-   manager
-   technician
-   help_desk_agent

Tenant isolation rules:

Most queries must include:

WHERE company_id = requesting_user.company_id

------------------------------------------------------------------------

# 14. Domain Relationships Overview

High-level domain relationships:

Asset ├ PM Schedule │ └ Generated Work Orders │ ├ Issues │ └ Inspection
│ └ Work Orders │ └ Maintenance History └ Measurement Results

Work Orders ├ Tasks ├ Photos ├ Checklist Responses └ Parts Used

Technicians may also generate:

Asset Requests

------------------------------------------------------------------------

# 15. Domain Goals

The MMS system is designed to support:

-   maintenance workflow management
-   engineering data capture
-   asset lifecycle tracking
-   preventive maintenance planning
-   inventory tracking
-   long-term equipment analytics

AI coding agents must ensure new features align with this domain model.
