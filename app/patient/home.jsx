import React from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DonorTopBar } from "../../src/components/donor/DonorTopBar";
import { DashboardHeaderSurface } from "../../src/components/layout/DashboardHeaderSurface";
import { DashboardLayout } from "../../src/components/layout/DashboardLayout";
import { PatientTutorialModal } from "../../src/components/patient/PatientTutorialModal";
import { StatusBanner } from "../../src/components/ui/StatusBanner";
import { patientDashboardNavItems } from "../../src/constants/dashboard";
import { resolveThemeRoles, theme } from "../../src/design-system/theme";
import { useNotifications } from "../../src/hooks/useNotifications";
import { usePatientWigRequest } from "../../src/hooks/usePatientWigRequest";
import { useProcessTracking } from "../../src/hooks/useProcessTracking";
import { useAuth } from "../../src/providers/AuthProvider";
import { fetchUpcomingDonationDrives } from "../../src/features/donorHome.api";

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const formatEventDate = (startDate, endDate) => {
  if (!startDate) return "Date to follow";
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : null;
  const formatter = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (!end || start.toDateString() === end.toDateString()) return formatter.format(start);
  if (start.getFullYear() === end.getFullYear()) {
    const rangeStartFormatter = new Intl.DateTimeFormat("en-PH", {
      month: "short",
      day: "numeric",
    });
    return `${rangeStartFormatter.format(start)} – ${formatter.format(end)}`;
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`;
};

const getEventDateBadge = (startDate) => {
  if (!startDate) return { month: 'DATE', day: '—' };
  const date = new Date(startDate);
  if (Number.isNaN(date.getTime())) return { month: 'DATE', day: '—' };
  return {
    month: new Intl.DateTimeFormat('en-PH', { month: 'short' }).format(date).toUpperCase(),
    day: new Intl.DateTimeFormat('en-PH', { day: 'numeric' }).format(date),
  };
};

const emptyJourneySteps = [
  { key: "request", icon: "clipboard-text-outline", label: "Submit request" },
  { key: "review", icon: "shield-search-outline", label: "Record review" },
  { key: "match", icon: "creation-outline", label: "Wig matching" },
];

const journeyStepIcons = {
  approval: "clipboard-check-outline",
  preparing: "creation-outline",
  dropoff: "truck-delivery-outline",
  received: "account-check-outline",
};

const getJourneyStepIcon = (step = {}) => (
  journeyStepIcons[step.key]
  || (String(step.title || "").toLowerCase().includes("prepar") ? "creation-outline" : null)
  || (String(step.title || "").toLowerCase().includes("dropoff") ? "truck-delivery-outline" : null)
  || (String(step.title || "").toLowerCase().includes("received") ? "account-check-outline" : null)
  || "clipboard-text-clock-outline"
);

function PatientEventCard({ drive, roles, onPress }) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const imageUrl = drive?.event_image_url || drive?.organization_logo_url || "";
  const dateBadge = getEventDateBadge(drive?.start_date);

  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${drive?.event_title || "donation event"} as a patient attendee`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.patientEventCard,
        pressed ? styles.patientEventCardPressed : null,
      ]}
    >
      <View
        style={[
          styles.patientEventLayout,
          {
            backgroundColor: roles.defaultCardBackground,
            borderColor: roles.defaultCardBorder,
          },
        ]}
      >
        <View style={[styles.patientEventMedia, { backgroundColor: roles.iconPrimarySurface }]}>
          {imageUrl && !imageFailed ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.patientEventImage}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={[styles.patientEventFallbackIcon, { backgroundColor: roles.defaultCardBackground }]}>
              <MaterialCommunityIcons name="calendar-heart" size={29} color={roles.primaryActionBackground} />
            </View>
          )}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(55,10,22,0)', 'rgba(55,10,22,0.34)']}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={styles.patientEventDateBadge}>
            <Text style={styles.patientEventDateMonth}>{dateBadge.month}</Text>
            <Text style={styles.patientEventDateDay}>{dateBadge.day}</Text>
          </View>
        </View>

        <LinearGradient
          colors={[theme.colors.palette.wine600, theme.colors.palette.wine800, theme.colors.palette.wine900]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.patientEventCopy}
        >
          <View pointerEvents="none" style={styles.patientEventCopyGlow} />
          <View pointerEvents="none" style={styles.patientEventCopyShine} />
          <View style={styles.patientEventTopLine}>
            <Text style={styles.patientEventScope}>
              {drive?.is_public ? "PUBLIC EVENT" : "PRIVATE EVENT"}
            </Text>
            {drive?.registration?.registration_id ? (
              <View style={styles.patientEventRegisteredPill}>
                <MaterialCommunityIcons name="check" size={11} color="#FFFFFF" />
                <Text style={styles.patientEventRegisteredText}>RSVP</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={2} style={styles.patientEventTitle}>
            {drive?.event_title || "Donation event"}
          </Text>
          <Text numberOfLines={1} style={styles.patientEventHost}>
            {drive?.organization_name || drive?.event_by || 'Community partner'}
          </Text>
          <View style={styles.patientEventMetaRow}>
            <MaterialCommunityIcons name="calendar-blank-outline" size={13} color="#F7DDE4" />
            <Text numberOfLines={1} style={styles.patientEventMeta}>
              {formatEventDate(drive?.start_date, drive?.end_date)}
            </Text>
          </View>
          <View style={styles.patientEventMetaRow}>
            <MaterialCommunityIcons name="map-marker-outline" size={13} color="#F7DDE4" />
            <Text numberOfLines={1} style={styles.patientEventMeta}>
              {drive?.location_label || drive?.address_label || "Location to follow"}
            </Text>
          </View>
          <View style={styles.patientEventArrow}>
            <MaterialCommunityIcons name="arrow-bottom-right" size={19} color={theme.colors.palette.wine900} />
          </View>
        </LinearGradient>
      </View>
    </Pressable>
  );
}

export default function PatientHomeScreen() {
  const router = useRouter();
  const { user, profile, resolvedTheme } = useAuth();
  const { unreadCount } = useNotifications({
    role: "patient",
    userId: user?.id,
    databaseUserId: profile?.user_id,
  });
  const {
    hasSubmittedRequest,
    isLoadingContext,
    error,
  } = usePatientWigRequest({ userId: user?.id });
  const { tracker, trackingError, isLoadingTracking } = useProcessTracking({
    role: "patient",
    userId: user?.id,
    databaseUserId: profile?.user_id,
  });

  const roles = resolveThemeRoles(resolvedTheme);
  const trackingSteps = tracker?.steps || [];
  const hasActiveRequest = Boolean(hasSubmittedRequest);
  const primaryTextColor = resolvedTheme?.primaryTextColor || roles.headingText;
  const [isTutorialOpen, setIsTutorialOpen] = React.useState(false);
  const [donationEvents, setDonationEvents] = React.useState([]);
  const [isLoadingEvents, setIsLoadingEvents] = React.useState(true);
  const [eventsError, setEventsError] = React.useState("");
  const [eventSearchQuery, setEventSearchQuery] = React.useState("");
  const firstName = String(profile?.first_name || "").trim();
  const lastName = String(profile?.last_name || "").trim();
  const avatarInitials = [firstName?.[0], lastName?.[0]].filter(Boolean).join("").toUpperCase();
  const greeting = React.useMemo(getGreeting, []);

  useFocusEffect(React.useCallback(() => {
    let isMounted = true;

    const loadDonationEvents = async () => {
      setIsLoadingEvents(true);
      setEventsError("");
      const result = await fetchUpcomingDonationDrives(24, profile?.user_id || null);
      if (!isMounted) return;
      setDonationEvents(result.data || []);
      setEventsError(result.error?.message || "");
      setIsLoadingEvents(false);
    };

    void loadDonationEvents();
    return () => {
      isMounted = false;
    };
  }, [profile?.user_id]));

  const handleNavPress = (item) => {
    if (!item.route || item.route === "/patient/home") return;
    router.navigate(item.route);
  };

  const filteredDonationEvents = React.useMemo(() => {
    const query = eventSearchQuery.trim().toLowerCase();
    if (!query) return donationEvents;

    return donationEvents.filter((drive) => (
      [
        drive?.event_title,
        drive?.organization_name,
        drive?.event_by,
        drive?.venue_name,
        drive?.location_label,
        drive?.address_label,
        drive?.is_public ? "public event" : "private event",
        formatEventDate(drive?.start_date, drive?.end_date),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    ));
  }, [donationEvents, eventSearchQuery]);

  const compactJourneyContent = !hasActiveRequest ? (
    <View style={styles.journeyLeadingHost}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start your wig journey"
        onPress={() => router.navigate("/patient/request-wig")}
        style={({ pressed }) => [
          styles.compactJourneyPressable,
          pressed ? styles.requestButtonPressed : null,
        ]}
      >
        <LinearGradient
          colors={[theme.colors.palette.wine600, theme.colors.palette.wine800, theme.colors.palette.wine900]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.compactJourneyCard}
        >
          <View pointerEvents="none" style={styles.compactJourneyGlow} />
          <View style={styles.compactJourneyIcon}>
            <MaterialCommunityIcons name="creation-outline" size={25} color="#FFFFFF" />
          </View>
          <View style={styles.compactJourneyCopy}>
            <Text style={styles.compactJourneyEyebrow}>WHEN YOU ARE READY</Text>
            <Text style={styles.compactJourneyTitle}>Start your wig journey</Text>
            <Text numberOfLines={2} style={styles.compactJourneyText}>Share your preferences and we’ll guide you with care.</Text>
          </View>
          <View style={styles.compactJourneyAction}>
            <MaterialCommunityIcons name="arrow-right" size={20} color={roles.primaryActionBackground} />
          </View>
        </LinearGradient>
      </Pressable>
    </View>
  ) : null;

  const stickyEventSearch = (
    <View style={styles.eventSearchStickyHost}>
      <View
        style={[
          styles.eventSearchBar,
          {
            backgroundColor: roles.defaultCardBackground,
            borderColor: roles.defaultCardBorder,
          },
        ]}
      >
        <View style={[styles.eventSearchIcon, { backgroundColor: roles.iconPrimarySurface }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={roles.primaryActionBackground} />
        </View>
        <TextInput
          accessibilityLabel="Search donation events"
          value={eventSearchQuery}
          onChangeText={setEventSearchQuery}
          placeholder="Search events, venues, or hosts"
          placeholderTextColor={roles.metaText}
          returnKeyType="search"
          autoCorrect={false}
          style={[styles.eventSearchInput, { color: primaryTextColor }]}
        />
        {eventSearchQuery ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear event search"
            hitSlop={8}
            onPress={() => setEventSearchQuery("")}
            style={({ pressed }) => [
              styles.eventSearchClear,
              { backgroundColor: roles.iconPrimarySurface },
              pressed ? styles.eventSearchClearPressed : null,
            ]}
          >
            <MaterialCommunityIcons name="close" size={17} color={roles.primaryActionBackground} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <DashboardLayout
      navItems={patientDashboardNavItems}
      activeNavKey="home"
      navVariant="patient"
      onNavPress={handleNavPress}
      leadingContent={compactJourneyContent}
      stickyContent={stickyEventSearch}
      header={
        <DashboardHeaderSurface>
          <DonorTopBar
            title={greeting}
            subtitle={`${firstName || "Patient"} | Wig Recipient`}
            avatarInitials={avatarInitials}
            avatarUri={profile?.avatar_url || profile?.photo_path || ""}
            unreadCount={unreadCount}
            onNotificationsPress={() =>
              router.navigate("/patient/notifications")
            }
            onProfilePress={() => router.navigate("/profile")}
          />
        </DashboardHeaderSurface>
      }
    >
      <PatientTutorialModal
        visible={isTutorialOpen}
        tabKey="home"
        onClose={() => setIsTutorialOpen(false)}
      />
      {isLoadingContext || isLoadingTracking ? (
        <StatusBanner
          title="Loading request status"
          message="Checking your latest wig request."
          variant="info"
          presentation="floating"
          visible
          autoDismissMs={3000}
        />
      ) : null}

      {error || trackingError ? (
        <StatusBanner
          title="Status unavailable"
          message={
            error?.message ||
            trackingError ||
            "We could not load your request status right now."
          }
          variant="error"
          presentation="floating"
          visible
          autoDismissMs={3000}
        />
      ) : null}

      <View style={styles.stack}>
        {hasActiveRequest ? (
        <LinearGradient
          colors={[theme.colors.palette.white, theme.colors.palette.blush100]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 0.92, y: 1 }}
          style={[styles.timelineSection, { borderColor: roles.defaultCardBorder }]}
        >
          <View pointerEvents="none" style={styles.timelineSectionGlow} />
          <View style={styles.timelineHeadingRow}>
            <View style={styles.timelineHeadingIdentity}>
              <LinearGradient
                colors={[theme.colors.palette.wine600, theme.colors.palette.wine900]}
                style={styles.timelineHeadingIcon}
              >
                <MaterialCommunityIcons name="timeline-clock-outline" size={21} color="#FFFFFF" />
              </LinearGradient>
              <View style={styles.timelineHeadingCopy}>
                <Text style={[styles.timelineEyebrow, { color: roles.primaryActionBackground }]}>YOUR WIG JOURNEY</Text>
                <Text style={[styles.timelineHeading, { color: primaryTextColor }]}>Journey timeline</Text>
                <Text style={[styles.timelineHeadingHint, { color: roles.metaText }]}>Swipe to follow every step of your request.</Text>
              </View>
            </View>
            {hasActiveRequest ? (
              <View style={styles.timelineStatusPill}>
                <View style={[styles.timelineStatusDot, { backgroundColor: roles.primaryActionBackground }]} />
                <Text style={[styles.timelineStatus, { color: roles.primaryActionBackground }]}>{tracker?.summary?.label || "Pending"}</Text>
              </View>
            ) : null}
          </View>

          {hasActiveRequest ? (
            <View style={styles.timelineList}>
              <View style={styles.timelineSwipeHint}>
                <MaterialCommunityIcons name="gesture-swipe-horizontal" size={17} color={roles.primaryActionBackground} />
                <Text style={[styles.timelineSwipeHintText, { color: roles.bodyText }]}>Swipe to see all stages</Text>
              </View>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={202}
                decelerationRate="fast"
                contentContainerStyle={styles.timelineHorizontalContent}
              >
                {trackingSteps.map((step, index) => {
                  const isCompleted = step.state === "completed";
                  const isCurrent = step.state === "current";
                  const isAttention = step.state === "attention";
                  const isHighlighted = isCompleted || isCurrent || isAttention;
                  const markerColor = isAttention
                    ? theme.colors.palette.amber700
                    : roles.primaryActionBackground;
                  const markerIcon = isCompleted ? "check" : getJourneyStepIcon(step);
                  return (
                    <View key={step.key || `${step.title}-${index}`} style={styles.timelineHorizontalStep}>
                      <View style={styles.timelineStepRail}>
                        <LinearGradient
                          colors={isHighlighted
                            ? [markerColor, theme.colors.palette.wine900]
                            : [theme.colors.palette.blueGray200, theme.colors.palette.blueGray500]}
                          style={styles.timelineMarker}
                        >
                          <MaterialCommunityIcons name={markerIcon} size={17} color="#FFFFFF" />
                        </LinearGradient>
                        {index < trackingSteps.length - 1 ? (
                          <View style={[
                            styles.timelineConnector,
                            {
                              backgroundColor: isCompleted
                                ? roles.primaryActionBackground
                                : roles.defaultCardBorder,
                            },
                          ]} />
                        ) : null}
                      </View>

                      <LinearGradient
                        colors={isCurrent
                          ? [theme.colors.palette.blush100, theme.colors.palette.white]
                          : [theme.colors.palette.white, theme.colors.palette.warm50]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[
                          styles.timelineCard,
                          {
                            borderColor: isHighlighted
                              ? markerColor
                              : roles.defaultCardBorder,
                          },
                        ]}
                      >
                        <View style={styles.timelineCardTopRow}>
                          <Text style={[styles.timelineStepNumber, { color: markerColor }]}>STEP {index + 1}</Text>
                          <View style={[
                            styles.timelineLabelPill,
                            { backgroundColor: isHighlighted ? roles.iconPrimarySurface : roles.defaultCardBackground },
                          ]}>
                            <Text numberOfLines={1} style={[styles.timelineLabel, { color: isHighlighted ? markerColor : roles.metaText }]}>
                              {step.label}
                            </Text>
                          </View>
                        </View>
                        <Text numberOfLines={2} style={[styles.timelineTitle, { color: primaryTextColor }]}>{step.title}</Text>
                        {step.description ? (
                          <Text numberOfLines={2} style={[styles.timelineDescription, { color: roles.bodyText }]}>
                            {step.description}
                          </Text>
                        ) : null}
                      </LinearGradient>
                    </View>
                  );
                })}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View full wig request details"
                onPress={() => router.navigate("/patient/requests")}
                style={({ pressed }) => [
                  styles.timelineDetailsLink,
                  { backgroundColor: roles.primaryActionBackground },
                  pressed ? styles.timelineDetailsLinkPressed : null,
                ]}
              >
                <View style={styles.timelineDetailsIcon}>
                  <MaterialCommunityIcons name="file-eye-outline" size={18} color={roles.primaryActionText} />
                </View>
                <Text style={[styles.timelineDetailsText, { color: roles.primaryActionText }]}>View full request details</Text>
                <MaterialCommunityIcons name="arrow-right" size={19} color={roles.primaryActionText} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyJourney}>
              <LinearGradient
                colors={[roles.defaultCardBackground, roles.supportCardBackground]}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={[styles.emptyJourneyCard, { borderColor: roles.defaultCardBorder }]}
              >
                <View style={styles.emptyJourneyArtwork}>
                  <View style={[styles.emptyJourneyArtworkRing, { borderColor: roles.defaultCardBorder }]} />
                  <View style={[styles.emptyJourneyIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                    <MaterialCommunityIcons name="account-heart-outline" size={38} color={roles.primaryActionBackground} />
                  </View>
                  <View style={[styles.emptyJourneySparkle, { backgroundColor: roles.primaryActionBackground }]}>
                    <MaterialCommunityIcons name="creation" size={13} color={roles.primaryActionText} />
                  </View>
                </View>

                <View style={styles.emptyJourneyCopy}>
                  <Text style={[styles.emptyJourneyTitle, { color: primaryTextColor }]}>Start your wig journey</Text>
                  <Text style={[styles.emptyJourneyMessage, { color: roles.bodyText }]}>Request a wig and we’ll guide you through document review, matching, and release updates.</Text>
                </View>

                <View style={styles.emptyJourneySteps}>
                  {emptyJourneySteps.map((step, index) => (
                    <React.Fragment key={step.key}>
                      <View style={styles.emptyJourneyStep}>
                        <View style={[styles.emptyJourneyStepIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                          <MaterialCommunityIcons name={step.icon} size={17} color={roles.primaryActionBackground} />
                        </View>
                        <Text numberOfLines={2} style={[styles.emptyJourneyStepLabel, { color: roles.bodyText }]}>{step.label}</Text>
                      </View>
                      {index < emptyJourneySteps.length - 1 ? (
                        <MaterialCommunityIcons name="chevron-right" size={16} color={roles.metaText} />
                      ) : null}
                    </React.Fragment>
                  ))}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Request a wig"
                  onPress={() => router.navigate("/patient/request-wig")}
                  style={({ pressed }) => [styles.requestButton, pressed ? styles.requestButtonPressed : null]}
                >
                  <LinearGradient
                    colors={[theme.colors.palette.wine600, theme.colors.palette.wine800, theme.colors.palette.wine900]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.requestButtonGradient}
                  >
                    <MaterialCommunityIcons name="clipboard-plus-outline" size={20} color={roles.primaryActionText} />
                    <Text style={[styles.requestButtonText, { color: roles.primaryActionText }]}>Request a wig</Text>
                    <MaterialCommunityIcons name="arrow-right" size={20} color={roles.primaryActionText} />
                  </LinearGradient>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Learn how the wig request works"
                  onPress={() => setIsTutorialOpen(true)}
                  style={({ pressed }) => [styles.learnMoreButton, pressed ? styles.learnMoreButtonPressed : null]}
                >
                  <MaterialCommunityIcons name="help-circle-outline" size={18} color={roles.primaryActionBackground} />
                  <Text style={[styles.learnMoreText, { color: roles.primaryActionBackground }]}>How the process works</Text>
                </Pressable>
              </LinearGradient>
            </View>
          )}
        </LinearGradient>
        ) : null}

        <View style={styles.eventsSection}>
          <View style={styles.eventsHeadingRow}>
            <View style={[styles.eventsHeadingIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <MaterialCommunityIcons name="calendar-heart" size={21} color={roles.primaryActionBackground} />
            </View>
            <View style={styles.eventsHeadingCopy}>
              <Text style={[styles.eventsEyebrow, { color: roles.primaryActionBackground }]}>COMMUNITY SUPPORT</Text>
              <Text style={[styles.eventsTitle, { color: primaryTextColor }]}>Donation events</Text>
              <Text style={[styles.eventsHint, { color: roles.metaText }]}>Join as a patient attendee. You are not registering as a hair donor.</Text>
            </View>
          </View>

          {isLoadingEvents ? (
            <View style={[styles.eventsLoadingCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
              <ActivityIndicator color={roles.primaryActionBackground} />
              <Text style={[styles.eventsLoadingText, { color: roles.bodyText }]}>Finding upcoming community events…</Text>
            </View>
          ) : filteredDonationEvents.length ? (
            <View style={styles.patientEventList}>
              {filteredDonationEvents.slice(0, 4).map((drive, index) => (
                <PatientEventCard
                  key={`patient-event-${drive?.donation_drive_id || drive?.id || index}`}
                  drive={drive}
                  roles={roles}
                  onPress={() => router.navigate(`/patient/events/${drive?.donation_drive_id || drive?.id}`)}
                />
              ))}
            </View>
          ) : (
            <View style={[styles.eventsEmptyCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
              <View style={[styles.eventsEmptyIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <MaterialCommunityIcons name="calendar-blank-outline" size={25} color={roles.primaryActionBackground} />
              </View>
              <View style={styles.eventsEmptyCopy}>
                <Text style={[styles.eventsEmptyTitle, { color: primaryTextColor }]}>
                  {eventSearchQuery.trim() ? "No matching events" : "No upcoming events yet"}
                </Text>
                <Text style={[styles.eventsEmptyText, { color: roles.bodyText }]}>
                  {eventSearchQuery.trim()
                    ? "Try another event name, host, date, or location."
                    : eventsError || "New patient-friendly community events will appear here when published."}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  journeyLeadingHost: {
    width: "100%",
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  eventSearchStickyHost: {
    width: "100%",
    paddingVertical: 2,
    backgroundColor: "transparent",
  },
  eventSearchBar: {
    minHeight: 56,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 19,
    paddingHorizontal: theme.spacing.sm,
    ...theme.shadows.card,
  },
  eventSearchIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  eventSearchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 0,
    paddingVertical: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  eventSearchClear: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  eventSearchClearPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },
  stack: {
    gap: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  compactJourneyPressable: {
    width: "100%",
    borderRadius: 22,
    ...theme.shadows.card,
  },
  compactJourneyCard: {
    position: "relative",
    overflow: "hidden",
    minHeight: 124,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: 22,
    padding: theme.spacing.md,
  },
  compactJourneyGlow: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    right: -48,
    top: -78,
    backgroundColor: "rgba(255,255,255,0.11)",
  },
  compactJourneyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
  },
  compactJourneyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  compactJourneyEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.7,
    color: "#F7DDE4",
  },
  compactJourneyTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    color: "#FFFFFF",
  },
  compactJourneyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    color: "#FFF7F8",
  },
  compactJourneyAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "#FFFFFF",
  },
  eventsSection: {
    gap: theme.spacing.md,
  },
  eventsHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  eventsHeadingIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  eventsHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  eventsEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.9,
  },
  eventsTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 26,
  },
  eventsHint: {
    marginTop: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  patientEventList: {
    gap: theme.spacing.sm,
    width: "100%",
    alignItems: "stretch",
  },
  patientEventCard: {
    width: "100%",
    alignSelf: "stretch",
    height: 150,
    minHeight: 150,
    maxHeight: 150,
    borderRadius: 24,
    ...theme.shadows.card,
  },
  patientEventLayout: {
    width: "100%",
    height: 150,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 24,
  },
  patientEventCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.988 }],
  },
  patientEventMedia: {
    position: "relative",
    width: 118,
    height: 150,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  patientEventImage: {
    width: "100%",
    height: 150,
  },
  patientEventFallbackIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadows.soft,
  },
  patientEventDateBadge: {
    position: "absolute",
    top: 7,
    left: 7,
    minWidth: 38,
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: "rgba(255,255,255,0.94)",
    ...theme.shadows.soft,
  },
  patientEventDateMonth: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 7,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.55,
    color: theme.colors.palette.wine700,
  },
  patientEventDateDay: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 17,
    lineHeight: 19,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.palette.wine900,
  },
  patientEventCopy: {
    height: 150,
    flex: 1,
    flexBasis: 0,
    position: "relative",
    overflow: "hidden",
    minWidth: 0,
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 10,
    paddingRight: 12,
  },
  patientEventCopyGlow: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    right: -38,
    top: -58,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  patientEventCopyShine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.32)",
  },
  patientEventTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
  },
  patientEventScope: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: 8,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.65,
    color: "#F7DDE4",
  },
  patientEventRegisteredPill: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 11,
    justifyContent: "center",
    paddingHorizontal: 7,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  patientEventRegisteredText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 8,
    fontWeight: theme.typography.weights.bold,
    color: "#FFFFFF",
  },
  patientEventTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 18,
    fontWeight: theme.typography.weights.bold,
    color: "#FFFFFF",
  },
  patientEventHost: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: "#FFF7F8",
    opacity: 0.88,
  },
  patientEventMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingRight: 28,
  },
  patientEventMeta: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 14,
    color: "#F7DDE4",
  },
  patientEventArrow: {
    position: "absolute",
    right: 9,
    bottom: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.72)",
    ...theme.shadows.soft,
  },
  eventsLoadingCard: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 20,
    padding: theme.spacing.md,
  },
  eventsLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  eventsEmptyCard: {
    minHeight: 100,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 20,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  eventsEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  eventsEmptyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  eventsEmptyTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  eventsEmptyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 17,
  },
  timelineSection: {
    position: "relative",
    overflow: "hidden",
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 24,
    padding: theme.spacing.md,
    ...theme.shadows.card,
  },
  timelineSectionGlow: {
    position: "absolute",
    width: 148,
    height: 148,
    borderRadius: 74,
    right: -58,
    top: -96,
    backgroundColor: "rgba(146,41,74,0.08)",
  },
  timelineHeadingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  timelineHeadingIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  timelineHeadingIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ...theme.shadows.soft,
  },
  timelineHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  timelineEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.9,
  },
  timelineHeading: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 27,
  },
  timelineHeadingHint: {
    marginTop: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  timelineStatusPill: {
    maxWidth: 132,
    minHeight: 32,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  timelineStatusDot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.full,
  },
  timelineStatus: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  timelineList: {
    gap: theme.spacing.sm,
  },
  timelineSwipeHint: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    minHeight: 28,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "rgba(255,255,255,0.74)",
  },
  timelineSwipeHintText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  timelineHorizontalContent: {
    gap: theme.spacing.md,
    paddingRight: theme.spacing.md,
    paddingBottom: theme.spacing.xs,
  },
  timelineHorizontalStep: {
    width: 190,
    flexShrink: 0,
  },
  timelineStepRail: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
  },
  timelineMarker: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ...theme.shadows.soft,
  },
  timelineConnector: {
    flex: 1,
    height: 3,
    marginHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.full,
  },
  timelineCard: {
    minHeight: 132,
    gap: 6,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    ...theme.shadows.soft,
  },
  timelineCardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.xs,
  },
  timelineStepNumber: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.75,
  },
  timelineLabelPill: {
    maxWidth: 100,
    minHeight: 25,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
  },
  timelineTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  timelineLabel: {
    flexShrink: 1,
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  timelineDescription: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  timelineDetailsLink: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    borderRadius: 17,
    paddingHorizontal: theme.spacing.md,
    ...theme.shadows.soft,
  },
  timelineDetailsLinkPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  timelineDetailsIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  timelineDetailsText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  emptyJourney: {
    width: "100%",
  },
  emptyJourneyCard: {
    width: "100%",
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderRadius: 24,
    alignItems: "center",
    gap: theme.spacing.md,
    overflow: "hidden",
    ...theme.shadows.soft,
  },
  emptyJourneyArtwork: {
    width: 88,
    height: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyJourneyArtworkRing: {
    position: "absolute",
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 1,
    borderStyle: "dashed",
    opacity: 0.85,
  },
  emptyJourneyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyJourneySparkle: {
    position: "absolute",
    right: 2,
    top: 5,
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  emptyJourneyCopy: {
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  emptyJourneyTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: "center",
  },
  emptyJourneyMessage: {
    maxWidth: 310,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 19,
    textAlign: "center",
  },
  emptyJourneySteps: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyJourneyStep: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 6,
  },
  emptyJourneyStepIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyJourneyStepLabel: {
    minHeight: 26,
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: theme.typography.weights.semibold,
    textAlign: "center",
  },
  requestButton: {
    width: "100%",
    borderRadius: 17,
    overflow: "hidden",
    ...theme.shadows.card,
  },
  requestButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  requestButtonGradient: {
    minHeight: 52,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  requestButtonText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    textAlign: "center",
  },
  learnMoreButton: {
    minHeight: 42,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  learnMoreButtonPressed: {
    opacity: 0.7,
  },
  learnMoreText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
});
