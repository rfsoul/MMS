// src/routes/work-order-photos.routes.js
'use strict';

const express = require('express');
const router  = express.Router({ mergeParams: true }); // access :workOrderId from parent
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { requireAuth, requirePasswordCurrent, requireCompanyUser, requireRole } = require('../middleware/auth.middleware');

router.use(requireAuth, requirePasswordCurrent, requireCompanyUser);

// ─────────────────────────────────────────
// MULTER — disk storage
// Files land at: uploads/work-orders/<workOrderId>/<uuid>.<ext>
// Express static middleware must be configured to serve /uploads
// ─────────────────────────────────────────

const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_ROOT, 'work-orders', req.params.workOrderId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per photo
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WEBP and HEIC images are accepted'));
  },
});

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

// Resolve the public URL for a stored file.
// BASE_URL should be set in env, e.g. https://mms.acme.com.au
function toServerUrl(workOrderId, filename) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `${base}/uploads/work-orders/${workOrderId}/${filename}`;
}

// Verify the work order exists and belongs to the caller's company.
// Returns the work order row or throws a structured error.
async function resolveWorkOrder(workOrderId, companyId) {
  const result = await pool.query(
    `SELECT id, status FROM work_orders
     WHERE id = $1 AND company_id = $2`,
    [workOrderId, companyId]
  );
  if (!result.rows.length) {
    const err = new Error('Work order not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  return result.rows[0];
}

// ─────────────────────────────────────────
// GET /work-orders/:workOrderId/photos
// List all photos for a work order, newest first.
// ─────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    await resolveWorkOrder(req.params.workOrderId, req.user.company_id);

    const result = await pool.query(
      `SELECT
         p.id,
         p.work_order_id,
         p.uploaded_by,
         u.full_name  AS uploaded_by_name,
         p.server_url,
         p.original_filename,
         p.mime_type,
         p.size_bytes,
         p.captured_at,
         p.created_at
       FROM work_order_photos p
       JOIN users u ON u.id = p.uploaded_by
       WHERE p.work_order_id = $1
       ORDER BY COALESCE(p.captured_at, p.created_at) DESC`,
      [req.params.workOrderId]
    );

    res.json({ photos: result.rows });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────
// POST /work-orders/:workOrderId/photos
// Upload one photo (multipart/form-data).
// Field name: photo
// Optional body fields:
//   captured_at  — ISO timestamp when the photo was taken (for offline uploads)
//
// The mobile app should set captured_at to the device timestamp so that photos
// taken offline and uploaded later sort correctly in the timeline.
// ─────────────────────────────────────────
router.post('/',
  requireRole('admin', 'manager', 'technician'),
  upload.single('photo'),
  async (req, res, next) => {
    // If multer rejected the file it calls next(err) — no file means bad request
    if (!req.file) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'A photo file is required (field: photo)',
      });
    }

    try {
      const wo = await resolveWorkOrder(req.params.workOrderId, req.user.company_id);

      if (wo.status === 'completed') {
        // Clean up the uploaded file — we won't be keeping it
        fs.unlink(req.file.path, () => {});
        return res.status(409).json({
          code: 'WORK_ORDER_CLOSED',
          message: 'Cannot add photos to a completed work order',
        });
      }

      const serverUrl   = toServerUrl(req.params.workOrderId, req.file.filename);
      const capturedAt  = req.body.captured_at
        ? new Date(req.body.captured_at)
        : null;

      const result = await pool.query(
        `INSERT INTO work_order_photos
           (work_order_id, uploaded_by, server_url, original_filename,
            mime_type, size_bytes, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id, work_order_id, uploaded_by, server_url,
           original_filename, mime_type, size_bytes,
           captured_at, created_at`,
        [
          req.params.workOrderId,
          req.user.id,
          serverUrl,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          capturedAt,
        ]
      );

      res.status(201).json({ message: 'Photo uploaded', photo: result.rows[0] });
    } catch (err) {
      // Clean up orphaned file on DB error
      if (req.file) fs.unlink(req.file.path, () => {});
      next(err);
    }
  }
);

// ─────────────────────────────────────────
// DELETE /work-orders/:workOrderId/photos/:photoId
// Admin / manager only — technicians cannot delete photos.
// Removes both the DB record and the file on disk.
// ─────────────────────────────────────────
router.delete('/:photoId',
  requireRole('admin', 'manager'),
  async (req, res, next) => {
    try {
      await resolveWorkOrder(req.params.workOrderId, req.user.company_id);

      const result = await pool.query(
        `DELETE FROM work_order_photos
         WHERE id = $1 AND work_order_id = $2
         RETURNING server_url`,
        [req.params.photoId, req.params.workOrderId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Photo not found' });
      }

      // Best-effort file removal — don't fail the request if the file is missing
      const serverUrl = result.rows[0].server_url;
      const filename  = path.basename(serverUrl);
      const filePath  = path.join(UPLOAD_ROOT, 'work-orders', req.params.workOrderId, filename);
      fs.unlink(filePath, () => {});

      res.json({ message: 'Photo deleted' });
    } catch (err) { next(err); }
  }
);

module.exports = router;
