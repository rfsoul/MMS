// src/utils/token.js
const crypto = require('crypto');

/**
 * Generate a cryptographically secure random token
 * Returns the raw token (sent to client) and its SHA-256 hash (stored in DB)
 */
function generateToken() {
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * Hash a raw token for DB lookup
 */
function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Calculate session expiry timestamp based on timeout minutes from system_config
 */
function sessionExpiresAt(timeoutMinutes) {
  return new Date(Date.now() + timeoutMinutes * 60 * 1000);
}

module.exports = { generateToken, hashToken, sessionExpiresAt };
