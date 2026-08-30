import { createClient } from 'npm:@supabase/supabase-js@2';
import { createJsonResponse, handleCorsPreflight } from '../_shared/cors.ts';

type NotificationRow = {
  notification_id: number;
  user_id: number;
  type: string | null;
  title: string | null;
  message: string | null;
  reference_type: string | null;
  reference_id: string | null;
  email_status: string | null;
};

type PushTokenRow = {
  push_token_id: number;
  user_id: number;
  expo_push_token: string;
};

type PushDelivery = {
  notificationId: number;
  pushTokenId: number;
  token: string;
  message: Record<string, unknown>;
};

type UserRow = {
  user_id: number;
  email: string | null;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RESEND_EMAIL_URL = 'https://api.resend.com/emails';
const MAX_EXPO_BATCH_SIZE = 100;
const MAX_EXPO_ATTEMPTS = 3;
const VIEW_DETAILS_CATEGORY_ID = 'donivra_view_details';
const MAX_PUSH_BODY_LENGTH = 110;

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
};

const toNumberArray = (value: unknown) => (
  (Array.isArray(value) ? value : [value])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
);

const getNotificationIds = (payload: Record<string, unknown>) => {
  const directIds = toNumberArray(payload.notificationIds);
  if (directIds.length) return directIds;

  const record = payload.record as Record<string, unknown> | undefined;
  return toNumberArray(record?.Notification_ID || record?.notification_id);
};

const isExpoPushToken = (value = '') => (
  /^Expo(nent)?PushToken\[[\w-]+\]$/.test(value)
);

const getRouteForNotification = (notification: NotificationRow) => {
  if (notification.reference_type === 'route' && notification.reference_id?.startsWith('/')) {
    return notification.reference_id;
  }

  if (notification.reference_type === 'donation_drive' && notification.reference_id) {
    return `/donor/drives/${notification.reference_id}`;
  }

  if (notification.reference_type === 'ai_screening' && notification.reference_id) {
    return `/donor/hair-check-details?screeningId=${encodeURIComponent(notification.reference_id)}`;
  }

  switch (notification.type) {
    case 'hair_analysis_reminder':
      return '/donor/donations';
    case 'donation_drive_update':
    case 'donation_drive_rsvp_reminder':
      return notification.reference_id ? `/donor/drives/${notification.reference_id}` : '/donor/home';
    case 'wig_allocation_updated':
    case 'wig_request_updated':
      return '/patient/requests';
    case 'submission_received':
    case 'ai_screening_completed':
    case 'recommendation_available':
    case 'logistics_update':
    case 'donation_tracking_updated':
      return '/donor/status';
    case 'certificate_available':
      return '/donor/achievements';
    default:
      return null;
  }
};

const truncatePushBody = (value: string) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_PUSH_BODY_LENGTH) return normalized;

  const candidate = normalized.slice(0, MAX_PUSH_BODY_LENGTH - 1);
  const lastSpace = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, lastSpace > 70 ? lastSpace : candidate.length).trimEnd()}…`;
};

const getPushBody = (notification: NotificationRow) => {
  switch (notification.type) {
    case 'ai_screening_completed':
      return 'Your hair analysis is ready. Open Donivra to view the full results.';
    case 'hair_analysis_reminder':
      return "It’s time for today’s quick hair check.";
    case 'recommendation_available':
      return 'New hair-care guidance is ready for you.';
    case 'submission_received':
      return 'Your hair donation was submitted and is being processed.';
    case 'certificate_available':
      return 'Your donation certificate is ready.';
    case 'donation_drive_rsvp_reminder':
      return 'Your event is coming up. Open Donivra for the schedule and location.';
    case 'donation_drive_update':
      return 'An event you joined has an update.';
    case 'wig_request_updated':
      return 'Your wig request has a new update.';
    case 'wig_allocation_updated':
      return 'There is a new update about your wig.';
    default:
      return truncatePushBody(notification.message || 'You have a new Donivra update.');
  }
};

const chunk = <T>(items: T[], size: number) => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
};

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const sendExpoBatch = async (
  batch: PushDelivery[],
  headers: Record<string, string>,
) => {
  let lastResult: { ok: boolean; status: number; body: Record<string, unknown> } | null = null;

  for (let attempt = 0; attempt < MAX_EXPO_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(batch.map((delivery) => delivery.message)),
      });
      const body = await response.clone().json().catch(async () => ({
        errors: [{ message: await response.text().catch(() => 'Expo push request failed.') }],
      })) as Record<string, unknown>;

      lastResult = { ok: response.ok, status: response.status, body };
      const isTransient = response.status === 429 || response.status >= 500;
      if (!isTransient || attempt === MAX_EXPO_ATTEMPTS - 1) return lastResult;
    } catch (error) {
      lastResult = {
        ok: false,
        status: 0,
        body: { errors: [{ message: error instanceof Error ? error.message : 'Expo push request failed.' }] },
      };
      if (attempt === MAX_EXPO_ATTEMPTS - 1) return lastResult;
    }

    await wait(500 * (2 ** attempt));
  }

  return lastResult || {
    ok: false,
    status: 0,
    body: { errors: [{ message: 'Expo push request failed.' }] },
  };
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

const buildEmailHtml = (notification: NotificationRow) => {
  const title = escapeHtml(notification.title || 'Donivra update');
  const message = escapeHtml(notification.message || 'You have a new Donivra notification.');
  const route = getRouteForNotification(notification);

  return `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px;">${title}</h2>
      <p style="margin: 0 0 16px;">${message}</p>
      <p style="margin: 0 0 8px;">Open Donivra to view the full update${route ? ` in ${escapeHtml(route)}` : ''}.</p>
      <p style="margin: 18px 0 0; color: #6b7280; font-size: 12px;">This message was sent to the email address registered on your Donivra account.</p>
    </div>
  `;
};

const buildEmailText = (notification: NotificationRow) => {
  const route = getRouteForNotification(notification);
  return [
    notification.title || 'Donivra update',
    '',
    notification.message || 'You have a new Donivra notification.',
    '',
    `Open Donivra to view the full update${route ? ` in ${route}` : ''}.`,
    '',
    'This message was sent to the email address registered on your Donivra account.',
  ].join('\n');
};

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
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
  const resendFromEmail = Deno.env.get('RESEND_FROM_EMAIL') || '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return createJsonResponse({ message: 'Supabase server configuration is missing.' }, 500);
  }

  const payload = await request.json().catch(() => ({}));
  const notificationIds = [...new Set(getNotificationIds(payload))];
  if (!notificationIds.length) {
    return createJsonResponse({ sent: 0, skipped: true, reason: 'no_notification_ids' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  const bearerToken = getBearerToken(request);
  let callerUserId: number | null = null;

  if (!bearerToken) {
    return createJsonResponse({ message: 'Authorization is required.' }, 401);
  }

  if (bearerToken && bearerToken !== supabaseServiceRoleKey) {
    const authUserResult = await supabase.auth.getUser(bearerToken);
    const authUserId = authUserResult.data?.user?.id || '';

    if (!authUserId || authUserResult.error) {
      return createJsonResponse({ message: 'A valid authenticated session is required.' }, 401);
    }

    const systemUserResult = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (systemUserResult.error || !systemUserResult.data?.user_id) {
      return createJsonResponse({ message: 'The authenticated app user could not be resolved.' }, 403);
    }

    callerUserId = Number(systemUserResult.data.user_id);
  }

  let notificationQuery = supabase
    .from('Notification')
    .select(`
      notification_id:Notification_ID,
      user_id:User_ID,
      type:Type,
      title:Title,
      message:Message,
      reference_type:Reference_Type,
      reference_id:Reference_ID,
      email_status:Email_Status
    `)
    .in('Notification_ID', notificationIds);

  if (callerUserId) {
    notificationQuery = notificationQuery.eq('User_ID', callerUserId);
  }

  const notificationResult = await notificationQuery;
  if (notificationResult.error) {
    return createJsonResponse({ message: notificationResult.error.message || 'Unable to load notifications.' }, 500);
  }

  const notifications = (notificationResult.data || []) as NotificationRow[];
  const userIds = [...new Set(notifications.map((row) => row.user_id).filter(Boolean))];
  if (!notifications.length || !userIds.length) {
    return createJsonResponse({ sent: 0, skipped: true, reason: 'no_authorized_notifications' });
  }

  const [tokenResult, userResult] = await Promise.all([
    supabase
      .from('Push_Notification_Tokens')
      .select('push_token_id:Push_Token_ID, user_id:User_ID, expo_push_token:Expo_Push_Token')
      .in('User_ID', userIds)
      .eq('Is_Active', true),
    supabase
      .from('users')
      .select('user_id, email')
      .in('user_id', userIds),
  ]);

  if (tokenResult.error) {
    return createJsonResponse({ message: tokenResult.error.message || 'Unable to load push tokens.' }, 500);
  }

  if (userResult.error) {
    return createJsonResponse({ message: userResult.error.message || 'Unable to load notification recipients.' }, 500);
  }

  const usersById = new Map<number, UserRow>();
  ((userResult.data || []) as UserRow[]).forEach((row) => {
    usersById.set(Number(row.user_id), row);
  });

  const emailResults = [];
  for (const notification of notifications) {
    if (String(notification.email_status || '').toLowerCase() === 'sent') {
      emailResults.push({
        notificationId: notification.notification_id,
        skipped: true,
        reason: 'already_sent',
      });
      continue;
    }

    const recipientEmail = String(usersById.get(notification.user_id)?.email || '').trim().toLowerCase();
    if (!isEmailAddress(recipientEmail)) {
      await supabase
        .from('Notification')
        .update({
          Email_Status: 'No account email',
          Email_Response: { reason: 'no_account_email' },
        })
        .eq('Notification_ID', notification.notification_id);

      emailResults.push({
        notificationId: notification.notification_id,
        skipped: true,
        reason: 'no_account_email',
      });
      continue;
    }

    if (!resendApiKey || !resendFromEmail) {
      await supabase
        .from('Notification')
        .update({
          Email_Status: 'Not configured',
          Email_Response: { reason: 'resend_not_configured' },
        })
        .eq('Notification_ID', notification.notification_id);

      emailResults.push({
        notificationId: notification.notification_id,
        skipped: true,
        reason: 'resend_not_configured',
      });
      continue;
    }

    const resendResponse = await fetch(RESEND_EMAIL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFromEmail,
        to: [recipientEmail],
        subject: notification.title || 'Donivra update',
        html: buildEmailHtml(notification),
        text: buildEmailText(notification),
      }),
    });

    const resendBody = await resendResponse.clone().json().catch(async () => ({
      message: await resendResponse.text().catch(() => 'Email request failed.'),
    }));

    await supabase
      .from('Notification')
      .update({
        Email_Status: resendResponse.ok ? 'Sent' : 'Failed',
        Email_Sent_At: resendResponse.ok ? new Date().toISOString() : null,
        Email_Response: resendBody,
      })
      .eq('Notification_ID', notification.notification_id);

    emailResults.push({
      notificationId: notification.notification_id,
      sent: resendResponse.ok,
      status: resendResponse.status,
      response: resendBody,
    });
  }

  const tokensByUserId = new Map<number, Array<{ pushTokenId: number; token: string }>>();
  ((tokenResult.data || []) as PushTokenRow[]).forEach((row) => {
    const token = String(row.expo_push_token || '').trim();
    if (!isExpoPushToken(token)) return;
    const tokens = tokensByUserId.get(row.user_id) || [];
    tokens.push({ pushTokenId: row.push_token_id, token });
    tokensByUserId.set(row.user_id, tokens);
  });

  const deliveries: PushDelivery[] = notifications.flatMap((notification) => {
    const route = getRouteForNotification(notification);
    return (tokensByUserId.get(notification.user_id) || []).map(({ pushTokenId, token }) => ({
      notificationId: notification.notification_id,
      pushTokenId,
      token,
      message: {
        to: token,
        sound: 'default',
        priority: 'high',
        channelId: 'donivra-updates',
        categoryId: VIEW_DETAILS_CATEGORY_ID,
        title: notification.title || 'Donivra update',
        body: getPushBody(notification),
        data: {
          notificationId: notification.notification_id,
          type: notification.type || 'system_update',
          url: route,
        },
      },
    }));
  });

  if (!deliveries.length) {
    await supabase
      .from('Notification')
      .update({
        Push_Status: 'No active push token',
        Push_Response: { reason: 'no_active_push_token' },
      })
      .in('Notification_ID', notifications.map((row) => row.notification_id));

    return createJsonResponse({
      pushSent: 0,
      emailSent: emailResults.filter((result) => result.sent).length,
      skipped: true,
      reason: 'no_active_push_token',
      emailResults,
    });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };

  if (expoAccessToken) {
    headers.Authorization = `Bearer ${expoAccessToken}`;
  }

  const expoResponses = [];
  const pushTickets: Array<Record<string, unknown>> = [];
  const invalidTokens = new Set<string>();

  for (const batch of chunk(deliveries, MAX_EXPO_BATCH_SIZE)) {
    const response = await sendExpoBatch(batch, headers);
    expoResponses.push(response);

    const ticketData = Array.isArray(response.body?.data) ? response.body.data : [];
    batch.forEach((delivery, index) => {
      const ticket = ticketData[index] as Record<string, unknown> | undefined;
      const details = ticket?.details as Record<string, unknown> | undefined;
      const ticketError = String(details?.error || '');
      const status = response.ok && ticket?.status === 'ok' ? 'ok' : 'error';

      if (ticketError === 'DeviceNotRegistered') {
        invalidTokens.add(delivery.token);
      }

      pushTickets.push({
        notificationId: delivery.notificationId,
        pushTokenId: delivery.pushTokenId,
        status,
        ticketId: ticket?.id || null,
        error: ticketError || (ticket?.message as string | undefined) || null,
        httpStatus: response.status,
      });
    });
  }

  if (invalidTokens.size) {
    await supabase
      .from('Push_Notification_Tokens')
      .update({
        Is_Active: false,
        Updated_At: new Date().toISOString(),
      })
      .in('Expo_Push_Token', [...invalidTokens]);
  }

  const acceptedCount = pushTickets.filter((ticket) => ticket.status === 'ok').length;
  const hasFailure = pushTickets.some((ticket) => ticket.status !== 'ok');
  const acceptedAt = new Date().toISOString();

  for (const notification of notifications) {
    const tickets = pushTickets.filter((ticket) => ticket.notificationId === notification.notification_id);
    const notificationAcceptedCount = tickets.filter((ticket) => ticket.status === 'ok').length;
    const pushStatus = notificationAcceptedCount === tickets.length
      ? 'Accepted'
      : notificationAcceptedCount > 0 ? 'Partially accepted' : 'Failed';

    await supabase
      .from('Notification')
      .update({
        Push_Status: pushStatus,
        Push_Sent_At: notificationAcceptedCount ? acceptedAt : null,
        Push_Response: {
          accepted_count: notificationAcceptedCount,
          tickets,
        },
      })
      .eq('Notification_ID', notification.notification_id);
  }

  return createJsonResponse({
    pushAccepted: acceptedCount,
    emailSent: emailResults.filter((result) => result.sent).length,
    pushFailed: hasFailure,
    notificationCount: notifications.length,
    invalidTokensDeactivated: invalidTokens.size,
    emailResults,
  });
});
