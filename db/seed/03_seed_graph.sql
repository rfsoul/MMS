-- =============================================================================
-- 03_seed_graph.sql
-- Asset graph nodes (building hierarchy + all assets) and relationships
-- Run after: 02_seed_companies_users.sql
-- NOTE: cypher() cannot run inside DO $$ blocks — all calls are plain SQL
-- =============================================================================

LOAD 'age';
SET search_path = ag_catalog, '$user', public;

-- Guard: abort if the graph already has Asset nodes.
-- This prevents duplicate nodes if 03_seed_graph.sql is accidentally run twice.
-- To reseed, run 00_teardown.sql first (which drops and recreates the graph).
DO $guard03$
DECLARE existing_count INT;
BEGIN
  SELECT COUNT(*) INTO existing_count
  FROM cypher('asset_graph', $$ MATCH (n:Asset) RETURN n $$) AS (n agtype);
  IF existing_count > 0 THEN
    RAISE EXCEPTION '03: Graph already contains % Asset node(s). Run 00_teardown.sql before reseeding.', existing_count;
  END IF;
END $guard03$;

-- ── BUILDING HIERARCHY ────────────────────────────────────────────────────────

SELECT * FROM cypher('asset_graph', $$ CREATE (n:Site { name: 'Acme Corporate Park', code: 'ACP-SITE', description: 'Main corporate campus' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Building { name: 'Tower One', code: 'ACP-TWR1', description: '6-storey commercial office tower with basement plant' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Floor { name: 'Basement Level 1', code: 'B1', description: 'Basement plant room level' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Floor { name: 'Ground Floor', code: 'GF', description: 'Ground floor lobby and transport' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Floor { name: 'Level 1', code: 'L1', description: 'Level 1 office space' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Floor { name: 'Level 2', code: 'L2', description: 'Level 2 office space' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Floor { name: 'Level 3', code: 'L3', description: 'Level 3 office space' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Floor { name: 'Level 4', code: 'L4', description: 'Level 4 office space' }) RETURN id(n) $$) AS (r agtype);

-- ── SPACES ────────────────────────────────────────────────────────────────────

SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'B1 HVAC Plant Room', code: 'B1-HVAC' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'B1 Electrical Room', code: 'B1-ELEC' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'Ground Floor Lobby', code: 'GF-LOBBY' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'Ground Floor Transport Hub', code: 'GF-TRANS' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'Level 1 Office', code: 'L1-OFFICE' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'Level 2 Office', code: 'L2-OFFICE' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'Level 3 Office', code: 'L3-OFFICE' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Space { name: 'Level 4 Office', code: 'L4-OFFICE' }) RETURN id(n) $$) AS (r agtype);

-- ── ELECTRICAL ASSETS ─────────────────────────────────────────────────────────

SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Main Switchboard', code: 'MSB-01', status: 'active', description: '415V LV main switchboard 3200A incomer' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Switchgear Panel A', code: 'SWG-A', status: 'active', description: 'North riser switchgear distribution panel' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Switchgear Panel B', code: 'SWG-B', status: 'active', description: 'South riser switchgear distribution panel' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Power Factor Correction Unit', code: 'PFC-01', status: 'active', description: '250kVAr capacitor bank PFC unit' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'UPS Unit A', code: 'UPS-A', status: 'active', description: '60kVA UPS primary critical loads' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'UPS Unit B', code: 'UPS-B', status: 'active', description: '60kVA UPS secondary critical loads' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Distribution Board GF', code: 'DB-GF', status: 'active', description: 'Ground floor sub-distribution board' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Distribution Board L1', code: 'DB-L1', status: 'active', description: 'Level 1 sub-distribution board' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Distribution Board L2', code: 'DB-L2', status: 'active', description: 'Level 2 sub-distribution board' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Distribution Board L3', code: 'DB-L3', status: 'active', description: 'Level 3 sub-distribution board' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Distribution Board L4', code: 'DB-L4', status: 'active', description: 'Level 4 sub-distribution board' }) RETURN id(n) $$) AS (r agtype);

-- ── HVAC ASSETS ───────────────────────────────────────────────────────────────

SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chiller A1', code: 'CH-A1', status: 'active', description: '500kW water-cooled chiller circuit A duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chiller A2', code: 'CH-A2', status: 'active', description: '500kW water-cooled chiller circuit A standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chiller B1', code: 'CH-B1', status: 'active', description: '500kW water-cooled chiller circuit B duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chiller B2', code: 'CH-B2', status: 'active', description: '500kW water-cooled chiller circuit B standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Cooling Tower A1', code: 'CT-A1', status: 'active', description: 'Cooling tower circuit A duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Cooling Tower A2', code: 'CT-A2', status: 'active', description: 'Cooling tower circuit A standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Cooling Tower B1', code: 'CT-B1', status: 'active', description: 'Cooling tower circuit B duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Cooling Tower B2', code: 'CT-B2', status: 'active', description: 'Cooling tower circuit B standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chilled Water Pump A1', code: 'CHWP-A1', status: 'active', description: 'CHW pump circuit A duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chilled Water Pump A2', code: 'CHWP-A2', status: 'active', description: 'CHW pump circuit A standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chilled Water Pump B1', code: 'CHWP-B1', status: 'active', description: 'CHW pump circuit B duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Chilled Water Pump B2', code: 'CHWP-B2', status: 'active', description: 'CHW pump circuit B standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Boiler A1', code: 'BLR-A1', status: 'active', description: '400kW condensing boiler circuit A duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Boiler A2', code: 'BLR-A2', status: 'active', description: '400kW condensing boiler circuit A standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Boiler B1', code: 'BLR-B1', status: 'active', description: '400kW condensing boiler circuit B duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Boiler B2', code: 'BLR-B2', status: 'active', description: '400kW condensing boiler circuit B standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Hot Water Pump A1', code: 'HWP-A1', status: 'active', description: 'HW pump circuit A duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Hot Water Pump A2', code: 'HWP-A2', status: 'active', description: 'HW pump circuit A standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Hot Water Pump B1', code: 'HWP-B1', status: 'active', description: 'HW pump circuit B duty' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Hot Water Pump B2', code: 'HWP-B2', status: 'active', description: 'HW pump circuit B standby' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'AHU-01', code: 'AHU-01', status: 'active', description: 'Air handling unit Level 1 zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'AHU-02', code: 'AHU-02', status: 'active', description: 'Air handling unit Level 2 zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'AHU-03', code: 'AHU-03', status: 'active', description: 'Air handling unit Level 3 zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'AHU-04', code: 'AHU-04', status: 'active', description: 'Air handling unit Level 4 zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L1-01', code: 'FCU-L1-01', status: 'active', description: 'Level 1 FCU north zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L1-02', code: 'FCU-L1-02', status: 'active', description: 'Level 1 FCU south zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L2-01', code: 'FCU-L2-01', status: 'active', description: 'Level 2 FCU north zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L2-02', code: 'FCU-L2-02', status: 'active', description: 'Level 2 FCU south zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L3-01', code: 'FCU-L3-01', status: 'active', description: 'Level 3 FCU north zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L3-02', code: 'FCU-L3-02', status: 'active', description: 'Level 3 FCU south zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L4-01', code: 'FCU-L4-01', status: 'active', description: 'Level 4 FCU north zone' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'FCU-L4-02', code: 'FCU-L4-02', status: 'active', description: 'Level 4 FCU south zone' }) RETURN id(n) $$) AS (r agtype);

-- ── VERTICAL TRANSPORT ────────────────────────────────────────────────────────

SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Lift A', code: 'LIFT-A', status: 'active', description: 'Passenger lift A 16 person B1 to L4' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Lift B', code: 'LIFT-B', status: 'active', description: 'Passenger lift B 16 person B1 to L4' }) RETURN id(n) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ CREATE (n:Asset { name: 'Escalator GF-L1', code: 'ESC-01', status: 'active', description: 'Escalator ground floor to level 1' }) RETURN id(n) $$) AS (r agtype);

-- ── RELATIONSHIPS — all via MATCH by code ─────────────────────────────────────

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Site {code:'ACP-SITE'}), (b:Building {code:'ACP-TWR1'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Building {code:'ACP-TWR1'}), (b:Floor {code:'B1'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Building {code:'ACP-TWR1'}), (b:Floor {code:'GF'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Building {code:'ACP-TWR1'}), (b:Floor {code:'L1'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Building {code:'ACP-TWR1'}), (b:Floor {code:'L2'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Building {code:'ACP-TWR1'}), (b:Floor {code:'L3'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Building {code:'ACP-TWR1'}), (b:Floor {code:'L4'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'B1'}), (b:Space {code:'B1-HVAC'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'B1'}), (b:Space {code:'B1-ELEC'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'GF'}), (b:Space {code:'GF-LOBBY'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'GF'}), (b:Space {code:'GF-TRANS'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'L1'}), (b:Space {code:'L1-OFFICE'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'L2'}), (b:Space {code:'L2-OFFICE'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'L3'}), (b:Space {code:'L3-OFFICE'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Floor {code:'L4'}), (b:Space {code:'L4-OFFICE'}) CREATE (a)-[:CONTAINS]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-ELEC'}), (b:Asset {code:'MSB-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-ELEC'}), (b:Asset {code:'SWG-A'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-ELEC'}), (b:Asset {code:'SWG-B'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-ELEC'}), (b:Asset {code:'PFC-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-ELEC'}), (b:Asset {code:'UPS-A'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-ELEC'}), (b:Asset {code:'UPS-B'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'GF-LOBBY'}), (b:Asset {code:'DB-GF'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L1-OFFICE'}), (b:Asset {code:'DB-L1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L2-OFFICE'}), (b:Asset {code:'DB-L2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L3-OFFICE'}), (b:Asset {code:'DB-L3'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L4-OFFICE'}), (b:Asset {code:'DB-L4'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'MSB-01'}), (b:Asset {code:'SWG-A'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'MSB-01'}), (b:Asset {code:'SWG-B'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'MSB-01'}), (b:Asset {code:'PFC-01'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'SWG-A'}), (b:Asset {code:'DB-GF'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'SWG-A'}), (b:Asset {code:'DB-L1'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'SWG-A'}), (b:Asset {code:'DB-L2'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'SWG-B'}), (b:Asset {code:'DB-L3'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'SWG-B'}), (b:Asset {code:'DB-L4'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'SWG-B'}), (b:Asset {code:'UPS-A'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'SWG-B'}), (b:Asset {code:'UPS-B'}) CREATE (a)-[:FEEDS]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CH-A1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CH-A2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CH-B1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CH-B2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CT-A1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CT-A2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CT-B1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CT-B2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CHWP-A1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CHWP-A2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CHWP-B1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'CHWP-B2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'BLR-A1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'BLR-A2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'BLR-B1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'BLR-B2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'HWP-A1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'HWP-A2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'HWP-B1'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'B1-HVAC'}), (b:Asset {code:'HWP-B2'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-A1'}), (b:Asset {code:'CT-A1'}) CREATE (a)-[:REJECTS_HEAT_TO]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-A2'}), (b:Asset {code:'CT-A2'}) CREATE (a)-[:REJECTS_HEAT_TO]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-B1'}), (b:Asset {code:'CT-B1'}) CREATE (a)-[:REJECTS_HEAT_TO]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-B2'}), (b:Asset {code:'CT-B2'}) CREATE (a)-[:REJECTS_HEAT_TO]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-A1'}), (b:Asset {code:'CHWP-A1'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-A2'}), (b:Asset {code:'CHWP-A2'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-B1'}), (b:Asset {code:'CHWP-B1'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CH-B2'}), (b:Asset {code:'CHWP-B2'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'BLR-A1'}), (b:Asset {code:'HWP-A1'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'BLR-A2'}), (b:Asset {code:'HWP-A2'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'BLR-B1'}), (b:Asset {code:'HWP-B1'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'BLR-B2'}), (b:Asset {code:'HWP-B2'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L1-OFFICE'}), (b:Asset {code:'AHU-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L2-OFFICE'}), (b:Asset {code:'AHU-02'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L3-OFFICE'}), (b:Asset {code:'AHU-03'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L4-OFFICE'}), (b:Asset {code:'AHU-04'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CHWP-A1'}), (b:Asset {code:'AHU-01'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CHWP-A1'}), (b:Asset {code:'AHU-02'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CHWP-B1'}), (b:Asset {code:'AHU-03'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'CHWP-B1'}), (b:Asset {code:'AHU-04'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'HWP-A1'}), (b:Asset {code:'AHU-01'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'HWP-A1'}), (b:Asset {code:'AHU-02'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'HWP-B1'}), (b:Asset {code:'AHU-03'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'HWP-B1'}), (b:Asset {code:'AHU-04'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L1-OFFICE'}), (b:Asset {code:'FCU-L1-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L1-OFFICE'}), (b:Asset {code:'FCU-L1-02'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L2-OFFICE'}), (b:Asset {code:'FCU-L2-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L2-OFFICE'}), (b:Asset {code:'FCU-L2-02'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L3-OFFICE'}), (b:Asset {code:'FCU-L3-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L3-OFFICE'}), (b:Asset {code:'FCU-L3-02'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L4-OFFICE'}), (b:Asset {code:'FCU-L4-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'L4-OFFICE'}), (b:Asset {code:'FCU-L4-02'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-01'}), (b:Asset {code:'FCU-L1-01'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-01'}), (b:Asset {code:'FCU-L1-02'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-02'}), (b:Asset {code:'FCU-L2-01'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-02'}), (b:Asset {code:'FCU-L2-02'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-03'}), (b:Asset {code:'FCU-L3-01'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-03'}), (b:Asset {code:'FCU-L3-02'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-04'}), (b:Asset {code:'FCU-L4-01'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Asset {code:'AHU-04'}), (b:Asset {code:'FCU-L4-02'}) CREATE (a)-[:SERVES]->(b) $$) AS (r agtype);

SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'GF-TRANS'}), (b:Asset {code:'LIFT-A'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'GF-TRANS'}), (b:Asset {code:'LIFT-B'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);
SELECT * FROM cypher('asset_graph', $$ MATCH (a:Space {code:'GF-TRANS'}), (b:Asset {code:'ESC-01'}) CREATE (a)-[:HAS_ASSET]->(b) $$) AS (r agtype);

DO $$ BEGIN RAISE NOTICE '=== 03_seed_graph.sql complete ==='; END $$;
