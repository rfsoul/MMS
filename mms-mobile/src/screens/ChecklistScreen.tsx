// src/screens/ChecklistScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useChecklistItems, useResponses, localSaveResponse, localTransitionTask } from '@/hooks/useWorkOrders';
import { dbQuery } from '@/db/database';
import type { WorkOrderTask, ChecklistItem } from '@/utils/types';

export default function ChecklistScreen() {
  const { id: workOrderId, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const router = useRouter();

  const [task,     setTask]    = useState<WorkOrderTask | null>(null);
  const [taskLoaded, setTaskLoaded] = useState(false);

  // Load task
  React.useEffect(() => {
    dbQuery<WorkOrderTask>(
      `SELECT * FROM work_order_tasks WHERE id = ?`, [taskId]
    ).then(rows => {
      setTask(rows[0] ?? null);
      setTaskLoaded(true);
    });
  }, [taskId]);

  const checklistId = task?.asset_checklist_id ?? null;
  const { items,     loading: itemsLoading  } = useChecklistItems(checklistId);
  const { responses, reload: reloadResponses } = useResponses(taskId);

  // Local form state: itemId → pending input value
  const [inputs,  setInputs]  = useState<Record<string, string>>({});
  const [booleans, setBooleans] = useState<Record<string, boolean | undefined>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});

  const allRequired  = items.filter(i => i.is_required);
  const requiredDone = allRequired.filter(i => responses[i.id] != null).length;
  const canComplete  = requiredDone === allRequired.length && allRequired.length > 0;

  async function saveItem(item: ChecklistItem) {
    setSaving(prev => ({ ...prev, [item.id]: true }));
    Keyboard.dismiss();
    try {
      let data: Parameters<typeof localSaveResponse>[4] extends ChecklistItem ? never : Record<string, any> = {};

      switch (item.item_type) {
        case 'measurement': {
          const num = parseFloat(inputs[item.id] ?? '');
          if (isNaN(num)) { Alert.alert('Invalid value', 'Enter a valid number'); return; }
          data = { numeric_value: num };
          break;
        }
        case 'true_false':
        case 'step': {
          const val = booleans[item.id];
          if (val === undefined) { Alert.alert('Required', 'Select Pass or Fail'); return; }
          data = { boolean_value: val };
          break;
        }
        case 'text': {
          const txt = (inputs[item.id] ?? '').trim();
          if (!txt) { Alert.alert('Required', 'Enter a value'); return; }
          data = { text_value: txt };
          break;
        }
        case 'photo': {
          // Handled by pickPhoto — data.photo_url already set
          const url = inputs[item.id]?.trim();
          if (!url) { Alert.alert('Required', 'Capture or enter a photo reference'); return; }
          data = { photo_url: url };
          break;
        }
      }

      await localSaveResponse(workOrderId, taskId, item.id, data as any, item);
      await reloadResponses();
    } finally {
      setSaving(prev => ({ ...prev, [item.id]: false }));
    }
  }

  async function pickPhoto(item: ChecklistItem) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera Permission', 'Camera permission is required for photo items.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const localPath = result.assets[0].uri;
      setInputs(prev => ({ ...prev, [item.id]: localPath }));
      await localSaveResponse(
        workOrderId, taskId, item.id,
        { local_photo_path: localPath },
        item
      );
      await reloadResponses();
    }
  }

  async function handleCompleteTask() {
    if (!task) return;
    Alert.alert(
      'Complete Task',
      'Mark this checklist task as completed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Complete', style: 'default',
          onPress: async () => {
            await localTransitionTask(workOrderId, task, 'complete');
            router.back();
          },
        },
      ]
    );
  }

  if (!taskLoaded || itemsLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f0a500" />
      </View>
    );
  }

  if (!task || !checklistId) {
    return (
      <View style={styles.center}>
        <Text style={styles.notFound}>Checklist not found</Text>
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
          <Text style={styles.headerSub} numberOfLines={1}>{task.title}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{task.asset_checklist_name ?? 'Checklist'}</Text>
        </View>
        <View style={styles.counter}>
          <Text style={[styles.counterNum, { color: canComplete ? '#4adf7a' : '#f0a500' }]}>
            {requiredDone}/{allRequired.length}
          </Text>
          <Text style={styles.counterLabel}>required</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {items.map(item => {
          const resp     = responses[item.id];
          const answered = resp != null;
          const oor      = answered && resp.is_out_of_range;
          const isSaving = saving[item.id];

          return (
            <View
              key={item.id}
              style={[
                styles.item,
                answered && !oor && styles.itemAnswered,
                oor && styles.itemOor,
              ]}
            >
              {/* Item header */}
              <View style={styles.itemHeader}>
                <Text style={styles.itemLabel}>{item.sequence}. {item.label}</Text>
                {answered && (
                  <Text style={[styles.itemTag, { color: oor ? '#ff4444' : '#4adf7a' }]}>
                    {oor ? '⚠ OOR' : '✓'}
                  </Text>
                )}
              </View>

              {/* Meta */}
              <View style={styles.itemMeta}>
                <Text style={styles.itemType}>{item.item_type.replace(/_/g, ' ')}</Text>
                {item.unit ? <Text style={styles.itemUnit}>{item.unit}</Text> : null}
                {(item.min_value != null || item.max_value != null) && (
                  <Text style={styles.itemRange}>
                    range: {item.min_value ?? '—'} – {item.max_value ?? '—'} {item.unit}
                  </Text>
                )}
                {item.is_required && <Text style={styles.reqTag}>required</Text>}
                {item.is_runtime_trigger && <Text style={styles.rtTag}>runtime trigger</Text>}
              </View>

              {/* Current value if answered */}
              {answered && !oor && item.item_type === 'measurement' && (
                <Text style={styles.currentVal}>{resp.numeric_value} {item.unit}</Text>
              )}
              {answered && (item.item_type === 'true_false' || item.item_type === 'step') && (
                <Text style={styles.currentVal}>{resp.boolean_value ? 'Pass ✓' : 'Fail ✗'}</Text>
              )}
              {answered && item.item_type === 'text' && (
                <Text style={styles.currentVal} numberOfLines={2}>{resp.text_value}</Text>
              )}

              {/* Input area */}
              {item.item_type === 'measurement' && (
                <View style={styles.inputRow}>
                  <TextInput
                    style={[styles.input, styles.inputNum]}
                    keyboardType="decimal-pad"
                    placeholder={`Enter ${item.unit ?? 'value'}`}
                    placeholderTextColor="#444"
                    value={inputs[item.id] ?? (answered ? String(resp.numeric_value) : '')}
                    onChangeText={v => setInputs(p => ({ ...p, [item.id]: v }))}
                  />
                  {item.unit ? <Text style={styles.unitLabel}>{item.unit}</Text> : null}
                  <TouchableOpacity style={styles.saveBtn} onPress={() => saveItem(item)} disabled={isSaving}>
                    {isSaving ? <ActivityIndicator size={14} color="#0d0d0f" /> : <Text style={styles.saveBtnText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              )}

              {(item.item_type === 'true_false' || item.item_type === 'step') && (
                <View style={styles.inputRow}>
                  <View style={styles.boolWrap}>
                    <TouchableOpacity
                      style={[styles.boolBtn, booleans[item.id] === true && styles.boolBtnPass]}
                      onPress={() => setBooleans(p => ({ ...p, [item.id]: true }))}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.boolText, booleans[item.id] === true && styles.boolTextPass]}>
                        {item.item_type === 'step' ? 'Done ✓' : 'Pass ✓'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.boolBtn, booleans[item.id] === false && styles.boolBtnFail]}
                      onPress={() => setBooleans(p => ({ ...p, [item.id]: false }))}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.boolText, booleans[item.id] === false && styles.boolTextFail]}>
                        {item.item_type === 'step' ? 'Skip ✗' : 'Fail ✗'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.saveBtn} onPress={() => saveItem(item)} disabled={isSaving}>
                    {isSaving ? <ActivityIndicator size={14} color="#0d0d0f" /> : <Text style={styles.saveBtnText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              )}

              {item.item_type === 'text' && (
                <View style={styles.textWrap}>
                  <TextInput
                    style={[styles.input, styles.inputMulti]}
                    multiline
                    placeholder="Enter observation..."
                    placeholderTextColor="#444"
                    value={inputs[item.id] ?? (answered ? resp.text_value ?? '' : '')}
                    onChangeText={v => setInputs(p => ({ ...p, [item.id]: v }))}
                  />
                  <TouchableOpacity style={[styles.saveBtn, { alignSelf: 'flex-end', marginTop: 6 }]} onPress={() => saveItem(item)} disabled={isSaving}>
                    {isSaving ? <ActivityIndicator size={14} color="#0d0d0f" /> : <Text style={styles.saveBtnText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              )}

              {item.item_type === 'photo' && (
                <View style={styles.photoWrap}>
                  <TouchableOpacity style={styles.cameraBtn} onPress={() => pickPhoto(item)} activeOpacity={0.8}>
                    <Text style={styles.cameraBtnText}>📷  Take Photo</Text>
                  </TouchableOpacity>
                  {answered && resp.photo_url && (
                    <Text style={styles.photoSaved} numberOfLines={1}>✓ {resp.photo_url.split('/').pop()}</Text>
                  )}
                  {answered && (resp as any).local_photo_path && !resp.photo_url && (
                    <Text style={styles.photoPending}>⏳ Pending upload</Text>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {items.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No checklist items found</Text>
            <Text style={styles.emptyHint}>Sync when connected to load checklist</Text>
          </View>
        )}
      </ScrollView>

      {/* Action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.backBtnBar} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backBtnBarText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.completeBtn, !canComplete && styles.completeBtnDisabled]}
          onPress={canComplete ? handleCompleteTask : undefined}
          activeOpacity={canComplete ? 0.8 : 1}
        >
          <Text style={[styles.completeBtnText, !canComplete && styles.completeBtnTextDisabled]}>
            {canComplete
              ? 'Complete Task'
              : allRequired.length === 0
                ? 'No required items'
                : `${allRequired.length - requiredDone} required remaining`}
          </Text>
        </TouchableOpacity>
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
  headerInfo:      { flex: 1 },
  headerSub:       { fontSize: 10, color: '#555', letterSpacing: 1, fontFamily: 'monospace', textTransform: 'uppercase' },
  headerTitle:     { fontSize: 14, fontWeight: '700', color: '#e8e4dc', fontFamily: 'monospace' },
  counter:         { alignItems: 'center' },
  counterNum:      { fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  counterLabel:    { fontSize: 9, color: '#555', fontFamily: 'monospace' },
  scroll:          { flex: 1 },
  item:            { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1e' },
  itemAnswered:    { backgroundColor: '#0a130a' },
  itemOor:         { backgroundColor: '#180a0a' },
  itemHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  itemLabel:       { flex: 1, fontSize: 14, fontWeight: '600', color: '#e8e4dc', fontFamily: 'monospace', lineHeight: 20 },
  itemTag:         { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, fontFamily: 'monospace' },
  itemMeta:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  itemType:        { fontSize: 10, color: '#555', textTransform: 'capitalize', fontFamily: 'monospace' },
  itemUnit:        { fontSize: 10, color: '#888', fontFamily: 'monospace' },
  itemRange:       { fontSize: 10, color: '#555', fontFamily: 'monospace' },
  reqTag:          { fontSize: 10, color: '#f0a500', fontFamily: 'monospace' },
  rtTag:           { fontSize: 10, color: '#6aabff', fontFamily: 'monospace' },
  currentVal:      { fontSize: 13, color: '#4adf7a', fontFamily: 'monospace', marginBottom: 8, fontWeight: '600' },
  inputRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input:           { backgroundColor: '#1a1a1e', borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, color: '#e8e4dc', fontSize: 14, fontFamily: 'monospace' },
  inputNum:        { width: 130 },
  inputMulti:      { flex: 1, minHeight: 70, textAlignVertical: 'top' },
  unitLabel:       { fontSize: 13, color: '#666', fontFamily: 'monospace' },
  saveBtn:         { backgroundColor: '#f0a500', borderRadius: 4, paddingHorizontal: 14, paddingVertical: 10, minWidth: 54, alignItems: 'center' },
  saveBtnText:     { fontSize: 11, fontWeight: '700', color: '#0d0d0f', letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'monospace' },
  boolWrap:        { flex: 1, flexDirection: 'row', gap: 8 },
  boolBtn:         { flex: 1, borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, padding: 10, alignItems: 'center', backgroundColor: '#1a1a1e' },
  boolBtnPass:     { backgroundColor: '#0a2a0a', borderColor: '#4adf7a' },
  boolBtnFail:     { backgroundColor: '#2a0a0a', borderColor: '#ff4444' },
  boolText:        { fontSize: 12, color: '#555', fontFamily: 'monospace', fontWeight: '600' },
  boolTextPass:    { color: '#4adf7a' },
  boolTextFail:    { color: '#ff4444' },
  textWrap:        {},
  photoWrap:       { gap: 8 },
  cameraBtn:       { borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, padding: 12, alignItems: 'center', backgroundColor: '#1a1a1e' },
  cameraBtnText:   { fontSize: 13, color: '#e8e4dc', fontFamily: 'monospace' },
  photoSaved:      { fontSize: 11, color: '#4adf7a', fontFamily: 'monospace' },
  photoPending:    { fontSize: 11, color: '#888', fontFamily: 'monospace' },
  empty:           { padding: 48, alignItems: 'center', gap: 8 },
  emptyText:       { fontSize: 13, color: '#444', fontFamily: 'monospace' },
  emptyHint:       { fontSize: 11, color: '#333', fontFamily: 'monospace' },
  actionBar:       { backgroundColor: '#111114', borderTopWidth: 1, borderTopColor: '#22222a', paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', gap: 10 },
  backBtnBar:      { borderWidth: 1, borderColor: '#2a2a30', borderRadius: 5, paddingHorizontal: 18, paddingVertical: 14 },
  backBtnBarText:  { fontSize: 12, color: '#888', letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', fontFamily: 'monospace' },
  completeBtn:     { flex: 1, backgroundColor: '#f0a500', borderRadius: 5, padding: 14, alignItems: 'center' },
  completeBtnDisabled: { backgroundColor: '#1a1a1e' },
  completeBtnText: { fontSize: 12, color: '#0d0d0f', fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: 'monospace' },
  completeBtnTextDisabled: { color: '#444' },
});
