// src/services/backgroundSync.ts
// Registers a background task that fires every ~30s while the app is in the
// background on a corporate WiFi network. Drains the outbox so responses
// submitted while the technician had momentary WiFi get pushed even after
// they navigate away.
//
// Note: Android background fetch is throttled by the OS — intervals are
// approximate. For reliable sync, the foreground app also triggers on
// NetInfo 'connected' events (see useSync hook).

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { SYNC_TASK_NAME, SYNC_INTERVAL_MS } from '@/utils/config';
import { fullSync } from './syncEngine';
import { useAuthStore } from '@/store/authStore';

TaskManager.defineTask(SYNC_TASK_NAME, async () => {
  const token = useAuthStore.getState().token;
  if (!token) return BackgroundFetch.BackgroundFetchResult.NoData;

  try {
    await fullSync();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    console.warn('[BG Sync] Background fetch not available on this device');
    return;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK_NAME);
  if (!isRegistered) {
    await BackgroundFetch.registerTaskAsync(SYNC_TASK_NAME, {
      minimumInterval: SYNC_INTERVAL_MS / 1000,
      stopOnTerminate: false,
      startOnBoot:     true,
    });
    console.log('[BG Sync] Registered');
  }
}

export async function unregisterBackgroundSync(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK_NAME);
  if (isRegistered) {
    await BackgroundFetch.unregisterTaskAsync(SYNC_TASK_NAME);
  }
}
