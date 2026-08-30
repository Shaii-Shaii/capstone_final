import React from 'react';

const OPEN_STREET_MAP_PROBE_URL = 'https://tile.openstreetmap.org/0/0/0.png';
const MAP_PROBE_TIMEOUT_MS = 4500;
const AVAILABLE_CACHE_MS = 15 * 1000;
const UNAVAILABLE_CACHE_MS = 10 * 1000;

let cachedAvailability = null;
let cachedAvailabilityExpiresAt = 0;
let activeProbePromise = null;

const requestOpenStreetMapAvailability = async ({ force = false } = {}) => {
  const now = Date.now();
  if (activeProbePromise) return activeProbePromise;

  if (!force && cachedAvailability !== null && now < cachedAvailabilityExpiresAt) {
    return cachedAvailability;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAP_PROBE_TIMEOUT_MS);

  const probePromise = fetch(OPEN_STREET_MAP_PROBE_URL, {
    method: 'GET',
    headers: { Accept: 'image/png' },
    cache: 'no-store',
    signal: controller.signal,
  })
    .then((response) => response.ok)
    .catch(() => false)
    .then((isAvailable) => {
      cachedAvailability = isAvailable;
      cachedAvailabilityExpiresAt = Date.now()
        + (isAvailable ? AVAILABLE_CACHE_MS : UNAVAILABLE_CACHE_MS);
      return isAvailable;
    })
    .finally(() => {
      clearTimeout(timeout);
      if (activeProbePromise === probePromise) activeProbePromise = null;
    });

  activeProbePromise = probePromise;
  return probePromise;
};

export const useOpenStreetMapAvailability = ({ enabled = true } = {}) => {
  const [status, setStatus] = React.useState(enabled ? 'checking' : 'disabled');
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const checkAvailability = React.useCallback(async ({ force = false } = {}) => {
    if (!enabled) {
      setStatus('disabled');
      return false;
    }

    if (isMountedRef.current) setStatus('checking');
    const isAvailable = await requestOpenStreetMapAvailability({ force });
    if (isMountedRef.current) setStatus(isAvailable ? 'available' : 'unavailable');
    return isAvailable;
  }, [enabled]);

  React.useEffect(() => {
    let isMounted = true;

    if (!enabled) {
      setStatus('disabled');
      return () => {
        isMounted = false;
      };
    }

    setStatus('checking');
    requestOpenStreetMapAvailability().then((isAvailable) => {
      if (isMounted) setStatus(isAvailable ? 'available' : 'unavailable');
    });

    return () => {
      isMounted = false;
    };
  }, [enabled]);

  const markUnavailable = React.useCallback(() => {
    cachedAvailability = false;
    cachedAvailabilityExpiresAt = Date.now() + UNAVAILABLE_CACHE_MS;
    if (isMountedRef.current) setStatus('unavailable');
  }, []);

  return {
    status,
    isAvailable: status === 'available',
    isChecking: status === 'checking',
    retry: () => checkAvailability({ force: true }),
    markUnavailable,
  };
};
