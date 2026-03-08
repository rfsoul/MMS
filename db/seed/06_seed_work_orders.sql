-- =============================================================================
-- 06_seed_work_orders.sql
-- Historical completed work orders with checklist task responses
-- Schema: work_orders → work_order_tasks → asset_checklist_responses
-- Run after: 05_seed_pm_schedules.sql
-- =============================================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

DROP TABLE IF EXISTS _wo_nodes;
CREATE TEMP TABLE _wo_nodes AS
SELECT DISTINCT ON (code) trim(both '"' from code::text) AS code, trim(both '"' from id::text) AS graph_id FROM cypher('asset_graph', $$
  MATCH (n:Asset) WHERE n.code IN [
    'MSB-01','DB-L1','DB-L2','DB-L3','DB-L4',
    'CH-A1','CH-B1','AHU-01','AHU-02',
    'FCU-L1-01','FCU-L2-01','LIFT-A','LIFT-B','ESC-01'
  ]
  RETURN n.code, id(n)
$$) AS (code agtype, id agtype)
ORDER BY code;

DO $check$
DECLARE node_count INT;
BEGIN
  SELECT COUNT(*) INTO node_count FROM _wo_nodes;
  RAISE NOTICE '06_seed: _wo_nodes has % rows (expected 14)', node_count;
  IF node_count = 0 THEN
    RAISE EXCEPTION '06: No asset graph nodes found — run 03_seed_graph.sql first';
  END IF;
  IF node_count < 14 THEN
    RAISE EXCEPTION '06: Only % of 14 expected asset nodes found in graph — check 03_seed_graph.sql', node_count;
  END IF;
END $check$;

DO $$
DECLARE
  -- Companies / users
  co_elec   UUID; co_hvac UUID; co_vt UUID;
  u_emgr    UUID; u_etech1 UUID; u_etech2 UUID;
  u_hmgr    UUID; u_htech1 UUID; u_htech2 UUID;
  u_vmgr    UUID; u_vtech1 UUID; u_vtech2 UUID;

  -- Graph node IDs
  gn_msb    TEXT; gn_db_1 TEXT; gn_db_2 TEXT; gn_db_3 TEXT; gn_db_4 TEXT;
  gn_ch_a1  TEXT; gn_ch_b1 TEXT;
  gn_ahu_1  TEXT; gn_ahu_2 TEXT;
  gn_fcu_1a TEXT; gn_fcu_2a TEXT;
  gn_lift_a TEXT; gn_lift_b TEXT;
  gn_esc    TEXT;

  -- Work holders
  wo_id     UUID;
  task_id   UUID;
  cl_id     UUID;       -- asset checklist id
  item_ids  UUID[];     -- array of checklist item ids for current checklist

BEGIN
  -- ── COMPANIES AND USERS ───────────────────────────────────────────────────
  SELECT id INTO co_elec FROM companies WHERE name = 'Acme Electrical Services';
  SELECT id INTO co_hvac FROM companies WHERE name = 'Acme HVAC Services';
  SELECT id INTO co_vt   FROM companies WHERE name = 'Acme Vertical Transport';

  SELECT id INTO u_emgr   FROM users WHERE email = 'manager@acme-electrical.com.au';
  SELECT id INTO u_etech1 FROM users WHERE email = 'tech1@acme-electrical.com.au';
  SELECT id INTO u_etech2 FROM users WHERE email = 'tech2@acme-electrical.com.au';
  SELECT id INTO u_hmgr   FROM users WHERE email = 'manager@acme-hvac.com.au';
  SELECT id INTO u_htech1 FROM users WHERE email = 'tech1@acme-hvac.com.au';
  SELECT id INTO u_htech2 FROM users WHERE email = 'tech2@acme-hvac.com.au';
  SELECT id INTO u_vmgr   FROM users WHERE email = 'manager@acme-vt.com.au';
  SELECT id INTO u_vtech1 FROM users WHERE email = 'tech1@acme-vt.com.au';
  SELECT id INTO u_vtech2 FROM users WHERE email = 'tech2@acme-vt.com.au';

  -- ── GRAPH NODES ───────────────────────────────────────────────────────────
  SELECT MAX(CASE WHEN code = 'MSB-01'    THEN graph_id END),
         MAX(CASE WHEN code = 'DB-L1'     THEN graph_id END),
         MAX(CASE WHEN code = 'DB-L2'     THEN graph_id END),
         MAX(CASE WHEN code = 'DB-L3'     THEN graph_id END),
         MAX(CASE WHEN code = 'DB-L4'     THEN graph_id END),
         MAX(CASE WHEN code = 'CH-A1'     THEN graph_id END),
         MAX(CASE WHEN code = 'CH-B1'     THEN graph_id END),
         MAX(CASE WHEN code = 'AHU-01'    THEN graph_id END),
         MAX(CASE WHEN code = 'AHU-02'    THEN graph_id END),
         MAX(CASE WHEN code = 'FCU-L1-01' THEN graph_id END),
         MAX(CASE WHEN code = 'FCU-L2-01' THEN graph_id END),
         MAX(CASE WHEN code = 'LIFT-A'    THEN graph_id END),
         MAX(CASE WHEN code = 'LIFT-B'    THEN graph_id END),
         MAX(CASE WHEN code = 'ESC-01'    THEN graph_id END)
    INTO gn_msb, gn_db_1, gn_db_2, gn_db_3, gn_db_4,
         gn_ch_a1, gn_ch_b1, gn_ahu_1, gn_ahu_2,
         gn_fcu_1a, gn_fcu_2a, gn_lift_a, gn_lift_b, gn_esc
    FROM _wo_nodes;

  IF co_elec  IS NULL THEN RAISE EXCEPTION '06: Acme Electrical Services not found — run 02_seed first'; END IF;
  IF co_hvac  IS NULL THEN RAISE EXCEPTION '06: Acme HVAC Services not found — run 02_seed first'; END IF;
  IF co_vt    IS NULL THEN RAISE EXCEPTION '06: Acme Vertical Transport not found — run 02_seed first'; END IF;
  IF gn_msb   IS NULL THEN RAISE EXCEPTION '06: Asset MSB-01 not found in graph — run 03_seed first'; END IF;
  IF gn_ch_a1 IS NULL THEN RAISE EXCEPTION '06: Asset CH-A1 not found in graph — run 03_seed first'; END IF;
  IF gn_lift_a IS NULL THEN RAISE EXCEPTION '06: Asset LIFT-A not found in graph — run 03_seed first'; END IF;

  RAISE NOTICE 'Lookups complete, creating historical work orders...';

  -- ══════════════════════════════════════════════════════════════════════════
  -- ELECTRICAL — MSB-01  (3 annual inspections)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists
    WHERE asset_graph_id = gn_msb AND company_id = co_elec LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence)
    INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_msb — run 04_seed first'; END IF;

  -- WO 1 — Jan 2023
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_elec, gn_msb, 'MSB-01 Annual Inspection — Jan 2023',
      'Annual LV switchboard inspection per AS/NZS 3000.', 'inspection',
      'completed', 'medium', u_emgr, u_etech1,
      '2023-01-20 14:00:00', '2023-01-10 08:00:00', '2023-01-20 14:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'MSB-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2023-01-20 13:30:00', '2023-01-10 08:00:00', '2023-01-20 13:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_etech1, TRUE,  NULL,  'Enclosure clean, labels legible'),
    (item_ids[2], task_id, u_etech1, NULL,  231.4, NULL),
    (item_ids[3], task_id, u_etech1, NULL,  230.8, NULL),
    (item_ids[4], task_id, u_etech1, NULL,  232.1, NULL),
    (item_ids[5], task_id, u_etech1, NULL,  1842,  NULL),
    (item_ids[6], task_id, u_etech1, NULL,  38.2,  NULL),
    (item_ids[7], task_id, u_etech1, TRUE,  NULL,  'IR report attached — no hotspots'),
    (item_ids[8], task_id, u_etech1, TRUE,  NULL,  NULL);

  -- WO 2 — Jan 2024
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_elec, gn_msb, 'MSB-01 Annual Inspection — Jan 2024',
      'Annual LV switchboard inspection per AS/NZS 3000.', 'inspection',
      'completed', 'medium', u_emgr, u_etech2,
      '2024-01-18 15:00:00', '2024-01-08 08:00:00', '2024-01-18 15:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'MSB-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-01-18 14:30:00', '2024-01-08 08:00:00', '2024-01-18 14:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_etech2, TRUE,  NULL,  NULL),
    (item_ids[2], task_id, u_etech2, NULL,  229.9, NULL),
    (item_ids[3], task_id, u_etech2, NULL,  230.4, NULL),
    (item_ids[4], task_id, u_etech2, NULL,  231.0, NULL),
    (item_ids[5], task_id, u_etech2, NULL,  1956,  NULL),
    (item_ids[6], task_id, u_etech2, NULL,  40.1,  NULL),
    (item_ids[7], task_id, u_etech2, TRUE,  NULL,  'IR scan clear'),
    (item_ids[8], task_id, u_etech2, TRUE,  NULL,  NULL);

  -- WO 3 — Jan 2025
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_elec, gn_msb, 'MSB-01 Annual Inspection — Jan 2025',
      'Annual LV switchboard inspection per AS/NZS 3000.', 'inspection',
      'completed', 'medium', u_emgr, u_etech1,
      '2025-01-17 14:00:00', '2025-01-07 08:00:00', '2025-01-17 14:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'MSB-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2025-01-17 13:00:00', '2025-01-07 08:00:00', '2025-01-17 13:00:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_etech1, TRUE,  NULL,  NULL),
    (item_ids[2], task_id, u_etech1, NULL,  230.2, NULL),
    (item_ids[3], task_id, u_etech1, NULL,  231.5, NULL),
    (item_ids[4], task_id, u_etech1, NULL,  229.8, NULL),
    (item_ids[5], task_id, u_etech1, NULL,  2010,  NULL),
    (item_ids[6], task_id, u_etech1, NULL,  41.3,  'Slightly elevated — monitor'),
    (item_ids[7], task_id, u_etech1, TRUE,  NULL,  'IR report attached'),
    (item_ids[8], task_id, u_etech1, TRUE,  NULL,  NULL);

  -- ══════════════════════════════════════════════════════════════════════════
  -- ELECTRICAL — DB-L1, DB-L2, DB-L3, DB-L4 (1 each)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_db_1 AND company_id = co_elec LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_db_1 — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_elec, gn_db_1, 'DB-L1 Annual Inspection — Feb 2024', 'Annual inspection of Level 1 sub-distribution board.', 'inspection',
      'completed', 'low', u_emgr, u_etech2, '2024-02-14 12:00:00', '2024-02-05 08:00:00', '2024-02-14 12:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'DB-L1 Inspection Checklist', 'checklist_execution', cl_id, 'completed', '2024-02-14 11:30:00', '2024-02-05 08:00:00', '2024-02-14 11:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_etech2, TRUE, NULL, NULL),
    (item_ids[2], task_id, u_etech2, TRUE, NULL, NULL),
    (item_ids[3], task_id, u_etech2, TRUE, NULL, NULL),
    (item_ids[4], task_id, u_etech2, TRUE, NULL, 'IR scan clear'),
    (item_ids[5], task_id, u_etech2, TRUE, NULL, NULL);

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_db_2 AND company_id = co_elec LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_db_2 — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_elec, gn_db_2, 'DB-L2 Annual Inspection — Feb 2024', 'Annual inspection of Level 2 sub-distribution board.', 'inspection',
      'completed', 'low', u_emgr, u_etech1, '2024-02-15 12:00:00', '2024-02-05 08:00:00', '2024-02-15 12:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'DB-L2 Inspection Checklist', 'checklist_execution', cl_id, 'completed', '2024-02-15 11:30:00', '2024-02-05 08:00:00', '2024-02-15 11:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[2], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[3], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[4], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[5], task_id, u_etech1, TRUE, NULL, NULL);

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_db_3 AND company_id = co_elec LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_db_3 — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_elec, gn_db_3, 'DB-L3 Annual Inspection — Feb 2024', 'Annual inspection of Level 3 sub-distribution board.', 'inspection',
      'completed', 'low', u_emgr, u_etech2, '2024-02-16 12:00:00', '2024-02-05 08:00:00', '2024-02-16 12:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'DB-L3 Inspection Checklist', 'checklist_execution', cl_id, 'completed', '2024-02-16 11:30:00', '2024-02-05 08:00:00', '2024-02-16 11:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_etech2, TRUE, NULL, NULL),
    (item_ids[2], task_id, u_etech2, TRUE, NULL, NULL),
    (item_ids[3], task_id, u_etech2, TRUE, NULL, NULL),
    (item_ids[4], task_id, u_etech2, TRUE, NULL, NULL),
    (item_ids[5], task_id, u_etech2, TRUE, NULL, NULL);

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_db_4 AND company_id = co_elec LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_db_4 — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_elec, gn_db_4, 'DB-L4 Annual Inspection — Feb 2024', 'Annual inspection of Level 4 sub-distribution board.', 'inspection',
      'completed', 'low', u_emgr, u_etech1, '2024-02-17 12:00:00', '2024-02-05 08:00:00', '2024-02-17 12:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'DB-L4 Inspection Checklist', 'checklist_execution', cl_id, 'completed', '2024-02-17 11:30:00', '2024-02-05 08:00:00', '2024-02-17 11:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[2], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[3], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[4], task_id, u_etech1, TRUE, NULL, NULL),
    (item_ids[5], task_id, u_etech1, TRUE, NULL, NULL);

  -- ══════════════════════════════════════════════════════════════════════════
  -- HVAC — CH-A1 (3 monthly inspections)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_ch_a1 AND company_id = co_hvac LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_ch_a1 — run 04_seed first'; END IF;

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ch_a1, 'CH-A1 Monthly Inspection — Oct 2024', 'Monthly chiller inspection — circuit A duty unit.', 'inspection',
      'completed', 'high', u_hmgr, u_htech1,
      '2024-10-08 11:00:00', '2024-10-01 07:00:00', '2024-10-08 11:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'CH-A1 Chiller Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-10-08 10:30:00', '2024-10-01 07:00:00', '2024-10-08 10:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech1, NULL,  6.8,  NULL),
    (item_ids[2], task_id, u_htech1, NULL,  12.4, NULL),
    (item_ids[3], task_id, u_htech1, NULL,  512,  NULL),
    (item_ids[4], task_id, u_htech1, NULL,  1480, NULL),
    (item_ids[5], task_id, u_htech1, TRUE,  NULL, 'Oil level normal'),
    (item_ids[6], task_id, u_htech1, NULL,  382,  NULL),
    (item_ids[7], task_id, u_htech1, TRUE,  NULL, 'No abnormal vibration'),
    (item_ids[8], task_id, u_htech1, NULL,  4210, NULL),
    (item_ids[9], task_id, u_htech1, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ch_a1, 'CH-A1 Monthly Inspection — Nov 2024', 'Monthly chiller inspection — circuit A duty unit.', 'inspection',
      'completed', 'high', u_hmgr, u_htech2,
      '2024-11-06 10:00:00', '2024-11-01 07:00:00', '2024-11-06 10:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'CH-A1 Chiller Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-11-06 09:30:00', '2024-11-01 07:00:00', '2024-11-06 09:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech2, NULL,  7.1,  NULL),
    (item_ids[2], task_id, u_htech2, NULL,  13.0, NULL),
    (item_ids[3], task_id, u_htech2, NULL,  498,  NULL),
    (item_ids[4], task_id, u_htech2, NULL,  1510, NULL),
    (item_ids[5], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[6], task_id, u_htech2, NULL,  375,  NULL),
    (item_ids[7], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[8], task_id, u_htech2, NULL,  4480, NULL),
    (item_ids[9], task_id, u_htech2, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ch_a1, 'CH-A1 Monthly Inspection — Dec 2024', 'Monthly chiller inspection — circuit A duty unit.', 'inspection',
      'completed', 'high', u_hmgr, u_htech1,
      '2024-12-05 11:30:00', '2024-12-01 07:00:00', '2024-12-05 11:30:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'CH-A1 Chiller Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-12-05 11:00:00', '2024-12-01 07:00:00', '2024-12-05 11:00:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech1, NULL,  6.5,  NULL),
    (item_ids[2], task_id, u_htech1, NULL,  11.8, NULL),
    (item_ids[3], task_id, u_htech1, NULL,  520,  NULL),
    (item_ids[4], task_id, u_htech1, NULL,  1465, NULL),
    (item_ids[5], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[6], task_id, u_htech1, NULL,  390,  'Slightly elevated — chiller working harder in heat'),
    (item_ids[7], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[8], task_id, u_htech1, NULL,  4750, NULL),
    (item_ids[9], task_id, u_htech1, TRUE,  NULL, NULL);

  -- ══════════════════════════════════════════════════════════════════════════
  -- HVAC — CH-B1 (1 inspection)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_ch_b1 AND company_id = co_hvac LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_ch_b1 — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ch_b1, 'CH-B1 Monthly Inspection — Dec 2024', 'Monthly chiller inspection — circuit B duty unit.', 'inspection',
      'completed', 'high', u_hmgr, u_htech2,
      '2024-12-06 10:00:00', '2024-12-01 07:00:00', '2024-12-06 10:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'CH-B1 Chiller Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-12-06 09:30:00', '2024-12-01 07:00:00', '2024-12-06 09:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech2, NULL,  6.9,  NULL),
    (item_ids[2], task_id, u_htech2, NULL,  12.5, NULL),
    (item_ids[3], task_id, u_htech2, NULL,  505,  NULL),
    (item_ids[4], task_id, u_htech2, NULL,  1490, NULL),
    (item_ids[5], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[6], task_id, u_htech2, NULL,  368,  NULL),
    (item_ids[7], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[8], task_id, u_htech2, NULL,  2980, NULL),
    (item_ids[9], task_id, u_htech2, TRUE,  NULL, NULL);

  -- ══════════════════════════════════════════════════════════════════════════
  -- HVAC — AHU-01 (3 monthly inspections)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_ahu_1 AND company_id = co_hvac LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_ahu_1 — run 04_seed first'; END IF;

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ahu_1, 'AHU-01 Monthly Inspection — Oct 2024', 'Monthly AHU inspection — Level 1 zone.', 'inspection',
      'completed', 'medium', u_hmgr, u_htech1,
      '2024-10-10 14:00:00', '2024-10-01 07:00:00', '2024-10-10 14:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'AHU-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-10-10 13:30:00', '2024-10-01 07:00:00', '2024-10-10 13:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech1, NULL,  14.2, NULL),
    (item_ids[2], task_id, u_htech1, NULL,  22.8, NULL),
    (item_ids[3], task_id, u_htech1, TRUE,  NULL, 'Filters replaced this visit'),
    (item_ids[4], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_htech1, NULL,  42.1, NULL),
    (item_ids[6], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_htech1, NULL,  8820, NULL),
    (item_ids[8], task_id, u_htech1, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ahu_1, 'AHU-01 Monthly Inspection — Nov 2024', 'Monthly AHU inspection — Level 1 zone.', 'inspection',
      'completed', 'medium', u_hmgr, u_htech2,
      '2024-11-08 14:00:00', '2024-11-01 07:00:00', '2024-11-08 14:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'AHU-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-11-08 13:30:00', '2024-11-01 07:00:00', '2024-11-08 13:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech2, NULL,  15.0, NULL),
    (item_ids[2], task_id, u_htech2, NULL,  23.1, NULL),
    (item_ids[3], task_id, u_htech2, TRUE,  NULL, 'Filter pressure drop within limits'),
    (item_ids[4], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_htech2, NULL,  43.8, NULL),
    (item_ids[6], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_htech2, NULL,  9100, NULL),
    (item_ids[8], task_id, u_htech2, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ahu_1, 'AHU-01 Monthly Inspection — Dec 2024', 'Monthly AHU inspection — Level 1 zone.', 'inspection',
      'completed', 'medium', u_hmgr, u_htech1,
      '2024-12-09 14:00:00', '2024-12-01 07:00:00', '2024-12-09 14:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'AHU-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-12-09 13:30:00', '2024-12-01 07:00:00', '2024-12-09 13:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech1, NULL,  13.8, NULL),
    (item_ids[2], task_id, u_htech1, NULL,  22.5, NULL),
    (item_ids[3], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_htech1, NULL,  41.5, NULL),
    (item_ids[6], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_htech1, NULL,  9380, NULL),
    (item_ids[8], task_id, u_htech1, TRUE,  NULL, NULL);

  -- ══════════════════════════════════════════════════════════════════════════
  -- HVAC — AHU-02 (1 inspection)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_ahu_2 AND company_id = co_hvac LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_ahu_2 — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_ahu_2, 'AHU-02 Monthly Inspection — Dec 2024', 'Monthly AHU inspection — Level 2 zone.', 'inspection',
      'completed', 'medium', u_hmgr, u_htech2,
      '2024-12-09 16:00:00', '2024-12-01 07:00:00', '2024-12-09 16:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'AHU-02 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-12-09 15:30:00', '2024-12-01 07:00:00', '2024-12-09 15:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech2, NULL,  14.5, NULL),
    (item_ids[2], task_id, u_htech2, NULL,  23.4, NULL),
    (item_ids[3], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_htech2, NULL,  39.2, NULL),
    (item_ids[6], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_htech2, NULL,  7640, NULL),
    (item_ids[8], task_id, u_htech2, TRUE,  NULL, NULL);

  -- ══════════════════════════════════════════════════════════════════════════
  -- HVAC — FCU-L1-01, FCU-L2-01 (1 each)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_fcu_1a AND company_id = co_hvac LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_fcu_1a — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_fcu_1a, 'FCU-L1-01 Quarterly Inspection — Q4 2024', 'Quarterly FCU inspection Level 1 north zone.', 'inspection',
      'completed', 'low', u_hmgr, u_htech1,
      '2024-11-15 11:00:00', '2024-11-10 07:00:00', '2024-11-15 11:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'FCU-L1-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-11-15 10:30:00', '2024-11-10 07:00:00', '2024-11-15 10:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech1, NULL,  16.2, NULL),
    (item_ids[2], task_id, u_htech1, TRUE,  NULL, 'Filter cleaned'),
    (item_ids[3], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_htech1, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_htech1, TRUE,  NULL, NULL);

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_fcu_2a AND company_id = co_hvac LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_fcu_2a — run 04_seed first'; END IF;
  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_hvac, gn_fcu_2a, 'FCU-L2-01 Quarterly Inspection — Q4 2024', 'Quarterly FCU inspection Level 2 north zone.', 'inspection',
      'completed', 'low', u_hmgr, u_htech2,
      '2024-11-15 13:00:00', '2024-11-10 07:00:00', '2024-11-15 13:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'FCU-L2-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-11-15 12:30:00', '2024-11-10 07:00:00', '2024-11-15 12:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_htech2, NULL,  15.8, NULL),
    (item_ids[2], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[3], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_htech2, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_htech2, TRUE,  NULL, NULL);

  -- ══════════════════════════════════════════════════════════════════════════
  -- VERTICAL TRANSPORT — LIFT-A, LIFT-B (3 each), ESC-01 (2)
  -- ══════════════════════════════════════════════════════════════════════════

  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_lift_a AND company_id = co_vt LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_lift_a — run 04_seed first'; END IF;

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_vt, gn_lift_a, 'Lift A Monthly Inspection — Oct 2024', 'Monthly statutory lift inspection.', 'inspection',
      'completed', 'high', u_vmgr, u_vtech1,
      '2024-10-04 10:00:00', '2024-10-01 07:00:00', '2024-10-04 10:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'Lift A Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-10-04 09:30:00', '2024-10-01 07:00:00', '2024-10-04 09:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[2], task_id, u_vtech1, NULL,  4.0,  NULL),
    (item_ids[3], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_vtech1, NULL,  52.0, NULL),
    (item_ids[6], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_vtech1, NULL,  12840, NULL),
    (item_ids[8], task_id, u_vtech1, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_vt, gn_lift_a, 'Lift A Monthly Inspection — Nov 2024', 'Monthly statutory lift inspection.', 'inspection',
      'completed', 'high', u_vmgr, u_vtech1,
      '2024-11-05 10:00:00', '2024-11-01 07:00:00', '2024-11-05 10:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'Lift A Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-11-05 09:30:00', '2024-11-01 07:00:00', '2024-11-05 09:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[2], task_id, u_vtech1, NULL,  3.0,  NULL),
    (item_ids[3], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_vtech1, NULL,  51.0, NULL),
    (item_ids[6], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_vtech1, NULL,  13210, NULL),
    (item_ids[8], task_id, u_vtech1, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_vt, gn_lift_a, 'Lift A Monthly Inspection — Dec 2024', 'Monthly statutory lift inspection.', 'inspection',
      'completed', 'high', u_vmgr, u_vtech1,
      '2024-12-04 10:00:00', '2024-12-01 07:00:00', '2024-12-04 10:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'Lift A Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-12-04 09:30:00', '2024-12-01 07:00:00', '2024-12-04 09:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[2], task_id, u_vtech1, NULL,  5.0,  NULL),
    (item_ids[3], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_vtech1, NULL,  53.0, NULL),
    (item_ids[6], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_vtech1, NULL,  13580, NULL),
    (item_ids[8], task_id, u_vtech1, TRUE,  NULL, NULL);

  -- LIFT-B (2 inspections)
  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_lift_b AND company_id = co_vt LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_lift_b — run 04_seed first'; END IF;

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_vt, gn_lift_b, 'Lift B Monthly Inspection — Nov 2024', 'Monthly statutory lift inspection.', 'inspection',
      'completed', 'high', u_vmgr, u_vtech2,
      '2024-11-05 13:00:00', '2024-11-01 07:00:00', '2024-11-05 13:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'Lift B Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-11-05 12:30:00', '2024-11-01 07:00:00', '2024-11-05 12:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[2], task_id, u_vtech2, NULL,  4.0,  NULL),
    (item_ids[3], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_vtech2, NULL,  50.0, NULL),
    (item_ids[6], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_vtech2, NULL,  9820, NULL),
    (item_ids[8], task_id, u_vtech2, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_vt, gn_lift_b, 'Lift B Monthly Inspection — Dec 2024', 'Monthly statutory lift inspection.', 'inspection',
      'completed', 'high', u_vmgr, u_vtech2,
      '2024-12-04 13:00:00', '2024-12-01 07:00:00', '2024-12-04 13:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'Lift B Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-12-04 12:30:00', '2024-12-01 07:00:00', '2024-12-04 12:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[2], task_id, u_vtech2, NULL,  3.0,  NULL),
    (item_ids[3], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_vtech2, NULL,  51.0, NULL),
    (item_ids[6], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[7], task_id, u_vtech2, NULL,  10150, NULL),
    (item_ids[8], task_id, u_vtech2, TRUE,  NULL, NULL);

  -- ESC-01 (2 inspections)
  SELECT id INTO cl_id FROM asset_checklists WHERE asset_graph_id = gn_esc AND company_id = co_vt LIMIT 1;
  SELECT ARRAY(SELECT id FROM asset_checklist_items WHERE checklist_id = cl_id ORDER BY sequence) INTO item_ids;
  IF cl_id IS NULL THEN RAISE EXCEPTION '06: No checklist found for gn_esc — run 04_seed first'; END IF;

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_vt, gn_esc, 'ESC-01 Monthly Inspection — Nov 2024', 'Monthly statutory escalator inspection.', 'inspection',
      'completed', 'high', u_vmgr, u_vtech1,
      '2024-11-06 10:00:00', '2024-11-01 07:00:00', '2024-11-06 10:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'ESC-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-11-06 09:30:00', '2024-11-01 07:00:00', '2024-11-06 09:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[2], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[3], task_id, u_vtech1, TRUE,  NULL, 'Lubrication applied'),
    (item_ids[4], task_id, u_vtech1, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_vtech1, NULL,  18.2, NULL),
    (item_ids[6], task_id, u_vtech1, NULL,  6240, NULL),
    (item_ids[7], task_id, u_vtech1, TRUE,  NULL, NULL);

  INSERT INTO work_orders (company_id, asset_graph_id, title, description, type, status, priority, created_by, assigned_to, completed_at, created_at, updated_at)
    VALUES (co_vt, gn_esc, 'ESC-01 Monthly Inspection — Dec 2024', 'Monthly statutory escalator inspection.', 'inspection',
      'completed', 'high', u_vmgr, u_vtech2,
      '2024-12-05 10:00:00', '2024-12-01 07:00:00', '2024-12-05 10:00:00')
    RETURNING id INTO wo_id;
  INSERT INTO work_order_tasks (work_order_id, sequence, title, task_type, asset_checklist_id, status, completed_at, created_at, updated_at)
    VALUES (wo_id, 1, 'ESC-01 Inspection Checklist', 'checklist_execution', cl_id, 'completed',
      '2024-12-05 09:30:00', '2024-12-01 07:00:00', '2024-12-05 09:30:00')
    RETURNING id INTO task_id;
  INSERT INTO asset_checklist_responses (asset_checklist_item_id, work_order_task_id, responded_by, boolean_value, numeric_value, notes) VALUES
    (item_ids[1], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[2], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[3], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[4], task_id, u_vtech2, TRUE,  NULL, NULL),
    (item_ids[5], task_id, u_vtech2, NULL,  17.8, NULL),
    (item_ids[6], task_id, u_vtech2, NULL,  6510, NULL),
    (item_ids[7], task_id, u_vtech2, TRUE,  NULL, NULL);

  RAISE NOTICE '=== 06_seed_work_orders.sql complete ===';
END;
$$;

DROP TABLE _wo_nodes;
