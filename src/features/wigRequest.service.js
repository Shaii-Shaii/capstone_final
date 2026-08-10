import * as WigRequestAPI from './wigRequest.api';
import {
  buildImmediateNotificationEvents,
  recordNotifications,
} from './notification.service';
import {
  createPatientDetails,
  fetchPatientDetailsByUserId,
  resolveSystemUser,
  updatePatientPictureByPatientId,
} from './profile/api/profile.api';
import { ensureActiveSession } from '../api/supabase/client';
import { wigRequestStatuses } from './wigRequest.constants';
import { logAppError, logAppEvent, writeAuditLog } from '../utils/appErrors';

const getFileExtension = (mimeType = 'image/jpeg') => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  return 'jpg';
};

const buildUploadedWigRequestImageUrl = async ({
  userId,
  image,
  fileNamePrefix = 'wig-reference',
}) => {
  if (!image?.uri) return null;

  const sessionResult = await ensureActiveSession();
  const activeAuthUserId = sessionResult?.session?.user?.id || '';
  if (sessionResult?.error || !activeAuthUserId) {
    throw new Error('Please sign in again before uploading your wig request image.');
  }

  if (userId && activeAuthUserId !== userId) {
    throw new Error('Your session changed. Please sign in again before submitting a wig request.');
  }

  const fileResponse = await fetch(image.uri);
  const fileBody = await fileResponse.arrayBuffer();
  const extension = getFileExtension(image.mimeType);
  const filePath = `${activeAuthUserId}/${fileNamePrefix}-${Date.now()}.${extension}`;

  const uploadResult = await WigRequestAPI.uploadWigReferenceImage({
    path: filePath,
    fileBody,
    contentType: image.mimeType || 'image/jpeg',
  });

  if (uploadResult.error) {
    throw new Error(uploadResult.error.message || 'Unable to upload the wig request image.');
  }

  const { data } = WigRequestAPI.getStoragePublicUrl({ path: filePath });
  return data?.publicUrl || filePath;
};

const buildReferenceImageUrl = async ({ userId, referenceImage }) =>
  buildUploadedWigRequestImageUrl({
    userId,
    image: referenceImage,
    fileNamePrefix: 'wig-reference',
  });

const buildPreviewImageUrl = async ({ userId, previewImage }) =>
  buildUploadedWigRequestImageUrl({
    userId,
    image: previewImage,
    fileNamePrefix: 'wig-preview',
  });

const COMPLETED_REQUEST_TOKENS = ['completed', 'claimed', 'released', 'cancelled', 'canceled', 'rejected', 'closed'];

const isOngoingWigRequest = (request) => {
  if (!request?.req_id) return false;
  const status = String(request.status || '').trim().toLowerCase();
  if (!status) return true;
  return !COMPLETED_REQUEST_TOKENS.some((token) => status.includes(token));
};

const isCancellableWigRequest = (request) => {
  if (!request?.req_id) return false;
  const status = String(request.status || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!status) return true;
  return ![
    'accepted',
    'approved',
    'in production',
    'to be release',
    'releasing',
    'released',
    'cancelled',
    'canceled',
    'rejected',
    'closed',
  ].some((token) => status.includes(token));
};

const ensurePatientDetails = async (userId) => {
  const { data: existingPatientDetails, error: patientDetailsError } = await fetchPatientDetailsByUserId(userId);
  if (patientDetailsError) {
    throw new Error(patientDetailsError.message || 'Unable to load patient details.');
  }

  if (existingPatientDetails?.id) {
    return existingPatientDetails;
  }

  const { data: createdPatientDetails, error: createPatientDetailsError } = await createPatientDetails({
    user_id: userId,
  });

  if (!createPatientDetailsError && createdPatientDetails?.id) {
    return createdPatientDetails;
  }

  const createErrorMessage = String(createPatientDetailsError?.message || '').toLowerCase();
  if (createErrorMessage.includes('duplicate') || createErrorMessage.includes('already exists')) {
    const { data: retriedPatientDetails, error: retriedPatientDetailsError } = await fetchPatientDetailsByUserId(userId);
    if (retriedPatientDetailsError) {
      throw new Error(retriedPatientDetailsError.message || 'Unable to load patient details.');
    }

    if (retriedPatientDetails?.id) {
      return retriedPatientDetails;
    }
  }

  throw new Error(
    createPatientDetailsError?.message
    || 'Unable to prepare the patient record needed for wig requests.'
  );
};

export const getPatientWigRequestContext = async (userId) => {
  try {
    if (!userId) {
      throw new Error('Your session is not ready.');
    }

    const sessionResult = await ensureActiveSession();
    const activeAuthUserId = sessionResult?.session?.user?.id || '';
    if (sessionResult?.error || !activeAuthUserId) {
      throw new Error('Your session has expired. Please sign in again.');
    }
    if (activeAuthUserId !== userId) {
      throw new Error('Your session changed. Please sign in again.');
    }

    logAppEvent('wig_request.context', 'Loading wig request context.', {
      userId,
    });

    const patientDetails = await ensurePatientDetails(userId);

    const [{ data: latestWigRequest, error: wigRequestError }, { data: latestAllocation, error: allocationError }] =
      await Promise.all([
        WigRequestAPI.fetchLatestWigRequestByPatientDetailsId(patientDetails.patient_id),
        WigRequestAPI.fetchLatestWigAllocationByPatientDetailsId(patientDetails.patient_id),
      ]);

    if (wigRequestError) {
      throw new Error(wigRequestError.message || 'Unable to load the latest wig request.');
    }

    if (allocationError) {
      throw new Error(allocationError.message || 'Unable to load the latest wig allocation.');
    }

    const { data: latestWigSpecification, error: wigSpecificationError } = latestWigRequest?.req_id
      ? await WigRequestAPI.fetchLatestWigSpecificationByRequestId(latestWigRequest.req_id)
      : { data: null, error: null };

    if (wigSpecificationError) {
      throw new Error(wigSpecificationError.message || 'Unable to load the latest wig specification.');
    }

    const hospitalId = latestWigRequest?.hospital_id || patientDetails.hospital_id || null;
    const selectedWigId = latestWigRequest?.allocated_wig_id
      || latestAllocation?.wig_id
      || latestWigRequest?.requested_wig_id
      || null;

    const [
      { data: requestHospital, error: hospitalError },
      { data: requestWig, error: requestWigError },
      { data: latestReleaseSchedule, error: releaseScheduleError },
      { data: safetyAssessment, error: safetyAssessmentError },
    ] = await Promise.all([
      hospitalId ? WigRequestAPI.fetchHospitalById(hospitalId) : { data: null, error: null },
      selectedWigId ? WigRequestAPI.fetchWigDetailsById(selectedWigId) : { data: null, error: null },
      latestWigRequest?.req_id
        ? WigRequestAPI.fetchLatestReleaseScheduleByRequestId(latestWigRequest.req_id)
        : { data: null, error: null },
      latestWigRequest?.req_id
        ? WigRequestAPI.fetchPatientWigSafetyAssessmentByRequestId(latestWigRequest.req_id)
        : { data: null, error: null },
    ]);

    if (hospitalError) {
      throw new Error(hospitalError.message || 'Unable to load the request hospital.');
    }

    if (requestWigError) {
      throw new Error(requestWigError.message || 'Unable to load the request wig specification.');
    }

    if (releaseScheduleError) {
      throw new Error(releaseScheduleError.message || 'Unable to load the release schedule.');
    }

    if (safetyAssessmentError) {
      throw new Error(safetyAssessmentError.message || 'Unable to load the wig safety assessment.');
    }

    return {
      patientDetails,
      latestWigRequest,
      latestWigSpecification,
      latestAllocation,
      requestHospital,
      requestWig,
      latestReleaseSchedule,
      safetyAssessment,
      error: null,
    };
  } catch (error) {
    return {
      patientDetails: null,
      latestWigRequest: null,
      latestWigSpecification: null,
      latestAllocation: null,
      requestHospital: null,
      requestWig: null,
      latestReleaseSchedule: null,
      safetyAssessment: null,
      error: error.message || 'Unable to load the patient wig request context.',
    };
  }
};

export const getActiveWigTryOnFilters = async () => {
  try {
    const [{ data, error }, { data: physicalSpecs, error: physicalSpecError }] = await Promise.all([
      WigRequestAPI.fetchActiveWigAiFilters(),
      WigRequestAPI.fetchWigPhysicalSpecifications(),
    ]);

    if (error) {
      throw new Error(error.message || 'Unable to load available wigs.');
    }

    if (physicalSpecError) {
      throw new Error(physicalSpecError.message || 'Unable to load wig specifications.');
    }

    const physicalSpecsByWigId = new Map(
      (physicalSpecs || []).map((specification) => [String(specification.wig_id), specification])
    );
    const wigs = (data || []).map((wig) => ({
      ...wig,
      physical_specification: physicalSpecsByWigId.get(String(wig.wig_id)) || {
        wig_id: wig.wig_id || null,
        length: wig.pending_hair_length ?? null,
        color: wig.pending_hair_color || '',
        hair_texture: wig.pending_hair_texture || '',
        hair_density: wig.pending_hair_density || '',
        cap_size: wig.pending_cap_size || '',
        style: wig.pending_style || '',
      },
    }));

    return {
      wigs,
      error: null,
    };
  } catch (error) {
    logAppError('wig_request.try_on_filters', error);
    return {
      wigs: [],
      error: error.message || 'Unable to load available wigs.',
    };
  }
};

const normalizePreferenceText = (value) => String(value ?? '').trim();

const formatLengthPreference = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return '';
  return Number.isInteger(numericValue) ? String(numericValue) : String(Number(numericValue.toFixed(2)));
};

const collectUnique = (items, mapper) => {
  const values = [];
  const seen = new Set();

  items.forEach((item) => {
    const value = normalizePreferenceText(mapper(item));
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(value);
  });

  return values;
};

export const getWigPreferenceOptions = async () => {
  try {
    const { data, error } = await WigRequestAPI.fetchWigPhysicalSpecifications();

    if (error) {
      throw new Error(error.message || 'Unable to load wig preference options.');
    }

    const specifications = data || [];

    return {
      options: {
        lengths: collectUnique(specifications, (item) => formatLengthPreference(item.length)),
        colors: collectUnique(specifications, (item) => item.color),
        textures: collectUnique(specifications, (item) => item.hair_texture),
        densities: collectUnique(specifications, (item) => item.hair_density),
        capSizes: collectUnique(specifications, (item) => item.cap_size),
        styles: collectUnique(specifications, (item) => item.style),
      },
      error: null,
    };
  } catch (error) {
    logAppError('wig_request.preference_options', error);
    return {
      options: {
        lengths: [],
        colors: [],
        textures: [],
        densities: [],
        capSizes: [],
        styles: [],
      },
      error: error.message || 'Unable to load wig preference options.',
    };
  }
};

export const savePatientWigRequestFlow = async ({
  userId,
  preferences,
  preview,
  previewImage,
  referenceImage,
  selectedWigId = null,
}) => {
  try {
    if (!userId) throw new Error('Your session is not ready.');

    logAppEvent('wig_request.save', 'Saving wig request flow.', {
      userId,
      hasReferenceImage: Boolean(referenceImage?.uri),
      hasPreviewImage: Boolean(previewImage?.uri),
      hasPreview: Boolean(preview),
      previewKeys: preview ? Object.keys(preview) : [],
      selectedOptionId: preview?.selected_option_id || '',
      selectedOptionIndex: preview?.selected_option_index || null,
    });

    const patientDetails = await ensurePatientDetails(userId);

    const { data: existingWigRequest, error: existingWigRequestError } =
      await WigRequestAPI.fetchLatestWigRequestByPatientDetailsId(patientDetails.patient_id);

    if (existingWigRequestError) {
      throw new Error(existingWigRequestError.message || 'Unable to check existing wig requests.');
    }

    if (isOngoingWigRequest(existingWigRequest)) {
      logAppEvent('wig_request.save', 'Existing ongoing wig request found; skipping duplicate create.', {
        userId,
        reqId: existingWigRequest.req_id || null,
      }, 'info');

      return {
        wigRequest: existingWigRequest,
        wigSpecification: null,
        alreadyExists: true,
        warning: null,
        error: null,
      };
    }

    const { data: systemUser, error: systemUserError } = await resolveSystemUser(userId);
    if (systemUserError) {
      throw new Error(systemUserError.message || 'Unable to resolve the patient account.');
    }

    let savedPreviewImageUrl = null;
    if (previewImage?.uri) {
      try {
        savedPreviewImageUrl = await buildPreviewImageUrl({ userId, previewImage });
      } catch (uploadError) {
        logAppEvent('wig_request.save', 'Adjusted wig preview upload failed.', {
          userId,
          patientId: patientDetails.patient_id,
          uploadError: uploadError.message || 'Wig preview upload error',
        }, 'warn');
        throw uploadError;
      }
    }

    // Create main wig request first (BEFORE uploading reference image)
    const { data: wigRequest, error: wigRequestError } = await WigRequestAPI.createWigRequest({
      patient_id: patientDetails.patient_id,
      hospital_id: patientDetails.hospital_id || null,
      requested_by: systemUser?.user_id || null,
      request_date: new Date().toISOString(),
      status: wigRequestStatuses.pending,
      requested_wig_id: selectedWigId || null,
    });

    if (wigRequestError) {
      throw new Error(wigRequestError.message || 'Unable to create the wig request.');
    }

    // Upload reference image AFTER wig request is created
    // If upload fails, the request still succeeds (reference photo is optional)
    let referenceImageUrl = null;
    if (referenceImage?.uri) {
      try {
        referenceImageUrl = await buildReferenceImageUrl({ userId, referenceImage });
        
        if (referenceImageUrl && patientDetails.patient_id) {
          logAppEvent('wig_request.save', 'Updating patient reference image after wig request creation.', {
            userId,
            patientId: patientDetails.patient_id,
          });

          const patientPictureResult = await updatePatientPictureByPatientId(patientDetails.patient_id, referenceImageUrl);
          if (patientPictureResult.error) {
            logAppEvent('wig_request.save', 'Failed to update patient picture, but wig request is created.', {
              userId,
              patientId: patientDetails.patient_id,
              error: patientPictureResult.error.message || 'Unable to save the patient reference photo.',
            }, 'warn');
            // Don't throw - reference photo update is not critical
          }
        }
      } catch (uploadError) {
        logAppEvent('wig_request.save', 'Reference image upload failed, but wig request is created and will continue.', {
          userId,
          patientId: patientDetails.patient_id,
          uploadError: uploadError.message || 'Reference image upload error',
        }, 'warn');
        // Don't throw - reference photo is optional
      }
    }

    logAppEvent('wig_request.save', 'Wig request row created.', {
      userId,
      reqId: wigRequest?.req_id || null,
      patientId: patientDetails.patient_id,
    });

    const preferenceNotes = [
      preferences.hairDensity ? `Hair density preference: ${preferences.hairDensity}` : '',
      preferences.specialNotes,
      preview?.style_notes,
      preview?.summary,
    ].filter(Boolean).join('\n\n') || null;

    const { data: wigSpecification, error: wigSpecificationError } = await WigRequestAPI.createWigSpecification({
      wig_request_id: wigRequest.req_id,
      preferred_color: preferences.preferredColor,
      preferred_length: preferences.preferredLength,
      hair_texture: preferences.hairTexture || null,
      cap_size: preferences.capSize || null,
      style_preference: preferences.stylePreference || preview?.recommended_style_name || null,
      notes: preferenceNotes,
      ai_wig_preview_url: savedPreviewImageUrl || preview?.preview_url || preview?.generated_image_data_url || null,
    });

    logAppEvent('wig_request.save', 'Wig specification payload prepared.', {
      userId,
      reqId: wigRequest?.req_id || null,
      previewPayloadKeys: preview ? Object.keys(preview) : [],
      selectedOptionId: preview?.selected_option_id || '',
      selectedPreviewUrl: savedPreviewImageUrl || preview?.preview_url || preview?.generated_image_data_url || '',
      dbPayloadKeys: [
        'preferred_color',
        'preferred_length',
        'hair_texture',
        'cap_size',
        'style_preference',
        'special_notes',
        'ai_wig_preview_url',
      ],
      renderKey: 'ai_wig_preview_url',
    });

    let savedWigSpecification = wigSpecification;
    let specificationWarning = null;
    if (wigSpecificationError) {
      specificationWarning = wigSpecificationError.message || 'Wig request saved without preferences.';
      savedWigSpecification = null;
      logAppEvent('wig_request.save', 'Wig specification save failed after request row creation.', {
        userId,
        reqId: wigRequest?.req_id || null,
        error: specificationWarning,
      }, 'warn');
    } else {
      logAppEvent('wig_request.save', 'Wig specification row saved.', {
        userId,
        reqId: wigRequest?.req_id || null,
        reqSpecId: savedWigSpecification?.req_spec_id || null,
        hasPreviewUrl: Boolean(savedWigSpecification?.ai_wig_preview_url),
      });
    }

    const notificationEvents = buildImmediateNotificationEvents({
      role: 'patient',
      payload: {
        wigRequest,
      },
    });

    try {
      if (notificationEvents.length) {
        void recordNotifications({
          userId,
          role: 'patient',
          notifications: notificationEvents,
        }).catch((notificationError) => {
          logAppError('wig_request.save.notifications', notificationError, {
            userId,
            reqId: wigRequest?.req_id || null,
          });
        });
      }
    } catch (notificationError) {
      logAppError('wig_request.save.notifications', notificationError, {
        userId,
        reqId: wigRequest?.req_id || null,
      });
    }

    try {
      void writeAuditLog({
        authUserId: userId,
        databaseUserId: systemUser?.user_id || null,
        action: 'wig_request.create',
        description: `Created wig request ${wigRequest.req_id || wigRequest.id}.`,
        resource: 'wig_requests',
        status: 'success',
      }).catch((auditError) => {
        logAppError('wig_request.save.audit', auditError, {
          userId,
          reqId: wigRequest?.req_id || null,
        });
      });
    } catch (auditError) {
      logAppError('wig_request.save.audit', auditError, {
        userId,
        reqId: wigRequest?.req_id || null,
      });
    }

    return {
      wigRequest,
      wigSpecification: savedWigSpecification,
      warning: specificationWarning,
      error: null,
    };
  } catch (error) {
    try {
      await writeAuditLog({
        authUserId: userId,
        action: 'wig_request.create',
        description: error.message || 'Unable to save wig request.',
        resource: 'wig_requests',
        status: 'failed',
      });
    } catch (auditError) {
      logAppError('wig_request.save.failed_audit', auditError, { userId });
    }

    return {
      wigRequest: null,
      wigSpecification: null,
      error: error.message || 'Unable to save the wig request.',
    };
  }
};

export const cancelPatientWigRequest = async ({ userId, wigRequestId }) => {
  try {
    if (!userId) throw new Error('Your session is not ready.');
    if (!wigRequestId) throw new Error('No request selected.');

    const patientDetails = await ensurePatientDetails(userId);
    const { data: latestWigRequest, error: latestWigRequestError } =
      await WigRequestAPI.fetchLatestWigRequestByPatientDetailsId(patientDetails.patient_id);

    if (latestWigRequestError) {
      throw new Error(latestWigRequestError.message || 'Unable to check this request.');
    }

    if (!latestWigRequest?.req_id || String(latestWigRequest.req_id) !== String(wigRequestId)) {
      throw new Error('This request is no longer active.');
    }

    if (!isCancellableWigRequest(latestWigRequest)) {
      throw new Error('This request can no longer be cancelled.');
    }

    const { data: cancelledRequest, error: cancelError } = await WigRequestAPI.cancelPendingWigRequest({
      reqId: latestWigRequest.req_id,
      patientId: patientDetails.patient_id,
    });

    if (cancelError) {
      throw new Error(cancelError.message || 'Unable to cancel this request.');
    }

    if (!cancelledRequest?.req_id) {
      const { data: refreshedWigRequest } =
        await WigRequestAPI.fetchLatestWigRequestByPatientDetailsId(patientDetails.patient_id);

      if (String(refreshedWigRequest?.status || '').trim().toLowerCase() === 'cancelled') {
        return {
          wigRequest: refreshedWigRequest,
          error: null,
        };
      }

      throw new Error('Unable to cancel this request. Please apply the patient cancel policy in Supabase.');
    }

    try {
      const { data: systemUser } = await resolveSystemUser(userId);
      await writeAuditLog({
        authUserId: userId,
        databaseUserId: systemUser?.user_id || null,
        action: 'wig_request.cancel',
        description: `Cancelled wig request ${latestWigRequest.req_id}.`,
        resource: 'wig_requests',
        status: 'success',
      });
    } catch (auditError) {
      logAppError('wig_request.cancel.audit', auditError, {
        userId,
        reqId: latestWigRequest.req_id,
      });
    }

    return {
      wigRequest: cancelledRequest,
      error: null,
    };
  } catch (error) {
    logAppError('wig_request.cancel', error, {
      userId,
      wigRequestId,
    });

    return {
      wigRequest: null,
      error: error.message || 'Unable to cancel this request.',
    };
  }
};
