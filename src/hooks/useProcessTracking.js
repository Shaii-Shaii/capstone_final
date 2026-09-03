import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../api/supabase/client';
import { getProcessTracking } from '../features/processTracking.service';
import { resolveDatabaseUserId } from '../features/profile/api/profile.api';

const PROCESS_TRACKING_CACHE_TTL_MS = 30 * 1000;
const processTrackingCache = new Map();
const processTrackingInflightRequests = new Map();

const getProcessTrackingCacheKey = ({ role, userId }) => (
  `${role || 'unknown'}:${userId || 'anonymous'}`
);

const isProcessTrackingCacheFresh = (cacheEntry) => (
  Boolean(cacheEntry?.fetchedAt && Date.now() - cacheEntry.fetchedAt < PROCESS_TRACKING_CACHE_TTL_MS)
);

export const useProcessTracking = ({
  role,
  userId,
  databaseUserId: preferredDatabaseUserId = null,
  enabled = true,
}) => {
  const [tracker, setTracker] = useState(null);
  const [trackingError, setTrackingError] = useState(null);
  const [isLoadingTracking, setIsLoadingTracking] = useState(false);
  const [isRefreshingTracking, setIsRefreshingTracking] = useState(false);
  const [databaseUserId, setDatabaseUserId] = useState(preferredDatabaseUserId || null);
  const cacheKey = getProcessTrackingCacheKey({ role, userId });

  useEffect(() => {
    let isMounted = true;

    const syncDatabaseUserId = async () => {
      if (!enabled || !userId) {
        if (isMounted) setDatabaseUserId(null);
        return;
      }

      if (preferredDatabaseUserId) {
        if (isMounted) setDatabaseUserId(preferredDatabaseUserId);
        return;
      }

      const result = await resolveDatabaseUserId(userId, { ensure: false });
      if (isMounted) {
        setDatabaseUserId(result.data || null);
      }
    };

    syncDatabaseUserId();

    return () => {
      isMounted = false;
    };
  }, [enabled, preferredDatabaseUserId, userId]);

  const applyTrackingResult = useCallback((result) => {
    setTracker(result?.tracker || null);
    setTrackingError(result?.error || null);
  }, []);

  const loadTracking = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!enabled) return { success: true, tracker: null, error: null };
    if (!userId || !role) return { success: false, error: 'Session is not ready.' };

    const cached = processTrackingCache.get(cacheKey);
    if (!force && isProcessTrackingCacheFresh(cached)) {
      applyTrackingResult(cached.result);
      return {
        success: !cached.result?.error,
        tracker: cached.result?.tracker || null,
        error: cached.result?.error || null,
      };
    }

    // Realtime events often arrive in a burst across related tables. Even a
    // forced refresh should join the active request instead of starting the
    // same tracking batch several times in parallel.
    if (processTrackingInflightRequests.has(cacheKey)) {
      const inflightResult = await processTrackingInflightRequests.get(cacheKey);
      applyTrackingResult(inflightResult);
      return {
        success: !inflightResult?.error,
        tracker: inflightResult?.tracker || null,
        error: inflightResult?.error || null,
      };
    }

    if (silent) {
      setIsRefreshingTracking(true);
    } else {
      setIsLoadingTracking(true);
    }

    const request = getProcessTracking({ role, userId })
      .then((result) => {
        const normalizedResult = {
          tracker: result?.tracker || null,
          error: result?.error || null,
        };

        processTrackingCache.set(cacheKey, {
          fetchedAt: Date.now(),
          result: normalizedResult,
        });

        return normalizedResult;
      })
      .finally(() => {
        processTrackingInflightRequests.delete(cacheKey);
      });

    processTrackingInflightRequests.set(cacheKey, request);
    const result = await request;

    if (silent) {
      setIsRefreshingTracking(false);
    } else {
      setIsLoadingTracking(false);
    }

    applyTrackingResult(result);

    return {
      success: !result.error,
      tracker: result.tracker,
      error: result.error,
    };
  }, [applyTrackingResult, cacheKey, enabled, role, userId]);

  const refreshTracking = useCallback(async () => (
    await loadTracking({ silent: true, force: true })
  ), [loadTracking]);

  useEffect(() => {
    if (!enabled || !userId || !role) return;
    const cached = processTrackingCache.get(cacheKey);
    if (cached?.result) {
      applyTrackingResult(cached.result);
    }
    if (!isProcessTrackingCacheFresh(cached)) {
      loadTracking({ silent: Boolean(cached?.result) });
    }
  }, [applyTrackingResult, cacheKey, enabled, loadTracking, role, userId]);

  useEffect(() => {
    if (!enabled || !userId || !role) return undefined;
    if (role === 'donor' && !databaseUserId) return undefined;

    const watch = tracker?.watch || {};
    const channelName = [
      'process-tracker',
      role,
      role === 'donor' ? databaseUserId : userId,
      watch.submissionId || watch.patientId || 'root',
      watch.submissionDetailId || watch.wigId || watch.reqId || 'detail',
    ].join('-');

    let channel = supabase.channel(channelName);

    if (role === 'donor') {
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Hair_Submissions',
        filter: `User_ID=eq.${databaseUserId}`,
      }, () => {
        refreshTracking();
      });

      if (watch.submissionId) {
        channel = channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'Hair_Submission_Logistics',
          filter: `Submission_ID=eq.${watch.submissionId}`,
        }, () => {
          refreshTracking();
        });

        channel = channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'Hair_Submission_Details',
          filter: `Submission_ID=eq.${watch.submissionId}`,
        }, () => {
          refreshTracking();
        });
      }
    }

    if (role === 'patient') {
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'Patients',
        ...(databaseUserId ? { filter: `User_ID=eq.${databaseUserId}` } : {}),
      }, () => {
        refreshTracking();
      });

      if (watch.patientId) {
        channel = channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'Wig_Requests',
          filter: `Patient_ID=eq.${watch.patientId}`,
        }, () => {
          refreshTracking();
        });
      }

      if (watch.reqId) {
        channel = channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'Wig_Request_Specifications',
          filter: `Req_ID=eq.${watch.reqId}`,
        }, () => {
          refreshTracking();
        });
      }

      if (watch.wigId) {
        channel = channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'Wigs',
          filter: `Wig_ID=eq.${watch.wigId}`,
        }, () => {
          refreshTracking();
        });
      }

      if (watch.patientId) {
        channel = channel.on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'Wig_Allocations',
          filter: `Patient_ID=eq.${watch.patientId}`,
        }, () => {
          refreshTracking();
        });
      }
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [databaseUserId, enabled, refreshTracking, role, tracker?.watch, userId]);

  return {
    tracker,
    trackingError,
    isLoadingTracking,
    isRefreshingTracking,
    refreshTracking,
  };
};
