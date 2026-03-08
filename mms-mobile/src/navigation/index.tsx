// src/navigation/index.tsx
import { useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { registerBackgroundSync } from '@/services/backgroundSync';
import { getDb } from '@/db/database';
import { needsAssetSync, isAssetSyncComplete } from '@/services/syncEngine';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});

function AuthGuard() {
  const { token, isHydrated, hydrateAuth } = useAuthStore();
  const segments = useSegments();
  const router   = useRouter();
  const [ready, setReady]  = useState(false);
  const syncRequired       = useRef(false);
  const prevToken          = useRef<string | null | undefined>(undefined);

  useEffect(() => { getDb().catch(console.error); }, []);
  useEffect(() => { hydrateAuth(); }, []);

  // Check needsAssetSync whenever token changes
  useEffect(() => {
    if (!isHydrated) return;

    if (!token) {
      prevToken.current = null;
      setReady(true);
      return;
    }

    if (token === prevToken.current) {
      setReady(true);
      return;
    }

    prevToken.current = token;
    setReady(false);

    const timeout = setTimeout(() => {
      console.warn('AuthGuard: sync check timed out');
      setReady(true);
    }, 5000);

    needsAssetSync()
      .then(needed => {
        console.log('needsAssetSync result:', needed);
        syncRequired.current = needed;
        clearTimeout(timeout);
        setReady(true);
      })
      .catch(() => {
        clearTimeout(timeout);
        setReady(true);
      });

    return () => clearTimeout(timeout);
  }, [isHydrated, token]);

  // Routing — segments included so it fires when navigation is ready
  // isAssetSyncComplete() prevents the first-sync redirect loop
  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync();

    const inAuthGroup = segments[0] === '(auth)';
    const inFirstSync = segments[0] === 'first-sync';

    console.log('AuthGuard routing:', {
      seg: segments[0], token: !!token,
      syncRequired: syncRequired.current,
      syncComplete: isAssetSyncComplete(),
    });

    if (!token) {
      if (!inAuthGroup) router.replace('/login');
    } else if (inAuthGroup) {
      router.replace(syncRequired.current ? '/first-sync' : '/work-orders');
    } else if (syncRequired.current && !inFirstSync && !isAssetSyncComplete()) {
      router.replace('/first-sync');
    }
  }, [ready, token, segments]);

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
