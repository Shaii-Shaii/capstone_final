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

export function NotificationListItem({ notification, onPress, compact = false, showDivider = true }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const timestamp = getNotificationTimestampLabel(notification?.createdAt);

  return (
    <Pressable
      onPress={() => onPress?.(notification)}
      style={({ pressed }) => [
        styles.row,
        compact ? styles.rowCompact : null,
        showDivider ? styles.rowDivider : styles.rowLast,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
        <AppIcon
          name={TYPE_ICON_MAP[notification?.type] || 'bell-outline'}
          size="md"
          color={roles.iconPrimaryColor}
        />
      </View>

      <View style={styles.copyWrap}>
        <View style={styles.topRow}>
          <Text numberOfLines={2} style={[styles.title, compact ? styles.titleCompact : null]}>
            {notification?.title}
          </Text>
          {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
        </View>
        <View style={styles.messageRow}>
          <Text numberOfLines={compact ? 1 : 2} style={[styles.message, compact ? styles.messageCompact : null]}>
            {notification?.message}
          </Text>
          {!notification?.isRead ? <View style={styles.unreadDot} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  rowCompact: {
    paddingVertical: theme.spacing.sm,
    minHeight: 60,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    opacity: 0.84,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: theme.colors.textPrimary,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  titleCompact: {
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.snug,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.textError,
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
    color: theme.colors.textSecondary,
  },
  messageCompact: {
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.snug,
  },
  timestamp: {
    flexShrink: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
    marginTop: 1,
  },
});
