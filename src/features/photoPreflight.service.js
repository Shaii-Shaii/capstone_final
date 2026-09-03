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
      const validationDataUrl = photo?.validationDataUrl || photo?.dataUrl;
      if (!validationDataUrl) return null;
      const view = requiredViews[index] || {};
      return {
        dataUrl: validationDataUrl,
        mimeType: photo.validationMimeType || photo.mimeType || 'image/jpeg',
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

const normalizeRemoteAccessoryFindings = (value = []) => (
  Array.isArray(value)
    ? value.map((finding) => ({
        viewLabel: String(finding?.view_label || '').trim(),
        accessory: String(finding?.accessory || '').trim(),
        blocksRequiredHair: finding?.blocks_required_hair === true,
        accepted: finding?.accepted === true || finding?.blocks_required_hair === false,
        note: String(finding?.note || '').trim(),
      })).filter((finding) => finding.viewLabel && finding.accessory)
    : []
);

const normalizeRemotePerViewChecks = (value = []) => (
  Array.isArray(value)
    ? value.map((check) => ({
        viewLabel: String(check?.view_label || '').trim(),
        viewCorrect: check?.view_correct === true,
        observedPose: String(check?.observed_pose || '').trim().toLowerCase(),
        poseCorrect: check?.pose_correct === true,
        sameSubjectStatus: String(check?.same_subject_status || '').trim().toLowerCase(),
        confidence: Number(check?.confidence || 0),
        note: String(check?.note || '').trim(),
      })).filter((check) => check.viewLabel)
    : []
);

const buildPerViewValidationDetails = ({ failedViews = [], perViewChecks = [], reason = '' } = {}) => {
  const failedViewSet = new Set((Array.isArray(failedViews) ? failedViews : []).map((view) => String(view || '').trim()));
  const detailedFailures = perViewChecks
    .filter((check) => failedViewSet.has(check.viewLabel) || !check.viewCorrect || check.sameSubjectStatus === 'mismatch')
    .map((check) => ({
      viewLabel: check.viewLabel,
      error: check.note || reason || 'This photo needs another check.',
    }));

  if (detailedFailures.length) return detailedFailures;
  return buildRemoteValidationDetails([...failedViewSet], reason);
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

const getCapturedYawAngle = (photo = null) => {
  const value = photo?.photoValidation?.yawAngle;
  if (value === null || value === undefined || value === '') return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
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

  const leftSideIndex = requiredViews.findIndex((view) => {
    const key = String(view?.key || '').trim().toLowerCase();
    const label = String(view?.label || '').trim().toLowerCase();
    return key === 'side_profile' || (label.includes('left') && label.includes('side'));
  });
  const rightSideIndex = requiredViews.findIndex((view) => {
    const key = String(view?.key || '').trim().toLowerCase();
    const label = String(view?.label || '').trim().toLowerCase();
    return key === 'right_side_profile' || (label.includes('right') && label.includes('side'));
  });
  const leftYaw = leftSideIndex >= 0 ? getCapturedYawAngle(photos[leftSideIndex]) : null;
  const rightYaw = rightSideIndex >= 0 ? getCapturedYawAngle(photos[rightSideIndex]) : null;
  if (leftYaw !== null && rightYaw !== null) {
    const hasClearTurns = Math.abs(leftYaw) >= 18 && Math.abs(rightYaw) >= 18;
    const showsOppositeDirections = leftYaw * rightYaw < 0;
    if (!hasClearTurns || !showsOppositeDirections) {
      riskScore += 60;
      const error = !hasClearTurns
        ? 'Turn farther to the requested side, then retake this photo.'
        : 'The left and right photos show the same head-turn direction. Retake this side.';
      details.push({
        viewLabel: requiredViews[leftSideIndex]?.label || 'Left Side Photo',
        error,
      });
      details.push({
        viewLabel: requiredViews[rightSideIndex]?.label || 'Right Side Photo',
        error,
      });
    }
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
      ok: false,
      skipped: false,
      hardBlock: true,
      retryable: true,
      title: 'Photo Check Temporarily Unavailable',
      message: 'We could not verify your photos right now. Your photos are still here, so please try the photo check again shortly.',
      details: [],
      validationMode: 'remote_cross_view_unavailable_block',
      validationWarning: toSafeMessage(result.error, 'Remote photo match check unavailable.'),
      accessoriesDetected: null,
      hairAuthenticityStatus: 'unclear',
      visualScreeningCompleted: false,
      verificationToken: null,
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
  const accessoryFindings = normalizeRemoteAccessoryFindings(validation.accessory_findings);
  const allowedAccessories = normalizeRemoteAccessoryFindings(validation.allowed_accessories)
    .filter((finding) => finding.accepted && !finding.blocksRequiredHair);
  const perViewChecks = normalizeRemotePerViewChecks(validation.per_view_checks);
  const sameSubjectVerified = validation.same_subject_verified === true;
  const differentFacesDetected = validation.different_faces_detected === true;
  const faceMismatchViews = Array.isArray(validation.face_mismatch_views)
    ? validation.face_mismatch_views.map((view) => String(view || '').trim()).filter(Boolean)
    : [];
  const hasArtificialHairConcern = hairAuthenticityStatus === 'possible_wig_or_extensions';
  const verificationToken = typeof result.data?.verification_token === 'string'
    ? result.data.verification_token.trim()
    : '';
  const isAcceptable = validation.is_acceptable === true
    && visualScreeningCompleted
    && accessoriesDetected === false
    && hairAuthenticityStatus === 'likely_natural'
    && sameSubjectVerified
    && Boolean(verificationToken);
  const visualConcernReason = accessoriesDetected === true
    ? toSafeMessage(validation.accessory_notes, 'Remove accessories or objects blocking the hair, then retake the affected views.')
    : hasArtificialHairConcern
      ? toSafeMessage(validation.hair_authenticity_notes, 'Possible wig, hairpiece, or extensions detected. Retake with the natural hairline and roots clearly visible.')
      : '';
  const reason = visualConcernReason || (!visualScreeningCompleted
    ? 'We could not finish checking these photos. Please try the photo check again before analysis.'
    : hairAuthenticityStatus === 'unclear'
      ? 'The natural hairline and roots are not clear enough to verify. Remove any head covering or obstruction, then retake the affected views.'
      : !verificationToken && validation.is_acceptable === true
        ? 'Photo verification could not be secured. Please run the photo check again.'
        : toSafeMessage(validation.reason, isAcceptable
          ? 'Ready for analysis.'
          : 'Photos must show the same person and same current hair.'));
  const failedViews = Array.isArray(validation.failed_views)
    ? validation.failed_views
    : [];
  const resolvedFailedViews = failedViews.length || !visualConcernReason
    ? failedViews
    : ['Photo set'];
  const retryable = validation.retryable === true
    || !visualScreeningCompleted
    || (!verificationToken && validation.is_acceptable === true);

  return {
    ok: isAcceptable,
    skipped: false,
    hardBlock: !isAcceptable,
    title: isAcceptable
      ? 'Photos Ready'
      : retryable
        ? 'Photo Check Needs Retry'
        : accessoriesDetected === true
          ? 'Remove Hair Accessories'
          : hasArtificialHairConcern || hairAuthenticityStatus === 'unclear'
            ? 'Hair Verification Needed'
            : 'Photos Do Not Match',
    message: isAcceptable ? 'Ready for analysis.' : reason,
    details: isAcceptable ? [] : buildPerViewValidationDetails({
      failedViews: resolvedFailedViews,
      perViewChecks,
      reason,
    }),
    validationMode: 'remote_cross_view',
    accessoriesDetected,
    accessoryNotes: toSafeMessage(validation.accessory_notes),
    accessoryFindings,
    allowedAccessories,
    hairAuthenticityStatus,
    hairAuthenticityNotes: toSafeMessage(validation.hair_authenticity_notes),
    appearanceFlags,
    perViewChecks,
    sameSubjectVerified,
    differentFacesDetected,
    faceMismatchViews,
    faceComparisonStatus: String(result.data?.face_comparison?.status || '').trim().toLowerCase(),
    visualScreeningCompleted,
    verificationToken: isAcceptable ? verificationToken : null,
    retryable,
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
