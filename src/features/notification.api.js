import { supabase } from '../api/supabase/client';

const NOTIFICATION_TABLE = 'Notification';

const notificationSelect = `
  notification_id:Notification_ID,
  user_id:User_ID,
  type:Type,
  title:Title,
  message:Message,
  status:Status,
  reference_type:Reference_Type,
  reference_id:Reference_ID,
  push_status:Push_Status,
  push_sent_at:Push_Sent_At,
  push_response:Push_Response,
  email_status:Email_Status,
  email_sent_at:Email_Sent_At,
  email_response:Email_Response,
  updated_at:Updated_At
`;

const toNotificationInsertRow = (row = {}) => ({
  User_ID: row.user_id,
  Type: row.type,
  Title: row.title,
  Message: row.message,
  Status: row.status || 'Unread',
  Reference_Type: row.reference_type || null,
  Reference_ID: row.reference_id ? String(row.reference_id) : null,
  Updated_At: row.updated_at || new Date().toISOString(),
});

const pushTokenSelect = `
  push_token_id:Push_Token_ID,
  user_id:User_ID,
  expo_push_token:Expo_Push_Token,
  device_id:Device_ID,
  platform:Platform,
  role:Role,
  is_active:Is_Active,
  last_registered_at:Last_Registered_At,
  created_at:Created_At,
  updated_at:Updated_At
`;

export const fetchNotificationsByUserId = async (userId) => (
  await supabase
    .from(NOTIFICATION_TABLE)
    .select(notificationSelect)
    .eq('User_ID', userId)
    .order('Updated_At', { ascending: false })
    .limit(60)
);

export const createNotifications = async (rows) => (
  await supabase
    .from(NOTIFICATION_TABLE)
    .insert((rows || []).map(toNotificationInsertRow))
    .select(notificationSelect)
);

export const markNotificationsRead = async (ids) => (
  await supabase
    .from(NOTIFICATION_TABLE)
    .update({
      Status: 'Read',
      Updated_At: new Date().toISOString(),
    })
    .in('Notification_ID', ids)
    .select(notificationSelect)
);

export const markAllNotificationsRead = async (userId) => (
  await supabase
    .from(NOTIFICATION_TABLE)
    .update({
      Status: 'Read',
      Updated_At: new Date().toISOString(),
    })
    .eq('User_ID', userId)
    .select(notificationSelect)
);

export const upsertPushNotificationToken = async ({
  userId,
  expoPushToken,
  deviceId,
  platform,
  role,
}) => (
  await supabase
    .from('Push_Notification_Tokens')
    .upsert({
      User_ID: userId,
      Expo_Push_Token: expoPushToken,
      Device_ID: deviceId || null,
      Platform: platform || null,
      Role: role || null,
      Is_Active: true,
      Last_Registered_At: new Date().toISOString(),
      Updated_At: new Date().toISOString(),
    }, {
      onConflict: 'User_ID,Expo_Push_Token',
    })
    .select(pushTokenSelect)
    .maybeSingle()
);

export const deactivatePushNotificationToken = async ({ userId, expoPushToken }) => (
  await supabase
    .from('Push_Notification_Tokens')
    .update({
      Is_Active: false,
      Updated_At: new Date().toISOString(),
    })
    .eq('User_ID', userId)
    .eq('Expo_Push_Token', expoPushToken)
    .select(pushTokenSelect)
);
