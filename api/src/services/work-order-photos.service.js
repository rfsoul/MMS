// src/services/work-order-photos.service.js
'use strict';

const path  = require('path');
const fs    = require('fs');
const { v4: uuidv4 } = require('uuid');
const pool  = require('../db/pool');

// Upload directory — relative to project root.
// In production replace with S3 or equivalent object storage.
// The API must serve this directory as static files at /uploads.
const UPLOAD_DIR = process.env.UPLOAD_DIR
  || path.join(__dirname, '../../uploads/work-orders');

// Base URL for constructing server_url in responses
const UPLOADS_BASE_URL = process.env.UPLOADS_BASE_URL || '/uploads';

// ─────────────────────────────────────────
// listPhotos
// ─────────────────────────────────────────
async function listPhotos(workOrderId, caller) {
  // Verify work order belongs to caller's company
  const woCheck = await pool.query(
    `SELECT id FROM work_orders WHERE id = $1 AND company_id = $2`,
    [workOrderId, caller.company_id]
  );
  if (woCheck.rows.length === 0) {
    const err = new Error('Work order not found');
    err.statusCode = 404; err.code = 'NOT_FOUND';
    throw err;
  }

  const result = await pool.query(
    `SELECT id, work_order_id, uploaded_by, server_url, original_filename,
            mime_type, size_bytes, captured_at, created_at
     FROM work_order_photos
     WHERE work_order_id = $1
     ORDER BY COALESCE(captured_at, created_at) DESC`,
    [workOrderId]
  );
  return result.rows;
}

// ─────────────────────────────────────────
// uploadPhoto
// ─────────────────────────────────────────
async function uploadPhoto(workOrderId, file, capturedAt, caller) {
  // Verify work order belongs to caller's company and is not completed
  const woCheck = await pool.query(
    `SELECT id, status FROM work_orders WHERE id = $1 AND company_id = $2`,
    [workOrderId, caller.company_id]
  );
  if (woCheck.rows.length === 0) {
    const err = new Error('Work order not found');
    err.statusCode = 404; err.code = 'NOT_FOUND';
    throw err;
  }
  if (woCheck.rows[0].status === 'completed') {
    const err = new Error('Cannot upload photos to a completed work order');
    err.statusCode = 409; err.code = 'WORK_ORDER_CLOSED';
    throw err;
  }

  // Determine file extension from MIME type
  const extMap = {
    'image/jpeg': '.jpg',
    'image/png':  '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
  };
  const ext      = extMap[file.mimetype] ?? '.jpg';
  const filename = `${uuidv4()}${ext}`;
  const destDir  = path.join(UPLOAD_DIR, workOrderId);
  const destPath = path.join(destDir, filename);

  // Ensure target directory exists
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, file.buffer);

  const serverUrl = `${UPLOADS_BASE_URL}/work-orders/${workOrderId}/${filename}`;

  const result = await pool.query(
    `INSERT INTO work_order_photos
       (work_order_id, uploaded_by, server_url, original_filename, mime_type, size_bytes, captured_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      workOrderId,
      caller.id,
      serverUrl,
      file.originalname,
      file.mimetype,
      file.size,
      capturedAt || null,
    ]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────
// deletePhoto
// ─────────────────────────────────────────
async function deletePhoto(workOrderId, photoId, caller) {
  const result = await pool.query(
    `DELETE FROM work_order_photos
     WHERE id = $1
       AND work_order_id = $2
       AND work_order_id IN (
         SELECT id FROM work_orders WHERE company_id = $3
       )
     RETURNING server_url`,
    [photoId, workOrderId, caller.company_id]
  );
  if (result.rows.length === 0) {
    const err = new Error('Photo not found');
    err.statusCode = 404; err.code = 'NOT_FOUND';
    throw err;
  }

  // Best-effort delete from disk — don't fail if file already gone
  try {
    const serverUrl = result.rows[0].server_url;
    const relativePath = serverUrl.replace(UPLOADS_BASE_URL, '');
    const filePath = path.join(path.dirname(UPLOAD_DIR), relativePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}

  return { message: 'Photo deleted' };
}

module.exports = { listPhotos, uploadPhoto, deletePhoto };
