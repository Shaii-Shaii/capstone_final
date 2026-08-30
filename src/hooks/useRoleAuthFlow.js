import { Alert } from 'react-native';
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuthActions } from '../features/auth/hooks/useAuthActions';
import {
  authMessages,
  roleAuthConfig,
} from '../constants/auth';
import { useAuth } from '../providers/AuthProvider';
import { savePendingSignupDraft, syncPendingSignupDraft } from '../features/auth/services/signupDraft.service';
import { logAppEvent } from '../utils/appErrors';

export const useRoleAuthFlow = (role) => {
  const router = useRouter();
  const { login, register, continueWithGoogle, logout, isLoading, clearError } = useAuthActions();
  const { refreshProfile, resolvedTheme } = useAuth();
  const config = roleAuthConfig[role] || roleAuthConfig.access;
  const expectedRole = role === 'donor' || role === 'patient' ? role : undefined;
  const [loginError, setLoginError] = useState('');
  const [loginErrorCode, setLoginErrorCode] = useState('');
  const [loginLockedUntil, setLoginLockedUntil] = useState(null);
  const [loginLockoutSeconds, setLoginLockoutSeconds] = useState(0);
  const [signupError, setSignupError] = useState('');
  const [googleError, setGoogleError] = useState('');
  const [activeAuthAction, setActiveAuthAction] = useState('');

  const formatLockoutMessage = (seconds) => {
    const safeSeconds = Math.max(1, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = safeSeconds % 60;
    return `Account temporarily locked. Try again in ${minutes}:${String(remainingSeconds).padStart(2, '0')}.`;
  };

  useEffect(() => {
    if (!loginLockedUntil) {
      setLoginLockoutSeconds(0);
      return undefined;
    }

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((new Date(loginLockedUntil).getTime() - Date.now()) / 1000));
      setLoginLockoutSeconds(remaining);
      if (remaining > 0) {
        setLoginErrorCode('ACCOUNT_LOCKED');
        setLoginError(formatLockoutMessage(remaining));
      } else {
        setLoginLockedUntil(null);
        setLoginErrorCode('');
        setLoginError('');
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [loginLockedUntil]);

  const clearLoginError = (fieldName = '') => {
    if (loginLockoutSeconds > 0 && fieldName !== 'email') return;
    if (fieldName === 'email') {
      setLoginLockedUntil(null);
      setLoginLockoutSeconds(0);
    }
    setLoginError('');
    setLoginErrorCode('');
    setGoogleError('');
    clearError?.();
  };

  const clearSignupError = () => {
    setSignupError('');
    setGoogleError('');
    clearError?.();
  };

  const clearGoogleError = () => {
    setGoogleError('');
    clearError?.();
  };

  const handleSignup = async (data) => {
    clearSignupError();
    const selectedRole = 'tentative';

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveAuthAction('signup');

    try {
      const result = await register(data.email, data.password, {
        role: selectedRole,
        acceptedLegal: data.acceptedLegal === true,
      });

      if (result.success) {
        await savePendingSignupDraft({
          email: data.email,
          role: selectedRole,
        });

        if (result.session && result.user?.id) {
          await syncPendingSignupDraft({
            userId: result.user.id,
            email: data.email,
            role: selectedRole,
          });

          await logout();
        }

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace(`/auth/verify-email?email=${encodeURIComponent(data.email)}&role=${selectedRole}`);
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setSignupError(result.error || authMessages.signupFailed);
    } finally {
      setActiveAuthAction('');
    }
  };

  const handleLogin = async (data) => {
    if (loginLockoutSeconds > 0) {
      setLoginErrorCode('ACCOUNT_LOCKED');
      setLoginError(formatLockoutMessage(loginLockoutSeconds));
      return;
    }

    clearLoginError();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveAuthAction('login');

    try {
      const result = await login(data.email, data.password, expectedRole);

      if (result.success || result.user) {
        setLoginLockedUntil(null);
        setLoginErrorCode('');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const resolvedRole = result.role || result.profile?.role;

        if (!resolvedRole) {
          setLoginError(authMessages.roleNotFound);
          return;
        }

        router.replace('/');
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      if (result.errorCode === 'EMAIL_NOT_CONFIRMED' || (result.error && result.error.includes('verify your email'))) {
        const verifyRole = expectedRole || result.role || result.profile?.role;

        Alert.alert(
          authMessages.verifyPromptTitle,
          authMessages.verifyPromptBody,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Verify Now',
              onPress: () => router.replace(`/auth/verify-email?email=${encodeURIComponent(data.email)}${verifyRole ? `&role=${verifyRole}` : ''}`),
            },
          ]
        );
        return;
      }

      setLoginErrorCode(result.errorCode || '');
      if (result.errorCode === 'ACCOUNT_LOCKED') {
        const fallbackDurationMs = Math.max(1, Number(result.retryAfterSeconds) || 15 * 60) * 1000;
        const resolvedLockedUntil = result.lockedUntil
          && new Date(result.lockedUntil).getTime() > Date.now()
          ? result.lockedUntil
          : new Date(Date.now() + fallbackDurationMs).toISOString();
        setLoginLockedUntil(resolvedLockedUntil);
        setLoginError(formatLockoutMessage(Math.ceil((new Date(resolvedLockedUntil).getTime() - Date.now()) / 1000)));
      } else {
        setLoginError(result.error || authMessages.loginFailed);
      }
    } finally {
      setActiveAuthAction('');
    }
  };

  const handleGoogleAuth = async () => {
    clearLoginError();
    clearSignupError();
    clearGoogleError();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveAuthAction('google');

    try {
      const result = await continueWithGoogle({
        role: 'tentative',
      });

      if (result.cancelled) {
        return;
      }

      if (result.success || result.user) {
        if (result.user?.id) {
          await refreshProfile(result.user.id);
        }

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        logAppEvent('auth.google.redirect_requested', 'Google auth completed; routing through app root.', {
          authUserId: result.user?.id || null,
          role: result.role || result.profile?.role || null,
        });
        router.replace('/');
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const message = result.error || authMessages.loginFailed;
      setGoogleError(message);

      if (role === 'signup') {
        setSignupError(message);
      } else {
        setLoginError(message);
      }
    } finally {
      setActiveAuthAction('');
    }
  };

  return {
    isLoading,
    activeAuthAction,
    config,
    loginError,
    loginErrorCode,
    loginLockoutSeconds,
    isLoginLocked: loginLockoutSeconds > 0,
    signupError,
    googleError,
    clearLoginError,
    clearSignupError,
    clearGoogleError,
    resolvedTheme,
    handleSignup,
    handleLogin,
    handleGoogleAuth,
  };
};
