import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { upsertPushNotificationToken } from '../features/notification.api';

const INSTALLATION_ID_KEY = 'donivra.push.installation_id';
const VIEW_DETAILS_CATEGORY_ID = 'donivra_view_details';
const VIEW_DETAILS_ACTION_ID = 'view_full_details';

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
    return await upsertPushNotificationToken({
      userId: databaseUserId,
      expoPushToken,
      deviceId,
      platform: Platform.OS,
      role,
    });
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

    if (!databaseUserId || !['donor', 'patient'].includes(normalizedRole)) {
      registeredKeyRef.current = '';
      return;
    }

    if (registeredKeyRef.current === registrationKey) return;
    registeredKeyRef.current = registrationKey;

    registerForPushNotifications({ databaseUserId, role: normalizedRole }).then((result) => {
      if (result?.error && typeof console !== 'undefined') {
        console.warn('Push notifications are not available:', result.error.message || result.error);
      }
    });
  }, [databaseUserId, normalizedRole]);

  useEffect(() => {
    if (!isNavigationReady || !pendingRouteRef.current) return;

    const targetRoute = pendingRouteRef.current;
    pendingRouteRef.current = '';
    router.navigate(targetRoute);
  }, [isNavigationReady, router]);

  useEffect(() => {
    const openNotification = (response) => {
      const responseId = String(response?.notification?.request?.identifier || '');
      if (responseId && handledResponseIdRef.current === responseId) return;

      const targetRoute = response?.notification?.request?.content?.data?.url;
      if (typeof targetRoute === 'string' && targetRoute.startsWith('/')) {
        handledResponseIdRef.current = responseId;
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
      subscription.remove();
    };
  }, [isNavigationReady, router]);
};
