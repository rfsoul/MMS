// src/utils/config.ts
// The API base URL is read from the environment at build time.
// For on-prem deployments, set this in your EAS environment variables
// or in a local .env file during development.
//
// Example .env:
//   EXPO_PUBLIC_API_URL=http://192.168.1.50:3001
//
// In production EAS builds, set EXPO_PUBLIC_API_URL in the EAS dashboard
// under your project's environment variables for the "production" profile.

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

export const SYNC_INTERVAL_MS = 30_000;       // Background sync every 30s when online
export const SYNC_TASK_NAME   = 'MMS_BACKGROUND_SYNC';
export const OFFLINE_PHOTO_DIR = 'mms_photos'; // Subdirectory in expo-file-system cache
