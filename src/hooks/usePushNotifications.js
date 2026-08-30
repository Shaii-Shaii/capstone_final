import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import {
  deactivateOtherPushNotificationTokensForDevice,
  deactivatePushNotificationToken,
  markNotificationsRead,
  upsertPushNotificationToken,
} from '../features/notification.api';
import { publishNotificationChange } from '../features/notification.events';

const INSTALLATION_ID_KEY = 'donivra.push.installation_id';
const PUSH_REGISTRATION_KEY = 'donivra.push.registration';
const VIEW_DETAILS_CATEGORY_ID = 'donivra_view_details';
const VIEW_DETAILS_ACTION_ID = 'view_full_details';
const REGISTRATION_RETRY_DELAYS_MS = [5000, 30000, 120000];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const getProjectId = () => (
  Constants?.expoConfig?.extra?.eas?.projectId
  || Constants?.easConfig?.projectId
  || ''
);

const createInstallationId = () => (
  `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
);

const getInstallationId = async () => {
  const existingId = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (existingId) return existingId;

  const nextId = createInstallationId();
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, nextId);
  return nextId;
};

const savePushRegistration = async ({ userId, expoPushToken, deviceId, role }) => {
  await AsyncStorage.setItem(PUSH_REGISTRATION_KEY, JSON.stringify({
    userId,
    expoPushToken,
    deviceId,
    role,
  }));
};

const loadPushRegistration = async () => {
  try {
    const value = await AsyncStorage.getItem(PUSH_REGISTRATION_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const ensureAndroidNotificationChannel = async () => {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('donivra-updates', {
    name: 'Donivra updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#7f1d1d',
    sound: 'default',
  });
};

const ensureNotificationCategory = async () => {
  await Notifications.setNotificationCategoryAsync(
    VIEW_DETAILS_CATEGORY_ID,
    [
      {
        identifier: VIEW_DETAILS_ACTION_ID,
        buttonTitle: 'View full details',
        options: {
          opensAppToForeground: true,
        },
      },
    ],
  );
};

const requestNotificationPermission = async () => {
  const currentPermissions = await Notifications.getPermissionsAsync();
  if (currentPermissions.granted || currentPermissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }

  const requestedPermissions = await Notifications.requestPermissionsAsync();
  return Boolean(
    requestedPermissions.granted
    || requestedPermissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
};

export const registerForPushNotifications = async ({ databaseUserId, role }) => {
  if (!databaseUserId || !['donor', 'patient'].includes(String(role || '').toLowerCase())) {
    return { data: null, error: null };
  }

  try {
    await ensureAndroidNotificationChannel();
    await ensureNotificationCategory();

    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) {
      return { data: null, error: new Error('Push notification permission was not granted.') };
    }

    const projectId = getProjectId();
    if (!projectId) {
      return { data: null, error: new Error('Expo project ID is not configured.') };
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenResult?.data || '';
    if (!expoPushToken) {
      return { data: null, error: new Error('Expo push token could not be created.') };
    }

    const deviceId = await getInstallationId();
    const cleanupResult = await deactivateOtherPushNotificationTokensForDevice({
      userId: databaseUserId,
      deviceId,
      expoPushToken,
    }).catch(() => ({ error: null }));
    const registrationResult = await upsertPushNotificationToken({
      userId: databaseUserId,
      expoPushToken,
      deviceId,
      platform: Platform.OS,
      role,
    });

    if (!registrationResult?.error) {
      await savePushRegistration({
        userId: databaseUserId,
        expoPushToken,
        deviceId,
        role,
      });
    }

    return {
      ...registrationResult,
      cleanupError: cleanupResult?.error || null,
      expoPushToken,
    };
  } catch (error) {
    return { data: null, error };
  }
};

export const unregisterCurrentPushNotificationToken = async () => {
  const registration = await loadPushRegistration();
  if (!registration?.userId || !registration?.expoPushToken) {
    return { data: null, error: null };
  }

  try {
    const result = await deactivatePushNotificationToken({
      userId: registration.userId,
      expoPushToken: registration.expoPushToken,
    });

    if (!result?.error) {
      await AsyncStorage.removeItem(PUSH_REGISTRATION_KEY);
    }
    return result;
  } catch (error) {
    return { data: null, error };
  }
};

export const usePushNotifications = ({ databaseUserId, role }) => {
  const router = useRouter();
  const registeredKeyRef = useRef('');
  const handledResponseIdRef = useRef('');
  const pendingRouteRef = useRef('');
  const normalizedRole = String(role || '').toLowerCase();
  const isNavigationReady = Boolean(
    databaseUserId && ['donor', 'patient'].includes(normalizedRole)
  );

  useEffect(() => {
    const registrationKey = `${databaseUserId || 'none'}:${normalizedRole}`;
    let cancelled = false;
    let retryTimer = null;

    if (!databaseUserId || !['donor', 'patient'].includes(normalizedRole)) {
      registeredKeyRef.current = '';
      return undefined;
    }

    if (registeredKeyRef.current === registrationKey) return undefined;

    const attemptRegistration = async (attempt = 0) => {
      const result = await registerForPushNotifications({ databaseUserId, role: normalizedRole });
      if (cancelled) return;

      if (!result?.error) {
        registeredKeyRef.current = registrationKey;
        return;
      }

      if (typeof console !== 'undefined') {
        console.warn('Push notifications are not available:', result.error.message || result.error);
      }

      const permissionDenied = String(result.error?.message || '').toLowerCase().includes('permission');
      const retryDelay = REGISTRATION_RETRY_DELAYS_MS[attempt];
      if (!permissionDenied && retryDelay) {
        retryTimer = setTimeout(() => attemptRegistration(attempt + 1), retryDelay);
      }
    };

    void attemptRegistration();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [databaseUserId, normalizedRole]);

  useEffect(() => {
    if (!databaseUserId || !['donor', 'patient'].includes(normalizedRole)) return undefined;
    let isRefreshingToken = false;

    const subscription = Notifications.addPushTokenListener(() => {
      if (isRefreshingToken) return;
      isRefreshingToken = true;
      registeredKeyRef.current = '';
      void registerForPushNotifications({ databaseUserId, role: normalizedRole })
        .then((result) => {
          if (!result?.error) {
            registeredKeyRef.current = `${databaseUserId}:${normalizedRole}`;
          }
        })
        .catch(() => {})
        .finally(() => {
          isRefreshingToken = false;
        });
    });

    return () => subscription.remove();
  }, [databaseUserId, normalizedRole]);

  useEffect(() => {
    if (!isNavigationReady || !pendingRouteRef.current) return;

    const targetRoute = pendingRouteRef.current;
    pendingRouteRef.current = '';
    if (targetRoute.startsWith(`/${normalizedRole}/`)) {
      router.navigate(targetRoute);
    }
  }, [isNavigationReady, normalizedRole, router]);

  useEffect(() => {
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      publishNotificationChange({
        source: 'push-received',
        databaseUserId,
        role: normalizedRole,
        notificationId: notification?.request?.content?.data?.notificationId || null,
        forceRefresh: true,
      });
    });

    const openNotification = (response) => {
      const responseId = String(response?.notification?.request?.identifier || '');
      if (responseId && handledResponseIdRef.current === responseId) return;

      const targetRoute = response?.notification?.request?.content?.data?.url;
      const targetRole = typeof targetRoute === 'string'
        ? targetRoute.match(/^\/(donor|patient)\//)?.[1] || ''
        : '';
      const isAllowedRoleRoute = Boolean(targetRole && (!normalizedRole || targetRole === normalizedRole));
      if (isAllowedRoleRoute) {
        handledResponseIdRef.current = responseId;
        const rawNotificationId = response?.notification?.request?.content?.data?.notificationId;
        const notificationId = Number(rawNotificationId);
        const syncReadState = Number.isInteger(notificationId) && notificationId > 0
          ? markNotificationsRead([notificationId]).catch(() => null)
          : Promise.resolve(null);

        void syncReadState.finally(() => {
          publishNotificationChange({
            source: 'push-opened',
            databaseUserId,
            role: normalizedRole,
            notificationId: rawNotificationId || null,
            forceRefresh: true,
          });
        });
        if (isNavigationReady) {
          router.navigate(targetRoute);
        } else {
          pendingRouteRef.current = targetRoute;
        }
      }
    };

    // Register the category on every app start so Android and iOS can render
    // the action button even before a token refresh is needed.
    void ensureNotificationCategory().catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);

    // The listener alone can miss the response that launched a terminated app.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        openNotification(response);
        Notifications.clearLastNotificationResponse();
      })
      .catch(() => {});

    return () => {
      receivedSubscription.remove();
      subscription.remove();
    };
  }, [databaseUserId, isNavigationReady, normalizedRole, router]);
};
