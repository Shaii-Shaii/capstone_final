import { useState, useEffect, useCallback } from 'react';
import { ensureActiveSession, supabase } from '../api/supabase/client';
import { getCurrentAccountBundle, needsPostLoginOnboarding } from '../features/profile/services/profile.service';
import { withTimeout } from '../utils/asyncTimeout';

const SESSION_CHECK_TIMEOUT_MS = 12000;
const ACCOUNT_LOAD_TIMEOUT_MS = 15000;
const SESSION_UNAVAILABLE_MESSAGE = 'Donivra is temporarily undergoing maintenance. Your information is safe. Please try again in a few minutes.';

const createSessionUnavailableError = () => ({
  code: 'SESSION_SERVICE_UNAVAILABLE',
  title: 'System maintenance',
  message: SESSION_UNAVAILABLE_MESSAGE,
});

export const useAuthSession = () => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [patientProfile, setPatientProfile] = useState(null);
  const [staffProfile, setStaffProfile] = useState(null);
  const [hospitalProfile, setHospitalProfile] = useState(null);
  const [databaseUserId, setDatabaseUserId] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const retrySession = useCallback(() => {
    setSessionError(null);
    setIsLoading(true);
    setLoadAttempt((current) => current + 1);
  }, []);

  const refreshProfile = useCallback(async (userId) => {
    const targetUserId = userId || user?.id;
    if (!targetUserId) return null;

    try {
      const accountBundle = await withTimeout(
        () => getCurrentAccountBundle(targetUserId),
        {
          timeoutMs: ACCOUNT_LOAD_TIMEOUT_MS,
          message: SESSION_UNAVAILABLE_MESSAGE,
        },
      );
      if (accountBundle?.error) {
        throw new Error(accountBundle.error);
      }

      const {
        profile: userProfile,
        patientProfile: nextPatientProfile,
        staffProfile: nextStaffProfile,
        hospitalProfile: nextHospitalProfile,
        databaseUserId: nextDatabaseUserId,
        onboardingCompleted,
      } = accountBundle;
      setProfile(userProfile);
      setPatientProfile(nextPatientProfile);
      setStaffProfile(nextStaffProfile);
      setHospitalProfile(nextHospitalProfile);
      setDatabaseUserId(nextDatabaseUserId);
      setNeedsOnboarding(needsPostLoginOnboarding({
        profile: userProfile,
        patientProfile: nextPatientProfile,
        staffProfile: nextStaffProfile,
        onboardingCompleted,
      }));
      setSessionError(null);
      return userProfile;
    } catch (_error) {
      setSessionError(createSessionUnavailableError());
      return null;
    }
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;
    let subscription = null;

    async function handleSessionData(newSession) {
      if (!newSession?.user) {
        if (mounted) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setPatientProfile(null);
          setStaffProfile(null);
          setHospitalProfile(null);
          setDatabaseUserId(null);
          setNeedsOnboarding(false);
          setSessionError(null);
          setIsLoading(false);
        }
        return;
      }

      if (mounted) {
        setSession(newSession);
        setUser(newSession.user);
      }
      
      try {
        const accountBundle = await withTimeout(
          () => getCurrentAccountBundle(newSession.user.id),
          {
            timeoutMs: ACCOUNT_LOAD_TIMEOUT_MS,
            message: SESSION_UNAVAILABLE_MESSAGE,
          },
        );
        if (accountBundle?.error) {
          throw new Error(accountBundle.error);
        }

        const {
          profile: userProfile,
          patientProfile: nextPatientProfile,
          staffProfile: nextStaffProfile,
          hospitalProfile: nextHospitalProfile,
          databaseUserId: nextDatabaseUserId,
          onboardingCompleted,
        } = accountBundle;
        if (mounted) {
          setProfile(userProfile);
          setPatientProfile(nextPatientProfile);
          setStaffProfile(nextStaffProfile);
          setHospitalProfile(nextHospitalProfile);
          setDatabaseUserId(nextDatabaseUserId);
          setNeedsOnboarding(needsPostLoginOnboarding({
            profile: userProfile,
            patientProfile: nextPatientProfile,
            staffProfile: nextStaffProfile,
            onboardingCompleted,
          }));
          setSessionError(null);
          setIsLoading(false);
        }
      } catch (_err) {
        if (mounted) {
          setProfile(null);
          setPatientProfile(null);
          setStaffProfile(null);
          setHospitalProfile(null);
          setDatabaseUserId(null);
          setNeedsOnboarding(false);
          setSessionError(createSessionUnavailableError());
          setIsLoading(false);
        }
      }
    }

    async function bootstrapAuthSession() {
      setIsLoading(true);

      let activeSession = null;
      let sessionCheckFailed = false;
      try {
        const activeSessionResult = await withTimeout(
          ensureActiveSession,
          {
            timeoutMs: SESSION_CHECK_TIMEOUT_MS,
            message: SESSION_UNAVAILABLE_MESSAGE,
          },
        );
        if (activeSessionResult?.error) {
          throw activeSessionResult.error;
        }
        activeSession = activeSessionResult?.session || null;
      } catch (_error) {
        sessionCheckFailed = true;
        if (mounted) {
          setSessionError(createSessionUnavailableError());
          setIsLoading(false);
        }
      }

      if (!sessionCheckFailed && mounted) {
        await handleSessionData(activeSession);
      }

      if (!mounted) return;

      const authStateResult = supabase.auth.onAuthStateChange(
        (_event, newSession) => {
          handleSessionData(newSession);
        }
      );

      subscription = authStateResult?.data?.subscription || null;
    }

    bootstrapAuthSession();

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [loadAttempt]);

  return {
    user,
    session,
    profile,
    patientProfile,
    staffProfile,
    hospitalProfile,
    databaseUserId,
    needsOnboarding,
    isLoading,
    sessionError,
    retrySession,
    refreshProfile,
  };
};
