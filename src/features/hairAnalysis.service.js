import { invokeEdgeFunction } from '../api/supabase/client';
import { hairAnalysisFunctionName, hairSubmissionImageTypes } from './hairSubmission.constants';
import { normalizeHairAnalyzerAnswers } from './hairSubmission.schema';
import { getErrorMessage, logAppError, logAppEvent } from '../utils/appErrors';
import { alignScreeningWithMinimumLength, resolveEstimatedLengthCm } from '../utils/hairLength';

const HAIR_ANALYSIS_MAX_INVOKE_ATTEMPTS = 2;
const HAIR_ANALYSIS_RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const CARE_SAFETY_NOTE = 'If you have allergies, scalp irritation, or sensitivity, consult a qualified hair or scalp care professional before trying new ingredients.';

const waitFor = async (milliseconds = 0) => (
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
);

const advertisedNamePatterns = [
  /\bHuman Nature\b/gi,
  /\bDove\b/gi,
  /\bCream Silk\b/gi,
  /\bVitress\b/gi,
  /\bHead\s*&\s*Shoulders\b/gi,
  /\bSelsun Blue\b/gi,
  /\bPantene(?:\s+Pro-V)?\b/gi,
  /\bWatsons\b/gi,
  /\bSM\b/g,
  /\bRobinsons\b/gi,
  /\bLazada(?:\.ph)?\b/gi,
  /\bShopee(?:\.ph)?\b/gi,
];
const recommendationOriginPatterns = [
  /(?:neutral care|generic|local|country)?\s*product options? to consider:.*?(?:\.|$)/gi,
  /Ingredient or product-type options to consider:.*?(?:\.|$)/gi,
  /\bPhilippine(?:s)?\b/gi,
  /\b(?:country|locally|local)\s+(?:product|care)\s+options?\b/gi,
  /\b[A-Z][a-z]+(?:n|ian|ese|ish|i)\s+(?:product|brand|care)\s+options?\b/g,
];

const removeAdvertisedNames = (value = '') => {
  let cleaned = String(value || '').trim();
  advertisedNamePatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, 'generic');
  });
  recommendationOriginPatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '');
  });
  return cleaned
    .replace(/\bgeneric\s+generic\b/gi, 'generic')
    .replace(/\bneutral care\s+neutral care\b/gi, 'neutral care')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const addCareSafetyNote = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!/ingredients that may help/i.test(text)) return text;
  if (/consult a qualified hair or scalp care professional/i.test(text)) return text;
  return `${text} ${CARE_SAFETY_NOTE}`;
};

const resolveRetryDelayMs = ({ attempt = 1, retryAfterSeconds = null }) => {
  const retryAfter = Number(retryAfterSeconds);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(Math.ceil(retryAfter * 1000), 12000);
  }

  const backoff = 700 * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(backoff, 4200);
};

const normalizeRecommendations = (source = []) => (
  source
    .map((item, index) => {
      const recommendationText = item?.recommendation_text || item?.recommendation || item?.message || item?.text || '';
      const parsedPriority = Number(item?.priority_order ?? item?.priority ?? item?.rank);

      return {
        title: removeAdvertisedNames(item?.title || item?.heading || ''),
        recommendation_text: addCareSafetyNote(removeAdvertisedNames(recommendationText)),
        priority_order: Number.isFinite(parsedPriority) && parsedPriority > 0 ? parsedPriority : index + 1,
      };
    })
    .filter((item) => item.recommendation_text)
    .sort((left, right) => left.priority_order - right.priority_order)
);

const normalizeViewNotes = (source = []) => (
  source
    .map((item) => ({
      view: item?.view || '',
      clearly_visible: item?.clearly_visible !== false,
      notes: item?.notes || '',
    }))
    .filter((item) => item.view)
);

const normalizeStringArray = (source = []) => (
  Array.isArray(source) && source.length
    ? source.map((item) => String(item || '').trim()).filter(Boolean)
    : ['none']
);

const toNumberOrDefault = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const hasVisibleDandruffEvidence = (value = '') => {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return false;
  if (/\b(no|not|without)\s+(?:visible\s+)?(?:dandruff|flakes?|flaking|white particles?|yellow particles?|buildup)\b/i.test(normalized)) {
    return false;
  }
  return /\b(dandruff|flakes?|flaking|white particles?|yellow particles?|flake-like|dandruff-like|scaly|buildup)\b/i.test(normalized);
};

const normalizeAnalysis = (data, donationRequirementContext = null) => {
  const perViewNotes = normalizeViewNotes(data?.per_view_notes || []);
  const scalpCoverageNotes = data?.scalp_coverage_notes || 'No clear scalp coverage issue was reported.';
  const scalpFindingEvidenceText = [
    data?.summary,
    data?.visible_damage_notes,
    scalpCoverageNotes,
    ...perViewNotes
      .filter((item) => String(item?.view || '').toLowerCase().includes('scalp'))
      .map((item) => item.notes),
  ].filter(Boolean).join(' ');
  const dandruffDetected = data?.dandruff_detected === true || hasVisibleDandruffEvidence(scalpFindingEvidenceText);

  return alignScreeningWithMinimumLength({
    is_hair_detected: data?.is_hair_detected !== false,
    invalid_image_reason: data?.invalid_image_reason || '',
    missing_views: Array.isArray(data?.missing_views) ? data.missing_views : [],
    per_view_notes: perViewNotes,
    estimated_length: resolveEstimatedLengthCm(data) ?? 0,
    detected_color: data?.detected_color || 'Black',
    detected_texture: data?.detected_texture || 'Straight',
    detected_density: data?.detected_density || 'Medium',
    detected_condition: data?.detected_condition || 'Needs manual hair review',
    visible_damage_notes: data?.visible_damage_notes || 'No visible damage notes reported.',
    confidence_score: toNumberOrDefault(data?.confidence_score, 0),
    shine_level: toNumberOrDefault(data?.shine_level, 5),
    frizz_level: toNumberOrDefault(data?.frizz_level, 5),
    dryness_level: toNumberOrDefault(data?.dryness_level, 5),
    oiliness_level: toNumberOrDefault(data?.oiliness_level, 5),
    damage_level: toNumberOrDefault(data?.damage_level, 5),
    bald_spots_present: data?.bald_spots_present === true,
    affected_regions: normalizeStringArray(data?.affected_regions || []),
    hair_density_score: toNumberOrDefault(data?.hair_density_score, 50),
    shedding_level: data?.shedding_level || 'mild',
    visible_scalp_area: data?.visible_scalp_area || 'low',
    scalp_coverage_notes: scalpCoverageNotes,
    dandruff_detected: dandruffDetected,
    dandruff_severity: data?.dandruff_severity || (dandruffDetected ? 'mild' : 'none'),
    dandruff_notes: data?.dandruff_notes || (
      dandruffDetected
        ? 'Dandruff-like flakes were observed in the uploaded scalp or root views.'
        : 'No visible dandruff-like flakes were observed in the uploaded views.'
    ),
    lice_detected: data?.lice_detected === true,
    lice_confidence: data?.lice_confidence || (data?.lice_detected === true ? 'medium' : 'none'),
    lice_notes: data?.lice_notes || (
      data?.lice_detected === true
        ? 'Visible lice or nit-like signs were observed; this screening is not a medical diagnosis.'
        : 'No visible lice or nit-like signs were observed in the uploaded views.'
    ),
    improvement_tracking_status: data?.improvement_tracking_status || 'Needs improvement tracking',
    improvement_recommendation: data?.improvement_recommendation || 'Keep tracking hair length and condition with future CheckHair scans before donating.',
    decision: data?.decision || 'Improve hair condition',
    summary: data?.summary || 'Hair analysis completed with limited details. Final screening requires manual review.',
    length_assessment: data?.length_assessment || '',
    donation_readiness_note: data?.donation_readiness_note || '',
    history_assessment: data?.history_assessment || '',
    recommendations: normalizeRecommendations(data?.recommendations || []),
  }, donationRequirementContext);
};

const hasStructuredAnalysisContent = (analysis) => Boolean(
  analysis?.summary
  || analysis?.decision
  || analysis?.detected_color
  || analysis?.detected_texture
  || analysis?.detected_density
  || analysis?.detected_condition
  || (Array.isArray(analysis?.recommendations) && analysis.recommendations.length)
);

const isLowDetailPlaceholderAnalysis = (analysis = {}) => {
  const normalizeToken = (value) => String(value || '').trim().toLowerCase();
  const isUnclearToken = (value) => ['unclear', 'unknown', 'not sure', 'none', 'n/a', 'na', ''].includes(normalizeToken(value));
  const estimatedLength = Number(analysis?.estimated_length);
  const confidenceScore = Number(analysis?.confidence_score);
  const detectedCondition = normalizeToken(analysis?.detected_condition);

  const weakCoreSignals = [
    isUnclearToken(analysis?.detected_color),
    isUnclearToken(analysis?.detected_texture),
    isUnclearToken(analysis?.detected_density),
    detectedCondition.includes('low-confidence'),
  ].filter(Boolean).length;

  return (
    weakCoreSignals >= 3
    && (!Number.isFinite(estimatedLength) || estimatedLength <= 0)
    && (!Number.isFinite(confidenceScore) || confidenceScore <= 0.45)
  );
};

const isSupportedAiProviderMarker = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'groq' || normalized === 'gemini' || normalized === 'google-ai' || normalized === 'openai';
};

const resolvePhotoQualityIssueMessage = (analysis = {}) => {
  const rawMessage = String(analysis?.invalid_image_reason || '').trim();
  const normalized = rawMessage.toLowerCase();
  const missingViews = Array.isArray(analysis?.missing_views) ? analysis.missing_views.filter(Boolean) : [];
  const isPlaceholderMessage = !rawMessage || ['n/a', 'na', 'none', 'null', 'not applicable'].includes(normalized);

  if (missingViews.length) {
    return `Photos incomplete. Please retake or add these required views: ${missingViews.join(', ')}.`;
  }

  if (analysis?.is_hair_detected === false) {
    return isPlaceholderMessage
      ? ''
      : rawMessage;
  }

  if (isPlaceholderMessage) return '';

  if (normalized.includes('too dark') || normalized.includes('dark') || normalized.includes('underexposed')) {
    return 'The photo looks too dark. Please move near bright indirect light and retake it.';
  }

  if (
    normalized.includes('accessor')
    || normalized.includes('hat')
    || normalized.includes('cap')
    || normalized.includes('clip')
    || normalized.includes('headband')
    || normalized.includes('glasses')
    || normalized.includes('sunglasses')
    || normalized.includes('eyeglasses')
    || normalized.includes('mask')
    || normalized.includes('scarf')
    || normalized.includes('headphones')
  ) {
    return 'The scan needs clearer hair visibility. Please retake the required view in bright light with your hair centered.';
  }

  if (normalized.includes('blur') || normalized.includes('not clear') || normalized.includes('unclear')) {
    return '';
  }

  if (normalized.includes('background') || normalized.includes('distracting') || normalized.includes('clutter')) {
    return 'The background makes the analysis harder. Please retake the photo against a plain, uncluttered background.';
  }

  return rawMessage;
};

const prepareImagesForAnalysis = async (images = []) => images || [];

const isStaleHairEndsRequirementError = (message = '') => {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('required hair views') && normalized.includes('hair ends close-up');
};

const buildHairEndsCompatibilityImage = (images = []) => {
  const sourceImage = images.find((image) => String(image?.viewKey || '').toLowerCase() === hairSubmissionImageTypes.sideProfile)
    || images.find((image) => String(image?.viewKey || '').toLowerCase() === hairSubmissionImageTypes.frontView)
    || images.find((image) => image?.dataUrl)
    || null;

  if (!sourceImage) return null;

  return {
    ...sourceImage,
    viewKey: hairSubmissionImageTypes.hairEndsCloseUp,
    viewLabel: 'Hair Ends Close-Up',
    compatibilityDuplicate: true,
  };
};

const estimateImagePayloadBytes = (images = []) => (
  (images || []).reduce((total, image) => total + (image?.base64 ? image.base64.length : 0), 0)
);

const isGatewayFailureResponse = (message = '') => {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('502 bad gateway')
    || normalized.includes('<title>502 bad gateway</title>')
    || normalized.includes('<h1>502 bad gateway</h1>')
  );
};

const extractErrorPayloadFromResponse = async (response) => {
  if (!response || typeof response.clone !== 'function') {
    return null;
  }

  try {
    const payload = await response.clone().json();
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_jsonError) {
    return null;
  }
};

const resolveFunctionErrorMessage = async (error) => {
  const response = error?.context;

  if (!response || typeof response.clone !== 'function') {
    return getErrorMessage(error);
  }

  try {
    const payload = await response.clone().json();
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
  } catch (_jsonError) {
    // Fall back to plain text parsing.
  }

  try {
    const text = await response.clone().text();
    if (text?.trim()) {
      return text.trim();
    }
  } catch (_textError) {
    // Fall back to the original error message.
  }

  return getErrorMessage(error);
};

const buildStructuredAnalysisError = (message, extras = {}) => {
  const error = new Error(message || 'Hair analysis could not be completed right now.');
  Object.assign(error, extras);
  return error;
};

const buildLowConfidenceFallbackAnalysis = ({ images = [], message = '' } = {}) => {
  const providedViews = (images || [])
    .map((image) => image?.viewLabel || image?.viewKey || '')
    .filter(Boolean);

  return normalizeAnalysis({
    is_hair_detected: true,
    invalid_image_reason: '',
    missing_views: [],
    per_view_notes: providedViews.map((view) => ({
      view,
      clearly_visible: true,
      notes: 'The AI provider received this view but returned limited structured detail, so the hair wellness result is low confidence.',
    })),
    estimated_length: 0,
    detected_color: 'Black',
    detected_texture: 'Straight',
    detected_density: 'Medium',
    detected_condition: 'Needs manual hair review',
    visible_damage_notes: 'Hair is visible, but the AI provider did not return enough detail for a strong condition reading.',
    confidence_score: 0.35,
    shine_level: 5,
    frizz_level: 5,
    dryness_level: 5,
    oiliness_level: 3,
    damage_level: 5,
    bald_spots_present: false,
    affected_regions: ['none'],
    hair_density_score: 50,
    shedding_level: 'mild',
    visible_scalp_area: 'low',
    scalp_coverage_notes: 'Hair and scalp view were submitted; coverage should be tracked again in the next scan for a stronger comparison.',
    dandruff_detected: false,
    dandruff_severity: 'none',
    dandruff_notes: 'No visible dandruff-like flakes were confirmed in this low-confidence fallback.',
    lice_detected: false,
    lice_confidence: 'none',
    lice_notes: 'No visible lice or nit-like signs were confirmed in this low-confidence fallback.',
    improvement_tracking_status: 'Needs improvement tracking',
    improvement_recommendation: 'Focus on gentle hair care, scalp comfort, and length retention. Keep tracking changes over time before deciding on donation readiness.',
    decision: 'Not eligible for donation yet',
    summary: message
      ? `Hair is visible in the submitted photos. This check uses conservative hair-care values because detailed scoring was limited. ${message}`
      : 'Hair is visible in the submitted photos. This low-confidence check uses conservative hair-care values for progress tracking.',
    length_assessment: 'Visible hair length should be confirmed during manual screening because the automated estimate was conservative.',
    donation_readiness_note: '',
    history_assessment: '',
    recommendations: [
      {
        title: 'Support length retention',
        recommendation_text: 'Use gentle detangling, avoid tight pulling styles, and protect the ends so existing length is less likely to break while growing.',
        priority_order: 1,
      },
      {
        title: 'Keep moisture balanced',
        recommendation_text: 'Apply conditioner mainly on the mid-lengths and ends, and add a weekly moisturizing routine if the hair feels dry or rough.',
        priority_order: 2,
      },
      {
        title: 'Protect scalp comfort',
        recommendation_text: 'Use a mild washing routine and avoid harsh products if the scalp feels itchy, flaky, or irritated.',
        priority_order: 3,
      },
    ],
  });
};

const isQuotaLikeError = (message = '', errorType = '') => {
  const normalizedMessage = String(message || '').toLowerCase();
  const normalizedType = String(errorType || '').trim().toLowerCase();

  return (
    normalizedType === 'quota_exceeded'
    || normalizedMessage.includes('quota exceeded')
    || normalizedMessage.includes('free tier request limit')
    || normalizedMessage.includes('rate limit')
    || normalizedMessage.includes('retry in')
  );
};

const isTemporaryUnavailableError = (message = '', errorType = '') => {
  const normalizedMessage = String(message || '').toLowerCase();
  const normalizedType = String(errorType || '').trim().toLowerCase();

  return (
    normalizedType === 'temporary_unavailable'
    || normalizedMessage.includes('high demand')
    || normalizedMessage.includes('temporarily busy')
    || normalizedMessage.includes('temporarily unavailable')
    || normalizedMessage.includes('service unavailable')
    || normalizedMessage.includes('retry later')
    || normalizedMessage.includes('resource exhausted')
    || normalizedMessage.includes('overloaded')
  );
};

const isProviderAccessDeniedError = (message = '', errorType = '', status = null) => {
  const normalizedMessage = String(message || '').toLowerCase();
  const normalizedType = String(errorType || '').trim().toLowerCase();
  const normalizedStatus = Number(status);

  return (
    normalizedType === 'provider_access_denied'
    || normalizedStatus === 401
    || normalizedStatus === 403
    || normalizedMessage.includes('denied access')
    || normalizedMessage.includes('permission denied')
    || normalizedMessage.includes('caller does not have permission')
    || normalizedMessage.includes('access denied')
    || normalizedMessage.includes('api key not valid')
    || normalizedMessage.includes('api key is invalid')
    || normalizedMessage.includes('key is invalid')
  );
};

const isServerConfigurationError = (message = '') => {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('api key is not configured')
    || normalized.includes('not configured in edge function secrets')
    || normalized.includes('hair analysis is not configured on the server')
    || normalized.includes('provider access is denied')
  );
};

const isInvokeTransportError = (message = '') => {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('network request failed')
    || normalized.includes('failed to fetch')
    || normalized.includes('load failed')
    || normalized.includes('fetcherror')
    || normalized.includes('could not connect')
  );
};

const isPhotoQualityAnalysisError = (message = '', errorType = '') => {
  const normalizedMessage = String(message || '').toLowerCase();
  const normalizedType = String(errorType || '').trim().toLowerCase();

  return (
    normalizedType === 'photo_quality'
    || normalizedMessage.includes('clearer scan')
    || normalizedMessage.includes('not clear enough for a reliable hair analysis')
    || normalizedMessage.includes('required hair views')
    || normalizedMessage.includes('please add these required hair views')
    || normalizedMessage.includes('photos do not match')
    || normalizedMessage.includes('do not match')
    || normalizedMessage.includes('does not clearly show hair')
    || normalizedMessage.includes('not look like hair')
  );
};

const buildPhotoOverrideFallbackAnalysis = ({ images = [], message = '' } = {}) => {
  const fallbackAnalysis = buildLowConfidenceFallbackAnalysis({
    images,
    message: message || 'The user chose to continue after photo validation warning. This result is low-confidence and should be used for hair-care tracking, not donation approval.',
  });

  return normalizeAnalysis({
    ...fallbackAnalysis,
    confidence_score: Math.min(Number(fallbackAnalysis.confidence_score) || 0.35, 0.35),
    decision: 'Not eligible for donation yet',
    summary: 'Analysis continued with user-approved photos after validation warning. The result is low-confidence and should not be used for donation approval.',
    length_assessment: 'The photos were manually approved after a validation warning, so cheek/neck-to-ends donation length could not be confirmed reliably.',
    donation_readiness_note: '',
    improvement_tracking_status: 'Needs improvement tracking',
    improvement_recommendation: 'Use this as a low-confidence hair progress check. Focus on gentle handling, moisture balance, scalp comfort, and protecting the ends from breakage.',
  });
};

export const analyzeHairPhotos = async ({
  images,
  questionnaireAnswers,
  complianceContext = null,
  donationRequirementContext = null,
  submissionContext = null,
  historyContext = null,
  correctedDetails = null,
  allowPhotoQualityFallback = false,
}) => {
  try {
    if (!images?.length) {
      throw new Error('Please upload at least one hair photo before analysis.');
    }

    const preparedImages = await prepareImagesForAnalysis(images);
    const invalidImages = preparedImages.filter((image) => !image?.dataUrl || !image?.mimeType);
    if (invalidImages.length) {
      throw new Error('One or more uploaded photos could not be read. Please upload or retake the unclear image again.');
    }

    const normalizedAnswers = normalizeHairAnalyzerAnswers(questionnaireAnswers);
    if (!normalizedAnswers?.questionnaire_answers?.screening_intent) {
      throw new Error('Please complete the guided hair questions before analysis.');
    }

    if (!complianceContext?.acknowledged) {
      throw new Error('Please confirm the photo compliance checklist before analysis.');
    }

    const payload = {
      concern_type: normalizedAnswers.concern_type,
      questionnaire_answers: normalizedAnswers.questionnaire_answers,
      compliance_context: {
        acknowledged: Boolean(complianceContext?.acknowledged),
      },
      images: preparedImages.map((image) => ({
        mimeType: image.mimeType,
        dataUrl: image.dataUrl,
        viewKey: image.viewKey,
        viewLabel: image.viewLabel,
      })),
      donation_requirement_context: donationRequirementContext
        ? {
            donation_requirement_id: donationRequirementContext.donation_requirement_id || null,
            minimum_hair_length: donationRequirementContext.minimum_hair_length_cm ?? null,
            minimum_hair_length_inches: donationRequirementContext.minimum_hair_length_inches ?? null,
            chemical_treatment_status: donationRequirementContext.chemical_treatment_status ?? null,
            colored_hair_status: donationRequirementContext.colored_hair_status ?? null,
            bleached_hair_status: donationRequirementContext.bleached_hair_status ?? null,
            rebonded_hair_status: donationRequirementContext.rebonded_hair_status ?? null,
            hair_texture_status: donationRequirementContext.hair_texture_status || '',
            notes: donationRequirementContext.notes || '',
          }
        : null,
      submission_context: submissionContext
        ? {
            submission_id: submissionContext.submission_id || null,
            donation_drive_id: submissionContext.donation_drive_id || null,
            organization_id: submissionContext.organization_id || null,
            detail_id: submissionContext.submission_detail_id || null,
            declared_length: submissionContext.declared_length ?? null,
            declared_texture: submissionContext.declared_texture || '',
            declared_density: submissionContext.declared_density || '',
            declared_condition: submissionContext.declared_condition || '',
          }
        : null,
      history_context: historyContext
        ? {
            total_checks: Number(historyContext.total_checks) || 0,
            latest_condition: historyContext.latest_condition || '',
            latest_check_at: historyContext.latest_check_at || '',
            latest_result: historyContext.latest_result
              ? {
                  created_at: historyContext.latest_result.created_at || '',
                  detected_condition: historyContext.latest_result.detected_condition || '',
                  decision: historyContext.latest_result.decision || '',
                  summary: historyContext.latest_result.summary || '',
                  estimated_length: historyContext.latest_result.estimated_length ?? null,
                }
              : null,
            latest_recommendations: Array.isArray(historyContext.latest_recommendations)
              ? historyContext.latest_recommendations.map((recommendation, index) => ({
                  title: recommendation?.title || '',
                  recommendation_text: recommendation?.recommendation_text || '',
                  priority_order: recommendation?.priority_order ?? index + 1,
                }))
              : [],
            entries: Array.isArray(historyContext.entries)
              ? historyContext.entries.map((entry) => ({
                  created_at: entry.created_at || '',
                  detected_condition: entry.detected_condition || '',
                  decision: entry.decision || '',
                  summary: entry.summary || '',
                  estimated_length: entry.estimated_length ?? null,
                  recommendations: Array.isArray(entry.recommendations)
                    ? entry.recommendations.map((recommendation, index) => ({
                        title: recommendation?.title || '',
                        recommendation_text: recommendation?.recommendation_text || '',
                        priority_order: recommendation?.priority_order ?? index + 1,
                      }))
                    : [],
                }))
              : [],
          }
        : null,
      corrected_details: correctedDetails
        ? {
            length_value: correctedDetails.length_value ?? null,
            length_unit: correctedDetails.length_unit || '',
            normalized_length_cm: correctedDetails.normalized_length_cm ?? null,
            texture: correctedDetails.texture || '',
            density: correctedDetails.density || '',
          }
        : null,
    };

    logAppEvent('hairAnalysis.invoke', 'Invoking hair analysis edge function.', {
      functionName: hairAnalysisFunctionName,
      concernType: payload.concern_type,
      hasDonationRequirementContext: Boolean(payload.donation_requirement_context),
      hasSubmissionContext: Boolean(payload.submission_context?.submission_id),
      hasHistoryContext: Boolean(payload.history_context?.entries?.length),
      hasCorrectedDetails: Boolean(payload.corrected_details),
      questionKeys: Object.keys(payload.questionnaire_answers || {}),
      imageCount: payload.images.length,
      imageViews: payload.images.map((image) => image.viewLabel || image.viewKey).filter(Boolean),
      usesWebOptimizedImages: preparedImages.some((image, index) => image?.dataUrl !== images?.[index]?.dataUrl),
      estimatedImagePayloadBytes: estimateImagePayloadBytes(preparedImages),
    });

    let functionResult = null;
    let addedStaleHairEndsCompatibilityView = false;
    for (let attempt = 1; attempt <= HAIR_ANALYSIS_MAX_INVOKE_ATTEMPTS; attempt += 1) {
      functionResult = await invokeEdgeFunction(hairAnalysisFunctionName, {
        body: payload,
      });

      if (!functionResult.error) break;

      const errorPayload = await extractErrorPayloadFromResponse(functionResult.error?.context);
      const edgeFunctionInvoked = errorPayload?.edge_function_invoked === true;
      const providerRequestAttempted = errorPayload?.provider_request_attempted === true;
      const providerResponseStatus = errorPayload?.provider_response_status ?? null;
      const providerParseSuccess = errorPayload?.provider_parse_success ?? null;
      const resolvedErrorMessage = errorPayload?.error || await resolveFunctionErrorMessage(functionResult.error);
      const normalizedErrorType = String(errorPayload?.error_type || '').trim().toLowerCase();
      const retryAfterSeconds = providerRequestAttempted ? errorPayload?.retry_after_seconds ?? null : null;
      const canRetryWithStaleHairEndsCompatibility = (
        !addedStaleHairEndsCompatibilityView
        && payload.images.length === 3
        && isStaleHairEndsRequirementError(resolvedErrorMessage)
      );
      const isRetryableProviderBusyError = (
        edgeFunctionInvoked
        && providerRequestAttempted
        && HAIR_ANALYSIS_RETRYABLE_STATUS.has(Number(providerResponseStatus))
        && isTemporaryUnavailableError(resolvedErrorMessage, normalizedErrorType)
      );
      const canRetry = (isRetryableProviderBusyError || canRetryWithStaleHairEndsCompatibility)
        && attempt < HAIR_ANALYSIS_MAX_INVOKE_ATTEMPTS;

      logAppEvent('hairAnalysis.invoke', 'Hair analysis edge invoke failed before a usable result was returned.', {
        functionName: hairAnalysisFunctionName,
        hasErrorContext: Boolean(functionResult.error?.context),
        edgeFunctionInvoked,
        providerRequestAttempted,
        providerResponseStatus,
        providerParseSuccess,
        attempt,
        maxAttempts: HAIR_ANALYSIS_MAX_INVOKE_ATTEMPTS,
        willRetry: canRetry,
      }, 'warn');

      if (allowPhotoQualityFallback && isPhotoQualityAnalysisError(resolvedErrorMessage, normalizedErrorType)) {
        const fallbackAnalysis = buildPhotoOverrideFallbackAnalysis({
          images: payload.images,
          message: resolvedErrorMessage,
        });

        logAppEvent('hairAnalysis.invoke', 'Recovered from photo-quality rejection because the user approved the photos for analysis.', {
          functionName: hairAnalysisFunctionName,
          imageCount: payload.images.length,
          edgeFunctionInvoked,
          providerRequestAttempted,
          providerResponseStatus,
          providerParseSuccess,
          attempt,
          errorType: normalizedErrorType || null,
        }, 'info');

        return {
          analysis: fallbackAnalysis,
          provider: 'openai',
          error: null,
          recoveredFromPhotoQualityError: true,
          edgeFunctionInvoked,
          providerRequestAttempted,
          providerResponseStatus,
        };
      }

      if (canRetryWithStaleHairEndsCompatibility) {
        const compatibilityImage = buildHairEndsCompatibilityImage(payload.images);
        if (compatibilityImage) {
          payload.images = [...payload.images, compatibilityImage];
          addedStaleHairEndsCompatibilityView = true;

          logAppEvent('hairAnalysis.invoke', 'Retrying hair analysis with compatibility view for stale Hair Ends server requirement.', {
            functionName: hairAnalysisFunctionName,
            attempt,
            imageCount: payload.images.length,
            originalRequiredPhotoCount: 3,
            staleRequirement: 'Hair Ends Close-Up',
          }, 'warn');

          continue;
        }
      }

      if (canRetry) {
        const retryDelayMs = resolveRetryDelayMs({ attempt, retryAfterSeconds });
        logAppEvent('hairAnalysis.invoke', 'Retrying hair analysis after provider temporary-unavailable response.', {
          functionName: hairAnalysisFunctionName,
          attempt,
          maxAttempts: HAIR_ANALYSIS_MAX_INVOKE_ATTEMPTS,
          retryDelayMs,
          retryAfterSeconds: retryAfterSeconds ?? null,
          providerResponseStatus,
          errorType: normalizedErrorType || null,
        }, 'info');
        await waitFor(retryDelayMs);
        continue;
      }

      throw buildStructuredAnalysisError(
        resolvedErrorMessage,
        {
          errorType: providerRequestAttempted ? errorPayload?.error_type || null : null,
          retryAfterSeconds: providerRequestAttempted ? errorPayload?.retry_after_seconds ?? null : null,
          edgeFunctionInvoked,
          providerRequestAttempted,
          providerResponseStatus,
          providerParseSuccess,
        }
      );
    }

    const analysisPayload = functionResult.data?.analysis ? functionResult.data.analysis : functionResult.data;
    logAppEvent('hairAnalysis.invoke', 'Hair analysis edge function returned.', {
      functionName: hairAnalysisFunctionName,
      success: functionResult.data?.success ?? null,
      provider: functionResult.data?.provider || '',
      providerModel: functionResult.data?.provider_model || null,
      edgeFunctionInvoked: functionResult.data?.edge_function_invoked ?? null,
      providerRequestAttempted: functionResult.data?.provider_request_attempted ?? null,
      providerResponseStatus: functionResult.data?.provider_response_status ?? null,
      providerParseSuccess: functionResult.data?.provider_parse_success ?? null,
      responseKeys: functionResult.data ? Object.keys(functionResult.data) : [],
      analysisKeys: analysisPayload ? Object.keys(analysisPayload) : [],
      hasLengthAssessment: Boolean(analysisPayload?.length_assessment),
      hasEstimatedLength: analysisPayload?.estimated_length != null,
      usedCorrectedDetails: Boolean(payload.corrected_details),
      recommendationCount: Array.isArray(analysisPayload?.recommendations)
        ? analysisPayload.recommendations.length
        : Array.isArray(functionResult.data?.recommendations)
          ? functionResult.data.recommendations.length
          : 0,
    });

    if (!analysisPayload) {
      throw new Error('The AI analysis response was incomplete.');
    }

    if (functionResult.data?.edge_function_invoked === false) {
      throw new Error('Hair analysis did not reach the server function.');
    }

    if (functionResult.data?.provider_request_attempted === false) {
      throw new Error('Hair analysis did not reach the AI provider.');
    }

    if (functionResult.data?.provider_parse_success === false) {
      throw new Error('The AI provider returned a response that could not be parsed.');
    }

    const normalizedAnalysis = normalizeAnalysis({
      ...analysisPayload,
      recommendations: analysisPayload?.recommendations || functionResult.data?.recommendations || [],
    }, donationRequirementContext);

    if (isLowDetailPlaceholderAnalysis(normalizedAnalysis)) {
      logAppEvent('hairAnalysis.invoke', 'Rejected low-detail AI provider response instead of showing fallback values.', {
        functionName: hairAnalysisFunctionName,
        imageCount: payload.images.length,
        providerMarker: functionResult.data?.provider || '',
        providerRequestAttempted: functionResult.data?.provider_request_attempted ?? true,
        providerResponseStatus: functionResult.data?.provider_response_status ?? null,
        providerParseSuccess: functionResult.data?.provider_parse_success ?? null,
      }, 'warn');

      return {
        analysis: null,
        provider: functionResult.data?.provider || 'openai',
        error: 'The AI returned incomplete hair details instead of a usable photo-specific analysis. Please tap Try again to analyze the photos again.',
        errorType: 'insufficient_detail',
        edgeFunctionInvoked: true,
        providerRequestAttempted: functionResult.data?.provider_request_attempted ?? true,
        providerResponseStatus: functionResult.data?.provider_response_status ?? null,
      };
    }

    const photoQualityIssueMessage = resolvePhotoQualityIssueMessage(normalizedAnalysis);
    if (photoQualityIssueMessage) {
      if (allowPhotoQualityFallback) {
        const fallbackAnalysis = buildPhotoOverrideFallbackAnalysis({
          images: payload.images,
          message: photoQualityIssueMessage,
        });

        logAppEvent('hairAnalysis.invoke', 'Converted photo-quality analysis result into a low-confidence user-approved fallback.', {
          functionName: hairAnalysisFunctionName,
          imageCount: payload.images.length,
          providerMarker: functionResult.data?.provider || '',
          providerRequestAttempted: functionResult.data?.provider_request_attempted ?? true,
          providerResponseStatus: functionResult.data?.provider_response_status ?? null,
          providerParseSuccess: functionResult.data?.provider_parse_success ?? null,
        }, 'info');

        return {
          analysis: fallbackAnalysis,
          provider: functionResult.data?.provider || 'openai',
          error: null,
          recoveredFromPhotoQualityError: true,
          edgeFunctionInvoked: true,
          providerRequestAttempted: functionResult.data?.provider_request_attempted ?? true,
          providerResponseStatus: functionResult.data?.provider_response_status ?? null,
        };
      }

      throw buildStructuredAnalysisError(photoQualityIssueMessage, {
        errorType: 'photo_quality',
        edgeFunctionInvoked: true,
        providerRequestAttempted: functionResult.data?.provider_request_attempted ?? true,
        providerResponseStatus: functionResult.data?.provider_response_status ?? null,
        providerParseSuccess: functionResult.data?.provider_parse_success ?? null,
      });
    }

    logAppEvent('hairAnalysis.invoke', 'Hair analysis fields preserved from AI provider response.', {
      functionName: hairAnalysisFunctionName,
      usedAiSummary: Boolean(normalizedAnalysis.summary),
      usedAiLengthAssessment: Boolean(normalizedAnalysis.length_assessment),
      usedAiEstimatedLength: normalizedAnalysis.estimated_length != null,
      usedAiColor: Boolean(normalizedAnalysis.detected_color),
      usedAiCondition: Boolean(normalizedAnalysis.detected_condition),
      usedAiTexture: Boolean(normalizedAnalysis.detected_texture),
      usedAiDensity: Boolean(normalizedAnalysis.detected_density),
      usedAiRecommendations: Array.isArray(normalizedAnalysis.recommendations)
        ? normalizedAnalysis.recommendations.length
        : 0,
    });

    if (!hasStructuredAnalysisContent(normalizedAnalysis)) {
      return {
        analysis: null,
        provider: functionResult.data?.provider || '',
        error: 'The AI analysis response was missing the required hair details. Please try analyzing the photos again.',
        errorType: 'insufficient_detail',
        edgeFunctionInvoked: true,
        providerRequestAttempted: functionResult.data?.provider_request_attempted ?? true,
        providerResponseStatus: functionResult.data?.provider_response_status ?? null,
      };
    }

    const providerMarker = functionResult.data?.provider || '';
    logAppEvent('hairAnalysis.invoke', 'Hair analysis response validated.', {
      functionName: hairAnalysisFunctionName,
      providerMarker,
      providerMarkerRecognized: isSupportedAiProviderMarker(providerMarker),
      edgeFunctionInvoked: functionResult.data?.edge_function_invoked ?? null,
      providerRequestAttempted: functionResult.data?.provider_request_attempted ?? null,
      providerResponseStatus: functionResult.data?.provider_response_status ?? null,
      providerParseSuccess: functionResult.data?.provider_parse_success ?? null,
      usedStructuredAnalysisValidation: true,
    });

    if (!isSupportedAiProviderMarker(providerMarker)) {
      throw new Error('Hair analysis returned an unexpected AI provider response.');
    }

    return {
      analysis: normalizedAnalysis,
      provider: providerMarker,
      error: null,
    };
  } catch (error) {
    const resolvedMessage = await resolveFunctionErrorMessage(error);
    const technicalMessage = resolvedMessage.toLowerCase();
    const providerRequestAttempted = error?.providerRequestAttempted === true;
    const edgeFunctionInvoked = error?.edgeFunctionInvoked === true;
    const providerResponseStatus = Number.isFinite(Number(error?.providerResponseStatus))
      ? Number(error.providerResponseStatus)
      : null;
    const directRetryAfterSeconds = Number(error?.retryAfterSeconds);
    const retryAfterSeconds = Number.isFinite(directRetryAfterSeconds) && directRetryAfterSeconds > 0
      ? Math.max(1, Math.ceil(directRetryAfterSeconds))
      : null;
    const errorType = providerRequestAttempted
      ? String(error?.errorType || '').trim().toLowerCase()
      : '';
    const isRateLimitError = providerRequestAttempted && isQuotaLikeError(resolvedMessage, errorType);
    const isTemporaryBusyError = providerRequestAttempted && isTemporaryUnavailableError(resolvedMessage, errorType);
    const isProviderAccessDenied = providerRequestAttempted && isProviderAccessDeniedError(
      resolvedMessage,
      errorType,
      providerResponseStatus
    );
    if (allowPhotoQualityFallback && isPhotoQualityAnalysisError(resolvedMessage, errorType)) {
      const fallbackAnalysis = buildPhotoOverrideFallbackAnalysis({
        images,
        message: resolvedMessage,
      });

      logAppEvent('hairAnalysis.analyzeHairPhotos', 'Recovered from photo-quality analysis failure because the user approved the photos.', {
        imageCount: images?.length || 0,
        functionName: hairAnalysisFunctionName,
        edgeFunctionInvoked,
        providerRequestAttempted,
        providerResponseStatus,
        errorType: errorType || null,
      }, 'info');

      return {
        analysis: fallbackAnalysis,
        provider: 'openai',
        error: null,
        edgeFunctionInvoked,
        providerRequestAttempted,
        providerResponseStatus,
        recoveredFromPhotoQualityError: true,
      };
    }

    if (
      !technicalMessage.includes('requested function was not found')
      && !technicalMessage.includes('not_found')
      && !technicalMessage.includes('invalid jwt')
    ) {
      const logContext = {
        imageCount: images?.length || 0,
        functionName: hairAnalysisFunctionName,
        edgeFunctionInvoked,
        providerRequestAttempted,
        providerResponseStatus,
        errorType: isRateLimitError
          ? 'quota_exceeded'
          : isTemporaryBusyError
            ? 'temporary_unavailable'
            : isProviderAccessDenied
              ? 'provider_access_denied'
              : errorType || null,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
      };

      if (isRateLimitError) {
        logAppEvent('hairAnalysis.analyzeHairPhotos', 'AI provider request returned a retryable quota or rate-limit response.', {
          ...logContext,
          message: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? `Hair analysis is busy right now. Please wait ${retryAfterSeconds} seconds, then try again.`
            : 'Hair analysis is busy right now. Please try again in a moment.',
        }, 'warn');
      } else if (isTemporaryBusyError) {
        logAppEvent('hairAnalysis.analyzeHairPhotos', 'AI provider request returned a temporary-unavailable response.', {
          ...logContext,
          message: 'Hair analysis is temporarily busy right now. Please try again in a moment.',
        }, 'warn');
      } else if (isProviderAccessDenied) {
        logAppEvent('hairAnalysis.analyzeHairPhotos', 'AI provider rejected the configured project or API key.', {
          ...logContext,
          message: 'Hair analysis provider access is denied. Check the OpenAI API key, API restrictions, billing/quota, and model access in the OpenAI project.',
        }, 'error');
      } else if (errorType === 'photo_quality') {
        logAppEvent('hairAnalysis.analyzeHairPhotos', 'AI provider marked the uploaded photos as unsuitable for reliable analysis.', {
          ...logContext,
          message: resolvedMessage || 'Photo quality did not meet the analysis requirements.',
        }, 'info');
      } else if (!edgeFunctionInvoked) {
        logAppEvent('hairAnalysis.analyzeHairPhotos', 'Hair analysis invoke failed before the edge function was reached.', {
          ...logContext,
          message: resolvedMessage || 'Hair analysis could not reach the server function.',
        }, 'warn');
      } else if (!providerRequestAttempted) {
        logAppEvent('hairAnalysis.analyzeHairPhotos', 'Hair analysis failed on the server before the AI provider was called.', {
          ...logContext,
          message: resolvedMessage || 'Hair analysis failed before the provider request started.',
        }, 'warn');
      } else {
        logAppError('hairAnalysis.analyzeHairPhotos', error, logContext);
      }
    }

    const userMessage = technicalMessage.includes('at least one hair photo')
      ? 'Please upload at least one clear hair photo before running the analysis.'
      : isRateLimitError
        ? Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? `Hair analysis is busy right now. Please wait ${retryAfterSeconds} seconds, then try again.`
          : 'Hair analysis is busy right now. Please try again in a moment.'
      : isGatewayFailureResponse(resolvedMessage)
        ? 'Hair analysis is temporarily unavailable on the server right now. Please try again in a moment.'
      : isTemporaryBusyError
        ? 'Hair analysis is temporarily busy right now. Please try again in a moment.'
      : isProviderAccessDenied
        ? 'Hair analysis provider access is denied. Please ask an admin to check the OpenAI API key and model access.'
      : isServerConfigurationError(resolvedMessage)
        ? 'Hair analysis is not configured on the server right now. Please try again later.'
      : technicalMessage.includes('guided donation questions') || technicalMessage.includes('guided hair questions')
        ? 'Please complete the guided questions before analysis.'
      : technicalMessage.includes('compliance checklist')
        ? 'Please confirm the photo checklist before analysis.'
        : technicalMessage.includes('could not be read')
          ? 'One of the selected photos could not be read. Please upload or retake that image again.'
          : technicalMessage.includes('invalid jwt')
            ? 'Your session has expired. Please sign in again, then retry the hair analysis.'
            : technicalMessage.includes('requested function was not found') || technicalMessage.includes('not_found')
              ? 'Hair analysis is still being connected on the server. Please try again in a moment.'
            : technicalMessage.includes('required hair views') || technicalMessage.includes('please add these required hair views')
              ? resolvedMessage
      : !edgeFunctionInvoked && isInvokeTransportError(resolvedMessage)
        ? 'Hair analysis could not reach the server right now. Please try again.'
      : !edgeFunctionInvoked
        ? 'Cannot start hair analysis right now. Please try again.'
      : edgeFunctionInvoked && !providerRequestAttempted
        ? 'Hair analysis could not start on the server right now. Please try again.'
            : technicalMessage.includes('too large for analysis')
              ? resolvedMessage
            : technicalMessage.includes('does not represent a valid image')
              ? resolvedMessage
            : technicalMessage.includes('could not be processed for ai analysis')
              ? resolvedMessage
            : technicalMessage.includes('front view photo')
              || technicalMessage.includes('left side photo')
              || technicalMessage.includes('side profile photo')
              || technicalMessage.includes('right side photo')
              || technicalMessage.includes('side view photo')
              || technicalMessage.includes('back view photo')
              || technicalMessage.includes('back hair photo')
              || technicalMessage.includes('hair ends close-up')
              || technicalMessage.includes('hair scalp')
              ? resolvedMessage
            : technicalMessage.includes('does not clearly show hair') || technicalMessage.includes('not look like hair')
              ? resolvedMessage
            : technicalMessage.includes('not clear enough for a reliable hair analysis')
              ? resolvedMessage
            : technicalMessage.includes('invalid json') || technicalMessage.includes('could not be parsed')
              ? 'The AI response could not be read properly. Please try the hair analysis again.'
            : errorType === 'photo_quality'
              ? ['n/a', 'na', 'none', 'null', 'not applicable'].includes(technicalMessage.trim())
                ? 'Hair analysis used the visible hair details from your validated photos.'
                : resolvedMessage
            : technicalMessage.includes('incomplete')
              ? 'Hair analysis could not be completed right now.'
              : 'Hair analysis could not be completed right now.';

    return {
      analysis: null,
      error: userMessage,
      errorType: isRateLimitError
        ? 'quota_exceeded'
        : isProviderAccessDenied
          ? 'provider_access_denied'
          : errorType || null,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
      edgeFunctionInvoked,
      providerRequestAttempted,
      providerResponseStatus,
    };
  }
};
