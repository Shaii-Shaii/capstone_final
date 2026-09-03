import React from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Camera, Map as MapLibreMap, Marker } from '@maplibre/maplibre-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DashboardHeaderSurface } from '../../../src/components/layout/DashboardHeaderSurface';
import { DashboardLayout } from '../../../src/components/layout/DashboardLayout';
import { DonorTopBar } from '../../../src/components/donor/DonorTopBar';
import { ProfileCompletionGateModal } from '../../../src/components/donor/ProfileCompletionGateModal';
import { AppButton } from '../../../src/components/ui/AppButton';
import { AppIcon } from '../../../src/components/ui/AppIcon';
import { LocalQrCode } from '../../../src/components/ui/LocalQrCode';
import { StatusBanner } from '../../../src/components/ui/StatusBanner';
import { supabase } from '../../../src/api/supabase/client';
import { patientDashboardNavItems } from '../../../src/constants/dashboard';
import { resolvePatientThemeRoles, theme } from '../../../src/design-system/theme';
import { useOpenStreetMapAvailability } from '../../../src/hooks/useOpenStreetMapAvailability';
import {
  createDonationDriveRegistration,
  fetchDonationDriveDetail,
} from '../../../src/features/donorHome.api';
import { buildDriveInvitationQrPayload } from '../../../src/features/donorDonations.service';
import { DONOR_PERMISSION_REASONS } from '../../../src/features/donorCompliance.service';
import { buildProfileCompletionMeta } from '../../../src/features/profile/services/profile.service';
import { useAuth } from '../../../src/providers/AuthProvider';

const EVENT_MAP_STYLE = {
  version: 8,
  sources: {
    openStreetMap: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{
    id: 'openStreetMapRaster',
    type: 'raster',
    source: 'openStreetMap',
    minzoom: 0,
    maxzoom: 19,
  }],
};

const formatEventDate = (startDate, endDate) => {
  if (!startDate) return 'Date to follow';
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  const formatter = new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  if (!end || start.toDateString() === end.toDateString()) return formatter.format(start);
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

const formatEventTime = (startDate, endDate) => {
  if (!startDate) return 'Time to follow';
  const formatter = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' });
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  return end ? `${formatter.format(start)} – ${formatter.format(end)}` : formatter.format(start);
};

const hasEventEnded = (drive) => {
  const value = drive?.end_date || drive?.start_date;
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
};

const getEventCoordinate = (drive = null) => {
  const latitude = Number(drive?.latitude);
  const longitude = Number(drive?.longitude);
  const hasLatitude = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
  const hasLongitude = Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  return hasLatitude && hasLongitude ? [longitude, latitude] : null;
};

function EventDetailRow({ icon, label, value, roles }) {
  return (
    <View style={styles.detailRow}>
      <View style={[styles.detailIcon, { backgroundColor: roles.iconPrimarySurface }]}>
        <MaterialCommunityIcons name={icon} size={19} color={roles.primaryActionBackground} />
      </View>
      <View style={styles.detailCopy}>
        <Text style={[styles.detailLabel, { color: roles.metaText }]}>{label}</Text>
        <Text style={[styles.detailValue, { color: roles.headingText }]}>{value}</Text>
      </View>
    </View>
  );
}

function EventLocationPreview({ drive, roles }) {
  const coordinate = React.useMemo(() => getEventCoordinate(drive), [drive]);
  const address = drive?.address_label || drive?.location_label || '';
  const {
    isAvailable: isMapAvailable,
    isChecking: isCheckingMap,
    retry: retryMap,
    markUnavailable: markMapUnavailable,
  } = useOpenStreetMapAvailability({ enabled: Boolean(coordinate) });

  const directionsUrl = React.useMemo(() => {
    if (coordinate) {
      const [longitude, latitude] = coordinate;
      return Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${latitude},${longitude}`
        : `geo:${latitude},${longitude}?q=${latitude},${longitude}`;
    }
    if (!address) return '';
    return Platform.OS === 'ios'
      ? `http://maps.apple.com/?q=${encodeURIComponent(address)}`
      : `geo:0,0?q=${encodeURIComponent(address)}`;
  }, [address, coordinate]);

  const openDirections = React.useCallback(() => {
    if (!directionsUrl) return;
    Linking.openURL(directionsUrl).catch(() => {});
  }, [directionsUrl]);

  return (
    <View style={[styles.mapCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
      <View style={[styles.mapFrame, { backgroundColor: roles.supportCardBackground }]}>
        {coordinate && isMapAvailable ? (
          <MapLibreMap
            style={styles.mapView}
            mapStyle={EVENT_MAP_STYLE}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            attributionEnabled={false}
            logoEnabled={false}
            onDidFailLoadingMap={markMapUnavailable}
          >
            <Camera initialViewState={{ center: coordinate, zoom: 14 }} />
            <Marker id={`patient-event-${drive?.donation_drive_id || 'location'}`} lngLat={coordinate}>
              <View style={[styles.mapMarker, { backgroundColor: roles.primaryActionBackground }]}>
                <MaterialCommunityIcons name="map-marker" size={22} color={roles.primaryActionText} />
              </View>
            </Marker>
          </MapLibreMap>
        ) : (
          <View style={styles.mapFallback}>
            {isCheckingMap ? (
              <ActivityIndicator color={roles.primaryActionBackground} />
            ) : (
              <View style={[styles.mapFallbackIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <MaterialCommunityIcons
                  name={coordinate ? 'map-marker-alert-outline' : 'map-marker-question-outline'}
                  size={28}
                  color={roles.primaryActionBackground}
                />
              </View>
            )}
            <Text style={[styles.mapFallbackTitle, { color: roles.headingText }]}>
              {isCheckingMap
                ? 'Loading event map'
                : coordinate
                  ? 'Map preview unavailable'
                  : 'Map coordinates not provided'}
            </Text>
            <Text style={[styles.mapFallbackText, { color: roles.metaText }]}>
              {coordinate
                ? 'You can still open the event location in your maps app.'
                : 'The venue address is still available below.'}
            </Text>
            {coordinate && !isCheckingMap ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry event map"
                onPress={retryMap}
                style={[styles.mapRetryButton, { borderColor: roles.primaryActionBackground }]}
              >
                <MaterialCommunityIcons name="reload" size={14} color={roles.primaryActionBackground} />
                <Text style={[styles.mapRetryText, { color: roles.primaryActionBackground }]}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        {coordinate && isMapAvailable ? <Text style={styles.mapAttribution}>© OpenStreetMap</Text> : null}
      </View>

      <View style={styles.mapFooter}>
        <View style={[styles.mapAddressIcon, { backgroundColor: roles.iconPrimarySurface }]}>
          <MaterialCommunityIcons name="map-marker-outline" size={19} color={roles.primaryActionBackground} />
        </View>
        <View style={styles.mapAddressCopy}>
          <Text style={[styles.mapAddressLabel, { color: roles.metaText }]}>Venue</Text>
          <Text numberOfLines={3} style={[styles.mapAddressText, { color: roles.headingText }]}>
            {address || 'Location to follow'}
          </Text>
        </View>
        {directionsUrl ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open event directions"
            onPress={openDirections}
            style={[styles.directionsButton, { backgroundColor: roles.primaryActionBackground }]}
          >
            <MaterialCommunityIcons name="directions" size={17} color={roles.primaryActionText} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function PatientEventDetailsScreen() {
  const router = useRouter();
  const { driveId } = useLocalSearchParams();
  const numericDriveId = Number(Array.isArray(driveId) ? driveId[0] : driveId);
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolvePatientThemeRoles(resolvedTheme);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;
  const [drive, setDrive] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [successMessage, setSuccessMessage] = React.useState('');
  const [imageFailed, setImageFailed] = React.useState(false);
  const [isProfileGateOpen, setIsProfileGateOpen] = React.useState(false);

  const completionMeta = React.useMemo(() => buildProfileCompletionMeta({
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
  }), [profile]);

  const loadDrive = React.useCallback(async () => {
    if (!Number.isFinite(numericDriveId) || numericDriveId <= 0) {
      setErrorMessage('This event is not available.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setErrorMessage('');
    const result = await fetchDonationDriveDetail(numericDriveId, profile?.user_id || null);
    setDrive(result.data || null);
    setErrorMessage(result.error?.message || '');
    setIsLoading(false);
  }, [numericDriveId, profile?.user_id]);

  React.useEffect(() => {
    void loadDrive();
  }, [loadDrive]);

  const activeRegistrationId = drive?.registration?.registration_id || null;

  React.useEffect(() => {
    if (!activeRegistrationId) return undefined;

    const channel = supabase
      .channel(`patient-event-attendance-${activeRegistrationId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'Event_Attendees',
        filter: `Event_Attendee_ID=eq.${activeRegistrationId}`,
      }, ({ new: row }) => {
        setDrive((current) => {
          if (!current?.registration) return current;
          return {
            ...current,
            registration: {
              ...current.registration,
              attendee_type: row?.Attendee_Type || current.registration.attendee_type,
              registration_status: row?.Registration_Status || current.registration.registration_status,
              attendance_status: row?.Attendance_Status || current.registration.attendance_status,
              rsvp_scanned_at: row?.RSVP_Scanned_At || current.registration.rsvp_scanned_at,
              rsvp_scanned_by: row?.RSVP_Scanned_By || current.registration.rsvp_scanned_by,
              updated_at: row?.Updated_At || current.registration.updated_at,
            },
          };
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeRegistrationId]);

  const handlePatientRsvp = async () => {
    if (!drive?.donation_drive_id || isSubmitting || hasEventEnded(drive)) return;
    if (!completionMeta.isComplete) {
      setIsProfileGateOpen(true);
      return;
    }
    if (!profile?.user_id || !user?.id) {
      setErrorMessage('Your patient account is not ready. Please sign in again.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');
    const result = await createDonationDriveRegistration({
      driveId: drive.donation_drive_id,
      databaseUserId: profile.user_id,
      attendanceOnly: true,
    });
    setIsSubmitting(false);

    if (result.error || !result.data?.registration_id) {
      if (result.error?.code === DONOR_PERMISSION_REASONS.profileIncomplete) {
        setIsProfileGateOpen(true);
        return;
      }
      setErrorMessage(result.error?.message || 'Your patient-attendee RSVP could not be saved.');
      return;
    }

    setDrive((current) => ({ ...current, registration: result.data }));
    setSuccessMessage(result.alreadyRegistered
      ? 'Your registration is confirmed as a patient attendee.'
      : 'You are registered as a patient attendee. No hair donation is expected.');
  };

  const handleNavPress = (item) => {
    if (item?.route) router.replace(item.route);
  };

  const imageUrl = drive?.event_image_url || drive?.organization_logo_url || '';
  const registration = drive?.registration || null;
  const hasSavedRegistration = Boolean(registration?.registration_id);
  const isPatientRegistration = hasSavedRegistration
    && String(registration?.attendee_type || '').trim().toLowerCase() === 'voluntary';
  const isCheckedIn = isPatientRegistration && (
    Boolean(registration?.rsvp_scanned_at)
    || String(registration?.attendance_status || '').trim().toLowerCase() === 'present'
  );
  const patientQrPayload = isPatientRegistration
    ? buildDriveInvitationQrPayload({ drive, registration })
    : '';
  const ended = hasEventEnded(drive);
  const eventDescription = drive?.event_overview || drive?.short_overview || drive?.description || '';

  return (
    <DashboardLayout
      navItems={patientDashboardNavItems}
      navVariant="patient"
      activeNavKey=""
      onNavPress={handleNavPress}
      header={(
        <DashboardHeaderSurface>
          <DonorTopBar
            title="Event details"
            subtitle="Patient attendee"
            showBack
            showNotificationsAction={false}
            onBackPress={() => router.back()}
          />
        </DashboardHeaderSurface>
      )}
    >
      <ProfileCompletionGateModal
        visible={isProfileGateOpen}
        completionMeta={completionMeta}
        onClose={() => setIsProfileGateOpen(false)}
        onComplete={() => {
          setIsProfileGateOpen(false);
          router.navigate('/profile');
        }}
      />

      {errorMessage ? (
        <StatusBanner
          visible
          title="Event update"
          message={errorMessage}
          variant="error"
          presentation="floating"
          autoDismissMs={4000}
        />
      ) : null}
      {successMessage ? (
        <StatusBanner
          visible
          title="RSVP confirmed"
          message={successMessage}
          variant="success"
          presentation="floating"
          autoDismissMs={4000}
        />
      ) : null}

      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={roles.primaryActionBackground} />
          <Text style={[styles.loadingText, { color: roles.bodyText }]}>Loading event details…</Text>
        </View>
      ) : drive ? (
        <View style={styles.screenStack}>
          <View style={[styles.heroCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <View style={[styles.heroMedia, { backgroundColor: roles.iconPrimarySurface }]}>
              {imageUrl && !imageFailed ? (
                <Image source={{ uri: imageUrl }} style={styles.heroImage} resizeMode="cover" onError={() => setImageFailed(true)} />
              ) : (
                <MaterialCommunityIcons name="calendar-heart" size={54} color={roles.primaryActionBackground} />
              )}
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(40,5,14,0)', 'rgba(40,5,14,0.72)']}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={styles.heroBadges}>
                <View style={styles.heroPatientBadge}>
                  <MaterialCommunityIcons name="account-heart-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.heroPatientBadgeText}>PATIENT ATTENDEE</Text>
                </View>
                <View style={styles.heroScopeBadge}>
                  <Text style={styles.heroScopeBadgeText}>{drive?.is_public ? 'PUBLIC EVENT' : 'PRIVATE EVENT'}</Text>
                </View>
              </View>
            </View>
            <View style={styles.heroBody}>
              <Text numberOfLines={2} style={[styles.eventTitle, { color: primaryTextColor }]}>{drive.event_title || 'Donation event'}</Text>
              <Text style={[styles.eventHost, { color: roles.metaText }]}>{drive.event_by || drive.organization_name || 'Community partner'}</Text>
            </View>
          </View>

          <LinearGradient
            colors={[roles.defaultCardBackground, roles.supportCardBackground]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.patientNotice, { borderColor: roles.defaultCardBorder }]}
          >
            <View style={[styles.patientNoticeIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <MaterialCommunityIcons name="heart-circle-outline" size={25} color={roles.primaryActionBackground} />
            </View>
            <View style={styles.patientNoticeCopy}>
              <Text style={[styles.patientNoticeTitle, { color: primaryTextColor }]}>You are joining as a patient</Text>
              <Text style={[styles.patientNoticeText, { color: roles.bodyText }]}>Attend for community support and event activities. You will not be registered or evaluated as a hair donor.</Text>
            </View>
          </LinearGradient>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>Visit information</Text>
            <View style={[styles.detailsCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
              <EventDetailRow icon="calendar-month-outline" label="Date" value={formatEventDate(drive.start_date, drive.end_date)} roles={roles} />
              <EventDetailRow icon="clock-outline" label="Time" value={formatEventTime(drive.start_date, drive.end_date)} roles={roles} />
              <EventDetailRow icon="map-marker-outline" label="Location" value={drive.address_label || drive.location_label || 'Location to follow'} roles={roles} />
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeadingRow}>
              <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>Event location</Text>
              <Text style={[styles.sectionHint, { color: roles.metaText }]}>Map preview</Text>
            </View>
            <EventLocationPreview drive={drive} roles={roles} />
          </View>

          {eventDescription ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>About this event</Text>
              <View style={[styles.descriptionCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
                <Text style={[styles.descriptionText, { color: roles.bodyText }]}>{eventDescription}</Text>
              </View>
            </View>
          ) : null}

          <View style={[styles.rsvpCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <View style={styles.rsvpHeader}>
              <View style={[styles.rsvpIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <MaterialCommunityIcons name={isPatientRegistration ? 'check-circle-outline' : 'account-check-outline'} size={22} color={roles.primaryActionBackground} />
              </View>
              <View style={styles.rsvpCopy}>
                <Text style={[styles.rsvpTitle, { color: primaryTextColor }]}>{isPatientRegistration ? 'Patient attendance confirmed' : 'Attend this event'}</Text>
                <Text style={[styles.rsvpText, { color: roles.bodyText }]}>
                  {isPatientRegistration
                    ? 'Your place is reserved as a patient attendee.'
                    : hasSavedRegistration
                      ? 'Confirm this registration as attendance-only to receive your patient pass.'
                      : 'Reserve your place as a patient attendee.'}
                </Text>
              </View>
            </View>
            <AppButton
              title={ended
                ? 'Event ended'
                : isPatientRegistration
                  ? 'Registered as patient attendee'
                  : hasSavedRegistration
                    ? 'Confirm patient attendance'
                    : 'RSVP as patient attendee'}
              onPress={handlePatientRsvp}
              loading={isSubmitting}
              disabled={ended || isPatientRegistration || isSubmitting}
              leading={<AppIcon name={isPatientRegistration ? 'checkmarkCircle' : 'calendar-check-outline'} state="inverse" />}
            />
          </View>

          {isPatientRegistration && patientQrPayload ? (
            <LinearGradient
              colors={[roles.defaultCardBackground, roles.supportCardBackground]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.patientPassCard, { borderColor: roles.defaultCardBorder }]}
            >
              <View style={styles.patientPassHeader}>
                <View style={[styles.patientPassIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                  <MaterialCommunityIcons name="qrcode-scan" size={24} color={roles.primaryActionBackground} />
                </View>
                <View style={styles.patientPassHeadingCopy}>
                  <Text style={[styles.patientPassEyebrow, { color: roles.primaryActionBackground }]}>EVENT CHECK-IN</Text>
                  <Text style={[styles.patientPassTitle, { color: primaryTextColor }]}>Patient attendance pass</Text>
                </View>
                <View style={[
                  styles.patientPassStatus,
                  { backgroundColor: isCheckedIn ? '#E6F4EC' : roles.iconPrimarySurface },
                ]}>
                  <MaterialCommunityIcons
                    name={isCheckedIn ? 'check-circle' : 'clock-outline'}
                    size={14}
                    color={isCheckedIn ? '#26734D' : roles.primaryActionBackground}
                  />
                  <Text style={[
                    styles.patientPassStatusText,
                    { color: isCheckedIn ? '#26734D' : roles.primaryActionBackground },
                  ]}>
                    {isCheckedIn ? 'Present' : 'Ready'}
                  </Text>
                </View>
              </View>

              <View style={[styles.patientQrFrame, { borderColor: roles.defaultCardBorder }]}>
                <LocalQrCode
                  value={patientQrPayload}
                  size={210}
                  color={theme.colors.brandPrimary}
                  backgroundColor={theme.colors.backgroundPrimary}
                />
              </View>

              <View style={styles.patientPassMessageRow}>
                <MaterialCommunityIcons
                  name={isCheckedIn ? 'check-decagram-outline' : 'account-check-outline'}
                  size={19}
                  color={roles.primaryActionBackground}
                />
                <Text style={[styles.patientPassMessage, { color: roles.bodyText }]}>
                  {isCheckedIn
                    ? 'Your attendance has been marked. You are checked in as a patient attendee.'
                    : 'Show this QR to event staff at the entrance. Scanning it marks attendance only—it does not create a hair donation.'}
                </Text>
              </View>

              <View style={[styles.patientOnlyBadge, { backgroundColor: roles.iconPrimarySurface }]}>
                <MaterialCommunityIcons name="heart-outline" size={15} color={roles.primaryActionBackground} />
                <Text style={[styles.patientOnlyBadgeText, { color: roles.primaryActionBackground }]}>PATIENT ATTENDEE · NO DONATION</Text>
              </View>
            </LinearGradient>
          ) : null}
        </View>
      ) : (
        <View style={styles.loadingState}>
          <MaterialCommunityIcons name="calendar-remove-outline" size={46} color={roles.primaryActionBackground} />
          <Text style={[styles.loadingText, { color: roles.bodyText }]}>This event is not available.</Text>
          <AppButton title="Back to home" onPress={() => router.replace('/patient/home')} />
        </View>
      )}
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  screenStack: {
    gap: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  loadingState: {
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  loadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: 'center',
  },
  heroCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 24,
    ...theme.shadows.card,
  },
  heroMedia: {
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroBadges: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  heroPatientBadge: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 15,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: theme.colors.palette.wine700,
  },
  heroPatientBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.45,
    color: '#FFFFFF',
  },
  heroScopeBadge: {
    minHeight: 28,
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  heroScopeBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  heroBody: {
    gap: 4,
    padding: theme.spacing.md,
  },
  eventTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: 27,
    fontWeight: theme.typography.weights.bold,
  },
  eventHost: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
  },
  patientNotice: {
    minHeight: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  patientNoticeIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  patientNoticeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  patientNoticeTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  patientNoticeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 17,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  sectionHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  detailsCard: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  detailRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  detailIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  detailLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  detailValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 19,
    fontWeight: theme.typography.weights.semibold,
  },
  mapCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 22,
    ...theme.shadows.soft,
  },
  mapFrame: {
    position: 'relative',
    height: 190,
    overflow: 'hidden',
  },
  mapView: {
    flex: 1,
  },
  mapMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    ...theme.shadows.soft,
  },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: theme.spacing.lg,
  },
  mapFallbackIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  mapFallbackTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  mapFallbackText: {
    maxWidth: 260,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    textAlign: 'center',
  },
  mapRetryButton: {
    minHeight: 30,
    borderWidth: 1,
    borderRadius: theme.radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: theme.spacing.sm,
    marginTop: 3,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  mapRetryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  mapAttribution: {
    position: 'absolute',
    left: 5,
    bottom: 4,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.82)',
    fontFamily: theme.typography.fontFamily,
    fontSize: 7,
    color: '#333333',
  },
  mapFooter: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  mapAddressIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mapAddressCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  mapAddressLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  mapAddressText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 18,
    fontWeight: theme.typography.weights.semibold,
  },
  directionsButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...theme.shadows.soft,
  },
  descriptionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: theme.spacing.md,
  },
  descriptionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 20,
  },
  rsvpCard: {
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.md,
    ...theme.shadows.card,
  },
  rsvpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rsvpIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rsvpCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rsvpTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  rsvpText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  patientPassCard: {
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 24,
    padding: theme.spacing.md,
    ...theme.shadows.card,
  },
  patientPassHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  patientPassIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  patientPassHeadingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  patientPassEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.55,
  },
  patientPassTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  patientPassStatus: {
    minHeight: 29,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    flexShrink: 0,
  },
  patientPassStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  patientQrFrame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  patientPassMessageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  patientPassMessage: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 19,
  },
  patientOnlyBadge: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
  },
  patientOnlyBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.35,
    textAlign: 'center',
  },
});
