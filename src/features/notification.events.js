const notificationListeners = new Set();

export const subscribeToNotificationChanges = (listener) => {
  if (typeof listener !== 'function') return () => {};

  notificationListeners.add(listener);
  return () => notificationListeners.delete(listener);
};

export const publishNotificationChange = (event = {}) => {
  notificationListeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // One screen should never prevent other notification surfaces updating.
    }
  });
};
