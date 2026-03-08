-- =============================================================================
-- 05_seed_pm_schedules.sql
-- PM schedules for all assets across all three companies
-- Run after: 04c_seed_checklists_vtransport.sql
-- =============================================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

CREATE TEMP TABLE _all_nodes AS
SELECT trim(both '"' from code::text) AS code, trim(both '"' from id::text) AS graph_id FROM cypher('asset_graph', $$
  MATCH (n:Asset)
  RETURN n.code, id(n)
$$) AS (code agtype, id agtype);

DO $$
DECLARE
  co_elec UUID; co_hvac UUID; co_vt UUID;
  u_elec  UUID; u_hvac  UUID; u_vt  UUID;
  at_msb UUID; at_swg UUID; at_pfc UUID; at_ups UUID; at_db  UUID;
  at_chl UUID; at_ct  UUID; at_blr UUID; at_chwp UUID; at_hwp UUID;
  at_ahu UUID; at_fcu UUID; at_lift UUID; at_esc UUID;
  tt_m1 UUID; tt_yr UUID;

BEGIN
  SELECT id INTO co_elec FROM companies WHERE name = 'Acme Electrical Services';
  SELECT id INTO co_hvac FROM companies WHERE name = 'Acme HVAC Services';
  SELECT id INTO co_vt   FROM companies WHERE name = 'Acme Vertical Transport';
  SELECT id INTO u_elec  FROM users WHERE email = 'admin@acme-electrical.com.au';
  SELECT id INTO u_hvac  FROM users WHERE email = 'admin@acme-hvac.com.au';
  SELECT id INTO u_vt    FROM users WHERE email = 'admin@acme-vt.com.au';

  SELECT id INTO at_msb  FROM asset_types WHERE name = 'Main Switchboard'        AND company_id = co_elec;
  SELECT id INTO at_swg  FROM asset_types WHERE name = 'Switchgear Panel'        AND company_id = co_elec;
  SELECT id INTO at_pfc  FROM asset_types WHERE name = 'Power Factor Correction' AND company_id = co_elec;
  SELECT id INTO at_ups  FROM asset_types WHERE name = 'UPS Battery Backup'      AND company_id = co_elec;
  SELECT id INTO at_db   FROM asset_types WHERE name = 'Distribution Board'      AND company_id = co_elec;
  SELECT id INTO at_chl  FROM asset_types WHERE name = 'Chiller'                 AND company_id = co_hvac;
  SELECT id INTO at_ct   FROM asset_types WHERE name = 'Cooling Tower'           AND company_id = co_hvac;
  SELECT id INTO at_blr  FROM asset_types WHERE name = 'Boiler'                  AND company_id = co_hvac;
  SELECT id INTO at_chwp FROM asset_types WHERE name = 'Chilled Water Pump'      AND company_id = co_hvac;
  SELECT id INTO at_hwp  FROM asset_types WHERE name = 'Hot Water Pump'          AND company_id = co_hvac;
  SELECT id INTO at_ahu  FROM asset_types WHERE name = 'Air Handling Unit'       AND company_id = co_hvac;
  SELECT id INTO at_fcu  FROM asset_types WHERE name = 'Fan Coil Unit'           AND company_id = co_hvac;
  SELECT id INTO at_lift FROM asset_types WHERE name = 'Lift'                    AND company_id = co_vt;
  SELECT id INTO at_esc  FROM asset_types WHERE name = 'Escalator'               AND company_id = co_vt;

  SELECT id INTO tt_m1 FROM pm_trigger_types WHERE code = 'calendar_monthly';
  SELECT id INTO tt_yr FROM pm_trigger_types WHERE code = 'calendar_yearly';

  -- ── ELECTRICAL ─────────────────────────────────────────────────────────────
  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_elec, graph_id, at_msb, 'MSB-01 Annual Inspection', 'Inspection', tt_yr, 1, '2025-01-01', '2024-12-31', u_elec
    FROM _all_nodes WHERE code = 'MSB-01';

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_elec, graph_id, at_swg, trim(both '"' from code) || ' 6-Monthly Inspection', 'Inspection', tt_m1, 6, '2025-01-01', '2024-12-31', u_elec
    FROM _all_nodes WHERE code IN ('SWG-A','SWG-B');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_elec, graph_id, at_swg, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_elec
    FROM _all_nodes WHERE code IN ('SWG-A','SWG-B');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_elec, graph_id, at_pfc, 'PFC-01 Quarterly Inspection', 'Inspection', tt_m1, 3, '2025-01-01', '2024-12-31', u_elec
    FROM _all_nodes WHERE code = 'PFC-01';

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_elec, graph_id, at_ups, trim(both '"' from code) || ' Monthly Inspection', 'Inspection', tt_m1, 1, '2025-01-01', '2024-12-31', u_elec
    FROM _all_nodes WHERE code IN ('UPS-A','UPS-B');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_elec, graph_id, at_ups, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_elec
    FROM _all_nodes WHERE code IN ('UPS-A','UPS-B');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_elec, graph_id, at_db, trim(both '"' from code) || ' Annual Inspection', 'Inspection', tt_yr, 1, '2025-01-01', '2024-12-31', u_elec
    FROM _all_nodes WHERE code IN ('DB-GF','DB-L1','DB-L2','DB-L3','DB-L4');

  RAISE NOTICE 'Electrical PM schedules created';

  -- ── HVAC ───────────────────────────────────────────────────────────────────
  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_chl, trim(both '"' from code) || ' Monthly Inspection', 'Inspection', tt_m1, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('CH-A1','CH-A2','CH-B1','CH-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_chl, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('CH-A1','CH-A2','CH-B1','CH-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_ct, trim(both '"' from code) || ' Monthly Inspection', 'Inspection', tt_m1, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('CT-A1','CT-A2','CT-B1','CT-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_ct, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('CT-A1','CT-A2','CT-B1','CT-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_blr, trim(both '"' from code) || ' Monthly Inspection', 'Inspection', tt_m1, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('BLR-A1','BLR-A2','BLR-B1','BLR-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_blr, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('BLR-A1','BLR-A2','BLR-B1','BLR-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_chwp, trim(both '"' from code) || ' Quarterly Inspection', 'Inspection', tt_m1, 3, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('CHWP-A1','CHWP-A2','CHWP-B1','CHWP-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_chwp, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('CHWP-A1','CHWP-A2','CHWP-B1','CHWP-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_hwp, trim(both '"' from code) || ' Quarterly Inspection', 'Inspection', tt_m1, 3, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('HWP-A1','HWP-A2','HWP-B1','HWP-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_hwp, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('HWP-A1','HWP-A2','HWP-B1','HWP-B2');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_ahu, trim(both '"' from code) || ' Monthly Inspection', 'Inspection', tt_m1, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('AHU-01','AHU-02','AHU-03','AHU-04');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_ahu, trim(both '"' from code) || ' Annual Overhaul', 'Overhaul', tt_yr, 1, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN ('AHU-01','AHU-02','AHU-03','AHU-04');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_hvac, graph_id, at_fcu, trim(both '"' from code) || ' Quarterly Inspection', 'Inspection', tt_m1, 3, '2025-01-01', '2024-12-31', u_hvac
    FROM _all_nodes WHERE code IN (
      'FCU-L1-01','FCU-L1-02','FCU-L2-01','FCU-L2-02',
      'FCU-L3-01','FCU-L3-02','FCU-L4-01','FCU-L4-02');

  RAISE NOTICE 'HVAC PM schedules created';

  -- ── VERTICAL TRANSPORT ─────────────────────────────────────────────────────
  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_vt, graph_id, at_lift, trim(both '"' from code) || ' Monthly Inspection', 'Inspection', tt_m1, 1, '2025-01-01', '2024-12-31', u_vt
    FROM _all_nodes WHERE code IN ('LIFT-A','LIFT-B');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_vt, graph_id, at_lift, trim(both '"' from code) || ' Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_vt
    FROM _all_nodes WHERE code IN ('LIFT-A','LIFT-B');

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_vt, graph_id, at_esc, 'ESC-01 Monthly Inspection', 'Inspection', tt_m1, 1, '2025-01-01', '2024-12-31', u_vt
    FROM _all_nodes WHERE code = 'ESC-01';

  INSERT INTO pm_schedules (company_id, asset_graph_id, asset_type_id, name, work_type, trigger_type_id, interval_value, starts_on, last_generated_date, created_by)
    SELECT co_vt, graph_id, at_esc, 'ESC-01 Annual Service', 'Service', tt_yr, 1, '2025-01-01', '2024-12-31', u_vt
    FROM _all_nodes WHERE code = 'ESC-01';

  RAISE NOTICE '=== 05_seed_pm_schedules.sql complete ===';
END;
$$;

DROP TABLE _all_nodes;
