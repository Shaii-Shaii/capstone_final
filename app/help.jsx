import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { DashboardLayout } from '../src/components/layout/DashboardLayout';
import { DashboardHeaderSurface } from '../src/components/layout/DashboardHeaderSurface';
import { DonorTopBar } from '../src/components/donor/DonorTopBar';
import { donorDashboardNavItems, patientDashboardNavItems } from '../src/constants/dashboard';
import { resolveThemeRoles, theme } from '../src/design-system/theme';
import { useAuth } from '../src/providers/AuthProvider';
import { useNotifications } from '../src/hooks/useNotifications';

const COMMON_GUIDES = [
  {
    id: 'account',
    icon: 'account-check-outline',
    title: 'Set up your account',
    summary: 'Keep your personal details and profile photo complete and current.',
    steps: [
      'Open Profile and select Edit Profile or Personal Information.',
      'Review your name, contact number, address, and profile photo.',
      'Save your changes before leaving the page.',
      'Use Change Password if you need to update your account password.',
    ],
  },
  {
    id: 'notifications',
    icon: 'bell-outline',
    title: 'Use notifications',
    summary: 'See reminders, event updates, donation progress, and other important notices.',
    steps: [
      'Allow notification permission when the application asks for it.',
      'Tap the bell icon to open your notification history.',
      'Tap a notification to open its related page and view the full details.',
      'Keep internet access enabled so new updates can reach your device.',
    ],
  },
  {
    id: 'privacy',
    icon: 'shield-lock-outline',
    title: 'Protect your information',
    summary: 'Use clear photos and documents only when the application asks for them.',
    steps: [
      'Do not share your password, private event code, or account access with other people.',
      'Upload only your own photos and documents, or files you are allowed to submit.',
      'AI results provide guidance and may still require review by an authorized organization.',
      'Log out when using a shared device.',
    ],
  },
  {
    id: 'troubleshooting',
    icon: 'tools',
    title: 'Fix common problems',
    summary: 'Try these quick checks when a page or request does not load.',
    steps: [
      'Check your internet connection and try the action again.',
      'Pull down to refresh when a screen supports refreshing.',
      'Close and reopen the application if a page remains unavailable.',
      'Use Feedback from your profile and include what you were doing when the problem happened.',
    ],
  },
];

const DONOR_GUIDES = [
  {
    id: 'hair-analysis',
    icon: 'camera-outline',
    title: 'Complete a hair analysis',
    summary: 'Take clear hair photos to receive a useful screening result and care guidance.',
    steps: [
      'Open Analysis and follow the requested photo angles.',
      'Use bright, even lighting and keep your hair fully visible and in focus.',
      'Make sure only one person appears in each photo.',
      'Review the result, donation decision, hair notes, and care recommendations.',
      'Remember that final donation acceptance is confirmed by the receiving organization.',
    ],
  },
  {
    id: 'events',
    icon: 'calendar-heart',
    title: 'Join a donation event',
    summary: 'Browse public events or use a code to open a private event.',
    steps: [
      'On Home, swipe through Upcoming donation events.',
      'Tap an event card to review its date, location, requirements, and available roles.',
      'Choose donor participation when eligible, or attend as a volunteer or attendee when offered.',
      'Submit your RSVP and check Notifications for event updates.',
      'For a private event, open the Private Event card and enter the event code.',
    ],
  },
  {
    id: 'logistics',
    icon: 'package-variant-closed',
    title: 'Send a logistics donation',
    summary: 'Prepare, label, and send your hair donation safely.',
    steps: [
      'Open Donate and choose Logistic Donation.',
      'Select the available drop-off or shipment option and complete the required details.',
      'Keep the hair clean, completely dry, secured, and protected inside the package.',
      'Open or print the waybill QR and attach it securely to the donation package.',
      'Send or drop off the package, then follow its progress in your donation timeline.',
    ],
  },
  {
    id: 'donation-status',
    icon: 'progress-clock',
    title: 'Track your donation',
    summary: 'Follow each step from submission until the organization receives your donation.',
    steps: [
      'Open Donate to view your current and previous donations.',
      'Check the journey timeline for shipping, receiving, review, and production updates.',
      'Read new status notifications before taking another action.',
      'A certificate becomes available after the organization confirms that your donation was received.',
    ],
  },
  {
    id: 'guardian',
    icon: 'account-child-outline',
    title: 'Complete guardian consent',
    summary: 'Donors below the required age need active consent from a guardian.',
    steps: [
      'Ask your guardian to review the consent agreement.',
      'Enter the guardian name, relationship, contact number, and optional email.',
      'Confirm the agreement and save the consent form.',
      'Keep the information current before joining an event or submitting a donation.',
    ],
  },
  {
    id: 'hair-logs',
    icon: 'chart-timeline-variant',
    title: 'Review hair logs',
    summary: 'Compare earlier analyses and open the full result for any saved check-in date.',
    steps: [
      'Tap a date under Hair Log on the Home page.',
      'Review the saved assessment, condition, measurements, decision, and care guidance.',
      'Use later check-ins to monitor visible changes over time.',
    ],
  },
];

const PATIENT_GUIDES = [
  {
    id: 'patient-profile',
    icon: 'file-account-outline',
    title: 'Complete your patient profile',
    summary: 'Provide the information needed to review and support your wig request.',
    steps: [
      'Open Profile and select Personal Information.',
      'Enter your medical information, guardian details when required, and hospital information if available.',
      'Upload a clear and valid medical document, then save your profile.',
      'Open Medical Document from your profile to preview or download the saved file.',
    ],
  },
  {
    id: 'wig-preview',
    icon: 'image-multiple-outline',
    title: 'Get AI wig recommendations',
    summary: 'Use a clear front-facing photo to preview suitable wig styles.',
    steps: [
      'Open Wig and start a wig request or recommendation.',
      'Capture or upload a clear front-facing photo with your full head visible.',
      'Use good lighting, avoid blur, and make sure only one person is in the image.',
      'Wait while the application analyzes your face and prepares recommended styles.',
      'Compare the generated previews and read why each style may suit your appearance.',
    ],
  },
  {
    id: 'wig-request',
    icon: 'clipboard-text-outline',
    title: 'Submit a wig request',
    summary: 'Choose a wig and complete the required request information.',
    steps: [
      'Review the available wigs and your AI recommendations.',
      'Select the style you prefer and check the request details.',
      'Confirm your delivery, hospital, or pickup information when requested.',
      'Submit the request once all required information is complete.',
    ],
  },
  {
    id: 'request-status',
    icon: 'progress-check',
    title: 'Track your wig request',
    summary: 'Follow your request from review through distribution or pickup.',
    steps: [
      'Open the Wig tab to see your current request.',
      'Review the timeline for approval, production, distribution, and readiness updates.',
      'If pickup is required, read the displayed location and instructions before traveling.',
      'Check Notifications for changes or actions required from you.',
    ],
  },
];

function GuideTopic({ topic, expanded, onToggle, roles }) {
  return (
    <View style={[styles.topicCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? 'Close' : 'Open'} ${topic.title} guide`}
        onPress={onToggle}
        style={styles.topicPressable}
      >
        <View style={styles.topicHeader}>
          <View style={[styles.topicIcon, { backgroundColor: roles.iconPrimarySurface }]}>
            <MaterialCommunityIcons name={topic.icon} size={22} color={roles.primaryActionBackground} />
          </View>
          <View style={styles.topicCopy}>
            <Text style={[styles.topicTitle, { color: roles.headingText }]}>{topic.title}</Text>
            <Text style={[styles.topicSummary, { color: roles.metaText }]}>{topic.summary}</Text>
          </View>
          <View style={[styles.topicChevron, { backgroundColor: expanded ? roles.iconPrimarySurface : 'transparent' }]}>
            <MaterialCommunityIcons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={roles.primaryActionBackground}
            />
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View style={[styles.topicSteps, { borderTopColor: roles.defaultCardBorder }]}>
          {topic.steps.map((step, index) => (
            <View key={`${topic.id}-step-${index}`} style={styles.stepRow}>
              <View style={[styles.stepNumber, { backgroundColor: roles.primaryActionBackground }]}>
                <Text style={[styles.stepNumberText, { color: roles.primaryActionText }]}>{index + 1}</Text>
              </View>
              <Text style={[styles.stepText, { color: roles.bodyText }]}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function HelpScreen() {
  const router = useRouter();
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const role = String(profile?.role || '').trim().toLowerCase() === 'patient' ? 'patient' : 'donor';
  const navItems = role === 'patient' ? patientDashboardNavItems : donorDashboardNavItems;
  const notificationRoute = role === 'patient' ? '/patient/notifications' : '/donor/notifications';
  const feedbackRoute = role === 'patient' ? '/patient/feedback' : '/donor/feedback';
  const roleGuides = role === 'patient' ? PATIENT_GUIDES : DONOR_GUIDES;
  const allGuides = React.useMemo(() => [...roleGuides, ...COMMON_GUIDES], [roleGuides]);
  const [query, setQuery] = React.useState('');
  const [expandedIds, setExpandedIds] = React.useState(() => new Set([allGuides[0]?.id].filter(Boolean)));
  const { unreadCount } = useNotifications({
    role,
    userId: user?.id,
    userEmail: user?.email || profile?.email || '',
    databaseUserId: profile?.user_id,
    mode: 'badge',
  });

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGuides = React.useMemo(() => {
    if (!normalizedQuery) return allGuides;
    return allGuides.filter((topic) => (
      [topic.title, topic.summary, ...topic.steps]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
    ));
  }, [allGuides, normalizedQuery]);

  const toggleTopic = React.useCallback((topicId) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }, []);

  const allVisibleExpanded = visibleGuides.length > 0 && visibleGuides.every((topic) => expandedIds.has(topic.id));
  const toggleAllVisible = React.useCallback(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (allVisibleExpanded) visibleGuides.forEach((topic) => next.delete(topic.id));
      else visibleGuides.forEach((topic) => next.add(topic.id));
      return next;
    });
  }, [allVisibleExpanded, visibleGuides]);

  return (
    <DashboardLayout
      header={(
        <DashboardHeaderSurface>
          <DonorTopBar
            title="Help & User Guide"
            subtitle={role === 'patient' ? 'Patient guide' : 'Donor guide'}
            showBack
            unreadCount={unreadCount}
            onBackPress={() => router.replace('/profile')}
            onNotificationsPress={() => router.navigate(notificationRoute)}
            onProfilePress={() => router.replace('/profile')}
          />
        </DashboardHeaderSurface>
      )}
      navItems={navItems}
      activeNavKey=""
      navVariant={role}
      screenVariant={role === 'patient' ? 'dashboard' : 'default'}
      onNavPress={(item) => item?.route && router.replace(item.route)}
    >
      <View style={styles.page}>
        <LinearGradient
          colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View pointerEvents="none" style={styles.heroGlowLarge} />
          <View pointerEvents="none" style={styles.heroGlowSmall} />
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons name="book-open-page-variant-outline" size={27} color="#FFFFFF" />
          </View>
          <Text style={styles.heroEyebrow}>DONIVRA GUIDE</Text>
          <Text style={styles.heroTitle}>How can we help?</Text>
          <Text style={styles.heroText}>
            Find simple steps for the features available to your {role} account.
          </Text>
          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaPill}>
              <MaterialCommunityIcons name="book-check-outline" size={15} color="#FFFFFF" />
              <Text style={styles.heroMetaText}>{allGuides.length} helpful guides</Text>
            </View>
            <View style={styles.heroMetaPill}>
              <MaterialCommunityIcons name="account-outline" size={15} color="#FFFFFF" />
              <Text style={styles.heroMetaText}>{role === 'patient' ? 'Patient' : 'Donor'}</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={[styles.searchShell, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
          <MaterialCommunityIcons name="magnify" size={21} color={roles.primaryActionBackground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search the user guide"
            placeholderTextColor={roles.metaText}
            returnKeyType="search"
            style={[styles.searchInput, { color: roles.headingText }]}
          />
          {query ? (
            <Pressable accessibilityLabel="Clear guide search" onPress={() => setQuery('')} style={styles.clearSearch}>
              <MaterialCommunityIcons name="close-circle" size={19} color={roles.metaText} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.guideHeadingRow}>
          <View style={styles.guideHeadingCopy}>
            <Text style={[styles.guideHeading, { color: roles.headingText }]}>Guides for you</Text>
            <Text style={[styles.guideHeadingMeta, { color: roles.metaText }]}>
              {visibleGuides.length} {visibleGuides.length === 1 ? 'topic' : 'topics'}
            </Text>
          </View>
          {visibleGuides.length ? (
            <Pressable onPress={toggleAllVisible} style={[styles.expandButton, { backgroundColor: roles.iconPrimarySurface }]}>
              <Text style={[styles.expandButtonText, { color: roles.primaryActionBackground }]}>
                {allVisibleExpanded ? 'Close all' : 'Open all'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.topicList}>
          {visibleGuides.map((topic) => (
            <GuideTopic
              key={topic.id}
              topic={topic}
              expanded={expandedIds.has(topic.id)}
              onToggle={() => toggleTopic(topic.id)}
              roles={roles}
            />
          ))}
        </View>

        {!visibleGuides.length ? (
          <View style={[styles.emptyState, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <View style={[styles.emptyIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <MaterialCommunityIcons name="text-search" size={28} color={roles.primaryActionBackground} />
            </View>
            <Text style={[styles.emptyTitle, { color: roles.headingText }]}>No guide found</Text>
            <Text style={[styles.emptyText, { color: roles.metaText }]}>Try a shorter word such as photo, event, request, or password.</Text>
          </View>
        ) : null}

        <LinearGradient
          colors={['#FFF8F9', '#F8E7EA']}
          style={[styles.supportCard, { borderColor: roles.defaultCardBorder }]}
        >
          <View style={[styles.supportIcon, { backgroundColor: roles.primaryActionBackground }]}>
            <MaterialCommunityIcons name="message-question-outline" size={23} color={roles.primaryActionText} />
          </View>
          <View style={styles.supportCopy}>
            <Text style={[styles.supportTitle, { color: roles.headingText }]}>Still need help?</Text>
            <Text style={[styles.supportText, { color: roles.metaText }]}>Send feedback and describe what happened.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open feedback"
            onPress={() => router.navigate(feedbackRoute)}
            style={[styles.supportAction, { backgroundColor: roles.primaryActionBackground }]}
          >
            <MaterialCommunityIcons name="arrow-right" size={19} color={roles.primaryActionText} />
          </Pressable>
        </LinearGradient>
      </View>
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  hero: {
    minHeight: 220,
    borderRadius: 24,
    padding: theme.spacing.lg,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...theme.shadows.md,
  },
  heroGlowLarge: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: theme.radius.full,
    right: -50,
    top: -76,
    backgroundColor: 'rgba(255,255,255,0.11)',
  },
  heroGlowSmall: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: theme.radius.full,
    right: 92,
    top: 24,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  heroEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.2,
    color: '#F4D8DE',
  },
  heroTitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleMd,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  heroText: {
    maxWidth: 290,
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 19,
    color: '#F8EDEF',
  },
  heroMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  heroMetaPill: {
    minHeight: 28,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  heroMetaText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  searchShell: {
    minHeight: 52,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  searchInput: {
    flex: 1,
    minHeight: 50,
    paddingVertical: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  clearSearch: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  guideHeadingCopy: {
    flex: 1,
  },
  guideHeading: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  guideHeadingMeta: {
    marginTop: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  expandButton: {
    minHeight: 34,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  topicList: {
    gap: theme.spacing.sm,
  },
  topicCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  topicPressable: {
    width: '100%',
  },
  topicHeader: {
    minHeight: 82,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  topicIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  topicCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  topicTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  topicSummary: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 17,
  },
  topicChevron: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  topicSteps: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNumberText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
  },
  stepText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 20,
  },
  emptyState: {
    borderWidth: 1,
    borderRadius: 20,
    padding: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
  },
  emptyTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  emptyText: {
    maxWidth: 280,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 19,
  },
  supportCard: {
    minHeight: 88,
    borderRadius: 20,
    borderWidth: 1,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    overflow: 'hidden',
  },
  supportIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportCopy: {
    flex: 1,
    gap: 2,
  },
  supportTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  supportText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 17,
  },
  supportAction: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
