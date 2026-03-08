-- db/init/01_setup.sql
-- NOTE: The apache/age image automatically loads the AGE extension via
-- its own 00-create-extension-age.sql init script. We only need to
-- load additional extensions and set the search path here.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- AGE is already loaded by the image — just set the search path
LOAD 'age';
SET search_path = ag_catalog, '$user', public;

-- Create the asset graph (IF NOT EXISTS guard via exception handler)
DO $$
BEGIN
  PERFORM create_graph('asset_graph');
EXCEPTION
  WHEN others THEN
    IF SQLERRM LIKE '%already exists%' THEN
      RAISE NOTICE 'Graph asset_graph already exists, skipping.';
    ELSE
      RAISE;
    END IF;
END;
$$;

-- Reset search_path to public so all subsequent tables are created
-- in the correct schema and not in ag_catalog
SET search_path = public;

-- ─────────────────────────────────────────
-- COMPANIES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT UNIQUE NOT NULL,
  is_help_desk  BOOLEAN NOT NULL DEFAULT FALSE,
  address       TEXT,
  geom          GEOMETRY(POINT, 7856),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_one_help_desk
  ON companies (is_help_desk)
  WHERE is_help_desk = TRUE;

INSERT INTO companies (name, is_help_desk)
  VALUES ('Global Help Desk', TRUE)
  ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id),

  -- Shared identity fields (both auth modes)
  email         TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  role          TEXT CHECK (role IN (
                  'help_desk_agent',
                  'admin',
                  'manager',
                  'technician'
                )) NOT NULL,

  -- Azure AD / Entra ID fields (populated when auth_mode = 'azure_ad')
  -- azure_oid is the immutable Object ID from the AD token (oid claim)
  -- Used to match incoming tokens to MMS users — never changes even if
  -- email or name changes in AD
  azure_oid     TEXT UNIQUE,              -- nullable: only set in azure_ad mode

  -- Internal authentication fields (populated when auth_mode = 'internal')
  password_hash TEXT,                     -- nullable: only set in internal mode
  -- Enforces strong password reset policy
  password_changed_at   TIMESTAMPTZ,
  must_change_password  BOOLEAN DEFAULT FALSE,

  -- Last successful login regardless of auth mode
  last_seen_at  TIMESTAMPTZ,

  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast AD token-to-user lookup
CREATE INDEX IF NOT EXISTS idx_users_azure_oid ON users (azure_oid);
CREATE INDEX IF NOT EXISTS idx_users_company   ON users (company_id);

-- Enforce: azure_oid must be set when auth_mode is azure_ad,
--          password_hash must be set when auth_mode is internal
-- This is enforced at the application layer on user creation
-- (cannot reference system_config here as it may not yet exist)

CREATE OR REPLACE FUNCTION check_user_company_role()
RETURNS TRIGGER AS $$
DECLARE
  target_is_help_desk BOOLEAN;
BEGIN
  SELECT is_help_desk INTO target_is_help_desk
    FROM companies WHERE id = NEW.company_id;

  IF target_is_help_desk AND NEW.role != 'help_desk_agent' THEN
    RAISE EXCEPTION 'Only help_desk_agent role is allowed in the help desk company';
  END IF;

  IF NOT target_is_help_desk AND NEW.role = 'help_desk_agent' THEN
    RAISE EXCEPTION 'help_desk_agent role is only allowed in the help desk company';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_company_role
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION check_user_company_role();

-- ─────────────────────────────────────────
-- SYSTEM CONFIGURATION
-- Set once at installation time, never changed at runtime
-- Controls fundamental system behaviour such as auth mode
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_config (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Authentication mode — fixed at installation, cannot be changed at runtime
  -- 'internal'  : users authenticate with email + password managed in MMS
  -- 'azure_ad'  : users authenticate via Azure AD / Entra ID (OAuth 2.0 / OIDC)
  auth_mode     TEXT NOT NULL CHECK (auth_mode IN ('internal', 'azure_ad')),

  -- Internal auth settings (applicable when auth_mode = 'internal')
  -- Password policy enforced by the API on user creation and password change
  password_min_length       INT  NOT NULL DEFAULT 12,
  password_require_upper    BOOL NOT NULL DEFAULT TRUE,
  password_require_number   BOOL NOT NULL DEFAULT TRUE,
  password_require_special  BOOL NOT NULL DEFAULT TRUE,
  password_expiry_days      INT           DEFAULT 90,   -- NULL = passwords never expire
  max_failed_login_attempts INT  NOT NULL DEFAULT 5,    -- account locked after N failures
  session_timeout_minutes   INT  NOT NULL DEFAULT 480,  -- 8 hours default

  -- Installation metadata
  installed_at  TIMESTAMPTZ DEFAULT NOW(),
  installed_by  TEXT                                    -- name/email of installer
);

-- Enforce only one system config row ever exists
CREATE UNIQUE INDEX idx_one_system_config ON system_config ((TRUE));

-- ─────────────────────────────────────────
-- AZURE AD CONFIGURATION
-- Populated at installation when auth_mode = 'azure_ad'
-- Stores the Entra ID tenant details used to validate
-- incoming OAuth tokens. Only one row should ever exist.
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS azure_ad_config (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Azure AD / Entra ID tenant details
  tenant_id      TEXT NOT NULL,            -- Azure AD tenant (directory) ID
  client_id      TEXT NOT NULL,            -- MMS app registration client ID

  -- OIDC discovery — used by the API to fetch public keys for JWT verification
  -- Typically: https://login.microsoftonline.com/{tenant_id}/v2.0
  authority_url  TEXT NOT NULL,

  -- The audience claim the API expects in incoming tokens
  -- Typically the client_id or api:// URI of the app registration
  token_audience TEXT NOT NULL,

  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce only one Azure AD configuration row
CREATE UNIQUE INDEX idx_one_azure_ad_config ON azure_ad_config ((TRUE));

-- Enforce: azure_ad_config must only exist when auth_mode = 'azure_ad'
CREATE OR REPLACE FUNCTION check_azure_ad_config_auth_mode()
RETURNS TRIGGER AS $$
DECLARE
  current_auth_mode TEXT;
BEGIN
  SELECT auth_mode INTO current_auth_mode FROM system_config LIMIT 1;
  IF current_auth_mode IS NULL OR current_auth_mode != 'azure_ad' THEN
    RAISE EXCEPTION 'Azure AD configuration can only be set when auth_mode is azure_ad';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_azure_ad_config_auth_mode
  BEFORE INSERT OR UPDATE ON azure_ad_config
  FOR EACH ROW EXECUTE FUNCTION check_azure_ad_config_auth_mode();

-- ─────────────────────────────────────────
-- USER SESSIONS
-- Short-lived MMS session tokens issued after
-- successful authentication (either auth mode)
-- For azure_ad: issued after AD JWT validation
-- For internal: issued after email/password verification
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Opaque session token stored as a secure hash
  token_hash    TEXT UNIQUE NOT NULL,

  -- Azure AD only: the AD token jti claim that created this session
  -- Used to detect token replay
  ad_token_jti  TEXT UNIQUE,

  ip_address    INET,
  user_agent    TEXT,

  issued_at     TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ             -- set on logout or forced revocation
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions (expires_at);

-- ─────────────────────────────────────────
-- FAILED LOGIN ATTEMPTS
-- Internal auth only — tracks consecutive failures
-- per user for account lockout enforcement
-- The API checks this table before allowing login
-- and clears it on successful authentication
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address   INET,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_logins_user_id
  ON failed_login_attempts (user_id, attempted_at DESC);

-- ─────────────────────────────────────────
-- PASSWORD RESET TOKENS
-- Internal auth only — one-time tokens for
-- password reset flow (email link)
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT UNIQUE NOT NULL,      -- hashed one-time token sent via email
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,               -- set when the token is consumed
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_id
  ON password_reset_tokens (user_id);

-- ─────────────────────────────────────────
-- REPORTERS
-- External people who report faults to the
-- help desk (not system users)
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reporters (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name    TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  organisation TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- FAULT SYMPTOM CATEGORIES
-- Controlled vocabulary for classifying issues
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS symptom_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- MAINTENANCE ISSUES
-- Raised by the help desk, resolved by a company
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS maintenance_issues (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Help desk side
  raised_by           UUID NOT NULL REFERENCES users(id),
  reporter_id         UUID REFERENCES reporters(id),
  target_company_id   UUID NOT NULL REFERENCES companies(id),
  symptom_category_id UUID REFERENCES symptom_categories(id),
  title               TEXT NOT NULL,
  fault_description   TEXT NOT NULL,
  severity            TEXT CHECK (severity IN (
                        'low', 'medium', 'high', 'critical'
                      )) NOT NULL DEFAULT 'medium',

  -- Spatial / asset context
  asset_graph_id      TEXT,
  geom                GEOMETRY(POINT, 7856),

  -- Lifecycle
  status              TEXT CHECK (status IN (
                        'open',
                        'assigned',
                        'inspecting',
                        'follow_up_work',
                        'closed'
                      )) NOT NULL DEFAULT 'open',

  -- Timestamps for each status transition (for SLA tracking)
  assigned_at         TIMESTAMPTZ,
  inspecting_at       TIMESTAMPTZ,
  follow_up_work_at   TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce: only help_desk_agents can raise issues
CREATE OR REPLACE FUNCTION check_issue_raised_by()
RETURNS TRIGGER AS $$
DECLARE
  raiser_role TEXT;
BEGIN
  SELECT role INTO raiser_role FROM users WHERE id = NEW.raised_by;
  IF raiser_role != 'help_desk_agent' THEN
    RAISE EXCEPTION 'Only help_desk_agents can raise maintenance issues';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issue_raised_by
  BEFORE INSERT ON maintenance_issues
  FOR EACH ROW EXECUTE FUNCTION check_issue_raised_by();

-- Enforce: target_company_id must not be the help desk company
CREATE OR REPLACE FUNCTION check_issue_target_company()
RETURNS TRIGGER AS $$
DECLARE
  company_is_help_desk BOOLEAN;
BEGIN
  SELECT is_help_desk INTO company_is_help_desk
    FROM companies WHERE id = NEW.target_company_id;
  IF company_is_help_desk THEN
    RAISE EXCEPTION 'Maintenance issues cannot be targeted at the help desk company';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issue_target_company
  BEFORE INSERT OR UPDATE ON maintenance_issues
  FOR EACH ROW EXECUTE FUNCTION check_issue_target_company();

-- Auto-stamp status transition timestamps
CREATE OR REPLACE FUNCTION stamp_issue_status_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'assigned'       AND OLD.status != 'assigned'       THEN NEW.assigned_at       = NOW(); END IF;
  IF NEW.status = 'inspecting'     AND OLD.status != 'inspecting'     THEN NEW.inspecting_at     = NOW(); END IF;
  IF NEW.status = 'follow_up_work' AND OLD.status != 'follow_up_work' THEN NEW.follow_up_work_at = NOW(); END IF;
  IF NEW.status = 'closed'         AND OLD.status != 'closed'         THEN NEW.closed_at         = NOW(); END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issue_status_timestamps
  BEFORE UPDATE ON maintenance_issues
  FOR EACH ROW EXECUTE FUNCTION stamp_issue_status_timestamps();

-- ─────────────────────────────────────────
-- ISSUE ATTACHMENTS
-- Photos uploaded by help desk when raising an issue
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS issue_attachments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id    UUID NOT NULL REFERENCES maintenance_issues(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  file_url    TEXT NOT NULL,
  file_name   TEXT,
  mime_type   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- ISSUE STATUS HISTORY
-- Full audit trail visible to help desk in real time
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS issue_status_history (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id    UUID NOT NULL REFERENCES maintenance_issues(id) ON DELETE CASCADE,
  changed_by  UUID NOT NULL REFERENCES users(id),
  old_status  TEXT,
  new_status  TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-record status history on every status change
CREATE OR REPLACE FUNCTION record_issue_status_history()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO issue_status_history (issue_id, changed_by, old_status, new_status)
      VALUES (
        NEW.id,
        current_setting('app.current_user_id')::UUID,
        OLD.status,
        NEW.status
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issue_status_history
  AFTER UPDATE ON maintenance_issues
  FOR EACH ROW EXECUTE FUNCTION record_issue_status_history();

-- ─────────────────────────────────────────
-- INSPECTIONS
-- One inspection per issue, performed by a technician
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inspections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_id     UUID NOT NULL UNIQUE REFERENCES maintenance_issues(id),
  inspected_by UUID NOT NULL REFERENCES users(id),
  notes        TEXT,
  outcome      TEXT CHECK (outcome IN (
                 'resolved',
                 'follow_up'
               )),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce: inspector must be a technician belonging to the target company
CREATE OR REPLACE FUNCTION check_inspection_technician()
RETURNS TRIGGER AS $$
DECLARE
  tech_role     TEXT;
  tech_company  UUID;
  issue_company UUID;
BEGIN
  SELECT role, company_id INTO tech_role, tech_company
    FROM users WHERE id = NEW.inspected_by;

  SELECT target_company_id INTO issue_company
    FROM maintenance_issues WHERE id = NEW.issue_id;

  IF tech_role != 'technician' THEN
    RAISE EXCEPTION 'Only technicians can perform inspections';
  END IF;

  IF tech_company != issue_company THEN
    RAISE EXCEPTION 'Inspection technician must belong to the company responsible for the issue';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inspection_technician
  BEFORE INSERT ON inspections
  FOR EACH ROW EXECUTE FUNCTION check_inspection_technician();

-- ─────────────────────────────────────────
-- INSPECTION ATTACHMENTS
-- Photos taken during inspection
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inspection_attachments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  file_url      TEXT NOT NULL,
  file_name     TEXT,
  mime_type     TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- WORK ORDERS
-- Follow-up work raised after inspection or
-- generated by the preventive maintenance scheduler
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_orders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id),
  issue_id       UUID REFERENCES maintenance_issues(id),
  inspection_id  UUID REFERENCES inspections(id),
  title          TEXT NOT NULL,
  description    TEXT,
  type           TEXT CHECK (type IN (
                   'pm', 'inspection', 'corrective', 'replacement'
                 )) DEFAULT 'inspection',
  status         TEXT CHECK (status IN (
                   'open', 'assigned', 'in_progress', 'on_hold', 'completed'
                 )) DEFAULT 'open',
  priority       TEXT CHECK (priority IN (
                   'low', 'medium', 'high', 'critical'
                 )) DEFAULT 'medium',
  asset_graph_id TEXT,
  assigned_to    UUID REFERENCES users(id),
  created_by     UUID NOT NULL REFERENCES users(id),

  -- Safety Work Method document (PDF, one per work order)
  swm_document_url  TEXT,                  -- URL/path to stored PDF
  swm_document_name TEXT,                  -- original filename
  swm_uploaded_by   UUID REFERENCES users(id),
  swm_uploaded_at   TIMESTAMPTZ,

  -- Actual duration recorded on completion (minutes)
  actual_duration_minutes INT,

  -- Link to a pending asset recommendation (mobile field-submitted).
  -- Mutually exclusive with asset_graph_id — one or the other, never both.
  -- No FK constraint: asset_requests is defined later in this file.
  -- Relationship enforced at the application layer.
  asset_request_id UUID,

  -- Actual start/completion timestamps.
  -- Stamped by DB trigger on status transition, but can be overridden
  -- by the application layer (mobile client supplies device-recorded times).
  -- Trigger uses IS NULL guards so a pre-set value is never overwritten.
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_company    ON work_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned   ON work_orders (assigned_to);
CREATE INDEX IF NOT EXISTS idx_work_orders_status     ON work_orders (status);
CREATE INDEX IF NOT EXISTS idx_work_orders_asset      ON work_orders (asset_graph_id);

-- Enforce: assignee must belong to same company as work order
CREATE OR REPLACE FUNCTION check_work_order_assignment()
RETURNS TRIGGER AS $$
DECLARE
  assignee_company UUID;
BEGIN
  IF NEW.assigned_to IS NOT NULL THEN
    SELECT company_id INTO assignee_company
      FROM users WHERE id = NEW.assigned_to;
    IF assignee_company != NEW.company_id THEN
      RAISE EXCEPTION 'Work order assignee must belong to the same company as the work order';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_work_order_assignment
  BEFORE INSERT OR UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION check_work_order_assignment();

-- Auto-stamp started_at / completed_at on status transitions.
-- Both stamps use IS NULL guards so the application layer can supply
-- device-recorded times (mobile client) that the trigger will not overwrite.
CREATE OR REPLACE FUNCTION stamp_work_order_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at = NOW();
  END IF;
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = NOW();
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_work_order_timestamps
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION stamp_work_order_timestamps();

-- Auto-close issue when all linked work orders are completed
CREATE OR REPLACE FUNCTION auto_close_issue()
RETURNS TRIGGER AS $$
DECLARE
  open_count INT;
BEGIN
  IF NEW.status = 'completed' AND NEW.issue_id IS NOT NULL THEN
    SELECT COUNT(*) INTO open_count
      FROM work_orders
      WHERE issue_id = NEW.issue_id
        AND status != 'completed';

    IF open_count = 0 THEN
      UPDATE maintenance_issues
        SET status = 'closed'
        WHERE id = NEW.issue_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_close_issue
  AFTER UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION auto_close_issue();

-- ─────────────────────────────────────────
-- WORK ORDER UPDATES
-- Field updates from technicians via mobile
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_order_updates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id),
  updated_by    UUID NOT NULL REFERENCES users(id),
  status        TEXT,
  notes         TEXT,
  photo_urls    TEXT[],
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- WORK ORDER TASKS
-- Structured tasks within a work order
-- All tasks must be completed or skipped before
-- the work order can be marked as completed
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_order_tasks (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id            UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  sequence                 INT NOT NULL,            -- execution order within the WO
  title                    TEXT NOT NULL,
  description              TEXT,

  task_type                TEXT NOT NULL CHECK (task_type IN (
                             'checklist_execution',  -- execute an asset checklist
                             'inspection',           -- perform a physical inspection
                             'general',              -- general task / instruction
                             'safety_check',         -- safety verification step
                             'reading'               -- record a meter or gauge reading
                           )),

  status                   TEXT NOT NULL CHECK (status IN (
                             'pending',
                             'in_progress',
                             'completed',
                             'skipped'
                           )) DEFAULT 'pending',

  -- Only populated when task_type = 'checklist_execution'
  -- Points to the asset checklist to execute
  asset_checklist_id       UUID,                    -- FK added after asset_checklists is created

  estimated_duration_minutes INT,
  actual_duration_minutes    INT,

  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_tasks_work_order ON work_order_tasks (work_order_id, sequence);
CREATE INDEX IF NOT EXISTS idx_wo_tasks_status     ON work_order_tasks (status);

-- Auto-stamp task timestamps on status transitions
CREATE OR REPLACE FUNCTION stamp_task_timestamps()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'in_progress' AND OLD.status != 'in_progress' AND NEW.started_at IS NULL THEN
    NEW.started_at = NOW();
  END IF;
  IF NEW.status IN ('completed', 'skipped') AND OLD.status NOT IN ('completed', 'skipped') THEN
    NEW.completed_at = NOW();
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stamp_task_timestamps
  BEFORE UPDATE ON work_order_tasks
  FOR EACH ROW EXECUTE FUNCTION stamp_task_timestamps();

-- Note: work orders can be completed regardless of task state.
-- Tasks serve as guidance for field technicians but do not gate WO closure.
-- The INCOMPLETE_CHECKLIST check on individual checklist tasks still applies
-- (a checklist_execution task cannot be marked completed with unanswered
-- required items) — but that is task-level, not WO-level enforcement.

-- ─────────────────────────────────────────
-- ASSET LOCATIONS
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_locations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id),
  asset_graph_id TEXT NOT NULL,
  name           TEXT NOT NULL,
  geom           GEOMETRY(POINT, 7856),
  floor_level    INT,
  floor_geom     GEOMETRY(POLYGON, 7856),
  address        TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_locations_geom
  ON asset_locations USING GIST(geom);

-- ─────────────────────────────────────────
-- SPATIAL ZONES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spatial_zones (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  zone_type   TEXT CHECK (zone_type IN ('site','building','floor','room','zone')),
  geom        GEOMETRY(POLYGON, 7856),
  floor_level INT,
  parent_id   UUID REFERENCES spatial_zones(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spatial_zones_geom
  ON spatial_zones USING GIST(geom);

-- ─────────────────────────────────────────
-- SPACE TYPES
-- Lookup table for room/space classifications
-- Seeded with defaults, admin can add more
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS space_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- BUSINESS UNITS
-- Organisational units that own or occupy spaces
-- Scoped to a company
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_units (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name       TEXT NOT NULL,
  code       TEXT,                          -- short code e.g. 'FIN', 'OPS'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, name)
);

-- ─────────────────────────────────────────
-- ROOMS
-- Physical spaces within a spatial zone (building/floor)
-- Each room has a mandatory polygon geometry for spatial searching
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rooms (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES companies(id),

  -- Location in spatial hierarchy
  spatial_zone_id  UUID NOT NULL REFERENCES spatial_zones(id),

  -- Space classification
  space_type_id    UUID NOT NULL REFERENCES space_types(id),

  -- Identity
  name             TEXT NOT NULL,           -- e.g. 'Board Room', 'Reception'
  room_number      TEXT,                    -- e.g. '2.14', 'B-04'

  -- Space management
  business_unit_id UUID REFERENCES business_units(id),
  manager_id       UUID REFERENCES users(id),

  -- Geometry — mandatory polygon in GDA2020
  geom             GEOMETRY(POLYGON, 7856) NOT NULL,

  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_geom
  ON rooms USING GIST(geom);

CREATE INDEX IF NOT EXISTS idx_rooms_spatial_zone
  ON rooms (spatial_zone_id);

CREATE INDEX IF NOT EXISTS idx_rooms_business_unit
  ON rooms (business_unit_id);

-- Enforce: manager must belong to the same company as the room
CREATE OR REPLACE FUNCTION check_room_manager_company()
RETURNS TRIGGER AS $$
DECLARE
  manager_company UUID;
BEGIN
  IF NEW.manager_id IS NOT NULL THEN
    SELECT company_id INTO manager_company
      FROM users WHERE id = NEW.manager_id;
    IF manager_company != NEW.company_id THEN
      RAISE EXCEPTION 'Room manager must belong to the same company as the room';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_room_manager_company
  BEFORE INSERT OR UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION check_room_manager_company();

-- Enforce: business unit must belong to the same company as the room
CREATE OR REPLACE FUNCTION check_room_business_unit_company()
RETURNS TRIGGER AS $$
DECLARE
  bu_company UUID;
BEGIN
  IF NEW.business_unit_id IS NOT NULL THEN
    SELECT company_id INTO bu_company
      FROM business_units WHERE id = NEW.business_unit_id;
    IF bu_company != NEW.company_id THEN
      RAISE EXCEPTION 'Business unit must belong to the same company as the room';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_room_business_unit_company
  BEFORE INSERT OR UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION check_room_business_unit_company();

-- Auto-stamp updated_at
CREATE OR REPLACE FUNCTION stamp_room_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_room_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION stamp_room_updated_at();

-- ─────────────────────────────────────────
-- ASSET TYPES
-- Classification of assets for template alignment
-- Scoped to a company
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,               -- e.g. 'Air Handling Unit', 'Fire Pump'
  description TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, name)
);

-- ─────────────────────────────────────────
-- ASSET TYPE CHECKLIST TEMPLATES
-- Company-managed default checklist definitions per asset type
-- Used as a starting point when creating an asset checklist
-- Multiple templates per asset type allowed
-- (e.g. 'Routine Service', 'Emergency Response')
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_type_checklist_templates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id),
  asset_type_id  UUID NOT NULL REFERENCES asset_types(id),
  name           TEXT NOT NULL,
  description    TEXT,
  is_active      BOOLEAN DEFAULT TRUE,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, asset_type_id, name)
);

CREATE INDEX IF NOT EXISTS idx_atct_company_asset_type
  ON asset_type_checklist_templates (company_id, asset_type_id);

-- Enforce: template must belong to same company as asset type
CREATE OR REPLACE FUNCTION check_atct_asset_type_company()
RETURNS TRIGGER AS $$
DECLARE
  at_company UUID;
BEGIN
  SELECT company_id INTO at_company
    FROM asset_types WHERE id = NEW.asset_type_id;
  IF at_company != NEW.company_id THEN
    RAISE EXCEPTION 'Checklist template asset type must belong to the same company';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_atct_asset_type_company
  BEFORE INSERT OR UPDATE ON asset_type_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION check_atct_asset_type_company();

-- ─────────────────────────────────────────
-- ASSET TYPE CHECKLIST TEMPLATE ITEMS
-- Default line items within an asset type template
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_type_checklist_template_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id       UUID NOT NULL REFERENCES asset_type_checklist_templates(id) ON DELETE CASCADE,
  sequence          INT NOT NULL,
  label             TEXT NOT NULL,
  description       TEXT,
  item_type         TEXT NOT NULL CHECK (item_type IN (
                      'measurement',    -- numeric value with optional unit and min/max bounds
                      'true_false',     -- yes/no or pass/fail
                      'step',           -- checkbox — step completed
                      'text',           -- free text observation
                      'photo'           -- photo capture
                    )),
  unit              TEXT,              -- e.g. '°C', 'bar', 'RPM', 'V', 'hours'
  min_value         NUMERIC,           -- lower bound for measurement validation
  max_value         NUMERIC,           -- upper bound for measurement validation
  is_required       BOOLEAN DEFAULT TRUE,
  -- Runtime trigger flag: when TRUE, recorded numeric_values on this item
  -- feed the PM runtime projection engine for the asset
  is_runtime_trigger BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atcti_template
  ON asset_type_checklist_template_items (template_id, sequence);

-- Enforce: only one runtime trigger item per template
CREATE UNIQUE INDEX idx_atcti_one_runtime_trigger
  ON asset_type_checklist_template_items (template_id)
  WHERE is_runtime_trigger = TRUE;

-- ─────────────────────────────────────────
-- ASSET CHECKLISTS
-- Checklists owned by a specific asset (graph node)
-- Multiple checklists per asset allowed
-- Can be created from a template, from scratch, or via CSV import
-- Fully independent of the template after creation —
-- template changes do not affect existing asset checklists
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_checklists (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES companies(id),
  asset_graph_id       TEXT NOT NULL,             -- AGE graph node id
  asset_type_id        UUID NOT NULL REFERENCES asset_types(id),
  name                 TEXT NOT NULL,
  description          TEXT,
  is_active            BOOLEAN DEFAULT TRUE,
  -- nullable: NULL when created from scratch or CSV without a template source
  source_template_id   UUID REFERENCES asset_type_checklist_templates(id),
  created_by           UUID NOT NULL REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_checklists_asset
  ON asset_checklists (company_id, asset_graph_id);

CREATE INDEX IF NOT EXISTS idx_asset_checklists_asset_type
  ON asset_checklists (asset_type_id);

-- ─────────────────────────────────────────
-- ASSET CHECKLIST ITEMS
-- The actual line items on a specific asset's checklist
-- Fully customisable — independent of any template after creation
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_checklist_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id      UUID NOT NULL REFERENCES asset_checklists(id) ON DELETE CASCADE,
  sequence          INT NOT NULL,
  label             TEXT NOT NULL,
  description       TEXT,
  item_type         TEXT NOT NULL CHECK (item_type IN (
                      'measurement',
                      'true_false',
                      'step',
                      'text',
                      'photo'
                    )),
  unit              TEXT,
  min_value         NUMERIC,
  max_value         NUMERIC,
  is_required       BOOLEAN DEFAULT TRUE,
  -- When TRUE, recorded numeric_values on this item feed the PM
  -- runtime projection engine. Only one per checklist enforced below.
  is_runtime_trigger BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aci_checklist
  ON asset_checklist_items (checklist_id, sequence);

-- Enforce: only one runtime trigger item per asset checklist
CREATE UNIQUE INDEX idx_aci_one_runtime_trigger
  ON asset_checklist_items (checklist_id)
  WHERE is_runtime_trigger = TRUE;

-- ─────────────────────────────────────────
-- ASSET CHECKLIST RESPONSES
-- Technician responses captured during a work order task execution
-- Tied to both the asset checklist item AND the work order task —
-- this gives full history: what was recorded, on which asset item,
-- during which task, on which work order
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_checklist_responses (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_checklist_item_id UUID NOT NULL REFERENCES asset_checklist_items(id),
  work_order_task_id    UUID NOT NULL REFERENCES work_order_tasks(id) ON DELETE CASCADE,
  responded_by          UUID NOT NULL REFERENCES users(id),

  -- Response values — only one populated depending on item_type
  numeric_value         NUMERIC,           -- for item_type = 'measurement'
  boolean_value         BOOLEAN,           -- for item_type = 'true_false' or 'step'
  text_value            TEXT,              -- for item_type = 'text'
  photo_url             TEXT,              -- for item_type = 'photo'

  -- Set by trigger: TRUE if numeric_value falls outside item min/max bounds
  is_out_of_range       BOOLEAN DEFAULT FALSE,

  notes                 TEXT,              -- optional technician note on this response
  responded_at          TIMESTAMPTZ DEFAULT NOW(),

  -- One response per item per task execution
  UNIQUE (asset_checklist_item_id, work_order_task_id)
);

CREATE INDEX IF NOT EXISTS idx_acr_task
  ON asset_checklist_responses (work_order_task_id);

CREATE INDEX IF NOT EXISTS idx_acr_item
  ON asset_checklist_responses (asset_checklist_item_id);

-- Trigger: auto-flag out-of-range measurement responses
CREATE OR REPLACE FUNCTION flag_out_of_range_response()
RETURNS TRIGGER AS $$
DECLARE
  item_min   NUMERIC;
  item_max   NUMERIC;
  item_type  TEXT;
BEGIN
  SELECT i.min_value, i.max_value, i.item_type
    INTO item_min, item_max, item_type
    FROM asset_checklist_items i
    WHERE i.id = NEW.asset_checklist_item_id;

  IF item_type = 'measurement' AND NEW.numeric_value IS NOT NULL THEN
    NEW.is_out_of_range = (
      (item_min IS NOT NULL AND NEW.numeric_value < item_min) OR
      (item_max IS NOT NULL AND NEW.numeric_value > item_max)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_flag_out_of_range
  BEFORE INSERT OR UPDATE ON asset_checklist_responses
  FOR EACH ROW EXECUTE FUNCTION flag_out_of_range_response();

-- ─────────────────────────────────────────
-- ADD FK: work_order_tasks.asset_checklist_id
-- Deferred until after asset_checklists is created
-- ─────────────────────────────────────────

ALTER TABLE work_order_tasks
  ADD CONSTRAINT fk_task_asset_checklist
  FOREIGN KEY (asset_checklist_id) REFERENCES asset_checklists(id);

-- ─────────────────────────────────────────
-- PARTS INVENTORY
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  name              TEXT NOT NULL,
  part_number       TEXT,
  quantity_in_stock INT DEFAULT 0,
  unit_cost         NUMERIC(10,2),
  location          TEXT,
  UNIQUE (company_id, part_number)
);

-- ─────────────────────────────────────────
-- PM TRIGGER TYPES
-- Lookup table for schedule trigger categories
-- Seeded at install time — never changes at runtime
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pm_trigger_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        TEXT UNIQUE NOT NULL,   -- e.g. 'calendar_monthly'
  label       TEXT NOT NULL,          -- e.g. 'Monthly'
  category    TEXT NOT NULL CHECK (category IN ('calendar', 'runtime')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PM SCHEDULES
-- Preventive maintenance schedules for specific assets
-- One trigger type per schedule
-- Calendar triggers generate WOs automatically via cron
-- Runtime trigger fields are informational only —
-- used by the web client to surface alerts to maintenance staff
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pm_schedules (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                 UUID NOT NULL REFERENCES companies(id),

  -- Target asset (specific graph node)
  asset_graph_id             TEXT NOT NULL,
  asset_type_id              UUID NOT NULL REFERENCES asset_types(id),

  -- Schedule identity
  name                       TEXT NOT NULL,
  work_type                  TEXT NOT NULL CHECK (work_type IN (
                               'Inspection', 'Service', 'Overhaul',
                               'Clean', 'Deep Clean', 'Replace'
                             )),

  -- Trigger
  trigger_type_id            UUID NOT NULL REFERENCES pm_trigger_types(id),

  -- Calendar fields (used when trigger category = 'calendar')
  -- e.g. interval_value=3 with calendar_monthly = every 3 months
  interval_value             INT CHECK (interval_value > 0),

  -- Runtime fields (informational only — web client alert)
  runtime_threshold          NUMERIC,
  runtime_checklist_item_id  UUID REFERENCES asset_checklist_items(id),

  -- Schedule bounds
  starts_on                  DATE NOT NULL,
  ends_on                    DATE,

  -- Rolling window tracking
  last_generated_date        DATE,

  is_active                  BOOLEAN DEFAULT TRUE,
  created_by                 UUID NOT NULL REFERENCES users(id),
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_schedules_company
  ON pm_schedules (company_id);

CREATE INDEX IF NOT EXISTS idx_pm_schedules_asset
  ON pm_schedules (asset_graph_id);

CREATE INDEX IF NOT EXISTS idx_pm_schedules_active
  ON pm_schedules (is_active, last_generated_date)
  WHERE is_active = TRUE;

-- Enforce: calendar schedules must have interval_value
-- Enforce: runtime schedules must have runtime_threshold
CREATE OR REPLACE FUNCTION check_pm_schedule_trigger_fields()
RETURNS TRIGGER AS $$
DECLARE
  trigger_category TEXT;
BEGIN
  SELECT category INTO trigger_category
    FROM pm_trigger_types WHERE id = NEW.trigger_type_id;

  IF trigger_category = 'calendar' AND NEW.interval_value IS NULL THEN
    RAISE EXCEPTION 'Calendar schedules must have an interval_value';
  END IF;

  IF trigger_category = 'runtime' AND NEW.runtime_threshold IS NULL THEN
    RAISE EXCEPTION 'Runtime schedules must have a runtime_threshold';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pm_schedule_trigger_fields
  BEFORE INSERT OR UPDATE ON pm_schedules
  FOR EACH ROW EXECUTE FUNCTION check_pm_schedule_trigger_fields();

CREATE OR REPLACE FUNCTION stamp_pm_schedule_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pm_schedule_updated_at
  BEFORE UPDATE ON pm_schedules
  FOR EACH ROW EXECUTE FUNCTION stamp_pm_schedule_updated_at();

-- ─────────────────────────────────────────
-- PM GENERATED WORK ORDERS
-- Junction table tracking which WOs have been
-- generated for which schedule on which due date
-- UNIQUE (schedule_id, due_date) prevents duplicates
-- even if the cron runs multiple times
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pm_generated_work_orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id   UUID NOT NULL REFERENCES pm_schedules(id) ON DELETE CASCADE,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  due_date      DATE NOT NULL,
  generated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (schedule_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_pm_generated_schedule
  ON pm_generated_work_orders (schedule_id, due_date);

-- ─────────────────────────────────────────
-- WORK ORDER PHOTOS
-- Photos attached to a work order at any stage.
-- Uploaded from the field via mobile app (multipart POST).
-- Files stored on local filesystem under uploads/work-orders/<wo_id>/
-- server_url is the full URL served by Express static middleware.
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS work_order_photos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id     UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  uploaded_by       UUID NOT NULL REFERENCES users(id),
  server_url        TEXT NOT NULL,
  original_filename TEXT,
  mime_type         TEXT,
  size_bytes        INTEGER,
  captured_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_photos_work_order
  ON work_order_photos (work_order_id, captured_at);

-- ─────────────────────────────────────────
-- ASSET REQUESTS
-- New asset recommendations submitted from the field via mobile app.
-- Not a real asset record — a notification to admin to add the asset.
-- Once resolved, resolved_asset_graph_id is set to the new AGE node id
-- and any work orders referencing asset_request_id are patched.
--
-- Asset type: exactly one of (asset_type_id, asset_type_recommendation) set.
-- Location:   exactly one of (suggested_location, location_recommendation) set,
--             or both NULL if the tech skipped location.
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_requests (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id                UUID NOT NULL REFERENCES companies(id),
  requested_by              UUID NOT NULL REFERENCES users(id),
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Asset identity
  name                      TEXT NOT NULL,
  description               TEXT,

  -- Asset type — exactly one populated
  asset_type_id             UUID REFERENCES asset_types(id),
  asset_type_name           TEXT,              -- denormalised display name
  asset_type_recommendation TEXT,             -- free text when "Other" chosen

  -- Location — exactly one populated (or both NULL if skipped)
  suggested_location        TEXT,             -- breadcrumb: Building › Floor › Space
  location_recommendation   TEXT,             -- free text when "Other" chosen

  -- Lifecycle
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  notes           TEXT,
  resolved_asset_graph_id TEXT,              -- set when admin approves and creates the asset
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id),

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_requests_company
  ON asset_requests (company_id, status);

CREATE OR REPLACE FUNCTION stamp_asset_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_request_updated_at
  BEFORE UPDATE ON asset_requests
  FOR EACH ROW EXECUTE FUNCTION stamp_asset_request_updated_at();

-- ─────────────────────────────────────────
-- SEED DATA
-- ─────────────────────────────────────────

-- PM trigger types seed data
INSERT INTO pm_trigger_types (code, label, category) VALUES
  ('calendar_daily',   'Daily',          'calendar'),
  ('calendar_weekly',  'Weekly',         'calendar'),
  ('calendar_monthly', 'Monthly',        'calendar'),
  ('calendar_yearly',  'Yearly',         'calendar'),
  ('runtime_hours',    'Runtime Hours',  'runtime'),
  ('runtime_kms',      'Runtime KMs',   'runtime'),
  ('runtime_cycles',   'Runtime Cycles', 'runtime')
ON CONFLICT (code) DO NOTHING;

INSERT INTO symptom_categories (name, description) VALUES
  ('Electrical',  'Issues related to electrical systems and components'),
  ('Plumbing',    'Water, drainage and pipe-related faults'),
  ('HVAC',        'Heating, ventilation and air conditioning faults'),
  ('Structural',  'Building fabric, walls, floors, roofing'),
  ('Mechanical',  'Rotating equipment, motors, pumps, conveyors'),
  ('Fire Safety', 'Fire detection, suppression and evacuation systems'),
  ('Security',    'Access control, CCTV and alarm systems'),
  ('Cleaning',    'Cleaning and housekeeping related issues'),
  ('Other',       'Faults not covered by other categories');

-- Space types seed data
INSERT INTO space_types (name, description) VALUES
  ('Office',            'General office and workstation space'),
  ('Meeting Room',      'Bookable meeting and conference rooms'),
  ('Board Room',        'Executive board and formal meeting rooms'),
  ('Theatre',           'Lecture theatres and presentation spaces'),
  ('Classroom',         'Teaching and training rooms'),
  ('Laboratory',        'Scientific, research and testing spaces'),
  ('Workshop',          'Trade, maintenance and fabrication spaces'),
  ('Corridor',          'Hallways, passages and circulation spaces'),
  ('Lobby / Reception', 'Entrance foyers and reception areas'),
  ('Bathroom',          'Toilets, showers and amenity rooms'),
  ('Kitchen / Breakout','Staff kitchens, lunch rooms and breakout areas'),
  ('Storage',           'Store rooms, archives and bulk storage'),
  ('Plant Room',        'Mechanical, electrical and building services rooms'),
  ('Server Room',       'IT infrastructure and data centre spaces'),
  ('Car Park',          'Internal and external parking areas'),
  ('Outdoor Area',      'External courtyards, terraces and grounds'),
  ('Other',             'Spaces not covered by other categories');

-- ─────────────────────────────────────────
-- SYSTEM CONFIGURATION
-- ─────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO system_config (
  auth_mode,
  password_min_length,
  password_require_upper,
  password_require_number,
  password_require_special,
  password_expiry_days,
  max_failed_login_attempts,
  session_timeout_minutes,
  installed_by
) VALUES (
  'internal',
  12,
  TRUE,
  TRUE,
  TRUE,
  NULL,
  5,
  1440,
  'system'
)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────
-- INITIAL HELP DESK ADMIN USER
-- Default password: Admin@123456
-- must_change_password = TRUE forces a password
-- change on first login
-- ─────────────────────────────────────────

INSERT INTO users (
  company_id,
  email,
  full_name,
  role,
  password_hash,
  password_changed_at,
  must_change_password,
  is_active
) VALUES (
  (SELECT id FROM companies WHERE is_help_desk = TRUE),
  'admin@mms.local',
  'System Administrator',
  'help_desk_agent',
  crypt('Admin@123456', gen_salt('bf', 12)),
  NOW(),
  FALSE,
  TRUE
)
ON CONFLICT (email) DO NOTHING;

-- ─────────────────────────────────────────
-- GRANT PERMISSIONS TO mms_admin
-- Tables are created by postgres superuser via db-init
-- mms_admin needs full access to all public schema objects
-- ─────────────────────────────────────────

GRANT USAGE ON SCHEMA public TO mms_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mms_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mms_admin;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO mms_admin;

-- Ensure future tables are also accessible
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO mms_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO mms_admin;
