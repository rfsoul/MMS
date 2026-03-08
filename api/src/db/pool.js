// src/db/pool.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

/**
 * Run a standard SQL query
 */
async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

/**
 * Run a Cypher query via Apache AGE
 * Sets the required search_path before executing
 */
async function cypher(graphName, cypherQuery, params = {}) {
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ag_catalog, '$user', public");
    const result = await client.query(
      `SELECT * FROM cypher($1, $2) AS (result agtype)`,
      [graphName, cypherQuery]
    );
    return result.rows.map((r) => JSON.parse(r.result));
  } finally {
    client.release();
  }
}

/**
 * Run multiple queries in a single transaction
 * fn receives a client and must return a promise
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Set the current user ID on the DB session
 * Required for audit triggers (record_issue_status_history etc.)
 */
async function setSessionUserId(client, userId) {
  await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
}

module.exports = { query, cypher, withTransaction, setSessionUserId, pool };
