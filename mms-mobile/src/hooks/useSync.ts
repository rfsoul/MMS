// src/hooks/useSync.ts
// Watches network state. When the device reconnects to WiFi, triggers
// a full sync (outbox drain + pull). Also exposes manual sync trigger
// and sync status for UI indicators.

import { useEffect, useRef, useState, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { fullSync } from '@/services/syncEngine';
import { useAuthStore } from '@/store/authStore';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'offline';

export function useSync() {
  const token               = useAuthStore(s => s.token);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [isOnline, setIsOnline] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const isSyncing = useRef(false);

  const sync = useCallback(async (silent = false) => {
    if (!token || isSyncing.current) return;
    isSyncing.current = true;
    if (!silent) setStatus('syncing');
    try {
      await fullSync();
      setLastSynced(new Date());
      setStatus('success');
    } catch {
      setStatus('error');
    } finally {
      isSyncing.current = false;
    }
  }, [token]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(prev => {
        if (!prev && online) {
          // Just came online — trigger sync
          sync(true);
        }
        return online;
      });
      if (!online) setStatus('offline');
    });

    // Initial check
    NetInfo.fetch().then(state => {
      const online = !!(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      if (online) sync(true);
    });

    return unsubscribe;
  }, [sync]);

  return { isOnline, status, lastSynced, sync };
}
