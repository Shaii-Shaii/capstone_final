import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { DashboardLayout } from './DashboardLayout';
import { AppIcon } from '../ui/AppIcon';
import { StatusBanner } from '../ui/StatusBanner';
import { NotificationListItem } from '../notifications/NotificationListItem';
import { useNotifications } from '../../hooks/useNotifications';
import { useAuth } from '../../providers/AuthProvider';
import { donorDashboardNavItems, patientDashboardNavItems } from '../../constants/dashboard';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { getNotificationNavigationTarget } from '../../features/notification.service';

const getNotificationRenderKey = (notification = {}, index = 0) => (
  String(
    notification?.backendId
    || notification?.id
    || notification?.dedupeKey
    || `${notification?.type || 'notification'}:${notification?.createdAt || 'no-date'}:${index}`
  )
);

const getDateSectionLabel = (value) => {
  if (!value) return 'Earlier';

  const createdAt = new Date(value);
  const today = new Date();
  if (Number.isNaN(createdAt.getTime())) return 'Earlier';

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfCreated = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
  const diffDays = Math.floor((startOfToday.getTime() - startOfCreated.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Today';
  if (diffDays > 0 && diffDays < 7) return 'This week';
  return 'Earlier';
};

const groupNotificationsByDate = (notifications = []) => {
  const sections = [];
  const sectionMap = new Map();

  (notifications || []).forEach((notification, index) => {
    const label = getDateSectionLabel(notification?.createdAt);
    if (!sectionMap.has(label)) {
      const section = {
        key: label.toLowerCase().replace(/\s+/g, '-'),
        label,
        items: [],
      };
      sectionMap.set(label, section);
      sections.push(section);
    }

    sectionMap.get(label).items.push({
      ...notification,
      renderKey: getNotificationRenderKey(notification, index),
    });
  });

  return sections;
};

const getVisibleNotifications = (notifications = []) => {
  const seen = new Set();
  const seenBackendIds = new Set();

  return (Array.isArray(notifications) ? notifications : []).filter((notification) => {
    if (!notification || (!notification.title && !notification.message)) {
      return false;
    }

    // Keep the renderer safe even if a stale cache or live update briefly
    // supplies the same backend row twice before the service refreshes.
    const backendId = notification.backendId || notification.notificationId || null;
    if (backendId) {
      const backendKey = String(backendId);
      if (seenBackendIds.has(backendKey)) return false;
      seenBackendIds.add(backendKey);
    }

    const title = String(notification.title || '').trim().toLowerCase();
    const message = String(notification.message || '').trim().toLowerCase();
    const key = [
      notification.type || 'notification',
      notification.referenceType || '',
      notification.referenceId || '',
      title,
      message,
    ].join('|');

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

function NotificationsEmptyState() {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconWrap}>
        <AppIcon name="notifications" size="lg" state="muted" />
      </View>
      <Text style={styles.emptyTitle}>No notifications yet</Text>
      <Text style={styles.emptyMessage}>
        Your updates, reminders, and status changes will appear here.
      </Text>
    </View>
  );
}

function NotificationTopBar({ title, onBack, onRefresh, refreshing = false }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const { height } = useWindowDimensions();
  const horizontalInset = height < theme.layout.shortScreenHeight
    ? theme.layout.screenPaddingXCompact
    : theme.layout.screenPaddingX;

  return (
    <View
      style={[
        styles.topBar,
        {
          backgroundColor: roles.primaryActionBackground,
          marginHorizontal: -horizontalInset,
          paddingHorizontal: 0,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={({ pressed }) => [
          styles.topBarButton,
          { backgroundColor: 'rgba(255, 255, 255, 0.10)' },
          pressed ? styles.topBarButtonPressed : null,
        ]}
      >
        <AppIcon name="arrowLeft" state="inverse" color={roles.primaryActionText} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.topBarTitle, { color: roles.primaryActionText }]}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh notifications"
        onPress={onRefresh}
        style={({ pressed }) => [
          styles.topBarButton,
          { backgroundColor: 'rgba(255, 255, 255, 0.10)' },
          pressed ? styles.topBarButtonPressed : null,
        ]}
      >
        {refreshing ? (
          <ActivityIndicator size="small" color={roles.primaryActionText} />
        ) : (
          <AppIcon name="refresh" state="inverse" color={roles.primaryActionText} />
        )}
      </Pressable>
    </View>
  );
}

function NotificationsContent({
  notifications,
  isLoadingNotifications,
  notificationError,
  onNotificationPress,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const visibleNotifications = React.useMemo(
    () => getVisibleNotifications(notifications),
    [notifications]
  );
  const sections = React.useMemo(
    () => groupNotificationsByDate(visibleNotifications),
    [visibleNotifications]
  );

  return (
    <>
      {notificationError ? (
        <StatusBanner
          title="Notification sync"
          message={notificationError}
          variant="info"
        />
      ) : null}

      {isLoadingNotifications ? (
        <View style={styles.loadingState}>
          <AppIcon name="notifications" size="lg" state="muted" />
          <Text style={styles.loadingTitle}>Loading notifications</Text>
          <Text style={styles.loadingBody}>Fetching the latest updates.</Text>
        </View>
      ) : sections.length ? (
        <View style={styles.sectionsWrap}>
          {sections.map((section) => (
            <View key={section.key} style={styles.sectionBlock}>
              <Text
                style={[
                  styles.sectionHeading,
                  (section.label === 'Today' || section.label === 'This week') ? styles.sectionHeadingCompact : null,
                  { color: roles.headingText },
                ]}
              >
                {section.label}
              </Text>
              <View style={styles.sectionList}>
                {section.items.map((notification, index) => (
                  <NotificationListItem
                    key={notification.renderKey}
                    notification={notification}
                    onPress={onNotificationPress}
                    showDivider={index < section.items.length - 1}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <NotificationsEmptyState />
      )}
    </>
  );
}

export function NotificationCenterScreen({ role }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const {
    notifications,
    isLoadingNotifications,
    isRefreshingNotifications,
    notificationError,
    refreshNotifications,
    readNotification,
  } = useNotifications({
    role,
    userId: user?.id,
    userEmail: user?.email || profile?.email || '',
    databaseUserId: profile?.user_id,
    mode: 'full',
    liveUpdates: true,
  });

  const navItems = role === 'donor' ? donorDashboardNavItems : patientDashboardNavItems;

  const handleNavPress = (item) => {
    if (!item.route) return;
    if (item.route === (role === 'donor' ? '/donor/notifications' : '/patient/notifications')) return;
    router.navigate(item.route);
  };

  const handleNotificationPress = async (notification) => {
    if (!notification?.isRead) {
      await readNotification(notification.id);
    }

    const targetRoute = getNotificationNavigationTarget(notification);
    if (targetRoute) {
      router.navigate(targetRoute);
    }
  };

  return (
    <DashboardLayout
      showSupportChat={false}
      hideNav
      navItems={navItems}
      activeNavKey="notifications"
      navVariant={role === 'donor' ? 'donor' : 'patient'}
      onNavPress={handleNavPress}
      screenVariant="default"
      header={(
        <NotificationTopBar
          title="Notifications"
          onBack={() => router.back()}
          onRefresh={() => refreshNotifications({ silent: true, force: true })}
          refreshing={isRefreshingNotifications}
        />
      )}
    >
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={styles.screenContent}
        showsVerticalScrollIndicator={false}
      >
        <NotificationsContent
          notifications={notifications}
          isLoadingNotifications={isLoadingNotifications}
          notificationError={notificationError}
          onNotificationPress={handleNotificationPress}
        />
      </ScrollView>
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  screenContent: {
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    minHeight: 56,
    paddingVertical: theme.spacing.xs,
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarButtonPressed: {
    opacity: 0.82,
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  topBarSpacer: {
    width: 40,
    height: 40,
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xl,
  },
  loadingBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  loadingTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  sectionsWrap: {
    gap: theme.spacing.lg,
  },
  sectionBlock: {
    gap: theme.spacing.sm,
  },
  sectionHeading: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
    paddingHorizontal: theme.spacing.xs,
  },
  sectionHeadingCompact: {
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  sectionList: {
    backgroundColor: theme.colors.transparent,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xl,
    marginTop: theme.spacing.sm,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  emptyTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  emptyMessage: {
    maxWidth: 260,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});
