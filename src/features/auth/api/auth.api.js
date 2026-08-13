import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ensureActiveSession, supabase } from '../../../api/supabase/client';

const APP_SCHEME = 'donivra';

try {
  WebBrowser.maybeCompleteAuthSession();
} catch (_error) {
  // The helper is web-only in practice; ignore unsupported platform noise.
}

/**
 * Low-level Supabase Auth calls
 * No business logic should reside here
 */

export const loginWithEmail = async ({ email, password }) => {
  return await supabase.auth.signInWithPassword({ email, password });
};

export const registerWithEmail = async ({ email, password, metadata }) => {
  return await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
    },
  });
};

const getGoogleRedirectUrl = () => Linking.createURL('/', { scheme: APP_SCHEME });

const extractAuthParamsFromUrl = (url) => {
  const params = {};

  if (!url || typeof url !== 'string') {
    return params;
  }

  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const hash = parsedUrl.hash?.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash;
    if (hash) {
      const hashParams = new URLSearchParams(hash);
      hashParams.forEach((value, key) => {
        params[key] = value;
      });
    }
  } catch (_error) {
    const queryLike = url.split('?')[1] || url.split('#')[1] || '';
    const safeParams = new URLSearchParams(queryLike);
    safeParams.forEach((value, key) => {
      params[key] = value;
    });
  }

  return params;
};

const createSessionFromOAuthRedirect = async (url) => {
  const params = extractAuthParamsFromUrl(url);

  if (params.error || params.error_code) {
    return {
      data: { session: null, user: null },
      error: new Error(params.error_description || params.error || params.error_code),
    };
  }

  if (params.code) {
    const result = await supabase.auth.exchangeCodeForSession(params.code);
    return {
      data: {
        session: result.data?.session || null,
        user: result.data?.user || result.data?.session?.user || null,
      },
      error: result.error || null,
    };
  }

  // Some Supabase email templates return a one-time token hash instead of a
  // PKCE code. Recovery links must be verified explicitly on mobile because
  // detectSessionInUrl is disabled for the native client.
  if (params.token_hash || (params.token && params.type === 'recovery')) {
    const result = await supabase.auth.verifyOtp({
      token_hash: params.token_hash || params.token,
      type: params.type || 'recovery',
    });
    return {
      data: {
        session: result.data?.session || null,
        user: result.data?.user || result.data?.session?.user || null,
      },
      error: result.error || null,
    };
  }

  if (params.access_token && params.refresh_token) {
    const result = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });

    return {
      data: {
        session: result.data?.session || null,
        user: result.data?.user || result.data?.session?.user || null,
      },
      error: result.error || null,
    };
  }

  const sessionResult = await ensureActiveSession();
  return {
    data: {
      session: sessionResult?.session || null,
      user: sessionResult?.session?.user || null,
    },
    error: sessionResult?.error || null,
  };
};

export const createSessionFromAuthUrl = async (url) => createSessionFromOAuthRedirect(url);

export const signInWithGoogle = async () => {
  const redirectTo = getGoogleRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    return { data: { session: null, user: null }, error, cancelled: false };
  }

  if (!data?.url) {
    return {
      data: { session: null, user: null },
      error: new Error('Google sign-in could not be started.'),
      cancelled: false,
    };
  }

  const authResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (authResult.type === 'cancel' || authResult.type === 'dismiss') {
    return { data: { session: null, user: null }, error: null, cancelled: true };
  }

  if (authResult.type !== 'success' || !authResult.url) {
    return {
      data: { session: null, user: null },
      error: new Error('Google sign-in did not return a valid session.'),
      cancelled: false,
    };
  }

  return {
    ...(await createSessionFromOAuthRedirect(authResult.url)),
    cancelled: false,
  };
};

export const logoutUser = async () => {
  try {
    const localResult = await supabase.auth.signOut({ scope: 'local' });
    if (!localResult?.error) {
      return localResult;
    }
  } catch (_error) {
    // Fall back to default sign-out below.
  }

  return await supabase.auth.signOut();
};

export const getCurrentSession = async () => {
  const result = await ensureActiveSession();
  return {
    data: {
      session: result?.session || null,
    },
    error: result?.error || null,
  };
};

export const sendPasswordResetEmail = async ({ email, redirectTo }) => {
  return await supabase.auth.resetPasswordForEmail(email, { redirectTo });
};

export const updateUserPassword = async ({ newPassword }) => {
  return await supabase.auth.updateUser({ password: newPassword });
};

const isRetriableOtpTypeError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('invalid')
    || message.includes('expired')
    || message.includes('token')
    || message.includes('otp')
  );
};

export const verifyEmailOtp = async ({ email, token }) => {
  const verifyTypes = ['signup', 'email'];
  let lastResult = { data: { user: null, session: null }, error: null };

  for (let index = 0; index < verifyTypes.length; index += 1) {
    const type = verifyTypes[index];
    const result = await supabase.auth.verifyOtp({ email, token, type });
    lastResult = result;

    if (!result?.error) {
      return result;
    }

    const isLastAttempt = index === verifyTypes.length - 1;
    if (isLastAttempt || !isRetriableOtpTypeError(result.error)) {
      return result;
    }
  }

  return lastResult;
};

export const resendSignupOtp = async ({ email }) => {
  return await supabase.auth.resend({
    type: 'signup',
    email,
  });
};

const uiSettingsSelect = `
  brand_name:Brand_Name,
  brand_tagline:Brand_Tagline,
  logo_icon:Logo_Icon,
  login_background_photo:Login_Background_Photo,
  primary_color:Primary_Color,
  secondary_color:Secondary_Color,
  tertiary_color:Tertiary_Color,
  background_color:Background_Color,
  primary_text_color:Primary_Text_Color,
  secondary_text_color:Secondary_Text_Color,
  tertiary_text_color:Tertiary_Text_Color,
  font_family:Font_Family,
  secondary_font_family:Secondary_Font_Family
`;

const themePresetSelect = `
  primary_color:Primary_Color,
  secondary_color:Secondary_Color,
  tertiary_color:Tertiary_Color,
  background_color:Background_Color,
  primary_text_color:Primary_Text_Color,
  secondary_text_color:Secondary_Text_Color,
  tertiary_text_color:Tertiary_Text_Color,
  font_family:Font_Family,
  secondary_font_family:Secondary_Font_Family
`;

export const fetchUiSettings = async () => {
  return await supabase
    .from('UI_Settings')
    .select(uiSettingsSelect)
    .limit(1)
    .maybeSingle();
};

export const fetchDefaultThemePreset = async () => {
  return await supabase
    .from('Theme_Presets')
    .select(themePresetSelect)
    .eq('Is_Default', true)
    .eq('Is_Deleted', false)
    .limit(1)
    .maybeSingle();
};
