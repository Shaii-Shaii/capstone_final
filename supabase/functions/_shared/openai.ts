const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_IMAGE_EDITS_URL = 'https://api.openai.com/v1/images/edits';

type OpenAiInputMessage = {
  role: 'system' | 'user' | 'assistant';
  content: Record<string, unknown>[];
};

type StructuredResponseOptions = {
  input: OpenAiInputMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  instructions?: string;
  maxOutputTokens?: number;
  model?: string;
  includeDiagnostics?: boolean;
};

type OpenAiDiagnostics = {
  provider: 'openai';
  provider_request_attempted: boolean;
  provider_response_status: number | null;
  provider_parse_success: boolean;
  provider_model: string;
  provider_error_type?: string;
};

type ImageEditReference = {
  image_url?: string;
  file_id?: string;
};

type ImageEditOptions = {
  prompt: string;
  images: ImageEditReference[];
  model?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  inputFidelity?: 'low' | 'high';
  outputCompression?: number;
};

const extractErrorMessage = (payload: any) => (
  payload?.error?.message
  || payload?.message
  || 'OpenAI request failed.'
);

const extractOutputText = (payload: any) => {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const contentItems = Array.isArray(payload?.output)
    ? payload.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    : [];

  const textItem = contentItems.find((item: any) => typeof item?.text === 'string' && item.text.trim());
  return textItem?.text?.trim() || '';
};

const getExtensionFromMimeType = (mimeType = 'image/png') => {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
};

const dataUrlToBlob = (dataUrl: string) => {
  const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl || '');
  if (!match?.[2]) {
    throw new Error('Invalid image data URL.');
  }

  const mimeType = match[1] || 'image/png';
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
  };
};

const loadImageEditBlob = async (image: ImageEditReference, index: number) => {
  const imageUrl = String(image?.image_url || '').trim();

  if (!imageUrl) {
    throw new Error('Image edit references must include image_url values.');
  }

  if (imageUrl.startsWith('data:')) {
    const { blob, mimeType } = dataUrlToBlob(imageUrl);
    return {
      blob,
      fileName: `image-${index + 1}.${getExtensionFromMimeType(mimeType)}`,
    };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Unable to load image reference ${index + 1}.`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  return {
    blob: new Blob([await response.arrayBuffer()], { type: contentType }),
    fileName: `image-${index + 1}.${getExtensionFromMimeType(contentType)}`,
  };
};

export const readOpenAiKey = () => {
  const openAiKey = (Deno.env.get('OPENAI_API_KEY') || '').trim();

  if (!openAiKey) {
    throw new Error('OpenAI API key is not configured in Edge Function Secrets.');
  }

  return openAiKey;
};

export const getDefaultOpenAiModel = () => (
  Deno.env.get('OPENAI_MODEL')
  || 'gpt-4o-mini'
);

export const getDefaultOpenAiImageModel = () => (
  Deno.env.get('OPENAI_IMAGE_MODEL')
  || 'gpt-image-1.5'
);

export const createStructuredResponse = async ({
  input,
  schemaName,
  schema,
  instructions,
  maxOutputTokens = 1200,
  model = getDefaultOpenAiModel(),
  includeDiagnostics = false,
}: StructuredResponseOptions) => {
  const diagnostics: OpenAiDiagnostics = {
    provider: 'openai',
    provider_request_attempted: false,
    provider_response_status: null,
    provider_parse_success: false,
    provider_model: model,
  };

  console.info('[openai] preparing structured response request', {
    schemaName,
    model,
    hasInstructions: Boolean(instructions),
    inputMessageCount: Array.isArray(input) ? input.length : 0,
    hasOpenAiKey: Boolean(Deno.env.get('OPENAI_API_KEY')),
  });

  const openAiKey = readOpenAiKey();
  const requestBody = {
    model,
    input: instructions
      ? [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: instructions,
              },
            ],
          },
          ...input,
        ]
      : input,
    max_output_tokens: maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName,
        strict: true,
        schema,
      },
    },
  };

  diagnostics.provider_request_attempted = true;
  console.info('[openai] request started', {
    schemaName,
    model,
  });

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => ({}));
  diagnostics.provider_response_status = response.status;

  console.info('[openai] response received', {
    schemaName,
    ok: response.ok,
    status: response.status,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
  });

  if (!response.ok) {
    const errorMessage = extractErrorMessage(payload);
    diagnostics.provider_error_type = response.status === 429 ? 'rate_limited' : 'provider_error';
    const error = new Error(errorMessage) as Error & { diagnostics?: OpenAiDiagnostics };
    error.diagnostics = diagnostics;
    throw error;
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    const error = new Error('OpenAI returned an empty response.') as Error & { diagnostics?: OpenAiDiagnostics };
    error.diagnostics = diagnostics;
    throw error;
  }

  try {
    const parsed = JSON.parse(outputText);
    diagnostics.provider_parse_success = true;
    console.info('[openai] parsed structured response', {
      schemaName,
      model,
      topLevelKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
    });
    return includeDiagnostics ? { parsed, diagnostics } : parsed;
  } catch {
    const error = new Error('OpenAI returned invalid JSON.') as Error & { diagnostics?: OpenAiDiagnostics };
    error.diagnostics = diagnostics;
    throw error;
  }
};

export const createImageEdit = async ({
  prompt,
  images,
  model = getDefaultOpenAiImageModel(),
  quality = 'medium',
  size = '1024x1024',
  outputFormat = 'png',
  inputFidelity = 'high',
  outputCompression = 85,
}: ImageEditOptions) => {
  if (!prompt?.trim()) {
    throw new Error('OpenAI image prompt is required.');
  }

  const validImages = Array.isArray(images)
    ? images.filter((image) => image?.image_url || image?.file_id)
    : [];

  if (!validImages.length) {
    throw new Error('At least one source image is required for image editing.');
  }

  console.info('[openai] preparing image edit request', {
    model,
    imageCount: validImages.length,
    hasPrompt: Boolean(prompt.trim()),
    quality,
    size,
    outputFormat,
    inputFidelity,
    outputCompression,
    hasOpenAiKey: Boolean(Deno.env.get('OPENAI_API_KEY')),
  });

  const openAiKey = readOpenAiKey();
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('quality', quality);
  formData.append('size', size);
  formData.append('output_format', outputFormat);
  formData.append('input_fidelity', inputFidelity);
  if (outputFormat !== 'png') {
    formData.append('output_compression', String(Math.max(0, Math.min(100, outputCompression))));
  }
  formData.append('n', '1');

  const imageBlobs = await Promise.all(validImages.map(loadImageEditBlob));
  imageBlobs.forEach(({ blob, fileName }) => {
    formData.append('image[]', blob, fileName);
  });

  const response = await fetch(OPENAI_IMAGE_EDITS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`,
    },
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));

  console.info('[openai] image edit response received', {
    ok: response.ok,
    status: response.status,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
    dataLength: Array.isArray(payload?.data) ? payload.data.length : 0,
  });

  if (!response.ok) {
    const error = new Error(extractErrorMessage(payload)) as Error & { status?: number; provider?: string };
    error.status = response.status;
    error.provider = 'openai';
    throw error;
  }

  const firstImage = Array.isArray(payload?.data) ? payload.data[0] : null;
  const b64Json = typeof firstImage?.b64_json === 'string' ? firstImage.b64_json.trim() : '';
  const imageUrl = typeof firstImage?.url === 'string' ? firstImage.url.trim() : '';

  if (b64Json) {
    return {
      imageDataUrl: `data:image/${outputFormat};base64,${b64Json}`,
      outputFormat,
      raw: payload,
    };
  }

  if (imageUrl) {
    return {
      imageUrl,
      outputFormat,
      raw: payload,
    };
  }

  throw new Error('OpenAI image edit returned no usable image output.');
};
