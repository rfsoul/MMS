// src/screens/WorkOrderDetailScreen.tsx
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { dbQuery, dbRun } from '@/db/database';
import { useTasks, localTransitionTask } from '@/hooks/useWorkOrders';
import { pullTasksForWorkOrder, drainOutbox } from '@/services/syncEngine';
import { workOrderApi } from '@/services/api';
import { useSync } from '@/hooks/useSync';
import { PriorityBadge } from '@/components/PriorityBadge';
import { ProgressBar }   from '@/components/ProgressBar';
import { PhotoStrip, type PhotoItem } from '@/components/PhotoStrip';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import type { WorkOrder, WorkOrderTask } from '@/utils/types';
import { fmtDuration, getTaskProgress } from '@/utils/format';
import { format } from 'date-fns';

const TASK_TYPE_ICON: Record<string, string> = {
  checklist_execution: '☑',
  safety_check:        '⚠',
  inspection:          '🔍',
  general:             '●',
  reading:             '◎',
};

const STATUS_DOT: Record<string, string> = {
  completed:   '#4adf7a',
  skipped:     '#555',
  in_progress: '#f0a500',
  pending:     '#333',
};

// Format a Date for display in editable time fields
function fmtDateTime(d: Date): string {
  return format(d, 'dd MMM yyyy HH:mm');
}

// Parse an edited time string back to ISO — returns null if unparseable
function parseTimeInput(val: string): string | null {
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function WorkOrderDetailScreen() {
  const { id }   = useLocalSearchParams<{ id: string }>();
  const router   = useRouter();
  const { isOnline } = useSync();

  const [wo,          setWo]          = useState<WorkOrder | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [photos,      setPhotos]      = useState<PhotoItem[]>([]);
  const [fieldNotes,  setFieldNotes]  = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  // Time fields — ISO values are the source of truth.
  // Text fields are for display/edit only. Manual edits parse back to ISO.
  const [startedAtIso,    setStartedAtIso]    = useState('');
  const [completedAtIso,  setCompletedAtIso]  = useState('');
  const [startedAtText,   setStartedAtText]   = useState('');
  const [completedAtText, setCompletedAtText] = useState('');
  const [startOverridden, setStartOverridden] = useState(false);

  const { tasks, reload: reloadTasks } = useTasks(id);
  const { saveAndSync, loadPhotos, removePhoto } = usePhotoUpload();

  useEffect(() => {
    loadWO();
    loadPhotos(id).then(setPhotos).catch(() => {});
  }, [id]);

  // Pull tasks + checklist items when online and we open a WO
  useEffect(() => {
    if (isOnline && id) {
      pullTasksForWorkOrder(id)
        .then(reloadTasks)
        .catch(() => {});
    }
  }, [isOnline, id]);

  async function loadWO() {
    setLoading(true);
    try {
      const rows = await dbQuery<WorkOrder>(
        `SELECT * FROM work_orders WHERE id = ?`, [id]
      );
      const loaded = rows[0] ?? null;
      setWo(loaded);

      if (loaded && loaded.status !== 'completed') {
        // Stamp started_at the first time a technician opens an active WO.
        // If already stamped (e.g. resumed after hold), keep the existing value.
        const now = new Date().toISOString();
        const existingStart = (loaded as any).started_at ?? null;
        const effectiveStart = existingStart ?? now;

        if (!existingStart) {
          await dbRun(
            `UPDATE work_orders SET started_at = ?, updated_at = ? WHERE id = ?`,
            [now, now, id]
          );
        }

        const nowIso = new Date().toISOString();
        setStartedAtIso(effectiveStart);
        setCompletedAtIso(nowIso);
        setStartedAtText(fmtDateTime(new Date(effectiveStart)));
        setCompletedAtText(fmtDateTime(new Date(nowIso)));
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshWO() {
    if (!isOnline) return;
    try {
      const res = await workOrderApi.get(id);
      const updated = res.work_order;
      await dbRun(
        `UPDATE work_orders SET status=?, updated_at=? WHERE id=?`,
        [updated.status, updated.updated_at, id]
      );
      setWo(prev => prev ? { ...prev, status: updated.status } : prev);
    } catch { /* offline — show local state */ }
  }

  const prog    = getTaskProgress(tasks);
  const allDone = prog.done === prog.total && prog.total > 0;

  async function handleSubmit() {
    // Use stored ISO values directly — no re-parsing of display strings.
    // If the technician has manually edited the text fields, parse those;
    // otherwise fall back to the ISO values set on open.
    const resolvedCompletedAt = parseTimeInput(completedAtText) ?? (completedAtIso || new Date().toISOString());
    const resolvedStartedAt   = parseTimeInput(startedAtText)   ?? (startedAtIso   || resolvedCompletedAt);

    const now = new Date().toISOString();
    try {
      // Soft check: warn if tasks are incomplete but don't block — the server
      // enforces the rule via DB trigger and will reject if needed.
      const incomplete = await dbQuery<{ count: number }>(
        `SELECT COUNT(*) AS count FROM work_order_tasks
         WHERE work_order_id = ? AND status NOT IN ('completed', 'skipped')`,
        [id]
      );
      if (incomplete[0]?.count > 0) {
        await new Promise<void>((resolve, reject) => {
          Alert.alert(
            'Tasks not complete',
            `${incomplete[0].count} task${incomplete[0].count === 1 ? '' : 's'} still pending. Submit anyway?`,
            [
              { text: 'Cancel', style: 'cancel', onPress: () => reject() },
              { text: 'Submit', style: 'default', onPress: () => resolve() },
            ]
          );
        }).catch(() => { throw new Error('CANCELLED'); });
      }

      setSubmitting(true);
      await dbRun(
        `UPDATE work_orders
         SET status='completed', started_at=?, completed_at=?, updated_at=?
         WHERE id=?`,
        [resolvedStartedAt, resolvedCompletedAt, now, id]
      );
      setWo(prev => prev ? { ...prev, status: 'completed' } : prev);

      // Remove stale status outbox entries so they don't overwrite completed
      await dbRun(
        `DELETE FROM outbox WHERE entity_type='work_order' AND entity_id=?`,
        [id]
      );

      await dbRun(
        `INSERT INTO outbox (id, entity_type, entity_id, operation, payload, created_at)
         VALUES (?,?,?,?,?,?)`,
        [
          `wo_submit_${id}`, 'work_order', id, 'UPDATE',
          JSON.stringify({
            action:      'complete',
            workOrderId: id,
            notes:       fieldNotes.trim() || null,
            started_at:  resolvedStartedAt,
            completed_at: resolvedCompletedAt,
          }),
          now,
        ]
      );

      if (isOnline) {
        drainOutbox().catch(() => {});
      }

      router.back();
    } catch (err: any) {
      if (err?.message !== 'CANCELLED') {
        Alert.alert('Error', 'Failed to submit work order. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleHold() {
    const now = new Date().toISOString();
    await dbRun(`UPDATE work_orders SET status='on_hold', updated_at=? WHERE id=?`, [now, id]);
    setWo(prev => prev ? { ...prev, status: 'on_hold' } : prev);
    await dbRun(
      `INSERT OR REPLACE INTO outbox (id, entity_type, entity_id, operation, payload, created_at)
       VALUES (?,?,?,?,?,?)`,
      [`wo_status_${id}`, 'work_order', id, 'UPDATE',
       JSON.stringify({ action: 'hold', workOrderId: id }), now]
    );
  }

  async function handleResume() {
    const now = new Date().toISOString();
    await dbRun(`UPDATE work_orders SET status='in_progress', updated_at=? WHERE id=?`, [now, id]);
    setWo(prev => prev ? { ...prev, status: 'in_progress' } : prev);
    await dbRun(
      `INSERT OR REPLACE INTO outbox (id, entity_type, entity_id, operation, payload, created_at)
       VALUES (?,?,?,?,?,?)`,
      [`wo_status_${id}`, 'work_order', id, 'UPDATE',
       JSON.stringify({ action: 'resume', workOrderId: id }), now]
    );
  }

  async function handleAddPhoto(photo: PhotoItem) {
    setPhotos(prev => [...prev, photo]);
    const synced = await saveAndSync(id, photo);
    if (synced) {
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, ...synced } : p));
    }
  }

  async function handleRemovePhoto(photoId: string) {
    await removePhoto(photoId);
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  }

  async function handleOpenChecklist(task: WorkOrderTask) {
    if (task.status !== 'in_progress') {
      await localTransitionTask(id, task, 'start');
      reloadTasks();
    }
    router.push(`./checklist/${task.id}`);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f0a500" />
      </View>
    );
  }

  if (!wo) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Work order not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerSub} numberOfLines={1}>{wo.type?.toUpperCase() ?? 'WORK ORDER'}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{wo.title}</Text>
        </View>
        <PriorityBadge priority={wo.priority} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroStatus}>
            <Text style={styles.statusText}>{wo.status.replace('_', ' ').toUpperCase()}</Text>
            {prog.total > 0 && (
              <Text style={styles.progText}>{prog.done}/{prog.total} tasks · {prog.pct}%</Text>
            )}
          </View>
          <ProgressBar pct={prog.pct} hasProgress={prog.done > 0} height={4} />
          {wo.description ? (
            <Text style={styles.desc}>{wo.description}</Text>
          ) : null}
        </View>

        {/* Meta grid */}
        <View style={styles.grid}>
          {[
            { label: 'Asset',    val: wo.asset_label   ?? '—' },
            { label: 'Type',     val: wo.asset_type    ?? '—' },
            { label: 'Location', val: wo.location      ?? '—' },
            { label: 'Building', val: wo.building      ?? '—' },
            { label: 'Est. Duration', val: fmtDuration(wo.estimated_duration_minutes) },
            { label: 'Created',  val: format(new Date(wo.created_at), 'd MMM yyyy') },
          ].map(({ label, val }) => (
            <View key={label} style={styles.gridCell}>
              <Text style={styles.gridLabel}>{label}</Text>
              <Text style={styles.gridVal} numberOfLines={2}>{val}</Text>
            </View>
          ))}
        </View>

        {/* Tasks */}
        <Text style={styles.sectionHead}>Tasks</Text>
        {tasks.map(task => {
          const isChecklist = task.task_type === 'checklist_execution';
          const canAct = isChecklist && task.status !== 'completed' && task.status !== 'skipped';
          const dotColor = STATUS_DOT[task.status] ?? '#333';
          const icon = task.status === 'completed' ? '✓'
                     : task.status === 'skipped'   ? '—'
                     : TASK_TYPE_ICON[task.task_type] ?? '●';

          return (
            <View key={task.id} style={[styles.taskRow, task.status === 'in_progress' && styles.taskRowActive]}>
              <View style={[styles.taskDot, { backgroundColor: dotColor }]}>
                <Text style={styles.taskDotText}>{icon}</Text>
              </View>
              <View style={styles.taskInfo}>
                <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
                <Text style={styles.taskMeta}>
                  {task.task_type.replace(/_/g, ' ')}
                  {task.estimated_duration_minutes ? ` · ${fmtDuration(task.estimated_duration_minutes)}` : ''}
                </Text>
              </View>
              {canAct && (
                <TouchableOpacity
                  style={styles.taskBtn}
                  onPress={() => handleOpenChecklist(task)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.taskBtnText}>
                    {task.status === 'in_progress' ? 'Continue' : 'Start'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Photos */}
        <Text style={styles.sectionHead}>Photos</Text>
        <View style={styles.photoSection}>
          <PhotoStrip
            photos={photos}
            onAdd={handleAddPhoto}
            onRemove={handleRemovePhoto}
            disabled={wo.status === 'completed'}
            label=""
          />
        </View>

        {/* Field notes */}
        <Text style={styles.sectionHead}>Field Notes</Text>
        <View style={styles.notesSection}>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder={wo.status === 'completed' ? 'No notes recorded.' : 'Enter any notes about the work performed…'}
            placeholderTextColor="#444"
            value={fieldNotes}
            onChangeText={setFieldNotes}
            textAlignVertical="top"
            editable={wo.status !== 'completed'}
          />
        </View>

        {/* Time fields — only shown when WO is active (not yet completed) */}
        {wo.status !== 'completed' && (
          <>
            <Text style={styles.sectionHead}>Time on Job</Text>
            <View style={styles.timeSection}>
              <View style={styles.timeField}>
                <Text style={styles.timeLabel}>Started</Text>
                <TextInput
                  style={[styles.timeInput, startOverridden && styles.timeInputOverridden]}
                  value={startedAtText}
                  onChangeText={v => {
                    setStartedAtText(v);
                    setStartOverridden(true);
                    const iso = parseTimeInput(v);
                    if (iso) setStartedAtIso(iso);
                  }}
                  placeholder="DD MMM YYYY HH:MM"
                  placeholderTextColor="#444"
                  autoCapitalize="none"
                />
                {startOverridden && (
                  <TouchableOpacity
                    onPress={() => {
                      // Revert to the value stored in local DB
                      dbQuery<WorkOrder>(`SELECT started_at FROM work_orders WHERE id = ?`, [id])
                        .then(rows => {
                          const s = (rows[0] as any)?.started_at;
                          if (s) {
                            setStartedAtIso(s);
                            setStartedAtText(fmtDateTime(new Date(s)));
                            setStartOverridden(false);
                          }
                        });
                    }}
                  >
                    <Text style={styles.timeReset}>reset</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.timeField}>
                <Text style={styles.timeLabel}>Finished</Text>
                <TextInput
                  style={styles.timeInput}
                  value={completedAtText}
                  onChangeText={v => {
                    setCompletedAtText(v);
                    const iso = parseTimeInput(v);
                    if (iso) setCompletedAtIso(iso);
                  }}
                  placeholder="DD MMM YYYY HH:MM"
                  placeholderTextColor="#444"
                  autoCapitalize="none"
                />
                <Text style={styles.timeHint}>Defaults to now on submit</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Action bar */}
      <View style={styles.actionBar}>
        {wo.status !== 'completed' && (
          wo.status === 'on_hold'
            ? <TouchableOpacity style={[styles.secondaryBtn, styles.resumeBtn]} onPress={handleResume} activeOpacity={0.8}>
                <Text style={[styles.secondaryBtnText, { color: '#f0a500' }]}>Resume</Text>
              </TouchableOpacity>
            : <TouchableOpacity style={styles.secondaryBtn} onPress={handleHold} activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>Hold</Text>
              </TouchableOpacity>
        )}

        {wo.status !== 'completed' ? (
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting
              ? <ActivityIndicator color="#0d0d0f" />
              : <Text style={styles.submitBtnText}>Submit</Text>
            }
          </TouchableOpacity>
        ) : (
          <View style={[styles.submitBtn, styles.completedBtn]}>
            <Text style={styles.completedBtnText}>✓ Completed</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:            { flex: 1, backgroundColor: '#0d0d0f' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d0f' },
  notFound:        { color: '#555', fontFamily: 'monospace', fontSize: 13 },
  header:          { backgroundColor: '#111114', borderBottomWidth: 1, borderBottomColor: '#2a2a30', paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn:         { paddingRight: 4 },
  backText:        { fontSize: 26, color: '#f0a500', fontFamily: 'monospace', lineHeight: 28 },
  headerInfo:      { flex: 1, minWidth: 0 },
  headerSub:       { fontSize: 10, color: '#555', letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'monospace' },
  headerTitle:     { fontSize: 14, fontWeight: '700', color: '#e8e4dc', fontFamily: 'monospace' },
  scroll:          { flex: 1 },
  scrollContent:   { paddingBottom: 20 },
  hero:            { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1e1e22' },
  heroStatus:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  statusText:      { fontSize: 11, fontWeight: '700', color: '#f0a500', letterSpacing: 1, fontFamily: 'monospace' },
  progText:        { fontSize: 11, color: '#555', fontFamily: 'monospace' },
  desc:            { marginTop: 12, fontSize: 13, color: '#888', lineHeight: 20, fontFamily: 'monospace' },
  grid:            { flexDirection: 'row', flexWrap: 'wrap', padding: 14, borderBottomWidth: 1, borderBottomColor: '#1e1e22', gap: 12 },
  gridCell:        { width: '46%', gap: 3 },
  gridLabel:       { fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: '#444', fontFamily: 'monospace' },
  gridVal:         { fontSize: 13, color: '#e8e4dc', fontWeight: '600', fontFamily: 'monospace' },
  sectionHead:     { paddingHorizontal: 18, paddingVertical: 12, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#444', borderBottomWidth: 1, borderBottomColor: '#1e1e22', fontFamily: 'monospace' },
  taskRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#1a1a1e', gap: 12 },
  taskRowActive:   { backgroundColor: '#141410' },
  taskDot:         { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  taskDotText:     { fontSize: 12, color: '#0d0d0f', fontWeight: '700' },
  taskInfo:        { flex: 1 },
  taskTitle:       { fontSize: 13, fontWeight: '600', color: '#e8e4dc', fontFamily: 'monospace' },
  taskMeta:        { fontSize: 10, color: '#555', marginTop: 2, textTransform: 'capitalize', fontFamily: 'monospace' },
  taskBtn:         { borderWidth: 1, borderColor: '#f0a500', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 5 },
  taskBtnText:     { fontSize: 10, color: '#f0a500', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'monospace' },
  actionBar:            { backgroundColor: '#111114', borderTopWidth: 1, borderTopColor: '#22222a', paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', gap: 10 },
  secondaryBtn:         { borderWidth: 1, borderColor: '#2a2a30', borderRadius: 5, paddingHorizontal: 16, paddingVertical: 14 },
  resumeBtn:            { borderColor: '#f0a500' },
  secondaryBtnText:     { fontSize: 12, color: '#888', letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', fontFamily: 'monospace' },
  submitBtn:            { flex: 1, backgroundColor: '#f0a500', borderRadius: 5, padding: 14, alignItems: 'center', justifyContent: 'center' },
  submitBtnText:        { fontSize: 13, color: '#0d0d0f', fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', fontFamily: 'monospace' },
  completedBtn:         { flex: 1, backgroundColor: '#0a2a14' },
  completedBtnText:     { fontSize: 13, color: '#4adf7a', fontWeight: '700', letterSpacing: 1.2, fontFamily: 'monospace', textTransform: 'uppercase' },
  notesSection:         { padding: 18, paddingTop: 14 },
  notesInput:           { backgroundColor: '#1a1a1e', borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, padding: 13, color: '#e8e4dc', fontSize: 13, fontFamily: 'monospace', minHeight: 100, textAlignVertical: 'top' },
  photoSection:         { paddingTop: 14, paddingBottom: 6 },
  timeSection:          { padding: 18, paddingTop: 14, gap: 16 },
  timeField:            { gap: 6 },
  timeLabel:            { fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: '#444', fontFamily: 'monospace' },
  timeInput:            { backgroundColor: '#1a1a1e', borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, paddingHorizontal: 13, paddingVertical: 10, color: '#e8e4dc', fontSize: 13, fontFamily: 'monospace' },
  timeInputOverridden:  { borderColor: '#f0a50066' },
  timeReset:            { fontSize: 9, color: '#f0a500', fontFamily: 'monospace', letterSpacing: 0.8, marginTop: 4 },
  timeHint:             { fontSize: 9, color: '#3a3a45', fontFamily: 'monospace', marginTop: 4 },
});
