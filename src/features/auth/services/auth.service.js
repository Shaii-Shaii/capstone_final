import * as AuthAPI from '../api/auth.api';
import { getProfile } from '../../profile/services/profile.service';
import { ensureProfileInfrastructure, fetchSystemUserByAuthUserId } from '../../profile/api/profile.api';
import { authMessages } from '../../../constants/auth';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { isPasswordReuse, reusedPasswordMessage } from '../../../utils/passwordRules';
import { logAppError, logAppEvent, writeAuditLog } from '../../../utils/appErrors';
import { emptyResolvedTheme, theme } from '../../../design-system/theme';
import { recordAcceptedLegalAgreements } from '../../donorCompliance.service';
import { unregisterCurrentPushNotificationToken } from '../../../hooks/usePushNotifications';
import {
  hasMinimumSignupEmailLocalPart,
  normalizeEmailAddress,
  signupEmailLocalPartMessage,
} from '../../../utils/emailRules';

const isEmailConfirmed = (user) => Boolean(user?.email_confirmed_at || user?.confirmed_at);
const loginErrorCodes = {
  invalidCredentials: 'INVALID_CREDENTIALS',
  accountLocked: 'ACCOUNT_LOCKED',
  rateLimited: 'RATE_LIMITED',
  securityUnavailable: 'LOGIN_SECURITY_UNAVAILABLE',
  roleMismatch: 'ROLE_MISMATCH',
  emailNotConfirmed: 'EMAIL_NOT_CONFIRMED',
  accountDetailsMissing: 'ACCOUNT_DETAILS_MISSING',
  accountInactive: 'ACCOUNT_INACTIVE',
  accessNotStarted: 'ACCESS_NOT_STARTED',
  accessExpired: 'ACCESS_EXPIRED',
  network: 'NETWORK_ERROR',
  accountLoadFailed: 'ACCOUNT_LOAD_FAILED',
  unexpected: 'UNEXPECTED_ERROR',
};

const signupErrorCodes = {
  emailAlreadyRegistered: 'EMAIL_ALREADY_REGISTERED',
  invalidEmail: 'INVALID_EMAIL',
  weakPassword: 'WEAK_PASSWORD',
  rateLimited: 'RATE_LIMITED',
  emailDeliveryFailed: 'EMAIL_DELIVERY_FAILED',
  signupUnavailable: 'SIGNUP_UNAVAILABLE',
  securityCheckFailed: 'SECURITY_CHECK_FAILED',
  network: 'NETWORK_ERROR',
  unexpected: 'UNEXPECTED_ERROR',
};

const googleAuthErrorCodes = {
  cancelled: 'GOOGLE_AUTH_CANCELLED',
  sessionMissing: 'GOOGLE_SESSION_MISSING',
  bootstrapFailed: 'GOOGLE_BOOTSTRAP_FAILED',
  network: 'NETWORK_ERROR',
  unexpected: 'UNEXPECTED_ERROR',
};

const APP_SCHEME = 'donivra';
const MOBILE_RESET_REDIRECT = `${APP_SCHEME}://auth/reset-password`;

const normalizeVisualValue = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const toTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const isNetworkErrorMessage = (message) => {
  const normalized = String(message || '').trim().toLowerCase();
  return (
    normalized.includes('network request failed')
    || normalized.includes('failed to fetch')
    || normalized.includes('fetch failed')
    || normalized.includes('networkerror')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('internet')
    || normalized.includes('offline')
    || normalized.includes('connection')
  );
};

const buildUserFacingLoginError = (message, code = loginErrorCodes.unexpected, sourceError = null) => {
  const error = new Error(message);
  error.code = code;
  error.lockedUntil = sourceError?.lockedUntil || null;
  error.retryAfterSeconds = Number(sourceError?.retryAfterSeconds) || 0;
  error.failedAttempts = Number(sourceError?.failedAttempts) || 0;
  error.attemptsRemaining = sourceError?.attemptsRemaining !== null
    && sourceError?.attemptsRemaining !== undefined
    && Number.isFinite(Number(sourceError.attemptsRemaining))
    ? Number(sourceError.attemptsRemaining)
    : null;
  return error;
};

const buildUserFacingSignupError = (message, code = signupErrorCodes.unexpected, sourceError = null) => {
  const error = new Error(message);
  error.code = code;
  error.backendCode = sourceError?.code || null;
  error.status = sourceError?.status || null;
  return error;
};

const isExpectedSignupFailure = (error) => [
  signupErrorCodes.emailAlreadyRegistered,
  signupErrorCodes.invalidEmail,
  signupErrorCodes.weakPassword,
  signupErrorCodes.rateLimited,
  signupErrorCodes.emailDeliveryFailed,
  signupErrorCodes.signupUnavailable,
  signupErrorCodes.securityCheckFailed,
  signupErrorCodes.network,
].includes(error?.code);

const getFriendlyAuthError = (error) => {
  const msg = String(error?.message || '').trim();
  const normalized = msg.toLowerCase();
  const backendCode = String(error?.code || '').trim().toUpperCase();

  if (backendCode === loginErrorCodes.accountLocked || normalized.includes('temporarily locked')) {
    return buildUserFacingLoginError(
      msg || 'Account temporarily locked. Try again in 15 minutes.',
      loginErrorCodes.accountLocked,
      error
    );
  }

  if (backendCode === loginErrorCodes.securityUnavailable) {
    return buildUserFacingLoginError(
      msg || 'Donivra is temporarily undergoing maintenance. Please try again in a few minutes.',
      loginErrorCodes.securityUnavailable,
      error
    );
  }

  if (
    backendCode === 'OVER_REQUEST_RATE_LIMIT'
    || backendCode === 'RATE_LIMIT_EXCEEDED'
    || normalized.includes('rate limit')
    || normalized.includes('too many requests')
  ) {
    return buildUserFacingLoginError(
      'Too many login requests. Please wait a few minutes before trying again.',
      loginErrorCodes.rateLimited,
      error
    );
  }

  if (normalized.includes('invalid login credentials') || normalized.includes('invalid credentials')) {
    return buildUserFacingLoginError(msg || 'Invalid credentials.', loginErrorCodes.invalidCredentials, error);
  }
  if (normalized.includes('email not confirmed')) {
    return buildUserFacingLoginError('Please verify your email address before logging in.', loginErrorCodes.emailNotConfirmed);
  }
  if (isNetworkErrorMessage(normalized) || isTemporaryDatabaseError(error)) {
    return buildUserFacingLoginError(
      'Donivra is temporarily undergoing maintenance. Your information is safe. Please try again in a few minutes.',
      loginErrorCodes.network,
    );
  }

  return buildUserFacingLoginError('Something went wrong. Please try again.');
};

const getFriendlySignupError = (error) => {
  const msg = String(error?.message || '').trim();
  const normalized = msg.toLowerCase();
  const backendCode = String(error?.code || '').trim().toLowerCase();

  if (
    backendCode === 'user_already_exists'
    || backendCode === 'email_exists'
    || normalized.includes('already registered')
    || normalized.includes('user already exists')
    || normalized.includes('already been registered')
    || normalized.includes('identities')
  ) {
    return buildUserFacingSignupError(
      'An account already uses this email. Try logging in or reset your password.',
      signupErrorCodes.emailAlreadyRegistered,
      error
    );
  }

  if (
    backendCode === 'email_address_invalid'
    || normalized.includes('invalid email')
    || normalized.includes('email address is invalid')
    || (normalized.includes('validate email') && normalized.includes('invalid'))
    || normalized.includes('disposable email')
  ) {
    return buildUserFacingSignupError(
      'Please use a valid email address that can receive messages.',
      signupErrorCodes.invalidEmail,
      error
    );
  }

  if (backendCode === 'weak_password' || normalized.includes('weak password')) {
    return buildUserFacingSignupError(
      'Your password is too weak. Use uppercase, lowercase, numbers, and a special character.',
      signupErrorCodes.weakPassword,
      error
    );
  }

  if (normalized.includes('same password') || normalized.includes('new password should be different')) {
    return buildUserFacingSignupError(reusedPasswordMessage, signupErrorCodes.weakPassword, error);
  }

  if (
    backendCode === 'over_email_send_rate_limit'
    || backendCode === 'over_request_rate_limit'
    || backendCode === 'rate_limit_exceeded'
    || normalized.includes('rate limit')
    || normalized.includes('too many requests')
  ) {
    return buildUserFacingSignupError(
      'Too many signup attempts were made. Please wait a few minutes, then try again.',
      signupErrorCodes.rateLimited,
      error
    );
  }

  if (backendCode === 'signup_disabled' || normalized.includes('signups not allowed') || normalized.includes('signup is disabled')) {
    return buildUserFacingSignupError(
      'Account creation is temporarily unavailable. Please try again later.',
      signupErrorCodes.signupUnavailable,
      error
    );
  }

  if (backendCode === 'captcha_failed' || normalized.includes('captcha')) {
    return buildUserFacingSignupError(
      'We could not complete the security check. Please try again.',
      signupErrorCodes.securityCheckFailed,
      error
    );
  }

  if (
    normalized.includes('error sending confirmation email')
    || normalized.includes('failed to send')
    || normalized.includes('email provider')
    || normalized.includes('smtp')
  ) {
    return buildUserFacingSignupError(
      'We could not send the verification email right now. Please wait a moment and try again.',
      signupErrorCodes.emailDeliveryFailed,
      error
    );
  }

  if (isNetworkErrorMessage(normalized)) {
    return buildUserFacingSignupError(
      'We could not connect right now. Please check your internet and try again.',
      signupErrorCodes.network,
      error
    );
  }

  return buildUserFacingSignupError(
    'We could not create your account right now. Please try again in a moment.',
    signupErrorCodes.unexpected,
    error
  );
};

const isTemporaryDatabaseError = (error) => {
  const message = String(error?.message || '').trim().toLowerCase();
  const code = String(error?.code || '').trim().toLowerCase();
  const status = Number(error?.status || error?.statusCode || 0);

  return (
    code === '57014'
    || status === 502
    || status === 503
    || status === 504
    || status === 522
    || message.includes('statement timeout')
    || message.includes('canceling statement')
    || message.includes('connection timeout')
    || message.includes('gateway timeout')
    || message.includes('service unavailable')
  );
};

const getFriendlyGoogleAuthError = (error) => {
  const msg = String(error?.message || '').trim();
  const normalized = msg.toLowerCase();

  if (normalized.includes('cancel') || normalized.includes('dismiss')) {
    return buildUserFacingLoginError('', googleAuthErrorCodes.cancelled);
  }

  if (isNetworkErrorMessage(normalized)) {
    return buildUserFacingLoginError(
      'We could not connect to Google right now. Please check your internet and try again.',
      googleAuthErrorCodes.network
    );
  }

  return buildUserFacingLoginError(
    'Google sign-in could not be completed. Please try again.',
    googleAuthErrorCodes.unexpected
  );
};

const getFriendlyOtpError = (error) => {
  const msg = String(error?.message || '').trim();
  const normalized = msg.toLowerCase();

  if (
    normalized.includes('otp')
    || normalized.includes('token')
    || normalized.includes('code')
    || normalized.includes('invalid')
    || normalized.includes('expired')
  ) {
    return new Error('Invalid OTP');
  }

  if (isNetworkErrorMessage(normalized)) {
    return new Error('We could not connect right now. Please check your internet and try again.');
  }

  return new Error(msg || 'Invalid OTP');
};

const isInvalidRefreshTokenMessage = (message = '') => {
  const normalized = String(message || '').trim().toLowerCase();
  return (
    normalized.includes('invalid refresh token')
    || normalized.includes('refresh token not found')
    || normalized.includes('invalid grant')
  );
};

const validateSystemUserAccount = (systemUser) => {
  if (!systemUser?.user_id) {
    return buildUserFacingLoginError('We could not find your account details.', loginErrorCodes.accountDetailsMissing);
  }

  if (systemUser.is_active === false) {
    return buildUserFacingLoginError('Your account is currently inactive.', loginErrorCodes.accountInactive);
  }

  const now = Date.now();
  const accessStart = toTimestamp(systemUser.access_start);
  const accessEnd = toTimestamp(systemUser.access_end);

  if (accessStart && accessStart > now) {
    return buildUserFacingLoginError('Your account access has not started yet.', loginErrorCodes.accessNotStarted);
  }

  if (accessEnd && accessEnd < now) {
    return buildUserFacingLoginError('Your account access has already expired.', loginErrorCodes.accessExpired);
  }

  return null;
};

const resolveRoleMismatchError = (actualRole) => (
  buildUserFacingLoginError(
    `This account is registered as a ${actualRole}. Please continue through the ${actualRole} login.`,
    loginErrorCodes.roleMismatch
  )
);

const expectedLoginErrorCodes = new Set([
  loginErrorCodes.invalidCredentials,
  loginErrorCodes.accountLocked,
  loginErrorCodes.rateLimited,
  loginErrorCodes.securityUnavailable,
  loginErrorCodes.roleMismatch,
  loginErrorCodes.emailNotConfirmed,
  loginErrorCodes.accountDetailsMissing,
  loginErrorCodes.accountInactive,
  loginErrorCodes.accessNotStarted,
  loginErrorCodes.accessExpired,
  loginErrorCodes.network,
  loginErrorCodes.accountLoadFailed,
]);

const isExpectedLoginFailure = (error) => (
  expectedLoginErrorCodes.has(error?.code)
);

const isExpectedOtpFailure = (error) => {
  const message = String(error?.message || '').trim().toLowerCase();
  return (
    message === 'invalid otp'
    || message.includes('invalid otp')
    || message.includes('expired')
    || message.includes('invalid')
    || isNetworkErrorMessage(message)
  );
};

const resolveVisualTheme = ({ uiSettings = {}, preset = {} } = {}) => {
  const resolved = {
    brandName: normalizeVisualValue(uiSettings.brand_name),
    brandTagline: normalizeVisualValue(uiSettings.brand_tagline),
    logoIcon: normalizeVisualValue(uiSettings.logo_icon),
    loginBackgroundPhoto: normalizeVisualValue(uiSettings.login_background_photo),
    primaryColor: normalizeVisualValue(uiSettings.primary_color) || normalizeVisualValue(preset.primary_color),
    secondaryColor: normalizeVisualValue(uiSettings.secondary_color) || normalizeVisualValue(preset.secondary_color),
    tertiaryColor: normalizeVisualValue(uiSettings.tertiary_color) || normalizeVisualValue(preset.tertiary_color),
    backgroundColor: normalizeVisualValue(uiSettings.background_color) || normalizeVisualValue(preset.background_color),
    primaryTextColor: normalizeVisualValue(uiSettings.primary_text_color) || normalizeVisualValue(preset.primary_text_color),
    secondaryTextColor: normalizeVisualValue(uiSettings.secondary_text_color) || normalizeVisualValue(preset.secondary_text_color),
    tertiaryTextColor: normalizeVisualValue(uiSettings.tertiary_text_color) || normalizeVisualValue(preset.tertiary_text_color),
    fontFamily: normalizeVisualValue(uiSettings.font_family) || normalizeVisualValue(preset.font_family) || theme.typography.fontFamily,
    secondaryFontFamily: normalizeVisualValue(uiSettings.secondary_font_family) || normalizeVisualValue(preset.secondary_font_family) || theme.typography.fontFamilyDisplay,
  };

  return resolved;
};

/**
 * Helper to translate raw Supabase errors into human-friendly strings
 */
const getFriendlyError = (error) => {
  const msg = error.message || '';
  const normalized = msg.toLowerCase();
  if (msg.toLowerCase().includes('invalid login credentials')) {
    return new Error('Invalid Credentials');
  }
  if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('user already exists')) {
    return new Error('Email already exists');
  }
  if (msg.toLowerCase().includes('email not confirmed')) {
    // Specifically tag this error so the UI can prompt for verification
    const err = new Error("Please verify your email address before logging in.");
    err.code = 'EMAIL_NOT_CONFIRMED';
    return err;
  }
  if (msg.toLowerCase().includes('same password')) {
    return new Error(reusedPasswordMessage);
  }
  if (msg.toLowerCase().includes('new password should be different')) {
    return new Error(reusedPasswordMessage);
  }
  if (msg.toLowerCase().includes('weak password')) {
    return new Error('Your new password is too weak. Use uppercase, lowercase, numbers, and a special character.');
  }
  if (msg.toLowerCase().includes('reauthentication') || msg.toLowerCase().includes('re-authentication')) {
    return new Error('For security, please reauthenticate before changing your password.');
  }
  if (msg.toLowerCase().includes('auth session missing')) {
    return new Error('Your session is no longer active. Please log in again and retry the password change.');
  }
  if (normalized.includes('redirect') && (normalized.includes('not allowed') || normalized.includes('invalid'))) {
    return new Error('Password reset is not configured for this mobile app. Please contact support.');
  }
  if (normalized.includes('rate limit') || normalized.includes('too many requests')) {
    return new Error('Too many reset requests. Please wait a few minutes and try again.');
  }
  if (isNetworkErrorMessage(msg)) {
    return new Error('We could not connect right now. Please check your internet and try again.');
  }
  return new Error('Something went wrong. Please try again.');
};


/**
 * Business logic layer for Auth
 * Handles errors, shapes responses, and triggers related processes
 */

export const login = async (email, password, expectedRole) => {
  try {
    logAppEvent('auth.login', 'Login attempt started.', {
      email,
      expectedRole: expectedRole || null,
    });

    const { data: authData, error } = await AuthAPI.loginWithEmail({ email, password });
    if (error) throw getFriendlyAuthError(error);

    if (!isEmailConfirmed(authData.user)) {
      await AuthAPI.logoutUser();
      const unconfirmedError = buildUserFacingLoginError('Please verify your email address before logging in.', loginErrorCodes.emailNotConfirmed);
      throw unconfirmedError;
    }

    logAppEvent('auth.login.account_lookup_started', 'Fetching public.users record after auth.', {
      authUserId: authData.user?.id || null,
      email,
      expectedRole: expectedRole || null,
    });

    const systemUserResult = await fetchSystemUserByAuthUserId(authData.user.id);
    if (systemUserResult.error) {
      await AuthAPI.logoutUser();
      const accountLoadError = buildUserFacingLoginError(
        'Donivra is temporarily undergoing maintenance. Your information is safe. Please try again in a few minutes.',
        loginErrorCodes.accountLoadFailed,
      );
      logAppError('auth.login.account_lookup_failed', systemUserResult.error, {
        authUserId: authData.user?.id || null,
        email,
        table: 'users',
        filter: { auth_user_id: authData.user?.id || null },
      });
      throw accountLoadError;
    }

    const systemUser = systemUserResult.data || null;
    const accountStateError = validateSystemUserAccount(systemUser);
    if (accountStateError) {
      await AuthAPI.logoutUser();
      throw accountStateError;
    }

    const actualRole = systemUser?.role || null;
    if (!actualRole) {
      await AuthAPI.logoutUser();
      throw buildUserFacingLoginError('We could not find your account details.', loginErrorCodes.accountDetailsMissing);
    }

    if (expectedRole && actualRole && actualRole !== expectedRole) {
      await AuthAPI.logoutUser();
      throw resolveRoleMismatchError(actualRole);
    }

    await writeAuditLog({
      authUserId: authData.user?.id,
      userEmail: authData.user?.email || email,
      action: 'auth.login',
      description: `User logged in as ${actualRole}.`,
      resource: 'auth',
      status: 'success',
    });

    logAppEvent('auth.login', 'Login succeeded.', {
      authUserId: authData.user?.id || null,
      databaseUserId: systemUser?.user_id || null,
      role: actualRole,
    });

    return {
      user: authData.user,
      session: authData.session,
      profile: systemUser,
      role: actualRole,
      error: null,
    };
  } catch (error) {
    const loginLogExtras = {
      email,
      expectedRole: expectedRole || null,
      errorCode: error?.code || null,
    };

    if (isExpectedLoginFailure(error)) {
      logAppEvent('auth.login.failed', error?.message || 'Login failed.', loginLogExtras, 'info');
    } else {
      logAppError('auth.login', error, loginLogExtras);
    }

    // Avoid noisy audit permission warnings for known user-level login failures.
    if (!isExpectedLoginFailure(error)) {
      await writeAuditLog({
        userEmail: email,
        action: 'auth.login',
        description: error.message || 'Login failed.',
        resource: 'auth',
        status: 'failed',
      });
    }
    return {
      user: null,
      session: null,
      profile: null,
      role: null,
      error: error.message,
      errorCode: error.code,
      lockedUntil: error.lockedUntil || null,
      retryAfterSeconds: Number(error.retryAfterSeconds) || 0,
      failedAttempts: Number(error.failedAttempts) || 0,
      attemptsRemaining: error.attemptsRemaining !== null
        && error.attemptsRemaining !== undefined
        && Number.isFinite(Number(error.attemptsRemaining))
        ? Number(error.attemptsRemaining)
        : null,
    };
  }
};


export const register = async (email, password, additionalData = {}) => {
  const normalizedEmail = normalizeEmailAddress(email);

  try {
    if (!hasMinimumSignupEmailLocalPart(normalizedEmail)) {
      throw buildUserFacingSignupError(signupEmailLocalPartMessage, signupErrorCodes.invalidEmail);
    }

    logAppEvent('auth.signup', 'Signup attempt started.', {
      email: normalizedEmail,
      role: additionalData.role || null,
    });

    const metadata = {
      role: additionalData.role,
    };
    
    const { data, error } = await AuthAPI.registerWithEmail({ email: normalizedEmail, password, metadata });
    if (error) throw getFriendlySignupError(error);

    if (data?.user && !data?.session && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw buildUserFacingSignupError('Email already exists', signupErrorCodes.emailAlreadyRegistered);
    }

    // When email confirmation is required, Supabase can create the auth user without
    // returning an active session yet. In that case, defer public table setup until
    // OTP verification/login so signup does not fail before the account is confirmed.
    if (data?.user?.id && data?.session) {
      const ensureSystemUserResult = await ensureProfileInfrastructure({
        authUserId: data.user.id,
        email: data.user.email || normalizedEmail,
        role: additionalData.role || 'donor',
      });

      if (ensureSystemUserResult.error) {
        throw new Error(ensureSystemUserResult.error.message || authMessages.roleNotFound);
      }

      if (additionalData.acceptedLegal === true && ensureSystemUserResult.data?.user_id) {
        const legalResult = await recordAcceptedLegalAgreements({
          databaseUserId: ensureSystemUserResult.data.user_id,
          authUserId: data.user.id,
        });

        if (!legalResult.success) {
          logAppEvent('auth.signup.legal_agreement_skipped', 'Legal agreement save failed after signup. Continuing auth flow.', {
            authUserId: data.user.id,
            databaseUserId: ensureSystemUserResult.data.user_id,
            email: normalizedEmail,
            error: legalResult.error?.message || null,
          }, 'warn');
        }
      }
    }

    if (data?.user?.id && !data?.session) {
      logAppEvent('auth.signup', 'Signup created auth user and is waiting for email verification before DB sync.', {
        authUserId: data.user.id,
        role: additionalData.role || null,
      });
    }

    await writeAuditLog({
      authUserId: data.user?.id,
      userEmail: data.user?.email || normalizedEmail,
      action: 'auth.signup',
      description: data?.session
        ? `Signup created for ${additionalData.role || 'account'} account.`
        : `Signup created and is waiting for email verification for ${additionalData.role || 'account'} account.`,
      resource: 'auth',
      status: 'success',
    });

    logAppEvent('auth.signup', 'Signup succeeded.', {
      authUserId: data.user?.id || null,
      role: additionalData.role || null,
    });

    return { user: data.user, session: data.session, error: null };

  } catch (error) {
    const signupLogExtras = {
      email: normalizedEmail,
      role: additionalData.role || null,
      errorCode: error?.code || null,
      backendCode: error?.backendCode || null,
      status: error?.status || null,
    };

    if (isExpectedSignupFailure(error)) {
      logAppEvent('auth.signup.failed', error?.message || 'Signup could not be completed.', signupLogExtras, 'info');
    } else {
      logAppError('auth.signup', error, signupLogExtras);
    }

    await writeAuditLog({
      userEmail: normalizedEmail,
      action: 'auth.signup',
      description: error.message || 'Signup failed.',
      resource: 'auth',
      status: 'failed',
    });
    return { user: null, session: null, error: error.message, errorCode: error.code };
  }
};

export const continueWithGoogle = async ({ role = 'tentative' } = {}) => {
  let authUserId = '';
  let authEmail = '';

  try {
    logAppEvent('auth.google.start', 'Google auth started.', {
      requestedRole: role || null,
    });

    const { data: authData, error, cancelled } = await AuthAPI.signInWithGoogle();
    if (cancelled) {
      logAppEvent('auth.google.cancelled', 'Google auth was cancelled by the user.', {}, 'info');
      return {
        user: null,
        session: null,
        profile: null,
        role: null,
        cancelled: true,
        error: null,
      };
    }

    if (error) throw getFriendlyGoogleAuthError(error);

    const session = authData?.session || null;
    const user = authData?.user || session?.user || null;
    authUserId = user?.id || '';
    authEmail = user?.email || '';

    logAppEvent('auth.google.success', 'Google auth returned an authenticated session.', {
      authUserId: authUserId || null,
      email: authEmail || null,
    });

    if (!session?.access_token || !authUserId) {
      throw buildUserFacingLoginError(
        'Google sign-in could not create a valid session. Please try again.',
        googleAuthErrorCodes.sessionMissing
      );
    }

    let ensureResult = await ensureProfileInfrastructure({
      authUserId,
      email: authEmail || null,
      role: role || null,
    });

    if (ensureResult.error) {
      logAppError('auth.google.bootstrap_retry', ensureResult.error, {
        authUserId,
        email: authEmail || null,
      });

      ensureResult = await ensureProfileInfrastructure({
        authUserId,
        email: authEmail || null,
        role: role || null,
      });
    }

    if (ensureResult.error || !ensureResult.data?.user_id) {
      const bootstrapError = ensureResult.error || new Error(authMessages.roleNotFound);
      logAppError('auth.google.bootstrap_failed', bootstrapError, {
        authUserId,
        email: authEmail || null,
      });
      await AuthAPI.logoutUser();
      throw buildUserFacingLoginError(
        'Google sign-in worked, but your app profile could not be prepared. Please try again.',
        googleAuthErrorCodes.bootstrapFailed
      );
    }

    const accountStateError = validateSystemUserAccount(ensureResult.data);
    if (accountStateError) {
      await AuthAPI.logoutUser();
      throw accountStateError;
    }

    await writeAuditLog({
      authUserId,
      databaseUserId: ensureResult.data.user_id,
      userEmail: authEmail || '',
      action: 'auth.google',
      description: `User continued with Google as ${ensureResult.data.role || 'an onboarding account'}.`,
      resource: 'auth',
      status: 'success',
    });

    logAppEvent('auth.google.redirect_delegate', 'Google auth bootstrap succeeded; routing delegated to role/onboarding redirect.', {
      authUserId,
      databaseUserId: ensureResult.data.user_id,
      email: authEmail || null,
      role: ensureResult.data.role || null,
    });

    return {
      user,
      session,
      profile: ensureResult.data,
      role: ensureResult.data.role || null,
      cancelled: false,
      error: null,
    };
  } catch (error) {
    if (authUserId) {
      await AuthAPI.logoutUser();
    }

    logAppError('auth.google', error, {
      authUserId: authUserId || null,
      email: authEmail || null,
      errorCode: error?.code || null,
    });

    await writeAuditLog({
      authUserId,
      userEmail: authEmail || '',
      action: 'auth.google',
      description: error.message || 'Google auth failed.',
      resource: 'auth',
      status: 'failed',
    });

    return {
      user: null,
      session: null,
      profile: null,
      role: null,
      cancelled: error?.code === googleAuthErrorCodes.cancelled,
      error: error.message || 'Google sign-in could not be completed. Please try again.',
      errorCode: error.code,
    };
  }
};

export const getResolvedSystemTheme = async () => {
  try {
    logAppEvent('auth.theme', 'Resolving login theme from database settings.', {
      tables: ['UI_Settings', 'Theme_Presets'],
    });

    const [uiSettingsResult, defaultPresetResult] = await Promise.all([
      AuthAPI.fetchUiSettings(),
      AuthAPI.fetchDefaultThemePreset(),
    ]);

    if (uiSettingsResult.error) {
      logAppEvent(
        'auth.theme.ui_settings_unavailable',
        'UI settings could not be reached. Using the local theme fallback.',
        { table: 'UI_Settings' },
        'info'
      );
    }

    if (defaultPresetResult.error) {
      logAppEvent(
        'auth.theme.theme_preset_unavailable',
        'Theme presets could not be reached. Using the local theme fallback.',
        { table: 'Theme_Presets' },
        'info'
      );
    }

    const branding = resolveVisualTheme({
      uiSettings: uiSettingsResult.data || {},
      preset: defaultPresetResult.data || {},
    });

    logAppEvent('auth.theme', 'Resolved login theme for auth screens.', {
      hasUiSettings: Boolean(uiSettingsResult.data),
      hasDefaultPreset: Boolean(defaultPresetResult.data),
      brandName: branding.brandName,
      hasLogoIcon: Boolean(branding.logoIcon),
      hasLoginBackgroundPhoto: Boolean(branding.loginBackgroundPhoto),
    });

    return {
      data: branding,
      error: null,
    };
  } catch (error) {
    logAppEvent(
      'auth.theme.unavailable',
      'Theme settings could not be reached. Using the local theme fallback.',
      {
        tables: ['UI_Settings', 'Theme_Presets'],
        reason: isNetworkErrorMessage(error?.message) || isTemporaryDatabaseError(error)
          ? 'temporary_service_issue'
          : 'fallback_required',
      },
      'info',
    );

    return {
      data: emptyResolvedTheme,
      error,
    };
  }
};

export const getResolvedLoginTheme = getResolvedSystemTheme;

export const verifyEmail = async (email, code) => {
  try {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedCode = String(code || '').replace(/\s+/g, '').trim();

    logAppEvent('auth.verify_email', 'OTP verification attempt started.', {
      email: normalizedEmail,
      codeLength: normalizedCode.length,
    });

    const { data, error } = await AuthAPI.verifyEmailOtp({ email: normalizedEmail, token: normalizedCode });
    if (error) throw getFriendlyOtpError(error);
    
    // After verification, check profile for routing
    let profile = null;
    if (data?.user) {
      const ensureSystemUserResult = await ensureProfileInfrastructure({
        authUserId: data.user.id,
        email: data.user.email || email,
        role: data.user.user_metadata?.role || 'donor',
      });

      if (ensureSystemUserResult.error) {
        throw new Error(ensureSystemUserResult.error.message || authMessages.roleNotFound);
      }

      if (ensureSystemUserResult.data?.user_id) {
        const legalResult = await recordAcceptedLegalAgreements({
          databaseUserId: ensureSystemUserResult.data.user_id,
          authUserId: data.user.id,
        });

        if (!legalResult.success) {
          logAppEvent('auth.verify_email.legal_agreement_skipped', 'Legal agreement save failed after email verification. Continuing verified account flow.', {
            authUserId: data.user.id,
            databaseUserId: ensureSystemUserResult.data.user_id,
            email: normalizedEmail,
            error: legalResult.error?.message || null,
          }, 'warn');
        }
      }

      const { profile: fetchedProfile } = await getProfile(data.user.id);
      profile = fetchedProfile;
    }

    await writeAuditLog({
      authUserId: data?.user?.id,
      userEmail: data?.user?.email || normalizedEmail,
      action: 'auth.verify_email',
      description: 'Email verification completed.',
      resource: 'auth',
      status: 'success',
    });

    logAppEvent('auth.verify_email', 'OTP verification succeeded.', {
      authUserId: data?.user?.id || null,
      databaseUserId: profile?.user_id || null,
      role: profile?.role || null,
    });

    return {
      user: data?.user,
      session: data?.session,
      profile,
      role: profile?.role || null,
      error: null,
    };
  } catch (error) {
    const otpLogExtras = {
      email: String(email || '').trim().toLowerCase(),
      codeLength: String(code || '').replace(/\s+/g, '').trim().length,
    };
    if (isExpectedOtpFailure(error)) {
      logAppEvent('auth.verify_email.failed', error?.message || 'OTP verification failed.', otpLogExtras, 'info');
    } else {
      logAppError('auth.verify_email', error, otpLogExtras);
    }

    await writeAuditLog({
      userEmail: String(email || '').trim().toLowerCase(),
      action: 'auth.verify_email',
      description: error.message || 'Email verification failed.',
      resource: 'auth',
      status: 'failed',
    });
    return { user: null, session: null, profile: null, role: null, error: error.message };
  }
};

export const resendVerifyEmail = async (email) => {
  try {
    const { error } = await AuthAPI.resendSignupOtp({ email });
    if (error) throw getFriendlyError(error);
    await writeAuditLog({
      userEmail: email,
      action: 'auth.resend_verification',
      description: 'Verification email resent.',
      resource: 'auth',
      status: 'success',
    });
    return { success: true, error: null };
  } catch (error) {
    await writeAuditLog({
      userEmail: email,
      action: 'auth.resend_verification',
      description: error.message || 'Resend verification failed.',
      resource: 'auth',
      status: 'failed',
    });
    return { success: false, error: error.message };
  }
};


export const logout = async () => {
  let currentUser = null;

  try {
    const sessionResult = await AuthAPI.getCurrentSession();
    currentUser = sessionResult?.data?.session?.user || null;
  } catch (sessionError) {
    logAppEvent('auth.logout.session_lookup_skipped', 'Current session lookup failed before logout. Continuing sign-out.', {
      error: sessionError?.message || null,
    }, 'warn');
  }

  try {
    const pushResult = await unregisterCurrentPushNotificationToken();
    if (pushResult?.error) {
      logAppEvent('auth.logout.push_token_cleanup_skipped', 'The device push token could not be deactivated before logout.', {
        error: pushResult.error?.message || String(pushResult.error),
      }, 'warn');
    }
  } catch (pushError) {
    logAppEvent('auth.logout.push_token_cleanup_exception', 'Push token cleanup failed unexpectedly before logout.', {
      error: pushError?.message || null,
    }, 'warn');
  }

  try {
    const auditResult = await writeAuditLog({
      authUserId: currentUser?.id,
      userEmail: currentUser?.email || '',
      action: 'auth.logout',
      description: 'User logged out.',
      resource: 'auth',
      status: 'success',
    });

    if (!auditResult.success) {
      logAppEvent('auth.logout.audit_skipped', 'Logout audit log could not be written before session teardown. Continuing logout.', {
        authUserId: currentUser?.id || null,
        userEmail: currentUser?.email || '',
        auditError: auditResult.error || null,
      }, 'warn');
    }
  } catch (auditError) {
    logAppEvent('auth.logout.audit_exception', 'Logout audit threw unexpectedly. Continuing logout.', {
      authUserId: currentUser?.id || null,
      userEmail: currentUser?.email || '',
      auditError: auditError?.message || null,
    }, 'warn');
  }

  try {
    const { error } = await AuthAPI.logoutUser();
    if (error) {
      const message = String(error?.message || '');
      if (isInvalidRefreshTokenMessage(message)) {
        return { success: true, error: null };
      }
      throw new Error(message || 'Logout failed.');
    }

    return { success: true, error: null };
  } catch (error) {
    const auditResult = await writeAuditLog({
      action: 'auth.logout',
      description: error.message || 'Logout failed.',
      resource: 'auth',
      status: 'failed',
    });

    if (!auditResult.success) {
      logAppEvent('auth.logout.audit_failed', 'Logout failure audit log could not be written.', {
        auditError: auditResult.error || null,
        logoutError: error.message || null,
      }, 'warn');
    }

    return { success: false, error: error.message };
  }
};

export const getCurrentSessionStatus = async () => {
  try {
    const { data, error } = await AuthAPI.getCurrentSession();
    if (error) throw getFriendlyError(error);
    return { session: data?.session || null, error: null };
  } catch (error) {
    return { session: null, error: error.message };
  }
};

export const recoverSessionFromAuthUrl = async (url) => {
  try {
    if (!url) {
      return { session: null, error: null };
    }

    const { data, error } = await AuthAPI.createSessionFromAuthUrl(url);
    if (error) throw getFriendlyError(error);
    return { session: data?.session || null, user: data?.user || null, error: null };
  } catch (error) {
    return { session: null, user: null, error: error.message };
  }
};

export const sendPasswordReset = async (email) => {
  try {
    // Keep the native callback stable so it exactly matches the Supabase
    // allow-list. Linking.createURL can produce an environment-specific URL
    // (for example an Expo development URL), which causes recovery links to
    // return without their token on a standalone Android build.
    const redirectTo = Platform.OS === 'web'
      ? Linking.createURL('/auth/reset-password')
      : MOBILE_RESET_REDIRECT;
    const { error } = await AuthAPI.sendPasswordResetEmail({ email, redirectTo });
    if (error) {
      const friendlyError = getFriendlyError(error);
      logAppError('auth.password_reset_failed', friendlyError.message, {
        rawMessage: error.message || '',
        redirectTo,
        emailDomain: String(email || '').split('@')[1] || '',
      });
      throw friendlyError;
    }
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const updatePassword = async (payload) => {
  try {
    const normalizedPayload = typeof payload === 'string'
      ? { newPassword: payload, currentPassword: '' }
      : (payload || {});
    const { newPassword, currentPassword } = normalizedPayload;

    if (isPasswordReuse(currentPassword, newPassword)) {
      throw new Error(reusedPasswordMessage);
    }

    const { error } = await AuthAPI.updateUserPassword({ newPassword });
    if (error) throw getFriendlyError(error);

    const sessionResult = await AuthAPI.getCurrentSession();
    const currentUser = sessionResult.data?.session?.user || null;
    await writeAuditLog({
      authUserId: currentUser?.id,
      userEmail: currentUser?.email || '',
      action: 'auth.update_password',
      description: 'Password updated successfully.',
      resource: 'auth',
      status: 'success',
    });

    return { success: true, error: null };
  } catch (error) {
    await writeAuditLog({
      action: 'auth.update_password',
      description: error.message || 'Password update failed.',
      resource: 'auth',
      status: 'failed',
    });
    return { success: false, error: error.message };
  }
};
