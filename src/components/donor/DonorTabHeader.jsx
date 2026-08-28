import React from 'react';
import { useRouter } from 'expo-router';
import { DashboardHeaderSurface } from '../layout/DashboardHeaderSurface';
import { DonorTopBar } from './DonorTopBar';
import { useAuth } from '../../providers/AuthProvider';

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export function DonorTabHeader({
  unreadCount = 0,
  showRefreshAction = false,
  onRefreshPress,
  isRefreshing = false,
}) {
  const router = useRouter();
  const { profile } = useAuth();
  const firstName = String(profile?.first_name || '').trim();
  const lastName = String(profile?.last_name || '').trim();
  const avatarInitials = [firstName?.[0], lastName?.[0]]
    .filter(Boolean)
    .join('')
    .toUpperCase();
  const avatarUri = profile?.avatar_url || profile?.photo_path || '';
  const greeting = React.useMemo(getGreeting, []);

  return (
    <DashboardHeaderSurface>
      <DonorTopBar
        title={greeting}
        subtitle={`${firstName || 'Donor'} | Hair Donor`}
        avatarInitials={avatarInitials}
        avatarUri={avatarUri}
        unreadCount={unreadCount}
        showRefreshAction={showRefreshAction}
        onRefreshPress={onRefreshPress}
        isRefreshing={isRefreshing}
        onNotificationsPress={() => router.navigate('/donor/notifications')}
        onProfilePress={() => router.navigate('/profile')}
      />
    </DashboardHeaderSurface>
  );
}
