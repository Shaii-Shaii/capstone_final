import { supabase } from '../api/supabase/client';

export const createAppError = (title, message) => ({
  title,
  message,
});

export const getErrorMessage = (error, fallback = '') => {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return fallback;
};

const LOG_LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const resolveConfiguredLogLevel = () => {
  const configuredLevel = String(process.env.EXPO_PUBLIC_APP_LOG_LEVEL || 'warn')
    .trim()
    .toLowerCase();

  return LOG_LEVEL_PRIORITY[configuredLevel] ? configuredLevel : 'warn';
};

const shouldWriteConsoleLog = (level = 'info') => {
  const normalizedLevel = LOG_LEVEL_PRIORITY[level] ? level : 'info';
  return LOG_LEVEL_PRIORITY[normalizedLevel] >= LOG_LEVEL_PRIORITY[resolveConfiguredLogLevel()];
};

const writeConsoleLog = (level, scope, message, extras = {}, error = undefined) => {
  const normalizedLevel = LOG_LEVEL_PRIORITY[level] ? level : 'info';

  if (!shouldWriteConsoleLog(normalizedLevel)) {
    return;
  }

  const logger = typeof console?.[normalizedLevel] === 'function'
    ? console[normalizedLevel]
    : console.log;
  logger(`[${scope}] ${message}`, {
    timestamp: new Date().toISOString(),
    scope,
    message,
    extras,
    error,
  });
};

export const logAppEvent = (scope, message, extras = {}, level = 'info') => {
  writeConsoleLog(level, scope, message, extras);
};

export const logAppError = (scope, error, extras) => {
  const technicalMessage = getErrorMessage(error, 'Unknown error');

  writeConsoleLog('error', scope, technicalMessage, extras, error);
};

const isAuditPermissionError = (error) => {
  const normalizedMessage = String(error?.message || '').toLowerCase();
  const normalizedCode = String(error?.code || '').trim();

  return (
    normalizedCode === '42501'
    || normalizedMessage.includes('row-level security')
    || normalizedMessage.includes('violates row-level security policy')
  );
};

const resolveAuditUserId = async ({ databaseUserId = null, authUserId = '', userEmail = '' } = {}) => {
  if (databaseUserId) {
    return databaseUserId;
  }

  if (authUserId) {
    const result = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (result.data?.user_id) {
      return result.data.user_id;
    }
  }

  if (userEmail) {
    const result = await supabase
      .from('users')
      .select('user_id')
      .ilike('email', userEmail.trim())
      .maybeSingle();

    if (result.data?.user_id) {
      return result.data.user_id;
    }
  }

  return null;
};

export const writeAuditLog = async ({
  databaseUserId = null,
  authUserId = '',
  userEmail = '',
  action,
  description = '',
  resource = '',
  status = 'success',
}) => {
  try {
    if (!action) {
      return { success: false, error: 'Audit action is required.' };
    }

    const userId = await resolveAuditUserId({ databaseUserId, authUserId, userEmail });

    const result = await supabase
      .from('audit_logs')
      .insert([{
        user_id: userId,
        action,
        description: description || null,
        time: new Date().toISOString(),
        user_email: userEmail || null,
        resource: resource || null,
        status: status || 'success',
      }]);

    if (result.error) {
      throw result.error;
    }

    return {
      success: true,
      logId: null,
      error: null,
    };
  } catch (error) {
    const auditExtras = {
      action,
      resource,
      status,
      userEmail,
      authUserId,
      databaseUserId,
    };

    if (isAuditPermissionError(error)) {
      logAppEvent('audit.writeAuditLog.permission_denied', 'Audit log insert was blocked by database permissions. Continuing without blocking the user flow.', {
        ...auditExtras,
        errorCode: error?.code || null,
      }, 'warn');
    } else {
      logAppError('audit.writeAuditLog', error, auditExtras);
    }

    return {
      success: false,
      logId: null,
      error: getErrorMessage(error, 'Unable to write audit log.'),
    };
  }
};
