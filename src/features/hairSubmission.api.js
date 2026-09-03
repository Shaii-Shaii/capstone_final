import { supabase } from '../api/supabase/client';
import { resolveEstimatedLengthCm } from '../utils/hairLength';
import { hairSubmissionStorageBucket } from './hairSubmission.constants';
import { resolveDatabaseUserId } from './profile/api/profile.api';
import { logAppError, logAppEvent } from '../utils/appErrors';

const hairSubmissionsTable = 'Hair_Submissions';
const hairSubmissionDetailsTable = 'Hair_Submission_Details';
const hairSubmissionImagesTable = 'Hair_Submission_Images';
const hairSubmissionLogisticsTable = 'Hair_Submission_Logistics';
const hairBundleTrackingHistoryTable = 'Hair_Bundle_Tracking_History';
const aiScreeningsTable = 'AI_Screenings';
const donationRequirementsTable = 'wig_requirements';
const logisticsSettingsTable = 'Logistics_Settings';
const donationCertificatesTable = 'Donation_Certificates';
const wigsTable = 'Wigs';
const wigAllocationsTable = 'Wig_Allocations';
const hairSubmissionBundlesTable = 'Hair_Submission_Bundles';
const salonDonationAppointmentsTable = 'Salon_Donation_Appointments';
const salonOperatingHoursTable = 'Salon_Operating_Hours';
const salonScheduleOverridesTable = 'Salon_Schedule_Overrides';
const salonAppointmentStatusHistoryTable = 'Salon_Appointment_Status_History';
const CM_PER_INCH = 2.54;

const hairSubmissionSelect = `
  submission_id:Submission_ID,
  user_id:User_ID,
  event_request_id:Event_Request_ID,
  event_attendee_id:Event_Attendee_ID,
  ai_screening_id:AI_Screening_ID,
  from_event:From_Event,
  waybill_code:Waybill_Code,
  donor_notes:Donor_Notes,
  status:Status,
  bundle_id:Bundle_ID,
  cut_at:Cut_At,
  cut_by_user_id:Cut_By_User_ID,
  created_at:Created_At,
  updated_at:Updated_At
`;

const hairSubmissionDetailSelect = `
  submission_detail_id:Submission_Detail_ID,
  submission_id:Submission_ID,
  declared_length:Declared_Length,
  declared_color:Declared_Color,
  declared_texture:Declared_Texture,
  declared_density:Declared_Density,
  declared_condition:Declared_Condition,
  is_chemically_treated:Is_Chemically_Treated,
  is_colored:Is_Colored,
  is_bleached:Is_Bleached,
  is_rebonded:Is_Rebonded,
  detail_notes:Detail_Notes,
  rejection_reason:Rejection_Reason,
  status:Status,
  created_at:Created_At,
  updated_by:Updated_By,
  updated_at:Updated_At
`;

const hairSubmissionImageSelect = `
  image_id:Image_ID,
  submission_detail_id:Submission_Detail_ID,
  file_path:File_Path,
  image_type:Image_Type,
  uploaded_at:Uploaded_At
`;

const aiScreeningSelect = `
  ai_screening_id:AI_Screening_ID,
  user_id:User_ID,
  submission_id:Submission_ID,
  estimated_length:Estimated_Length,
  detected_color:Detected_Color,
  detected_texture:Detected_Texture,
  detected_density:Detected_Density,
  detected_condition:Detected_Condition,
  visible_damage_notes:Visible_Damage_Notes,
  confidence_score:Confidence_Score,
  shine_level:Shine_Level,
  frizz_level:Frizz_Level,
  dryness_level:Dryness_Level,
  oiliness_level:Oiliness_Level,
  damage_level:Damage_Level,
  bald_spots_present:Bald_Spots_Present,
  affected_regions:Affected_Regions,
  hair_density_score:Hair_Density_Score,
  shedding_level:Shedding_Level,
  visible_scalp_area:Visible_Scalp_Area,
  scalp_coverage_notes:Scalp_Coverage_Notes,
  dandruff_detected:Dandruff_Detected,
  dandruff_severity:Dandruff_Severity,
  dandruff_notes:Dandruff_Notes,
  lice_detected:Lice_Detected,
  lice_confidence:Lice_Confidence,
  lice_notes:Lice_Notes,
  improvement_tracking_status:Improvement_Tracking_Status,
  improvement_recommendation:Improvement_Recommendation,
  decision:Decision,
  summary:Summary,
  length_assessment:Length_Assessment,
  donation_readiness_note:Donation_Readiness_Note,
  history_assessment:History_Assessment,
  screening_images:Screening_Images,
  analysis_result:Analysis_Result,
  created_at:Created_At
`;
const aiScreeningSelectWithoutImages = aiScreeningSelect.replace(
  /\s*screening_images:Screening_Images,\s*/,
  '\n'
);

const isMissingScreeningImagesColumnError = (error = null) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703'
    || error?.code === 'PGRST204'
    || (message.includes('screening_images') && (message.includes('column') || message.includes('schema cache')));
};

const donationRequirementSelect = `
  donation_requirement_id:Wig_Requirement_ID,
  minimum_number_donor:Minimum_Number_Donor,
  minimum_hair_length:Minimum_Hair_Length,
  chemical_treatment_status:Chemical_Treatment_Status,
  colored_hair_status:Colored_Hair_Status,
  bleached_hair_status:Bleached_Hair_Status,
  rebonded_hair_status:Rebonded_Hair_Status,
  hair_texture_status:Hair_Texture_Status,
  notes:Notes,
  updated_at:Updated_At,
  updated_by:Updated_By
`;

const hairSubmissionLogisticsSelect = `
  submission_logistics_id:Submission_Logistics_ID,
  submission_id:Submission_ID,
  logistics_type:Logistics_Type,
  shipment_status:Shipment_Status,
  courier_name:Courier_Name,
  tracking_number:Tracking_Number,
  pickup_scheduled_at:Pickup_Scheduled_At,
  pickup_approved_at:Pickup_Approved_At,
  received_by:Received_By,
  received_at:Received_At,
  notes:Notes,
  created_at:Created_At,
  updated_by:Updated_By,
  updated_at:Updated_At
`;

const LOGISTICS_NOTES_PREFIX = '__DONIVRA_LOGISTICS__:';

const parseLogisticsNotes = (value = '') => {
  const raw = String(value || '');
  if (!raw.startsWith(LOGISTICS_NOTES_PREFIX)) return { notes: raw };

  try {
    const parsed = JSON.parse(raw.slice(LOGISTICS_NOTES_PREFIX.length));
    return parsed && typeof parsed === 'object' ? parsed : { notes: '' };
  } catch {
    return { notes: raw };
  }
};

const normalizeLogisticsTypeForDb = (value = '') => {
  const key = normalizeFlowKey(value);
  if (['courier', 'shipping', 'independentshipping'].includes(key)) return 'Courier';
  if (['pickup', 'pickuprequest'].includes(key)) return 'Pickup';
  if (['salondropoff', 'onsitedelivery', 'walkin', 'dropoff'].includes(key)) return 'Salon Dropoff';
  return '';
};

const buildLogisticsWritePayload = (payload = {}, { includeSubmissionId = false } = {}) => {
  const row = {
    Submission_ID: includeSubmissionId ? payload?.submission_id : undefined,
    Logistics_Type: payload?.logistics_type === undefined
      ? undefined
      : normalizeLogisticsTypeForDb(payload.logistics_type),
    Shipment_Status: payload?.shipment_status,
    Courier_Name: payload?.courier_name,
    Tracking_Number: payload?.tracking_number,
    Pickup_Scheduled_At: payload?.pickup_scheduled_at,
    Pickup_Approved_At: payload?.pickup_approved_at,
    Received_By: payload?.received_by,
    Received_At: payload?.received_at,
    Notes: payload?.notes,
    Updated_By: payload?.updated_by,
  };

  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined)
  );
};

const trackingEntrySelect = `
  tracking_id:Tracking_ID,
  submission_id:Submission_ID,
  submission_detail_id:Submission_Detail_ID,
  status:Status,
  title:Title,
  description:Description,
  changed_by:Changed_By,
  updated_at:Updated_At
`;

const logisticsSettingsSelect = `
  logistics_settings_id:Logistics_Settings_ID,
  destination_name:Destination_Name,
  street:Street,
  region:Region,
  barangay:Barangay,
  city:City,
  province:Province,
  country:Country,
  contact_person:Contact_Person,
  contact_number:Contact_Number,
  longitude:Longitude,
  latitude:Latitude,
  updated_at:Updated_At
`;

const donationCertificateSelect = `
  certificate_id:Certificate_ID,
  user_id:User_ID,
  certificate_number:Certificate_Number,
  certificate_type:Certificate_Type,
  file_url:File_URL,
  issued_by:Issued_By,
  issued_at:Issued_At,
  remarks:Remarks,
  submission_id:Submission_ID
`;

const logHairQuery = (source, extras = {}) => {
  logAppEvent('hair_submission.query', 'Hair submission query started.', {
    source,
    ...extras,
  });
};

const waitFor = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const isOptionalRelationReadUnavailableError = (error) => {
  const normalizedMessage = String(error?.message || '').toLowerCase();
  const normalizedCode = String(error?.code || '').trim();

  return (
    normalizedCode === '42P01'
    || normalizedCode === 'PGRST002'
    || normalizedCode === 'PGRST205'
    || normalizedMessage.includes('does not exist')
    || normalizedMessage.includes('could not find the table')
    || normalizedMessage.includes('schema cache')
  );
};

const readOptionalHairSubmissionRelation = async ({
  queryFactory,
  scope,
  table,
  extras = {},
  retryDelayMs = 350,
}) => {
  const firstResult = await queryFactory();

  if (!firstResult.error || !isOptionalRelationReadUnavailableError(firstResult.error)) {
    return firstResult;
  }

  if (firstResult.error?.code === 'PGRST002') {
    await waitFor(retryDelayMs);
    const retryResult = await queryFactory();
    if (!retryResult.error || !isOptionalRelationReadUnavailableError(retryResult.error)) {
      return retryResult;
    }
  }

  logAppEvent(scope, 'Optional hair submission relation could not be read. Continuing with empty related data.', {
    table,
    phase: 'read',
    errorCode: firstResult.error?.code || null,
    ...extras,
  }, 'warn');

  return { data: [], error: null };
};

const getPhilippineDatabaseTimestamp = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

const normalizeSubmissionUserId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeFlowKey = (value = '') => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '')
);

const getDonorNotesSource = (donorNotes = '') => {
  if (typeof donorNotes !== 'string' || !donorNotes.trim()) return '';

  try {
    return String(JSON.parse(donorNotes)?.source || '').trim();
  } catch {
    return '';
  }
};

const resolveHairSubmissionSource = (submission = null) => {
  const explicitSource = String(submission?.donation_source || '').trim();
  if (explicitSource) return explicitSource;

  const notesSource = getDonorNotesSource(submission?.donor_notes || submission?.Donor_Notes || '');
  if (notesSource) return notesSource;

  const isEventLinked = Boolean(
    submission?.from_event
    || submission?.event_request_id
    || submission?.event_attendee_id
  );
  return isEventLinked ? 'drive_donation' : 'Independent';
};

const resolveFromEventForWrite = ({ payload = null, eventRequestId = null, eventAttendeeId = null, fallback }) => {
  if (eventRequestId || eventAttendeeId) return true;
  if (typeof payload?.from_event === 'boolean') return payload.from_event;

  const sourceKey = normalizeFlowKey(payload?.donation_source || '');
  if (['drive', 'drivedonation', 'event', 'eventrsvp', 'eventdonation'].includes(sourceKey)) return true;
  if (['checkhair', 'independent', 'independentdonation', 'manualdonordetails', 'manualentry'].includes(sourceKey)) return false;
  return fallback;
};

export const isHairCheckOnlySubmission = (submission = null) => {
  const sourceKey = normalizeFlowKey(resolveHairSubmissionSource(submission));
  if (sourceKey === 'checkhair') return true;

  const donorNotes = submission?.donor_notes || submission?.Donor_Notes || '';
  if (typeof donorNotes !== 'string' || !donorNotes.trim()) return false;

  try {
    return normalizeFlowKey(JSON.parse(donorNotes)?.source || '') === 'checkhair';
  } catch {
    return donorNotes.toLowerCase().includes('"source":"checkhair"')
      || donorNotes.toLowerCase().includes('"source": "checkhair"');
  }
};

const normalizeHairSubmissionStatusForDb = (status, fallback = 'Pending') => {
  const key = normalizeFlowKey(status);
  if (!key) return fallback;
  if (key === 'pending' || key === 'draft' || key === 'qrgenerated' || key === 'waybillready') return 'Pending';
  if (
    key === 'cut'
    || key === 'submitted'
    || key === 'readyforshipping'
    || key === 'shipped'
    || key === 'intransit'
    || key === 'received'
    || key === 'partiallyreceived'
    || key === 'underreview'
    || key === 'underqareview'
    || key === 'accepted'
    || key === 'partiallyaccepted'
    || key === 'rejected'
  ) return 'Cut';
  if (key === 'wiginproduction' || key === 'inproduction') return 'Wig in Production';
  if (key === 'wigcreated' || key === 'wigcompleted' || key === 'completed') return 'Wig Created';
  if (key === 'cancelled' || key === 'canceled') return 'Cancelled';
  return fallback;
};

const normalizeHairSubmissionDetailStatusForDb = (status, fallback = 'Pending') => {
  const key = normalizeFlowKey(status);
  if (!key) return fallback;
  if (
    key === 'pending'
    || key === 'draft'
    || key === 'qrgenerated'
    || key === 'readyforshipping'
    || key === 'waybillready'
    || key === 'submitted'
    || key === 'shipped'
    || key === 'intransit'
    || key === 'received'
    || key === 'underreview'
    || key === 'underqareview'
  ) return 'Pending';
  if (
    key === 'approved'
    || key === 'accepted'
    || key === 'partiallyaccepted'
    || key === 'cut'
    || key === 'wiginproduction'
    || key === 'inproduction'
    || key === 'wigcreated'
    || key === 'wigcompleted'
    || key === 'completed'
  ) return 'Approved';
  if (key === 'rejectedcut') return 'Rejected Cut';
  if (key === 'rejected' || key === 'cancelled' || key === 'canceled') return 'Rejected';
  return fallback;
};

const nonEmptyString = (value, fallback) => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const numberOrDefault = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isUnclearScreeningValue = (value = '') => {
  const key = normalizeFlowKey(value);
  return (
    !key
    || key === 'unclear'
    || key === 'unknown'
    || key === 'notsure'
    || key === 'notdetected'
    || key === 'notapplicable'
    || key === 'na'
    || key === 'none'
  );
};

const screeningStringOrDefault = (value, fallback) => (
  isUnclearScreeningValue(value) ? fallback : nonEmptyString(value, fallback)
);

const normalizeSheddingLevelForDb = (value, fallback = 'mild') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;

  if (/^(none|no|absent|normal)$/.test(normalized) || /\b(no|without)\s+(visible\s+)?(hair\s+)?(fall|loss|shedding)\b/.test(normalized)) {
    return 'none';
  }
  if (/^(mild|low|minimal|slight|light)$/.test(normalized) || /\b(mild|low|minimal|slight|light)\b/.test(normalized)) {
    return 'mild';
  }
  if (/^(moderate|medium|average)$/.test(normalized) || /\b(moderate|medium|average)\b/.test(normalized)) {
    return 'moderate';
  }
  if (/^(severe|high|heavy|excessive|significant)$/.test(normalized) || /\b(severe|high|heavy|excessive|significant)\b/.test(normalized)) {
    return 'severe';
  }

  return fallback;
};

const normalizeAiScreeningInsertPayload = (payload = {}) => {
  const estimatedLength = resolveEstimatedLengthCm(payload) ?? 0;
  const normalizedPayload = {
    ...payload,
    estimated_length: estimatedLength,
    detected_color: screeningStringOrDefault(payload?.detected_color, 'Black'),
    detected_texture: screeningStringOrDefault(payload?.detected_texture, 'Straight'),
    detected_density: screeningStringOrDefault(payload?.detected_density, 'Medium'),
    detected_condition: screeningStringOrDefault(payload?.detected_condition, 'Needs manual hair review'),
    shedding_level: normalizeSheddingLevelForDb(payload?.shedding_level),
    visible_scalp_area: screeningStringOrDefault(payload?.visible_scalp_area, 'low'),
  };

  return {
    ...normalizedPayload,
    confidence_score: confidenceForAiScreening(normalizedPayload),
  };
};

const confidenceForAiScreening = (payload = {}) => {
  const confidence = numberOrDefault(payload?.confidence_score, 0);
  const estimatedLength = numberOrDefault(payload?.estimated_length, 0);
  const violatesConfidentScreeningRule = (
    isUnclearScreeningValue(payload?.detected_color)
    || isUnclearScreeningValue(payload?.detected_texture)
    || isUnclearScreeningValue(payload?.detected_density)
    || estimatedLength <= 0
  );

  return violatesConfidentScreeningRule
    ? Math.min(confidence, 0.59)
    : confidence;
};

const levelOrDefault = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(10, Math.max(1, Math.round(parsed)));
};

const densityScoreOrDefault = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(0, parsed));
};

const stringArrayOrDefault = (value, fallback = ['none']) => (
  Array.isArray(value) && value.length
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : fallback
);

const resolveSubmissionUserId = async (userId, databaseUserId = null) => {
  const explicitDatabaseUserId = normalizeSubmissionUserId(databaseUserId);
  if (explicitDatabaseUserId) {
    return {
      userId: explicitDatabaseUserId,
      error: null,
    };
  }

  const directUserId = normalizeSubmissionUserId(userId);
  if (directUserId) {
    return {
      userId: directUserId,
      error: null,
    };
  }

  const result = await resolveDatabaseUserId(userId, { ensure: false });
  if (result.error || !result.data) {
    return {
      userId: null,
      error: result.error || new Error('The logged-in account is not linked to a donor record.'),
    };
  }

  return {
    userId: result.data,
    error: null,
  };
};

const createDonationCertificateNumber = (submission = null) => {
  const submissionPart = String(submission?.donation_reference || submission?.submission_id || Date.now())
    .replace(/[^a-z0-9]+/gi, '')
    .slice(-10)
    .toUpperCase();
  const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DON-CERT-${submissionPart || Date.now().toString(36).toUpperCase()}-${randomPart}`;
};

const isEventSubmissionCutAndShipComplete = (submission = null) => {
  const statusKey = normalizeFlowKey(submission?.status || submission?.Status || '');
  return [
    'cut',
    'wiginproduction',
    'inproduction',
    'wigcreated',
    'wigcompleted',
    'completed',
  ].includes(statusKey);
};

const hasDetailDonationProgress = (detail = null) => {
  const statusKey = normalizeFlowKey(detail?.current_tracking_status || detail?.status || '');
  const qrStatusKey = normalizeFlowKey(detail?.qr_status || '');

  return Boolean(
    detail?.qr_token
    || detail?.qr_image_path
    || detail?.qr_generated_at
    || [
      'qrgenerated',
      'scanned',
      'qractive',
      'activated',
      'readyforshipping',
      'submitted',
      'shipped',
      'intransit',
      'received',
      'underreview',
      'underqareview',
      'accepted',
      'rejected',
      'rejectedcut',
    ].includes(qrStatusKey)
    || [
      'readyforshipping',
      'submitted',
      'shipped',
      'intransit',
      'received',
      'underreview',
      'underqareview',
      'accepted',
      'rejected',
      'rejectedcut',
    ].includes(statusKey)
  );
};

export const hasDonationFlowProgress = (submission = null, {
  logistics = null,
  trackingEntries = [],
} = {}) => {
  if (!submission?.submission_id) return false;
  if (isHairCheckOnlySubmission(submission)) return false;

  const statusKey = normalizeFlowKey(submission?.status || '');
  if (['cancelled', 'canceled', 'rejected'].includes(statusKey)) return false;

  const details = Array.isArray(submission?.submission_details)
    ? submission.submission_details
    : [];
  const hasLogisticsProgress = Boolean(
    logistics?.submission_logistics_id
    || logistics?.received_at
    || logistics?.shipment_status
    || logistics?.logistics_type
  );

  return Boolean(
    submission?.cut_at
    || submission?.bundle_id
    || isEventSubmissionCutAndShipComplete(submission)
    || details.some(hasDetailDonationProgress)
    || hasLogisticsProgress
    || (trackingEntries || []).some((entry) => entry?.tracking_id || entry?.status || entry?.title)
  );
};

export const isCompletedDonationSubmission = (submission = null, {
  logistics = null,
  trackingEntries = [],
} = {}) => {
  if (!submission?.submission_id) return false;
  if (isHairCheckOnlySubmission(submission)) return false;

  const statusKey = normalizeFlowKey(submission?.status || '');
  if (['cancelled', 'canceled', 'rejected'].includes(statusKey)) return false;

  const hasReceivedLogistics = Boolean(
    logistics?.received_at
    || normalizeFlowKey(logistics?.shipment_status || '').includes('received')
  );

  return Boolean(
    submission?.cut_at
    || submission?.bundle_id
    || isEventSubmissionCutAndShipComplete(submission)
    || hasReceivedLogistics
    || (trackingEntries || []).some((entry) => {
      const entryText = normalizeFlowKey([
        entry?.status,
        entry?.title,
        entry?.description,
      ].filter(Boolean).join(' '));
      return entryText.includes('received') || entryText.includes('accepted') || entryText.includes('cut');
    })
  );
};

const normalizeAiScreening = (row) => {
  const analysisResult = row?.analysis_result
    && typeof row.analysis_result === 'object'
    && !Array.isArray(row.analysis_result)
    ? row.analysis_result
    : {};
  const storedCareTips = Array.isArray(analysisResult?.recommendations)
    ? analysisResult.recommendations
    : Array.isArray(analysisResult?.care_tips)
      ? analysisResult.care_tips
      : [];

  const screening = ({
  ...analysisResult,
  id: row?.ai_screening_id || analysisResult?.ai_screening_id || null,
  ai_screening_id: row?.ai_screening_id || null,
  user_id: row?.user_id || null,
  submission_id: row?.submission_id || null,
  submission_detail_id: row?.submission_detail_id || null,
  estimated_length: row?.estimated_length ?? null,
  detected_color: row?.detected_color || '',
  detected_texture: row?.detected_texture || '',
  detected_density: row?.detected_density || '',
  detected_condition: row?.detected_condition || '',
  visible_damage_notes: row?.visible_damage_notes || '',
  confidence_score: row?.confidence_score ?? null,
  shine_level: row?.shine_level ?? null,
  frizz_level: row?.frizz_level ?? null,
  dryness_level: row?.dryness_level ?? null,
  oiliness_level: row?.oiliness_level ?? null,
  damage_level: row?.damage_level ?? null,
  bald_spots_present: row?.bald_spots_present === true,
  affected_regions: Array.isArray(row?.affected_regions) ? row.affected_regions : [],
  hair_density_score: row?.hair_density_score ?? null,
  shedding_level: row?.shedding_level || '',
  visible_scalp_area: row?.visible_scalp_area || '',
  scalp_coverage_notes: row?.scalp_coverage_notes || '',
  dandruff_detected: row?.dandruff_detected === true,
  dandruff_severity: row?.dandruff_severity || '',
  dandruff_notes: row?.dandruff_notes || '',
  lice_detected: row?.lice_detected === true,
  lice_confidence: row?.lice_confidence || '',
  lice_notes: row?.lice_notes || '',
  improvement_tracking_status: row?.improvement_tracking_status || '',
  improvement_recommendation: row?.improvement_recommendation || '',
  decision: row?.decision || '',
  summary: row?.summary || '',
  length_assessment: row?.length_assessment || analysisResult?.length_assessment || '',
  donation_readiness_note: row?.donation_readiness_note || analysisResult?.donation_readiness_note || '',
  history_assessment: row?.history_assessment || analysisResult?.history_assessment || '',
  screening_images: Array.isArray(row?.screening_images) ? row.screening_images : [],
  recommendations: storedCareTips,
  care_tips: storedCareTips,
  analysis_result: analysisResult,
  created_at: row?.created_at || null,
  });

  return {
    ...screening,
    estimated_length: resolveEstimatedLengthCm(screening),
  };
};

const normalizeHairSubmission = (row) => {
  const aiScreenings = Array.isArray(row?.ai_screenings)
    ? row.ai_screenings.map(normalizeAiScreening)
    : row?.ai_screenings
      ? [normalizeAiScreening(row.ai_screenings)]
      : [];
  return ({
  id: row?.submission_id || null,
  submission_id: row?.submission_id || null,
  user_id: row?.user_id || null,
  event_request_id: row?.event_request_id || null,
  donation_drive_id: row?.event_request_id || row?.donation_drive_id || null,
  event_attendee_id: row?.event_attendee_id || null,
  ai_screening_id: row?.ai_screening_id || null,
  waybill_code: row?.waybill_code || '',
  donation_reference: row?.waybill_code || (row?.submission_id ? `DON-${row.submission_id}` : ''),
  from_event: row?.from_event ?? null,
  // The database has no separate source column. Keep this app-facing value derived
  // from persisted event links and the optional source stored in Donor_Notes.
  donation_source: resolveHairSubmissionSource(row),
  donor_notes: row?.donor_notes || '',
  recipient_type: row?.recipient_type || '',
  bundle_id: row?.bundle_id || null,
  cut_at: row?.cut_at || null,
  cut_by_user_id: row?.cut_by_user_id || null,
  submitted_at: row?.submitted_at || row?.cut_at || null,
  cancelled_at: row?.cancelled_at || null,
  status: row?.status || '',
  created_at: row?.created_at || null,
  updated_at: row?.updated_at || null,
  ai_screenings: aiScreenings,
  submission_details: Array.isArray(row?.submission_details)
    ? row.submission_details.map(normalizeHairSubmissionDetail)
    : [],
  });
};

const normalizeHairSubmissionDetail = (row) => ({
  id: row?.submission_detail_id || null,
  submission_detail_id: row?.submission_detail_id || null,
  submission_id: row?.submission_id || null,
  declared_length: row?.declared_length ?? null,
  declared_color: row?.declared_color || '',
  declared_texture: row?.declared_texture || '',
  declared_density: row?.declared_density || '',
  declared_condition: row?.declared_condition || '',
  is_chemically_treated: Boolean(row?.is_chemically_treated),
  is_colored: Boolean(row?.is_colored),
  is_bleached: Boolean(row?.is_bleached),
  is_rebonded: Boolean(row?.is_rebonded),
  detail_notes: row?.detail_notes || '',
  hair_item_code: row?.hair_item_code || '',
  hair_owner_type: row?.hair_owner_type || 'Self',
  hair_owner_display_name: row?.hair_owner_display_name || '',
  relationship_to_submitter: row?.relationship_to_submitter || '',
  input_method: row?.input_method || 'Manual',
  consent_confirmed: Boolean(row?.consent_confirmed),
  consent_confirmed_at: row?.consent_confirmed_at || null,
  qr_token: row?.qr_token || '',
  qr_image_path: row?.qr_image_path || '',
  qr_status: row?.qr_status || '',
  qr_generated_at: row?.qr_generated_at || null,
  current_tracking_status: row?.current_tracking_status || '',
  rejection_reason: row?.rejection_reason || '',
  status: row?.status || '',
  created_at: row?.created_at || null,
  updated_by: row?.updated_by || null,
  updated_at: row?.updated_at || row?.created_at || null,
  images: Array.isArray(row?.images) ? row.images.map(normalizeHairSubmissionImage) : [],
});

const normalizeHairSubmissionImage = (row) => ({
  id: row?.image_id || null,
  image_id: row?.image_id || null,
  submission_detail_id: row?.submission_detail_id || null,
  file_path: row?.file_path || '',
  image_type: row?.image_type || '',
  uploaded_at: row?.uploaded_at || null,
});

const normalizeHairSubmissionLogistics = (row) => {
  const metadata = parseLogisticsNotes(row?.notes);
  return ({
  id: row?.submission_logistics_id || null,
  submission_logistics_id: row?.submission_logistics_id || null,
  submission_id: row?.submission_id || null,
  logistics_type: row?.logistics_type || '',
  courier_name: row?.courier_name || metadata?.courier_name || '',
  tracking_number: row?.tracking_number || metadata?.tracking_number || '',
  shipment_status: row?.shipment_status || '',
  pickup_scheduled_at: row?.pickup_scheduled_at || metadata?.pickup_scheduled_at || null,
  pickup_approved_at: row?.pickup_approved_at || metadata?.pickup_approved_at || null,
  received_by: row?.received_by || null,
  received_at: row?.received_at || null,
  notes: metadata?.notes || '',
  created_at: row?.created_at || null,
  updated_by: row?.updated_by || null,
  updated_at: row?.updated_at || row?.created_at || null,
  });
};

const normalizeTrackingEntry = (row) => ({
  id: row?.tracking_id || null,
  tracking_id: row?.tracking_id || null,
  submission_id: row?.submission_id || null,
  submission_detail_id: row?.submission_detail_id || null,
  status: row?.status || '',
  title: row?.title || '',
  description: row?.description || '',
  changed_by: row?.changed_by || null,
  updated_at: row?.updated_at || null,
});

const normalizeRequirementLength = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeDonationRequirement = (row) => {
  const minimumHairLengthInches = normalizeRequirementLength(row?.minimum_hair_length);
  const minimumHairLengthCm = minimumHairLengthInches != null
    ? Number((minimumHairLengthInches * CM_PER_INCH).toFixed(2))
    : null;

  return ({
  id: row?.donation_requirement_id || null,
  donation_requirement_id: row?.donation_requirement_id || null,
  minimum_number_donor: row?.minimum_number_donor ?? null,
  minimum_hair_length: row?.minimum_hair_length ?? null,
  minimum_hair_length_inches: minimumHairLengthInches,
  minimum_hair_length_cm: minimumHairLengthCm,
  chemical_treatment_status: row?.chemical_treatment_status ?? null,
  colored_hair_status: row?.colored_hair_status ?? null,
  bleached_hair_status: row?.bleached_hair_status ?? null,
  rebonded_hair_status: row?.rebonded_hair_status ?? null,
  hair_texture_status: row?.hair_texture_status || '',
  notes: row?.notes || '',
  updated_at: row?.updated_at || null,
  updated_by: row?.updated_by || null,
  });
};

const normalizeLogisticsSettings = (row) => ({
  id: row?.logistics_settings_id || null,
  logistics_settings_id: row?.logistics_settings_id || null,
  destination_name: row?.destination_name || '',
  street: row?.street || '',
  region: row?.region || '',
  barangay: row?.barangay || '',
  city: row?.city || '',
  province: row?.province || '',
  country: row?.country || '',
  contact_person: row?.contact_person || '',
  contact_number: row?.contact_number || '',
  longitude: row?.longitude ?? null,
  latitude: row?.latitude ?? null,
  updated_at: row?.updated_at || null,
});

const normalizeDonationCertificate = (row) => ({
  id: row?.certificate_id || null,
  certificate_id: row?.certificate_id || null,
  user_id: row?.user_id || null,
  certificate_number: row?.certificate_number || '',
  certificate_type: row?.certificate_type || '',
  file_url: row?.file_url || '',
  issued_by: row?.issued_by || null,
  issued_at: row?.issued_at || null,
  remarks: row?.remarks || '',
  submission_id: row?.submission_id || null,
});

export const createHairSubmission = async (payload) => {
  const { userId, error } = await resolveSubmissionUserId(payload?.user_id, payload?.database_user_id);
  if (error) {
    return { data: null, error };
  }

  logAppEvent('hair_submission.query', 'Numeric donor user id resolved for submission create.', {
    authUserId: payload?.user_id || null,
    databaseUserId: payload?.database_user_id || null,
    resolvedUserId: userId,
  });

  logHairQuery('createHairSubmission', {
    table: hairSubmissionsTable,
    phase: 'create',
    userId,
    columns: ['User_ID', 'AI_Screening_ID', 'Event_Request_ID', 'Event_Attendee_ID', 'From_Event', 'Donor_Notes', 'Status', 'Cut_At', 'Cut_By_User_ID'],
  });

  let eventRequestId = payload?.event_request_id || payload?.donation_drive_id || null;
  const eventAttendeeId = payload?.event_attendee_id || payload?.registration_id || null;

  // If caller only passes Event_Attendee_ID, resolve Event_Request_ID first so
  // event-linked submissions always target the same singleton row.
  if (!eventRequestId && eventAttendeeId) {
    const attendeeLookup = await supabase
      .from('Event_Attendees')
      .select('Event_Request_ID')
      .eq('Event_Attendee_ID', eventAttendeeId)
      .maybeSingle();

    if (!attendeeLookup.error && attendeeLookup.data?.Event_Request_ID) {
      eventRequestId = attendeeLookup.data.Event_Request_ID;
    }
  }

  const insertPayload = {
    User_ID: userId,
    AI_Screening_ID: payload?.ai_screening_id || null,
    Event_Request_ID: eventRequestId,
    From_Event: resolveFromEventForWrite({
      payload,
      eventRequestId,
      eventAttendeeId,
      fallback: false,
    }),
    Donor_Notes: payload?.donor_notes || null,
    Status: normalizeHairSubmissionStatusForDb(payload?.status, 'Pending'),
    Cut_At: payload?.cut_at || payload?.submitted_at || null,
    Cut_By_User_ID: payload?.cut_by_user_id || null,
    Created_At: getPhilippineDatabaseTimestamp(),
    Updated_At: getPhilippineDatabaseTimestamp(),
  };

  if (eventAttendeeId) {
    insertPayload.Event_Attendee_ID = eventAttendeeId;
  }

  const query = eventAttendeeId
    ? supabase
      .from(hairSubmissionsTable)
      .upsert([insertPayload], { onConflict: 'Event_Attendee_ID' })
    : eventRequestId
      ? supabase
        .from(hairSubmissionsTable)
        .upsert([insertPayload], { onConflict: 'User_ID,Event_Request_ID' })
      : supabase
        .from(hairSubmissionsTable)
        .insert([insertPayload]);

  const result = await query
    .select(hairSubmissionSelect)
    .single();

  return {
    data: result.data ? normalizeHairSubmission(result.data) : null,
    error: result.error,
  };
};

export const createHairSubmissionDetail = async (payload) => {
  logHairQuery('createHairSubmissionDetail', {
    table: hairSubmissionDetailsTable,
    phase: 'create',
    filters: { Submission_ID: payload?.submission_id },
    columns: ['Submission_ID', 'Declared_Length', 'Declared_Texture', 'Declared_Density', 'Declared_Condition', 'Detail_Notes', 'Status'],
  });

  const result = await supabase
    .from(hairSubmissionDetailsTable)
    .upsert([{
      Submission_ID: payload?.submission_id || null,
      Declared_Length: payload?.declared_length ?? null,
      Declared_Color: payload?.declared_color || null,
      Declared_Texture: payload?.declared_texture || null,
      Declared_Density: payload?.declared_density || null,
      Declared_Condition: payload?.declared_condition || null,
      Is_Chemically_Treated: payload?.is_chemically_treated ?? false,
      Is_Colored: payload?.is_colored ?? false,
      Is_Bleached: payload?.is_bleached ?? false,
      Is_Rebonded: payload?.is_rebonded ?? false,
      Detail_Notes: payload?.detail_notes || null,
      Rejection_Reason: payload?.rejection_reason || null,
      Status: normalizeHairSubmissionDetailStatusForDb(payload?.status),
      Updated_By: payload?.updated_by || null,
      Created_At: getPhilippineDatabaseTimestamp(),
      Updated_At: getPhilippineDatabaseTimestamp(),
    }], { onConflict: 'Submission_ID' })
    .select(hairSubmissionDetailSelect)
    .single();

  return {
    data: result.data ? normalizeHairSubmissionDetail(result.data) : null,
    error: result.error,
  };
};

export const updateHairSubmissionDetailById = async (submissionDetailId, payload) => {
  if (!submissionDetailId) {
    return { data: null, error: new Error('Submission detail ID is required.') };
  }

  logHairQuery('updateHairSubmissionDetailById', {
    table: hairSubmissionDetailsTable,
    phase: 'update',
    filters: { Submission_Detail_ID: submissionDetailId },
    columns: ['Declared_Length', 'Declared_Color', 'Declared_Texture', 'Declared_Density', 'Declared_Condition', 'Detail_Notes', 'Status'],
  });

  const result = await supabase
    .from(hairSubmissionDetailsTable)
    .update({
      Declared_Length: payload?.declared_length ?? undefined,
      Declared_Color: payload?.declared_color ?? undefined,
      Declared_Texture: payload?.declared_texture ?? undefined,
      Declared_Density: payload?.declared_density ?? undefined,
      Declared_Condition: payload?.declared_condition ?? undefined,
      Is_Chemically_Treated: payload?.is_chemically_treated ?? undefined,
      Is_Colored: payload?.is_colored ?? undefined,
      Is_Bleached: payload?.is_bleached ?? undefined,
      Is_Rebonded: payload?.is_rebonded ?? undefined,
      Detail_Notes: payload?.detail_notes ?? undefined,
      Rejection_Reason: payload?.rejection_reason ?? undefined,
      Status: payload?.status == null ? undefined : normalizeHairSubmissionDetailStatusForDb(payload.status),
      Updated_By: payload?.updated_by ?? undefined,
      Updated_At: getPhilippineDatabaseTimestamp(),
    })
    .eq('Submission_Detail_ID', submissionDetailId)
    .select(hairSubmissionDetailSelect)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmissionDetail(result.data) : null,
    error: result.error,
  };
};

export const createHairSubmissionImages = async (rows) => {
  const insertRows = rows.map((row) => ({
    Submission_Detail_ID: row?.submission_detail_id || null,
    File_Path: row?.file_path || null,
    Image_Type: row?.image_type || null,
    Uploaded_At: getPhilippineDatabaseTimestamp(),
  }));

  logHairQuery('createHairSubmissionImages', {
    table: hairSubmissionImagesTable,
    phase: 'create',
    rowCount: insertRows.length,
    columns: ['Submission_Detail_ID', 'File_Path', 'Image_Type'],
  });

  return await supabase
    .from(hairSubmissionImagesTable)
    .insert(insertRows)
    .select(hairSubmissionImageSelect);
};

export const createAiScreening = async (payload) => {
  const screeningPayload = normalizeAiScreeningInsertPayload(payload);
  const resolvedUser = await resolveSubmissionUserId(payload?.user_id, payload?.database_user_id);
  if (resolvedUser.error || !resolvedUser.userId) {
    return {
      data: null,
      error: resolvedUser.error || new Error('A donor is required for AI screening.'),
    };
  }

  logHairQuery('createAiScreening', {
    table: aiScreeningsTable,
    phase: 'create',
    filters: { User_ID: resolvedUser.userId, Submission_ID: payload?.submission_id || null },
    columns: ['User_ID', 'Submission_ID', 'Estimated_Length', 'Detected_Color', 'Detected_Texture', 'Detected_Density', 'Detected_Condition', 'Visible_Damage_Notes', 'Confidence_Score', 'Shine_Level', 'Frizz_Level', 'Dryness_Level', 'Oiliness_Level', 'Damage_Level', 'Bald_Spots_Present', 'Affected_Regions', 'Hair_Density_Score', 'Shedding_Level', 'Visible_Scalp_Area', 'Scalp_Coverage_Notes', 'Dandruff_Detected', 'Dandruff_Severity', 'Dandruff_Notes', 'Lice_Detected', 'Lice_Confidence', 'Lice_Notes', 'Improvement_Tracking_Status', 'Improvement_Recommendation', 'Decision', 'Summary', 'Length_Assessment', 'Donation_Readiness_Note', 'History_Assessment', 'Screening_Images', 'Analysis_Result'],
  });

  const insertRow = {
      User_ID: resolvedUser.userId,
      Submission_ID: payload?.submission_id || null,
      Estimated_Length: screeningPayload.estimated_length,
      Detected_Color: screeningPayload.detected_color,
      Detected_Texture: screeningPayload.detected_texture,
      Detected_Density: screeningPayload.detected_density,
      Detected_Condition: screeningPayload.detected_condition,
      Visible_Damage_Notes: nonEmptyString(payload?.visible_damage_notes, 'No visible damage notes reported.'),
      Confidence_Score: screeningPayload.confidence_score,
      Shine_Level: levelOrDefault(payload?.shine_level, 5),
      Frizz_Level: levelOrDefault(payload?.frizz_level, 5),
      Dryness_Level: levelOrDefault(payload?.dryness_level, 5),
      Oiliness_Level: levelOrDefault(payload?.oiliness_level, 5),
      Damage_Level: levelOrDefault(payload?.damage_level, 5),
      Bald_Spots_Present: payload?.bald_spots_present === true,
      Affected_Regions: stringArrayOrDefault(payload?.affected_regions),
      Hair_Density_Score: densityScoreOrDefault(payload?.hair_density_score),
      Shedding_Level: screeningPayload.shedding_level,
      Visible_Scalp_Area: screeningPayload.visible_scalp_area,
      Scalp_Coverage_Notes: nonEmptyString(payload?.scalp_coverage_notes, 'No clear scalp coverage issue was reported.'),
      Dandruff_Detected: payload?.dandruff_detected === true,
      Dandruff_Severity: screeningStringOrDefault(payload?.dandruff_severity, payload?.dandruff_detected === true ? 'mild' : 'none'),
      Dandruff_Notes: nonEmptyString(payload?.dandruff_notes, payload?.dandruff_detected === true
        ? 'Dandruff-like flakes were observed in the uploaded scalp or root views.'
        : 'No visible dandruff-like flakes were observed in the uploaded views.'),
      Lice_Detected: payload?.lice_detected === true,
      Lice_Confidence: screeningStringOrDefault(payload?.lice_confidence, payload?.lice_detected === true ? 'medium' : 'none'),
      Lice_Notes: nonEmptyString(payload?.lice_notes, payload?.lice_detected === true
        ? 'Visible lice or nit-like signs were observed; this screening is not a medical diagnosis.'
        : 'No visible lice or nit-like signs were observed in the uploaded views.'),
      Improvement_Tracking_Status: nonEmptyString(payload?.improvement_tracking_status, 'Needs improvement tracking'),
      Improvement_Recommendation: nonEmptyString(payload?.improvement_recommendation, 'Keep tracking hair length and condition with future CheckHair scans before donating.'),
      Decision: nonEmptyString(payload?.decision, 'Improve hair condition'),
      Summary: nonEmptyString(payload?.summary, 'Hair analysis completed with limited details. Final screening requires manual review.'),
      Length_Assessment: nonEmptyString(payload?.length_assessment, ''),
      Donation_Readiness_Note: nonEmptyString(payload?.donation_readiness_note, ''),
      History_Assessment: nonEmptyString(payload?.history_assessment, ''),
      Screening_Images: Array.isArray(payload?.screening_images) ? payload.screening_images : [],
      Analysis_Result: payload?.analysis_result
        && typeof payload.analysis_result === 'object'
        && !Array.isArray(payload.analysis_result)
        ? payload.analysis_result
        : {},
      Created_At: getPhilippineDatabaseTimestamp(),
    };
  const query = payload?.submission_id
    ? supabase.from(aiScreeningsTable).upsert([insertRow], { onConflict: 'Submission_ID' })
    : supabase.from(aiScreeningsTable).insert([insertRow]);
  const result = await query
    .select(aiScreeningSelect)
    .single();

  return {
    data: result.data ? normalizeAiScreening(result.data) : null,
    error: result.error,
  };
};

export const fetchLatestDonationRequirement = async () => {
  logHairQuery('fetchLatestDonationRequirement', {
    table: donationRequirementsTable,
    phase: 'read',
    columns: [
      'Wig_Requirement_ID',
      'Minimum_Number_Donor',
      'Minimum_Hair_Length',
      'Chemical_Treatment_Status',
      'Colored_Hair_Status',
      'Bleached_Hair_Status',
      'Rebonded_Hair_Status',
      'Hair_Texture_Status',
      'Notes',
      'Updated_At',
      'Updated_By',
    ],
  });

  const result = await supabase
    .from(donationRequirementsTable)
    .select(donationRequirementSelect)
    .order('Updated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    logAppError('hair_submission.requirements.read_failed', result.error, {
      table: donationRequirementsTable,
    });
  }

  return {
    data: result.data ? normalizeDonationRequirement(result.data) : null,
    error: result.error,
  };
};

export const fetchLatestLogisticsSettings = async () => {
  logHairQuery('fetchLatestLogisticsSettings', {
    table: logisticsSettingsTable,
    phase: 'read',
    columns: [
      'Logistics_Settings_ID',
      'Destination_Name',
      'Street',
      'Region',
      'Barangay',
      'City',
      'Province',
      'Country',
      'Contact_Person',
      'Contact_Number',
      'Longitude',
      'Latitude',
      'Updated_At',
    ],
  });

  const result = await supabase
    .from(logisticsSettingsTable)
    .select(logisticsSettingsSelect)
    .order('Updated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: result.data ? normalizeLogisticsSettings(result.data) : null,
    error: result.error,
  };
};

export const fetchUpcomingHaircutSchedules = async (limit = 3) => {
  logHairQuery('fetchUpcomingHaircutSchedules', {
    table: salonOperatingHoursTable,
    phase: 'read',
    columns: [
      'Operating_Hours_ID',
      'Day_Group',
      'Is_Open',
      'Opening_Time',
      'Closing_Time',
      'Break_Start_Time',
      'Break_End_Time',
      'Appointment_Duration_Minutes',
      'Buffer_Minutes',
      'Capacity_Per_Slot',
      'Minimum_Booking_Notice_Days',
      'Maximum_Booking_Days',
    ],
    limit,
  });

  const result = await supabase
    .from(salonOperatingHoursTable)
    .select(`
      schedule_id:Operating_Hours_ID,
      day_group:Day_Group,
      is_open:Is_Open,
      opening_time:Opening_Time,
      closing_time:Closing_Time,
      break_start_time:Break_Start_Time,
      break_end_time:Break_End_Time,
      appointment_duration_minutes:Appointment_Duration_Minutes,
      buffer_minutes:Buffer_Minutes,
      capacity_per_slot:Capacity_Per_Slot,
      minimum_booking_notice_days:Minimum_Booking_Notice_Days,
      maximum_booking_days:Maximum_Booking_Days,
      updated_at:Updated_At
    `)
    .eq('Is_Open', true)
    .order('Day_Group', { ascending: true })
    .limit(Math.max(1, Number(limit) || 3));

  return { data: result.data || [], error: result.error };
};

export const fetchLatestHaircutReservationByUserId = async (userId) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) {
    return { data: null, error: resolvedUserId.error };
  }

  logHairQuery('fetchLatestHaircutReservationByUserId', {
    table: salonDonationAppointmentsTable,
    phase: 'read',
    filters: { User_ID: resolvedUserId.userId },
    columns: [
      'Appointment_ID',
      'User_ID',
      'Hair_Submission_ID',
      'Appointment_Start_At',
      'Appointment_End_At',
      'Status',
      'Created_At',
      'Updated_At',
    ],
  });

  const result = await supabase
    .from(salonDonationAppointmentsTable)
    .select(`
      reservation_id:Appointment_ID,
      appointment_id:Appointment_ID,
      user_id:User_ID,
      submission_id:Hair_Submission_ID,
      appointment_start_at:Appointment_Start_At,
      appointment_end_at:Appointment_End_At,
      status:Status,
      created_at:Created_At,
      updated_at:Updated_At
    `)
    .eq('User_ID', resolvedUserId.userId)
    .in('Status', ['Confirmed', 'Rescheduled', 'Checked In'])
    .order('Appointment_Start_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { data: result.data || null, error: result.error };
};

export const fetchLatestDonationCertificateByUserId = async (userId) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) {
    return { data: null, error: resolvedUserId.error };
  }

  logHairQuery('fetchLatestDonationCertificateByUserId', {
    table: donationCertificatesTable,
    phase: 'read',
    filters: { User_ID: resolvedUserId.userId },
    columns: ['Certificate_ID', 'User_ID', 'Certificate_Number', 'Certificate_Type', 'File_URL', 'Issued_At', 'Submission_ID'],
  });

  const result = await supabase
    .from(donationCertificatesTable)
    .select(donationCertificateSelect)
    .eq('User_ID', resolvedUserId.userId)
    .order('Issued_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: result.data ? normalizeDonationCertificate(result.data) : null,
    error: result.error,
  };
};

export const fetchDonationCertificateBySubmissionId = async (submissionId) => {
  if (!submissionId) {
    return { data: null, error: null };
  }

  logHairQuery('fetchDonationCertificateBySubmissionId', {
    table: donationCertificatesTable,
    phase: 'read',
    filters: { Submission_ID: submissionId },
    columns: ['Certificate_ID', 'User_ID', 'Certificate_Number', 'Certificate_Type', 'File_URL', 'Issued_At', 'Submission_ID'],
  });

  const result = await supabase
    .from(donationCertificatesTable)
    .select(donationCertificateSelect)
    .eq('Submission_ID', submissionId)
    .order('Issued_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: result.data ? normalizeDonationCertificate(result.data) : null,
    error: result.error,
  };
};

export const createDonationCertificate = async (payload = {}) => {
  const { userId, error } = await resolveSubmissionUserId(payload?.user_id, payload?.database_user_id);
  if (error) {
    return { data: null, error };
  }

  logHairQuery('createDonationCertificate', {
    table: donationCertificatesTable,
    phase: 'create',
    filters: { User_ID: userId, Submission_ID: payload?.submission_id || null },
    columns: ['User_ID', 'Certificate_Number', 'Certificate_Type', 'File_URL', 'Issued_By', 'Issued_At', 'Remarks', 'Submission_ID'],
  });

  const insertPayload = {
    User_ID: userId,
    Certificate_Number: payload?.certificate_number || null,
    Certificate_Type: payload?.certificate_type || 'Certificate of Donation',
    File_URL: payload?.file_url || null,
    Issued_By: payload?.issued_by || null,
    Issued_At: payload?.issued_at || getPhilippineDatabaseTimestamp(),
    Remarks: payload?.remarks || null,
    Submission_ID: payload?.submission_id || null,
  };

  const result = await supabase
    .from(donationCertificatesTable)
    .insert(insertPayload)
    .select(donationCertificateSelect)
    .single();

  return {
    data: result.data ? normalizeDonationCertificate(result.data) : null,
    error: result.error,
  };
};

export const fetchDonationCertificatesByUserId = async (userId, limit = 20) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) {
    return { data: [], error: resolvedUserId.error };
  }

  logHairQuery('fetchDonationCertificatesByUserId', {
    table: donationCertificatesTable,
    phase: 'read',
    filters: { User_ID: resolvedUserId.userId },
    columns: ['Certificate_ID', 'User_ID', 'Certificate_Number', 'Certificate_Type', 'File_URL', 'Issued_At', 'Submission_ID'],
    limit,
  });

  const result = await supabase
    .from(donationCertificatesTable)
    .select(donationCertificateSelect)
    .eq('User_ID', resolvedUserId.userId)
    .order('Issued_At', { ascending: false })
    .limit(limit);

  return {
    data: (result.data || []).map(normalizeDonationCertificate),
    error: result.error,
  };
};

export const ensureCertificatesForScannedEventDonations = async (userId, limit = 50) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) {
    return { data: [], error: resolvedUserId.error };
  }

  const submissionsResult = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('User_ID', resolvedUserId.userId)
    .not('Event_Request_ID', 'is', null)
    .order('Updated_At', { ascending: false })
    .limit(limit);

  if (submissionsResult.error) {
    return { data: [], error: submissionsResult.error };
  }

  const submissions = (submissionsResult.data || []).map(normalizeHairSubmission);
  const submissionIds = submissions.map((submission) => submission.submission_id).filter(Boolean);

  if (!submissionIds.length) {
    return { data: [], error: null };
  }

  const [existingCertificatesResult, trackingResult, logisticsResult] = await Promise.all([
    supabase
      .from(donationCertificatesTable)
      .select(donationCertificateSelect)
      .in('Submission_ID', submissionIds),
    supabase
      .from(hairBundleTrackingHistoryTable)
      .select(trackingEntrySelect)
      .in('Submission_ID', submissionIds),
    supabase
      .from(hairSubmissionLogisticsTable)
      .select(hairSubmissionLogisticsSelect)
      .in('Submission_ID', submissionIds),
  ]);

  if (existingCertificatesResult.error || trackingResult.error || logisticsResult.error) {
    return {
      data: [],
      error: existingCertificatesResult.error || trackingResult.error || logisticsResult.error,
    };
  }

  const existingBySubmissionId = new Map(
    (existingCertificatesResult.data || [])
      .map(normalizeDonationCertificate)
      .filter((certificate) => certificate?.submission_id)
      .map((certificate) => [Number(certificate.submission_id), certificate])
  );
  const trackingBySubmissionId = new Map();
  (trackingResult.data || []).forEach((entry) => {
    const submissionId = Number(entry?.submission_id);
    const rows = trackingBySubmissionId.get(submissionId) || [];
    rows.push(entry);
    trackingBySubmissionId.set(submissionId, rows);
  });
  const logisticsBySubmissionId = new Map(
    (logisticsResult.data || []).map((row) => [Number(row?.submission_id), row])
  );
  const isOrganizationReceipt = (entry = null) => {
    const statusKey = normalizeFlowKey(entry?.status || entry?.shipment_status || '');
    const textKey = normalizeFlowKey([entry?.title, entry?.description].filter(Boolean).join(' '));
    return ['received', 'receivedbycompany', 'receivedbyhairforhope', 'receivedbyorganization', 'organizationreceived'].includes(statusKey)
      || textKey.includes('receivedbyhairforhope')
      || textKey.includes('receivedbyorganization')
      || textKey.includes('organizationreceived');
  };
  const certificates = [];

  for (const submission of submissions) {
    const submissionId = Number(submission.submission_id);
    const trackingEntries = trackingBySubmissionId.get(submissionId) || [];
    const logistics = logisticsBySubmissionId.get(submissionId) || null;
    const receiptEntry = trackingEntries.find(isOrganizationReceipt);
    const hasOrganizationReceipt = Boolean(
      receiptEntry
      || logistics?.received_at
      || isOrganizationReceipt(logistics)
    );

    if (!hasOrganizationReceipt || isHairCheckOnlySubmission(submission)) {
      continue;
    }

    const existingCertificate = existingBySubmissionId.get(submissionId);
    if (existingCertificate) {
      certificates.push(existingCertificate);
      continue;
    }

    const certificateResult = await createDonationCertificate({
      user_id: resolvedUserId.userId,
      submission_id: submission.submission_id,
      certificate_number: createDonationCertificateNumber(submission),
      certificate_type: 'Certificate of Donation',
      issued_by: receiptEntry?.changed_by || logistics?.received_by || null,
      issued_at: receiptEntry?.updated_at || logistics?.received_at || new Date().toISOString(),
      remarks: 'Issued after the organization received the hair donation.',
    });

    if (certificateResult.data?.certificate_id) {
      certificates.push(certificateResult.data);
      existingBySubmissionId.set(Number(submission.submission_id), certificateResult.data);
    }
  }

  return {
    data: certificates,
    error: null,
  };
};

export const fetchDonorPatientImpactByBundleIds = async (bundleIds = []) => {
  const normalizedBundleIds = [
    ...new Set(
      (bundleIds || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    ),
  ];

  if (!normalizedBundleIds.length) {
    return { data: { patientCount: 0, patientIds: [] }, error: null };
  }

  logHairQuery('fetchDonorPatientImpactByBundleIds', {
    table: wigsTable,
    phase: 'read',
    filters: { Bundle_ID: normalizedBundleIds },
    columns: ['Wig_ID', 'Bundle_ID'],
  });

  const wigsResult = await supabase
    .from(wigsTable)
    .select('Wig_ID, Bundle_ID')
    .in('Bundle_ID', normalizedBundleIds);

  if (wigsResult.error) {
    return { data: { patientCount: 0, patientIds: [] }, error: wigsResult.error };
  }

  const wigIds = (wigsResult.data || [])
    .map((row) => row?.Wig_ID)
    .filter(Boolean);

  if (!wigIds.length) {
    return { data: { patientCount: 0, patientIds: [] }, error: null };
  }

  logHairQuery('fetchDonorPatientImpactByBundleIds', {
    table: wigAllocationsTable,
    phase: 'read',
    filters: { Wig_ID: wigIds },
    columns: ['Wig_ID', 'Patient_ID', 'Release_Status', 'Released_At'],
  });

  const allocationResult = await supabase
    .from(wigAllocationsTable)
    .select('Wig_ID, Patient_ID, Release_Status, Released_At')
    .in('Wig_ID', wigIds);

  if (allocationResult.error) {
    return { data: { patientCount: 0, patientIds: [] }, error: allocationResult.error };
  }

  const patientIds = [
    ...new Set(
      (allocationResult.data || [])
        .map((row) => row?.Patient_ID)
        .filter(Boolean)
    ),
  ];

  return {
    data: {
      patientCount: patientIds.length,
      patientIds,
    },
    error: null,
  };
};

export const fetchDonationTimelineProductionByBundleId = async (bundleId) => {
  const normalizedBundleId = Number(bundleId);
  if (!Number.isInteger(normalizedBundleId) || normalizedBundleId <= 0) {
    return { data: { bundle: null, wig: null, allocation: null }, error: null };
  }

  const [bundleResult, wigResult] = await Promise.all([
    supabase
      .from(hairSubmissionBundlesTable)
      .select('Bundle_ID, Status, Notes, Created_At, Updated_At, Wig_Completed_At, Bundle_Waybill_Code')
      .eq('Bundle_ID', normalizedBundleId)
      .maybeSingle(),
    supabase
      .from(wigsTable)
      .select('Wig_ID, Bundle_ID, Wig_Status, Created_At, Updated_At, Completed_At, Wig_Name, Wig_Code, Req_ID')
      .eq('Bundle_ID', normalizedBundleId)
      .maybeSingle(),
  ]);

  if (bundleResult.error || wigResult.error) {
    return {
      data: { bundle: null, wig: null, allocation: null },
      error: bundleResult.error || wigResult.error,
    };
  }

  let allocation = null;
  let allocationError = null;

  if (wigResult.data?.Wig_ID) {
    const allocationResult = await supabase
      .from(wigAllocationsTable)
      .select('Allocation_ID, Wig_ID, Patient_ID, Wig_Request_ID, Release_Status, Allocated_At, Released_At, Notes')
      .eq('Wig_ID', wigResult.data.Wig_ID)
      .order('Allocated_At', { ascending: false })
      .limit(1)
      .maybeSingle();

    allocation = allocationResult.data || null;
    allocationError = allocationResult.error || null;
  }

  if (allocationError) {
    return {
      data: { bundle: bundleResult.data || null, wig: wigResult.data || null, allocation: null },
      error: allocationError,
    };
  }

  return {
    data: {
      bundle: bundleResult.data ? {
        bundle_id: bundleResult.data.Bundle_ID,
        status: bundleResult.data.Status || '',
        notes: bundleResult.data.Notes || '',
        created_at: bundleResult.data.Created_At || null,
        updated_at: bundleResult.data.Updated_At || null,
        wig_completed_at: bundleResult.data.Wig_Completed_At || null,
        donation_reference: bundleResult.data.Bundle_Waybill_Code || '',
      } : null,
      wig: wigResult.data ? {
        wig_id: wigResult.data.Wig_ID,
        bundle_id: wigResult.data.Bundle_ID,
        wig_status: wigResult.data.Wig_Status || '',
        created_at: wigResult.data.Created_At || null,
        updated_at: wigResult.data.Updated_At || null,
        completed_at: wigResult.data.Completed_At || null,
        wig_name: wigResult.data.Wig_Name || '',
        wig_code: wigResult.data.Wig_Code || '',
        req_id: wigResult.data.Req_ID || null,
      } : null,
      allocation: allocation ? {
        allocation_id: allocation.Allocation_ID,
        wig_id: allocation.Wig_ID,
        patient_id: allocation.Patient_ID || null,
        wig_request_id: allocation.Wig_Request_ID || null,
        release_status: allocation.Release_Status || '',
        allocated_at: allocation.Allocated_At || null,
        released_at: allocation.Released_At || null,
        notes: allocation.Notes || '',
      } : null,
    },
    error: null,
  };
};

export const fetchHairSubmissionsByUserId = async (
  userId,
  limit = 10,
  { relationLimit = limit } = {}
) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) {
    return { data: [], error: resolvedUserId.error };
  }

  logHairQuery('fetchHairSubmissionsByUserId', {
    table: hairSubmissionsTable,
    phase: 'read',
    filters: { User_ID: resolvedUserId.userId },
    columns: ['Submission_ID', 'User_ID', 'Event_Request_ID', 'From_Event', 'Donor_Notes', 'Status', 'Bundle_ID', 'Cut_At', 'Cut_By_User_ID', 'Created_At', 'Updated_At'],
  });

  const result = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('User_ID', resolvedUserId.userId)
    .order('Created_At', { ascending: false })
    .limit(limit);

  if (result.error || !(result.data || []).length) {
    return {
      data: (result.data || []).map(normalizeHairSubmission),
      error: result.error,
    };
  }

  const normalizedRows = result.data.map(normalizeHairSubmission);
  const normalizedRelationLimit = Math.max(1, Number(relationLimit) || limit);
  const recentRelationIds = normalizedRows
    .slice(0, normalizedRelationLimit)
    .map((submission) => submission.submission_id);
  const nonTerminalRelationIds = normalizedRows
    .filter((submission) => {
      const statusKey = normalizeFlowKey(submission?.status || '');
      return !isHairCheckOnlySubmission(submission)
        && !['cancelled', 'canceled', 'rejected', 'closed', 'completed', 'wigcreated'].includes(statusKey);
    })
    .map((submission) => submission.submission_id);
  const submissionIds = [...new Set([...recentRelationIds, ...nonTerminalRelationIds])].filter(Boolean);

  const screeningIds = [...new Set(normalizedRows
    .map((submission) => submission.ai_screening_id)
    .filter(Boolean))];
  const screeningsResult = await readOptionalHairSubmissionRelation({
    queryFactory: () => {
      const filters = [];
      if (screeningIds.length) filters.push(`AI_Screening_ID.in.(${screeningIds.join(',')})`);
      if (submissionIds.length) filters.push(`Submission_ID.in.(${submissionIds.join(',')})`);
      return supabase
        .from(aiScreeningsTable)
        .select(aiScreeningSelect)
        .eq('User_ID', resolvedUserId.userId)
        .or(filters.join(','))
        .order('Created_At', { ascending: false });
    },
    scope: 'hair_submission.query.fetchHairSubmissionsByUserId.screenings.optional_unavailable',
    table: aiScreeningsTable,
    extras: { submissionIds, screeningIds },
  });

  if (screeningsResult.error) {
    logAppError('hair_submission.query.fetchHairSubmissionsByUserId.screenings', screeningsResult.error, {
      table: aiScreeningsTable,
      phase: 'read',
      submissionIds,
    });
  }

  const screeningsById = new Map();
  const legacyScreeningsBySubmissionId = new Map();
  (screeningsResult.data || []).forEach((row) => {
    const screening = normalizeAiScreening(row);
    if (screening.ai_screening_id) screeningsById.set(screening.ai_screening_id, screening);
    if (!screening.submission_id) return;
    const currentRows = legacyScreeningsBySubmissionId.get(screening.submission_id) || [];
    currentRows.push(screening);
    legacyScreeningsBySubmissionId.set(screening.submission_id, currentRows);
  });

  const detailsResult = await readOptionalHairSubmissionRelation({
    queryFactory: () => supabase
      .from(hairSubmissionDetailsTable)
      .select(hairSubmissionDetailSelect)
      .in('Submission_ID', submissionIds)
      .order('Created_At', { ascending: false }),
    scope: 'hair_submission.query.fetchHairSubmissionsByUserId.details.optional_unavailable',
    table: hairSubmissionDetailsTable,
    extras: { submissionIds },
  });

  if (detailsResult.error) {
    logAppError('hair_submission.query.fetchHairSubmissionsByUserId.details', detailsResult.error, {
      table: hairSubmissionDetailsTable,
      phase: 'read',
      submissionIds,
    });
  }

  const normalizedDetails = (detailsResult.data || []).map(normalizeHairSubmissionDetail);
  const detailIds = normalizedDetails.map((detail) => detail.submission_detail_id).filter(Boolean);

  const imagesResult = detailIds.length
    ? await readOptionalHairSubmissionRelation({
        queryFactory: () => supabase
          .from(hairSubmissionImagesTable)
          .select(hairSubmissionImageSelect)
          .in('Submission_Detail_ID', detailIds)
          .order('Uploaded_At', { ascending: false }),
        scope: 'hair_submission.query.fetchHairSubmissionsByUserId.images.optional_unavailable',
        table: hairSubmissionImagesTable,
        extras: { detailIds },
      })
    : { data: [], error: null };

  if (imagesResult.error) {
    logAppError('hair_submission.query.fetchHairSubmissionsByUserId.images', imagesResult.error, {
      table: hairSubmissionImagesTable,
      phase: 'read',
      detailIds,
    });
  }

  const imagesByDetailId = new Map();
  (imagesResult.data || []).forEach((row) => {
    const image = normalizeHairSubmissionImage(row);
    const currentRows = imagesByDetailId.get(image.submission_detail_id) || [];
    currentRows.push(image);
    imagesByDetailId.set(image.submission_detail_id, currentRows);
  });

  const detailsBySubmissionId = new Map();
  normalizedDetails.forEach((detail) => {
    const detailWithImages = {
      ...detail,
      images: imagesByDetailId.get(detail.submission_detail_id) || [],
    };
    const currentRows = detailsBySubmissionId.get(detail.submission_id) || [];
    currentRows.push(detailWithImages);
    detailsBySubmissionId.set(detail.submission_id, currentRows);
  });

  return {
    data: (result.data || []).map((row) => normalizeHairSubmission({
      ...row,
      ai_screenings: row?.ai_screening_id && screeningsById.has(row.ai_screening_id)
        ? [screeningsById.get(row.ai_screening_id)]
        : legacyScreeningsBySubmissionId.get(row?.submission_id) || [],
      submission_details: detailsBySubmissionId.get(row?.submission_id) || [],
    })),
    error: result.error,
  };
};

export const getHairSubmissionImageSignedUrl = async (path, expiresIn = 3600) => {
  if (!path) {
    return { data: '', error: new Error('Image path is required.') };
  }

  const rawPath = String(path).trim();
  if (/^(data:|file:|content:|blob:)/i.test(rawPath)) {
    return { data: rawPath, error: null };
  }

  let objectPath = rawPath;
  const directUrlFallback = /^https?:\/\//i.test(rawPath) ? rawPath : '';

  if (directUrlFallback) {
    try {
      const parsedUrl = new URL(rawPath);
      const storageMarker = '/storage/v1/object/';
      const markerIndex = parsedUrl.pathname.indexOf(storageMarker);
      if (markerIndex >= 0) {
        const storageSegments = parsedUrl.pathname
          .slice(markerIndex + storageMarker.length)
          .split('/')
          .filter(Boolean);
        if (['public', 'sign', 'authenticated'].includes(storageSegments[0])) storageSegments.shift();
        if (storageSegments[0] === hairSubmissionStorageBucket) storageSegments.shift();
        objectPath = decodeURIComponent(storageSegments.join('/'));
      } else {
        return { data: directUrlFallback, error: null };
      }
    } catch {
      return { data: directUrlFallback, error: null };
    }
  }

  objectPath = objectPath
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${hairSubmissionStorageBucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\/`), '');

  const result = await supabase.storage
    .from(hairSubmissionStorageBucket)
    .createSignedUrl(objectPath, expiresIn);

  return {
    data: result.data?.signedUrl || directUrlFallback,
    error: result.error,
  };
};

export const fetchAiScreeningsByUserId = async (userId, limit = 12) => {
  const resolvedUser = await resolveSubmissionUserId(userId);
  if (resolvedUser.error || !resolvedUser.userId) {
    return { data: [], error: resolvedUser.error || new Error('A donor is required.') };
  }

  const runQuery = (columns) => supabase
      .from(aiScreeningsTable)
      .select(columns)
      .eq('User_ID', resolvedUser.userId)
      .order('Created_At', { ascending: false })
      .limit(Math.max(1, Number(limit) || 12));
  let result = await runQuery(aiScreeningSelect);
  if (isMissingScreeningImagesColumnError(result.error)) {
    result = await runQuery(aiScreeningSelectWithoutImages);
  }

  return {
    data: (result.data || []).map(normalizeAiScreening),
    error: result.error,
  };
};

export const fetchLatestEligibleAiScreeningByUserId = async (userId) => {
  const screeningsResult = await fetchAiScreeningsByUserId(userId, 30);
  const latestScreening = (screeningsResult.data || []).find((screening) => (
    screening?.ai_screening_id && String(screening?.decision || '').trim()
  )) || null;
  return {
    data: latestScreening && (
      ['eligible', 'eligiblefordonation', 'eligibleforhairdonation', 'passed']
        .includes(normalizeFlowKey(latestScreening.decision))
    ) ? latestScreening : null,
    error: screeningsResult.error,
  };
};

/**
 * Lightweight submission rows for counts, history summaries, and page-level
 * decisions. Unlike fetchHairSubmissionsByUserId, this intentionally does not
 * load screenings, recommendations, details, or images.
 */
export const fetchHairSubmissionSummariesByUserId = async (userId, limit = 100) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) {
    return { data: [], error: resolvedUserId.error };
  }

  logHairQuery('fetchHairSubmissionSummariesByUserId', {
    table: hairSubmissionsTable,
    phase: 'read',
    filters: { User_ID: resolvedUserId.userId },
    columns: ['Submission_ID', 'User_ID', 'Event_Request_ID', 'Event_Attendee_ID', 'From_Event', 'Donor_Notes', 'Status', 'Bundle_ID', 'Cut_At', 'Created_At', 'Updated_At'],
    limit,
  });

  const result = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('User_ID', resolvedUserId.userId)
    .order('Created_At', { ascending: false })
    .limit(limit);

  return {
    data: (result.data || []).map(normalizeHairSubmission),
    error: result.error,
  };
};

export const fetchHairSubmissionProgressSummariesByUserId = async (userId, limit = 100) => {
  const submissionsResult = await fetchHairSubmissionSummariesByUserId(userId, limit);
  const submissionIds = (submissionsResult.data || [])
    .map((submission) => submission.submission_id)
    .filter(Boolean);
  if (submissionsResult.error || !submissionIds.length) return submissionsResult;

  const detailsResult = await supabase
    .from(hairSubmissionDetailsTable)
    .select(hairSubmissionDetailSelect)
    .in('Submission_ID', submissionIds);
  const detailsBySubmissionId = new Map();
  (detailsResult.data || []).forEach((row) => {
    const detail = normalizeHairSubmissionDetail(row);
    const rows = detailsBySubmissionId.get(detail.submission_id) || [];
    rows.push(detail);
    detailsBySubmissionId.set(detail.submission_id, rows);
  });

  return {
    data: submissionsResult.data.map((submission) => ({
      ...submission,
      submission_details: detailsBySubmissionId.get(submission.submission_id) || [],
    })),
    error: detailsResult.error || null,
  };
};

export const fetchHairSubmissionDetailCountsBySubmissionIds = async (submissionIds = []) => {
  const ids = [...new Set(
    (submissionIds || [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  )];
  if (!ids.length) return { data: {}, error: null };

  const result = await supabase
    .from(hairSubmissionDetailsTable)
    .select('submission_id:Submission_ID')
    .in('Submission_ID', ids);

  const counts = (result.data || []).reduce((accumulator, row) => {
    const submissionId = Number(row?.submission_id);
    if (submissionId) accumulator[submissionId] = (accumulator[submissionId] || 0) + 1;
    return accumulator;
  }, {});

  return { data: counts, error: result.error };
};

/** Load only the records linked to already-selected submissions. */
export const fetchHairSubmissionCertificateRecordsByIds = async (submissionIds = []) => {
  const ids = [...new Set(
    (submissionIds || [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  )];

  if (!ids.length) return { data: [], error: null };

  const submissionsResult = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .in('Submission_ID', ids);

  if (submissionsResult.error || !(submissionsResult.data || []).length) {
    return {
      data: (submissionsResult.data || []).map(normalizeHairSubmission),
      error: submissionsResult.error,
    };
  }

  const normalizedSubmissions = submissionsResult.data.map(normalizeHairSubmission);
  const screeningIds = [...new Set(normalizedSubmissions
    .map((row) => row.ai_screening_id)
    .filter(Boolean))];
  const screeningFilters = [];
  if (screeningIds.length) screeningFilters.push(`AI_Screening_ID.in.(${screeningIds.join(',')})`);
  if (ids.length) screeningFilters.push(`Submission_ID.in.(${ids.join(',')})`);
  const [screeningsResult, detailsResult] = await Promise.all([
    supabase
      .from(aiScreeningsTable)
      .select(aiScreeningSelect)
      .or(screeningFilters.join(','))
      .order('Created_At', { ascending: false }),
    supabase
      .from(hairSubmissionDetailsTable)
      .select(hairSubmissionDetailSelect)
      .in('Submission_ID', ids)
      .order('Created_At', { ascending: false }),
  ]);

  const screeningsById = new Map();
  const legacyScreeningsBySubmissionId = new Map();
  (screeningsResult.data || []).forEach((row) => {
    const screening = normalizeAiScreening(row);
    if (screening.ai_screening_id) screeningsById.set(screening.ai_screening_id, screening);
    if (!screening.submission_id) return;
    const rows = legacyScreeningsBySubmissionId.get(screening.submission_id) || [];
    rows.push(screening);
    legacyScreeningsBySubmissionId.set(screening.submission_id, rows);
  });

  const detailsBySubmissionId = new Map();
  (detailsResult.data || []).forEach((row) => {
    const detail = normalizeHairSubmissionDetail(row);
    const rows = detailsBySubmissionId.get(detail.submission_id) || [];
    rows.push(detail);
    detailsBySubmissionId.set(detail.submission_id, rows);
  });

  return {
    data: (submissionsResult.data || []).map((row) => normalizeHairSubmission({
      ...row,
      ai_screenings: row?.ai_screening_id && screeningsById.has(row.ai_screening_id)
        ? [screeningsById.get(row.ai_screening_id)]
        : legacyScreeningsBySubmissionId.get(row?.submission_id) || [],
      submission_details: detailsBySubmissionId.get(row?.submission_id) || [],
    })),
    error: submissionsResult.error || screeningsResult.error || detailsResult.error || null,
  };
};

/**
 * Resolve one saved hair check and only the relationships its details page
 * renders. Ownership is checked before any related rows are requested.
 */
export const fetchHairScreeningEntryById = async ({ userId, screeningId } = {}) => {
  if (!userId || !screeningId) {
    return { data: null, error: new Error('User and screening IDs are required.') };
  }

  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) return { data: null, error: resolvedUserId.error };

  const runScreeningQuery = (columns) => supabase
      .from(aiScreeningsTable)
      .select(columns)
      .eq('AI_Screening_ID', screeningId)
      .maybeSingle();
  let screeningResult = await runScreeningQuery(aiScreeningSelect);
  if (isMissingScreeningImagesColumnError(screeningResult.error)) {
    screeningResult = await runScreeningQuery(aiScreeningSelectWithoutImages);
  }

  if (screeningResult.error || !screeningResult.data) {
    return { data: null, error: screeningResult.error };
  }

  const screening = normalizeAiScreening(screeningResult.data);
  if (Number(screening.user_id) !== Number(resolvedUserId.userId)) {
    return { data: null, error: new Error('Hair screening was not found for this donor.') };
  }

  if (!screening.submission_id) {
    return {
      data: {
        screening,
        submission: null,
        recommendations: screening.recommendations || [],
        images: screening.screening_images || [],
      },
      error: null,
    };
  }

  const submissionResult = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('Submission_ID', screeningResult.data.submission_id)
    .eq('User_ID', resolvedUserId.userId)
    .maybeSingle();

  if (submissionResult.error || !submissionResult.data?.submission_id) {
    return { data: null, error: submissionResult.error };
  }

  const submissionId = submissionResult.data.submission_id;
  const detailsResult = await supabase
    .from(hairSubmissionDetailsTable)
    .select(hairSubmissionDetailSelect)
    .eq('Submission_ID', submissionId)
    .order('Created_At', { ascending: false });

  const details = (detailsResult.data || []).map(normalizeHairSubmissionDetail);
  const detailIds = details.map((detail) => detail.submission_detail_id).filter(Boolean);
  const imagesResult = detailIds.length
    ? await supabase
      .from(hairSubmissionImagesTable)
      .select(hairSubmissionImageSelect)
      .in('Submission_Detail_ID', detailIds)
      .order('Uploaded_At', { ascending: false })
    : { data: [], error: null };

  const imagesByDetailId = new Map();
  (imagesResult.data || []).forEach((row) => {
    const image = normalizeHairSubmissionImage(row);
    const rows = imagesByDetailId.get(image.submission_detail_id) || [];
    rows.push(image);
    imagesByDetailId.set(image.submission_detail_id, rows);
  });

  const detailsWithImages = details.map((detail) => ({
    ...detail,
    images: imagesByDetailId.get(detail.submission_detail_id) || [],
  }));
  const submission = normalizeHairSubmission({
    ...submissionResult.data,
    ai_screenings: [screening],
    submission_details: detailsWithImages,
  });

  return {
    data: {
      screening,
      submission,
      recommendations: screening.recommendations || [],
      images: screening.screening_images?.length
        ? screening.screening_images
        : detailsWithImages.flatMap((detail) => detail.images || []),
    },
    error: detailsResult.error || imagesResult.error || null,
  };
};

/** Compact latest-analysis model for eligibility badges and event registration. */
export const fetchLatestHairAnalysisSummaryByUserId = async (userId, submissionLimit = 50) => {
  const [submissionsResult, screeningsResult] = await Promise.all([
    fetchHairSubmissionSummariesByUserId(userId, submissionLimit),
    fetchAiScreeningsByUserId(userId, 1),
  ]);
  if (submissionsResult.error || screeningsResult.error) {
    return {
      data: { submissions: submissionsResult.data || [], latestAnalysisEntry: null },
      error: submissionsResult.error || screeningsResult.error,
    };
  }

  const screening = screeningsResult.data?.[0] || null;
  if (!screening) {
    return {
      data: { submissions: submissionsResult.data, latestAnalysisEntry: null },
      error: null,
    };
  }

  const baseSubmission = submissionsResult.data.find(
    (submission) => Number(submission.ai_screening_id) === Number(screening.ai_screening_id)
      || Number(submission.submission_id) === Number(screening.submission_id)
  ) || null;
  const detail = baseSubmission?.submission_details?.[0] || null;
  const submission = baseSubmission ? {
    ...baseSubmission,
    ai_screenings: [screening],
    submission_details: detail ? [detail] : [],
  } : null;

  return {
    data: {
      submissions: submissionsResult.data,
      latestAnalysisEntry: {
        screening,
        submission,
        detail,
        recommendations: screening.recommendations || [],
        images: screening.screening_images || [],
      },
    },
    error: null,
  };
};

export const fetchHairSubmissionForEventByUserId = async ({ userId, eventRequestId } = {}) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) return { data: null, error: resolvedUserId.error };

  const result = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('User_ID', resolvedUserId.userId)
    .eq('Event_Request_ID', eventRequestId)
    .order('Created_At', { ascending: false })
    .limit(5);

  const submission = (result.data || [])
    .map(normalizeHairSubmission)
    .find((item) => !['cancelled', 'canceled', 'rejected'].includes(
      String(item?.status || '').trim().toLowerCase()
    )) || null;

  return {
    data: submission,
    error: result.error,
  };
};

export const fetchLatestHairSubmissionByUserId = async (userId) => {
  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) {
    return { data: null, error: resolvedUserId.error };
  }

  logHairQuery('fetchLatestHairSubmissionByUserId', {
    table: hairSubmissionsTable,
    phase: 'read',
    filters: { User_ID: resolvedUserId.userId },
    columns: ['Submission_ID', 'User_ID', 'Event_Request_ID', 'From_Event', 'Donor_Notes', 'Status', 'Bundle_ID', 'Cut_At', 'Cut_By_User_ID', 'Created_At', 'Updated_At'],
  });

  const result = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('User_ID', resolvedUserId.userId)
    .order('Created_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmission(result.data) : null,
    error: result.error,
  };
};

export const fetchLatestHairSubmissionDetailBySubmissionId = async (submissionId) => {
  logHairQuery('fetchLatestHairSubmissionDetailBySubmissionId', {
    table: hairSubmissionDetailsTable,
    phase: 'read',
    filters: { Submission_ID: submissionId },
    columns: ['Submission_Detail_ID', 'Submission_ID', 'Declared_Length', 'Declared_Texture', 'Declared_Density', 'Declared_Condition', 'Detail_Notes', 'Status', 'Created_At'],
  });

  const result = await supabase
    .from(hairSubmissionDetailsTable)
    .select(hairSubmissionDetailSelect)
    .eq('Submission_ID', submissionId)
    .order('Created_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmissionDetail(result.data) : null,
    error: result.error,
  };
};

export const fetchHairSubmissionById = async (submissionId) => {
  if (!submissionId) {
    return { data: null, error: new Error('Submission ID is required.') };
  }

  logHairQuery('fetchHairSubmissionById', {
    table: hairSubmissionsTable,
    phase: 'read',
    filters: { Submission_ID: submissionId },
    columns: ['Submission_ID', 'User_ID', 'Event_Request_ID', 'From_Event', 'Status'],
  });

  const result = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('Submission_ID', submissionId)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmission(result.data) : null,
    error: result.error,
  };
};

export const fetchHairSubmissionDetailById = async (submissionDetailId) => {
  if (!submissionDetailId) {
    return { data: null, error: new Error('Submission detail ID is required.') };
  }

  logHairQuery('fetchHairSubmissionDetailById', {
    table: hairSubmissionDetailsTable,
    phase: 'read',
    filters: { Submission_Detail_ID: submissionDetailId },
    columns: ['Submission_Detail_ID', 'Submission_ID', 'Declared_Length', 'Declared_Color', 'Status'],
  });

  const result = await supabase
    .from(hairSubmissionDetailsTable)
    .select(hairSubmissionDetailSelect)
    .eq('Submission_Detail_ID', submissionDetailId)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmissionDetail(result.data) : null,
    error: result.error,
  };
};

export const fetchHairSubmissionDetailByQrToken = async (qrToken) => {
  const token = String(qrToken || '').trim();
  if (!token) {
    return { data: null, error: new Error('QR token is required.') };
  }

  logHairQuery('fetchHairSubmissionDetailByQrToken', {
    table: hairSubmissionDetailsTable,
    phase: 'skipped',
    filters: { legacyQrToken: token ? '[provided]' : '' },
    reason: 'QR token lookup is no longer part of the current donor schema.',
  });

  return { data: null, error: new Error('QR token lookup is not supported by the current donor schema.') };
};

export const fetchHairSubmissionDetailsBySubmissionId = async (submissionId) => {
  if (!submissionId) {
    return { data: [], error: new Error('Submission ID is required.') };
  }

  logHairQuery('fetchHairSubmissionDetailsBySubmissionId', {
    table: hairSubmissionDetailsTable,
    phase: 'read',
    filters: { Submission_ID: submissionId },
    columns: ['Submission_Detail_ID', 'Submission_ID', 'Declared_Length', 'Declared_Color', 'Status'],
  });

  const result = await supabase
    .from(hairSubmissionDetailsTable)
    .select(hairSubmissionDetailSelect)
    .eq('Submission_ID', submissionId)
    .order('Created_At', { ascending: true });

  return {
    data: (result.data || []).map(normalizeHairSubmissionDetail),
    error: result.error,
  };
};

export const createHairSubmissionLogistics = async (payload) => {
  logHairQuery('createHairSubmissionLogistics', {
    table: hairSubmissionLogisticsTable,
    phase: 'upsert',
    filters: { Submission_ID: payload?.submission_id },
    columns: ['Submission_ID', 'Logistics_Type', 'Shipment_Status', 'Courier_Name', 'Tracking_Number', 'Pickup_Scheduled_At', 'Pickup_Approved_At', 'Received_By', 'Received_At', 'Notes', 'Updated_By'],
  });

  if (!payload?.submission_id) {
    return { data: null, error: new Error('Submission ID is required for logistics.') };
  }
  if (!normalizeLogisticsTypeForDb(payload?.logistics_type)) {
    return { data: null, error: new Error('Choose Courier, Pickup, or Salon Dropoff.') };
  }

  const parentResult = await supabase
    .from(hairSubmissionsTable)
    .select('Submission_ID, From_Event')
    .eq('Submission_ID', payload.submission_id)
    .maybeSingle();
  if (parentResult.error) return { data: null, error: parentResult.error };
  if (!parentResult.data?.Submission_ID || parentResult.data.From_Event !== false) {
    return { data: null, error: new Error('Logistics can only be added to an existing independent donation.') };
  }

  const result = await supabase
    .from(hairSubmissionLogisticsTable)
    .upsert([
      buildLogisticsWritePayload(payload, { includeSubmissionId: true }),
    ], { onConflict: 'Submission_ID' })
    .select(hairSubmissionLogisticsSelect)
    .single();

  return {
    data: result.data ? normalizeHairSubmissionLogistics(result.data) : null,
    error: result.error,
  };
};

export const upsertSalonDonationAppointment = async ({
  appointmentId = null,
  userId,
  submissionId,
  startAt,
  endAt,
  contactName,
  contactEmail = null,
  contactNumber,
  donorNotes = null,
  bookingSource = 'Mobile',
  isMinor = false,
  guardianConsentId = null,
  consentLegalDocumentId = null,
}) => {
  if (!userId || !submissionId || !startAt || !endAt || !contactName || !contactNumber) {
    return { data: null, error: new Error('Complete the appointment details before scheduling your drop-off.') };
  }

  let resolvedAppointmentId = appointmentId;
  if (!resolvedAppointmentId) {
    const existingResult = await supabase
      .from(salonDonationAppointmentsTable)
      .select('appointment_id:Appointment_ID')
      .eq('Hair_Submission_ID', submissionId)
      .maybeSingle();
    if (existingResult.error) {
      return { data: null, error: existingResult.error };
    }
    resolvedAppointmentId = existingResult.data?.appointment_id || null;
  }

  const row = {
    User_ID: userId,
    Hair_Submission_ID: submissionId,
    Appointment_Start_At: startAt,
    Appointment_End_At: endAt,
    Status: resolvedAppointmentId ? 'Rescheduled' : 'Confirmed',
    Contact_Name: contactName,
    Contact_Email: contactEmail || null,
    Contact_Number: contactNumber,
    Donor_Notes: donorNotes || null,
    Booking_Source: bookingSource || 'Mobile',
    Is_Minor: Boolean(isMinor),
    Guardian_Consent_ID: guardianConsentId || null,
    Consent_Legal_Document_ID: consentLegalDocumentId || null,
    Updated_At: getPhilippineDatabaseTimestamp(),
  };

  const query = resolvedAppointmentId
    ? supabase
        .from(salonDonationAppointmentsTable)
        .update(row)
        .eq('Appointment_ID', resolvedAppointmentId)
    : supabase
        .from(salonDonationAppointmentsTable)
        .insert([row]);
  const result = await query
    .select(`
      appointment_id:Appointment_ID,
      user_id:User_ID,
      submission_id:Hair_Submission_ID,
      appointment_start_at:Appointment_Start_At,
      appointment_end_at:Appointment_End_At,
      status:Status,
      booking_source:Booking_Source,
      checked_in_at:Checked_In_At,
      completed_at:Completed_At,
      cancelled_at:Cancelled_At,
      created_at:Created_At,
      updated_at:Updated_At
    `)
    .single();

  return { data: result.data || null, error: result.error };
};

export const fetchSalonDonationAppointmentBySubmissionId = async (submissionId) => {
  if (!submissionId) return { data: null, error: null };

  const result = await supabase
    .from(salonDonationAppointmentsTable)
    .select(`
      appointment_id:Appointment_ID,
      user_id:User_ID,
      submission_id:Hair_Submission_ID,
      appointment_start_at:Appointment_Start_At,
      appointment_end_at:Appointment_End_At,
      status:Status,
      contact_name:Contact_Name,
      contact_email:Contact_Email,
      contact_number:Contact_Number,
      booking_source:Booking_Source,
      checked_in_at:Checked_In_At,
      completed_at:Completed_At,
      cancelled_at:Cancelled_At,
      created_at:Created_At,
      updated_at:Updated_At
    `)
    .eq('Hair_Submission_ID', submissionId)
    .maybeSingle();

  return { data: result.data || null, error: result.error };
};

export const fetchSalonOperatingHours = async () => {
  const result = await supabase
    .from(salonOperatingHoursTable)
    .select(`
      Operating_Hours_ID,
      Day_Group,
      Is_Open,
      Opening_Time,
      Closing_Time,
      Break_Start_Time,
      Break_End_Time,
      Appointment_Duration_Minutes,
      Buffer_Minutes,
      Late_Grace_Minutes,
      Capacity_Per_Slot,
      Minimum_Booking_Notice_Days,
      Maximum_Booking_Days,
      Updated_By,
      Updated_At
    `)
    .order('Day_Group', { ascending: true });

  return {
    data: result.data || [],
    error: result.error,
  };
};

export const fetchSalonScheduleOverrides = async ({ startDate = '', endDate = '' } = {}) => {
  let query = supabase
    .from(salonScheduleOverridesTable)
    .select(`
      Schedule_Override_ID,
      Override_Date,
      Is_Closed,
      Opening_Time,
      Closing_Time,
      Break_Start_Time,
      Break_End_Time,
      Capacity_Per_Slot,
      Reason,
      Created_By,
      Created_At,
      Updated_By,
      Updated_At
    `);

  if (startDate) query = query.gte('Override_Date', startDate);
  if (endDate) query = query.lte('Override_Date', endDate);

  const result = await query.order('Override_Date', { ascending: true });

  return {
    data: result.data || [],
    error: result.error,
  };
};

export const fetchSalonDonationAppointmentsInRange = async ({ startAt = '', endAt = '' } = {}) => {
  let query = supabase
    .from(salonDonationAppointmentsTable)
    .select(`
      Appointment_ID,
      User_ID,
      Appointment_Start_At,
      Appointment_End_At,
      Status,
      Hair_Submission_ID,
      Checked_In_At,
      Completed_At,
      Cancelled_At,
      Created_At,
      Updated_At
    `);

  if (startAt) query = query.gte('Appointment_Start_At', startAt);
  if (endAt) query = query.lt('Appointment_Start_At', endAt);

  const result = await query;

  return {
    data: result.data || [],
    error: result.error,
  };
};

export const fetchSalonAppointmentStatusHistoryByAppointmentIds = async (appointmentIds = []) => {
  const ids = (appointmentIds || []).map(Number).filter(Boolean);
  if (!ids.length) return { data: [], error: null };

  const result = await supabase
    .from(salonAppointmentStatusHistoryTable)
    .select(`
      Status_History_ID,
      Appointment_ID,
      From_Status,
      To_Status,
      Change_Type,
      Old_Start_At,
      New_Start_At,
      Notes,
      Changed_By,
      Changed_At
    `)
    .in('Appointment_ID', ids)
    .order('Changed_At', { ascending: false });

  return {
    data: result.data || [],
    error: result.error,
  };
};

export const createHairSubmissionLogisticsItems = async (rows = []) => {
  logHairQuery('createHairSubmissionLogisticsItems', {
    table: 'Hair_Submission_Logistics',
    phase: 'skipped',
    rowCount: (rows || []).length,
    reason: 'The current mobile schema tracks logistics at the submission level only.',
  });

  return { data: [], error: null };
};

export const updateHairSubmissionLogisticsItemsByDetailIds = async ({
  submissionDetailIds = [],
  itemLogisticsStatus = '',
  lastScannedAt = null,
  receivedAt = null,
  receivedBy = null,
}) => {
  const ids = (submissionDetailIds || []).map(Number).filter(Boolean);
  if (!ids.length || !itemLogisticsStatus) {
    return { data: [], error: null };
  }

  logHairQuery('updateHairSubmissionLogisticsItemsByDetailIds', {
    table: 'Hair_Submission_Logistics',
    phase: 'skipped',
    submissionDetailCount: ids.length,
    itemLogisticsStatus,
    lastScannedAt,
    receivedAt,
    receivedBy,
    reason: 'The current mobile schema has no Hair_Submission_Logistics_Items table.',
  });

  return { data: [], error: null };
};

export const updateHairSubmissionById = async (submissionId, payload) => {
  if (!submissionId) {
    return { data: null, error: new Error('Submission ID is required.') };
  }

  logHairQuery('updateHairSubmissionById', {
    table: hairSubmissionsTable,
    phase: 'update',
    filters: { Submission_ID: submissionId },
    columns: ['Event_Request_ID', 'From_Event', 'Donor_Notes', 'Status', 'Bundle_ID', 'Cut_At', 'Cut_By_User_ID'],
  });

  const eventRequestId = payload?.event_request_id ?? payload?.donation_drive_id;
  const fromEvent = resolveFromEventForWrite({
    payload,
    eventRequestId,
    eventAttendeeId: payload?.event_attendee_id,
    fallback: undefined,
  });

  const result = await supabase
    .from(hairSubmissionsTable)
    .update({
      AI_Screening_ID: payload?.ai_screening_id ?? undefined,
      Event_Request_ID: eventRequestId ?? undefined,
      From_Event: fromEvent,
      Donor_Notes: payload?.donor_notes ?? undefined,
      Bundle_ID: payload?.bundle_id ?? undefined,
      Cut_At: payload?.cut_at ?? payload?.submitted_at ?? undefined,
      Cut_By_User_ID: payload?.cut_by_user_id ?? undefined,
      Status: payload?.status == null ? undefined : normalizeHairSubmissionStatusForDb(payload.status),
      Updated_At: getPhilippineDatabaseTimestamp(),
    })
    .eq('Submission_ID', submissionId)
    .select(hairSubmissionSelect)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmission(result.data) : null,
    error: result.error,
  };
};

export const updateHairSubmissionLogisticsById = async (submissionLogisticsId, payload) => {
  if (!submissionLogisticsId) {
    return { data: null, error: new Error('Submission logistics ID is required.') };
  }

  logHairQuery('updateHairSubmissionLogisticsById', {
    table: hairSubmissionLogisticsTable,
    phase: 'update',
    filters: { Submission_Logistics_ID: submissionLogisticsId },
    columns: ['Logistics_Type', 'Shipment_Status', 'Courier_Name', 'Tracking_Number', 'Pickup_Scheduled_At', 'Pickup_Approved_At', 'Received_By', 'Received_At', 'Notes', 'Updated_By'],
  });

  const result = await supabase
    .from(hairSubmissionLogisticsTable)
    .update(buildLogisticsWritePayload(payload))
    .eq('Submission_Logistics_ID', submissionLogisticsId)
    .select(hairSubmissionLogisticsSelect)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmissionLogistics(result.data) : null,
    error: result.error,
  };
};

export const fetchHairSubmissionLogisticsBySubmissionId = async (submissionId) => {
  logHairQuery('fetchHairSubmissionLogisticsBySubmissionId', {
    table: hairSubmissionLogisticsTable,
    phase: 'read',
    filters: { Submission_ID: submissionId },
    columns: ['Submission_Logistics_ID', 'Submission_ID', 'Logistics_Type', 'Shipment_Status', 'Courier_Name', 'Tracking_Number', 'Pickup_Scheduled_At', 'Pickup_Approved_At', 'Received_By', 'Received_At', 'Notes', 'Created_At', 'Updated_By', 'Updated_At'],
  });

  const result = await supabase
    .from(hairSubmissionLogisticsTable)
    .select(hairSubmissionLogisticsSelect)
    .eq('Submission_ID', submissionId)
    .maybeSingle();

  return {
    data: result.data ? normalizeHairSubmissionLogistics(result.data) : null,
    error: result.error,
  };
};

/**
 * Load the small workflow evidence set used by notification validation.
 * This keeps notification badges from issuing two queries for every historical
 * submission while still returning the same latest logistics and tracking data.
 */
export const fetchHairSubmissionWorkflowEvidenceByIds = async ({
  userId,
  submissionIds = [],
  trackingLimitPerSubmission = 24,
} = {}) => {
  const ids = [...new Set(
    (submissionIds || [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
  )];
  if (!userId || !ids.length) return { data: [], error: null };

  const resolvedUserId = await resolveSubmissionUserId(userId);
  if (resolvedUserId.error) return { data: [], error: resolvedUserId.error };

  const submissionsResult = await supabase
    .from(hairSubmissionsTable)
    .select(hairSubmissionSelect)
    .eq('User_ID', resolvedUserId.userId)
    .in('Submission_ID', ids);

  if (submissionsResult.error || !(submissionsResult.data || []).length) {
    return {
      data: (submissionsResult.data || []).map(normalizeHairSubmission),
      error: submissionsResult.error,
    };
  }

  const ownedIds = submissionsResult.data
    .map((row) => Number(row?.submission_id))
    .filter(Boolean);
  const normalizedTrackingLimit = Math.max(1, Number(trackingLimitPerSubmission) || 24);
  const [logisticsResult, trackingResult] = await Promise.all([
    supabase
      .from(hairSubmissionLogisticsTable)
      .select(hairSubmissionLogisticsSelect)
      .in('Submission_ID', ownedIds)
      .order('Created_At', { ascending: false }),
    supabase
      .from(hairBundleTrackingHistoryTable)
      .select(trackingEntrySelect)
      .in('Submission_ID', ownedIds)
      .order('Updated_At', { ascending: false }),
  ]);

  const latestLogisticsBySubmissionId = new Map();
  (logisticsResult.data || []).forEach((row) => {
    const logistics = normalizeHairSubmissionLogistics(row);
    if (!latestLogisticsBySubmissionId.has(Number(logistics.submission_id))) {
      latestLogisticsBySubmissionId.set(Number(logistics.submission_id), logistics);
    }
  });

  const trackingBySubmissionId = new Map();
  (trackingResult.data || []).forEach((row) => {
    const entry = normalizeTrackingEntry(row);
    const submissionId = Number(entry.submission_id);
    const entries = trackingBySubmissionId.get(submissionId) || [];
    if (entries.length < normalizedTrackingLimit) entries.push(entry);
    trackingBySubmissionId.set(submissionId, entries);
  });

  return {
    data: submissionsResult.data.map((row) => {
      const submission = normalizeHairSubmission(row);
      const submissionId = Number(submission.submission_id);
      return {
        submission,
        logistics: latestLogisticsBySubmissionId.get(submissionId) || null,
        trackingEntries: trackingBySubmissionId.get(submissionId) || [],
      };
    }),
    error: submissionsResult.error || logisticsResult.error || trackingResult.error || null,
  };
};

export const fetchLatestQaAssessmentBySubmissionDetailId = async (submissionDetailId) => {
  logHairQuery('fetchLatestQaAssessmentBySubmissionDetailId', {
    table: null,
    phase: 'read',
    filters: { Submission_Detail_ID: submissionDetailId },
    columns: [],
    skipped: 'QA_Assessments is not present in the provided schema.',
  });

  return { data: null, error: null };
};

export const fetchHairBundleTrackingHistory = async ({ submissionId, submissionDetailId, limit = 6 }) => {
  logHairQuery('fetchHairBundleTrackingHistory', {
    table: hairBundleTrackingHistoryTable,
    phase: 'read',
    filters: { Submission_ID: submissionId || null, Submission_Detail_ID: submissionDetailId || null },
    columns: ['Tracking_ID', 'Submission_ID', 'Submission_Detail_ID', 'Status', 'Title', 'Description', 'Changed_By', 'Updated_At'],
  });

  const query = supabase
    .from(hairBundleTrackingHistoryTable)
    .select(trackingEntrySelect)
    .order('Updated_At', { ascending: false })
    .limit(limit);

  if (submissionId && submissionDetailId) {
    const result = await query
      .eq('Submission_ID', submissionId)
      .or(`Submission_Detail_ID.eq.${submissionDetailId},Submission_Detail_ID.is.null`);
    return {
      data: (result.data || []).map(normalizeTrackingEntry),
      error: result.error,
    };
  }

  if (submissionId) {
    const result = await query.eq('Submission_ID', submissionId);
    return {
      data: (result.data || []).map(normalizeTrackingEntry),
      error: result.error,
    };
  }

  if (submissionDetailId) {
    const result = await query.eq('Submission_Detail_ID', submissionDetailId);
    return {
      data: (result.data || []).map(normalizeTrackingEntry),
      error: result.error,
    };
  }

  return { data: [], error: null };
};

export const createHairBundleTrackingEntry = async (payload) => {
  logHairQuery('createHairBundleTrackingEntry', {
    table: hairBundleTrackingHistoryTable,
    phase: 'create',
    filters: {
      Submission_ID: payload?.submission_id || null,
      Submission_Detail_ID: payload?.submission_detail_id || null,
    },
    columns: ['Submission_ID', 'Submission_Detail_ID', 'Status', 'Title', 'Description', 'Changed_By'],
  });

  const result = await supabase
    .from(hairBundleTrackingHistoryTable)
    .insert([{
      Submission_ID: payload?.submission_id || null,
      Submission_Detail_ID: payload?.submission_detail_id || null,
      Status: payload?.status || null,
      Title: payload?.title || null,
      Description: payload?.description || null,
      Changed_By: payload?.changed_by || null,
    }])
    .select(trackingEntrySelect)
    .maybeSingle();

  return {
    data: result.data ? normalizeTrackingEntry(result.data) : null,
    error: result.error,
  };
};

export const uploadHairSubmissionImage = async ({ path, fileBody, contentType, bucket = hairSubmissionStorageBucket }) => (
  await supabase.storage
    .from(bucket)
    .upload(path, fileBody, {
      contentType,
      upsert: false,
    })
);

export const removeHairSubmissionImagesFromStorage = async ({ paths = [], bucket = hairSubmissionStorageBucket }) => (
  await supabase.storage
    .from(bucket)
    .remove(paths.filter(Boolean))
);

export const deleteHairSubmissionImagesByDetailId = async (submissionDetailId) => (
  await supabase
    .from(hairSubmissionImagesTable)
    .delete()
    .eq('Submission_Detail_ID', submissionDetailId)
);

export const fetchHairSubmissionImagesByDetailIds = async (submissionDetailIds = []) => {
  const detailIds = (submissionDetailIds || []).filter(Boolean);
  if (!detailIds.length) return { data: [], error: null };

  const result = await supabase
    .from(hairSubmissionImagesTable)
    .select(hairSubmissionImageSelect)
    .in('Submission_Detail_ID', detailIds);

  return {
    data: (result.data || []).map(normalizeHairSubmissionImage),
    error: result.error,
  };
};

export const deleteHairSubmissionImagesByDetailIds = async (submissionDetailIds = []) => {
  const detailIds = (submissionDetailIds || []).filter(Boolean);
  if (!detailIds.length) return { data: [], error: null };

  return await supabase
    .from(hairSubmissionImagesTable)
    .delete()
    .in('Submission_Detail_ID', detailIds);
};

export const deleteAiScreeningsBySubmissionId = async (submissionId) => (
  await supabase
    .from(aiScreeningsTable)
    .delete()
    .eq('Submission_ID', submissionId)
);

export const deleteHairSubmissionLogisticsBySubmissionId = async (submissionId) => (
  await supabase
    .from(hairSubmissionLogisticsTable)
    .delete()
    .eq('Submission_ID', submissionId)
);

export const deleteHairBundleTrackingHistoryBySubmissionId = async (submissionId) => (
  await supabase
    .from(hairBundleTrackingHistoryTable)
    .delete()
    .eq('Submission_ID', submissionId)
);

export const deleteSalonDonationAppointmentsBySubmissionId = async (submissionId) => (
  await supabase
    .from(salonDonationAppointmentsTable)
    .delete()
    .eq('Hair_Submission_ID', submissionId)
);

export const deleteHairSubmissionDetailById = async (submissionDetailId) => (
  await supabase
    .from(hairSubmissionDetailsTable)
    .delete()
    .eq('Submission_Detail_ID', submissionDetailId)
);

export const deleteHairSubmissionDetailsBySubmissionId = async (submissionId) => (
  await supabase
    .from(hairSubmissionDetailsTable)
    .delete()
    .eq('Submission_ID', submissionId)
);

export const deleteHairSubmissionById = async (submissionId) => (
  await supabase
    .from(hairSubmissionsTable)
    .delete()
    .eq('Submission_ID', submissionId)
);
