import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useAuth } from '../providers/AuthProvider';
import { logAppEvent } from '../utils/appErrors';

export const useRoleRedirect = () => {
  const { user, profile, needsOnboarding, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    // Reconstruct the actual route path for cleaner comparison (e.g. "", "auth/access")
    const currentPath = segments.join('/');
    const isPasswordRecoveryRoute = currentPath === 'auth/reset-password';

    // Supabase creates a short-lived authenticated recovery session so the
    // user can call updateUser({ password }). It must not be treated as a
    // normal login and redirected to a role home before the password form is
    // submitted.
    if (isPasswordRecoveryRoute) return;

    // 1. Define explicitly which routes unauthenticated users are allowed to see
    const isPublicAuthRoute = 
      currentPath === '' || // app/index.jsx -> Landing
      currentPath.startsWith('auth/') || // access, forgot-password, reset-password, verify-email
      currentPath === 'patient/login' ||
      currentPath === 'patient/signup' ||
      currentPath === 'donor/login' ||
      currentPath === 'donor/signup';

    // 2. Guard unauthenticated users
    if (!user) {
      if (!isPublicAuthRoute) {
        logAppEvent('auth.redirect.decision', 'Unauthenticated user redirected to login.', {
          from: currentPath || '/',
          to: '/auth/access',
        });
        router.replace('/auth/access');
      }
      return;
    }

    // 3. Guard authenticated users
    if (user && profile) {
      const role = String(profile.role || '').trim().toLowerCase();
      const isRootRoute = currentPath === '';
      const isTryingToAccessPatientArea = currentPath.startsWith('patient/');
      const isTryingToAccessDonorArea = currentPath.startsWith('donor/');

      if (role === 'tentative') {
        if (needsOnboarding) {
          if (!isRootRoute) {
            logAppEvent('auth.redirect.decision', 'Tentative account redirected to onboarding.', {
              from: currentPath || '/',
              to: '/',
              role,
              needsOnboarding,
            });
            router.replace('/');
          }
          return;
        }

        if (isPublicAuthRoute || isRootRoute || isTryingToAccessPatientArea) {
          logAppEvent('auth.redirect.decision', 'Tentative account redirected to donor home.', {
            from: currentPath || '/',
            to: '/donor/home',
            role,
            needsOnboarding,
          });
          router.replace('/donor/home');
          return;
        }

        if (!isTryingToAccessDonorArea && currentPath !== 'profile') {
          logAppEvent('auth.redirect.decision', 'Tentative account protected route fallback redirected to donor home.', {
            from: currentPath || '/',
            to: '/donor/home',
            role,
            needsOnboarding,
          });
          router.replace('/donor/home');
        }
        return;
      }

      if (needsOnboarding) {
        if (!isRootRoute) {
          logAppEvent('auth.redirect.decision', 'Incomplete account redirected to onboarding.', {
            from: currentPath || '/',
            to: '/',
            role,
            needsOnboarding,
          });
          router.replace('/');
        }
        return;
      }

      // Rule A: If logged in, block access to public auth routes and auto-redirect to correct home
      if (isPublicAuthRoute) {
        if (role === 'patient') {
          logAppEvent('auth.redirect.decision', 'Authenticated patient redirected from public auth route.', {
            from: currentPath || '/',
            to: '/patient/home',
            role,
            needsOnboarding,
          });
          router.replace('/patient/home');
        } else if (role === 'donor') {
          logAppEvent('auth.redirect.decision', 'Authenticated donor redirected from public auth route.', {
            from: currentPath || '/',
            to: '/donor/home',
            role,
            needsOnboarding,
          });
          router.replace('/donor/home');
        }
        return;
      }

      // Rule B: Prevent cross-role access to protected spaces
      if (role === 'patient' && isTryingToAccessDonorArea) {
        logAppEvent('auth.redirect.decision', 'Patient was redirected away from donor route.', {
          from: currentPath || '/',
          to: '/patient/home',
          role,
        });
        router.replace('/patient/home');
      } else if (role === 'donor' && isTryingToAccessPatientArea) {
        logAppEvent('auth.redirect.decision', 'Donor was redirected away from patient route.', {
          from: currentPath || '/',
          to: '/donor/home',
          role,
        });
        router.replace('/donor/home');
      }
    }
  }, [user, profile, needsOnboarding, isLoading, segments, router]);
};
