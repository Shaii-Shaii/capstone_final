import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { HairLogDetailModal } from '../../src/components/hair/HairLogDetailModal';
import { DonorTopBar } from '../../src/components/donor/DonorTopBar';
import { fetchHairSubmissionsByUserId } from '../../src/features/hairSubmission.api';
import { useNotifications } from '../../src/hooks/useNotifications';
import { useAuth } from '../../src/providers/AuthProvider';
import { resolveThemeRoles, theme } from '../../src/design-system/theme';

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function DonorHairCheckDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const screeningId = Array.isArray(params.screeningId) ? params.screeningId[0] : params.screeningId;
  const { user, profile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const { unreadCount } = useNotifications({
    role: 'donor',
    userId: user?.id,
    userEmail: user?.email || '',
    mode: 'badge',
  });
  const [entry, setEntry] = React.useState(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!user?.id || !screeningId) {
        if (mounted) setError('This hair check could not be found.');
        return;
      }

      const result = await fetchHairSubmissionsByUserId(user.id, 30);
      if (!mounted) return;

      const submissions = Array.isArray(result.data) ? result.data : [];
      for (const submission of submissions) {
        const screening = (submission.ai_screenings || []).find(
          (item) => String(item.ai_screening_id || item.id) === String(screeningId)
        );
        if (!screening) continue;

        setEntry({
          screening,
          submission,
          recommendations: submission.donor_recommendations?.length
            ? submission.donor_recommendations
            : screening.recommendations || screening.analysis_result?.recommendations || [],
          images: (submission.submission_details || []).flatMap((detail) => detail.images || []),
        });
        return;
      }

      setError(result.error?.message || 'This hair check could not be found.');
    };

    load();
    return () => {
      mounted = false;
    };
  }, [screeningId, user?.id]);

  if (entry) {
    return (
      <SafeAreaView style={[styles.page, { backgroundColor: roles.pageBackground }]}>
        <View style={[styles.header, { backgroundColor: resolvedTheme?.primaryColor || roles.primaryActionBackground }]}>
          <DonorTopBar
            title={profile?.first_name || 'Donor'}
            subtitle="Hair Donor"
            unreadCount={unreadCount}
            onNotificationsPress={() => router.navigate('/donor/notifications')}
            onProfilePress={() => router.navigate('/profile')}
          />
        </View>
        <HairLogDetailModal
          visible
          pageMode
          dateKey={toDateKey(entry.screening?.created_at)}
          entries={[entry]}
          onClose={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.state, { backgroundColor: roles.pageBackground }]}>
      {error ? (
        <Text style={[styles.message, { color: roles.bodyText }]}>{error}</Text>
      ) : (
        <ActivityIndicator color={roles.primaryActionBackground} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  header: {
    paddingVertical: theme.spacing.xs,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  message: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: 'center',
  },
});
