import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppIcon } from '../ui/AppIcon';
import { AppCard } from '../ui/AppCard';
import { AppButton } from '../ui/AppButton';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';
import { useAuthActions } from '../../features/auth/hooks/useAuthActions';

export function DonorTopBar({
  title,
  subtitle = '',
  avatarUri = '',
  avatarInitials = '',
  unreadCount = 0,
  showBack = false,
  showFeedbackAction,
  showNotificationsAction = true,
  showTutorialAction = false,
  showLogoutAction = false,
  onBackPress,
  onFeedbackPress,
  onTutorialPress,
  onProfilePress,
  onNotificationsPress,
  onLogoutPress,
  isLoggingOut = false,
  style,
}) {
  const { resolvedTheme, profile } = useAuth();
  const router = useRouter();
  const { logout: fallbackLogout, isLoading: isFallbackLoggingOut } = useAuthActions();
  const roles = resolveThemeRoles(resolvedTheme);
  const [avatarFailed, setAvatarFailed] = React.useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = React.useState(false);
  const effectiveIsLoggingOut = Boolean(isLoggingOut || (!onLogoutPress && isFallbackLoggingOut));
  const headerIconColor = roles.primaryActionText || '#ffffff';
  const shouldShowFeedbackAction = showFeedbackAction ?? false;
  const headerTitle = title || resolvedTheme?.brandName || 'Donivra';
  const headerSubtitle = subtitle || (!title ? resolvedTheme?.brandTagline || 'Where hair becomes hope' : '');

  const profileImageUri = avatarUri || profile?.avatar_url || profile?.photo_path || '';
  const profileInitials = avatarInitials || [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .map((value) => String(value).trim().charAt(0).toUpperCase())
    .join('') || headerTitle.trim().charAt(0).toUpperCase() || 'D';

  React.useEffect(() => {
    setAvatarFailed(false);
  }, [profileImageUri]);

  const openLogoutModal = React.useCallback(() => {
    if (effectiveIsLoggingOut) return;
    setIsLogoutModalOpen(true);
  }, [effectiveIsLoggingOut]);

  const closeLogoutModal = React.useCallback(() => {
    if (effectiveIsLoggingOut) return;
    setIsLogoutModalOpen(false);
  }, [effectiveIsLoggingOut]);

  const confirmLogout = React.useCallback(async () => {
    setIsLogoutModalOpen(false);
    if (onLogoutPress) {
      const result = await onLogoutPress();
      if (result?.success && !result?.error) {
        router.replace('/auth/access');
      }
      return;
    }

    const result = await fallbackLogout();
    if (result?.success && !result?.error) {
      router.replace('/auth/access');
    }
  }, [fallbackLogout, onLogoutPress, router]);

  const handleFeedbackPress = React.useCallback(() => {
    if (onFeedbackPress) {
      onFeedbackPress();
      return;
    }
    router.navigate('/donor/feedback');
  }, [onFeedbackPress, router]);

  return (
    <>
      <View style={[styles.headerRow, style]}>
        {showBack ? (
          <Pressable
            onPress={onBackPress}
            disabled={!onBackPress}
            style={styles.headerIdentityPressable}
          >
            <View style={styles.headerIdentityContent}>
              <View style={styles.headerBackButton}>
                <AppIcon name="arrowLeft" size="md" state="default" color={headerIconColor} />
              </View>
              <View style={styles.headerCopy}>
                <Text numberOfLines={1} style={[styles.headerTitle, { color: headerIconColor }]}>
                  {headerTitle}
                </Text>
                {subtitle ? (
                  <Text numberOfLines={1} style={[styles.headerSubtitle, { color: headerIconColor }]}>
                    {headerSubtitle}
                  </Text>
                ) : null}
              </View>
            </View>
          </Pressable>
        ) : (
          <Pressable
            onPress={onProfilePress}
            disabled={!onProfilePress}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            hitSlop={6}
            style={styles.headerIdentityPressable}
          >
            <View style={styles.headerIdentityContent}>
              <View
                style={[
                  styles.brandLogoWrap,
                  {
                    backgroundColor: resolvedTheme?.backgroundColor || roles.pageBackground,
                    borderColor: 'rgba(255, 255, 255, 0.56)',
                  },
                ]}
              >
                {profileImageUri && !avatarFailed ? (
                  <Image
                    source={{ uri: profileImageUri }}
                    style={styles.brandLogoImage}
                    resizeMode="cover"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <Text style={[styles.avatarInitials, { color: headerIconColor }]}>{profileInitials}</Text>
                )}
              </View>
              <View style={styles.headerCopy}>
                <Text numberOfLines={1} style={[styles.headerTitle, { color: headerIconColor }]}>
                  {headerTitle}
                </Text>
                {headerSubtitle ? (
                  <Text numberOfLines={1} style={[styles.headerSubtitle, { color: headerIconColor }]}>
                    {headerSubtitle}
                  </Text>
                ) : null}
              </View>
            </View>
          </Pressable>
        )}

        <View style={styles.headerActions}>
          {shouldShowFeedbackAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open feedback"
              onPress={handleFeedbackPress}
              hitSlop={6}
              style={({ pressed }) => [styles.headerIconButton, pressed && styles.headerIconButtonPressed]}
            >
              <AppIcon name="feedback" size="md" state="default" color={headerIconColor} />
            </Pressable>
          ) : null}

          {showTutorialAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open tutorial guide"
              onPress={onTutorialPress}
              disabled={!onTutorialPress}
              hitSlop={6}
              style={({ pressed }) => [
                styles.headerIconButton,
                pressed && styles.headerIconButtonPressed,
                !onTutorialPress && styles.headerIconButtonDisabled,
              ]}
            >
              <AppIcon name="tutorial" size="md" state="default" color={headerIconColor} />
            </Pressable>
          ) : null}

          {showNotificationsAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open notifications"
              onPress={onNotificationsPress}
              hitSlop={6}
              style={({ pressed }) => [
                styles.headerIconButton,
                pressed && styles.headerIconButtonPressed,
                !onNotificationsPress && styles.headerIconButtonDisabled,
              ]}
              disabled={!onNotificationsPress}
            >
              <AppIcon name="notifications" size="md" state="default" color={headerIconColor} />
              {unreadCount ? (
                <View style={styles.headerBadge}>
                  <Text style={styles.headerBadgeText}>
                    {Math.min(unreadCount, 99)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}

          {showLogoutAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Log out"
              onPress={openLogoutModal}
              disabled={effectiveIsLoggingOut}
              hitSlop={6}
              style={({ pressed }) => [
                styles.headerIconButton,
                styles.headerIconButtonLight,
                { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder },
                pressed && styles.headerIconButtonPressed,
                effectiveIsLoggingOut && styles.headerIconButtonDisabled,
              ]}
            >
              <AppIcon name="signOut" size="md" state="default" color={roles.headingText} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <Modal transparent visible={isLogoutModalOpen} animationType="fade" onRequestClose={closeLogoutModal}>
        <View style={styles.logoutModalOverlay}>
          <Pressable style={styles.logoutModalBackdrop} onPress={closeLogoutModal} />
          <AppCard variant="elevated" radius="xl" padding="lg" style={styles.logoutModalCard}>
            <Text style={styles.logoutModalTitle}>Log out?</Text>
            <Text style={styles.logoutModalBody}>Are you sure you want to log out?</Text>
            <View style={styles.logoutModalActions}>
              <AppButton title="Cancel" variant="outline" fullWidth={false} onPress={closeLogoutModal} />
              <AppButton title="Log out" fullWidth={false} onPress={confirmLogout} loading={effectiveIsLoggingOut} />
            </View>
          </AppCard>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  headerIdentityPressable: {
    flex: 1,
    minWidth: 0,
  },
  headerIdentityContent: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: theme.spacing.sm,
    width: '100%',
  },
  identityPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  headerBackButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  brandLogoWrap: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    ...theme.shadows.sm,
  },
  brandLogoImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitials: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 16,
    fontWeight: theme.typography.weights.bold,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  headerTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyMd,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 20,
  },
  headerSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    opacity: 0.76,
    lineHeight: 14,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flexShrink: 0,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerIconButtonLight: {
    borderWidth: 1,
  },
  headerIconButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.94 }],
  },
  headerIconButtonDisabled: {
    opacity: 0.46,
  },
  headerBadge: {
    position: 'absolute',
    top: -5,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: theme.radius.full,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6E2C8',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  headerBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    color: '#5B0B12',
  },
  logoutModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  logoutModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  logoutModalCard: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  logoutModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  logoutModalBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  logoutModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
});
