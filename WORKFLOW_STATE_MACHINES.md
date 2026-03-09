# WORKFLOW_STATE_MACHINES.md

This document defines the **formal lifecycle state machines** used in
the MMS system.

These workflows reflect real-world maintenance processes and must be
respected by API logic, database triggers, and UI workflows.

AI agents must enforce valid state transitions.

------------------------------------------------------------------------

# 1. Issue Lifecycle

Issues represent faults or complaints reported by users or technicians.

Possible states:

open → assigned → inspecting → follow_up_work → closed

State meanings:

open Issue has been reported but not yet reviewed.

assigned Issue assigned to technician or inspection team.

inspecting Technician performing investigation.

follow_up_work Inspection determined maintenance work is required.

closed Issue resolved and no further work required.

Valid transitions:

open → assigned assigned → inspecting inspecting → follow_up_work
inspecting → closed follow_up_work → closed

Invalid transitions must be rejected by the API.

------------------------------------------------------------------------

# 2. Inspection Lifecycle

Inspections diagnose issues.

States:

scheduled → in_progress → completed

scheduled Inspection created but not started.

in_progress Technician currently performing inspection.

completed Inspection finished.

Outcomes of inspection:

• Issue resolved • Work order created • Multiple work orders created

------------------------------------------------------------------------

# 3. Work Order Lifecycle

Work orders represent actionable maintenance work.

States:

open → assigned → in_progress → on_hold → completed → verified

State meanings:

open Work order created.

assigned Technician assigned.

in_progress Technician performing work.

on_hold Waiting for parts, access, or other constraints.

completed Technician finished the task.

verified Supervisor confirms work quality.

Valid transitions:

open → assigned assigned → in_progress in_progress → on_hold on_hold →
in_progress in_progress → completed completed → verified

------------------------------------------------------------------------

# 4. Work Order Task Lifecycle

Tasks break work orders into smaller actions.

States:

pending → in_progress → completed

pending Task created but not started.

in_progress Technician working on task.

completed Task finished.

Checklist completion may be required before task completion.

------------------------------------------------------------------------

# 5. Preventive Maintenance Lifecycle

PM schedules automatically generate work orders.

States:

active → paused → retired

active PM schedule generating work orders.

paused Schedule temporarily disabled.

retired Schedule permanently disabled.

Scheduler generates work orders according to:

calendar schedule runtime thresholds

------------------------------------------------------------------------

# 6. Asset Request Lifecycle

Technicians may discover assets not registered in the system.

Workflow:

draft → submitted → under_review → approved → rejected

draft Technician recording asset details.

submitted Request sent for review.

under_review Manager reviewing request.

approved Asset created in graph.

rejected Request declined.

Approval creates:

Graph asset node resolved_asset_graph_id link

------------------------------------------------------------------------

# 7. Checklist Lifecycle

Checklists collect maintenance data.

States:

template → assigned → completed

template Checklist definition.

assigned Checklist attached to work order.

completed Technician finished checklist.

Templates are immutable once assigned.

------------------------------------------------------------------------

# 8. Measurement Data Lifecycle

Engineering measurements evolve into historical asset data.

Checklist Response ↓ Maintenance Result Record ↓ Graph Measurement Node

Graph measurements enable:

trend analysis predictive maintenance asset performance tracking
