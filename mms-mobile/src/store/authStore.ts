// src/store/authStore.ts
// Persists token in expo-secure-store (Android Keystore backed).
// Token survives app restarts. Cleared on logout or 401.

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { User } from '@/utils/types';

const TOKEN_KEY = 'mms_auth_token';
const USER_KEY  = 'mms_auth_user';

interface AuthState {
  token:           string | null;
  user:            User | null;
  isHydrated:      boolean;
  assetSyncDone:   boolean;        // true once first asset sync completes this session
  setAuth:         (token: string, user: User) => Promise<void>;
  clearAuth:       () => Promise<void>;
  hydrateAuth:     () => Promise<void>;
  setAssetSyncDone: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token:          null,
  user:           null,
  isHydrated:     false,
  assetSyncDone:  false,           // resets to false on every app start (not persisted)

  setAuth: async (token, user) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },

  clearAuth: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    set({ token: null, user: null, assetSyncDone: false });
  },

  hydrateAuth: async () => {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SecureStore timeout')), 3000)
      );
      const hydrate = async () => {
        const token    = await SecureStore.getItemAsync(TOKEN_KEY);
        const userJson = await SecureStore.getItemAsync(USER_KEY);
        const user     = userJson ? (JSON.parse(userJson) as User) : null;
        return { token, user };
      };
      const { token, user } = await Promise.race([hydrate(), timeoutPromise]);
      set({ token, user, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },

  setAssetSyncDone: () => set({ assetSyncDone: true }),
}));
