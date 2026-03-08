# MMS Web App — Developer Handoff Brief

**Purpose:** This document provides everything a new development thread needs to work on the MMS web admin interface without requiring constant back-reference to the API/DB thread. It covers architecture, coding patterns, current state, known gaps, and the protocol for requesting changes.

---

## 1. System Overview

A multi-tenant Maintenance Management System serving three companies on a shared backend. Two clients consume one shared API:

- **Android tablet app** (React Native/Expo) — field technicians, offline-first
- **Web admin interface** (React + Vite) — managers, admins, help desk agents, browser-only

Both clients are read/write against the same REST API. There is no separate admin API.

**Stack:**
| Layer | Technology |
|---|---|
| Database | PostgreSQL 15 + Apache AGE (graph) + PostGIS (spatial) + pgcrypto |
| API | Node.js / Express |
| Mobile client | React Native / Expo (Android rugged tablets) |
| Web client | React + Vite (no SSR — internal tool, SSR not needed) |
| File storage | Local disk via Express static middleware |

**Three tenant companies (seeded):**
| Company | Email domain | Password |
|---|---|---|
| Acme Electrical Services | `@acme-electrical.com.au` | `Acme@123456` |
| Acme HVAC Services | `@acme-hvac.com.au` | `Acme@123456` |
| Acme Vertical Transport | `@acme-vt.com.au` | `Acme@123456` |
| Global Help Desk | `admin@mms.local` | `Admin@123456` |

Each company has: 1 admin, 1 manager, 2 technicians (e.g. `admin@acme-electrical.com.au`).

---

## 2. Roles and Access Model

Four roles, strictly enforced at the API layer via JWT claims:

| Role | Scope | Key capabilities |
|---|---|---|
| `help_desk_agent` | Cross-company | Manage companies, users, view all WOs, raise and manage maintenance issues |
| `admin` | Own company | Full company config, user management, asset management |
| `manager` | Own company | Create/assign WOs, manage schedules, approve asset requests |
| `technician` | Own assigned WOs | Execute work, submit responses, upload photos |

**Multi-tenancy rule:** Every API endpoint enforces `company_id` isolation from the JWT. A user cannot see or modify another company's data. `help_desk_agent` is the only role that crosses company boundaries.

**Auth flow:**
1. `POST /auth/login` → returns `{ token, user }`. Token is a JWT.
2. All subsequent requests: `Authorization: Bearer <token>`
3. If `user.must_change_password === true`, the client must redirect to change-password before any other action — the API enforces this via `requirePasswordCurrent` middleware (returns 403 `PASSWORD_CHANGE_REQUIRED`).

---

## 3. API Conventions

**Base URL:** Configured via environment — typically `http://localhost:3000` in development.

**All requests/responses:** `application/json` except photo upload (multipart).

**Error shape — always consistent:**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Human-readable description"
}
```

**Common error codes:**
| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing or invalid field |
| `NOT_FOUND` | 404 | Resource doesn't exist or wrong company |
| `FORBIDDEN` | 403 | Authenticated but wrong role/company |
| `INVALID_TRANSITION` | 400 | State machine violation |
| `BUSINESS_RULE_VIOLATION` | 400 | Domain constraint |
| `INCOMPLETE_CHECKLIST` | 400 | Required checklist items unanswered |
| `INVALID_OPERATION` | 400 | Action not permitted in current state |
| `DUPLICATE` | 409 | Unique constraint (e.g. duplicate company name) |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

**Rate limiting:** The auth endpoints (`/auth/login`, `/auth/forgot-password`, `/auth/change-password`) are rate-limited to 20 requests per 15-minute window in production (`NODE_ENV=production`). The limiter is bypassed entirely in non-production environments — test harnesses and development tooling are not affected.

**Pagination:** Not yet implemented on list endpoints. All lists return the full set for the company. This will need addressing as data grows — raise as a future API request.

---

## 4. Key Data Models

### 4.1 Asset Model — Dual Layer

Assets exist in two places simultaneously:

**AGE Graph (`asset_graph`)** — physical hierarchy and relationships:
```
Site → Building → Floor → Space → Asset
```
Relationships: `CONTAINS` (spatial), `HAS_ASSET`, `PART_OF`, `HAS_COMPONENT`, `FEEDS` (criticality).

Graph node IDs are numeric AGE integers stored as `TEXT` — referred to as `asset_graph_id` throughout the codebase. This is the join key between the graph and all relational tables.

**Relational tables** — operational data: work orders, checklists, schedules, responses.

**Web app perspective on the graph:**
- Field technicians don't traverse graph relationships — they just confirm assets exist
- The web app is where graph traversal matters: criticality impact, upstream/downstream views, maintenance history trends
- `MaintenanceReport` nodes are written to the graph when work orders close (not yet implemented — see Section 8)

### 4.2 Work Orders

```
Status flow:  open → assigned → in_progress → completed
                                    ↕
                                 on_hold
```

Key fields:
| Field | Notes |
|---|---|
| `type` | `pm`, `inspection`, `corrective`, `replacement` — **note: `maintenance` is not valid** |
| `priority` | `low`, `medium`, `high`, `critical` — **note: `urgent` is not valid** |
| `asset_graph_id` | Graph node this WO targets |
| `assigned_to` | User UUID (technician) |
| `swm_document_url` | Safe Work Method PDF — upload not yet routed |
| `actual_duration_minutes` | Recorded on close |
| `asset_request_id` | App-layer link to a field discovery (no FK in DB) |

**Completion rule:** Work orders can be closed regardless of task state — tasks are guidance for field technicians but do not gate WO closure. The one remaining task-level enforcement is that a `checklist_execution` task cannot itself be marked `completed` if required checklist items are unanswered (`INCOMPLETE_CHECKLIST`) — but that is task-level only and does not prevent the WO from closing.

### 4.3 Work Order Tasks

Tasks are structured execution steps within a WO. All must be completed or skipped to close the WO.

| `task_type` | Has checklist? | Description |
|---|---|---|
| `checklist_execution` | Yes — `asset_checklist_id` required | Execute an asset checklist |
| `inspection` | No | Physical inspection step |
| `general` | No | General instruction |
| `safety_check` | No | Safety verification |
| `reading` | No | Record a meter/gauge reading |

### 4.4 Checklist Architecture — Three Levels

```
Template (asset_type_checklist_templates)
    ↓ copied from, not linked to
Asset Checklist (asset_checklists)
    ↓ executed via work_order_task
Checklist Response (asset_checklist_responses)
    scoped to: asset_checklist_item_id + work_order_task_id
```

**Templates** are convenience only — a starting point for creating asset checklists. They have no runtime role. Template changes do not affect existing asset checklists.

**Asset checklists** are the living definitions. Multiple checklists per asset are normal (e.g. monthly, quarterly, annual). Each has `version` for lineage.

**Checklist item types:** `measurement`, `true_false`, `step`, `text`, `photo`

**Important flags on checklist items:**
- `is_required` — must be answered before task can complete
- `is_runtime_trigger` — one per checklist max; feeds PM runtime scheduling from recorded values
- `is_reportable` — if `TRUE`, this item's response is written as a `ChecklistResult` graph node when the WO closes. Use for engineering measurements worth trending (temperatures, pressures, currents, voltages). Set `FALSE` for procedural steps, visual checks, safety checks.

### 4.5 Asset Requests (Field Discovery)

When a technician encounters an unregistered asset during a job:
1. Tech submits `POST /work-orders/:id/asset-requests` with name, optional type, location
2. Record lands in `asset_requests` table with `status: pending`
3. Admin reviews, creates the graph node, resolves the request with `resolved_asset_graph_id`

**Important:** `asset_requests` is scoped to `company_id` only — there is no FK back to the work order. The nested route path is contextual. `work_orders.asset_request_id` is an app-layer soft link only.

### 4.6 Maintenance Issues

Issues are raised by the help desk and resolved by a tenant company. They have their own lifecycle separate from work orders:

```
Status flow:  open → assigned → inspecting → follow_up_work → closed
```

Auto-close: when all work orders linked to an issue reach `completed`, the DB trigger `auto_close_issue` automatically closes the parent issue.

Key fields:
| Field | Notes |
|---|---|
| `raised_by` | Must be a `help_desk_agent` — enforced by DB trigger |
| `target_company_id` | Cannot be the help desk company — enforced by DB trigger |
| `severity` | `low`, `medium`, `high`, `critical` |
| `asset_graph_id` | Optional — null for vague/location-unknown faults |
| `reporter_id` | Optional FK to `reporters` table — external person who reported the fault |
| `symptom_category_id` | Optional FK to `symptom_categories` lookup |
| `assigned_at`, `inspecting_at`, `follow_up_work_at`, `closed_at` | Auto-stamped by DB trigger on each status change |

Status history is automatically recorded in `issue_status_history` on every status change via a DB trigger. The trigger reads `current_setting('app.current_user_id')` — see coding patterns section for implementation detail.

**Inspection records** (`inspections` table): one per issue, created by a technician belonging to the target company. Has `outcome`: `resolved` or `follow_up`.

**Reporters** (`reporters` table): external contacts (tenants, building managers) who reported the fault. Not company-scoped — global lookup. Help desk agents can create reporters on-the-fly while raising an issue.

**Symptom categories** (`symptom_categories`): seeded lookup — Electrical, Plumbing, HVAC, Structural, Mechanical, Fire Safety, Security, Cleaning, Other. Read-only from the API.

**Role access summary for issues:**
| Action | Roles |
|---|---|
| Raise issue | `help_desk_agent` only |
| Edit issue fields | `help_desk_agent` only |
| View issues | `help_desk_agent` (all), `admin`/`manager` (own company only), `technician` (denied) |
| Transition `open → assigned` | `help_desk_agent` only |
| Transition `assigned → inspecting` | `help_desk_agent`, `admin`, `manager` of target company |
| Transition `inspecting → follow_up_work` | `help_desk_agent`, `admin`, `manager` of target company |
| Transition `follow_up_work → closed` | `help_desk_agent` only |

### 4.7 PM Schedules

Schedules drive automated WO generation:

| Trigger category | How it works |
|---|---|
| `calendar` | `interval_value` + `trigger_type` (monthly/weekly/etc.) — cron generates WOs |
| `runtime` | `runtime_threshold` — informational only, web client surfaces alert when threshold approached |

The scheduler checks `last_generated_date` and generates WOs up to 12 months ahead. The `pm_generated_work_orders` junction table (unique on `schedule_id + due_date`) prevents duplicate generation.

---

## 5. API Route Map

### Currently Implemented

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/auth/login` | — | Returns token + user |
| GET | `/auth/me` | any | Current user |
| POST | `/auth/change-password` | any | Required if `must_change_password` |
| POST | `/auth/forgot-password` | — | Always 200 |
| GET | `/companies` | help_desk_agent | List all companies |
| POST | `/companies` | help_desk_agent | Create company |
| GET | `/companies/:id` | help_desk_agent | Single company |
| PATCH | `/companies/:id` | help_desk_agent | Update company |
| GET | `/users` | admin, manager, help_desk_agent | Company-scoped list |
| POST | `/users` | admin, help_desk_agent | Create user |
| GET | `/users/:id` | admin, manager, help_desk_agent | Single user |
| PATCH | `/users/:id` | admin, help_desk_agent | Update user |
| POST | `/users/:id/reset-password` | admin, help_desk_agent | Force password reset |
| GET | `/asset-types` | any | Company-scoped list |
| POST | `/asset-types` | admin | Create type |
| PATCH | `/asset-types/:id` | admin | Update type |
| POST | `/assets` | admin, manager | Create graph node |
| GET | `/assets` | any | All nodes for company |
| GET | `/assets/flat` | any | Paginated flat list (mobile sync) |
| GET | `/assets/types` | any | Asset type list (mobile picker) |
| GET | `/assets/:nodeId` | any | Single enriched node |
| PATCH | `/assets/:nodeId` | admin, manager | Update node properties |
| GET | `/assets/:nodeId/neighbours` | any | Connected nodes |
| GET | `/assets/:nodeId/hierarchy` | any | Spatial ancestors |
| GET | `/assets/:nodeId/wo-cache` | any | Last 2 completed WOs (mobile cache) |
| POST | `/assets/relationships` | admin, manager | Create edge |
| DELETE | `/assets/relationships/:id` | admin, manager | Remove edge |
| GET | `/checklists/templates` | admin, manager | List templates |
| POST | `/checklists/templates` | admin | Create template |
| GET | `/checklists/templates/:id` | admin, manager | Single template + items |
| GET | `/checklists/templates/:id/export` | admin | CSV export |
| POST | `/checklists/templates/import` | admin | CSV import |
| DELETE | `/checklists/templates/:id` | admin | Deactivate |
| GET | `/checklists/assets/:assetGraphId` | any | List asset checklists |
| POST | `/checklists/assets/:assetGraphId` | admin | Create asset checklist |
| GET | `/checklists/assets/:assetGraphId/:id` | any | Single checklist + items |
| PATCH | `/checklists/assets/:assetGraphId/:id` | admin | Update checklist |
| POST | `/checklists/assets/:assetGraphId/import` | admin | CSV import |
| GET | `/checklists/assets/:assetGraphId/:id/export` | admin | CSV export |
| DELETE | `/checklists/assets/:assetGraphId/:id` | admin | Deactivate |
| GET | `/work-orders` | any | Company-scoped list with filters |
| POST | `/work-orders` | admin, manager, technician | Create WO |
| GET | `/work-orders/:id` | any | Single WO + updates journal |
| PATCH | `/work-orders/:id` | admin, manager, technician | Update fields |
| POST | `/work-orders/:id/assign` | admin, manager | Assign technician |
| POST | `/work-orders/:id/start` | any | Transition to in_progress |
| POST | `/work-orders/:id/hold` | any | Transition to on_hold |
| POST | `/work-orders/:id/complete` | any | Complete WO (any status → complete) |
| POST | `/work-orders/:id/updates` | any | Add journal note + optional `photo_urls[]` |
| GET | `/work-orders/:id/tasks` | any | Task list |
| POST | `/work-orders/:id/tasks` | admin, manager | Create task |
| GET | `/work-orders/:id/tasks/:taskId` | any | Single task |
| PATCH | `/work-orders/:id/tasks/:taskId` | admin, manager | Update task |
| DELETE | `/work-orders/:id/tasks/:taskId` | admin, manager | Delete pending task |
| POST | `/work-orders/:id/tasks/:taskId/start` | any | Transition to in_progress |
| POST | `/work-orders/:id/tasks/:taskId/complete` | any | Transition to completed |
| POST | `/work-orders/:id/tasks/:taskId/skip` | any | Skip task |
| GET | `/work-orders/:id/tasks/:taskId/responses` | any | Items + current responses |
| POST | `/work-orders/:id/tasks/:taskId/responses` | any | Bulk upsert responses |
| DELETE | `/work-orders/:id/tasks/:taskId/responses/:responseId` | any | Delete response |
| GET | `/work-orders/:id/photos` | any | List photos |
| POST | `/work-orders/:id/photos` | admin, manager, technician | Upload photo (multipart) |
| DELETE | `/work-orders/:id/photos/:photoId` | admin, manager | Delete photo |
| POST | `/work-orders/:id/asset-requests` | admin, manager, technician | Submit field discovery |
| GET | `/work-orders/:id/asset-requests` | any | List discoveries (default: pending only) |
| GET | `/pm/trigger-types` | any | Lookup list |
| GET | `/pm/schedules` | any | Schedule list |
| POST | `/pm/schedules` | admin, manager | Create schedule |
| GET | `/pm/schedules/:id` | any | Single schedule + upcoming WOs |
| PATCH | `/pm/schedules/:id` | admin, manager | Update schedule |
| DELETE | `/pm/schedules/:id` | admin, manager | Deactivate |
| POST | `/pm/schedules/:id/generate` | admin, manager | Generate WOs for 12 months |
| GET | `/pm/schedules/:id/work-orders` | any | List generated WOs |
| POST | `/pm/run` | admin | Run scheduler across all active schedules |
| GET | `/issues/symptom-categories` | any | Lookup list for raise-issue picker |
| GET | `/issues` | help_desk_agent (all), admin/manager (own company) | List issues with filters |
| POST | `/issues` | help_desk_agent | Raise new issue |
| GET | `/issues/:id` | help_desk_agent, admin/manager of target company | Single issue + history + WOs + inspection |
| PATCH | `/issues/:id` | help_desk_agent | Update editable fields (not status) |
| PATCH | `/issues/:id/status` | help_desk_agent, admin/manager (limited transitions) | Advance lifecycle |
| GET | `/reporters` | help_desk_agent | List reporters |
| POST | `/reporters` | help_desk_agent | Create reporter on-the-fly |

### Missing / Not Yet Implemented

The following are **confirmed gaps** — raise as API requests to the DB/API thread:

1. **`GET /asset-requests`** — admin list view of all pending/approved/rejected discoveries (currently only accessible nested under a WO). Needs standalone endpoint with filters.
2. **`PATCH /asset-requests/:id`** — admin resolve action: set `resolved_asset_graph_id`, update `status` to `approved` or `rejected`, record `resolved_by` + `resolved_at`.
3. **`POST /checklists/templates/from-asset/:assetGraphId/:checklistId`** — promote an asset checklist to a reusable template.
4. **`POST /work-orders/:id/swm`** — upload a Safe Work Method PDF document. The `work_orders` table has `swm_document_url`, `swm_document_name`, `swm_uploaded_by`, `swm_uploaded_at` columns but no upload route exists.
5. **MaintenanceReport graph write** — triggered on WO close, writes a graph node with nested `TaskExecution` and `ChecklistResult` children. This is a backend service, not a route, but the web app will need to query it via a graph traversal endpoint (also missing).
6. **`GET /assets/:nodeId/maintenance-history`** — query graph for `MaintenanceReport` nodes attached to an asset, for trend display.
7. **`POST /inspections`** — no route yet for creating an inspection record. Technician of the target company submits inspection outcome (`resolved` or `follow_up`) and notes.
8. **`GET /issues` filters** — currently filters `status`, `severity`, `target_company_id`. May need `raised_by`, `reporter_id`, date range filters as the list grows.

### Known Route Bugs (raise fix requests if encountered)

- `POST /assets/relationships` is shadowed by `/:nodeId` in Express — may need route reordering
- `GET /asset-types` may not return `is_active` column
- `GET /assets/:nodeId/wo-cache` has a JOIN issue with `asset_checklist_name`
- PM schedule mutation routes may be missing `requireRole` guards
- `POST /pm/run` should require `admin` role — currently unguarded

---

## 6. Coding Patterns

When the web app thread raises API changes or additions, the DB/API thread will implement them. Providing these patterns helps frame requests correctly and ensures consistency.

### Service / Route Separation

Every route file delegates to a service file. Routes handle HTTP concerns (auth middleware, request parsing, response serialisation). Services handle business logic and DB access.

```
routes/work-orders.routes.js  →  services/work-orders.service.js
routes/work-order-tasks.routes.js  →  services/work-order-tasks.service.js
```

Inline SQL in route files is acceptable for simple single-table lookups. Complex queries and all business logic go in the service.

### Error Pattern

Services throw structured errors using a `fail()` helper:

```js
function fail(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code   = code;
  throw err;
}
// Usage:
fail(404, 'NOT_FOUND', 'Work order not found');
fail(400, 'VALIDATION_ERROR', 'title is required');
fail(403, 'FORBIDDEN', 'Technicians cannot create tasks');
```

Express error middleware catches these and returns the standard `{ code, message }` shape. **Always use this pattern** — never `res.status(x).json(...)` from a service function.

### Auth Middleware Chain

Most protected routes use this middleware stack (applied at router level):

```js
router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);
```

- `requireAuth` — validates JWT, attaches `req.user = { id, company_id, role, ... }`
- `requirePasswordCurrent` — rejects with `PASSWORD_CHANGE_REQUIRED` if `must_change_password`
- `requireCompanyUser` — verifies the user's company exists and is **not** the help desk company (`is_help_desk = FALSE`)

**Exception — issues and reporters routes omit `requireCompanyUser`:** help desk agents belong to the help desk company (`is_help_desk = TRUE`) and would be rejected by that guard. These routes use only `requireAuth` + `requirePasswordCurrent` at the router level, with role enforcement handled per-endpoint via `requireRole('help_desk_agent')`.

Role checks use inline middleware:

```js
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => { ... });
```

`requireRole` is variadic — pass any number of allowed roles.

### Database Access

```js
const { query } = require('../db/pool');
// or for inline route SQL:
const pool = require('../db/pool');

// Service usage:
const { rows } = await query(`SELECT * FROM work_orders WHERE id = $1`, [id]);

// Route inline usage:
const result = await pool.query(`SELECT id FROM companies WHERE id = $1`, [id]);
```

Always use parameterised queries (`$1`, `$2`...). Never interpolate user input.

**Important — pool wrapper limitation:** The pool module exposes `.query()` but **not** `.connect()`. You cannot acquire a dedicated client for manual transaction management. If you need `BEGIN/COMMIT`, you cannot use `pool.connect()` — it will throw `TypeError: pool.connect is not a function`.

**Pattern for triggers that read session config** (e.g. `record_issue_status_history` reads `current_setting('app.current_user_id')`): use `set_config()` with `is_local=false` in a separate `pool.query` call immediately before the statement that fires the trigger:

```js
// Set the session variable the trigger will read
await pool.query(`SELECT set_config('app.current_user_id', $1, false)`, [req.user.id]);
// Fire the statement (and thus the trigger)
await pool.query(`UPDATE maintenance_issues SET status = $1 WHERE id = $2`, [newStatus, id]);
```

`is_local=false` is session-scoped rather than transaction-scoped. This is safe when set immediately before the triggering statement. Do not use `is_local=true` — it is not visible to the trigger through this pool wrapper.

### Multi-Tenancy Pattern

Every service function receives `requestingUser` (from `req.user`) and enforces company isolation:

```js
async function getWorkOrder(workOrderId, requestingUser) {
  const { rows } = await query(
    `SELECT * FROM work_orders WHERE id = $1 AND company_id = $2`,
    [workOrderId, requestingUser.company_id]
  );
  if (rows.length === 0) fail(404, 'NOT_FOUND', 'Work order not found');
  // 404 rather than 403 — don't reveal existence of other companies' data
  ...
}
```

`help_desk_agent` is the only role that can bypass the `company_id` filter — check `requestingUser.role === 'help_desk_agent'` before applying it.

---

## 7. Schema Quick Reference

Key tables and their primary relationships:

```
companies
  └── users (company_id)
  └── asset_types (company_id)
  └── work_orders (company_id)
  └── pm_schedules (company_id)
  └── asset_requests (company_id)

maintenance_issues
  ├── issue_status_history (issue_id)
  ├── issue_attachments (issue_id)
  ├── inspections (issue_id — unique, one per issue)
  │     └── inspection_attachments (inspection_id)
  └── work_orders (issue_id — follow-up WOs)

reporters  (global — not company-scoped)
symptom_categories  (global lookup — seeded, read-only)

work_orders
  ├── work_order_tasks (work_order_id)
  │     └── asset_checklist_responses (work_order_task_id)
  ├── work_order_updates (work_order_id)
  └── work_order_photos (work_order_id)

asset_checklists (asset_graph_id → AGE graph)
  └── asset_checklist_items (checklist_id)
        └── asset_checklist_responses (asset_checklist_item_id)

asset_type_checklist_templates (asset_type_id)
  └── asset_type_checklist_template_items (template_id)

pm_schedules
  └── pm_generated_work_orders (schedule_id, work_order_id)
```

**`asset_graph_id`** is a TEXT column throughout — it holds a numeric AGE node ID as a string. It is not a UUID. Do not treat it as one.

**Tables with no route coverage yet:** `parts`, `inspections` (inspection creation), `issue_attachments`, `inspection_attachments`, `spatial_zones`, `rooms`, `business_units` — these exist in the schema but have no API routes.

---

## 8. Outstanding Work Items

In rough priority order for the web app:

### High — blocks core admin workflows
1. **Asset request resolution** — `PATCH /asset-requests/:id` + standalone `GET /asset-requests`. Admin needs to review and approve/reject field discoveries.
2. **Inspection creation** — `POST /inspections`. Technician of the target company submits inspection outcome and notes. DB trigger enforces that `inspected_by` must be a technician belonging to the target company.
3. **SWM document upload** — `POST /work-orders/:id/swm`. The DB columns are ready; needs a multer route similar to photos.
4. **Parts catalogue** — `parts` table exists with no routes. Admin CRUD + assignment to work orders (schema change needed: `work_order_parts` junction table).

### Medium — improves operational visibility
5. **Maintenance history endpoint** — `GET /assets/:nodeId/maintenance-history`. Requires the graph write service (item 6 below) to have run first.
6. **MaintenanceReport graph write** — service triggered on WO close. Writes `MaintenanceReport → TaskExecution → ChecklistResult` nodes. Only `is_reportable = TRUE` items produce `ChecklistResult` nodes.
7. **PM schedule `asset_checklist_id`** — column exists in schema, but PM schedule create/update routes don't yet expose it. Generated WOs would then auto-attach the correct checklist as a task.

### Low — convenience and completeness
8. **Promote asset checklist to template** — `POST /checklists/templates/from-asset/:assetGraphId/:checklistId`
9. **Issue attachment upload** — `POST /issues/:id/attachments`. DB table exists (`issue_attachments`), no route.
10. **Seed data gaps** — consider requesting: more historical work orders, a mix of WO statuses, some resolved asset requests, parts records, and at least one completed WO with checklist responses for trend display testing.
11. **`GET /asset-requests` default filter** — currently defaults to `pending`. Web admin will likely want `?status=all` as the default or a tab-based filter. Clarify UX requirements before raising the change.

---

## 9. Seed Data Reference

**Reseed procedure:**
```bash
psql -d mms -f 00_teardown.sql
psql -d mms -f 01_setup.sql   # only needed after schema changes
psql -d mms -f 02_seed_companies_users.sql
psql -d mms -f 03_seed_graph.sql
psql -d mms -f 04a_seed_checklists_electrical.sql
psql -d mms -f 04b_seed_checklists_hvac.sql
psql -d mms -f 04c_seed_checklists_vtransport.sql
psql -d mms -f 05_seed_pm_schedules.sql
psql -d mms -f 06_seed_work_orders.sql
psql -d mms -f 07_seed_issues.sql
psql -d mms -f 08_seed_lisa_workorders.sql  # open WOs for mobile testing
```

**Important — `00_teardown.sql` re-inserts lookup tables:** `symptom_categories`, `space_types`, and the help desk company are truncated by teardown and re-inserted at the bottom of `00_teardown.sql`. Do not skip teardown when reseeding or these will be missing. `01_setup.sql` only needs to be re-run after schema changes.

**What's seeded:**
- 3 tenant companies + 1 help desk company
- 13 users (4 per tenant + 1 help desk admin)
- Asset graph: Site → Building → multiple floors/spaces/assets per company
- Asset types per company (e.g. Switchboard, Chiller, Lift)
- Checklist templates per asset type with `is_reportable` flags set
- Asset checklists copied from templates per asset
- PM schedules (calendar monthly/weekly/yearly) for key assets
- Historical completed work orders with checklist responses (Electrical, HVAC, Vertical Transport)
- 6 maintenance issues across all three companies in varied statuses (open ×2, assigned, inspecting, follow_up_work, closed)
- 4 reporters
- 1 inspection record (on the follow_up_work issue)
- 1 follow-up work order linked to an issue
- 9 symptom categories (Electrical, Plumbing, HVAC, Structural, Mechanical, Fire Safety, Security, Cleaning, Other)
- **4 open work orders assigned to Lisa Park** (see below)

**Open work orders for mobile app testing — Lisa Park (`tech1@acme-hvac.com.au`)**

These four WOs are designed to exercise distinct mobile app states immediately on login. All are for Acme HVAC Services. Login credentials: `tech1@acme-hvac.com.au` / `Acme@123456`.

| # | Asset | Title | Status | Priority | Tasks |
|---|---|---|---|---|---|
| 1 | CH-A2 | CH-A2 Monthly Inspection — Jan 2025 | `assigned` | high | 1 × `checklist_execution` (pending) |
| 2 | AHU-03 | AHU-03 Filter Service & Inspection — Jan 2025 | `in_progress` | medium | 1 × `checklist_execution` (in_progress) + 2 × `general` (pending) |
| 3 | CHWP-B1 | CHWP-B1 Vibration Fault Investigation | `assigned` | critical | 1 × `inspection` + 1 × `reading` (both pending, no checklist) |
| 4 | BLR-A1 | BLR-A1 Monthly Inspection — Jan 2025 | `assigned` | high | 1 × `checklist_execution` (pending) |

What each WO tests on the mobile client:

- **WO 1 & 4** (`assigned`, checklist pending) — the standard queue state: WO appears in the list, tech taps Start, then works through the checklist. Tests the `assigned → in_progress` transition and checklist execution path.
- **WO 2** (`in_progress`, multi-task) — simulates a job already underway. The checklist task is `in_progress` and two general tasks are `pending`. Tests resuming an active job, mixed task types, and the requirement that all tasks must be completed/skipped before the WO can close.
- **WO 3** (`assigned`, corrective, no checklist) — a fault call with no checklist attached. Tests the non-checklist task path (`inspection` and `reading` task types), `critical` priority display, and completing a WO that has only general tasks.

**What's not seeded (known gaps):**
- No `parts` records
- No `asset_requests` records
- No `MaintenanceReport` graph nodes
- PM-generated WOs have no checklist responses recorded

---

## 10. Handoff Protocol

When the web app thread identifies an API gap or bug:

**For new endpoints or schema changes:**
> "Need: `PATCH /asset-requests/:id` — admin resolves a field discovery. Should accept `{ status: 'approved'|'rejected', resolved_asset_graph_id?, notes? }`. Should set `resolved_by`, `resolved_at`. Returns updated `asset_request`."

**For bug fixes:**
> "Bug: `GET /asset-types` does not return `is_active` in the response. Needed for filter UI."

**For seed data:**
> "Need: 3-5 completed work orders for Acme HVAC with checklist responses recorded, including at least one `is_out_of_range` result. Needed for trend display development."

**For test harness:**
> "New endpoint added — please add harness coverage for `PATCH /asset-requests/:id`."

The DB/API thread will implement the change, update the test harness and API docs, and return the updated files. The web app thread consumes the updated files and proceeds.

**Current outputs from DB/API thread** (latest versions):
- `01_setup.sql` — full schema
- `00_teardown.sql` — teardown + lookup table re-inserts
- `02_seed_companies_users.sql` — user seed
- `07_seed_issues.sql` — issues, reporters, inspections seed
- `08_seed_lisa_workorders.sql` — open WOs for mobile testing (Lisa Park / Acme HVAC)
- `auth.routes.js` — rate limiter with `NODE_ENV`-based test bypass
- `index.js` — API entry point with all routes mounted
- `work-orders.routes.js` — includes asset-requests routes
- `work-order-tasks.routes.js` — bulk responses
- `work-order-tasks.service.js` — includes `submitResponses`
- `work-order-photos.service.js` — photo upload service
- `issues.routes.js` — full issue lifecycle routes
- `reporters.routes.js` — reporter CRUD routes
- `mms_android_api_docs.txt` — full API reference (DokuWiki format)
- `mms_design_notes.txt` — architectural decisions and rationale
- `test-harness.js` — 144 tests, 100% pass rate
