-- =============================================================================
-- 04b_seed_checklists_hvac.sql
-- Checklist templates + asset checklists for Acme HVAC Services
-- Run after: 04a_seed_checklists_electrical.sql
-- =============================================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

DROP TABLE IF EXISTS _hvac_nodes;
CREATE TEMP TABLE _hvac_nodes AS
SELECT DISTINCT ON (code) trim(both '"' from code::text) AS code, trim(both '"' from id::text) AS graph_id FROM cypher('asset_graph', $$
  MATCH (n:Asset) WHERE n.code IN [
    'CH-A1','CH-A2','CH-B1','CH-B2',
    'CT-A1','CT-A2','CT-B1','CT-B2',
    'CHWP-A1','CHWP-A2','CHWP-B1','CHWP-B2',
    'BLR-A1','BLR-A2','BLR-B1','BLR-B2',
    'HWP-A1','HWP-A2','HWP-B1','HWP-B2',
    'AHU-01','AHU-02','AHU-03','AHU-04',
    'FCU-L1-01','FCU-L1-02','FCU-L2-01','FCU-L2-02',
    'FCU-L3-01','FCU-L3-02','FCU-L4-01','FCU-L4-02'
  ]
  RETURN n.code, id(n)
$$) AS (code agtype, id agtype)
ORDER BY code;

DO $check04b$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM _hvac_nodes;
  RAISE NOTICE '04b: _hvac_nodes has % rows', n;
  IF n = 0 THEN
    RAISE EXCEPTION '04b: _hvac_nodes is empty — run 03_seed_graph.sql first';
  END IF;
END $check04b$;

DO $$
DECLARE
  co_hvac UUID; u_admin UUID;
  at_chl UUID; at_ct UUID; at_blr UUID; at_chwp UUID; at_hwp UUID; at_ahu UUID; at_fcu UUID;
  ct_chl UUID; ct_ct UUID; ct_blr UUID; ct_chwp UUID; ct_hwp UUID; ct_ahu UUID; ct_fcu UUID;
  ac_id UUID;
  r RECORD;
BEGIN
  SELECT id INTO co_hvac FROM companies WHERE name = 'Acme HVAC Services';
  SELECT id INTO u_admin FROM users WHERE email = 'admin@acme-hvac.com.au';
  SELECT id INTO at_chl  FROM asset_types WHERE name = 'Chiller'            AND company_id = co_hvac;
  SELECT id INTO at_ct   FROM asset_types WHERE name = 'Cooling Tower'      AND company_id = co_hvac;
  SELECT id INTO at_blr  FROM asset_types WHERE name = 'Boiler'             AND company_id = co_hvac;
  SELECT id INTO at_chwp FROM asset_types WHERE name = 'Chilled Water Pump' AND company_id = co_hvac;
  SELECT id INTO at_hwp  FROM asset_types WHERE name = 'Hot Water Pump'     AND company_id = co_hvac;
  SELECT id INTO at_ahu  FROM asset_types WHERE name = 'Air Handling Unit'  AND company_id = co_hvac;
  SELECT id INTO at_fcu  FROM asset_types WHERE name = 'Fan Coil Unit'      AND company_id = co_hvac;

  IF co_hvac  IS NULL THEN RAISE EXCEPTION '04b: Acme HVAC Services company not found — run 02_seed first'; END IF;
  IF at_chl   IS NULL THEN RAISE EXCEPTION '04b: asset_type Chiller not found'; END IF;
  IF at_ct    IS NULL THEN RAISE EXCEPTION '04b: asset_type Cooling Tower not found'; END IF;
  IF at_blr   IS NULL THEN RAISE EXCEPTION '04b: asset_type Boiler not found'; END IF;
  IF at_chwp  IS NULL THEN RAISE EXCEPTION '04b: asset_type Chilled Water Pump not found'; END IF;
  IF at_hwp   IS NULL THEN RAISE EXCEPTION '04b: asset_type Hot Water Pump not found'; END IF;
  IF at_ahu   IS NULL THEN RAISE EXCEPTION '04b: asset_type Air Handling Unit not found'; END IF;
  IF at_fcu   IS NULL THEN RAISE EXCEPTION '04b: asset_type Fan Coil Unit not found'; END IF;

  -- ── CHILLER TEMPLATE ──────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_hvac, at_chl, 'Chiller Monthly Inspection', 'Monthly inspection for water-cooled centrifugal chillers', u_admin)
    RETURNING id INTO ct_chl;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_chl, 1, 'Leaving chilled water temperature (LWT)',      'measurement', 'C',   5,    8,    TRUE, FALSE),
    (ct_chl, 2, 'Entering chilled water temperature (EWT)',     'measurement', 'C',   10,   16,   TRUE, FALSE),
    (ct_chl, 3, 'Refrigerant suction pressure',                 'measurement', 'kPa', 400,  600,  TRUE, FALSE),
    (ct_chl, 4, 'Refrigerant discharge pressure',               'measurement', 'kPa', 1200, 1800, TRUE, FALSE),
    (ct_chl, 5, 'Compressor oil level — sight glass check',     'true_false',  NULL,  NULL, NULL, TRUE, FALSE),
    (ct_chl, 6, 'Compressor run amps',                          'measurement', 'A',   0,    500,  TRUE, FALSE),
    (ct_chl, 7, 'Vibration check — compressor and motor',       'true_false',  NULL,  NULL, NULL, TRUE, FALSE),
    (ct_chl, 8, 'Cumulative runtime hours',                     'measurement', 'hrs', 0,    NULL, TRUE, TRUE),
    (ct_chl, 9, 'Refrigerant leak check — no leaks detected',   'true_false',  NULL,  NULL, NULL, TRUE, FALSE);

  -- ── COOLING TOWER TEMPLATE ────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_hvac, at_ct, 'Cooling Tower Monthly Inspection', 'Monthly inspection of evaporative cooling towers', u_admin)
    RETURNING id INTO ct_ct;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_ct, 1, 'Basin water level — check and adjust',              'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_ct, 2, 'Water treatment — check dosing and conductivity',   'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_ct, 3, 'Fan motor run amps',                                'measurement', 'A',  0,    50,   TRUE, FALSE),
    (ct_ct, 4, 'Condenser water inlet temperature',                 'measurement', 'C',  25,   36,   TRUE, FALSE),
    (ct_ct, 5, 'Condenser water outlet temperature',                'measurement', 'C',  20,   32,   TRUE, FALSE),
    (ct_ct, 6, 'Visual inspection — fill media, drift eliminators', 'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_ct, 7, 'Cumulative runtime hours',                          'measurement', 'hrs',0,    NULL, TRUE, TRUE);

  -- ── BOILER TEMPLATE ───────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_hvac, at_blr, 'Boiler Monthly Inspection', 'Monthly inspection of condensing gas-fired hot water boilers', u_admin)
    RETURNING id INTO ct_blr;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_blr, 1, 'Flow water temperature',                          'measurement', 'C',   60,  85,   TRUE, FALSE),
    (ct_blr, 2, 'Return water temperature',                        'measurement', 'C',   45,  70,   TRUE, FALSE),
    (ct_blr, 3, 'Gas supply pressure',                             'measurement', 'kPa', 1,   3,    TRUE, FALSE),
    (ct_blr, 4, 'Flue gas temperature',                            'measurement', 'C',   0,   200,  TRUE, FALSE),
    (ct_blr, 5, 'Burner operation — ignition and flame check',     'true_false',  NULL,  NULL,NULL, TRUE, FALSE),
    (ct_blr, 6, 'Water treatment — system inhibitor level',        'true_false',  NULL,  NULL,NULL, TRUE, FALSE),
    (ct_blr, 7, 'Cumulative runtime hours',                        'measurement', 'hrs', 0,   NULL, TRUE, TRUE),
    (ct_blr, 8, 'Visual inspection — flue, casing, pipework',      'true_false',  NULL,  NULL,NULL, TRUE, FALSE);

  -- ── CHW PUMP TEMPLATE ─────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_hvac, at_chwp, 'Chilled Water Pump Quarterly Inspection', 'Quarterly inspection for variable speed chilled water pumps', u_admin)
    RETURNING id INTO ct_chwp;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_chwp, 1, 'Flow rate at duty point',                       'measurement', 'L/s',0,   NULL, TRUE, FALSE),
    (ct_chwp, 2, 'Differential pressure across pump',             'measurement', 'kPa',0,   400,  TRUE, FALSE),
    (ct_chwp, 3, 'Motor run amps',                                'measurement', 'A',  0,   100,  TRUE, FALSE),
    (ct_chwp, 4, 'Bearing temperature',                           'measurement', 'C',  0,   80,   TRUE, FALSE),
    (ct_chwp, 5, 'Vibration — shaft and casing check',            'true_false',  NULL, NULL,NULL, TRUE, FALSE),
    (ct_chwp, 6, 'Cumulative runtime hours',                      'measurement', 'hrs',0,   NULL, TRUE, TRUE);

  -- ── HW PUMP TEMPLATE ──────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_hvac, at_hwp, 'Hot Water Pump Quarterly Inspection', 'Quarterly inspection for variable speed hot water pumps', u_admin)
    RETURNING id INTO ct_hwp;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_hwp, 1, 'Flow rate at duty point',                        'measurement', 'L/s',0,   NULL, TRUE, FALSE),
    (ct_hwp, 2, 'Differential pressure across pump',              'measurement', 'kPa',0,   400,  TRUE, FALSE),
    (ct_hwp, 3, 'Motor run amps',                                 'measurement', 'A',  0,   100,  TRUE, FALSE),
    (ct_hwp, 4, 'Bearing temperature',                            'measurement', 'C',  0,   90,   TRUE, FALSE),
    (ct_hwp, 5, 'Vibration — shaft and casing check',             'true_false',  NULL, NULL,NULL, TRUE, FALSE),
    (ct_hwp, 6, 'Cumulative runtime hours',                       'measurement', 'hrs',0,   NULL, TRUE, TRUE);

  -- ── AHU TEMPLATE ──────────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_hvac, at_ahu, 'AHU Monthly Inspection', 'Monthly inspection checklist for central air handling units', u_admin)
    RETURNING id INTO ct_ahu;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_ahu, 1, 'Supply air temperature',                          'measurement', 'C',  12,  18,   TRUE, FALSE),
    (ct_ahu, 2, 'Return air temperature',                          'measurement', 'C',  20,  26,   TRUE, FALSE),
    (ct_ahu, 3, 'Filter condition — visual and pressure drop check','true_false', NULL, NULL,NULL, TRUE, FALSE),
    (ct_ahu, 4, 'Fan belt tension and condition',                  'true_false',  NULL, NULL,NULL, TRUE, FALSE),
    (ct_ahu, 5, 'Fan motor run amps',                              'measurement', 'A',  0,   80,   TRUE, FALSE),
    (ct_ahu, 6, 'Cooling and heating coil condition',              'true_false',  NULL, NULL,NULL, TRUE, FALSE),
    (ct_ahu, 7, 'Cumulative runtime hours',                        'measurement', 'hrs',0,   NULL, TRUE, TRUE),
    (ct_ahu, 8, 'Visual inspection — casing, dampers, drain pan',  'true_false',  NULL, NULL,NULL, TRUE, FALSE);

  -- ── FCU TEMPLATE ──────────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_hvac, at_fcu, 'FCU Quarterly Inspection', 'Quarterly inspection for terminal fan coil units', u_admin)
    RETURNING id INTO ct_fcu;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_fcu, 1, 'Supply air temperature at diffuser',              'measurement', 'C',  14,  20,   TRUE, FALSE),
    (ct_fcu, 2, 'Filter condition — clean or replace if required', 'true_false',  NULL, NULL,NULL, TRUE, FALSE),
    (ct_fcu, 3, 'Coil condition — no fouling or corrosion',        'true_false',  NULL, NULL,NULL, TRUE, FALSE),
    (ct_fcu, 4, 'Condensate drain — clear and flowing freely',     'true_false',  NULL, NULL,NULL, TRUE, FALSE),
    (ct_fcu, 5, 'Visual inspection — casing, controls',            'true_false',  NULL, NULL,NULL, TRUE, FALSE);

  RAISE NOTICE 'HVAC templates created (7)';

  -- ── ASSET CHECKLISTS — loop over temp table rows ──────────────────────────

  FOR r IN SELECT graph_id, code FROM _hvac_nodes WHERE code IN ('CH-A1','CH-A2','CH-B1','CH-B2') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_hvac, r.graph_id, at_chl, trim(both '"' from r.code) || ' Monthly Inspection', ct_chl, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_chl ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _hvac_nodes WHERE code IN ('CT-A1','CT-A2','CT-B1','CT-B2') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_hvac, r.graph_id, at_ct, trim(both '"' from r.code) || ' Monthly Inspection', ct_ct, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_ct ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _hvac_nodes WHERE code IN ('CHWP-A1','CHWP-A2','CHWP-B1','CHWP-B2') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_hvac, r.graph_id, at_chwp, trim(both '"' from r.code) || ' Quarterly Inspection', ct_chwp, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_chwp ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _hvac_nodes WHERE code IN ('BLR-A1','BLR-A2','BLR-B1','BLR-B2') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_hvac, r.graph_id, at_blr, trim(both '"' from r.code) || ' Monthly Inspection', ct_blr, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_blr ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _hvac_nodes WHERE code IN ('HWP-A1','HWP-A2','HWP-B1','HWP-B2') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_hvac, r.graph_id, at_hwp, trim(both '"' from r.code) || ' Quarterly Inspection', ct_hwp, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_hwp ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _hvac_nodes WHERE code IN ('AHU-01','AHU-02','AHU-03','AHU-04') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_hvac, r.graph_id, at_ahu, trim(both '"' from r.code) || ' Monthly Inspection', ct_ahu, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_ahu ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _hvac_nodes WHERE code IN (
    'FCU-L1-01','FCU-L1-02','FCU-L2-01','FCU-L2-02',
    'FCU-L3-01','FCU-L3-02','FCU-L4-01','FCU-L4-02') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_hvac, r.graph_id, at_fcu, trim(both '"' from r.code) || ' Quarterly Inspection', ct_fcu, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_fcu ORDER BY sequence;
  END LOOP;

  RAISE NOTICE '=== 04b_seed_checklists_hvac.sql complete ===';
END;
$$;

DROP TABLE _hvac_nodes;
