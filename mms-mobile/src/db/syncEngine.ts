// src/services/syncEngine.ts
// Offline-first sync engine.
//
// PULL: Fetches work orders + tasks + checklist items assigned to the current
//       technician and upserts them into local SQLite.
//       Also pulls asset types and flat asset list on first login.
//
// PUSH: Drains the outbox table — replays queued writes to the API in order.
//       On success the outbox entry is deleted.
//       On network error: leaves in queue, will retry next sync.
//       On API error (4xx): marks as failed with last_error, skips (won't retry
//       automatically — needs manual resolution or server fix).
//
// PHOTO UPLOAD: Responses with local_photo_path but no photo_url get their
//               photo uploaded to the API first, then the response is submitted.

import { dbQuery, dbRun, dbTransaction, getDb } from '@/db/database';
import { workOrderApi, taskApi, responseApi, checklistApi, apiFetch, NetworkError, ApiError } from './api';
import { useAuthStore } from '@/store/authStore';
import type {
  WorkOrder, WorkOrderTask, ChecklistItem,
  ChecklistResponse, OutboxEntry,
} from '@/utils/types';
import { API_URL } from '@/utils/config';
import * as FileSystem from 'expo-file-system';

// ── Pull work orders ──────────────────────────────────────────────────────────

export async function pullWorkOrders(): Promise<void> {
  const response = await workOrderApi.list();
  const workOrders: WorkOrder[] = response.work_orders ?? [];
  console.log('[pullWorkOrders] fetched', workOrders.length, 'work orders');

  await dbTransaction(async (db) => {
    const now = new Date().toISOString();
    for (const wo of workOrders) {
      console.log('[pullWorkOrders] inserting:', wo.id, wo.title);
      await db.runAsync(
        `INSERT INTO work_orders
           (id, company_id, title, description, type, status, priority,
            asset_graph_id, assigned_to, assigned_to_name,
            estimated_duration_minutes, actual_duration_minutes,
            started_at, completed_at, created_at, updated_at, synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, description=excluded.description,
           type=excluded.type, status=excluded.status, priority=excluded.priority,
           assigned_to=excluded.assigned_to,
           assigned_to_name=excluded.assigned_to_name,
           estimated_duration_minutes=excluded.estimated_duration_minutes,
           actual_duration_minutes=excluded.actual_duration_minutes,
           started_at=excluded.started_at,
           completed_at=excluded.completed_at,
           updated_at=excluded.updated_at, synced_at=excluded.synced_at`,
        [
          wo.id, wo.company_id, wo.title, wo.description ?? null,
          (wo as any).type ?? 'inspection',
          wo.status, wo.priority,
          wo.asset_graph_id != null ? String(wo.asset_graph_id) : null,
          wo.assigned_to ?? null,
          (wo as any).assigned_to_name ?? null,
          wo.estimated_duration_minutes ?? null,
          wo.actual_duration_minutes ?? null,
          (wo as any).started_at ?? null,
          wo.completed_at ?? null,
          wo.created_at, wo.updated_at, now,
        ]
      );
    }
    await db.runAsync(
      `INSERT INTO sync_log (synced_at, direction, entity_type, record_count)
       VALUES (?, 'pull', 'work_orders', ?)`,
      [now, workOrders.length]
    );
  });

  // Enrich asset labels from local asset_nodes — runs AFTER the transaction
  // so a lookup failure never aborts the WO inserts
  const db = await getDb();
  for (const wo of workOrders) {
    if (!wo.asset_graph_id) continue;
    try {
      const rows = await db.getAllAsync<any>(
        `SELECT code, name, asset_type_name, floor_name, space_name, building_name
         FROM asset_nodes WHERE asset_graph_id = ?`,
        [String(wo.asset_graph_id)]
      );
      if (rows.length === 0) continue;
      const a = rows[0];
      const assetLabel = a.code ? `${a.code} — ${a.name}` : a.name;
      const location   = [a.floor_name, a.space_name].filter(Boolean).join(' › ') || null;
      await db.runAsync(
        `UPDATE work_orders
         SET asset_label=?, asset_type=?, location=?, building=?
         WHERE id=? AND asset_label IS NULL`,
        [assetLabel, a.asset_type_name ?? null, location, a.building_name ?? null, wo.id]
      );
    } catch {
      // asset_nodes not yet synced — will populate on next pull
    }
  }
}

export async function pullTasksForWorkOrder(workOrderId: string): Promise<void> {
  const res = await taskApi.list(workOrderId);
  const tasks: WorkOrderTask[] = res.tasks;

  const db = await getDb();
  for (const t of tasks) {
    await db.runAsync(
      `INSERT INTO work_order_tasks
         (id, work_order_id, sequence, title, description, task_type,
          status, asset_checklist_id, asset_checklist_name,
          estimated_duration_minutes, actual_duration_minutes,
          started_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         sequence=excluded.sequence, title=excluded.title,
         description=excluded.description, status=excluded.status,
         asset_checklist_id=excluded.asset_checklist_id,
         asset_checklist_name=excluded.asset_checklist_name,
         estimated_duration_minutes=excluded.estimated_duration_minutes,
         actual_duration_minutes=excluded.actual_duration_minutes,
         started_at=excluded.started_at, completed_at=excluded.completed_at`,
      [
        t.id, t.work_order_id, t.sequence, t.title, t.description ?? null,
        t.task_type, t.status, t.asset_checklist_id ?? null,
        t.asset_checklist_name ?? null,
        t.estimated_duration_minutes ?? null,
        t.actual_duration_minutes ?? null,
        t.started_at ?? null, t.completed_at ?? null,
      ]
    );
  }
}

export async function pullChecklistItems(
  assetGraphId: string,
  checklistId: string
): Promise<void> {
  const res = await checklistApi.getItems(assetGraphId, checklistId);
  const items: ChecklistItem[] = res.checklist.items;

  const db = await getDb();
  for (const item of items) {
    await db.runAsync(
      `INSERT INTO checklist_items
         (id, checklist_id, sequence, label, description, item_type,
          unit, min_value, max_value, is_required, is_runtime_trigger)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         sequence=excluded.sequence, label=excluded.label,
         description=excluded.description, item_type=excluded.item_type,
         unit=excluded.unit, min_value=excluded.min_value,
         max_value=excluded.max_value, is_required=excluded.is_required,
         is_runtime_trigger=excluded.is_runtime_trigger`,
      [
        item.id, item.checklist_id, item.sequence, item.label,
        item.description ?? null, item.item_type, item.unit ?? null,
        item.min_value ?? null, item.max_value ?? null,
        item.is_required ? 1 : 0, item.is_runtime_trigger ? 1 : 0,
      ]
    );
  }
}

export async function pullResponsesForTask(
  workOrderId: string,
  taskId: string
): Promise<void> {
  const res = await responseApi.list(workOrderId, taskId);
  const responded = (res.responses as any[]).filter(r => r.response_id);

  const db = await getDb();
  for (const r of responded) {
    await db.runAsync(
      `INSERT INTO checklist_responses
         (id, asset_checklist_item_id, work_order_task_id, responded_by,
          responded_at, numeric_value, boolean_value, text_value, photo_url,
          notes, is_out_of_range, is_pending_sync)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0)
       ON CONFLICT(asset_checklist_item_id, work_order_task_id) DO UPDATE SET
         numeric_value=excluded.numeric_value,
         boolean_value=excluded.boolean_value,
         text_value=excluded.text_value, photo_url=excluded.photo_url,
         notes=excluded.notes, is_out_of_range=excluded.is_out_of_range,
         is_pending_sync=0`,
      [
        r.response_id, r.item_id, taskId, r.responded_by ?? '',
        r.responded_at ?? new Date().toISOString(),
        r.numeric_value ?? null, r.boolean_value ?? null,
        r.text_value ?? null, r.photo_url ?? null,
        r.notes ?? null, r.is_out_of_range ? 1 : 0,
      ]
    );
  }
}

// ── Pull asset types ──────────────────────────────────────────────────────────

export async function pullAssetTypes(): Promise<void> {
  const data = await apiFetch<{ asset_types: any[] }>('GET', '/assets/types');
  const now  = new Date().toISOString();
  const db   = await getDb();

  for (const t of data.asset_types) {
    await db.runAsync(
      `INSERT INTO asset_types (id, company_id, name, description, is_active, synced_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, description=excluded.description,
         is_active=excluded.is_active, synced_at=excluded.synced_at`,
      [t.id, t.company_id, t.name, t.description ?? null, t.is_active ? 1 : 0, now]
    );
  }
}

// ── Pull flat asset list (paginated) ─────────────────────────────────────────
// onProgress(loaded, total) is called after each page — use for progress bar.
// total is an estimate based on pages seen so far.

export async function pullAssets(
  onProgress?: (loaded: number, total: number) => void
): Promise<void> {
  const LIMIT  = 500;
  let   offset = 0;
  let   loaded = 0;
  const now    = new Date().toISOString();
  const db     = await getDb();

  while (true) {
    const data = await apiFetch<{ assets: any[]; total: number }>(
      'GET', `/assets/flat?limit=${LIMIT}&offset=${offset}`
    );

    console.log('pullAssets page:', data.assets.length, 'assets');  // ← add
    console.log('first asset:', JSON.stringify(data.assets[0]));     // ← add

    for (const a of data.assets) {
      try{
	      console.log('inserting:', a.asset_graph_id, a.code);
      await db.runAsync(
        `INSERT INTO asset_nodes (
           asset_graph_id, company_id, code, name, description, status,
           asset_type_id, asset_type_name,
           site_name, building_name, floor_name, space_name,
           location_id, floor_level, address, synced_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(asset_graph_id) DO UPDATE SET
           code=excluded.code, name=excluded.name,
           description=excluded.description, status=excluded.status,
           asset_type_id=excluded.asset_type_id,
           asset_type_name=excluded.asset_type_name,
           site_name=excluded.site_name, building_name=excluded.building_name,
           floor_name=excluded.floor_name, space_name=excluded.space_name,
           location_id=excluded.location_id, floor_level=excluded.floor_level,
           address=excluded.address, synced_at=excluded.synced_at`,
        [
          a.asset_graph_id, a.company_id, a.code, a.name,
          a.description ?? null, a.status ?? 'active',
          a.asset_type_id ?? null, a.asset_type_name ?? null,
          a.site_name ?? null, a.building_name ?? null,
          a.floor_name ?? null, a.space_name ?? null,
          a.location_id ?? null, a.floor_level ?? null,
          a.address ?? null, now,
        ]
      );
      console.log('inserted OK:', a.code);
      } catch(insertErr){
	      console.error('INSERT FAIOLED:',insertErr,a.asset_graph_id);
      }
    }

    loaded += data.assets.length;
    // Estimate total: if we got a full page, assume at least one more page
    const estimatedTotal = data.assets.length === LIMIT
      ? loaded + LIMIT
      : loaded;
    onProgress?.(loaded, estimatedTotal);

    offset += data.assets.length;
    if (data.assets.length < LIMIT) break; // last page
  }

  // Record successful sync timestamp
  await db.runAsync(
    `INSERT INTO sync_meta (entity_type, last_synced_at)
     VALUES ('asset_nodes', ?)
     ON CONFLICT(entity_type) DO UPDATE SET last_synced_at=excluded.last_synced_at`,
    [now]
  );
}

// ── Pull WO cache for a specific asset ───────────────────────────────────────
// Called when a technician selects an asset on a work order.

export async function pullAssetWOCache(assetGraphId: string): Promise<void> {
  const data = await apiFetch<{ work_orders: any[] }>(
    'GET', `/assets/${assetGraphId}/wo-cache`
  );
  const now = new Date().toISOString();
  const db  = await getDb();

  // Replace cache for this asset (keep only latest 2 from server)
  await db.runAsync(
    `DELETE FROM asset_wo_cache WHERE asset_graph_id = ?`,
    [assetGraphId]
  );

  for (const wo of data.work_orders) {
    await db.runAsync(
      `INSERT INTO asset_wo_cache (
         id, asset_graph_id, company_id, title, description,
         status, priority, assigned_to, assigned_to_name,
         actual_duration_minutes, completed_at, created_at,
         tasks_json, synced_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        wo.id, assetGraphId, wo.company_id ?? '',
        wo.title, wo.description ?? null,
        wo.status, wo.priority,
        wo.assigned_to ?? null, wo.assigned_to_name ?? null,
        wo.actual_duration_minutes ?? null,
        wo.completed_at ?? null, wo.created_at,
        JSON.stringify(wo.tasks ?? []), now,
      ]
    );
  }
}

// ── Asset search (local FTS5) ─────────────────────────────────────────────────

export async function searchAssets(query: string): Promise<any[]> {
  if (!query || query.trim().length < 2) {
    return dbQuery<any>(
      `SELECT * FROM asset_nodes WHERE status = 'active' ORDER BY name ASC LIMIT 50`,
      []
    );
  }
  const ftsQuery = query.trim().split(/\s+/).map(w => `${w}*`).join(' ');
  return dbQuery<any>(
    `SELECT a.* FROM asset_nodes a
     JOIN asset_nodes_fts fts ON fts.asset_graph_id = a.asset_graph_id
     WHERE asset_nodes_fts MATCH ?
       AND a.status = 'active'
     ORDER BY rank
     LIMIT 50`,
    [ftsQuery]
  );
}

// ── Check if asset sync is needed ────────────────────────────────────────────
// Returns true if asset_nodes have never been synced.
// Used by app/index.tsx to decide whether to show FirstSyncScreen.

export async function needsAssetSync(): Promise<boolean> {
  const rows = await dbQuery<{ last_synced_at: string }>(
    `SELECT last_synced_at FROM sync_meta WHERE entity_type = 'asset_nodes'`,
    []
  );
  return rows.length === 0;
}

// ── Push (drain outbox) ───────────────────────────────────────────────────────

export async function drainOutbox(): Promise<{ synced: number; failed: number }> {
  const entries = await dbQuery<OutboxEntry>(
    `SELECT * FROM outbox ORDER BY created_at ASC LIMIT 50`
  );

  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const payload = JSON.parse(entry.payload);
      await dispatchOutboxEntry(entry.entity_type as any, entry.operation as any, payload);
      await dbRun(`DELETE FROM outbox WHERE id = ?`, [entry.id]);
      synced++;
    } catch (err) {
      if (err instanceof NetworkError) {
        break;
      }
      if (err instanceof ApiError) {
        await dbRun(
          `UPDATE outbox SET retry_count = retry_count + 1, last_error = ? WHERE id = ?`,
          [err.message, entry.id]
        );
        failed++;
      }
    }
  }

  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO sync_log (synced_at, direction, entity_type, record_count)
     VALUES (?, 'push', 'outbox', ?)`,
    [now, synced]
  );

  return { synced, failed };
}

async function dispatchOutboxEntry(
  entityType: OutboxEntry['entity_type'],
  _operation: OutboxEntry['operation'],
  payload: any
): Promise<void> {
  switch (entityType) {
    case 'task_transition': {
      const { workOrderId, taskId, transition, actual_duration_minutes } = payload;
      if (transition === 'start')    await taskApi.start(workOrderId, taskId);
      if (transition === 'complete') await taskApi.complete(workOrderId, taskId, actual_duration_minutes);
      if (transition === 'skip')     await taskApi.skip(workOrderId, taskId);
      break;
    }
    case 'checklist_response': {
      const { workOrderId, taskId, local_photo_path, ...responseData } = payload;
      if (local_photo_path && !responseData.photo_url) {
        const uploadedUrl = await uploadPhoto(local_photo_path, workOrderId, taskId);
        responseData.photo_url = uploadedUrl;
        await dbRun(
          `UPDATE checklist_responses SET photo_url = ?, local_photo_path = NULL
           WHERE asset_checklist_item_id = ? AND work_order_task_id = ?`,
          [uploadedUrl, responseData.asset_checklist_item_id, taskId]
        );
      }
      await responseApi.submit(workOrderId, taskId, responseData);
      await dbRun(
        `UPDATE checklist_responses SET is_pending_sync = 0
         WHERE asset_checklist_item_id = ? AND work_order_task_id = ?`,
        [responseData.asset_checklist_item_id, taskId]
      );
      break;
    }
    case 'response_delete': {
      const { workOrderId, taskId, responseId } = payload;
      await responseApi.delete(workOrderId, taskId, responseId);
      break;
    }
    case 'work_order': {
      const { action } = payload;
      if (action === 'complete') await workOrderApi.complete(payload.workOrderId);
      else if (action === 'hold')   await workOrderApi.hold(payload.workOrderId);
      else if (action === 'resume') await workOrderApi.start(payload.workOrderId);
      else                          await workOrderApi.create(payload);
      break;
    }
    case 'work_order_update': {
      const { workOrderId, notes } = payload;
      await workOrderApi.addUpdate(workOrderId, notes);
      break;
    }
  }
}

// ── Photo upload ──────────────────────────────────────────────────────────────

async function uploadPhoto(
  localPath: string,
  workOrderId: string,
  taskId: string
): Promise<string> {
  const token = useAuthStore.getState().token;
  const res   = await FileSystem.uploadAsync(
    `${API_URL}/uploads/photos`,
    localPath,
    {
      httpMethod:  'POST',
      uploadType:  FileSystem.FileSystemUploadType.MULTIPART,
      fieldName:   'photo',
      headers:     token ? { Authorization: `Bearer ${token}` } : {},
      parameters:  { work_order_id: workOrderId, task_id: taskId },
    }
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new ApiError(res.status, 'UPLOAD_FAILED', 'Photo upload failed');
  }
  const data = JSON.parse(res.body);
  return data.url as string;
}

// ── Full sync ─────────────────────────────────────────────────────────────────
// Push first, then pull work orders.
// Asset sync is NOT included here — it runs separately via FirstSyncScreen
// on first login, and in the background on subsequent logins.

export async function fullSync(): Promise<void> {
  await drainOutbox();
  await pullWorkOrders();
}

// ── Background asset refresh ──────────────────────────────────────────────────
// Called after fullSync() on subsequent logins (assets already seeded).
// Runs quietly without blocking the UI.

export async function backgroundAssetSync(): Promise<void> {
  try {
    await pullAssetTypes();
    await pullAssets();
  } catch {
    // Non-fatal — assets will refresh on next sync
  }
}

// ── Session-level sync completion flag ───────────────────────────────────────
// Module-level — persists for the JS bundle lifetime (one app session).
// Set by FirstSyncScreen once assets are seeded.
// Read by AuthGuard via isAssetSyncComplete() to prevent redirect loops.

let _assetSyncComplete = false;
export function markAssetSyncComplete() { _assetSyncComplete = true; }
export function isAssetSyncComplete()   { return _assetSyncComplete; }

