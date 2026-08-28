import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { DonorTopBar } from "../../src/components/donor/DonorTopBar";
import { DashboardHeaderSurface } from "../../src/components/layout/DashboardHeaderSurface";
import { DashboardLayout } from "../../src/components/layout/DashboardLayout";
import { AppButton } from "../../src/components/ui/AppButton";
import { AppCard } from "../../src/components/ui/AppCard";
import { AppIcon } from "../../src/components/ui/AppIcon";
import { StatusBanner } from "../../src/components/ui/StatusBanner";
import { patientDashboardNavItems } from "../../src/constants/dashboard";
import { resolveThemeRoles, theme } from "../../src/design-system/theme";
import { submitFeedback } from "../../src/features/feedback.api";
import { useNotifications } from "../../src/hooks/useNotifications";
import { useAuth } from "../../src/providers/AuthProvider";

const FEEDBACK_TYPES = [
  { key: "issue", label: "Issue", helper: "Report a problem", icon: "alert-circle-outline" },
  { key: "suggestion", label: "Suggestion", helper: "Share an idea", icon: "lightbulb-outline" },
  { key: "experience", label: "Experience", helper: "Tell us how it went", icon: "heart-outline" },
];
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 2000;

export default function PatientFeedbackScreen() {
  const router = useRouter();
  const { user, profile, resolvedTheme } = useAuth();
  const { unreadCount } = useNotifications({
    role: "patient",
    userId: user?.id,
    databaseUserId: profile?.user_id,
  });
  const roles = resolveThemeRoles(resolvedTheme);
  const [selectedType, setSelectedType] = React.useState(
    FEEDBACK_TYPES[0].key,
  );
  const [message, setMessage] = React.useState("");
  const [feedback, setFeedback] = React.useState(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = React.useCallback(async () => {
    const trimmedMessage = message.trim();

    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFeedback({
        type: "error",
        title: "Add more detail",
        message: `Please write at least ${MIN_MESSAGE_LENGTH} characters before submitting feedback.`,
      });
      return;
    }

    setIsSubmitting(true);
    const result = await submitFeedback({
      databaseUserId: profile?.user_id,
      feedbackType: selectedType,
      message: trimmedMessage,
      appRole: "patient",
      sourceRoute: "/patient/feedback",
    });
    setIsSubmitting(false);

    if (result.error || !result.data?.feedback_id) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFeedback({
        type: "error",
        title: "Not submitted",
        message:
          result.error?.message || "Feedback could not be saved right now.",
      });
      return;
    }

    setMessage("");
    await Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    );
    setFeedback({
      type: "success",
      title: "Thank you for helping us improve",
      message: "Your feedback was sent to the Donivra team.",
    });
  }, [message, profile?.user_id, selectedType]);

  const messageLength = message.trim().length;
  const canSubmit = messageLength >= MIN_MESSAGE_LENGTH && !isSubmitting;
  const remainingRequiredCharacters = Math.max(
    MIN_MESSAGE_LENGTH - messageLength,
    0,
  );

  const handleSelectType = React.useCallback(async (type) => {
    setSelectedType(type);
    await Haptics.selectionAsync();
  }, []);

  const handleMessageChange = React.useCallback((value) => {
    if (value.length > MAX_MESSAGE_LENGTH) {
      setFeedback({
        type: "info",
        title: "Limit reached",
        message: `Feedback can be up to ${MAX_MESSAGE_LENGTH} characters.`,
      });
      setMessage(value.slice(0, MAX_MESSAGE_LENGTH));
      return;
    }
    setMessage(value);
  }, []);

  return (
    <DashboardLayout
      header={
        <DashboardHeaderSurface>
          <DonorTopBar
            title="Feedback"
            subtitle="Help us improve Donivra"
            showBack
            showFeedbackAction={false}
            unreadCount={unreadCount}
            onBackPress={() => router.back()}
            onNotificationsPress={() =>
              router.navigate("/patient/notifications")
            }
            onProfilePress={() => router.navigate("/profile")}
          />
        </DashboardHeaderSurface>
      }
      navItems={patientDashboardNavItems}
      activeNavKey=""
      navVariant="patient"
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
        colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.feedbackIntro}
      >
        <View style={styles.feedbackIntroIcon}>
          <AppIcon name="message-text-outline" size="lg" color="#FFFFFF" />
        </View>
        <View style={styles.feedbackIntroCopy}>
          <Text style={styles.feedbackIntroTitle}>We would love to hear from you</Text>
          <Text style={styles.feedbackIntroText}>
            Share a problem, an idea, or your experience. Your message helps us make the app better.
          </Text>
        </View>
      </LinearGradient>

      <AppCard
        variant="outline"
        radius="lg"
        padding="md"
        style={[
          styles.card,
          {
            backgroundColor: roles.defaultCardBackground,
            borderColor: roles.defaultCardBorder,
          },
        ]}
      >
        <View style={styles.formHeader}>
          <View style={[styles.formStep, { backgroundColor: roles.primaryActionBackground }]}>
            <Text style={[styles.formStepText, { color: roles.primaryActionText }]}>1</Text>
          </View>
          <View style={styles.formHeaderCopy}>
            <Text style={[styles.formTitle, { color: roles.headingText }]}>What would you like to share?</Text>
            <Text style={[styles.formMeta, { color: roles.metaText }]}>Choose the option that best matches your message.</Text>
          </View>
        </View>

        <View style={styles.typeGrid}>
          {FEEDBACK_TYPES.map((item) => {
            const isActive = item.key === selectedType;
            return (
              <Pressable
                key={item.key}
                onPress={() => handleSelectType(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                style={[
                  styles.typeButton,
                  {
                    backgroundColor: isActive
                      ? roles.iconPrimarySurface
                      : roles.pageBackground,
                    borderColor: isActive
                      ? roles.primaryActionBackground
                      : roles.defaultCardBorder,
                  },
                ]}
              >
                <View style={styles.typeButtonContent}>
                  <View style={[styles.typeIcon, { backgroundColor: isActive ? roles.primaryActionBackground : roles.defaultCardBackground }]}>
                    <AppIcon name={item.icon} size="md" color={isActive ? roles.primaryActionText : roles.primaryActionBackground} />
                  </View>
                  <Text style={[styles.typeButtonLabel, { color: roles.headingText }]}>{item.label}</Text>
                  <Text numberOfLines={2} style={[styles.typeButtonHelper, { color: roles.metaText }]}>{item.helper}</Text>
                  {isActive ? (
                    <View style={[styles.typeSelected, { backgroundColor: roles.primaryActionBackground }]}>
                      <AppIcon name="check" size="sm" color={roles.primaryActionText} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.fieldGroup}>
          <View style={styles.formHeader}>
            <View style={[styles.formStep, { backgroundColor: roles.primaryActionBackground }]}>
              <Text style={[styles.formStepText, { color: roles.primaryActionText }]}>2</Text>
            </View>
            <View style={styles.formHeaderCopy}>
              <Text style={[styles.formTitle, { color: roles.headingText }]}>Tell us more</Text>
              <Text style={[styles.formMeta, { color: roles.metaText }]}>A clear description helps the team understand your feedback.</Text>
            </View>
          </View>
          <View style={styles.fieldHeader}>
            <Text style={[styles.label, { color: roles.headingText }]}>
              Your message
            </Text>
            <Text style={[styles.counter, { color: roles.metaText }]}>
              {messageLength}/{MAX_MESSAGE_LENGTH}
            </Text>
          </View>
          <TextInput
            value={message}
            onChangeText={handleMessageChange}
            multiline
            textAlignVertical="top"
            placeholder="What happened, or what would you like us to improve?"
            placeholderTextColor={roles.metaText}
            maxLength={MAX_MESSAGE_LENGTH}
            style={[
              styles.messageInput,
              {
                color: roles.headingText,
                backgroundColor: roles.pageBackground,
                borderColor: roles.defaultCardBorder,
              },
            ]}
          />
          <Text style={[styles.helperText, { color: roles.metaText }]}>
            {remainingRequiredCharacters > 0
              ? `Add ${remainingRequiredCharacters} more ${remainingRequiredCharacters === 1 ? "character" : "characters"} to continue.`
              : "Your message is ready to send."}
          </Text>
        </View>

        <View style={[styles.privacyNote, { backgroundColor: roles.iconPrimarySurface }]}>
          <AppIcon name="shield" size="sm" color={roles.primaryActionBackground} />
          <Text style={[styles.privacyNoteText, { color: roles.bodyText }]}>Your feedback is linked to your account so the team can review it properly.</Text>
        </View>

        <AppButton
          title={isSubmitting
            ? "Sending feedback..."
            : canSubmit
              ? "Send feedback"
              : `Write ${remainingRequiredCharacters} more`}
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={!canSubmit}
          leading={<AppIcon name="feedback" size="sm" state="inverse" />}
          fullWidth
          style={styles.submitButton}
        />
      </AppCard>
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  feedbackIntro: {
    minHeight: 126,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    overflow: "hidden",
    ...theme.shadows.card,
  },
  feedbackIntroIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.24)",
  },
  feedbackIntroCopy: {
    flex: 1,
    gap: 5,
  },
  feedbackIntroTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    color: "#FFFFFF",
  },
  feedbackIntroText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 19,
    color: "#F9EDEF",
  },
  card: {
    gap: theme.spacing.lg,
    borderRadius: theme.radius.xl,
    ...theme.shadows.soft,
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  formStep: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  formStepText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  formHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  formTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  formMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  typeGrid: {
    flexDirection: "row",
    gap: theme.spacing.xs,
  },
  typeButton: {
    flex: 1,
    minHeight: 108,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
  },
  typeButtonContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: theme.spacing.sm,
  },
  typeIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  typeButtonLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
    textAlign: "center",
  },
  typeButtonHelper: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    lineHeight: 13,
    textAlign: "center",
  },
  typeSelected: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldGroup: {
    gap: theme.spacing.sm,
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  counter: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  messageInput: {
    minHeight: 148,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  helperText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  privacyNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  privacyNoteText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 17,
  },
  submitButton: {
    borderRadius: theme.radius.lg,
  },
});
