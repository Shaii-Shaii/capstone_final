import React from 'react';
import { View, StyleSheet, Platform, ScrollView, KeyboardAvoidingView, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, resolveThemeRoles } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';

export const ScreenContainer = ({
  children,
  style,
  contentStyle,
  scrollable = true,
  safeArea = true,
  variant = 'default',
  heroColors,
  authHeroImageUri = '',
  keyboardAvoidingEnabled = true,
}) => {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const isAuth = variant === 'auth';
  const isDashboard = variant === 'dashboard';
  const isShortScreen = height < theme.layout.shortScreenHeight;
  const isCompactScreen = height < theme.layout.compactScreenHeight;
  const contentPaddingHorizontal = isShortScreen
    ? theme.layout.screenPaddingXCompact
    : theme.layout.screenPaddingX;
  const contentPaddingTop = isAuth
    ? (isCompactScreen ? theme.spacing.sm : isShortScreen ? theme.spacing.md : theme.spacing.lg)
    : (isCompactScreen ? theme.spacing.xs : isShortScreen ? theme.spacing.sm : theme.spacing.md);
  const contentPaddingBottom = isDashboard && !scrollable
    ? 0
    : Math.max(
      isCompactScreen ? theme.spacing.lg : isShortScreen ? theme.spacing.xl : theme.spacing.sectionLg,
      insets.bottom + (isDashboard ? theme.spacing.md : theme.spacing.lg)
    );
  const dashboardHeroHeight = isShortScreen
    ? theme.layout.dashboardHeroMinHeightCompact
    : theme.layout.dashboardHeroMinHeight;
  const backgroundCanvas = resolvedTheme?.backgroundColor || theme.colors.backgroundCanvas;
  const dashboardBaseBackground = resolvedTheme?.backgroundColor || theme.colors.backgroundSecondary;
  const dashboardHeroBackground = roles.heroBackground || heroColors?.[0] || theme.colors.dashboardShellFrom;

  const content = (
    <View
      style={[
        styles.content,
        isAuth ? styles.authContent : null,
        {
          paddingHorizontal: contentPaddingHorizontal,
          paddingTop: contentPaddingTop,
          paddingBottom: contentPaddingBottom,
        },
        contentStyle,
        style,
      ]}
    >
      {children}
    </View>
  );

  const viewPort = scrollable ? (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContainer,
        isAuth ? styles.authScroll : null,
        isShortScreen ? styles.scrollContainerCompact : null,
      ]}
      automaticallyAdjustKeyboardInsets={isAuth}
      automaticallyAdjustContentInsets={!isAuth}
      bounces={!isAuth}
      contentInsetAdjustmentBehavior={isAuth ? 'never' : 'automatic'}
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
    >
      {content}
    </ScrollView>
  ) : (
    content
  );

  const keyboardWrapper = keyboardAvoidingEnabled ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Math.max(insets.top, isAuth ? theme.spacing.xl : theme.spacing.sm)}
    >
      {viewPort}
    </KeyboardAvoidingView>
  ) : viewPort;

  const shell = (
    <View
      style={[
        styles.container,
        isDashboard ? styles.dashboardContainer : null,
        { backgroundColor: isDashboard ? dashboardBaseBackground : backgroundCanvas },
      ]}
    >
      {isAuth ? (
        keyboardWrapper
      ) : (
        <>
          {isDashboard ? (
            <>
              <View
                style={[
                  styles.dashboardHero,
                  { height: dashboardHeroHeight, backgroundColor: dashboardHeroBackground },
                ]}
              />
              <View style={[styles.dashboardBase, { top: dashboardHeroHeight - theme.spacing.lg, backgroundColor: dashboardBaseBackground }]} />
            </>
          ) : null}
          {keyboardWrapper}
        </>
      )}
    </View>
  );

  if (!safeArea) {
    return <View style={[styles.safeArea, { backgroundColor: backgroundCanvas }]}>{shell}</View>;
  }

  return <SafeAreaView style={[styles.safeArea, { backgroundColor: backgroundCanvas }]}>{shell}</SafeAreaView>;
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.backgroundCanvas,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.backgroundCanvas,
  },
  dashboardContainer: {
    backgroundColor: theme.colors.backgroundSecondary,
  },
  dashboardBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.backgroundSecondary,
    borderTopLeftRadius: theme.radius.giant,
    borderTopRightRadius: theme.radius.giant,
  },
  dashboardHero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  scrollContainer: {
    flexGrow: 1,
  },
  scrollContainerCompact: {
    minHeight: '100%',
  },
  authScroll: {
    minHeight: '100%',
  },
  content: {
    flex: 1,
  },
  authContent: {
    justifyContent: 'flex-start',
  },
});
