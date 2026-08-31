import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { DashboardLayout } from './DashboardLayout';
import { DashboardHeaderSurface } from './DashboardHeaderSurface';
import { DonorTopBar } from '../donor/DonorTopBar';
import { AppIcon } from '../ui/AppIcon';
import { EmptyDataState } from '../ui/EmptyDataState';
import { useAuth } from '../../providers/AuthProvider';
import { getDonorDonationsModuleData } from '../../features/donorDonations.service';
import { resolveThemeRoles, theme } from '../../design-system/theme';

const formatStatusLabel = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Completed';

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const getDonationStatusTone = (status = '') => {
  const normalized = String(status || '').toLowerCase();
  return {
    isCancelled: /cancel|reject|deny|fail|void|expire/.test(normalized),
    isCompleted: /complete|completed|success|approved|received|done|closed/.test(normalized),
  };
};

function DonationHistoryRow({ item, roles, showDivider = true }) {
  const { isCancelled, isCompleted } = getDonationStatusTone(item?.status);
  const statusLabel = isCancelled
    ? 'Cancelled'
    : isCompleted
      ? 'Completed'
      : formatStatusLabel(item?.status);
  const statusBackground = isCancelled
    ? 'rgba(163, 33, 33, 0.10)'
    : isCompleted
      ? roles.iconPrimarySurface
      : roles.badgeBackground;
  const statusColor = isCancelled
    ? '#A32121'
    : isCompleted
      ? roles.iconPrimaryColor
      : roles.badgeText;

  return (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: roles.defaultCardBorder,
          borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0,
        },
      ]}
    >
      <View style={[styles.rowIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
        <AppIcon name="history" size="md" color={roles.iconPrimaryColor} />
      </View>

      <View style={styles.rowCopy}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: roles.headingText }]}>
            {item?.donation_reference || 'Donation record'}
          </Text>
          <Text numberOfLines={1} style={[styles.rowDate, { color: roles.metaText }]}>
            {item?.date_label || 'Date unavailable'}
          </Text>
        </View>

        <View style={styles.rowBottom}>
          <View style={[styles.statusBadge, { backgroundColor: statusBackground }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          <Text numberOfLines={1} style={[styles.bundleText, { color: roles.bodyText }]}>
            {item?.bundle_quantity
              ? `${item.bundle_quantity} bundle${item.bundle_quantity === 1 ? '' : 's'}`
              : 'N/A'}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function DonorDonationHistoryScreen() {
  const router = useRouter();
  const { user, profile, resolvedTheme, isLoading: isAuthLoading } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);

  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [historyItems, setHistoryItems] = React.useState([]);

  const loadHistory = React.useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) {
      setHistoryItems([]);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const result = await getDonorDonationsModuleData({
        userId: user.id,
        databaseUserId: profile?.user_id || null,
      });

      setHistoryItems(result?.donationHistory || result?.completedDonationHistory || []);

      if (result?.error) {
        // Keep the technical detail out of the UI, but preserve it for debugging.
        console.warn('[DonorDonationHistoryScreen] loadHistory error:', result.error);
      }
    } catch (err) {
      setHistoryItems([]);
      console.warn('[DonorDonationHistoryScreen] loadHistory exception:', err);
    } finally {
      if (silent) {
        setIsRefreshing(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [profile?.user_id, user?.id]);

  React.useEffect(() => {
    if (isAuthLoading) return;
    loadHistory();
  }, [isAuthLoading, loadHistory]);

  return (
    <DashboardLayout
      hideNav
      navItems={[]}
      navVariant="donor"
      screenVariant="default"
      onRefresh={() => loadHistory({ silent: true })}
      refreshing={isRefreshing}
      header={(
        <DashboardHeaderSurface>
          <DonorTopBar
            title="History"
            subtitle="Your donation journey"
            showBack
            showNotificationsAction={false}
            showLogoutAction={false}
            onBackPress={() => router.back()}
          />
        </DashboardHeaderSurface>
      )}
    >
      <View style={styles.page}>
        <LinearGradient
          colors={[roles.iconPrimarySurface, roles.defaultCardBackground]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.historyOverview, { borderColor: roles.defaultCardBorder }]}
        >
          <View style={[styles.historyOverviewIcon, { backgroundColor: roles.primaryActionBackground }]}>
            <AppIcon name="history" size="lg" color={roles.primaryActionText} />
          </View>
          <View style={styles.historyOverviewCopy}>
            <Text style={[styles.historyOverviewTitle, { color: roles.headingText }]}>Donation history</Text>
            <Text style={[styles.historyOverviewText, { color: roles.bodyText }]}>Review completed and cancelled donations in one place.</Text>
          </View>
        </LinearGradient>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
            <Text style={[styles.loadingText, { color: roles.metaText }]}>
              Loading donation history...
            </Text>
          </View>
        ) : historyItems.length ? (
          <View style={[styles.list, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            {historyItems.map((item, index) => (
              <DonationHistoryRow
                key={item.submission_id}
                item={item}
                roles={roles}
                showDivider={index < historyItems.length - 1}
              />
            ))}
          </View>
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <EmptyDataState
              variant="default"
              showCountBadge={false}
              title="No donation history yet"
              message="Completed or cancelled donations will appear here."
              style={styles.emptyState}
              illustrationStyle={styles.emptyIllustration}
              titleStyle={[styles.emptyTitle, { color: roles.headingText }]}
              messageStyle={[styles.emptyBody, { color: roles.metaText }]}
            />
          </View>
        )}
      </View>
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  page: {
    width: '100%',
    maxWidth: theme.layout.contentMaxWidth,
    alignSelf: 'center',
    gap: theme.spacing.md,
  },
  historyOverview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 20,
    ...theme.shadows.soft,
  },
  historyOverviewIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  historyOverviewCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  historyOverviewTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  historyOverviewText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
  },
  loadingState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  loadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  list: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: theme.spacing.md,
    ...theme.shadows.soft,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  rowDate: {
    flexShrink: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.snug,
    marginTop: 2,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
  },
  statusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  bundleText: {
    flexShrink: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  emptyState: {
    width: '100%',
    minHeight: 300,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
  },
  emptyCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 24,
    ...theme.shadows.soft,
  },
  emptyIllustration: {
    marginBottom: theme.spacing.xs,
  },
  emptyTitle: {
    fontSize: 24,
    lineHeight: 28,
  },
  emptyBody: {
    maxWidth: 300,
  },
});
