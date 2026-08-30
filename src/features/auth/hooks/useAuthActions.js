import { useCallback, useState } from 'react';
import * as AuthService from '../services/auth.service';

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
      const result = await actionFunction(...args);
      if (result.error) {
        setError(result.error);
        return { success: false, ...result };
      }
      return { success: true, ...result };
    } catch (err) {
      setError(err.message || 'An unexpected error occurred');
      return { success: false, error: err.message, errorCode: err.code };
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
