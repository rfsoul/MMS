-- =============================================================================
-- 04a_seed_checklists_electrical.sql
-- Checklist templates + asset checklists for Acme Electrical Services
-- Run after: 03_seed_graph.sql
-- =============================================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

-- Capture asset graph IDs into a temp table for use in the DO block
DROP TABLE IF EXISTS _elec_nodes;
CREATE TEMP TABLE _elec_nodes AS
SELECT DISTINCT ON (code) trim(both '"' from code::text) AS code, trim(both '"' from id::text) AS graph_id FROM cypher('asset_graph', $$
  MATCH (n:Asset) WHERE n.code IN ['MSB-01','SWG-A','SWG-B','PFC-01','UPS-A','UPS-B','DB-GF','DB-L1','DB-L2','DB-L3','DB-L4']
  RETURN n.code, id(n)
$$) AS (code agtype, id agtype)
ORDER BY code;

DO $check04a$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM _elec_nodes;
  RAISE NOTICE '04a: _elec_nodes has % rows (expected 11)', n;
  IF n = 0 THEN
    RAISE EXCEPTION '04a: _elec_nodes is empty — run 03_seed_graph.sql first';
  END IF;
END $check04a$;

DO $$
DECLARE
  co_elec UUID; u_admin UUID;
  at_msb UUID; at_swg UUID; at_pfc UUID; at_ups UUID; at_db UUID;
  ct_msb UUID; ct_swg UUID; ct_pfc UUID; ct_ups UUID; ct_db UUID;
  ac_id UUID; r RECORD;
BEGIN
  SELECT id INTO co_elec FROM companies WHERE name = 'Acme Electrical Services';
  SELECT id INTO u_admin FROM users WHERE email = 'admin@acme-electrical.com.au';
  SELECT id INTO at_msb FROM asset_types WHERE name = 'Main Switchboard'        AND company_id = co_elec;
  SELECT id INTO at_swg FROM asset_types WHERE name = 'Switchgear Panel'        AND company_id = co_elec;
  SELECT id INTO at_pfc FROM asset_types WHERE name = 'Power Factor Correction' AND company_id = co_elec;
  SELECT id INTO at_ups FROM asset_types WHERE name = 'UPS Battery Backup'      AND company_id = co_elec;
  SELECT id INTO at_db  FROM asset_types WHERE name = 'Distribution Board'      AND company_id = co_elec;

  IF co_elec IS NULL THEN RAISE EXCEPTION '04a: Acme Electrical Services company not found — run 02_seed first'; END IF;
  IF at_msb  IS NULL THEN RAISE EXCEPTION '04a: asset_type Main Switchboard not found'; END IF;
  IF at_swg  IS NULL THEN RAISE EXCEPTION '04a: asset_type Switchgear Panel not found'; END IF;
  IF at_pfc  IS NULL THEN RAISE EXCEPTION '04a: asset_type Power Factor Correction not found'; END IF;
  IF at_ups  IS NULL THEN RAISE EXCEPTION '04a: asset_type UPS Battery Backup not found'; END IF;
  IF at_db   IS NULL THEN RAISE EXCEPTION '04a: asset_type Distribution Board not found'; END IF;


  -- ── MAIN SWITCHBOARD TEMPLATE ──────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_elec, at_msb, 'MSB Standard Inspection', 'Standard annual inspection checklist for main LV switchboard', u_admin)
    RETURNING id INTO ct_msb;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_msb, 1, 'Visual inspection — enclosure, cable entries, labels',  'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_msb, 2, 'Phase voltage L1',                                      'measurement', 'V',  210,  250,  TRUE, FALSE),
    (ct_msb, 3, 'Phase voltage L2',                                      'measurement', 'V',  210,  250,  TRUE, FALSE),
    (ct_msb, 4, 'Phase voltage L3',                                      'measurement', 'V',  210,  250,  TRUE, FALSE),
    (ct_msb, 5, 'Incomer current (full load amps)',                      'measurement', 'A',  0,    3200, TRUE, FALSE),
    (ct_msb, 6, 'Switchboard internal temperature',                      'measurement', 'C',  0,    45,   TRUE, FALSE),
    (ct_msb, 7, 'IR thermographic scan completed (attach report)',       'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_msb, 8, 'Earth continuity test result — pass',                   'true_false',  NULL, NULL, NULL, TRUE, FALSE);

  -- ── SWITCHGEAR TEMPLATE ────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_elec, at_swg, 'Switchgear Standard Inspection', 'Periodic inspection checklist for HV/LV switchgear panels', u_admin)
    RETURNING id INTO ct_swg;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_swg, 1, 'Visual inspection — enclosure, busbar, insulators',   'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_swg, 2, 'Circuit breaker operation test (trip/reset)',          'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_swg, 3, 'Contact resistance measurement',                       'measurement', 'mO', 0,    50,   TRUE, FALSE),
    (ct_swg, 4, 'Insulation resistance test result',                    'measurement', 'MO', 100,  NULL, TRUE, FALSE),
    (ct_swg, 5, 'Mechanism lubrication completed',                      'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_swg, 6, 'IR thermographic scan completed',                      'true_false',  NULL, NULL, NULL, TRUE, FALSE);

  -- ── PFC TEMPLATE ──────────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_elec, at_pfc, 'PFC Unit Quarterly Inspection', 'Quarterly inspection of power factor correction unit', u_admin)
    RETURNING id INTO ct_pfc;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_pfc, 1, 'Visual inspection — capacitor bank, contactors, fuses', 'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_pfc, 2, 'Total harmonic distortion (THD)',                       'measurement', '%',  0,    8,    TRUE, FALSE),
    (ct_pfc, 3, 'Power factor reading (target >= 0.95)',                 'measurement', 'PF', 0.90, 1.00, TRUE, FALSE),
    (ct_pfc, 4, 'Capacitor bank temperature',                            'measurement', 'C',  0,    55,   TRUE, FALSE),
    (ct_pfc, 5, 'Contactor operation test',                              'true_false',  NULL, NULL, NULL, TRUE, FALSE);

  -- ── UPS TEMPLATE ──────────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_elec, at_ups, 'UPS Monthly Inspection', 'Monthly inspection and battery health check for UPS units', u_admin)
    RETURNING id INTO ct_ups;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_ups, 1, 'Visual inspection — batteries, connections, enclosure', 'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_ups, 2, 'Battery string voltage',                                'measurement', 'V',  46,   56,   TRUE, FALSE),
    (ct_ups, 3, 'UPS load percentage',                                   'measurement', '%',  0,    80,   TRUE, FALSE),
    (ct_ups, 4, 'Battery temperature',                                   'measurement', 'C',  15,   35,   TRUE, FALSE),
    (ct_ups, 5, 'Runtime test — confirm rated backup duration',          'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_ups, 6, 'Alarm and fault indicator check — no active faults',   'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_ups, 7, 'Automatic transfer switch (ATS) test — pass',          'true_false',  NULL, NULL, NULL, TRUE, FALSE);

  -- ── DISTRIBUTION BOARD TEMPLATE ───────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_elec, at_db, 'Distribution Board Annual Inspection', 'Annual inspection checklist for floor sub-distribution boards', u_admin)
    RETURNING id INTO ct_db;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_db, 1, 'Visual inspection — enclosure, cables, labels',        'true_false', NULL, NULL, NULL, TRUE, FALSE),
    (ct_db, 2, 'Circuit breaker trip test (RCD where applicable)',     'true_false', NULL, NULL, NULL, TRUE, FALSE),
    (ct_db, 3, 'Torque check — all connections',                       'true_false', NULL, NULL, NULL, TRUE, FALSE),
    (ct_db, 4, 'IR thermographic scan completed',                      'true_false', NULL, NULL, NULL, TRUE, FALSE),
    (ct_db, 5, 'Circuit labelling accurate and legible',               'true_false', NULL, NULL, NULL, TRUE, FALSE);

  RAISE NOTICE 'Electrical templates created';

  -- ── ASSET CHECKLISTS — use FOR loops (same pattern as 04b which works) ──────

  FOR r IN SELECT graph_id, code FROM _elec_nodes WHERE code = 'MSB-01' LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_elec, r.graph_id, at_msb, 'MSB-01 Annual Inspection', ct_msb, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_msb ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _elec_nodes WHERE code IN ('SWG-A','SWG-B') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_elec, r.graph_id, at_swg, trim(both '"' from r.code) || ' Standard Inspection', ct_swg, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_swg ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _elec_nodes WHERE code = 'PFC-01' LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_elec, r.graph_id, at_pfc, 'PFC-01 Quarterly Inspection', ct_pfc, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_pfc ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _elec_nodes WHERE code IN ('UPS-A','UPS-B') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_elec, r.graph_id, at_ups, trim(both '"' from r.code) || ' Monthly Inspection', ct_ups, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_ups ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _elec_nodes WHERE code IN ('DB-GF','DB-L1','DB-L2','DB-L3','DB-L4') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_elec, r.graph_id, at_db, trim(both '"' from r.code) || ' Annual Inspection', ct_db, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_db ORDER BY sequence;
  END LOOP;

  RAISE NOTICE '=== 04a_seed_checklists_electrical.sql complete ===';
END;
$$;

DROP TABLE _elec_nodes;
