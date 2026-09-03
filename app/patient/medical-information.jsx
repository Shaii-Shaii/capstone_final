import React, { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DashboardHeaderSurface } from '../../src/components/layout/DashboardHeaderSurface';
import { DashboardLayout } from '../../src/components/layout/DashboardLayout';
import { DonorTopBar } from '../../src/components/donor/DonorTopBar';
import { LegalDocumentPreview } from '../../src/components/legal/LegalDocumentPreview';
import { AppIcon } from '../../src/components/ui/AppIcon';
import { patientDashboardNavItems } from '../../src/constants/dashboard';
import { resolvePatientThemeRoles, theme } from '../../src/design-system/theme';
import { useAuth } from '../../src/providers/AuthProvider';

const getDocumentUri = (value) => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(
    value.publicUrl || value.documentUrl || value.url || value.uri || value.previewUri || ''
  ).trim();
};

const getDocumentFileName = (value, uri) => {
  if (typeof value === 'object' && (value.fileName || value.name)) {
    return String(value.fileName || value.name);
  }
  const pathName = String(uri || '').split('?')[0].split('/').pop();
  return pathName || 'medical-certificate';
};

const isPdfDocument = (value, uri) => (
  String(value?.contentType || value?.mimeType || '').toLowerCase().includes('pdf')
  || /\.pdf(?:$|[?#])/i.test(String(uri || ''))
);

const formatDate = (value) => {
  if (!value) return 'Not provided';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
};

const getVerificationLabel = (status, hasDocument) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (['verified', 'approved', 'prc_verified'].includes(normalized)) return 'Verified medical document';
  if (normalized === 'ocr_passed_prc_pending') return 'OCR passed · PRC review pending';
  if (normalized === 'ocr_passed') return 'OCR verification passed';
  if (normalized === 'ocr_failed') return 'Document needs review';
  return hasDocument ? 'Medical document uploaded' : 'No medical document uploaded';
};

function MedicalDetailRow({ icon, label, value, roles, isLast = false }) {
  return (
    <View
      style={[
        styles.detailRow,
        { borderBottomColor: roles.defaultCardBorder },
        isLast ? styles.detailRowLast : null,
      ]}
    >
      <View style={[styles.detailIcon, { backgroundColor: roles.iconPrimarySurface }]}>
        <AppIcon name={icon} size="md" color={roles.primaryActionBackground} />
      </View>
      <View style={styles.detailCopy}>
        <Text style={[styles.detailLabel, { color: roles.metaText }]}>{label}</Text>
        <Text selectable style={[styles.detailValue, { color: roles.headingText }]}>
          {value || 'Not provided'}
        </Text>
      </View>
    </View>
  );
}

function MedicalImagePreview({ uri, fileName, roles }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasError, setHasError] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Preview medical certificate"
        accessibilityHint="Opens the complete document"
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [
          styles.previewCard,
          {
            backgroundColor: roles.defaultCardBackground,
            borderColor: roles.defaultCardBorder,
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        <View style={[styles.previewViewport, { backgroundColor: roles.supportCardBackground }]}>
          {!hasError ? (
            <Image
              source={{ uri }}
              style={styles.previewImage}
              resizeMode="contain"
              onError={() => setHasError(true)}
            />
          ) : (
            <View style={styles.previewFallback}>
              <View style={[styles.previewFallbackIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <AppIcon name="file-document-outline" size="xl" color={roles.primaryActionBackground} />
              </View>
              <Text style={[styles.previewFallbackTitle, { color: roles.headingText }]}>Preview unavailable</Text>
            </View>
          )}
          <View style={[styles.expandBadge, { backgroundColor: roles.primaryActionBackground }]}>
            <AppIcon name="fullscreen" size="sm" color={roles.primaryActionText} />
            <Text style={[styles.expandBadgeText, { color: roles.primaryActionText }]}>Enlarge</Text>
          </View>
        </View>
        <View style={styles.previewFooter}>
          <View style={[styles.previewFileIcon, { backgroundColor: roles.iconPrimarySurface }]}>
            <AppIcon name="file-document-outline" size="sm" color={roles.primaryActionBackground} />
          </View>
          <View style={styles.previewFooterCopy}>
            <Text style={[styles.previewTitle, { color: roles.headingText }]}>Medical certificate</Text>
            <Text numberOfLines={1} style={[styles.previewMeta, { color: roles.metaText }]}>{fileName}</Text>
          </View>
          <View style={[styles.previewAction, { backgroundColor: roles.iconPrimarySurface }]}>
            <AppIcon name="chevronRight" size="sm" color={roles.primaryActionBackground} />
          </View>
        </View>
      </Pressable>

      <Modal visible={isOpen} animationType="slide" onRequestClose={() => setIsOpen(false)}>
        <SafeAreaView style={[styles.viewerScreen, { backgroundColor: roles.pageBackground }]} edges={['top', 'bottom']}>
          <DashboardHeaderSurface style={styles.viewerHeaderSurface}>
            <View style={styles.viewerHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to medical information"
                onPress={() => setIsOpen(false)}
                style={styles.viewerBackButton}
              >
                <AppIcon name="arrowLeft" size="md" color={roles.primaryActionText} />
              </Pressable>
              <View style={styles.viewerHeaderCopy}>
                <Text numberOfLines={1} style={[styles.viewerTitle, { color: roles.primaryActionText }]}>Medical certificate</Text>
                <Text numberOfLines={1} style={[styles.viewerMeta, { color: roles.primaryActionText }]}>{fileName}</Text>
              </View>
              <View style={styles.viewerHeaderSpacer} />
            </View>
          </DashboardHeaderSurface>
          <View style={styles.viewerBody}>
            <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

export default function PatientMedicalInformationScreen() {
  const router = useRouter();
  const { profile, patientProfile, hospitalProfile, resolvedTheme } = useAuth();
  const roles = resolvePatientThemeRoles(resolvedTheme);
  const primaryTextColor = roles.headingText;
  const documentValue = patientProfile?.medical_document || patientProfile?.medical_document_url || '';
  const documentUri = getDocumentUri(documentValue);
  const fileName = getDocumentFileName(documentValue, documentUri);
  const isPdf = isPdfDocument(documentValue, documentUri);
  const verificationStatus = patientProfile?.medical_document_verification_status || '';
  const verificationLabel = getVerificationLabel(verificationStatus, Boolean(documentUri));
  const verifiedAt = patientProfile?.medical_document_verified_at;
  const patientName = useMemo(() => (
    [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ')
  ), [profile?.first_name, profile?.last_name, profile?.middle_name, profile?.suffix]);

  const hospitalName = hospitalProfile?.hospital_name || patientProfile?.hospital_name || 'Not linked';
  const guardianValue = [patientProfile?.guardian, patientProfile?.guardian_relationship]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · ');
  const doctorValue = [patientProfile?.doctor_name, patientProfile?.doctor_license_number]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' · PRC ');

  const handleNavPress = (item) => {
    if (!item?.route) return;
    router.replace(item.route);
  };

  return (
    <DashboardLayout
      navItems={patientDashboardNavItems}
      navVariant="patient"
      activeNavKey=""
      onNavPress={handleNavPress}
      header={(
        <DashboardHeaderSurface>
          <DonorTopBar
            title="Medical information"
            subtitle="Private patient record"
            showBack
            showNotificationsAction={false}
            onBackPress={() => router.back()}
          />
        </DashboardHeaderSurface>
      )}
    >
      <View style={styles.screenStack}>
        <LinearGradient
          colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.privacyHero}
        >
          <View pointerEvents="none" style={styles.privacyHeroGlow} />
          <View style={styles.privacyHeroIcon}>
            <AppIcon name="shield-lock-outline" size="lg" color="#FFFFFF" />
          </View>
          <View style={styles.privacyHeroCopy}>
            <Text style={styles.privacyEyebrow}>PROTECTED HEALTH INFORMATION</Text>
            <Text style={styles.privacyTitle}>{patientName || 'Patient medical record'}</Text>
            <Text style={styles.privacyText}>Only you and authorized care staff can access these details.</Text>
          </View>
        </LinearGradient>

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={[styles.sectionHeadingIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <AppIcon name="clipboard-pulse-outline" size="sm" color={roles.primaryActionBackground} />
            </View>
            <View style={styles.sectionHeadingCopy}>
              <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>Medical record summary</Text>
              <Text style={[styles.sectionHint, { color: roles.metaText }]}>Information recorded during patient setup.</Text>
            </View>
          </View>

          <View style={[styles.detailsCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <MedicalDetailRow icon="hospital-building" label="Clinic / Hospital" value={hospitalName} roles={roles} />
            <MedicalDetailRow icon="clipboard-pulse-outline" label="Medical condition" value={patientProfile?.medical_condition} roles={roles} />
            <MedicalDetailRow icon="calendar-month-outline" label="Diagnosis date" value={formatDate(patientProfile?.date_of_diagnosis)} roles={roles} />
            <MedicalDetailRow icon="doctor" label="Doctor / PRC license" value={doctorValue} roles={roles} />
            <MedicalDetailRow icon="account-heart-outline" label="Guardian" value={guardianValue} roles={roles} isLast />
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeadingRow}>
            <View style={styles.sectionHeading}>
              <View style={[styles.sectionHeadingIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <AppIcon name="file-document-outline" size="sm" color={roles.primaryActionBackground} />
              </View>
              <View style={styles.sectionHeadingCopy}>
                <Text style={[styles.sectionTitle, { color: primaryTextColor }]}>Medical document</Text>
                <Text style={[styles.sectionHint, { color: roles.metaText }]}>Tap the preview to view the complete certificate.</Text>
              </View>
            </View>
          </View>

          <View style={[styles.verificationBanner, { backgroundColor: roles.iconPrimarySurface, borderColor: roles.defaultCardBorder }]}>
            <AppIcon
              name={verificationStatus === 'ocr_failed' ? 'alert-circle-outline' : 'shield-check-outline'}
              size="md"
              color={roles.primaryActionBackground}
            />
            <View style={styles.verificationCopy}>
              <Text style={[styles.verificationTitle, { color: primaryTextColor }]}>{verificationLabel}</Text>
              <Text style={[styles.verificationMeta, { color: roles.metaText }]}>
                {verifiedAt ? `Last checked ${formatDate(verifiedAt)}` : 'Verification date is not available.'}
              </Text>
            </View>
          </View>

          {documentUri ? (
            isPdf ? (
              <LegalDocumentPreview
                document={{
                  title: 'Medical certificate',
                  pdf_url: documentUri,
                  file_path: fileName,
                }}
                roles={roles}
              />
            ) : (
              <MedicalImagePreview uri={documentUri} fileName={fileName} roles={roles} />
            )
          ) : (
            <View style={[styles.noDocumentCard, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
              <View style={[styles.noDocumentIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <AppIcon name="file-document-alert-outline" size="xl" color={roles.primaryActionBackground} />
              </View>
              <Text style={[styles.noDocumentTitle, { color: primaryTextColor }]}>No document available</Text>
              <Text style={[styles.noDocumentText, { color: roles.bodyText }]}>Your uploaded medical certificate will appear here after it is linked to your account.</Text>
            </View>
          )}
        </View>
      </View>
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  screenStack: {
    gap: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  privacyHero: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderRadius: 24,
    padding: theme.spacing.lg,
    ...theme.shadows.card,
  },
  privacyHeroGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -48,
    top: -82,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  privacyHeroIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  privacyHeroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  privacyEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: '#F7DDE4',
    letterSpacing: 0.7,
  },
  privacyTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  privacyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: 17,
    color: '#FFF7F8',
  },
  section: {
    gap: theme.spacing.md,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  sectionHeadingIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeadingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  sectionHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: 16,
  },
  detailsCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 22,
    ...theme.shadows.soft,
  },
  detailRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  detailLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  detailValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 19,
    fontWeight: theme.typography.weights.semibold,
  },
  verificationBanner: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  verificationCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  verificationTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  verificationMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  previewCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 20,
    ...theme.shadows.soft,
  },
  previewViewport: {
    height: 210,
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  previewFallbackIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewFallbackTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  expandBadge: {
    position: 'absolute',
    right: theme.spacing.sm,
    top: theme.spacing.sm,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
  },
  expandBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  previewFooter: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  previewFileIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewFooterCopy: {
    flex: 1,
    minWidth: 0,
  },
  previewTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  previewMeta: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  previewAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDocumentCard: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.xl,
    ...theme.shadows.soft,
  },
  noDocumentIcon: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDocumentTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  noDocumentText: {
    maxWidth: 280,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 19,
    textAlign: 'center',
  },
  viewerScreen: {
    flex: 1,
  },
  viewerHeaderSurface: {
    marginHorizontal: 0,
  },
  viewerHeader: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  viewerBackButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  viewerTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  viewerMeta: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    opacity: 0.86,
  },
  viewerHeaderSpacer: {
    width: 48,
  },
  viewerBody: {
    flex: 1,
    padding: theme.spacing.sm,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
});
