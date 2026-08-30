import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../api/supabase/client';
import {
  loadNotificationSummary,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../features/notification.service';
import { resolveDatabaseUserId } from '../features/profile/api/profile.api';
import {
  publishNotificationChange,
  subscribeToNotificationChanges,
} from '../features/notification.events';

const NOTIFICATION_CACHE_TTL_MS = 30 * 1000;
const notificationCache = new Map();
const notificationInflightRequests = new Map();

const getNotificationCacheKey = ({ role, userId, mode }) => (
  `${role || 'unknown'}:${userId || 'anonymous'}:${mode || 'badge'}`
);

const isCacheFresh = (cacheEntry) => (
  Boolean(cacheEntry?.fetchedAt && Date.now() - cacheEntry.fetchedAt < NOTIFICATION_CACHE_TTL_MS)
);

const updateUserNotificationCaches = ({ role, userId, result }) => {
  const cachePrefix = `${role || 'unknown'}:${userId || 'anonymous'}:`;
  notificationCache.forEach((entry, key) => {
    if (!key.startsWith(cachePrefix)) return;
    notificationCache.set(key, {
      fetchedAt: Date.now(),
      result: {
        ...entry.result,
        ...result,
      },
    });
  });
};

const invalidateUserNotificationCaches = ({ role, userId }) => {
  const cachePrefix = `${role || 'unknown'}:${userId || 'anonymous'}:`;
  notificationCache.forEach((entry, key) => {
    if (!key.startsWith(cachePrefix)) return;
    notificationCache.set(key, { ...entry, fetchedAt: 0 });
  });
};

export const useNotifications = ({
  role,
  userId,
  userEmail = '',
  databaseUserId: preferredDatabaseUserId = null,
  mode = 'badge',
  liveUpdates = false,
  refreshOnMount = false,
}) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isRefreshingNotifications, setIsRefreshingNotifications] = useState(false);
  const [notificationError, setNotificationError] = useState(null);
  const [databaseUserId, setDatabaseUserId] = useState(preferredDatabaseUserId || null);
  const appStateRef = useRef(AppState.currentState);
  const cacheKey = getNotificationCacheKey({ role, userId, mode });
  const loader = mode === 'full' ? loadNotifications : loadNotificationSummary;

  const applyNotificationResult = useCallback((result) => {
    setNotifications(result?.notifications || []);
    setUnreadCount(result?.unreadCount || 0);
    setNotificationError(result?.error || null);
    setDatabaseUserId(result?.databaseUserId || preferredDatabaseUserId || null);
  }, [preferredDatabaseUserId]);

  const refreshNotifications = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!userId || !role) return;

    const cached = notificationCache.get(cacheKey);
    if (!force && isCacheFresh(cached)) {
      applyNotificationResult(cached.result);
      return cached.result;
    }

    if (!force && notificationInflightRequests.has(cacheKey)) {
      const inflightResult = await notificationInflightRequests.get(cacheKey);
      applyNotificationResult(inflightResult);
      return inflightResult;
    }

    if (silent) {
      setIsRefreshingNotifications(true);
    } else {
      setIsLoadingNotifications(true);
    }

    const request = loader({
      userId,
      userEmail,
      role,
      databaseUserId: preferredDatabaseUserId || databaseUserId || null,
    })
      .then((result) => {
        const normalizedResult = {
          notifications: result?.notifications || [],
          unreadCount: result?.unreadCount || 0,
          error: result?.error || null,
          databaseUserId: result?.databaseUserId || preferredDatabaseUserId || databaseUserId || null,
        };

        notificationCache.set(cacheKey, {
          fetchedAt: Date.now(),
          result: normalizedResult,
        });

        return normalizedResult;
      })
      .finally(() => {
        notificationInflightRequests.delete(cacheKey);
      });

    notificationInflightRequests.set(cacheKey, request);

    try {
      const result = await request;
      applyNotificationResult(result);
      return result;
    } catch (error) {
      const fallbackResult = cached?.result || {
        notifications: [],
        unreadCount: 0,
        databaseUserId: preferredDatabaseUserId || databaseUserId || null,
      };
      const errorResult = {
        ...fallbackResult,
        error: error?.message || 'Unable to refresh notifications right now.',
      };
      applyNotificationResult(errorResult);
      return errorResult;
    } finally {
      if (silent) {
        setIsRefreshingNotifications(false);
      } else {
        setIsLoadingNotifications(false);
      }
    }
  }, [applyNotificationResult, cacheKey, databaseUserId, loader, preferredDatabaseUserId, role, userEmail, userId]);

  useEffect(() => {
    if (!userId || !role) {
      setNotifications([]);
      setUnreadCount(0);
      setNotificationError(null);
      setDatabaseUserId(preferredDatabaseUserId || null);
      return;
    }

    const cached = notificationCache.get(cacheKey);
    if (cached?.result) {
      applyNotificationResult(cached.result);
    }

    if (refreshOnMount || !isCacheFresh(cached)) {
      refreshNotifications({ silent: Boolean(cached?.result), force: refreshOnMount });
    }
  }, [applyNotificationResult, cacheKey, preferredDatabaseUserId, refreshNotifications, refreshOnMount, role, userId]);

  const readNotification = async (notificationId) => {
    const result = await markNotificationRead({ userId, role, notificationId });
    const normalizedResult = {
      notifications: result.notifications || [],
      unreadCount: result.unreadCount || 0,
      error: null,
      databaseUserId,
    };
    notificationCache.set(cacheKey, {
      fetchedAt: Date.now(),
      result: normalizedResult,
    });
    updateUserNotificationCaches({ role, userId, result: normalizedResult });
    applyNotificationResult(normalizedResult);
    publishNotificationChange({
      source: 'read-state',
      role,
      userId,
      databaseUserId,
      result: normalizedResult,
    });
  };

  const readAllNotifications = async () => {
    const result = await markAllNotificationsRead({ userId, role });
    const normalizedResult = {
      notifications: result.notifications || [],
      unreadCount: result.unreadCount || 0,
      error: null,
      databaseUserId,
    };
    notificationCache.set(cacheKey, {
      fetchedAt: Date.now(),
      result: normalizedResult,
    });
    updateUserNotificationCaches({ role, userId, result: normalizedResult });
    applyNotificationResult(normalizedResult);
    publishNotificationChange({
      source: 'read-state',
      role,
      userId,
      databaseUserId,
      result: normalizedResult,
    });
  };

  useEffect(() => {
    if (!userId || !role) return undefined;

    return subscribeToNotificationChanges((event) => {
      if (event?.role && event.role !== role) return;
      if (event?.userId && event.userId !== userId) return;
      if (event?.databaseUserId && databaseUserId && Number(event.databaseUserId) !== Number(databaseUserId)) return;

      if (event?.result) {
        applyNotificationResult(event.result);
        return;
      }

      invalidateUserNotificationCaches({ role, userId });
      void refreshNotifications({ silent: true, force: true });
    });
  }, [applyNotificationResult, databaseUserId, refreshNotifications, role, userId]);

  useEffect(() => {
    if (!userId || !role) return undefined;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasInactive = appStateRef.current === 'background' || appStateRef.current === 'inactive';
      appStateRef.current = nextState;
      if (wasInactive && nextState === 'active') {
        invalidateUserNotificationCaches({ role, userId });
        void refreshNotifications({ silent: true, force: true });
      }
    });

    return () => subscription.remove();
  }, [refreshNotifications, role, userId]);

  useEffect(() => {
    if (!userId || !role) return;
    void Notifications.setBadgeCountAsync(Math.max(0, Number(unreadCount) || 0)).catch(() => {});
  }, [role, unreadCount, userId]);

  useEffect(() => {
    let isMounted = true;

    if (!preferredDatabaseUserId && userId) {
      resolveDatabaseUserId(userId, { ensure: false }).then((result) => {
        if (isMounted) {
          setDatabaseUserId(result.data || null);
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [preferredDatabaseUserId, userId]);

  useEffect(() => {
    if (!liveUpdates || !userId || !role || !databaseUserId) return undefined;

    const channel = supabase.channel(`notifications-${mode}-${role}-${databaseUserId}`);
    channel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'Notification',
      filter: `User_ID=eq.${databaseUserId}`,
    }, () => {
      refreshNotifications({ silent: true, force: true });
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [databaseUserId, liveUpdates, mode, refreshNotifications, role, userId]);

  return {
    notifications,
    unreadCount,
    isLoadingNotifications,
    isRefreshingNotifications,
    notificationError,
    refreshNotifications,
    readNotification,
    readAllNotifications,
  };
};
