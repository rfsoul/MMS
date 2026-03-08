// src/components/SyncBar.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import type { SyncStatus } from '@/hooks/useSync';
import { format } from 'date-fns';

interface Props {
  isOnline:   boolean;
  status:     SyncStatus;
  lastSynced: Date | null;
  onSync:     () => void;
}

export function SyncBar({ isOnline, status, lastSynced, onSync }: Props) {
  const syncing = status === 'syncing';

  if (!isOnline) {
    return (
      <View style={[styles.bar, styles.offline]}>
        <View style={[styles.dot, styles.dotOffline]} />
        <Text style={styles.text}>Offline — changes saved locally</Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.bar, styles.online]}
      onPress={!syncing ? onSync : undefined}
      activeOpacity={0.7}
    >
      {syncing ? (
        <ActivityIndicator size={10} color="#4adf7a" style={{ marginRight: 6 }} />
      ) : (
        <View style={[styles.dot, styles.dotOnline]} />
      )}
      <Text style={styles.text}>
        {syncing
          ? 'Syncing...'
          : lastSynced
          ? `Synced ${format(lastSynced, 'HH:mm')}`
          : 'Connected — tap to sync'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 14,
    paddingVertical:    5,
  },
  offline: { backgroundColor: '#2a1a1a' },
  online:  { backgroundColor: '#111114' },
  dot: {
    width:        6,
    height:       6,
    borderRadius: 3,
    marginRight:  7,
  },
  dotOnline:  { backgroundColor: '#4adf7a' },
  dotOffline: { backgroundColor: '#ff4444' },
  text: {
    fontSize:      11,
    color:         '#666',
    letterSpacing: 0.04,
    fontFamily:    'monospace',
  },
});
