# MMS API — Project Notes
*Last updated: 21 February 2026*

---

## Project Overview

A **multi-tenant Maintenance Management System (MMS)** built with:

- **Backend:** Node.js / Express
- **Database:** PostgreSQL with Apache AGE extension (graph queries)
- **Auth:** Internal email/password (bcrypt, session tokens) — Azure AD/Entra ID also designed in
- **Mobile:** React Native / Expo (planned)
- **Web:** React (planned)

---

## Architecture Decisions

### Multi-tenancy
- One `companies` table — one row is flagged `is_help_desk = TRUE` (Global Help Desk)
- Help desk agents can see and manage all companies
- Company users (admin, manager, technician) are scoped to their own `company_id`

### Roles
| Role | Scope |
|---|---|
| `help_desk_agent` | Help desk company only — raises issues, manages all companies |
| `admin` | Company-scoped — full CRUD within company |
| `manager` | Company-scoped — can create/assign work orders |
| `technician` | Company-scoped — self-assigns, updates own work orders |

### Asset Graph (Apache AGE)
Seven node types in the `asset_graph` graph: `Site → Building → Floor → Space → System → Asset → Component`

Relationship types: `CONTAINS`, `HAS_ASSET`, `PART_OF`, `FEEDS`, `HAS_COMPONENT`

### Database
- Schema defined in `db/init/01_setup.sql` — single file, runs on container init
- No separate migration files — schema changes go into `01_setup.sql` and require a container rebuild
- DB triggers handle: timestamp stamping, status history, constraint enforcement, out-of-range measurement flagging, required checklist item enforcement before WO completion

---

## Docker Setup

```bash
# Run the API
docker compose up --build

# Run the test harness
docker run --rm \
  --network maintenance-system_default \
  -v $(pwd)/test/test-harness.js:/test-harness.js \
  -e API_URL=http://mms-api:3000 \
  node:20-alpine \
  node /test-harness.js
```

Container name: `mms-api`
Network: `maintenance-system_default`
API internal URL: `http://mms-api:3000`

---

## Files Produced This Session

### API Source Files
| File | Destination |
|---|---|
| `work-orders.service.js` | `src/services/` |
| `work-orders.routes.js` | `src/routes/` |
| `checklists.service.js` | `src/services/` |
| `checklists.routes.js` | `src/routes/` |

### Config Files Updated
| File | Change |
|---|---|
| `src/index.js` | Added `work-orders` and `checklists` route registrations |
| `package.json` | Added `multer` dependency |

### Test
| File | Destination |
|---|---|
| `test-harness.js` | `test/` — full merged harness including all suites |

---

## API Endpoints

### Work Orders — `/work-orders`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/work-orders` | all | List (technician sees own only) |
| POST | `/work-orders` | admin, manager, technician | Create |
| GET | `/work-orders/:id` | all | Get with `updates[]` array |
| PATCH | `/work-orders/:id` | admin, manager, technician | Update fields |
| POST | `/work-orders/:id/assign` | admin, manager | Assign technician |
| POST | `/work-orders/:id/start` | admin, manager, technician | → in_progress |
| POST | `/work-orders/:id/hold` | admin, manager, technician | → on_hold |
| POST | `/work-orders/:id/complete` | admin, manager, technician | → completed |
| POST | `/work-orders/:id/updates` | admin, manager, technician | Add field note / photos |
| POST | `/work-orders/:id/swm` | admin, manager | Record SWM document |

### Work Order Status Transitions
```
open → assigned → in_progress → on_hold → in_progress → completed
         ↓                                                   (terminal)
        open  (unassign)
```
Note: `cancelled` does NOT exist in the schema.

### Work Order Schema (key columns)
```
id, company_id, issue_id, inspection_id, title, description,
status, priority, asset_graph_id, assigned_to, created_by,
swm_document_url, swm_document_name, swm_uploaded_by, swm_uploaded_at,
actual_duration_minutes, completed_at, created_at, updated_at
```
- `completed_at` is auto-stamped by DB trigger — not set by the service
- Field updates go into `work_order_updates` table (has `status`, `notes`, `photo_urls`)

---

### Checklists — `/checklists`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/checklists/templates` | all | List templates |
| POST | `/checklists/templates` | admin, manager, help_desk_agent | Create with JSON items |
| GET | `/checklists/templates/:id` | all | Get template + items |
| DELETE | `/checklists/templates/:id` | admin, manager, help_desk_agent | Soft-deactivate |
| POST | `/checklists/templates/import` | admin, manager, help_desk_agent | CSV upload → create template |
| GET | `/checklists/templates/:id/export` | all | Download items as CSV |
| GET | `/checklists/work-orders/:woId` | all | Get checklists on a WO (with responses) |
| POST | `/checklists/work-orders/:woId` | admin, manager, help_desk_agent | Attach template to WO |
| DELETE | `/checklists/work-orders/:woId/:clId` | admin, manager, help_desk_agent | Detach checklist |

### Checklist Design Decisions
- **Versioning:** Duplicate template name → auto-versioned (`v2`, `v3`, etc.) — never rejected
- **CSV import:** `multipart/form-data` with fields: `file` (CSV), `asset_type_id`, `name`, `description`
- **CSV columns:** `sequence, label, description, item_type, unit, min_value, max_value, is_required`
- **Item types:** `measurement`, `true_false`, `step`, `text`, `photo`
- **Snapshot:** Attaching a template copies all items into `work_order_checklist_items` — template edits never affect in-flight WOs
- **DB trigger:** Checklist can only be attached to `open` or `assigned` work orders
- **DB trigger:** Required checklist items must all be responded to before WO can be completed
- **DB trigger:** Out-of-range measurement responses auto-flagged via `is_out_of_range`

---

## Test Harness — Suite Order

```
testHealth()
testAuth()
testCompanies()
testUsers()
testAssetTypes()
testAssetGraph()
testWorkOrders()
testChecklists()
testCleanup()
```

### State Object (key fields)
```js
adminToken, adminUser
companyAdminToken, companyAdminUser, companyAdminEmail
testCompanyId, testUserId, technicianUserId
assetTypeId, siteNodeId, buildingNodeId, floorNodeId,
spaceNodeId, systemNodeId, assetNodeId, componentNodeId
workOrderId, assignedWorkOrderId, techWOId
managerUserId, managerToken, managerEmail
technicianToken, technicianEmail
checklistTemplateId, importedTemplateId, workOrderChecklistId
```

### Test Counts (approximate)
| Suite | Tests |
|---|---|
| Health | 1 |
| Auth | 6 |
| Companies | 5 |
| Users | 8 |
| Asset Types | 3 |
| Asset Graph | 16 |
| Work Orders | 30 |
| Checklists | 20 |
| Cleanup | ~10 |
| **Total** | **~99** |

---

## What's Not Yet Built

- Checklist **responses** (technician submitting answers via mobile)
- **Parts / inventory** usage against work orders
- **Preventive maintenance scheduling** (recurring WOs)
- **IFC import/export** service (IfcOpenShell / BIM data)
- **React web portal**
- **React Native mobile app**
- **Issue / inspection** API endpoints (tables exist in schema)
- **Reporters** API (external fault reporters)
- **Rooms / spatial zones** API
- **Business units** API
