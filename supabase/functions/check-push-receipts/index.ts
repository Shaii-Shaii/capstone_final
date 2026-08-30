import { createClient } from 'npm:@supabase/supabase-js@2';
import { createJsonResponse, handleCorsPreflight } from '../_shared/cors.ts';

type StoredTicket = {
  notificationId?: number;
  pushTokenId?: number;
  status?: string;
  ticketId?: string | null;
  error?: string | null;
  receiptStatus?: string | null;
  receiptError?: string | null;
};

type NotificationRow = {
  notification_id: number;
  push_status: string | null;
  push_response: {
    accepted_count?: number;
    tickets?: StoredTicket[];
  } | null;
};

const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const MAX_RECEIPT_BATCH_SIZE = 1000;
const RECEIPT_LOOKBACK_HOURS = 24;

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get('Authorization') || '';
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
};

const chunk = <T>(items: T[], size: number) => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
};

Deno.serve(async (request) => {
  const preflightResponse = handleCorsPreflight(request);
  if (preflightResponse) return preflightResponse;
  if (request.method !== 'POST') {
    return createJsonResponse({ message: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return createJsonResponse({ message: 'Supabase server configuration is missing.' }, 500);
  }

  const bearerToken = getBearerToken(request);
  if (!bearerToken) return createJsonResponse({ message: 'Authorization is required.' }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  let callerUserId: number | null = null;

  if (bearerToken !== serviceRoleKey) {
    const authResult = await supabase.auth.getUser(bearerToken);
    const authUserId = authResult.data?.user?.id || '';
    if (!authUserId || authResult.error) {
      return createJsonResponse({ message: 'A valid authenticated session is required.' }, 401);
    }

    const userResult = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (userResult.error || !userResult.data?.user_id) {
      return createJsonResponse({ message: 'The authenticated app user could not be resolved.' }, 403);
    }
    callerUserId = Number(userResult.data.user_id);
  }

  const lookback = new Date(Date.now() - RECEIPT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  let notificationQuery = supabase
    .from('Notification')
    .select('notification_id:Notification_ID, push_status:Push_Status, push_response:Push_Response')
    .in('Push_Status', ['Accepted', 'Partially accepted'])
    .gte('Push_Sent_At', lookback)
    .order('Push_Sent_At', { ascending: true })
    .limit(200);

  if (callerUserId) notificationQuery = notificationQuery.eq('User_ID', callerUserId);
  const notificationResult = await notificationQuery;
  if (notificationResult.error) {
    return createJsonResponse({ message: notificationResult.error.message }, 500);
  }

  const notifications = (notificationResult.data || []) as NotificationRow[];
  const receiptIds = [...new Set(notifications.flatMap((notification) => (
    (notification.push_response?.tickets || [])
      .map((ticket) => String(ticket.ticketId || ''))
      .filter(Boolean)
  )))];

  if (!receiptIds.length) {
    return createJsonResponse({ checked: 0, delivered: 0, failed: 0, pending: 0 });
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (expoAccessToken) headers.Authorization = `Bearer ${expoAccessToken}`;

  const receipts = new Map<string, Record<string, unknown>>();
  for (const batch of chunk(receiptIds, MAX_RECEIPT_BATCH_SIZE)) {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: batch }),
    });
    const body = await response.json().catch(() => ({})) as {
      data?: Record<string, Record<string, unknown>>;
      errors?: unknown[];
    };
    if (!response.ok || body.errors?.length) {
      return createJsonResponse({ message: 'Expo push receipts could not be retrieved.', details: body.errors || [] }, 502);
    }
    Object.entries(body.data || {}).forEach(([id, receipt]) => receipts.set(id, receipt));
  }

  const invalidPushTokenIds = new Set<number>();
  let delivered = 0;
  let failed = 0;
  let pending = 0;

  for (const notification of notifications) {
    const tickets = (notification.push_response?.tickets || []).map((ticket) => {
      if (!ticket.ticketId) return ticket;
      const receipt = receipts.get(ticket.ticketId);
      if (!receipt) {
        pending += 1;
        return ticket;
      }

      const details = receipt.details as Record<string, unknown> | undefined;
      const receiptError = String(details?.error || '');
      const receiptStatus = receipt.status === 'ok' ? 'ok' : 'error';
      if (receiptStatus === 'ok') delivered += 1;
      else failed += 1;

      if (receiptError === 'DeviceNotRegistered' && ticket.pushTokenId) {
        invalidPushTokenIds.add(Number(ticket.pushTokenId));
      }

      return {
        ...ticket,
        receiptStatus,
        receiptError: receiptError || (receipt.message as string | undefined) || null,
      };
    });

    const receiptTickets = tickets.filter((ticket) => ticket.ticketId);
    const completedTickets = receiptTickets.filter((ticket) => ticket.receiptStatus);
    const successfulTickets = completedTickets.filter((ticket) => ticket.receiptStatus === 'ok');
    let pushStatus = notification.push_status || 'Accepted';

    if (receiptTickets.length && completedTickets.length === receiptTickets.length) {
      pushStatus = successfulTickets.length === receiptTickets.length
        ? 'Delivered'
        : successfulTickets.length ? 'Partially delivered' : 'Failed';
    }

    await supabase
      .from('Notification')
      .update({
        Push_Status: pushStatus,
        Push_Response: {
          ...(notification.push_response || {}),
          delivered_count: successfulTickets.length,
          receipts_checked_at: new Date().toISOString(),
          tickets,
        },
      })
      .eq('Notification_ID', notification.notification_id);
  }

  if (invalidPushTokenIds.size) {
    await supabase
      .from('Push_Notification_Tokens')
      .update({ Is_Active: false, Updated_At: new Date().toISOString() })
      .in('Push_Token_ID', [...invalidPushTokenIds]);
  }

  return createJsonResponse({
    checked: receiptIds.length,
    delivered,
    failed,
    pending,
    invalidTokensDeactivated: invalidPushTokenIds.size,
  });
});
