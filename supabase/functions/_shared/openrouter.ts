const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_IMAGE_URL = 'https://openrouter.ai/api/v1/images';
const OPENROUTER_DEFAULT_MODEL = 'openrouter/free';
const OPENROUTER_DEFAULT_IMAGE_MODEL = 'openai/gpt-image-1';
const OPENROUTER_MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

type StructuredMessage = {
  role: 'system' | 'user' | 'assistant';
  content: Array<Record<string, unknown>>;
};

type StructuredResponseOptions = {
  input: StructuredMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  instructions?: string;
  maxOutputTokens?: number;
  temperature?: number;
  model?: string;
  includeDiagnostics?: boolean;
  providerSort?: 'latency' | 'throughput' | 'price';
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
};

type VisionStructuredResponseOptions = {
  model?: string;
  systemInstruction?: string;
  contents: Array<Record<string, unknown>>;
  responseJsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
  includeDiagnostics?: boolean;
  providerSort?: 'latency' | 'throughput' | 'price';
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
};

type ImageReference = {
  image_url?: string;
  file_id?: string;
};

type ImageEditOptions = {
  prompt: string;
  images: ImageReference[];
  model?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  inputFidelity?: 'low' | 'high';
  outputCompression?: number;
};

type OpenRouterDiagnostics = {
  provider: 'openrouter';
  provider_request_attempted: boolean;
  provider_response_status: number | null;
  provider_parse_success: boolean;
  provider_endpoint: string;
  provider_model: string;
  provider_error_type?: string;
  provider_finish_reason?: string | null;
  provider_native_finish_reason?: string | null;
};

const toText = (value: unknown) => (
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : ''
);

const extractErrorMessage = (payload: any) => (
  payload?.error?.message
  || payload?.message
  || 'OpenRouter request failed.'
);

const extractMessageText = (payload: any) => {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => toText(item?.text) || toText(item?.content))
    .filter(Boolean)
    .join('\n')
    .trim();
};

const extractJsonObject = (value: string) => {
  const withoutFences = String(value || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!withoutFences) return '';
  if (withoutFences.startsWith('{') && withoutFences.endsWith('}')) return withoutFences;

  const start = withoutFences.indexOf('{');
  if (start < 0) return withoutFences;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < withoutFences.length; index += 1) {
    const character = withoutFences[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return withoutFences.slice(start, index + 1);
    }
  }

  return withoutFences;
};

const parseJson = (value: string) => {
  const candidate = extractJsonObject(value);
  try {
    const parsed = JSON.parse(candidate);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    const normalized = candidate.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(normalized);
  }
};

const classifyError = (status: number, message: string) => {
  const normalized = message.toLowerCase();
  if (status === 429 || normalized.includes('rate limit') || normalized.includes('quota')) {
    return 'quota_exceeded';
  }
  if (status === 401 || status === 403 || normalized.includes('api key') || normalized.includes('unauthorized')) {
    return 'provider_access_denied';
  }
  if (status === 404 || normalized.includes('model not found') || normalized.includes('no endpoints')) {
    return 'model_unavailable';
  }
  if (RETRYABLE_STATUS.has(status) || normalized.includes('temporarily unavailable')) {
    return 'temporary_unavailable';
  }
  return 'provider_error';
};

const createProviderError = (
  message: string,
  diagnostics: OpenRouterDiagnostics,
  status?: number,
) => {
  const error = new Error(message) as Error & {
    diagnostics?: OpenRouterDiagnostics;
    provider?: string;
    status?: number;
  };
  error.diagnostics = { ...diagnostics };
  error.provider = 'openrouter';
  error.status = status;
  return error;
};

const getHeaders = () => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${readOpenRouterKey()}`,
    'Content-Type': 'application/json',
  };
  const siteUrl = toText(Deno.env.get('OPENROUTER_SITE_URL'));
  const appName = toText(Deno.env.get('OPENROUTER_APP_NAME')) || 'Donivra';
  if (siteUrl) headers['HTTP-Referer'] = siteUrl;
  if (appName) headers['X-Title'] = appName;
  return headers;
};

const getProviderPreferences = () => ({
  // Hair analysis requires both vision and structured JSON support. Prevent
  // the free router from silently dropping response_format for a model that
  // cannot satisfy the requested schema.
  require_parameters: true,
  data_collection: toText(Deno.env.get('OPENROUTER_DATA_COLLECTION')).toLowerCase() === 'allow'
    ? 'allow'
    : 'deny',
});

const normalizeChatContent = (item: Record<string, unknown>) => {
  const type = toText(item?.type);
  if (type === 'input_text' || type === 'text') {
    return { type: 'text', text: toText(item?.text) };
  }
  if (type === 'input_image' || type === 'image_url') {
    const nestedUrl = toText((item?.image_url as Record<string, unknown>)?.url);
    const imageUrl = toText(item?.image_url) || nestedUrl;
    return imageUrl
      ? { type: 'image_url', image_url: { url: imageUrl } }
      : null;
  }
  return null;
};

const toChatMessages = (input: StructuredMessage[], instructions = '') => {
  const messages: Array<Record<string, unknown>> = [];
  if (instructions.trim()) {
    messages.push({
      role: 'system',
      content: `${instructions}\n\nReturn one valid JSON object only. Do not use markdown.`,
    });
  }

  for (const message of input || []) {
    const content = (message?.content || [])
      .map((item) => normalizeChatContent(item))
      .filter(Boolean);
    if (!content.length) continue;
    messages.push({ role: message.role || 'user', content });
  }

  return messages;
};

const visionPartToChatContent = (part: Record<string, unknown>) => {
  if (typeof part?.text === 'string') {
    return { type: 'text', text: part.text };
  }

  const inlineData = part?.inlineData as { mimeType?: string; data?: string } | undefined;
  if (!inlineData?.data) return null;
  const imageUrl = inlineData.data.startsWith('data:')
    ? inlineData.data
    : `data:${inlineData.mimeType || 'image/jpeg'};base64,${inlineData.data}`;
  return { type: 'image_url', image_url: { url: imageUrl } };
};

const toVisionMessages = (
  systemInstruction: string,
  contents: Array<Record<string, unknown>>,
) => {
  const messages: StructuredMessage[] = [];
  if (systemInstruction.trim()) {
    messages.push({
      role: 'system',
      content: [{ type: 'input_text', text: systemInstruction }],
    });
  }

  for (const content of contents || []) {
    const rawRole = toText(content?.role);
    const role = ['system', 'assistant', 'user'].includes(rawRole)
      ? rawRole as StructuredMessage['role']
      : 'user';
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const normalized = parts
      .map((part) => part && typeof part === 'object'
        ? visionPartToChatContent(part as Record<string, unknown>)
        : null)
      .filter(Boolean)
      .map((part) => {
        if (part?.type === 'text') return { type: 'input_text', text: part.text };
        return { type: 'input_image', image_url: part?.image_url?.url };
      });
    if (normalized.length) messages.push({ role, content: normalized });
  }
  return messages;
};

export const isOpenRouterConfigured = () => Boolean(
  toText(Deno.env.get('OPENROUTER_API_KEY')),
);

export const readOpenRouterKey = () => {
  const apiKey = toText(Deno.env.get('OPENROUTER_API_KEY'));
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured in Edge Function Secrets.');
  }
  return apiKey;
};

export const getDefaultOpenRouterModel = () => (
  toText(Deno.env.get('OPENROUTER_MODEL')) || OPENROUTER_DEFAULT_MODEL
);

export const getDefaultOpenRouterVisionModel = () => (
  toText(Deno.env.get('OPENROUTER_HAIR_VALIDATION_MODEL'))
  || toText(Deno.env.get('OPENROUTER_VISION_MODEL'))
  || getDefaultOpenRouterModel()
);

export const getDefaultOpenRouterImageModel = () => (
  toText(Deno.env.get('OPENROUTER_IMAGE_MODEL')) || OPENROUTER_DEFAULT_IMAGE_MODEL
);

export const createStructuredResponse = async ({
  input,
  schemaName,
  schema,
  instructions = '',
  maxOutputTokens = 1200,
  temperature = 0.2,
  model = getDefaultOpenRouterModel(),
  includeDiagnostics = false,
  providerSort,
  reasoningEffort,
}: StructuredResponseOptions) => {
  const diagnostics: OpenRouterDiagnostics = {
    provider: 'openrouter',
    provider_request_attempted: false,
    provider_response_status: null,
    provider_parse_success: false,
    provider_endpoint: OPENROUTER_CHAT_URL,
    provider_model: model,
  };
  const messages = toChatMessages(input, instructions);
  if (!messages.length) {
    throw createProviderError('No valid OpenRouter input content was provided.', diagnostics);
  }

  diagnostics.provider_request_attempted = true;
  let response: Response | null = null;
  let payload: any = null;
  for (let attempt = 1; attempt <= OPENROUTER_MAX_ATTEMPTS; attempt += 1) {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxOutputTokens,
        temperature,
        stream: false,
        ...(reasoningEffort
          ? { reasoning: { effort: reasoningEffort, exclude: true } }
          : {}),
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: schemaName,
            strict: false,
            schema,
          },
        },
        provider: {
          ...getProviderPreferences(),
          ...(providerSort ? { sort: providerSort } : {}),
        },
      }),
    });
    payload = await response.json().catch(() => ({}));
    diagnostics.provider_response_status = response.status;
    if (response.ok) break;

    const message = extractErrorMessage(payload);
    diagnostics.provider_error_type = classifyError(response.status, message);
    const canRetry = RETRYABLE_STATUS.has(response.status) && attempt < OPENROUTER_MAX_ATTEMPTS;
    if (!canRetry) throw createProviderError(message, diagnostics, response.status);
    await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
  }

  if (!response?.ok) {
    throw createProviderError('OpenRouter request failed.', diagnostics, response?.status);
  }

  diagnostics.provider_model = toText(payload?.model) || model;
  diagnostics.provider_finish_reason = toText(payload?.choices?.[0]?.finish_reason) || null;
  diagnostics.provider_native_finish_reason = toText(payload?.choices?.[0]?.native_finish_reason) || null;
  const outputText = extractMessageText(payload);
  if (!outputText) {
    diagnostics.provider_error_type = 'empty_response';
    throw createProviderError('OpenRouter returned an empty response.', diagnostics, response.status);
  }

  try {
    const parsed = parseJson(outputText);
    diagnostics.provider_parse_success = true;
    return includeDiagnostics ? { parsed, diagnostics } : parsed;
  } catch {
    diagnostics.provider_error_type = 'invalid_response';
    throw createProviderError('OpenRouter returned invalid JSON.', diagnostics, response.status);
  }
};

export const createVisionStructuredResponse = async ({
  model = getDefaultOpenRouterVisionModel(),
  systemInstruction = '',
  contents,
  responseJsonSchema,
  maxOutputTokens = 2048,
  temperature = 0.2,
  includeDiagnostics = false,
  providerSort,
  reasoningEffort,
}: VisionStructuredResponseOptions) => (
  await createStructuredResponse({
    input: toVisionMessages(systemInstruction, contents),
    schemaName: 'hair_analysis_result',
    schema: responseJsonSchema,
    maxOutputTokens,
    temperature,
    model: model.includes('/') ? model : getDefaultOpenRouterVisionModel(),
    includeDiagnostics,
    providerSort,
    reasoningEffort,
  })
);

export const createImageEdit = async ({
  prompt,
  images,
  model = getDefaultOpenRouterImageModel(),
  quality = 'medium',
  size = '1024x1024',
  outputFormat = 'webp',
  outputCompression = 82,
}: ImageEditOptions) => {
  if (!prompt.trim()) throw new Error('OpenRouter image prompt is required.');
  const references = (images || [])
    .map((image) => toText(image?.image_url))
    .filter(Boolean)
    .map((url) => ({ type: 'image_url', image_url: { url } }));
  if (!references.length) throw new Error('At least one source image is required for image editing.');

  const response = await fetch(OPENROUTER_IMAGE_URL, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model,
      prompt,
      input_references: references,
      quality,
      size,
      output_format: outputFormat,
      output_compression: Math.max(0, Math.min(100, outputCompression)),
      n: 1,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(extractErrorMessage(payload)) as Error & { status?: number; provider?: string };
    error.status = response.status;
    error.provider = 'openrouter';
    throw error;
  }

  const image = Array.isArray(payload?.data) ? payload.data[0] : null;
  const base64 = toText(image?.b64_json);
  const imageUrl = toText(image?.url);
  if (base64) {
    const mimeType = toText(image?.media_type) || `image/${outputFormat}`;
    return { imageDataUrl: `data:${mimeType};base64,${base64}`, outputFormat, raw: payload };
  }
  if (imageUrl) return { imageUrl, outputFormat, raw: payload };
  throw new Error('OpenRouter image generation returned no usable image output.');
};
