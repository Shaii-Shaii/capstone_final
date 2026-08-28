import React from 'react';
import { Animated, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { AppCard } from '../../src/components/ui/AppCard';
import { DonorHairSubmissionScreen } from '../../src/components/layout/DonorHairSubmissionScreen';
import { DashboardLayout } from '../../src/components/layout/DashboardLayout';
import { DonorTabHeader } from '../../src/components/donor/DonorTabHeader';
import { AppIcon } from '../../src/components/ui/AppIcon';
import { GradientActionButton } from '../../src/components/ui/GradientActionButton';
import { EmptyDataState } from '../../src/components/ui/EmptyDataState';
import { DonivraLoadingOverlay } from '../../src/components/ui/DonivraLoadingOverlay';
import { donorDashboardNavItems } from '../../src/constants/dashboard';
import {
  fetchHairSubmissionsByUserId,
  fetchLatestDonationRequirement,
} from '../../src/features/hairSubmission.api';
import { evaluateAiDonationEligibility } from '../../src/features/donorDonations.service';
import {
  getCachedHairAnalysisHomeData,
  setCachedHairAnalysisHomeData,
} from '../../src/features/hairAnalysisHomeCache';
import { buildProfileCompletionMeta } from '../../src/features/profile/services/profile.service';
import {
  getCanonicalHairAssessment,
  getHairScreeningMood,
  getScreeningEntriesNewestFirst,
} from '../../src/features/hairScreeningPresentation';
import { useNotifications } from '../../src/hooks/useNotifications';
import { useAuth } from '../../src/providers/AuthProvider';
import { resolveThemeRoles, theme } from '../../src/design-system/theme';
import hairAnalysisAiIcon from '../../src/assets/images/hair-analysis-ai-icon.png';

const HAIR_CALENDAR_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toLocalDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getWeekRangeLabel = (date) => {
  const current = new Date(date);
  const day = current.getDay();
  const start = new Date(current);
  start.setDate(current.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const formatter = new Intl.DateTimeFormat('en-US', { day: 'numeric' });
  return `${formatter.format(start)}-${formatter.format(end)}`;
};

const clampLevel = (value, fallback = 5) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(10, parsed));
};

const inferLevelsFromCondition = (condition = '') => {
  const normalized = String(condition || '').toLowerCase();

  if (normalized.includes('healthy') || normalized.includes('good')) {
    return { shine: 8, frizz: 2, dryness: 2, oiliness: 2, damage: 1 };
  }

  if (normalized.includes('dry') || normalized.includes('damaged')) {
    return { shine: 3, frizz: 7, dryness: 8, oiliness: 2, damage: 8 };
  }

  if (normalized.includes('oily')) {
    return { shine: 6, frizz: 3, dryness: 2, oiliness: 8, damage: 3 };
  }

  return { shine: 5, frizz: 4, dryness: 4, oiliness: 4, damage: 4 };
};

const getLengthLabel = (screening = null) => {
  const cm = Number(screening?.estimated_length);
  if (!Number.isFinite(cm) || cm <= 0) return 'N/A';
  const inches = cm / 2.54;
  return `${inches.toFixed(1)}"`;
};

const getMoistureLabel = (screening = null) => {
  if (!screening) return 'Unknown';
  const inferred = inferLevelsFromCondition(screening.detected_condition);
  const dryness = clampLevel(screening.dryness_level, inferred.dryness);
  const oiliness = clampLevel(screening.oiliness_level, inferred.oiliness);
  const moistureBalance = 10 - Math.abs(dryness - oiliness);
  if (moistureBalance >= 7) return 'Balanced';
  if (moistureBalance >= 4) return 'Medium';
  return 'Low';
};

const formatRecentLogDate = (value) => {
  if (!value) return 'No date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
};

const WEEKLY_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function HairConditionSummaryCard({ entry, eligibility = null, onPress }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);

  if (!entry) return null;

  const mood = getHairScreeningMood(entry);
  const isEligible = Boolean(eligibility?.isQualified);
  const conditionLabel = isEligible ? 'Eligible for donation' : 'Not eligible for donation yet';
  const currentLengthCm = Number(eligibility?.normalized_length_cm);
  const minimumLengthCm = Number(eligibility?.minimum_length_cm);
  const eligibilityNote = !isEligible
    && Number.isFinite(currentLengthCm)
    && Number.isFinite(minimumLengthCm)
    && currentLengthCm > 0
    && minimumLengthCm > 0
    && currentLengthCm < minimumLengthCm
    ? `${(currentLengthCm / 2.54).toFixed(1)} in measured · ${Math.round(minimumLengthCm / 2.54)} in required`
    : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open hair check details for ${formatRecentLogDate(entry.created_at)}`}
      onPress={onPress}
      style={({ pressed }) => [pressed ? styles.cardPressed : null]}
    >
      <AppCard
        variant="outline"
        radius="md"
        padding="md"
        style={[
          styles.hairConditionCard,
          {
            borderColor: roles.defaultCardBorder,
            backgroundColor: roles.defaultCardBackground,
          },
        ]}
      >
        <Text style={[styles.hairConditionTitle, { color: roles.headingText }]}>
          {conditionLabel}
        </Text>
        {eligibilityNote ? (
          <Text style={[styles.hairConditionEligibilityNote, { color: roles.metaText }]}>
            {eligibilityNote}
          </Text>
        ) : null}

        <View style={styles.hairConditionMetaRow}>
          <Text style={[styles.hairConditionDate, { color: roles.metaText }]}>
            {formatRecentLogDate(entry.created_at)}
          </Text>
          <View style={[styles.hairConditionMoodInline, { backgroundColor: mood.surface }]}>
            <MaterialCommunityIcons name={mood.icon} size={16} color={mood.color} />
            <Text style={[styles.hairConditionMoodInlineText, { color: mood.color }]}>{mood.label}</Text>
          </View>
        </View>

        <View style={[styles.hairConditionDivider, { backgroundColor: roles.defaultCardBorder }]} />

        <View style={styles.hairConditionFooter}>
          <View style={styles.hairConditionActionCopy}>
            <Text style={[styles.hairConditionViewLabel, { color: roles.headingText }]}>View details</Text>
            <Text style={[styles.hairConditionStatusText, { color: roles.metaText }]}>
              {isEligible ? 'Eligible' : 'Review requirements'}
            </Text>
          </View>
          <AppIcon name="chevronRight" size="sm" state="muted" color={roles.metaText} />
        </View>
      </AppCard>
    </Pressable>
  );
}

const getMonthLabel = (date) => (
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date)
);

const buildHairCalendarCells = (cursorDate, markedDateKeys = new Set(), selectedDateKey = '') => {
  const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = toLocalDateKey(date);
    return {
      key,
      date,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === cursorDate.getMonth(),
      isToday: key === toLocalDateKey(new Date()),
      isSelected: key === selectedDateKey,
      hasLog: markedDateKeys.has(key),
    };
  });
};

const buildHairWeekCells = (cursorDate, markedDateKeys = new Set(), selectedDateKey = '') => {
  const weekStart = new Date(cursorDate);
  weekStart.setHours(12, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const key = toLocalDateKey(date);
    return {
      key,
      date,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === cursorDate.getMonth(),
      isToday: key === toLocalDateKey(new Date()),
      isSelected: key === selectedDateKey,
      hasLog: markedDateKeys.has(key),
    };
  });
};

const getCalendarWeekLabel = (date) => {
  const week = buildHairWeekCells(date);
  const first = week[0]?.date;
  const last = week[6]?.date;
  if (!first || !last) return 'This week';

  const sameMonth = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  const firstLabel = new Intl.DateTimeFormat('en-US', sameMonth
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: first.getFullYear() !== last.getFullYear() ? 'numeric' : undefined }).format(first);
  const lastLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(last);
  return `${firstLabel} - ${lastLabel}`;
};

function HairAnalysisFloatingButton({ title, icon, onPress, showHairAnalysisIcon = false }) {
  const entrance = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.spring(entrance, {
      toValue: 1,
      damping: 15,
      stiffness: 190,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  return (
    <Animated.View
      style={[
        styles.analysisFabPosition,
        {
          opacity: entrance,
          transform: [{
            translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
          }],
        },
      ]}
    >
      <View style={styles.analysisFabSurface}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={onPress}
          style={({ pressed }) => [styles.analysisFabButton, pressed ? styles.analysisFabPressed : null]}
        >
          <View style={styles.analysisFabIconWrap}>
            {showHairAnalysisIcon ? (
              <Image source={hairAnalysisAiIcon} style={styles.analysisFabIconImage} resizeMode="contain" />
            ) : (
              <AppIcon name={icon} color={theme.colors.dashboardDonorFrom} size="sm" />
            )}
          </View>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.88}
            style={styles.analysisFabText}
          >
            {title}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

function HairAnalysisHomeModule() {
  const router = useRouter();
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const cachedHome = getCachedHairAnalysisHomeData(user?.id);
  const cacheMatchesUser = Boolean(cachedHome);
  const submissionsRef = React.useRef(cachedHome?.submissions || []);
  const [isLoading, setIsLoading] = React.useState(!cacheMatchesUser);
  const [error, setError] = React.useState('');
  const [submissions, setSubmissions] = React.useState(cachedHome?.submissions || []);
  const [donationRequirement, setDonationRequirement] = React.useState(cachedHome?.donationRequirement || null);
  const [isFirstCheckPromptVisible, setIsFirstCheckPromptVisible] = React.useState(false);
  const [isProfileCompletionPromptVisible, setIsProfileCompletionPromptVisible] = React.useState(false);
  const [firstCheckPromptDismissed, setFirstCheckPromptDismissed] = React.useState(false);
  const [calendarMode, setCalendarMode] = React.useState('week');
  const [calendarCursor, setCalendarCursor] = React.useState(() => new Date());
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = React.useState(() => toLocalDateKey(new Date()));
  const calendarTransition = React.useRef(new Animated.Value(1)).current;
  const analysisLoadRequestRef = React.useRef(0);

  const { unreadCount } = useNotifications({
    role: 'donor',
    userId: user?.id,
    userEmail: user?.email || '',
    mode: 'badge',
    liveUpdates: true,
  });

  const profileCompletionMeta = React.useMemo(() => buildProfileCompletionMeta({
    photo_path: profile?.photo_path || profile?.avatar_url || '',
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    birthdate: profile?.birthdate || '',
    gender: profile?.gender || '',
    contact_number: profile?.contact_number || profile?.phone || '',
    street: profile?.street || '',
    barangay: profile?.barangay || '',
    city: profile?.city || '',
    province: profile?.province || '',
    region: profile?.region || '',
    country: profile?.country || 'Philippines',
  }), [
    profile?.avatar_url,
    profile?.barangay,
    profile?.birthdate,
    profile?.city,
    profile?.contact_number,
    profile?.country,
    profile?.first_name,
    profile?.gender,
    profile?.last_name,
    profile?.phone,
    profile?.photo_path,
    profile?.province,
    profile?.region,
    profile?.street,
  ]);

  const loadAnalysisHomeData = React.useCallback(async () => {
    const requestId = analysisLoadRequestRef.current + 1;
    analysisLoadRequestRef.current = requestId;

    if (!user?.id) {
      setSubmissions([]);
      setIsLoading(false);
      return;
    }

    if (!submissionsRef.current.length) setIsLoading(true);
    setError('');
    const [result, requirementResult] = await Promise.all([
      fetchHairSubmissionsByUserId(user.id, 30),
      fetchLatestDonationRequirement(),
    ]);

    if (analysisLoadRequestRef.current !== requestId) return;

    if (result.error) {
      setError(result.error.message || 'Could not load hair analysis history.');
    }

    const normalized = Array.isArray(result.data) ? result.data : [];
    const nextDonationRequirement = requirementResult.data || null;
    setCachedHairAnalysisHomeData(user.id, { submissions: normalized, donationRequirement: nextDonationRequirement });
    submissionsRef.current = normalized;
    setSubmissions(normalized);
    setDonationRequirement(nextDonationRequirement);
    setIsLoading(false);
  }, [user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      void loadAnalysisHomeData();
      return () => {
        analysisLoadRequestRef.current += 1;
      };
    }, [loadAnalysisHomeData])
  );

  const screenings = React.useMemo(() => (
    getScreeningEntriesNewestFirst(submissions).map(({ submission, screening }) => ({
      ...screening,
      submission,
    }))
  ), [submissions]);

  const latestScreening = screenings[0] || null;
  const latestEligibility = React.useMemo(() => {
    if (!latestScreening) return null;
    const details = Array.isArray(latestScreening?.submission?.submission_details)
      ? latestScreening.submission.submission_details
      : [];
    const latestDetail = [...details].sort(
      (left, right) => new Date(right?.created_at || 0) - new Date(left?.created_at || 0)
    )[0] || null;
    return evaluateAiDonationEligibility({
      screening: latestScreening,
      detail: latestDetail,
      donationRequirement,
    });
  }, [donationRequirement, latestScreening]);
  const recentLogs = React.useMemo(() => screenings.slice(0, 5), [screenings]);
  const olderLogs = React.useMemo(() => recentLogs.slice(1), [recentLogs]);
  const hasRecentLogs = recentLogs.length > 0;
  const screeningsByDate = React.useMemo(() => {
    const grouped = new Map();
    screenings.forEach((entry) => {
      const key = toLocalDateKey(entry.created_at);
      if (!key) return;
      const rows = grouped.get(key) || [];
      rows.push(entry);
      grouped.set(key, rows);
    });
    return grouped;
  }, [screenings]);
  const calendarDateKeys = React.useMemo(() => new Set(screeningsByDate.keys()), [screeningsByDate]);
  const monthCalendarCells = React.useMemo(
    () => buildHairCalendarCells(calendarCursor, calendarDateKeys, selectedCalendarDateKey),
    [calendarCursor, calendarDateKeys, selectedCalendarDateKey]
  );
  const monthCalendarRows = React.useMemo(() => {
    const rows = [];
    for (let index = 0; index < monthCalendarCells.length; index += 7) {
      rows.push(monthCalendarCells.slice(index, index + 7));
    }
    return rows;
  }, [monthCalendarCells]);
  const weekCalendarCells = React.useMemo(
    () => buildHairWeekCells(calendarCursor, calendarDateKeys, selectedCalendarDateKey),
    [calendarCursor, calendarDateKeys, selectedCalendarDateKey]
  );
  const calendarRows = calendarMode === 'week' ? [weekCalendarCells] : monthCalendarRows;
  const calendarPeriodLabel = calendarMode === 'week'
    ? getCalendarWeekLabel(calendarCursor)
    : getMonthLabel(calendarCursor);
  const isProfileComplete = profileCompletionMeta.isComplete;
  const isFirstHairCheck = screenings.length === 0;
  const latestScreeningAtMs = latestScreening?.created_at ? new Date(latestScreening.created_at).getTime() : NaN;
  const isWeeklyScanLocked = Number.isFinite(latestScreeningAtMs)
    ? Date.now() < (latestScreeningAtMs + WEEKLY_SCAN_INTERVAL_MS)
    : false;

  const latestAssessment = React.useMemo(
    () => getCanonicalHairAssessment(latestScreening),
    [latestScreening]
  );
  const latestMood = React.useMemo(
    () => getHairScreeningMood(latestScreening),
    [latestScreening]
  );
  const todayCondition = latestAssessment.label;
  const lengthLabel = getLengthLabel(latestScreening);
  const textureLabel = latestScreening?.detected_texture || 'N/A';
  const scalpLabel = latestScreening ? todayCondition : 'N/A';
  const moistureLabel = getMoistureLabel(latestScreening);
  const healthRangeLabel = latestScreening ? `Week ${getWeekRangeLabel(new Date(latestScreening.created_at))}` : '';

  const animateCalendarChange = React.useCallback((applyChange) => {
    calendarTransition.stopAnimation();
    Animated.timing(calendarTransition, {
      toValue: 0,
      duration: 90,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      applyChange();
      calendarTransition.setValue(0.72);
      Animated.spring(calendarTransition, {
        toValue: 1,
        damping: 18,
        stiffness: 220,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    });
  }, [calendarTransition]);

  const moveCalendar = (direction) => {
    animateCalendarChange(() => {
      setCalendarCursor((previous) => {
        const next = new Date(previous);
        if (calendarMode === 'week') {
          next.setDate(previous.getDate() + (direction * 7));
        } else {
          next.setMonth(previous.getMonth() + direction, 1);
        }
        return next;
      });
    });
  };

  const handleStartAnalysis = () => {
    router.push('/donor/donations?mode=scan');
  };

  const handlePrimaryAction = () => {
    if (!isProfileComplete) {
      setIsProfileCompletionPromptVisible(true);
      return;
    }
    if (isWeeklyScanLocked && latestScreening) {
      openLogDetailsForEntry(latestScreening);
      return;
    }
    handleStartAnalysis();
  };

  const handleNavPress = (item) => {
    if (!item?.route) return;
    router.replace(item.route);
  };

  const openLogDetailsForEntry = (entry) => {
    const screeningId = entry?.ai_screening_id || entry?.id;
    if (!screeningId) return;
    router.push({
      pathname: '/donor/hair-check-details',
      params: { screeningId: String(screeningId) },
    });
  };

  const primaryActionTitle = !isProfileComplete
    ? 'Complete Profile'
    : isFirstHairCheck
      ? 'Start First Hair Check'
      : isWeeklyScanLocked
        ? 'View Recent Log'
        : 'Start Hair Analysis';
  const resolvedPrimaryActionIcon = !isProfileComplete
    ? 'editProfile'
    : isWeeklyScanLocked && !isFirstHairCheck
      ? 'history'
      : 'camera';
  const activeHairPrompt = isProfileCompletionPromptVisible
    ? 'profile'
    : isFirstCheckPromptVisible
      ? 'first-check'
      : '';
  const isProfilePrompt = activeHairPrompt === 'profile';
  const promptTitle = isProfilePrompt
    ? 'Complete your profile first'
    : 'No hair records yet';
  const promptMessage = isProfilePrompt
    ? 'Finish your donor profile details before starting hair checks.'
    : 'Start your first CheckHair scan to create your hair log and analysis.';
  const promptIcon = isProfilePrompt ? 'account-alert-outline' : 'chart-line';
  const promptActionTitle = isProfilePrompt ? 'Complete Profile' : primaryActionTitle;
  const promptActionIcon = isProfilePrompt ? 'editProfile' : resolvedPrimaryActionIcon;
  const promptDismissLabel = isProfilePrompt
    ? 'Dismiss profile completion prompt'
    : 'Dismiss first hair check prompt';
  React.useEffect(() => {
    const shouldShowPrompt = isProfileComplete
      && isFirstHairCheck
      && !isLoading
      && !firstCheckPromptDismissed;

    setIsFirstCheckPromptVisible(shouldShowPrompt);
  }, [firstCheckPromptDismissed, isFirstHairCheck, isLoading, isProfileComplete]);

  const dismissFirstCheckPrompt = () => {
    setFirstCheckPromptDismissed(true);
    setIsFirstCheckPromptVisible(false);
  };

  const dismissProfileCompletionPrompt = () => {
    setIsProfileCompletionPromptVisible(false);
  };

  const dismissHairPrompt = () => {
    if (activeHairPrompt === 'profile') {
      dismissProfileCompletionPrompt();
      return;
    }

    dismissFirstCheckPrompt();
  };

  const handleHairPromptAction = () => {
    if (activeHairPrompt === 'profile') {
      dismissProfileCompletionPrompt();
      router.navigate('/profile');
      return;
    }

    handlePrimaryAction();
  };

  return (
    <DashboardLayout
      header={<DonorTabHeader unreadCount={unreadCount} />}
      navItems={donorDashboardNavItems}
      activeNavKey="checkhair"
      onNavPress={handleNavPress}
      navVariant="donor"
      screenVariant="default"
      showSupportChat={false}
      floatingOverlay={(
        <HairAnalysisFloatingButton
          title={primaryActionTitle}
          icon={resolvedPrimaryActionIcon}
          showHairAnalysisIcon={resolvedPrimaryActionIcon === 'camera'}
          onPress={handlePrimaryAction}
        />
      )}
      loadingOverlay={isLoading ? (
        <DonivraLoadingOverlay visible label="Loading hair analysis..." />
      ) : null}
    >
      <View style={styles.container}>
        {error ? (
          <View style={[styles.errorCard, { borderColor: roles.defaultCardBorder, backgroundColor: roles.pageBackground }]}>
            <Text style={[styles.errorText, { color: roles.bodyText }]}>{error}</Text>
          </View>
        ) : null}
        <View style={styles.analysisIntro}>
          <View style={styles.analysisIntroCopy}>
            <Text style={[styles.analysisIntroTitle, { color: roles.headingText }]}>Your hair health</Text>
            <Text style={[styles.analysisIntroText, { color: roles.bodyText }]}>See your latest result and follow changes over time.</Text>
          </View>
          <View style={[styles.analysisIntroIcon, { backgroundColor: roles.iconPrimarySurface }]}>
            <MaterialCommunityIcons name="chart-timeline-variant-shimmer" size={25} color={roles.primaryActionBackground} />
          </View>
        </View>

        <View style={styles.tabPanelStack}>
          <LinearGradient
            colors={[theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.healthOverviewCard}
          >
            <View style={styles.healthOverviewGlow} />
            <View style={styles.healthOverviewHeader}>
              <View style={styles.healthOverviewHeaderCopy}>
                <Text style={styles.healthOverviewEyebrow}>LATEST RESULT</Text>
                <Text numberOfLines={2} style={styles.healthOverviewTitle}>{todayCondition}</Text>
                {healthRangeLabel ? <Text style={styles.healthOverviewRange}>{healthRangeLabel}</Text> : <Text style={styles.healthOverviewRange}>Complete your first check to begin.</Text>}
              </View>
              <View style={styles.healthMoodRing}>
                <MaterialCommunityIcons name={latestMood.icon} size={31} color="#FFFFFF" />
                <Text numberOfLines={1} style={styles.healthMoodLabel}>{latestMood.label}</Text>
              </View>
            </View>

            <View style={styles.healthMetricsRow}>
              {[
                { key: 'length', label: 'Length', value: lengthLabel },
                { key: 'texture', label: 'Texture', value: textureLabel },
                { key: 'scalp', label: 'Condition', value: scalpLabel },
                { key: 'moisture', label: 'Moisture', value: moistureLabel },
              ].map((metric, index) => (
                <React.Fragment key={metric.key}>
                  {index ? <View style={styles.healthMetricDivider} /> : null}
                  <View style={styles.healthMetricItem}>
                    <Text numberOfLines={1} style={styles.healthMetricLabel}>{metric.label}</Text>
                    <Text numberOfLines={1} style={styles.healthMetricValue}>{metric.value}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>

          </LinearGradient>

          <View style={styles.analysisSectionBlock}>
            <View style={styles.analysisSectionHeaderRow}>
              <View style={styles.analysisSectionHeaderCopy}>
                <Text style={[styles.analysisSectionTitle, { color: roles.headingText }]}>Hair history</Text>
                <Text style={[styles.analysisSectionSubtitle, { color: roles.metaText }]}>Review saved results by week or month.</Text>
              </View>
              <View style={[styles.calendarModeSwitch, { backgroundColor: roles.iconPrimarySurface }]}>
                {['week', 'month'].map((mode) => {
                  const selected = calendarMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        if (!selected) animateCalendarChange(() => setCalendarMode(mode));
                      }}
                      style={[
                        styles.calendarModeButton,
                        selected ? { backgroundColor: roles.primaryActionBackground } : null,
                      ]}
                    >
                      <Text style={[
                        styles.calendarModeText,
                        { color: selected ? roles.primaryActionText : roles.primaryActionBackground },
                      ]}>
                        {mode === 'week' ? 'Week' : 'Month'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Animated.View
              style={{
                opacity: calendarTransition,
                transform: [{
                  scale: calendarTransition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.985, 1],
                  }),
                }],
              }}
            >
              <View style={[styles.card, styles.calendarCard, { borderColor: roles.defaultCardBorder, backgroundColor: roles.defaultCardBackground }]}>
              <View style={styles.calendarHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Previous ${calendarMode}`}
                  onPress={() => moveCalendar(-1)}
                  style={[styles.calendarNavButton, { backgroundColor: roles.iconPrimarySurface, borderColor: roles.defaultCardBorder }]}
                >
                  <AppIcon name="chevron-left" color={roles.primaryActionBackground} />
                </Pressable>
                <View style={styles.calendarHeaderCopy}>
                  <Text style={[styles.calendarPeriodLabel, { color: roles.headingText }]}>{calendarPeriodLabel}</Text>
                  <Text style={[styles.calendarPeriodHint, { color: roles.metaText }]}>{calendarMode === 'week' ? 'Weekly view' : 'Monthly view'}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Next ${calendarMode}`}
                  onPress={() => moveCalendar(1)}
                  style={[styles.calendarNavButton, { backgroundColor: roles.iconPrimarySurface, borderColor: roles.defaultCardBorder }]}
                >
                  <AppIcon name="chevron-right" color={roles.primaryActionBackground} />
                </Pressable>
              </View>

              <View style={styles.calendarWeekdayRow}>
                {HAIR_CALENDAR_WEEKDAYS.map((label) => (
                  <Text key={`hair-calendar-weekday-${label}`} style={[styles.calendarWeekdayText, { color: roles.metaText }]}>{label}</Text>
                ))}
              </View>

              <View style={styles.calendarGrid}>
                {calendarRows.map((row, rowIndex) => (
                  <View key={`hair-calendar-row-${rowIndex}`} style={styles.calendarRow}>
                    {row.map((cell) => (
                      <Pressable
                        key={cell.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${cell.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}${cell.hasLog ? ', saved result' : ''}`}
                        onPress={() => {
                          setSelectedCalendarDateKey(cell.key);
                          setCalendarCursor(cell.date);
                          const logs = screeningsByDate.get(cell.key) || [];
                          if (logs[0]) openLogDetailsForEntry(logs[0]);
                        }}
                        style={[
                          styles.calendarDay,
                          { borderColor: cell.hasLog || cell.isSelected ? roles.defaultCardBorder : 'transparent' },
                          cell.isSelected && cell.hasLog ? { backgroundColor: roles.primaryActionBackground } : null,
                          cell.isSelected && !cell.hasLog ? { backgroundColor: roles.iconPrimarySurface } : null,
                          !cell.isSelected && cell.hasLog ? { backgroundColor: roles.iconPrimarySurface } : null,
                          calendarMode === 'month' && !cell.isCurrentMonth ? styles.calendarDayMuted : null,
                        ]}
                      >
                        <Text style={[
                          styles.calendarDayText,
                          { color: cell.isSelected && cell.hasLog ? roles.primaryActionText : cell.hasLog || cell.isSelected ? roles.primaryActionBackground : roles.headingText },
                        ]}>{cell.day}</Text>
                        {cell.hasLog ? (
                          <View style={[styles.calendarDot, { backgroundColor: cell.isSelected ? roles.primaryActionText : roles.primaryActionBackground }]} />
                        ) : cell.isToday ? (
                          <View style={[styles.calendarTodayDot, { borderColor: roles.primaryActionBackground }]} />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>

                <View style={[styles.calendarLegend, { borderTopColor: roles.defaultCardBorder }]}>
                  <View style={[styles.calendarLegendDot, { backgroundColor: roles.primaryActionBackground }]} />
                  <Text style={[styles.calendarLegendText, { color: roles.metaText }]}>Marked dates have saved results. Tap one to open it.</Text>
                </View>
              </View>
            </Animated.View>
          </View>

          <View style={styles.analysisSectionBlock}>
            <View style={styles.analysisSectionHeaderCopy}>
              <Text style={[styles.analysisSectionTitle, { color: roles.headingText }]}>Recent results</Text>
              <Text style={[styles.analysisSectionSubtitle, { color: roles.metaText }]}>Open a result to view the full assessment and guidance.</Text>
            </View>
            {hasRecentLogs ? (
              <View style={styles.recentLogFeed}>
                <HairConditionSummaryCard
                  entry={latestScreening}
                  eligibility={latestEligibility}
                  onPress={() => openLogDetailsForEntry(latestScreening)}
                />

                {olderLogs.length ? (
                  <View style={[styles.card, styles.recentLogCard, { borderColor: roles.defaultCardBorder, backgroundColor: roles.defaultCardBackground }]}>
                    <View style={styles.recentLogList}>
                      {olderLogs.map((entry, index) => {
                        const assessment = getCanonicalHairAssessment(entry);
                        const mood = getHairScreeningMood(entry);
                        return (
                          <Pressable
                            key={entry.ai_screening_id || entry.created_at || index}
                            accessibilityRole="button"
                            accessibilityLabel={`Open result from ${formatRecentLogDate(entry.created_at)}`}
                            onPress={() => openLogDetailsForEntry(entry)}
                            style={({ pressed }) => [
                              styles.recentLogItem,
                              { borderColor: roles.defaultCardBorder, backgroundColor: roles.pageBackground },
                              pressed ? styles.cardPressed : null,
                            ]}
                          >
                            <View style={[styles.recentLogMoodIcon, { backgroundColor: mood.surface }]}>
                              <MaterialCommunityIcons name={mood.icon} size={20} color={mood.color} />
                            </View>
                            <View style={styles.recentLogMain}>
                              <Text style={[styles.recentLogDate, { color: roles.metaText }]}>{formatRecentLogDate(entry.created_at)}</Text>
                              <Text numberOfLines={1} style={[styles.recentLogCondition, { color: roles.headingText }]}>{assessment.label}</Text>
                            </View>
                            <View style={[styles.recentLogMoodWrap, { backgroundColor: mood.surface }]}>
                              <Text style={[styles.recentLogMoodText, { color: mood.color }]}>{mood.label}</Text>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : (
              <EmptyDataState
                compact
                showCountBadge={false}
                title="No saved results yet"
                message="Start a hair check to save your first result."
                variant="analysis"
              />
            )}
          </View>
        </View>
      </View>

      {isFirstCheckPromptVisible || isProfileCompletionPromptVisible ? (
        <Modal
          transparent
          animationType="fade"
          visible={isFirstCheckPromptVisible || isProfileCompletionPromptVisible}
          onRequestClose={dismissHairPrompt}
        >
          <View style={styles.firstTimeOverlay}>
            <Pressable
              style={styles.firstTimeBackdrop}
              onPress={dismissHairPrompt}
              accessibilityRole="button"
              accessibilityLabel={promptDismissLabel}
            />
            {isProfilePrompt ? (
              <Pressable
                style={[styles.firstTimeCard, { backgroundColor: roles.pageBackground }]}
                onPress={() => {}}
              >
                <Pressable
                  onPress={dismissHairPrompt}
                  style={styles.firstTimeCloseButton}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={promptDismissLabel}
                >
                  <MaterialCommunityIcons name="close" size={24} color={roles.primaryActionBackground} />
                </Pressable>
                <View style={[styles.firstTimeIconWrap, { backgroundColor: roles.pageBackground }]}>
                  <AppIcon name={promptIcon} color={roles.primaryActionBackground} size="xl" />
                </View>
                <Text style={[styles.firstTimeTitle, { color: roles.headingText }]}>{promptTitle}</Text>
                <Text style={[styles.firstTimeMessage, { color: roles.bodyText }]}>{promptMessage}</Text>
                <GradientActionButton
                  title={promptActionTitle}
                  onPress={handleHairPromptAction}
                  leading={<AppIcon name={promptActionIcon} state="inverse" />}
                  fullWidth
                  textColor={roles.primaryActionText}
                  style={styles.firstTimeActionButton}
                />
              </Pressable>
            ) : (
              <View style={[styles.firstTimeAnalysisSheet, { backgroundColor: roles.pageBackground }]}>
                <Pressable
                  onPress={dismissHairPrompt}
                  style={styles.firstTimeCloseButton}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={promptDismissLabel}
                >
                  <MaterialCommunityIcons name="close" size={24} color={roles.primaryActionBackground} />
                </Pressable>
                <View style={styles.firstTimeAnalysisState}>
                  <MaterialCommunityIcons
                    name={promptIcon}
                    size={44}
                    color={roles.primaryActionBackground}
                    style={styles.firstTimeAnalysisIcon}
                  />
                  <Text style={[styles.firstTimeTitle, { color: roles.headingText }]}>{promptTitle}</Text>
                  <Text style={[styles.firstTimeMessage, { color: roles.bodyText }]}>{promptMessage}</Text>
                </View>
                <GradientActionButton
                  title={promptActionTitle}
                  onPress={handleHairPromptAction}
                  leading={<AppIcon name={promptActionIcon} state="inverse" />}
                  fullWidth
                  textColor={roles.primaryActionText}
                  style={styles.firstTimeAnalysisActionButton}
                />
              </View>
            )}
          </View>
        </Modal>
      ) : null}

    </DashboardLayout>
  );
}

export default function DonorDonationsScreen() {
  const params = useLocalSearchParams();
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;

  if (mode === 'scan') {
    return <DonorHairSubmissionScreen />;
  }

  return <HairAnalysisHomeModule />;
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.md,
  },
  analysisFabPosition: {
    position: 'absolute',
    right: theme.spacing.lg,
    bottom: 100,
    zIndex: 40,
    shadowColor: '#3B0711',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 9,
  },
  analysisFabSurface: {
    width: 176,
    minHeight: 84,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 248, 249, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(110, 13, 34, 0.16)',
  },
  analysisFabButton: {
    flex: 1,
    width: '100%',
    minHeight: 84,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  analysisFabPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  analysisFabIconWrap: {
    width: 42,
    height: 42,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  analysisFabIconImage: {
    width: 38,
    height: 38,
  },
  analysisFabText: {
    width: '100%',
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.dashboardDonorFrom,
    textAlign: 'center',
    lineHeight: 17,
    textShadowColor: 'rgba(255, 255, 255, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  headerRow: {
    borderWidth: 1,
    borderRadius: theme.radius.xl,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -1,
    minWidth: 16,
    height: 16,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
  },
  analysisIntro: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingHorizontal: 2,
  },
  analysisIntroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  analysisIntroTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  analysisIntroText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  analysisIntroIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPanelStack: {
    gap: theme.spacing.xl,
  },
  analysisSectionBlock: {
    gap: theme.spacing.sm,
  },
  recentLogFeed: {
    gap: theme.spacing.md,
  },
  analysisSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  analysisSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  analysisSectionHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  analysisSectionSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
  },
  healthOverviewCard: {
    position: 'relative',
    borderRadius: 24,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#3B0711',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 9,
  },
  healthOverviewGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    top: -80,
    right: -45,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  healthOverviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  healthOverviewHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  healthOverviewEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.1,
    color: 'rgba(255, 255, 255, 0.76)',
  },
  healthOverviewTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  healthOverviewRange: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: 'rgba(255, 255, 255, 0.78)',
  },
  healthMoodRing: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.82)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  healthMoodLabel: {
    maxWidth: 66,
    fontFamily: theme.typography.fontFamily,
    fontSize: 8.5,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  healthMetricsRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  healthMetricItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 3,
  },
  healthMetricDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  healthMetricLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    color: 'rgba(255, 255, 255, 0.68)',
  },
  healthMetricValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  overviewCard: {
    borderRadius: theme.radius.sm,
  },
  calendarCard: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 22,
    ...theme.shadows.md,
  },
  calendarModeSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: theme.radius.pill,
  },
  calendarModeButton: {
    minWidth: 58,
    minHeight: 32,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarModeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  sectionCardTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  sectionCardCaption: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  conditionStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    flexShrink: 0,
  },
  conditionStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  calendarHeaderCopy: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
    gap: 2,
  },
  calendarPeriodLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  calendarPeriodHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.semibold,
  },
  calendarNavButton: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarWeekdayRow: {
    flexDirection: 'row',
    gap: 3,
  },
  calendarWeekdayText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
  },
  calendarGrid: {
    gap: 5,
  },
  calendarRow: {
    flexDirection: 'row',
    gap: 5,
  },
  calendarDay: {
    flex: 1,
    minHeight: 38,
    borderWidth: 1,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  calendarDayMuted: {
    opacity: 0.46,
  },
  calendarDayText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.semibold,
  },
  calendarDot: {
    width: 4,
    height: 4,
    borderRadius: 3,
  },
  calendarTodayDot: {
    width: 4,
    height: 4,
    borderRadius: 3,
    borderWidth: 1,
  },
  calendarLegend: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing.sm,
  },
  calendarLegendDot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.full,
  },
  calendarLegendText: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 14,
  },
  calendarSelectedPanel: {
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  calendarSelectedCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  calendarSelectedTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'capitalize',
  },
  calendarSelectedText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  calendarViewButton: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
  },
  calendarViewButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.bold,
  },
  recentLogCard: {
    gap: theme.spacing.sm,
    borderRadius: 20,
    ...theme.shadows.soft,
  },
  hairConditionCard: {
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
    borderRadius: 20,
    ...theme.shadows.soft,
  },
  hairConditionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  hairConditionHeaderCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  hairConditionEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hairConditionDate: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  hairConditionStatus: {
    alignSelf: 'flex-start',
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
  },
  hairConditionStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  hairConditionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyMd,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.semantic.bodyMd * theme.typography.lineHeights.relaxed,
    marginBottom: theme.spacing.sm,
  },
  hairConditionEligibilityNote: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
    marginTop: -theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  hairConditionSummary: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  hairConditionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  hairConditionActionCopy: {
    gap: 1,
  },
  hairConditionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  hairConditionMoodInline: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  hairConditionMoodInlineText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  hairConditionDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: theme.spacing.sm,
  },
  hairConditionViewLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.semibold,
  },
  cardPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.995 }],
  },
  conditionCard: {
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  cardTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  cardSubtitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
  },
  logCountPill: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  logCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.semibold,
  },
  improvementPanel: {
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  improvementHeader: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'flex-start',
  },
  improvementIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  improvementCopy: {
    flex: 1,
    gap: 2,
  },
  improvementTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  improvementBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  recommendationPreviewList: {
    gap: theme.spacing.xs,
  },
  recommendationPreviewItem: {
    gap: 2,
  },
  recommendationPreviewTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.bold,
  },
  recommendationPreviewText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  recentLogList: {
    gap: theme.spacing.xs,
  },
  recentLogItem: {
    borderWidth: 1,
    borderRadius: 16,
    padding: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  recentLogMoodIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recentLogMain: {
    flex: 1,
    gap: 4,
  },
  recentLogTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.xs,
  },
  recentLogDate: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  recentLogStatus: {
    borderRadius: theme.radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  recentLogStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  recentLogCondition: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 14,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'capitalize',
  },
  recentLogRecommendation: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  recentLogMoodWrap: {
    minHeight: 32,
    maxWidth: 78,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  recentLogMoodText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  healthMeta: {
    flex: 1,
    gap: 1,
  },
  healthMetaLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.bold,
  },
  healthMetaValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'capitalize',
  },
  healthMetaRange: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  metricItem: {
    width: '48%',
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    gap: 2,
  },
  calendarMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    flexShrink: 0,
  },
  calendarMetaText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  metricKey: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
  },
  metricValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    fontWeight: theme.typography.weights.semibold,
  },
  centerState: {
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  centerStateText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  errorCard: {
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
  },
  errorText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  firstTimeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(21, 28, 39, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  firstTimeBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  firstTimeCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.sm,
    position: 'relative',
    ...theme.shadows.lg,
  },
  firstTimeAnalysisSheet: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    position: 'relative',
  },
  firstTimeCloseButton: {
    position: 'absolute',
    top: theme.spacing.md,
    right: theme.spacing.md,
    zIndex: 2,
    padding: 2,
  },
  firstTimeAnalysisState: {
    width: '100%',
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
  },
  firstTimeAnalysisIcon: {
    marginBottom: theme.spacing.md,
  },
  firstTimeAnalysisActionButton: {
    width: '100%',
  },
  firstTimeIconWrap: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
  },
  firstTimeTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  firstTimeMessage: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  firstTimeActionButton: {
    width: '100%',
  },
});
