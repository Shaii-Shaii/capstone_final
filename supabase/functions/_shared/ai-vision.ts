/// <reference path="../deno-globals.d.ts" />

import { createStructuredResponse as createGoogleStructuredResponse } from './google-ai.ts';
import { createStructuredResponse as createOpenAiStructuredResponse } from './openai-vision.ts';
import { createVisionStructuredResponse as createOpenRouterStructuredResponse } from './openrouter.ts';

type GenerateStructuredContentParams = {
  model?: string;
  providerMode?: 'fallback' | 'openrouter-only';
  systemInstruction?: string;
  contents: Array<Record<string, unknown>>;
  responseJsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  includeDiagnostics?: boolean;
  providerSort?: 'latency' | 'throughput' | 'price';
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
};

export const DEFAULT_OPENROUTER_HAIR_VISION_MODEL = 'google/gemini-3.1-flash-lite';

export const resolveOpenRouterHairVisionModel = (configuredModel?: string | null) => {
  const normalizedModel = String(configuredModel || '').trim();
  const lowerModel = normalizedModel.toLowerCase();
  if (!normalizedModel || lowerModel === 'openrouter/free' || lowerModel.endsWith(':free')) {
    return DEFAULT_OPENROUTER_HAIR_VISION_MODEL;
  }
  return normalizedModel;
};

const hasGoogleAiKey = () => Boolean((Deno.env.get('GOOGLE_AI_API_KEY') || '').trim());
const hasOpenAiKey = () => Boolean((Deno.env.get('OPENAI_API_KEY') || '').trim());
const hasOpenRouterKey = () => Boolean((Deno.env.get('OPENROUTER_API_KEY') || '').trim());

const resolveGoogleFallbackModel = (model?: string) => {
  const normalizedModel = String(model || '').trim();
  if (normalizedModel.toLowerCase().startsWith('gemini')) return normalizedModel;

  return Deno.env.get('GOOGLE_AI_HAIR_VALIDATION_MODEL')
    || Deno.env.get('GOOGLE_AI_HAIR_ANALYSIS_MODEL')
    || Deno.env.get('GOOGLE_AI_VISION_MODEL')
    || Deno.env.get('GOOGLE_AI_MODEL')
    || Deno.env.get('GEMINI_MODEL')
    || undefined;
};

const resolveOpenAiFallbackModel = (model?: string) => {
  const normalizedModel = String(model || '').trim();
  if (normalizedModel.toLowerCase().startsWith('gpt')) return normalizedModel;

  return Deno.env.get('OPENAI_VISION_MODEL')
    || Deno.env.get('OPENAI_MODEL')
    || undefined;
};

const getProviderErrorType = (error: unknown) => (
  (error as { diagnostics?: { provider_error_type?: string } })?.diagnostics?.provider_error_type || ''
);

const shouldRetryOpenRouterFree = (error: unknown) => {
  const errorType = getProviderErrorType(error);
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return [
    'quota_exceeded',
    'temporary_unavailable',
    'model_unavailable',
    'incomplete_response',
    'empty_response',
    'invalid_response',
  ].includes(errorType)
    || message.includes('invalid json')
    || message.includes('empty response')
    || message.includes('incomplete');
};

const isFreeOpenRouterModel = (model?: string) => {
  const normalizedModel = String(model || '').trim().toLowerCase();
  return normalizedModel === 'openrouter/free' || normalizedModel.endsWith(':free');
};

const findMissingRequiredField = (
  value: unknown,
  schema: Record<string, unknown>,
  path = 'response',
): string => {
  if (!schema || typeof schema !== 'object') return '';
  const schemaType = String(schema.type || '').toLowerCase();

  if (schemaType === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return path;
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const field of required) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) return `${path}.${field}`;
    }
    const properties = schema.properties && typeof schema.properties === 'object'
      ? schema.properties as Record<string, Record<string, unknown>>
      : {};
    for (const [field, fieldSchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
      const missing = findMissingRequiredField(record[field], fieldSchema, `${path}.${field}`);
      if (missing) return missing;
    }
  }

  if (schemaType === 'array' && Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    for (let index = 0; index < value.length; index += 1) {
      const missing = findMissingRequiredField(
        value[index],
        schema.items as Record<string, unknown>,
        `${path}[${index}]`,
      );
      if (missing) return missing;
    }
  }

  return '';
};

const requireCompleteStructuredResult = <T>(
  result: T,
  params: GenerateStructuredContentParams,
): T => {
  const resultRecord = result && typeof result === 'object'
    ? result as Record<string, unknown>
    : {};
  const parsed = params.includeDiagnostics ? resultRecord.parsed : result;
  let missingField = findMissingRequiredField(parsed, params.responseJsonSchema);

  // Some OpenRouter models follow the requested fields but omit a single
  // cosmetic envelope such as { analysis: ... }, { validation: ... }, or
  // { check: ... }. Each consuming Edge Function already normalizes both
  // shapes, so validate the flat object against the envelope's schema before
  // deciding that the response is incomplete.
  if (missingField && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const requiredEnvelopeFields = Array.isArray(params.responseJsonSchema.required)
      ? params.responseJsonSchema.required.map(String)
      : [];
    const schemaProperties = params.responseJsonSchema.properties
      && typeof params.responseJsonSchema.properties === 'object'
      ? params.responseJsonSchema.properties as Record<string, Record<string, unknown>>
      : {};
    const envelopeField = requiredEnvelopeFields.length === 1
      ? requiredEnvelopeFields[0]
      : '';
    const envelopeSchema = envelopeField ? schemaProperties[envelopeField] : null;
    const parsedRecord = parsed as Record<string, unknown>;

    if (
      envelopeField
      && envelopeSchema
      && !Object.prototype.hasOwnProperty.call(parsedRecord, envelopeField)
    ) {
      missingField = findMissingRequiredField(parsed, envelopeSchema, 'response');
    }
  }

  if (!missingField) return result;

  const error = new Error(`AI provider response was incomplete at ${missingField}.`);
  (error as Error & { diagnostics?: Record<string, unknown> }).diagnostics = {
    ...(resultRecord.diagnostics && typeof resultRecord.diagnostics === 'object'
      ? resultRecord.diagnostics as Record<string, unknown>
      : {}),
    provider_error_type: 'incomplete_response',
  };
  throw error;
};

export const createStructuredResponse = async (params: GenerateStructuredContentParams) => {
  const openRouterOnly = params.providerMode === 'openrouter-only';
  const openRouterConfigured = hasOpenRouterKey();
  const googleConfigured = !openRouterOnly && hasGoogleAiKey();
  const openAiConfigured = !openRouterOnly && hasOpenAiKey();
  let openRouterFailureDiagnostics: Record<string, unknown> | null = null;
  let googleFailureDiagnostics: Record<string, unknown> | null = null;

  if (openRouterOnly && !openRouterConfigured) {
    throw new Error('OpenRouter API key is not configured. Set OPENROUTER_API_KEY in Edge Function Secrets.');
  }

  if (openRouterConfigured) {
    const usesFreeRouter = isFreeOpenRouterModel(params.model);
    const maxOpenRouterAttempts = usesFreeRouter ? 3 : 1;
    let lastOpenRouterError: unknown = null;

    for (let attempt = 1; attempt <= maxOpenRouterAttempts; attempt += 1) {
      console.info('[ai-vision] calling OpenRouter vision provider', {
        requestedModel: params.model || null,
        attempt,
        maxAttempts: maxOpenRouterAttempts,
        hasGoogleFallback: googleConfigured,
        hasOpenAiFallback: openAiConfigured,
      });

      try {
        const result = await createOpenRouterStructuredResponse(params);
        return requireCompleteStructuredResult(result, params);
      } catch (error) {
        lastOpenRouterError = error;
        openRouterFailureDiagnostics = (error as { diagnostics?: Record<string, unknown> })?.diagnostics || null;
        const willRetryFreeRouter = usesFreeRouter
          && attempt < maxOpenRouterAttempts
          && shouldRetryOpenRouterFree(error);
        console.warn('[ai-vision] OpenRouter vision attempt failed', {
          attempt,
          maxAttempts: maxOpenRouterAttempts,
          willRetryFreeRouter,
          providerErrorType: getProviderErrorType(error) || null,
          providerResponseStatus: (error as { diagnostics?: { provider_response_status?: number | null } })?.diagnostics?.provider_response_status ?? null,
          providerModel: (error as { diagnostics?: { provider_model?: string | null } })?.diagnostics?.provider_model || null,
          providerFinishReason: (error as { diagnostics?: { provider_finish_reason?: string | null } })?.diagnostics?.provider_finish_reason || null,
          providerNativeFinishReason: (error as { diagnostics?: { provider_native_finish_reason?: string | null } })?.diagnostics?.provider_native_finish_reason || null,
        });
        if (!willRetryFreeRouter) break;
        await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
      }
    }

    if (!googleConfigured && !openAiConfigured) throw lastOpenRouterError;
    console.warn('[ai-vision] OpenRouter attempts exhausted; trying configured fallback provider', {
      providerErrorType: getProviderErrorType(lastOpenRouterError) || null,
      providerResponseStatus: (lastOpenRouterError as { diagnostics?: { provider_response_status?: number | null } })?.diagnostics?.provider_response_status ?? null,
    });
    if (!openRouterFailureDiagnostics) {
      openRouterFailureDiagnostics = (lastOpenRouterError as { diagnostics?: Record<string, unknown> })?.diagnostics || null;
    }
  }

  if (googleConfigured) {
    const googleModel = resolveGoogleFallbackModel(params.model);
    try {
      console.info('[ai-vision] calling Google AI provider', {
        requestedModel: googleModel || null,
        hasOpenAiFallback: openAiConfigured,
        fallbackFromOpenRouter: Boolean(openRouterFailureDiagnostics),
      });
      const result = await createGoogleStructuredResponse({
        ...params,
        model: googleModel,
      });
      return requireCompleteStructuredResult(result, params);
    } catch (error) {
      if (!openAiConfigured) {
        throw error;
      }

      console.warn('[ai-vision] Google AI failed; falling back to OpenAI', {
        googleModel: googleModel || '',
        providerErrorType: getProviderErrorType(error) || null,
        providerResponseStatus: (error as { diagnostics?: { provider_response_status?: number | null } })?.diagnostics?.provider_response_status ?? null,
      });
      googleFailureDiagnostics = (error as { diagnostics?: Record<string, unknown> })?.diagnostics || null;
    }
  }

  if (openAiConfigured) {
    console.info('[ai-vision] calling OpenAI vision provider', {
      requestedModel: resolveOpenAiFallbackModel(params.model) || null,
      googleConfigured,
    });
    try {
      return await createOpenAiStructuredResponse({
        ...params,
        model: resolveOpenAiFallbackModel(params.model),
      });
    } catch (error) {
      if (googleFailureDiagnostics) {
        const diagnostics = (error as { diagnostics?: Record<string, unknown> })?.diagnostics || {};
        (error as { diagnostics?: Record<string, unknown> }).diagnostics = {
          ...diagnostics,
          fallback_from_provider: 'gemini',
          fallback_from_provider_error_type: googleFailureDiagnostics.provider_error_type || null,
          fallback_from_provider_response_status: googleFailureDiagnostics.provider_response_status ?? null,
          fallback_from_provider_model: googleFailureDiagnostics.provider_model || null,
        };
      }
      if (openRouterFailureDiagnostics) {
        const diagnostics = (error as { diagnostics?: Record<string, unknown> })?.diagnostics || {};
        (error as { diagnostics?: Record<string, unknown> }).diagnostics = {
          ...diagnostics,
          openrouter_fallback_error_type: openRouterFailureDiagnostics.provider_error_type || null,
          openrouter_fallback_response_status: openRouterFailureDiagnostics.provider_response_status ?? null,
          openrouter_fallback_model: openRouterFailureDiagnostics.provider_model || null,
        };
      }
      throw error;
    }
  }

  throw new Error('No AI provider API key is configured. Set OPENROUTER_API_KEY, GOOGLE_AI_API_KEY, or OPENAI_API_KEY.');
};
