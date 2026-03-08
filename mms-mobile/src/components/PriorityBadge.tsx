// src/components/PriorityBadge.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { WOPriority } from '@/utils/types';

const CONFIG: Record<WOPriority, { bg: string; text: string; label: string }> = {
  critical: { bg: '#ff2d2d', text: '#fff', label: 'CRITICAL' },
  high:     { bg: '#ff6b00', text: '#fff', label: 'HIGH'     },
  medium:   { bg: '#e8b400', text: '#111', label: 'MEDIUM'   },
  low:      { bg: '#3a7d44', text: '#fff', label: 'LOW'      },
};

export function PriorityBadge({ priority }: { priority: WOPriority }) {
  const c = CONFIG[priority] ?? CONFIG.medium;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.label, { color: c.text }]}>{c.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge:  { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 2 },
  label:  { fontSize: 9, letterSpacing: 1.2, fontWeight: '700', fontFamily: 'monospace' },
});
