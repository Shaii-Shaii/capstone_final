import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { DashboardLayout } from '../../src/components/layout/DashboardLayout';
import { AppButton } from '../../src/components/ui/AppButton';
import { AppCard } from '../../src/components/ui/AppCard';
import { EmptyDataState } from '../../src/components/ui/EmptyDataState';
import { DonationEventsEmptyState } from '../../src/components/ui/DonationEventsEmptyState';
import { GradientActionButton } from '../../src/components/ui/GradientActionButton';
import { AppIcon } from '../../src/components/ui/AppIcon';
import { StatusBanner } from '../../src/components/ui/StatusBanner';
import { DonivraLoadingOverlay } from '../../src/components/ui/DonivraLoadingOverlay';
import { DonorTopBar } from '../../src/components/donor/DonorTopBar';
import { DonorTutorialModal } from '../../src/components/donor/DonorTutorialModal';
import { SectionTitleRow } from '../../src/components/ui/SectionTitleRow';
import { donorDashboardNavItems } from '../../src/constants/dashboard';
import {
  fetchHairSubmissionsByUserId,
  fetchLatestDonationRequirement,
  fetchLatestDonorRecommendationByUserId,
} from '../../src/features/hairSubmission.api';
import {
  fetchUpcomingDonationDrives,
  fetchRegisteredDonationDrivesByUserId,
  unlockPrivateEventAccess,
} from '../../src/features/donorHome.api';
import { getDonorDonationsModuleData } from '../../src/features/donorDonations.service';
import { useAuthActions } from '../../src/features/auth/hooks/useAuthActions';
import { useNotifications } from '../../src/hooks/useNotifications';
import { useAuth } from '../../src/providers/AuthProvider';
import { resolveThemeRoles, theme } from '../../src/design-system/theme';
import { supabase } from '../../src/api/supabase/client';
import { buildProfileCompletionMeta } from '../../src/features/profile/services/profile.service';

const formatDayLabel = (value) => (
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))
);

const formatRequirementLength = (requirement = null) => {
  const inches = Number(requirement?.minimum_hair_length_inches);
  if (!Number.isFinite(inches) || inches <= 0) return 'Not set';
  const rounded = Number(inches.toFixed(1));
  return `${rounded} in`;
};

const getRequirementStatusTone = (value) => {
  if (value === true) return 'accepted';
  if (value === false) return 'blocked';
  return 'neutral';
};

const buildDonationTreatmentRequirementItems = (requirement = null) => ([
  { key: 'chemical', label: 'Chemical', value: requirement?.chemical_treatment_status },
  { key: 'colored', label: 'Colored', value: requirement?.colored_hair_status },
  { key: 'bleached', label: 'Bleached', value: requirement?.bleached_hair_status },
  { key: 'rebonded', label: 'Rebonded', value: requirement?.rebonded_hair_status },
]);


const formatDriveDate = (startDate, endDate) => {
  if (!startDate) return 'Date to follow';
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  const shortFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

  if (!end) {
    return shortFormatter.format(start);
  }

  return `${shortFormatter.format(start)} - ${shortFormatter.format(end)}`;
};

const formatDriveCardDate = (startDate, endDate) => {
  if (!startDate) return 'Date to follow';

  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  const longFormatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const shortFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (!end || start.toDateString() === end.toDateString()) {
    return longFormatter.format(start);
  }

  return `${shortFormatter.format(start)} - ${shortFormatter.format(end)}`;
};

const normalizeDonationEventSearchText = (value = '') => (
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
);

const getDonationEventSortTime = (drive = null) => {
  const dateValue = drive?.start_date || drive?.end_date || drive?.updated_at || null;
  const time = dateValue ? new Date(dateValue).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

const getDonationEventSearchText = (drive = null) => normalizeDonationEventSearchText([
  drive?.event_title,
  drive?.event_by,
  drive?.partnered_with,
  drive?.organization_name,
  drive?.venue_name,
  drive?.location_label,
  drive?.address_label,
  drive?.is_public ? 'public' : 'private',
  formatDriveCardDate(drive?.start_date, drive?.end_date),
].filter(Boolean).join(' '));

const sortDonationDrivesByDate = (drives = [], sortOrder = 'nearest') => (
  [...drives].sort((left, right) => {
    const leftTime = getDonationEventSortTime(left);
    const rightTime = getDonationEventSortTime(right);
    const direction = sortOrder === 'oldest' ? -1 : 1;
    if (leftTime !== rightTime) return (leftTime - rightTime) * direction;

    const leftTitle = String(left?.event_title || '').toLowerCase();
    const rightTitle = String(right?.event_title || '').toLowerCase();
    if (leftTitle !== rightTitle) return leftTitle.localeCompare(rightTitle);

    return Number(right?.donation_drive_id || 0) - Number(left?.donation_drive_id || 0);
  })
);

const DONATION_EVENT_VISIBILITY_OPTIONS = [
  { key: 'all', label: 'All events' },
  { key: 'public', label: 'Public only' },
  { key: 'private', label: 'Private only' },
];

const DONATION_EVENT_SORT_OPTIONS = [
  { key: 'nearest', label: 'Nearest date' },
  { key: 'oldest', label: 'Oldest date' },
];

const getDonationEventVisibilityOption = (value = 'all') => (
  DONATION_EVENT_VISIBILITY_OPTIONS.find((option) => option.key === value)
  || DONATION_EVENT_VISIBILITY_OPTIONS[0]
);

const getDonationEventSortOption = (value = 'nearest') => (
  DONATION_EVENT_SORT_OPTIONS.find((option) => option.key === value)
  || DONATION_EVENT_SORT_OPTIONS[0]
);

const getInitials = (value = '') => (
  String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'D'
);

const extractDriveIdFromUnlockResult = (payload) => {
  if (!payload) return null;
  const candidates = Array.isArray(payload) ? payload : [payload];
  for (const item of candidates) {
    const driveId = Number(
      item?.donation_drive_id
      || item?.event_request_id
      || item?.Event_Request_ID
      || item?.drive_id
      || item?.event_id
    );
    if (Number.isFinite(driveId) && driveId > 0) return driveId;
  }
  return null;
};

const getMembershipRank = (membership) => {
  if (membership?.is_active) return 3;
  if (membership?.is_pending) return 2;
  return membership?.member_id ? 1 : 0;
};

const getBestMembershipByOrganization = (memberships = []) => {
  const membershipByOrganizationId = new Map();

  memberships.forEach((membership) => {
    if (!membership?.organization_id) return;

    const current = membershipByOrganizationId.get(membership.organization_id);
    const nextRank = getMembershipRank(membership);
    const currentRank = getMembershipRank(current);
    const nextUpdatedAt = new Date(membership.updated_at || membership.created_at || 0).getTime();
    const currentUpdatedAt = new Date(current?.updated_at || current?.created_at || 0).getTime();

    if (!current || nextRank > currentRank || (nextRank === currentRank && nextUpdatedAt > currentUpdatedAt)) {
      membershipByOrganizationId.set(membership.organization_id, membership);
    }
  });

  return membershipByOrganizationId;
};

// eslint-disable-next-line no-unused-vars
const attachMembershipsToOrganizations = (organizations = [], memberships = []) => {
  const membershipByOrganizationId = getBestMembershipByOrganization(memberships);

  return organizations.map((organization) => ({
    ...organization,
    membership: membershipByOrganizationId.get(organization.organization_id) || null,
  }));
};

const isDriveActiveForHome = (drive = null) => {
  const compareDate = drive?.end_date || drive?.start_date || null;
  if (!compareDate) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(compareDate).getTime() >= today.getTime();
};

// eslint-disable-next-line no-unused-vars
const getMobileOrganizationError = (error, fallback = 'Something went wrong. Please try again.') => {
  const message = String(error?.message || error || '').toLowerCase();
  if (!message) return fallback;
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return 'Connection problem. Check your internet and try again.';
  }
  if (message.includes('permission') || message.includes('42501') || message.includes('row-level')) {
    return 'We could not save this yet because your account permission is not ready.';
  }
  if (message.includes('not available') || message.includes('not open')) {
    return 'This organization is not available to join right now.';
  }
  if (message.includes('required')) {
    return 'Your donor account must be ready before joining an organization.';
  }
  return fallback;
};

const normalizeConditionTone = (condition = '') => {
  const normalized = String(condition || '').trim().toLowerCase();

  if (normalized.includes('healthy') || normalized.includes('good')) {
    return {
      dotColor: '',
      label: 'Healthy',
    };
  }

  if (normalized.includes('dry') || normalized.includes('damaged')) {
    return {
      dotColor: '',
      label: 'Needs care',
    };
  }

  if (normalized.includes('treated') || normalized.includes('rebonded') || normalized.includes('colored')) {
    return {
      dotColor: '',
      label: 'Treated',
    };
  }

  return {
    dotColor: '',
    label: condition || 'Checked',
  };
};

const hasNegatedCareConcern = (text = '') => (
  /\b(no|not|without)\s+(?:visible\s+|significant\s+|major\s+)?(?:damage|dryness|frizz|breakage|split\s+ends?|issues?)\b/i.test(text)
  || /\bno\s+significant\s+damage\s+or\s+issues\b/i.test(text)
  || /\bsealed\s+ends?\b/i.test(text)
);

const hasExplicitCareConcern = (text = '') => {
  const normalized = String(text || '').toLowerCase();
  const negated = hasNegatedCareConcern(normalized);
  if (/(split\s+ends?|split\s+tips?|breakage|brittle|fray(?:ed|ing)|frizz|flyaways|oily|greasy|stressed\s+ends)/i.test(normalized)) {
    return true;
  }
  if (/(dry|dull|damage|damaged|needs care|not eligible|improve)/i.test(normalized) && !negated) {
    return true;
  }
  return false;
};

const getCanonicalHairAssessment = (screening = null) => {
  if (!screening) {
    return { label: 'No result', needsCare: false, issueLabel: 'No result' };
  }

  const combined = [
    screening.detected_condition,
    screening.visible_damage_notes,
    screening.summary,
    screening.decision,
  ].filter(Boolean).join(' ');
  const condition = String(screening.detected_condition || '').trim();
  const metrics = deriveHairMetrics(screening);
  const metricConcern = (
    Number(metrics.dryness) >= 6
    || Number(metrics.damage) >= 6
    || Number(metrics.frizz) >= 6
    || Number(metrics.oiliness) >= 7
  );
  const explicitConcern = hasExplicitCareConcern(combined);
  const needsCare = explicitConcern || metricConcern;

  if (!needsCare && (/healthy|good|eligible/i.test(combined) || condition)) {
    return { label: condition || 'Healthy', needsCare: false, issueLabel: 'Good result' };
  }

  const issueLabel = [
    Number(metrics.damage) >= 6 || /split|breakage|damage|fray|stressed/i.test(combined) ? 'Damage' : '',
    Number(metrics.dryness) >= 6 || /dry|dull/i.test(combined) ? 'Dryness' : '',
    Number(metrics.frizz) >= 6 || /frizz|flyaway/i.test(combined) ? 'Frizz' : '',
    Number(metrics.oiliness) >= 7 || /oily|greasy/i.test(combined) ? 'Oiliness' : '',
  ].filter(Boolean)[0] || 'Needs care';

  return {
    label: condition && !/healthy/i.test(condition) ? condition : issueLabel,
    needsCare: true,
    issueLabel,
  };
};

const getScreeningEntries = (submissions = []) => (
  submissions
    .flatMap((submission) => (submission?.ai_screenings || []).map((screening) => ({ submission, screening })))
    .filter((entry) => entry.screening?.created_at)
    .sort((left, right) => new Date(right.screening.created_at).getTime() - new Date(left.screening.created_at).getTime())
);

const WEEK_DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOME_REALTIME_DEBOUNCE_MS = 420;
const HOME_CACHE_FRESH_MS = 60000;
const PRIVATE_ACCESS_FAB_SIZE = 48;
const PRIVATE_ACCESS_FAB_EDGE_PADDING = 12;
const PRIVATE_ACCESS_FAB_TOP_PADDING = 96;
const PRIVATE_ACCESS_FAB_BOTTOM_PADDING = 112;

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

let cachedDonorHomeData = null;
let cachedDonorHomeUserId = '';

function AnimatedHomeSection({ children, delay = 0, style, animate = true }) {
  const opacity = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const translateY = React.useRef(new Animated.Value(animate ? 14 : 0)).current;

  React.useEffect(() => {
    if (!animate) {
      opacity.setValue(1);
      translateY.setValue(0);
      return undefined;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        delay,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(delay),
        Animated.spring(translateY, {
          toValue: 0,
          damping: 16,
          stiffness: 180,
          mass: 0.8,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    return undefined;
  }, [animate, delay, opacity, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

// Converts any Date or ISO string to the user's LOCAL calendar date key (YYYY-MM-DD).
// Using toISOString() on local-midnight Date objects shifts the day in UTC+N timezones,
// causing a one-day mismatch between calendar cells and stored screening dates.
const toLocalDateKey = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getRegisteredEventCalendarDate = (drive = null) => (
  drive?.start_date
  || drive?.registration?.registered_at
  || drive?.registration?.updated_at
  || drive?.end_date
  || drive?.updated_at
  || ''
);

const buildScreeningEntriesByDate = (submissions = []) => {
  const markers = new Map();

  getScreeningEntries(submissions).forEach((entry) => {
    const createdAt = entry?.screening?.created_at;
    if (!createdAt) return;
    const key = toLocalDateKey(createdAt);
    const current = markers.get(key) || [];
    current.push(entry);
    current.sort((left, right) => (
      new Date(right?.screening?.created_at || 0).getTime() - new Date(left?.screening?.created_at || 0).getTime()
    ));
    markers.set(key, current);
  });

  return markers;
};

const buildRegisteredEventsByDate = (registeredEventDrives = []) => {
  const markers = new Map();

  (registeredEventDrives || []).forEach((drive) => {
    const calendarDate = getRegisteredEventCalendarDate(drive);
    if (!calendarDate) return;
    const key = toLocalDateKey(calendarDate);
    const current = markers.get(key) || [];
    current.push({
      ...drive,
      calendar_date: calendarDate,
    });
    current.sort((left, right) => (
      new Date(right?.calendar_date || 0).getTime() - new Date(left?.calendar_date || 0).getTime()
    ));
    markers.set(key, current);
  });

  return markers;
};

const buildHairActivityCalendarCells = (
  cursorDate,
  screeningEntriesByDate = new Map(),
  registeredEventsByDate = new Map(),
  selectedDateKey = ''
) => {
  const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  const todayKey = toLocalDateKey(new Date());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = toLocalDateKey(date);
    const screeningEntries = screeningEntriesByDate.get(key) || [];
    const eventEntries = registeredEventsByDate.get(key) || [];

    return {
      key,
      date,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === cursorDate.getMonth(),
      isToday: key === todayKey,
      isSelected: key === selectedDateKey,
      screeningEntries,
      eventEntries,
      latestScreening: screeningEntries[0]?.screening || null,
    };
  });
};

// Maps each logged calendar date to the submission that owns the latest AI screening on that date.
// eslint-disable-next-line no-unused-vars
const buildSubmissionByDate = (submissions = []) => {
  const latest = new Map(); // dateKey → { submission, createdAt }

  submissions.forEach((submission) => {
    (submission?.ai_screenings || []).forEach((screening) => {
      if (!screening?.created_at) return;
      const key = toLocalDateKey(screening.created_at);
      const current = latest.get(key);
      if (!current || new Date(screening.created_at).getTime() > new Date(current.createdAt).getTime()) {
        latest.set(key, { submission, createdAt: screening.created_at });
      }
    });
  });

  const result = new Map();
  latest.forEach(({ submission }, key) => result.set(key, submission));
  return result;
};


// Derives 0-10 levels for each hair metric from the screening data.
// Falls back to DB columns (shine_level etc.) if populated, otherwise infers from text fields.
const deriveHairMetrics = (screening) => {
  const cond = String(screening?.detected_condition || '').toLowerCase();
  const dmg = String(screening?.visible_damage_notes || '').toLowerCase();
  const tex = String(screening?.detected_texture || '').toLowerCase();

  const shine =
    screening?.shine_level != null ? screening.shine_level
    : cond.includes('healthy') || cond.includes('good') ? 8
    : cond.includes('dry') || cond.includes('damaged') ? 3
    : cond.includes('oily') ? 5 : 5;

  const frizz =
    screening?.frizz_level != null ? screening.frizz_level
    : cond.includes('frizz') ? 7
    : cond.includes('healthy') ? 2
    : tex.includes('wavy') || tex.includes('curly') ? 5 : 3;

  const dryness =
    screening?.dryness_level != null ? screening.dryness_level
    : cond.includes('dry') ? 8
    : cond.includes('healthy') ? 2
    : cond.includes('oily') ? 1 : 4;

  const oiliness =
    screening?.oiliness_level != null ? screening.oiliness_level
    : cond.includes('oily') || cond.includes('greasy') ? 8
    : cond.includes('healthy') ? 2
    : cond.includes('dry') ? 1 : 3;

  const damage =
    screening?.damage_level != null ? screening.damage_level
    : dmg.includes('split') || dmg.includes('break') || cond.includes('damaged') ? 8
    : cond.includes('healthy') ? 1
    : cond.includes('dry') ? 5 : 3;

  return { shine, frizz, dryness, oiliness, damage };
};

const HAIR_METRIC_DEFS = [
  { key: 'shine', label: 'Shine', positive: true, tip: 'Does hair look glossy or dull?' },
  { key: 'frizz', label: 'Frizz', positive: false, tip: 'Flyaway or messy strands?' },
  { key: 'dryness', label: 'Dryness', positive: false, tip: 'Rough or straw-like texture?' },
  { key: 'oiliness', label: 'Oiliness', positive: false, tip: 'Greasy or flat near roots?' },
  { key: 'damage', label: 'Damage / Splits', positive: false, tip: 'Broken or uneven ends?' },
];

const HAIR_METRIC_ICON_BY_KEY = {
  shine: 'white-balance-sunny',
  frizz: 'blur',
  dryness: 'water-off-outline',
  oiliness: 'water-outline',
  damage: 'content-cut',
};

// Kept for the detailed hair widget layout if the donor home re-enables an expanded analysis card.
// eslint-disable-next-line no-unused-vars
function HairConditionWidget({ screening, onViewDetail }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const bodyFont = resolvedTheme?.fontFamily || theme.typography.fontFamily;
  const headingFont = resolvedTheme?.secondaryFontFamily || theme.typography.fontFamilyDisplay;

  if (!screening) return null;
  const metrics = deriveHairMetrics(screening);

  return (
    <AppCard variant="default" radius="xl" padding="md">
      <View style={styles.hairWidgetHeader}>
        <View style={styles.hairWidgetTitleRow}>
          <View style={[styles.hairWidgetIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
            <MaterialCommunityIcons name="hair-dryer-outline" size={16} color={roles.primaryActionBackground} />
          </View>
          <Text style={[styles.hairWidgetTitle, { color: roles.headingText, fontFamily: headingFont }]}>
            Hair Condition
          </Text>
        </View>
        {onViewDetail ? (
          <Pressable onPress={onViewDetail} style={styles.hairWidgetViewBtn}>
            <Text style={[styles.hairWidgetViewBtnText, { color: roles.primaryActionBackground, fontFamily: bodyFont }]}>
              View log
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={14} color={roles.primaryActionBackground} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.hairMetricList}>
        {HAIR_METRIC_DEFS.map((def) => {
          const rawValue = metrics[def.key] ?? 5;
          const level = Math.max(0, Math.min(10, rawValue));
          const barFraction = level / 10;
          const barColor = def.positive
            ? (level >= 7 ? '#54b86f' : level >= 4 ? '#f0a856' : '#e05252')
            : (level <= 3 ? '#54b86f' : level <= 6 ? '#f0a856' : '#e05252');

          return (
            <View key={def.key} style={styles.hairMetricRow}>
              <View style={[styles.hairMetricIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
                <MaterialCommunityIcons
                  name={HAIR_METRIC_ICON_BY_KEY[def.key] || 'circle-outline'}
                  size={12}
                  color={roles.iconPrimaryColor}
                />
              </View>
              <Text style={[styles.hairMetricLabel, { color: roles.bodyText, fontFamily: bodyFont }]}>
                {def.label}
              </Text>
              <View style={[styles.hairMetricTrack, { backgroundColor: roles.supportCardBackground }]}>
                <View style={[styles.hairMetricFill, { width: `${barFraction * 100}%`, backgroundColor: barColor }]} />
              </View>
              <Text style={[styles.hairMetricValue, { color: barColor, fontFamily: bodyFont }]}>
                {level}/10
              </Text>
            </View>
          );
        })}
      </View>

      {screening.summary ? (
        <Text numberOfLines={2} style={[styles.hairWidgetSummary, { color: roles.metaText, fontFamily: bodyFont }]}>
          {screening.summary}
        </Text>
      ) : null}
    </AppCard>
  );
}

function RecentHairLogWidget({ hairSubmissions, latestRecommendation, onOpenLog, onOpenHistory }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const headingFont = resolvedTheme?.secondaryFontFamily || theme.typography.fontFamilyDisplay;
  const bodyFont = resolvedTheme?.fontFamily || theme.typography.fontFamily;
  // eslint-disable-next-line no-unused-vars
  const _latestRecommendation = latestRecommendation;
  const allEntries = React.useMemo(() => getScreeningEntries(hairSubmissions), [hairSubmissions]);
  const entries = allEntries.slice(0, 3);
  const totalCount = allEntries.length;

  if (!entries.length) {
    return (
      <EmptyDataState
        title="No hair checks yet"
        message="Run CheckHair to create your first hair log and analysis."
        compact
        showCountBadge={false}
        variant="analysis"
        style={[
          styles.recentLogEmpty,
          {
            backgroundColor: roles.pageBackground,
          },
        ]}
      />
    );
  }

  return (
    <View style={[styles.recentLogFlatCard, { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder }]}>
      {entries.map((entry, index) => {
        const assessment = getCanonicalHairAssessment(entry.screening);
        const needsCare = assessment.needsCare;
        const dotColor = needsCare ? '#c46a18' : '#54b86f';
        return (
          <React.Fragment key={`log-${entry.screening?.ai_screening_id || index}`}>
            {index > 0 && <View style={[styles.recentLogDivider, { backgroundColor: roles.defaultCardBorder }]} />}
            <Pressable
              onPress={() => onOpenLog?.(entry)}
              style={({ pressed }) => [styles.recentLogFlatRow, pressed ? styles.cardPressed : null]}
            >
              <View style={[styles.recentLogDot, { backgroundColor: dotColor }]} />
              <Text style={[styles.recentLogFlatCondition, { color: roles.headingText, fontFamily: headingFont }]} numberOfLines={1}>
                {assessment.label}
              </Text>
              <Text style={[styles.recentLogFlatDate, { color: roles.metaText, fontFamily: bodyFont }]}>
                {formatDayLabel(entry.screening.created_at)}
              </Text>
            </Pressable>
          </React.Fragment>
        );
      })}
      {totalCount > 3 ? (
        <>
          <View style={[styles.recentLogDivider, { backgroundColor: roles.defaultCardBorder }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${totalCount - 3} more hair checks`}
            onPress={onOpenHistory}
            style={({ pressed }) => [styles.recentLogFlatMore, pressed ? styles.cardPressed : null]}
          >
            <Text style={[styles.recentLogFlatMoreText, { color: roles.metaText, fontFamily: bodyFont }]}>
              +{totalCount - 3} more — view in Hair Checks
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function DonationRequirementsOverview({ requirement }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const headingFont = resolvedTheme?.secondaryFontFamily || theme.typography.fontFamilyDisplay;
  const bodyFont = resolvedTheme?.fontFamily || theme.typography.fontFamily;
  const [isExpanded, setIsExpanded] = React.useState(false);
  const hasRequirement = Boolean(requirement);
  const treatmentItems = React.useMemo(
    () => buildDonationTreatmentRequirementItems(requirement),
    [requirement]
  );
  const configuredBackground = resolvedTheme?.backgroundColor || roles.pageBackground;

  return (
    <View style={[styles.donationRequirementsCard, { backgroundColor: configuredBackground, borderColor: roles.defaultCardBorder }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isExpanded ? 'Hide donation requirements' : 'Show donation requirements'}
        onPress={() => setIsExpanded((current) => !current)}
        style={({ pressed }) => [styles.donationRequirementsDropdownHeader, pressed ? styles.cardPressed : null]}
      >
        <View style={[styles.donationRequirementsIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
          <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={roles.primaryActionBackground} />
        </View>
        <View style={styles.donationRequirementsMainCopy}>
          <Text style={[styles.donationRequirementsTitle, { color: roles.headingText, fontFamily: headingFont }]}>
            Donation Requirements
          </Text>
          <Text style={[styles.donationRequirementsSubtitle, { color: roles.metaText, fontFamily: bodyFont }]} numberOfLines={2}>
            Current eligibility rules
          </Text>
        </View>
        <MaterialCommunityIcons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={22}
          color={roles.primaryActionBackground}
        />
      </Pressable>

      {isExpanded && hasRequirement ? (
        <>
          <View style={styles.donationRequirementsHero}>
            <View style={[styles.donationRequirementsHeroIcon, { backgroundColor: roles.primaryActionBackground }]}>
              <MaterialCommunityIcons name="ruler-square" size={22} color="#fff" />
            </View>
            <View style={styles.donationRequirementsMainCopy}>
              <Text style={[styles.donationRequirementsLabel, { color: roles.metaText, fontFamily: bodyFont }]}>
                Required hair length
              </Text>
              <Text style={[styles.donationRequirementsLength, { color: roles.headingText, fontFamily: headingFont }]}>
                {formatRequirementLength(requirement)}
              </Text>
            </View>
          </View>

          <Text style={[styles.donationRequirementsGroupLabel, { color: roles.metaText, fontFamily: bodyFont }]}>
            Treatment rules
          </Text>
          <View style={styles.donationRequirementChipGrid}>
            {treatmentItems.map((item) => {
              const tone = getRequirementStatusTone(item.value);
              const isAccepted = tone === 'accepted';
              const isBlocked = tone === 'blocked';
              return (
                <View
                  key={item.key}
                  style={[
                    styles.donationRequirementChip,
                    {
                      backgroundColor: configuredBackground,
                      borderColor: roles.defaultCardBorder,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={isAccepted ? 'check-circle-outline' : isBlocked ? 'close-circle-outline' : 'minus-circle-outline'}
                    size={15}
                    color={isAccepted ? roles.successText : isBlocked ? roles.primaryActionBackground : roles.metaText}
                  />
                  <Text style={[styles.donationRequirementChipLabel, { color: roles.headingText, fontFamily: bodyFont }]}>
                    {item.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {isExpanded && !hasRequirement ? (
        <View style={styles.donationRequirementsEmpty}>
          <MaterialCommunityIcons name="database-alert-outline" size={20} color={roles.primaryActionBackground} />
          <Text style={[styles.donationRequirementsEmptyTitle, { color: roles.headingText, fontFamily: headingFont }]}>
            Requirements not configured
          </Text>
          <Text style={[styles.donationRequirementsEmptyText, { color: roles.metaText, fontFamily: bodyFont }]}>
            Add a row in wig_requirements so donors can check the current donation rules.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function HairCalendarWidget({ hairSubmissions, registeredEventDrives = [], onOpenDate }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [currentMonth, setCurrentMonth] = React.useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedKey, setSelectedKey] = React.useState(() => toLocalDateKey(new Date()));
  const screeningEntriesByDate = React.useMemo(
    () => buildScreeningEntriesByDate(hairSubmissions),
    [hairSubmissions]
  );
  const registeredEventsByDate = React.useMemo(
    () => buildRegisteredEventsByDate(registeredEventDrives),
    [registeredEventDrives]
  );
  const calendarCells = React.useMemo(
    () => buildHairActivityCalendarCells(
      currentMonth,
      screeningEntriesByDate,
      registeredEventsByDate,
      selectedKey
    ),
    [currentMonth, registeredEventsByDate, screeningEntriesByDate, selectedKey]
  );

  const monthRows = React.useMemo(() => {
    const result = [];
    for (let i = 0; i < calendarCells.length; i += 7) {
      result.push(calendarCells.slice(i, i + 7));
    }
    return result;
  }, [calendarCells]);

  const totalHairChecks = React.useMemo(
    () => Array.from(screeningEntriesByDate.values()).reduce((total, rows) => total + rows.length, 0),
    [screeningEntriesByDate]
  );
  const totalRegisteredEvents = React.useMemo(
    () => Array.from(registeredEventsByDate.values()).reduce((total, rows) => total + rows.length, 0),
    [registeredEventsByDate]
  );
  const hasAnyActivity = totalHairChecks > 0 || totalRegisteredEvents > 0;

  if (!hasAnyActivity) {
    return (
      <AppCard variant="outline" radius="sm" padding="md" style={styles.homeCalendarShell}>
        <Text style={[styles.calendarHelperText, { color: roles.bodyText }]}>
          No hair checks or registered events yet.
        </Text>
      </AppCard>
    );
  }

  return (
    <AppCard
      variant="outline"
      radius="sm"
      padding="md"
      style={styles.homeCalendarShell}
      contentStyle={styles.homeCalendarCard}
    >
      <View style={styles.homeCalendarHeader}>
        <Pressable
          onPress={() => setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          style={({ pressed }) => [
            styles.homeCalendarNavButton,
            { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder },
            pressed ? styles.cardPressed : null,
          ]}
        >
          <AppIcon name="chevron-left" size="sm" color={roles.headingText} />
        </Pressable>
        <View style={styles.homeCalendarHeaderCopy}>
          <Text style={[styles.homeCalendarMonthLabel, { color: roles.headingText }]}>
            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </Text>
        </View>
        <Pressable
          onPress={() => setCurrentMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          style={({ pressed }) => [
            styles.homeCalendarNavButton,
            { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder },
            pressed ? styles.cardPressed : null,
          ]}
        >
          <AppIcon name="chevron-right" size="sm" color={roles.headingText} />
        </Pressable>
      </View>

      <View style={styles.homeCalendarWeekdayRow}>
        {WEEK_DAY_LABELS.map((day) => (
          <Text key={day} style={[styles.homeCalendarWeekdayText, { color: roles.headingText }]}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.homeCalendarGrid}>
        {monthRows.map((row, rowIdx) => (
          <View key={`hair-activity-calendar-row-${rowIdx}`} style={styles.homeCalendarRow}>
            {row.map((cell) => {
              const hasScreening = cell.screeningEntries.length > 0;
              const hasEvent = cell.eventEntries.length > 0;
              const assessment = cell.latestScreening ? getCanonicalHairAssessment(cell.latestScreening) : null;
              const markerColors = [];

              if (hasScreening) {
                markerColors.push(assessment?.needsCare ? '#c46a18' : '#54b86f');
              }
              if (hasEvent) {
                markerColors.push(roles.primaryActionBackground);
              }

              return (
                <Pressable
                  key={cell.key}
                  onPress={() => {
                    setSelectedKey(cell.key);
                    if (!cell.isCurrentMonth) {
                      setCurrentMonth(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                    }
                    if (hasScreening || hasEvent) {
                      onOpenDate?.({
                        dateKey: cell.key,
                        entries: cell.screeningEntries,
                        events: cell.eventEntries,
                      });
                    }
                  }}
                  style={({ pressed }) => [
                    styles.homeCalendarDay,
                    cell.isSelected
                      ? { backgroundColor: roles.iconPrimarySurface, borderColor: roles.defaultCardBorder }
                      : null,
                    cell.isToday && !cell.isSelected
                      ? { borderColor: roles.defaultCardBorder }
                      : null,
                    !cell.isCurrentMonth && !cell.isSelected ? styles.homeCalendarDayMuted : null,
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.homeCalendarDayText,
                      { color: cell.isSelected ? roles.primaryActionBackground : roles.headingText },
                      !cell.isCurrentMonth && !cell.isSelected ? { color: roles.metaText } : null,
                    ]}
                  >
                    {cell.day}
                  </Text>

                  {markerColors.length ? (
                    <View style={styles.homeCalendarMarkerRow}>
                      {markerColors.map((color, index) => (
                        <View
                          key={`${cell.key}-marker-${index}`}
                          style={[styles.homeCalendarMarker, { backgroundColor: color }]}
                        />
                      ))}
                    </View>
                  ) : cell.isToday ? (
                    <View style={[styles.homeCalendarTodayDot, { borderColor: roles.primaryActionBackground }]} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </AppCard>
  );
}

function FinishSetupCard({ completionMeta, onManageProfile }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const bodyFont = resolvedTheme?.fontFamily || theme.typography.fontFamily;
  const missingCount = completionMeta?.missingFieldLabels?.length || 0;

  return (
    <Pressable
      onPress={onManageProfile}
      style={({ pressed }) => [
        styles.setupInlineBar,
        { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder },
        pressed ? styles.cardPressed : null,
      ]}
    >
      <MaterialCommunityIcons name="account-edit-outline" size={15} color={roles.primaryActionBackground} />
      <Text style={[styles.setupInlineText, { color: roles.bodyText, fontFamily: bodyFont }]} numberOfLines={1}>
        Complete your profile — {missingCount} field{missingCount !== 1 ? 's' : ''} missing
      </Text>
      <MaterialCommunityIcons name="chevron-right" size={15} color={roles.metaText} />
    </Pressable>
  );
}

// Kept as a compact action-row variant for future home quick actions.
// eslint-disable-next-line no-unused-vars
function DonorFlowCard({
  title,
  description,
  badge,
  badgeVariant = 'neutral',
  icon,
  buttonTitle,
  onPress,
  filled = false,
  style,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const badgeStyles = badgeVariant === 'success'
    ? { backgroundColor: '#e9f8ef', color: '#0f7b3d' }
    : badgeVariant === 'warning'
      ? { backgroundColor: '#fff5dd', color: '#8a5a00' }
      : { backgroundColor: roles.iconPrimarySurface, color: roles.primaryActionBackground };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.flowActionRow,
        {
          backgroundColor: filled ? roles.primaryActionBackground : roles.defaultCardBackground,
          borderColor: filled ? roles.primaryActionBackground : roles.defaultCardBorder,
        },
        pressed ? styles.cardPressed : null,
        style,
      ]}
    >
      <View style={[
        styles.flowIconWrap,
        { backgroundColor: filled ? roles.primaryActionText : roles.iconPrimarySurface },
      ]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={roles.primaryActionBackground}
        />
      </View>
      <View style={styles.flowActionCopy}>
        <View style={styles.flowActionTitleRow}>
          <Text numberOfLines={1} style={[styles.flowCardTitle, { color: filled ? roles.primaryActionText : roles.headingText }]}>
            {title}
          </Text>
          {badge ? (
            <View style={[styles.flowBadge, { backgroundColor: filled ? 'rgba(255,255,255,0.18)' : badgeStyles.backgroundColor }]}>
              <Text style={[styles.flowBadgeText, { color: filled ? roles.primaryActionText : badgeStyles.color }]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={2} style={[styles.flowCardDescription, { color: filled ? roles.primaryActionText : roles.bodyText }]}>
          {description}
        </Text>
      </View>
      <View style={[styles.flowActionCta, { backgroundColor: filled ? roles.primaryActionText : roles.primaryActionBackground }]}>
        <Text numberOfLines={1} style={[
          styles.flowCardButtonText,
          { color: filled ? roles.primaryActionBackground : roles.primaryActionText },
        ]}>{buttonTitle}</Text>
        <AppIcon name="chevronRight" size="sm" color={filled ? roles.primaryActionBackground : roles.primaryActionText} />
      </View>
    </Pressable>
  );
}

// Kept for alternate single-feature-drive layouts.
// eslint-disable-next-line no-unused-vars
function UpcomingDriveHero({ drive, onPress }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [imageFailed, setImageFailed] = React.useState(false);
  const imageUrl = drive?.event_image_url || drive?.organization_logo_url || '';

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  if (!drive) {
    return (
      <AppCard variant="outline" radius="xl" padding="md" contentStyle={styles.emptyDriveHero}>
        <Text style={[styles.emptyDriveTitle, { color: roles.headingText }]}>No upcoming drives yet</Text>
        <Text style={[styles.emptyDriveText, { color: roles.bodyText }]}>
          Public and private events will appear here when available.
        </Text>
      </AppCard>
    );
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed ? styles.cardPressed : null]}>
      <View style={[styles.upcomingDriveHero, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
        {imageUrl && !imageFailed ? (
          <Image source={{ uri: imageUrl }} style={styles.upcomingDriveImage} resizeMode="cover" onError={() => setImageFailed(true)} />
        ) : (
          <View style={[styles.upcomingDriveFallback, { backgroundColor: roles.iconPrimarySurface }]}>
            <MaterialCommunityIcons name="calendar-heart" size={34} color={roles.primaryActionBackground} />
          </View>
        )}
        <View style={styles.upcomingDriveScrim} />
        <View style={styles.upcomingDriveCopy}>
          <Text style={styles.upcomingDriveEyebrow}>COMMUNITY EVENT</Text>
          <Text numberOfLines={2} style={styles.upcomingDriveTitle}>{drive.event_title || 'Donation drive'}</Text>
          <Text numberOfLines={1} style={styles.upcomingDriveMeta}>
            {formatDriveDate(drive.start_date, drive.end_date)}
            {drive.location_label ? `  •  ${drive.location_label}` : ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function ActiveDonationDriveCard({ drive, onOpenDetails, style }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [imageFailed, setImageFailed] = React.useState(false);
  const imageUrl = drive?.event_image_url || drive?.organization_logo_url || '';
  const scopeLabel = drive?.is_public ? 'PUBLIC' : 'PRIVATE';
  const driveDateLabel = formatDriveCardDate(drive?.start_date, drive?.end_date);

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open event details for ${drive?.event_title || 'donation drive'}`}
      onPress={onOpenDetails}
      style={({ pressed }) => [style, pressed ? styles.cardPressed : null]}
    >
      <View style={[styles.activeDriveCard, { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder }]}>
        <View style={[styles.activeDriveCover, { backgroundColor: roles.iconPrimarySurface }]}>
          {imageUrl && !imageFailed ? (
            <Image source={{ uri: imageUrl }} style={styles.activeDriveImage} resizeMode="cover" onError={() => setImageFailed(true)} />
          ) : (
            <View style={styles.activeDriveFallback}>
              <MaterialCommunityIcons name="calendar-heart" size={42} color={roles.primaryActionBackground} />
            </View>
          )}
        </View>
        <View style={styles.activeDriveBody}>
          <View style={[styles.activeDriveBadge, { backgroundColor: roles.supportCardBackground, borderColor: roles.defaultCardBorder }]}>
            <Text style={[styles.activeDriveBadgeText, { color: roles.metaText }]}>{scopeLabel}</Text>
          </View>
          <Text numberOfLines={1} style={[styles.activeDriveTitle, { color: roles.headingText }]}>
            {drive?.event_title || 'Donation drive'}
          </Text>
          <View style={styles.activeDriveMetaRow}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={14} color={roles.metaText} />
            <Text numberOfLines={1} style={[styles.activeDriveMetaText, { color: roles.bodyText }]}>
              {driveDateLabel}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function OrganizationHomeCard({ organization, onPress }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [imageFailed, setImageFailed] = React.useState(false);
  const isActiveMember = Boolean(organization?.membership?.is_active);
  const isPendingMember = Boolean(organization?.membership?.is_pending);
  const joinButtonTitle = isActiveMember ? 'Joined' : isPendingMember ? 'Pending' : 'Join';
  const joinButtonIsSecondary = isActiveMember || isPendingMember;

  React.useEffect(() => {
    setImageFailed(false);
  }, [organization?.organization_logo_url]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.orgJoinCard,
        { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder },
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={[styles.orgJoinLogoWrap, { backgroundColor: roles.supportCardBackground, borderColor: roles.defaultCardBorder }]}>
        {organization?.organization_logo_url && !imageFailed ? (
          <Image
            source={{ uri: organization.organization_logo_url }}
            style={styles.orgJoinLogo}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <Text style={[styles.orgJoinInitials, { color: roles.primaryActionBackground }]}>
            {getInitials(organization?.organization_name)}
          </Text>
        )}
      </View>

      <Text numberOfLines={2} style={[styles.orgJoinName, { color: roles.headingText }]}>
        {organization?.organization_name || 'Partner organization'}
      </Text>
      <Text numberOfLines={3} style={[styles.orgJoinDescription, { color: roles.bodyText }]}>
        {organization?.organization_type
          ? `${organization.organization_type} partner for Donivra donation drives.`
          : 'Partner organization for hair donation activities.'}
      </Text>

      <View style={styles.orgJoinMetaRow}>
        <View style={styles.orgJoinMetaItem}>
          <MaterialCommunityIcons name="account-group-outline" size={15} color={roles.metaText} />
          <Text style={[styles.orgJoinMetaText, { color: roles.metaText }]}>Partner</Text>
        </View>
        <View style={[styles.orgJoinDot, { backgroundColor: roles.defaultCardBorder }]} />
        <View style={styles.orgJoinMetaItem}>
          <MaterialCommunityIcons name="map-marker-outline" size={15} color={roles.metaText} />
          <Text numberOfLines={1} style={[styles.orgJoinMetaText, { color: roles.metaText }]}>
            {organization?.location_label || 'Philippines'}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.orgJoinButton,
          {
            backgroundColor: joinButtonIsSecondary ? roles.supportCardBackground : roles.primaryActionBackground,
            borderColor: joinButtonIsSecondary ? roles.defaultCardBorder : roles.primaryActionBackground,
          },
        ]}
      >
        <MaterialCommunityIcons
          name={isActiveMember ? 'check' : isPendingMember ? 'clock-outline' : 'plus'}
          size={16}
          color={joinButtonIsSecondary ? roles.bodyText : roles.primaryActionText}
        />
        <Text style={[
          styles.orgJoinButtonText,
          { color: joinButtonIsSecondary ? roles.bodyText : roles.primaryActionText },
        ]}>
          {joinButtonTitle}
        </Text>
      </View>
    </Pressable>
  );
}

// eslint-disable-next-line no-unused-vars
function OrganizationHomeSection({
  organizations,
  searchQuery,
  onSearchChange,
  onOpenOrganization,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredOrganizations = React.useMemo(() => (
    organizations.filter((organization) => {
      if (!normalizedQuery) return true;
      return [
        organization.organization_name,
        organization.organization_type,
        organization.location_label,
        organization.address_label,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    })
  ), [normalizedQuery, organizations]);
  return (
    <View style={styles.organizationHome}>
      <View style={[styles.organizationSearchShell, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
        <MaterialCommunityIcons name="magnify" size={22} color={roles.metaText} />
          <TextInput
            value={searchQuery}
            onChangeText={onSearchChange}
          placeholder="Search organizations..."
          placeholderTextColor={roles.metaText}
          style={[styles.organizationSearchInput, { color: roles.headingText }]}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.section}>
        <HomeSectionHeader title="Organizations You Can Join" />
        {filteredOrganizations.length ? (
          <View style={styles.orgJoinGrid}>
            {filteredOrganizations.slice(0, 6).map((organization) => (
              <OrganizationHomeCard
                key={`org-join-${organization.organization_id}`}
                organization={organization}
                onPress={() => onOpenOrganization(organization)}
              />
            ))}
          </View>
        ) : (
          <Text style={[styles.emptySectionText, { color: roles.bodyText }]}>No organizations matched your search.</Text>
        )}
      </View>

    </View>
  );
}

function HomeSectionHeader({ title, icon = 'file-document-outline', actionLabel, onActionPress, style }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);

  return (
    <View style={[styles.homeSectionHeader, style]}>
      <SectionTitleRow
        title={title}
        icon={icon}
        color={roles.headingText}
        iconColor={roles.primaryActionBackground}
        accentColor={roles.primaryActionBackground}
        titleStyle={styles.homeSectionTitle}
      />
      {actionLabel && onActionPress ? (
        <Pressable onPress={onActionPress} style={styles.homeSectionAction}>
          <Text style={[styles.homeSectionActionText, { color: roles.primaryActionBackground }]}>
            {actionLabel}
          </Text>
          <AppIcon name="chevronRight" size="sm" color={roles.primaryActionBackground} />
        </Pressable>
      ) : null}
    </View>
  );
}

function DonationEventsGroupHeader({ title }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);

  return (
    <View style={styles.donationEventsGroupHeader}>
      <Text style={[styles.donationEventsGroupTitle, { color: roles.headingText }]}>
        {title}
      </Text>
      <View style={[styles.donationEventsGroupLine, { backgroundColor: roles.defaultCardBorder }]} />
    </View>
  );
}

function DonationEventsVisibilityDropdown({ value, onChange }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [isOpen, setIsOpen] = React.useState(false);
  const activeOption = getDonationEventVisibilityOption(value);

  const handleSelect = (nextValue) => {
    onChange?.(nextValue);
    setIsOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select donation visibility filter. Current value ${activeOption.label}`}
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [
          styles.donationEventsVisibilityButton,
          {
            width: '100%',
            backgroundColor: roles.pageBackground,
            borderColor: roles.defaultCardBorder,
          },
          pressed ? styles.cardPressed : null,
        ]}
      >
        <View style={styles.donationEventsVisibilityButtonCopy}>
          <MaterialCommunityIcons name="filter-variant" size={18} color={roles.primaryActionBackground} />
          <Text style={[styles.donationEventsVisibilityButtonText, { color: roles.bodyText }]}>
            {activeOption.label}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={roles.metaText}
        />
      </Pressable>

      <Modal
        transparent
        visible={isOpen}
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <View style={styles.donationEventsVisibilityOverlay}>
          <Pressable
            style={styles.donationEventsVisibilityBackdrop}
            onPress={() => setIsOpen(false)}
          />
          <AppCard
            variant="elevated"
            radius="md"
            padding="none"
            style={[
              styles.donationEventsVisibilityMenuCard,
              {
                backgroundColor: roles.pageBackground,
                borderColor: roles.defaultCardBorder,
              },
            ]}
            contentStyle={styles.donationEventsVisibilityMenuContent}
          >
            {DONATION_EVENT_VISIBILITY_OPTIONS.map((option) => {
              const isSelected = option.key === value;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  onPress={() => handleSelect(option.key)}
                  style={({ pressed }) => [
                    styles.donationEventsVisibilityMenuItem,
                    {
                      backgroundColor: isSelected ? roles.iconPrimarySurface : 'transparent',
                    },
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  <Text style={[
                    styles.donationEventsVisibilityMenuText,
                    { color: isSelected ? roles.primaryActionBackground : roles.headingText },
                  ]}>
                    {option.label}
                  </Text>
                  {isSelected ? (
                    <MaterialCommunityIcons
                      name="check"
                      size={18}
                      color={roles.primaryActionBackground}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </AppCard>
        </View>
      </Modal>
    </>
  );
}

function DonationEventsSortDropdown({ value, onChange }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [isOpen, setIsOpen] = React.useState(false);
  const activeOption = getDonationEventSortOption(value);

  const handleSelect = (nextValue) => {
    onChange?.(nextValue);
    setIsOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select donation sort order. Current value ${activeOption.label}`}
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [
          styles.donationEventsVisibilityButton,
          {
            width: '100%',
            backgroundColor: roles.pageBackground,
            borderColor: roles.defaultCardBorder,
          },
          pressed ? styles.cardPressed : null,
        ]}
      >
        <View style={styles.donationEventsVisibilityButtonCopy}>
          <MaterialCommunityIcons name="sort" size={18} color={roles.primaryActionBackground} />
          <Text style={[styles.donationEventsVisibilityButtonText, { color: roles.bodyText }]}>
            {activeOption.label}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={roles.metaText}
        />
      </Pressable>

      <Modal
        transparent
        visible={isOpen}
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <View style={styles.donationEventsVisibilityOverlay}>
          <Pressable
            style={styles.donationEventsVisibilityBackdrop}
            onPress={() => setIsOpen(false)}
          />
          <AppCard
            variant="elevated"
            radius="md"
            padding="none"
            style={[
              styles.donationEventsSortMenuCard,
              {
                backgroundColor: roles.pageBackground,
                borderColor: roles.defaultCardBorder,
              },
            ]}
            contentStyle={styles.donationEventsVisibilityMenuContent}
          >
            {DONATION_EVENT_SORT_OPTIONS.map((option) => {
              const isSelected = option.key === value;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  onPress={() => handleSelect(option.key)}
                  style={({ pressed }) => [
                    styles.donationEventsVisibilityMenuItem,
                    {
                      backgroundColor: isSelected ? roles.iconPrimarySurface : 'transparent',
                    },
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  <Text style={[
                    styles.donationEventsVisibilityMenuText,
                    { color: isSelected ? roles.primaryActionBackground : roles.headingText },
                  ]}>
                    {option.label}
                  </Text>
                  {isSelected ? (
                    <MaterialCommunityIcons
                      name="check"
                      size={18}
                      color={roles.primaryActionBackground}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </AppCard>
        </View>
      </Modal>
    </>
  );
}

function AiInsightCard({ message }) {
  const { resolvedTheme } = useAuth();
  const bodyFont = resolvedTheme?.fontFamily || theme.typography.fontFamily;

  return (
    <LinearGradient
      colors={['#2a060c', '#4e0c16', '#74152c']}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.aiInsightCard}
    >
      <MaterialCommunityIcons name="lightbulb-on-outline" size={15} color="#f5dfa8" />
      <Text style={[styles.aiInsightText, { fontFamily: bodyFont }]} numberOfLines={2}>
        {message || 'Start your first hair check when you are ready.'}
      </Text>
    </LinearGradient>
  );
}
// eslint-disable-next-line no-unused-vars
function OrganizationPreviewModal({
  visible,
  organization,
  isLoading,
  errorMessage,
  feedbackMessage,
  feedbackVariant,
  isJoining,
  onClose,
  onJoinOrganization,
  onViewOrganization,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [isJoinConfirmOpen, setIsJoinConfirmOpen] = React.useState(false);
  const isActiveMember = Boolean(organization?.membership?.is_active);
  const isPendingMember = Boolean(organization?.membership?.is_pending);
  const organizationIsJoinable = (
    String(organization?.status || '').trim().toLowerCase() === 'active'
    && Boolean(organization?.is_approved)
    && String(organization?.approval_status || '').trim().toLowerCase() === 'approved'
  );
  const joinButtonTitle = isActiveMember
    ? 'Joined'
    : isPendingMember
      ? 'Pending approval'
      : 'Join organization';
  const membershipMessage = errorMessage
    || feedbackMessage
    || (isPendingMember ? 'Your request is pending. We will notify you once approved.' : '')
    || (!organizationIsJoinable && organization && !isActiveMember
      ? 'This organization is not available to join right now.'
      : '');
  const membershipVariant = errorMessage
    ? 'error'
    : feedbackMessage
      ? feedbackVariant || 'info'
      : isActiveMember
        ? 'success'
        : 'info';

  React.useEffect(() => {
    setImageFailed(false);
  }, [organization?.organization_logo_url]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.previewModalOverlay}>
        <Pressable style={styles.previewModalBackdrop} onPress={onClose} />

        <AppCard variant="elevated" radius="xl" padding="lg" style={styles.previewModalCard}>
          <View style={styles.previewModalHeader}>
            <View style={styles.previewModalHeaderCopy}>
              <Text style={[styles.previewEyebrow, { color: roles.metaText }]}>Organization</Text>
              <Text style={[styles.previewTitle, { color: roles.headingText }]}>
                {organization?.organization_name || 'Organization preview'}
              </Text>
            </View>

            <Pressable onPress={onClose} style={[styles.previewCloseButton, { backgroundColor: roles.supportCardBackground }]}>
              <AppIcon name="close" size="sm" state="muted" />
            </Pressable>
          </View>

          {membershipMessage ? (
            <StatusBanner
              variant={membershipVariant}
              message={membershipMessage}
              style={styles.previewBanner}
            />
          ) : null}

          {isLoading ? (
            <View style={styles.previewLoadingState}>
              <ActivityIndicator color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
              <Text style={[styles.loadingText, { color: roles.bodyText }]}>Loading organization</Text>
            </View>
          ) : organization ? (
            <>
              <View style={styles.organizationPreviewSummary}>
                <View style={[styles.organizationPreviewLogoWrap, { backgroundColor: roles.supportCardBackground, borderColor: roles.supportCardBorder }]}>
                  {organization.organization_logo_url && !imageFailed ? (
                    <Image
                      source={{ uri: organization.organization_logo_url }}
                      style={styles.organizationPreviewLogo}
                      resizeMode="cover"
                      onError={() => setImageFailed(true)}
                    />
                  ) : (
                    <AppIcon name="organization" size="md" state="default" color={roles.headingText} />
                  )}
                </View>

                <View style={styles.organizationPreviewCopy}>
                  {isActiveMember ? (
                    <View style={[styles.organizationPreviewPill, { backgroundColor: roles.iconPrimarySurface }]}>
                      <MaterialCommunityIcons name="check" size={13} color={roles.primaryActionBackground} />
                      <Text style={[styles.organizationPreviewPillText, { color: roles.primaryActionBackground }]}>Joined</Text>
                    </View>
                  ) : null}
                  {organization.organization_type ? (
                    <Text style={[styles.previewSupportText, { color: roles.metaText }]}>
                      {organization.organization_type}
                    </Text>
                  ) : null}
                  {organization.location_label ? (
                    <Text style={[styles.previewStatusText, { color: roles.metaText }]}>
                      {organization.location_label}
                    </Text>
                  ) : null}
                  {organization.contact_number ? (
                    <Text style={[styles.previewStatusText, { color: roles.metaText }]}>
                      {organization.contact_number}
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.organizationPreviewActions}>
                <AppButton
                  title="View details"
                  variant="outline"
                  fullWidth={false}
                  onPress={onViewOrganization}
                />
                <AppButton
                  title={joinButtonTitle}
                  fullWidth={false}
                  onPress={() => setIsJoinConfirmOpen(true)}
                  disabled={isActiveMember || isPendingMember || !organizationIsJoinable}
                  loading={isJoining}
                />
              </View>
            </>
          ) : (
            <Text style={[styles.emptySectionText, { color: roles.bodyText }]}>
              Organization details are not available right now.
            </Text>
          )}
        </AppCard>
      </View>
      <Modal transparent visible={isJoinConfirmOpen} animationType="fade" onRequestClose={() => setIsJoinConfirmOpen(false)}>
        <View style={styles.joinModalOverlay}>
          <Pressable style={styles.joinModalBackdrop} onPress={() => setIsJoinConfirmOpen(false)} />
          <AppCard variant="elevated" radius="xl" padding="lg" style={styles.joinModalCard}>
            <Text style={styles.joinModalTitle}>Send Join Request?</Text>
            <Text style={styles.joinModalBody}>
              Your membership will be pending until approved by the organization.
            </Text>
            <View style={styles.joinModalActions}>
              <AppButton title="Cancel" variant="outline" fullWidth={false} onPress={() => setIsJoinConfirmOpen(false)} />
              <AppButton
                title="Confirm"
                fullWidth={false}
                loading={isJoining}
                onPress={async () => {
                  setIsJoinConfirmOpen(false);
                  await onJoinOrganization?.();
                }}
              />
            </View>
          </AppCard>
        </View>
      </Modal>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS FOR DAILY REMINDER & ANALYTICS

const conditionScoreMap = {
  healthy: 5,
  good: 4,
  'fair': 3,
  improving: 3.5,
  'needs care': 2,
  poor: 1,
  dry: 2,
  damaged: 1.5,
  treated: 3,
  rebonded: 3,
  colored: 3,
};

const normalizeConditionForChart = (condition = '') => {
  const normalized = String(condition || '').trim().toLowerCase();
  for (const [key, score] of Object.entries(conditionScoreMap)) {
    if (normalized.includes(key)) return score;
  }
  return 2.5; // default middle score
};

// Build analytics data from submissions
const buildAnalyticsData = (submissions = []) => {
  const allScreenings = submissions
    .flatMap((s) => (s?.ai_screenings || []).map((screening) => ({ submission: s, screening })))
    .filter((entry) => entry.screening?.created_at)
    .sort((a, b) => new Date(a.screening.created_at) - new Date(b.screening.created_at));

  if (!allScreenings.length) {
    return {
      hasHistory: false,
      chartData: [],
      latestStatus: null,
      latestAnalysis: null,
      trendDirection: null,
    };
  }

  // Get last 10 screenings for chart
  const recentScreenings = allScreenings.slice(-10);

  // Map to chart data
  const chartData = recentScreenings.map((entry) => ({
    date: toLocalDateKey(entry.screening.created_at),
    displayDate: formatDayLabel(entry.screening.created_at),
    value: normalizeConditionForChart(entry.screening.detected_condition),
    condition: entry.screening.detected_condition,
  }));

  // Calculate trend
  const latestValue = chartData[chartData.length - 1]?.value || 2.5;
  const earliestValue = chartData[0]?.value || 2.5;
  let trendDirection = '→';
  if (latestValue > earliestValue + 0.3) trendDirection = '↑';
  else if (latestValue < earliestValue - 0.3) trendDirection = '↓';

  return {
    hasHistory: true,
    chartData,
    latestStatus: normalizeConditionTone(allScreenings[allScreenings.length - 1]?.screening?.detected_condition),
    latestAnalysis: allScreenings[allScreenings.length - 1]?.screening || null,
    trendDirection,
  };
};

// Build daily reminder state from submissions
// eslint-disable-next-line no-unused-vars
const buildDailyReminder = (submissions = []) => {
  const today = toLocalDateKey(new Date());

  const allScreenings = submissions
    .flatMap((s) => (s?.ai_screenings || []).map((screening) => ({ submission: s, screening })))
    .filter((entry) => entry.screening?.created_at);

  if (!allScreenings.length) {
    return {
      type: 'first-time',
      title: 'Start your hair check',
      subtitle: 'No analysis yet. Begin with CheckHair to understand your hair condition.',
      buttonLabel: 'Start CheckHair',
    };
  }

  // Check if analysis done today
  const todayScreenings = allScreenings.filter((entry) => toLocalDateKey(entry.screening.created_at) === today);

  if (todayScreenings.length > 0) {
    // Already analyzed today - show improvement tip
    const latestToday = todayScreenings[todayScreenings.length - 1];
    const decision = latestToday.screening.decision || latestToday.screening.summary || 'Keep following your routine';
    const summary = String(decision)
      .trim()
      .split('\n')[0] // first line only
      .slice(0, 100); // max 100 chars

    return {
      type: 'analyzed-today',
      title: "Today's care tip",
      subtitle: summary || 'Check your latest result for more details',
      buttonLabel: 'View Hair Log',
    };
  }

  // No analysis today - remind
  return {
    type: 'reminder',
    title: "You haven't checked your hair today",
    subtitle: 'Quick hair check takes 1 minute',
    buttonLabel: 'Start CheckHair',
  };
};

const WEEKLY_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const buildHairReminderMessage = (submissions = []) => {
  const entries = getScreeningEntries(submissions);
  if (!entries.length) {
    return 'You have no hair log yet. Start CheckHair to track your progress.';
  }

  const latest = entries[0]?.screening || null;
  const assessment = getCanonicalHairAssessment(latest);
  const needsCare = assessment.needsCare;
  const createdAt = latest?.created_at ? new Date(latest.created_at) : null;
  const nextScanAt = createdAt ? new Date(createdAt.getTime() + WEEKLY_SCAN_INTERVAL_MS) : null;
  const scanReady = !nextScanAt || Date.now() >= nextScanAt.getTime();
  const nextScanLabel = nextScanAt
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(nextScanAt)
    : '';

  if (scanReady) {
    return needsCare
      ? `Your weekly scan is ready. Last result: ${assessment.label}. Run a new check to see if your hair improved.`
      : `Your weekly scan is ready. Last result: ${assessment.label}. Run a quick check to confirm it is maintained.`;
  }

  return needsCare
    ? `Last result: ${assessment.label}. Continue gentle care this week. Next scan: ${nextScanLabel}.`
    : `Great job. Last result: ${assessment.label}. Keep your routine. Next scan: ${nextScanLabel}.`;
};

// eslint-disable-next-line no-unused-vars
const buildContextualGreeting = ({ hasHistory, latestCondition, checkedToday, daysSinceLastLog, latestRecommendation }) => {
  if (!hasHistory) return 'Start your first hair check to get personalized insights.';
  const tone = normalizeConditionTone(latestCondition || '');
  if (checkedToday) {
    return tone.label === 'Healthy'
      ? 'Your hair is healthy today. Keep it up!'
      : `Today's check shows ${tone.label.toLowerCase()}. See your care tips below.`;
  }
  const days = Number(daysSinceLastLog) || 0;
  const daysText = days === 1 ? '1 day' : `${days} days`;
  if (days > 1) {
    return tone.label !== 'Healthy'
      ? `You haven't logged for ${daysText}. Based on your previous log, you had ${tone.label.toLowerCase()} hair. Have you tried the recommendations?`
      : `It's been ${daysText} since your last check. Your hair was healthy last time, so check in again.`;
  }
  return tone.label !== 'Healthy'
    ? `Your last check showed ${tone.label.toLowerCase()} hair. Have you tried the care tips we shared?`
    : `Last check: ${tone.label.toLowerCase()}. Ready for today's check?`;
};
// ─────────────────────────────────────────────────────────────────────────────

export default function DonorHomeScreen() {
  const router = useRouter();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const headerPrimaryColor = resolvedTheme?.primaryColor || roles.primaryActionBackground;
  const { logout, isLoading: isLoggingOut } = useAuthActions();
  const {
    unreadCount,
  } = useNotifications({
    role: 'donor',
    userId: user?.id,
    userEmail: user?.email || profile?.email || '',
    databaseUserId: profile?.user_id,
    mode: 'badge',
    liveUpdates: true,
  });
  const homeCacheMatchesUser = Boolean(cachedDonorHomeData && cachedDonorHomeUserId === user?.id);
  const cachedHome = homeCacheMatchesUser ? cachedDonorHomeData : null;
  const homeCacheRef = React.useRef(cachedHome);
  const shouldAnimateHomeSections = !homeCacheMatchesUser;
  const [isLoadingHome, setIsLoadingHome] = React.useState(!homeCacheMatchesUser);
  const [homeError, setHomeError] = React.useState('');
  const [donationDrives, setDonationDrives] = React.useState(cachedHome?.donationDrives || []);
  const [hairSubmissions, setHairSubmissions] = React.useState(cachedHome?.hairSubmissions || []);
  const [registeredEventDrives, setRegisteredEventDrives] = React.useState(cachedHome?.registeredEventDrives || []);
  const [donationRequirement, setDonationRequirement] = React.useState(cachedHome?.donationRequirement || null);
  const [latestRecommendation, setLatestRecommendation] = React.useState(cachedHome?.latestRecommendation || null);
  const [donationEventSearchQuery, setDonationEventSearchQuery] = React.useState('');
  const [donationEventSortOrder, setDonationEventSortOrder] = React.useState('nearest');
  const [donationEventVisibilityFilter, setDonationEventVisibilityFilter] = React.useState('all');
  const [privateEventCode, setPrivateEventCode] = React.useState('');
  const [isUnlockingPrivateEvent, setIsUnlockingPrivateEvent] = React.useState(false);
  const [isPrivateAccessModalVisible, setIsPrivateAccessModalVisible] = React.useState(false);
  const [privateUnlockMessage, setPrivateUnlockMessage] = React.useState('');
  const [privateUnlockVariant, setPrivateUnlockVariant] = React.useState('info');
  const [activeHomeTab, setActiveHomeTab] = React.useState('overview');
  const [certificateToastMessage, setCertificateToastMessage] = React.useState('');
  const [isTutorialOpen, setIsTutorialOpen] = React.useState(false);
  const privateAccessFabPosition = React.useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const privateAccessFabDragStart = React.useRef({ x: 0, y: 0 });
  const hasInitializedFabPosition = React.useRef(false);
  const privateAccessFabBounds = React.useMemo(() => {
    const minX = PRIVATE_ACCESS_FAB_EDGE_PADDING;
    const maxX = Math.max(
      minX,
      viewportWidth - PRIVATE_ACCESS_FAB_SIZE - PRIVATE_ACCESS_FAB_EDGE_PADDING
    );
    const minY = PRIVATE_ACCESS_FAB_TOP_PADDING;
    const maxY = Math.max(
      minY,
      viewportHeight - PRIVATE_ACCESS_FAB_SIZE - PRIVATE_ACCESS_FAB_BOTTOM_PADDING
    );
    return { minX, maxX, minY, maxY };
  }, [viewportHeight, viewportWidth]);

  const clampPrivateAccessFab = React.useCallback((x, y) => {
    const clampedX = Math.min(
      privateAccessFabBounds.maxX,
      Math.max(privateAccessFabBounds.minX, x)
    );
    const clampedY = Math.min(
      privateAccessFabBounds.maxY,
      Math.max(privateAccessFabBounds.minY, y)
    );
    return { x: clampedX, y: clampedY };
  }, [
    privateAccessFabBounds.maxX,
    privateAccessFabBounds.maxY,
    privateAccessFabBounds.minX,
    privateAccessFabBounds.minY,
  ]);

  const snapPrivateAccessFabToEdge = React.useCallback((x, y, animate = true) => {
    const clamped = clampPrivateAccessFab(x, y);
    const snapToLeft = (clamped.x - privateAccessFabBounds.minX) <= (privateAccessFabBounds.maxX - clamped.x);
    const snapX = snapToLeft ? privateAccessFabBounds.minX : privateAccessFabBounds.maxX;
    const toValue = { x: snapX, y: clamped.y };

    if (!animate) {
      privateAccessFabPosition.setValue(toValue);
      return;
    }

    Animated.spring(privateAccessFabPosition, {
      toValue,
      damping: 20,
      stiffness: 240,
      mass: 0.9,
      useNativeDriver: false,
    }).start();
  }, [
    clampPrivateAccessFab,
    privateAccessFabBounds.maxX,
    privateAccessFabBounds.minX,
    privateAccessFabPosition,
  ]);

  React.useEffect(() => {
    privateAccessFabPosition.stopAnimation((current = { x: privateAccessFabBounds.maxX, y: privateAccessFabBounds.maxY }) => {
      if (!hasInitializedFabPosition.current) {
        privateAccessFabPosition.setValue({
          x: privateAccessFabBounds.maxX,
          y: privateAccessFabBounds.maxY,
        });
        hasInitializedFabPosition.current = true;
        return;
      }
      snapPrivateAccessFabToEdge(current.x, current.y, false);
    });
  }, [
    privateAccessFabBounds.maxX,
    privateAccessFabBounds.maxY,
    privateAccessFabPosition,
    snapPrivateAccessFabToEdge,
  ]);

  const privateAccessFabPanResponder = React.useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gestureState) => (
      Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3
    ),
    onPanResponderGrant: () => {
      privateAccessFabPosition.stopAnimation((current = { x: privateAccessFabBounds.maxX, y: privateAccessFabBounds.maxY }) => {
        privateAccessFabDragStart.current = clampPrivateAccessFab(current.x, current.y);
      });
    },
    onPanResponderMove: (_event, gestureState) => {
      const nextX = privateAccessFabDragStart.current.x + gestureState.dx;
      const nextY = privateAccessFabDragStart.current.y + gestureState.dy;
      privateAccessFabPosition.setValue(clampPrivateAccessFab(nextX, nextY));
    },
    onPanResponderRelease: (_event, gestureState) => {
      const releaseX = privateAccessFabDragStart.current.x + gestureState.dx;
      const releaseY = privateAccessFabDragStart.current.y + gestureState.dy;
      snapPrivateAccessFabToEdge(releaseX, releaseY, true);
    },
    onPanResponderTerminate: (_event, gestureState) => {
      const releaseX = privateAccessFabDragStart.current.x + gestureState.dx;
      const releaseY = privateAccessFabDragStart.current.y + gestureState.dy;
      snapPrivateAccessFabToEdge(releaseX, releaseY, true);
    },
  }), [
    clampPrivateAccessFab,
    privateAccessFabBounds.maxX,
    privateAccessFabBounds.maxY,
    privateAccessFabPosition,
    snapPrivateAccessFabToEdge,
  ]);

  const firstName = String(profile?.first_name || '').trim();
  const lastName = String(profile?.last_name || '').trim();
  const avatarInitials = [firstName?.[0], lastName?.[0]].filter(Boolean).join('').toUpperCase();
  const avatarUri = profile?.avatar_url || profile?.photo_path || '';

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
  const areCredentialsCompleted = profileCompletionMeta.isComplete;
  const normalizedDonationEventSearchQuery = React.useMemo(
    () => normalizeDonationEventSearchText(donationEventSearchQuery),
    [donationEventSearchQuery],
  );
  const filteredDonationDrives = React.useMemo(() => {
    const source = Array.isArray(donationDrives) ? donationDrives : [];
    const searchedDrives = normalizedDonationEventSearchQuery
      ? source.filter((drive) => getDonationEventSearchText(drive).includes(normalizedDonationEventSearchQuery))
      : source;
    const visibilityFilteredDrives = donationEventVisibilityFilter === 'public'
      ? searchedDrives.filter((drive) => drive?.is_public || drive?.visibility_scope === 'public')
      : donationEventVisibilityFilter === 'private'
        ? searchedDrives.filter((drive) => !(drive?.is_public || drive?.visibility_scope === 'public'))
        : searchedDrives;
    return sortDonationDrivesByDate(visibilityFilteredDrives, donationEventSortOrder);
  }, [
    donationDrives,
    donationEventSortOrder,
    donationEventVisibilityFilter,
    normalizedDonationEventSearchQuery,
  ]);
  const publicDonationDrives = React.useMemo(() => (
    filteredDonationDrives.filter((drive) => drive?.is_public || drive?.visibility_scope === 'public')
  ), [filteredDonationDrives]);
  const privateDonationDrives = React.useMemo(() => (
    filteredDonationDrives.filter((drive) => !(drive?.is_public || drive?.visibility_scope === 'public'))
  ), [filteredDonationDrives]);
  const donationEventsVisibilityLabel = getDonationEventVisibilityOption(donationEventVisibilityFilter).label;
  const showPublicDonationSection = donationEventVisibilityFilter !== 'private';
  const showPrivateDonationSection = donationEventVisibilityFilter !== 'public';
  const donationEventsEmptyTitle = normalizedDonationEventSearchQuery
    ? 'No matching events found'
    : donationEventVisibilityFilter === 'public'
      ? 'No public events available'
      : donationEventVisibilityFilter === 'private'
        ? 'No private events available'
        : 'No active donation drives';
  const donationEventsEmptyMessage = normalizedDonationEventSearchQuery
    ? 'Try a different keyword or change the date or visibility filter.'
    : donationEventVisibilityFilter === 'all'
      ? 'Public and private events will appear here when available.'
      : `Only ${donationEventsVisibilityLabel.toLowerCase()} events will appear here.`;

  const loadHome = React.useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) return;
    const cachedAt = Number(homeCacheRef.current?.cachedAt || 0);
    const cacheIsFresh = cachedAt && (Date.now() - cachedAt) < HOME_CACHE_FRESH_MS;
    if (silent && cacheIsFresh) return;

    if (!silent && !homeCacheRef.current) {
      setIsLoadingHome(true);
    }
    setHomeError('');

    const [
      donationModuleResult,
      upcomingDrivesResult,
      submissionsResult,
      registeredDrivesResult,
      recommendationResult,
      requirementResult,
    ] = await Promise.all([
      getDonorDonationsModuleData({
        userId: user.id,
        databaseUserId: profile?.user_id || null,
        driveLimit: 8,
      }),
      fetchUpcomingDonationDrives(12, profile?.user_id || null),
      fetchHairSubmissionsByUserId(user.id, 12),
      fetchRegisteredDonationDrivesByUserId({
        databaseUserId: profile?.user_id || null,
        limit: 24,
      }),
      fetchLatestDonorRecommendationByUserId(user.id).catch(() => ({ data: null })),
      fetchLatestDonationRequirement().catch((error) => ({ data: null, error })),
    ]);

    const visibleDriveRows = Array.isArray(upcomingDrivesResult.data)
      ? upcomingDrivesResult.data
      : [];
    const nextDonationDrives = visibleDriveRows.filter(isDriveActiveForHome);
    const nextHairSubmissions = submissionsResult.data || [];
    const nextRegisteredEventDrives = registeredDrivesResult.data || [];
    const nextLatestRecommendation = recommendationResult?.data || null;
    const nextDonationRequirement = requirementResult?.data || null;
    const nextHomeData = {
      donationDrives: nextDonationDrives,
      hairSubmissions: nextHairSubmissions,
      registeredEventDrives: nextRegisteredEventDrives,
      latestRecommendation: nextLatestRecommendation,
      donationRequirement: nextDonationRequirement,
      cachedAt: Date.now(),
    };
    cachedDonorHomeData = nextHomeData;
    cachedDonorHomeUserId = user.id;
    homeCacheRef.current = nextHomeData;
    setDonationDrives(nextDonationDrives);
    setHairSubmissions(nextHairSubmissions);
    setRegisteredEventDrives(nextRegisteredEventDrives);
    setLatestRecommendation(nextLatestRecommendation);
    setDonationRequirement(nextDonationRequirement);
    const loadFailed = Boolean(
      donationModuleResult.error
      || upcomingDrivesResult.error
      || submissionsResult.error
      || registeredDrivesResult.error
      || requirementResult?.error
    );
    const friendlyRegistrationError = registeredDrivesResult.error?.isTransient
      ? registeredDrivesResult.error.message
      : '';
    setHomeError(loadFailed
      ? (friendlyRegistrationError || 'Some updates could not load. Pull down to try again.')
      : '');
    setIsLoadingHome(false);

  }, [profile?.user_id, user?.id]);

  const homeRealtimeRefreshRef = React.useRef(null);
  const scheduleHomeRealtimeRefresh = React.useCallback(() => {
    if (homeRealtimeRefreshRef.current) {
      clearTimeout(homeRealtimeRefreshRef.current);
    }

    homeRealtimeRefreshRef.current = setTimeout(() => {
      void loadHome({ silent: true });
    }, HOME_REALTIME_DEBOUNCE_MS);
  }, [loadHome]);

  React.useEffect(() => {
    if (homeCacheRef.current) return;
    loadHome();
  }, [loadHome]);

  useFocusEffect(
    React.useCallback(() => {
      void loadHome({ silent: true });
      return undefined;
    }, [loadHome])
  );

  React.useEffect(() => {
    return () => {
      if (homeRealtimeRefreshRef.current) {
        clearTimeout(homeRealtimeRefreshRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!user?.id || !profile?.user_id) return undefined;

    const channel = supabase.channel(`donor-home-live-${profile.user_id}`);
    const onRealtimeEvent = () => {
      scheduleHomeRealtimeRefresh();
    };
    const onCertificateRealtimeEvent = (payload = {}) => {
      if (payload?.eventType !== 'INSERT') return;
      setCertificateToastMessage('Certificate is now available in Achievements.');
      scheduleHomeRealtimeRefresh();
    };

    channel
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Event_Requests',
      }, onRealtimeEvent)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Event_Attendees',
        filter: `User_ID=eq.${profile.user_id}`,
      }, onRealtimeEvent)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Hair_Submissions',
        filter: `User_ID=eq.${profile.user_id}`,
      }, onRealtimeEvent)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'wig_requirements',
      }, onRealtimeEvent)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'Donation_Certificates',
        filter: `User_ID=eq.${profile.user_id}`,
      }, onCertificateRealtimeEvent)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.user_id, scheduleHomeRealtimeRefresh, user?.id]);

  // Compute daily reminder and analytics data
  const analyticsData = React.useMemo(() => buildAnalyticsData(hairSubmissions), [hairSubmissions]);
  const homeReminderMessage = React.useMemo(() => buildHairReminderMessage(hairSubmissions), [hairSubmissions]);
  const showHairActivityCalendar = analyticsData.hasHistory || registeredEventDrives.length > 0;
  const handleOpenHairLogEntry = React.useCallback((entry) => {
    const screeningId = entry?.screening?.ai_screening_id || entry?.screening?.id;
    if (!screeningId) return;
    router.push({
      pathname: '/donor/hair-check-details',
      params: { screeningId: String(screeningId) },
    });
  }, [router]);

  const handleOpenHairActivityDate = React.useCallback(({ dateKey, entries = [], events = [] }) => {
    const screening = entries[0]?.screening;
    const screeningId = screening?.ai_screening_id || screening?.id;
    if (screeningId) {
      router.push({
        pathname: '/donor/hair-check-details',
        params: { screeningId: String(screeningId) },
      });
      return;
    }

    const driveId = events[0]?.donation_drive_id || events[0]?.id;
    if (driveId) router.navigate(`/donor/drives/${driveId}`);
  }, [router]);

  const handleOpenHairLogHistory = React.useCallback(() => {
    router.navigate('/donor/donations?tab=history');
  }, [router]);

  const handleUnlockPrivateEvent = React.useCallback(async () => {
    if (!String(privateEventCode || '').trim()) {
      setPrivateUnlockMessage('Enter the private event code.');
      setPrivateUnlockVariant('error');
      return;
    }

    setIsUnlockingPrivateEvent(true);
    const result = await unlockPrivateEventAccess({
      accessCode: privateEventCode,
    });
    setIsUnlockingPrivateEvent(false);

    if (result.error) {
      setPrivateUnlockMessage(result.error.message || 'Private event unlock failed.');
      setPrivateUnlockVariant('error');
      return;
    }

    setPrivateUnlockMessage('Private event unlocked. You can now register.');
    setPrivateUnlockVariant('success');
    setPrivateEventCode('');
    setIsPrivateAccessModalVisible(false);
    setActiveHomeTab('events');
    let unlockedDriveId = extractDriveIdFromUnlockResult(result.data);
    await loadHome({ silent: false });
    if (!unlockedDriveId) {
      const firstUnlockedPrivateDrive = (homeCacheRef.current?.donationDrives || []).find((drive) => !drive?.is_public);
      const fallbackDriveId = Number(firstUnlockedPrivateDrive?.donation_drive_id || firstUnlockedPrivateDrive?.id || 0);
      if (Number.isFinite(fallbackDriveId) && fallbackDriveId > 0) {
        unlockedDriveId = fallbackDriveId;
      }
    }
    if (unlockedDriveId) {
      router.navigate(`/donor/drives/${unlockedDriveId}`);
    }
  }, [loadHome, privateEventCode, router]);

  const handleClosePrivateAccessModal = React.useCallback(() => {
    setPrivateEventCode('');
    setPrivateUnlockMessage('');
    setPrivateUnlockVariant('info');
    setIsPrivateAccessModalVisible(false);
  }, []);

  const handleNavPress = (item) => {
    if (!item.route) return;
    router.navigate(item.route);
  };

  const floatingPrivateAccessButton = (
    <Animated.View
      style={[
        styles.privateAccessFabFloatWrap,
        { left: privateAccessFabPosition.x, top: privateAccessFabPosition.y },
      ]}
      {...privateAccessFabPanResponder.panHandlers}
    >
      <Pressable
        onPress={() => setIsPrivateAccessModalVisible(true)}
        style={[
          styles.privateAccessFab,
          {
            backgroundColor: roles.primaryActionBackground,
            borderColor: roles.primaryActionBorder || roles.primaryActionBackground,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open private event access"
      >
        <MaterialCommunityIcons
          name="lock"
          size={20}
          color={roles.pageBackground || roles.defaultCardBackground || '#FFFFFF'}
        />
      </Pressable>
    </Animated.View>
  );

  return (
    <DashboardLayout
      navItems={donorDashboardNavItems}
      activeNavKey="home"
      navVariant="donor"
      onNavPress={handleNavPress}
      screenVariant="default"
      showSupportChat={false}
      chatModalPresentation="centered"
      draggableChat={true}
      floatingOverlay={floatingPrivateAccessButton}
      loadingOverlay={isLoadingHome ? (
        <DonivraLoadingOverlay visible label="Loading dashboard..." />
      ) : null}
      header={(
        <View style={[styles.dashboardHeaderSurface, { backgroundColor: headerPrimaryColor }]}>
          <DonorTopBar
            title={firstName || 'Donor'}
            subtitle="Hair Donor"
            avatarInitials={avatarInitials}
            avatarUri={avatarUri}
            unreadCount={unreadCount}
            showTutorialAction
            onTutorialPress={() => setIsTutorialOpen(true)}
            onNotificationsPress={() => router.navigate('/donor/notifications')}
            onProfilePress={() => router.navigate('/profile')}
            onLogoutPress={logout}
            isLoggingOut={isLoggingOut}
          />
        </View>
      )}
    >
      <DonorTutorialModal
        visible={isTutorialOpen}
        tabKey={activeHomeTab === 'events' ? 'homeEvents' : 'homeOverview'}
        onClose={() => setIsTutorialOpen(false)}
      />
      {homeError ? (
        <StatusBanner
          variant="info"
          message={homeError}
          presentation="floating"
          visible={Boolean(homeError)}
          autoDismissMs={3000}
          onDismiss={() => setHomeError('')}
        />
      ) : null}

      {privateUnlockMessage ? (
        <StatusBanner
          variant={privateUnlockVariant}
          message={privateUnlockMessage}
          presentation="floating"
          visible={Boolean(privateUnlockMessage)}
          autoDismissMs={2200}
          onDismiss={() => setPrivateUnlockMessage('')}
        />
      ) : null}

      {certificateToastMessage ? (
        <StatusBanner
          variant="success"
          message={certificateToastMessage}
          presentation="floating"
          visible={Boolean(certificateToastMessage)}
          autoDismissMs={2800}
          onDismiss={() => setCertificateToastMessage('')}
        />
      ) : null}

      <View style={styles.homeFeed}>
        <View style={[styles.homeModeTabs, { borderBottomColor: roles.defaultCardBorder }]}>
          <Pressable
            onPress={() => setActiveHomeTab('overview')}
            style={[
              styles.homeModeTab,
              activeHomeTab === 'overview' ? [styles.homeModeTabActive, { borderBottomColor: headerPrimaryColor }] : null,
            ]}
          >
            <Text
              style={[
                styles.homeModeTabText,
                { color: activeHomeTab === 'overview' ? headerPrimaryColor : roles.metaText },
              ]}
            >
              Overview
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveHomeTab('events')}
            style={[
              styles.homeModeTab,
              activeHomeTab === 'events' ? [styles.homeModeTabActive, { borderBottomColor: headerPrimaryColor }] : null,
            ]}
          >
            <Text
              style={[
                styles.homeModeTabText,
                { color: activeHomeTab === 'events' ? headerPrimaryColor : roles.metaText },
              ]}
            >
              Donation Events
            </Text>
          </Pressable>
        </View>

        {activeHomeTab === 'overview' ? (
          <>
            <AnimatedHomeSection delay={20} animate={shouldAnimateHomeSections}>
              <AiInsightCard
                message={homeReminderMessage}
              />
            </AnimatedHomeSection>

            <AnimatedHomeSection delay={45} style={styles.section} animate={shouldAnimateHomeSections}>
              <DonationRequirementsOverview requirement={donationRequirement} />
            </AnimatedHomeSection>

            {!areCredentialsCompleted ? (
              <AnimatedHomeSection delay={60} animate={shouldAnimateHomeSections}>
                <FinishSetupCard
                  completionMeta={profileCompletionMeta}
                  onManageProfile={() => router.navigate('/profile')}
                />
              </AnimatedHomeSection>
            ) : null}

            <AnimatedHomeSection
              delay={90}
              style={[styles.section, !areCredentialsCompleted ? styles.hairLogSectionAfterSetup : null]}
              animate={shouldAnimateHomeSections}
            >
              <HomeSectionHeader title="Hair Screening Log" />
              <RecentHairLogWidget
                hairSubmissions={hairSubmissions}
                latestRecommendation={latestRecommendation}
                onOpenLog={handleOpenHairLogEntry}
                onOpenHistory={handleOpenHairLogHistory}
              />
              {showHairActivityCalendar ? (
                <>
                  <HomeSectionHeader
                    title="Calendar"
                    icon="calendar-month-outline"
                    style={styles.calendarSectionHeader}
                  />
                  <HairCalendarWidget
                    hairSubmissions={hairSubmissions}
                    registeredEventDrives={registeredEventDrives}
                    onOpenDate={handleOpenHairActivityDate}
                  />
                </>
              ) : null}
            </AnimatedHomeSection>
          </>
        ) : null}

        {activeHomeTab === 'events' ? (
          <>
            <AnimatedHomeSection delay={140} style={styles.section} animate={shouldAnimateHomeSections}>
              {donationDrives.length ? (
                <View style={styles.donationEventsControls}>
                  <View style={[styles.donationEventsSearchShell, { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder }]}>
                    <MaterialCommunityIcons name="magnify" size={20} color={roles.primaryActionBackground} />
                    <TextInput
                      value={donationEventSearchQuery}
                      onChangeText={setDonationEventSearchQuery}
                      placeholder="Search donation events..."
                      placeholderTextColor={roles.metaText}
                      style={[styles.donationEventsSearchInput, { color: roles.headingText }]}
                      returnKeyType="search"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>

                  <View style={styles.donationEventsFiltersRow}>
                    <View style={styles.donationEventsFilterCell}>
                      <DonationEventsSortDropdown
                        value={donationEventSortOrder}
                        onChange={setDonationEventSortOrder}
                      />
                    </View>
                    <View style={styles.donationEventsFilterCell}>
                      <DonationEventsVisibilityDropdown
                        value={donationEventVisibilityFilter}
                        onChange={setDonationEventVisibilityFilter}
                      />
                    </View>
                  </View>
                </View>
              ) : null}

              <HomeSectionHeader title="Donation Events" />
              {donationDrives.length ? (
                <View style={styles.donationEventsPanel}>
                  {showPublicDonationSection && publicDonationDrives.length ? (
                    <View style={styles.donationEventsSection}>
                      <DonationEventsGroupHeader title="Public Events" />
                      <View style={styles.donationEventsCardList}>
                        {publicDonationDrives.map((drive) => (
                          <ActiveDonationDriveCard
                            key={`public-drive-${drive.donation_drive_id}`}
                            drive={drive}
                            onOpenDetails={() => {
                              router.navigate(`/donor/drives/${drive.donation_drive_id}`);
                            }}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {showPrivateDonationSection && privateDonationDrives.length ? (
                    <View style={styles.donationEventsSection}>
                      <DonationEventsGroupHeader title="Private Events" />
                      <View style={styles.donationEventsCardList}>
                        {privateDonationDrives.map((drive) => (
                          <ActiveDonationDriveCard
                            key={`private-drive-${drive.donation_drive_id}`}
                            drive={drive}
                            onOpenDetails={() => {
                              router.navigate(`/donor/drives/${drive.donation_drive_id}`);
                            }}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {!publicDonationDrives.length && !privateDonationDrives.length ? (
                    <DonationEventsEmptyState
                      title={donationEventsEmptyTitle}
                      message={donationEventsEmptyMessage}
                      style={styles.donationEventsEmptyState}
                    />
                  ) : null}
                </View>
              ) : (
                <View style={styles.donationEventsEmptyWrapper}>
                  <DonationEventsEmptyState />
                </View>
              )}
            </AnimatedHomeSection>
          </>
        ) : null}
      </View>

      <Modal
        transparent
        visible={isPrivateAccessModalVisible}
        animationType="fade"
        onRequestClose={handleClosePrivateAccessModal}
      >
        <View style={styles.privateAccessModalOverlay}>
          <Pressable style={styles.privateAccessModalBackdrop} onPress={handleClosePrivateAccessModal} />
          <AppCard
            variant="elevated"
            radius="lg"
            padding="none"
            style={[
              styles.privateAccessModalCard,
              {
                borderColor: withOpacity(roles.primaryActionBackground, 0.12),
                backgroundColor: theme.colors.backgroundPrimary,
              },
            ]}
            contentStyle={styles.privateAccessModalContent}
          >
            <Pressable
              onPress={handleClosePrivateAccessModal}
              style={styles.privateAccessModalCloseButton}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close private event access"
            >
              <MaterialCommunityIcons name="close" size={24} color={roles.primaryActionBackground} />
            </Pressable>
            <View style={styles.privateAccessModalHeader}>
              <MaterialCommunityIcons
                name="lock-outline"
                size={34}
                color={roles.primaryActionBackground}
              />
              <Text style={[styles.privateAccessModalTitle, { color: roles.primaryActionBackground }]}>
                Private Event
              </Text>
            </View>

            <View style={styles.privateAccessModalFieldGroup}>
              <Text style={[styles.privateAccessModalFieldLabel, { color: roles.headingText }]}>EVENT CODE</Text>
              <TextInput
                value={privateEventCode}
                onChangeText={setPrivateEventCode}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                maxLength={8}
                placeholder="Enter Private Event Code"
                placeholderTextColor={withOpacity(roles.primaryActionBackground, 0.24)}
                cursorColor={roles.primaryActionBackground}
                selectionColor={withOpacity(roles.primaryActionBackground, 0.24)}
                style={[
                  styles.privateAccessModalInput,
                  {
                    color: roles.headingText,
                    borderColor: withOpacity(roles.primaryActionBackground, 0.12),
                    backgroundColor: withOpacity(roles.primaryActionBackground, 0.04),
                  },
                ]}
              />
            </View>

            <View style={styles.privateAccessModalActions}>
              <GradientActionButton
                title="Submit"
                onPress={handleUnlockPrivateEvent}
                loading={isUnlockingPrivateEvent}
                textColor={roles.primaryActionText}
                style={styles.privateAccessModalPrimaryAction}
              />
            </View>
          </AppCard>
        </View>
      </Modal>

    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  statusBanner: {
    marginTop: 0,
  },
  dashboardHeaderSurface: {
    marginHorizontal: -theme.layout.screenPaddingX,
    paddingHorizontal: 0,
    paddingVertical: theme.spacing.xs,
  },
  homeFeed: {
    gap: theme.spacing.lg,
  },
  homeModeTabs: {
    minHeight: 44,
    marginHorizontal: -theme.spacing.md,
    marginTop: -theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
  },
  homeModeTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    paddingTop: 4,
    paddingBottom: 8,
  },
  homeModeTabActive: {
    borderBottomWidth: 2,
  },
  homeModeTabText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  privateAccessFabFloatWrap: {
    position: 'absolute',
    zIndex: 28,
    pointerEvents: 'box-none',
  },
  privateAccessFab: {
    width: PRIVATE_ACCESS_FAB_SIZE,
    height: PRIVATE_ACCESS_FAB_SIZE,
    borderRadius: PRIVATE_ACCESS_FAB_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 9,
  },
  privateAccessModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    backgroundColor: 'rgba(45, 39, 39, 0.58)',
  },
  privateAccessModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  privateAccessModalCard: {
    width: '100%',
    alignSelf: 'center',
    borderWidth: 1,
    ...theme.shadows.soft,
  },
  privateAccessModalContent: {
    width: '100%',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    alignItems: 'center',
  },
  privateAccessModalCloseButton: {
    position: 'absolute',
    top: theme.spacing.md,
    right: theme.spacing.md,
    zIndex: 2,
    padding: 2,
  },
  privateAccessModalHeader: {
    width: '100%',
    alignItems: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.xl,
  },
  privateAccessModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.semibold,
    textAlign: 'center',
  },
  privateAccessModalFieldGroup: {
    width: '100%',
    gap: theme.spacing.xs,
    marginTop: 28,
  },
  privateAccessModalFieldLabel: {
    marginLeft: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  privateAccessModalInput: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: theme.spacing.lg,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    letterSpacing: 0.2,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  privateAccessModalActions: {
    width: '100%',
    alignItems: 'center',
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  privateAccessModalPrimaryAction: {
    width: '100%',
    marginTop: 0,
  },
  activeDriveList: {
    gap: theme.spacing.md,
  },
  donationEventsPanel: {
    gap: theme.spacing.xl,
  },
  donationEventsControls: {
    gap: theme.spacing.md,
  },
  donationEventsSearchShell: {
    minHeight: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  donationEventsSearchInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    paddingVertical: 0,
  },
  donationEventsFiltersRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
  },
  donationEventsFilterCell: {
    flex: 1,
    minWidth: 0,
  },
  donationEventsVisibilityButton: {
    minHeight: 42,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  donationEventsSortMenuCard: {
    width: '100%',
    maxWidth: 260,
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  donationEventsVisibilityButtonCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    minWidth: 0,
  },
  donationEventsVisibilityButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  donationEventsVisibilityOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    paddingHorizontal: theme.spacing.md,
    paddingTop: 248,
    backgroundColor: 'rgba(45, 39, 39, 0.18)',
  },
  donationEventsVisibilityBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  donationEventsVisibilityMenuCard: {
    width: '100%',
    maxWidth: 260,
    alignSelf: 'flex-end',
    borderWidth: 1,
  },
  donationEventsVisibilityMenuContent: {
    paddingVertical: theme.spacing.xs,
  },
  donationEventsVisibilityMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  donationEventsVisibilityMenuText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  donationEventsSection: {
    gap: theme.spacing.md,
  },
  donationEventsGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.md,
  },
  donationEventsGroupTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.2,
    flexShrink: 0,
  },
  donationEventsGroupLine: {
    flex: 1,
    height: 1,
    borderRadius: theme.radius.full,
    opacity: 0.9,
  },
  donationEventsCardList: {
    gap: theme.spacing.md,
  },
  donationEventsEmptyWrapper: {
    paddingTop: theme.spacing.xs,
  },
  donationEventsEmptyState: {
    marginTop: theme.spacing.xs,
  },
  privateUnlockInputRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  privateUnlockCard: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    ...theme.shadows.soft,
  },
  privateUnlockHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  privateUnlockHeaderIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  privateUnlockHelperText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  privateUnlockInput: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: theme.spacing.md,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    letterSpacing: 0.4,
  },
  privateUnlockInputSingle: {
    flex: 0,
    width: '100%',
  },
  activeDriveCarousel: {
    marginHorizontal: -theme.spacing.md,
  },
  activeDriveCarouselContent: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  activeDriveCard: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  activeDriveCover: {
    width: '100%',
    height: 96,
    overflow: 'hidden',
  },
  activeDriveImage: {
    width: '100%',
    height: '100%',
  },
  activeDriveFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDriveBody: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  activeDriveTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyMd,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.semantic.bodyMd * theme.typography.lineHeights.snug,
  },
  activeDriveBadge: {
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  activeDriveBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.5,
  },
  activeDriveMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 2,
  },
  activeDriveMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '47%',
  },
  activeDriveMetaText: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.snug,
  },
  activeDriveMetaDot: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  activeDriveLink: {
    marginTop: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
  activeDriveLinkText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  homeFlowGrid: {
    flexDirection: 'column',
    gap: theme.spacing.md,
  },
  flowGridItem: {
    width: '100%',
  },
  flowGridItemStacked: {
    width: '100%',
  },
  setupCardContent: {
    gap: theme.spacing.md,
  },
  setupCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  setupIcon: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupCopy: {
    flex: 1,
    gap: 4,
  },
  setupTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
  },
  setupBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  setupButton: {
    minHeight: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  setupButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  flowActionRow: {
    minHeight: 92,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  flowActionCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  flowActionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  flowCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  flowIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowBadge: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
  },
  flowBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.4,
  },
  flowCardCopy: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  flowCardTitle: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.compact.body * theme.typography.lineHeights.snug,
  },
  flowCardDescription: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    flexShrink: 1,
  },
  flowActionCta: {
    minHeight: 38,
    maxWidth: 128,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  flowCardButton: {
    minHeight: 42,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  flowCardButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  upcomingDriveHero: {
    height: 224,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  upcomingDriveImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  upcomingDriveFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingDriveScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  upcomingDriveCopy: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  upcomingDriveEyebrow: {
    color: theme.colors.palette.white,
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.8,
  },
  upcomingDriveTitle: {
    color: theme.colors.palette.white,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
  },
  upcomingDriveMeta: {
    color: theme.colors.palette.white,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  emptyDriveHero: {
    minHeight: 132,
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  emptyDriveTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
  },
  emptyDriveText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  organizationList: {
    gap: theme.spacing.sm,
  },
  organizationRow: {
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  organizationRowIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  organizationRowCopy: {
    flex: 1,
    gap: 3,
  },
  organizationRowName: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.semibold,
  },
  organizationRowMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  quickOverviewSection: {
    gap: theme.spacing.xs,
  },
  section: {
    gap: theme.spacing.sm,
  },
  hairLogSectionAfterSetup: {
    marginTop: theme.spacing.md,
  },
  homeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xs,
  },
  calendarSectionHeader: {
    marginTop: theme.spacing.sm,
  },
  homeSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  homeSectionAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 32,
  },
  homeSectionActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  loadingState: {
    minHeight: 104,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  loadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  homeSplashLoading: {
    minHeight: 420,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xxxl,
  },
  homeSplashLogo: {
    width: 118,
    height: 118,
  },
  homeSplashBrand: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    textAlign: 'center',
  },
  emptySectionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  emptySectionTextInline: {
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  cardPressed: {
    transform: [{ scale: 0.985 }],
  },
  // Drive feed (Facebook style)
  driveFeedScroll: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.sm,
  },
  driveFeedItem: {
    width: 190,
  },
  driveCard: {
    width: 190,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  driveCover: {
    width: '100%',
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  driveCoverImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  driveDateBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  driveDateBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.semibold,
  },
  driveLinkedTag: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  driveLinkedText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  driveCardBody: {
    padding: theme.spacing.sm,
    gap: 3,
  },
  driveOrgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  driveTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.snug,
  },
  driveSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    flex: 1,
  },
  // Hair condition widget
  hairWidgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  hairWidgetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  hairWidgetIconWrap: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairWidgetTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
  },
  hairWidgetViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  hairWidgetViewBtnText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  hairMetricList: {
    gap: theme.spacing.xs,
  },
  hairMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  hairMetricIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  hairMetricLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    width: 90,
  },
  hairMetricTrack: {
    flex: 1,
    height: 7,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
  },
  hairMetricFill: {
    height: '100%',
    borderRadius: theme.radius.full,
  },
  hairMetricValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
    width: 30,
    textAlign: 'right',
  },
  hairWidgetSummary: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    marginTop: theme.spacing.xs,
    lineHeight: theme.typography.compact.caption * 1.4,
  },
  recentLogCard: {
    gap: theme.spacing.md,
  },
  recentLogHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  recentLogHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  recentLogTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
  },
  recentLogSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  recentLogCountPill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
  },
  recentLogCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  homeRecommendationPanel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: theme.spacing.md,
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  homeRecommendationIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  homeRecommendationCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  homeRecommendationTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
    fontWeight: theme.typography.weights.semibold,
  },
  homeRecommendationText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  recentLogList: {
    gap: theme.spacing.sm,
  },
  recentLogItem: {
    borderWidth: 1,
    borderRadius: 14,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  recentLogIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recentLogCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  recentLogTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  recentLogCondition: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
    fontWeight: theme.typography.weights.semibold,
  },
  recentLogDate: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    flexShrink: 0,
  },
  recentLogMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  recentLogRecommendation: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  // Week strip calendar
  calWeekStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  calWeekDayCol: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  calWeekDayLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    fontWeight: theme.typography.weights.semibold,
  },
  organizationCard: {
    width: '100%',
    minHeight: 134,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
  },
  organizationLogoWrap: {
    width: '100%',
    height: 68,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  organizationLogo: {
    width: '100%',
    height: '100%',
  },
  organizationInitials: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.bold,
  },
  organizationName: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    fontWeight: theme.typography.weights.semibold,
  },
  organizationLocation: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  organizationHome: {
    gap: theme.spacing.md,
  },
  organizationSearchShell: {
    minHeight: 50,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  organizationSearchInput: {
    flex: 1,
    minHeight: 48,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    paddingVertical: 0,
  },
  orgJoinGrid: {
    gap: theme.spacing.sm,
  },
  orgJoinCard: {
    minHeight: 206,
    borderRadius: 18,
    borderWidth: 1,
    padding: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'flex-start',
    ...theme.shadows.soft,
  },
  orgJoinLogoWrap: {
    width: 68,
    height: 68,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: theme.spacing.sm,
  },
  orgJoinLogo: {
    width: '100%',
    height: '100%',
  },
  orgJoinInitials: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  orgJoinName: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
    marginBottom: 4,
  },
  orgJoinDescription: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    marginBottom: theme.spacing.sm,
  },
  orgJoinMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    alignSelf: 'stretch',
    marginBottom: theme.spacing.sm,
  },
  orgJoinMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '46%',
  },
  orgJoinMetaText: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  orgJoinDot: {
    width: 4,
    height: 4,
    borderRadius: theme.radius.full,
  },
  orgJoinButton: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 'auto',
  },
  orgJoinButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  previewModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  previewModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  previewModalCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  joinModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  joinModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  joinModalCard: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  joinModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  joinModalBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  joinModalActions: {
    marginTop: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  previewModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  previewModalHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  previewEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  previewTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
  },
  previewCloseButton: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewBanner: {
    marginBottom: theme.spacing.sm,
  },
  previewLoadingState: {
    minHeight: 172,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  previewIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  previewLogo: {
    width: 48,
    height: 48,
    borderRadius: 16,
  },
  previewLogoFallback: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewIdentityCopy: {
    flex: 1,
    gap: 2,
  },
  previewSupportText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  previewStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  previewMetaBlock: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  previewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  previewMetaText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  previewBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    marginBottom: theme.spacing.md,
  },
  previewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  driveQrStage: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surfaceSoft,
  },
  driveQrImage: {
    width: 220,
    height: 220,
  },
  driveQrMeta: {
    alignItems: 'center',
    gap: 4,
    marginBottom: theme.spacing.md,
  },
  driveQrStatus: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  driveQrContextTitle: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
  },
  driveQrContextText: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  organizationPreviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  organizationPreviewIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  organizationPreviewSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  organizationPreviewLogoWrap: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  organizationPreviewLogo: {
    width: '100%',
    height: '100%',
  },
  organizationPreviewCopy: {
    flex: 1,
    gap: 2,
  },
  organizationPreviewPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    marginBottom: 2,
  },
  organizationPreviewPillText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  organizationDriveList: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  organizationDriveTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  organizationDriveRow: {
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
  },
  organizationDriveName: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    marginBottom: 2,
  },
  organizationDriveDate: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  organizationDriveRegistration: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    marginTop: 2,
  },
  emptyCalendarState: {
    gap: theme.spacing.md,
    alignItems: 'flex-start',
  },
  emptyCalendarIcon: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCalendarCopy: {
    gap: 4,
  },
  emptyCalendarTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
  },
  emptyCalendarBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  compactCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  compactSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.titleSm,
  },
  compactConditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  compactConditionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  iconOnlyButton: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  calendarMonthLabel: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
  },
  calendarSummaryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  calendarHeaderCopy: {
    flex: 1,
    gap: 2,
    paddingRight: theme.spacing.sm,
  },
  calendarHelperText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    marginBottom: theme.spacing.sm,
  },
  homeCalendarCard: {
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  homeCalendarShell: {
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  homeCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  homeCalendarHeaderCopy: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  homeCalendarMonthLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  homeCalendarNavButton: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeCalendarWeekdayRow: {
    flexDirection: 'row',
    gap: 3,
  },
  homeCalendarWeekdayText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 8,
    fontWeight: theme.typography.weights.bold,
  },
  homeCalendarGrid: {
    gap: 3,
  },
  homeCalendarRow: {
    flexDirection: 'row',
    gap: 3,
  },
  homeCalendarDay: {
    flex: 1,
    minHeight: 32,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  homeCalendarDayMuted: {
    opacity: 0.46,
  },
  homeCalendarDayText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  homeCalendarMarkerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  homeCalendarMarker: {
    width: 4,
    height: 4,
    borderRadius: theme.radius.full,
  },
  homeCalendarTodayDot: {
    width: 4,
    height: 4,
    borderRadius: theme.radius.full,
    borderWidth: 1,
  },
  latestConditionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
  },
  latestConditionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.xs,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.xs,
  },
  calendarCell: {
    width: '13.5%',
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  calendarCellLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.semibold,
  },
  conditionDot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.full,
  },
  // ─── AI Insight Card ───────────────────────────────────────────────────────
  aiInsightCard: {
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  aiInsightText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: 'rgba(255,245,235,0.90)',
  },
  // ─── Setup Inline Bar ──────────────────────────────────────────────────────
  setupInlineBar: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  setupInlineText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  // ─── Flat Log List ─────────────────────────────────────────────────────────
  recentLogFlatCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  recentLogFlatRow: {
    minHeight: 48,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  recentLogDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  recentLogFlatCondition: {
    flex: 1,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.semibold,
  },
  recentLogFlatDate: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    flexShrink: 0,
  },
  recentLogDivider: {
    height: 1,
    marginHorizontal: theme.spacing.md,
  },
  recentLogFlatMore: {
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
    justifyContent: 'center',
  },
  recentLogFlatMoreText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  recentLogEmpty: {
    minHeight: 286,
    borderRadius: theme.radius.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentLogEmptyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  // ─── Monthly Calendar ───────────────────────────────────────────────────────
  donationRequirementsCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  donationRequirementsDropdownHeader: {
    minHeight: 64,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  donationRequirementsIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  donationRequirementsMainCopy: {
    flex: 1,
    gap: 2,
  },
  donationRequirementsTitle: {
    fontSize: theme.typography.compact.bodyLg,
    fontWeight: theme.typography.weights.semibold,
  },
  donationRequirementsSubtitle: {
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.snug,
  },
  donationRequirementsHero: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  donationRequirementsHeroIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  donationRequirementsLabel: {
    fontSize: theme.typography.compact.caption,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  donationRequirementsLength: {
    fontSize: theme.typography.compact.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  donationRequirementsUpdated: {
    maxWidth: 104,
    textAlign: 'right',
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.snug,
  },
  donationRequirementChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  donationRequirementsGroupLabel: {
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  donationRequirementChip: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  donationRequirementChipLabel: {
    flex: 1,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  donationRequirementDivider: {
    height: 1,
    marginHorizontal: theme.spacing.md,
  },
  donationRequirementMetaList: {
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  donationRequirementMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  donationRequirementMetaLabel: {
    fontSize: theme.typography.compact.caption,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  donationRequirementMetaValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  donationRequirementNotes: {
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  donationRequirementsEmpty: {
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  donationRequirementsEmptyTitle: {
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.semibold,
    textAlign: 'center',
  },
  donationRequirementsEmptyText: {
    maxWidth: 260,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    textAlign: 'center',
  },
  calMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  calMonthLabel: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
  },
  calMonthNav: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  calNavBtn: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calWeekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calWeekCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  calWeekLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  calRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  calDayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 3,
    gap: 2,
  },
  calDayCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDayToday: {
    borderRadius: 19,
  },
  calDaySelected: {
    borderWidth: 2,
  },
  calDayNumber: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 17,
    fontWeight: theme.typography.weights.semibold,
  },
  calCheckBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  calCheckBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 8,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 9,
  },
  calendarLegendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  calendarLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  calendarLegendDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
  },
  calendarLegendText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.medium,
  },
  joinOrgPromptCard: {
    gap: theme.spacing.sm,
  },
  joinOrgPromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  joinOrgIconWrap: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  joinOrgCopy: {
    flex: 1,
    gap: 3,
  },
  joinOrgTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
  },
  joinOrgSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  horizontalPicker: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingBottom: 2,
  },
  horizontalPickerItem: {
    width: 132,
  },

  // ─── Hair Log Detail Modal ────────────────────────────────────────────────
  hairLogModalCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    maxHeight: '85%',
  },
  hairLogScroll: {
    flexGrow: 0,
  },
  hairLogScrollContent: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  hairLogConditionCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  hairLogConditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hairLogConditionLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  hairLogConditionDetail: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  hairLogSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    marginTop: theme.spacing.xs,
  },
  hairLogPhotoLoading: {
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairLogPhotoRow: {
    gap: theme.spacing.sm,
    paddingBottom: 2,
  },
  hairLogPhoto: {
    width: 100,
    height: 100,
    borderRadius: 14,
  },
  hairLogEmptyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  hairLogAiBlock: {
    borderRadius: 16,
    borderWidth: 1,
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  hairLogDecisionBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  hairLogDecisionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'capitalize',
  },
  hairLogAiSummary: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  hairLogMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  hairLogMetaItem: {
    gap: 2,
    minWidth: 72,
  },
  hairLogMetaKey: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  hairLogMetaValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  hairLogDamageNote: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * 1.5,
    fontStyle: 'italic',
  },
  hairLogRecsLoader: {
    alignSelf: 'flex-start',
  },
  hairLogRecsList: {
    gap: 0,
  },
  hairLogRecItem: {
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    gap: 2,
  },
  hairLogRecTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  hairLogRecText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },

  // ─── Daily Hair Reminder Card ────────────────────────────────────────────
  reminderCard: {
    marginHorizontal: theme.spacing.md,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  reminderContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  reminderIconWrap: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  reminderCopy: {
    flex: 1,
    gap: 1,
  },
  reminderTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.compact.bodyMd * theme.typography.lineHeights.snug,
  },
  reminderSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  reminderFooter: {
    marginTop: theme.spacing.xs,
  },

  // ─── Hair Analytics Card ─────────────────────────────────────────────────
  analyticsCard: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  analyticsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: 4,
  },
  analyticsTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.compact.bodyMd * theme.typography.lineHeights.snug,
  },
  analyticsSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
});
