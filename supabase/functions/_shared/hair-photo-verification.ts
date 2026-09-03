type VerificationImage = {
  dataUrl?: string;
  viewKey?: string;
  viewLabel?: string;
};

type VerificationPayload = {
  version: 1;
  imageDigest: string;
  issuedAt: number;
  expiresAt: number;
};

const encoder = new TextEncoder();
const TOKEN_TTL_MS = 60 * 60 * 1000;

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const getSigningSecret = () => (
  (Deno.env.get('HAIR_PHOTO_VERIFICATION_SECRET') || '').trim()
  || (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()
);

const buildImageMaterial = (images: VerificationImage[] = []) => images
  .map((image, index) => [
    String(index),
    String(image?.viewKey || '').trim(),
    String(image?.viewLabel || '').trim(),
    String(image?.dataUrl || '').trim(),
  ].join('\n'))
  .join('\n---\n');

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
};

const importSigningKey = async (secret: string) => crypto.subtle.importKey(
  'raw',
  encoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify'],
);

export const createHairPhotoVerificationToken = async (
  images: VerificationImage[] = [],
): Promise<string> => {
  const secret = getSigningSecret();
  if (!secret) throw new Error('Hair photo verification signing is not configured.');

  const issuedAt = Date.now();
  const payload: VerificationPayload = {
    version: 1,
    imageDigest: await sha256(buildImageMaterial(images)),
    issuedAt,
    expiresAt: issuedAt + TOKEN_TTL_MS,
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingKey = await importSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(encodedPayload));

  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
};

export const verifyHairPhotoVerificationToken = async ({
  token,
  images = [],
}: {
  token?: string;
  images?: VerificationImage[];
}) => {
  const secret = getSigningSecret();
  const [encodedPayload, encodedSignature, ...extraParts] = String(token || '').split('.');
  if (!secret || !encodedPayload || !encodedSignature || extraParts.length) return false;

  try {
    const signingKey = await importSigningKey(secret);
    const signatureValid = await crypto.subtle.verify(
      'HMAC',
      signingKey,
      base64UrlToBytes(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!signatureValid) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload)),
    ) as Partial<VerificationPayload>;
    const now = Date.now();
    if (
      payload.version !== 1
      || !Number.isFinite(payload.issuedAt)
      || !Number.isFinite(payload.expiresAt)
      || Number(payload.issuedAt) > now + 60_000
      || Number(payload.expiresAt) <= now
    ) {
      return false;
    }

    const currentDigest = await sha256(buildImageMaterial(images));
    return payload.imageDigest === currentDigest;
  } catch {
    return false;
  }
};
