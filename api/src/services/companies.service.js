// src/services/companies.service.js
const { query } = require('../db/pool');

/**
 * List all companies
 * Help desk agents see all companies
 * Company users only see their own company
 */
async function listCompanies(requestingUser) {
  if (requestingUser.is_help_desk) {
    const result = await query(`
      SELECT
        c.id,
        c.name,
        c.is_help_desk,
        c.address,
        ST_AsGeoJSON(c.geom)::json AS location,
        c.created_at,
        COUNT(u.id) FILTER (WHERE u.is_active = TRUE) AS active_user_count
      FROM companies c
      LEFT JOIN users u ON u.company_id = c.id
      GROUP BY c.id
      ORDER BY c.is_help_desk DESC, c.name ASC
    `);
    return result.rows;
  }

  // Company users only see their own company
  const result = await query(`
    SELECT
      c.id,
      c.name,
      c.is_help_desk,
      c.address,
      ST_AsGeoJSON(c.geom)::json AS location,
      c.created_at,
      COUNT(u.id) FILTER (WHERE u.is_active = TRUE) AS active_user_count
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id
    WHERE c.id = $1
    GROUP BY c.id
  `, [requestingUser.company_id]);
  return result.rows;
}

/**
 * Get a single company by ID
 */
async function getCompany(id, requestingUser) {
  // Company users can only view their own company
  if (!requestingUser.is_help_desk && requestingUser.company_id !== id) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You can only view your own company' };
  }

  const result = await query(`
    SELECT
      c.id,
      c.name,
      c.is_help_desk,
      c.address,
      ST_AsGeoJSON(c.geom)::json AS location,
      c.created_at,
      COUNT(u.id) FILTER (WHERE u.is_active = TRUE) AS active_user_count
    FROM companies c
    LEFT JOIN users u ON u.company_id = c.id
    WHERE c.id = $1
    GROUP BY c.id
  `, [id]);

  if (result.rows.length === 0) {
    throw { status: 404, code: 'NOT_FOUND', message: 'Company not found' };
  }

  return result.rows[0];
}

/**
 * Create a new company
 * Only help desk agents (admin role implied) can create companies
 */
async function createCompany(data) {
  const { name, address, longitude, latitude } = data;

  if (!name) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'Company name is required' };
  }

  const geomExpr = (longitude != null && latitude != null)
    ? `ST_SetSRID(ST_MakePoint($3, $4), 7856)`
    : 'NULL';

  const params = (longitude != null && latitude != null)
    ? [name, address || null, longitude, latitude]
    : [name, address || null];

  const result = await query(`
    INSERT INTO companies (name, address, geom)
    VALUES ($1, $2, ${geomExpr})
    RETURNING
      id, name, is_help_desk, address,
      ST_AsGeoJSON(geom)::json AS location,
      created_at
  `, params);

  return result.rows[0];
}

/**
 * Update a company
 */
async function updateCompany(id, data, requestingUser) {
  // Company admins can update their own company
  // Help desk can update any company
  if (!requestingUser.is_help_desk && requestingUser.company_id !== id) {
    throw { status: 403, code: 'FORBIDDEN', message: 'You can only update your own company' };
  }

  const company = await getCompany(id, requestingUser);
  if (company.is_help_desk && !requestingUser.is_help_desk) {
    throw { status: 403, code: 'FORBIDDEN', message: 'Cannot modify the help desk company' };
  }

  const { name, address, longitude, latitude } = data;

  const updates = [];
  const params = [];
  let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx++}`); params.push(name); }
  if (address !== undefined) { updates.push(`address = $${idx++}`); params.push(address); }
  if (longitude != null && latitude != null) {
    updates.push(`geom = ST_SetSRID(ST_MakePoint($${idx++}, $${idx++}), 7856)`);
    params.push(longitude, latitude);
  }

  if (updates.length === 0) {
    throw { status: 400, code: 'VALIDATION_ERROR', message: 'No fields to update' };
  }

  params.push(id);
  const result = await query(`
    UPDATE companies SET ${updates.join(', ')}
    WHERE id = $${idx}
    RETURNING
      id, name, is_help_desk, address,
      ST_AsGeoJSON(geom)::json AS location,
      created_at
  `, params);

  return result.rows[0];
}

module.exports = { listCompanies, getCompany, createCompany, updateCompany };
