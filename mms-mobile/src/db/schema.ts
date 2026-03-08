// src/db/schema.ts
// Local SQLite schema. Tables mirror the API's PostgreSQL schema so that
// synced rows can be stored and queried offline without transformation.
// UUIDs are stored as TEXT. Booleans as INTEGER (0/1). Timestamps as TEXT (ISO).

export const CREATE_TABLES = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- ── Users ──────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    full_name   TEXT NOT NULL,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL,
    company_id  TEXT NOT NULL
  );

  -- ── Work orders ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS work_orders (
    id                          TEXT PRIMARY KEY,
    company_id                  TEXT NOT NULL,
    title                       TEXT NOT NULL,
    description                 TEXT,
    status                      TEXT NOT NULL DEFAULT 'open',
    priority                    TEXT NOT NULL DEFAULT 'medium',
    asset_graph_id              TEXT,
    asset_label                 TEXT,
    asset_type                  TEXT,
    location                    TEXT,
    building                    TEXT,
    assigned_to                 TEXT,
    assigned_to_name            TEXT,
    type                        TEXT,
    estimated_duration_minutes  INTEGER,
    actual_duration_minutes     INTEGER,
    started_at                  TEXT,
    completed_at                TEXT,
    created_at                  TEXT NOT NULL,
    updated_at                  TEXT NOT NULL,
    -- Local sync metadata
    synced_at                   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_wo_status     ON work_orders (status);
  CREATE INDEX IF NOT EXISTS idx_wo_assigned   ON work_orders (assigned_to);
  CREATE INDEX IF NOT EXISTS idx_wo_priority   ON work_orders (priority);
  CREATE INDEX IF NOT EXISTS idx_wo_location   ON work_orders (location);

  -- ── Work order tasks ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS work_order_tasks (
    id                          TEXT PRIMARY KEY,
    work_order_id               TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    sequence                    INTEGER NOT NULL,
    title                       TEXT NOT NULL,
    description                 TEXT,
    task_type                   TEXT NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'pending',
    asset_checklist_id          TEXT,
    asset_checklist_name        TEXT,
    estimated_duration_minutes  INTEGER,
    actual_duration_minutes     INTEGER,
    started_at                  TEXT,
    completed_at                TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_wo ON work_order_tasks (work_order_id, sequence);

  -- ── Asset checklists (header only — items pulled separately) ───────────────
  CREATE TABLE IF NOT EXISTS asset_checklists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    company_id  TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1
  );

  -- ── Checklist items ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS checklist_items (
    id                  TEXT PRIMARY KEY,
    checklist_id        TEXT NOT NULL REFERENCES asset_checklists(id) ON DELETE CASCADE,
    sequence            INTEGER NOT NULL,
    label               TEXT NOT NULL,
    description         TEXT,
    item_type           TEXT NOT NULL,
    unit                TEXT,
    min_value           REAL,
    max_value           REAL,
    is_required         INTEGER NOT NULL DEFAULT 0,
    is_runtime_trigger  INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_items_checklist ON checklist_items (checklist_id, sequence);

  -- ── Checklist responses ────────────────────────────────────────────────────
  -- Stores both synced (from server) and pending (local-only) responses.
  CREATE TABLE IF NOT EXISTS checklist_responses (
    id                        TEXT PRIMARY KEY,
    asset_checklist_item_id   TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
    work_order_task_id        TEXT NOT NULL REFERENCES work_order_tasks(id) ON DELETE CASCADE,
    responded_by              TEXT NOT NULL,
    responded_at              TEXT NOT NULL,
    numeric_value             REAL,
    boolean_value             INTEGER,     -- 0 / 1 / NULL
    text_value                TEXT,
    photo_url                 TEXT,
    notes                     TEXT,
    is_out_of_range           INTEGER NOT NULL DEFAULT 0,
    -- Local sync metadata
    is_pending_sync           INTEGER NOT NULL DEFAULT 0,   -- 1 = not yet synced to server
    local_photo_path          TEXT    -- path in expo-file-system if photo not yet uploaded
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_resp_unique
    ON checklist_responses (asset_checklist_item_id, work_order_task_id);

  -- ── Outbox ─────────────────────────────────────────────────────────────────
  -- Queue for writes that happened while offline.
  CREATE TABLE IF NOT EXISTS outbox (
    id           TEXT PRIMARY KEY,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    operation    TEXT NOT NULL,
    payload      TEXT NOT NULL,  -- JSON
    created_at   TEXT NOT NULL,
    retry_count  INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT
  );

  -- ── Sync log ───────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    synced_at   TEXT NOT NULL,
    direction   TEXT NOT NULL,   -- 'pull' | 'push'
    entity_type TEXT,
    record_count INTEGER,
    error       TEXT
  );
`;

export const CREATE_ASSET_TABLES = `

  -- Asset types (mirrors public.asset_types, UUID pk as TEXT)
  CREATE TABLE IF NOT EXISTS asset_types (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    synced_at   TEXT
  );

  -- Flat asset table (denormalised from AGE graph)
  -- Hierarchy: Site-[:CONTAINS]->Building-[:CONTAINS]->Floor
  --            -[:CONTAINS]->Space-[:HAS_ASSET]->Asset
  -- asset_graph_id = AGE node id cast to TEXT
  CREATE TABLE IF NOT EXISTS asset_nodes (
    asset_graph_id  TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL,
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    asset_type_id   TEXT,
    asset_type_name TEXT,
    site_name       TEXT,
    building_name   TEXT,
    floor_name      TEXT,
    space_name      TEXT,
    location_id     TEXT,
    floor_level     INTEGER,
    address         TEXT,
    synced_at       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_asset_nodes_company
    ON asset_nodes (company_id);
  CREATE INDEX IF NOT EXISTS idx_asset_nodes_type
    ON asset_nodes (asset_type_id);
  CREATE INDEX IF NOT EXISTS idx_asset_nodes_status
    ON asset_nodes (status);

  -- FTS5 index for instant asset search
  CREATE VIRTUAL TABLE IF NOT EXISTS asset_nodes_fts USING fts5(
    asset_graph_id UNINDEXED,
    code,
    name,
    description,
    asset_type_name,
    site_name,
    building_name,
    floor_name,
    space_name,
    content='asset_nodes',
    content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS asset_nodes_ai
    AFTER INSERT ON asset_nodes BEGIN
      INSERT INTO asset_nodes_fts(rowid, asset_graph_id, code, name,
        description, asset_type_name, site_name, building_name, floor_name, space_name)
      VALUES (new.rowid, new.asset_graph_id, new.code, new.name,
        new.description, new.asset_type_name, new.site_name,
        new.building_name, new.floor_name, new.space_name);
    END;

  CREATE TRIGGER IF NOT EXISTS asset_nodes_ad
    AFTER DELETE ON asset_nodes BEGIN
      INSERT INTO asset_nodes_fts(asset_nodes_fts, rowid, asset_graph_id, code,
        name, description, asset_type_name, site_name, building_name, floor_name, space_name)
      VALUES ('delete', old.rowid, old.asset_graph_id, old.code, old.name,
        old.description, old.asset_type_name, old.site_name,
        old.building_name, old.floor_name, old.space_name);
    END;

  CREATE TRIGGER IF NOT EXISTS asset_nodes_au
    AFTER UPDATE ON asset_nodes BEGIN
      INSERT INTO asset_nodes_fts(asset_nodes_fts, rowid, asset_graph_id, code,
        name, description, asset_type_name, site_name, building_name, floor_name, space_name)
      VALUES ('delete', old.rowid, old.asset_graph_id, old.code, old.name,
        old.description, old.asset_type_name, old.site_name,
        old.building_name, old.floor_name, old.space_name);
      INSERT INTO asset_nodes_fts(rowid, asset_graph_id, code, name,
        description, asset_type_name, site_name, building_name, floor_name, space_name)
      VALUES (new.rowid, new.asset_graph_id, new.code, new.name,
        new.description, new.asset_type_name, new.site_name,
        new.building_name, new.floor_name, new.space_name);
    END;

  -- Cache of 2 most recent completed work orders per asset
  -- Full task + response detail stored as JSON to avoid cascade complexity
  CREATE TABLE IF NOT EXISTS asset_wo_cache (
    id              TEXT PRIMARY KEY,
    asset_graph_id  TEXT NOT NULL,
    company_id      TEXT NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL,
    priority        TEXT NOT NULL,
    assigned_to     TEXT,
    assigned_to_name TEXT,
    actual_duration_minutes INTEGER,
    completed_at    TEXT,
    created_at      TEXT NOT NULL,
    tasks_json      TEXT NOT NULL DEFAULT '[]',
    synced_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_asset_wo_cache_asset
    ON asset_wo_cache (asset_graph_id, completed_at DESC);

  -- Asset requests raised from the field
  -- These are notifications to helpdesk admin, NOT real asset records
  CREATE TABLE IF NOT EXISTS asset_requests (
    id                      TEXT PRIMARY KEY,
    company_id              TEXT NOT NULL,
    requested_by            TEXT NOT NULL,
    requested_at            TEXT NOT NULL,
    code                    TEXT,
    name                    TEXT NOT NULL,
    description             TEXT,
    asset_type_id           TEXT,
    asset_type_name         TEXT,
    suggested_location      TEXT,
    notes                   TEXT,
    photo_url               TEXT,
    local_photo_path        TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending',
    resolved_asset_graph_id TEXT,
    resolved_at             TEXT,
    is_pending_sync         INTEGER NOT NULL DEFAULT 1
  );

  -- Sync metadata — tracks last successful pull per entity type
  -- Used for delta sync (updated_since param on API)
  CREATE TABLE IF NOT EXISTS sync_meta (
    entity_type    TEXT PRIMARY KEY,
    last_synced_at TEXT NOT NULL
  );
`;

