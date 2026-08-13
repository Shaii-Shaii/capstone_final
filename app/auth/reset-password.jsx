import React from 'react';
import { BackHandler, View, StyleSheet, Text, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import * as Haptics from 'expo-haptics';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthScreenLayout, authLayoutStyles } from '../../src/components/auth/AuthScreenLayout';
import { PasswordInput } from '../../src/components/ui/PasswordInput';
import { AppButton } from '../../src/components/ui/AppButton';
import { resetPasswordSchema } from '../../src/features/auth/validators/auth.schema';
import { useAuthActions } from '../../src/features/auth/hooks/useAuthActions';
import { resolveThemeRoles, theme } from '../../src/design-system/theme';
import { useAuth } from '../../src/providers/AuthProvider';
import { supabase } from '../../src/api/supabase/client';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams();
  const incomingUrl = Linking.useURL();
  const { updatePassword, getCurrentSessionStatus, recoverSessionFromAuthUrl } = useAuthActions();
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [isCheckingSession, setIsCheckingSession] = React.useState(true);
  const [hasResetSession, setHasResetSession] = React.useState(false);
  const [succeeded, setSucceeded] = React.useState(false);
  const [updateError, setUpdateError] = React.useState('');
  const [recoveryError, setRecoveryError] = React.useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = React.useState(false);
  const processedUrlRef = React.useRef('');

  const exitRecoveryToLogin = React.useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } finally {
      router.replace('/auth/access');
    }
  }, [router]);

  useFocusEffect(
    React.useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        exitRecoveryToLogin();
        return true;
      });

      return () => subscription.remove();
    }, [exitRecoveryToLogin])
  );

  React.useEffect(() => {
    let mounted = true;

    const authSubscription = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted || !session) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setHasResetSession(true);
        setIsCheckingSession(false);
      }
    });

    const processAuthUrl = async (value) => {
      const authUrl = typeof value === 'string' ? value.trim() : '';
      if (!authUrl || processedUrlRef.current === authUrl) return false;
      processedUrlRef.current = authUrl;
      const recovered = await recoverSessionFromAuthUrl(authUrl);
      if (mounted && recovered?.session) {
        setHasResetSession(true);
        setIsCheckingSession(false);
        return true;
      }
      if (mounted && recovered?.error) setRecoveryError(recovered.error);
      return false;
    };

    const checkSession = async () => {
      const initialUrl = typeof incomingUrl === 'string' && incomingUrl.trim()
        ? incomingUrl.trim()
        : await Linking.getInitialURL();
      await processAuthUrl(initialUrl);

      const authParams = Object.entries(routeParams || {})
        .flatMap(([key, value]) => (
          Array.isArray(value)
            ? value.map((entry) => [key, entry])
            : [[key, value]]
        ))
        .filter(([, value]) => value != null && String(value).trim());

      const routeError = routeParams?.error_description || routeParams?.error_code || routeParams?.error;
      if (mounted && routeError) setRecoveryError(String(routeError));

      const urlAlreadyHasAuthPayload = /[?#&](?:code|token_hash|token|access_token)=/.test(initialUrl || '');
      if (authParams.length && !urlAlreadyHasAuthPayload) {
        const query = new URLSearchParams(
          authParams.map(([key, value]) => [key, String(value)])
        ).toString();
        const recovered = await recoverSessionFromAuthUrl(`donivra://auth/reset-password?${query}`);
        if (mounted && recovered?.session) {
          setHasResetSession(true);
          setIsCheckingSession(false);
        }
      }

      const result = await getCurrentSessionStatus();
      if (!mounted) return;
      if (result.success && result.session) setHasResetSession(true);
      setIsCheckingSession(false);
    };

    checkSession();
    const urlSubscription = Linking.addEventListener('url', ({ url }) => {
      processAuthUrl(url);
    });

    return () => {
      mounted = false;
      authSubscription?.data?.subscription?.unsubscribe?.();
      urlSubscription?.remove?.();
    };
  }, [getCurrentSessionStatus, incomingUrl, recoverSessionFromAuthUrl, routeParams]);

  const { control, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onBlur',
    defaultValues: { password: '', confirmPassword: '' },
  });

  const handlePasswordUpdate = async (data) => {
    if (isUpdatingPassword) return;
    setIsUpdatingPassword(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setUpdateError('');
    try {
      const result = await updatePassword(data.password);
      if (result.success) {
        // Do not leave the recovery session active as a normal signed-in
        // session. The user should explicitly sign in with the new password.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSucceeded(true);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setUpdateError(result.error || 'Could not update password. Your link may have expired.');
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const iconName = succeeded
    ? 'check-circle-outline'
    : hasResetSession
    ? 'lock-reset'
    : 'lock-alert-outline';

  return (
    <AuthScreenLayout>
      {/* Back button */}
      <Pressable
        onPress={exitRecoveryToLogin}
        style={({ pressed }) => [styles.backBtn, pressed ? styles.backBtnPressed : null]}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <View
          style={[
            styles.backIconShell,
            {
              backgroundColor: roles.defaultCardBackground,
              borderColor: roles.defaultCardBorder,
            },
          ]}
        >
          <MaterialCommunityIcons name="arrow-left" size={18} color={roles.headingText} />
        </View>
        <Text style={[styles.backBtnText, { color: roles.bodyText }]}>Back</Text>
      </Pressable>

      {/* Illustration */}
      <View style={styles.illustrationSection}>
        <View style={[styles.iconCircleOuter, { backgroundColor: roles.supportCardBackground }]}>
          <View
            style={[
              styles.iconCircleInner,
              {
                backgroundColor: roles.defaultCardBackground,
                borderColor: roles.defaultCardBorder,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={iconName}
              size={36}
              color={roles.primaryActionBackground}
            />
          </View>
        </View>
      </View>

      {/* Header */}
      <View style={styles.headerBlock}>
        <Text
          style={[
            styles.title,
            {
              color: roles.headingText,
              fontFamily:
                resolvedTheme?.secondaryFontFamily || theme.typography.fontFamilyDisplay,
            },
          ]}
        >
          {succeeded
            ? 'Password updated'
            : isCheckingSession
            ? 'Checking link...'
            : hasResetSession
            ? 'Enter new password'
            : 'Reset link unavailable'}
        </Text>
        <Text style={[styles.subtitle, { color: roles.bodyText }]}>
          {succeeded
            ? 'Your password has been updated. You can now log in with your new password.'
            : isCheckingSession
            ? 'Please wait while we verify your reset link.'
            : hasResetSession
            ? 'Choose a strong password. Must include uppercase, lowercase, a number, and a special character.'
            : 'This link may have been opened already, replaced by a newer request, or expired. Request a fresh link to continue.'}
        </Text>
        {!isCheckingSession && !hasResetSession && recoveryError ? (
          <Text style={[styles.recoveryError, { color: theme.colors.textError }]}>
            {recoveryError}
          </Text>
        ) : null}
      </View>

      {/* Content */}
      {isCheckingSession ? (
        <View style={styles.centerRow}>
          <Text style={[styles.infoText, { color: roles.bodyText }]}>Verifying...</Text>
        </View>
      ) : succeeded ? (
        <AppButton
          title="Go to login"
          onPress={() => router.replace('/auth/access')}
          size="lg"
        />
      ) : hasResetSession ? (
        <View style={authLayoutStyles.formSection}>
          {updateError ? (
            <Text style={[styles.errorText, { color: theme.colors.textError }]}>
              {updateError}
            </Text>
          ) : null}

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <PasswordInput
                label="New password"
                placeholder="Create a strong password"
                variant="filled"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={errors.password?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <PasswordInput
                label="Confirm new password"
                placeholder="Retype your password"
                variant="filled"
                onBlur={onBlur}
                onChangeText={onChange}
                value={value}
                error={errors.confirmPassword?.message}
              />
            )}
          />

          <AppButton
            title="Update password"
            onPress={handleSubmit(handlePasswordUpdate)}
            loading={isUpdatingPassword}
            disabled={isUpdatingPassword}
            size="lg"
            style={styles.submitBtn}
          />
        </View>
      ) : (
        <View style={styles.expiredActions}>
          <AppButton
            title="Send a new reset link"
            onPress={() => router.replace('/auth/forgot-password')}
            size="lg"
          />
        </View>
      )}
    </AuthScreenLayout>
  );
}

const styles = StyleSheet.create({
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xxl,
  },
  backBtnPressed: {
    opacity: 0.7,
  },
  backIconShell: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.medium,
  },
  illustrationSection: {
    alignItems: 'center',
    marginBottom: theme.spacing.xxl,
  },
  iconCircleOuter: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleInner: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  headerBlock: {
    marginBottom: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
  },
  subtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  submitBtn: {
    marginTop: theme.spacing.md,
  },
  centerRow: {
    alignItems: 'center',
    paddingVertical: theme.spacing.xl,
  },
  infoText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
  },
  expiredActions: {
    gap: theme.spacing.xl,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  recoveryError: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
});
