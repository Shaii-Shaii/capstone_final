import { createClient } from 'npm:@supabase/supabase-js@2';
import { createJsonResponse, handleCorsPreflight } from '../_shared/cors.ts';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const LOCKOUT_MS = LOCKOUT_MINUTES * 60 * 1000;

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();

const toTimestamp = (value: unknown) => {
  const timestamp = value ? new Date(String(value)).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getLoginSecurityState = (user: Record<string, unknown> | null = null) => {
  const appMetadata = (user?.app_metadata || {}) as Record<string, unknown>;
  const loginSecurity = (appMetadata.login_security || {}) as Record<string, unknown>;
  const metadataLockedUntil = toTimestamp(loginSecurity.locked_until);
  const providerBannedUntil = toTimestamp(user?.banned_until);
  const lockedUntilTimestamp = Math.max(metadataLockedUntil, providerBannedUntil);
  const now = Date.now();
  const isLocked = lockedUntilTimestamp > now;
  const storedFailures = Math.max(0, Number(loginSecurity.failed_attempts) || 0);

  return {
    appMetadata,
    failedAttempts: !isLocked && metadataLockedUntil && metadataLockedUntil <= now ? 0 : storedFailures,
    isLocked,
    lockedUntil: lockedUntilTimestamp ? new Date(lockedUntilTimestamp).toISOString() : null,
    retryAfterSeconds: isLocked
      ? Math.max(1, Math.ceil((lockedUntilTimestamp - now) / 1000))
      : 0,
  };
};

Deno.serve(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;
  if (request.method !== 'POST') {
    return createJsonResponse({ success: false, message: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return createJsonResponse({ success: false, message: 'Authentication service configuration is missing.' }, 500);
  }

  const payload = await request.json().catch(() => ({}));
  const email = normalizeEmail(payload?.email);
  const password = String(payload?.password || '');
  if (!email || !password) {
    return createJsonResponse({
      success: false,
      errorCode: 'INVALID_CREDENTIALS',
      message: 'Email and password are required.',
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const systemUserResult = await adminClient
    .from('users')
    .select('user_id,auth_user_id')
    .ilike('email', email)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (systemUserResult.error) {
    return createJsonResponse({
      success: false,
      errorCode: 'LOGIN_SECURITY_UNAVAILABLE',
      message: 'Secure login is temporarily unavailable. Please try again shortly.',
    });
  }

  const databaseUserId = Number(systemUserResult.data?.user_id) || null;
  const authUserId = String(systemUserResult.data?.auth_user_id || '');
  const adminUserResult = authUserId
    ? await adminClient.auth.admin.getUserById(authUserId)
    : { data: { user: null }, error: null };
  if (adminUserResult.error) {
    return createJsonResponse({
      success: false,
      errorCode: 'LOGIN_SECURITY_UNAVAILABLE',
      message: 'Secure login is temporarily unavailable. Please try again shortly.',
    });
  }

  const lockoutState = getLoginSecurityState(
    (adminUserResult.data?.user || null) as unknown as Record<string, unknown> | null,
  );
  if (lockoutState.isLocked) {
    return createJsonResponse({
      success: false,
      errorCode: 'ACCOUNT_LOCKED',
      message: `Account temporarily locked. Try again in ${LOCKOUT_MINUTES} minutes.`,
      lockedUntil: lockoutState.lockedUntil,
      retryAfterSeconds: lockoutState.retryAfterSeconds,
    });
  }

  const authResult = await authClient.auth.signInWithPassword({ email, password });
  const authErrorCode = String(authResult.error?.code || '').toLowerCase();
  const authErrorMessage = String(authResult.error?.message || '').toLowerCase();
  const isInvalidPassword = Boolean(authResult.error) && (
    authErrorCode === 'invalid_credentials'
    || authErrorMessage.includes('invalid login credentials')
    || authErrorMessage.includes('invalid credentials')
  );

  const writeSecurityEvent = async (action: string, description: string, status: string) => {
    if (!databaseUserId) return { error: null, skipped: true };

    const result = await adminClient.from('audit_logs').insert([{
      user_id: databaseUserId,
      action,
      description,
      time: new Date().toISOString(),
      user_email: email,
      resource: 'auth',
      status,
    }]);
    return { error: result.error || null, skipped: false };
  };

  if (isInvalidPassword) {
    // Keep unknown emails indistinguishable and avoid creating orphan audit
    // rows. Registered accounts always have a public.users identity.
    if (!databaseUserId || !authUserId) {
      return createJsonResponse({
        success: false,
        errorCode: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials.',
      });
    }

    const nextFailureCount = lockoutState.failedAttempts + 1;
    const isLockingAttempt = nextFailureCount >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = isLockingAttempt
      ? new Date(Date.now() + LOCKOUT_MS).toISOString()
      : null;
    const updateResult = await adminClient.auth.admin.updateUserById(authUserId, {
      app_metadata: {
        ...lockoutState.appMetadata,
        login_security: {
          failed_attempts: Math.min(nextFailureCount, MAX_FAILED_ATTEMPTS),
          last_failed_at: new Date().toISOString(),
          locked_until: lockedUntil,
        },
      },
      ...(isLockingAttempt ? { ban_duration: `${LOCKOUT_MINUTES}m` } : {}),
    });
    if (updateResult.error) {
      console.error('Unable to persist password failure security state.', updateResult.error);
      return createJsonResponse({
        success: false,
        errorCode: 'LOGIN_SECURITY_UNAVAILABLE',
        message: 'Secure login is temporarily unavailable. Please try again shortly.',
      });
    }

    const failureAuditResult = await writeSecurityEvent(
      'auth.login.password_failed',
      `Password login failed (${Math.min(nextFailureCount, MAX_FAILED_ATTEMPTS)}/${MAX_FAILED_ATTEMPTS}).`,
      'failed',
    );
    if (failureAuditResult.error) {
      console.error('Unable to persist password failure audit event.', failureAuditResult.error);
    }

    if (isLockingAttempt) {
      const lockAuditResult = await writeSecurityEvent(
        'auth.login.account_locked',
        `Account temporarily locked after ${MAX_FAILED_ATTEMPTS} consecutive failed password attempts.`,
        'failed',
      );
      if (lockAuditResult.error) {
        console.error('Unable to persist account lock audit event.', lockAuditResult.error);
      }

      return createJsonResponse({
        success: false,
        errorCode: 'ACCOUNT_LOCKED',
        message: `Account temporarily locked. Try again in ${LOCKOUT_MINUTES} minutes.`,
        lockedUntil,
        retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000),
        failedAttempts: MAX_FAILED_ATTEMPTS,
        attemptsRemaining: 0,
      });
    }

    const attemptsRemaining = MAX_FAILED_ATTEMPTS - nextFailureCount;
    return createJsonResponse({
      success: false,
      errorCode: 'INVALID_CREDENTIALS',
      message: `Invalid credentials. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining before temporary lockout.`,
      failedAttempts: nextFailureCount,
      attemptsRemaining,
    });
  }

  if (authResult.error) {
    const isBanned = authErrorCode === 'user_banned' || authErrorMessage.includes('banned');
    return createJsonResponse({
      success: false,
      errorCode: isBanned ? 'ACCOUNT_LOCKED' : (authResult.error.code || 'AUTH_ERROR'),
      message: isBanned
        ? `Account temporarily locked. Try again in ${LOCKOUT_MINUTES} minutes.`
        : authResult.error.message,
      lockedUntil: isBanned ? lockoutState.lockedUntil : null,
      retryAfterSeconds: isBanned ? lockoutState.retryAfterSeconds || Math.ceil(LOCKOUT_MS / 1000) : 0,
    });
  }

  if (authUserId) {
    const authenticatedAppMetadata = (authResult.data.user?.app_metadata || lockoutState.appMetadata) as Record<string, unknown>;
    const resetResult = await adminClient.auth.admin.updateUserById(authUserId, {
      app_metadata: {
        ...authenticatedAppMetadata,
        login_security: {
          failed_attempts: 0,
          last_failed_at: null,
          locked_until: null,
          last_succeeded_at: new Date().toISOString(),
        },
      },
    });
    if (resetResult.error) {
      console.error('Unable to clear the consecutive password failure counter.', resetResult.error);
      return createJsonResponse({
        success: false,
        errorCode: 'LOGIN_SECURITY_UNAVAILABLE',
        message: 'Secure login is temporarily unavailable. Please try again shortly.',
      });
    }
  }

  const successEventResult = await writeSecurityEvent(
    'auth.login.password_succeeded',
    'Password login succeeded and the consecutive failure counter was cleared.',
    'success',
  );
  if (successEventResult.error) {
    console.error('Unable to clear the consecutive password failure counter.', successEventResult.error);
  }

  return createJsonResponse({
    success: true,
    user: authResult.data.user,
    session: authResult.data.session,
  });
});
