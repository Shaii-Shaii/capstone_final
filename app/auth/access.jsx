import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { DonivraLoadingOverlay } from '../../src/components/ui/DonivraLoadingOverlay';
import { LoginForm } from '../../src/components/auth/LoginForm';
import { useRoleAuthFlow } from '../../src/hooks/useRoleAuthFlow';
import googleLogo from '../../src/assets/images/google_mark.png';
import {
  resolveBrandLogoSource,
  resolveThemeRoles,
  theme,
} from '../../src/design-system/theme';

// Rose-gold gradient border (same palette as the splash screen badge)
const BADGE_BORDER_GRAD = [
  '#6e2e0e',
  '#d4874e',
  '#f5dfa8',
  '#d4874e',
  '#6e2e0e',
];

const LOGIN_BUTTON_BORDER_GRAD = [
  '#5f2f12',
  '#8e4f24',
  '#c8864f',
  '#ffe7ac',
  '#c8864f',
  '#8e4f24',
  '#5f2f12',
];

const LOGIN_FILL_GRAD = [
  '#8a111d',
  '#740c15',
  '#5c0910',
];

// ─── BrandBadge ────────────────────────────────────────────────────────────
// Small logo badge: gradient border outer + dark wine inner card.
// Mirrors the splash screen badge — just scaled down for the auth hero.
function BrandBadge({ resolvedTheme }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logoSrc = resolveBrandLogoSource(resolvedTheme, imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedTheme?.logoIcon]);

  return (
    <View style={styles.badgeOuter}>
      {/* Rose-gold gradient fills the outer view, visible as border.
          No borderRadius on the gradient itself — parent overflow:hidden clips it. */}
      <LinearGradient
        colors={BADGE_BORDER_GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Dark wine interior — logo pops against the dark surface */}
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

// ─── SocialLoginButton ─────────────────────────────────────────────────────
function SocialLoginButton({ label, onPress, disabled, loading, roles }) {
  const isInactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.socialButton,
        {
          backgroundColor: theme.colors.surfaceCard,
          borderColor: roles.defaultCardBorder,
        },
        pressed && !isInactive ? styles.pressed : null,
        isInactive ? styles.disabledButton : null,
      ]}
    >
      <View style={styles.socialButtonContent}>
        {loading ? (
          <ActivityIndicator color={roles.headingText} />
        ) : (
          <>
          <View style={styles.googleLogoSlot}>
            <Image
              source={googleLogo}
              style={styles.googleLogo}
              resizeMode="contain"
            />
          </View>
          <Text style={[styles.socialButtonText, { color: roles.headingText }]}>
            {label}
          </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

// ─── AccessScreen ──────────────────────────────────────────────────────────
export default function AccessScreen() {
  const router = useRouter();
  const {
    handleLogin,
    handleGoogleAuth,
    isLoading,
    activeAuthAction,
    loginError,
    loginErrorCode,
    isLoginLocked,
    clearLoginError,
    resolvedTheme,
  } = useRoleAuthFlow('access');

  const roles = resolveThemeRoles(resolvedTheme);
  const brandName = resolvedTheme?.brandName || 'Donivra';
  const brandTagline = resolvedTheme?.brandTagline || 'Where Hair Becomes Hope';
  const isGoogleLoading = isLoading && activeAuthAction === 'google';
  const loadingLabel = activeAuthAction === 'login'
    ? 'Logging you in securely...'
    : activeAuthAction === 'google'
      ? 'Connecting your Google account...'
      : 'Preparing your secure session...';

  return (
    <ScreenContainer
      scrollable
      safeArea={false}
      variant="auth"
      contentStyle={[styles.screenContent, { backgroundColor: roles.pageBackground }]}
    >
      <View style={styles.page}>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <LinearGradient
          colors={['#26050a', '#4a0a15', '#6f1228', '#8f1d3b']}
          start={{ x: 0.25, y: 0 }}
          end={{ x: 0.75, y: 1 }}
          style={styles.hero}
        >
          {/* Decorative rings */}
          <View style={styles.heroRingLg} pointerEvents="none" />
          <View style={styles.heroRingSm} pointerEvents="none" />
          <View style={styles.heroArc} pointerEvents="none" />
          <View style={styles.heroArcSecondary} pointerEvents="none" />

          {/* Logo badge */}
          <BrandBadge resolvedTheme={resolvedTheme} />

          {/* Brand name */}
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

          {/* Tagline */}
          <Text style={styles.heroTagline}>{brandTagline}</Text>
        </LinearGradient>

        {/* ── Form panel ────────────────────────────────────────── */}
        <View
          style={[
            styles.formPanel,
            { backgroundColor: theme.colors.surfaceCard },
          ]}
        >
          <Text
            style={[
              styles.formHeading,
              { color: roles.primaryActionBackground },
            ]}
          >
            Login Page
          </Text>

          <LoginForm
            onSubmit={(data) => handleLogin(data)}
            isLoading={isLoading}
            activeAuthAction={activeAuthAction}
            onForgotPassword={() => router.push('/auth/forgot-password')}
            buttonText="Log In"
            submitError={loginError}
            submitErrorCode={loginErrorCode}
            isLoginLocked={isLoginLocked}
            onFieldEdit={clearLoginError}
            onFieldFocus={() => {}}
            resolvedTheme={resolvedTheme}
            emailLabel="EMAIL"
            passwordLabel="PASSWORD"
            disableAutofill={true}
            fieldLabelStyle={styles.formLabelOverride}
            fieldShellStyle={[
              styles.fieldShellOverride,
              {
                backgroundColor: theme.colors.surfaceCard,
                borderColor: roles.defaultCardBorder,
              },
            ]}
            fieldInputStyle={styles.fieldInputOverride}
            forgotPasswordStyle={styles.forgotLinkOverride}
            submitButtonStyle={styles.loginButton}
            submitButtonTextStyle={styles.loginButtonText}
            submitGradientBorderColors={LOGIN_BUTTON_BORDER_GRAD}
            submitGradientFillColors={LOGIN_FILL_GRAD}
          />

          {/* OR divider */}
          <View style={styles.dividerRow}>
            <View
              style={[styles.dividerLine, { backgroundColor: roles.supportCardBorder }]}
            />
            <Text style={[styles.dividerText, { color: roles.headingText }]}>
              OR
            </Text>
            <View
              style={[styles.dividerLine, { backgroundColor: roles.supportCardBorder }]}
            />
          </View>

          {/* Google sign-in */}
          <SocialLoginButton
            label="Continue with Google"
            onPress={handleGoogleAuth}
            disabled={isLoading}
            loading={isGoogleLoading}
            roles={roles}
          />

          {/* Sign-up link */}
          <View style={styles.signupRow}>
            <Text style={[styles.signupText, { color: roles.headingText }]}>
              No account?
            </Text>
            <Pressable
              onPress={() => router.replace('/auth/signup')}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <Text
                style={[
                  styles.signupLink,
                  styles.signupLinkColor,
                ]}
              >
                Sign up free
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
      <DonivraLoadingOverlay visible={isLoading} label={loadingLabel} />
    </ScreenContainer>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
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

  // ── Hero ─────────────────────────────────────────────────────
  hero: {
    minHeight: 250,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 48,
    overflow: 'hidden',
    gap: 10,
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

  // ── Logo badge ────────────────────────────────────────────────
  // Outer: 88×88, borderRadius 22 — filled with rose-gold gradient
  // Inner: 76×76, borderRadius 17 — dark wine card (logo on dark surface)
  // The 6px gap between outer and inner is the visible gradient "border"
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

  // ── Hero text ─────────────────────────────────────────────────
  brandWord: {
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: 1.0,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
    maxWidth: 280,
  },
  heroTagline: {
    fontSize: 10,
    fontWeight: '300',
    fontFamily: theme.typography.fontFamily,
    color: 'rgba(240, 215, 200, 0.65)',
    letterSpacing: 2.6,
    textAlign: 'center',
    textTransform: 'uppercase',
  },

  // ── Form panel ────────────────────────────────────────────────
  formPanel: {
    marginTop: -22,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.section,
    flex: 1,
  },
  formHeading: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
    marginBottom: theme.spacing.lg,
  },

  // Form field overrides
  formLabelOverride: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  fieldShellOverride: {
    minHeight: 52,
    borderRadius: 16,
    shadowOpacity: 0,
    elevation: 0,
  },
  fieldInputOverride: {
    fontSize: theme.typography.semantic.body,
  },
  forgotLinkOverride: {
    fontWeight: theme.typography.weights.regular,
    fontSize: theme.typography.semantic.bodySm,
  },

  // Login button
  loginButton: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 0,
  },
  loginButtonText: {
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.4,
  },

  // OR divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  dividerLine: {
    height: 1,
    flex: 1,
  },
  dividerText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },

  // Google button
  socialButton: {
    width: '100%',
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  socialButtonContent: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  socialButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.medium,
  },
  googleLogo: {
    width: 18,
    height: 18,
  },
  googleLogoSlot: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Sign-up link row
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.xl,
    gap: 3,
    minHeight: 24,
  },
  signupText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight: 20,
  },
  signupLink: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 20,
  },
  signupLinkColor: {
    color: theme.colors.actionTextLink,
  },

  pressed: { opacity: 0.72 },
  disabledButton: { opacity: 0.68 },
});

