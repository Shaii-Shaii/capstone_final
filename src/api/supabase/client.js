import 'react-native-url-polyfill/auto';
import './webCryptoPolyfill';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const supabasePublishableKey = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();
const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey);
const missingSupabaseConfigMessage = 'Supabase environment variables are not configured.';

const extractPersistedSession = (payload) => {
  if (!payload || typeof payload !== 'object') return null;

  if (payload.currentSession && typeof payload.currentSession === 'object') {
    return payload.currentSession;
  }

  if (payload.session && typeof payload.session === 'object') {
    return payload.session;
  }

  if (payload.access_token || payload.refresh_token || payload.user) {
    return payload;
  }

  return null;
};

const shouldDiscardPersistedAuthValue = (rawValue) => {
  if (!rawValue) return false;

  let parsedValue;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch (_error) {
    return true;
  }

  const persistedSession = extractPersistedSession(parsedValue);
  if (!persistedSession) return false;

  const hasAccessToken = Boolean(persistedSession?.access_token);
  const hasRefreshToken = Boolean(persistedSession?.refresh_token);
  const hasUser = Boolean(persistedSession?.user);

  if ((hasAccessToken || hasUser) && !hasRefreshToken) {
    return true;
  }

  const expiresAt = Number(persistedSession?.expires_at);
  if (expiresAt && expiresAt * 1000 <= Date.now()) {
    return true;
  }

  return false;
};

const createSanitizedAuthStorage = (storage) => ({
  async getItem(key) {
    if (!storage?.getItem) return null;
    const value = await storage.getItem(key);

    if (shouldDiscardPersistedAuthValue(value)) {
      try {
        await storage.removeItem?.(key);
      } catch (_error) {
        // Ignore storage cleanup failures and return signed out.
      }
      return null;
    }

    return value;
  },
  async setItem(key, value) {
    if (!storage?.setItem) return;
    await storage.setItem(key, value);
  },
  async removeItem(key) {
    if (!storage?.removeItem) return;
    await storage.removeItem(key);
  },
});

const createSupabaseConfigError = () => new Error(missingSupabaseConfigMessage);

const createFallbackQueryBuilder = (resultFactory = () => ({
  data: null,
  error: createSupabaseConfigError(),
})) => {
  let proxy;

  const execute = () => Promise.resolve(resultFactory());

  const target = {
    then(onFulfilled, onRejected) {
      return execute().then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return execute().catch(onRejected);
    },
    finally(onFinally) {
      return execute().finally(onFinally);
    },
  };

  proxy = new Proxy(target, {
    get(currentTarget, property) {
      if (property in currentTarget) {
        return currentTarget[property];
      }

      return (..._args) => proxy;
    },
  });

  return proxy;
};

const createFallbackChannel = () => ({
  on() {
    return this;
  },
  subscribe() {
    return this;
  },
  unsubscribe() {
    return undefined;
  },
});

const createFallbackStorageBucket = () => ({
  upload: async () => ({ data: null, error: createSupabaseConfigError() }),
  download: async () => ({ data: null, error: createSupabaseConfigError() }),
  remove: async () => ({ data: null, error: createSupabaseConfigError() }),
  list: async () => ({ data: [], error: createSupabaseConfigError() }),
  getPublicUrl: () => ({
    data: { publicUrl: '' },
    error: createSupabaseConfigError(),
  }),
});

const createFallbackSupabaseClient = () => ({
  auth: {
    signInWithPassword: async () => ({ data: { user: null, session: null }, error: createSupabaseConfigError() }),
    signInWithOAuth: async () => ({ data: { url: null, provider: null }, error: createSupabaseConfigError() }),
    signUp: async () => ({ data: { user: null, session: null }, error: createSupabaseConfigError() }),
    signOut: async () => ({ error: createSupabaseConfigError() }),
    getSession: async () => ({ data: { session: null }, error: createSupabaseConfigError() }),
    refreshSession: async () => ({ data: { session: null }, error: createSupabaseConfigError() }),
    setSession: async () => ({ data: { user: null, session: null }, error: createSupabaseConfigError() }),
    exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: createSupabaseConfigError() }),
    resetPasswordForEmail: async () => ({ data: null, error: createSupabaseConfigError() }),
    updateUser: async () => ({ data: { user: null }, error: createSupabaseConfigError() }),
    verifyOtp: async () => ({ data: { user: null, session: null }, error: createSupabaseConfigError() }),
    resend: async () => ({ data: null, error: createSupabaseConfigError() }),
    getUser: async () => ({ data: { user: null }, error: createSupabaseConfigError() }),
    onAuthStateChange: () => ({
      data: {
        subscription: {
          unsubscribe() {
            return undefined;
          },
        },
      },
    }),
    startAutoRefresh() {
      return undefined;
    },
    stopAutoRefresh() {
      return undefined;
    },
  },
  functions: {
    invoke: async () => ({ data: null, error: createSupabaseConfigError() }),
  },
  storage: {
    from() {
      return createFallbackStorageBucket();
    },
  },
  channel() {
    return createFallbackChannel();
  },
  removeChannel() {
    return undefined;
  },
  from() {
    return createFallbackQueryBuilder();
  },
});

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storage: createSanitizedAuthStorage(AsyncStorage),
        // Recovery emails use the PKCE authorization-code flow. Persisting
        // the verifier lets the native app exchange the email `code` after
        // the deep link opens the reset screen.
        // Keep one flow for web and native. The native WebCrypto compatibility
        // layer above supplies secure SHA-256 challenges through expo-crypto.
        // Mixing PKCE and implicit between requests makes recovery links
        // intermittently unusable.
        flowType: 'pkce',
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : createFallbackSupabaseClient();

const parseStructuredErrorMessage = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';

  const normalized = value.trim();

  if (normalized.toLowerCase().includes('invalid jwt')) {
    return 'Invalid JWT';
  }

  if (!(normalized.startsWith('{') || normalized.startsWith('['))) {
    return '';
  }

  try {
    const payload = JSON.parse(normalized);
    return (
      (typeof payload?.message === 'string' && payload.message.trim())
      || (typeof payload?.error === 'string' && payload.error.trim())
      || ''
    );
  } catch (_error) {
    return '';
  }
};

const getFunctionErrorMessage = async (error) => {
  if (!error) return '';

  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    try {
      const payload = await response.clone().json();
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
      }
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
      }
      if (typeof payload?.code === 'string' && payload.code.trim()) {
        return payload.code.trim();
      }
    } catch (_jsonError) {
      // Fall through to plain text parsing.
    }

    try {
      const text = await response.clone().text();
      const parsedTextMessage = parseStructuredErrorMessage(text);
      if (parsedTextMessage) {
        return parsedTextMessage;
      }
      if (text?.trim()) {
        return text.trim();
      }
    } catch (_textError) {
      // Ignore and use the fallback message.
    }
  }

  const parsedMessage = parseStructuredErrorMessage(error?.message);
  if (parsedMessage) {
    return parsedMessage;
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return '';
};

const getAuthErrorMessage = (error) => (
  String(
    error?.message
    || error?.error_description
    || error?.description
    || ''
  ).trim().toLowerCase()
);

const isInvalidRefreshTokenError = (error) => {
  const normalized = getAuthErrorMessage(error);
  return (
    normalized.includes('invalid refresh token')
    || normalized.includes('refresh token not found')
    || normalized.includes('invalid grant')
  );
};

const getAuthStorage = () => AsyncStorage;

const getPersistedAuthStorageKey = () => {
  if (!supabaseUrl) return '';

  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : '';
  } catch (_error) {
    return '';
  }
};

const getPersistedAuthStorageKeyPrefix = () => {
  if (!supabaseUrl) return '';

  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    return projectRef ? `sb-${projectRef}-auth-token` : '';
  } catch (_error) {
    return '';
  }
};

const removePersistedAuthKeys = async () => {
  const storage = getAuthStorage();
  const exactKey = getPersistedAuthStorageKey();
  const keyPrefix = getPersistedAuthStorageKeyPrefix();

  if (!storage?.removeItem) return;

  if (exactKey) {
    try {
      await storage.removeItem(exactKey);
    } catch (_error) {
      // Ignore cleanup errors and continue.
    }
  }

  if (!storage?.getAllKeys || !keyPrefix) return;

  try {
    const allKeys = await storage.getAllKeys();
    const matchingKeys = (allKeys || []).filter((key) => String(key || '').startsWith(keyPrefix));
    if (!matchingKeys.length) return;
    await Promise.all(matchingKeys.map((key) => storage.removeItem(key)));
  } catch (_error) {
    // Ignore cleanup errors and continue.
  }
};

const sanitizePersistedAuthSession = async () => {
  const storage = getAuthStorage();
  const storageKey = getPersistedAuthStorageKey();

  if (!storage?.getItem || !storage?.removeItem || !storageKey) return;

  try {
    const rawValue = await storage.getItem(storageKey);
    if (!rawValue) return;

    let parsedValue;
    try {
      parsedValue = JSON.parse(rawValue);
    } catch (_parseError) {
      await removePersistedAuthKeys();
      return;
    }

    const persistedSession = extractPersistedSession(parsedValue);
    const hasAccessToken = Boolean(persistedSession?.access_token);
    const hasRefreshToken = Boolean(persistedSession?.refresh_token);
    const hasUser = Boolean(persistedSession?.user);

    const expiresAt = Number(persistedSession?.expires_at);
    if (
      ((hasAccessToken || hasUser) && !hasRefreshToken)
      || (expiresAt && expiresAt * 1000 <= Date.now())
    ) {
      await removePersistedAuthKeys();
    }
  } catch (_error) {
    // Ignore storage cleanup issues and continue without blocking the app.
  }
};

const getSessionSafely = async () => {
  await sanitizePersistedAuthSession();

  let sessionResult;
  try {
    sessionResult = await supabase.auth.getSession();
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearPersistedAuthSession();
      return {
        session: null,
        error: null,
      };
    }

    return {
      session: null,
      error: error || null,
    };
  }

  if (isInvalidRefreshTokenError(sessionResult?.error)) {
    await clearPersistedAuthSession();
    return {
      session: null,
      error: null,
    };
  }

  return {
    session: sessionResult?.data?.session || null,
    error: sessionResult?.error || null,
  };
};

const clearPersistedAuthSession = async () => {
  const storage = getAuthStorage();
  if (!storage?.removeItem) {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (_error) {
      // A broken refresh token should not block falling back to signed-out state.
    }
    return;
  }

  await removePersistedAuthKeys();

  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    if (!isInvalidRefreshTokenError(error)) {
      // Ignore cleanup errors and let the app proceed unauthenticated.
    }
  }
};

const isInvalidJwtFunctionError = async (error) => {
  const normalized = (await getFunctionErrorMessage(error)).toLowerCase();
  return normalized.includes('invalid jwt');
};

const tryRefreshAuthSession = async () => {
  const currentSessionResult = await getSessionSafely();
  const currentSession = currentSessionResult?.session || null;

  if (!currentSession?.refresh_token) {
    await clearPersistedAuthSession();
    return {
      session: null,
      error: null,
    };
  }

  let data = null;
  let error = null;
  try {
    const refreshResult = await supabase.auth.refreshSession({
      refresh_token: currentSession.refresh_token,
    });
    data = refreshResult?.data || null;
    error = refreshResult?.error || null;
  } catch (caughtError) {
    error = caughtError;
  }

  if (isInvalidRefreshTokenError(error)) {
    await clearPersistedAuthSession();
    return {
      session: null,
      error: null,
    };
  }

  return {
    session: data?.session || null,
    error,
  };
};

const withAccessToken = (options = {}, accessToken) => {
  if (!accessToken) return options;

  return {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  };
};

const getCurrentAccessToken = async () => {
  const sessionResult = await getSessionSafely();
  return sessionResult?.session?.access_token || '';
};

const shouldRefreshSession = (session) => {
  const expiresAt = Number(session?.expires_at);
  if (!expiresAt) return false;

  const expiresAtMs = expiresAt * 1000;
  const now = Date.now();
  const refreshThresholdMs = 60 * 1000;

  return expiresAtMs - now <= refreshThresholdMs;
};

export const ensureActiveSession = async () => {
  const sessionResult = await getSessionSafely();
  const session = sessionResult?.session || null;

  if (!session) {
    return {
      session: null,
      error: null,
    };
  }

  if (!shouldRefreshSession(session)) {
    return { session, error: null };
  }

  return await tryRefreshAuthSession();
};

export const invokeEdgeFunction = async (functionName, options = {}) => {
  const activeSessionResult = await ensureActiveSession();
  const initialAccessToken = activeSessionResult?.session?.access_token || await getCurrentAccessToken();
  let result = await supabase.functions.invoke(
    functionName,
    withAccessToken(options, initialAccessToken)
  );

  if (!result?.error || !(await isInvalidJwtFunctionError(result.error))) {
    return result;
  }

  const refreshResult = await tryRefreshAuthSession();
  if (!refreshResult?.session || refreshResult?.error) {
    return result;
  }

  result = await supabase.functions.invoke(
    functionName,
    withAccessToken(options, refreshResult.session.access_token)
  );
  return result;
};

if (!hasSupabaseConfig && typeof console !== 'undefined') {
  console.warn(missingSupabaseConfigMessage);
}

if (hasSupabaseConfig) {
  void sanitizePersistedAuthSession();
}
