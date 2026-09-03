import { supabase } from '../api/supabase/client';
import { wigReferenceStorageBucket } from './wigRequest.constants';
import { logAppError, logAppEvent } from '../utils/appErrors';

const wigRequestsTable = 'Wig_Requests';
const wigRequestSpecificationsTable = 'Wig_Request_Specifications';
const wigAllocationsTable = 'Wig_Allocations';
const wigsTable = 'Wigs';
const wigAiFiltersTable = 'Wig_AI_Filters';
const wigAiFiltersStorageBucket = 'wig_ai_filters';
const wigPhysicalSpecificationsTable = 'Wig_Specifications';
const patientsTable = 'Patients';
const hospitalsTable = 'Hospitals';
const releaseSchedulesTable = 'Release_Schedules';
const wigSafetyAssessmentsTable = 'patient_wig_safety_assessments';

const wigRequestSelect = `
  req_id:Req_ID,
  patient_id:Patient_ID,
  status:Status,
  request_date:Request_Date,
  requested_by:Requested_By,
  approved_by:Approved_By,
  approved_at:Approved_At,
  updated_at:Updated_At,
  pdf_url:Pdf_Url,
  status_reason:Status_Reason,
  hospital_id:Hospital_ID,
  requested_wig_id:Requested_Wig_ID,
  allocated_wig_id:Allocated_Wig_ID,
  request_code:Request_Code,
  requested_wig_specification_id:Requested_Wig_Specification_ID,
  requested_cap_size:Requested_Cap_Size,
  is_wish_request:Is_Wish_Request,
  fulfillment_status:Fulfillment_Status,
  fulfillment_bundle_id:Fulfillment_Bundle_ID
`;

const wigSpecificationSelect = `
  req_spec_id:Req_Spec_ID,
  req_id:Req_ID,
  preferred_color:Preferred_Color,
  preferred_length:Preferred_Length,
  hair_texture:Hair_Texture,
  cap_size:Cap_Size,
  style_preference:Style_Preference,
  special_notes:Special_Notes,
  ai_wig_preview_url:AI_Wig_Preview_URL
`;

const wigAllocationSelect = `
  allocation_id:Allocation_ID,
  wig_id:Wig_ID,
  patient_id:Patient_ID,
  wig_request_id:Wig_Request_ID,
  allocated_by:Allocated_By,
  allocated_at:Allocated_At,
  release_status:Release_Status,
  released_at:Released_At,
  notes:Notes
`;

const wigSelect = `
  wig_id:Wig_ID,
  wig_code:Wig_Code,
  wig_name:Wig_Name,
  wig_status:Wig_Status,
  stock_count:Stock_Count,
  production_notes:Production_Notes,
  completed_at:Completed_At,
  updated_at:Updated_At
`;

const wigPhysicalSpecificationSelect = `
  wig_specification_id:Wig_Specification_ID,
  wig_id:Wig_ID,
  color:Hair_Color,
  length:Hair_Length,
  hair_texture:Hair_Texture,
  hair_density:Hair_Density,
  cap_size:Cap_Size,
  style:Style
`;

const hospitalSelect = `
  hospital_id:Hospital_ID,
  hospital_name:Hospital_Name,
  hospital_logo:Hospital_Logo,
  country:Country,
  region:Region,
  province:Province,
  city:City,
  barangay:Barangay,
  street:Street,
  contact_number:Contact_Number
`;

const releaseScheduleSelect = `
  release_schedule_id:Release_Schedule_ID,
  req_id:Req_ID,
  proposed_release_date:Proposed_Release_Date,
  proposed_by:Proposed_By,
  proposal_note:Proposal_Note,
  hospital_decision:Hospital_Decision,
  hospital_decision_by:Hospital_Decision_By,
  hospital_decision_at:Hospital_Decision_At,
  hospital_decision_reason:Hospital_Decision_Reason,
  is_current:Is_Current,
  created_at:Created_At,
  updated_at:Updated_At
`;

const normalizeWigPhysicalSpecification = (row) => ({
  id: row?.wig_specification_id || row?.Wig_Specification_ID || null,
  wig_id: row?.wig_id || row?.Wig_ID || null,
  color: row?.color || row?.Hair_Color || '',
  length: row?.length ?? row?.Hair_Length ?? null,
  hair_texture: row?.hair_texture || row?.Hair_Texture || '',
  hair_density: row?.hair_density || row?.Hair_Density || '',
  cap_size: row?.cap_size || row?.Cap_Size || '',
  style: row?.style || row?.Style || '',
});

const normalizeHospital = (row) => ({
  id: row?.hospital_id || row?.Hospital_ID || null,
  hospital_id: row?.hospital_id || row?.Hospital_ID || null,
  hospital_name: row?.hospital_name || row?.Hospital_Name || '',
  hospital_logo: row?.hospital_logo || row?.Hospital_Logo || '',
  country: row?.country || row?.Country || '',
  region: row?.region || row?.Region || '',
  province: row?.province || row?.Province || '',
  city: row?.city || row?.City || '',
  barangay: row?.barangay || row?.Barangay || '',
  street: row?.street || row?.Street || '',
  contact_number: row?.contact_number || row?.Contact_Number || '',
});

const normalizeReleaseSchedule = (row) => ({
  id: row?.release_schedule_id || row?.Release_Schedule_ID || null,
  release_schedule_id: row?.release_schedule_id || row?.Release_Schedule_ID || null,
  req_id: row?.req_id || row?.Req_ID || null,
  proposed_release_date: row?.proposed_release_date || row?.Proposed_Release_Date || null,
  proposed_by: row?.proposed_by || row?.Proposed_By || null,
  proposal_note: row?.proposal_note || row?.Proposal_Note || '',
  hospital_decision: row?.hospital_decision || row?.Hospital_Decision || '',
  hospital_decision_by: row?.hospital_decision_by || row?.Hospital_Decision_By || null,
  hospital_decision_at: row?.hospital_decision_at || row?.Hospital_Decision_At || null,
  hospital_decision_reason: row?.hospital_decision_reason || row?.Hospital_Decision_Reason || '',
  is_current: row?.is_current ?? row?.Is_Current ?? false,
  created_at: row?.created_at || row?.Created_At || null,
  updated_at: row?.updated_at || row?.Updated_At || null,
});

const patientPictureSelect = `
  patient_picture:Patient_Picture
`;

const firstRelation = (value) => (Array.isArray(value) ? value[0] || null : value || null);

const parseJsonValue = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const buildWigFilterPublicUrl = (path) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;

  return supabase.storage
    .from(wigAiFiltersStorageBucket)
    .getPublicUrl(path)
    .data?.publicUrl || '';
};

const normalizeWigAiFilter = (row) => {
  const wig = firstRelation(row?.Wigs);

  return {
    id: row?.Filter_ID || null,
    filter_id: row?.Filter_ID || null,
    wig_id: row?.Wig_ID || null,
    version: row?.Version ?? null,
    status: row?.Status || '',
    is_active: Boolean(row?.Is_Active),
    wig_name: wig?.Wig_Name || row?.Pending_Wig_Name || `Wig ${row?.Wig_ID || ''}`.trim(),
    wig_code: wig?.Wig_Code || row?.Pending_Wig_Code || '',
    stock_count: wig?.Stock_Count ?? null,
    fit_settings: parseJsonValue(row?.Fit_Settings),
    thumbnail_path: row?.Thumbnail_Path || '',
    layer_full_wig_path: row?.Layer_Full_Wig_Path || '',
    layer_back_hair_path: row?.Layer_Back_Hair_Path || '',
    layer_front_bangs_path: row?.Layer_Front_Bangs_Path || '',
    layer_hair_mask_path: row?.Layer_Hair_Mask_Path || '',
    layer_face_mask_path: row?.Layer_Face_Mask_Path || '',
    thumbnail_url: buildWigFilterPublicUrl(row?.Thumbnail_Path),
    layer_full_wig_url: buildWigFilterPublicUrl(row?.Layer_Full_Wig_Path),
    layer_back_hair_url: buildWigFilterPublicUrl(row?.Layer_Back_Hair_Path),
    layer_front_bangs_url: buildWigFilterPublicUrl(row?.Layer_Front_Bangs_Path),
    layer_hair_mask_url: buildWigFilterPublicUrl(row?.Layer_Hair_Mask_Path),
    layer_face_mask_url: buildWigFilterPublicUrl(row?.Layer_Face_Mask_Path),
    pending_wig_name: row?.Pending_Wig_Name || '',
    pending_wig_code: row?.Pending_Wig_Code || '',
    pending_hair_length: row?.Pending_Hair_Length ?? null,
    pending_hair_color: row?.Pending_Hair_Color || '',
    pending_hair_texture: row?.Pending_Hair_Texture || '',
    pending_hair_density: row?.Pending_Hair_Density || '',
    pending_cap_size: row?.Pending_Cap_Size || '',
    pending_style: row?.Pending_Style || '',
    physical_specification: null,
  };
};

const normalizeWigDetails = (wig, physicalSpec = null) => (
  wig
    ? {
        id: wig?.wig_id || wig?.Wig_ID || null,
        wig_id: wig?.wig_id || wig?.Wig_ID || null,
        wig_code: wig?.wig_code || wig?.Wig_Code || '',
        wig_name: wig?.wig_name || wig?.Wig_Name || physicalSpec?.style || 'Selected Wig',
        wig_status: wig?.wig_status || wig?.Wig_Status || '',
        stock_count: wig?.stock_count ?? wig?.Stock_Count ?? null,
        completed_at: wig?.completed_at || wig?.Completed_At || null,
        updated_at: wig?.updated_at || wig?.Updated_At || null,
        production_notes: wig?.production_notes || wig?.Production_Notes || '',
        physical_specification: physicalSpec || null,
      }
    : null
);

const logWigQuery = (source, extras = {}) => {
  logAppEvent('wig_request.query', 'Wig request query started.', {
    source,
    ...extras,
  });
};

const isMissingRelationError = (error) => (
  error?.code === '42P01'
  || error?.code === 'PGRST205'
  || String(error?.message || '').toLowerCase().includes('does not exist')
  || String(error?.message || '').toLowerCase().includes('could not find the table')
  || String(error?.message || '').toLowerCase().includes('schema cache')
);

const normalizeWigRequest = (row) => {
  const specification = firstRelation(row?.wig_request_specifications);

  return {
    id: row?.req_id || null,
    req_id: row?.req_id || null,
    patient_id: row?.patient_id || null,
    status: row?.status || '',
    request_date: row?.request_date || null,
    requested_by: row?.requested_by || null,
    approved_by: row?.approved_by || null,
    approved_at: row?.approved_at || null,
    updated_at: row?.updated_at || null,
    pdf_url: row?.pdf_url || '',
    status_reason: row?.status_reason || '',
    requested_wig_id: row?.requested_wig_id || null,
    allocated_wig_id: row?.allocated_wig_id || null,
    request_code: row?.request_code || '',
    requested_wig_specification_id: row?.requested_wig_specification_id || null,
    requested_cap_size: row?.requested_cap_size || '',
    is_wish_request: Boolean(row?.is_wish_request),
    fulfillment_status: row?.fulfillment_status || '',
    fulfillment_bundle_id: row?.fulfillment_bundle_id || null,
    notes: specification?.special_notes || '',
    ai_wig_preview_url: specification?.ai_wig_preview_url || '',
  };
};

const normalizeWigSpecification = (row) => {
  const wigRequest = firstRelation(row?.wig_requests);
  const patient = firstRelation(wigRequest?.patients);

  return {
    id: row?.req_spec_id || null,
    req_spec_id: row?.req_spec_id || null,
    req_id: row?.req_id || null,
    wig_request_id: row?.req_id || null,
    preferred_color: row?.preferred_color || '',
    preferred_length: row?.preferred_length || '',
    hair_texture: row?.hair_texture || '',
    cap_size: row?.cap_size || '',
    style_preference: row?.style_preference || '',
    notes: row?.special_notes || '',
    special_notes: row?.special_notes || '',
    ai_wig_preview_url: row?.ai_wig_preview_url || '',
    patient_picture: patient?.patient_picture || '',
    updated_at: wigRequest?.updated_at || null,
  };
};

const normalizeWigAllocation = (row) => {
  const wig = firstRelation(row?.wigs);
  const wigRequest = firstRelation(row?.wig_requests);
  const physicalSpec = firstRelation(wig?.wig_physical_specifications);
  const requestSpecification = firstRelation(wigRequest?.wig_request_specifications);

  return {
    id: row?.allocation_id || null,
    allocation_id: row?.allocation_id || null,
    wig_id: row?.wig_id || null,
    patient_id: row?.patient_id || null,
    wig_request_id: row?.wig_request_id || null,
    allocated_by: row?.allocated_by || null,
    allocated_at: row?.allocated_at || null,
    release_status: row?.release_status || '',
    released_at: row?.released_at || null,
    notes: row?.notes || '',
    wigs: wig
      ? {
          id: wig?.wig_id || null,
          wig_id: wig?.wig_id || null,
          wig_code: wig?.wig_code || '',
          wig_name: wig?.wig_name || physicalSpec?.style || 'Assigned Wig',
          wig_status: wig?.wig_status || '',
          stock_count: wig?.stock_count ?? null,
          completed_at: wig?.completed_at || null,
          updated_at: wig?.updated_at || null,
          production_notes: wig?.production_notes || '',
          physical_specification: physicalSpec
            ? {
                color: physicalSpec?.color || '',
                length: physicalSpec?.length || '',
                hair_texture: physicalSpec?.hair_texture || '',
                hair_density: physicalSpec?.hair_density || '',
                cap_size: physicalSpec?.cap_size || '',
                style: physicalSpec?.style || '',
                notes: physicalSpec?.notes || '',
              }
            : null,
        }
      : null,
    wig_requests: wigRequest
      ? {
          id: wigRequest?.req_id || null,
          req_id: wigRequest?.req_id || null,
          patient_id: wigRequest?.patient_id || null,
          status: wigRequest?.status || '',
          request_date: wigRequest?.request_date || null,
          notes: requestSpecification?.special_notes || '',
          ai_wig_preview_url: requestSpecification?.ai_wig_preview_url || '',
        }
      : null,
  };
};

export const createWigRequest = async (payload) => {
  logWigQuery('createWigRequest', {
    table: wigRequestsTable,
    phase: 'create',
    filters: { Patient_ID: payload?.patient_id || null },
    columns: ['Patient_ID', 'Status', 'Request_Date', 'Requested_By', 'Approved_By', 'Approved_At', 'Updated_At', 'Pdf_Url', 'Status_Reason', 'Hospital_ID', 'Requested_Wig_ID', 'Allocated_Wig_ID', 'Request_Code'],
  });

  const result = await supabase
    .from(wigRequestsTable)
    .insert([{
      Patient_ID: payload?.patient_id || null,
      Status: payload?.status || null,
      Request_Date: payload?.request_date || new Date().toISOString(),
      Requested_By: payload?.requested_by || null,
      Approved_By: payload?.approved_by || null,
      Approved_At: payload?.approved_at || null,
      Updated_At: new Date().toISOString(),
      Pdf_Url: payload?.pdf_url || null,
      Status_Reason: payload?.status_reason || null,
      Hospital_ID: payload?.hospital_id || null,
      Requested_Wig_ID: payload?.requested_wig_id || null,
      Allocated_Wig_ID: payload?.allocated_wig_id || null,
      Requested_Wig_Specification_ID: payload?.requested_wig_specification_id || null,
      Requested_Cap_Size: payload?.requested_cap_size || null,
      Is_Wish_Request: Boolean(payload?.is_wish_request),
      Fulfillment_Status: payload?.fulfillment_status || 'catalog_review',
      Fulfillment_Bundle_ID: payload?.fulfillment_bundle_id || null,
    }])
    .select(wigRequestSelect)
    .single();

  return {
    data: result.data ? normalizeWigRequest(result.data) : null,
    error: result.error,
  };
};

export const upsertPatientWigSafetyAssessment = async ({
  reqId,
  hasKnownAllergies,
  allergyDetails = '',
  hasSensitiveScalp,
  hasScalpIrritation,
  hasOpenScalpWounds,
  hasMedicalRestriction,
  medicalRestrictionDetails = '',
  informationConfirmed,
}) => {
  const confirmedAt = informationConfirmed ? new Date().toISOString() : null;
  const result = await supabase
    .from(wigSafetyAssessmentsTable)
    .upsert([{
      req_id: reqId,
      has_known_allergies: hasKnownAllergies,
      allergy_details: hasKnownAllergies ? allergyDetails.trim() || null : null,
      has_sensitive_scalp: hasSensitiveScalp,
      has_scalp_irritation: hasScalpIrritation,
      has_open_scalp_wounds: hasOpenScalpWounds,
      has_medical_restriction: hasMedicalRestriction,
      medical_restriction_details: hasMedicalRestriction
        ? medicalRestrictionDetails.trim() || null
        : null,
      information_confirmed: Boolean(informationConfirmed),
      confirmed_at: confirmedAt,
      review_status: 'Pending',
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    }], {
      onConflict: 'req_id',
    })
    .select('*')
    .single();

  return {
    data: result.data || null,
    error: result.error,
  };
};

export const fetchPatientWigSafetyAssessmentByRequestId = async (reqId) => {
  if (!reqId) return { data: null, error: null };

  const result = await supabase
    .from(wigSafetyAssessmentsTable)
    .select('*')
    .eq('req_id', reqId)
    .maybeSingle();

  if (isMissingRelationError(result.error)) {
    return { data: null, error: null };
  }

  return {
    data: result.data || null,
    error: result.error,
  };
};

export const cancelPendingWigRequest = async ({ reqId, patientId }) => {
  const cancellationCutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
  logWigQuery('cancelPendingWigRequest', {
    table: wigRequestsTable,
    phase: 'update',
    filters: { Req_ID: reqId, Patient_ID: patientId },
    columns: ['Status', 'Status_Reason', 'Updated_At'],
  });

  const result = await supabase
    .from(wigRequestsTable)
    .update({
      Status: 'cancelled',
      Status_Reason: 'Cancelled by patient.',
      Updated_At: new Date().toISOString(),
    })
    .eq('Req_ID', reqId)
    .eq('Patient_ID', patientId)
    .gte('Request_Date', cancellationCutoff)
    .select(wigRequestSelect)
    .maybeSingle();

  return {
    data: result.data ? normalizeWigRequest(result.data) : null,
    error: result.error,
  };
};

export const createWigSpecification = async (payload) => {
  logWigQuery('createWigSpecification', {
    table: wigRequestSpecificationsTable,
    phase: 'create',
    filters: { Req_ID: payload?.wig_request_id || payload?.req_id || null },
    columns: ['Req_ID', 'Preferred_Color', 'Preferred_Length', 'Hair_Texture', 'Cap_Size', 'Style_Preference', 'Special_Notes', 'AI_Wig_Preview_URL'],
  });

  const result = await supabase
    .from(wigRequestSpecificationsTable)
    .upsert([{
      Req_ID: payload?.wig_request_id || payload?.req_id || null,
      Preferred_Color: payload?.preferred_color || null,
      Preferred_Length: payload?.preferred_length || null,
      Hair_Texture: payload?.hair_texture || null,
      Cap_Size: payload?.cap_size || null,
      Style_Preference: payload?.style_preference || null,
      Special_Notes: payload?.notes || payload?.special_notes || null,
      AI_Wig_Preview_URL: payload?.ai_wig_preview_url || null,
    }], {
      onConflict: 'Req_ID',
    })
    .select(wigSpecificationSelect)
    .single();

  if (isMissingRelationError(result.error)) {
    return {
      data: null,
      error: null,
    };
  }

  return {
    data: result.data ? normalizeWigSpecification(result.data) : null,
    error: result.error,
  };
};

export const fetchLatestWigRequestByPatientDetailsId = async (patientId) => {
  logWigQuery('fetchLatestWigRequestByPatientDetailsId', {
    table: wigRequestsTable,
    phase: 'read',
    filters: { Patient_ID: patientId },
    columns: ['Req_ID', 'Patient_ID', 'Status', 'Request_Date', 'Requested_By', 'Approved_By', 'Approved_At', 'Updated_At', 'Pdf_Url', 'Status_Reason', 'Hospital_ID', 'Requested_Wig_ID', 'Allocated_Wig_ID', 'Request_Code'],
  });

  const result = await supabase
    .from(wigRequestsTable)
    .select(wigRequestSelect)
    .eq('Patient_ID', patientId)
    .order('Updated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error || !result.data?.req_id) {
    return {
      data: result.data ? normalizeWigRequest(result.data) : null,
      error: result.error,
    };
  }

  const specificationResult = await supabase
    .from(wigRequestSpecificationsTable)
    .select(wigSpecificationSelect)
    .eq('Req_ID', result.data.req_id)
    .maybeSingle();

  if (specificationResult.error && !isMissingRelationError(specificationResult.error)) {
    logAppError('wig_request.query.fetchLatestWigRequestByPatientDetailsId.specification', specificationResult.error, {
      table: wigRequestSpecificationsTable,
      phase: 'read',
      filters: { Req_ID: result.data.req_id },
    });
  }

  return {
    data: result.data ? normalizeWigRequest({
      ...result.data,
      wig_request_specifications: specificationResult.error ? [] : specificationResult.data ? [specificationResult.data] : [],
    }) : null,
    error: result.error,
  };
};

/** Request fields used by status/timeline surfaces, without loading preferences. */
export const fetchLatestWigRequestTrackingByPatientId = async (patientId) => {
  const result = await supabase
    .from(wigRequestsTable)
    .select(wigRequestSelect)
    .eq('Patient_ID', patientId)
    .order('Updated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: result.data ? normalizeWigRequest(result.data) : null,
    error: result.error,
  };
};

export const fetchLatestWigSpecificationByRequestId = async (wigRequestId) => {
  logWigQuery('fetchLatestWigSpecificationByRequestId', {
    table: wigRequestSpecificationsTable,
    phase: 'read',
    filters: { Req_ID: wigRequestId },
    columns: ['Req_Spec_ID', 'Req_ID', 'Preferred_Color', 'Preferred_Length', 'Hair_Texture', 'Cap_Size', 'Style_Preference', 'Special_Notes', 'AI_Wig_Preview_URL'],
  });

  const result = await supabase
    .from(wigRequestSpecificationsTable)
    .select(wigSpecificationSelect)
    .eq('Req_ID', wigRequestId)
    .maybeSingle();

  if (isMissingRelationError(result.error)) {
    return {
      data: null,
      error: null,
    };
  }

  if (result.error || !result.data) {
    return {
      data: result.data ? normalizeWigSpecification(result.data) : null,
      error: result.error,
    };
  }

  const wigRequestResult = await supabase
    .from(wigRequestsTable)
    .select(`
      req_id:Req_ID,
      patient_id:Patient_ID,
      updated_at:Updated_At
    `)
    .eq('Req_ID', wigRequestId)
    .maybeSingle();

  if (wigRequestResult.error) {
    logAppError('wig_request.query.fetchLatestWigSpecificationByRequestId.request', wigRequestResult.error, {
      table: wigRequestsTable,
      phase: 'read',
      filters: { Req_ID: wigRequestId },
    });
  }

  const patientResult = wigRequestResult.data?.patient_id
    ? await supabase
      .from(patientsTable)
      .select(patientPictureSelect)
      .eq('Patient_ID', wigRequestResult.data.patient_id)
      .maybeSingle()
    : { data: null, error: null };

  if (patientResult.error) {
    logAppError('wig_request.query.fetchLatestWigSpecificationByRequestId.patient', patientResult.error, {
      table: patientsTable,
      phase: 'read',
      filters: { Patient_ID: wigRequestResult.data?.patient_id || null },
    });
  }

  return {
    data: result.data ? normalizeWigSpecification({
      ...result.data,
      wig_requests: wigRequestResult.data
        ? [{
            ...wigRequestResult.data,
            patients: patientResult.data ? [patientResult.data] : [],
          }]
        : [],
    }) : null,
    error: result.error,
  };
};

export const uploadWigReferenceImage = async ({ path, fileBody, contentType, bucket = wigReferenceStorageBucket }) => {
  logAppEvent('wig_request.storage.upload_started', 'Wig preview upload started.', {
    table: 'storage',
    bucket,
    filePath: path,
    fileType: 'wig_request_preview',
    contentType: contentType || 'image/jpeg',
  });

  const result = await supabase.storage
    .from(bucket)
    .upload(path, fileBody, {
      contentType,
      upsert: false,
    });

  if (result.error) {
    logAppError('wig_request.storage.upload_failed', result.error, {
      table: 'storage',
      bucket,
      filePath: path,
      fileType: 'wig_request_preview',
      contentType: contentType || 'image/jpeg',
    });
    return result;
  }

  logAppEvent('wig_request.storage.upload_succeeded', 'Wig preview upload succeeded.', {
    table: 'storage',
    bucket,
    filePath: path,
    fileType: 'wig_request_preview',
  });

  return result;
};

export const getStoragePublicUrl = ({ path, bucket = wigReferenceStorageBucket }) => (
  supabase.storage
    .from(bucket)
    .getPublicUrl(path)
);

export const fetchActiveWigAiFilters = async () => {
  logWigQuery('fetchActiveWigAiFilters', {
    table: wigAiFiltersTable,
    phase: 'read',
    filters: { Is_Active: true },
    columns: [
      'Filter_ID',
      'Wig_ID',
      'Version',
      'Status',
      'Is_Active',
      'Fit_Settings',
      'Thumbnail_Path',
      'Layer_Full_Wig_Path',
      'Layer_Back_Hair_Path',
      'Layer_Front_Bangs_Path',
      'Layer_Hair_Mask_Path',
      'Layer_Face_Mask_Path',
      'Pending_Wig_Name',
      'Pending_Wig_Code',
      'Wigs.Wig_Name',
    ],
  });

  let result = await supabase
    .from(wigAiFiltersTable)
    .select('Filter_ID, Wig_ID, Version, Status, Is_Active, Fit_Settings, Thumbnail_Path, Layer_Full_Wig_Path, Layer_Back_Hair_Path, Layer_Face_Mask_Path, Layer_Front_Bangs_Path, Layer_Hair_Mask_Path, Pending_Wig_Name, Pending_Wig_Code, Pending_Hair_Length, Pending_Hair_Color, Pending_Hair_Texture, Pending_Hair_Density, Pending_Cap_Size, Pending_Style, Wigs:Wig_ID(Wig_Name, Wig_Code, Stock_Count)')
    .eq('Is_Active', true)
    .order('Filter_ID', { ascending: false });

  if (isMissingRelationError(result.error)) {
    result = await supabase
      .from(wigAiFiltersTable)
      .select('Filter_ID, Wig_ID, Version, Status, Is_Active, Fit_Settings, Thumbnail_Path, Layer_Full_Wig_Path, Layer_Back_Hair_Path, Layer_Face_Mask_Path, Layer_Front_Bangs_Path, Layer_Hair_Mask_Path, Pending_Wig_Name, Pending_Wig_Code, Pending_Hair_Length, Pending_Hair_Color, Pending_Hair_Texture, Pending_Hair_Density, Pending_Cap_Size, Pending_Style')
      .eq('Is_Active', true)
      .order('Filter_ID', { ascending: false });
  }

  return {
    data: Array.isArray(result.data) ? result.data.map(normalizeWigAiFilter) : [],
    error: result.error,
  };
};

export const fetchWigPhysicalSpecifications = async () => {
  logWigQuery('fetchWigPhysicalSpecifications', {
    table: wigPhysicalSpecificationsTable,
    phase: 'read',
    filters: {},
    columns: ['Wig_Specification_ID', 'Wig_ID', 'Hair_Length', 'Hair_Color', 'Hair_Texture', 'Hair_Density', 'Cap_Size', 'Style'],
  });

  const result = await supabase
    .from(wigPhysicalSpecificationsTable)
    .select(wigPhysicalSpecificationSelect)
    .order('Updated_At', { ascending: false });

  return {
    data: Array.isArray(result.data) ? result.data.map(normalizeWigPhysicalSpecification) : [],
    error: result.error,
  };
};

export const fetchHospitalById = async (hospitalId) => {
  if (!hospitalId) {
    return { data: null, error: null };
  }

  logWigQuery('fetchHospitalById', {
    table: hospitalsTable,
    phase: 'read',
    filters: { Hospital_ID: hospitalId },
    columns: ['Hospital_ID', 'Hospital_Name', 'Hospital_Logo', 'Country', 'Region', 'Province', 'City', 'Barangay', 'Street', 'Contact_Number'],
  });

  const result = await supabase
    .from(hospitalsTable)
    .select(hospitalSelect)
    .eq('Hospital_ID', hospitalId)
    .maybeSingle();

  return {
    data: result.data ? normalizeHospital(result.data) : null,
    error: result.error,
  };
};

export const fetchWigDetailsById = async (wigId) => {
  if (!wigId) {
    return { data: null, error: null };
  }

  logWigQuery('fetchWigDetailsById', {
    table: wigsTable,
    phase: 'read',
    filters: { Wig_ID: wigId },
    columns: ['Wig_ID', 'Wig_Code', 'Wig_Name', 'Wig_Status', 'Stock_Count', 'Production_Notes', 'Completed_At', 'Updated_At'],
  });

  const wigResult = await supabase
    .from(wigsTable)
    .select(wigSelect)
    .eq('Wig_ID', wigId)
    .maybeSingle();

  if (wigResult.error || !wigResult.data) {
    return {
      data: wigResult.data ? normalizeWigDetails(wigResult.data) : null,
      error: wigResult.error,
    };
  }

  const physicalSpecResult = await supabase
    .from(wigPhysicalSpecificationsTable)
    .select(wigPhysicalSpecificationSelect)
    .eq('Wig_ID', wigId)
    .maybeSingle();

  if (physicalSpecResult.error) {
    logAppError('wig_request.query.fetchWigDetailsById.physical_spec', physicalSpecResult.error, {
      table: wigPhysicalSpecificationsTable,
      phase: 'read',
      filters: { Wig_ID: wigId },
    });
  }

  return {
    data: normalizeWigDetails(
      wigResult.data,
      physicalSpecResult.data ? normalizeWigPhysicalSpecification(physicalSpecResult.data) : null
    ),
    error: wigResult.error,
  };
};

export const fetchLatestReleaseScheduleByRequestId = async (wigRequestId) => {
  if (!wigRequestId) {
    return { data: null, error: null };
  }

  logWigQuery('fetchLatestReleaseScheduleByRequestId', {
    table: releaseSchedulesTable,
    phase: 'read',
    filters: { Req_ID: wigRequestId },
    columns: ['Release_Schedule_ID', 'Req_ID', 'Proposed_Release_Date', 'Proposal_Note', 'Hospital_Decision', 'Hospital_Decision_Reason', 'Is_Current'],
  });

  const currentResult = await supabase
    .from(releaseSchedulesTable)
    .select(releaseScheduleSelect)
    .eq('Req_ID', wigRequestId)
    .eq('Is_Current', true)
    .order('Updated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentResult.data || currentResult.error) {
    return {
      data: currentResult.data ? normalizeReleaseSchedule(currentResult.data) : null,
      error: currentResult.error,
    };
  }

  const latestResult = await supabase
    .from(releaseSchedulesTable)
    .select(releaseScheduleSelect)
    .eq('Req_ID', wigRequestId)
    .order('Updated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    data: latestResult.data ? normalizeReleaseSchedule(latestResult.data) : null,
    error: latestResult.error,
  };
};

export const fetchLatestWigAllocationByPatientDetailsId = async (patientId) => {
  logWigQuery('fetchLatestWigAllocationByPatientDetailsId', {
    table: wigAllocationsTable,
    phase: 'read',
    filters: { Patient_ID: patientId },
    columns: ['Allocation_ID', 'Wig_ID', 'Patient_ID', 'Wig_Request_ID', 'Allocated_By', 'Allocated_At', 'Release_Status', 'Released_At', 'Notes'],
  });

  const result = await supabase
    .from(wigAllocationsTable)
    .select(wigAllocationSelect)
    .eq('Patient_ID', patientId)
    .order('Allocated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error || !result.data) {
    return {
      data: result.data ? normalizeWigAllocation(result.data) : null,
      error: result.error,
    };
  }

  const wigResult = result.data.wig_id
    ? await supabase
      .from(wigsTable)
      .select(wigSelect)
      .eq('Wig_ID', result.data.wig_id)
      .maybeSingle()
    : { data: null, error: null };

  if (wigResult.error) {
    logAppError('wig_request.query.fetchLatestWigAllocationByPatientDetailsId.wig', wigResult.error, {
      table: wigsTable,
      phase: 'read',
      filters: { Wig_ID: result.data.wig_id || null },
    });
  }

  const physicalSpecResult = wigResult.data?.wig_id
    ? await supabase
      .from(wigPhysicalSpecificationsTable)
      .select(wigPhysicalSpecificationSelect)
      .eq('Wig_ID', wigResult.data.wig_id)
      .maybeSingle()
    : { data: null, error: null };

  if (physicalSpecResult.error) {
    logAppError('wig_request.query.fetchLatestWigAllocationByPatientDetailsId.physical_spec', physicalSpecResult.error, {
      table: wigPhysicalSpecificationsTable,
      phase: 'read',
      filters: { Wig_ID: wigResult.data?.wig_id || null },
    });
  }

  const wigRequestResult = result.data.wig_request_id
    ? await supabase
      .from(wigRequestsTable)
      .select(wigRequestSelect)
      .eq('Req_ID', result.data.wig_request_id)
      .maybeSingle()
    : { data: null, error: null };

  if (wigRequestResult.error) {
    logAppError('wig_request.query.fetchLatestWigAllocationByPatientDetailsId.request', wigRequestResult.error, {
      table: wigRequestsTable,
      phase: 'read',
      filters: { Req_ID: result.data.wig_request_id || null },
    });
  }

  const requestSpecificationResult = wigRequestResult.data?.req_id
    ? await supabase
      .from(wigRequestSpecificationsTable)
      .select(wigSpecificationSelect)
      .eq('Req_ID', wigRequestResult.data.req_id)
      .maybeSingle()
    : { data: null, error: null };

  if (requestSpecificationResult.error) {
    logAppError('wig_request.query.fetchLatestWigAllocationByPatientDetailsId.specification', requestSpecificationResult.error, {
      table: wigRequestSpecificationsTable,
      phase: 'read',
      filters: { Req_ID: wigRequestResult.data?.req_id || null },
    });
  }

  return {
    data: result.data ? normalizeWigAllocation({
      ...result.data,
      wigs: wigResult.data
        ? [{
            ...wigResult.data,
            wig_physical_specifications: physicalSpecResult.data ? [physicalSpecResult.data] : [],
          }]
        : [],
      wig_requests: wigRequestResult.data
        ? [{
            ...wigRequestResult.data,
            wig_request_specifications: requestSpecificationResult.data ? [requestSpecificationResult.data] : [],
          }]
        : [],
    }) : null,
    error: result.error,
  };
};

/** Allocation and wig identity/status only; used by process tracking. */
export const fetchLatestWigAllocationTrackingByPatientId = async (patientId) => {
  const allocationResult = await supabase
    .from(wigAllocationsTable)
    .select(wigAllocationSelect)
    .eq('Patient_ID', patientId)
    .order('Allocated_At', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (allocationResult.error || !allocationResult.data) {
    return {
      data: allocationResult.data ? normalizeWigAllocation(allocationResult.data) : null,
      error: allocationResult.error,
    };
  }

  const wigResult = allocationResult.data.wig_id
    ? await supabase
      .from(wigsTable)
      .select(wigSelect)
      .eq('Wig_ID', allocationResult.data.wig_id)
      .maybeSingle()
    : { data: null, error: null };

  return {
    data: normalizeWigAllocation({
      ...allocationResult.data,
      wigs: wigResult.data ? [wigResult.data] : [],
    }),
    error: allocationResult.error || wigResult.error || null,
  };
};
