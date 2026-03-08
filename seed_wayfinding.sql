-- =============================================================================
-- pgRouting Indoor/Outdoor Wayfinding — Seed Data
-- SRID: 7856 (GDA2020 / MGA zone 56, units: metres)
--
-- Scenario: A 2-storey building with an outdoor plaza connecting to a
--           second building entrance. Showcases all design choices:
--
--   Spaces
--   ├── Building A, Floor 1
--   │   ├── Lobby / Entrance         (transition indoor↔outdoor)
--   │   ├── Corridor A1              (single floor)
--   │   ├── Room 101                 (single floor, door: open)
--   │   ├── Room 102                 (single floor, door: access_controlled)
--   │   ├── Lift Shaft               (multi-floor: 1–2, 2 floor nodes)
--   │   ├── Stairwell                (multi-floor: 1–2, 2 floor nodes)
--   │   ├── Escalator Up   F1→F2     (directed, non-accessible)
--   │   ├── Escalator Down F2→F1     (directed, non-accessible)
--   │   └── Atrium                   (multi-floor: 1–2, only F1 routable)
--   ├── Building A, Floor 2
--   │   ├── Corridor A2              (single floor)
--   │   ├── Room 201                 (single floor, door: open)
--   │   └── Room 202                 (single floor, door: locked)
--   └── Outdoor
--       ├── Building A Entrance      (threshold point)
--       ├── Outdoor Plaza            (open area)
--       └── Building B Entrance      (threshold point)
--
-- All coordinates are fictitious but valid GDA2020/MGA56 easting/northing (m).
-- Origin ~(320000, 6850000) — a generic urban block in zone 56.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- -----------------------------------------------------------------------------
-- 1. Routing cost config
-- -----------------------------------------------------------------------------
INSERT INTO routing_cost_config (connection_type, cost_per_floor, fixed_penalty) VALUES
    ('stair',     25.0,  0.0),
    ('escalator', 15.0,  0.0),
    ('lift',       8.0, 30.0)
ON CONFLICT (connection_type) DO NOTHING;

-- =============================================================================
-- 2. SPACES
--    Geometries are MULTIPOLYGON(7856). Single-floor spaces have
--    floor_level_min = floor_level_max. Multi-floor spaces span levels.
--
--    Coordinate grid (approximate, metres):
--
--       320000                320060
--    6850060 ┌──────────────────┐  ← Floor plates ~60m × 40m
--            │  Building A      │
--    6850020 └──────────────────┘
--                                     320070  320120
--    6850060                        ┌──────────┐
--                                   │Building B│
--    6850020                        └──────────┘
--    6850000 ← outdoor plaza between buildings
-- =============================================================================

-- ── BUILDING A / FLOOR 1 ─────────────────────────────────────────────────────

-- Lobby / Entrance  (10m × 8m, south end of building — straddles indoor/outdoor)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(1, 'Lobby / Entrance', 'lobby', false, 1, 1,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320000 6850020, 320010 6850020, 320010 6850028, 320000 6850028, 320000 6850020))',
   7856)));

-- Corridor A1  (40m × 3m, running east–west along floor 1)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(2, 'Corridor A1', 'corridor', false, 1, 1,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320010 6850023, 320050 6850023, 320050 6850026, 320010 6850026, 320010 6850023))',
   7856)));

-- Room 101  (10m × 8m, north side)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(3, 'Room 101', 'room', false, 1, 1,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320010 6850026, 320020 6850026, 320020 6850034, 320010 6850034, 320010 6850026))',
   7856)));

-- Room 102  (10m × 8m, north side, access-controlled door)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(4, 'Room 102', 'room', false, 1, 1,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320020 6850026, 320030 6850026, 320030 6850034, 320020 6850034, 320020 6850026))',
   7856)));

-- Lift Shaft  (4m × 4m — MULTI-FLOOR 1–2, floor nodes at each level)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(5, 'Lift Shaft', 'lift', false, 1, 2,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320046 6850026, 320050 6850026, 320050 6850030, 320046 6850030, 320046 6850026))',
   7856)));

-- Stairwell  (4m × 5m — MULTI-FLOOR 1–2)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(6, 'Stairwell', 'stair', false, 1, 2,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320040 6850026, 320046 6850026, 320046 6850031, 320040 6850031, 320040 6850026))',
   7856)));

-- Escalator (shared shaft, 3m × 4m — MULTI-FLOOR 1–2)
-- Up and Down are separate *connections*, not separate spaces.
-- The physical escalator shaft is one space with floor nodes at each end.
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(7, 'Escalator Shaft', 'escalator', false, 1, 2,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320034 6850026, 320040 6850026, 320040 6850030, 320034 6850030, 320034 6850026))',
   7856)));

-- Atrium  (12m × 10m — MULTI-FLOOR 1–2, but only floor 1 is routable)
-- Represents a double-height void; you can walk around the ground level only.
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(8, 'Atrium', 'open_area', false, 1, 2,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320010 6850034, 320022 6850034, 320022 6850044, 320010 6850044, 320010 6850034))',
   7856)));

-- ── BUILDING A / FLOOR 2 ─────────────────────────────────────────────────────

-- Corridor A2  (40m × 3m, same footprint as A1 but floor 2)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(9, 'Corridor A2', 'corridor', false, 2, 2,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320010 6850023, 320050 6850023, 320050 6850026, 320010 6850026, 320010 6850023))',
   7856)));

-- Room 201  (10m × 8m, north side floor 2)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(10, 'Room 201', 'room', false, 2, 2,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320010 6850026, 320020 6850026, 320020 6850034, 320010 6850034, 320010 6850026))',
   7856)));

-- Room 202  (10m × 8m, north side floor 2, door is LOCKED)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(11, 'Room 202', 'room', false, 2, 2,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320020 6850026, 320030 6850026, 320030 6850034, 320020 6850034, 320020 6850026))',
   7856)));

-- ── OUTDOOR ──────────────────────────────────────────────────────────────────

-- Outdoor Plaza  (connects Building A south face to Building B entrance)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(12, 'Outdoor Plaza', 'outdoor_plaza', true, 0, 0,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320000 6850010, 320120 6850010, 320120 6850020, 320000 6850020, 320000 6850010))',
   7856)));

-- Outdoor Path  (10m wide path running east across the plaza)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(13, 'Outdoor Path', 'outdoor_path', true, 0, 0,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320005 6850010, 320070 6850010, 320070 6850020, 320005 6850020, 320005 6850010))',
   7856)));

-- Building B Entrance  (small entrance lobby, floor 1)
INSERT INTO spaces (id, name, space_type, is_outdoor, floor_level_min, floor_level_max, geom) VALUES
(14, 'Building B Entrance', 'entrance', false, 1, 1,
 ST_Multi(ST_GeomFromText(
   'POLYGON((320070 6850020, 320080 6850020, 320080 6850028, 320070 6850028, 320070 6850020))',
   7856)));

-- =============================================================================
-- 3. SPACE FLOOR NODES
--    One row per (space, floor_level) that is actually routable.
--    Point placed at the centroid of the floor-level footprint.
--    Multi-floor spaces get one node per accessible floor.
--    The atrium only gets a node on floor 1 (floor 2 void is not routable).
-- =============================================================================

INSERT INTO space_floor_nodes (id, space_id, floor_level, geom) VALUES
-- Floor 1 nodes
( 1,  1, 1, ST_GeomFromText('POINT(320005 6850024)', 7856)),  -- Lobby
( 2,  2, 1, ST_GeomFromText('POINT(320030 6850024)', 7856)),  -- Corridor A1
( 3,  3, 1, ST_GeomFromText('POINT(320015 6850030)', 7856)),  -- Room 101
( 4,  4, 1, ST_GeomFromText('POINT(320025 6850030)', 7856)),  -- Room 102
( 5,  5, 1, ST_GeomFromText('POINT(320048 6850028)', 7856)),  -- Lift F1
( 6,  6, 1, ST_GeomFromText('POINT(320043 6850028)', 7856)),  -- Stairwell F1
( 7,  7, 1, ST_GeomFromText('POINT(320037 6850028)', 7856)),  -- Escalator F1
( 8,  8, 1, ST_GeomFromText('POINT(320016 6850039)', 7856)),  -- Atrium F1 only

-- Floor 2 nodes
( 9,  5, 2, ST_GeomFromText('POINT(320048 6850028)', 7856)),  -- Lift F2
(10,  6, 2, ST_GeomFromText('POINT(320043 6850028)', 7856)),  -- Stairwell F2
(11,  7, 2, ST_GeomFromText('POINT(320037 6850028)', 7856)),  -- Escalator F2
(12,  9, 2, ST_GeomFromText('POINT(320030 6850024)', 7856)),  -- Corridor A2
(13, 10, 2, ST_GeomFromText('POINT(320015 6850030)', 7856)),  -- Room 201
(14, 11, 2, ST_GeomFromText('POINT(320025 6850030)', 7856)),  -- Room 202

-- Floor 0 / outdoor nodes
(15, 12, 0, ST_GeomFromText('POINT(320060 6850015)', 7856)),  -- Outdoor Plaza
(16, 13, 0, ST_GeomFromText('POINT(320037 6850015)', 7856)),  -- Outdoor Path
(17, 14, 1, ST_GeomFromText('POINT(320075 6850024)', 7856));  -- Building B Entrance

-- =============================================================================
-- 4. DOORS
--    Physical door entities with state.
--    Showcases: open, access_controlled, locked, closed states.
-- =============================================================================

INSERT INTO doors (id, name, state, accessible, geom) VALUES
(1, 'Lobby Front Door',     'open',              true,  ST_GeomFromText('POINT(320005 6850020)', 7856)),
(2, 'Room 101 Door',        'open',              true,  ST_GeomFromText('POINT(320015 6850026)', 7856)),
(3, 'Room 102 Door',        'access_controlled', true,  ST_GeomFromText('POINT(320025 6850026)', 7856)),
(4, 'Room 201 Door',        'open',              true,  ST_GeomFromText('POINT(320015 6850026)', 7856)),
(5, 'Room 202 Door',        'locked',            false, ST_GeomFromText('POINT(320025 6850026)', 7856)),
(6, 'Building B Front Door','open',              true,  ST_GeomFromText('POINT(320070 6850024)', 7856));

-- =============================================================================
-- 5. SPACE CONNECTIONS  (edges for pgRouting)
--
--    source = from_node_id, target = to_node_id  (space_floor_nodes.id)
--    cost / reverse_cost in metres (or metre-equivalent for vertical travel)
--
--    Connection types demonstrated:
--      door          — corridor ↔ room through a physical door
--      open          — lobby ↔ corridor, no door (open adjacency)
--      lift          — bidirectional, fixed penalty + per-floor cost
--      stair         — bidirectional, per-floor cost, accessible
--      escalator     — directed (two rows for up/down), non-accessible
--      outdoor_path  — indoor entrance ↔ outdoor and across plaza
-- =============================================================================

INSERT INTO space_connections
    (id, from_node_id, to_node_id, connection_type, door_id, is_bidirectional, cost, reverse_cost, accessible,
     geom) VALUES

-- ── FLOOR 1: open adjacencies & doors ───────────────────────────────────────

-- 1. Lobby → Corridor A1  (open adjacency, ~25m walk)
(1,  1,  2, 'open',  NULL, true,  25.0, 25.0, true,
 ST_GeomFromText('LINESTRING(320005 6850024, 320030 6850024)', 7856)),

-- 2. Corridor A1 → Room 101  (door: open, ~6m)
(2,  2,  3, 'door',  2,    true,   6.0,  6.0, true,
 ST_GeomFromText('LINESTRING(320030 6850024, 320015 6850030)', 7856)),

-- 3. Corridor A1 → Room 102  (door: access_controlled, ~6m)
(3,  2,  4, 'door',  3,    true,   6.0,  6.0, true,
 ST_GeomFromText('LINESTRING(320030 6850024, 320025 6850030)', 7856)),

-- 4. Corridor A1 → Atrium F1  (open adjacency, ~16m — atrium has no door)
(4,  2,  8, 'open',  NULL, true,  16.0, 16.0, true,
 ST_GeomFromText('LINESTRING(320030 6850024, 320016 6850039)', 7856)),

-- ── FLOOR 2: open adjacencies & doors ───────────────────────────────────────

-- 5. Corridor A2 → Room 201  (door: open, ~6m)
(5, 12, 13, 'door',  4,    true,   6.0,  6.0, true,
 ST_GeomFromText('LINESTRING(320030 6850024, 320015 6850030)', 7856)),

-- 6. Corridor A2 → Room 202  (door: locked — router excludes at query time)
(6, 12, 14, 'door',  5,    true,   6.0,  6.0, false,
 ST_GeomFromText('LINESTRING(320030 6850024, 320025 6850030)', 7856)),

-- ── LIFT: Floor 1 ↔ Floor 2  (bidirectional, accessible) ────────────────────
-- cost = (lift cost_per_floor × 1 floor) + fixed_penalty = 8 + 30 = 38m equiv

-- 7. Corridor A1 → Lift F1  (open adjacency into lift lobby)
(7,  2,  5, 'open',  NULL, true,   3.0,  3.0, true,
 ST_GeomFromText('LINESTRING(320030 6850024, 320048 6850028)', 7856)),

-- 8. Lift F1 → Lift F2  (vertical travel)
(8,  5,  9, 'lift',  NULL, true,  38.0, 38.0, true,
 ST_GeomFromText('LINESTRING(320048 6850028, 320048 6850028)', 7856)),

-- 9. Lift F2 → Corridor A2  (open adjacency out of lift)
(9,  9, 12, 'open',  NULL, true,   3.0,  3.0, true,
 ST_GeomFromText('LINESTRING(320048 6850028, 320030 6850024)', 7856)),

-- ── STAIRWELL: Floor 1 ↔ Floor 2  (bidirectional, accessible) ───────────────
-- cost = stair cost_per_floor × 1 = 25m equiv

-- 10. Corridor A1 → Stairwell F1
(10,  2,  6, 'open',  NULL, true,   2.0,  2.0, true,
 ST_GeomFromText('LINESTRING(320030 6850024, 320043 6850028)', 7856)),

-- 11. Stairwell F1 → Stairwell F2  (vertical)
(11,  6, 10, 'stair', NULL, true,  25.0, 25.0, true,
 ST_GeomFromText('LINESTRING(320043 6850028, 320043 6850028)', 7856)),

-- 12. Stairwell F2 → Corridor A2
(12, 10, 12, 'open',  NULL, true,   2.0,  2.0, true,
 ST_GeomFromText('LINESTRING(320043 6850028, 320030 6850024)', 7856)),

-- ── ESCALATORS: directed, non-accessible ─────────────────────────────────────
-- cost = escalator cost_per_floor × 1 = 15m equiv
-- reverse_cost = 1e9 (one-way — going wrong way is effectively impossible)

-- 13. Escalator UP: Escalator F1 → Escalator F2
(13,  7, 11, 'escalator', NULL, false, 15.0, 1e9, false,
 ST_GeomFromText('LINESTRING(320037 6850028, 320037 6850028)', 7856)),

-- 14. Escalator DOWN: Escalator F2 → Escalator F1
--     This is the paired down escalator (separate directed edge)
(14, 11,  7, 'escalator', NULL, false, 15.0, 1e9, false,
 ST_GeomFromText('LINESTRING(320037 6850028, 320037 6850028)', 7856)),

-- 15. Corridor A1 → Escalator F1 (open adjacency)
(15,  2,  7, 'open',  NULL, true,   2.0,  2.0, false,
 ST_GeomFromText('LINESTRING(320030 6850024, 320037 6850028)', 7856)),

-- 16. Escalator F2 → Corridor A2 (open adjacency)
(16, 11, 12, 'open',  NULL, true,   2.0,  2.0, false,
 ST_GeomFromText('LINESTRING(320037 6850028, 320030 6850024)', 7856)),

-- ── INDOOR → OUTDOOR transition ──────────────────────────────────────────────
-- Lobby ↔ Outdoor Path via front door (open state)

-- 17. Lobby → Outdoor Path  (door: Lobby Front Door, ~9m to plaza threshold)
(17,  1, 16, 'door',  1, true,  9.0,  9.0, true,
 ST_GeomFromText('LINESTRING(320005 6850024, 320037 6850015)', 7856)),

-- ── OUTDOOR connections ───────────────────────────────────────────────────────

-- 18. Outdoor Path → Outdoor Plaza  (open, ~23m)
(18, 16, 15, 'outdoor_path', NULL, true, 23.0, 23.0, true,
 ST_GeomFromText('LINESTRING(320037 6850015, 320060 6850015)', 7856)),

-- 19. Outdoor Plaza → Building B Entrance  (open, ~15m then door)
(19, 15, 17, 'door',  6, true, 20.0, 20.0, true,
 ST_GeomFromText('LINESTRING(320060 6850015, 320075 6850024)', 7856));


-- =============================================================================
-- 6. VERIFICATION QUERIES
-- =============================================================================

-- Check all spaces loaded with correct floor ranges
SELECT id, name, space_type, is_outdoor, floor_level_min, floor_level_max,
       ST_Area(geom)::NUMERIC(10,2) AS area_m2
FROM spaces ORDER BY id;

-- Check floor nodes — confirm atrium only has F1 node
SELECT fn.id, s.name, fn.floor_level,
       ST_AsText(fn.geom) AS node_point
FROM space_floor_nodes fn
JOIN spaces s ON fn.space_id = s.id
ORDER BY s.id, fn.floor_level;

-- Check door states
SELECT id, name, state, accessible FROM doors;

-- Check connections — flag any that reference locked/closed doors
SELECT sc.id, sc.connection_type,
       fs.name AS from_space, ts.name AS to_space,
       d.name  AS door_name,  d.state AS door_state,
       sc.cost, sc.accessible
FROM space_connections sc
JOIN space_floor_nodes fn_from ON sc.from_node_id = fn_from.id
JOIN space_floor_nodes fn_to   ON sc.to_node_id   = fn_to.id
JOIN spaces fs ON fn_from.space_id = fs.id
JOIN spaces ts ON fn_to.space_id   = ts.id
LEFT JOIN doors d ON sc.door_id = d.id
ORDER BY sc.id;

-- =============================================================================
-- 7. SAMPLE ROUTING QUERIES
-- =============================================================================

-- ── A. Standard route: Room 101 (F1) → Room 201 (F2), any vertical ──────────
--    Expected: Corridor A1 → (lift or stair or escalator) → Corridor A2 → Room 201
SELECT
    seq,
    route.node,
    route.edge,
    s.name          AS space_name,
    s.space_type,
    fn.floor_level,
    sc.connection_type,
    route.cost
FROM pgr_dijkstra(
    'SELECT sc.id,
            sc.from_node_id AS source,
            sc.to_node_id   AS target,
            sc.cost,
            sc.reverse_cost
     FROM space_connections sc
     LEFT JOIN doors d ON sc.door_id = d.id
     WHERE sc.door_id IS NULL
        OR d.state IN (''open'', ''access_controlled'')',
    3,   -- Room 101 F1 node
    13,  -- Room 201 F2 node
    directed := true
) AS route
JOIN space_floor_nodes fn ON route.node = fn.id
JOIN spaces s             ON fn.space_id = s.id
LEFT JOIN space_connections sc ON route.edge = sc.id
ORDER BY seq;


-- ── B. Accessible-only route: Room 101 (F1) → Room 201 (F2) ─────────────────
--    Expected: should use lift (not escalator or locked-door stair)
SELECT
    seq,
    s.name          AS space_name,
    s.space_type,
    fn.floor_level,
    sc.connection_type,
    route.cost
FROM pgr_dijkstra(
    'SELECT sc.id,
            sc.from_node_id AS source,
            sc.to_node_id   AS target,
            sc.cost,
            sc.reverse_cost
     FROM space_connections sc
     LEFT JOIN doors d ON sc.door_id = d.id
     WHERE sc.accessible = true
       AND (sc.door_id IS NULL OR d.state IN (''open'', ''access_controlled''))',
    3,   -- Room 101 F1 node
    13,  -- Room 201 F2 node
    directed := true
) AS route
JOIN space_floor_nodes fn ON route.node = fn.id
JOIN spaces s             ON fn.space_id = s.id
LEFT JOIN space_connections sc ON route.edge = sc.id
ORDER BY seq;


-- ── C. Cross-building route: Room 101 → Building B Entrance ─────────────────
--    Expected: Room 101 → Corridor A1 → Lobby → Outdoor Path → Plaza → Bldg B
SELECT
    seq,
    s.name          AS space_name,
    s.space_type,
    s.is_outdoor,
    fn.floor_level,
    sc.connection_type,
    route.cost
FROM pgr_dijkstra(
    'SELECT sc.id,
            sc.from_node_id AS source,
            sc.to_node_id   AS target,
            sc.cost,
            sc.reverse_cost
     FROM space_connections sc
     LEFT JOIN doors d ON sc.door_id = d.id
     WHERE sc.door_id IS NULL
        OR d.state IN (''open'', ''access_controlled'')',
    3,   -- Room 101 F1 node
    17,  -- Building B Entrance node
    directed := true
) AS route
JOIN space_floor_nodes fn ON route.node = fn.id
JOIN spaces s             ON fn.space_id = s.id
LEFT JOIN space_connections sc ON route.edge = sc.id
ORDER BY seq;


-- ── D. Attempt to route to Room 202 (locked door) ───────────────────────────
--    Expected: pgr_dijkstra returns empty / no path found
SELECT
    seq,
    s.name          AS space_name,
    fn.floor_level,
    sc.connection_type
FROM pgr_dijkstra(
    'SELECT sc.id,
            sc.from_node_id AS source,
            sc.to_node_id   AS target,
            sc.cost,
            sc.reverse_cost
     FROM space_connections sc
     LEFT JOIN doors d ON sc.door_id = d.id
     WHERE sc.door_id IS NULL
        OR d.state IN (''open'', ''access_controlled'')',
    3,   -- Room 101 F1 node
    14,  -- Room 202 F2 node (locked door)
    directed := true
) AS route
JOIN space_floor_nodes fn ON route.node = fn.id
JOIN spaces s             ON fn.space_id = s.id
LEFT JOIN space_connections sc ON route.edge = sc.id
ORDER BY seq;
