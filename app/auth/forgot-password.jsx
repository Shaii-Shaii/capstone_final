import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { DonivraLoadingOverlay } from '../../src/components/ui/DonivraLoadingOverlay';
import { AppInput } from '../../src/components/ui/AppInput';
import { AppButton } from '../../src/components/ui/AppButton';
import { forgotPasswordSchema } from '../../src/features/auth/validators/auth.schema';
import { useAuthActions } from '../../src/features/auth/hooks/useAuthActions';
import { resolveBrandLogoSource, resolveThemeRoles, theme } from '../../src/design-system/theme';
import { useAuth } from '../../src/providers/AuthProvider';

const BADGE_BORDER_GRAD = [
  '#6e2e0e',
  '#d4874e',
  '#f5dfa8',
  '#d4874e',
  '#6e2e0e',
];

const SUBMIT_BORDER_GRAD = [
  '#5f2f12',
  '#8e4f24',
  '#c8864f',
  '#ffe7ac',
  '#c8864f',
  '#8e4f24',
  '#5f2f12',
];

const SUBMIT_FILL_GRAD = [
  '#8a111d',
  '#740c15',
  '#5c0910',
];

const RESET_LINK_VALIDITY_SECONDS = 60 * 60;
const RESET_RESEND_COOLDOWN_SECONDS = 60;

const formatCountdown = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

function BrandBadge({ resolvedTheme }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logoSrc = resolveBrandLogoSource(resolvedTheme, imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedTheme?.logoIcon]);

  return (
    <View style={styles.badgeOuter}>
      <LinearGradient
        colors={BADGE_BORDER_GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.badgeInner}>
        <View style={styles.badgeLogoPlate}>
          <Image
            source={logoSrc}
            style={styles.badgeLogo}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        </View>
      </View>
    </View>
  );
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { sendPasswordReset, isLoading } = useAuthActions();
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const brandName = resolvedTheme?.brandName || 'Donivra';
  const brandTagline = resolvedTheme?.brandTagline || 'Where Hair Becomes Hope';
  const [emailSent, setEmailSent] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [sendError, setSendError] = useState('');
  const [resetLinkExpiresAt, setResetLinkExpiresAt] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [clockNow, setClockNow] = useState(Date.now());

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const handleSendReset = async (data) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendError('');
    const result = await sendPasswordReset(data.email);

    if (result.success) {
      const sentAt = Date.now();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmittedEmail(data.email);
      setClockNow(sentAt);
      setResetLinkExpiresAt(sentAt + RESET_LINK_VALIDITY_SECONDS * 1000);
      setResendAvailableAt(sentAt + RESET_RESEND_COOLDOWN_SECONDS * 1000);
      setEmailSent(true);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setSendError(result.error || 'Failed to send reset link. Please try again.');
  };

  useEffect(() => {
    if (!emailSent) return undefined;

    setClockNow(Date.now());
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [emailSent]);

  const resetLinkSecondsRemaining = Math.max(0, Math.ceil((resetLinkExpiresAt - clockNow) / 1000));
  const resendSecondsRemaining = Math.max(0, Math.ceil((resendAvailableAt - clockNow) / 1000));
  const isResetLinkExpired = emailSent && resetLinkSecondsRemaining === 0;
  const isResendDisabled = isLoading || resendSecondsRemaining > 0;

  const handleResendReset = async () => {
    if (!submittedEmail || isResendDisabled) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSendError('');
    const result = await sendPasswordReset(submittedEmail);

    if (result.success) {
      const sentAt = Date.now();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setClockNow(sentAt);
      setResetLinkExpiresAt(sentAt + RESET_LINK_VALIDITY_SECONDS * 1000);
      setResendAvailableAt(sentAt + RESET_RESEND_COOLDOWN_SECONDS * 1000);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setSendError(result.error || 'Failed to resend the reset link. Please try again.');
  };

  return (
    <ScreenContainer
      scrollable
      safeArea={false}
      variant="auth"
      contentStyle={[styles.screenContent, { backgroundColor: roles.pageBackground }]}
    >
      <View style={styles.page}>
        <LinearGradient
          colors={['#26050a', '#4a0a15', '#6f1228', '#8f1d3b']}
          start={{ x: 0.25, y: 0 }}
          end={{ x: 0.75, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroRingLg} pointerEvents="none" />
          <View style={styles.heroRingSm} pointerEvents="none" />
          <View style={styles.heroArc} pointerEvents="none" />
          <View style={styles.heroArcSecondary} pointerEvents="none" />

          <BrandBadge resolvedTheme={resolvedTheme} />

          <Text
            style={[
              styles.brandWord,
              {
                fontFamily:
                  resolvedTheme?.secondaryFontFamily
                  || Platform.select({
                    ios: 'Times New Roman',
                    android: 'serif',
                    default: 'serif',
                  }),
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {brandName}
          </Text>
          <Text style={styles.heroTagline}>{brandTagline}</Text>
        </LinearGradient>

        <View style={[styles.formPanel, { backgroundColor: theme.colors.surfaceCard }]}>
          <View style={styles.headerBlock}>
            <Text style={[styles.title, { color: roles.primaryActionBackground }]}>
              {emailSent ? 'Check Your Inbox' : 'Forgot Password'}
            </Text>
            <Text style={[styles.subtitle, { color: roles.headingText }]}>
              {emailSent
                ? 'We sent a password reset link to your email address.'
                : 'Enter your registered email and we will send a reset link.'}
            </Text>
          </View>

          {!emailSent ? (
            <>
              {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, onBlur, value } }) => (
                  <AppInput
                    label="EMAIL"
                    placeholder="donor@example.com"
                    placeholderTextColor={roles.headingText}
                    leftIcon="email-outline"
                    leftIconColor={roles.primaryActionBackground}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value}
                    error={errors.email?.message}
                    disabled={isLoading}
                    style={styles.field}
                    labelStyle={[styles.fieldLabel, { color: roles.headingText }]}
                    shellStyle={[
                      styles.fieldShell,
                      {
                        borderColor: roles.defaultCardBorder,
                        backgroundColor: theme.colors.surfaceCard,
                      },
                    ]}
                    inputStyle={[styles.fieldInput, { color: roles.headingText }]}
                  />
                )}
              />

              <LinearGradient
                colors={SUBMIT_BORDER_GRAD}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.submitGradientBorder}
              >
                <LinearGradient
                  colors={SUBMIT_FILL_GRAD}
                  start={{ x: 0.2, y: 0 }}
                  end={{ x: 0.8, y: 1 }}
                  style={styles.submitGradientFill}
                >
                  <LinearGradient
                    colors={[
                      'rgba(255, 246, 222, 0)',
                      'rgba(255, 246, 222, 0.18)',
                      'rgba(255, 246, 222, 0)',
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.submitDiagonalShine}
                  />
                  <AppButton
                    title="Send Reset Link"
                    onPress={handleSubmit(handleSendReset)}
                    loading={isLoading}
                    disabled={isLoading}
                    size="lg"
                    variant="outline"
                    style={styles.submitBtn}
                    textStyle={styles.submitBtnText}
                    backgroundColorOverride="transparent"
                    borderColorOverride="transparent"
                    textColorOverride={roles.primaryActionText}
                  />
                </LinearGradient>
              </LinearGradient>

              <View style={styles.linkRow}>
                <Text style={[styles.linkLead, { color: roles.headingText }]}>
                  Remembered your password?{' '}
                </Text>
                <Pressable
                  onPress={() => router.replace('/auth/access')}
                  style={({ pressed }) => (pressed ? styles.pressed : null)}
                  accessibilityRole="button"
                >
                  <Text style={styles.linkAction}>Log In</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.successState}>
              <View
                style={[
                  styles.successCard,
                  {
                    backgroundColor: roles.supportCardBackground,
                    borderColor: roles.supportCardBorder,
                  },
                ]}
              >
                <View
                  style={[
                  styles.successIconWrap,
                  {
                      backgroundColor: roles.iconPrimarySurface,
                      borderColor: roles.supportCardBorder,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="email-check-outline"
                    size={22}
                    color={roles.primaryActionBackground}
                  />
                </View>
                <View style={styles.successCopy}>
                  <Text style={[styles.successLabel, { color: roles.metaText }]}>RESET LINK SENT TO</Text>
                  <Text numberOfLines={2} style={[styles.successEmail, { color: roles.headingText }]}>
                    {submittedEmail}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.expiryCard,
                  {
                    backgroundColor: isResetLinkExpired ? roles.supportCardBackground : roles.iconPrimarySurface,
                    borderColor: isResetLinkExpired ? theme.colors.textError : roles.supportCardBorder,
                  },
                ]}
              >
                <View style={styles.expiryIconWrap}>
                  <MaterialCommunityIcons
                    name={isResetLinkExpired ? 'clock-alert-outline' : 'timer-sand'}
                    size={22}
                    color={isResetLinkExpired ? theme.colors.textError : roles.primaryActionBackground}
                  />
                </View>
                <View style={styles.expiryCopy}>
                  <Text style={[styles.expiryLabel, { color: roles.metaText }]}>
                    {isResetLinkExpired ? 'LINK EXPIRED' : 'LINK EXPIRES IN'}
                  </Text>
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.expiryTime,
                      { color: isResetLinkExpired ? theme.colors.textError : roles.primaryActionBackground },
                    ]}
                  >
                    {isResetLinkExpired ? 'Request a new link' : formatCountdown(resetLinkSecondsRemaining)}
                  </Text>
                </View>
                {!isResetLinkExpired ? (
                  <View style={[styles.expiryBadge, { backgroundColor: roles.primaryActionBackground }]}>
                    <Text style={[styles.expiryBadgeText, { color: roles.primaryActionText }]}>1 HOUR</Text>
                  </View>
                ) : null}
              </View>

              {sendError ? <Text style={styles.successErrorText}>{sendError}</Text> : null}

              <View style={styles.successActions}>
                <LinearGradient
                  colors={SUBMIT_BORDER_GRAD}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.submitGradientBorder}
                >
                  <LinearGradient
                    colors={SUBMIT_FILL_GRAD}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.8, y: 1 }}
                    style={styles.submitGradientFill}
                  >
                    <LinearGradient
                      colors={[
                        'rgba(255, 246, 222, 0)',
                        'rgba(255, 246, 222, 0.18)',
                        'rgba(255, 246, 222, 0)',
                      ]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.submitDiagonalShine}
                    />
                    <AppButton
                      title="Back to Login"
                      onPress={() => router.replace('/auth/access')}
                      size="lg"
                      variant="outline"
                      style={styles.submitBtn}
                      textStyle={styles.submitBtnText}
                      backgroundColorOverride="transparent"
                      borderColorOverride="transparent"
                      textColorOverride={roles.primaryActionText}
                    />
                  </LinearGradient>
                </LinearGradient>

                <Pressable
                  onPress={handleResendReset}
                  disabled={isResendDisabled}
                  style={({ pressed }) => [
                    styles.secondaryActionPressable,
                    isResendDisabled ? styles.disabledAction : null,
                    pressed && !isResendDisabled ? styles.pressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isResendDisabled }}
                >
                  <View
                    style={[
                      styles.secondaryActionSurface,
                      styles.resendActionSurface,
                      {
                        backgroundColor: roles.supportCardBackground,
                        borderColor: roles.supportCardBorder,
                      },
                    ]}
                  >
                    <View style={[styles.secondaryActionIcon, { backgroundColor: theme.colors.surfaceCard }]}>
                      <MaterialCommunityIcons
                        name="email-sync-outline"
                        size={19}
                        color={roles.primaryActionBackground}
                      />
                    </View>
                    <View style={styles.secondaryActionCopy}>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                        style={[styles.secondaryActionText, { color: roles.primaryActionBackground }]}
                      >
                        {resendSecondsRemaining > 0
                          ? `Resend available in ${formatCountdown(resendSecondsRemaining)}`
                          : isResetLinkExpired
                            ? 'Send a new reset link'
                            : 'Resend reset email'}
                      </Text>
                    </View>
                    <View style={[styles.secondaryActionEndIcon, { backgroundColor: theme.colors.surfaceCard }]}>
                      <MaterialCommunityIcons
                        name={resendSecondsRemaining > 0 ? 'timer-outline' : 'refresh'}
                        size={18}
                        color={roles.primaryActionBackground}
                      />
                    </View>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => {
                    setEmailSent(false);
                    setSendError('');
                  }}
                  style={({ pressed }) => [
                    styles.secondaryActionPressable,
                    pressed ? styles.pressed : null,
                  ]}
                  accessibilityRole="button"
                >
                  <View
                    style={[
                      styles.secondaryActionSurface,
                      styles.differentEmailSurface,
                      {
                        backgroundColor: theme.colors.surfaceCard,
                        borderColor: theme.colors.borderStrong,
                      },
                    ]}
                  >
                    <View style={[styles.secondaryActionIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                      <MaterialCommunityIcons name="pencil-outline" size={18} color={roles.primaryActionBackground} />
                    </View>
                    <View style={styles.secondaryActionCopy}>
                      <Text style={[styles.secondaryActionText, { color: roles.headingText }]}>Use a different email</Text>
                    </View>
                    <View style={[styles.secondaryActionEndIcon, { borderColor: roles.supportCardBorder }]}>
                      <MaterialCommunityIcons name="chevron-right" size={20} color={roles.primaryActionBackground} />
                    </View>
                  </View>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
      <DonivraLoadingOverlay visible={isLoading} label="Sending reset link..." />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  page: {
    flex: 1,
    width: '100%',
    backgroundColor: theme.colors.surfaceCard,
  },
  hero: {
    minHeight: 232,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 40,
    overflow: 'hidden',
    gap: 8,
  },
  heroRingLg: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    borderWidth: 1,
    borderColor: 'rgba(150, 30, 46, 0.30)',
    top: -200,
    right: -110,
  },
  heroRingSm: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: 'rgba(210, 90, 110, 0.14)',
    top: 10,
    left: -90,
  },
  heroArc: {
    position: 'absolute',
    width: 460,
    height: 200,
    borderRadius: 200,
    borderWidth: 1,
    borderColor: 'rgba(185, 38, 57, 0.22)',
    bottom: -88,
    left: -38,
    transform: [{ rotate: '-8deg' }],
  },
  heroArcSecondary: {
    position: 'absolute',
    width: 430,
    height: 180,
    borderRadius: 170,
    borderWidth: 1,
    borderColor: 'rgba(185, 38, 57, 0.14)',
    bottom: -96,
    left: 2,
    transform: [{ rotate: '-6deg' }],
  },
  badgeOuter: {
    width: 72,
    height: 72,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    elevation: 18,
    shadowColor: '#b8622a',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 16,
  },
  badgeInner: {
    width: 62,
    height: 62,
    borderRadius: 14,
    backgroundColor: '#1e0508',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLogoPlate: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: '#fff7f3',
    borderWidth: 1,
    borderColor: 'rgba(176, 122, 70, 0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLogo: {
    width: 34,
    height: 34,
  },
  brandWord: {
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: 0.9,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    maxWidth: 280,
  },
  heroTagline: {
    fontSize: 9,
    fontWeight: '300',
    fontFamily: theme.typography.fontFamily,
    color: 'rgba(240, 215, 200, 0.60)',
    letterSpacing: 2.4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  formPanel: {
    marginTop: -22,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.section,
    flex: 1,
  },
  headerBlock: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  title: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: 'center',
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    maxWidth: 340,
  },
  errorText: {
    marginBottom: theme.spacing.md,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textError,
  },
  field: {
    marginBottom: theme.spacing.sm,
  },
  fieldLabel: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  fieldShell: {
    minHeight: 52,
    borderRadius: 16,
    shadowOpacity: 0,
    elevation: 0,
  },
  fieldInput: {
    fontSize: theme.typography.semantic.body,
  },
  submitGradientBorder: {
    marginTop: theme.spacing.sm,
    borderRadius: 16,
    padding: 3,
    overflow: 'hidden',
    shadowColor: '#c8864f',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
  submitGradientFill: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  submitDiagonalShine: {
    position: 'absolute',
    top: -54,
    left: 20,
    width: 40,
    height: 190,
    transform: [{ rotate: '22deg' }],
  },
  submitBtn: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 0,
    marginTop: 0,
  },
  submitBtnText: {
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.4,
  },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: theme.spacing.lg,
  },
  linkLead: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
  },
  linkAction: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    textDecorationLine: 'underline',
    color: theme.colors.actionTextLink,
  },
  successCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    ...theme.shadows.soft,
  },
  successState: {
    gap: theme.spacing.md,
  },
  successIconWrap: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  successCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  successLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
  },
  successEmail: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  expiryCard: {
    minHeight: 82,
    borderWidth: 1,
    borderRadius: 18,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  expiryIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
  },
  expiryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  expiryLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
  },
  expiryTime: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  expiryBadge: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
  },
  expiryBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 8,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.8,
  },
  successErrorText: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textError,
  },
  successActions: {
    gap: theme.spacing.md,
  },
  secondaryActionPressable: {
    width: '100%',
    borderRadius: 17,
  },
  secondaryActionSurface: {
    width: '100%',
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 8,
    gap: theme.spacing.sm,
  },
  resendActionSurface: {
    ...theme.shadows.soft,
  },
  differentEmailSurface: {
    borderWidth: 1.5,
  },
  secondaryActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  secondaryActionCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  secondaryActionEndIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  secondaryActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  disabledAction: {
    opacity: 0.72,
  },
  pressed: {
    opacity: 0.72,
  },
});
