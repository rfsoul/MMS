# CODEX_TASK_TEMPLATE.md

This document provides a **standard task specification format** for
assigning development work to Codex or other AI coding agents.

Using a structured task specification dramatically improves output
quality, prevents architectural mistakes, and ensures changes remain
consistent with the MMS system design.

Always use this template when requesting code changes.

------------------------------------------------------------------------

# Codex Task Specification

## Task Title

Short descriptive title.

Example:

Implement PATCH /asset-requests/:id approval endpoint

------------------------------------------------------------------------

## Objective

Describe what the feature or change should accomplish from a system
perspective.

Example:

Allow managers to approve or reject asset requests created by
technicians.\
The endpoint must update request status and optionally link the approved
asset to a graph node.

------------------------------------------------------------------------

## Context

Explain how the change fits into the MMS system.

Relevant systems may include:

-   work orders
-   issues
-   checklists
-   PM schedules
-   asset graph

Example:

Asset requests are created when a technician discovers equipment that is
not yet registered in the asset graph.\
Managers review the request and either approve the creation of a new
asset node or reject the request.

------------------------------------------------------------------------

## API Changes

List all endpoints involved.

Example:

POST /asset-requests GET /asset-requests PATCH /asset-requests/:id
DELETE /asset-requests/:id

Include request and response structure.

Example:

Request:

{ status: "approved", resolved_asset_graph_id: "12345", notes: "Asset
added to graph" }

Response:

{ id: "...", status: "approved", resolved_by: "...", resolved_at: "..."
}

------------------------------------------------------------------------

## Database Changes

Specify required schema updates.

Example:

Table: asset_requests

Fields:

id (uuid) company_id created_by status notes resolved_asset_graph_id
resolved_by resolved_at

If new tables are required:

Provide full schema.

If triggers must be updated:

Describe trigger behaviour.

------------------------------------------------------------------------

## Files to Modify

List exact files Codex may edit.

Example:

api/src/routes/asset-requests.routes.js
api/src/services/asset-requests.service.js test/test-harness.js

If new files are required, list them explicitly.

------------------------------------------------------------------------

## Architectural Constraints

Codex must follow these rules:

-   routes contain no business logic
-   services implement domain logic
-   use parameterized SQL
-   enforce tenant isolation

Example constraint:

All queries must include company_id filtering.

------------------------------------------------------------------------

## Security Considerations

Specify role restrictions.

Example:

Only roles:

admin manager

may approve requests.

Technicians may only create requests.

------------------------------------------------------------------------

## Acceptance Criteria

Describe when the task is considered complete.

Example:

• Endpoint returns correct status codes\
• Tenant isolation enforced\
• Tests pass in test harness\
• Seed scripts updated if schema changed

------------------------------------------------------------------------

## Testing Requirements

List required tests.

Example:

Add tests in:

test/test-harness.js

Include cases:

-   approve request
-   reject request
-   invalid role
-   cross-company access blocked

------------------------------------------------------------------------

## Edge Cases

Describe important edge cases.

Example:

-   approving request without asset_graph_id
-   approving already approved request
-   request belonging to different company

------------------------------------------------------------------------

## Example Implementation Pattern

Use existing route/service structure.

Example:

Route:

router.patch('/asset-requests/:id', requireAuth,
requireRole('admin','manager'), handler)

Service:

async function updateAssetRequest(id, data, user)

------------------------------------------------------------------------

## Out of Scope

Explicitly list what Codex should NOT modify.

Example:

Do not modify:

asset graph schema checklist system PM scheduler

------------------------------------------------------------------------

# Usage Instructions

1.  Copy this template.
2.  Fill in each section.
3.  Submit the full specification to Codex.
4.  Review generated code before merging.

This ensures Codex produces safe and predictable changes.
