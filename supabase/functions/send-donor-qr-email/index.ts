import { createClient } from 'npm:@supabase/supabase-js@2';
import QRCode from 'npm:qrcode@1.5.4';
import { createJsonResponse, handleCorsPreflight } from '../_shared/cors.ts';

type QrItem = {
  title?: string;
  subtitle?: string;
  qrPayload?: string;
  reference?: string;
  details?: Array<{ label?: string; value?: string | number | null }>;
};

type PreparedQrItem = QrItem & {
  qrDataUrl: string;
  attachmentName: string;
};

const RESEND_EMAIL_URL = 'https://api.resend.com/emails';

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
};

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const isEmailAddress = (value = '') => (
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
);

const normalizeQrItems = (value: unknown): QrItem[] => (
  (Array.isArray(value) ? value : [value])
    .map((item) => (typeof item === 'object' && item ? item as QrItem : null))
    .filter((item): item is QrItem => Boolean(String(item?.qrPayload || '').trim()))
    .slice(0, 12)
);

const sanitizeAttachmentName = (value = 'donivra-qr') => (
  String(value || 'donivra-qr')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  || 'donivra-qr'
);

const prepareQrItems = async (qrItems: QrItem[]): Promise<PreparedQrItem[]> => {
  const preparedItems: PreparedQrItem[] = [];

  for (const [index, item] of qrItems.entries()) {
    const payload = String(item.qrPayload || '').trim();
    if (!payload) continue;

    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
    });
    const attachmentName = `${sanitizeAttachmentName(item.reference || item.title || `donivra-qr-${index + 1}`)}.png`;
    preparedItems.push({
      ...item,
      qrPayload: payload,
      qrDataUrl,
      attachmentName,
    });
  }

  return preparedItems;
};

const buildDetailsHtml = (details: QrItem['details'] = []) => {
  const rows = (details || [])
    .filter((item) => item?.label && item?.value !== undefined && item?.value !== null && String(item.value).trim())
    .map((item) => `
      <tr>
        <td style="padding: 4px 10px 4px 0; color: #6b7280;">${escapeHtml(item.label || '')}</td>
        <td style="padding: 4px 0; color: #111827; font-weight: 600;">${escapeHtml(String(item.value || ''))}</td>
      </tr>
    `)
    .join('');

  return rows ? `<table style="margin: 12px auto 0; font-size: 13px;">${rows}</table>` : '';
};

const buildEmailHtml = ({
  donorName,
  qrItems,
}: {
  donorName: string;
  qrItems: PreparedQrItem[];
}) => `
  <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
    <h2 style="margin: 0 0 8px;">Your Donivra donation QR is ready</h2>
    <p style="margin: 0 0 16px;">${escapeHtml(donorName || 'Donor')}, keep this QR available for donation logistics and staff scanning.</p>
    ${qrItems.map((item, index) => {
      return `
        <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px; margin: 16px 0; text-align: center;">
          <h3 style="margin: 0 0 4px;">${escapeHtml(item.title || `Donation QR ${index + 1}`)}</h3>
          ${item.subtitle ? `<p style="margin: 0 0 12px; color: #6b7280;">${escapeHtml(item.subtitle)}</p>` : ''}
          <img src="${escapeHtml(item.qrDataUrl)}" alt="Donation QR" width="260" height="260" style="display: block; margin: 12px auto; max-width: 100%; height: auto;" />
          ${item.reference ? `<p style="margin: 8px 0 0; font-size: 13px;">Reference: <strong>${escapeHtml(item.reference)}</strong></p>` : ''}
          <p style="margin: 8px 0 0; color: #6b7280; font-size: 12px;">QR image is also attached as ${escapeHtml(item.attachmentName)}.</p>
          ${buildDetailsHtml(item.details)}
        </div>
      `;
    }).join('')}
    <p style="margin: 18px 0 0;">Open Donivra to view the latest donation status and instructions.</p>
    <p style="margin: 18px 0 0; color: #6b7280; font-size: 12px;">This email was sent to the address registered on your Donivra account.</p>
  </div>
`;

const buildEmailText = ({ donorName, qrItems }: { donorName: string; qrItems: PreparedQrItem[] }) => [
  'Your Donivra donation QR is ready',
  '',
  `${donorName || 'Donor'}, keep this QR available for donation logistics and staff scanning.`,
  '',
  ...qrItems.flatMap((item, index) => [
    item.title || `Donation QR ${index + 1}`,
    item.reference ? `Reference: ${item.reference}` : '',
    `Attached file: ${item.attachmentName}`,
    '',
  ]),
  'Open Donivra to view the latest donation status and instructions.',
].filter(Boolean).join('\n');

Deno.serve(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) {
    return preflightResponse;
  }

  if (request.method !== 'POST') {
    return createJsonResponse({ message: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
  const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') || '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return createJsonResponse({ message: 'Supabase server configuration is missing.' }, 500);
  }

  const bearerToken = getBearerToken(request);
  if (!bearerToken) {
    return createJsonResponse({ message: 'Authorization is required.' }, 401);
  }

  const payload = await request.json().catch(() => ({}));
  const qrItems = await prepareQrItems(normalizeQrItems(payload?.qrItems || payload?.qrItem));
  if (!qrItems.length) {
    return createJsonResponse({ sent: false, skipped: true, reason: 'no_qr_items' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const authUserResult = await supabase.auth.getUser(bearerToken);
  const authUserId = authUserResult.data?.user?.id || '';
  if (!authUserId || authUserResult.error) {
    return createJsonResponse({ message: 'A valid authenticated session is required.' }, 401);
  }

  const systemUserResult = await supabase
    .from('users')
    .select('user_id, email, role')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (systemUserResult.error || !systemUserResult.data?.user_id) {
    return createJsonResponse({ message: 'The authenticated donor account could not be resolved.' }, 403);
  }

  if (String(systemUserResult.data.role || '').trim().toLowerCase() !== 'donor') {
    return createJsonResponse({ message: 'Only donor accounts can receive donation QR emails.' }, 403);
  }

  const recipientEmail = String(systemUserResult.data.email || '').trim().toLowerCase();
  if (!isEmailAddress(recipientEmail)) {
    return createJsonResponse({ sent: false, skipped: true, reason: 'no_account_email' });
  }

  if (!resendApiKey || !resendFromEmail) {
    return createJsonResponse({ sent: false, skipped: true, reason: 'resend_not_configured' });
  }

  const donorName = String(payload?.donorName || '').trim();
  const resendResponse = await fetch(RESEND_EMAIL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFromEmail,
      to: [recipientEmail],
      subject: qrItems.length > 1 ? 'Donivra: your donation QR labels are ready' : 'Donivra: your donation QR is ready',
      html: buildEmailHtml({ donorName, qrItems }),
      text: buildEmailText({ donorName, qrItems }),
      attachments: qrItems.map((item) => ({
        filename: item.attachmentName,
        content: item.qrDataUrl.split(',')[1] || '',
        content_type: 'image/png',
      })),
    }),
  });

  const responseBody = await resendResponse.clone().json().catch(async () => ({
    message: await resendResponse.text().catch(() => 'Email request failed.'),
  }));

  if (!resendResponse.ok) {
    return createJsonResponse({
      sent: false,
      failed: true,
      status: resendResponse.status,
      response: responseBody,
    }, 502);
  }

  return createJsonResponse({
    sent: true,
    recipient: recipientEmail,
    response: responseBody,
  });
});
