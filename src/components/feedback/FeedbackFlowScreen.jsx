import React from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { DashboardLayout } from '../layout/DashboardLayout';
import { DashboardHeaderSurface } from '../layout/DashboardHeaderSurface';
import { DonorTopBar } from '../donor/DonorTopBar';
import { AppCard } from '../ui/AppCard';
import { AppIcon } from '../ui/AppIcon';
import { StatusBanner } from '../ui/StatusBanner';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';
import { useNotifications } from '../../hooks/useNotifications';

const FEEDBACK_TYPES = [
  {
    key: 'issue',
    label: 'Report a problem',
    helper: 'Something is not working',
    icon: 'alert-circle-outline',
    surface: '#FFF1F3',
    iconSurface: '#F8DDE3',
  },
  {
    key: 'suggestion',
    label: 'Share an idea',
    helper: 'Suggest a useful change',
    icon: 'lightbulb-outline',
    surface: '#FFF7F0',
    iconSurface: '#F5E4D4',
  },
  {
    key: 'experience',
    label: 'Share your experience',
    helper: 'Tell us how the app felt',
    icon: 'heart-outline',
    surface: '#F8F1F5',
    iconSurface: '#EBDDE5',
  },
];

const MAX_MESSAGE_LENGTH = 2000;

function FeedbackActionButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  icon = 'arrow-right',
  gradientColors,
  roles,
}) {
  const isInactive = disabled || loading;
  const content = (
    <View
      pointerEvents="none"
      style={[
        styles.actionButtonSurface,
        isInactive
          ? {
              backgroundColor: roles.iconPrimarySurface,
              borderColor: roles.defaultCardBorder,
            }
          : { borderColor: roles.primaryActionBackground },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={roles.primaryActionText} />
      ) : (
        <>
          <Text style={[
            styles.actionButtonText,
            { color: isInactive ? roles.metaText : roles.primaryActionText },
          ]}>
            {title}
          </Text>
          <AppIcon
            name={icon}
            size="sm"
            color={isInactive ? roles.metaText : roles.primaryActionText}
          />
        </>
      )}
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        pressed && !isInactive ? styles.actionButtonPressed : null,
      ]}
    >
      {isInactive ? content : (
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.actionButtonGradient}
        >
          {content}
        </LinearGradient>
      )}
    </Pressable>
  );
}

export function FeedbackFlowScreen({
  role,
  navItems,
  notificationsRoute,
  submitRequest,
}) {
  const router = useRouter();
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const { unreadCount } = useNotifications({
    role,
    userId: user?.id,
    userEmail: user?.email || profile?.email || '',
    databaseUserId: profile?.user_id,
    mode: 'badge',
  });
  const [step, setStep] = React.useState(1);
  const [selectedType, setSelectedType] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [feedback, setFeedback] = React.useState(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const stepEntrance = React.useRef(new Animated.Value(1)).current;

  const selectedFeedbackType = FEEDBACK_TYPES.find((item) => item.key === selectedType) || null;
  const messageLength = message.length;
  const canContinue = Boolean(selectedType);

  const moveToStep = React.useCallback((nextStep) => {
    Animated.timing(stepEntrance, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => {
      setStep(nextStep);
      stepEntrance.setValue(0);
      Animated.spring(stepEntrance, {
        toValue: 1,
        damping: 17,
        stiffness: 180,
        mass: 0.75,
        useNativeDriver: true,
      }).start();
    });
  }, [stepEntrance]);

  const handleSelectType = React.useCallback(async (type) => {
    setSelectedType((currentType) => (currentType === type ? '' : type));
    setFeedback(null);
    await Haptics.selectionAsync();
  }, []);

  const handleMessageChange = React.useCallback((value) => {
    if (value.length > MAX_MESSAGE_LENGTH) {
      setMessage(value.slice(0, MAX_MESSAGE_LENGTH));
      setFeedback({
        type: 'info',
        title: 'Message limit reached',
        message: 'Your message can contain up to 2,000 characters.',
      });
      return;
    }
    setMessage(value);
  }, []);

  const handleSubmit = React.useCallback(async () => {
    if (!selectedFeedbackType || isSubmitting) return;

    const trimmedMessage = message.trim();
    const savedMessage = trimmedMessage
      || `No additional details were provided for: ${selectedFeedbackType.label}.`;

    setIsSubmitting(true);
    let result;
    try {
      result = await submitRequest({
        databaseUserId: profile?.user_id,
        feedbackType: selectedFeedbackType.key,
        message: savedMessage,
      });
    } catch (error) {
      result = { error };
    } finally {
      setIsSubmitting(false);
    }

    if (!result || result.error || !result.data?.feedback_id) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFeedback({
        type: 'error',
        title: 'Feedback not sent',
        message: result?.error?.message || 'Please check your connection and try again.',
      });
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFeedback({
      type: 'success',
      title: 'Thank you',
      message: 'Your feedback was sent to the Donivra team.',
    });
    setMessage('');
    setSelectedType('');
    setStep(1);
  }, [isSubmitting, message, profile?.user_id, selectedFeedbackType, submitRequest]);

  const animatedStepStyle = {
    opacity: stepEntrance,
    transform: [{
      translateX: stepEntrance.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }),
    }],
  };
  const heroColors = role === 'patient'
    ? [theme.colors.dashboardPatientFrom, theme.colors.dashboardPatientTo]
    : [theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo];

  return (
    <DashboardLayout
      header={(
        <DashboardHeaderSurface>
          <DonorTopBar
            title="Feedback"
            subtitle="Share your thoughts"
            showBack
            showFeedbackAction={false}
            unreadCount={unreadCount}
            onBackPress={() => router.back()}
            onNotificationsPress={() => router.navigate(notificationsRoute)}
          />
        </DashboardHeaderSurface>
      )}
      navItems={navItems}
      activeNavKey=""
      navVariant={role}
      screenVariant="default"
      onNavPress={(item) => item?.route && router.replace(item.route)}
    >
      {feedback ? (
        <StatusBanner
          variant={feedback.type}
          title={feedback.title}
          message={feedback.message}
          presentation="floating"
          visible={Boolean(feedback.message)}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <LinearGradient
        colors={heroColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View pointerEvents="none" style={styles.heroGlowLarge} />
        <View pointerEvents="none" style={styles.heroGlowSmall} />
        <View style={styles.heroIcon}>
          <AppIcon name="message-text-outline" size="lg" color="#FFFFFF" />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Your voice matters</Text>
          <Text style={styles.heroText}>Tell us what we should fix or improve.</Text>
        </View>
      </LinearGradient>

      <View style={styles.progressRow}>
        <Text style={[styles.progressText, { color: roles.metaText }]}>Step {step} of 2</Text>
        <View style={styles.progressTrackRow}>
          {[1, 2].map((item) => (
            <View
              key={item}
              style={[
                styles.progressSegment,
                { backgroundColor: item <= step ? roles.primaryActionBackground : roles.defaultCardBorder },
              ]}
            />
          ))}
        </View>
      </View>

      <Animated.View style={animatedStepStyle}>
        <AppCard
          variant="outline"
          radius="xl"
          padding="lg"
          style={[styles.flowCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}
        >
          {step === 1 ? (
            <View style={styles.stepContent}>
              <View style={styles.stepHeading}>
                <Text style={[styles.stepTitle, { color: roles.headingText }]}>What do you want to report?</Text>
                <Text style={[styles.stepSubtitle, { color: roles.metaText }]}>Choose one topic.</Text>
              </View>

              <View style={styles.typeList}>
                {FEEDBACK_TYPES.map((item) => {
                  const isSelected = item.key === selectedType;
                  return (
                    <Pressable
                      key={item.key}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityHint={isSelected ? 'Tap again to clear this selection' : 'Tap to select this topic'}
                      onPress={() => handleSelectType(item.key)}
                      style={({ pressed }) => [
                        styles.typeRow,
                        {
                          backgroundColor: isSelected ? roles.iconPrimarySurface : roles.defaultCardBackground,
                          borderColor: isSelected ? roles.primaryActionBackground : roles.defaultCardBorder,
                        },
                        isSelected ? styles.typeRowSelected : null,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View pointerEvents="none" style={styles.typeRowContent}>
                        <View style={[
                          styles.typeIcon,
                          {
                            backgroundColor: isSelected ? roles.primaryActionBackground : item.iconSurface,
                            borderColor: isSelected ? roles.primaryActionBackground : roles.defaultCardBorder,
                          },
                        ]}>
                          <AppIcon
                            name={item.icon}
                            size="md"
                            color={isSelected ? roles.primaryActionText : roles.primaryActionBackground}
                          />
                        </View>
                        <View style={styles.typeCopy}>
                          <Text style={[styles.typeLabel, { color: roles.headingText }]}>{item.label}</Text>
                          <Text style={[styles.typeHelper, { color: roles.metaText }]}>{item.helper}</Text>
                        </View>
                        <View style={[
                          styles.radio,
                          { borderColor: isSelected ? roles.primaryActionBackground : roles.defaultCardBorder },
                          isSelected && { backgroundColor: roles.primaryActionBackground },
                        ]}>
                          {isSelected ? <AppIcon name="check" size="sm" color={roles.primaryActionText} /> : null}
                        </View>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <FeedbackActionButton
                title={canContinue ? 'Continue' : 'Select an option'}
                disabled={!canContinue}
                onPress={() => moveToStep(2)}
                gradientColors={heroColors}
                roles={roles}
              />
            </View>
          ) : (
            <View style={styles.stepContent}>
              <View style={styles.stepTwoHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Return to feedback topics"
                  onPress={() => moveToStep(1)}
                  style={[styles.stepBackButton, { backgroundColor: roles.iconPrimarySurface }]}
                >
                  <AppIcon name="arrowLeft" size="sm" color={roles.iconPrimaryColor} />
                </Pressable>
                <View style={styles.stepHeading}>
                  <Text style={[styles.stepTitle, { color: roles.headingText }]}>Would you like to add details?</Text>
                  <Text style={[styles.stepSubtitle, { color: roles.metaText }]}>This part is optional.</Text>
                </View>
              </View>

              <View style={[styles.selectedTopic, { backgroundColor: selectedFeedbackType?.surface, borderColor: roles.defaultCardBorder }]}>
                <View style={[styles.selectedTopicIcon, { backgroundColor: selectedFeedbackType?.iconSurface }]}>
                  <AppIcon name={selectedFeedbackType?.icon} size="sm" color={roles.primaryActionBackground} />
                </View>
                <Text style={[styles.selectedTopicText, { color: roles.headingText }]}>{selectedFeedbackType?.label}</Text>
                <Pressable onPress={() => moveToStep(1)} hitSlop={8}>
                  <Text style={[styles.changeText, { color: roles.primaryActionBackground }]}>Change</Text>
                </Pressable>
              </View>

              <View style={styles.messageHeader}>
                <Text style={[styles.messageLabel, { color: roles.headingText }]}>Your message</Text>
                <Text style={[styles.messageCounter, { color: roles.metaText }]}>{messageLength}/{MAX_MESSAGE_LENGTH}</Text>
              </View>
              <TextInput
                value={message}
                onChangeText={handleMessageChange}
                multiline
                textAlignVertical="top"
                placeholder="Tell us what happened or what could be better..."
                placeholderTextColor={roles.metaText}
                style={[
                  styles.messageInput,
                  {
                    color: roles.headingText,
                    backgroundColor: roles.pageBackground,
                    borderColor: roles.defaultCardBorder,
                  },
                ]}
              />

              <View style={[styles.privacyNote, { backgroundColor: roles.iconPrimarySurface }]}>
                <AppIcon name="shield" size="sm" color={roles.iconPrimaryColor} />
                <Text style={[styles.privacyText, { color: roles.bodyText }]}>Linked to your account for follow-up.</Text>
              </View>

              <FeedbackActionButton
                title={isSubmitting ? 'Sending...' : 'Send feedback'}
                loading={isSubmitting}
                disabled={isSubmitting}
                onPress={handleSubmit}
                icon="send-outline"
                gradientColors={heroColors}
                roles={roles}
              />
            </View>
          )}
        </AppCard>
      </Animated.View>
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 108,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    overflow: 'hidden',
    ...theme.shadows.card,
  },
  heroGlowLarge: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: theme.radius.full,
    right: -50,
    top: -88,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  heroGlowSmall: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: theme.radius.full,
    right: 52,
    bottom: -48,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    flexShrink: 0,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  heroTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  heroText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 18,
    color: '#F9EDEF',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: 2,
  },
  progressText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  progressTrackRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: theme.radius.full,
  },
  flowCard: {
    borderRadius: theme.radius.xl,
    ...theme.shadows.soft,
  },
  stepContent: {
    gap: theme.spacing.lg,
  },
  stepHeading: {
    flex: 1,
    gap: 3,
  },
  stepTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  stepSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  typeList: {
    gap: theme.spacing.sm,
  },
  typeRow: {
    width: '100%',
    minHeight: 80,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
  },
  typeRowContent: {
    width: '100%',
    minHeight: 78,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  typeRowSelected: {
    borderWidth: 2,
    ...theme.shadows.soft,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: theme.spacing.md,
  },
  typeCopy: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2,
  },
  typeLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 20,
  },
  typeHelper: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 17,
    marginTop: 2,
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: theme.radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: theme.spacing.md,
  },
  actionButton: {
    width: '100%',
    minHeight: 56,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  actionButtonGradient: {
    width: '100%',
    minHeight: 56,
    borderRadius: theme.radius.pill,
  },
  actionButtonSurface: {
    width: '100%',
    minHeight: 56,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  actionButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.1,
    marginRight: theme.spacing.sm,
  },
  stepTwoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  stepBackButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  selectedTopic: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 8,
  },
  selectedTopicIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedTopicText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  changeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  messageLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  messageCounter: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  messageInput: {
    minHeight: 148,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 20,
  },
  privacyNote: {
    minHeight: 44,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  privacyText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
});
