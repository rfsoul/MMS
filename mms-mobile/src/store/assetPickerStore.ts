// src/store/assetPickerStore.ts
//
// Shared store used to pass the result of AssetPickerScreen back to
// NewWorkOrderScreen (Expo Router doesn't support typed navigation params
// for complex objects, so we use a Zustand store as a side-channel).
//
// Two pick modes:
//
//   mode: 'existing'
//     A real asset was selected from the list.
//     asset_graph_id is a real AGE node id.
//
//   mode: 'recommendation'
//     The tech submitted a new asset recommendation.
//     asset_graph_id is a local placeholder: 'pending_<uuid>'.
//     asset_request_id is the UUID written to asset_requests / outbox.
//     The WO is created with this placeholder id so the admin can later
//     patch it to the real graph id once the asset is approved and added.

import { create } from 'zustand';

// ── Shared fields present in both modes ──────────────────────────────────────

interface PickedAssetBase {
  asset_graph_id: string;   // real id OR 'pending_<uuid>'
  name: string;
  asset_type_name: string;
  building_name: string;
  floor_name: string;
  space_name: string;
}

// ── Existing asset ────────────────────────────────────────────────────────────

export interface PickedExistingAsset extends PickedAssetBase {
  mode: 'existing';
  code: string;
}

// ── Recommended (new) asset ───────────────────────────────────────────────────

export interface PickedRecommendedAsset extends PickedAssetBase {
  mode: 'recommendation';
  code: null;
  asset_request_id: string;          // UUID of the asset_requests row
  asset_type_id: string;             // UUID if a known type was picked, else ''
  asset_type_recommendation: string; // free text if "Other" type, else ''
  suggested_location: string;        // breadcrumb if known location, else ''
  location_recommendation: string;   // free text if "Other" location, else ''
  description: string;
}

export type PickedAsset = PickedExistingAsset | PickedRecommendedAsset;

// ── Store ─────────────────────────────────────────────────────────────────────

interface AssetPickerState {
  pending: PickedAsset | null;
  setPending: (asset: PickedAsset) => void;
  clear: () => void;
}

export const useAssetPickerStore = create<AssetPickerState>(set => ({
  pending: null,
  setPending: (asset) => set({ pending: asset }),
  clear: () => set({ pending: null }),
}));
