// app/index.tsx
// Root redirect — checks whether the asset database has been seeded.
// First login:       → /first-sync  (FirstSyncScreen with progress bar)
// Subsequent logins: → /work-orders (direct, assets refresh in background)

import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { needsAssetSync } from '@/services/syncEngine';
import { useAuthStore } from '@/store/authStore';

export default function Index() {
  const token                     = useAuthStore(s => s.token);
  const isHydrated                = useAuthStore(s => s.isHydrated);
  const [checking, setChecking]   = useState(true);
  const [firstSync, setFirstSync] = useState(false);

  useEffect(() => {
    if (!isHydrated || !token) {
      setChecking(false);
      return;
    }
    needsAssetSync()
      .then(needed => setFirstSync(needed))
      .catch(() => setFirstSync(false))
      .finally(() => setChecking(false));
  }, [isHydrated, token]);

  if (!isHydrated || checking) return null;
  if (!token)      return <Redirect href="/login" />;
  if (firstSync)   return <Redirect href="/first-sync" />;
  return           <Redirect href="/work-orders" />;
}
