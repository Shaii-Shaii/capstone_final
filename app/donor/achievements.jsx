import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DashboardLayout } from '../../src/components/layout/DashboardLayout';
import { AppIcon } from '../../src/components/ui/AppIcon';
import { EmptyDataState } from '../../src/components/ui/EmptyDataState';
import { SectionTitleRow } from '../../src/components/ui/SectionTitleRow';
import { StatusBanner } from '../../src/components/ui/StatusBanner';
import { donorDashboardNavItems } from '../../src/constants/dashboard';
import {
  ensureCertificatesForScannedEventDonations,
  fetchDonationCertificatesByUserId,
  fetchDonorPatientImpactByBundleIds,
  fetchHairSubmissionsByUserId,
  isCompletedDonationSubmission,
} from '../../src/features/hairSubmission.api';
import { fetchOrganizationPreview } from '../../src/features/donorHome.api';
import {
  buildDonorCertificateHtml,
  buildDonorCertificateModel,
  buildDonorFullName,
  generateDonorCertificatePdf,
  isCertificateSharingSupported,
  shareDonorCertificatePdf,
} from '../../src/features/donorCertificate.service';
import { resolveThemeRoles, theme } from '../../src/design-system/theme';
import { useAuth } from '../../src/providers/AuthProvider';

const withOpacity = (color, opacity) => {
  if (!color || typeof color !== 'string') return color;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
    const raw = color.slice(1);
    const expanded = raw.length === 3
      ? raw.split('').map((part) => part + part).join('')
      : raw;
    const red = parseInt(expanded.slice(0, 2), 16);
    const green = parseInt(expanded.slice(2, 4), 16);
    const blue = parseInt(expanded.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${opacity})`);
  }
  return color;
};

const buildCertificateColors = (resolvedTheme) => {
  const roles = resolveThemeRoles(resolvedTheme);
  const primary = roles.primaryActionBackground;
  const surface = roles.defaultCardBackground;
  const supportSurface = roles.supportCardBackground;
  const accentSurface = roles.accentCardBackground;

  return {
    background: roles.pageBackground,
    surface,
    surfaceLow: supportSurface,
    surfaceHigh: accentSurface,
    surfaceHighest: roles.defaultCardBorder,
    primary,
    primaryContainer: roles.primaryActionBackground,
    onPrimary: roles.primaryActionText,
    onSurface: roles.headingText,
    onSurfaceVariant: roles.bodyText,
    secondary: roles.bodyText,
    outline: roles.metaText,
    outlineVariant: roles.defaultCardBorder,
    tertiary: roles.tertiaryAccentText,
    gold: resolvedTheme?.tertiaryColor || primary,
    successBg: roles.badgeStrongBackground,
    successText: roles.badgeStrongText,
    shadow: theme.colors.palette.black,
    bannerWatermark: withOpacity(roles.primaryActionText, 0.16),
    headerSurface: withOpacity(roles.pageBackground, 0.92),
    statLabel: withOpacity(roles.primaryActionText, 0.9),
    impactIconSurface: roles.iconPrimarySurface,
  };
};

const formatDateLabel = (value) => {
  if (!value) return 'Date not available';

  try {
    return new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getLengthLabel = (certificate) => {
  const length = toNumber(certificate?.declaredLength ?? certificate?.estimatedLength);
  return length > 0 ? `${length.toFixed(length % 1 ? 1 : 0)} inches` : 'Recorded';
};

const getBundleLabel = (certificate) => (
  certificate?.bundleId ? `Bundle #${certificate.bundleId}` : 'No bundle yet'
);

const SORT_OPTIONS = [
  { key: 'recent', label: 'Most Recent' },
  { key: 'oldest', label: 'Oldest' },
];

const ACHIEVEMENT_TABS = [
  { key: 'certificates', label: 'Certificates' },
  { key: 'milestones', label: 'Milestones' },
];

const sortCertificateRows = (rows, sortKey) => {
  const direction = sortKey === 'oldest' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftTime = new Date(left?.issuedAt || left?.donationDate || 0).getTime() || 0;
    const rightTime = new Date(right?.issuedAt || right?.donationDate || 0).getTime() || 0;
    return (leftTime - rightTime) * direction;
  });
};

const getConditionLabel = (certificate) => certificate?.detectedCondition || certificate?.decision || 'Verified';

const getCertificateCanvasNameFontSize = (value = '') => {
  const length = String(value || '').trim().length;
  if (length > 30) return 16;
  if (length > 24) return 18;
  if (length > 18) return 20;
  return 22;
};

function AchievementsTopBar({ title, onBack, styles }) {
  const { resolvedTheme } = useAuth();
  const colors = useMemo(() => buildCertificateColors(resolvedTheme), [resolvedTheme]);
  const { height } = useWindowDimensions();
  const horizontalInset = height < theme.layout.shortScreenHeight
    ? theme.layout.screenPaddingXCompact
    : theme.layout.screenPaddingX;

  return (
    <View
      style={[
        styles.topBar,
        {
          backgroundColor: colors.primaryContainer,
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
          pressed ? styles.pressed : null,
        ]}
      >
        <AppIcon name="arrowLeft" state="inverse" color={colors.onPrimary} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.topBarTitle, { color: colors.onPrimary }]}>
        {title}
      </Text>
      <View style={styles.topBarSpacer} />
    </View>
  );
}

function CertificateCanvas({ certificate, colors, styles }) {
  const recipientName = certificate?.donorName || 'Full name required';
  const recipientNameFontSize = getCertificateCanvasNameFontSize(recipientName);

  return (
    <View collapsable={false} style={styles.certificateCanvas}>
      <View style={styles.certificatePattern} pointerEvents="none" />
      <View style={styles.canvasHeader}>
        <Text style={styles.canvasBrand}>Donivra</Text>
        <Text style={styles.canvasTitle}>Certificate of Donation</Text>
        <View style={styles.goldRule} />
      </View>

      <View style={styles.canvasBody}>
        <Text style={styles.canvasIntro}>This is to certify that</Text>
        <Text
          style={[
            styles.canvasName,
            {
              fontSize: recipientNameFontSize,
              lineHeight: recipientNameFontSize + 6,
            },
          ]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.48}
        >
          {recipientName}
        </Text>
        <Text style={styles.canvasCopy}>
          Has generously donated {getLengthLabel(certificate)} of hair on {certificate?.donationDateLabel || certificate?.issuedAtLabel}.
          {'\n'}Your contribution brings hope and confidence to patients experiencing hair loss.
        </Text>
      </View>

      <View style={styles.canvasFooter}>
        <View style={styles.signatureBlock}>
          <View style={styles.signatureLine} />
          <Text style={styles.signatureLabel}>Authorized Signature</Text>
        </View>
        <View style={styles.seal}>
          <MaterialCommunityIcons name="check-decagram" size={40} color={colors.gold} />
        </View>
        <View style={styles.qrBox}>
          <MaterialCommunityIcons name="qrcode" size={30} color={colors.onSurfaceVariant} />
        </View>
      </View>
    </View>
  );
}

function CertificateDetailModal({
  certificate,
  visible,
  isBusy,
  colors,
  styles,
  onClose,
  onPrint,
  onSharePdf,
}) {
  const insets = useSafeAreaInsets();
  const [activeDetailTab, setActiveDetailTab] = React.useState('details');

  React.useEffect(() => {
    if (visible) {
      setActiveDetailTab('details');
    }
  }, [certificate?.certificateNumber, visible]);

  if (!certificate) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.detailScreen}>
        <View
          style={[
            styles.detailHeader,
            {
              paddingTop: insets.top,
              minHeight: insets.top + 56,
              backgroundColor: colors.primary,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={onClose}
            style={({ pressed }) => [
              styles.headerIconButton,
              { backgroundColor: 'rgba(255, 255, 255, 0.10)' },
              pressed ? styles.headerButtonPressed : null,
            ]}
          >
            <AppIcon name="arrowLeft" state="inverse" color={colors.onPrimary} />
          </Pressable>
          <View style={styles.detailHeaderCopy}>
            <Text style={[styles.detailHeaderTitle, { color: colors.onPrimary }]}>Certificate</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          {!certificate.donorName ? (
            <StatusBanner
              variant="info"
              title="Name needed"
              message="Complete your donor full name in Profile before generating this certificate."
            />
          ) : null}

          <View style={styles.canvasWrap}>
            <CertificateCanvas certificate={certificate} colors={colors} styles={styles} />
          </View>

          <View style={[styles.detailTabs, { borderBottomColor: colors.outlineVariant }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open donation details"
              onPress={() => setActiveDetailTab('details')}
              style={({ pressed }) => [
                styles.detailTab,
                activeDetailTab === 'details' ? [styles.detailTabActive, { borderBottomColor: colors.primary }] : null,
                pressed ? styles.detailTabPressed : null,
              ]}
            >
              <Text
                style={[
                  styles.detailTabText,
                  activeDetailTab === 'details' ? [styles.detailTabTextActive, { color: colors.primary }] : null,
                ]}
              >
                Donation Details
              </Text>
              <View
                style={[
                  styles.detailTabIndicator,
                  activeDetailTab === 'details' ? { backgroundColor: colors.primary } : null,
                ]}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open actions"
              onPress={() => setActiveDetailTab('actions')}
              style={({ pressed }) => [
                styles.detailTab,
                activeDetailTab === 'actions' ? [styles.detailTabActive, { borderBottomColor: colors.primary }] : null,
                pressed ? styles.detailTabPressed : null,
              ]}
            >
              <Text
                style={[
                  styles.detailTabText,
                  activeDetailTab === 'actions' ? [styles.detailTabTextActive, { color: colors.primary }] : null,
                ]}
              >
                Actions
              </Text>
              <View
                style={[
                  styles.detailTabIndicator,
                  activeDetailTab === 'actions' ? { backgroundColor: colors.primary } : null,
                ]}
              />
            </Pressable>
          </View>

          {activeDetailTab === 'details' ? (
            <View style={styles.tabContent}>
              <View style={styles.impactCard}>
                <View style={styles.impactIconWrap}>
                  <MaterialCommunityIcons name="heart" size={24} color={colors.primary} />
                </View>
                <View style={styles.impactCopy}>
                  <Text style={styles.impactTitle}>Your Impact</Text>
                  <Text style={styles.impactText}>
                    Your {getLengthLabel(certificate)} donation contributes toward creating a medical-grade wig for a patient in need.
                  </Text>
                </View>
              </View>

              <View style={styles.infoPanel}>
                <InfoPair label="Donor Name" value={certificate.donorName || 'Full name required'} styles={styles} />
                <View style={styles.infoGridRow}>
                  <View style={styles.infoColumn}>
                    <InfoPair label="Donation Date" value={certificate.donationDateLabel || certificate.issuedAtLabel} styles={styles} />
                  </View>
                  <View style={styles.infoColumn}>
                    <InfoPair label="Length Donated" value={getLengthLabel(certificate)} styles={styles} />
                  </View>
                </View>
                <View style={styles.infoGridRow}>
                  <View style={styles.infoColumn}>
                    <InfoPair label="Hair Condition" value={getConditionLabel(certificate)} chip styles={styles} />
                  </View>
                  <View style={styles.infoColumn}>
                    <InfoPair label="Receiving Organization" value={certificate.organizationName || 'Hair for Hope'} styles={styles} />
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.tabContent}>
              <View style={styles.actionsPanel}>
                <Pressable disabled={isBusy} style={styles.primaryAction} onPress={() => onPrint(certificate)}>
                  <MaterialCommunityIcons name="printer-outline" size={20} color={colors.onPrimary} />
                  <Text style={styles.primaryActionText}>{isBusy ? 'Preparing...' : 'Print'}</Text>
                </Pressable>
                <Pressable
                  disabled={isBusy || !certificate.donorName}
                  style={[styles.secondaryAction, (!certificate.donorName || isBusy) ? styles.disabledAction : null]}
                  onPress={() => onSharePdf(certificate)}
                >
                  <MaterialCommunityIcons name="file-pdf-box" size={20} color={colors.primary} />
                  <Text style={styles.secondaryActionText}>Export to PDF</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function InfoPair({ label, value, chip = false, styles }) {
  return (
    <View style={styles.infoPair}>
      <Text style={styles.infoLabel}>{label}</Text>
      {chip ? (
        <View style={styles.conditionChip}>
          <View style={styles.conditionDot} />
          <Text style={styles.infoValue}>{value}</Text>
        </View>
      ) : (
        <Text style={styles.infoValue}>{value}</Text>
      )}
    </View>
  );
}

function MilestoneBadge({ icon, label, locked = false, colors, styles }) {
  return (
    <View style={[styles.milestoneItem, locked ? styles.lockedMilestone : null]}>
      <View style={[styles.milestoneCircle, locked ? styles.milestoneCircleLocked : null]}>
        <MaterialCommunityIcons name={locked ? 'lock-outline' : icon} size={30} color={locked ? colors.outline : colors.primary} />
      </View>
      <Text style={[styles.milestoneLabel, locked ? styles.lockedText : null]}>{label}</Text>
    </View>
  );
}

function CertificateRow({ item, onView, onOpenStoredFile, colors, styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View certificate for ${item.certificateType || 'donation'}`}
      onPress={() => onView(item)}
      style={({ pressed }) => [
        styles.certificateCard,
        {
          backgroundColor: colors.background,
          borderColor: colors.outlineVariant,
        },
        pressed ? styles.certificateCardPressed : null,
      ]}
    >
      <View style={styles.certificateThumb}>
        <MaterialCommunityIcons name="certificate-outline" size={30} color={colors.primary} />
        <View style={styles.thumbLine} />
        <View style={[styles.thumbLine, styles.thumbLineShort]} />
      </View>

      <View style={styles.cardDetails}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardDate}>{item.issuedAtLabel}</Text>
        </View>

        <View>
          <Text style={styles.cardTitle}>{item.certificateType || 'Certificate of Donation'}</Text>
          <Text style={styles.cardSubtitle}>{item.organizationName || 'Hair for Hope'}</Text>
        </View>

        <View style={styles.cardMetaRow}>
          <View style={styles.cardMetaItem}>
            <Text style={styles.cardMetaLabel}>Length</Text>
            <Text style={styles.cardMetaValue}>{getLengthLabel(item)}</Text>
          </View>
          <View style={[styles.cardMetaItem, styles.cardMetaWide]}>
            <Text style={styles.cardMetaLabel}>Bundle</Text>
            <Text style={styles.cardMetaValue} numberOfLines={1}>{getBundleLabel(item)}</Text>
          </View>
        </View>

        <View style={styles.cardActions}>
          {item.fileUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open stored file"
              onPress={() => onOpenStoredFile(item.fileUrl)}
              style={({ pressed }) => [
                styles.openStoredButton,
                pressed ? styles.linkPressed : null,
              ]}
            >
              <MaterialCommunityIcons name="download-outline" size={16} color={colors.primary} />
              <Text style={styles.openStoredLink}>Stored file</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function DonorAchievementsScreen() {
  const router = useRouter();
  const { certificateId } = useLocalSearchParams();
  const { user, profile, resolvedTheme } = useAuth();
  const colors = useMemo(() => buildCertificateColors(resolvedTheme), [resolvedTheme]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState({
    isLoading: true,
    error: '',
    certificates: [],
    patientHelpedCount: 0,
  });
  const [feedback, setFeedback] = useState(null);
  const [selectedCertificate, setSelectedCertificate] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isSharingAvailable, setIsSharingAvailable] = useState(false);
  const [activeSort, setActiveSort] = useState('recent');
  const [activeAchievementTab, setActiveAchievementTab] = useState('certificates');

  useEffect(() => {
    if (!certificateId || state.isLoading || selectedCertificate) return;

    const requestedId = Array.isArray(certificateId) ? certificateId[0] : certificateId;
    const matchingCertificate = state.certificates.find((item) => (
      String(item.certificateId || item.id || '') === String(requestedId)
    ));

    if (matchingCertificate) {
      setActiveAchievementTab('certificates');
      setSelectedCertificate(matchingCertificate);
    }
  }, [certificateId, selectedCertificate, state.certificates, state.isLoading]);

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      const supported = await isCertificateSharingSupported();
      if (!cancelled) setIsSharingAvailable(supported);
    };

    loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadAchievements = async () => {
      if (!user?.id) {
        setState({
          isLoading: false,
          error: 'Your donor session is not ready yet.',
          certificates: [],
          patientHelpedCount: 0,
        });
        return;
      }

      setState((current) => ({ ...current, isLoading: true, error: '' }));

      await ensureCertificatesForScannedEventDonations(user.id, 24);
      const [certificateResult, submissionsResult] = await Promise.all([
        fetchDonationCertificatesByUserId(user.id, 24),
        fetchHairSubmissionsByUserId(user.id, 24),
      ]);

      if (cancelled) return;

      if (certificateResult.error || submissionsResult.error) {
        setState({
          isLoading: false,
          error: certificateResult.error?.message || submissionsResult.error?.message || 'Unable to load donor achievements right now.',
          certificates: [],
          patientHelpedCount: 0,
        });
        return;
      }

      const donorFullName = buildDonorFullName(profile);
      const submissionsById = Object.fromEntries(
        (submissionsResult.data || []).map((submission) => [submission.submission_id, submission])
      );
      const completedCertificateRows = (certificateResult.data || []).filter((certificate) => (
        isCompletedDonationSubmission(submissionsById[certificate.submission_id])
      ));
      const organizationIds = [
        ...new Set(
          completedCertificateRows
            .map((certificate) => submissionsById[certificate.submission_id]?.organization_id)
            .filter(Boolean)
        ),
      ];

      const organizationResults = await Promise.all(
        organizationIds.map(async (organizationId) => {
          const result = await fetchOrganizationPreview(organizationId, profile?.user_id || null, 1);
          return [organizationId, result.data?.organization || result.data || null];
        })
      );

      if (cancelled) return;

      const organizationsById = Object.fromEntries(organizationResults);
      const certificates = completedCertificateRows.map((certificate) => {
        const linkedSubmission = submissionsById[certificate.submission_id] || null;
        const linkedScreening = Array.isArray(linkedSubmission?.ai_screenings)
          ? linkedSubmission.ai_screenings[0]
          : linkedSubmission?.ai_screenings || null;
        const organizationName = organizationsById[linkedSubmission?.organization_id]?.organization_name || '';
        const model = buildDonorCertificateModel({
          profile: { ...profile, email: user?.email || '' },
          certificateRow: certificate,
          submission: linkedSubmission,
          screening: linkedScreening,
          organizationName,
        });

        return {
          ...model,
          id: model.certificateId || `${certificate.certificate_number}-${certificate.issued_at}`,
          donorName: donorFullName,
          issuedAtLabel: formatDateLabel(certificate.issued_at || linkedSubmission?.created_at || ''),
          statusLabel: certificate.issued_at ? 'Issued' : 'Pending',
        };
      });

      const bundleIds = certificates.map((certificate) => certificate.bundleId).filter(Boolean);
      const patientImpactResult = await fetchDonorPatientImpactByBundleIds(bundleIds);

      if (cancelled) return;

      const patientIds = [
        ...new Set([
          ...(patientImpactResult.data?.patientIds || []),
          ...certificates.map((certificate) => certificate.recipientPatientId).filter(Boolean),
        ]),
      ];

      setState({
        isLoading: false,
        error: '',
        certificates,
        patientHelpedCount: patientIds.length,
      });
    };

    loadAchievements();
    return () => {
      cancelled = true;
    };
  }, [profile, user?.email, user?.id]);

  const certificateRows = useMemo(
    () => sortCertificateRows(state.certificates, activeSort),
    [activeSort, state.certificates]
  );
  const activeSortLabel = SORT_OPTIONS.find((option) => option.key === activeSort)?.label || SORT_OPTIONS[0].label;
  const totalAchievements = state.certificates.length;
  const patientsHelped = state.patientHelpedCount;

  const toggleSort = () => {
    setActiveSort((current) => (current === 'recent' ? 'oldest' : 'recent'));
  };

  const handleNavPress = (item) => {
    if (!item?.route) return;
    router.replace(item.route);
  };

  const handleOpenStoredCertificate = async (url) => {
    if (!url) {
      setFeedback({ type: 'info', title: 'No stored file', message: 'There is no uploaded certificate file for this record yet.' });
      return;
    }

    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }

    setFeedback({ type: 'error', title: 'Cannot open file', message: 'This certificate file could not be opened on this device.' });
  };

  const ensureDonorName = (certificate) => {
    if (!certificate?.donorName) {
      throw new Error('Complete your donor full name in Profile before generating this certificate.');
    }
  };

  const handleSharePdf = async (certificate) => {
    try {
      ensureDonorName(certificate);
      if (!isSharingAvailable) throw new Error('Sharing is not available on this device right now.');
      setIsBusy(true);
      setFeedback(null);
      const file = await generateDonorCertificatePdf(certificate, { colors });
      await shareDonorCertificatePdf(file.uri);
      setFeedback({ type: 'success', title: 'Certificate ready', message: 'Your certificate PDF has been opened in the share sheet.' });
    } catch (error) {
      setFeedback({ type: 'error', title: 'Certificate unavailable', message: error.message || 'Unable to prepare the certificate right now.' });
    } finally {
      setIsBusy(false);
    }
  };

  const handlePrintCertificate = async (certificate) => {
    try {
      ensureDonorName(certificate);
      setIsBusy(true);
      setFeedback(null);
      const html = await buildDonorCertificateHtml(certificate, { colors });
      await Print.printAsync({ html });
      setFeedback({ type: 'success', title: 'Print ready', message: 'The print dialog has been opened for this certificate.' });
    } catch (error) {
      setFeedback({ type: 'error', title: 'Print unavailable', message: error.message || 'Unable to open the print dialog right now.' });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <DashboardLayout
      screenVariant="default"
      hideNav
      navItems={donorDashboardNavItems}
      activeNavKey="profile"
      navVariant="donor"
      onNavPress={handleNavPress}
      header={<AchievementsTopBar title="Achievements" onBack={() => router.back()} styles={styles} />}
    >
      <View style={styles.screen}>
        {feedback ? (
          <StatusBanner
            variant={feedback.type}
            title={feedback.title}
            message={feedback.message}
            dismissible
            onDismiss={() => setFeedback(null)}
          />
        ) : null}

          <View style={styles.impactBanner}>
            <View style={styles.bannerHeader}>
              <MaterialCommunityIcons name="trophy" size={38} color={colors.onPrimary} />
              <Text style={styles.bannerTitle}>Donation Impact</Text>
            </View>
            <View style={styles.statsGrid}>
              <StatBlock value={String(totalAchievements)} label="Achievements" styles={styles} />
              <StatBlock value={String(patientsHelped)} label="Patients Helped" styles={styles} />
            </View>
            <MaterialCommunityIcons name="trophy" size={128} color={colors.bannerWatermark} style={styles.bannerWatermark} />
          </View>

        <View style={[styles.achievementTabs, { borderBottomColor: colors.outlineVariant }]}>
          {ACHIEVEMENT_TABS.map((tab) => {
            const isActive = activeAchievementTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveAchievementTab(tab.key)}
                style={[
                  styles.achievementTab,
                  isActive ? [styles.achievementTabActive, { borderBottomColor: colors.primary }] : null,
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.9}
                  style={[
                    styles.achievementTabText,
                    { color: isActive ? colors.primary : colors.outline },
                  ]}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeAchievementTab === 'certificates' ? (
          <View style={styles.tabPanelStack}>
            <View style={styles.section}>
              <View style={styles.sectionHeadingRow}>
                <SectionTitleRow
                  title="Certificates"
                  icon="file-document-outline"
                  color={colors.onSurface}
                  iconColor={colors.primary}
                  accentColor={colors.primary}
                  titleStyle={styles.sectionTitle}
                />
                <Pressable style={styles.sortPill} onPress={toggleSort}>
                  <Text style={styles.sortText}>{activeSortLabel}</Text>
                  <MaterialCommunityIcons name="chevron-down" size={18} color={colors.onSurfaceVariant} />
                </Pressable>
              </View>
            </View>

            {state.isLoading ? (
              <View style={styles.stateWrap}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.stateText}>Loading donor achievements...</Text>
              </View>
            ) : state.error ? (
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>{state.error}</Text>
              </View>
            ) : certificateRows.length ? (
              <View style={styles.cardsGrid}>
                {certificateRows.map((item) => (
                  <CertificateRow
                    key={String(item.id)}
                    item={item}
                    onView={setSelectedCertificate}
                    onOpenStoredFile={handleOpenStoredCertificate}
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </View>
            ) : (
              <EmptyDataState
                compact
                showCountBadge={false}
                title="No achievements yet"
                message="Your certificates will appear here once available."
                style={styles.emptyState}
              />
            )}
          </View>
        ) : (
          <View style={styles.tabPanelStack}>
            {state.isLoading ? (
              <View style={styles.stateWrap}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.stateText}>Loading donor achievements...</Text>
              </View>
            ) : state.error ? (
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>{state.error}</Text>
              </View>
            ) : (
              <View style={styles.section}>
                <SectionTitleRow
                  title="Milestones"
                  icon="trophy-award"
                  color={colors.onSurface}
                  iconColor={colors.primary}
                  accentColor={colors.primary}
                  titleStyle={styles.sectionTitle}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.milestonesRow}>
                  <MilestoneBadge icon="certificate" label="First Donation" locked={totalAchievements < 1} colors={colors} styles={styles} />
                  <MilestoneBadge icon="star-four-points" label="5 Donations" locked={totalAchievements < 5} colors={colors} styles={styles} />
                  <MilestoneBadge icon="trophy-award" label="10 Donations" locked={totalAchievements < 10} colors={colors} styles={styles} />
                </ScrollView>
              </View>
            )}
          </View>
        )}
      </View>

      <CertificateDetailModal
        certificate={selectedCertificate}
        visible={Boolean(selectedCertificate)}
        isBusy={isBusy}
        colors={colors}
        styles={styles}
        onClose={() => setSelectedCertificate(null)}
        onPrint={handlePrintCertificate}
        onSharePdf={handleSharePdf}
      />
    </DashboardLayout>
  );
}

function StatBlock({ value, label, styles }) {
  return (
    <View style={styles.statBlock}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  screen: {
    gap: 20,
    paddingBottom: 24,
  },
  topBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: '700',
  },
  topBarSpacer: {
    width: 40,
    height: 40,
  },
  achievementTabs: {
    minHeight: 44,
    marginHorizontal: -theme.spacing.md,
    marginTop: -theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
  },
  achievementTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingTop: 4,
    paddingBottom: 8,
    paddingHorizontal: theme.spacing.md,
  },
  achievementTabActive: {
    borderBottomWidth: 2,
  },
  achievementTabText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  impactBanner: {
    position: 'relative',
    overflow: 'hidden',
    gap: 12,
    padding: 18,
    borderRadius: 12,
    backgroundColor: colors.primaryContainer,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  bannerWatermark: {
    position: 'absolute',
    right: -24,
    bottom: -32,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statBlock: {
    flex: 1,
    gap: 2,
  },
  statValue: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  statLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    lineHeight: 15,
    color: colors.statLabel,
  },
  section: {
    gap: 8,
  },
  tabPanelStack: {
    gap: theme.spacing.lg,
  },
  sectionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.onSurface,
  },
  milestonesRow: {
    gap: 12,
    paddingVertical: 6,
  },
  milestoneItem: {
    width: 80,
    alignItems: 'center',
    gap: 8,
  },
  lockedMilestone: {
    opacity: 0.55,
  },
  milestoneCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  milestoneCircleLocked: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.outlineVariant,
    shadowOpacity: 0,
    elevation: 0,
  },
  milestoneLabel: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
  },
  lockedText: {
    color: colors.outline,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surface,
  },
  sortText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    color: colors.onSurface,
  },
  cardsGrid: {
    gap: 14,
  },
  certificateCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  certificateCardPressed: {
    opacity: 0.96,
  },
  certificateThumb: {
    width: 92,
    height: 124,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceLow,
  },
  thumbLine: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    marginTop: 7,
    backgroundColor: colors.outlineVariant,
  },
  thumbLineShort: {
    width: '74%',
    marginTop: 5,
  },
  cardDetails: {
    flex: 1,
    gap: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardDate: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    color: colors.onSurfaceVariant,
  },
  cardTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.onSurface,
  },
  cardSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    lineHeight: 18,
    color: colors.secondary,
  },
  cardMetaRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceHighest,
  },
  cardMetaItem: {
    gap: 2,
  },
  cardMetaWide: {
    flex: 1,
  },
  cardMetaLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.outline,
  },
  cardMetaValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: colors.onSurface,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  openStoredButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  linkPressed: {
    opacity: 0.72,
  },
  openStoredLink: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },
  stateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 48,
  },
  stateText: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 14,
    color: colors.secondary,
  },
  emptyState: {
    gap: 0,
    paddingVertical: 24,
  },
  emptyTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  emptyMessage: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
    color: colors.secondary,
  },
  detailScreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  detailHeader: {
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  detailHeaderCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 0,
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerButtonPressed: {
    opacity: 0.82,
  },
  detailHeaderTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.primary,
  },
  detailContent: {
    gap: 14,
    padding: 16,
    paddingBottom: 36,
  },
  canvasWrap: {
    alignItems: 'center',
  },
  certificateCanvas: {
    position: 'relative',
    width: '100%',
    maxWidth: 800,
    aspectRatio: 1.414,
    overflow: 'hidden',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: colors.gold,
    backgroundColor: colors.surface,
  },
  certificatePattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.08,
    backgroundColor: colors.surfaceLow,
  },
  canvasHeader: {
    width: '100%',
    alignItems: 'center',
    zIndex: 1,
    gap: 2,
  },
  canvasBrand: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    color: colors.primary,
  },
  canvasTitle: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: colors.onSurface,
  },
  goldRule: {
    width: 72,
    height: 2,
    marginTop: 4,
    borderRadius: 2,
    backgroundColor: colors.gold,
  },
  canvasBody: {
    zIndex: 1,
    width: '100%',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
  },
  canvasIntro: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    lineHeight: 14,
    fontStyle: 'italic',
    color: colors.secondary,
  },
  canvasName: {
    width: '100%',
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '800',
    color: colors.primary,
  },
  canvasCopy: {
    maxWidth: 520,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 14,
    color: colors.secondary,
  },
  canvasFooter: {
    zIndex: 1,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  signatureBlock: {
    alignItems: 'center',
  },
  signatureLine: {
    width: 88,
    height: 1,
    marginBottom: 6,
    backgroundColor: colors.outline,
  },
  signatureLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 7,
    lineHeight: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.secondary,
  },
  seal: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  impactCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.background,
  },
  impactIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.impactIconSurface,
  },
  impactCopy: {
    flex: 1,
    gap: 4,
  },
  impactTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
  },
  impactText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    lineHeight: 16,
    color: colors.onSurfaceVariant,
  },
  detailTabs: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 0,
    paddingHorizontal: 4,
    paddingTop: 2,
    borderBottomWidth: 1,
  },
  detailTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 4,
  },
  detailTabActive: {
    borderBottomColor: colors.primary,
  },
  detailTabPressed: {
    opacity: 0.88,
  },
  detailTabText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  detailTabTextActive: {
    fontWeight: '700',
  },
  detailTabIndicator: {
    width: '100%',
    height: 3,
    marginTop: 10,
    borderRadius: 999,
    backgroundColor: 'transparent',
  },
  tabContent: {
    gap: 14,
  },
  infoPanel: {
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.background,
  },
  actionsPanel: {
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.background,
  },
  infoPair: {
    gap: 2,
  },
  infoGridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  infoColumn: {
    flex: 1,
    minWidth: 0,
  },
  infoLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.secondary,
  },
  infoValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    color: colors.onSurface,
  },
  conditionChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.surfaceHigh,
  },
  conditionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  primaryAction: {
    minHeight: 46,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
  },
  primaryActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.onPrimary,
  },
  secondaryAction: {
    minHeight: 46,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  disabledAction: {
    opacity: 0.48,
  },
  secondaryActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.primary,
  },
});
