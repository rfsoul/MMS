# SYSTEM_ENTITY_DIAGRAM.md

This document describes the **entity relationships of the MMS system**.

It complements SYSTEM_DOMAIN_MODEL.md by visually describing how
entities interact.

------------------------------------------------------------------------

# 1. Core Maintenance Flow

Issue → Inspection → Work Order → Maintenance Results

Example flow:

Issue reported ↓ Inspection performed ↓ Work orders generated ↓
Checklist responses recorded ↓ Measurements stored in asset graph

------------------------------------------------------------------------

# 2. Asset Hierarchy

Infrastructure is stored in a graph hierarchy.

Site ├ Building │ ├ Floor │ │ ├ Space │ │ │ ├ System │ │ │ │ ├ Asset │ │
│ │ │ └ Component

Relationships include:

CONTAINS PART_OF HAS_COMPONENT FEEDS

------------------------------------------------------------------------

# 3. Maintenance Entities

Asset ├ PM Schedule │ └ Generated Work Orders │ ├ Issues │ └ Inspection
│ └ Work Orders │ └ Maintenance History └ Measurement Results

------------------------------------------------------------------------

# 4. Work Order Structure

Work Order ├ Tasks ├ Checklist Responses ├ Photos └ Parts Used

Checklist responses capture measurements and inspection results.

------------------------------------------------------------------------

# 5. Inventory Structure

Part ├ Inventory │ └ Stock Quantity └ WorkOrderPart

WorkOrderPart records parts used during maintenance.

Example:

Work Order: Replace pump seal

Parts used: Seal kit x1

------------------------------------------------------------------------

# 6. Reporter and Issue Model

Reporter └ Issue └ Inspection └ Work Orders

Reporters may be:

building occupants technicians help desk staff

------------------------------------------------------------------------

# 7. Asset Request Model

Technician ↓ Asset Request ↓ Manager Approval ↓ Asset Node Created

Asset request attributes:

description location photos proposed asset type

Approved requests link to:

resolved_asset_graph_id

------------------------------------------------------------------------

# 8. Multi-Tenant Model

Company ├ Users ├ Assets ├ Work Orders ├ Issues └ Inventory

Tenant isolation enforced via:

company_id

------------------------------------------------------------------------

# 9. Engineering Data Flow

Checklist Template ↓ Checklist Response ↓ Maintenance Result ↓ Graph
Measurement Node

Graph storage enables:

trend analysis predictive maintenance asset reliability tracking
