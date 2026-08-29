import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppCard } from '../ui/AppCard';
import { AppIcon } from '../ui/AppIcon';
import { SectionTitleRow } from '../ui/SectionTitleRow';
import {
  fetchDonorRecommendationsBySubmissionId,
  getHairSubmissionImageSignedUrl,
} from '../../features/hairSubmission.api';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';
import { alignScreeningWithMinimumLength, formatEstimatedLengthInches } from '../../utils/hairLength';
import {
  getCanonicalHairAssessment,
  getHairScreeningMood,
} from '../../features/hairScreeningPresentation';
import hairAnalysisAiIcon from '../../assets/images/hair-analysis-ai-icon.png';

const CAPTURE_NOISE_PATTERNS = [
  'retake', 'lighting', 'image quality', 'photo quality', 'clearer photo',
  'clear photo', 'clear image', 'better photo', 'better image', 'capture',
  'resubmit', 'provide a better', 'ensure all views', 'ensure the photo',
  'improve the photo', 'improve lighting', 'provide clear', 'upload',
  'reupload', 'all views are', 'photo is clear', 'visible in the',
];
const CARE_SAFETY_NOTE = 'If you have allergies, scalp irritation, or sensitivity, consult a qualified hair or scalp care professional before trying new ingredients.';
const HAIR_ANALYSIS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const ADVERTISED_RECOMMENDATION_PATTERNS = [
  /\bDove\b/gi,
  /\bCream Silk\b/gi,
  /\bHuman Nature\b/gi,
  /\bVitress\b/gi,
  /\bHead\s*&\s*Shoulders\b/gi,
  /\bSelsun Blue\b/gi,
  /\bPantene(?:\s+Pro-V)?\b/gi,
  /\bWatsons\b/gi,
  /\bLazada(?:\.ph)?\b/gi,
  /\bShopee(?:\.ph)?\b/gi,
];
const RECOMMENDATION_ORIGIN_PATTERNS = [
  /Philippine product options? to consider:.*?(?:\.|$)/gi,
  /(?:neutral care|generic|local|country)?\s*product options? to consider:.*?(?:\.|$)/gi,
  /\bPhilippine(?:s)?\b/gi,
  /\b(?:country|locally|local)\s+(?:product|care)\s+options?\b/gi,
  /\b[A-Z][a-z]+(?:n|ian|ese|ish|i)\s+(?:product|brand|care)\s+options?\b/g,
  /Ingredient or product-type options to consider:.*?(?:\.|$)/gi,
];

const cleanRecommendationText = (value = '') => {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  RECOMMENDATION_ORIGIN_PATTERNS.forEach((pattern) => {
    text = text.replace(pattern, '');
  });
  ADVERTISED_RECOMMENDATION_PATTERNS.forEach((pattern) => {
    text = text.replace(pattern, 'a suitable product type');
  });
  text = text.replace(/\s+/g, ' ').trim();
  if (/ingredients that may help/i.test(text) && !/consult a qualified hair or scalp care professional/i.test(text)) {
    text = `${text} ${CARE_SAFETY_NOTE}`;
  }
  return text;
};

const formatModalDateLabel = (value) => (
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
);

const formatModalWeekdayLabel = (value) => (
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
  }).format(new Date(`${value}T12:00:00`))
);

const formatSavedDateTime = (value) => (
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
);

const formatTimeLabel = (value) => (
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
);

const formatNextAnalysisDateTime = (value) => (
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
);

const formatCountdown = (milliseconds = 0) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const formatDensityScore = (value) => {
  const score = Number(value);
  return Number.isFinite(score) ? `${Math.round(score)} / 100` : 'Not enough data';
};

const formatDetectedLabel = (value) => (value === true ? 'Detected' : 'Not detected');

const toCompactSummary = (value = '') => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217).trimEnd()}...`;
};

const isHairCareTip = (recommendation) => {
  const combined = `${recommendation?.title || ''} ${recommendation?.recommendation_text || ''}`.toLowerCase();
  return Boolean(cleanRecommendationText(recommendation?.recommendation_text || recommendation?.title || ''))
    && !CAPTURE_NOISE_PATTERNS.some((pattern) => combined.includes(pattern));
};

const sanitizeRecommendation = (recommendation = {}) => ({
  ...recommendation,
  title: cleanRecommendationText(recommendation.title),
  recommendation_text: cleanRecommendationText(recommendation.recommendation_text),
});

const filterDisplayRecommendations = (rows = [], screening = null) => {
  return rows
    .filter(isHairCareTip)
    .map(sanitizeRecommendation)
    .filter((item) => item.title || item.recommendation_text);
};

const buildEntryKey = (entry, index) => (
  String(
    entry?.screening?.ai_screening_id
    || entry?.screening?.created_at
    || entry?.submission?.submission_id
    || index
  )
);

const getEventActivityDate = (event = null) => (
  event?.registration?.registered_at
  || event?.registration?.updated_at
  || event?.start_date
  || event?.updated_at
  || ''
);

const getEventStatusLabel = (event = null) => (
  String(
    event?.registration?.attendance_status
    || event?.registration?.registration_status
    || 'Registered'
  ).trim()
);

const getEventScheduleLabel = (event = null) => {
  if (!event?.start_date) return 'Schedule to be announced';
  const start = formatModalDateLabel(String(event.start_date).slice(0, 10));
  if (!event?.end_date) return start;
  return `${start} - ${formatModalDateLabel(String(event.end_date).slice(0, 10))}`;
};

const getEventLocationLabel = (event = null) => (
  event?.address_label
  || event?.location_label
  || event?.venue_name
  || 'Location to be announced'
);

const getInsightIcon = (value = '') => {
  const normalized = String(value || '').toLowerCase();
  if (/length|inch|trim|ends?/.test(normalized)) return 'ruler';
  if (/dandruff|flake/.test(normalized)) return 'head-snowflake-outline';
  if (/lice|nit|bug/.test(normalized)) return 'shield-bug-outline';
  if (/scalp|coverage|visible/.test(normalized)) return 'head-outline';
  if (/dry|moisture|condition/.test(normalized)) return 'water-outline';
  return 'head-check-outline';
};

const getStoredHairImagePath = (image = null) => String(
  image?.file_path
  || image?.File_Path
  || image?.signed_url
  || image?.public_url
  || image?.image_url
  || image?.uri
  || ''
).trim();

const getStoredHairImageId = (image = null) => (
  image?.image_id || image?.Image_ID || image?.id || getStoredHairImagePath(image)
);

const ASSESSMENT_WIDGET_TONES = [
  { surface: '#FFF4F6', border: '#F0D4DA', iconSurface: '#F6DDE3' },
  { surface: '#F8EEF1', border: '#E7CCD3', iconSurface: '#EED8DE' },
  { surface: '#FFF8F5', border: '#EEDBD2', iconSurface: '#F5E1D8' },
  { surface: '#F7F2F5', border: '#E3D4DB', iconSurface: '#EADDE3' },
];

function AssessmentMetricWidget({ metric, index, animationKey, textColor, metaColor, iconColor }) {
  const entrance = React.useRef(new Animated.Value(0)).current;
  const tone = ASSESSMENT_WIDGET_TONES[index % ASSESSMENT_WIDGET_TONES.length];

  React.useEffect(() => {
    entrance.setValue(0);
    Animated.spring(entrance, {
      toValue: 1,
      delay: Math.min(index * 45, 540),
      damping: 16,
      stiffness: 170,
      mass: 0.72,
      useNativeDriver: true,
    }).start();
  }, [animationKey, entrance, index]);

  return (
    <Animated.View
      accessibilityLabel={`${metric.label}: ${metric.value}`}
      style={[
        styles.metricItem,
        metric.wide && styles.metricItemFull,
        { backgroundColor: tone.surface, borderColor: tone.border },
        {
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
            { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      <View style={[styles.metricIconWrap, { backgroundColor: tone.iconSurface }]}>
        <MaterialCommunityIcons name={metric.icon} size={17} color={iconColor} />
      </View>
      <View style={styles.metricCopy}>
        <Text style={[styles.metaKey, { color: metaColor }]}>{metric.label}</Text>
        <Text
          style={[
            styles.metaValue,
            { color: textColor },
            metric.label === 'Length' && metric.value === 'Not detected' ? styles.metricValueMuted : null,
            metric.label === 'Density score' ? styles.metricValueLarge : null,
          ]}
        >
          {metric.value}
        </Text>
      </View>
    </Animated.View>
  );
}

export function HairLogDetailModal({
  visible,
  dateKey = '',
  entries = [],
  events = [],
  onClose,
  onStartAnalysis,
  pageMode = false,
  donationRequirement = null,
}) {
  const { resolvedTheme } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const roles = resolveThemeRoles(resolvedTheme);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;
  const pageColor = (fallback) => (pageMode ? primaryTextColor : fallback);
  const [activeEntryKey, setActiveEntryKey] = React.useState('');
  const [signedUrls, setSignedUrls] = React.useState({});
  const [isLoadingUrls, setIsLoadingUrls] = React.useState(false);
  const [imageUrlError, setImageUrlError] = React.useState('');
  const [imageUrlLoadNonce, setImageUrlLoadNonce] = React.useState(0);
  const [recommendations, setRecommendations] = React.useState([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = React.useState(false);
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [activePhotoIndex, setActivePhotoIndex] = React.useState(0);
  const photoScrollX = React.useRef(new Animated.Value(0)).current;
  const photoCarouselRef = React.useRef(null);

  React.useEffect(() => {
    if (!visible || !entries.length) {
      setActiveEntryKey('');
      return;
    }

    const nextKey = buildEntryKey(entries[0], 0);
    setActiveEntryKey((current) => (
      current && entries.some((entry, index) => buildEntryKey(entry, index) === current)
        ? current
        : nextKey
    ));
  }, [entries, visible]);

  const activeEntry = React.useMemo(
    () => entries.find((entry, index) => buildEntryKey(entry, index) === activeEntryKey) || entries[0] || null,
    [activeEntryKey, entries]
  );

  const allImages = React.useMemo(() => {
    if (!activeEntry) return [];
    if (Array.isArray(activeEntry.images) && activeEntry.images.length) return activeEntry.images;
    return (activeEntry.submission?.submission_details || []).flatMap((detail) => detail.images || []);
  }, [activeEntry]);

  React.useEffect(() => {
    setActivePhotoIndex(0);
    setImageUrlError('');
    photoScrollX.setValue(0);
    photoCarouselRef.current?.scrollTo?.({ x: 0, animated: false });
  }, [activeEntryKey, photoScrollX]);

  React.useEffect(() => {
    let isCancelled = false;

    if (!visible || !activeEntry) {
      setSignedUrls({});
      setImageUrlError('');
      setRecommendations([]);
      setIsLoadingUrls(false);
      setIsLoadingRecommendations(false);
      return () => {
        isCancelled = true;
      };
    }

    const imageRows = allImages.filter((image) => getStoredHairImagePath(image));
    if (!imageRows.length) {
      setSignedUrls({});
      setImageUrlError('');
      setIsLoadingUrls(false);
    } else {
      setIsLoadingUrls(true);
      setImageUrlError('');
      Promise.all(
        imageRows.map((image) => {
          const imagePath = getStoredHairImagePath(image);
          return getHairSubmissionImageSignedUrl(imagePath).then((result) => ({
            id: getStoredHairImageId(image),
            url: result.data || '',
            error: result.error || null,
          }));
        })
      ).then((results) => {
        if (isCancelled) return;
        const nextUrls = {};
        results.forEach(({ id, url }) => {
          if (url) nextUrls[id] = url;
        });
        setSignedUrls(nextUrls);
        setImageUrlError(results.some(({ url }) => !url)
          ? 'Some saved photos could not be opened. Please try again.'
          : '');
        setIsLoadingUrls(false);
      }).catch(() => {
        if (isCancelled) return;
        setSignedUrls({});
        setImageUrlError('Saved photos could not be opened. Please try again.');
        setIsLoadingUrls(false);
      });
    }

    const savedRecommendations = Array.isArray(activeEntry.recommendations) && activeEntry.recommendations.length
      ? activeEntry.recommendations
      : activeEntry.screening?.recommendations || activeEntry.screening?.analysis_result?.recommendations || [];

    if (savedRecommendations.length) {
      setRecommendations(filterDisplayRecommendations(savedRecommendations, activeEntry.screening));
      setIsLoadingRecommendations(false);
    } else if (activeEntry.submission?.submission_id) {
      setIsLoadingRecommendations(true);
      fetchDonorRecommendationsBySubmissionId(activeEntry.submission.submission_id, 5).then((result) => {
        if (isCancelled) return;
        setRecommendations(filterDisplayRecommendations(result.data || [], activeEntry.screening));
        setIsLoadingRecommendations(false);
      });
    } else {
      setRecommendations([]);
      setIsLoadingRecommendations(false);
    }

    return () => {
      isCancelled = true;
    };
  }, [activeEntry, allImages, imageUrlLoadNonce, visible]);

  React.useEffect(() => {
    if (!visible) return undefined;
    const intervalId = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, [visible]);

  if (!visible || (!activeEntry?.screening && !events.length)) return null;

  const screening = alignScreeningWithMinimumLength(activeEntry?.screening || null, donationRequirement);
  const hasScreening = Boolean(screening);
  const assessment = hasScreening
    ? getCanonicalHairAssessment(screening)
    : { label: 'Registered event', needsCare: false };
  const mood = hasScreening
    ? getHairScreeningMood(screening)
    : {
      icon: 'calendar-check-outline',
      color: roles.primaryActionBackground,
      surface: roles.iconPrimarySurface,
      label: 'Registered event',
    };
  const hasAssessmentDetails = Boolean(
    screening?.estimated_length != null
    || screening?.detected_color
    || screening?.detected_texture
    || screening?.detected_density
    || screening?.bald_spots_present === true
    || screening?.hair_density_score != null
    || screening?.visible_scalp_area
    || screening?.shedding_level
    || screening?.scalp_coverage_notes
    || screening?.dandruff_notes
    || screening?.lice_notes
    || screening?.summary
    || screening?.visible_damage_notes
  );
  const savedPhotoRows = allImages.filter((image) => getStoredHairImagePath(image));
  const photoItems = savedPhotoRows
    .map((image, index) => ({
      id: `${String(getStoredHairImageId(image) || 'photo')}-${index}`,
      uri: signedUrls[getStoredHairImageId(image)] || '',
      label: String(image.image_type || image.Image_Type || `Photo ${index + 1}`).replace(/[_-]+/g, ' '),
    }))
    .filter((item) => item.uri);
  const photoCardWidth = Math.min(Math.max(windowWidth - (pageMode ? 112 : 150), 220), 304);
  const photoCardGap = theme.spacing.md;
  const photoSnapInterval = photoCardWidth + photoCardGap;
  const compactSummary = pageMode
    ? String(screening?.summary || '').replace(/\s+/g, ' ').trim()
    : toCompactSummary(screening?.summary);
  const assessmentSummary = compactSummary
    || screening?.visible_damage_notes
    || screening?.scalp_coverage_notes
    || (hasScreening && assessment.needsCare
      ? 'Analysis continued with user-approved photos after validation warning. The result is low-confidence and should not be used for donation approval.'
      : 'Use this scan as a baseline and compare the next check for changes.');
  const assessmentMetrics = [
    { label: 'Condition', value: screening?.detected_condition || 'Not detected', icon: 'head-heart-outline', wide: true },
    { label: 'Donation decision', value: screening?.decision || 'Not detected', icon: 'content-cut', wide: true },
    { label: 'Length', value: formatEstimatedLengthInches(screening), icon: 'ruler' },
    { label: 'Color', value: screening?.detected_color || 'Not detected', icon: 'palette' },
    { label: 'Texture', value: screening?.detected_texture || 'Not detected', icon: 'waves' },
    { label: 'Density', value: screening?.detected_density || 'Not detected', icon: 'head-dots-horizontal-outline' },
    { label: 'Density score', value: formatDensityScore(screening?.hair_density_score), icon: 'head-check-outline' },
    { label: 'Visible scalp', value: screening?.visible_scalp_area || 'Not detected', icon: 'head-outline' },
    {
      label: 'Affected areas',
      value: Array.isArray(screening?.affected_regions) && screening.affected_regions.length
        ? screening.affected_regions.join(', ')
        : 'None detected',
      icon: 'head-alert-outline',
    },
    { label: 'Shedding', value: screening?.shedding_level || 'Not detected', icon: 'head-minus-outline' },
    { label: 'Dandruff', value: formatDetectedLabel(screening?.dandruff_detected), icon: 'head-snowflake-outline' },
    { label: 'Dandruff severity', value: screening?.dandruff_severity || 'None', icon: 'snowflake-alert' },
    { label: 'Lice / nits', value: formatDetectedLabel(screening?.lice_detected), icon: 'shield-bug-outline' },
    { label: 'Lice confidence', value: screening?.lice_confidence || 'None', icon: 'shield-check-outline' },
    { label: 'Tracking status', value: screening?.improvement_tracking_status || 'Not detected', icon: 'head-sync-outline', wide: true },
  ];
  const nextAnalysisAtMs = screening?.created_at
    ? new Date(screening.created_at).getTime() + HAIR_ANALYSIS_COOLDOWN_MS
    : NaN;
  const nextAnalysisRemainingMs = Number.isFinite(nextAnalysisAtMs)
    ? nextAnalysisAtMs - nowMs
    : 0;
  const canAnalyzeAgain = !Number.isFinite(nextAnalysisAtMs) || nextAnalysisRemainingMs <= 0;
  const nextAnalysisLabel = Number.isFinite(nextAnalysisAtMs)
    ? formatNextAnalysisDateTime(nextAnalysisAtMs)
    : '';
  const insightBullets = Array.from(new Set([
    screening?.donation_readiness_note,
    screening?.length_assessment,
    screening?.history_assessment,
    screening?.dandruff_notes,
    screening?.lice_notes,
    screening?.scalp_coverage_notes,
    screening?.improvement_recommendation,
    screening?.visible_damage_notes,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)))
    .filter((value) => value !== assessmentSummary);
  const modalEyebrow = hasScreening && events.length
    ? 'Hair check and events'
    : hasScreening
      ? 'Hair check'
      : 'Registered events';
  const modalTitle = dateKey
    ? formatModalDateLabel(dateKey)
    : formatSavedDateTime(screening?.created_at || getEventActivityDate(events[0]) || new Date().toISOString());
  const modalWeekday = dateKey ? formatModalWeekdayLabel(dateKey) : '';

  const content = (
      <View style={[
        styles.overlay,
        pageMode && styles.pageOverlay,
        pageMode && { backgroundColor: roles.pageBackground },
      ]}>
        {!pageMode ? <Pressable style={styles.backdrop} onPress={onClose} /> : null}

        <AppCard
          variant={pageMode ? 'default' : 'elevated'}
          radius="md"
          padding="lg"
          style={[
            styles.card,
            pageMode && styles.pageCard,
            {
              backgroundColor: roles.pageBackground,
              borderColor: pageMode ? roles.pageBackground : roles.defaultCardBorder,
            },
          ]}
          contentStyle={styles.cardContent}
        >
          <View style={[styles.header, pageMode && styles.pageHeader]}>
            {pageMode ? (
              <View style={styles.pageDateBlock}>
                <View style={styles.pageDateRow}>
                  <LinearGradient
                    colors={[theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.pageDateIcon}
                  >
                    <MaterialCommunityIcons name="calendar-check-outline" size={22} color="#FFFFFF" />
                  </LinearGradient>
                  <View style={styles.pageDateCopy}>
                    {modalWeekday ? (
                      <Text style={[styles.pageDateWeekday, { color: pageColor(roles.metaText) }]}>{modalWeekday}</Text>
                    ) : null}
                    <Text style={[styles.pageDateTitle, { color: pageColor(roles.headingText) }]}>{modalTitle}</Text>
                  </View>
                </View>
                <View style={[styles.pageDateTrack, { backgroundColor: roles.defaultCardBorder }]}>
                  <LinearGradient
                    colors={[theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo, 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.pageDateAccent}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.headerCopy}>
                <Text style={[styles.eyebrow, { color: pageColor(roles.metaText) }]}>{modalEyebrow}</Text>
                <Text style={[styles.title, { color: pageColor(roles.headingText) }]}>{modalTitle}</Text>
              </View>
            )}
            {!pageMode ? (
              <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
                <AppIcon name="close" size="sm" state="muted" color={pageColor(roles.metaText)} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            nestedScrollEnabled
          >
            {hasScreening ? (
              <LinearGradient
                colors={[theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.statusCard, pageMode && styles.pageStatusCard]}
              >
                <View pointerEvents="none" style={styles.statusCardGlow} />
                <View style={styles.statusMainRow}>
                  <View style={styles.statusMoodIcon}>
                    <MaterialCommunityIcons name={mood.icon} size={26} color="#FFFFFF" />
                  </View>
                  <View style={styles.statusCopy}>
                    <Text style={styles.statusEyebrow}>LATEST RESULT</Text>
                    <Text style={styles.statusLabel}>{assessment.label}</Text>
                    <Text style={styles.statusMoodLabel}>{mood.label}</Text>
                  </View>
                </View>
                <Text style={styles.statusSubtext}>
                  Saved {formatSavedDateTime(screening.created_at)}
                </Text>
              </LinearGradient>
            ) : null}

            {hasScreening && entries.length > 1 ? (
              <View style={styles.entrySwitcherWrap}>
                <SectionTitleRow
                  title="Entries"
                  icon="file-document-outline"
                  color={pageColor(roles.headingText)}
                  iconColor={pageColor(roles.metaText)}
                  accentColor={pageColor(roles.primaryActionBackground)}
                  titleStyle={styles.sectionTitle}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.entrySwitcherRow}>
                  {entries.map((entry, index) => {
                    const entryKey = buildEntryKey(entry, index);
                    const isActive = entryKey === activeEntryKey;
                    return (
                      <Pressable
                        key={entryKey}
                        onPress={() => setActiveEntryKey(entryKey)}
                        style={[
                          styles.entryChip,
                          {
                            backgroundColor: isActive ? roles.iconPrimarySurface : roles.supportCardBackground,
                            borderColor: isActive ? roles.iconPrimaryColor : roles.supportCardBorder,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.entryChipText,
                            { color: isActive ? roles.iconPrimaryColor : roles.bodyText },
                          ]}
                        >
                          {formatTimeLabel(entry?.screening?.created_at)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {events.length ? (
              <>
                <SectionTitleRow
                  title={events.length === 1 ? 'Registered event' : 'Registered events'}
                  icon="calendar-check-outline"
                  color={pageColor(roles.headingText)}
                  iconColor={pageColor(roles.metaText)}
                  accentColor={pageColor(roles.primaryActionBackground)}
                  titleStyle={styles.sectionTitle}
                />
                <View style={styles.eventList}>
                  {events.map((event, index) => {
                    const eventKey = String(
                      event?.registration?.registration_id
                      || event?.donation_drive_id
                      || `${event?.event_title || 'event'}-${index}`
                    );
                    const statusLabel = getEventStatusLabel(event);
                    const registeredAt = getEventActivityDate(event);
                    return (
                      <View
                        key={eventKey}
                        style={[
                          styles.eventCard,
                          {
                            backgroundColor: roles.pageBackground,
                            borderColor: roles.defaultCardBorder,
                          },
                        ]}
                      >
                        <View style={styles.eventCardHeader}>
                          <View style={[styles.eventCardIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
                            <MaterialCommunityIcons
                              name="calendar-check-outline"
                              size={18}
                              color={roles.iconPrimaryColor}
                            />
                          </View>
                          <View style={styles.eventCardCopy}>
                            <Text style={[styles.eventCardTitle, { color: roles.headingText }]} numberOfLines={2}>
                              {event?.event_title || 'Donation event'}
                            </Text>
                            <Text style={[styles.eventCardSubtitle, { color: roles.bodyText }]} numberOfLines={2}>
                              {event?.organization_name || 'Event host'}
                            </Text>
                          </View>
                          <View style={[styles.eventStatusChip, { backgroundColor: roles.iconPrimarySurface }]}>
                            <Text style={[styles.eventStatusText, { color: roles.iconPrimaryColor }]} numberOfLines={1}>
                              {statusLabel}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.eventMetaList}>
                          <View style={styles.eventMetaRow}>
                            <MaterialCommunityIcons name="clock-outline" size={16} color={roles.metaText} />
                            <Text style={[styles.eventMetaText, { color: roles.bodyText }]}>
                              {registeredAt ? `Registered ${formatSavedDateTime(registeredAt)}` : 'Registration date not available'}
                            </Text>
                          </View>
                          <View style={styles.eventMetaRow}>
                            <MaterialCommunityIcons name="calendar-range-outline" size={16} color={roles.metaText} />
                            <Text style={[styles.eventMetaText, { color: roles.bodyText }]}>
                              {getEventScheduleLabel(event)}
                            </Text>
                          </View>
                          <View style={styles.eventMetaRow}>
                            <MaterialCommunityIcons name="map-marker-outline" size={16} color={roles.metaText} />
                            <Text style={[styles.eventMetaText, { color: roles.bodyText }]}>
                              {getEventLocationLabel(event)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}

            {hasScreening ? (
              <View style={styles.photoSection}>
                <View style={styles.photoSectionHeader}>
                  <View style={[styles.photoSectionIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                    <MaterialCommunityIcons name="image-multiple-outline" size={20} color={roles.iconPrimaryColor} />
                  </View>
                  <View style={styles.photoSectionCopy}>
                    <Text style={[styles.photoSectionTitle, { color: pageColor(roles.headingText) }]}>Hair photos</Text>
                    <Text style={[styles.photoSectionHint, { color: pageColor(roles.metaText) }]}>Swipe to see every captured view.</Text>
                  </View>
                  {savedPhotoRows.length ? (
                    <View style={[styles.photoTotalBadge, { backgroundColor: roles.iconPrimarySurface }]}>
                      <Text style={[styles.photoTotalText, { color: roles.iconPrimaryColor }]}>{savedPhotoRows.length} views</Text>
                    </View>
                  ) : null}
                </View>
                {isLoadingUrls ? (
                  <View style={styles.photoLoading}>
                    <ActivityIndicator color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
                  </View>
                ) : photoItems.length ? (
                  <>
                    <Animated.ScrollView
                      ref={photoCarouselRef}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      decelerationRate="fast"
                      snapToInterval={photoSnapInterval}
                      snapToAlignment="start"
                      disableIntervalMomentum
                      contentContainerStyle={styles.photoRow}
                      onScroll={Animated.event(
                        [{ nativeEvent: { contentOffset: { x: photoScrollX } } }],
                        { useNativeDriver: true }
                      )}
                      onMomentumScrollEnd={(event) => {
                        const nextIndex = Math.round(event.nativeEvent.contentOffset.x / photoSnapInterval);
                        setActivePhotoIndex(Math.max(0, Math.min(nextIndex, photoItems.length - 1)));
                      }}
                      scrollEventThrottle={16}
                    >
                      {photoItems.map((item, index) => {
                        const inputRange = [
                          (index - 1) * photoSnapInterval,
                          index * photoSnapInterval,
                          (index + 1) * photoSnapInterval,
                        ];
                        const scale = photoScrollX.interpolate({
                          inputRange,
                          outputRange: [0.88, 1, 0.88],
                          extrapolate: 'clamp',
                        });
                        const translateY = photoScrollX.interpolate({
                          inputRange,
                          outputRange: [7, 0, 7],
                          extrapolate: 'clamp',
                        });
                        const opacity = photoScrollX.interpolate({
                          inputRange,
                          outputRange: [0.4, 1, 0.4],
                          extrapolate: 'clamp',
                        });

                        return (
                          <Animated.View
                            key={item.id}
                            style={[
                              styles.photoCard,
                              { width: photoCardWidth, opacity, transform: [{ scale }, { translateY }] },
                            ]}
                          >
                            <Image source={{ uri: item.uri }} style={styles.photo} resizeMode="cover" />
                            <LinearGradient
                              pointerEvents="none"
                              colors={['transparent', 'rgba(40, 4, 12, 0.72)']}
                              style={styles.photoScrim}
                            />
                            <View style={styles.photoCountBadge}>
                              <Text style={styles.photoCountText}>{index + 1} / {photoItems.length}</Text>
                            </View>
                            <View style={styles.photoCaptionRow}>
                              <MaterialCommunityIcons name="image-outline" size={15} color="#FFFFFF" />
                              <Text numberOfLines={1} style={styles.photoCaption}>{item.label}</Text>
                            </View>
                          </Animated.View>
                        );
                      })}
                    </Animated.ScrollView>
                    {photoItems.length > 1 ? (
                      <View style={styles.photoPager}>
                        {photoItems.map((item, index) => (
                          <View
                            key={`photo-dot-${item.id}`}
                            style={[
                              styles.photoPagerDot,
                              index === activePhotoIndex
                                ? [styles.photoPagerDotActive, { backgroundColor: roles.primaryActionBackground }]
                                : { backgroundColor: roles.defaultCardBorder },
                            ]}
                          />
                        ))}
                      </View>
                    ) : null}
                    {imageUrlError ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reload saved hair photos"
                        onPress={() => setImageUrlLoadNonce((current) => current + 1)}
                        style={[styles.photoRetryButton, { backgroundColor: roles.iconPrimarySurface }]}
                      >
                        <MaterialCommunityIcons name="refresh" size={16} color={roles.iconPrimaryColor} />
                        <Text style={[styles.photoRetryText, { color: roles.iconPrimaryColor }]}>Reload missing photos</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <View style={[styles.photoUnavailableCard, { backgroundColor: roles.supportCardBackground, borderColor: roles.defaultCardBorder }]}>
                    <View style={[styles.photoUnavailableIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                      <MaterialCommunityIcons name="image-off-outline" size={21} color={roles.iconPrimaryColor} />
                    </View>
                    <View style={styles.photoUnavailableCopy}>
                      <Text style={[styles.photoUnavailableTitle, { color: pageColor(roles.headingText) }]}>Photos are not visible yet</Text>
                      <Text style={[styles.photoUnavailableBody, { color: pageColor(roles.bodyText) }]}>
                        {savedPhotoRows.length ? imageUrlError : 'No saved photo records were returned for this result.'}
                      </Text>
                    </View>
                    {savedPhotoRows.length ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Reload saved hair photos"
                        onPress={() => setImageUrlLoadNonce((current) => current + 1)}
                        style={[styles.photoUnavailableRetry, { backgroundColor: roles.primaryActionBackground }]}
                      >
                        <MaterialCommunityIcons name="refresh" size={17} color={roles.primaryActionText} />
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}

            {hasScreening && hasAssessmentDetails ? (
              <>
                <SectionTitleRow
                  title="Hair assessment"
                  icon="clipboard-pulse-outline"
                  color={pageColor(roles.headingText)}
                  iconColor={pageColor(roles.metaText)}
                  accentColor={pageColor(roles.primaryActionBackground)}
                  titleStyle={styles.sectionTitle}
                />
                <View style={styles.assessmentContent}>
                  <View style={[styles.assessmentSummaryCard, { backgroundColor: roles.iconPrimarySurface }]}>
                    <View style={[styles.assessmentSummaryIcon, { backgroundColor: roles.primaryActionBackground }]}>
                      <MaterialCommunityIcons name="clipboard-text-outline" size={20} color={roles.primaryActionText} />
                    </View>
                    <View style={styles.assessmentSummaryCopy}>
                      <Text style={[styles.assessmentSummaryLabel, { color: roles.iconPrimaryColor }]}>AI overview</Text>
                      <Text style={[styles.assessmentSummary, { color: pageColor(roles.bodyText) }]} numberOfLines={pageMode ? undefined : 2}>
                        {assessmentSummary}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.metricGrid}>
                    {assessmentMetrics.map((metric, index) => (
                      <AssessmentMetricWidget
                        key={metric.label}
                        metric={metric}
                        index={index}
                        animationKey={activeEntryKey}
                        textColor={pageColor(roles.headingText)}
                        metaColor={pageColor(roles.metaText)}
                        iconColor={roles.iconPrimaryColor}
                      />
                    ))}
                  </View>
                </View>
              </>
            ) : null}

            {hasScreening ? (
              <View style={[styles.insightsCard, pageMode && styles.pageInnerCard, {
                backgroundColor: roles.supportCardBackground,
                borderColor: roles.defaultCardBorder,
              }]}>
                <View style={styles.insightsHeader}>
                  <View style={[styles.insightsIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
                    <MaterialCommunityIcons
                      name="lightbulb-on-outline"
                      size={19}
                      color={roles.iconPrimaryColor}
                    />
                  </View>
                  <View style={styles.insightsHeaderCopy}>
                    <Text style={[styles.insightsTitle, { color: pageColor(roles.headingText) }]}>Saved care notes</Text>
                    <Text style={[styles.insightsSubtitle, { color: pageColor(roles.metaText) }]}>Important details from this check</Text>
                  </View>
                  {insightBullets.length ? (
                    <View style={[styles.insightsCount, { backgroundColor: roles.primaryActionBackground }]}>
                      <Text style={[styles.insightsCountText, { color: roles.primaryActionText }]}>{insightBullets.length}</Text>
                    </View>
                  ) : null}
                </View>

                {isLoadingRecommendations ? (
                  <ActivityIndicator
                    color={resolvedTheme?.primaryColor || theme.colors.brandPrimary}
                    style={styles.recommendationLoader}
                  />
                ) : (
                  <View style={styles.insightsBody}>
                    {insightBullets.length ? (
                      <View style={styles.bulletList}>
                        {insightBullets.map((bullet, index) => (
                          <View key={`${index}-${bullet.slice(0, 24)}`} style={styles.bulletRow}>
                            <View style={[styles.bulletIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                              <MaterialCommunityIcons name={getInsightIcon(bullet)} size={17} color={roles.iconPrimaryColor} />
                            </View>
                            <Text style={[styles.bulletText, { color: pageColor(roles.bodyText) }]} numberOfLines={pageMode ? undefined : 2}>
                              {bullet}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={[styles.insightsText, { color: pageColor(roles.bodyText) }]}>
                        No additional analysis notes were saved for this check.
                      </Text>
                    )}
                  </View>
                )}

              </View>
            ) : null}

            {hasScreening ? (
              <>
                <SectionTitleRow
                  title="Hair recommendations"
                  icon="lightbulb-on-outline"
                  color={pageColor(roles.headingText)}
                  iconColor={pageColor(roles.metaText)}
                  accentColor={pageColor(roles.primaryActionBackground)}
                  titleStyle={styles.sectionTitle}
                />
                {isLoadingRecommendations ? (
                  <ActivityIndicator
                    color={resolvedTheme?.primaryColor || theme.colors.brandPrimary}
                    style={styles.recommendationLoader}
                  />
                ) : recommendations.length ? (
                  <View style={styles.recommendationList}>
                    {recommendations.map((recommendation, index) => (
                      <View
                        key={recommendation.recommendation_id || `${recommendation.title}-${index}`}
                        style={[
                          styles.recommendationCard,
                          {
                            backgroundColor: pageMode ? roles.pageBackground : roles.defaultCardBackground,
                            borderColor: roles.defaultCardBorder,
                          },
                        ]}
                      >
                        <Text style={[styles.recommendationStep, { color: pageColor(roles.primaryActionBackground) }]}>
                          Step {index + 1}
                        </Text>
                        {recommendation.title ? (
                          <Text style={[styles.recommendationTitle, { color: pageColor(roles.headingText) }]}>
                            {recommendation.title}
                          </Text>
                        ) : null}
                        <Text style={[styles.recommendationText, { color: pageColor(roles.bodyText) }]}>
                          {recommendation.recommendation_text || recommendation.title}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.insightsText, { color: pageColor(roles.bodyText) }]}>
                    No hair-care recommendations were saved for this check.
                  </Text>
                )}
              </>
            ) : null}

            {hasScreening ? (
              <View style={[styles.nextAnalysisCard, pageMode && styles.pageInnerCard, { backgroundColor: roles.supportCardBackground, borderColor: roles.defaultCardBorder }]}>
                <View pointerEvents="none" style={styles.nextAnalysisGlow} />
                <View style={styles.nextAnalysisInfoRow}>
                  <LinearGradient
                    colors={['#FFF9FA', '#F2DCE2']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.nextAnalysisIcon}
                  >
                    <Image source={hairAnalysisAiIcon} style={styles.nextAnalysisIconImage} resizeMode="contain" />
                  </LinearGradient>
                  <View style={styles.nextAnalysisCopy}>
                    <Text style={[styles.nextAnalysisTitle, { color: pageColor(roles.headingText) }]}>Next Hair Analysis</Text>
                    <Text style={[styles.nextAnalysisBody, { color: pageColor(roles.bodyText) }]}>
                      {canAnalyzeAgain ? 'Your next hair check is ready.' : `Available on ${nextAnalysisLabel}.`}
                    </Text>
                  </View>
                  {canAnalyzeAgain ? (
                    <View style={[styles.nextAnalysisReadyBadge, { backgroundColor: roles.iconPrimarySurface }]}>
                      <MaterialCommunityIcons name="check-circle-outline" size={14} color={roles.iconPrimaryColor} />
                      <Text style={[styles.nextAnalysisReadyText, { color: roles.iconPrimaryColor }]}>Ready</Text>
                    </View>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={canAnalyzeAgain ? 'Start Hair Analysis' : 'Hair Analysis is not ready yet'}
                  disabled={!canAnalyzeAgain || !onStartAnalysis}
                  onPress={onStartAnalysis}
                  style={({ pressed }) => [
                    styles.nextAnalysisCountdown,
                    !canAnalyzeAgain && {
                      backgroundColor: roles.pageBackground,
                      borderColor: roles.defaultCardBorder,
                      borderWidth: 1,
                    },
                    pressed && styles.nextAnalysisCountdownPressed,
                  ]}
                >
                  {canAnalyzeAgain ? (
                    <LinearGradient
                      colors={[theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.nextAnalysisActionGradient}
                    >
                      <Text style={styles.nextAnalysisActionText}>Start Hair Analysis</Text>
                      <View style={styles.nextAnalysisActionArrow}>
                        <MaterialCommunityIcons name="arrow-right" size={17} color="#FFFFFF" />
                      </View>
                    </LinearGradient>
                  ) : (
                    <View style={styles.nextAnalysisWaitingRow}>
                      <MaterialCommunityIcons name="clock-outline" size={16} color={pageColor(roles.primaryActionBackground)} />
                      <Text style={[styles.nextAnalysisCountdownText, { color: pageColor(roles.primaryActionBackground) }]}>
                        Available in {formatCountdown(nextAnalysisRemainingMs)}
                      </Text>
                    </View>
                  )}
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </AppCard>
      </View>
  );

  if (pageMode) return content;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  pageOverlay: {
    justifyContent: 'flex-start',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '92%',
    alignSelf: 'center',
    overflow: 'hidden',
    flexShrink: 1,
  },
  pageCard: {
    maxWidth: '100%',
    maxHeight: '100%',
    height: '100%',
    borderWidth: 0,
    borderRadius: 0,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  pageHeader: {
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  pageDateBlock: {
    width: '100%',
    gap: theme.spacing.md,
  },
  pageDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  pageDateIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: '#3B0711',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 7,
    elevation: 5,
  },
  pageDateCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pageDateWeekday: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  pageDateTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  pageDateTrack: {
    width: '100%',
    height: 3,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    opacity: 0.82,
  },
  pageDateAccent: {
    width: '72%',
    height: '100%',
    borderRadius: theme.radius.full,
  },
  pageInnerCard: {
    borderRadius: 18,
  },
  cardContent: {
    flexShrink: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.label,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.titleSm,
    lineHeight: theme.typography.compact.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  closeButton: {
    padding: theme.spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  scrollContent: {
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  statusCard: {
    position: 'relative',
    minHeight: 132,
    borderRadius: 22,
    padding: theme.spacing.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
    ...theme.shadows.md,
  },
  pageStatusCard: {
    borderRadius: 22,
  },
  statusCardGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: theme.radius.full,
    top: -84,
    right: -42,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  statusMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  statusMoodIcon: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  statusCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  statusEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.2,
    color: 'rgba(255, 255, 255, 0.72)',
  },
  statusLabel: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  statusMoodLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: 'rgba(255, 255, 255, 0.84)',
  },
  statusSubtext: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: 'rgba(255, 255, 255, 0.74)',
  },
  nextAnalysisCard: {
    position: 'relative',
    alignItems: 'stretch',
    gap: theme.spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 154,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  nextAnalysisGlow: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: theme.radius.full,
    top: -68,
    right: -42,
    backgroundColor: 'rgba(146, 32, 57, 0.09)',
  },
  nextAnalysisInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  nextAnalysisIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(110, 13, 34, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: '#3B0711',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 4,
  },
  nextAnalysisIconImage: {
    width: 34,
    height: 34,
  },
  nextAnalysisCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  nextAnalysisTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  nextAnalysisBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  nextAnalysisReadyBadge: {
    minHeight: 29,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 9,
    flexShrink: 0,
  },
  nextAnalysisReadyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  nextAnalysisCountdown: {
    alignSelf: 'stretch',
    minHeight: 54,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nextAnalysisCountdownPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.96 }],
  },
  nextAnalysisActionGradient: {
    flex: 1,
    alignSelf: 'stretch',
    minHeight: 54,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: theme.spacing.lg,
    paddingRight: 11,
    paddingVertical: 8,
  },
  nextAnalysisActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 14,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  nextAnalysisActionArrow: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  nextAnalysisWaitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  nextAnalysisCountdownText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  sectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.semibold,
    marginTop: 4,
  },
  entrySwitcherWrap: {
    gap: theme.spacing.sm,
  },
  entrySwitcherRow: {
    gap: theme.spacing.sm,
  },
  entryChip: {
    minWidth: 74,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
  },
  entryChipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  eventList: {
    gap: theme.spacing.md,
  },
  eventCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  eventCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  eventCardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eventCardCopy: {
    flex: 1,
    gap: 2,
  },
  eventCardTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
    lineHeight: theme.typography.compact.bodyMd * theme.typography.lineHeights.snug,
  },
  eventCardSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.snug,
  },
  eventStatusChip: {
    minHeight: 28,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eventStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  eventMetaList: {
    gap: theme.spacing.sm,
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  eventMetaText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  photoLoading: {
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoSection: {
    gap: theme.spacing.sm,
  },
  photoSectionHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  photoSectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  photoSectionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  photoSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyMd,
    fontWeight: theme.typography.weights.bold,
  },
  photoSectionHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  photoTotalBadge: {
    minHeight: 28,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    flexShrink: 0,
  },
  photoTotalText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  photoRow: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    paddingRight: theme.spacing.xxxl,
  },
  photoCard: {
    height: 216,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceMuted,
    shadowColor: '#3B0711',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 13,
    elevation: 8,
  },
  photo: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.surfaceMuted,
  },
  photoScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  photoCountBadge: {
    position: 'absolute',
    top: theme.spacing.sm,
    right: theme.spacing.sm,
    minHeight: 27,
    borderRadius: theme.radius.pill,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: 'rgba(44, 4, 13, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.42)',
  },
  photoCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  photoCaptionRow: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  photoCaption: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
    textTransform: 'capitalize',
  },
  photoPager: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoPagerDot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.full,
  },
  photoPagerDotActive: {
    width: 22,
  },
  photoRetryButton: {
    alignSelf: 'center',
    minHeight: 34,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 7,
  },
  photoRetryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
  },
  photoUnavailableCard: {
    minHeight: 82,
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  photoUnavailableIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  photoUnavailableCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  photoUnavailableTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  photoUnavailableBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
  },
  photoUnavailableRetry: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emptyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  assessmentContent: {
    gap: theme.spacing.md,
  },
  assessmentSummaryCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    borderRadius: 16,
    padding: theme.spacing.md,
  },
  assessmentSummaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  assessmentSummaryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  assessmentSummaryLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  assessmentSummary: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.md,
    columnGap: theme.spacing.sm,
  },
  metricItem: {
    width: '48%',
    minWidth: 0,
    minHeight: 78,
    borderWidth: 1,
    borderRadius: 15,
    padding: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  metricItemFull: {
    width: '100%',
  },
  metricIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  metricCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  metricValueMuted: {
    fontStyle: 'italic',
  },
  metricValueLarge: {
    fontSize: theme.typography.compact.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  insightsCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    ...theme.shadows.soft,
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  insightsIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  insightsHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  insightsTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyMd,
    fontWeight: theme.typography.weights.bold,
  },
  insightsSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  insightsCount: {
    minWidth: 30,
    height: 30,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  insightsCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
  },
  insightsBody: {
    gap: theme.spacing.sm,
  },
  insightsLead: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  bulletList: {
    gap: 0,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(110, 13, 34, 0.14)',
  },
  bulletIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bulletText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  insightsText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  metaKey: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  metaValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.snug,
  },
  insightsNoteCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: theme.spacing.sm,
  },
  insightsNoteText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
  },
  recommendationLoader: {
    marginVertical: theme.spacing.sm,
  },
  recommendationList: {
    gap: theme.spacing.sm,
  },
  recommendationCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  recommendationStep: {
    alignSelf: 'flex-start',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  recommendationTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  recommendationText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
});
