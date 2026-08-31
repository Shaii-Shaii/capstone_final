import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, Pressable, Alert, Image, Platform, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { DonivraLoadingOverlay } from '../../src/components/ui/DonivraLoadingOverlay';
import { VerifyEmailForm } from '../../src/components/auth/VerifyEmailForm';
import { verifyEmailSchema } from '../../src/features/auth/validators/auth.schema';
import { logout, verifyEmail, resendVerifyEmail } from '../../src/features/auth/services/auth.service';
import { syncPendingSignupDraft } from '../../src/features/auth/services/signupDraft.service';
import { resolveBrandLogoSource, resolveThemeRoles, theme } from '../../src/design-system/theme';
import { useAuth } from '../../src/providers/AuthProvider';

const RESEND_DELAY = 59;
const RESEND_POPUP_DURATION_MS = 2200;
const RESEND_TIMEOUT_MS = 12000;
const VERIFY_POPUP_DURATION_MS = 2200;
const ERROR_POPUP_DURATION_MS = 2600;
const BADGE_BORDER_GRAD = [
  '#6e2e0e',
  '#d4874e',
  '#f5dfa8',
  '#d4874e',
  '#6e2e0e',
];

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

function PopoutNoticeModal({
  visible,
  title,
  message,
  onRequestClose,
  roles,
  iconName = 'check-decagram',
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.noticeOverlay}>
        <View
          style={[
            styles.noticeCard,
            {
              backgroundColor: theme.colors.surfaceCard,
              borderColor: roles.defaultCardBorder,
            },
          ]}
        >
          <View
            style={[
              styles.noticeIconWrap,
              { backgroundColor: roles.iconPrimarySurface, borderColor: roles.defaultCardBorder },
            ]}
          >
            <MaterialCommunityIcons name={iconName} size={20} color={roles.primaryActionBackground} />
          </View>
          <Text style={[styles.noticeTitle, { color: roles.headingText }]}>{title}</Text>
          <Text style={[styles.noticeBody, { color: roles.headingText }]}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { email, role } = params;
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const brandName = resolvedTheme?.brandName || 'Donivra';
  const brandTagline = resolvedTheme?.brandTagline || 'Where Hair Becomes Hope';

  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [showResendNotice, setShowResendNotice] = useState(false);
  const [showVerifyNotice, setShowVerifyNotice] = useState(false);
  const [showErrorNotice, setShowErrorNotice] = useState(false);
  const [errorNoticeMessage, setErrorNoticeMessage] = useState('');
  const [verifyNoticeMessage, setVerifyNoticeMessage] = useState('');
  const loadingLabel = isResending
    ? 'Sending a new verification code...'
    : 'Verifying your code...';

  useEffect(() => {
    if (!email) {
      Alert.alert('Session Not Found', 'Please log in or sign up first.');
      router.replace('/auth/access');
    }
  }, [email, router]);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((current) => (current <= 1 ? 0 : current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  useEffect(() => {
    if (!showResendNotice) return;
    const timer = setTimeout(() => setShowResendNotice(false), RESEND_POPUP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showResendNotice]);

  useEffect(() => {
    if (!showVerifyNotice) return;
    const timer = setTimeout(() => setShowVerifyNotice(false), VERIFY_POPUP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showVerifyNotice]);

  useEffect(() => {
    if (!showErrorNotice) return;
    const timer = setTimeout(() => setShowErrorNotice(false), ERROR_POPUP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [showErrorNotice]);

  if (!email) return null;

  const routeAfterVerify = () => {
    router.replace('/auth/access');
  };

  const handleVerify = async (data) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsVerifying(true);
    const { session, role: verifiedRole, error } = await verifyEmail(email, data.otp);
    setIsVerifying(false);

    if (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorNoticeMessage(error);
      setShowErrorNotice(true);
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setVerifyNoticeMessage('Email verified. Preparing your account...');
    setShowVerifyNotice(true);

    if (session?.user?.id && email) {
      const syncResult = await syncPendingSignupDraft({
        userId: session.user.id,
        email,
        role: verifiedRole || role,
      });

      if (!syncResult.success) {
        setVerifyNoticeMessage('Email verified. Redirecting to login...');
      }
    }

    if (session) {
      await logout();
    }

    setVerifyNoticeMessage('Email verified. Please log in to continue.');
    setTimeout(routeAfterVerify, VERIFY_POPUP_DURATION_MS + 160);
  };

  const handleResend = async () => {
    if (resendCountdown > 0 || isResending) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsResending(true);

    const resendResult = await Promise.race([
      resendVerifyEmail(email),
      new Promise((resolve) => {
        setTimeout(() => resolve({ success: false, error: 'Resend request timed out. Please try again.' }), RESEND_TIMEOUT_MS);
      }),
    ]);
    setIsResending(false);
    const error = resendResult?.error || null;

    if (error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorNoticeMessage(error);
      setShowErrorNotice(true);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowResendNotice(true);
      setResendCountdown(RESEND_DELAY);
    }
  };

  const handleOtpValidationError = async (message) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setErrorNoticeMessage(message || 'Please enter a valid 6-digit code.');
    setShowErrorNotice(true);
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
                  resolvedTheme?.secondaryFontFamily ||
                  Platform.select({
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
            <Text style={[styles.title, { color: roles.primaryActionBackground }]}>Verify Your Email</Text>
            <Text style={[styles.subtitle, { color: roles.headingText }]}>
              Enter 6-digit code sent on your email.
            </Text>
          </View>

          <VerifyEmailForm
            schema={verifyEmailSchema}
            emailContext={email}
            onSubmit={handleVerify}
            onResend={handleResend}
            isLoading={isVerifying}
            isResending={isResending}
            resendCountdown={resendCountdown}
            onValidationError={handleOtpValidationError}
            successMessage=""
            resolvedTheme={resolvedTheme}
          />

          <LinearGradient
            colors={[
              theme.colors.palette.wine900,
              theme.colors.palette.wine700,
              theme.colors.palette.blush200,
            ]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.backGradientBorder}
          >
            <Pressable
              onPress={() => router.replace('/auth/signup')}
              android_ripple={{ color: theme.colors.surfacePressed, borderless: false }}
              style={[styles.backLink, { backgroundColor: theme.colors.surfaceSoft }]}
              accessibilityRole="button"
              accessibilityLabel="Back to sign up"
              accessibilityHint="Returns to account creation so you can change your details"
            >
              <View style={[styles.backIconSurface, { backgroundColor: roles.iconPrimarySurface }]}>
                <MaterialCommunityIcons name="arrow-left" size={19} color={roles.primaryActionBackground} />
              </View>
              <View style={styles.backCopy}>
                <Text style={[styles.backText, { color: roles.primaryActionBackground }]}>Back to sign up</Text>
                <Text style={[styles.backHelper, { color: roles.metaText }]}>Change your email or account details</Text>
              </View>
            </Pressable>
          </LinearGradient>
        </View>
      </View>

      <PopoutNoticeModal
        visible={showResendNotice}
        title="Verification Code Sent"
        message="A new verification code has been sent."
        onRequestClose={() => setShowResendNotice(false)}
        roles={roles}
      />
      <PopoutNoticeModal
        visible={showVerifyNotice}
        title="Email Verified"
        message={verifyNoticeMessage || 'Email verified. Please log in to continue.'}
        onRequestClose={() => setShowVerifyNotice(false)}
        roles={roles}
      />
      <PopoutNoticeModal
        visible={showErrorNotice}
        title="Verification Error"
        message={errorNoticeMessage || 'Please enter a valid 6-digit code.'}
        onRequestClose={() => setShowErrorNotice(false)}
        roles={roles}
        iconName="alert-circle"
      />
      <DonivraLoadingOverlay visible={isVerifying || isResending} label={loadingLabel} />
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
    minHeight: 230,
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
  backGradientBorder: {
    marginTop: theme.spacing.lg,
    width: '100%',
    borderRadius: 18,
    padding: 1.5,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  backLink: {
    minHeight: 62,
    borderRadius: 16.5,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    overflow: 'hidden',
  },
  backIconSurface: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  backCopy: {
    flex: 1,
    minWidth: 0,
  },
  backText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  backHelper: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  noticeOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 10, 12, 0.28)',
    paddingHorizontal: theme.spacing.lg,
  },
  noticeCard: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    alignItems: 'center',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  noticeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  noticeTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
  },
  noticeBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: 'center',
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
});
