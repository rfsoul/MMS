// src/components/ProgressBar.tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';

interface Props {
  pct:       number;   // 0–100
  hasProgress: boolean;
  height?:   number;
}

export function ProgressBar({ pct, hasProgress, height = 3 }: Props) {
  return (
    <View style={[styles.track, { height }]}>
      <View
        style={[
          styles.fill,
          {
            width: `${pct}%`,
            height,
            backgroundColor: hasProgress ? '#f0a500' : '#2a2a30',
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: '#1e1e22', width: '100%' },
  fill:  {},
});
