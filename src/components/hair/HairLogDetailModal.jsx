import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  if (!screening) return { label: 'No result', needsCare: false };
  const combined = [
    screening.detected_condition,
    screening.visible_damage_notes,
    screening.summary,
    screening.decision,
  ].filter(Boolean).join(' ');
  const condition = String(screening.detected_condition || '').trim();
  const needsCare = hasExplicitCareConcern(combined);
  const label = needsCare && /healthy/i.test(condition)
    ? 'Needs care'
    : condition || (needsCare ? 'Needs care' : 'Healthy');

  return {
    label,
    needsCare,
  };
};

const normalizeConditionTone = (condition = '') => {
  const normalized = String(condition || '').trim().toLowerCase();

  if (normalized.includes('healthy') || normalized.includes('good')) {
    return {
      dotColor: '#65b96f',
      label: 'Healthy',
    };
  }

  if (normalized.includes('dry') || normalized.includes('damage') || normalized.includes('frizz')) {
    return {
      dotColor: '#d89258',
      label: 'Needs care',
    };
  }

  return {
    dotColor: theme.colors.brandPrimary,
    label: condition || 'Hair check',
  };
};

const formatModalDateLabel = (value) => (
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
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

export function HairLogDetailModal({
  visible,
  dateKey = '',
  entries = [],
  events = [],
  onClose,
  pageMode = false,
  donationRequirement = null,
}) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;
  const pageColor = (fallback) => (pageMode ? primaryTextColor : fallback);
  const [activeEntryKey, setActiveEntryKey] = React.useState('');
  const [signedUrls, setSignedUrls] = React.useState({});
  const [isLoadingUrls, setIsLoadingUrls] = React.useState(false);
  const [recommendations, setRecommendations] = React.useState([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = React.useState(false);
  const [nowMs, setNowMs] = React.useState(() => Date.now());

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
    let isCancelled = false;

    if (!visible || !activeEntry) {
      setSignedUrls({});
      setRecommendations([]);
      setIsLoadingUrls(false);
      setIsLoadingRecommendations(false);
      return () => {
        isCancelled = true;
      };
    }

    const imageRows = allImages.filter((image) => image?.file_path);
    if (!imageRows.length) {
      setSignedUrls({});
      setIsLoadingUrls(false);
    } else {
      setIsLoadingUrls(true);
      Promise.all(
        imageRows.map((image) => (
          getHairSubmissionImageSignedUrl(image.file_path).then((result) => ({
            id: image.image_id || image.file_path,
            url: result.data || '',
          }))
        ))
      ).then((results) => {
        if (isCancelled) return;
        const nextUrls = {};
        results.forEach(({ id, url }) => {
          if (url) nextUrls[id] = url;
        });
        setSignedUrls(nextUrls);
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
  }, [activeEntry, allImages, visible]);

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
  const tone = hasScreening
    ? (assessment.needsCare
      ? { dotColor: '#d89258', label: 'Needs care' }
      : normalizeConditionTone(assessment.label))
    : {
      dotColor: roles.primaryActionBackground,
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
  const photoUris = allImages
    .map((image) => signedUrls[image.image_id || image.file_path])
    .filter(Boolean);
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
    { label: 'Condition', value: screening?.detected_condition || 'Not detected' },
    { label: 'Donation decision', value: screening?.decision || 'Not detected' },
    { label: 'Length', value: formatEstimatedLengthInches(screening) },
    { label: 'Color', value: screening?.detected_color || 'Not detected' },
    { label: 'Texture', value: screening?.detected_texture || 'Not detected' },
    { label: 'Density', value: screening?.detected_density || 'Not detected' },
    { label: 'Density score', value: formatDensityScore(screening?.hair_density_score) },
    { label: 'Visible scalp', value: screening?.visible_scalp_area || 'Not detected' },
    {
      label: 'Affected areas',
      value: Array.isArray(screening?.affected_regions) && screening.affected_regions.length
        ? screening.affected_regions.join(', ')
        : 'None detected',
    },
    { label: 'Shedding', value: screening?.shedding_level || 'Not detected' },
    { label: 'Dandruff', value: formatDetectedLabel(screening?.dandruff_detected) },
    { label: 'Dandruff severity', value: screening?.dandruff_severity || 'None' },
    { label: 'Lice / nits', value: formatDetectedLabel(screening?.lice_detected) },
    { label: 'Lice confidence', value: screening?.lice_confidence || 'None' },
    { label: 'Tracking status', value: screening?.improvement_tracking_status || 'Not detected' },
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
            <View style={styles.headerCopy}>
              <Text style={[styles.eyebrow, { color: pageColor(roles.metaText) }]}>{modalEyebrow}</Text>
              <Text style={[styles.title, { color: pageColor(roles.headingText) }]}>{modalTitle}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
              <AppIcon
                name={pageMode ? 'arrowLeft' : 'close'}
                size="sm"
                state="muted"
                color={pageColor(roles.metaText)}
              />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            nestedScrollEnabled
          >
            {hasScreening ? (
              <View style={[styles.statusCard, pageMode && styles.pageInnerCard, { backgroundColor: pageMode ? roles.pageBackground : roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: pageColor(tone.dotColor) }]} />
                  <Text style={[styles.statusLabel, { color: pageColor(tone.dotColor) }]}>{assessment.label}</Text>
                </View>
                <Text style={[styles.statusSubtext, { color: pageColor(roles.bodyText) }]}>
                  Saved {formatSavedDateTime(screening.created_at)}
                </Text>
              </View>
            ) : null}

            {hasScreening ? (
              <View style={[styles.nextAnalysisCard, pageMode && styles.pageInnerCard, { backgroundColor: roles.supportCardBackground, borderColor: roles.defaultCardBorder }]}>
                <View style={[styles.nextAnalysisIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                  <MaterialCommunityIcons name="timer-sand" size={18} color={roles.iconPrimaryColor} />
                </View>
                <View style={styles.nextAnalysisCopy}>
                  <Text style={[styles.nextAnalysisTitle, { color: pageColor(roles.headingText) }]}>
                    Next Hair Analysis
                  </Text>
                  <Text style={[styles.nextAnalysisBody, { color: pageColor(roles.bodyText) }]}>
                    {canAnalyzeAgain
                      ? 'You can use Hair Analysis again now.'
                      : `Available on ${nextAnalysisLabel}`}
                  </Text>
                </View>
                <View style={[styles.nextAnalysisCountdown, { borderColor: roles.defaultCardBorder }]}>
                  <Text style={[styles.nextAnalysisCountdownText, { color: pageColor(roles.primaryActionBackground) }]}>
                    {canAnalyzeAgain ? 'Ready' : formatCountdown(nextAnalysisRemainingMs)}
                  </Text>
                </View>
              </View>
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

            {hasScreening && (isLoadingUrls || photoUris.length) ? (
              <>
                <SectionTitleRow
                  title="Photos"
                  icon="file-document-outline"
                  color={pageColor(roles.headingText)}
                  iconColor={pageColor(roles.metaText)}
                  accentColor={pageColor(roles.primaryActionBackground)}
                  titleStyle={styles.sectionTitle}
                />
                {isLoadingUrls ? (
                  <View style={styles.photoLoading}>
                    <ActivityIndicator color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
                  </View>
                ) : photoUris.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
                    {photoUris.map((uri) => (
                      <Image key={uri} source={{ uri }} style={styles.photo} resizeMode="cover" />
                    ))}
                  </ScrollView>
                ) : null}
              </>
            ) : null}

            {hasScreening && hasAssessmentDetails ? (
              <>
                <SectionTitleRow
                  title="Hair Assessment"
                  icon="file-document-outline"
                  color={pageColor(roles.headingText)}
                  iconColor={pageColor(roles.metaText)}
                  accentColor={pageColor(roles.primaryActionBackground)}
                  titleStyle={styles.sectionTitle}
                />
                <View style={[styles.assessmentCard, pageMode && styles.pageInnerCard, { backgroundColor: pageMode ? roles.pageBackground : roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
                  <Text style={[styles.assessmentSummary, { color: pageColor(roles.bodyText) }]} numberOfLines={pageMode ? undefined : 2}>
                    {assessmentSummary}
                  </Text>
                  <View style={styles.metricGrid}>
                    {assessmentMetrics.map((metric) => (
                      <View key={metric.label} style={[styles.metricItem, pageMode && metric.label === 'Condition' && styles.metricItemFull]}>
                        <Text style={[styles.metaKey, { color: pageColor(roles.metaText) }]}>
                          {metric.label}
                        </Text>
                        <Text
                          style={[
                            styles.metaValue,
                            { color: pageColor(roles.headingText) },
                            metric.label === 'Length' && metric.value === 'Not detected' ? styles.metricValueMuted : null,
                            metric.label === 'Density score' ? styles.metricValueLarge : null,
                          ]}
                        >
                          {metric.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            ) : null}

            {hasScreening ? (
              <View style={[styles.insightsCard, pageMode && styles.pageInnerCard, {
                backgroundColor: pageMode ? roles.pageBackground : roles.defaultCardBackground,
                borderColor: roles.defaultCardBorder,
              }]}>
                <View style={styles.insightsHeader}>
                  <View style={[styles.insightsIconWrap, { backgroundColor: pageMode ? 'transparent' : roles.iconPrimarySurface }]}>
                    <MaterialCommunityIcons
                      name="lightbulb-on-outline"
                      size={16}
                      color={pageColor(roles.primaryActionBackground)}
                    />
                  </View>
                  <Text style={[styles.insightsTitle, { color: pageColor(roles.primaryActionBackground) }]}>
                    Saved analysis notes
                  </Text>
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
                            <View style={[styles.bulletDot, { backgroundColor: pageColor(roles.primaryActionBackground) }]} />
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
    flexDirection: 'row-reverse',
    paddingBottom: theme.spacing.sm,
  },
  pageInnerCard: {
    borderRadius: 6,
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
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxxl,
  },
  statusCard: {
    borderRadius: 6,
    borderWidth: 1,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
  },
  statusLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  statusSubtext: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  nextAnalysisCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    padding: theme.spacing.md,
  },
  nextAnalysisIcon: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  nextAnalysisCopy: {
    flex: 1,
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
  nextAnalysisCountdown: {
    minWidth: 72,
    minHeight: 34,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    flexShrink: 0,
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
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRow: {
    gap: theme.spacing.md,
    paddingBottom: 4,
  },
  photo: {
    width: 84,
    height: 84,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceMuted,
  },
  emptyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  assessmentCard: {
    borderRadius: 6,
    borderWidth: 1,
    padding: theme.spacing.md,
    gap: theme.spacing.lg,
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
    gap: 2,
  },
  metricItemFull: {
    width: '100%',
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
    borderRadius: 6,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  insightsIconWrap: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  insightsTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
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
    gap: theme.spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  bulletDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
    marginTop: 7,
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
    borderRadius: 12,
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
