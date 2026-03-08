-- =============================================================================
-- 02_seed_companies_users.sql
-- Companies, users and asset types
-- Run after: 01_setup.sql
--
-- Seed credentials:
--   Help desk admin : admin@mms.local       / Admin@123456
--   Company users   : <email>@acme-*.com.au / Acme@123456
-- =============================================================================

DO $$
DECLARE
  co_helpdesk    UUID;
  co_electrical  UUID;
  co_hvac        UUID;
  co_vtransport  UUID;
  pw_hash_admin  TEXT;
  pw_hash        TEXT;
BEGIN

  pw_hash_admin := crypt('Admin@123456', gen_salt('bf', 12));
  pw_hash       := crypt('Acme@123456',  gen_salt('bf', 12));

  -- ── HELP DESK COMPANY — already created by 01_setup.sql ──────────────────
  -- The schema seeds 'Global Help Desk' with is_help_desk = TRUE.
  -- Just look it up here — do not insert a second one.
  SELECT id INTO co_helpdesk FROM companies WHERE is_help_desk = TRUE LIMIT 1;

  IF co_helpdesk IS NULL THEN
    RAISE EXCEPTION 'Help desk company not found — ensure 01_setup.sql has been run first';
  END IF;

  -- ── HELP DESK ADMIN ───────────────────────────────────────────────────────
  -- Cross-company visibility. Used by the test harness.
  -- Login: admin@mms.local / Admin@123456
  INSERT INTO users (company_id, email, full_name, role, password_hash, password_changed_at, must_change_password, is_active) VALUES
    (co_helpdesk, 'admin@mms.local', 'MMS Administrator', 'help_desk_agent', pw_hash_admin, NOW(), FALSE, TRUE);

  RAISE NOTICE 'Help desk admin created: admin@mms.local';

  -- ── COMPANIES ────────────────────────────────────────────────────────────────
  INSERT INTO companies (name, address)
    VALUES ('Acme Electrical Services', '1 Power Street, Sydney NSW 2000')
    RETURNING id INTO co_electrical;

  INSERT INTO companies (name, address)
    VALUES ('Acme HVAC Services', '2 Climate Avenue, Sydney NSW 2000')
    RETURNING id INTO co_hvac;

  INSERT INTO companies (name, address)
    VALUES ('Acme Vertical Transport', '3 Elevator Lane, Sydney NSW 2000')
    RETURNING id INTO co_vtransport;

  RAISE NOTICE 'Companies created: %, %, %', co_electrical, co_hvac, co_vtransport;

  -- ── USERS — ELECTRICAL ───────────────────────────────────────────────────────
  INSERT INTO users (company_id, email, full_name, role, password_hash, password_changed_at, must_change_password, is_active) VALUES
    (co_electrical, 'admin@acme-electrical.com.au',   'Sarah Chen',    'admin',      pw_hash, NOW(), FALSE, TRUE),
    (co_electrical, 'manager@acme-electrical.com.au', 'David Kim',     'manager',    pw_hash, NOW(), FALSE, TRUE),
    (co_electrical, 'tech1@acme-electrical.com.au',   'James Wilson',  'technician', pw_hash, NOW(), FALSE, TRUE),
    (co_electrical, 'tech2@acme-electrical.com.au',   'Priya Sharma',  'technician', pw_hash, NOW(), FALSE, TRUE);

  -- ── USERS — HVAC ─────────────────────────────────────────────────────────────
  INSERT INTO users (company_id, email, full_name, role, password_hash, password_changed_at, must_change_password, is_active) VALUES
    (co_hvac, 'admin@acme-hvac.com.au',   'Michelle Torres', 'admin',      pw_hash, NOW(), FALSE, TRUE),
    (co_hvac, 'manager@acme-hvac.com.au', 'Robert Nguyen',   'manager',    pw_hash, NOW(), FALSE, TRUE),
    (co_hvac, 'tech1@acme-hvac.com.au',   'Lisa Park',       'technician', pw_hash, NOW(), FALSE, TRUE),
    (co_hvac, 'tech2@acme-hvac.com.au',   'Tom Brennan',     'technician', pw_hash, NOW(), FALSE, TRUE);

  -- ── USERS — VERTICAL TRANSPORT ───────────────────────────────────────────────
  INSERT INTO users (company_id, email, full_name, role, password_hash, password_changed_at, must_change_password, is_active) VALUES
    (co_vtransport, 'admin@acme-vt.com.au',   'Karen Walsh',  'admin',      pw_hash, NOW(), FALSE, TRUE),
    (co_vtransport, 'manager@acme-vt.com.au', 'Marcus Lee',   'manager',    pw_hash, NOW(), FALSE, TRUE),
    (co_vtransport, 'tech1@acme-vt.com.au',   'Amy Zhang',    'technician', pw_hash, NOW(), FALSE, TRUE),
    (co_vtransport, 'tech2@acme-vt.com.au',   'Ben Okafor',   'technician', pw_hash, NOW(), FALSE, TRUE);

  RAISE NOTICE 'Users created (13 total — 1 help desk + 12 company)';

  -- ── ASSET TYPES — ELECTRICAL ─────────────────────────────────────────────────
  INSERT INTO asset_types (company_id, name, description) VALUES
    (co_electrical, 'Main Switchboard',        '415V LV main switchboard — point of supply for the building'),
    (co_electrical, 'Switchgear Panel',        'HV/LV switchgear distribution panel'),
    (co_electrical, 'Power Factor Correction', 'Capacitor bank PFC unit for power quality improvement'),
    (co_electrical, 'UPS Battery Backup',      'Uninterruptible power supply with battery backup'),
    (co_electrical, 'Distribution Board',      'Sub-distribution board feeding floor circuits');

  -- ── ASSET TYPES — HVAC ───────────────────────────────────────────────────────
  INSERT INTO asset_types (company_id, name, description) VALUES
    (co_hvac, 'Chiller',            'Water-cooled centrifugal chiller unit'),
    (co_hvac, 'Cooling Tower',      'Evaporative cooling tower for condenser heat rejection'),
    (co_hvac, 'Boiler',             'Condensing gas-fired hot water boiler'),
    (co_hvac, 'Chilled Water Pump', 'Variable speed pump for chilled water distribution'),
    (co_hvac, 'Hot Water Pump',     'Variable speed pump for hot water distribution'),
    (co_hvac, 'Air Handling Unit',  'Central AHU providing conditioned air to floor zones'),
    (co_hvac, 'Fan Coil Unit',      'Terminal FCU for zone-level temperature control');

  -- ── ASSET TYPES — VERTICAL TRANSPORT ─────────────────────────────────────────
  INSERT INTO asset_types (company_id, name, description) VALUES
    (co_vtransport, 'Lift',      'Passenger lift / elevator'),
    (co_vtransport, 'Escalator', 'Moving staircase escalator');

  RAISE NOTICE 'Asset types created (14 total)';
  RAISE NOTICE '=== 02_seed_companies_users.sql complete ===';

END;
$$;
