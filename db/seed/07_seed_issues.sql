-- =============================================================================
-- 07_seed_issues.sql
-- Seed data for maintenance issues, reporters, inspections
-- Provides realistic varied data for web app development
--
-- Run after: 06_seed_work_orders.sql
-- Requires: companies, users, symptom_categories, asset graph seeded
--
-- Produces:
--   4 reporters
--   6 maintenance issues across all three companies in varied statuses
--   1 inspection record (on the follow_up_work issue)
--   1 WO linked to the follow_up_work issue
-- =============================================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

-- Capture asset graph IDs by code for asset-specific issues
CREATE TEMP TABLE _issue_nodes AS
SELECT
  trim(both '"' from code::text) AS code,
  trim(both '"' from id::text)   AS graph_id
FROM cypher('asset_graph', $$
  MATCH (n:Asset)
  RETURN n.code, id(n)
$$) AS (code agtype, id agtype);

DO $$
DECLARE
  -- Companies
  co_elec UUID; co_hvac UUID; co_vt UUID;

  -- Help desk agent (raises all issues)
  u_hd UUID;

  -- Company technicians (for inspections)
  u_elec_tech UUID; u_hvac_tech UUID; u_vt_tech UUID;

  -- Company managers (for linking work orders)
  u_hvac_mgr UUID;

  -- Symptom categories
  sc_electrical UUID; sc_hvac UUID; sc_mechanical UUID; sc_structural UUID;

  -- Reporter IDs
  rep_facilities UUID; rep_tenant_a UUID; rep_tenant_b UUID; rep_anon UUID;

  -- Issue IDs (needed for status transitions and linking)
  iss_open          UUID;
  iss_assigned      UUID;
  iss_inspecting    UUID;
  iss_follow_up     UUID;
  iss_closed        UUID;
  iss_vague         UUID;

  -- Graph node IDs
  gid_msb01   TEXT;
  gid_chwp_a1 TEXT;
  gid_lift_01 TEXT;

  -- Linked WO
  wo_follow_up UUID;

BEGIN
  -- ── Lookups ────────────────────────────────────────────────────────────────

  SELECT id INTO co_elec FROM companies WHERE name = 'Acme Electrical Services';
  SELECT id INTO co_hvac FROM companies WHERE name = 'Acme HVAC Services';
  SELECT id INTO co_vt   FROM companies WHERE name = 'Acme Vertical Transport';

  SELECT id INTO u_hd       FROM users WHERE email = 'admin@mms.local';
  SELECT id INTO u_elec_tech FROM users WHERE email = 'tech1@acme-electrical.com.au';
  SELECT id INTO u_hvac_tech FROM users WHERE email = 'tech1@acme-hvac.com.au';
  SELECT id INTO u_vt_tech   FROM users WHERE email = 'tech1@acme-vt.com.au';
  SELECT id INTO u_hvac_mgr  FROM users WHERE email = 'manager@acme-hvac.com.au';

  SELECT id INTO sc_electrical FROM symptom_categories WHERE name = 'Electrical';
  SELECT id INTO sc_hvac        FROM symptom_categories WHERE name = 'HVAC';
  SELECT id INTO sc_mechanical  FROM symptom_categories WHERE name = 'Mechanical';
  SELECT id INTO sc_structural  FROM symptom_categories WHERE name = 'Structural';

  SELECT graph_id INTO gid_msb01   FROM _issue_nodes WHERE code = 'MSB-01';
  SELECT graph_id INTO gid_chwp_a1 FROM _issue_nodes WHERE code = 'CHWP-A1';
  SELECT graph_id INTO gid_lift_01 FROM _issue_nodes WHERE code = 'LIFT-01';

  -- ── Reporters ──────────────────────────────────────────────────────────────

  INSERT INTO reporters (full_name, email, phone, organisation)
    VALUES ('Helen Marsh', 'h.marsh@tenantco.com.au', '0412 345 678', 'TenantCo Pty Ltd')
    RETURNING id INTO rep_facilities;

  INSERT INTO reporters (full_name, email, phone, organisation)
    VALUES ('Daniel Chow', 'd.chow@acmecorp.com.au', '0423 456 789', 'Acme Corporate')
    RETURNING id INTO rep_tenant_a;

  INSERT INTO reporters (full_name, email, phone, organisation)
    VALUES ('Sandra Obi', 's.obi@buildingops.com.au', NULL, 'Building Operations')
    RETURNING id INTO rep_tenant_b;

  INSERT INTO reporters (full_name, email, phone, organisation)
    VALUES ('Anonymous Caller', NULL, '1800 123 456', NULL)
    RETURNING id INTO rep_anon;

  -- ── Issue 1: OPEN — electrical fault, specific asset ──────────────────────
  -- A freshly raised issue, not yet assigned to a company

  INSERT INTO maintenance_issues
    (raised_by, reporter_id, target_company_id, symptom_category_id,
     title, fault_description, severity, asset_graph_id, status)
  VALUES
    (u_hd, rep_tenant_a, co_elec, sc_electrical,
     'Intermittent tripping on MSB-01 incomer breaker',
     'The 3200A incomer breaker on the main switchboard (MSB-01) has tripped twice '
     'in the past week under normal load conditions. No clear fault pattern identified. '
     'Last occurrence was Tuesday at 14:32. Building operations have manually reset each time.',
     'high', gid_msb01, 'open')
  RETURNING id INTO iss_open;

  -- ── Issue 2: ASSIGNED — HVAC fault, specific asset ────────────────────────
  -- Assigned to HVAC company; no inspection yet

  INSERT INTO maintenance_issues
    (raised_by, reporter_id, target_company_id, symptom_category_id,
     title, fault_description, severity, asset_graph_id, status,
     created_at)
  VALUES
    (u_hd, rep_facilities, co_hvac, sc_hvac,
     'CHWP-A1 bearing noise and elevated temperature',
     'Chilled water pump CHWP-A1 presenting audible bearing noise (grinding) and '
     'bearing temperature reading approximately 15°C above normal operating range. '
     'Vibration has increased noticeably over the past two weeks. Risk of unplanned '
     'failure if not addressed. CHWP-A2 standby is available.',
     'high', gid_chwp_a1, 'assigned',
     NOW() - INTERVAL '3 days')
  RETURNING id INTO iss_assigned;

  -- Stamp assigned_at correctly via direct update
  -- (trigger stamps it when status changes, but we're inserting directly)
  UPDATE maintenance_issues
    SET assigned_at = created_at + INTERVAL '2 hours'
    WHERE id = iss_assigned;

  -- ── Issue 3: INSPECTING — structural, no specific asset ───────────────────
  -- Vague location fault; company technician is currently on site

  INSERT INTO maintenance_issues
    (raised_by, reporter_id, target_company_id, symptom_category_id,
     title, fault_description, severity, asset_graph_id, status,
     created_at)
  VALUES
    (u_hd, rep_tenant_b, co_elec, sc_structural,
     'Water ingress — Level 3 east corridor ceiling',
     'Reported water staining and minor active drip from ceiling tiles in the Level 3 '
     'east corridor near the fire hose reel. Facilities have placed a bucket. Suspected '
     'roof penetration or pipe leak above the ceiling void. Source not confirmed.',
     'medium', NULL, 'inspecting',
     NOW() - INTERVAL '5 days')
  RETURNING id INTO iss_inspecting;

  UPDATE maintenance_issues
    SET assigned_at    = created_at + INTERVAL '4 hours',
        inspecting_at  = created_at + INTERVAL '1 day'
    WHERE id = iss_inspecting;

  -- ── Issue 4: FOLLOW_UP_WORK — lift fault with linked WO ───────────────────
  -- Inspection completed, follow-up work order raised

  INSERT INTO maintenance_issues
    (raised_by, reporter_id, target_company_id, symptom_category_id,
     title, fault_description, severity, asset_graph_id, status,
     created_at)
  VALUES
    (u_hd, rep_anon, co_vt, sc_mechanical,
     'Lift 01 — door re-open fault, intermittent',
     'LIFT-01 door re-open sensor triggering intermittently on Level 2 — doors open '
     'and close multiple times before travel. Issue observed by multiple tenants. '
     'Lift remains operational but tenant complaints increasing.',
     'medium', gid_lift_01, 'follow_up_work',
     NOW() - INTERVAL '8 days')
  RETURNING id INTO iss_follow_up;

  UPDATE maintenance_issues
    SET assigned_at       = created_at + INTERVAL '2 hours',
        inspecting_at     = created_at + INTERVAL '1 day',
        follow_up_work_at = created_at + INTERVAL '3 days'
    WHERE id = iss_follow_up;

  -- Inspection record for this issue
  INSERT INTO inspections (issue_id, inspected_by, notes, outcome, created_at)
  VALUES
    (iss_follow_up, u_vt_tech,
     'Door re-open sensor on Level 2 landing found to be misaligned — partially obstructed '
     'by a displaced door frame rubber seal. Sensor cleaned and temporarily adjusted. '
     'Door frame seal requires replacement to fully resolve. Part not on van.',
     'follow_up',
     NOW() - INTERVAL '5 days');

  -- Linked follow-up work order
  INSERT INTO work_orders
    (company_id, issue_id, asset_graph_id, title, description,
     type, status, priority, created_by, assigned_to, created_at)
  VALUES
    (co_vt, iss_follow_up, gid_lift_01,
     'Lift 01 — Replace Level 2 door frame rubber seal',
     'Replace the Level 2 landing door frame rubber seal on LIFT-01. '
     'The displaced seal is causing intermittent door re-open sensor faults. '
     'Parts to be sourced from supplier — ETA 3 business days.',
     'corrective', 'assigned', 'medium',
     u_hvac_mgr, u_vt_tech,
     NOW() - INTERVAL '4 days')
  RETURNING id INTO wo_follow_up;

  -- ── Issue 5: CLOSED — resolved HVAC fault ─────────────────────────────────

  INSERT INTO maintenance_issues
    (raised_by, reporter_id, target_company_id, symptom_category_id,
     title, fault_description, severity, asset_graph_id, status,
     created_at)
  VALUES
    (u_hd, rep_facilities, co_hvac, sc_hvac,
     'AHU-02 supply air temperature high — Level 2 cooling failure',
     'Level 2 office occupants reporting insufficient cooling. BMS trending showing '
     'AHU-02 supply air temperature 4°C above setpoint. Chilled water valve position '
     'showing 100% but supply temperature not responding.',
     'critical', NULL, 'closed',
     NOW() - INTERVAL '14 days')
  RETURNING id INTO iss_closed;

  UPDATE maintenance_issues
    SET assigned_at       = created_at + INTERVAL '1 hour',
        inspecting_at     = created_at + INTERVAL '3 hours',
        follow_up_work_at = created_at + INTERVAL '6 hours',
        closed_at         = created_at + INTERVAL '2 days'
    WHERE id = iss_closed;

  -- ── Issue 6: OPEN — vague, no asset, no reporter ──────────────────────────
  -- Tests the null asset_graph_id path in the API

  INSERT INTO maintenance_issues
    (raised_by, reporter_id, target_company_id, symptom_category_id,
     title, fault_description, severity, asset_graph_id, status,
     created_at)
  VALUES
    (u_hd, NULL, co_elec, sc_electrical,
     'Flickering lights reported — basement carpark area',
     'Anonymous complaint via building management system. Intermittent light flickering '
     'in basement carpark area. Exact location not specified. May relate to distribution '
     'board or individual fitting fault. Requires site attendance to identify.',
     'low', NULL, 'open',
     NOW() - INTERVAL '1 day')
  RETURNING id INTO iss_vague;

END;
$$;

-- Verify
DO $$
DECLARE
  issue_count    INT;
  reporter_count INT;
  insp_count     INT;
BEGIN
  SELECT COUNT(*) INTO issue_count    FROM maintenance_issues;
  SELECT COUNT(*) INTO reporter_count FROM reporters;
  SELECT COUNT(*) INTO insp_count     FROM inspections;

  RAISE NOTICE '07_seed_issues: % issues, % reporters, % inspections seeded',
    issue_count, reporter_count, insp_count;

  IF issue_count < 6 THEN
    RAISE EXCEPTION '07_seed_issues: expected at least 6 issues, got %', issue_count;
  END IF;
END;
$$;
