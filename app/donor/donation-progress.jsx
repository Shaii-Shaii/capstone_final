import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { AppIcon } from '../../src/components/ui/AppIcon';
import { StatusBanner } from '../../src/components/ui/StatusBanner';
import { getEventDonationProgressData } from '../../src/features/donorDonations.service';
import { useAuth } from '../../src/providers/AuthProvider';
import { resolveThemeRoles, theme } from '../../src/design-system/theme';

const STAGE_COPY = {
  cut_and_ship: {
    title: 'Hair received',
    description: 'Staff checked you in and accepted your hair donation.',
    icon: 'hand-heart-outline',
  },
  qa_assessment: {
    title: 'Quality assessment',
    description: 'The organization checks the donated hair before production.',
    icon: 'clipboard-check-outline',
  },
  wig_production: {
    title: 'Wig production',
    description: 'Approved hair is prepared and made into a wig.',
    icon: 'creation-outline',
  },
  assigned_to_patient: {
    title: 'Assigned to a patient',
    description: 'The completed wig is matched with an approved patient.',
    icon: 'account-heart-outline',
  },
  received_by_patient: {
    title: 'Received by the patient',
    description: 'The patient confirms that the wig has been received.',
    icon: 'gift-outline',
  },
};

const ACCESS_MESSAGES = {
  not_registered: {
    title: 'Registration required',
    message: 'Register for the event before opening donation progress.',
    icon: 'calendar-alert',
  },
  attendance_only: {
    title: 'Attendance confirmed',
    message: 'You joined this event as an attendee. Your attendance QR remains available on the event details page; no hair-donation journey is created.',
    icon: 'account-check-outline',
  },
  awaiting_staff_scan: {
    title: 'Show your attendance QR',
    message: 'Your donor place is reserved. Donation progress begins after staff scans your QR and accepts your hair at the event.',
    icon: 'qrcode-scan',
  },
  submission_unavailable: {
    title: 'Donation record unavailable',
    message: 'Your donor RSVP is confirmed, but its linked donation record could not be found. Please ask event staff for assistance.',
    icon: 'database-alert-outline',
  },
};

const normalizeStageState = (value = '') => {
  const state = String(value || '').trim().toLowerCase();
  if (state === 'completed') return 'completed';
  if (state === 'current' || state === 'attention') return 'current';
  return 'upcoming';
};

const getStatusLabel = (stage) => {
  const state = normalizeStageState(stage?.state);
  if (state === 'completed') return 'Complete';
  if (state === 'current') return 'In progress';
  return 'Waiting';
};

function ProgressHeader({ onBack, roles }) {
  return (
    <LinearGradient
      colors={[theme.colors.palette.wine900, roles.primaryActionBackground, theme.colors.palette.wine700]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.header}
    >
      <View pointerEvents="none" style={styles.headerGlow} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={({ pressed }) => [styles.headerButton, pressed ? styles.pressed : null]}
      >
        <AppIcon name="arrowLeft" state="inverse" color={roles.primaryActionText} />
      </Pressable>
      <View style={styles.headerCopy}>
        <Text style={[styles.headerEyebrow, { color: roles.primaryActionText }]}>DONATION JOURNEY</Text>
        <Text style={[styles.headerTitle, { color: roles.primaryActionText }]}>Donation Progress</Text>
      </View>
      <View style={styles.headerSpacer} />
    </LinearGradient>
  );
}

function TimelineStep({ stage, index, total, roles }) {
  const entrance = React.useRef(new Animated.Value(0)).current;
  const pulse = React.useRef(new Animated.Value(1)).current;
  const state = normalizeStageState(stage?.state);
  const isCompleted = state === 'completed';
  const isCurrent = state === 'current';
  const fallback = STAGE_COPY[stage?.key] || {};
  const title = fallback.title || stage?.label || stage?.title || `Step ${index + 1}`;
  const savedDescription = String(stage?.savedNote || stage?.description || '').trim();
  const description = savedDescription || fallback.description || 'Updates will appear when the organization reaches this step.';
  const iconName = fallback.icon || 'progress-clock';

  React.useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: theme.motion.cardEnter,
      delay: index * theme.motion.stagger,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance, index]);

  React.useEffect(() => {
    if (!isCurrent) {
      pulse.setValue(1);
      return undefined;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.14, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 850, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [isCurrent, pulse]);

  const markerBackground = isCompleted
    ? roles.primaryActionBackground
    : isCurrent
      ? roles.iconPrimarySurface
      : roles.defaultCardBackground;
  const markerColor = isCompleted
    ? roles.primaryActionText
    : isCurrent
      ? roles.primaryActionBackground
      : roles.metaText;

  return (
    <Animated.View
      style={[
        styles.timelineRow,
        {
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        },
      ]}
    >
      <View style={styles.markerColumn}>
        <Animated.View
          style={[
            styles.marker,
            {
              backgroundColor: markerBackground,
              borderColor: isCompleted || isCurrent ? roles.primaryActionBackground : roles.defaultCardBorder,
              transform: [{ scale: pulse }],
            },
          ]}
        >
          <MaterialCommunityIcons
            name={isCompleted ? 'check' : isCurrent ? 'progress-clock' : 'clock-outline'}
            size={15}
            color={markerColor}
          />
        </Animated.View>
        {index < total - 1 ? (
          <View
            style={[
              styles.connector,
              { backgroundColor: isCompleted ? roles.primaryActionBackground : roles.defaultCardBorder },
            ]}
          />
        ) : null}
      </View>

      <View
        style={[
          styles.stageCard,
          {
            backgroundColor: isCurrent ? roles.iconPrimarySurface : roles.defaultCardBackground,
            borderColor: isCurrent ? roles.primaryActionBackground : roles.defaultCardBorder,
          },
        ]}
      >
        <View style={styles.stageHeader}>
          <View style={[styles.stageIcon, { backgroundColor: isCurrent ? roles.defaultCardBackground : roles.iconPrimarySurface }]}>
            <MaterialCommunityIcons name={iconName} size={19} color={roles.primaryActionBackground} />
          </View>
          <View style={styles.stageTitleCopy}>
            <Text style={[styles.stageStep, { color: roles.metaText }]}>STEP {index + 1} OF {total}</Text>
            <Text style={[styles.stageTitle, { color: roles.headingText }]}>{title}</Text>
          </View>
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: isCompleted ? roles.badgeStrongBackground : roles.supportCardBackground,
                borderColor: isCurrent ? roles.primaryActionBackground : roles.defaultCardBorder,
              },
            ]}
          >
            <Text style={[styles.statusText, { color: isCompleted ? roles.badgeStrongText : roles.bodyText }]}>
              {getStatusLabel(stage)}
            </Text>
          </View>
        </View>
        <Text style={[styles.stageDescription, { color: roles.bodyText }]}>{description}</Text>
        {stage?.timestampLabel ? (
          <View style={styles.timestampRow}>
            <MaterialCommunityIcons name="clock-check-outline" size={14} color={roles.metaText} />
            <Text style={[styles.timestampText, { color: roles.metaText }]}>{stage.timestampLabel}</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

export default function DonorEventDonationProgressScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const driveIdParam = Array.isArray(params.driveId) ? params.driveId[0] : params.driveId;
  const driveId = Number(driveIdParam);
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const insets = useSafeAreaInsets();
  const [progressData, setProgressData] = React.useState(null);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const heroEntrance = React.useRef(new Animated.Value(0)).current;

  const loadProgress = React.useCallback(async ({ refreshing = false } = {}) => {
    if (!Number.isFinite(driveId) || driveId <= 0) {
      setErrorMessage('Donation progress could not be opened because the event is missing.');
      setIsLoading(false);
      return;
    }

    if (refreshing) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage('');

    const result = await getEventDonationProgressData({
      userId: user?.id || null,
      databaseUserId: profile?.user_id || null,
      driveId,
    });

    setProgressData(result.data || null);
    if (result.error) setErrorMessage(result.error.message || 'Donation progress could not be loaded.');
    setIsLoading(false);
    setIsRefreshing(false);
  }, [driveId, profile?.user_id, user?.id]);

  useFocusEffect(React.useCallback(() => {
    void loadProgress();
  }, [loadProgress]));

  React.useEffect(() => {
    if (!progressData?.canTrack) return;
    heroEntrance.setValue(0);
    Animated.spring(heroEntrance, {
      toValue: 1,
      damping: theme.motion.spring.damping,
      stiffness: theme.motion.spring.stiffness,
      mass: theme.motion.spring.mass,
      useNativeDriver: true,
    }).start();
  }, [heroEntrance, progressData?.canTrack]);

  const handleBackToEvent = React.useCallback(() => {
    if (router.canGoBack?.()) {
      router.back();
      return;
    }
    if (Number.isFinite(driveId) && driveId > 0) {
      router.replace(`/donor/drives/${driveId}`);
      return;
    }
    router.replace('/donor/home');
  }, [driveId, router]);

  const stages = progressData?.timelineStages || [];
  const completedCount = stages.filter((stage) => normalizeStageState(stage?.state) === 'completed').length;
  const currentCount = stages.some((stage) => normalizeStageState(stage?.state) === 'current') ? 0.5 : 0;
  const progressPercent = stages.length ? Math.min(100, Math.round(((completedCount + currentCount) / stages.length) * 100)) : 0;
  const accessMessage = ACCESS_MESSAGES[progressData?.reason] || ACCESS_MESSAGES.submission_unavailable;
  const eventTitle = progressData?.drive?.event_title || 'Donation event';
  const reference = progressData?.submission?.donation_reference || `Event #${driveId || ''}`;

  return (
    <ScreenContainer
      scrollable={false}
      safeArea
      contentStyle={[styles.screenContent, { backgroundColor: roles.pageBackground }]}
    >
      <ProgressHeader onBack={handleBackToEvent} roles={roles} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: theme.spacing.xxl + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => loadProgress({ refreshing: true })}
            colors={[roles.primaryActionBackground]}
            tintColor={roles.primaryActionBackground}
          />
        )}
      >
        {errorMessage ? (
          <StatusBanner
            message={errorMessage}
            variant="error"
            presentation="floating"
            visible
            onDismiss={() => setErrorMessage('')}
          />
        ) : null}

        {isLoading ? (
          <View style={styles.loadingState}>
            <View style={[styles.loadingIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <ActivityIndicator color={roles.primaryActionBackground} />
            </View>
            <Text style={[styles.loadingTitle, { color: roles.headingText }]}>Loading your journey</Text>
            <Text style={[styles.loadingSubtitle, { color: roles.bodyText }]}>Checking the latest organization updates.</Text>
          </View>
        ) : !progressData?.canTrack ? (
          <View style={[styles.accessCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <View style={[styles.accessIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <MaterialCommunityIcons name={accessMessage.icon} size={30} color={roles.primaryActionBackground} />
            </View>
            <Text style={[styles.accessTitle, { color: roles.headingText }]}>{accessMessage.title}</Text>
            <Text style={[styles.accessMessage, { color: roles.bodyText }]}>{accessMessage.message}</Text>
            <Pressable
              onPress={handleBackToEvent}
              accessibilityRole="button"
              accessibilityLabel="Return to event details"
              style={({ pressed }) => [
                styles.eventButton,
                { backgroundColor: roles.primaryActionBackground },
                pressed ? styles.pressed : null,
              ]}
            >
              <MaterialCommunityIcons name="calendar-arrow-left" size={19} color={roles.primaryActionText} />
              <Text style={[styles.eventButtonText, { color: roles.primaryActionText }]}>Back to event details</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Animated.View
              style={{
                opacity: heroEntrance,
                transform: [
                  { translateY: heroEntrance.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
                  { scale: heroEntrance.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
                ],
              }}
            >
              <LinearGradient
                colors={[theme.colors.palette.wine900, roles.primaryActionBackground, theme.colors.palette.wine700]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCard}
              >
                <View pointerEvents="none" style={styles.heroGlowLarge} />
                <View pointerEvents="none" style={styles.heroGlowSmall} />
                <View style={styles.heroTopRow}>
                  <View style={styles.heroIcon}>
                    <MaterialCommunityIcons name="timeline-check-outline" size={27} color={roles.primaryActionText} />
                  </View>
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={[styles.liveText, { color: roles.primaryActionText }]}>LIVE UPDATES</Text>
                  </View>
                </View>
                <Text style={[styles.heroEyebrow, { color: roles.primaryActionText }]}>YOUR HAIR DONATION</Text>
                <Text style={[styles.heroTitle, { color: roles.primaryActionText }]}>Making its way to someone</Text>
                <Text style={[styles.heroSubtitle, { color: roles.primaryActionText }]}>
                  Follow each milestone as the organization turns your donation into care.
                </Text>
                <View style={styles.heroEventRow}>
                  <MaterialCommunityIcons name="calendar-heart" size={16} color={roles.primaryActionText} />
                  <Text numberOfLines={1} style={[styles.heroEventText, { color: roles.primaryActionText }]}>{eventTitle}</Text>
                </View>
              </LinearGradient>
            </Animated.View>

            <View style={[styles.overviewCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
              <View style={styles.overviewHeader}>
                <View>
                  <Text style={[styles.overviewEyebrow, { color: roles.metaText }]}>OVERALL PROGRESS</Text>
                  <Text style={[styles.overviewValue, { color: roles.headingText }]}>{progressPercent}% complete</Text>
                </View>
                <View style={[styles.referencePill, { backgroundColor: roles.supportCardBackground }]}>
                  <Text numberOfLines={1} style={[styles.referenceText, { color: roles.bodyText }]}>{reference}</Text>
                </View>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: roles.supportCardBackground }]}>
                <LinearGradient
                  colors={[theme.colors.palette.wine700, roles.primaryActionBackground]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[styles.progressFill, { width: `${Math.max(progressPercent, 4)}%` }]}
                />
              </View>
              <Text style={[styles.overviewHelper, { color: roles.bodyText }]}>Pull down anytime to check for new updates.</Text>
            </View>

            <View style={styles.timelineHeadingRow}>
              <View>
                <Text style={[styles.sectionEyebrow, { color: roles.primaryActionBackground }]}>JOURNEY TIMELINE</Text>
                <Text style={[styles.sectionTitle, { color: roles.headingText }]}>Where your donation is now</Text>
              </View>
              <View style={[styles.stepCountPill, { backgroundColor: roles.iconPrimarySurface }]}>
                <Text style={[styles.stepCountText, { color: roles.primaryActionBackground }]}>{completedCount}/{stages.length}</Text>
              </View>
            </View>

            <View style={styles.timelineList}>
              {stages.map((stage, index) => (
                <TimelineStep
                  key={stage.key || `${stage.label}-${index}`}
                  stage={stage}
                  index={index}
                  total={stages.length}
                  roles={roles}
                />
              ))}
            </View>

            <View style={[styles.supportNote, { backgroundColor: roles.supportCardBackground, borderColor: roles.defaultCardBorder }]}>
              <MaterialCommunityIcons name="information-outline" size={19} color={roles.primaryActionBackground} />
              <Text style={[styles.supportNoteText, { color: roles.bodyText }]}>Updates are recorded by authorized staff. Some stages may take time while the donated hair is reviewed and prepared.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  header: {
    minHeight: 68,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    overflow: 'hidden',
    ...theme.shadows.sm,
  },
  headerGlow: {
    position: 'absolute', width: 150, height: 150, borderRadius: 75,
    right: -48, top: -94, backgroundColor: 'rgba(255,255,255,0.09)',
  },
  headerButton: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  headerCopy: { flex: 1, alignItems: 'center', gap: 1 },
  headerEyebrow: { fontFamily: theme.typography.fontFamily, fontSize: 8, fontWeight: theme.typography.weights.bold, letterSpacing: 1.2, opacity: 0.72 },
  headerTitle: { fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.semantic.body, fontWeight: theme.typography.weights.bold },
  headerSpacer: { width: 42 },
  scroll: { flex: 1 },
  content: { padding: theme.spacing.md, gap: theme.spacing.lg },
  pressed: { opacity: 0.86, transform: [{ scale: 0.985 }] },
  loadingState: { minHeight: 420, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.sm },
  loadingIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.xs },
  loadingTitle: { fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.semantic.titleSm, fontWeight: theme.typography.weights.bold },
  loadingSubtitle: { fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.bodySm, textAlign: 'center' },
  accessCard: { marginTop: theme.spacing.xl, borderWidth: 1, borderRadius: theme.radius.xl, padding: theme.spacing.xl, alignItems: 'center', gap: theme.spacing.sm, ...theme.shadows.card },
  accessIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing.xs },
  accessTitle: { fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.semantic.titleSm, fontWeight: theme.typography.weights.bold, textAlign: 'center' },
  accessMessage: { fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.bodySm, lineHeight: 21, textAlign: 'center' },
  eventButton: { minHeight: 50, borderRadius: theme.radius.pill, marginTop: theme.spacing.md, paddingHorizontal: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm, alignSelf: 'stretch', ...theme.shadows.soft },
  eventButtonText: { fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.bodySm, fontWeight: theme.typography.weights.bold },
  heroCard: { minHeight: 248, borderRadius: 28, padding: theme.spacing.xl, overflow: 'hidden', ...theme.shadows.card },
  heroGlowLarge: { position: 'absolute', width: 210, height: 210, borderRadius: 105, right: -72, top: -104, backgroundColor: 'rgba(255,255,255,0.09)' },
  heroGlowSmall: { position: 'absolute', width: 130, height: 130, borderRadius: 65, left: -68, bottom: -78, backgroundColor: 'rgba(255,255,255,0.06)' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.lg },
  heroIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)' },
  livePill: { minHeight: 30, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#F8D7DD' },
  liveText: { fontFamily: theme.typography.fontFamily, fontSize: 8, fontWeight: theme.typography.weights.bold, letterSpacing: 1 },
  heroEyebrow: { fontFamily: theme.typography.fontFamily, fontSize: 9, fontWeight: theme.typography.weights.bold, letterSpacing: 1.3, opacity: 0.75, marginBottom: 6 },
  heroTitle: { maxWidth: 280, fontFamily: theme.typography.fontFamilyDisplay, fontSize: 25, lineHeight: 30, fontWeight: theme.typography.weights.bold },
  heroSubtitle: { maxWidth: 290, fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.bodySm, lineHeight: 20, opacity: 0.88, marginTop: 7 },
  heroEventRow: { marginTop: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroEventText: { flex: 1, fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.caption, fontWeight: theme.typography.weights.semibold, opacity: 0.92 },
  overviewCard: { borderWidth: 1, borderRadius: theme.radius.xl, padding: theme.spacing.lg, gap: theme.spacing.md, ...theme.shadows.soft },
  overviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm },
  overviewEyebrow: { fontFamily: theme.typography.fontFamily, fontSize: 8, fontWeight: theme.typography.weights.bold, letterSpacing: 1.1 },
  overviewValue: { fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.semantic.body, fontWeight: theme.typography.weights.bold, marginTop: 2 },
  referencePill: { maxWidth: 128, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.sm, paddingVertical: 6 },
  referenceText: { fontFamily: theme.typography.fontFamily, fontSize: 9, fontWeight: theme.typography.weights.semibold },
  progressTrack: { height: 9, borderRadius: theme.radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: theme.radius.pill },
  overviewHelper: { fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.caption },
  timelineHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.spacing.md, marginTop: theme.spacing.xs },
  sectionEyebrow: { fontFamily: theme.typography.fontFamily, fontSize: 9, fontWeight: theme.typography.weights.bold, letterSpacing: 1.2, marginBottom: 3 },
  sectionTitle: { fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.semantic.titleSm, fontWeight: theme.typography.weights.bold },
  stepCountPill: { minWidth: 44, height: 30, borderRadius: 15, paddingHorizontal: theme.spacing.sm, alignItems: 'center', justifyContent: 'center' },
  stepCountText: { fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.caption, fontWeight: theme.typography.weights.bold },
  timelineList: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch' },
  markerColumn: { width: 42, alignItems: 'center' },
  marker: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  connector: { width: 2, flex: 1, minHeight: 88 },
  stageCard: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: theme.radius.xl, padding: theme.spacing.md, marginBottom: theme.spacing.md, gap: theme.spacing.sm, ...theme.shadows.soft },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  stageIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stageTitleCopy: { flex: 1, minWidth: 0, gap: 1 },
  stageStep: { fontFamily: theme.typography.fontFamily, fontSize: 8, fontWeight: theme.typography.weights.bold, letterSpacing: 0.8 },
  stageTitle: { fontFamily: theme.typography.fontFamilyDisplay, fontSize: theme.typography.compact.bodySm, fontWeight: theme.typography.weights.bold },
  statusPill: { borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5, flexShrink: 0 },
  statusText: { fontFamily: theme.typography.fontFamily, fontSize: 8, fontWeight: theme.typography.weights.bold },
  stageDescription: { fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.caption, lineHeight: 18 },
  timestampRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timestampText: { flex: 1, fontFamily: theme.typography.fontFamily, fontSize: 9 },
  supportNote: { borderWidth: 1, borderRadius: theme.radius.lg, padding: theme.spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
  supportNoteText: { flex: 1, fontFamily: theme.typography.fontFamily, fontSize: theme.typography.compact.caption, lineHeight: 18 },
});
