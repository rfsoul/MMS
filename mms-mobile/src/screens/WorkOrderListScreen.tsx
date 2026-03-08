// src/screens/WorkOrderListScreen.tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useWorkOrders } from '@/hooks/useWorkOrders';
import { useSync } from '@/hooks/useSync';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';
import { PriorityBadge } from '@/components/PriorityBadge';
import { ProgressBar }   from '@/components/ProgressBar';
import { SyncBar }       from '@/components/SyncBar';
import type { WorkOrder, WorkOrderTask } from '@/utils/types';
import { dbQuery } from '@/db/database';
import { fmtDuration } from '@/utils/format';

const STATUS_LABELS: Record<string, string> = {
  open:        'Open',
  assigned:    'Assigned',
  in_progress: 'In Progress',
  on_hold:     'On Hold',
  completed:   'Completed',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:        { bg: '#1a2a3a', text: '#6aabff' },
  assigned:    { bg: '#1a2050', text: '#7aafff' },
  in_progress: { bg: '#2a1f0a', text: '#f0a500' },
  on_hold:     { bg: '#2a2a0a', text: '#d4d400' },
  completed:   { bg: '#0a2a14', text: '#4adf7a' },
};

type SortKey = 'priority' | 'location';
type Filter  = 'active' | 'all';

export default function WorkOrderListScreen() {
  const router    = useRouter();
  const clearAuth = useAuthStore(s => s.clearAuth);
  const user      = useAuthStore(s => s.user);

  const [sort,   setSort]   = useState<SortKey>('priority');
  const [filter, setFilter] = useState<Filter>('active');

  const { workOrders, loading, reload } = useWorkOrders(filter);
  const { isOnline, status, lastSynced, sync } = useSync();

  // Reload SQLite data every time this screen comes into focus so status
  // changes made in WorkOrderDetailScreen are reflected immediately.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  // Load task progress counts per WO
  const [progressMap, setProgressMap] = useState<Record<string, { done: number; total: number }>>({});

  async function loadProgress(ids: string[]) {
    if (!ids.length) return;
    const map: Record<string, { done: number; total: number }> = {};
    for (const id of ids) {
      const rows = await dbQuery<WorkOrderTask>(
        `SELECT status FROM work_order_tasks WHERE work_order_id = ?`, [id]
      );
      const done  = rows.filter(t => t.status === 'completed' || t.status === 'skipped').length;
      map[id]     = { done, total: rows.length };
    }
    setProgressMap(map);
  }

  React.useEffect(() => {
    loadProgress(workOrders.map(w => w.id));
  }, [workOrders]);

  const sorted = useMemo(() => {
    return [...workOrders].sort((a, b) => {
      if (sort === 'location') return (a.location ?? '').localeCompare(b.location ?? '');
      return 0; // priority sort is already done in the SQL query
    });
  }, [workOrders, sort]);

  async function handleLogout() {
    authApi.logout().catch(() => {});
    await clearAuth();
  }

  async function handleRefresh() {
    await sync();
    await reload();
  }

  function renderItem({ item: wo }: { item: WorkOrder }) {
    const prog     = progressMap[wo.id] ?? { done: 0, total: 0 };
    const pct      = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
    const partial  = prog.done > 0 && prog.done < prog.total;
    const ready    = pct === 100 && wo.status !== 'completed';
    const sc       = STATUS_COLORS[wo.status] ?? STATUS_COLORS.open;

    return (
      <TouchableOpacity
        style={[styles.card, wo.status === 'completed' && styles.cardDim]}
        onPress={() => router.push(`/(app)/work-orders/${wo.id}`)}
        activeOpacity={0.75}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle} numberOfLines={2}>{wo.title}</Text>
          <PriorityBadge priority={wo.priority} />
        </View>

        <View style={styles.cardMeta}>
          {wo.location  && <Text style={styles.meta}>📍 <Text style={styles.metaVal}>{wo.location}</Text></Text>}
          <Text style={styles.meta}>⏱ <Text style={styles.metaVal}>{fmtDuration(wo.estimated_duration_minutes)}</Text></Text>
          {wo.asset_label && <Text style={styles.meta}>🔧 <Text style={styles.metaVal}>{wo.asset_label}</Text></Text>}
        </View>

        <ProgressBar pct={pct} hasProgress={prog.done > 0} />

        <View style={styles.cardBottom}>
          <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusText, { color: sc.text }]}>{STATUS_LABELS[wo.status]}</Text>
          </View>
          {partial && (
            <Text style={styles.partial}>◑ {prog.done}/{prog.total} tasks</Text>
          )}
          {ready && (
            <Text style={styles.ready}>✓ Ready to close</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSub}>Technician Portal</Text>
          <Text style={styles.headerName}>{user?.full_name ?? '—'}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.countWrap}>
            <Text style={styles.countNum}>{workOrders.length}</Text>
            <Text style={styles.countLabel}>active</Text>
          </View>
          <TouchableOpacity style={styles.outBtn} onPress={handleLogout}>
            <Text style={styles.outBtnText}>OUT</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SyncBar isOnline={isOnline} status={status} lastSynced={lastSynced} onSync={() => { sync(); reload(); }} />

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <Text style={styles.toolbarLabel}>Sort</Text>
        <TouchableOpacity style={[styles.sortBtn, sort === 'priority' && styles.sortBtnActive]} onPress={() => setSort('priority')}>
          <Text style={[styles.sortBtnText, sort === 'priority' && styles.sortBtnTextActive]}>Priority</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.sortBtn, sort === 'location' && styles.sortBtnActive]} onPress={() => setSort('location')}>
          <Text style={[styles.sortBtnText, sort === 'location' && styles.sortBtnTextActive]}>Location</Text>
        </TouchableOpacity>
        <View style={styles.spacer} />
        <TouchableOpacity style={[styles.filterBtn, filter === 'active' && styles.filterBtnActive]} onPress={() => setFilter('active')}>
          <Text style={[styles.filterText, filter === 'active' && styles.filterTextActive]}>Active</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterBtn, filter === 'all' && styles.filterBtnActive]} onPress={() => setFilter('all')}>
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>All</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      <FlatList
        data={sorted}
        keyExtractor={w => w.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={handleRefresh} tintColor="#f0a500" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No work orders found</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(app)/work-orders/log-activity')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#0d0d0f' },
  header:         { backgroundColor: '#111114', borderBottomWidth: 1, borderBottomColor: '#2a2a30', paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerSub:      { fontSize: 10, letterSpacing: 1.2, color: '#555', textTransform: 'uppercase', fontFamily: 'monospace' },
  headerName:     { fontSize: 16, fontWeight: '700', color: '#e8e4dc', fontFamily: 'monospace' },
  headerRight:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  countWrap:      { alignItems: 'center' },
  countNum:       { fontSize: 20, fontWeight: '700', color: '#f0a500', fontFamily: 'monospace', lineHeight: 22 },
  countLabel:     { fontSize: 9, color: '#555', letterSpacing: 0.8, fontFamily: 'monospace' },
  outBtn:         { borderWidth: 1, borderColor: '#2a2a30', borderRadius: 3, paddingHorizontal: 8, paddingVertical: 4 },
  outBtnText:     { fontSize: 10, color: '#555', letterSpacing: 0.8, fontFamily: 'monospace' },
  toolbar:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#0f0f12', borderBottomWidth: 1, borderBottomColor: '#1e1e22' },
  toolbarLabel:   { fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'monospace', marginRight: 2 },
  sortBtn:        { borderWidth: 1, borderColor: '#2a2a30', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#1a1a1e' },
  sortBtnActive:  { backgroundColor: '#f0a500', borderColor: '#f0a500' },
  sortBtnText:    { fontSize: 10, color: '#666', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'monospace' },
  sortBtnTextActive: { color: '#0d0d0f', fontWeight: '700' },
  spacer:         { flex: 1 },
  filterBtn:      { paddingHorizontal: 8, paddingVertical: 5 },
  filterBtnActive:{ backgroundColor: '#222', borderRadius: 3 },
  filterText:     { fontSize: 10, color: '#444', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'monospace' },
  filterTextActive:{ color: '#e8e4dc' },
  list:           { paddingBottom: 90, paddingTop: 6 },
  card:           { marginHorizontal: 12, marginBottom: 8, backgroundColor: '#111114', borderWidth: 1, borderColor: '#22222a', borderRadius: 6, overflow: 'hidden' },
  cardDim:        { opacity: 0.5 },
  cardTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 14, paddingBottom: 8, gap: 8 },
  cardTitle:      { flex: 1, fontSize: 14, fontWeight: '700', color: '#e8e4dc', fontFamily: 'monospace', lineHeight: 19 },
  cardMeta:       { paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  meta:           { fontSize: 11, color: '#555', fontFamily: 'monospace' },
  metaVal:        { color: '#aaa8a0' },
  cardBottom:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  statusPill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2 },
  statusText:     { fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', fontFamily: 'monospace' },
  partial:        { fontSize: 10, color: '#f0a500', fontFamily: 'monospace', letterSpacing: 0.4 },
  ready:          { fontSize: 10, color: '#4adf7a', fontFamily: 'monospace', letterSpacing: 0.4 },
  empty:          { padding: 48, alignItems: 'center' },
  emptyText:      { fontSize: 13, color: '#444', fontFamily: 'monospace' },
  fab:            { position: 'absolute', bottom: 24, right: 20, width: 52, height: 52, borderRadius: 26, backgroundColor: '#f0a500', justifyContent: 'center', alignItems: 'center', elevation: 6 },
  fabText:        { fontSize: 28, color: '#0d0d0f', fontWeight: '700', lineHeight: 32 },
});
