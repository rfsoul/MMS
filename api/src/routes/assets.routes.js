// src/routes/assets.routes.js
const express = require('express');
const router = express.Router();
const assetsService = require('../services/assets.service');
const { pool } = require('../db/pool');
const { requireAuth, requireRole, requirePasswordCurrent, requireCompanyUser } = require('../middleware/auth.middleware');

// All asset routes require authentication and a current password
router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);

// ─────────────────────────────────────────
// MOBILE SYNC ENDPOINTS
// These must be defined BEFORE /:nodeId routes
// or Express will treat 'flat', 'types', 'relationships'
// as nodeId params and route them incorrectly.
// ─────────────────────────────────────────

// Strip AGE's double-quoted string wrapper: '"value"' -> 'value'
function stripQuotes(val) {
  if (val == null) return null;
  const s = String(val);
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

// GET /assets/flat — flat asset list for mobile SQLite sync
// Walks Site->Building->Floor->Space->Asset hierarchy via CONTAINS/HAS_ASSET
// Supports pagination: ?limit=500&offset=0
router.get('/flat', async (req, res, next) => {
  const { company_id } = req.user;
  const limit  = Math.min(parseInt(req.query.limit  ?? '500'), 1000);
  const offset = parseInt(req.query.offset ?? '0');

  try {
    await pool.query(`SET search_path = ag_catalog, "$user", public`);

    const graphResult = await pool.query(`
      SELECT * FROM ag_catalog.cypher('asset_graph', $$
        MATCH (a:Asset)
        OPTIONAL MATCH (sp:Space)-[:HAS_ASSET]->(a)
        OPTIONAL MATCH (fl:Floor)-[:CONTAINS]->(sp)
        OPTIONAL MATCH (bu:Building)-[:CONTAINS]->(fl)
        OPTIONAL MATCH (si:Site)-[:CONTAINS]->(bu)
        RETURN
          id(a)           AS asset_id,
          a.code          AS code,
          a.name          AS name,
          a.description   AS description,
          a.status        AS status,
          a.asset_type_id AS asset_type_id,
          sp.name         AS space_name,
          fl.name         AS floor_name,
          bu.name         AS building_name,
          si.name         AS site_name
        SKIP ${offset}
        LIMIT ${limit}
      $$) AS (
        asset_id        ag_catalog.agtype,
        code            ag_catalog.agtype,
        name            ag_catalog.agtype,
        description     ag_catalog.agtype,
        status          ag_catalog.agtype,
        asset_type_id   ag_catalog.agtype,
        space_name      ag_catalog.agtype,
        floor_name      ag_catalog.agtype,
        building_name   ag_catalog.agtype,
        site_name       ag_catalog.agtype
      )
    `);

    if (graphResult.rows.length === 0) {
      return res.json({ assets: [], total: 0, offset, limit });
    }

    // Join relational asset_types for type names
    const typeIds = [...new Set(
      graphResult.rows
        .map(r => stripQuotes(r.asset_type_id))
        .filter(Boolean)
    )];

    let typeMap = {};
    if (typeIds.length > 0) {
      const typeResult = await pool.query(
        `SELECT id, name FROM asset_types
         WHERE id = ANY($1::uuid[]) AND company_id = $2`,
        [typeIds, company_id]
      );
      typeMap = Object.fromEntries(typeResult.rows.map(t => [t.id, t.name]));
    }

    // Join asset_locations for spatial data
    const graphIds = graphResult.rows.map(r => stripQuotes(r.asset_id));
    const locResult = await pool.query(
      `SELECT asset_graph_id, id AS location_id, floor_level, address
       FROM asset_locations
       WHERE asset_graph_id = ANY($1) AND company_id = $2`,
      [graphIds, company_id]
    );
    const locMap = Object.fromEntries(
      locResult.rows.map(l => [l.asset_graph_id, l])
    );

    const assets = graphResult.rows.map(row => {
      const graphId = stripQuotes(row.asset_id);
      const typeId  = stripQuotes(row.asset_type_id);
      const loc     = locMap[graphId] ?? {};
      return {
        asset_graph_id:  graphId,
        company_id,
        code:            stripQuotes(row.code)          ?? '',
        name:            stripQuotes(row.name)          ?? '',
        description:     stripQuotes(row.description)   ?? null,
        status:          stripQuotes(row.status)        ?? 'active',
        asset_type_id:   typeId                         ?? null,
        asset_type_name: typeId ? (typeMap[typeId] ?? null) : null,
        site_name:       stripQuotes(row.site_name)     ?? null,
        building_name:   stripQuotes(row.building_name) ?? null,
        floor_name:      stripQuotes(row.floor_name)    ?? null,
        space_name:      stripQuotes(row.space_name)    ?? null,
        location_id:     loc.location_id                ?? null,
        floor_level:     loc.floor_level                ?? null,
        address:         loc.address                    ?? null,
      };
    });

    return res.json({ assets, total: assets.length, offset, limit });

  } catch (err) { next(err); }
});

// GET /assets/types — asset types list for mobile picker
router.get('/types', async (req, res, next) => {
  const { company_id } = req.user;
  try {
    const result = await pool.query(
      `SELECT id, company_id, name, description, is_active
       FROM asset_types
       WHERE company_id = $1 AND is_active = TRUE
       ORDER BY name`,
      [company_id]
    );
    return res.json({ asset_types: result.rows });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// NODE CRUD
// ─────────────────────────────────────────

// GET /assets — list all nodes for the company
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      node_type:     req.query.node_type,
      status:        req.query.status,
      asset_type_id: req.query.asset_type_id,
    };
    const nodes = await assetsService.listNodes(req.user, filters);
    res.status(200).json({ nodes });
  } catch (err) { next(err); }
});

// POST /assets — create a new node
router.post('/',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const node = await assetsService.createNode(req.body, req.user);
      res.status(201).json({ message: 'Asset node created', node });
    } catch (err) { next(err); }
  }
);

// GET /assets/:nodeId — get a single node with enrichment
router.get('/:nodeId', async (req, res, next) => {
  try {
    const node = await assetsService.getNode(req.params.nodeId, req.user);
    res.status(200).json({ node });
  } catch (err) { next(err); }
});

// PATCH /assets/:nodeId — update node properties
router.patch('/:nodeId',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const node = await assetsService.updateNode(req.params.nodeId, req.body, req.user);
      res.status(200).json({ message: 'Asset node updated', node });
    } catch (err) { next(err); }
  }
);

// DELETE /assets/:nodeId — delete node and its relationships
router.delete('/:nodeId',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const result = await assetsService.deleteNode(req.params.nodeId, req.user);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// GRAPH TRAVERSAL
// ─────────────────────────────────────────

// GET /assets/:nodeId/neighbours — immediate connections
router.get('/:nodeId/neighbours', async (req, res, next) => {
  try {
    const depth = parseInt(req.query.depth) || 1;
    const neighbours = await assetsService.getNodeNeighbours(req.params.nodeId, req.user, depth);
    res.status(200).json({ neighbours });
  } catch (err) { next(err); }
});

// GET /assets/:nodeId/hierarchy — spatial ancestors (Space→Floor→Building→Site)
router.get('/:nodeId/hierarchy', async (req, res, next) => {
  try {
    const hierarchy = await assetsService.getHierarchy(req.params.nodeId, req.user);
    res.status(200).json({ hierarchy });
  } catch (err) { next(err); }
});

// GET /assets/:nodeId/downstream — what this asset feeds
router.get('/:nodeId/downstream', async (req, res, next) => {
  try {
    const nodes = await assetsService.getDownstream(req.params.nodeId, req.user);
    res.status(200).json({ nodes });
  } catch (err) { next(err); }
});

// GET /assets/:nodeId/upstream — what feeds this asset
router.get('/:nodeId/upstream', async (req, res, next) => {
  try {
    const nodes = await assetsService.getUpstream(req.params.nodeId, req.user);
    res.status(200).json({ nodes });
  } catch (err) { next(err); }
});

// GET /assets/:nodeId/wo-cache — 2 most recent completed WOs for mobile cache
router.get('/:nodeId/wo-cache', async (req, res, next) => {
  const { company_id } = req.user;
  const { nodeId }     = req.params;

  try {
    const woResult = await pool.query(
      `SELECT
         w.id, w.title, w.description, w.status, w.priority,
         w.asset_graph_id, w.assigned_to, w.completed_at, w.created_at,
         w.actual_duration_minutes,
         u.full_name AS assigned_to_name
       FROM work_orders w
       LEFT JOIN users u ON u.id = w.assigned_to
       WHERE w.company_id     = $1
         AND w.asset_graph_id = $2
         AND w.status         = 'completed'
       ORDER BY w.completed_at DESC
       LIMIT 2`,
      [company_id, nodeId]
    );

    if (woResult.rows.length === 0) {
      return res.json({ work_orders: [] });
    }

    const workOrders = await Promise.all(woResult.rows.map(async wo => {
      const taskResult = await pool.query(
        `SELECT
           t.id, t.sequence, t.title, t.description, t.task_type,
           t.status, t.asset_checklist_id, t.asset_checklist_name,
           t.estimated_duration_minutes, t.actual_duration_minutes,
           t.started_at, t.completed_at
         FROM work_order_tasks t
         WHERE t.work_order_id = $1
         ORDER BY t.sequence`,
        [wo.id]
      );

      const tasks = await Promise.all(taskResult.rows.map(async task => {
        if (task.task_type !== 'checklist_execution' || !task.asset_checklist_id) {
          return { ...task, responses: [] };
        }
        const respResult = await pool.query(
          `SELECT
             r.id, r.asset_checklist_item_id, r.work_order_task_id,
             r.responded_by, r.responded_at,
             r.numeric_value, r.boolean_value, r.text_value,
             r.photo_url, r.notes, r.is_out_of_range,
             i.label AS item_label, i.item_type, i.unit,
             i.min_value, i.max_value, i.sequence AS item_sequence
           FROM asset_checklist_responses r
           JOIN asset_checklist_items i ON i.id = r.asset_checklist_item_id
           WHERE r.work_order_task_id = $1
           ORDER BY i.sequence`,
          [task.id]
        );
        return { ...task, responses: respResult.rows };
      }));

      return { ...wo, tasks };
    }));

    return res.json({ work_orders: workOrders });

  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// RELATIONSHIPS
// ─────────────────────────────────────────

// POST /assets/relationships — create a relationship between two nodes
router.post('/relationships',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const relationship = await assetsService.createRelationship(req.body, req.user);
      res.status(201).json({ message: 'Relationship created', relationship });
    } catch (err) { next(err); }
  }
);

// DELETE /assets/relationships/:relationshipId — remove a relationship
router.delete('/relationships/:relationshipId',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      const result = await assetsService.deleteRelationship(req.params.relationshipId, req.user);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

// ─────────────────────────────────────────
// LINK TO RELATIONAL ENTITIES
// ─────────────────────────────────────────

// POST /assets/:nodeId/link — link a work order, issue or inspection to this asset
router.post('/:nodeId/link',
  requireRole('admin', 'manager', 'technician'),
  async (req, res, next) => {
    try {
      const { entity_type, entity_id } = req.body;
      if (!entity_type || !entity_id) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'entity_type and entity_id are required',
        });
      }
      const result = await assetsService.linkToAsset(entity_type, entity_id, req.params.nodeId, req.user);
      res.status(200).json(result);
    } catch (err) { next(err); }
  }
);

module.exports = router;
