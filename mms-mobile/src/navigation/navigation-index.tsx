// src/navigation/index.tsx
import { useEffect, useState, useRef } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { registerBackgroundSync } from '@/services/backgroundSync';
import { getDb } from '@/db/database';
import { needsAssetSync } from '@/services/syncEngine';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity },
  },
});

function AuthGuard() {
  const { token, isHydrated, hydrateAuth, assetSyncDone } = useAuthStore();
  const segments = useSegments();
  const router   = useRouter();

  const syncChecked  = useRef(false);
  const syncRequired = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { getDb().catch(console.error); }, []);
  useEffect(() => { hydrateAuth(); }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if (syncChecked.current) {
      setReady(true);
      return;
    }
    if (!token) {
      syncChecked.current = true;
      setReady(true);
      return;
    }
    needsAssetSync()
      .then(needed => {
        syncRequired.current = needed;
        syncChecked.current  = true;
        setReady(true);
      })
      .catch(() => {
        syncChecked.current = true;
        setReady(true);
      });
  }, [isHydrated, token]);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync();

    const inAuthGroup = segments[0] === '(auth)';
    const inFirstSync = segments[0] === 'first-sync';

    if (!token && !inAuthGroup) {
      router.replace('/login');
    } else if (token && inAuthGroup) {
      // Just logged in — route to first-sync or work-orders
      router.replace(syncRequired.current ? '/first-sync' : '/work-orders');
    } else if (token && syncRequired.current && !inFirstSync && !inAuthGroup && !assetSyncDone) {
      // Token already stored (app restarted) but assets not synced yet
      // assetSyncDone guard prevents redirect loop during sync
      router.replace('/first-sync');
    }
  }, [ready, token, segments, assetSyncDone]);

  useEffect(() => {
    if (token) registerBackgroundSync().catch(console.warn);
  }, [token]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d0f' }}>
        <ActivityIndicator color="#f0a500" />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGuard />
    </QueryClientProvider>
  );
}
