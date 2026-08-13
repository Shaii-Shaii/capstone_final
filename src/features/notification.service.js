import AsyncStorage from '@react-native-async-storage/async-storage';
import { invokeEdgeFunction } from '../api/supabase/client';
import * as NotificationAPI from './notification.api';
import { notificationStoragePrefix, notificationTypes } from './notification.constants';
import {
  createDonationCertificate,
  fetchDonationCertificateBySubmissionId,
  fetchHairBundleTrackingHistory,
  fetchDonorRecommendationsBySubmissionId,
  fetchHairSubmissionLogisticsBySubmissionId,
  fetchHairSubmissionsByUserId,
  hasDonationFlowProgress,
  isHairCheckOnlySubmission,
} from './hairSubmission.api';
import { fetchRegisteredDonationDrivesByUserId } from './donorHome.api';
import {
  fetchLatestWigAllocationByPatientDetailsId,
  fetchLatestWigRequestByPatientDetailsId,
} from './wigRequest.api';
import {
  fetchPatientDetailsByUserId,
  fetchSystemUserByAuthUserId,
  resolveDatabaseUserId,
} from './profile/api/profile.api';
import { writeAuditLog } from '../utils/appErrors';

const buildStorageKey = ({ userId, role }) => `${notificationStoragePrefix}.${role}.${userId}`;
const DONOR_REMINDER_EMAIL_FUNCTION = 'send-donor-hair-analysis-reminder';
const PUSH_NOTIFICATION_FUNCTION = 'send-push-notification';
const DRIVE_REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const reminderEmailAttemptCache = new Map();

const formatDateTime = (value) => {
  if (!value) return new Date().toISOString();

  try {
    return new Date(value).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const formatReadableDate = (value) => {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const toLocalDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getNotificationRouteFromType = (notification) => {
  if (notification?.referenceType === 'route' && typeof notification?.referenceId === 'string') {
    return notification.referenceId;
  }

  if (notification?.referenceType === 'donation_drive' && notification?.referenceId) {
    return `/donor/drives/${notification.referenceId}`;
  }

  if (notification?.referenceType === 'ai_screening' && notification?.referenceId) {
    return `/donor/hair-check-details?screeningId=${encodeURIComponent(notification.referenceId)}`;
  }

  switch (notification?.type) {
    case notificationTypes.hairAnalysisReminder:
      return '/donor/donations';
    case notificationTypes.accountCreated:
      return null;
    case notificationTypes.driveUpdated:
    case notificationTypes.driveRsvpConfirmed:
    case notificationTypes.driveRsvpReminder:
      return notification?.referenceId ? `/donor/drives/${notification.referenceId}` : '/donor/home';
    case notificationTypes.wigAllocationUpdated:
    case notificationTypes.wigRequestUpdated:
      return '/patient/requests';
    case notificationTypes.submissionReceived:
    case notificationTypes.screeningCompleted:
    case notificationTypes.recommendationAvailable:
    case notificationTypes.logisticsUpdated:
    case notificationTypes.donationTrackingUpdated:
      return '/donor/status';
    case notificationTypes.certificateAvailable:
      return '/donor/achievements';
    default:
      return null;
  }
};

const hasScreeningForLocalDay = (submissions = [], localDateKey) => (
  submissions.some((submission) => (
    (submission?.ai_screenings || []).some((screening) => (
      screening?.created_at && toLocalDateKey(screening.created_at) === localDateKey
    ))
  ))
);

const formatDriveWindowLabel = (drive) => {
  if (!drive?.start_date) return 'Schedule to be announced';

  try {
    return new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(drive.start_date));
  } catch {
    return drive.start_date;
  }
};

const shouldIncludeDriveUpdate = (drive) => {
  const now = Date.now();
  const startsAt = drive?.start_date ? new Date(drive.start_date).getTime() : 0;
  const isRegistered = Boolean(drive?.registration?.registration_id);
  const hasUpcomingReminderWindow = startsAt && startsAt >= now && startsAt - now <= DRIVE_REMINDER_WINDOW_MS;

  return isRegistered && hasUpcomingReminderWindow;
};

const buildDriveNotification = (drive) => {
  const startsSoon = drive?.start_date
    ? (new Date(drive.start_date).getTime() - Date.now()) <= DRIVE_REMINDER_WINDOW_MS
    : false;

  if (drive?.registration?.registration_id && startsSoon) {
    return buildNotification({
      dedupeKey: `${notificationTypes.driveRsvpReminder}:${drive.donation_drive_id}`,
      type: notificationTypes.driveRsvpReminder,
      title: 'Drive reminder',
      message: `${drive.event_title || 'Donation drive'} starts ${formatDriveWindowLabel(drive)}.`,
      createdAt: drive.updated_at || drive.start_date || new Date().toISOString(),
      referenceType: 'donation_drive',
      referenceId: drive.donation_drive_id,
    });
  }

  return null;
};

const buildDriveRsvpNotification = (drive) => {
  const registration = drive?.registration;
  if (!registration?.registration_id) return null;

  const attendeeType = normalizeFlowStatusKey(registration.attendee_type);
  const isParticipatingDonor = ['donor', 'participant', 'participatingdonor'].includes(attendeeType);

  return buildNotification({
    dedupeKey: `${notificationTypes.driveRsvpConfirmed}:${registration.registration_id}`,
    type: notificationTypes.driveRsvpConfirmed,
    title: 'RSVP confirmed',
    message: isParticipatingDonor
      ? `You are registered to participate in ${drive.event_title || 'the donation event'}.`
      : `You are registered to attend ${drive.event_title || 'the event'}.`,
    createdAt: registration.registered_at || registration.updated_at || new Date().toISOString(),
    referenceType: 'donation_drive',
    referenceId: drive.donation_drive_id,
  });
};

const triggerHairAnalysisReminderEmail = async ({
  authUserId,
  databaseUserId,
  userEmail,
  localDateKey,
}) => {
  const cacheKey = `${databaseUserId || authUserId || 'anonymous'}:${localDateKey}`;
  if (reminderEmailAttemptCache.has(cacheKey)) {
    return reminderEmailAttemptCache.get(cacheKey);
  }

  const invokeResult = await invokeEdgeFunction(DONOR_REMINDER_EMAIL_FUNCTION, {
    body: {
      authUserId,
      databaseUserId,
      userEmail,
      localDate: localDateKey,
    },
  }).catch((error) => ({ data: null, error }));

  const normalizedResult = {
    sent: Boolean(invokeResult?.data?.sent),
    skipped: Boolean(invokeResult?.data?.skipped),
    reason: invokeResult?.data?.reason || '',
    error: invokeResult?.error || null,
  };

  if (normalizedResult.sent || normalizedResult.skipped) {
    reminderEmailAttemptCache.set(cacheKey, normalizedResult);
  }

  return normalizedResult;
};

const buildNotification = ({
  dedupeKey,
  type,
  title,
  message,
  createdAt,
  referenceType,
  referenceId,
  backendId = null,
  isRead = false,
}) => ({
  id: backendId || dedupeKey,
  backendId,
  dedupeKey,
  stableKey: [type || '', title || '', message || ''].join('::'),
  type,
  title,
  message,
  createdAt: formatDateTime(createdAt),
  referenceType: referenceType || null,
  referenceId: referenceId || null,
  isRead,
});

const createDonationCertificateNumber = (submission = null) => {
  const submissionPart = String(submission?.donation_reference || submission?.submission_id || Date.now())
    .replace(/[^a-z0-9]+/gi, '')
    .slice(-10)
    .toUpperCase();
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DON-CERT-${submissionPart || Date.now().toString(36).toUpperCase()}-${randomPart}`;
};

const normalizeCertificateIssuerId = (value = null) => {
  const issuerId = Number(value);
  return Number.isFinite(issuerId) && issuerId > 0 ? issuerId : null;
};

const normalizeFlowStatusKey = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[_\s-]+/g, '');

const textIncludesAny = (source = '', tokens = []) => {
  const normalized = String(source || '').toLowerCase();
  return tokens.some((token) => normalized.includes(token));
};

const isReceivedByOrganizationSignal = (item = null) => {
  const statusKey = normalizeFlowStatusKey(item?.status || '');
  return (
  ['received', 'receivedbycompany', 'receivedbyhairforhope', 'receivedbyorganization', 'organizationreceived'].includes(statusKey)
  || textIncludesAny(item?.title, ['received by hair for hope', 'received by organization', 'received by the organization', 'organization received'])
  || textIncludesAny(item?.description, ['received by hair for hope', 'received by organization', 'received by the organization', 'organization received'])
  );
};

const findOrganizationReceiptEvidence = ({ trackingEntries = [], logistics = null } = {}) => {
  const sortedEntries = (trackingEntries || [])
    .slice()
    .sort((left, right) => new Date(right?.updated_at || 0).getTime() - new Date(left?.updated_at || 0).getTime());
  const receivedEntry = sortedEntries.find((entry) => isReceivedByOrganizationSignal(entry));

  if (receivedEntry) {
    return {
      issuedBy: normalizeCertificateIssuerId(receivedEntry.changed_by),
      issuedAt: receivedEntry.updated_at || null,
    };
  }

  if (
    logistics?.received_at
    || isReceivedByOrganizationSignal({ status: logistics?.shipment_status })
  ) {
    return {
      issuedBy: normalizeCertificateIssuerId(logistics?.received_by),
      issuedAt: logistics?.received_at || logistics?.created_at || null,
    };
  }

  return null;
};

const ensureDonationCertificateForNotification = async ({
  submission,
  trackingEntries = [],
  logistics = null,
}) => {
  if (!submission?.submission_id || !submission?.user_id) return null;
  if (isHairCheckOnlySubmission(submission)) return null;

  const receiptEvidence = findOrganizationReceiptEvidence({ trackingEntries, logistics });
  if (!receiptEvidence) return null;

  const existingResult = await fetchDonationCertificateBySubmissionId(submission.submission_id);
  if (existingResult.data?.certificate_id) {
    return existingResult.data;
  }

  const certificateResult = await createDonationCertificate({
    user_id: submission.user_id,
    submission_id: submission.submission_id,
    certificate_number: createDonationCertificateNumber(submission),
    certificate_type: 'Certificate of Donation',
    issued_by: receiptEvidence.issuedBy || null,
    issued_at: receiptEvidence.issuedAt || new Date().toISOString(),
    remarks: 'Issued after the organization received the hair donation.',
  });

  return certificateResult.data || null;
};

const normalizeTextToken = (value = '') => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const getNotificationIdentityKey = (notification = {}) => {
  const referenceScopedTypes = new Set([
    notificationTypes.accountCreated,
    notificationTypes.submissionReceived,
    notificationTypes.screeningCompleted,
    notificationTypes.recommendationAvailable,
    notificationTypes.driveRsvpConfirmed,
    notificationTypes.wigRequestUpdated,
    notificationTypes.wigAllocationUpdated,
    notificationTypes.certificateAvailable,
  ]);
  const referenceType = normalizeTextToken(notification.referenceType || '');
  const referenceId = String(notification.referenceId || '').trim();

  // Notification_ID is the canonical identity. Local and derived copies can
  // have different text, but they must still merge into one backend record.
  const backendId = notification.backendId || notification.notificationId || null;
  if (backendId) {
    return `backend:${String(backendId)}`;
  }

  if (referenceScopedTypes.has(notification.type) && referenceType && referenceId) {
    return `reference:${notification.type}:${referenceType}:${referenceId}`;
  }

  if (notification.stableKey) {
    return `stable:${normalizeTextToken(notification.stableKey)}`;
  }

  if (notification.dedupeKey) {
    return `dedupe:${notification.dedupeKey}`;
  }

  const type = normalizeTextToken(notification.type || 'system_update');
  const fallbackReferenceType = referenceType || 'none';
  const fallbackReferenceId = referenceId
    || String(notification.submissionId || notification.aiScreeningId || 'none').trim();
  const createdAt = String(notification.createdAt || notification.updatedAt || notification.created_at || '').trim();
  const title = normalizeTextToken(notification.title || 'system update');
  const message = normalizeTextToken(notification.message || '');

  return `fallback:${type}:${fallbackReferenceType}:${fallbackReferenceId}:${createdAt}:${title}:${message}`;
};

const sortNotificationsByNewest = (notifications = []) => (
  [...notifications].sort((left, right) => (
    new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
  ))
);

const dedupeNotifications = (notifications = []) => {
  const merged = new Map();

  (Array.isArray(notifications) ? notifications : []).forEach((notification) => {
    if (!notification || (!notification.title && !notification.message)) {
      return;
    }

    const identityKey = getNotificationIdentityKey(notification);
    const existing = merged.get(identityKey);

    if (!existing) {
      merged.set(identityKey, {
        ...notification,
        identityKey,
      });
      return;
    }

    const existingTime = new Date(existing.createdAt || 0).getTime();
    const incomingTime = new Date(notification.createdAt || 0).getTime();
    const preferIncoming = incomingTime >= existingTime;

    merged.set(identityKey, {
      ...(preferIncoming ? existing : notification),
      ...(preferIncoming ? notification : existing),
      id: notification.backendId || existing.backendId || notification.id || existing.id || identityKey,
      backendId: notification.backendId || existing.backendId || null,
      dedupeKey: notification.dedupeKey || existing.dedupeKey || identityKey,
      stableKey: notification.stableKey || existing.stableKey || identityKey,
      identityKey,
      isRead: Boolean(existing.isRead || notification.isRead),
      createdAt: preferIncoming ? (notification.createdAt || existing.createdAt) : (existing.createdAt || notification.createdAt),
      referenceType: existing.referenceType === 'notification'
        ? (notification.referenceType || existing.referenceType || null)
        : (existing.referenceType || notification.referenceType || null),
      referenceId: existing.referenceType === 'notification'
        ? (notification.referenceId || existing.referenceId || null)
        : (existing.referenceId || notification.referenceId || null),
    });
  });

  return sortNotificationsByNewest(Array.from(merged.values())).slice(0, 40);
};

const loadLocalNotifications = async ({ userId, role }) => {
  const rawValue = await AsyncStorage.getItem(buildStorageKey({ userId, role }));
  if (!rawValue) return [];

  try {
    const parsed = JSON.parse(rawValue);
    return dedupeNotifications(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
};

const saveLocalNotifications = async ({ userId, role, notifications }) => {
  await AsyncStorage.setItem(
    buildStorageKey({ userId, role }),
    JSON.stringify(dedupeNotifications(notifications))
  );
};

const normalizeBackendNotification = (row) => {
  const createdAt = row?.updated_at || new Date().toISOString();
  const type = row?.type || 'system_update';
  const backendId = row?.notification_id || null;
  const dedupeKey = `${type}:${backendId || `${row?.title || ''}:${row?.message || ''}:${createdAt}`}`;

  return buildNotification({
    dedupeKey,
    type,
    title: row?.title || 'System update',
    message: row?.message || '',
    createdAt,
    referenceType: row?.reference_type || 'notification',
    referenceId: row?.reference_id || backendId,
    backendId,
    isRead: String(row?.status || '').toLowerCase() === 'read',
  });
};

const toBackendPayload = ({ databaseUserId, role, notification }) => ({
  user_id: databaseUserId,
  title: notification.title,
  message: notification.message,
  type: notification.type || role || 'system_update',
  status: notification.isRead ? 'Read' : 'Unread',
  reference_type: notification.referenceType || null,
  reference_id: notification.referenceId || null,
  updated_at: notification.createdAt || new Date().toISOString(),
});

const sendPushForBackendNotifications = async ({ notificationIds = [] } = {}) => {
  const ids = (notificationIds || []).filter(Boolean);
  if (!ids.length) return null;

  const result = await invokeEdgeFunction(PUSH_NOTIFICATION_FUNCTION, {
    body: {
      notificationIds: ids,
    },
  }).catch((error) => ({ data: null, error }));

  return result?.error || null;
};

const resolveNotificationBackendUserId = async (userId) => {
  const result = await resolveDatabaseUserId(userId, { ensure: false });
  return result.data || null;
};

const fetchBackendNotifications = async (databaseUserId) => {
  if (!databaseUserId) {
    return {
      notifications: [],
      error: null,
    };
  }

  const backendResult = await NotificationAPI.fetchNotificationsByUserId(databaseUserId)
    .catch(() => ({ data: [], error: null }));

  return {
    notifications: (backendResult.data || [])
      .map(normalizeBackendNotification)
      .filter((notification) => notification.title || notification.message),
    error: backendResult.error || null,
  };
};

const mergeNotifications = ({ localNotifications, backendNotifications, derivedNotifications }) => {
  return dedupeNotifications([
    ...(backendNotifications || []),
    ...(localNotifications || []),
    ...(derivedNotifications || []),
  ]);
};

const isRsvpOnlyTrackingEntry = (entry = null) => {
  const key = normalizeFlowStatusKey([
    entry?.status,
    entry?.title,
  ].filter(Boolean).join(' '));
  return key.includes('eventrsvp')
    || key.includes('rsvp')
    || key.includes('driveselected')
    || key.includes('donationdriveselected');
};

const isDonationLifecycleTrackingEntry = (entry = null) => Boolean(
  entry
  && !isRsvpOnlyTrackingEntry(entry)
  && (entry?.tracking_id || entry?.status || entry?.title)
);

const hasSubmittedDonationEvidence = ({ submission = null, trackingEntries = [] } = {}) => {
  if (!submission?.submission_id || isHairCheckOnlySubmission(submission)) return false;

  const submissionStatus = normalizeFlowStatusKey(submission?.status || '');
  const submittedStatuses = [
    'cut',
    'wiginproduction',
    'wigcreated',
  ];
  const hasSubmittedTracking = (trackingEntries || []).some((entry) => {
    const trackingKey = normalizeFlowStatusKey(entry?.status || entry?.title || '');
    return [
      'donationsubmitted',
      'readyforshipping',
      'waybillready',
      'cutandshipped',
      'sentbydonor',
      'shipped',
      'intransit',
      'received',
      'receivedbycompany',
      'receivedbyorganization',
    ].some((key) => trackingKey.includes(key));
  });

  return Boolean(
    submission?.cut_at
    || submission?.bundle_id
    || submittedStatuses.includes(submissionStatus)
    || hasSubmittedTracking
  );
};

const hasDonationWorkflowEvidence = ({ submission = null, logistics = null, trackingEntries = [] } = {}) => {
  if (!submission?.submission_id || isHairCheckOnlySubmission(submission)) return false;
  return Boolean(
    hasSubmittedDonationEvidence({ submission, trackingEntries })
    || logistics?.submission_logistics_id
    || (trackingEntries || []).some(isDonationLifecycleTrackingEntry)
  );
};

const filterInvalidDonorDonationNotifications = async ({ userId, notifications = [] }) => {
  if (!userId || !notifications.length) return notifications;

  const { data: submissions } = await fetchHairSubmissionsByUserId(userId, 60).catch(() => ({ data: [] }));
  const todayLocalDateKey = toLocalDateKey(new Date());
  const hasAnalysisToday = hasScreeningForLocalDay(submissions || [], todayLocalDateKey);
  const evidenceRows = await Promise.all((submissions || []).map(async (submission) => {
    if (!submission?.submission_id || isHairCheckOnlySubmission(submission)) {
      return { submission, logistics: null, trackingEntries: [] };
    }

    const [logisticsResult, trackingResult] = await Promise.all([
      fetchHairSubmissionLogisticsBySubmissionId(submission.submission_id),
      fetchHairBundleTrackingHistory({ submissionId: submission.submission_id, limit: 24 }),
    ]);
    return {
      submission,
      logistics: logisticsResult.data || null,
      trackingEntries: trackingResult.data || [],
    };
  }));
  const donationWorkflowSubmissionIds = new Set();
  const submittedDonationSubmissionIds = new Set();
  const receivedDonationSubmissionIds = new Set();

  evidenceRows.forEach(({ submission, logistics, trackingEntries }) => {
    const submissionId = String(submission?.submission_id || '');
    if (!submissionId) return;
    if (hasDonationWorkflowEvidence({ submission, logistics, trackingEntries })) {
      donationWorkflowSubmissionIds.add(submissionId);
    }
    if (hasSubmittedDonationEvidence({ submission, trackingEntries })) {
      submittedDonationSubmissionIds.add(submissionId);
    }
    if (findOrganizationReceiptEvidence({ trackingEntries, logistics })) {
      receivedDonationSubmissionIds.add(submissionId);
    }
  });

  return notifications.filter((notification) => {
    const type = notification?.type || '';
    const referenceId = String(notification?.referenceId || '');

    if (
      type === notificationTypes.hairAnalysisReminder
      && hasAnalysisToday
      && toLocalDateKey(notification?.createdAt) === todayLocalDateKey
    ) {
      return false;
    }

    if (type === notificationTypes.submissionReceived) {
      return notification?.referenceType === 'hair_submission'
        && submittedDonationSubmissionIds.has(referenceId);
    }

    if ([notificationTypes.logisticsUpdated, notificationTypes.donationTrackingUpdated].includes(type)) {
      return notification?.referenceType === 'hair_submission'
        && donationWorkflowSubmissionIds.has(referenceId);
    }

    if (type === notificationTypes.certificateAvailable) {
      return receivedDonationSubmissionIds.size > 0;
    }

    return true;
  });
};

const buildDonorDerivedNotifications = async ({
  userId,
  databaseUserId = null,
  userEmail = '',
}) => {
  const notifications = [];
  const { data: submissions, error } = await fetchHairSubmissionsByUserId(userId, 6);

  if (error) {
    throw new Error(error.message || 'Unable to load donor notifications.');
  }
  const todayLocalDateKey = toLocalDateKey(new Date());

  if (!hasScreeningForLocalDay(submissions || [], todayLocalDateKey)) {
    notifications.push(buildNotification({
      dedupeKey: `${notificationTypes.hairAnalysisReminder}:${todayLocalDateKey}`,
      type: notificationTypes.hairAnalysisReminder,
      title: 'Hair analysis reminder',
      message: 'You have not checked your hair today.',
      createdAt: new Date().toISOString(),
      referenceType: 'route',
      referenceId: '/donor/donations',
    }));

    if (databaseUserId || userId) {
      await triggerHairAnalysisReminderEmail({
        authUserId: userId,
        databaseUserId,
        userEmail,
        localDateKey: todayLocalDateKey,
      });
    }
  }

  await Promise.all((submissions || []).map(async (submission) => {
    const submissionId = submission?.submission_id;
    if (!submissionId) return;

    const screening = Array.isArray(submission?.ai_screenings)
      ? submission.ai_screenings[0]
      : submission?.ai_screenings;
    const screeningId = screening?.ai_screening_id;

    if (screeningId) {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.screeningCompleted}:${screeningId}`,
        type: notificationTypes.screeningCompleted,
        title: 'Hair analysis completed',
        message: screening.summary || `Your latest screening result is ${screening.decision || 'ready for review'}.`,
        createdAt: screening.created_at,
        referenceType: 'ai_screening',
        referenceId: screeningId,
      }));
    }

    const recommendationRows = submission?.donor_recommendations?.length
      ? submission.donor_recommendations
      : (await fetchDonorRecommendationsBySubmissionId(submissionId)).data || [];
    if (recommendationRows.length && !screeningId) {
      const topRecommendation = recommendationRows[0];
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.recommendationAvailable}:${submissionId}`,
        type: notificationTypes.recommendationAvailable,
        title: 'Recommendation available',
        message: topRecommendation.recommendation_text || 'New donor guidance is now available after screening.',
        createdAt: topRecommendation.created_at,
        referenceType: 'hair_submission',
        referenceId: submissionId,
      }));
    }

    const [logisticsResult, trackingResult] = await Promise.all([
      fetchHairSubmissionLogisticsBySubmissionId(submissionId),
      fetchHairBundleTrackingHistory({ submissionId, limit: 4 }),
    ]);

    const logistics = logisticsResult.data;
    const trackingEntries = trackingResult.data || [];
    const hasDonationWorkflow = hasDonationWorkflowEvidence({
      submission,
      logistics,
      trackingEntries,
    });
    const hasSubmittedDonation = hasSubmittedDonationEvidence({ submission, trackingEntries });

    if (hasSubmittedDonation) {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.submissionReceived}:${submissionId}`,
        type: notificationTypes.submissionReceived,
        title: 'Donation submitted',
        message: `Your donation ${submission.donation_reference || ''} was submitted and is now being processed.`.trim(),
        createdAt: submission.updated_at || submission.created_at,
        referenceType: 'hair_submission',
        referenceId: submissionId,
      }));
    }

    if (hasDonationWorkflow && logistics?.submission_logistics_id) {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.logisticsUpdated}:${logistics.submission_logistics_id}`,
        type: notificationTypes.logisticsUpdated,
        title: 'Donation update',
        message: logistics.notes
          || [logistics.shipment_status, logistics.courier_name, logistics.tracking_number].filter(Boolean).join(' • ')
          || `Shipment status: ${logistics.shipment_status || logistics.logistics_type || 'updated'}.`,
        createdAt: logistics.received_at || logistics.pickup_approved_at || logistics.pickup_scheduled_at || logistics.created_at,
        referenceType: 'hair_submission',
        referenceId: submissionId,
      }));
    }

    trackingEntries.filter(isDonationLifecycleTrackingEntry).forEach((entry) => {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.donationTrackingUpdated}:${entry.tracking_id}`,
        type: notificationTypes.donationTrackingUpdated,
        title: entry.title || 'Donation update',
        message: entry.description || `Donation status: ${entry.status || 'updated'}.`,
        createdAt: entry.updated_at,
        referenceType: 'hair_submission',
        referenceId: entry.submission_id || submissionId,
      }));
    });

    const certificate = hasDonationWorkflow
      ? await ensureDonationCertificateForNotification({
          submission,
          trackingEntries,
          logistics,
        })
      : null;

    if (certificate?.certificate_id) {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.certificateAvailable}:${certificate.certificate_id}`,
        type: notificationTypes.certificateAvailable,
        title: 'Certificate available',
        message: 'Your donation was received. Your certificate is ready in Achievements.',
        createdAt: certificate.issued_at || new Date().toISOString(),
        referenceType: 'donation_certificate',
        referenceId: certificate.certificate_id,
      }));
    }

  }));

  if (databaseUserId) {
    const registeredDrivesResult = await fetchRegisteredDonationDrivesByUserId({ databaseUserId, limit: 24 });
    (registeredDrivesResult.data || []).forEach((drive) => {
      const rsvpNotification = buildDriveRsvpNotification(drive);
      if (rsvpNotification) notifications.push(rsvpNotification);

      if (shouldIncludeDriveUpdate(drive)) {
        const reminderNotification = buildDriveNotification(drive);
        if (reminderNotification) notifications.push(reminderNotification);
      }
    });
  }

  return notifications;
};

const buildPatientDerivedNotifications = async (userId) => {
  const notifications = [];
  const { data: patientDetails, error: patientDetailsError } = await fetchPatientDetailsByUserId(userId);

  if (patientDetailsError) {
    throw new Error(patientDetailsError.message || 'Unable to load patient notifications.');
  }

  if (!patientDetails?.patient_id) {
    return notifications;
  }

  const [{ data: wigRequest }, { data: latestAllocation }] = await Promise.all([
    fetchLatestWigRequestByPatientDetailsId(patientDetails.patient_id),
    fetchLatestWigAllocationByPatientDetailsId(patientDetails.patient_id),
  ]);

  if (wigRequest?.req_id) {
    notifications.push(buildNotification({
      dedupeKey: `${notificationTypes.wigRequestUpdated}:${wigRequest.req_id}`,
      type: notificationTypes.wigRequestUpdated,
      title: 'Wig request updated',
      message: wigRequest.notes || `Your wig request status is now ${wigRequest.status || 'pending'}.`,
      createdAt: wigRequest.updated_at || wigRequest.request_date,
      referenceType: 'wig_request',
      referenceId: wigRequest.req_id,
    }));
  }

  if (latestAllocation?.allocation_id) {
    const wig = latestAllocation.wigs;
    notifications.push(buildNotification({
      dedupeKey: `${notificationTypes.wigAllocationUpdated}:${latestAllocation.allocation_id}`,
      type: notificationTypes.wigAllocationUpdated,
      title: 'Wig allocation updated',
      message: latestAllocation.notes
        || [wig?.wig_name, latestAllocation.release_status].filter(Boolean).join(' | ')
        || 'Your wig allocation has a new status update.',
      createdAt: latestAllocation.released_at || latestAllocation.allocated_at,
      referenceType: 'wig_allocation',
      referenceId: latestAllocation.allocation_id,
    }));
  }

  return notifications;
};

const buildAccountCreatedNotification = async ({ userId, role }) => {
  if (!userId) return null;

  const accountResult = await fetchSystemUserByAuthUserId(userId).catch(() => ({ data: null }));
  const account = accountResult.data;
  if (!account?.user_id) return null;

  const normalizedRole = String(role || account.role || '').trim().toLowerCase();
  return buildNotification({
    dedupeKey: `${notificationTypes.accountCreated}:${account.user_id}`,
    type: notificationTypes.accountCreated,
    title: 'Welcome to Donivra',
    message: normalizedRole === 'patient'
      ? 'Your patient account has been created. You can now explore wig support and manage requests.'
      : 'Your donor account has been created. You can now analyze your hair, RSVP to events, and manage donations.',
    createdAt: account.created_at || account.updated_at || new Date().toISOString(),
    referenceType: 'route',
    referenceId: normalizedRole === 'patient' ? '/patient/home' : '/donor/home',
  });
};

const buildRoleDerivedNotifications = async ({ userId, databaseUserId, userEmail, role }) => {
  const [accountNotification, roleNotifications] = await Promise.all([
    buildAccountCreatedNotification({ userId, role }),
    role === 'donor'
      ? buildDonorDerivedNotifications({ userId, databaseUserId, userEmail })
      : buildPatientDerivedNotifications(userId),
  ]);

  return [accountNotification, ...(roleNotifications || [])].filter(Boolean);
};

const persistMissingBackendNotifications = async ({
  databaseUserId,
  role,
  notifications,
  backendNotifications,
}) => {
  if (!databaseUserId) {
    return null;
  }

  const backendKeys = new Set(backendNotifications.map((item) => item.stableKey || item.dedupeKey));
  const missingNotifications = notifications.filter((item) => !backendKeys.has(item.stableKey || item.dedupeKey));

  if (!missingNotifications.length) {
    return null;
  }

  const result = await NotificationAPI.createNotifications(
    missingNotifications.map((notification) => toBackendPayload({ databaseUserId, role, notification }))
  );

  if (!result.error) {
    void sendPushForBackendNotifications({
      notificationIds: (result.data || []).map((row) => row.notification_id),
    }).catch(() => {});
  }

  return result.error || null;
};

export const loadNotificationSummary = async ({
  userId,
  userEmail = '',
  role,
  databaseUserId: preferredDatabaseUserId = null,
}) => {
  try {
    const [localNotifications, databaseUserId] = await Promise.all([
      loadLocalNotifications({ userId, role }),
      preferredDatabaseUserId
        ? Promise.resolve(preferredDatabaseUserId)
        : resolveNotificationBackendUserId(userId),
    ]);

    const derivedNotifications = await buildRoleDerivedNotifications({
      userId,
      databaseUserId,
      userEmail,
      role,
    });
    const backendResult = await fetchBackendNotifications(databaseUserId);
    const mergedNotifications = mergeNotifications({
      localNotifications,
      backendNotifications: backendResult.notifications,
      derivedNotifications,
    });
    const notifications = role === 'donor'
      ? await filterInvalidDonorDonationNotifications({ userId, notifications: mergedNotifications })
      : mergedNotifications;

    if (notifications.length) {
      await saveLocalNotifications({ userId, role, notifications });
    }

    if (databaseUserId) {
      await persistMissingBackendNotifications({
        databaseUserId,
        role,
        notifications: derivedNotifications,
        backendNotifications: backendResult.notifications,
      });
    }

    return {
      notifications,
      unreadCount: notifications.filter((item) => !item.isRead).length,
      error: backendResult.error?.message || null,
      databaseUserId,
    };
  } catch (error) {
    const localNotifications = await loadLocalNotifications({ userId, role });
    const safeLocalNotifications = role === 'donor'
      ? await filterInvalidDonorDonationNotifications({ userId, notifications: localNotifications })
      : localNotifications;

    return {
      notifications: safeLocalNotifications,
      unreadCount: safeLocalNotifications.filter((item) => !item.isRead).length,
      error: error.message || 'Unable to load notifications right now.',
      databaseUserId: preferredDatabaseUserId || null,
    };
  }
};

export const loadNotifications = ({
  userId,
  userEmail = '',
  role,
  databaseUserId: preferredDatabaseUserId = null,
}) => {
  return (async () => {
  try {
    const [localNotifications, databaseUserId] = await Promise.all([
      loadLocalNotifications({ userId, role }),
      preferredDatabaseUserId
        ? Promise.resolve(preferredDatabaseUserId)
        : resolveNotificationBackendUserId(userId),
    ]);
    const derivedNotifications = await buildRoleDerivedNotifications({
      userId,
      databaseUserId,
      userEmail,
      role,
    });

    const backendResult = await fetchBackendNotifications(databaseUserId);
    const backendNotifications = backendResult.notifications;

    const unfilteredMergedNotifications = mergeNotifications({
      localNotifications,
      backendNotifications,
      derivedNotifications,
    });
    const mergedNotifications = role === 'donor'
      ? await filterInvalidDonorDonationNotifications({ userId, notifications: unfilteredMergedNotifications })
      : unfilteredMergedNotifications;

    await saveLocalNotifications({ userId, role, notifications: mergedNotifications });

    if (databaseUserId) {
      const persistError = await persistMissingBackendNotifications({
        databaseUserId,
        role,
        notifications: derivedNotifications,
        backendNotifications,
      });

      if (!persistError && derivedNotifications.length) {
        const refreshedBackendResult = await NotificationAPI.fetchNotificationsByUserId(databaseUserId).catch(() => ({ data: [], error: null }));
        const refreshedBackendNotifications = (refreshedBackendResult.data || [])
          .map(normalizeBackendNotification)
          .filter((notification) => notification.title || notification.message);

        const unfilteredDatabaseNotifications = mergeNotifications({
          localNotifications,
          backendNotifications: refreshedBackendNotifications,
          derivedNotifications,
        });
        const databaseNotifications = role === 'donor'
          ? await filterInvalidDonorDonationNotifications({ userId, notifications: unfilteredDatabaseNotifications })
          : unfilteredDatabaseNotifications;

        await saveLocalNotifications({ userId, role, notifications: databaseNotifications });

        return {
          notifications: databaseNotifications,
          unreadCount: databaseNotifications.filter((item) => !item.isRead).length,
          error: null,
          databaseUserId,
        };
      }
    }

    return {
      notifications: mergedNotifications,
      unreadCount: mergedNotifications.filter((item) => !item.isRead).length,
      error: null,
      databaseUserId,
    };
  } catch (error) {
    const localNotifications = await loadLocalNotifications({ userId, role });
    const safeLocalNotifications = role === 'donor'
      ? await filterInvalidDonorDonationNotifications({ userId, notifications: localNotifications })
      : localNotifications;

    return {
      notifications: safeLocalNotifications,
      unreadCount: safeLocalNotifications.filter((item) => !item.isRead).length,
      error: error.message || 'Unable to load notifications right now.',
      databaseUserId: preferredDatabaseUserId || null,
    };
  }
  })();
};

export const recordNotifications = async ({ userId, role, notifications }) => {
  const localNotifications = await loadLocalNotifications({ userId, role });
  const databaseUserId = await resolveNotificationBackendUserId(userId);
  let mergedNotifications = mergeNotifications({
    localNotifications,
    backendNotifications: [],
    derivedNotifications: notifications,
  });

  await saveLocalNotifications({ userId, role, notifications: mergedNotifications });

  if (databaseUserId) {
    const createResult = await NotificationAPI.createNotifications(
      notifications.map((notification) => toBackendPayload({ databaseUserId, role, notification }))
    ).catch((error) => ({ data: [], error }));

    if (!createResult?.error) {
      const backendNotifications = (createResult.data || [])
        .map(normalizeBackendNotification)
        .filter((notification) => notification.title || notification.message);

      void sendPushForBackendNotifications({
        notificationIds: backendNotifications.map((notification) => notification.backendId),
      }).catch(() => {});

      mergedNotifications = mergeNotifications({
        localNotifications,
        backendNotifications,
        derivedNotifications: [],
      });

      await saveLocalNotifications({ userId, role, notifications: mergedNotifications });
      await writeAuditLog({
        authUserId: userId,
        databaseUserId,
        action: 'notification.create',
        description: `Created ${backendNotifications.length || notifications.length} notification record(s).`,
        resource: 'notification',
        status: 'success',
      });
    } else {
      await writeAuditLog({
        authUserId: userId,
        databaseUserId,
        action: 'notification.create',
        description: createResult.error?.message || 'Unable to persist notifications.',
        resource: 'notification',
        status: 'failed',
      });
    }
  }

  return {
    notifications: mergedNotifications,
    unreadCount: mergedNotifications.filter((item) => !item.isRead).length,
  };
};

export const buildImmediateNotificationEvents = ({ role, payload }) => {
  if (role === 'donor') {
    const notifications = [];

    if (
      payload?.submission
      && !payload?.screening
      && !isHairCheckOnlySubmission(payload.submission)
      && hasDonationFlowProgress(payload.submission)
    ) {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.submissionReceived}:${payload.submission.submission_id}`,
        type: notificationTypes.submissionReceived,
        title: 'Donation submitted',
        message: `Your donation ${payload.submission.donation_reference || ''} was submitted and is now being processed.`.trim(),
        createdAt: payload.submission.created_at || new Date().toISOString(),
        referenceType: 'hair_submission',
        referenceId: payload.submission.submission_id,
      }));
    }

    if (payload?.screening) {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.screeningCompleted}:${payload.screening.ai_screening_id || payload.submission?.submission_id}`,
        type: notificationTypes.screeningCompleted,
        title: 'Hair analysis completed',
        message: payload.screening.summary || `Your latest screening result is ${payload.screening.decision || 'ready for review'}.`,
        createdAt: payload.screening.created_at || new Date().toISOString(),
        referenceType: 'ai_screening',
        referenceId: payload.screening.ai_screening_id || payload.submission?.submission_id,
      }));
    }

    if (payload?.recommendations?.length && !payload?.screening) {
      notifications.push(buildNotification({
        dedupeKey: `${notificationTypes.recommendationAvailable}:${payload.submission?.submission_id}`,
        type: notificationTypes.recommendationAvailable,
        title: 'Recommendation available',
        message: payload.recommendations[0].recommendation_text || 'New donor guidance is now available.',
        createdAt: payload.recommendations[0].created_at || new Date().toISOString(),
        referenceType: 'hair_submission',
        referenceId: payload.submission?.submission_id,
      }));
    }

    return notifications;
  }

  if (role === 'patient' && payload?.wigRequest) {
    return [
      buildNotification({
        dedupeKey: `${notificationTypes.wigRequestUpdated}:${payload.wigRequest.req_id}`,
        type: notificationTypes.wigRequestUpdated,
        title: 'Wig request updated',
        message: payload.wigRequest.notes || `Your wig request status is ${payload.wigRequest.status || 'pending'}.`,
        createdAt: payload.wigRequest.updated_at || payload.wigRequest.request_date || new Date().toISOString(),
        referenceType: 'wig_request',
        referenceId: payload.wigRequest.req_id,
      }),
    ];
  }

  return [];
};

export const markNotificationRead = async ({ userId, role, notificationId }) => {
  const localNotifications = await loadLocalNotifications({ userId, role });
  const databaseUserId = await resolveNotificationBackendUserId(userId);
  const targetNotification = localNotifications.find((item) => (
    item.id === notificationId
      || item.backendId === notificationId
      || item.dedupeKey === notificationId
  ));
  const nextNotifications = localNotifications.map((item) => (
    item.id === notificationId
      || item.backendId === notificationId
      || item.dedupeKey === notificationId
      ? { ...item, isRead: true }
      : item
  ));

  await saveLocalNotifications({ userId, role, notifications: nextNotifications });

  if (targetNotification?.backendId) {
    const result = await NotificationAPI.markNotificationsRead([targetNotification.backendId]).catch((error) => ({ error }));
    await writeAuditLog({
      authUserId: userId,
      databaseUserId,
      action: 'notification.read',
      description: result?.error
        ? (result.error.message || 'Unable to mark notification as read.')
        : `Marked notification ${targetNotification.backendId} as read.`,
      resource: 'notification',
      status: result?.error ? 'failed' : 'success',
    });
  }

  return {
    notifications: nextNotifications,
    unreadCount: nextNotifications.filter((item) => !item.isRead).length,
  };
};

export const markAllNotificationsRead = async ({ userId, role }) => {
  const localNotifications = await loadLocalNotifications({ userId, role });
  const databaseUserId = await resolveNotificationBackendUserId(userId);
  const nextNotifications = localNotifications.map((item) => ({
    ...item,
    isRead: true,
  }));

  await saveLocalNotifications({ userId, role, notifications: nextNotifications });
  if (databaseUserId) {
    const result = await NotificationAPI.markAllNotificationsRead(databaseUserId).catch((error) => ({ error }));
    await writeAuditLog({
      authUserId: userId,
      databaseUserId,
      action: 'notification.read_all',
      description: result?.error
        ? (result.error.message || 'Unable to mark all notifications as read.')
        : 'Marked all notifications as read.',
      resource: 'notification',
      status: result?.error ? 'failed' : 'success',
    });
  }

  return {
    notifications: nextNotifications,
    unreadCount: 0,
  };
};

export const getNotificationNavigationTarget = (notification) => (
  getNotificationRouteFromType(notification)
);

export const getNotificationTimestampLabel = (value) => formatReadableDate(value);
