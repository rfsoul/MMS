-- ============================================================
-- 08_seed_lisa_workorders.sql
-- Open work orders assigned to Lisa Park (tech1@acme-hvac.com.au)
-- for mobile app testing.
--
-- Statuses:
--   WO-1  CH-A2   assigned     — not yet started (appears in queue)
--   WO-2  AHU-03  in_progress  — already started (appears as active)
--   WO-3  CHWP-B1 assigned     — corrective, no checklist (general tasks)
--   WO-4  BLR-A1  assigned     — inspection with checklist task pending
--
-- Run after 04b_seed_checklists_hvac.sql
-- ============================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

-- Resolve graph node IDs outside the DO block (AGE cypher() cannot run
-- inside PL/pgSQL DO $$ blocks due to dollar-quote delimiter collision)
DROP TABLE IF EXISTS _lisa_nodes;
CREATE TEMP TABLE _lisa_nodes AS
SELECT trim(both '"' from code::text) AS code,
       trim(both '"' from id::text)   AS graph_id
FROM cypher('asset_graph', $$
  MATCH (n:Asset) WHERE n.code IN ['CH-A2', 'AHU-03', 'CHWP-B1', 'BLR-A1']
  RETURN n.code, id(n)
$$) AS (code agtype, id agtype);

DO $$
DECLARE
  co_hvac   UUID;
  u_hmgr    UUID;
  u_htech1  UUID;

  gn_ch_a2   TEXT;
  gn_ahu_3   TEXT;
  gn_chwp_b1 TEXT;
  gn_blr_a1  TEXT;

  cl_ch_a2   UUID;
  cl_ahu_3   UUID;
  cl_blr_a1  UUID;

  wo_id   UUID;
  task_id UUID;
BEGIN

  SELECT id INTO co_hvac   FROM companies WHERE name = 'Acme HVAC Services';
  SELECT id INTO u_hmgr    FROM users     WHERE email = 'manager@acme-hvac.com.au';
  SELECT id INTO u_htech1  FROM users     WHERE email = 'tech1@acme-hvac.com.au';

  IF co_hvac  IS NULL THEN RAISE EXCEPTION '08: Acme HVAC Services not found — run 02_seed first'; END IF;
  IF u_htech1 IS NULL THEN RAISE EXCEPTION '08: Lisa Park not found — run 02_seed first'; END IF;

  SELECT MAX(CASE WHEN code = 'CH-A2'   THEN graph_id END),
         MAX(CASE WHEN code = 'AHU-03'  THEN graph_id END),
         MAX(CASE WHEN code = 'CHWP-B1' THEN graph_id END),
         MAX(CASE WHEN code = 'BLR-A1'  THEN graph_id END)
    INTO gn_ch_a2, gn_ahu_3, gn_chwp_b1, gn_blr_a1
    FROM _lisa_nodes;

  IF gn_ch_a2   IS NULL THEN RAISE EXCEPTION '08: CH-A2 not found in graph — run 03_seed first'; END IF;
  IF gn_ahu_3   IS NULL THEN RAISE EXCEPTION '08: AHU-03 not found in graph — run 03_seed first'; END IF;
  IF gn_chwp_b1 IS NULL THEN RAISE EXCEPTION '08: CHWP-B1 not found in graph — run 03_seed first'; END IF;
  IF gn_blr_a1  IS NULL THEN RAISE EXCEPTION '08: BLR-A1 not found in graph — run 03_seed first'; END IF;

  SELECT id INTO cl_ch_a2  FROM asset_checklists WHERE asset_graph_id = gn_ch_a2  AND company_id = co_hvac LIMIT 1;
  SELECT id INTO cl_ahu_3  FROM asset_checklists WHERE asset_graph_id = gn_ahu_3  AND company_id = co_hvac LIMIT 1;
  SELECT id INTO cl_blr_a1 FROM asset_checklists WHERE asset_graph_id = gn_blr_a1 AND company_id = co_hvac LIMIT 1;

  IF cl_ch_a2  IS NULL THEN RAISE EXCEPTION '08: No checklist for CH-A2 — run 04b_seed first'; END IF;
  IF cl_ahu_3  IS NULL THEN RAISE EXCEPTION '08: No checklist for AHU-03 — run 04b_seed first'; END IF;
  IF cl_blr_a1 IS NULL THEN RAISE EXCEPTION '08: No checklist for BLR-A1 — run 04b_seed first'; END IF;

  -- WO-1: CH-A2 Monthly Inspection — assigned, not yet started
  INSERT INTO work_orders (
    company_id, asset_graph_id, title, description,
    type, status, priority, created_by, assigned_to,
    created_at, updated_at
  ) VALUES (
    co_hvac, gn_ch_a2,
    'CH-A2 Monthly Inspection — Jan 2025',
    'Monthly inspection of chiller circuit A standby unit. Check refrigerant pressures, compressor oil, electrical connections and control panel.',
    'inspection', 'assigned', 'high',
    u_hmgr, u_htech1,
    '2025-01-06 07:00:00', '2025-01-06 07:00:00'
  ) RETURNING id INTO wo_id;

  INSERT INTO work_order_tasks (
    work_order_id, sequence, title, task_type, asset_checklist_id,
    status, created_at, updated_at
  ) VALUES (
    wo_id, 1, 'CH-A2 Monthly Inspection Checklist',
    'checklist_execution', cl_ch_a2,
    'pending', '2025-01-06 07:00:00', '2025-01-06 07:00:00'
  );

  -- WO-2: AHU-03 Filter Service — in_progress, checklist task active
  INSERT INTO work_orders (
    company_id, asset_graph_id, title, description,
    type, status, priority, created_by, assigned_to, started_at,
    created_at, updated_at
  ) VALUES (
    co_hvac, gn_ahu_3,
    'AHU-03 Filter Service & Inspection — Jan 2025',
    'Replace G4 pre-filters and F7 bag filters. Inspect fan belts, bearings, coil fins and condensate drain. Log all readings.',
    'pm', 'in_progress', 'medium',
    u_hmgr, u_htech1, '2025-01-08 08:15:00',
    '2025-01-07 07:00:00', '2025-01-08 08:15:00'
  ) RETURNING id INTO wo_id;

  INSERT INTO work_order_tasks (
    work_order_id, sequence, title, task_type, asset_checklist_id,
    status, created_at, updated_at
  ) VALUES (
    wo_id, 1, 'AHU-03 Inspection Checklist',
    'checklist_execution', cl_ahu_3,
    'in_progress', '2025-01-07 07:00:00', '2025-01-08 08:15:00'
  );

  INSERT INTO work_order_tasks (
    work_order_id, sequence, title, description, task_type,
    status, created_at, updated_at
  ) VALUES (
    wo_id, 2,
    'Replace G4 pre-filters',
    'Dispose of old filters per site waste procedure. Install new G4 panels, record filter class and batch on WO.',
    'general', 'pending', '2025-01-07 07:00:00', '2025-01-07 07:00:00'
  );

  INSERT INTO work_order_tasks (
    work_order_id, sequence, title, description, task_type,
    status, created_at, updated_at
  ) VALUES (
    wo_id, 3,
    'Replace F7 bag filters',
    'Install new F7 bag filters. Check seal integrity on all pockets before securing housing.',
    'general', 'pending', '2025-01-07 07:00:00', '2025-01-07 07:00:00'
  );

  -- WO-3: CHWP-B1 Corrective — assigned, no checklist (general tasks only)
  INSERT INTO work_orders (
    company_id, asset_graph_id, title, description,
    type, status, priority, created_by, assigned_to,
    created_at, updated_at
  ) VALUES (
    co_hvac, gn_chwp_b1,
    'CHWP-B1 Vibration Fault Investigation',
    'Abnormal vibration reported on chilled water pump B1. Investigate bearing condition, impeller and coupling alignment. Do not operate until cleared.',
    'corrective', 'assigned', 'critical',
    u_hmgr, u_htech1,
    '2025-01-08 06:30:00', '2025-01-08 06:30:00'
  ) RETURNING id INTO wo_id;

  INSERT INTO work_order_tasks (
    work_order_id, sequence, title, description, task_type,
    status, created_at, updated_at
  ) VALUES (
    wo_id, 1,
    'Inspect bearings and impeller',
    'Isolate pump. Check bearing play, inspect impeller for damage or cavitation pitting. Measure shaft runout if possible.',
    'inspection', 'pending', '2025-01-08 06:30:00', '2025-01-08 06:30:00'
  );

  INSERT INTO work_order_tasks (
    work_order_id, sequence, title, description, task_type,
    status, created_at, updated_at
  ) VALUES (
    wo_id, 2,
    'Check and record coupling alignment',
    'Measure angular and parallel misalignment at coupling. Record results and note any corrective action required.',
    'reading', 'pending', '2025-01-08 06:30:00', '2025-01-08 06:30:00'
  );

  -- WO-4: BLR-A1 Monthly Inspection — assigned, checklist task pending
  INSERT INTO work_orders (
    company_id, asset_graph_id, title, description,
    type, status, priority, created_by, assigned_to,
    created_at, updated_at
  ) VALUES (
    co_hvac, gn_blr_a1,
    'BLR-A1 Monthly Inspection — Jan 2025',
    'Monthly inspection of condensing boiler circuit A duty unit. Check flue, burner operation, water quality, safety valves and controls.',
    'inspection', 'assigned', 'high',
    u_hmgr, u_htech1,
    '2025-01-06 07:00:00', '2025-01-06 07:00:00'
  ) RETURNING id INTO wo_id;

  INSERT INTO work_order_tasks (
    work_order_id, sequence, title, task_type, asset_checklist_id,
    status, created_at, updated_at
  ) VALUES (
    wo_id, 1, 'BLR-A1 Monthly Inspection Checklist',
    'checklist_execution', cl_blr_a1,
    'pending', '2025-01-06 07:00:00', '2025-01-06 07:00:00'
  );

  RAISE NOTICE '=== 08_seed_lisa_workorders.sql complete — 4 open WOs created for Lisa Park ===';
END;
$$;

DROP TABLE IF EXISTS _lisa_nodes;
