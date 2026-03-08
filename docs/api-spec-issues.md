# Issue Request API — Spec for DB/API Thread

Raised by: Web App thread
Priority: High — blocks Issue Request workflow UI

---

## Background

`maintenance_issues`, `inspections`, `issue_attachments`, `issue_status_history`,
`symptom_categories`, and `reporters` are fully modelled in the schema but have
no API routes. This spec covers everything the web admin needs.

DB constraints to be aware of:
- `trg_issue_raised_by` — `raised_by` must be a `help_desk_agent`
- `trg_issue_target_company` — `target_company_id` must not be the help desk company
- `trg_issue_status_timestamps` — auto-stamps `assigned_at`, `inspecting_at` etc.
- `trg_issue_status_history` — requires `SET LOCAL app.current_user_id = '<uuid>'`
  to be set inside the transaction before any status update
- `auto_close_issue` trigger — fires on `work_orders` UPDATE; auto-closes the
  parent issue when all linked WOs reach `completed`

---

## New Endpoints

### GET /issues
List maintenance issues. Help desk sees all issues (cross-company by nature).
Company admins/managers see issues targeted at their company only.

**Roles:** any (scoped by role — help_desk_agent sees all)

**Query params:**
| Param | Values | Notes |
|---|---|---|
| `status` | open, assigned, inspecting, follow_up_work, closed | Filter by status |
| `severity` | low, medium, high, critical | Filter by severity |
| `target_company_id` | UUID | Filter by company |
| `limit` | int | Default 50 |
| `offset` | int | Default 0 |

**Response 200:**
```json
{
  "issues": [
    {
      "id": "uuid",
      "title": "string",
      "fault_description": "string",
      "severity": "low|medium|high|critical",
      "status": "open|assigned|inspecting|follow_up_work|closed",
      "asset_graph_id": "string|null",
      "asset_name": "string|null",
      "target_company_id": "uuid",
      "target_company_name": "string",
      "symptom_category_id": "uuid|null",
      "symptom_category_name": "string|null",
      "reporter_id": "uuid|null",
      "reporter_name": "string|null",
      "raised_by": "uuid",
      "raised_by_name": "string",
      "created_at": "timestamptz",
      "assigned_at": "timestamptz|null",
      "inspecting_at": "timestamptz|null",
      "follow_up_work_at": "timestamptz|null",
      "closed_at": "timestamptz|null"
    }
  ],
  "total": 0
}
```

Note: `asset_name` requires a JOIN or graph lookup. If expensive, omit from list
and include only in the single-issue response. The UI can fall back to showing
`asset_graph_id` in the list view.

---

### POST /issues
Raise a new maintenance issue.

**Roles:** help_desk_agent only (DB trigger also enforces this)

**Body:**
```json
{
  "title": "string (required)",
  "fault_description": "string (required)",
  "severity": "low|medium|high|critical (required)",
  "target_company_id": "uuid (required)",
  "asset_graph_id": "string|null (optional)",
  "symptom_category_id": "uuid|null (optional)",
  "reporter_id": "uuid|null (optional)"
}
```

**Response 201:** full issue object (same shape as list item above)

---

### GET /issues/:id
Single issue with full detail.

**Roles:** help_desk_agent | admin/manager of target company

**Response 200:** issue object PLUS:
```json
{
  "status_history": [
    {
      "id": "uuid",
      "old_status": "string|null",
      "new_status": "string",
      "notes": "string|null",
      "changed_by_name": "string",
      "created_at": "timestamptz"
    }
  ],
  "work_orders": [
    {
      "id": "uuid",
      "title": "string",
      "status": "string",
      "priority": "string",
      "company_id": "uuid",
      "company_name": "string",
      "assigned_to_name": "string|null",
      "created_at": "timestamptz"
    }
  ],
  "inspection": {
    "id": "uuid",
    "notes": "string",
    "outcome": "resolved|follow_up|null",
    "inspected_by_name": "string",
    "created_at": "timestamptz"
  } | null
}
```

---

### PATCH /issues/:id
Update editable fields. Does NOT change status — use the status endpoint below.

**Roles:** help_desk_agent

**Body (all optional):**
```json
{
  "title": "string",
  "fault_description": "string",
  "severity": "low|medium|high|critical",
  "symptom_category_id": "uuid|null",
  "asset_graph_id": "string|null"
}
```

**Response 200:** updated issue object

---

### PATCH /issues/:id/status
Advance the issue through its lifecycle. Validates allowed transitions.

**Roles:**
- `help_desk_agent` — all transitions
- `admin`/`manager` of target company — `assigned → inspecting`, `inspecting → follow_up_work`

**Allowed transitions:**
```
open           → assigned
assigned       → inspecting
inspecting     → follow_up_work
follow_up_work → closed
```
Note: `→ closed` can also happen automatically via the `auto_close_issue` trigger
when all linked work orders complete.

**Body:**
```json
{
  "status": "assigned|inspecting|follow_up_work|closed",
  "notes": "string|null"
}
```

**Implementation note:** The `record_issue_status_history` trigger reads
`current_setting('app.current_user_id')`. The service must wrap the UPDATE in a
transaction and execute:
```sql
SET LOCAL app.current_user_id = '<requesting_user_uuid>';
UPDATE maintenance_issues SET status = $1 WHERE id = $2;
```

**Response 200:** updated issue object

**Errors:**
```json
{ "code": "INVALID_TRANSITION", "message": "Cannot transition from 'closed' to 'assigned'" }
{ "code": "FORBIDDEN", "message": "Only help_desk_agents can close issues" }
```

---

### GET /issues/symptom-categories
Return all seeded symptom categories for the raise-issue picker.

**Roles:** any

**Response 200:**
```json
{
  "categories": [
    { "id": "uuid", "name": "HVAC", "description": "string" }
  ]
}
```

---

### GET /reporters
List existing reporters for the raise-issue picker.

**Roles:** help_desk_agent

**Response 200:**
```json
{
  "reporters": [
    {
      "id": "uuid",
      "full_name": "string",
      "email": "string|null",
      "phone": "string|null",
      "organisation": "string|null"
    }
  ]
}
```

---

### POST /reporters
Create a reporter on-the-fly while raising an issue (no separate reporter management screen yet).

**Roles:** help_desk_agent

**Body:**
```json
{
  "full_name": "string (required)",
  "email": "string|null",
  "phone": "string|null",
  "organisation": "string|null"
}
```

**Response 201:** reporter object

---

## Routes file suggestion

```
routes/issues.routes.js      → services/issues.service.js
routes/reporters.routes.js   → services/reporters.service.js
```

Mount in app.js:
```js
app.use('/issues',    require('./routes/issues.routes'));
app.use('/reporters', require('./routes/reporters.routes'));
```

The symptom-categories route can sit on `/issues/symptom-categories` or as a
standalone `/symptom-categories` — either works. Suggest the former to keep
issue-related lookups grouped.

---

## Test Harness Coverage Needed

Please add harness tests for:
1. `POST /issues` — valid raise, missing required fields, non-help-desk user rejected
2. `GET /issues` — list, filter by status, filter by company
3. `GET /issues/:id` — includes history, work_orders, inspection
4. `PATCH /issues/:id/status` — valid transitions, invalid transitions, notes recorded
5. `GET /issues/symptom-categories`
6. `POST /reporters` + `GET /reporters`

---

## Seed Data Request

For web app development, please add to seed script:
- 4–6 `maintenance_issues` across all three companies in varied statuses
- At least 2 with `asset_graph_id` set (specific) and 2 without (vague)
- At least 1 with an `inspection` record
- At least 1 in `follow_up_work` with a linked work order
- At least 1 `closed` issue
- 3–4 `reporters` records
