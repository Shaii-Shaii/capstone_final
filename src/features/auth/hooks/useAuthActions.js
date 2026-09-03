import { useCallback, useState } from 'react';
import * as AuthService from '../services/auth.service';
import { isTimeoutError, REQUEST_TIMEOUT_CODE, withTimeout } from '../../../utils/asyncTimeout';

const AUTH_ACTION_TIMEOUT_MS = 18000;
const AUTH_TIMEOUT_MESSAGE = 'Donivra is temporarily undergoing maintenance. Your information is safe. Please try again in a few minutes.';

/**
 * Screen-facing hooks for auth flows
 * Manages loading states, errors, and triggers services
 */

export const useAuthActions = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAuthAction = async (actionFunction, ...args) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await withTimeout(
        () => actionFunction(...args),
        {
          timeoutMs: AUTH_ACTION_TIMEOUT_MS,
          message: AUTH_TIMEOUT_MESSAGE,
        },
      );
      if (result.error) {
        setError(result.error);
        return { success: false, ...result };
      }
      return { success: true, ...result };
    } catch (err) {
      const didTimeOut = isTimeoutError(err);
      const message = didTimeOut
        ? AUTH_TIMEOUT_MESSAGE
        : err.message || 'Something went wrong. Please try again.';
      setError(message);
      return {
        success: false,
        error: message,
        errorCode: didTimeOut ? REQUEST_TIMEOUT_CODE : err.code,
        isTimeout: didTimeOut,
      };
    }
    finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(
    (email, password, expectedRole) => handleAuthAction(AuthService.login, email, password, expectedRole),
    []
  );
  
  const register = useCallback(
    (email, password, additionalData) => handleAuthAction(AuthService.register, email, password, additionalData),
    []
  );

  const continueWithGoogle = useCallback(
    (options) => handleAuthAction(AuthService.continueWithGoogle, options),
    []
  );
  
  const logout = useCallback(() => handleAuthAction(AuthService.logout), []);
  
  const getCurrentSessionStatus = useCallback(
    () => handleAuthAction(AuthService.getCurrentSessionStatus),
    []
  );

  const recoverSessionFromAuthUrl = useCallback(
    (url) => handleAuthAction(AuthService.recoverSessionFromAuthUrl, url),
    []
  );

  const sendPasswordReset = useCallback(
    (email) => handleAuthAction(AuthService.sendPasswordReset, email),
    []
  );
  
  const updatePassword = useCallback(
    (payload) => handleAuthAction(AuthService.updatePassword, payload),
    []
  );

  return {
    isLoading,
    error,
    login,
    register,
    continueWithGoogle,
    logout,
    getCurrentSessionStatus,
    recoverSessionFromAuthUrl,
    sendPasswordReset,
    updatePassword,
    clearError: () => setError(null)
  };
};
