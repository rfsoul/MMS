-- =============================================================================
-- 04c_seed_checklists_vtransport.sql
-- Checklist templates + asset checklists for Acme Vertical Transport
-- Run after: 04b_seed_checklists_hvac.sql
-- =============================================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

DROP TABLE IF EXISTS _vt_nodes;
CREATE TEMP TABLE _vt_nodes AS
SELECT DISTINCT ON (code) trim(both '"' from code::text) AS code, trim(both '"' from id::text) AS graph_id FROM cypher('asset_graph', $$
  MATCH (n:Asset) WHERE n.code IN ['LIFT-A','LIFT-B','ESC-01']
  RETURN n.code, id(n)
$$) AS (code agtype, id agtype)
ORDER BY code;

DO $check04c$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM _vt_nodes;
  RAISE NOTICE '04c: _vt_nodes has % rows (expected 3)', n;
  IF n = 0 THEN
    RAISE EXCEPTION '04c: _vt_nodes is empty — run 03_seed_graph.sql first';
  END IF;
END $check04c$;

DO $$
DECLARE
  co_vt UUID; u_admin UUID;
  at_lift UUID; at_esc UUID;
  ct_lift UUID; ct_esc UUID;
  ac_id UUID; r RECORD;
BEGIN
  SELECT id INTO co_vt   FROM companies WHERE name = 'Acme Vertical Transport';
  SELECT id INTO u_admin FROM users WHERE email = 'admin@acme-vt.com.au';
  SELECT id INTO at_lift FROM asset_types WHERE name = 'Lift'      AND company_id = co_vt;
  SELECT id INTO at_esc  FROM asset_types WHERE name = 'Escalator' AND company_id = co_vt;

  IF co_vt   IS NULL THEN RAISE EXCEPTION '04c: Acme Vertical Transport company not found — run 02_seed first'; END IF;
  IF at_lift IS NULL THEN RAISE EXCEPTION '04c: asset_type Lift not found'; END IF;
  IF at_esc  IS NULL THEN RAISE EXCEPTION '04c: asset_type Escalator not found'; END IF;

  -- ── LIFT TEMPLATE ─────────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_vt, at_lift, 'Lift Monthly Inspection', 'Monthly statutory inspection checklist for passenger lifts', u_admin)
    RETURNING id INTO ct_lift;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_lift, 1, 'Door operation — opening, closing, reversal test',      'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_lift, 2, 'Floor levelling accuracy',                              'measurement', 'mm', 0,    10,   TRUE, FALSE),
    (ct_lift, 3, 'Safety circuit test — all safety devices active',       'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_lift, 4, 'Machine room oil level — sight glass check',            'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_lift, 5, 'Motor temperature under load',                          'measurement', 'C',  0,    80,   TRUE, FALSE),
    (ct_lift, 6, 'Brake operation and adjustment check',                  'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_lift, 7, 'Cumulative runtime hours',                              'measurement', 'hrs',0,    NULL, TRUE, TRUE),
    (ct_lift, 8, 'Visual inspection — car, shaft, machine room',          'true_false',  NULL, NULL, NULL, TRUE, FALSE);

  -- ── ESCALATOR TEMPLATE ────────────────────────────────────────────────────
  INSERT INTO asset_type_checklist_templates (company_id, asset_type_id, name, description, created_by)
    VALUES (co_vt, at_esc, 'Escalator Monthly Inspection', 'Monthly statutory inspection checklist for escalators', u_admin)
    RETURNING id INTO ct_esc;
  INSERT INTO asset_type_checklist_template_items (template_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger) VALUES
    (ct_esc, 1, 'Step condition — no cracks, chips or misalignment',     'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_esc, 2, 'Handrail tension and speed synchronisation',            'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_esc, 3, 'Lubrication — steps, tracks and drive chain',           'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_esc, 4, 'Safety devices test — comb plate, handrail entry',      'true_false',  NULL, NULL, NULL, TRUE, FALSE),
    (ct_esc, 5, 'Drive motor run amps',                                  'measurement', 'A',  0,    40,   TRUE, FALSE),
    (ct_esc, 6, 'Cumulative runtime hours',                              'measurement', 'hrs',0,    NULL, TRUE, TRUE),
    (ct_esc, 7, 'Visual inspection — balustrades, lighting, signage',    'true_false',  NULL, NULL, NULL, TRUE, FALSE);

  -- ── ASSET CHECKLISTS ──────────────────────────────────────────────────────
  FOR r IN SELECT graph_id, code FROM _vt_nodes WHERE code IN ('LIFT-A','LIFT-B') LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_vt, r.graph_id, at_lift, trim(both '"' from r.code) || ' Monthly Inspection', ct_lift, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_lift ORDER BY sequence;
  END LOOP;

  FOR r IN SELECT graph_id, code FROM _vt_nodes WHERE code = 'ESC-01' LOOP
    INSERT INTO asset_checklists (company_id, asset_graph_id, asset_type_id, name, source_template_id, created_by)
      VALUES (co_vt, r.graph_id, at_esc, 'ESC-01 Monthly Inspection', ct_esc, u_admin)
      RETURNING id INTO ac_id;
    INSERT INTO asset_checklist_items (checklist_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger)
      SELECT ac_id, sequence, label, item_type, unit, min_value, max_value, is_required, is_runtime_trigger FROM asset_type_checklist_template_items WHERE template_id = ct_esc ORDER BY sequence;
  END LOOP;

  RAISE NOTICE '=== 04c_seed_checklists_vtransport.sql complete ===';
END;
$$;

DROP TABLE _vt_nodes;
