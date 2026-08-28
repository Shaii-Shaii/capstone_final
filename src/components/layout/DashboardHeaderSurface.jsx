import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../design-system/theme';

export function DashboardHeaderSurface({ children, style }) {
  return (
    <LinearGradient
      colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.surface, style]}
    >
      <View pointerEvents="none" style={styles.glow} />
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  surface: {
    marginHorizontal: -theme.layout.screenPaddingX,
    paddingVertical: 2,
    position: 'relative',
    overflow: 'hidden',
    ...theme.shadows.sm,
  },
  glow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: theme.radius.full,
    right: -45,
    top: -92,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
  },
});
