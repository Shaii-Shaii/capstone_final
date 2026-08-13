import { supabase } from '../api/supabase/client';
import { logAppError, logAppEvent } from '../utils/appErrors';
import { canSubmitHairDonation, mapDonationPermissionError } from './donorCompliance.service';
import { createNotifications } from './notification.api';
import { notificationTypes } from './notification.constants';

const donationDriveRequestsTable = 'Event_Requests';
const donationDriveRegistrationsTable = 'Event_Attendees';
const hairSubmissionsTable = 'Hair_Submissions';
const hairSubmissionDetailsTable = 'Hair_Submission_Details';
const TRANSIENT_READ_MAX_ATTEMPTS = 2;
const TRANSIENT_READ_RETRY_DELAY_MS = 450;

const waitFor = (milliseconds = 0) => new Promise((resolve) => {
  setTimeout(resolve, Math.max(0, Number(milliseconds) || 0));
});

const isStatementTimeoutError = (error) => (
  String(error?.code || '').trim() === '57014'
  || String(error?.message || '').toLowerCase().includes('statement timeout')
);

const isConnectionTimeoutError = (error) => {
  const code = String(error?.code || '').trim().toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === 'PGRST003'
    || code.startsWith('08')
    || message.includes('connection timeout')
    || message.includes('network request failed')
    || message.includes('failed to fetch')
  );
};

const isTransientReadError = (error) => (
  isStatementTimeoutError(error) || isConnectionTimeoutError(error)
);

const createFriendlyTransientReadError = (error) => ({
  code: String(error?.code || '').trim() || 'TEMPORARY_READ_UNAVAILABLE',
  details: null,
  hint: 'Retry the request after a moment.',
  message: isConnectionTimeoutError(error)
    ? 'We could not reach the server. Check your connection and try again.'
    : 'The server took too long to load your event registrations. Please try again.',
  isTransient: true,
  technicalMessage: String(error?.message || ''),
});

const executeTransientRegistrationRead = async ({ queryFactory, scope, extras = {} }) => {
  let latestResult = { data: null, error: null };

  for (let attempt = 1; attempt <= TRANSIENT_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      latestResult = await queryFactory();
    } catch (error) {
      latestResult = { data: null, error };
    }

    if (!latestResult?.error || !isTransientReadError(latestResult.error)) {
      return latestResult;
    }

    if (attempt < TRANSIENT_READ_MAX_ATTEMPTS) {
      logAppEvent(`${scope}.retry`, 'Event registrations were temporarily unavailable. Retrying the read.', {
        ...extras,
        attempt,
        errorCode: latestResult.error?.code || null,
        errorType: isConnectionTimeoutError(latestResult.error) ? 'connection_timeout' : 'statement_timeout',
      }, 'info');
      await waitFor(TRANSIENT_READ_RETRY_DELAY_MS * attempt);
    }
  }

  const friendlyError = createFriendlyTransientReadError(latestResult.error);
  logAppEvent(`${scope}.temporarily_unavailable`, friendlyError.message, {
    ...extras,
    attempts: TRANSIENT_READ_MAX_ATTEMPTS,
    errorCode: friendlyError.code,
    errorType: isConnectionTimeoutError(latestResult.error) ? 'connection_timeout' : 'statement_timeout',
  }, 'warn');

  return { ...latestResult, error: friendlyError };
};

const donationDriveSelect = `
  event_request_id:Event_Request_ID,
  donation_drive_id:Event_Request_ID,
  event_application_id:Event_Application_ID,
  event_title:Event_Name,
  event_by:Event_By,
  partnered_with:Partnered_With,
  partner_social_media_link:Partner_Social_Media_Link,
  start_date:Start_Date,
  end_date:End_Date,
  venue_name:Venue_Name,
  event_image_url:Event_Photo_URL,
  street:Street,
  region:Region,
  barangay:Barangay,
  city:City_Municipality,
  province:Province,
  country:Country,
  latitude:Latitude,
  longitude:Longitude,
  status:Status,
  event_visibility:Event_Visibility,
  staff_contact_notes:Staff_Contact_Notes,
  admin_decision_reason:Admin_Decision_Reason,
  updated_at:Updated_At
`;

const donationDrivePrivateSelect = `
  ${donationDriveSelect},
  private_event_code:Private_Event_Code
`;

const donationDriveRegistrationSelect = `
  registration_id:Event_Attendee_ID,
  donation_drive_id:Event_Request_ID,
  user_id:User_ID,
  attendee_type:Attendee_Type,
  waybill_code:Waybill_Code,
  registration_status:Registration_Status,
  attendance_status:Attendance_Status,
  rsvp_scanned_at:RSVP_Scanned_At,
  rsvp_scanned_by:RSVP_Scanned_By,
  registered_at:Created_At,
  updated_at:Updated_At
`;

const eventHairSubmissionLinkSelect = `
  submission_id:Submission_ID,
  status:Status,
  created_at:Created_At
`;


const normalizeRegistrationStatus = (value = '') => String(value || '').trim().toLowerCase();
const normalizeDriveStatus = (value = '') => String(value || '').trim().toLowerCase();
const normalizeVisibility = (value = '') => String(value || '').trim().toLowerCase();

const createDriveRsvpNotification = async ({ databaseUserId, drive = null, registration = null }) => {
  if (!databaseUserId || !registration?.registration_id) return;
  const isParticipatingDonor = normalizeRegistrationStatus(registration?.attendee_type) === 'donor';

  await createNotifications([{
    user_id: databaseUserId,
    type: notificationTypes.driveRsvpConfirmed,
    title: 'RSVP confirmed',
    message: isParticipatingDonor
      ? `You are registered to participate in ${drive?.event_title || 'the donation event'}.`
      : `You are registered to attend ${drive?.event_title || 'the event'}.`,
    status: 'Unread',
    reference_type: 'donation_drive',
    reference_id: drive?.donation_drive_id || registration?.donation_drive_id,
    updated_at: registration?.registered_at || registration?.updated_at || new Date().toISOString(),
  }]).catch(() => ({ data: [], error: null }));
};

const resolveDatabaseUserIdFromSession = async (fallbackDatabaseUserId = null) => {
  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user?.id) {
      return Number(fallbackDatabaseUserId) || null;
    }

    const userLookup = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();

    if (userLookup.error) {
      return Number(fallbackDatabaseUserId) || null;
    }

    const mappedUserId = Number(userLookup.data?.user_id);
    return Number.isFinite(mappedUserId) && mappedUserId > 0
      ? mappedUserId
      : (Number(fallbackDatabaseUserId) || null);
  } catch (_error) {
    return Number(fallbackDatabaseUserId) || null;
  }
};
const getStartOfTodayIso = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
};

const getDriveCompareDate = (drive) => drive?.end_date || drive?.start_date || null;
const isDrivePublic = (drive = null) => {
  const visibility = normalizeVisibility(drive?.event_visibility || 'Public');
  return !visibility.includes('private');
};
const doesDriveRequireMembership = (_drive = null) => false;

const isDriveUnlockedForDonor = (drive = null, unlockedPrivateEventApplicationIds = new Set()) => {
  if (isDrivePublic(drive)) return true;
  if (drive?.registration?.registration_id) return true;
  const eventApplicationId = Number(drive?.event_application_id || 0);
  return eventApplicationId > 0 && unlockedPrivateEventApplicationIds.has(eventApplicationId);
};

const isUpcomingDrive = (drive) => {
  const compareDate = getDriveCompareDate(drive);
  if (!compareDate) return false;
  return new Date(compareDate).getTime() >= new Date(getStartOfTodayIso()).getTime();
};

const sortDrivesForHome = (rows = []) => (
  [...rows].sort((left, right) => {
    const leftUpcoming = isUpcomingDrive(left);
    const rightUpcoming = isUpcomingDrive(right);
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;

    const leftDate = leftUpcoming
      ? (left?.start_date || left?.end_date || left?.updated_at)
      : (left?.updated_at || left?.end_date || left?.start_date);
    const rightDate = rightUpcoming
      ? (right?.start_date || right?.end_date || right?.updated_at)
      : (right?.updated_at || right?.end_date || right?.start_date);
    const leftTime = leftDate ? new Date(leftDate).getTime() : 0;
    const rightTime = rightDate ? new Date(rightDate).getTime() : 0;

    if (leftUpcoming) return leftTime - rightTime;
    return rightTime - leftTime;
  })
);

const fetchUnlockedPrivateEventApplicationIds = async (databaseUserId = null) => {
  const userId = Number(databaseUserId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { data: new Set(), error: null };
  }

  const result = await supabase
    .from('Private_Event_Access')
    .select('event_application_id:Event_Application_ID')
    .eq('User_ID', userId);

  if (result.error) {
    logAppError('donor_home.private_event_access', result.error, {
      table: 'Private_Event_Access',
      databaseUserId: userId,
    });

    return { data: new Set(), error: result.error };
  }

  return {
    data: new Set(
      (result.data || [])
        .map((row) => Number(row?.event_application_id))
        .filter((value) => Number.isFinite(value) && value > 0)
    ),
    error: null,
  };
};

const resolveDriveQrState = (row) => {
  const attendanceStatus = normalizeRegistrationStatus(row?.attendance_status);
  const hasRegistration = Boolean(row?.registration_id);
  const isUsed = Boolean(row?.attendance_marked_at)
    || ['marked', 'attended', 'present', 'checked in', 'checked-in'].includes(attendanceStatus);

  return {
    state: isUsed ? 'used' : hasRegistration ? 'registered' : 'missing',
    generated_at: row?.registered_at || row?.updated_at || null,
    used_at: isUsed ? (row?.attendance_marked_at || row?.updated_at || row?.registered_at || null) : null,
    is_used: isUsed,
    is_valid: hasRegistration && !isUsed,
  };
};

const buildLocationLabel = (row) => (
  [row?.city, row?.province, row?.country]
    .filter(Boolean)
    .join(', ')
    .trim()
);

const buildFullAddressLabel = (row) => (
  [row?.venue_name, row?.street, row?.barangay, row?.city, row?.province, row?.country]
    .filter(Boolean)
    .join(', ')
    .trim()
);

const getEventHostKey = (row = {}) => (
  `event-${row?.event_application_id || row?.donation_drive_id || 'unknown'}`
);

const getEventHostName = (row = {}) => (
  row?.partnered_with
  || row?.event_by
  || 'Event host'
);

const normalizeEventHostOrganization = (row = {}, drives = []) => {
  const organizationId = getEventHostKey(row);
  const normalizedDrives = drives.length ? drives : [row];

  return {
    id: organizationId,
    organization_id: organizationId,
    organization_name: getEventHostName(row),
    organization_type: 'Event host',
    organization_logo_url: row?.event_image_url || '',
    location_label: buildLocationLabel(row),
    address_label: buildFullAddressLabel(row),
    description: buildShortOverview(row?.event_overview || 'Approved donation event host.'),
    membership: null,
    is_active: true,
    drives: normalizedDrives.map((drive) => normalizeDonationDrive(drive, null, null, null)),
    updated_at: row?.updated_at || null,
  };
};

const isRemoteUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());

const buildDonationDriveAttachmentUrl = (row = {}) => {
  if (row?.event_image_url) return row.event_image_url;
  const attachment = String(row?.proposal_attachment || '').trim();
  if (!attachment) return '';
  if (isRemoteUrl(attachment)) return attachment;
  if (!row?.proposal_attachment_bucket) return '';

  const { data } = supabase.storage
    .from(row.proposal_attachment_bucket)
    .getPublicUrl(attachment);

  return data?.publicUrl || '';
};

const buildShortOverview = (value, maxLength = 140) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
};

const normalizeDonationDriveRegistration = (row) => ({
  registration_id: row?.registration_id || null,
  donation_drive_id: row?.donation_drive_id || null,
  user_id: row?.user_id || null,
  attendee_type: row?.attendee_type || 'Donor',
  waybill_code: row?.waybill_code || null,
  submission_id: row?.submission_id || null,
  donation_reference: row?.donation_reference || '',
  submission_detail_id: row?.submission_detail_id || null,
  submission_status: row?.submission_status || '',
  submission_detail_status: row?.submission_detail_status || '',
  registration_status: row?.registration_status || '',
  attendance_status: row?.attendance_status || '',
  rsvp_scanned_at: row?.rsvp_scanned_at || null,
  rsvp_scanned_by: row?.rsvp_scanned_by || null,
  registered_at: row?.registered_at || null,
  updated_at: row?.updated_at || null,
  attendance_marked_at: row?.attendance_marked_at || null,
  qr: resolveDriveQrState(row),
});

const normalizeEventHairSubmissionLink = (row = null, detail = null) => {
  if (!row?.submission_id) return null;

  return {
    submission_id: row.submission_id || null,
    submission_status: row.status || '',
    submission_detail_id: detail?.submission_detail_id || null,
    submission_detail_status: detail?.status || '',
  };
};

const attachEventHairSubmissionLink = (registration = null, link = null) => (
  registration && link
    ? {
        ...registration,
        submission_id: link.submission_id || registration.submission_id || null,
        submission_detail_id: link.submission_detail_id || registration.submission_detail_id || null,
        submission_status: link.submission_status || registration.submission_status || '',
        submission_detail_status: link.submission_detail_status || registration.submission_detail_status || '',
      }
    : registration
);

const normalizeDonationDrive = (row, organization = null, registration = null, membership = null) => ({
  id: row?.donation_drive_id || null,
  donation_drive_id: row?.donation_drive_id || null,
  event_request_id: row?.event_request_id || null,
  organization_id: row?.organization_id || null,
  created_by_user_id: row?.created_by_user_id || null,
  event_title: row?.event_title || '',
  event_overview: row?.event_overview || row?.staff_contact_notes || '',
  short_overview: buildShortOverview(row?.event_overview || row?.staff_contact_notes),
  start_date: row?.start_date || null,
  end_date: row?.end_date || null,
  venue_name: row?.venue_name || '',
  proposal_attachment: row?.proposal_attachment || row?.event_image_path || '',
  proposal_attachment_bucket: row?.proposal_attachment_bucket || '',
  event_image_url: buildDonationDriveAttachmentUrl(row),
  street: row?.street || '',
  region: row?.region || '',
  barangay: row?.barangay || '',
  city: row?.city || '',
  province: row?.province || '',
  country: row?.country || '',
  latitude: row?.latitude ?? null,
  longitude: row?.longitude ?? null,
  status: row?.status || '',
  event_visibility: row?.event_visibility || 'Public',
  is_open_for_all: isDrivePublic(row),
  donation_setup_type: row?.donation_setup_type || 'Event',
  updated_at: row?.updated_at || null,
  location_label: buildLocationLabel(row),
  address_label: buildFullAddressLabel(row),
  organization_name: organization?.organization_name || getEventHostName(row),
  organization_logo_url: organization?.organization_logo_url || '',
  organization: organization || null,
  registration: registration || null,
  membership: membership || null,
  is_public: isDrivePublic(row),
  visibility_scope: isDrivePublic(row) ? 'public' : 'private',
  requires_membership: doesDriveRequireMembership(row),
  is_member: Boolean(membership?.is_active),
  can_view: true,
  can_join: !registration,
});

const sortByNewestTimestamp = (rows = [], timestampFields = []) => (
  [...rows].sort((left, right) => {
    const leftValue = timestampFields
      .map((field) => left?.[field])
      .find(Boolean);
    const rightValue = timestampFields
      .map((field) => right?.[field])
      .find(Boolean);

    const leftTime = leftValue ? new Date(leftValue).getTime() : 0;
    const rightTime = rightValue ? new Date(rightValue).getTime() : 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return (right?.registration_id || right?.donation_drive_id || right?.organization_id || 0)
      - (left?.registration_id || left?.donation_drive_id || left?.organization_id || 0);
  })
);

const ensureEventSubmissionHasLatestHairAnalysis = async ({ submissionId }) => {
  const targetDetailResult = await supabase
    .from(hairSubmissionDetailsTable)
    .select('Submission_Detail_ID')
    .eq('Submission_ID', submissionId)
    .order('Created_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (targetDetailResult.error) {
    return { error: targetDetailResult.error };
  }

  // Keep event registration singleton clean:
  // do not copy/create AI screening from another submission during registration.
  // The canonical analysis should come from the submission where the user saved results.
  if (!targetDetailResult.data?.Submission_Detail_ID) {
    const blankDetailResult = await supabase
      .from(hairSubmissionDetailsTable)
      .upsert({
        Submission_ID: submissionId,
        Status: 'Pending',
      }, {
        onConflict: 'Submission_ID',
      });

    if (blankDetailResult.error) {
      return { error: blankDetailResult.error };
    }
  }

  return { error: null };
};

const ensureHairSubmissionForDrive = async ({ driveId, databaseUserId, eventAttendeeId = null }) => {
  if (!driveId || !databaseUserId) return { data: null, error: null };

  const existingSubmissionResult = await supabase
    .from(hairSubmissionsTable)
    .select('Submission_ID,Created_At,Status,Event_Attendee_ID')
    .eq('User_ID', databaseUserId)
    .eq('Event_Request_ID', driveId)
    .not('Status', 'ilike', 'cancelled')
    .order('Created_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSubmissionResult.error) {
    return { data: null, error: existingSubmissionResult.error };
  }

  let submissionId = existingSubmissionResult.data?.Submission_ID || null;

  if (!submissionId) {
    const insertSubmissionResult = await supabase
      .from(hairSubmissionsTable)
      .upsert({
        User_ID: databaseUserId,
        Event_Request_ID: driveId,
        Event_Attendee_ID: eventAttendeeId || null,
        From_Event: true,
        Status: 'Pending',
      }, {
        onConflict: 'User_ID,Event_Request_ID',
      })
      .select('Submission_ID')
      .single();

    if (insertSubmissionResult.error) {
      return { data: null, error: insertSubmissionResult.error };
    }
    submissionId = insertSubmissionResult.data?.Submission_ID || null;
  }

  if (!submissionId) {
    return { data: null, error: new Error('Unable to create hair submission.') };
  }

  if (eventAttendeeId && Number(existingSubmissionResult.data?.Event_Attendee_ID || 0) !== Number(eventAttendeeId)) {
    const linkAttendeeResult = await supabase
      .from(hairSubmissionsTable)
      .update({ Event_Attendee_ID: eventAttendeeId })
      .eq('Submission_ID', submissionId);

    if (linkAttendeeResult.error) {
      return { data: { submission_id: submissionId }, error: linkAttendeeResult.error };
    }
  }

  const analysisResult = await ensureEventSubmissionHasLatestHairAnalysis({
    submissionId,
    databaseUserId,
    driveId,
  });

  if (analysisResult.error) {
    return { data: { submission_id: submissionId }, error: analysisResult.error };
  }

  const linkedSubmissionResult = await supabase
    .from(hairSubmissionsTable)
    .select(eventHairSubmissionLinkSelect)
    .eq('Submission_ID', submissionId)
    .maybeSingle();

  if (linkedSubmissionResult.error) {
    return { data: { submission_id: submissionId }, error: linkedSubmissionResult.error };
  }

  const linkedDetailResult = await supabase
    .from(hairSubmissionDetailsTable)
    .select('submission_detail_id:Submission_Detail_ID,status:Status,created_at:Created_At')
    .eq('Submission_ID', submissionId)
    .order('Created_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linkedDetailResult.error) {
    return { data: { submission_id: submissionId }, error: linkedDetailResult.error };
  }

  return {
    data: normalizeEventHairSubmissionLink(linkedSubmissionResult.data, linkedDetailResult.data) || { submission_id: submissionId },
    error: null,
  };
};

const findExistingDriveRegistration = async (driveId, databaseUserId) => {
  if (!driveId || !databaseUserId) {
    return { data: null, error: null };
  }

  const result = await executeTransientRegistrationRead({
    scope: 'donor_home.drive_registration.lookup',
    extras: { table: donationDriveRegistrationsTable, driveId, databaseUserId },
    queryFactory: () => supabase
      .from(donationDriveRegistrationsTable)
      .select(donationDriveRegistrationSelect)
      .eq('Event_Request_ID', driveId)
      .eq('User_ID', databaseUserId)
      .order('Updated_At', { ascending: false }),
  });

  if (result.error) {
    if (!result.error?.isTransient) {
      logAppError('donor_home.drive_registration.lookup', result.error, {
        table: donationDriveRegistrationsTable,
        driveId,
        databaseUserId,
      });
    }

    return {
      data: null,
      error: result.error,
    };
  }

  const normalizedRows = (result.data || []).map(normalizeDonationDriveRegistration);
  if (normalizedRows.length > 1) {
    logAppEvent('donor_home.drive_registration.lookup.duplicate', 'Multiple drive registrations found for the same donor.', {
      table: donationDriveRegistrationsTable,
      driveId,
      databaseUserId,
      registrationIds: normalizedRows.map((item) => item.registration_id),
    }, 'warn');
  }

  return {
    data: sortByNewestTimestamp(normalizedRows, ['updated_at', 'registered_at'])[0] || null,
    error: null,
  };
};

const updateDriveRegistrationAttendeeType = async (registrationId, attendeeType = 'Donor') => {
  if (!registrationId) return { data: null, error: null };

  const normalizedType = attendeeType === 'Voluntary' ? 'Voluntary' : 'Donor';
  const result = await supabase
    .from(donationDriveRegistrationsTable)
    .update({
      Attendee_Type: normalizedType,
      Updated_At: new Date().toISOString(),
    })
    .eq('Event_Attendee_ID', registrationId)
    .select(donationDriveRegistrationSelect)
    .maybeSingle();

  return {
    data: result.data ? normalizeDonationDriveRegistration(result.data) : null,
    error: result.error || null,
  };
};

const findDriveRegistrationsByUserIdAndDriveIds = async (driveIds = [], databaseUserId) => {
  if (!databaseUserId || !driveIds.length) {
    return {
      data: new Map(),
      error: null,
    };
  }

  const result = await executeTransientRegistrationRead({
    scope: 'donor_home.drive_registrations.by_drive_ids',
    extras: { table: donationDriveRegistrationsTable, databaseUserId, driveIds },
    queryFactory: () => supabase
      .from(donationDriveRegistrationsTable)
      .select(donationDriveRegistrationSelect)
      .eq('User_ID', databaseUserId)
      .in('Event_Request_ID', driveIds)
      .order('Updated_At', { ascending: false }),
  });

  if (result.error) {
    if (!result.error?.isTransient) {
      logAppError('donor_home.drive_registrations.by_drive_ids', result.error, {
        table: donationDriveRegistrationsTable,
        databaseUserId,
        driveIds,
      });
    }

    return {
      data: new Map(),
      error: result.error,
    };
  }

  const byDriveId = new Map();
  (result.data || [])
    .map(normalizeDonationDriveRegistration)
    .forEach((registration) => {
      if (!registration?.donation_drive_id || byDriveId.has(registration.donation_drive_id)) {
        return;
      }

      byDriveId.set(registration.donation_drive_id, registration);
    });

  return {
    data: byDriveId,
    error: null,
  };
};

const fetchOrganizationsByIds = async (organizationIds = []) => {
  return {
    data: new Map(),
    error: null,
  };
};

export const fetchOrganizationMembershipsByUserId = async (databaseUserId) => {
  return {
    data: [],
    error: null,
  };
};

export const fetchDonationDriveRegistrationsByUserId = async (databaseUserId) => {
  if (!databaseUserId) {
    return {
      data: [],
      error: null,
    };
  }

  const result = await executeTransientRegistrationRead({
    scope: 'donor_home.drive_registrations',
    extras: { table: donationDriveRegistrationsTable, databaseUserId },
    queryFactory: () => supabase
      .from(donationDriveRegistrationsTable)
      .select(donationDriveRegistrationSelect)
      .eq('User_ID', databaseUserId)
      .order('Updated_At', { ascending: false }),
  });

  if (result.error) {
    if (!result.error?.isTransient) {
      logAppError('donor_home.drive_registrations', result.error, {
        table: donationDriveRegistrationsTable,
        databaseUserId,
      });
    }

    return {
      data: [],
      error: result.error,
    };
  }

  return {
    data: (result.data || []).map(normalizeDonationDriveRegistration),
    error: null,
  };
};

export const createDonationDriveRegistration = async ({
  driveId,
  databaseUserId,
  hasEligibleHairScan = null,
  hasHairScanLog = null,
  requiresPostDonationAnalysis = false,
  attendanceOnly = false,
}) => {
  const effectiveDatabaseUserId = await resolveDatabaseUserIdFromSession(databaseUserId);

  if (!driveId || !effectiveDatabaseUserId) {
    return {
      data: null,
      error: new Error('Donation drive and donor account are required before joining a drive.'),
      alreadyRegistered: false,
    };
  }

  if (!attendanceOnly && hasEligibleHairScan === false) {
    const eligibilityError = new Error(
      requiresPostDonationAnalysis
        ? 'Your previous donated hair has already been cut. Please run Hair Analysis again so the app can verify if your current hair is long enough before registering for another donation event.'
        : hasHairScanLog
        ? 'Your latest AI hair screening is not eligible for donation yet. Please follow the recommendations and scan again before registering for a donation event.'
        : 'Scan your hair first so the system can confirm if you are eligible to join this donation event.'
    );
    eligibilityError.code = 'HAIR_ELIGIBILITY_REQUIRED';
    return {
      data: null,
      error: eligibilityError,
      alreadyRegistered: false,
    };
  }

  if (!attendanceOnly) {
    const permission = await canSubmitHairDonation(effectiveDatabaseUserId);
    if (!permission.allowed) {
      const permissionError = new Error(mapDonationPermissionError(permission.reason));
      permissionError.code = permission.reason;
      return {
        data: null,
        error: permissionError,
        alreadyRegistered: false,
      };
    }
  }

  const driveResult = await supabase
    .from(donationDriveRequestsTable)
    .select(donationDrivePrivateSelect)
    .eq('Event_Request_ID', driveId)
    .ilike('Status', 'approved')
    .maybeSingle();

  if (driveResult.error) {
    return {
      data: null,
      error: driveResult.error,
      alreadyRegistered: false,
    };
  }

  if (!driveResult.data) {
    return {
      data: null,
      error: new Error('The selected donation drive could not be found.'),
      alreadyRegistered: false,
    };
  }

  const driveStatus = String(driveResult.data.status || '').trim().toLowerCase();
  if (driveStatus !== 'approved') {
    return {
      data: null,
      error: new Error('This donation drive is not open for registration right now.'),
      alreadyRegistered: false,
    };
  }

  if (!isUpcomingDrive(driveResult.data)) {
    return {
      data: null,
      error: new Error('This donation drive has already ended.'),
      alreadyRegistered: false,
    };
  }

  const existingResult = await findExistingDriveRegistration(driveId, effectiveDatabaseUserId);
  if (existingResult.error) {
    return {
      data: null,
      error: existingResult.error,
      alreadyRegistered: false,
    };
  }

  if (existingResult.data?.registration_id) {
    if (attendanceOnly) {
      const typeResult = existingResult.data.attendee_type === 'Voluntary'
        ? { data: existingResult.data, error: null }
        : await updateDriveRegistrationAttendeeType(existingResult.data.registration_id, 'Voluntary');

      return {
        data: typeResult.data || existingResult.data,
        error: typeResult.error,
        alreadyRegistered: true,
      };
    }

    const donorTypeResult = existingResult.data.attendee_type === 'Donor'
      ? { data: existingResult.data, error: null }
      : await updateDriveRegistrationAttendeeType(existingResult.data.registration_id, 'Donor');

    if (donorTypeResult.error) {
      return {
        data: null,
        error: donorTypeResult.error,
        alreadyRegistered: true,
      };
    }

    const ensured = await ensureHairSubmissionForDrive({
      driveId,
      databaseUserId: effectiveDatabaseUserId,
      eventAttendeeId: existingResult.data.registration_id,
    });
    if (ensured.error) {
      return {
        data: null,
        error: ensured.error,
        alreadyRegistered: true,
      };
    }

    return {
      data: attachEventHairSubmissionLink(existingResult.data, ensured.data),
      error: null,
      alreadyRegistered: true,
    };
  }

  const insertResult = await supabase
    .from(donationDriveRegistrationsTable)
    .upsert({
      Event_Request_ID: driveId,
      User_ID: effectiveDatabaseUserId,
      Attendee_Type: attendanceOnly ? 'Voluntary' : 'Donor',
      Registration_Status: 'Registered',
      Attendance_Status: 'Not Marked',
    }, {
      onConflict: 'User_ID,Event_Request_ID',
    })
    .select(donationDriveRegistrationSelect)
    .maybeSingle();

  if (insertResult.error) {
    const duplicateLookupResult = await findExistingDriveRegistration(driveId, effectiveDatabaseUserId);
    if (duplicateLookupResult.data?.registration_id) {
      if (attendanceOnly) {
        const typeResult = duplicateLookupResult.data.attendee_type === 'Voluntary'
          ? { data: duplicateLookupResult.data, error: null }
          : await updateDriveRegistrationAttendeeType(duplicateLookupResult.data.registration_id, 'Voluntary');

        return {
          data: typeResult.data || duplicateLookupResult.data,
          error: typeResult.error,
          alreadyRegistered: true,
        };
      }

      const donorTypeResult = duplicateLookupResult.data.attendee_type === 'Donor'
        ? { data: duplicateLookupResult.data, error: null }
        : await updateDriveRegistrationAttendeeType(duplicateLookupResult.data.registration_id, 'Donor');

      if (donorTypeResult.error) {
        return {
          data: null,
          error: donorTypeResult.error,
          alreadyRegistered: true,
        };
      }

      const ensured = await ensureHairSubmissionForDrive({
        driveId,
        databaseUserId: effectiveDatabaseUserId,
        eventAttendeeId: duplicateLookupResult.data.registration_id,
      });

      return {
        data: attachEventHairSubmissionLink(duplicateLookupResult.data, ensured.data),
        error: ensured.error,
        alreadyRegistered: true,
      };
    }

    logAppError('donor_home.drive_registration.create', insertResult.error, {
      table: donationDriveRegistrationsTable,
      driveId,
      databaseUserId,
      effectiveDatabaseUserId,
    });

    return {
      data: null,
      error: insertResult.error,
      alreadyRegistered: false,
    };
  }

  const normalizedRegistration = normalizeDonationDriveRegistration(insertResult.data);
  if (attendanceOnly) {
    await createDriveRsvpNotification({
      databaseUserId: effectiveDatabaseUserId,
      drive: driveResult.data,
      registration: normalizedRegistration,
    });
    return {
      data: normalizedRegistration,
      error: null,
      alreadyRegistered: false,
    };
  }

  const ensured = await ensureHairSubmissionForDrive({
    driveId,
    databaseUserId: effectiveDatabaseUserId,
    eventAttendeeId: insertResult.data?.Event_Attendee_ID || insertResult.data?.registration_id || null,
  });
  if (ensured.error) {
    return {
      data: null,
      error: ensured.error,
      alreadyRegistered: false,
    };
  }

  await createDriveRsvpNotification({
    databaseUserId: effectiveDatabaseUserId,
    drive: driveResult.data,
    registration: normalizedRegistration,
  });

  return {
    data: attachEventHairSubmissionLink(normalizedRegistration, ensured.data),
    error: null,
    alreadyRegistered: false,
  };
};

export const unlockPrivateEventAccess = async ({
  driveId = null,
  accessCode = '',
}) => {
  const normalizedDriveId = Number(driveId);
  const normalizedCode = String(accessCode || '').trim();

  if (!normalizedCode) {
    return { data: null, error: new Error('Enter the private event code.') };
  }

  if (Number.isFinite(normalizedDriveId) && normalizedDriveId > 0) {
    const result = await supabase.rpc('unlock_private_event', {
      p_event_application_id: normalizedDriveId,
      p_access_code: normalizedCode,
    });

    if (result.error) {
      return { data: null, error: result.error };
    }

    return { data: result.data || null, error: null };
  }

  const byCodeResult = await supabase.rpc('unlock_private_event_by_code', {
    p_access_code: normalizedCode,
  });

  if (byCodeResult.error) {
    return { data: null, error: byCodeResult.error };
  }

  return { data: byCodeResult.data || null, error: null };
};

export const fetchOrganizationMembership = async ({
  organizationId,
  databaseUserId,
}) => {
  return {
    data: null,
    error: null,
  };
};

export const joinOrganizationMembership = async ({
  organizationId,
  databaseUserId,
}) => {
  return {
    data: null,
    error: new Error('Organization membership is not available in the current database schema.'),
    alreadyMember: false,
    alreadyPending: false,
    requestSubmitted: false,
  };
};

export const leaveOrganizationMembership = async ({
  organizationId,
  databaseUserId,
}) => {
  if (!organizationId || !databaseUserId) {
    return {
      data: null,
      error: new Error('Leaving an organization requires the organization and donor account.'),
      alreadyLeft: false,
    };
  }

  return {
    data: null,
    error: null,
    alreadyLeft: true,
  };
};

export const fetchFeaturedOrganizations = async (limit = 8) => {
  logAppEvent('donor_home.organizations', 'Loading featured organizations.', {
    table: donationDriveRequestsTable,
    limit,
    source: 'approved_event_hosts',
  });

  const result = await supabase
    .from(donationDriveRequestsTable)
    .select(donationDriveSelect)
    .ilike('Status', 'approved')
    .ilike('Event_Visibility', 'public')
    .order('Updated_At', { ascending: false })
    .limit(Math.max(Number(limit) || 8, 8) * 3);

  if (result.error) {
    logAppError('donor_home.organizations', result.error, {
      table: donationDriveRequestsTable,
      limit,
    });

    return {
      data: [],
      error: result.error,
    };
  }

  const byHost = new Map();
  (result.data || []).forEach((row) => {
    const key = getEventHostKey(row);
    const current = byHost.get(key);
    if (!current) {
      byHost.set(key, { row, drives: [row] });
      return;
    }
    current.drives.push(row);
  });

  return {
    data: Array.from(byHost.values())
      .map(({ row, drives }) => normalizeEventHostOrganization(row, drives))
      .slice(0, Math.max(Number(limit) || 8, 1)),
    error: null,
  };
};

export const fetchUpcomingDonationDrives = async (limit = 6, databaseUserId = null) => {
  const normalizedLimit = Math.max(1, Number(limit) || 6);
  const queryLimit = Math.min(Math.max(normalizedLimit * 8, 40), 120);

  logAppEvent('donor_home.drives', 'Loading upcoming donation drives.', {
    table: donationDriveRequestsTable,
    limit: normalizedLimit,
    queryLimit,
    status: 'approved',
    databaseUserId: databaseUserId || null,
  });

  const result = await supabase
    .from(donationDriveRequestsTable)
    .select(donationDriveSelect)
    .ilike('Status', 'approved')
    .order('Start_Date', { ascending: true })
    .limit(queryLimit);

  if (result.error) {
    logAppError('donor_home.drives', result.error, {
      table: donationDriveRequestsTable,
      limit: normalizedLimit,
      status: 'approved',
    });

    return {
      data: [],
      error: result.error,
    };
  }

  const driveRows = result.data || [];
  const organizationIds = [...new Set(driveRows.map((row) => row?.organization_id).filter(Boolean))];
  const organizationsResult = await fetchOrganizationsByIds(organizationIds);
  const driveIds = driveRows.map((row) => row?.donation_drive_id).filter(Boolean);

  const [membershipsResult, registrationsResult, privateAccessResult] = databaseUserId
    ? await Promise.all([
        fetchOrganizationMembershipsByUserId(databaseUserId),
        findDriveRegistrationsByUserIdAndDriveIds(driveIds, databaseUserId),
        fetchUnlockedPrivateEventApplicationIds(databaseUserId),
      ])
    : [{ data: [], error: null }, { data: new Map(), error: null }, { data: new Set(), error: null }];
  const membershipByOrganizationId = new Map(
    (membershipsResult.data || [])
      .filter((membership) => membership?.is_active)
      .map((membership) => [membership.organization_id, membership])
  );
  const registrationByDriveId = registrationsResult.data || new Map();
  const unlockedPrivateEventApplicationIds = privateAccessResult.data || new Set();

  const normalizedRows = driveRows.map((row) => {
    const membership = membershipByOrganizationId.get(row?.organization_id) || null;
    const registration = registrationByDriveId.get(row?.donation_drive_id) || null;
    return normalizeDonationDrive(
      row,
      organizationsResult.data.get(row?.organization_id) || null,
      registration,
      membership,
    );
  });

  const visibleRows = normalizedRows.filter((drive) => (
    normalizeDriveStatus(drive.status) === 'approved'
    && isUpcomingDrive(drive)
    && isDriveUnlockedForDonor(drive, unlockedPrivateEventApplicationIds)
  ));

  return {
    data: sortDrivesForHome(visibleRows).slice(0, normalizedLimit),
    error: organizationsResult.error || membershipsResult.error || registrationsResult.error || privateAccessResult.error || null,
  };
};

export const fetchDonationDrivePreview = async (driveId, databaseUserId = null) => {
  if (!driveId) {
    return {
      data: null,
      error: new Error('Donation drive ID is required.'),
    };
  }

  logAppEvent('donor_home.drive_preview', 'Loading donation drive preview.', {
    table: donationDriveRequestsTable,
    driveId,
    databaseUserId,
  });

  const driveResult = await supabase
    .from(donationDriveRequestsTable)
    .select(donationDriveSelect)
    .eq('Event_Request_ID', driveId)
    .ilike('Status', 'approved')
    .maybeSingle();

  if (driveResult.error) {
    logAppError('donor_home.drive_preview', driveResult.error, {
      table: donationDriveRequestsTable,
      driveId,
    });

    return {
      data: null,
      error: driveResult.error,
    };
  }

  if (!driveResult.data) {
    return { data: null, error: null };
  }

  const [organizationsResult, registrationResult, membershipResult, privateAccessResult] = await Promise.all([
    fetchOrganizationsByIds(driveResult.data.organization_id ? [driveResult.data.organization_id] : []),
    findExistingDriveRegistration(driveId, databaseUserId),
    fetchOrganizationMembership({
      organizationId: driveResult.data.organization_id || null,
      databaseUserId,
    }),
    fetchUnlockedPrivateEventApplicationIds(databaseUserId),
  ]);

  const previewDrive = normalizeDonationDrive(
    driveResult.data,
    organizationsResult.data.get(driveResult.data.organization_id) || null,
    registrationResult.data || null,
    membershipResult.data || null
  );

  if (!isDriveUnlockedForDonor(previewDrive, privateAccessResult.data || new Set())) {
    return {
      data: null,
      error: null,
    };
  }

  return {
    data: previewDrive,
    error: driveResult.error || organizationsResult.error || registrationResult.error || membershipResult.error || privateAccessResult.error,
  };
};

export const fetchDonationDriveDetail = async (driveId, databaseUserId = null) => (
  fetchDonationDrivePreview(driveId, databaseUserId)
);

export const fetchOrganizationPreview = async (organizationId, databaseUserId = null, driveLimit = 3) => {
  if (!organizationId) {
    return {
      data: null,
      error: new Error('Organization ID is required.'),
    };
  }

  const idText = String(organizationId);
  const numericId = Number(idText.replace(/^user-|^event-/, ''));
  const isEventHost = idText.startsWith('event-') && Number.isFinite(numericId);

  let query = supabase
    .from(donationDriveRequestsTable)
    .select(donationDriveSelect)
    .ilike('Status', 'approved')
    .order('Start_Date', { ascending: true })
    .limit(Math.max(Number(driveLimit) || 3, 1));

  if (isEventHost) {
    query = query.eq('Event_Application_ID', numericId);
  } else {
    return {
      data: null,
      error: null,
    };
  }

  const result = await query;

  if (result.error) {
    logAppError('donor_home.organization_preview', result.error, {
      table: donationDriveRequestsTable,
      organizationId,
      databaseUserId,
    });

    return {
      data: null,
      error: result.error,
    };
  }

  const rows = result.data || [];
  if (!rows.length) {
    return {
      data: null,
      error: null,
    };
  }

  return {
    data: normalizeEventHostOrganization(rows[0], rows),
    error: null,
  };
};

export const fetchOrganizationsWithDrives = async (limit = 24, driveLimitPerOrganization = 3, databaseUserId = null) => {
  const organizationsResult = await fetchFeaturedOrganizations(limit);

  return {
    data: (organizationsResult.data || []).map((organization) => ({
      ...organization,
      drives: (organization.drives || []).slice(0, Math.max(Number(driveLimitPerOrganization) || 3, 1)),
    })),
    error: organizationsResult.error || null,
  };
};

export const fetchRelevantDonationDriveUpdates = async ({
  databaseUserId,
  limit = 12,
}) => {
  if (!databaseUserId) {
    return {
      data: [],
      error: null,
    };
  }

  const registrationsResult = await fetchDonationDriveRegistrationsByUserId(databaseUserId);
  const registrations = registrationsResult.data || [];
  const driveIds = [...new Set(registrations.map((item) => item.donation_drive_id).filter(Boolean))];

  if (!driveIds.length) {
    return {
      data: [],
      error: registrationsResult.error || null,
    };
  }

  const registeredDrivesResult = await supabase
    .from(donationDriveRequestsTable)
    .select(donationDriveSelect)
    .in('Event_Request_ID', driveIds)
    .ilike('Status', 'approved')
    .order('Updated_At', { ascending: false })
    .limit(limit);

  if (registeredDrivesResult.error) {
    logAppError('donor_home.relevant_drive_updates.registrations', registeredDrivesResult.error, {
      table: donationDriveRequestsTable,
      driveIds,
      databaseUserId,
    });
  }

  const rawDrives = registeredDrivesResult.data || [];
  const uniqueDrives = new Map();
  rawDrives.filter(isUpcomingDrive).forEach((row) => {
    const driveId = row?.donation_drive_id;
    if (!driveId) return;
    const existing = uniqueDrives.get(driveId);
    if (!existing || new Date(row?.updated_at || 0).getTime() > new Date(existing?.updated_at || 0).getTime()) {
      uniqueDrives.set(driveId, row);
    }
  });

  const registrationByDriveId = new Map(registrations.map((item) => [item.donation_drive_id, item]));

  return {
    data: sortByNewestTimestamp(
      Array.from(uniqueDrives.values()).map((row) => normalizeDonationDrive(
        row,
        null,
        registrationByDriveId.get(row?.donation_drive_id) || null,
        null
      )),
      ['updated_at', 'start_date']
    ).slice(0, limit),
    error:
      registrationsResult.error
      || registeredDrivesResult.error
      || null,
  };
};

export const fetchRegisteredDonationDrivesByUserId = async ({
  databaseUserId,
  limit = 24,
} = {}) => {
  if (!databaseUserId) {
    return {
      data: [],
      error: null,
    };
  }

  const registrationsResult = await fetchDonationDriveRegistrationsByUserId(databaseUserId);
  const registrations = registrationsResult.data || [];
  const driveIds = [...new Set(registrations.map((item) => item.donation_drive_id).filter(Boolean))];

  if (!driveIds.length) {
    return {
      data: [],
      error: registrationsResult.error || null,
    };
  }

  const normalizedLimit = Math.max(Number(limit) || 24, driveIds.length);
  const registeredDrivesResult = await supabase
    .from(donationDriveRequestsTable)
    .select(donationDriveSelect)
    .in('Event_Request_ID', driveIds)
    .ilike('Status', 'approved')
    .order('Updated_At', { ascending: false })
    .limit(normalizedLimit);

  if (registeredDrivesResult.error) {
    logAppError('donor_home.registered_drives', registeredDrivesResult.error, {
      table: donationDriveRequestsTable,
      driveIds,
      databaseUserId,
    });
  }

  const uniqueDrives = new Map();
  (registeredDrivesResult.data || []).forEach((row) => {
    const driveId = row?.donation_drive_id;
    if (!driveId) return;
    const existing = uniqueDrives.get(driveId);
    if (!existing || new Date(row?.updated_at || 0).getTime() > new Date(existing?.updated_at || 0).getTime()) {
      uniqueDrives.set(driveId, row);
    }
  });

  const registrationByDriveId = new Map(registrations.map((item) => [item.donation_drive_id, item]));

  return {
    data: sortByNewestTimestamp(
      Array.from(uniqueDrives.values()).map((row) => normalizeDonationDrive(
        row,
        null,
        registrationByDriveId.get(row?.donation_drive_id) || null,
        null
      )),
      ['updated_at', 'start_date']
    ).slice(0, Math.max(Number(limit) || 24, 1)),
    error: registrationsResult.error || registeredDrivesResult.error || null,
  };
};
