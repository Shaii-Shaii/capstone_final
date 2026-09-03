import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../ui/AppIcon';
import { resolvePatientThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';

const PATIENT_TUTORIALS = {
  home: {
    title: 'Home Timeline',
    subtitle: 'Track your wig request journey.',
    steps: [
      { icon: 'home', title: 'Check status', body: 'Look at Journey Timeline to see your current request step.' },
      { icon: 'updates', title: 'Read updates', body: 'Open each timeline card to understand what is done or pending.' },
      { icon: 'requests', title: 'View details', body: 'Tap View request details to open your Wig tab.' },
      { icon: 'notifications', title: 'Check alerts', body: 'Tap the bell for request reminders and status updates.' },
    ],
  },
  wig: {
    title: 'Wig Request',
    subtitle: 'Request a wig and monitor progress.',
    steps: [
      { icon: 'requests', title: 'Start request', body: 'Tap Request Wig if you do not have an active request yet.' },
      { icon: 'editProfile', title: 'Complete details', body: 'Fill in patient details, medical information, and wig preferences.' },
      { icon: 'camera', title: 'Add photos', body: 'Upload or capture the required reference and medical documents.' },
      { icon: 'sparkle', title: 'Preview options', body: 'Review generated or available wig options before saving.' },
      { icon: 'updates', title: 'Track request', body: 'After submitting, open the timeline to follow review and release updates.' },
    ],
  },
  support: {
    title: 'Support',
    subtitle: 'Ask for help inside the app.',
    steps: [
      { icon: 'support', title: 'Open adviser', body: 'Use the chat panel for wig request, timeline, or account questions.' },
      { icon: 'requests', title: 'Ask clearly', body: 'Mention your request, status, or issue so the adviser can guide you.' },
      { icon: 'notifications', title: 'Follow updates', body: 'Check notifications after support or request changes.' },
    ],
  },
  profile: {
    title: 'Profile',
    subtitle: 'Keep patient information correct.',
    steps: [
      { icon: 'profile', title: 'Review details', body: 'Check your name, contact information, and patient account details.' },
      { icon: 'phone', title: 'Update contacts', body: 'Keep phone and email updated so the team can reach you.' },
      { icon: 'shield', title: 'Review documents', body: 'Make sure required patient or guardian documents are complete.' },
      { icon: 'save', title: 'Save changes', body: 'Save updates before leaving the page.' },
    ],
  },
};

const FALLBACK_TUTORIAL = {
  title: 'Patient Guide',
  subtitle: 'Use the active tab and open tutorial again for steps.',
  steps: [
    { icon: 'info', title: 'Choose a tab', body: 'Open Home, Wig, Support, or Profile to see specific guidance.' },
  ],
};

const resolveTutorialContent = (tabKey = '') => {
  const rawContent = PATIENT_TUTORIALS[String(tabKey || '')] || FALLBACK_TUTORIAL;
  const safeContent = rawContent && typeof rawContent === 'object' ? rawContent : FALLBACK_TUTORIAL;
  const steps = Array.isArray(safeContent.steps)
    ? safeContent.steps
        .filter((step) => step && typeof step === 'object')
        .map((step) => ({
          icon: step.icon || 'info',
          title: String(step.title || 'Step').trim() || 'Step',
          body: String(step.body || '').trim() || FALLBACK_TUTORIAL.steps[0].body,
        }))
    : [];

  return {
    title: String(safeContent.title || FALLBACK_TUTORIAL.title).trim() || FALLBACK_TUTORIAL.title,
    subtitle: String(safeContent.subtitle || FALLBACK_TUTORIAL.subtitle).trim() || FALLBACK_TUTORIAL.subtitle,
    steps: steps.length ? steps : FALLBACK_TUTORIAL.steps,
  };
};

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
  return color;
};

export function PatientTutorialModal({ visible, tabKey = 'home', onClose }) {
  const { resolvedTheme } = useAuth();
  const roles = resolvePatientThemeRoles(resolvedTheme);
  const content = resolveTutorialContent(tabKey);
  const accentColor = roles.primaryActionBackground;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.card,
            {
              backgroundColor: roles.defaultCardBackground,
              borderColor: roles.defaultCardBorder,
            },
          ]}
        >
          <View style={styles.header}>
            <View style={[styles.heroIcon, { backgroundColor: withOpacity(accentColor, 0.12) }]}>
              <AppIcon name="tutorial" size="lg" state="default" color={accentColor} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close patient tutorial"
              onPress={onClose}
              style={styles.closeButton}
            >
              <AppIcon name="closeCircle" size="md" state="default" color={roles.metaText} />
            </Pressable>
          </View>

          <Text style={[styles.title, { color: roles.headingText }]}>{content.title}</Text>
          <Text style={[styles.subtitle, { color: roles.bodyText }]}>{content.subtitle}</Text>

          <ScrollView
            style={styles.stepScroll}
            contentContainerStyle={styles.stepList}
            showsVerticalScrollIndicator={false}
          >
            {content.steps.map((step, index) => (
              <View
                key={`${step.title}-${index}`}
                style={[
                  styles.stepRow,
                  {
                    backgroundColor: roles.pageBackground,
                    borderColor: roles.defaultCardBorder,
                  },
                ]}
              >
                <View style={[styles.stepIcon, { backgroundColor: withOpacity(accentColor, 0.1) }]}>
                  <AppIcon name={step.icon} size="sm" state="default" color={accentColor} />
                </View>
                <View style={styles.stepCopy}>
                  <Text style={[styles.stepTitle, { color: roles.headingText }]}>
                    {index + 1}. {step.title}
                  </Text>
                  <Text style={[styles.stepBody, { color: roles.bodyText }]}>{step.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '82%',
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    shadowColor: theme.colors.palette.black,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    marginBottom: theme.spacing.md,
  },
  stepScroll: {
    maxHeight: 340,
  },
  stepList: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  stepIcon: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCopy: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  stepBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
});
