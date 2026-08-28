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
import { SignupForm } from '../../src/components/auth/SignupForm';
import { unifiedSignupSchema } from '../../src/features/auth/validators/auth.schema';
import { useRoleAuthFlow } from '../../src/hooks/useRoleAuthFlow';
import googleLogo from '../../src/assets/images/google_mark.png';
import {
  resolveBrandLogoSource,
  resolveThemeRoles,
  theme,
} from '../../src/design-system/theme';

// Shared rose-gold gradient — same palette as splash screen and login page
const BADGE_BORDER_GRAD = [
  '#6e2e0e',
  '#d4874e',
  '#f5dfa8',
  '#d4874e',
  '#6e2e0e',
];

// ─── BrandBadge ─────────────────────────────────────────────────────────────
// Identical badge to the login hero — gradient border + dark wine inner card
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

// ─── GoogleButton ───────────────────────────────────────────────────────────
function GoogleButton({ onPress, disabled, loading, roles }) {
  const isInactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign up with Google"
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
              <Image source={googleLogo} style={styles.googleLogo} resizeMode="contain" />
            </View>
            <Text style={[styles.socialButtonText, { color: roles.headingText }]}>
              Sign up with Google
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

// ─── SignupScreen ────────────────────────────────────────────────────────────
export default function SignupScreen() {
  const router = useRouter();
  const {
    handleSignup,
    handleGoogleAuth,
    isLoading,
    activeAuthAction,
    signupError,
    clearSignupError,
    resolvedTheme,
  } = useRoleAuthFlow('signup');

  const roles = resolveThemeRoles(resolvedTheme);
  const brandName = resolvedTheme?.brandName || 'Donivra';
  const brandTagline = resolvedTheme?.brandTagline || 'Where Hair Becomes Hope';
  const isGoogleLoading = isLoading && activeAuthAction === 'google';
  const loadingLabel = activeAuthAction === 'signup'
    ? 'Creating your Donivra account...'
    : activeAuthAction === 'google'
      ? 'Connecting your Google account...'
      : 'Preparing your profile...';

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

          {/* Heading + sub-copy */}
          <View style={styles.formHeadingBlock}>
            <Text style={[styles.formHeading, { color: roles.primaryActionBackground }]}>
              Create Account
            </Text>
          </View>

          {/* Sign-up form */}
          <SignupForm
            schema={unifiedSignupSchema}
            onSubmit={(data) => handleSignup(data)}
            isLoading={isLoading}
            activeAuthAction={activeAuthAction}
            buttonText="Create Account"
            submitError={signupError}
            onFieldEdit={clearSignupError}
            autofillEmail=""
            onFieldFocus={() => {}}
            resolvedTheme={resolvedTheme}
          />

          {/* OR divider */}
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: roles.supportCardBorder }]} />
            <Text style={[styles.dividerText, { color: roles.headingText }]}>OR</Text>
            <View style={[styles.dividerLine, { backgroundColor: roles.supportCardBorder }]} />
          </View>

          {/* Google sign-up */}
          <GoogleButton
            onPress={handleGoogleAuth}
            disabled={isLoading}
            loading={isGoogleLoading}
            roles={roles}
          />

          {/* Log-in link */}
          <View style={styles.loginRow}>
            <Text style={[styles.loginText, { color: roles.headingText }]}>
              Already have an account?{' '}
            </Text>
            <Pressable
              onPress={() => router.replace('/auth/access')}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <Text style={[styles.loginLink, styles.loginLinkColor]}>
                Log In
              </Text>
            </Pressable>
          </View>

        </View>
      </View>
      <DonivraLoadingOverlay visible={isLoading} label={loadingLabel} />
    </ScreenContainer>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
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

  // ── Hero ──────────────────────────────────────────────────────
  // Slightly shorter than the login hero (210 vs 250) — leaves more
  // room for the 3-field form without needing to scroll as much.
  hero: {
    minHeight: 210,
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

  // ── Logo badge ────────────────────────────────────────────────
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

  // Heading block
  formHeadingBlock: {
    marginBottom: theme.spacing.lg,
  },
  formHeading: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
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
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
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
  socialButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.medium,
  },

  // Log-in link
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: theme.spacing.xl,
    flexWrap: 'wrap',
  },
  loginText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
  },
  loginLink: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  loginLinkColor: {
    color: theme.colors.actionTextLink,
  },

  pressed: { opacity: 0.72 },
  disabledButton: { opacity: 0.68 },
});

