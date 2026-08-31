import { invokeEdgeFunction } from '../api/supabase/client';
import { getErrorMessage, logAppEvent } from '../utils/appErrors';
import { wigGenerationFunctionName } from './wigRequest.constants';

const getRecommendationLabel = (index) => (
  index === 0
    ? '#1 - Best overall match'
    : index === 1
      ? '#2 - Great alternative'
      : '#3 - Another flattering option'
);

const normalizePreviewOption = (item, index) => ({
  id: item?.id || `variant-${item?.option_index || index + 1}`,
  option_index: Number.isFinite(Number(item?.option_index)) ? Number(item.option_index) : index + 1,
  name: item?.recommended_style_name || item?.name || `Style ${index + 1}`,
  note: item?.note || item?.style_notes || item?.summary || '',
  summary: item?.summary || item?.note || '',
  style_notes: item?.style_notes || item?.note || '',
  family: item?.recommended_style_family || item?.family || '',
  match_label: getRecommendationLabel(index),
  preview_url: item?.preview_url || item?.generated_image_data_url || item?.generatedImageDataUrl || '',
  generated_image_data_url: item?.generated_image_data_url || item?.generatedImageDataUrl || item?.preview_url || '',
  render_mode: item?.render_mode || item?.renderMode || '',
  selected_wig: item?.selected_wig || item?.selectedWig || null,
  placement: item?.placement || null,
  suitability_reason: item?.suitability_reason || item?.reason || item?.note || '',
});

const normalizeSelectedWig = (selectedWig = {}) => {
  const physicalSpec = selectedWig?.physical_specification || {};
  const referenceUrl = selectedWig?.layer_full_wig_url
    || selectedWig?.thumbnail_url
    || selectedWig?.layer_front_bangs_url
    || selectedWig?.layer_back_hair_url
    || '';

  return {
    ...selectedWig,
    id: selectedWig?.wig_id || selectedWig?.id || null,
    wig_id: selectedWig?.wig_id || selectedWig?.id || null,
    wig_name: selectedWig?.wig_name || physicalSpec?.style || 'Selected wig',
    reference_image_url: referenceUrl,
    physical_specification: {
      color: physicalSpec?.color || selectedWig?.pending_hair_color || '',
      length: physicalSpec?.length ?? selectedWig?.pending_hair_length ?? '',
      hair_texture: physicalSpec?.hair_texture || selectedWig?.pending_hair_texture || '',
      hair_density: physicalSpec?.hair_density || selectedWig?.pending_hair_density || '',
      cap_size: physicalSpec?.cap_size || selectedWig?.pending_cap_size || '',
      style: physicalSpec?.style || selectedWig?.pending_style || '',
    },
  };
};

const normalizePreview = (data) => {
  const rawPreviews = Array.isArray(data?.previews)
    ? data.previews
    : Array.isArray(data?.options)
      ? data.options
      : [];

  const options = rawPreviews
    .map((item, index) => normalizePreviewOption(item, index))
    .filter((item) => item.name || item.note || item.generated_image_data_url);

  const primaryOption = options[0] || null;

  return {
    summary: data?.summary || data?.visual_profile_summary || primaryOption?.summary || '',
    visual_profile_summary: data?.visual_profile_summary || data?.summary || '',
    style_notes: data?.style_notes || primaryOption?.style_notes || '',
    recommended_style_name: data?.recommended_style_name || primaryOption?.name || '',
    recommended_style_family: data?.recommended_style_family || primaryOption?.family || '',
    preview_url: data?.preview_url || data?.generated_image_data_url || primaryOption?.preview_url || primaryOption?.generated_image_data_url || '',
    generated_image_data_url: data?.generated_image_data_url || data?.preview_url || primaryOption?.generated_image_data_url || primaryOption?.preview_url || '',
    render_mode: data?.render_mode || primaryOption?.render_mode || '',
    selected_wig: data?.selected_wig || primaryOption?.selected_wig || null,
    placement: data?.placement || primaryOption?.placement || null,
    provider: data?.provider || '',
    options,
  };
};

const normalizeReferenceImage = (referenceImage = {}) => {
  const dataUrl = typeof referenceImage?.dataUrl === 'string' ? referenceImage.dataUrl.trim() : '';
  const uri = typeof referenceImage?.uri === 'string' ? referenceImage.uri.trim() : '';

  return {
    dataUrl: dataUrl.startsWith('data:') ? dataUrl : '',
    imageUrl: uri.startsWith('http://') || uri.startsWith('https://') ? uri : '',
  };
};

const getEdgeFunctionErrorMessage = async (error) => {
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') {
    return error?.message || 'OpenAI wig recommendation request failed.';
  }

  try {
    const payload = await response.clone().json();
    return payload?.message || payload?.error || error?.message || 'OpenAI wig recommendation request failed.';
  } catch {
    try {
      const responseText = await response.clone().text();
      return responseText || error?.message || 'OpenAI wig recommendation request failed.';
    } catch {
      return error?.message || 'OpenAI wig recommendation request failed.';
    }
  }
};

const includesAny = (message, tokens) => tokens.some((token) => message.includes(token));

const resolveWigGenerationFailure = (technicalMessage = '') => {
  const message = String(technicalMessage || '').toLowerCase();

  if (message.includes('front photo')) {
    return {
      code: 'photo_required',
      title: 'Photo Needed',
      message: 'Take a clear front-facing photo before creating your wig previews.',
    };
  }

  if (includesAny(message, ['invalid jwt', 'session is not authorized', 'session has expired', 'sign in again'])) {
    return {
      code: 'session_expired',
      title: 'Session Expired',
      message: 'Please sign in again, then return to create your wig previews.',
    };
  }

  if (includesAny(message, [
    'no credits',
    'credits remaining',
    'insufficient_quota',
    'insufficient quota',
    'billing',
    'payment required',
    'exceeded your current quota',
    'usage limit',
  ])) {
    return {
      code: 'service_unavailable',
      title: 'Preview Temporarily Unavailable',
      message: 'Wig previews are temporarily unavailable. Your photo is still saved, so please try again later.',
    };
  }

  if (includesAny(message, ['rate limit', 'too many requests', 'overloaded', 'temporarily busy', 'status 429', ' 429'])) {
    return {
      code: 'service_busy',
      title: 'Preview Service Is Busy',
      message: 'Many previews are being created right now. Please wait a moment and try again.',
    };
  }

  if (includesAny(message, ['network request failed', 'failed to fetch', 'network error', 'timeout', 'timed out', 'offline'])) {
    return {
      code: 'connection_error',
      title: 'Connection Problem',
      message: 'We could not reach the preview service. Check your connection and try again.',
    };
  }

  if (includesAny(message, ['content policy', 'safety policy', 'image could not be processed', 'invalid image', 'unsupported image'])) {
    return {
      code: 'photo_rejected',
      title: 'Try Another Photo',
      message: 'We could not use this photo. Retake it with your face and full head clearly visible.',
    };
  }

  if (includesAny(message, ['three active wigs', 'valid reference images', 'reference image'])) {
    return {
      code: 'wig_inventory_unavailable',
      title: 'Wig Previews Unavailable',
      message: 'There are not enough preview-ready wig styles available right now. Please try again later.',
    };
  }

  if (includesAny(message, [
    'not configured',
    'openai api key',
    'requested function was not found',
    'not_found',
    'incomplete set',
  ])) {
    return {
      code: 'service_unavailable',
      title: 'Preview Temporarily Unavailable',
      message: 'We cannot create wig previews right now. Your photo is still saved, so please try again later.',
    };
  }

  return {
    code: 'preview_failed',
    title: 'Preview Could Not Be Created',
    message: 'Something interrupted the preview. Your photo is still saved—please try again.',
  };
};

export const generatePatientWigPreview = async ({
  preferences,
  referenceImage,
  selectedWig = null,
  availableWigs = [],
}) => {
  try {
    const normalizedReferenceImage = normalizeReferenceImage(referenceImage);
    if (!normalizedReferenceImage.dataUrl && !normalizedReferenceImage.imageUrl) {
      throw new Error('A front photo is required before generating a wig preview.');
    }

    const normalizedAvailableWigs = (availableWigs || [])
      .map(normalizeSelectedWig)
      .filter((wig) => wig.wig_id && wig.reference_image_url);
    if (normalizedAvailableWigs.length < 3) {
      throw new Error('At least three active wigs with reference images are required for AI recommendations.');
    }

    const normalizedSelectedWig = selectedWig ? normalizeSelectedWig(selectedWig) : null;
    const orderedWigs = normalizedSelectedWig?.wig_id
      ? [normalizedSelectedWig, ...normalizedAvailableWigs.filter((wig) => wig.wig_id !== normalizedSelectedWig.wig_id)]
      : normalizedAvailableWigs;

    logAppEvent('wigGeneration.openAiRequest', 'Requesting AI wig ranking and try-on images.', {
      candidateCount: orderedWigs.length,
      selectedWigId: normalizedSelectedWig?.wig_id || null,
      hasReferenceDataUrl: Boolean(normalizedReferenceImage.dataUrl),
    });

    const { data, error } = await invokeEdgeFunction(wigGenerationFunctionName, {
      body: {
        preferences: preferences || {},
        reference_image: {
          dataUrl: normalizedReferenceImage.dataUrl,
          imageUrl: normalizedReferenceImage.imageUrl,
        },
        selected_wig_id: normalizedSelectedWig?.wig_id || null,
        available_wigs: orderedWigs,
      },
    });

    if (error) throw new Error(await getEdgeFunctionErrorMessage(error));
    if (data?.error) throw new Error(data.message || data.error);

    const preview = normalizePreview(data);
    if (preview.options.length < 3 || preview.options.some((option) => !option.generated_image_data_url)) {
      throw new Error('OpenAI returned an incomplete set of wig recommendations.');
    }

    return { preview, previews: preview.options, error: null };
  } catch (error) {
    const resolvedMessage = getErrorMessage(error);
    const failure = resolveWigGenerationFailure(resolvedMessage);

    // This failure is handled in the UI. Keep diagnostics in opt-in app logs
    // without triggering a development error overlay for the patient.
    logAppEvent('wigGeneration.generatePatientWigPreview.failed', 'Wig preview generation failed.', {
      category: failure.code,
      technicalMessage: resolvedMessage,
      hasReferenceImage: Boolean(referenceImage?.uri || referenceImage?.dataUrl),
    }, 'info');

    return {
      preview: null,
      error: failure.message,
      errorCode: failure.code,
      errorTitle: failure.title,
    };
  }
};
