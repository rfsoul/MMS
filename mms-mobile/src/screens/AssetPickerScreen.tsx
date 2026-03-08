// src/screens/AssetPickerScreen.tsx
//
// Navigate to this screen from NewWorkOrderScreen via:
//   router.push('/asset-picker')
//
// On asset selection it navigates back and sets params via assetPickerStore:
//   asset_graph_id, code, name, asset_type_name,
//   building_name, floor_name, space_name
//
// On new asset recommendation it writes to asset_requests (outbox-queued).
// The recommendation stores:
//   - asset_type_id (UUID)        if a known type was picked
//   - asset_type_recommendation   if "Other" was chosen for type
//   - suggested_location          if a known location was picked (building › floor › space)
//   - location_recommendation     if "Other" was chosen for location

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Pressable, Modal,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { dbQuery, dbRun } from '@/db/database';
import { useAuthStore } from '@/store/authStore';
import { generateUUID } from '@/utils/uuid';
import { useAssetPickerStore } from '@/store/assetPickerStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AssetRow {
  asset_graph_id: string;
  code: string;
  name: string;
  description: string | null;
  asset_type_name: string | null;
  site_name: string | null;
  building_name: string | null;
  floor_name: string | null;
  space_name: string | null;
  status: string;
}

interface CachedWO {
  id: string;
  title: string;
  priority: string;
  assigned_to_name: string | null;
  completed_at: string | null;
  actual_duration_minutes: number | null;
}

interface AssetWithWOs extends AssetRow {
  recentWOs: CachedWO[];
}

// Asset type row synced from the server asset_types table
interface AssetTypeRow {
  id: string;
  name: string;
}

// Cascading location options derived from asset_nodes
interface LocationOptions {
  buildings: string[];
  floors: Record<string, string[]>;    // building → floors
  spaces: Record<string, string[]>;    // `${building}|${floor}` → spaces
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const PRIORITY_COLOURS: Record<string, string> = {
  low:      '#3a7d44',
  medium:   '#e8b400',
  high:     '#ff6b00',
  critical: '#ff2d2d',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(mins: number | null): string {
  if (!mins) return '';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: '2-digit',
  });
}

function locationBreadcrumb(a: AssetRow): string {
  return [a.building_name, a.floor_name, a.space_name].filter(Boolean).join(' › ');
}

function sanitiseFts(q: string): string {
  return q.trim().replace(/[^a-zA-Z0-9 ]/g, '') + '*';
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function WOBadge({ wo }: { wo: CachedWO }) {
  const colour = PRIORITY_COLOURS[wo.priority] ?? '#555';
  return (
    <View style={s.woBadge}>
      <View style={[s.woDot, { backgroundColor: colour }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.woTitle} numberOfLines={1}>{wo.title}</Text>
        <Text style={s.woMeta}>
          {[formatDate(wo.completed_at), formatDuration(wo.actual_duration_minutes)]
            .filter(Boolean).join(' · ')}
          {wo.assigned_to_name ? `  ${wo.assigned_to_name}` : ''}
        </Text>
      </View>
    </View>
  );
}

function AssetCard({ item, onPress }: { item: AssetWithWOs; onPress: () => void }) {
  const breadcrumb = locationBreadcrumb(item);
  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      onPress={onPress}
      android_ripple={{ color: '#f0a52022' }}
    >
      <View style={s.cardHeader}>
        <Text style={s.assetCode}>{item.code}</Text>
        {item.asset_type_name ? (
          <View style={s.typePill}>
            <Text style={s.typePillText}>{item.asset_type_name.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
      <Text style={s.assetName}>{item.name}</Text>
      {breadcrumb ? <Text style={s.breadcrumb}>{breadcrumb}</Text> : null}
      {item.recentWOs.length > 0 && (
        <View style={s.woSection}>
          <Text style={s.woSectionLabel}>LAST {item.recentWOs.length} COMPLETED</Text>
          {item.recentWOs.map(wo => <WOBadge key={wo.id} wo={wo} />)}
        </View>
      )}
    </Pressable>
  );
}

function FilterChip({
  label, active, onPress,
}: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.chip, active && s.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Asset Type Picker
//
// Shows chips from the synced asset_types table (server source of truth).
// Selecting "OTHER" reveals a free-text input for a type recommendation.
// ─────────────────────────────────────────────────────────────────────────────

interface AssetTypePickerProps {
  assetTypes: AssetTypeRow[];           // from asset_types SQLite table
  selectedId: string;                   // UUID of selected type, or '' or '__other__'
  otherValue: string;                   // free text when OTHER is active
  onSelectId: (id: string) => void;
  onOtherChange: (val: string) => void;
}

function AssetTypePicker({
  assetTypes, selectedId, otherValue, onSelectId, onOtherChange,
}: AssetTypePickerProps) {
  const otherActive = selectedId === '__other__';
  return (
    <View style={s.mField}>
      <Text style={s.mLabel}>ASSET TYPE</Text>
      {assetTypes.length > 0 ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.chipScroll}
          >
            <View style={s.chipRow}>
              {assetTypes.map(t => (
                <FilterChip
                  key={t.id}
                  label={t.name}
                  active={selectedId === t.id}
                  onPress={() => onSelectId(selectedId === t.id ? '' : t.id)}
                />
              ))}
              <FilterChip
                label="OTHER"
                active={otherActive}
                onPress={() => onSelectId(otherActive ? '' : '__other__')}
              />
            </View>
          </ScrollView>
          {otherActive && (
            <TextInput
              style={[s.mInput, s.mInputTopMargin]}
              placeholder="Describe the asset type…"
              placeholderTextColor="#444"
              value={otherValue}
              onChangeText={onOtherChange}
              autoFocus
            />
          )}
        </>
      ) : (
        // No asset types synced yet — fall back to free text only
        <TextInput
          style={[s.mInput, s.mInputTopMargin]}
          placeholder="e.g. Air Handling Unit, Fire Pump…"
          placeholderTextColor="#444"
          value={otherValue}
          onChangeText={onOtherChange}
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Location Picker
//
// Cascading Building → Floor → Space picker using distinct values already
// present in the local asset_nodes table (no extra API call needed).
//
// At each level there is an "OTHER" chip. Selecting "Other" at any level
// reveals a single free-text field and collapses the remaining levels.
// The free-text value is stored as location_recommendation on the request.
// ─────────────────────────────────────────────────────────────────────────────

interface LocationPickerProps {
  locationOptions: LocationOptions;
  // Selections — '' = nothing chosen yet, '__other__' = Other chosen
  selectedBuilding: string;
  selectedFloor: string;
  selectedSpace: string;
  locationOther: string;
  onSelectBuilding: (val: string) => void;
  onSelectFloor: (val: string) => void;
  onSelectSpace: (val: string) => void;
  onLocationOtherChange: (val: string) => void;
}

function LocationPicker({
  locationOptions,
  selectedBuilding, selectedFloor, selectedSpace,
  locationOther,
  onSelectBuilding, onSelectFloor, onSelectSpace,
  onLocationOtherChange,
}: LocationPickerProps) {
  const buildingOther = selectedBuilding === '__other__';
  const floorOther    = selectedFloor    === '__other__';
  const spaceOther    = selectedSpace    === '__other__';
  const anyOther      = buildingOther || floorOther || spaceOther;

  // Available floors for the selected building
  const availableFloors = selectedBuilding && !buildingOther
    ? (locationOptions.floors[selectedBuilding] ?? [])
    : [];

  // Available spaces for the selected building+floor
  const spaceKey = `${selectedBuilding}|${selectedFloor}`;
  const availableSpaces = selectedBuilding && selectedFloor && !buildingOther && !floorOther
    ? (locationOptions.spaces[spaceKey] ?? [])
    : [];

  return (
    <View style={s.mField}>
      <Text style={s.mLabel}>LOCATION</Text>

      {/* ── Building row ── */}
      <Text style={s.mSubLabel}>BUILDING</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll}>
        <View style={s.chipRow}>
          {locationOptions.buildings.map(b => (
            <FilterChip
              key={b}
              label={b}
              active={selectedBuilding === b}
              onPress={() => {
                // Reset downstream selections when building changes
                onSelectFloor('');
                onSelectSpace('');
                onSelectBuilding(selectedBuilding === b ? '' : b);
              }}
            />
          ))}
          <FilterChip
            label="OTHER"
            active={buildingOther}
            onPress={() => {
              onSelectFloor('');
              onSelectSpace('');
              onSelectBuilding(buildingOther ? '' : '__other__');
            }}
          />
        </View>
      </ScrollView>

      {/* "Other" free-text — shown as soon as any level picks Other */}
      {anyOther && (
        <TextInput
          style={[s.mInput, s.mInputTopMargin]}
          placeholder="Describe the location (floor, room, area)…"
          placeholderTextColor="#444"
          value={locationOther}
          onChangeText={onLocationOtherChange}
          autoFocus
        />
      )}

      {/* ── Floor row — only shown if a real building is selected ── */}
      {selectedBuilding && !buildingOther && availableFloors.length > 0 && (
        <>
          <Text style={[s.mSubLabel, s.mSubLabelSpaced]}>FLOOR</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll}>
            <View style={s.chipRow}>
              {availableFloors.map(f => (
                <FilterChip
                  key={f}
                  label={f}
                  active={selectedFloor === f}
                  onPress={() => {
                    onSelectSpace('');
                    onSelectFloor(selectedFloor === f ? '' : f);
                  }}
                />
              ))}
              <FilterChip
                label="OTHER"
                active={floorOther}
                onPress={() => {
                  onSelectSpace('');
                  onSelectFloor(floorOther ? '' : '__other__');
                }}
              />
            </View>
          </ScrollView>
        </>
      )}

      {/* ── Space row — only shown if a real floor is selected ── */}
      {selectedFloor && !floorOther && !buildingOther && availableSpaces.length > 0 && (
        <>
          <Text style={[s.mSubLabel, s.mSubLabelSpaced]}>SPACE / ROOM</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipScroll}>
            <View style={s.chipRow}>
              {availableSpaces.map(sp => (
                <FilterChip
                  key={sp}
                  label={sp}
                  active={selectedSpace === sp}
                  onPress={() => onSelectSpace(selectedSpace === sp ? '' : sp)}
                />
              ))}
              <FilterChip
                label="OTHER"
                active={spaceOther}
                onPress={() => onSelectSpace(spaceOther ? '' : '__other__')}
              />
            </View>
          </ScrollView>
        </>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommend New Asset Modal
// ─────────────────────────────────────────────────────────────────────────────

interface RecommendModalProps {
  visible: boolean;
  assetTypes: AssetTypeRow[];
  locationOptions: LocationOptions;
  prefillName: string;
  onClose: () => void;
  onSubmit: (rec: RecommendPayload) => void;
}

interface RecommendPayload {
  name: string;
  description: string;
  // Type — exactly one of these will be non-empty
  asset_type_id: string;            // UUID when a known type is selected
  asset_type_recommendation: string; // free text when "Other" chosen
  // Location — exactly one of these will be non-empty
  suggested_location: string;       // breadcrumb when known location selected
  location_recommendation: string;  // free text when "Other" chosen
}

function RecommendModal({
  visible, assetTypes, locationOptions, prefillName, onClose, onSubmit,
}: RecommendModalProps) {
  const [name, setName] = useState(prefillName);
  const [desc, setDesc] = useState('');

  // Asset type state
  const [typeId,    setTypeId]    = useState('');  // UUID | '' | '__other__'
  const [typeOther, setTypeOther] = useState('');

  // Location state
  const [selBuilding,    setSelBuilding]    = useState('');
  const [selFloor,       setSelFloor]       = useState('');
  const [selSpace,       setSelSpace]       = useState('');
  const [locationOther,  setLocationOther]  = useState('');

  // Sync prefill when modal opens
  useEffect(() => { if (visible) setName(prefillName); }, [visible, prefillName]);

  function reset() {
    setName(''); setDesc('');
    setTypeId(''); setTypeOther('');
    setSelBuilding(''); setSelFloor(''); setSelSpace('');
    setLocationOther('');
  }

  function handleClose() { reset(); onClose(); }

  // Build the resolved payload before submitting
  function handleSubmit() {
    if (!name.trim()) { Alert.alert('Required', 'Asset name is required'); return; }

    const isTypeOther    = typeId === '__other__';
    const isBuildOther   = selBuilding === '__other__';
    const isFloorOther   = selFloor    === '__other__';
    const isSpaceOther   = selSpace    === '__other__';
    const isLocOther     = isBuildOther || isFloorOther || isSpaceOther;

    // Build known location breadcrumb
    const knownLocation = !isLocOther
      ? [selBuilding, selFloor, selSpace].filter(Boolean).join(' › ')
      : '';

    onSubmit({
      name:                     name.trim(),
      description:              desc.trim(),
      asset_type_id:            !isTypeOther ? typeId : '',
      asset_type_recommendation: isTypeOther ? typeOther.trim() : '',
      suggested_location:       knownLocation,
      location_recommendation:  isLocOther ? locationOther.trim() : '',
    });
    reset();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={s.modalOverlay}>
        <View style={s.modalSheet}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>RECOMMEND NEW ASSET</Text>
              <TouchableOpacity onPress={handleClose}>
                <Text style={s.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.modalHint}>
              Can't find the asset? Submit a recommendation and it will be
              reviewed and added by your admin.
            </Text>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* Name */}
              <View style={s.mField}>
                <Text style={s.mLabel}>ASSET NAME *</Text>
                <TextInput
                  style={s.mInput}
                  placeholder="e.g. AHU-06 Supply Fan"
                  placeholderTextColor="#444"
                  value={name}
                  onChangeText={setName}
                />
              </View>

              {/* Description */}
              <View style={s.mField}>
                <Text style={s.mLabel}>DESCRIPTION</Text>
                <TextInput
                  style={[s.mInput, s.mInputMulti]}
                  placeholder="Make, model, serial number, condition…"
                  placeholderTextColor="#444"
                  multiline
                  textAlignVertical="top"
                  value={desc}
                  onChangeText={setDesc}
                />
              </View>

              {/* Asset type picker — from asset_types table */}
              <AssetTypePicker
                assetTypes={assetTypes}
                selectedId={typeId}
                otherValue={typeOther}
                onSelectId={setTypeId}
                onOtherChange={setTypeOther}
              />

              {/* Location picker — cascading building › floor › space */}
              <LocationPicker
                locationOptions={locationOptions}
                selectedBuilding={selBuilding}
                selectedFloor={selFloor}
                selectedSpace={selSpace}
                locationOther={locationOther}
                onSelectBuilding={setSelBuilding}
                onSelectFloor={setSelFloor}
                onSelectSpace={setSelSpace}
                onLocationOtherChange={setLocationOther}
              />
            </ScrollView>

            <View style={s.modalFooter}>
              <TouchableOpacity
                style={[s.submitBtn, !name.trim() && s.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={!name.trim()}
                activeOpacity={0.8}
              >
                <Text style={s.submitBtnText}>SUBMIT RECOMMENDATION</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────────────────────

export default function AssetPickerScreen() {
  const router     = useRouter();
  const user       = useAuthStore(s => s.user!);
  const setPending = useAssetPickerStore(s => s.setPending);

  const [searchText,     setSearchText]     = useState('');
  const [assets,         setAssets]         = useState<AssetWithWOs[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [loadingMore,    setLoadingMore]    = useState(false);
  const [page,           setPage]           = useState(0);
  const [hasMore,        setHasMore]        = useState(true);

  // Filter chips on the main list (from asset_nodes distinct values)
  const [filterTypes,    setFilterTypes]    = useState<string[]>([]);
  const [filterBuildings,setFilterBuildings]= useState<string[]>([]);
  const [activeType,     setActiveType]     = useState<string | null>(null);
  const [activeBuilding, setActiveBuilding] = useState<string | null>(null);

  // Data for the RecommendModal
  const [assetTypes,      setAssetTypes]      = useState<AssetTypeRow[]>([]);
  const [locationOptions, setLocationOptions] = useState<LocationOptions>({
    buildings: [], floors: {}, spaces: {},
  });

  const [showRecommend, setShowRecommend] = useState(false);

  // ── Load filter + modal data ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Filter chips: distinct values already on synced assets
      const types = await dbQuery<{ asset_type_name: string }>(
        `SELECT DISTINCT asset_type_name FROM asset_nodes
          WHERE asset_type_name IS NOT NULL AND status = 'active'
          ORDER BY asset_type_name`
      );
      setFilterTypes(types.map(r => r.asset_type_name));

      const blds = await dbQuery<{ building_name: string }>(
        `SELECT DISTINCT building_name FROM asset_nodes
          WHERE building_name IS NOT NULL AND status = 'active'
          ORDER BY building_name`
      );
      setFilterBuildings(blds.map(r => r.building_name));

      // Asset types for modal — from the synced asset_types table (server source)
      const at = await dbQuery<AssetTypeRow>(
        `SELECT id, name FROM asset_types
          WHERE is_active = 1
          ORDER BY name`
      );
      setAssetTypes(at);

      // Location hierarchy for modal — build from distinct combos in asset_nodes
      const locRows = await dbQuery<{
        building_name: string | null;
        floor_name: string | null;
        space_name: string | null;
      }>(
        `SELECT DISTINCT building_name, floor_name, space_name
          FROM asset_nodes
          WHERE status = 'active'
          ORDER BY building_name, floor_name, space_name`
      );

      const buildings = new Set<string>();
      const floors: Record<string, Set<string>> = {};
      const spaces: Record<string, Set<string>> = {};

      for (const row of locRows) {
        if (!row.building_name) continue;
        buildings.add(row.building_name);

        if (row.floor_name) {
          if (!floors[row.building_name]) floors[row.building_name] = new Set();
          floors[row.building_name].add(row.floor_name);

          if (row.space_name) {
            const key = `${row.building_name}|${row.floor_name}`;
            if (!spaces[key]) spaces[key] = new Set();
            spaces[key].add(row.space_name);
          }
        }
      }

      setLocationOptions({
        buildings: [...buildings],
        floors:    Object.fromEntries(Object.entries(floors).map(([k, v]) => [k, [...v]])),
        spaces:    Object.fromEntries(Object.entries(spaces).map(([k, v]) => [k, [...v]])),
      });
    })();
  }, []);

  // ── Fetch assets ──────────────────────────────────────────────────────────
  const fetchAssets = useCallback(async (
    query: string,
    type: string | null,
    building: string | null,
    offset: number,
    append: boolean,
  ) => {
    offset === 0 ? setLoading(true) : setLoadingMore(true);

    try {
      const params: (string | number | null)[] = [];
      const useFts = query.trim().length > 0;
      let sql: string;

      if (useFts) {
        sql = `
          SELECT a.asset_graph_id, a.code, a.name, a.description,
                 a.asset_type_name, a.site_name, a.building_name,
                 a.floor_name, a.space_name, a.status
          FROM asset_nodes_fts f
          JOIN asset_nodes a ON a.rowid = f.rowid
          WHERE asset_nodes_fts MATCH ?
            AND a.status = 'active'
        `;
        params.push(sanitiseFts(query));
      } else {
        sql = `
          SELECT asset_graph_id, code, name, description,
                 asset_type_name, site_name, building_name,
                 floor_name, space_name, status
          FROM asset_nodes
          WHERE status = 'active'
        `;
      }

      const alias = useFts ? 'a' : '';
      const col = (c: string) => alias ? `${alias}.${c}` : c;

      if (type)     { sql += ` AND ${col('asset_type_name')} = ?`; params.push(type); }
      if (building) { sql += ` AND ${col('building_name')} = ?`;  params.push(building); }

      sql += ` ORDER BY ${col('code')} LIMIT ? OFFSET ?`;
      params.push(PAGE_SIZE, offset);

      const rows = await dbQuery<AssetRow>(sql, params);

      let withWOs: AssetWithWOs[] = rows.map(r => ({ ...r, recentWOs: [] }));

      if (rows.length > 0) {
        const idList = rows
          .map(r => `'${r.asset_graph_id.replace(/'/g, "''")}'`)
          .join(',');
        const wos = await dbQuery<CachedWO & { asset_graph_id: string }>(`
          SELECT id, asset_graph_id, title, priority,
                 assigned_to_name, completed_at, actual_duration_minutes
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY asset_graph_id ORDER BY completed_at DESC
              ) AS rn
            FROM asset_wo_cache
            WHERE asset_graph_id IN (${idList})
          )
          WHERE rn <= 2
        `);

        const woMap: Record<string, CachedWO[]> = {};
        for (const wo of wos) {
          if (!woMap[wo.asset_graph_id]) woMap[wo.asset_graph_id] = [];
          woMap[wo.asset_graph_id].push(wo);
        }
        withWOs = rows.map(r => ({ ...r, recentWOs: woMap[r.asset_graph_id] ?? [] }));
      }

      setAssets(prev => append ? [...prev, ...withWOs] : withWOs);
      setHasMore(rows.length === PAGE_SIZE);
      setPage(offset / PAGE_SIZE);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(
      () => fetchAssets(searchText, activeType, activeBuilding, 0, false),
      250,
    );
    return () => clearTimeout(t);
  }, [searchText, activeType, activeBuilding, fetchAssets]);

  function loadMore() {
    if (loadingMore || !hasMore) return;
    fetchAssets(searchText, activeType, activeBuilding, (page + 1) * PAGE_SIZE, true);
  }

  // ── Asset selected ────────────────────────────────────────────────────────
  function handleSelect(asset: AssetWithWOs) {
    router.back();
    setTimeout(() => {
      setPending({
        mode:            'existing',
        asset_graph_id:  asset.asset_graph_id,
        code:            asset.code,
        name:            asset.name,
        asset_type_name: asset.asset_type_name ?? '',
        building_name:   asset.building_name ?? '',
        floor_name:      asset.floor_name ?? '',
        space_name:      asset.space_name ?? '',
      });
    }, 50);
  }

  // ── Submit recommendation ─────────────────────────────────────────────────
  async function handleRecommend(rec: RecommendPayload) {
    const now         = new Date().toISOString();
    const requestId   = generateUUID();
    // Placeholder graph id lets the WO reference this asset before it's approved
    const placeholderId = `pending_${requestId}`;

    // Resolve a human-readable type name for display in the WO screen
    const displayTypeName = rec.asset_type_recommendation
      || assetTypes.find(t => t.id === rec.asset_type_id)?.name
      || '';

    // Resolve location parts for the store (best-effort split of breadcrumb)
    const displayLocation = rec.location_recommendation || rec.suggested_location || '';
    const [displayBuilding = '', displayFloor = '', displaySpace = ''] =
      displayLocation.split(' › ').map(s => s.trim());

    await dbRun(
      `INSERT INTO asset_requests (
         id, company_id, requested_by, requested_at,
         name, description,
         asset_type_id, asset_type_name, asset_type_recommendation,
         suggested_location, location_recommendation,
         status, is_pending_sync
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        requestId, user.company_id, user.id, now,
        rec.name, rec.description || null,
        rec.asset_type_id || null,
        displayTypeName || null,
        rec.asset_type_recommendation || null,
        rec.suggested_location || null,
        rec.location_recommendation || null,
        'pending', 1,
      ]
    );

    await dbRun(
      `INSERT INTO outbox (id, entity_type, entity_id, operation, payload, created_at)
       VALUES (?,?,?,?,?,?)`,
      [
        `asset_req_${requestId}`, 'asset_request', requestId, 'CREATE',
        JSON.stringify({ ...rec, placeholder_id: placeholderId }),
        now,
      ]
    );

    setShowRecommend(false);

    // Pass the recommendation back to NewWorkOrderScreen via the store
    // so the WO is created with this placeholder asset attached
    setPending({
      mode:                      'recommendation',
      asset_graph_id:            placeholderId,
      code:                      null,
      name:                      rec.name,
      asset_request_id:          requestId,
      asset_type_id:             rec.asset_type_id,
      asset_type_name:           displayTypeName,
      asset_type_recommendation: rec.asset_type_recommendation,
      suggested_location:        rec.suggested_location,
      location_recommendation:   rec.location_recommendation,
      description:               rec.description,
      building_name:             displayBuilding,
      floor_name:                displayFloor,
      space_name:                displaySpace,
    });

    router.back();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const hasFilters = filterTypes.length > 0 || filterBuildings.length > 0;

  return (
    <>
      <View style={s.root}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backText}>← CANCEL</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>SELECT ASSET</Text>
          <TouchableOpacity onPress={() => setShowRecommend(true)} style={s.recommendBtn}>
            <Text style={s.recommendBtnText}>+ NEW</Text>
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={s.searchRow}>
          <Text style={s.searchIcon}>⌕</Text>
          <TextInput
            style={s.searchInput}
            placeholder="Search by code, name, location…"
            placeholderTextColor="#444"
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')} style={s.clearBtn}>
              <Text style={s.clearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Filter chips */}
        {hasFilters && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.filterRow}
            contentContainerStyle={s.filterContent}
          >
            {filterTypes.map(t => (
              <FilterChip
                key={`type_${t}`}
                label={t}
                active={activeType === t}
                onPress={() => setActiveType(prev => prev === t ? null : t)}
              />
            ))}
            {filterTypes.length > 0 && filterBuildings.length > 0 && (
              <View style={s.filterDivider} />
            )}
            {filterBuildings.map(b => (
              <FilterChip
                key={`bld_${b}`}
                label={b}
                active={activeBuilding === b}
                onPress={() => setActiveBuilding(prev => prev === b ? null : b)}
              />
            ))}
          </ScrollView>
        )}

        {/* Results */}
        {loading ? (
          <View style={s.centred}>
            <ActivityIndicator color="#f0a500" size="large" />
            <Text style={s.loadingText}>Loading assets…</Text>
          </View>
        ) : (
          <FlatList
            data={assets}
            keyExtractor={item => item.asset_graph_id}
            renderItem={({ item }) => (
              <AssetCard item={item} onPress={() => handleSelect(item)} />
            )}
            contentContainerStyle={s.listContent}
            ItemSeparatorComponent={() => <View style={s.separator} />}
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={s.centred}>
                <Text style={s.emptyIcon}>◎</Text>
                <Text style={s.emptyTitle}>No assets found</Text>
                <Text style={s.emptyHint}>
                  Try a different search term or clear your filters.
                </Text>
                <TouchableOpacity
                  style={s.emptyRecommendBtn}
                  onPress={() => setShowRecommend(true)}
                  activeOpacity={0.8}
                >
                  <Text style={s.emptyRecommendText}>+ RECOMMEND NEW ASSET</Text>
                </TouchableOpacity>
              </View>
            }
            ListFooterComponent={
              loadingMore
                ? <ActivityIndicator color="#f0a500" style={{ margin: 20 }} />
                : hasMore
                  ? null
                  : assets.length > 0
                    ? <Text style={s.endText}>— {assets.length} assets —</Text>
                    : null
            }
          />
        )}
      </View>

      <RecommendModal
        visible={showRecommend}
        assetTypes={assetTypes}
        locationOptions={locationOptions}
        prefillName={searchText}
        onClose={() => setShowRecommend(false)}
        onSubmit={handleRecommend}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:               { flex: 1, backgroundColor: '#0d0d0f' },

  // Header
  header:             { backgroundColor: '#111114', borderBottomWidth: 1, borderBottomColor: '#2a2a30', paddingHorizontal: 14, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn:            {},
  backText:           { fontSize: 11, color: '#f0a500', fontFamily: 'monospace', letterSpacing: 0.8 },
  headerTitle:        { fontSize: 13, fontWeight: '700', color: '#e8e4dc', letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: 'monospace' },
  recommendBtn:       { backgroundColor: '#1a1a1e', borderWidth: 1, borderColor: '#f0a50055', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 5 },
  recommendBtnText:   { fontSize: 10, color: '#f0a500', fontFamily: 'monospace', letterSpacing: 1 },

  // Search
  searchRow:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111114', borderBottomWidth: 1, borderBottomColor: '#2a2a30', paddingHorizontal: 14, paddingVertical: 10 },
  searchIcon:         { fontSize: 18, color: '#555', marginRight: 10, fontFamily: 'monospace' },
  searchInput:        { flex: 1, color: '#e8e4dc', fontSize: 14, fontFamily: 'monospace', padding: 0 },
  clearBtn:           { padding: 4 },
  clearText:          { fontSize: 12, color: '#555', fontFamily: 'monospace' },

  // Filters
  filterRow:          { backgroundColor: '#0d0d0f', borderBottomWidth: 1, borderBottomColor: '#1e1e24', maxHeight: 48 },
  filterContent:      { paddingHorizontal: 14, paddingVertical: 9, gap: 8, flexDirection: 'row', alignItems: 'center' },
  filterDivider:      { width: 1, height: 16, backgroundColor: '#2a2a30', marginHorizontal: 2 },

  // Chips
  chip:               { borderWidth: 1, borderColor: '#2a2a30', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#111114' },
  chipActive:         { backgroundColor: '#f0a500', borderColor: '#f0a500' },
  chipText:           { fontSize: 10, color: '#666', fontFamily: 'monospace', letterSpacing: 0.6 },
  chipTextActive:     { color: '#0d0d0f', fontWeight: '700' },
  chipScroll:         { marginTop: 6 },
  chipRow:            { flexDirection: 'row', gap: 8, paddingRight: 16 },

  // List
  listContent:        { padding: 12 },
  separator:          { height: 8 },

  // Asset card
  card:               { backgroundColor: '#111114', borderWidth: 1, borderColor: '#2a2a30', borderRadius: 5, padding: 14 },
  cardPressed:        { backgroundColor: '#16161a' },
  cardHeader:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  assetCode:          { fontSize: 13, fontWeight: '700', color: '#f0a500', fontFamily: 'monospace', letterSpacing: 0.5 },
  typePill:           { backgroundColor: '#1e1e24', borderRadius: 2, paddingHorizontal: 7, paddingVertical: 2 },
  typePillText:       { fontSize: 8, color: '#888', fontFamily: 'monospace', letterSpacing: 1 },
  assetName:          { fontSize: 13, color: '#e8e4dc', fontFamily: 'monospace', marginBottom: 2 },
  breadcrumb:         { fontSize: 10, color: '#555', fontFamily: 'monospace', letterSpacing: 0.4 },

  // WO section
  woSection:          { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1e1e24' },
  woSectionLabel:     { fontSize: 8, color: '#444', fontFamily: 'monospace', letterSpacing: 1.2, marginBottom: 6 },
  woBadge:            { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 5, gap: 8 },
  woDot:              { width: 6, height: 6, borderRadius: 3, marginTop: 4, flexShrink: 0 },
  woTitle:            { fontSize: 11, color: '#aaa', fontFamily: 'monospace' },
  woMeta:             { fontSize: 9, color: '#555', fontFamily: 'monospace', marginTop: 1 },

  // Empty state
  centred:            { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  loadingText:        { fontSize: 11, color: '#444', fontFamily: 'monospace', marginTop: 12, letterSpacing: 0.8 },
  emptyIcon:          { fontSize: 32, color: '#333', marginBottom: 12 },
  emptyTitle:         { fontSize: 13, color: '#555', fontFamily: 'monospace', letterSpacing: 0.6, marginBottom: 6 },
  emptyHint:          { fontSize: 11, color: '#3a3a42', fontFamily: 'monospace', textAlign: 'center', marginBottom: 20 },
  emptyRecommendBtn:  { borderWidth: 1, borderColor: '#f0a50066', borderRadius: 3, paddingHorizontal: 14, paddingVertical: 8 },
  emptyRecommendText: { fontSize: 10, color: '#f0a500', fontFamily: 'monospace', letterSpacing: 1 },
  endText:            { fontSize: 9, color: '#333', fontFamily: 'monospace', textAlign: 'center', padding: 20, letterSpacing: 0.8 },

  // Modal
  modalOverlay:       { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  modalSheet:         { backgroundColor: '#111114', borderTopWidth: 1, borderTopColor: '#2a2a30', borderTopLeftRadius: 10, borderTopRightRadius: 10, height: '90%', paddingBottom: Platform.OS === 'ios' ? 30 : 16 },
  modalHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#2a2a30' },
  modalTitle:         { fontSize: 12, fontWeight: '700', color: '#e8e4dc', fontFamily: 'monospace', letterSpacing: 1 },
  modalClose:         { fontSize: 14, color: '#555', fontFamily: 'monospace', padding: 4 },
  modalHint:          { fontSize: 11, color: '#555', fontFamily: 'monospace', paddingHorizontal: 18, paddingVertical: 10, lineHeight: 17 },

  // Modal fields
  mField:             { paddingHorizontal: 18, marginBottom: 20 },
  mLabel:             { fontSize: 9, letterSpacing: 1.4, color: '#555', fontFamily: 'monospace', marginBottom: 4 },
  mSubLabel:          { fontSize: 8, letterSpacing: 1.2, color: '#3a3a45', fontFamily: 'monospace', marginTop: 2 },
  mSubLabelSpaced:    { marginTop: 12 },
  mInput:             { backgroundColor: '#1a1a1e', borderWidth: 1, borderColor: '#2a2a30', borderRadius: 4, paddingHorizontal: 13, paddingVertical: 11, color: '#e8e4dc', fontSize: 13, fontFamily: 'monospace' },
  mInputTopMargin:    { marginTop: 10 },
  mInputMulti:        { minHeight: 72, textAlignVertical: 'top' },
  modalFooter:        { paddingHorizontal: 18, paddingTop: 10 },
  submitBtn:          { backgroundColor: '#f0a500', borderRadius: 5, padding: 15, alignItems: 'center' },
  submitBtnDisabled:  { opacity: 0.4 },
  submitBtnText:      { fontSize: 12, color: '#0d0d0f', fontWeight: '700', letterSpacing: 1.2, fontFamily: 'monospace' },
});
