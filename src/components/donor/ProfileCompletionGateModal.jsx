import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GradientActionButton } from '../ui/GradientActionButton';
import { useAuth } from '../../providers/AuthProvider';
import { resolveThemeRoles, theme } from '../../design-system/theme';

const withOpacity = (color, opacity) => {
  const normalized = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    const red = parseInt(normalized.slice(1, 3), 16);
    const green = parseInt(normalized.slice(3, 5), 16);
    const blue = parseInt(normalized.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
  }
  return normalized || `rgba(112, 15, 36, ${opacity})`;
};

export function ProfileCompletionGateModal({ visible, completionMeta, onClose, onComplete }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const bodyFont = resolvedTheme?.fontFamily || theme.typography.fontFamily;
  const headingFont = resolvedTheme?.secondaryFontFamily || theme.typography.fontFamilyDisplay;
  const missingFields = completionMeta?.missingFieldLabels || [];
  const visibleFields = missingFields.slice(0, 4);
  const remainingCount = Math.max(0, missingFields.length - visibleFields.length);
  const percentage = Math.max(0, Math.min(100, Number(completionMeta?.percentage) || 0));

  return (
    <Modal transparent statusBarTranslucent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.card, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
          <LinearGradient
            colors={['#4d0712', '#781228', '#a52f52']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View pointerEvents="none" style={styles.heroGlow} />
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons name="account-heart-outline" size={27} color="#FFFFFF" />
            </View>
            <Text style={[styles.eyebrow, { fontFamily: bodyFont }]}>PROFILE REQUIRED</Text>
            <Text style={[styles.title, { fontFamily: headingFont }]}>Complete your profile first</Text>
            <Text style={[styles.subtitle, { fontFamily: bodyFont }]}>
              Complete your account before attending or participating in a donation event.
            </Text>
          </LinearGradient>

          <View style={styles.body}>
            <View style={styles.progressHeader}>
              <View>
                <Text style={[styles.progressTitle, { color: roles.headingText, fontFamily: bodyFont }]}>Your progress</Text>
                <Text style={[styles.progressMeta, { color: roles.metaText, fontFamily: bodyFont }]}>
                  {missingFields.length} field{missingFields.length !== 1 ? 's' : ''} remaining
                </Text>
              </View>
              <View style={[styles.percentPill, { backgroundColor: roles.iconPrimarySurface }]}>
                <Text style={[styles.percentText, { color: roles.primaryActionBackground, fontFamily: bodyFont }]}>{percentage}%</Text>
              </View>
            </View>

            <View style={[styles.progressTrack, { backgroundColor: withOpacity(roles.primaryActionBackground, 0.1) }]}>
              <LinearGradient
                colors={['#8a111d', '#b84063']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.progressFill, { width: `${percentage}%` }]}
              />
            </View>

            <View style={[styles.missingCard, { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder }]}>
              <Text style={[styles.missingLabel, { color: roles.metaText, fontFamily: bodyFont }]}>COMPLETE THESE DETAILS</Text>
              <View style={styles.fieldList}>
                {visibleFields.map((label) => (
                  <View key={label} style={[styles.fieldChip, { backgroundColor: roles.iconPrimarySurface }]}>
                    <MaterialCommunityIcons name="plus-circle-outline" size={14} color={roles.primaryActionBackground} />
                    <Text numberOfLines={1} style={[styles.fieldText, { color: roles.bodyText, fontFamily: bodyFont }]}>{label}</Text>
                  </View>
                ))}
                {remainingCount > 0 ? (
                  <View style={[styles.fieldChip, { backgroundColor: roles.iconPrimarySurface }]}>
                    <Text style={[styles.moreText, { color: roles.primaryActionBackground, fontFamily: bodyFont }]}>+{remainingCount} more</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.actions}>
              <GradientActionButton
                title="Complete profile"
                onPress={onComplete}
                size="md"
                textColor="#FFFFFF"
                leading={<MaterialCommunityIcons name="account-edit-outline" size={19} color="#FFFFFF" />}
                trailing={<MaterialCommunityIcons name="arrow-right" size={19} color="#FFFFFF" />}
                style={styles.primaryAction}
                buttonStyle={styles.primaryButton}
              />
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.laterAction, pressed ? styles.pressed : null]}
              >
                <LinearGradient
                  colors={[roles.defaultCardBackground, roles.iconPrimarySurface]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.laterGradient, { borderColor: withOpacity(roles.primaryActionBackground, 0.18) }]}
                >
                  <View style={[styles.laterIcon, { backgroundColor: withOpacity(roles.primaryActionBackground, 0.1) }]}>
                    <MaterialCommunityIcons name="clock-outline" size={18} color={roles.primaryActionBackground} />
                  </View>
                  <Text numberOfLines={1} style={[styles.laterText, { color: roles.primaryActionBackground, fontFamily: bodyFont }]}>I’ll do this later</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={roles.primaryActionBackground} />
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
    backgroundColor: 'rgba(24, 11, 15, 0.68)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#2C0710',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 14,
  },
  hero: {
    minHeight: 202,
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    top: -105,
    right: -52,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  eyebrow: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.3,
    marginBottom: 4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 23,
    lineHeight: 29,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  subtitle: {
    maxWidth: 305,
    marginTop: theme.spacing.sm,
    color: 'rgba(255, 255, 255, 0.84)',
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 19,
    textAlign: 'center',
  },
  body: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTitle: {
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  progressMeta: {
    marginTop: 2,
    fontSize: theme.typography.compact.caption,
  },
  percentPill: {
    minWidth: 54,
    minHeight: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentText: {
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  progressTrack: {
    height: 7,
    marginTop: theme.spacing.md,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    minWidth: 7,
    borderRadius: theme.radius.full,
  },
  missingCard: {
    marginTop: theme.spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    padding: theme.spacing.md,
  },
  missingLabel: {
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.1,
    marginBottom: theme.spacing.sm,
  },
  fieldList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  fieldChip: {
    minHeight: 30,
    maxWidth: '100%',
    borderRadius: 15,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  fieldText: {
    flexShrink: 1,
    fontSize: theme.typography.compact.caption,
  },
  moreText: {
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  actions: {
    width: '100%',
    marginTop: theme.spacing.lg,
    gap: 12,
  },
  primaryAction: {
    width: '100%',
    marginTop: 0,
    borderRadius: 18,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
  },
  laterAction: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: 16,
    overflow: 'hidden',
    flexShrink: 0,
  },
  laterGradient: {
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  laterIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  laterText: {
    flex: 1,
    flexShrink: 1,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    textAlign: 'left',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
});
