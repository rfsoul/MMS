-- =============================================================================
-- 00_teardown.sql
-- Wipes all seed data in reverse dependency order.
-- Run this before re-seeding to get a clean state.
-- Does NOT drop tables or schema — just truncates data.
-- =============================================================================

-- Leaf tables first (no dependents), then up the tree to root tables

TRUNCATE TABLE
  asset_checklist_responses,
  pm_generated_work_orders,
  work_order_tasks,
  work_order_updates,
  work_orders,
  pm_schedules,
  asset_checklist_items,
  asset_checklists,
  asset_type_checklist_template_items,
  asset_type_checklist_templates,
  asset_types,
  inspection_attachments,
  inspections,
  issue_attachments,
  issue_status_history,
  maintenance_issues,
  reporters,
  symptom_categories,
  asset_locations,
  rooms,
  business_units,
  space_types,
  spatial_zones,
  users,
  companies
CASCADE;

-- Re-seed the AGE graph (drop and recreate the graph)
LOAD 'age';
SET search_path = ag_catalog, '$user', public;
SELECT drop_graph('asset_graph', true);
SELECT create_graph('asset_graph');

-- ─────────────────────────────────────────
-- Re-seed static lookup tables
-- These are truncated above but not in any numbered seed file.
-- Must be restored here so reseed (02–07) works without re-running 01_setup.sql.
-- ─────────────────────────────────────────

-- Help desk company (also created by 01_setup.sql)
INSERT INTO companies (name, is_help_desk)
  VALUES ('Global Help Desk', TRUE)
  ON CONFLICT DO NOTHING;

-- PM trigger types
INSERT INTO pm_trigger_types (code, label, category) VALUES
  ('calendar_daily',   'Daily',          'calendar'),
  ('calendar_weekly',  'Weekly',         'calendar'),
  ('calendar_monthly', 'Monthly',        'calendar'),
  ('calendar_yearly',  'Yearly',         'calendar'),
  ('runtime_hours',    'Runtime Hours',  'runtime'),
  ('runtime_kms',      'Runtime KMs',   'runtime'),
  ('runtime_cycles',   'Runtime Cycles', 'runtime')
ON CONFLICT (code) DO NOTHING;

-- Symptom categories
INSERT INTO symptom_categories (name, description) VALUES
  ('Electrical',  'Issues related to electrical systems and components'),
  ('Plumbing',    'Water, drainage and pipe-related faults'),
  ('HVAC',        'Heating, ventilation and air conditioning faults'),
  ('Structural',  'Building fabric, walls, floors, roofing'),
  ('Mechanical',  'Rotating equipment, motors, pumps, conveyors'),
  ('Fire Safety', 'Fire detection, suppression and evacuation systems'),
  ('Security',    'Access control, CCTV and alarm systems'),
  ('Cleaning',    'Cleaning and housekeeping related issues'),
  ('Other',       'Faults not covered by other categories')
ON CONFLICT (name) DO NOTHING;

-- Space types
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
  ('Other',             'Spaces not covered by other categories')
ON CONFLICT (name) DO NOTHING;

DO $$ BEGIN RAISE NOTICE '=== 00_teardown.sql complete — database is clean ==='; END $$;
