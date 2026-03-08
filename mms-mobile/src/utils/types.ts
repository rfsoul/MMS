// src/utils/types.ts

export type WOStatus     = 'open' | 'assigned' | 'in_progress' | 'on_hold' | 'completed';
export type WOPriority   = 'low' | 'medium' | 'high' | 'critical';
export type TaskStatus   = 'pending' | 'in_progress' | 'completed' | 'skipped';
export type TaskType     = 'checklist_execution' | 'inspection' | 'general' | 'safety_check' | 'reading';
export type ItemType     = 'measurement' | 'true_false' | 'step' | 'text' | 'photo';
export type OutboxOp     = 'CREATE' | 'UPDATE' | 'DELETE';
export type OutboxEntity = 'work_order' | 'work_order_update' | 'task_transition' | 'checklist_response' | 'response_delete';

// ── Domain types ──────────────────────────────────────────────────────────────

export interface User {
  id:        string;
  full_name: string;
  email:     string;
  role:      string;
  company_id: string;
}

export interface WorkOrder {
  id:                         string;
  company_id:                 string;
  title:                      string;
  description:                string | null;
  status:                     WOStatus;
  priority:                   WOPriority;
  asset_graph_id:             string | null;
  asset_label:                string | null;   // joined from graph node, not in schema — enriched by API
  asset_type:                 string | null;   // joined
  location:                   string | null;   // joined
  building:                   string | null;   // joined
  assigned_to:                string | null;
  estimated_duration_minutes: number | null;
  actual_duration_minutes:    number | null;
  completed_at:               string | null;
  created_at:                 string;
  updated_at:                 string;
}

export interface WorkOrderTask {
  id:                         string;
  work_order_id:              string;
  sequence:                   number;
  title:                      string;
  description:                string | null;
  task_type:                  TaskType;
  status:                     TaskStatus;
  asset_checklist_id:         string | null;
  asset_checklist_name:       string | null;
  estimated_duration_minutes: number | null;
  actual_duration_minutes:    number | null;
  started_at:                 string | null;
  completed_at:               string | null;
}

export interface ChecklistItem {
  id:                 string;
  checklist_id:       string;
  sequence:           number;
  label:              string;
  description:        string | null;
  item_type:          ItemType;
  unit:               string | null;
  min_value:          number | null;
  max_value:          number | null;
  is_required:        boolean;
  is_runtime_trigger: boolean;
}

export interface ChecklistResponse {
  id:                      string;
  asset_checklist_item_id: string;
  work_order_task_id:      string;
  responded_by:            string;
  responded_at:            string;
  numeric_value:           number | null;
  boolean_value:           boolean | null;
  text_value:              string | null;
  photo_url:               string | null;
  notes:                   string | null;
  is_out_of_range:         boolean;
}

// ── Outbox ────────────────────────────────────────────────────────────────────

export interface OutboxEntry {
  id:          string;
  entity_type: OutboxEntity;
  entity_id:   string;
  operation:   OutboxOp;
  payload:     string;       // JSON stringified
  created_at:  string;
  retry_count: number;
  last_error:  string | null;
}

// ── Enriched view model (used in UI) ─────────────────────────────────────────

export interface WorkOrderWithTasks extends WorkOrder {
  tasks: WorkOrderTask[];
}
