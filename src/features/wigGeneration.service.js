import { invokeEdgeFunction } from '../api/supabase/client';
import { getErrorMessage, logAppError, logAppEvent } from '../utils/appErrors';
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
    const technicalMessage = resolvedMessage.toLowerCase();
    if (!technicalMessage.includes('not_found') && !technicalMessage.includes('invalid jwt')) {
      logAppError('wigGeneration.generatePatientWigPreview', error, {
        hasReferenceImage: Boolean(referenceImage?.uri || referenceImage?.dataUrl),
      });
    }

    const userMessage = technicalMessage.includes('front photo')
      ? 'Please upload a clear front photo first.'
      : technicalMessage.includes('invalid jwt') || technicalMessage.includes('session is not authorized')
        ? 'Your session has expired. Please sign in again, then retry the wig preview.'
        : technicalMessage.includes('not configured') || technicalMessage.includes('openai api key')
          ? 'Wig preview is not configured on the server. Please try again later.'
          : technicalMessage.includes('requested function was not found') || technicalMessage.includes('not_found')
            ? 'Wig preview is still being connected on the server. Please try again in a moment.'
            : technicalMessage.includes('three active wigs') || technicalMessage.includes('reference image')
              ? 'At least three wigs with valid reference images are needed for AI recommendations.'
              : resolvedMessage || "We couldn't generate all three wig previews. Please try again or choose another photo.";

    return { preview: null, error: userMessage };
  }
};
