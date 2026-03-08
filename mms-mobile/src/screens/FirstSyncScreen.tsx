// src/screens/FirstSyncScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { router } from 'expo-router';
import { pullAssetTypes, pullAssets, fullSync, markAssetSyncComplete } from '@/services/syncEngine';
import { NetworkError } from '@/services/api';

type Phase = 'types' | 'assets' | 'workorders' | 'done' | 'error';

export default function FirstSyncScreen() {
  const [phase, setPhase] = useState<Phase>('types');
  const [error, setError] = useState<string | null>(null);
  const barAnim           = useRef(new Animated.Value(0)).current;
  const pulseAnim         = useRef(new Animated.Value(0.4)).current;

  // Pulse animation for status dot
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1,   duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // Animate bar to full when assets phase completes
  function animateBarFull() {
    Animated.timing(barAnim, {
      toValue:         1,
      duration:        400,
      useNativeDriver: false,
      easing:          Easing.out(Easing.quad),
    }).start();
  }

  useEffect(() => {
    let cancelled = false;

    async function runFirstSync() {
      try {
        setPhase('types');
        await pullAssetTypes();
        if (cancelled) return;

        // No progress callback — avoids React state updates mid-sync
        // which were causing AuthGuard re-renders and redirect loops
        setPhase('assets');
        await pullAssets();
        if (cancelled) return;

        animateBarFull();
        setPhase('workorders');
        await fullSync();
        if (cancelled) return;

        // Set module-level flag BEFORE navigating — stops AuthGuard redirect
        markAssetSyncComplete();
        setPhase('done');

        setTimeout(() => {
          if (!cancelled) router.replace('/work-orders');
        }, 600);

      } catch (err) {
        if (cancelled) return;
        console.error('FIRST SYNC ERROR:', err);
        if (err instanceof NetworkError) {
          setError('Cannot reach server.\nConnect to WiFi and reopen the app.');
        } else {
          setError('Sync failed. Please restart the app and try again.');
        }
        setPhase('error');
      }
    }

    runFirstSync();
    return () => { cancelled = true; };
  }, []);

  const phaseLabel: Record<Phase, string> = {
    types:      'Loading asset types...',
    assets:     'Loading assets...',
    workorders: 'Loading work orders...',
    done:       'Ready',
    error:      'Sync failed',
  };

  return (
    <View style={s.container}>
      <View style={s.card}>

        <Text style={s.logo}>MMS</Text>
        <Text style={s.subtitle}>Field App</Text>

        <View style={s.divider} />

        {phase !== 'error' ? (
          <>
            <View style={s.statusRow}>
              <Animated.View style={[s.dot, { opacity: pulseAnim }]} />
              <Text style={s.statusText}>{phaseLabel[phase]}</Text>
            </View>

            <View style={s.barTrack}>
              <Animated.View
                style={[
                  s.barFill,
                  {
                    width: barAnim.interpolate({
                      inputRange:  [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>

            {phase === 'done' && (
              <Text style={s.doneText}>✓ All data ready</Text>
            )}
          </>
        ) : (
          <View style={s.errorBox}>
            <Text style={s.errorIcon}>⚠</Text>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <View style={s.divider} />

        <Text style={s.hint}>
          {phase === 'error'
            ? 'Your work orders will load once you reconnect.'
            : 'This only runs once. Future syncs happen in the background.'}
        </Text>

      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0d0d0f',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         24,
  },
  card: {
    width:           '100%',
    maxWidth:        420,
    backgroundColor: '#111114',
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     '#22222a',
    padding:         32,
    alignItems:      'center',
  },
  logo: {
    fontFamily:    'monospace',
    fontSize:      36,
    fontWeight:    '700',
    color:         '#f0a500',
    letterSpacing: 6,
  },
  subtitle: {
    fontFamily:    'monospace',
    fontSize:      13,
    color:         '#555',
    marginTop:     4,
    letterSpacing: 3,
  },
  divider: {
    width:           '100%',
    height:          1,
    backgroundColor: '#22222a',
    marginVertical:  24,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  20,
  },
  dot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: '#f0a500',
    marginRight:     10,
  },
  statusText: {
    fontFamily: 'monospace',
    fontSize:   14,
    color:      '#e8e4dc',
  },
  barTrack: {
    width:           '100%',
    height:          6,
    backgroundColor: '#22222a',
    borderRadius:    3,
    overflow:        'hidden',
    marginBottom:    12,
  },
  barFill: {
    height:          6,
    backgroundColor: '#f0a500',
    borderRadius:    3,
  },
  doneText: {
    fontFamily: 'monospace',
    fontSize:   14,
    color:      '#4adf7a',
    marginTop:  8,
  },
  errorBox: {
    alignItems:      'center',
    paddingVertical: 8,
  },
  errorIcon: {
    fontSize:     28,
    color:        '#ff4444',
    marginBottom: 12,
  },
  errorText: {
    fontFamily: 'monospace',
    fontSize:   13,
    color:      '#ff4444',
    textAlign:  'center',
    lineHeight: 20,
  },
  hint: {
    fontFamily: 'monospace',
    fontSize:   11,
    color:      '#444',
    textAlign:  'center',
    lineHeight: 17,
  },
});
