import { createJsonResponse, handleCorsPreflight } from '../_shared/cors.ts';
import {
  createImageEdit,
  createStructuredResponse,
  getDefaultOpenAiImageModel,
  getDefaultOpenAiModel,
} from '../_shared/openai.ts';

const MAX_CANDIDATE_WIGS = 24;
const RECOMMENDATION_COUNT = 3;
const PREVIEW_STORAGE_BUCKET = Deno.env.get('WIG_REQUEST_PREVIEWS_BUCKET') || 'wig_request_previews';

type WigRecommendation = {
  wig_id: string;
  rank: number;
  suitability_reason: string;
  styling_note: string;
  wig: Record<string, unknown>;
};

const toText = (value: unknown) => (
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
);

const toSafeErrorMessage = (value: string) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-key]')
    .slice(0, 500);
};

const getAuthenticatedUserId = async (request: Request) => {
  const authorization = (request.headers.get('Authorization') || '').trim();
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
  if (!authorization.match(/^Bearer\s+\S+$/i) || !supabaseUrl || !anonKey) return '';

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
    });
    if (!response.ok) return '';
    const user = await response.json().catch(() => ({}));
    return toText(user?.id);
  } catch (error) {
    console.error('[generate-wig-preview] auth validation failed', error);
    return '';
  }
};

const dataUrlToBlob = (dataUrl: string) => {
  const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!match?.[2]) throw new Error('Generated image data is invalid.');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1] || 'image/webp' });
};

const persistGeneratedImage = async ({
  imageUrl,
  userId,
  optionIndex,
}: {
  imageUrl: string;
  userId: string;
  optionIndex: number;
}) => {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase Storage credentials are not configured in Edge Function Secrets.');
  }

  const imageBlob = imageUrl.startsWith('data:')
    ? dataUrlToBlob(imageUrl)
    : await fetch(imageUrl).then(async (response) => {
        if (!response.ok) throw new Error('Unable to download the generated OpenAI image.');
        return await response.blob();
      });
  const filePath = `${userId}/ai-wig-preview-${Date.now()}-${optionIndex}.webp`;
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const uploadResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/${encodeURIComponent(PREVIEW_STORAGE_BUCKET)}/${encodedPath}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': imageBlob.type || 'image/webp',
        'x-upsert': 'false',
      },
      body: imageBlob,
    },
  );
  if (!uploadResponse.ok) {
    const payload = await uploadResponse.json().catch(() => ({}));
    throw new Error(toText(payload?.message) || 'Unable to save the generated wig preview.');
  }

  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(PREVIEW_STORAGE_BUCKET)}/${encodedPath}`;
};

const getPatientImageUrl = (referenceImage: Record<string, unknown>) => (
  toText(referenceImage?.dataUrl)
  || toText(referenceImage?.imageUrl)
  || toText(referenceImage?.uri)
);

const getWigReferenceUrl = (wig: Record<string, unknown>) => (
  toText(wig?.reference_image_url)
  || toText(wig?.thumbnail_url)
  || toText(wig?.layer_full_wig_url)
  || toText(wig?.layer_front_bangs_url)
  || toText(wig?.layer_back_hair_url)
);

const isAllowedStorageImageUrl = (value: string) => {
  try {
    const imageUrl = new URL(value);
    const supabaseUrl = new URL((Deno.env.get('SUPABASE_URL') || '').trim());
    return imageUrl.protocol === 'https:' && imageUrl.host === supabaseUrl.host;
  } catch {
    return false;
  }
};

const getWigId = (wig: Record<string, unknown>) => (
  toText(wig?.wig_id) || toText(wig?.id)
);

const getWigName = (wig: Record<string, unknown>) => (
  toText(wig?.wig_name)
  || toText((wig?.physical_specification as Record<string, unknown>)?.style)
  || 'Available wig'
);

const normalizeWig = (wig: Record<string, unknown>) => {
  const specification = (wig?.physical_specification || {}) as Record<string, unknown>;
  const id = getWigId(wig);

  return {
    ...wig,
    id,
    wig_id: id,
    wig_name: getWigName(wig),
    reference_image_url: getWigReferenceUrl(wig),
    physical_specification: {
      color: toText(specification?.color) || toText(wig?.pending_hair_color),
      length: specification?.length ?? wig?.pending_hair_length ?? '',
      hair_texture: toText(specification?.hair_texture) || toText(wig?.pending_hair_texture),
      hair_density: toText(specification?.hair_density) || toText(wig?.pending_hair_density),
      cap_size: toText(specification?.cap_size) || toText(wig?.pending_cap_size),
      style: toText(specification?.style) || toText(wig?.pending_style),
    },
  };
};

const recommendationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    visual_profile_summary: { type: 'string' },
    recommendations: {
      type: 'array',
      minItems: RECOMMENDATION_COUNT,
      maxItems: RECOMMENDATION_COUNT,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          wig_id: { type: 'string' },
          rank: { type: 'integer', minimum: 1, maximum: RECOMMENDATION_COUNT },
          suitability_reason: { type: 'string' },
          styling_note: { type: 'string' },
        },
        required: ['wig_id', 'rank', 'suitability_reason', 'styling_note'],
      },
    },
  },
  required: ['visual_profile_summary', 'recommendations'],
};

const rankingInstructions = [
  'You are a wig styling assistant. Rank exactly three distinct wigs from the supplied inventory for the person in the photo.',
  'Base recommendations only on visible face outline, apparent proportions, and how each wig style, length, texture, density, and color visually frames the face.',
  'Do not identify the person or infer ethnicity, health, diagnosis, personality, gender identity, or any other sensitive attribute.',
  'Use only wig_id values present in the supplied inventory. Do not invent wigs.',
  'Rank the recommendations from best overall match to third-best match without using percentages, scores, ratings, or measurements.',
  'For each wig, explain in one or two short, warm, user-friendly sentences how its shape, length, texture, volume, fringe, or color complements the visible facial features and frames the face.',
  'Avoid technical styling jargon, guarantees, negative comments, and sensitive personal inferences. Return JSON only.',
].join(' ');

const toInventorySummary = (wig: Record<string, unknown>) => ({
  wig_id: getWigId(wig),
  wig_name: getWigName(wig),
  stock_count: wig?.stock_count ?? null,
  physical_specification: wig?.physical_specification || {},
});

const completeRecommendations = (
  rawRecommendations: Array<Record<string, unknown>>,
  wigs: Array<Record<string, unknown>>,
  selectedWigId = '',
): WigRecommendation[] => {
  const wigById = new Map(wigs.map((wig) => [getWigId(wig), wig]));
  const usedIds = new Set<string>();
  const completed: Array<Record<string, unknown>> = [];

  if (selectedWigId && wigById.has(selectedWigId)) {
    const selectedRecommendation = (rawRecommendations || []).find(
      (item) => toText(item?.wig_id) === selectedWigId,
    );
    usedIds.add(selectedWigId);
    completed.push(selectedRecommendation || {
      wig_id: selectedWigId,
      rank: 1,
      suitability_reason: 'This is the style you selected. It is included so you can see how naturally it frames your face beside the other suggestions.',
      styling_note: 'Patient-selected comparison style.',
    });
  }

  for (const item of rawRecommendations || []) {
    const wigId = toText(item?.wig_id);
    if (!wigId || usedIds.has(wigId) || !wigById.has(wigId)) continue;
    usedIds.add(wigId);
    completed.push({ ...item, wig_id: wigId });
    if (completed.length === RECOMMENDATION_COUNT) break;
  }

  for (const wig of wigs) {
    const wigId = getWigId(wig);
    if (!wigId || usedIds.has(wigId)) continue;
    usedIds.add(wigId);
    completed.push({
      wig_id: wigId,
      rank: completed.length + 1,
      suitability_reason: 'This style softly frames your face and creates a balanced, natural-looking outline.',
      styling_note: 'AI fallback recommendation based on the available wig inventory.',
    });
    if (completed.length === RECOMMENDATION_COUNT) break;
  }

  return completed.map((item, index) => {
    const wigId = toText(item?.wig_id);
    const wig = wigById.get(wigId);
    if (!wig) {
      throw new Error(`Recommendation references an unavailable wig: ${wigId || 'missing wig ID'}.`);
    }

    return {
      wig_id: wigId,
      rank: index + 1,
      suitability_reason: toText(item?.suitability_reason)
        || 'This style softly frames your face and creates a balanced, natural-looking outline.',
      styling_note: toText(item?.styling_note)
        || 'Recommended from the available wig inventory.',
      wig,
    };
  });
};

const buildTryOnPrompt = ({
  wig,
  recommendation,
}: {
  wig: Record<string, unknown>;
  recommendation: WigRecommendation;
}) => {
  const specification = (wig?.physical_specification || {}) as Record<string, unknown>;

  return [
    'Create a photorealistic virtual wig try-on using the two supplied reference images.',
    'The first image is the patient photo and must remain the composition and identity reference.',
    'The second image is the exact wig reference and must define the hairstyle.',
    'Place that wig naturally and accurately on the patient head, aligned to the hairline, forehead, temples, ears, crown, neck, and shoulders.',
    'Preserve the patient face, facial features, expression, skin tone, head pose, body, clothing, background, camera angle, and lighting.',
    'Change only the hair and areas naturally occluded by the selected wig. Remove or cover the original hair where the wig overlaps.',
    'Match realistic strand direction, density, flyaways, shadows, highlights, perspective, and contact at the scalp.',
    'Do not beautify, reshape, age, or otherwise alter the face. Do not add text, labels, borders, or watermarks.',
    `Selected inventory wig: ${getWigName(wig)}.`,
    `Wig specification: ${JSON.stringify(specification)}.`,
    `Styling rationale: ${toText(recommendation?.suitability_reason)}.`,
  ].join(' ');
};

const createWigImageWithRetry = async ({
  prompt,
  patientImageUrl,
  wigReferenceUrl,
  optionIndex,
}: {
  prompt: string;
  patientImageUrl: string;
  wigReferenceUrl: string;
  optionIndex: number;
}) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await createImageEdit({
        prompt,
        images: [
          { image_url: patientImageUrl },
          { image_url: wigReferenceUrl },
        ],
        quality: 'medium',
        size: '1024x1024',
        outputFormat: 'webp',
        inputFidelity: 'high',
        outputCompression: 82,
      });
    } catch (error) {
      const status = Number((error as Error & { status?: number })?.status || 0);
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 900 * optionIndex));
    }
  }

  throw new Error('OpenAI image edit did not complete.');
};

Deno.serve(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;

  let executionStage = 'authentication';
  try {
    const authenticatedUserId = await getAuthenticatedUserId(request);
    if (!authenticatedUserId) {
      return createJsonResponse({
        error: 'Your session is not authorized to generate wig recommendations.',
        errorType: 'authentication_error',
      }, 401);
    }

    executionStage = 'request_validation';
    const body = await request.json();
    const referenceImage = (body?.reference_image || {}) as Record<string, unknown>;
    const patientImageUrl = getPatientImageUrl(referenceImage);
    const requestedWigs = Array.isArray(body?.available_wigs) ? body.available_wigs : [];
    const selectedWigId = toText(body?.selected_wig_id);
    const wigs = requestedWigs
      .map((wig: Record<string, unknown>) => normalizeWig(wig))
      .filter((wig: Record<string, unknown>) => (
        getWigId(wig) && isAllowedStorageImageUrl(getWigReferenceUrl(wig))
      ))
      .slice(0, MAX_CANDIDATE_WIGS);

    if (!patientImageUrl) {
      return createJsonResponse({ error: 'A front photo is required before generating wig recommendations.' }, 400);
    }

    if (wigs.length < RECOMMENDATION_COUNT) {
      return createJsonResponse({
        error: 'At least three active wigs with reference images are required for AI recommendations.',
      }, 400);
    }

    console.info('[generate-wig-preview] recommendation started', {
      provider: 'openai',
      analysisModel: getDefaultOpenAiModel(),
      imageModel: getDefaultOpenAiImageModel(),
      candidateCount: wigs.length,
    });

    executionStage = 'facial_fit_analysis';
    const analysis = await createStructuredResponse({
      instructions: rankingInstructions,
      schemaName: 'patient_wig_recommendations',
      schema: recommendationSchema,
      maxOutputTokens: 1400,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                task: 'Rank the three most visually suitable wigs.',
                inventory: wigs.map(toInventorySummary),
                patient_preferences: body?.preferences || {},
                selected_wig_id: selectedWigId || null,
                selection_instruction: selectedWigId
                  ? 'Include the patient-selected wig in the three recommendations and rank the other candidates around it.'
                  : 'Choose the top three candidates from the inventory.',
              }),
            },
            {
              type: 'input_image',
              image_url: patientImageUrl,
              detail: 'high',
            },
          ],
        },
      ],
    }) as Record<string, unknown>;

    const recommendations = completeRecommendations(
      Array.isArray(analysis?.recommendations)
        ? analysis.recommendations as Array<Record<string, unknown>>
        : [],
      wigs,
      selectedWigId,
    );

    executionStage = 'try_on_generation';
    const generatedOptions = await Promise.all(recommendations.map(async (recommendation, index) => {
      const wig = recommendation.wig as Record<string, unknown>;
      const generated = await createWigImageWithRetry({
        prompt: buildTryOnPrompt({ wig, recommendation }),
        patientImageUrl,
        wigReferenceUrl: getWigReferenceUrl(wig),
        optionIndex: index + 1,
      });
      const providerImageUrl = 'imageDataUrl' in generated
        ? generated.imageDataUrl
        : generated.imageUrl;
      const generatedImageUrl = await persistGeneratedImage({
        imageUrl: providerImageUrl,
        userId: authenticatedUserId,
        optionIndex: index + 1,
      });

      return {
        id: getWigId(wig),
        option_index: index + 1,
        recommended_style_name: getWigName(wig),
        recommended_style_family: toText((wig?.physical_specification as Record<string, unknown>)?.style),
        match_label: `#${index + 1} - ${index === 0
          ? 'Best overall match'
          : index === 1
            ? 'Great alternative'
            : 'Another flattering option'}`,
        suitability_reason: toText(recommendation.suitability_reason),
        note: toText(recommendation.suitability_reason),
        summary: toText(recommendation.suitability_reason),
        style_notes: toText(recommendation.styling_note),
        generated_image_data_url: generatedImageUrl,
        preview_url: generatedImageUrl,
        render_mode: 'openai_image_edit',
        selected_wig: wig,
      };
    }));

    const primary = generatedOptions[0];
    console.info('[generate-wig-preview] recommendation ready', {
      provider: 'openai',
      recommendationCount: generatedOptions.length,
      generatedImageCount: generatedOptions.filter((item) => item.generated_image_data_url).length,
    });

    executionStage = 'complete';
    return createJsonResponse({
      success: true,
      provider: 'openai',
      analysis_model: getDefaultOpenAiModel(),
      image_model: getDefaultOpenAiImageModel(),
      visual_profile_summary: toText(analysis?.visual_profile_summary),
      summary: toText(analysis?.visual_profile_summary),
      preview_url: primary?.preview_url || '',
      generated_image_data_url: primary?.generated_image_data_url || '',
      render_mode: 'openai_image_edit',
      selected_wig: primary?.selected_wig || null,
      previews: generatedOptions,
      options: generatedOptions,
    });
  } catch (error) {
    console.error('[generate-wig-preview]', error);
    const errorMessage = error instanceof Error ? error.message : String(error || '');
    const normalizedMessage = errorMessage.toLowerCase();
    const providerStatus = Number((error as Error & { status?: number })?.status || 0) || null;
    const isConfigurationError = normalizedMessage.includes('openai api key is not configured')
      || normalizedMessage.includes('supabase storage credentials are not configured');

    return createJsonResponse({
      error: isConfigurationError
        ? 'Wig recommendations are not configured on the server. Please try again later.'
        : 'We could not generate the wig recommendations right now. Please try again.',
      message: toSafeErrorMessage(errorMessage),
      stage: executionStage,
      providerStatus,
      errorType: isConfigurationError ? 'configuration_error' : 'provider_error',
      provider: 'openai',
    }, isConfigurationError ? 500 : 502);
  }
});
