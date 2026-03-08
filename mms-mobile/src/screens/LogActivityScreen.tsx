// src/screens/LogActivityScreen.tsx
//
// Allows a technician to record work performed in the field without a
// prior work order. Always creates a completed WO record.
//
// Fields:
//   - What was done       (title + description)
//   - Asset               (existing from picker, or recommend new)
//   - Start time          (defaults to now − duration, overridable)
//   - Duration            (hours + minutes)
//   - Photos              (proof of work)
//
// On submit:
//   - Generates a WO ID locally
//   - Updates the asset_request outbox entry with workOrderId (if recommendation)
//   - Posts to server via workOrderApi.create(); falls back to outbox if offline

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { workOrderApi, NetworkError } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { dbRun, dbQuery } from '@/db/database';
import { generateUUID } from '@/utils/uuid';
import { useAssetPickerStore, type PickedAsset } from '@/store/assetPickerStore';
import { PhotoStrip, type PhotoItem } from '@/components/PhotoStrip';
import { usePhotoUpload } from '@/hooks/usePhotoUpload';
import type { WOPriority } from '@/utils/types';
import { format, subMinutes } from 'date-fns';

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITIES: { value: WOPriority; label: string; bg: string; text: string }[] = [
  { value: 'low',      label: 'Low',      bg: '#3a7d44', text: '#fff' },
  { value: 'medium',   label: 'Medium',   bg: '#e8b400', text: '#111' },
  { value: 'high',     label: 'High',     bg: '#ff6b00', text: '#fff' },
  { value: 'critical', label: 'Critical', bg: '#ff2d2d', text: '#fff' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function assetLocationLabel(a: PickedAsset): string {
  return [a.building_name, a.floor_name, a.space_name].filter(Boolean).join(' › ');
}

function isRecommendation(a: PickedAsset): boolean {
  return a.mode === 'recommendation';
}

// Format a Date for display in the editable time field
function fmtTime(d: Date): string {
  return format(d, 'dd MMM yyyy HH:mm');
}

// Parse an edited time string back to ISO — returns null if unparseable
function parseTimeInput(val: string): string | null {
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Derive start time from end time and duration in minutes
function deriveStartTime(endIso: string, durationMins: number): Date {
  return subMinutes(new Date(endIso), durationMins || 0);
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function LogActivityScreen() {
  const router       = useRouter();
  const user         = useAuthStore(s => s.user!);
  const pending      = useAssetPickerStore(s => s.pending);
  const clearPending = useAssetPickerStore(s => s.clear);

  const [title,         setTitle]         = useState('');
  const [desc,          setDesc]          = useState('');
  const [priority,      setPriority]      = useState<WOPriority>('medium');
  const [pickedAsset,   setPickedAsset]   = useState<PickedAsset | null>(null);
  const [durationHours, setDurationHours] = useState('');
  const [durationMins,  setDurationMins]  = useState('');
  const [photos,        setPhotos]        = useState<PhotoItem[]>([]);
  const [loading,       setLoading]       = useState(false);

  // Time fields — shown as editable text, defaulting to now / now−duration
  const [completedAt,     setCompletedAt]     = useState<string>(() => new Date().toISOString());
  const [startedAt,       setStartedAt]       = useState<string>(() => new Date().toISOString());
  const [startOverridden, setStartOverridden] = useState(false);

  const [completedAtText, setCompletedAtText] = useState(() => fmtTime(new Date()));
  const [startedAtText,   setStartedAtText]   = useState(() => fmtTime(new Date()));

  const { saveAndSync } = usePhotoUpload();

  // Populate asset fields when returning from AssetPickerScreen
  useEffect(() => {
    if (pending) {
      setPickedAsset(pending);
      clearPending();
    }
  }, [pending]);

  // Auto-derive start time from completed time + duration unless overridden
  const totalDurationMins = useCallback(() => {
    return (parseInt(durationHours || '0', 10) * 60) + parseInt(durationMins || '0', 10);
  }, [durationHours, durationMins]);

  useEffect(() => {
    if (startOverridden) return;
    const mins = totalDurationMins();
    const derived = deriveStartTime(completedAt, mins);
    setStartedAt(derived.toISOString());
    setStartedAtText(fmtTime(derived));
  }, [completedAt, durationHours, durationMins, startOverridden]);

  function handleCompletedAtChange(val: string) {
    setCompletedAtText(val);
    const iso = parseTimeInput(val);
    if (iso) setCompletedAt(iso);
  }

  function handleStartedAtChange(val: string) {
    setStartedAtText(val);
    setStartOverridden(true);
    const iso = parseTimeInput(val);
    if (iso) setStartedAt(iso);
  }

  function resetStartTime() {
    setStartOverridden(false);
    // Trigger re-derive via useEffect
    setDurationMins(m => m);
  }

  async function handleSubmit() {
    if (!title.trim()) { Alert.alert('Required', 'Please describe what was done'); return; }

    // Validate times parse correctly
    if (!parseTimeInput(completedAtText)) {
      Alert.alert('Invalid time', 'End time could not be parsed. Use format: DD MMM YYYY HH:MM');
      return;
    }
    if (!parseTimeInput(startedAtText)) {
      Alert.alert('Invalid time', 'Start time could not be parsed. Use format: DD MMM YYYY HH:MM');
      return;
    }

    setLoading(true);

    const now        = new Date().toISOString();
    const woId       = generateUUID();
    const durationMinutes = totalDurationMins() || null;

    const isRec          = pickedAsset ? isRecommendation(pickedAsset) : false;
    const assetRequestId = isRec ? (pickedAsset as any).asset_request_id : null;
    const graphId        = isRec ? null : (pickedAsset?.asset_graph_id ?? null);
    const locationStr    = pickedAsset ? assetLocationLabel(pickedAsset) : null;
    const assetLabel     = pickedAsset
      ? isRec
        ? `⧗ ${pickedAsset.name}`
        : `${(pickedAsset as any).code} — ${pickedAsset.name}`
      : null;

    // Write WO locally
    await dbRun(
      `INSERT INTO work_orders
         (id, company_id, title, description, status, priority,
          asset_graph_id, asset_label, asset_type,
          location, building, assigned_to,
          actual_duration_minutes, started_at, completed_at,
          created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        woId, user.company_id, title.trim(), desc.trim() || null,
        'completed', priority,
        graphId,
        assetLabel,
        pickedAsset?.asset_type_name ?? null,
        locationStr,
        pickedAsset?.building_name ?? null,
        user.id,
        durationMinutes,
        startedAt,
        completedAt,
        now, now,
      ]
    );

    // If this WO references a recommended (pending) asset, update the
    // asset_request outbox entry to include workOrderId so drainOutbox
    // can POST to /work-orders/:workOrderId/asset-requests correctly.
    if (assetRequestId) {
      const existing = await dbQuery<{ payload: string }>(
        `SELECT payload FROM outbox WHERE entity_id = ?`,
        [assetRequestId]
      );
      if (existing[0]) {
        const updated = { ...JSON.parse(existing[0].payload), workOrderId: woId };
        await dbRun(
          `UPDATE outbox SET payload = ? WHERE entity_id = ?`,
          [JSON.stringify(updated), assetRequestId]
        );
      }
    }

    const apiPayload = {
      title:                   title.trim(),
      description:             desc.trim() || undefined,
      priority,
      status:                  'completed' as const,
      asset_graph_id:          graphId ?? undefined,
      asset_request_id:        assetRequestId ?? undefined,
      actual_duration_minutes: durationMinutes ?? undefined,
      started_at:              startedAt,
      completed_at:            completedAt,
    };

    try {
      await workOrderApi.create(apiPayload);
      for (const photo of photos) {
        saveAndSync(woId, photo).catch(() => {});
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        await dbRun(
          `INSERT INTO outbox (id, entity_type, entity_id, operation, payload, created_at)
           VALUES (?,?,?,?,?,?)`,
          [
            `wo_create_${woId}`, 'work_order', woId, 'CREATE',
            JSON.stringify(apiPayload),
            now,
          ]
        );
        for (const photo of photos) {
          saveAndSync(woId, photo).catch(() => {});
        }
      } else {
        Alert.alert('Error', 'Failed to save activity. Please try again.');
        setLoading(false);
        return;
      }
    } finally {
      setLoading(false);
    }

    router.back();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const locationLabel = pickedAsset ? assetLocationLabel(pickedAsset) : null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Log Field Activity</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* What was done */}
        <View style={styles.field}>
          <Text style={styles.label}>Activity *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Replaced faulty contactor on AHU-03"
            placeholderTextColor="#444"
            value={title}
            onChangeText={setTitle}
          />
        </View>

        {/* Asset */}
        <View style={styles.field}>
          <Text style={styles.label}>Asset</Text>
          <TouchableOpacity
            style={[styles.input, styles.assetPickerBtn]}
            onPress={() => router.push('/(app)/work-orders/asset-picker')}
            activeOpacity={0.7}
          >
            {pickedAsset ? (
              <View style={styles.assetPickedContent}>
                <View style={styles.assetPickedMain}>
                  {isRecommendation(pickedAsset) ? (
                    <View style={styles.pendingPill}>
                      <Text style={styles.pendingPillText}>⧗ PENDING</Text>
                    </View>
                  ) : (
                    <Text style={styles.assetPickedCode}>{(pickedAsset as any).code}</Text>
                  )}
                  {pickedAsset.asset_type_name ? (
                    <View style={styles.assetTypePill}>
                      <Text style={styles.assetTypePillText}>
                        {pickedAsset.asset_type_name.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.assetPickedName}>{pickedAsset.name}</Text>
                {isRecommendation(pickedAsset) && (
                  <Text style={styles.assetPendingHint}>
                    Recommendation queued — admin will add this asset
                  </Text>
                )}
                {locationLabel ? (
                  <Text style={styles.assetPickedLocation}>{locationLabel}</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.assetPickerPlaceholder}>Tap to select asset…</Text>
            )}
            <Text style={styles.assetPickerChevron}>›</Text>
          </TouchableOpacity>
          {pickedAsset && (
            <TouchableOpacity style={styles.clearAsset} onPress={() => setPickedAsset(null)}>
              <Text style={styles.clearAssetText}>✕  CLEAR ASSET</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Priority */}
        <View style={styles.field}>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.priorityRow}>
            {PRIORITIES.map(p => (
              <TouchableOpacity
                key={p.value}
                style={[
                  styles.priorityBtn,
                  priority === p.value && { backgroundColor: p.bg, borderColor: p.bg },
                ]}
                onPress={() => setPriority(p.value)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.priorityText,
                  priority === p.value && { color: p.text, fontWeight: '700' },
                ]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Duration */}
        <View style={styles.field}>
          <Text style={styles.label}>Duration</Text>
          <View style={styles.durationRow}>
            <View style={styles.durationField}>
              <TextInput
                style={[styles.input, styles.durationInput]}
                placeholder="0"
                placeholderTextColor="#444"
                value={durationHours}
                onChangeText={v => setDurationHours(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Text style={styles.durationUnit}>hrs</Text>
            </View>
            <View style={styles.durationField}>
              <TextInput
                style={[styles.input, styles.durationInput]}
                placeholder="0"
                placeholderTextColor="#444"
                value={durationMins}
                onChangeText={v => {
                  const n = parseInt(v.replace(/[^0-9]/g, '') || '0', 10);
                  setDurationMins(String(Math.min(n, 59)));
                }}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.durationUnit}>min</Text>
            </View>
          </View>
        </View>

        {/* Times */}
        <View style={styles.field}>
          <Text style={styles.label}>End Time</Text>
          <TextInput
            style={styles.input}
            value={completedAtText}
            onChangeText={handleCompletedAtChange}
            placeholder="DD MMM YYYY HH:MM"
            placeholderTextColor="#444"
            autoCapitalize="none"
          />
          <Text style={styles.fieldHint}>When did you finish? Defaults to now.</Text>
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Start Time</Text>
            {startOverridden && (
              <TouchableOpacity onPress={resetStartTime}>
                <Text style={styles.resetBtn}>reset</Text>
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            style={[styles.input, startOverridden && styles.inputOverridden]}
            value={startedAtText}
            onChangeText={handleStartedAtChange}
            placeholder="DD MMM YYYY HH:MM"
            placeholderTextColor="#444"
            autoCapitalize="none"
          />
          <Text style={styles.fieldHint}>
            {startOverridden ? 'Manually set.' : 'Derived from end time − duration.'}
          </Text>
        </View>

        {/* Description */}
        <View style={styles.field}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            multiline
            placeholder="Additional details about the work performed…"
            placeholderTextColor="#444"
            value={desc}
            onChangeText={setDesc}
            textAlignVertical="top"
          />
        </View>

        {/* Photos */}
        <PhotoStrip
          photos={photos}
          onAdd={photo => setPhotos(prev => [...prev, photo])}
          onRemove={id => setPhotos(prev => prev.filter(p => p.id !== id))}
          disabled={loading}
        />

      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.createBtn, (!title.trim() || loading) && styles.createBtnDisabled]}
          onPress={handleSubmit}
          disabled={!title.trim() || loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#0d0d0f" />
            : <Text style={styles.createBtnText}>Log Activity</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:               { flex: 1, backgroundColor: '#0d0d0f' },
  header:             { backgroundColor: '#111114', borderBottomWidth: 1, borderBottomColor: '#2a2a30', paddingHorizontal: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancelBtn:          {},
  cancelText:         { fontSize: 13, color: '#f0a500', fontFamily: 'monospace' },
  headerTitle:        { fontSize: 13, fontWeight: '700', color: '#e8e4dc', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'monospace' },
  scroll:             { flex: 1, padding: 18 },
  field:              { marginBottom: 20 },
  labelRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  label:              { fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: '#555', fontFamily: 'monospace' },
  fieldHint:          { fontSize: 9, color: '#3a3a45', fontFamily: 'monospace', marginTop: 5, letterSpacing: 0.4 },
  resetBtn:           { fontSize: 9, color: '#f0a500', fontFamily: 'monospace', letterSpacing: 0.8 },
  input:              { backgroundColor: '#1a1a1e', borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, paddingHorizontal: 13, paddingVertical: 12, color: '#e8e4dc', fontSize: 14, fontFamily: 'monospace' },
  inputMulti:         { minHeight: 90, textAlignVertical: 'top' },
  inputOverridden:    { borderColor: '#f0a50066' },

  // Asset picker
  assetPickerBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  assetPickerPlaceholder: { flex: 1, fontSize: 14, color: '#444', fontFamily: 'monospace' },
  assetPickerChevron: { fontSize: 20, color: '#444', fontFamily: 'monospace', marginLeft: 8 },
  assetPickedContent: { flex: 1 },
  assetPickedMain:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  assetPickedCode:    { fontSize: 13, fontWeight: '700', color: '#f0a500', fontFamily: 'monospace' },
  assetTypePill:      { backgroundColor: '#222228', borderRadius: 2, paddingHorizontal: 6, paddingVertical: 2 },
  assetTypePillText:  { fontSize: 8, color: '#888', fontFamily: 'monospace', letterSpacing: 1 },
  assetPickedName:    { fontSize: 12, color: '#e8e4dc', fontFamily: 'monospace' },
  assetPickedLocation:{ fontSize: 10, color: '#555', fontFamily: 'monospace', marginTop: 1 },
  clearAsset:         { marginTop: 8, alignSelf: 'flex-start' },
  clearAssetText:     { fontSize: 9, color: '#555', fontFamily: 'monospace', letterSpacing: 1 },
  pendingPill:        { backgroundColor: '#2a1f00', borderWidth: 1, borderColor: '#f0a50066', borderRadius: 3, paddingHorizontal: 7, paddingVertical: 3 },
  pendingPillText:    { fontSize: 9, color: '#f0a500', fontFamily: 'monospace', letterSpacing: 1 },
  assetPendingHint:   { fontSize: 9, color: '#666', fontFamily: 'monospace', marginTop: 2, fontStyle: 'italic' },

  // Priority
  priorityRow:        { flexDirection: 'row', gap: 8 },
  priorityBtn:        { flex: 1, borderWidth: 1, borderColor: '#2a2a30', borderRadius: 3, paddingVertical: 8, alignItems: 'center', backgroundColor: '#1a1a1e' },
  priorityText:       { fontSize: 10, color: '#555', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'monospace' },

  // Duration
  durationRow:        { flexDirection: 'row', gap: 12 },
  durationField:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  durationInput:      { width: 72, textAlign: 'center' },
  durationUnit:       { fontSize: 11, color: '#555', fontFamily: 'monospace', letterSpacing: 0.6 },

  // Footer
  footer:             { backgroundColor: '#111114', borderTopWidth: 1, borderTopColor: '#22222a', padding: 14 },
  createBtn:          { backgroundColor: '#f0a500', borderRadius: 5, padding: 15, alignItems: 'center' },
  createBtnDisabled:  { opacity: 0.4 },
  createBtnText:      { fontSize: 13, color: '#0d0d0f', fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: 'monospace' },
});
