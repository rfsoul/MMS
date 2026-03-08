// src/services/assets.service.js
const { query, withTransaction } = require('../db/pool');
const { Pool } = require('pg');

// Valid node labels for the asset graph
const VALID_NODE_TYPES = ['Site', 'Building', 'Floor', 'Space', 'System', 'Asset', 'Component'];

// Valid relationship types
const VALID_RELATIONSHIP_TYPES = [
  'CONTAINS',
  'HAS_ASSET',
  'HAS_COMPONENT',
  'PART_OF',
  'CONNECTED_TO',
  'FEEDS',
  'BACKED_UP_BY',
  'MONITORS',
  'CONTROLS',
];

// Relationships that are directional and should not be traversed in reverse
const DIRECTIONAL_RELATIONSHIPS = ['FEEDS', 'BACKED_UP_BY', 'MONITORS', 'CONTROLS'];

/**
 * Run a Cypher query via AGE with correct search_path
 * Returns parsed rows
 */
async function cypher(cypherQuery, params = []) {
  const client = await (require('../db/pool').pool).connect();
  try {
    await client.query("SET search_path = ag_catalog, '$user', public");
    await client.query("LOAD 'age'");
    const result = await client.query(cypherQuery, params);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Build a Cypher property map string from a JS object.
 * Strips null/undefined values — AGE does not accept null in property maps.
 * Escapes string values to prevent Cypher injection.
 */
function buildCypherProps(obj) {
  const entries = Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      if (typeof v === 'string') {
        // Escape single quotes and backslashes
        const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        return `${k}: '${escaped}'`;
      }
      if (typeof v === 'boolean') return `${k}: ${v}`;
      if (typeof v === 'number') return `${k}: ${v}`;
      return `${k}: '${String(v)}'`;
    });
  return `{${entries.join(', ')}}`;
}

/**
 * Parse an AGE agtype result into a plain JS object.
 * AGE returns values with type annotations appended e.g. {"id":...}::vertex
 * These must be stripped before JSON.parse
 */
function parseAgtype(raw) {
  if (raw === null || raw === undefined) return null;
  const str = typeof raw === 'string' ? raw : String(raw);
  // Strip AGE type annotations: ::vertex, ::edge, ::path, ::integer, etc.
  const clean = str.replace(/::[a-z_]+$/i, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // If it's a primitive agtype (integer, float, boolean) return as-is
    if (clean === 'true') return true;
    if (clean === 'false') return false;
    const num = Number(clean);
    if (!isNaN(num)) return num;
    return clean;
  }
}

function parseNode(row, key = 'n') {
  if (!row[key]) return null;
  const parsed = parseAgtype(row[key]);
  return {
    id: String(parsed.id),
    label: parsed.label,
    properties: parsed.properties || {},
  };
}

/**
 * Validate node type
 */
function validateNodeType(type) {
  if (!VALID_NODE_TYPES.includes(type)) {
    throw {
      status: 400,
      code: 'INVALID_NODE_TYPE',
      message: `Invalid node type '${type}'. Must be one of: ${VALID_NODE_TYPES.join(', ')}`,
    };
  }
}

/**
 * Validate relationship type
 */
function validateRelationshipType(type) {
  if (!VALID_RELATIONSHIP_TYPES.includes(type)) {
    throw {
      status: 400,
      code: 'INVALID_RELATIONSHIP_TYPE',
      message: `Invalid relationship type '${type}'. Must be one of: ${VALID_RELATIONSHIP_TYPES.join(', ')}`,
    };
  }
}

/**
 * Create a node in the asset graph
 * Validates asset_type_id against the relational asset_types table
 */
async function createNode(data, requestingUser) {
  const {
    node_type,
    name,
    code,
    description,
    asset_type_id,
    external_id,
    status,
    properties,
  } = data;

  validateNodeType(node_type);

  if (!name) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'name is required' };
  }

  // Validate asset_type_id if provided
  if (asset_type_id) {
    const typeCheck = await query(
      'SELECT id FROM asset_types WHERE id = $1 AND company_id = $2',
      [asset_type_id, requestingUser.company_id]
    );
    if (typeCheck.rows.length === 0) {
      throw { status: 404, code: 'NOT_FOUND', message: 'Asset type not found' };
    }
  }

  const nodeProps = {
    company_id: requestingUser.company_id,
    name,
    code: code || null,
    description: description || null,
    asset_type_id: asset_type_id || null,
    external_id: external_id || null,
    status: status || 'active',
    created_by: requestingUser.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(properties || {}),
  };

  const propsMap = buildCypherProps(nodeProps);

  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      CREATE (n:${node_type} ${propsMap})
      RETURN n
    $$) AS (n agtype)`
  );

  if (!rows.length) {
    throw { status: 500, code: 'GRAPH_ERROR', message: 'Failed to create graph node' };
  }

  const node = parseNode(rows[0]);

  // If spatial data provided, upsert into asset_locations
  if (data.longitude != null && data.latitude != null) {
    await query(`
      INSERT INTO asset_locations (company_id, asset_graph_id, name, geom, floor_level, address)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 7856), $6, $7)
      ON CONFLICT (asset_graph_id) DO UPDATE SET
        name = EXCLUDED.name,
        geom = EXCLUDED.geom,
        floor_level = EXCLUDED.floor_level,
        address = EXCLUDED.address
    `, [
      requestingUser.company_id,
      node.id,
      name,
      data.longitude,
      data.latitude,
      data.floor_level || null,
      data.address || null,
    ]);
  }

  return node;
}

/**
 * Get a node by its AGE ID
 */
async function getNode(nodeId, requestingUser) {
  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (n)
      WHERE id(n) = ${nodeId}
        AND n.company_id = '${requestingUser.company_id}'
      RETURN n
    $$) AS (n agtype)`
  );

  if (!rows.length) {
    throw { status: 404, code: 'NOT_FOUND', message: 'Asset node not found' };
  }

  const node = parseNode(rows[0]);

  // Enrich with asset_type details if present
  if (node.properties.asset_type_id) {
    const typeResult = await query(
      'SELECT id, name, description FROM asset_types WHERE id = $1',
      [node.properties.asset_type_id]
    );
    if (typeResult.rows.length > 0) {
      node.asset_type = typeResult.rows[0];
    }
  }

  // Enrich with spatial location if present
  const locationResult = await query(
    `SELECT
      ST_AsGeoJSON(geom)::json AS location,
      floor_level,
      address
     FROM asset_locations
     WHERE asset_graph_id = $1`,
    [nodeId]
  );
  if (locationResult.rows.length > 0) {
    node.spatial = locationResult.rows[0];
  }

  return node;
}

/**
 * Update a node's properties
 */
async function updateNode(nodeId, data, requestingUser) {
  // Verify node belongs to company first
  await getNode(nodeId, requestingUser);

  const allowedProps = [
    'name', 'code', 'description', 'status',
    'asset_type_id', 'external_id',
  ];

  const updates = {};
  for (const key of allowedProps) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  updates.updated_at = new Date().toISOString();

  // Build SET clause for Cypher
  const setClauses = Object.entries(updates)
    .map(([k, v]) => `n.${k} = '${String(v).replace(/'/g, "\\'")}'`)
    .join(', ');

  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (n)
      WHERE id(n) = ${nodeId}
      SET ${setClauses}
      RETURN n
    $$) AS (n agtype)`
  );

  const node = parseNode(rows[0]);

  // Update spatial location if provided
  if (data.longitude != null && data.latitude != null) {
    await query(`
      INSERT INTO asset_locations (company_id, asset_graph_id, name, geom, floor_level, address)
      VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 7856), $6, $7)
      ON CONFLICT (asset_graph_id) DO UPDATE SET
        name = EXCLUDED.name,
        geom = EXCLUDED.geom,
        floor_level = EXCLUDED.floor_level,
        address = EXCLUDED.address
    `, [
      requestingUser.company_id,
      nodeId,
      data.name || node.properties.name,
      data.longitude,
      data.latitude,
      data.floor_level || null,
      data.address || null,
    ]);
  }

  return node;
}

/**
 * Delete a node and all its relationships
 */
async function deleteNode(nodeId, requestingUser) {
  await getNode(nodeId, requestingUser);

  await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (n)
      WHERE id(n) = ${nodeId}
      DETACH DELETE n
      RETURN 1
    $$) AS (result agtype)`
  );

  // Remove spatial record
  await query('DELETE FROM asset_locations WHERE asset_graph_id = $1', [nodeId]);

  return { message: 'Asset node deleted successfully' };
}

/**
 * List nodes for a company with optional filters
 */
async function listNodes(requestingUser, filters = {}) {
  let whereClause = `n.company_id = '${requestingUser.company_id}'`;

  if (filters.node_type) {
    validateNodeType(filters.node_type);
  }
  if (filters.status) {
    whereClause += ` AND n.status = '${filters.status}'`;
  }
  if (filters.asset_type_id) {
    whereClause += ` AND n.asset_type_id = '${filters.asset_type_id}'`;
  }

  const labelClause = filters.node_type ? `:${filters.node_type}` : '';

  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (n${labelClause})
      WHERE ${whereClause}
      RETURN n
      ORDER BY n.name
    $$) AS (n agtype)`
  );

  return rows.map(r => parseNode(r));
}

/**
 * Create a relationship between two nodes
 */
async function createRelationship(data, requestingUser) {
  const { from_node_id, to_node_id, relationship_type, properties } = data;

  if (!from_node_id || !to_node_id || !relationship_type) {
    throw {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'from_node_id, to_node_id and relationship_type are required',
    };
  }

  validateRelationshipType(relationship_type);

  // Verify both nodes belong to this company
  await getNode(from_node_id, requestingUser);
  await getNode(to_node_id, requestingUser);

  const relProps = {
    created_by: requestingUser.id,
    created_at: new Date().toISOString(),
    ...(properties || {}),
  };
  const propsMap = buildCypherProps(relProps);

  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (a), (b)
      WHERE id(a) = ${from_node_id} AND id(b) = ${to_node_id}
      CREATE (a)-[r:${relationship_type} ${propsMap}]->(b)
      RETURN r
    $$) AS (r agtype)`
  );

  if (!rows.length) {
    throw { status: 500, code: 'GRAPH_ERROR', message: 'Failed to create relationship' };
  }

  const rel = parseAgtype(rows[0].r);
  return {
    id: String(rel.id),
    type: relationship_type,
    from_node_id: String(from_node_id),
    to_node_id: String(to_node_id),
    properties: rel.properties || {},
  };
}

/**
 * Delete a relationship by its AGE ID
 */
async function deleteRelationship(relationshipId, requestingUser) {
  await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH ()-[r]->()
      WHERE id(r) = ${relationshipId}
      DELETE r
      RETURN 1
    $$) AS (result agtype)`
  );

  return { message: 'Relationship deleted successfully' };
}

/**
 * Get the full neighbourhood of a node —
 * immediate relationships in both directions
 */
async function getNodeNeighbours(nodeId, requestingUser, depth = 1) {
  await getNode(nodeId, requestingUser);

  if (depth < 1 || depth > 5) depth = 1;

  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (n)-[r*1..${depth}]-(neighbour)
      WHERE id(n) = ${nodeId}
        AND neighbour.company_id = '${requestingUser.company_id}'
      RETURN DISTINCT neighbour, r
    $$) AS (neighbour agtype, r agtype)`
  );

  return rows.map(row => ({
    node: parseNode(row, 'neighbour'),
    relationships: row.r,
  }));
}

/**
 * Get all assets downstream of a given node via FEEDS relationships
 * Useful for impact analysis — "what does this asset feed?"
 */
async function getDownstream(nodeId, requestingUser) {
  await getNode(nodeId, requestingUser);

  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (n)-[:FEEDS*1..10]->(downstream)
      WHERE id(n) = ${nodeId}
        AND downstream.company_id = '${requestingUser.company_id}'
      RETURN DISTINCT downstream
    $$) AS (downstream agtype)`
  );

  return rows.map(r => parseNode(r, 'downstream'));
}

/**
 * Get all assets upstream of a given node via FEEDS relationships
 * Useful for root cause analysis — "what feeds this asset?"
 */
async function getUpstream(nodeId, requestingUser) {
  await getNode(nodeId, requestingUser);

  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (upstream)-[:FEEDS*1..10]->(n)
      WHERE id(n) = ${nodeId}
        AND upstream.company_id = '${requestingUser.company_id}'
      RETURN DISTINCT upstream
    $$) AS (upstream agtype)`
  );

  return rows.map(r => parseNode(r, 'upstream'));
}

/**
 * Get the full spatial hierarchy a node belongs to
 * e.g. Asset → Space → Floor → Building → Site
 */
async function getHierarchy(nodeId, requestingUser) {
  await getNode(nodeId, requestingUser);

  // AGE doesn't support named paths or length() in all contexts
  // Instead: match all ancestors, then deduplicate in JS
  // The deepest ancestors (Site) appear multiple times across paths so
  // we simply return unique nodes — caller can determine order from label
  const rows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (ancestor)-[:CONTAINS*1..10]->(n)
      WHERE id(n) = ${nodeId}
        AND ancestor.company_id = '${requestingUser.company_id}'
      RETURN DISTINCT ancestor
    $$) AS (ancestor agtype)`
  );

  // Also include the node itself (depth 0)
  const selfRows = await cypher(
    `SELECT * FROM cypher('asset_graph', $$
      MATCH (n)
      WHERE id(n) = ${nodeId}
      RETURN n
    $$) AS (n agtype)`
  );

  const ancestors = rows.map(r => parseNode(r, 'ancestor'));
  const self = selfRows.map(r => parseNode(r, 'n'));

  // Deduplicate by id
  const seen = new Set();
  const all = [...ancestors, ...self].filter(n => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });

  return all;
}

/**
 * Link a work order, issue or inspection to an asset node
 * Updates the relational table's asset_graph_id column
 */
async function linkToAsset(entityType, entityId, nodeId, requestingUser) {
  const tableMap = {
    work_order: 'work_orders',
    issue: 'maintenance_issues',
    inspection: 'inspections',
  };

  const table = tableMap[entityType];
  if (!table) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: `Invalid entity type '${entityType}'` };
  }

  // Verify node exists and belongs to company
  await getNode(nodeId, requestingUser);

  await query(
    `UPDATE ${table} SET asset_graph_id = $1 WHERE id = $2`,
    [String(nodeId), entityId]
  );

  return { message: `${entityType} linked to asset successfully` };
}

module.exports = {
  createNode,
  getNode,
  updateNode,
  deleteNode,
  listNodes,
  createRelationship,
  deleteRelationship,
  getNodeNeighbours,
  getDownstream,
  getUpstream,
  getHierarchy,
  linkToAsset,
  VALID_NODE_TYPES,
  VALID_RELATIONSHIP_TYPES,
};
