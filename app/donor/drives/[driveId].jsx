import React from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '../../../src/components/ui/ScreenContainer';
import { AppButton } from '../../../src/components/ui/AppButton';
import { AppIcon } from '../../../src/components/ui/AppIcon';
import { LocalQrCode } from '../../../src/components/ui/LocalQrCode';
import { StatusBanner } from '../../../src/components/ui/StatusBanner';
import { useAuth } from '../../../src/providers/AuthProvider';
import {
  createDonationDriveRegistration,
  fetchDonationDriveDetail,
  fetchDonationDrivePreview,
} from '../../../src/features/donorHome.api';
import {
  buildDriveInvitationQrPayload,
  getDonorDonationsModuleData,
} from '../../../src/features/donorDonations.service';
import { DONOR_PERMISSION_REASONS } from '../../../src/features/donorCompliance.service';
import { supabase } from '../../../src/api/supabase/client';
import { resolveThemeRoles, theme } from '../../../src/design-system/theme';
import { Map, Camera, Marker } from '@maplibre/maplibre-react-native';

const DRIVE_REALTIME_DEBOUNCE_MS = 380;
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const formatDriveDate = (startDate, endDate) => {
  if (!startDate) return 'Date to follow';
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  const formatter = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  if (!end || start.toDateString() === end.toDateString()) return formatter.format(start);
  return `${formatter.format(start)} - ${formatter.format(end)}`;
};

const formatDriveTime = (startDate, endDate) => {
  if (!startDate) return '';
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  const formatTime = (date) => {
    const options = { hour: 'numeric' };
    if (date.getMinutes() !== 0) {
      options.minute = '2-digit';
    }
    return new Intl.DateTimeFormat('en-US', options).format(date);
  };

  if (!end) return formatTime(start);
  return `${formatTime(start)} - ${formatTime(end)}`;
};

const isDriveEnded = (drive = null) => {
  const compareDate = drive?.end_date || drive?.start_date || null;
  if (!compareDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(compareDate).getTime() < today.getTime();
};

const normalizeRealtimeDriveRegistration = (row = {}) => ({
  registration_id: row?.Event_Attendee_ID || row?.registration_id || null,
  donation_drive_id: row?.Event_Request_ID || row?.donation_drive_id || null,
  user_id: row?.User_ID || row?.user_id || null,
  attendee_type: row?.Attendee_Type || row?.attendee_type || 'Donor',
  waybill_code: row?.Waybill_Code || row?.waybill_code || null,
  registration_status: row?.Registration_Status || row?.registration_status || '',
  attendance_status: row?.Attendance_Status || row?.attendance_status || '',
  registered_at: row?.Created_At || row?.registered_at || null,
  updated_at: row?.Updated_At || row?.updated_at || null,
  attendance_marked_at: normalizeRsvpStatus(row?.Attendance_Status || row?.attendance_status) === 'present'
    ? (row?.Updated_At || row?.updated_at || null)
    : null,
});

const isApprovedRegistration = (registration = null) => (
  ['approved', 'joined', 'confirmed', 'accepted'].includes(
    String(registration?.registration_status || '').trim().toLowerCase()
  )
);

const normalizeRsvpStatus = (value = '') => (
  String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ')
);

const isPresentRegistration = (registration = null) => {
  if (!registration) return false;
  if (registration?.attendance_marked_at) return true;
  return ['present', 'attended', 'checked in', 'marked'].includes(
    normalizeRsvpStatus(registration?.attendance_status)
  );
};

const buildDirectionsUrl = (drive = null) => {
  const latitude = Number(drive?.latitude);
  const longitude = Number(drive?.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const coordinate = `${latitude},${longitude}`;
    if (Platform.OS === 'ios') return `http://maps.apple.com/?daddr=${coordinate}`;
    return `geo:${coordinate}?q=${coordinate}`;
  }

  const address = drive?.address_label || drive?.location_label || '';
  if (!address) return '';
  return `geo:0,0?q=${encodeURIComponent(address)}`;
};

const getDriveCoordinates = (drive = null) => {
  const latitude = Number(drive?.latitude);
  const longitude = Number(drive?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
};

const getMapPreviewLabel = (drive = null) => (
  drive?.address_label || drive?.location_label || 'Tap to view directions.'
);

const useResponsiveThemeRoles = (resolvedTheme) => {
  const { width } = useWindowDimensions();
  return React.useMemo(
    () => resolveThemeRoles(resolvedTheme, { isMobile: width < 768 }),
    [resolvedTheme, width]
  );
};

function EventTopBar({ title, onBack }) {
  const { resolvedTheme } = useAuth();
  const roles = useResponsiveThemeRoles(resolvedTheme);

  return (
    <View style={[styles.topBar, { backgroundColor: roles.primaryActionBackground }]}>
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
        <AppIcon name="arrowLeft" state="inverse" color={roles.primaryActionText} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.topBarTitle, { color: roles.primaryActionText }]}>
        {title}
      </Text>
      <View style={styles.topBarSpacer} />
    </View>
  );
}

function EventMapPreview({ drive }) {
  const { resolvedTheme } = useAuth();
  const roles = useResponsiveThemeRoles(resolvedTheme);
  const coordinates = getDriveCoordinates(drive);
  const directionsUrl = buildDirectionsUrl(drive);
  const mapCoordinate = coordinates ? [coordinates.longitude, coordinates.latitude] : null;

  const handleOpenDirections = React.useCallback(async () => {
    if (!directionsUrl) return;
    await Linking.openURL(directionsUrl);
  }, [directionsUrl]);

  if (!directionsUrl && !coordinates) return null;

  return (
    <View
      style={[
        styles.mapPreview,
        { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder },
      ]}
    >
      {mapCoordinate ? (
        <Map style={styles.mapNativeView} mapStyle={OPENFREEMAP_STYLE} scrollEnabled={false} rotateEnabled={false} pitchEnabled={false}>
          <Camera initialViewState={{ center: mapCoordinate, zoom: 14 }} />
          <Marker id={`drive-${drive?.event_request_id || drive?.Event_Request_ID || 'location'}`} lngLat={mapCoordinate}>
            <View style={styles.mapMarker}>
              <MaterialCommunityIcons name="map-marker-radius-outline" size={34} color={roles.primaryActionBackground} />
            </View>
          </Marker>
        </Map>
      ) : (
        <View style={styles.mapFallback}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={34} color={roles.primaryActionBackground} />
          <Text style={[styles.mapFallbackTitle, { color: roles.headingText }]}>
            {coordinates ? 'Map preview unavailable' : 'Event coordinates needed'}
          </Text>
          <Text numberOfLines={2} style={[styles.mapFallbackSubtitle, { color: roles.bodyText }]}>
            {coordinates ? getMapPreviewLabel(drive) : 'Add latitude and longitude to enable directions.'}
          </Text>
        </View>
      )}

      {mapCoordinate ? (
        <Text style={styles.mapAttribution}>
          © OpenStreetMap contributors © OpenFreeMap
        </Text>
      ) : null}

      {directionsUrl ? (
        <Pressable
          onPress={handleOpenDirections}
          accessibilityRole="button"
          accessibilityLabel="Open event location in maps"
          style={({ pressed }) => [
            styles.mapDirectionsOverlay,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={[styles.mapDirectionsBadge, { backgroundColor: roles.defaultCardBackground }]}>
            <MaterialCommunityIcons name="directions" size={15} color={roles.primaryActionBackground} />
            <Text style={[styles.mapDirectionsText, { color: roles.headingText }]}>Directions</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

function DetailIconRow({ icon, value, meta, onPress }) {
  const { resolvedTheme } = useAuth();
  const roles = useResponsiveThemeRoles(resolvedTheme);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;
  const content = (
    <View style={styles.detailIconRow}>
      <View style={[styles.detailIcon, { backgroundColor: roles.pageBackground }]}>
        <MaterialCommunityIcons name={icon} size={18} color={primaryTextColor} />
      </View>
      <View style={styles.detailIconCopy}>
        <Text style={[styles.detailIconValue, { color: primaryTextColor }]}>{value}</Text>
        {meta ? <Text style={[styles.detailIconMeta, { color: primaryTextColor }]}>{meta}</Text> : null}
      </View>
      {onPress ? <MaterialCommunityIcons name="chevron-right" size={22} color={primaryTextColor} /> : null}
    </View>
  );

  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed ? styles.pressed : null]}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

function HairEligibilitySection({
  isRegisteredForDrive = false,
  hasHairScanLog = false,
  isAiEligible = false,
  hairEligibilityMessage = '',
  ended = false,
  onScanPress,
}) {
  const { resolvedTheme } = useAuth();
  const roles = useResponsiveThemeRoles(resolvedTheme);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;

  if (isRegisteredForDrive || ended) return null;
  if (hasHairScanLog && isAiEligible) return null;

  const hasScannedButNotEligible = hasHairScanLog && !isAiEligible;
  const icon = hasScannedButNotEligible ? 'alert-circle-outline' : 'hair-dryer-outline';
  const surfaceColor = roles.defaultCardBackground;
  const borderColor = roles.defaultCardBorder;
  const title = hasScannedButNotEligible ? 'Not eligible yet' : 'Hair scan required';

  return (
    <View style={[styles.eligibilityBanner, { backgroundColor: surfaceColor, borderColor }]}>
      <View style={[styles.eligibilityIconWrap, { backgroundColor: roles.pageBackground }]}>
        <MaterialCommunityIcons name={icon} size={18} color={primaryTextColor} />
      </View>
      <View style={styles.eligibilityContent}>
        <Text style={[styles.eligibilityTitle, { color: primaryTextColor }]}>{title}</Text>
        <Text style={[styles.eligibilityMessage, { color: primaryTextColor }]}>{hairEligibilityMessage}</Text>
        {!hasHairScanLog && onScanPress ? (
          <Pressable
            onPress={onScanPress}
            style={({ pressed }) => [styles.eligibilityScanLink, pressed ? styles.pressed : null]}
            accessibilityRole="button"
            accessibilityLabel="Go to Hair Scan"
          >
            <Text style={[styles.eligibilityScanLinkText, { color: primaryTextColor }]}>
              Scan
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function EventRsvpQrCard({ drive }) {
  const { resolvedTheme } = useAuth();
  const roles = useResponsiveThemeRoles(resolvedTheme);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;
  const registration = drive?.registration || null;
  const hasRsvp = Boolean(registration?.registration_id);
  const isVoluntary = String(registration?.attendee_type || '').trim().toLowerCase() === 'voluntary';
  const qrPayload = hasRsvp ? buildDriveInvitationQrPayload({ drive, registration }) : '';

  if (!hasRsvp || !qrPayload) return null;

  return (
    <View style={[styles.rsvpQrCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
      <View style={styles.rsvpQrHeader}>
        <View style={styles.rsvpQrHeaderCopy}>
          <Text style={[styles.rsvpQrTitle, { color: primaryTextColor }]}>RSVP QR</Text>
          <Text style={[styles.rsvpQrSubtitle, { color: primaryTextColor }]}>
            Staff scans this at the event site to mark you Present.
          </Text>
        </View>
        <View style={[styles.rsvpTypeBadge, { backgroundColor: roles.supportCardBackground, borderColor: roles.defaultCardBorder }]}>
          <Text style={[styles.rsvpTypeText, { color: primaryTextColor }]}>
            {isVoluntary ? 'Voluntary' : 'Donor'}
          </Text>
        </View>
      </View>

      <View style={[styles.rsvpQrFrame, { borderColor: roles.defaultCardBorder }]}>
        <LocalQrCode
          value={qrPayload}
          size={210}
          color={theme.colors.brandPrimary}
          backgroundColor={theme.colors.backgroundPrimary}
        />
      </View>
    </View>
  );
}

function EventDetailsPanel({
  drive,
  shownRegistrationCount = 0,
  isRegisteredForDrive = false,
  actionTitle,
  actionDisabled = false,
  onRsvpPress,
  onAttendOnlyPress,
  isSubmittingRsvp = false,
  isSubmittingAttendOnly = false,
  hasHairScanLog = false,
  isAiEligible = false,
  hairEligibilityMessage = '',
  ended = false,
  onScanPress,
}) {
  const { resolvedTheme } = useAuth();
  const roles = useResponsiveThemeRoles(resolvedTheme);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;
  const directionsUrl = buildDirectionsUrl(drive);
  const shownCount = Number(shownRegistrationCount) || 0;
  const overviewText = drive?.event_overview
    || 'Join this Donivra hair donation drive and help provide meaningful support to people who need wigs and care.';
  const isVoluntaryRegistration = String(drive?.registration?.attendee_type || '').trim().toLowerCase() === 'voluntary';
  const attendanceMeta = isRegisteredForDrive
    ? isVoluntaryRegistration
      ? 'Voluntary attendee. You can observe or inquire at the event.'
      : (isPresentRegistration(drive?.registration)
        ? 'You are marked present.'
        : 'You are counted for this event.')
    : 'RSVP to be counted.';
  const canDonateAndParticipate = hasHairScanLog && isAiEligible && !ended && !isRegisteredForDrive;
  const canAttendOnly = !ended && !isRegisteredForDrive;
  const shouldShowRegisteredAction = ended || (isRegisteredForDrive && !actionDisabled);

  return (
    <View style={styles.detailsBlock}>
      <View style={styles.detailsCopy}>
        <Text style={[styles.eventTitle, { color: primaryTextColor }]}>
          {drive?.event_title || 'Donation drive'}
        </Text>
        <Text style={[styles.eventDescription, { color: primaryTextColor }]}>
          {overviewText}
        </Text>
      </View>

      <View style={styles.detailIconList}>
        <DetailIconRow
          icon="calendar-month-outline"
          value={formatDriveDate(drive?.start_date, drive?.end_date)}
        />
        <DetailIconRow
          icon="clock-outline"
          value={formatDriveTime(drive?.start_date, drive?.end_date) || 'Time to follow'}
        />
        <DetailIconRow
          icon="map-marker-outline"
          value={drive?.address_label || drive?.location_label || 'Location to follow'}
          meta={directionsUrl ? 'Tap map for directions' : ''}
          onPress={directionsUrl ? () => Linking.openURL(directionsUrl) : null}
        />
      </View>

      {shouldShowRegisteredAction ? (
        <AppButton
          title={actionTitle || 'RSVP'}
          onPress={onRsvpPress}
          loading={isSubmittingRsvp}
          disabled={actionDisabled}
          size="sm"
          style={styles.rsvpButton}
        />
      ) : !isRegisteredForDrive && !ended ? (
        <View style={styles.participationOptions}>
          <Text style={[styles.participationTitle, { color: primaryTextColor }]}>Choose how you will join</Text>
          <AppButton
            title="Donate and participate"
            onPress={onRsvpPress}
            loading={isSubmittingRsvp}
            disabled={!canDonateAndParticipate || isSubmittingAttendOnly}
            size="sm"
            style={styles.participationButton}
            leading={<MaterialCommunityIcons name="gift-outline" size={16} color={roles.primaryActionText} />}
          />
          <AppButton
            title="Attend only"
            variant="outline"
            onPress={onAttendOnlyPress}
            loading={isSubmittingAttendOnly}
            disabled={!canAttendOnly || isSubmittingRsvp}
            size="sm"
            style={styles.participationButton}
            textColorOverride={primaryTextColor}
            leading={<MaterialCommunityIcons name="account-eye-outline" size={16} color={primaryTextColor} />}
          />
          <Text style={[styles.participationHelper, { color: primaryTextColor }]}>
            Attend-only RSVPs are saved as voluntary attendees for visitors who want to observe or inquire without donating hair.
          </Text>
        </View>
      ) : null}

      <HairEligibilitySection
        isRegisteredForDrive={isRegisteredForDrive}
        hasHairScanLog={hasHairScanLog}
        isAiEligible={isAiEligible}
        hairEligibilityMessage={hairEligibilityMessage}
        ended={ended}
        onScanPress={onScanPress}
      />

      <EventRsvpQrCard drive={drive} />

      <EventMapPreview drive={drive} />

      <View style={styles.attendingSection}>
        <Text style={[styles.sectionHeading, { color: primaryTextColor }]}>Who&apos;s Attending</Text>
        <View style={[styles.attendingCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
          <View style={[styles.attendingIcon, { backgroundColor: roles.pageBackground }]}>
            <MaterialCommunityIcons name="account-group-outline" size={18} color={primaryTextColor} />
          </View>
          <View style={styles.attendingCopy}>
            <Text style={[styles.attendingCount, { color: primaryTextColor }]}>
              {shownCount > 0 ? `${shownCount} attending` : 'No registered donors yet'}
            </Text>
            <Text style={[styles.attendingMeta, { color: primaryTextColor }]}>
              {attendanceMeta}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function DonorDriveDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const driveId = Array.isArray(params.driveId) ? params.driveId[0] : params.driveId;
  const numericDriveId = Number(driveId);
  const { user, profile, resolvedTheme } = useAuth();
  const roles = useResponsiveThemeRoles(resolvedTheme);
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = React.useState(true);
  const [drive, setDrive] = React.useState(null);
  const [registrationCount, setRegistrationCount] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [feedbackMessage, setFeedbackMessage] = React.useState('');
  const [feedbackVariant, setFeedbackVariant] = React.useState('info');
  const [isSubmittingRsvp, setIsSubmittingRsvp] = React.useState(false);
  const [isSubmittingAttendOnly, setIsSubmittingAttendOnly] = React.useState(false);
  const [donationFlowState, setDonationFlowState] = React.useState({
    hasOngoingDonation: false,
    ongoingDonationMessage: '',
    hasHairScanLog: false,
    isAiEligible: false,
    requiresPostDonationAnalysis: false,
    hairEligibilityMessage: '',
    hasSubmittedDonationForDrive: false,
  });

  const driveImageUrl = drive?.event_image_url || drive?.organization_logo_url || '';
  const hasOngoingDonation = Boolean(donationFlowState.hasOngoingDonation);
  const hasHairScanLog = Boolean(donationFlowState.hasHairScanLog);
  const hasSubmittedDonationForDrive = Boolean(donationFlowState.hasSubmittedDonationForDrive);
  const requiresPostDonationAnalysis = Boolean(donationFlowState.requiresPostDonationAnalysis);
  const ended = isDriveEnded(drive);
  const ongoingDonationMessage = donationFlowState.ongoingDonationMessage
    || 'You already have an ongoing donation. Please complete or wait for the current donation process to finish before starting a new one.';
  const hairEligibilityMessage = donationFlowState.hairEligibilityMessage
    || 'Scan your hair first so the system can confirm if you are eligible to join this donation event.';

  const loadRegistrationCount = React.useCallback(async () => {
    if (!Number.isFinite(numericDriveId) || numericDriveId <= 0) return;
    const countResult = await supabase
      .from('Event_Attendees')
      .select('Event_Attendee_ID', { count: 'exact', head: true })
      .eq('Event_Request_ID', numericDriveId);

    if (!countResult.error && Number.isFinite(countResult.count)) {
      setRegistrationCount(countResult.count || 0);
      return;
    }

    const rowsResult = await supabase
      .from('Event_Attendees')
      .select('Event_Attendee_ID,User_ID')
      .eq('Event_Request_ID', numericDriveId)
      .limit(500);

    if (!rowsResult.error) {
      const rows = rowsResult.data || [];
      const currentUserRegistered = profile?.user_id
        ? rows.some((row) => row?.User_ID === profile.user_id || row?.user_id === profile.user_id)
        : false;
      setRegistrationCount(Math.max(rows.length, currentUserRegistered ? 1 : 0));
      return;
    }

    setRegistrationCount((current) => current || 0);
  }, [numericDriveId, profile?.user_id]);

  const loadDrive = React.useCallback(async ({ silent = false } = {}) => {
    if (!driveId || !Number.isFinite(numericDriveId) || numericDriveId <= 0) {
      setErrorMessage('Drive details are not available right now.');
      setIsLoading(false);
      return;
    }

    if (!silent) setIsLoading(true);
    setErrorMessage('');

    const [driveResult, donationModuleResult] = await Promise.all([
      fetchDonationDriveDetail(numericDriveId, profile?.user_id || null),
      getDonorDonationsModuleData({
        userId: user?.id || null,
        databaseUserId: profile?.user_id || null,
        driveLimit: 8,
      }),
      loadRegistrationCount(),
    ]);

    if (driveResult.error) {
      setErrorMessage('Drive details could not be loaded right now.');
    }

    const nextDrive = driveResult.data || null;
    setDrive(nextDrive);
    setRegistrationCount((current) => Math.max(
      current || 0,
      nextDrive?.registration?.registration_id ? 1 : 0
    ));
    const hasSubmittedDonationForDrive = [
      ...(Array.isArray(donationModuleResult.activeSubmissions) ? donationModuleResult.activeSubmissions : []),
      donationModuleResult.latestSubmission,
    ].filter(Boolean).some((submission) => Number(submission?.donation_drive_id) === Number(numericDriveId));

    setDonationFlowState({
      hasOngoingDonation: Boolean(donationModuleResult.hasOngoingDonation),
      ongoingDonationMessage: donationModuleResult.ongoingDonationMessage || '',
      hasHairScanLog: Boolean(donationModuleResult.latestScreening && donationModuleResult.latestAnalysisEntry?.submission),
      isAiEligible: Boolean(donationModuleResult.isAiEligible),
      requiresPostDonationAnalysis: Boolean(donationModuleResult.requiresPostDonationAnalysis),
      hairEligibilityMessage: donationModuleResult.requiresPostDonationAnalysis
        ? 'Your previous donated hair has already been cut. Run Hair Analysis again so the app can verify if your current hair is long enough for another event donation.'
        : donationModuleResult.latestScreening
          ? donationModuleResult.isAiEligible
            ? 'Your hair is cleared for this drive.'
            : (() => {
                const reason = String(donationModuleResult.latestAiEligibility?.reason || '').trim();
                const firstSentence = reason.split(/[.!]/)[0].trim();
                return firstSentence ? `${firstSentence}.` : 'Follow the scan recommendations and try again.';
              })()
          : 'Complete a CheckHair scan to check eligibility.',
      hasSubmittedDonationForDrive,
    });
    setIsLoading(false);
  }, [driveId, loadRegistrationCount, numericDriveId, profile?.user_id, user?.id]);

  const driveRealtimeRefreshRef = React.useRef(null);
  const scheduleDriveRealtimeRefresh = React.useCallback(() => {
    if (driveRealtimeRefreshRef.current) clearTimeout(driveRealtimeRefreshRef.current);
    driveRealtimeRefreshRef.current = setTimeout(() => {
      void loadDrive({ silent: true });
    }, DRIVE_REALTIME_DEBOUNCE_MS);
  }, [loadDrive]);

  React.useEffect(() => {
    loadDrive();
  }, [loadDrive]);

  React.useEffect(() => () => {
    if (driveRealtimeRefreshRef.current) clearTimeout(driveRealtimeRefreshRef.current);
  }, []);

  React.useEffect(() => {
    if (!user?.id || !profile?.user_id || !Number.isFinite(numericDriveId) || numericDriveId <= 0) return undefined;

    const channel = supabase.channel(`donor-drive-live-${profile.user_id}-${numericDriveId}`);
    const onRealtimeEvent = () => scheduleDriveRealtimeRefresh();
    const onCertificateRealtimeEvent = (payload = {}) => {
      if (payload?.eventType !== 'INSERT') return;
      setFeedbackMessage('Certificate is now available in Achievements.');
      setFeedbackVariant('success');
      scheduleDriveRealtimeRefresh();
    };
    const onRegistrationRealtimeEvent = (payload = {}) => {
      const nextRow = payload.new || {};
      const oldRow = payload.old || {};
      const nextRegistration = normalizeRealtimeDriveRegistration(nextRow);
      const oldRegistration = normalizeRealtimeDriveRegistration(oldRow);
      const registrationDriveId = Number(nextRegistration.donation_drive_id || oldRegistration.donation_drive_id);
      const registrationUserId = Number(nextRegistration.user_id || oldRegistration.user_id);

      if (registrationDriveId === numericDriveId) {
        void loadRegistrationCount();
      }

      if (registrationDriveId === numericDriveId && registrationUserId === Number(profile.user_id)) {
        setDrive((current) => {
          if (!current?.donation_drive_id) return current;
          if (payload.eventType === 'DELETE') {
            return { ...current, registration: null };
          }
          return {
            ...current,
            registration: {
              ...(current.registration || {}),
              ...nextRegistration,
            },
          };
        });

        if (isApprovedRegistration(nextRegistration)) {
          setFeedbackMessage('Your RSVP is approved for this event.');
          setFeedbackVariant('success');
        }
      }

      scheduleDriveRealtimeRefresh();
    };

    channel
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Event_Requests',
        filter: `Event_Request_ID=eq.${numericDriveId}`,
      }, onRealtimeEvent)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Event_Attendees',
        filter: `Event_Request_ID=eq.${numericDriveId}`,
      }, onRegistrationRealtimeEvent)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Event_Attendees',
        filter: `User_ID=eq.${profile.user_id}`,
      }, onRegistrationRealtimeEvent)
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
  }, [loadRegistrationCount, numericDriveId, profile?.user_id, scheduleDriveRealtimeRefresh, user?.id]);

  const refreshDriveRegistration = React.useCallback(async () => {
    if (!drive?.donation_drive_id || !profile?.user_id) return null;
    const refreshed = await fetchDonationDrivePreview(drive.donation_drive_id, profile.user_id);
    if (refreshed.data) {
      setDrive(refreshed.data);
      return refreshed.data;
    }
    return null;
  }, [drive?.donation_drive_id, profile?.user_id]);

  const handleDriveRsvp = React.useCallback(async () => {
    if (!drive?.donation_drive_id || ended) return;

    if ((!hasHairScanLog || !donationFlowState.isAiEligible) && !drive.registration?.registration_id) {
      setFeedbackMessage(hairEligibilityMessage);
      setFeedbackVariant('info');
      if (!hasHairScanLog || requiresPostDonationAnalysis) router.navigate('/donor/donations');
      return;
    }

    if (hasOngoingDonation && !drive.registration?.registration_id) {
      setFeedbackMessage(ongoingDonationMessage);
      setFeedbackVariant('info');
      return;
    }

    if (hasOngoingDonation && drive.registration?.registration_id && hasSubmittedDonationForDrive) {
      router.navigate(`/donor/status?driveId=${drive.donation_drive_id}`);
      return;
    }

    if (drive.registration?.registration_id) {
      const isPresent = isPresentRegistration(drive.registration);
      if (isPresent) {
        router.navigate(`/donor/status?driveId=${drive.donation_drive_id}`);
        return;
      }
      return;
    }

    if (!profile?.user_id) {
      setFeedbackMessage('Your donor account is required before joining this event.');
      setFeedbackVariant('info');
      return;
    }

    setIsSubmittingRsvp(true);
    const result = await createDonationDriveRegistration({
      driveId: drive.donation_drive_id,
      databaseUserId: profile.user_id,
      hasEligibleHairScan: Boolean(donationFlowState.isAiEligible),
      hasHairScanLog,
      requiresPostDonationAnalysis,
    });
    setIsSubmittingRsvp(false);

    if (result.error || !result.data?.registration_id) {
      if (result.error?.code === DONOR_PERMISSION_REASONS.profileIncomplete) {
        router.navigate('/profile');
        return;
      }
      if (result.error?.code === DONOR_PERMISSION_REASONS.guardianConsentRequired) {
        router.navigate('/donor/guardian-consent');
        return;
      }
      setFeedbackMessage(result.error?.message || 'Event registration could not be saved right now.');
      setFeedbackVariant('error');
      return;
    }

    await loadRegistrationCount();
    await refreshDriveRegistration();
    setRegistrationCount((current) => Math.max(current || 0, 1));
    setFeedbackMessage(result.alreadyRegistered ? 'You are already registered for this event.' : 'Registration saved.');
    setFeedbackVariant('success');
  }, [
    drive,
    ended,
    hairEligibilityMessage,
    hasOngoingDonation,
    hasHairScanLog,
    requiresPostDonationAnalysis,
    donationFlowState.isAiEligible,
    hasSubmittedDonationForDrive,
    loadRegistrationCount,
    ongoingDonationMessage,
    profile?.user_id,
    refreshDriveRegistration,
    router,
  ]);

  const handleAttendOnlyRsvp = React.useCallback(async () => {
    if (!drive?.donation_drive_id || ended) return;

    if (drive.registration?.registration_id) {
      setFeedbackMessage('You are already registered for this event.');
      setFeedbackVariant('info');
      return;
    }

    if (!profile?.user_id) {
      setFeedbackMessage('Your donor account is required before joining this event.');
      setFeedbackVariant('info');
      return;
    }

    setIsSubmittingAttendOnly(true);
    const result = await createDonationDriveRegistration({
      driveId: drive.donation_drive_id,
      databaseUserId: profile.user_id,
      attendanceOnly: true,
    });
    setIsSubmittingAttendOnly(false);

    if (result.error || !result.data?.registration_id) {
      setFeedbackMessage(result.error?.message || 'Attendance RSVP could not be saved right now.');
      setFeedbackVariant('error');
      return;
    }

    await loadRegistrationCount();
    await refreshDriveRegistration();
    setRegistrationCount((current) => Math.max(current || 0, 1));
    setFeedbackMessage(result.alreadyRegistered ? 'You are already registered as a voluntary attendee.' : 'Voluntary RSVP saved.');
    setFeedbackVariant('success');
  }, [
    drive,
    ended,
    loadRegistrationCount,
    profile?.user_id,
    refreshDriveRegistration,
  ]);

  const isRegisteredForDrive = Boolean(drive?.registration?.registration_id);
  const isDrivePresent = isPresentRegistration(drive?.registration);
  const hasRegistrationDonationLink = Boolean(drive?.registration?.submission_id);
  const actionTitle = ended
    ? 'Event ended'
    : !isRegisteredForDrive
      ? 'RSVP'
      : isDrivePresent && hasRegistrationDonationLink
        ? 'Open Donation Module'
        : isDrivePresent
          ? 'Checked in'
          : 'Registered';

  const actionDisabled = isLoading
    || ended
    || (isRegisteredForDrive && (!isDrivePresent || !hasRegistrationDonationLink));
  const shownRegistrationCount = Math.max(registrationCount, isRegisteredForDrive ? 1 : 0);

  return (
    <ScreenContainer
      scrollable={false}
      safeArea
      variant="default"
      contentStyle={[styles.screenContent, { backgroundColor: roles.pageBackground }]}
    >
      <EventTopBar title="Event Details" onBack={() => router.back()} />

      <ScrollView
        style={styles.detailScroll}
        contentContainerStyle={[styles.detailContent, { paddingBottom: drive ? theme.spacing.xl + insets.bottom : theme.spacing.lg }]}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        {errorMessage ? (
          <StatusBanner
            message={errorMessage}
            variant="info"
            presentation="floating"
            visible={Boolean(errorMessage)}
            autoDismissMs={3000}
            onDismiss={() => setErrorMessage('')}
          />
        ) : null}
        {feedbackMessage ? (
          <StatusBanner
            message={feedbackMessage}
            variant={feedbackVariant}
            presentation="floating"
            visible={Boolean(feedbackMessage)}
            autoDismissMs={3000}
            onDismiss={() => setFeedbackMessage('')}
          />
        ) : null}

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
            <Text style={[styles.loadingText, { color: roles.bodyText }]}>Loading event details</Text>
          </View>
        ) : drive ? (
          <>
            <View style={[styles.hero, { backgroundColor: roles.iconPrimarySurface }]}>
              {driveImageUrl ? (
                <Image
                  source={{ uri: driveImageUrl }}
                  style={styles.heroImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.heroFallback}>
                  <MaterialCommunityIcons name="calendar-heart" size={52} color={roles.primaryActionBackground} />
                  <Text numberOfLines={2} style={[styles.heroFallbackTitle, { color: roles.headingText }]}>
                    {drive.event_title || 'Donation drive'}
                  </Text>
                </View>
              )}
            </View>

            <EventDetailsPanel
              drive={drive}
              shownRegistrationCount={shownRegistrationCount}
              isRegisteredForDrive={isRegisteredForDrive}
              actionTitle={actionTitle}
              actionDisabled={actionDisabled}
              onRsvpPress={handleDriveRsvp}
              onAttendOnlyPress={handleAttendOnlyRsvp}
              isSubmittingRsvp={isSubmittingRsvp}
              isSubmittingAttendOnly={isSubmittingAttendOnly}
              hasHairScanLog={hasHairScanLog}
              isAiEligible={donationFlowState.isAiEligible}
              hairEligibilityMessage={hairEligibilityMessage}
              ended={ended}
              onScanPress={() => router.navigate('/donor/donations')}
            />
        </>
      ) : (
        <Text style={[styles.emptyText, { color: roles.bodyText }]}>Drive details are not available right now.</Text>
      )}

      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  detailScroll: {
    flex: 1,
  },
  detailContent: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: 0,
  },
  topBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    marginBottom: 0,
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  topBarSpacer: {
    width: 40,
    height: 40,
  },
  pressed: {
    opacity: 0.75,
    transform: [{ scale: 0.98 }],
  },
  bannerGap: {
    marginBottom: theme.spacing.sm,
  },
  hero: {
    height: 228,
    marginHorizontal: -theme.spacing.md,
    borderRadius: 0,
    overflow: 'hidden',
    marginBottom: theme.spacing.md,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  heroFallbackTitle: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  sectionGap: {
    marginBottom: theme.spacing.lg,
  },
  eventPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  eventPanelTitle: {
    flex: 1,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  detailIconList: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  detailIconRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  detailIconCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  detailIconValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.compact.body * 1.35,
  },
  detailIconMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * 1.35,
  },
  mapPreview: {
    marginTop: theme.spacing.md,
    height: 180,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapNativeView: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  mapMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapAttribution: {
    position: 'absolute',
    left: theme.spacing.xs,
    bottom: theme.spacing.xs,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    color: '#374151',
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
  },
  mapFallback: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: 4,
    zIndex: 2,
  },
  mapDirectionsOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  mapDirectionsBadge: {
    position: 'absolute',
    right: theme.spacing.sm,
    bottom: theme.spacing.sm,
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  mapDirectionsText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  mapFallbackTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  mapFallbackSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * 1.4,
    textAlign: 'center',
  },
  detailsBlock: {
    paddingBottom: theme.spacing.lg,
  },
  detailsCopy: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  eventTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  eventDescription: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * 1.65,
  },
  rsvpButton: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  rsvpQrCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  rsvpQrHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  rsvpQrHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rsvpQrTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodyMd,
    fontWeight: theme.typography.weights.bold,
  },
  rsvpQrSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * 1.4,
  },
  rsvpTypeBadge: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
  },
  rsvpTypeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  rsvpQrFrame: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  participationOptions: {
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  participationTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  participationButton: {
    width: '100%',
  },
  participationHelper: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * 1.55,
  },
  attendingSection: {
    marginTop: theme.spacing.md,
  },
  sectionHeading: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    marginBottom: theme.spacing.sm,
  },
  attendingCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  attendingIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  attendingCopy: {
    flex: 1,
    minWidth: 0,
  },
  attendingCount: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  attendingMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * 1.4,
    marginTop: 2,
  },
  accessCodeInput: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.md,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    letterSpacing: 0,
  },
  fixedBottomCta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    ...theme.shadows.soft,
  },
  loadingState: {
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  loadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  qrWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.sm,
  },
  qrImage: {
    width: 240,
    height: 240,
  },
  qrHelper: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
  },
  qrStatusBanner: {
    width: '100%',
    marginTop: theme.spacing.md,
  },
  registrationStateRow: {
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  registrationStateText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * 1.45,
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
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  emptyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    paddingVertical: theme.spacing.xs,
  },
  eligibilityBanner: {
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  eligibilityIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  eligibilityContent: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  eligibilityTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  eligibilityMessage: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * 1.55,
  },
  eligibilityScanLink: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.xs,
  },
  eligibilityScanLinkText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
});
