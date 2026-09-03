/// <reference path="../deno-globals.d.ts" />

import { createJsonResponse, handleCorsPreflight } from '../_shared/cors.ts';
import { createStructuredResponse, resolveOpenRouterHairVisionModel } from '../_shared/ai-vision.ts';

const accessoryCheckSchema = {
  type: 'object',
  properties: {
    check: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['no_accessory', 'accessory_detected', 'unclear'],
        },
        detected_accessories: {
          type: 'array',
          items: { type: 'string' },
        },
        confidence: { type: 'number' },
        reason: { type: 'string' },
        visual_screening_completed: { type: 'boolean' },
        hair_fully_visible: { type: 'boolean' },
        hair_loose_and_down: { type: 'boolean' },
        presentation_issues: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: [
        'status',
        'detected_accessories',
        'confidence',
        'reason',
        'visual_screening_completed',
        'hair_fully_visible',
        'hair_loose_and_down',
        'presentation_issues',
      ],
    },
  },
  required: ['check'],
};

const normalizeString = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
);

const normalizeStringArray = (value: unknown) => (
  Array.isArray(value)
    ? [...new Set(value.map(normalizeString).filter(Boolean))]
    : []
);

const extractImageData = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
};

const instructions = [
  'You are a strict accessory gate for one guided hair-screening camera frame.',
  'Return JSON only. Do not identify the person or infer sensitive traits.',
  '',
  'Set status="accessory_detected" when any of these is visibly worn on the face or head, fastened to the hair, or covering hair: prescription eyeglasses, reading glasses, sunglasses, cap, hat, bonnet, wig cap, head wrap, scarf, hood, headband, hair clip, claw clip, pin, hair tie, scrunchie, ribbon, headphones, headset, earbuds, face mask, face shield, towel, or similar item.',
  'Eyeglasses must always be reported even when they do not cover the hairline.',
  'Every detected accessory is disallowed for this guided capture even when it does not block hair length.',
  'Report each visible item using a short familiar name in detected_accessories.',
  'Do not count earrings, necklaces, ordinary clothing below the neck, room objects, or background objects unless they cover or touch the required hair or face area.',
  'Do not count the person\'s hand as an accessory, but use status="unclear" if a hand blocks the hair, scalp, or face needed for this view.',
  'For scalp, hair-ends, and back-hair views, a missing face is expected. Inspect the visible head and hair for accessories.',
  'Set hair_fully_visible=false when the hair area required by this view is cropped, covered, too dark, badly blurred, or hidden by the pose, hand, clothing, or another object.',
  'Set hair_loose_and_down=false if the hair is tied, pinned, clipped, braided into an updo, folded upward, placed in a bun or ponytail, or covered by a cap, hat, bonnet, scarf, or hood. For scalp and hair-ends close-ups, judge whether the visible hair is free of these restraints even if its full hanging length is outside the close-up.',
  'List short actionable problems such as "hair tied in ponytail", "cap covers hair", or "hair ends cropped" in presentation_issues.',
  'Use status="unclear" when blur, darkness, cropping, or obstruction prevents a reliable accessory decision.',
  'Use status="no_accessory" only after checking the entire visible head, face, and hair area.',
  'Set visual_screening_completed=true only when the decision is clear. Keep the reason to one short sentence.',
].join('\n');

Deno.serve(async (request) => {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  if (request.method !== 'POST') {
    return createJsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const body = await request.json();
    const dataUrl = normalizeString(body?.image?.dataUrl);
    const image = extractImageData(dataUrl);
    const viewLabel = normalizeString(body?.view?.label) || 'Hair photo';

    if (!image || !image.mimeType.startsWith('image/') || !image.data) {
      return createJsonResponse({ error: 'A readable image is required.' }, 400);
    }

    if (image.data.length > 12_000_000) {
      return createJsonResponse({ error: 'The image is too large to check.' }, 413);
    }

    const hasOpenRouterKey = Boolean(Deno.env.get('OPENROUTER_API_KEY'));

    if (!hasOpenRouterKey) {
      return createJsonResponse({ error: 'OpenRouter accessory validation is not configured.' }, 500);
    }

    const model = resolveOpenRouterHairVisionModel(
      Deno.env.get('OPENROUTER_HAIR_VALIDATION_MODEL'),
    );

    const result = await createStructuredResponse({
      providerMode: 'openrouter-only',
      systemInstruction: instructions,
      responseJsonSchema: accessoryCheckSchema,
      maxOutputTokens: 1400,
      model,
      temperature: 0,
      reasoningEffort: 'minimal',
      includeDiagnostics: true,
      providerSort: 'latency',
      contents: [{
        role: 'user',
        parts: [
          { text: `Check this ${viewLabel} frame for visible accessories before it can be accepted.` },
          {
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          },
        ],
      }],
    });

    const parsed = result?.parsed && typeof result.parsed === 'object'
      ? result.parsed as Record<string, unknown>
      : {};
    const source = parsed.check && typeof parsed.check === 'object'
      ? parsed.check as Record<string, unknown>
      : parsed;
    const status = normalizeString(source.status).toLowerCase();
    const detectedAccessories = normalizeStringArray(source.detected_accessories);
    const presentationIssues = normalizeStringArray(source.presentation_issues);
    const hairFullyVisible = source.hair_fully_visible === true;
    const hairLooseAndDown = source.hair_loose_and_down === true;
    const accessoryDetected = status === 'accessory_detected' || detectedAccessories.length > 0;
    const presentationBlocked = !hairFullyVisible || !hairLooseAndDown || presentationIssues.length > 0;
    const visualScreeningCompleted = source.visual_screening_completed === true
      && ['no_accessory', 'accessory_detected'].includes(status);
    const confidenceValue = Number(source.confidence);
    const confidence = Number.isFinite(confidenceValue)
      ? Math.min(1, Math.max(0, confidenceValue))
      : 0;

    return createJsonResponse({
      check: {
        accessory_detected: accessoryDetected,
        detected_accessories: detectedAccessories,
        confidence,
        reason: normalizeString(source.reason),
        visual_screening_completed: visualScreeningCompleted,
        hair_fully_visible: hairFullyVisible,
        hair_loose_and_down: hairLooseAndDown,
        presentation_issues: presentationIssues,
        can_capture: visualScreeningCompleted && !accessoryDetected && !presentationBlocked,
      },
      diagnostics: result?.diagnostics || null,
    });
  } catch (error) {
    console.error('[validate-hair-capture-accessories]', error);
    const diagnostics = (error as { diagnostics?: Record<string, unknown> })?.diagnostics || null;
    return createJsonResponse({
      error: 'The accessory check is temporarily unavailable.',
      diagnostics,
    }, 503);
  }
});
