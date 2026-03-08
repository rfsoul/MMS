// src/hooks/usePhotoUpload.ts
//
// Handles uploading pending photos to the server.
// Called by both NewWorkOrderScreen (after WO is created) and
// WorkOrderDetailScreen (immediately when online, or queued when not).
//
// Upload flow:
//   1. Photo is saved locally with is_pending_sync = 1
//   2. If online → upload immediately, set server_url, clear is_pending_sync
//   3. If offline → insert into outbox; sync engine handles it later
//
// The server endpoint is:
//   POST /api/work-orders/:woId/photos
//   multipart/form-data, field name: "photo"
//   Returns: { photo: { id, server_url, ... } }

import { useCallback } from 'react';
import * as FileSystem from 'expo-file-system';
import { dbRun, dbQuery } from '@/db/database';
import { useAuthStore } from '@/store/authStore';
import { useSync } from '@/hooks/useSync';
import { generateUUID } from '@/utils/uuid';
import type { PhotoItem } from '@/components/PhotoStrip';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export function usePhotoUpload() {
  const token     = useAuthStore(s => s.token);
  const { isOnline } = useSync();

  // Upload a single photo to the server.
  // Returns the server_url on success, throws on failure.
  const uploadPhoto = useCallback(async (
    woId: string,
    photo: PhotoItem,
  ): Promise<string> => {
    const uploadResult = await FileSystem.uploadAsync(
      `${API_BASE}/api/work-orders/${woId}/photos`,
      photo.local_uri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName:  'photo',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        parameters: {
          photo_id:    photo.id,
          captured_at: photo.captured_at,
        },
      }
    );

    if (uploadResult.status !== 201) {
      throw new Error(`Upload failed: ${uploadResult.status}`);
    }

    const body = JSON.parse(uploadResult.body);
    return body.photo.server_url as string;
  }, [token]);

  // Attempt to upload a photo immediately if online, otherwise queue to outbox.
  // Updates the wo_photos SQLite row in both cases.
  const syncPhoto = useCallback(async (
    woId: string,
    photo: PhotoItem,
  ): Promise<PhotoItem> => {
    if (isOnline) {
      try {
        const serverUrl = await uploadPhoto(woId, photo);
        await dbRun(
          `UPDATE wo_photos SET server_url=?, is_pending_sync=0 WHERE id=?`,
          [serverUrl, photo.id]
        );
        return { ...photo, server_url: serverUrl, is_pending_sync: false };
      } catch {
        // Fall through to outbox on upload failure
      }
    }

    // Queue for later sync
    await dbRun(
      `INSERT OR IGNORE INTO outbox
         (id, entity_type, entity_id, operation, payload, created_at)
       VALUES (?,?,?,?,?,?)`,
      [
        `photo_upload_${photo.id}`,
        'wo_photo',
        photo.id,
        'UPLOAD',
        JSON.stringify({ wo_id: woId, photo_id: photo.id, local_uri: photo.local_uri }),
        new Date().toISOString(),
      ]
    );

    return photo; // still pending
  }, [isOnline, uploadPhoto]);

  // Save a new photo to SQLite and trigger sync
  const saveAndSync = useCallback(async (
    woId: string,
    photo: PhotoItem,
  ): Promise<PhotoItem> => {
    await dbRun(
      `INSERT INTO wo_photos
         (id, wo_id, local_uri, server_url, is_pending_sync, captured_at)
       VALUES (?,?,?,?,?,?)`,
      [
        photo.id, woId,
        photo.local_uri,
        photo.server_url,
        photo.is_pending_sync ? 1 : 0,
        photo.captured_at,
      ]
    );
    return syncPhoto(woId, photo);
  }, [syncPhoto]);

  // Load all photos for a WO from local SQLite
  const loadPhotos = useCallback(async (woId: string): Promise<PhotoItem[]> => {
    return dbQuery<PhotoItem>(
      `SELECT id, local_uri, server_url,
              is_pending_sync, captured_at
       FROM wo_photos
       WHERE wo_id = ?
       ORDER BY captured_at ASC`,
      [woId]
    );
  }, []);

  // Remove a photo locally and queue deletion on server
  const removePhoto = useCallback(async (
    woId: string,
    photoId: string,
  ): Promise<void> => {
    await dbRun(`DELETE FROM wo_photos WHERE id=?`, [photoId]);

    if (isOnline) {
      // Best-effort immediate delete — ignore failures
      try {
        await fetch(`${API_BASE}/api/work-orders/${woId}/photos/${photoId}`, {
          method:  'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    } else {
      await dbRun(
        `INSERT OR IGNORE INTO outbox
           (id, entity_type, entity_id, operation, payload, created_at)
         VALUES (?,?,?,?,?,?)`,
        [
          `photo_delete_${photoId}`,
          'wo_photo', photoId, 'DELETE',
          JSON.stringify({ wo_id: woId, photo_id: photoId }),
          new Date().toISOString(),
        ]
      );
    }
  }, [isOnline, token]);

  return { saveAndSync, loadPhotos, removePhoto };
}
