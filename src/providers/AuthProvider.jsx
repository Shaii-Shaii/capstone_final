import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import { getResolvedSystemTheme } from '../features/auth/services/auth.service';
import { emptyResolvedTheme, normalizeResolvedTheme } from '../design-system/theme';
import { withTimeout } from '../utils/asyncTimeout';

const THEME_LOAD_TIMEOUT_MS = 8000;

let resolvedThemeCache = null;
let resolvedThemeInflight = null;

const AuthContext = createContext({
  user: null,
  session: null,
  profile: null,
  patientProfile: null,
  staffProfile: null,
  hospitalProfile: null,
  databaseUserId: null,
  needsOnboarding: false,
  isLoading: true,
  sessionError: null,
  retrySession: () => undefined,
  refreshProfile: async () => null,
  resolvedTheme: emptyResolvedTheme,
  refreshResolvedTheme: async () => emptyResolvedTheme,
});

export const AuthProvider = ({ children }) => {
  const authState = useAuthSession();
  const [resolvedTheme, setResolvedTheme] = useState(resolvedThemeCache || emptyResolvedTheme);

  const refreshResolvedTheme = useCallback(async ({ force = false } = {}) => {
    if (!force && resolvedThemeCache) {
      setResolvedTheme(resolvedThemeCache);
      return resolvedThemeCache;
    }

    if (!force && resolvedThemeInflight) {
      const inflightTheme = await resolvedThemeInflight;
      setResolvedTheme(inflightTheme);
      return inflightTheme;
    }

    resolvedThemeInflight = withTimeout(
      getResolvedSystemTheme,
      {
        timeoutMs: THEME_LOAD_TIMEOUT_MS,
        message: 'Theme settings took too long to load.',
      },
    )
      .then((result) => {
        const nextTheme = result?.data ? normalizeResolvedTheme(result.data) : emptyResolvedTheme;
        resolvedThemeCache = nextTheme;
        return nextTheme;
      })
      .catch(() => {
        resolvedThemeCache = emptyResolvedTheme;
        return emptyResolvedTheme;
      })
      .finally(() => {
        resolvedThemeInflight = null;
      });

    const nextTheme = await resolvedThemeInflight;
    setResolvedTheme(nextTheme);
    return nextTheme;
  }, []);

  useEffect(() => {
    refreshResolvedTheme();
  }, [refreshResolvedTheme]);

  const contextValue = useMemo(() => ({
    ...authState,
    resolvedTheme,
    refreshResolvedTheme,
  }), [authState, refreshResolvedTheme, resolvedTheme]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
