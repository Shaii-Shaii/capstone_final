import React from 'react';
import { useRouter } from 'expo-router';
import { DashboardHeaderSurface } from '../layout/DashboardHeaderSurface';
import { DonorTopBar } from './DonorTopBar';
import { useAuth } from '../../providers/AuthProvider';
import { useLanguage } from '../../providers/LanguageProvider';

const getGreetingKey = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'header.goodMorning';
  if (hour < 18) return 'header.goodAfternoon';
  return 'header.goodEvening';
};

export function DonorTabHeader({
  unreadCount = 0,
}) {
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useLanguage();
  const firstName = String(profile?.first_name || '').trim();
  const lastName = String(profile?.last_name || '').trim();
  const avatarInitials = [firstName?.[0], lastName?.[0]]
    .filter(Boolean)
    .join('')
    .toUpperCase();
  const avatarUri = profile?.avatar_url || profile?.photo_path || '';
  const greetingKey = React.useMemo(getGreetingKey, []);

  return (
    <DashboardHeaderSurface>
      <DonorTopBar
        title={t(greetingKey)}
        subtitle={`${firstName || 'Donor'} | ${t('header.hairDonor')}`}
        avatarInitials={avatarInitials}
        avatarUri={avatarUri}
        unreadCount={unreadCount}
        onNotificationsPress={() => router.navigate('/donor/notifications')}
        onProfilePress={() => router.navigate('/profile')}
      />
    </DashboardHeaderSurface>
  );
}
