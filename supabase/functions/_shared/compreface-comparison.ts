type FaceComparisonStatus = 'match' | 'mismatch' | 'unclear' | 'unavailable';

export type FaceComparisonResult = {
  status: FaceComparisonStatus;
  similarity: number | null;
  reason: string;
};

const normalizeBase64 = (dataUrl = '') => {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
};

const normalizeBaseUrl = (value = '') => value.trim().replace(/\/+$/, '');

const resolveSimilarityThreshold = () => {
  const configured = Number(Deno.env.get('COMPREFACE_SIMILARITY_THRESHOLD'));
  return Number.isFinite(configured)
    ? Math.max(0, Math.min(1, configured))
    : 0.8;
};

const resolveDetectionThreshold = () => {
  const configured = Number(Deno.env.get('COMPREFACE_DETECTION_THRESHOLD'));
  return Number.isFinite(configured)
    ? Math.max(0, Math.min(1, configured))
    : 0.8;
};

const resolveTimeoutMs = () => {
  const configured = Number(Deno.env.get('COMPREFACE_TIMEOUT_MS'));
  return Number.isFinite(configured)
    ? Math.max(3000, Math.min(30000, configured))
    : 15000;
};

export const isCompreFaceConfigured = () => Boolean(
  normalizeBaseUrl(Deno.env.get('COMPREFACE_URL') || '')
  && String(Deno.env.get('COMPREFACE_API_KEY') || '').trim()
);

export const compareFacesWithCompreFace = async ({
  sourceDataUrl,
  targetDataUrl,
}: {
  sourceDataUrl: string;
  targetDataUrl: string;
}): Promise<FaceComparisonResult> => {
  if (!isCompreFaceConfigured()) {
    return {
      status: 'unavailable',
      similarity: null,
      reason: 'CompreFace is not configured.',
    };
  }

  const baseUrl = normalizeBaseUrl(Deno.env.get('COMPREFACE_URL') || '');
  const apiKey = String(Deno.env.get('COMPREFACE_API_KEY') || '').trim();
  const similarityThreshold = resolveSimilarityThreshold();
  const detectionThreshold = resolveDetectionThreshold();
  const endpoint = new URL(`${baseUrl}/api/v1/verification/verify`);
  endpoint.searchParams.set('limit', '1');
  endpoint.searchParams.set('prediction_count', '1');
  endpoint.searchParams.set('det_prob_threshold', String(detectionThreshold));
  endpoint.searchParams.set('status', 'false');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs());

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        source_image: normalizeBase64(sourceDataUrl),
        target_image: normalizeBase64(targetDataUrl),
      }),
      signal: controller.signal,
    });
    const responseBody = await response.json().catch(() => ({})) as Record<string, unknown>;

    if (!response.ok) {
      const message = String(responseBody.message || responseBody.error || '').toLowerCase();
      if (
        response.status === 400
        || response.status === 422
        || message.includes('face')
      ) {
        return {
          status: 'unclear',
          similarity: null,
          reason: 'A clear face was not available in one of the compared views.',
        };
      }
      throw new Error(`CompreFace request failed with status ${response.status}.`);
    }

    const results = Array.isArray(responseBody.result)
      ? responseBody.result as Array<Record<string, unknown>>
      : [];
    const faceMatches = results.flatMap((result) => (
      Array.isArray(result?.face_matches)
        ? result.face_matches as Array<Record<string, unknown>>
        : []
    ));
    const similarity = faceMatches.reduce((highest, match) => {
      const value = Number(match?.similarity);
      return Number.isFinite(value) ? Math.max(highest, value) : highest;
    }, 0);

    if (!results.length || !faceMatches.length) {
      return {
        status: 'unclear',
        similarity: null,
        reason: 'A clear comparable face was not found in one of the views.',
      };
    }

    return {
      status: similarity >= similarityThreshold ? 'match' : 'mismatch',
      similarity,
      reason: similarity >= similarityThreshold
        ? 'The face-visible views are consistent.'
        : 'The face-visible views could not be matched confidently.',
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('CompreFace request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
