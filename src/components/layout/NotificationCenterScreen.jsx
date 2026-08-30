import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { DashboardLayout } from './DashboardLayout';
import { DashboardHeaderSurface } from './DashboardHeaderSurface';
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

function NotificationsEmptyState({ filter = 'all', roles }) {
  const isUnreadFilter = filter === 'unread';

  return (
    <View style={[styles.emptyState, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
      <View style={[styles.emptyIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
        <AppIcon name={isUnreadFilter ? 'checkmarkCircle' : 'notifications'} size="lg" color={roles.iconPrimaryColor} />
      </View>
      <Text style={[styles.emptyTitle, { color: roles.headingText }]}>
        {isUnreadFilter ? "You're all caught up" : 'No notifications yet'}
      </Text>
      <Text style={[styles.emptyMessage, { color: roles.bodyText }]}>
        {isUnreadFilter
          ? 'There are no unread updates right now.'
          : 'Your updates, reminders, and status changes will appear here.'}
      </Text>
    </View>
  );
}

function NotificationToolbar({ activeFilter, totalCount, unreadCount, onFilterChange, onMarkAllRead, roles }) {
  const filters = [
    { key: 'all', label: 'All', count: totalCount },
    { key: 'unread', label: 'Unread', count: unreadCount },
  ];

  return (
    <View style={styles.toolbar}>
      <View style={styles.filterGroup}>
        {filters.map((item) => {
          const isActive = activeFilter === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => onFilterChange(item.key)}
              style={({ pressed }) => [
                styles.filterChip,
                pressed ? styles.controlPressed : null,
              ]}
            >
              <View
                pointerEvents="none"
                style={[
                  styles.filterChipContent,
                  {
                    backgroundColor: isActive ? roles.primaryActionBackground : roles.defaultCardBackground,
                    borderColor: isActive ? roles.primaryActionBackground : roles.defaultCardBorder,
                  },
                ]}
              >
                <Text style={[styles.filterChipText, { color: isActive ? roles.primaryActionText : roles.bodyText }]}>
                  {item.label}
                </Text>
                <View
                  style={[
                    styles.filterCount,
                    { backgroundColor: isActive ? 'rgba(255,255,255,0.18)' : roles.iconPrimarySurface },
                  ]}
                >
                  <Text style={[styles.filterCountText, { color: isActive ? roles.primaryActionText : roles.iconPrimaryColor }]}>
                    {item.count}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mark all notifications as read"
        accessibilityState={{ disabled: unreadCount === 0 }}
        disabled={unreadCount === 0}
        onPress={onMarkAllRead}
        style={({ pressed }) => [
          styles.markAllButton,
          { opacity: unreadCount === 0 ? 0.46 : pressed ? 0.72 : 1 },
        ]}
      >
        <View pointerEvents="none" style={styles.markAllContent}>
          <AppIcon name="checkmarkCircle" size="sm" color={unreadCount ? roles.primaryActionBackground : roles.metaText} />
          <Text style={[styles.markAllText, { color: unreadCount ? roles.primaryActionBackground : roles.metaText }]}>Mark all read</Text>
        </View>
      </Pressable>
    </View>
  );
}

function NotificationTopBar({
  title,
  subtitle = 'Updates and reminders',
  onBack,
  onRefresh,
  refreshing = false,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);

  return (
    <DashboardHeaderSurface>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={6}
          onPress={onBack}
          style={({ pressed }) => [
            styles.topBarButton,
            pressed ? styles.topBarButtonPressed : null,
          ]}
        >
          <AppIcon name="arrowLeft" size="md" state="inverse" color={roles.primaryActionText} />
        </Pressable>

        <View style={styles.topBarCopy}>
          <Text numberOfLines={1} style={[styles.topBarTitle, { color: roles.primaryActionText }]}>
            {title}
          </Text>
          <Text numberOfLines={1} style={[styles.topBarSubtitle, { color: roles.primaryActionText }]}>
            {subtitle}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh notifications"
          hitSlop={6}
          disabled={refreshing}
          onPress={onRefresh}
          style={({ pressed }) => [
            styles.topBarButton,
            pressed ? styles.topBarButtonPressed : null,
            refreshing ? styles.topBarButtonDisabled : null,
          ]}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={roles.primaryActionText} />
          ) : (
            <AppIcon name="refresh" size="md" state="inverse" color={roles.primaryActionText} />
          )}
        </Pressable>
      </View>
    </DashboardHeaderSurface>
  );
}

function NotificationsContent({
  notifications,
  isLoadingNotifications,
  notificationError,
  onNotificationPress,
  filter,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const visibleNotifications = React.useMemo(
    () => getVisibleNotifications(notifications).filter((notification) => (
      filter === 'unread' ? !notification?.isRead : true
    )),
    [filter, notifications]
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
        <View style={[styles.loadingState, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
          <AppIcon name="notifications" size="lg" color={roles.iconPrimaryColor} />
          <Text style={[styles.loadingTitle, { color: roles.headingText }]}>Loading notifications</Text>
          <Text style={[styles.loadingBody, { color: roles.bodyText }]}>Fetching the latest updates.</Text>
        </View>
      ) : sections.length ? (
        <View style={styles.sectionsWrap}>
          {sections.map((section) => (
            <View key={section.key} style={styles.sectionBlock}>
              <View style={styles.sectionHeadingRow}>
                <Text
                  style={[
                    styles.sectionHeading,
                    (section.label === 'Today' || section.label === 'This week') ? styles.sectionHeadingCompact : null,
                    { color: roles.headingText },
                  ]}
                >
                  {section.label}
                </Text>
                <View style={[styles.sectionCount, { backgroundColor: roles.iconPrimarySurface }]}>
                  <Text style={[styles.sectionCountText, { color: roles.iconPrimaryColor }]}>{section.items.length}</Text>
                </View>
              </View>
              <View style={styles.sectionList}>
                {section.items.map((notification) => (
                  <NotificationListItem
                    key={notification.renderKey}
                    notification={notification}
                    onPress={onNotificationPress}
                    presentation="card"
                    showDivider={false}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <NotificationsEmptyState filter={filter} roles={roles} />
      )}
    </>
  );
}

export function NotificationCenterScreen({ role }) {
  const router = useRouter();
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [activeFilter, setActiveFilter] = React.useState('all');
  const {
    notifications,
    isLoadingNotifications,
    isRefreshingNotifications,
    notificationError,
    refreshNotifications,
    readNotification,
    readAllNotifications,
  } = useNotifications({
    role,
    userId: user?.id,
    userEmail: user?.email || profile?.email || '',
    databaseUserId: profile?.user_id,
    mode: 'full',
    liveUpdates: true,
  });

  const navItems = role === 'donor' ? donorDashboardNavItems : patientDashboardNavItems;
  const visibleNotifications = React.useMemo(
    () => getVisibleNotifications(notifications),
    [notifications]
  );
  const unreadCount = React.useMemo(
    () => visibleNotifications.filter((notification) => !notification?.isRead).length,
    [visibleNotifications]
  );

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

  const handleMarkAllRead = async () => {
    if (!unreadCount) return;
    await readAllNotifications();
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
        {!isLoadingNotifications ? (
          <NotificationToolbar
            activeFilter={activeFilter}
            totalCount={visibleNotifications.length}
            unreadCount={unreadCount}
            onFilterChange={setActiveFilter}
            onMarkAllRead={handleMarkAllRead}
            roles={roles}
          />
        ) : null}
        <NotificationsContent
          notifications={notifications}
          isLoadingNotifications={isLoadingNotifications}
          notificationError={notificationError}
          onNotificationPress={handleNotificationPress}
          filter={activeFilter}
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
  toolbar: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    minHeight: 38,
    borderRadius: theme.radius.pill,
    marginRight: theme.spacing.sm,
    overflow: 'hidden',
  },
  filterChipContent: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    marginRight: 6,
  },
  filterCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  markAllButton: {
    minHeight: 38,
    justifyContent: 'center',
    flexShrink: 1,
  },
  markAllContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingLeft: theme.spacing.xs,
  },
  markAllText: {
    marginLeft: 5,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  controlPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }],
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    minHeight: 64,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  topBarButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.94 }],
  },
  topBarButtonDisabled: {
    opacity: 0.72,
  },
  topBarCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  topBarTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyMd,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 20,
  },
  topBarSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 14,
    opacity: 0.76,
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xxl,
    borderRadius: 20,
    borderWidth: 1,
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
  sectionHeadingRow: {
    minHeight: 28,
    paddingHorizontal: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeading: {
    flex: 1,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
  },
  sectionHeadingCompact: {
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  sectionList: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.transparent,
  },
  sectionCount: {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    minHeight: 230,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xxl,
    marginTop: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 22,
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
