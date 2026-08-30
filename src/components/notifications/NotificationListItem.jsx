import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../ui/AppIcon';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';
import { getNotificationTimestampLabel } from '../../features/notification.service';

const TYPE_ICON_MAP = {
  account_created: 'account-check-outline',
  submission_received: 'gift-outline',
  ai_screening_completed: 'star-four-points-outline',
  recommendation_available: 'lightbulb-on-outline',
  logistics_update: 'truck-delivery-outline',
  donation_tracking_updated: 'timeline-text-outline',
  hair_analysis_reminder: 'line-scan',
  donation_drive_update: 'calendar-clock-outline',
  donation_drive_rsvp_confirmed: 'calendar-check-outline',
  donation_drive_rsvp_reminder: 'calendar-clock-outline',
  wig_request_updated: 'clipboard-text-outline',
  wig_allocation_updated: 'content-cut',
  certificate_available: 'certificate-outline',
};

export function NotificationListItem({
  notification,
  onPress,
  compact = false,
  showDivider = true,
  presentation = 'list',
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const timestamp = getNotificationTimestampLabel(notification?.createdAt);
  const isCard = presentation === 'card';
  const isUnread = !notification?.isRead;

  return (
    <Pressable
      onPress={() => onPress?.(notification)}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          styles.rowContent,
          compact ? styles.rowContentCompact : null,
          isCard
            ? [
                styles.rowCard,
                {
                  backgroundColor: isUnread ? roles.iconPrimarySurface : roles.defaultCardBackground,
                  borderColor: isUnread ? roles.primaryActionBackground : roles.defaultCardBorder,
                },
              ]
            : showDivider ? styles.rowDivider : styles.rowLast,
        ]}
      >
        {isCard && isUnread ? (
          <View style={[styles.unreadAccent, { backgroundColor: roles.primaryActionBackground }]} />
        ) : null}
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: isUnread ? roles.primaryActionBackground : roles.iconPrimarySurface,
              borderColor: isUnread ? roles.primaryActionBackground : roles.defaultCardBorder,
            },
          ]}
        >
          <AppIcon
            name={TYPE_ICON_MAP[notification?.type] || 'bell-outline'}
            size="md"
            color={isUnread ? roles.primaryActionText : roles.iconPrimaryColor}
          />
        </View>

        <View style={styles.copyWrap}>
          <View style={styles.topRow}>
            <Text
              numberOfLines={2}
              style={[
                styles.title,
                compact ? styles.titleCompact : null,
                { color: roles.headingText },
              ]}
            >
              {notification?.title}
            </Text>
            {timestamp ? <Text numberOfLines={1} style={[styles.timestamp, { color: roles.metaText }]}>{timestamp}</Text> : null}
          </View>
          <View style={styles.messageRow}>
            <Text
              numberOfLines={compact ? 1 : 2}
              style={[
                styles.message,
                compact ? styles.messageCompact : null,
                { color: roles.bodyText },
              ]}
            >
              {notification?.message}
            </Text>
            {isUnread ? <View style={[styles.unreadDot, { backgroundColor: roles.primaryActionBackground }]} /> : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
  },
  rowContent: {
    width: '100%',
    minHeight: 88,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowContentCompact: {
    paddingVertical: theme.spacing.sm,
    minHeight: 60,
  },
  rowCard: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  unreadAccent: {
    position: 'absolute',
    left: 0,
    top: theme.spacing.md,
    bottom: theme.spacing.md,
    width: 4,
    borderRadius: theme.radius.full,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: theme.spacing.md,
  },
  copyWrap: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  titleCompact: {
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.snug,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
    marginTop: 3,
    marginLeft: theme.spacing.sm,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  message: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  messageCompact: {
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.snug,
  },
  timestamp: {
    flexShrink: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    marginTop: 1,
  },
});
