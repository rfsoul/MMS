// src/utils/format.ts

export function fmtDuration(mins: number | null | undefined): string {
  if (!mins) return '—';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function getTaskProgress(tasks: { status: string }[]): {
  done: number; total: number; pct: number;
} {
  const total = tasks.length;
  if (!total) return { done: 0, total: 0, pct: 0 };
  const done = tasks.filter(t => t.status === 'completed' || t.status === 'skipped').length;
  return { done, total, pct: Math.round((done / total) * 100) };
}
