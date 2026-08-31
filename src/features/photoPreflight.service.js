import { invokeEdgeFunction } from '../api/supabase/client';

const toSafeMessage = (value, fallback = '') => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value.message === 'string' && value.message.trim()) return value.message.trim();
  if (value && typeof value.error === 'string' && value.error.trim()) return value.error.trim();
  return fallback;
};

const normalizeViewKey = (view = {}) => (
  String(view?.key || view?.label || '')
    .trim()
    .toLowerCase()
);

const normalizeViewLabel = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('back hair') || normalized.includes('back view') || normalized === 'back' || normalized.includes('back')) {
    return 'Back Hair Photo';
  }
  if (normalized.includes('hair ends') || normalized.includes('ends close')) {
    return 'Hair Ends Close-Up';
  }
  if (normalized.includes('hair scalp') || normalized.includes('scalp') || normalized.includes('crown')) {
    return 'Hair Scalp';
  }
  if (normalized.includes('front view') || normalized === 'front' || normalized.includes('front')) {
    return 'Front View Photo';
  }
  if (normalized.includes('right side') || normalized.includes('right_side')) {
    return 'Right Side Photo';
  }
  if (normalized.includes('side profile') || normalized.includes('side view') || normalized.includes('left side') || normalized.includes('right side') || normalized.includes('side')) {
    return 'Side Profile Photo';
  }
  return String(value || '').trim();
};

const hasImagePayload = (photo = null) => Boolean(
  photo?.uri
  && (photo?.dataUrl || photo?.base64 || photo?.file)
);

const buildMissingPhotoDetails = ({ photos = [], requiredViews = [] } = {}) => (
  requiredViews
    .map((view, index) => ({
      viewLabel: view?.label || `Photo ${index + 1}`,
      error: hasImagePayload(photos[index]) ? '' : 'Missing or unreadable photo.',
    }))
    .filter((item) => item.error)
);

const hasCanonicalView = (photos = [], canonicalLabel = '') => photos.some((photo) => (
  normalizeViewLabel(photo?.viewLabel || photo?.viewKey) === canonicalLabel
));

const hasRequiredViewSet = (requiredViews = []) => {
  const keys = requiredViews.map(normalizeViewKey);
  return (
    keys.some((key) => key.includes('front'))
    && keys.some((key) => key.includes('side'))
    && keys.some((key) => key.includes('scalp') || key.includes('crown'))
  );
};

const buildValidationPayloadImages = ({ photos = [], requiredViews = [] } = {}) => (
  photos
    .map((photo, index) => {
      if (!photo?.dataUrl) return null;
      const view = requiredViews[index] || {};
      return {
        dataUrl: photo.dataUrl,
        mimeType: photo.mimeType || 'image/jpeg',
        viewKey: photo.viewKey || view?.key || `view_${index + 1}`,
        viewLabel: photo.viewLabel || view?.label || `Photo ${index + 1}`,
      };
    })
    .filter(Boolean)
);

const buildRemoteValidationDetails = (failedViews = [], reason = '') => {
  const views = Array.isArray(failedViews) && failedViews.length ? failedViews : ['Photo set'];
  return views.map((viewLabel) => ({
    viewLabel,
    error: reason || 'Photos must show the same person and same current hair.',
  }));
};

const isSoftCrossViewMismatchReason = (reason = '') => {
  const normalized = String(reason || '').toLowerCase();
  return (
    normalized.includes('views do not match')
    || normalized.includes('hair views do not match')
    || normalized.includes('front view are inconsistent')
    || normalized.includes('front and side')
    || normalized.includes('side profile and front')
    || normalized.includes('inconsistent')
  ) && !(
    normalized.includes('different person')
    || normalized.includes('different people')
    || normalized.includes('unrelated')
    || normalized.includes('stock')
    || normalized.includes('watermark')
    || normalized.includes('downloaded')
    || normalized.includes('wig')
    || normalized.includes('extension')
    || normalized.includes('hairpiece')
    || normalized.includes('accessor')
    || normalized.includes('headband')
    || normalized.includes('clip')
  );
};

const isInternalValidationReason = (reason = '') => {
  const normalized = String(reason || '').toLowerCase();
  return (
    normalized.includes('incomplete json')
    || normalized.includes('invalid json')
    || normalized.includes('json input')
    || normalized.includes('json schema')
    || normalized.includes('schema')
    || normalized.includes('provider')
    || normalized.includes('api')
  );
};

const toMillis = (value) => {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const getPhotoCapturedAt = (photo = null) => (
  photo?.capturedAt
  || photo?.photoValidation?.capturedAt
  || null
);

const buildQuickImageFingerprint = (photo = null) => {
  const base64 = String(photo?.base64 || '');
  if (!base64) return '';
  const head = base64.slice(0, 48);
  const tail = base64.slice(-48);
  return `${base64.length}:${head}:${tail}`;
};

const evaluateFraudRiskSignals = ({ photos = [], requiredViews = [] } = {}) => {
  const details = [];
  let riskScore = 0;

  const sources = photos.map((photo) => String(photo?.sourceType || '').toLowerCase());
  const uploadCount = sources.filter((source) => source === 'upload').length;
  if (uploadCount === photos.length && photos.length > 0) {
    riskScore += 55;
    details.push({ viewLabel: 'Capture flow', error: 'Use in-app camera for all required views.' });
  } else if (uploadCount > 0) {
    riskScore += 25;
    details.push({ viewLabel: 'Capture flow', error: 'Mixed source detected. Retake using in-app camera only.' });
  }

  const captureSessionIds = new Set(
    photos.map((photo) => String(photo?.captureSessionId || '').trim()).filter(Boolean)
  );
  if (captureSessionIds.size > 1) {
    riskScore += 20;
    details.push({ viewLabel: 'Session', error: 'Capture all required views in one session.' });
  }

  const timestamps = photos.map((photo) => toMillis(getPhotoCapturedAt(photo))).filter(Boolean).sort((a, b) => a - b);
  const freshnessWindowMs = 1000 * 60 * 20;
  if (timestamps.length) {
    const oldest = timestamps[0];
    if (Date.now() - oldest > freshnessWindowMs) {
      riskScore += 20;
      details.push({ viewLabel: 'Recency', error: 'Photos are not recent. Retake now.' });
    }
  }

  const staleOrderSignals = requiredViews.some((_view, index) => {
    const current = toMillis(getPhotoCapturedAt(photos[index]));
    const previous = index > 0 ? toMillis(getPhotoCapturedAt(photos[index - 1])) : null;
    return Boolean(current && previous && current < previous);
  });
  if (staleOrderSignals) {
    riskScore += 20;
    details.push({ viewLabel: 'Sequence', error: 'Retake the guided views in the same order they appear.' });
  }

  const duplicateMap = new Map();
  photos.forEach((photo, index) => {
    const key = buildQuickImageFingerprint(photo);
    if (!key) return;
    const list = duplicateMap.get(key) || [];
    list.push(index);
    duplicateMap.set(key, list);
  });
  const hasDuplicate = [...duplicateMap.values()].some((indexes) => indexes.length > 1);
  if (hasDuplicate) {
    riskScore += 45;
    details.push({ viewLabel: 'Duplicate', error: 'Duplicate photo detected across required views.' });
  }

  const riskLevel = riskScore >= 60 ? 'high' : riskScore >= 25 ? 'medium' : 'low';
  return { riskScore, riskLevel, details };
};

const runCrossViewPhotoValidation = async ({ photos = [], requiredViews = [] } = {}) => {
  const images = buildValidationPayloadImages({ photos, requiredViews });
  if (images.length !== requiredViews.length) {
    return {
      ok: false,
      skipped: false,
      hardBlock: true,
      title: 'Photo Match Check Failed',
      message: 'Photos could not be verified. Please retake the required views.',
      details: [],
      validationMode: 'remote_cross_view_missing_payload',
    };
  }

  const result = await invokeEdgeFunction('validate-hair-photo-set', {
    body: { images },
  });

  if (result.error) {
    return {
      ok: true,
      skipped: false,
      hardBlock: false,
      title: 'Photos Ready',
      message: 'Photo check will continue in the full analysis.',
      details: [],
      validationMode: 'remote_cross_view_unavailable_pass',
      validationWarning: toSafeMessage(result.error, 'Remote photo match check unavailable.'),
    };
  }

  const validation = result.data?.validation || {};
  const visualScreeningCompleted = validation.visual_screening_completed === true;
  const accessoriesDetected = visualScreeningCompleted
    ? validation.accessories_detected === true
      ? true
      : validation.accessories_detected === false
        ? false
        : null
    : null;
  const reportedHairAuthenticityStatus = [
    'likely_natural',
    'possible_wig_or_extensions',
    'unclear',
  ].includes(String(validation.hair_authenticity_status || '').trim().toLowerCase())
    ? String(validation.hair_authenticity_status).trim().toLowerCase()
    : 'unclear';
  const hairAuthenticityStatus = visualScreeningCompleted
    ? reportedHairAuthenticityStatus
    : 'unclear';
  const appearanceFlags = Array.isArray(validation.appearance_flags)
    ? validation.appearance_flags.map((flag) => String(flag || '').trim()).filter(Boolean)
    : [];
  const hasArtificialHairConcern = hairAuthenticityStatus === 'possible_wig_or_extensions';
  const isAcceptable = validation.is_acceptable === true
    && accessoriesDetected !== true
    && !hasArtificialHairConcern;
  const visualConcernReason = accessoriesDetected === true
    ? toSafeMessage(validation.accessory_notes, 'Remove accessories or objects blocking the hair, then retake the affected views.')
    : hasArtificialHairConcern
      ? toSafeMessage(validation.hair_authenticity_notes, 'Possible wig, hairpiece, or extensions detected. Retake with the natural hairline and roots clearly visible.')
      : '';
  const reason = visualConcernReason || toSafeMessage(validation.reason, isAcceptable
    ? 'Ready for analysis.'
    : 'Photos must show the same person and same current hair.');
  const failedViews = Array.isArray(validation.failed_views)
    ? validation.failed_views
    : [];
  const resolvedFailedViews = failedViews.length || !visualConcernReason
    ? failedViews
    : ['Photo set'];

  if (!isAcceptable && isInternalValidationReason(reason)) {
    return {
      ok: true,
      skipped: false,
      hardBlock: false,
      title: 'Photos Ready',
      message: 'Photo check will continue in the full analysis.',
      details: [],
      validationMode: 'remote_cross_view_internal_pass',
      validationWarning: reason,
      accessoriesDetected,
      hairAuthenticityStatus,
      appearanceFlags,
      visualScreeningCompleted,
    };
  }

  if (!isAcceptable && isSoftCrossViewMismatchReason(reason)) {
    return {
      ok: true,
      skipped: false,
      hardBlock: false,
      title: 'Photos Ready',
      message: 'Photo check passed. The full analysis will verify the hair details.',
      details: [],
      validationMode: 'remote_cross_view_soft_pass',
      validationWarning: reason,
      accessoriesDetected,
      hairAuthenticityStatus,
      appearanceFlags,
      visualScreeningCompleted,
    };
  }

  return {
    ok: isAcceptable,
    skipped: false,
    hardBlock: !isAcceptable,
    title: isAcceptable
      ? 'Photos Ready'
      : accessoriesDetected === true
        ? 'Remove Hair Accessories'
        : hasArtificialHairConcern
          ? 'Hair Verification Needed'
          : 'Photos Do Not Match',
    message: isAcceptable ? 'Ready for analysis.' : reason,
    details: isAcceptable ? [] : buildRemoteValidationDetails(resolvedFailedViews, reason),
    validationMode: 'remote_cross_view',
    accessoriesDetected,
    accessoryNotes: toSafeMessage(validation.accessory_notes),
    hairAuthenticityStatus,
    hairAuthenticityNotes: toSafeMessage(validation.hair_authenticity_notes),
    appearanceFlags,
    visualScreeningCompleted,
  };
};

export const validateHairPhotosBeforeAnalysis = async ({ photos = [], requiredViews = [] } = {}) => {
  const filledPhotos = photos.filter(Boolean);
  const missingDetails = buildMissingPhotoDetails({ photos, requiredViews });

  if (!requiredViews.length || filledPhotos.length !== requiredViews.length || missingDetails.length) {
    return {
      ok: false,
      skipped: false,
      hardBlock: true,
      title: 'Photos Incomplete',
      message: 'Add all required photos before analysis.',
      details: missingDetails,
      validationMode: 'local',
    };
  }

  if (!hasRequiredViewSet(requiredViews)) {
    return {
      ok: false,
      skipped: false,
      hardBlock: true,
      title: 'Photo Setup Needed',
      message: 'Use the required front, left side, right side, scalp, back, and hair-ends views.',
      details: [],
      validationMode: 'local',
    };
  }

  const crossViewResult = await runCrossViewPhotoValidation({ photos, requiredViews });
  if (!crossViewResult?.ok) {
    const failedViewLabels = Array.isArray(crossViewResult?.details)
      ? crossViewResult.details.map((detail) => normalizeViewLabel(detail?.viewLabel || '')).filter(Boolean)
      : [];
    const scalpOnlyFailure = failedViewLabels.length === 1 && failedViewLabels[0] === 'Hair Scalp';
    const hasAppearanceConcern = crossViewResult?.accessoriesDetected === true
      || crossViewResult?.hairAuthenticityStatus === 'possible_wig_or_extensions';
    if (scalpOnlyFailure && !hasAppearanceConcern && hasCanonicalView(photos, 'Hair Scalp')) {
      return {
        ok: true,
        skipped: false,
        hardBlock: false,
        title: 'Photos Ready',
        message: 'Photo check passed. The full hair analysis will verify these photos.',
        details: [],
        validationMode: 'local_scalp_soft_pass',
        validationWarning: crossViewResult?.message || 'Hair Scalp view was not clearly recognized.',
      };
    }
    return crossViewResult;
  }

  const fraudRisk = evaluateFraudRiskSignals({ photos, requiredViews });
  if (fraudRisk.riskLevel === 'high') {
    return {
      ok: false,
      skipped: false,
      hardBlock: true,
      title: 'Retake required',
      message: 'Photo risk is high. Retake all required views using live camera.',
      details: fraudRisk.details.slice(0, 2),
      validationMode: 'fraud_risk',
      riskLevel: fraudRisk.riskLevel,
      riskScore: fraudRisk.riskScore,
    };
  }

  if (fraudRisk.riskLevel === 'medium') {
    return {
      ok: false,
      skipped: false,
      hardBlock: false,
      title: 'Retake required',
      message: 'Photo check flagged a risk. Please retake for a cleaner scan.',
      details: fraudRisk.details.slice(0, 2),
      validationMode: 'fraud_risk',
      riskLevel: fraudRisk.riskLevel,
      riskScore: fraudRisk.riskScore,
    };
  }

  return {
    ...crossViewResult,
    riskLevel: fraudRisk.riskLevel,
    riskScore: fraudRisk.riskScore,
  };
};
