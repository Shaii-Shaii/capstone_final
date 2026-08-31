import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { AppButton } from '../src/components/ui/AppButton';
import { AppInput } from '../src/components/ui/AppInput';
import { OtpInput } from '../src/components/ui/OtpInput';
import { DatePickerField } from '../src/components/ui/DatePickerField';
import { LegalDocumentPreview } from '../src/components/legal/LegalDocumentPreview';
import { AddressOptionSheet, AddressSelectField, SignupAddressSection } from '../src/components/auth/SignupAddressSection';
import { useAuth } from '../src/providers/AuthProvider';
import {
  completePostLoginOnboarding,
  getPatientLinkPreview,
} from '../src/features/profile/services/profile.service';
import {
  compareMedicalCertificateToPatientInput,
  verifyMedicalCertificateAsset,
} from '../src/features/patientMedicalCertificate.service';
import { calculateAgeFromBirthdate } from '../src/features/auth/validators/auth.schema';
import { patientOnboardingSchema } from '../src/features/profile/profile.schema';
import { guardianRelationshipOptions, profileGenderOptions, profileSuffixOptions } from '../src/constants/profile';
import { resolveBrandLogoSource, resolveThemeRoles, theme } from '../src/design-system/theme';
import { fetchActiveMinorConsentDocument } from '../src/features/donorCompliance.service';

// Rose-gold gradient border — shared across splash / login / signup / onboarding
const BADGE_BORDER_GRAD = ['#6e2e0e', '#d4874e', '#f5dfa8', '#d4874e', '#6e2e0e'];
const ACTION_BUTTON_BORDER_GRAD = ['#5f2f12', '#8e4f24', '#c8864f', '#ffe7ac', '#c8864f', '#8e4f24', '#5f2f12'];
const ACTION_BUTTON_FILL_GRAD = ['#8a111d', '#740c15', '#5c0910'];
const ONBOARDING_SUBMIT_TIMEOUT_MS = 25000;

const normalizePatientCode = (value) => {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.startsWith('PT') && normalized.length > 6) {
    return normalized.slice(2, 8);
  }
  return normalized.slice(0, 6);
};
const IMAGE_MEDIA_TYPES = ['images'];
const MINIMUM_BIRTHDATE = new Date(1900, 0, 1);
const MINIMUM_DIAGNOSIS_DATE = new Date(1900, 0, 1);
const formatPhilippineMobileInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 11);

const getMaximumBirthdate = () => {
  const maxDate = new Date();
  maxDate.setHours(0, 0, 0, 0);
  return maxDate;
};

const getMaximumDiagnosisDate = () => {
  const maxDate = new Date();
  maxDate.setHours(0, 0, 0, 0);
  return maxDate;
};

const manualPatientStepFieldGroups = [
  [
    'first_name',
    'last_name',
    'birthdate',
    'parental_consent',
    'gender',
    'contact_number',
    'street',
    'barangay',
    'region',
    'city',
    'province',
    'country',
    'latitude',
    'longitude',
  ],
  [
    'medical_condition',
    'date_of_diagnosis',
    'guardian',
    'guardian_relationship',
    'guardian_contact_number',
  ],
  [
    'patient_picture',
    'medical_document',
  ],
];

const getFileExtension = (mimeType = '', fileName = '') => {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  const normalizedFileName = String(fileName || '').toLowerCase();

  if (normalizedMimeType.includes('pdf') || normalizedFileName.endsWith('.pdf')) return 'pdf';
  if (normalizedMimeType.includes('png') || normalizedFileName.endsWith('.png')) return 'png';
  if (normalizedMimeType.includes('webp') || normalizedFileName.endsWith('.webp')) return 'webp';
  if (normalizedMimeType.includes('gif') || normalizedFileName.endsWith('.gif')) return 'gif';
  return 'jpg';
};

const base64ToArrayBuffer = (base64Value = '') => {
  const base64 = String(base64Value || '').replace(/\s/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = [];

  let buffer = 0;
  let bits = 0;

  for (const character of base64) {
    if (character === '=') break;
    const value = alphabet.indexOf(character);
    if (value < 0) continue;

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes).buffer;
};

const getPickedMediaPayload = async (asset, fallbackPrefix) => {
  if (!asset) {
    throw new Error('Unable to read the selected image.');
  }

  const contentType = asset.mimeType || asset.file?.type || 'image/jpeg';
  const fileName = asset.fileName || asset.file?.name || `${fallbackPrefix}.${getFileExtension(contentType)}`;
  const previewUri = asset.uri || '';

  if (asset.base64) {
    return {
      fileBody: base64ToArrayBuffer(asset.base64),
      contentType,
      fileName,
      previewUri: previewUri || `data:${contentType};base64,${asset.base64}`,
    };
  }

  if (asset.file && typeof asset.file.arrayBuffer === 'function') {
    return {
      fileBody: await asset.file.arrayBuffer(),
      contentType,
      fileName,
      previewUri,
    };
  }

  if (asset.uri) {
    const fileResponse = await fetch(asset.uri);
    if (!fileResponse.ok) {
      throw new Error('Unable to read the selected image.');
    }

    return {
      fileBody: await fileResponse.arrayBuffer(),
      contentType,
      fileName,
      previewUri: asset.uri,
    };
  }

  throw new Error('Unable to read the selected image.');
};

const getPickedDocumentPayload = async (asset, fallbackPrefix) => {
  if (!asset) {
    throw new Error('Unable to read the selected file.');
  }

  const contentType = asset.mimeType || 'application/octet-stream';
  const fileName = asset.name || `${fallbackPrefix}.${getFileExtension(contentType)}`;

  if (asset.file && typeof asset.file.arrayBuffer === 'function') {
    return {
      fileBody: await asset.file.arrayBuffer(),
      contentType,
      fileName,
      previewUri: asset.uri || '',
    };
  }

  if (asset.uri) {
    const fileResponse = await fetch(asset.uri);
    if (!fileResponse.ok) {
      throw new Error('Unable to read the selected file.');
    }

    return {
      fileBody: await fileResponse.arrayBuffer(),
      contentType,
      fileName,
      previewUri: asset.uri,
    };
  }

  throw new Error('Unable to read the selected file.');
};

const VERIFIED_MEDICAL_DOCUMENT_STATUSES = new Set([
  'auto_verified_with_qr',
  'ocr_passed_prc_pending',
  'prc_verified',
  'verified',
  'staff_verified',
]);
const DATABASE_MEDICAL_DOCUMENT_STATUSES = new Set([
  'not_submitted',
  'ocr_failed',
  'ocr_passed_prc_pending',
  'prc_verified',
  'rejected',
  'verified',
]);

const getDatabaseSafeMedicalDocumentStatus = (status, passed = false) => {
  const normalized = String(status || '').toLowerCase();
  if (DATABASE_MEDICAL_DOCUMENT_STATUSES.has(normalized)) return normalized;
  return passed ? 'ocr_passed_prc_pending' : 'ocr_failed';
};

const getMedicalDocumentVerification = (medicalDocumentValue, fallbackVerification = null) => {
  if (medicalDocumentValue && typeof medicalDocumentValue === 'object') {
    return medicalDocumentValue.verification || fallbackVerification;
  }
  return fallbackVerification;
};

const getMedicalDocumentVerificationStatus = (medicalDocumentValue, fallbackVerification = null) => {
  const verification = getMedicalDocumentVerification(medicalDocumentValue, fallbackVerification);
  const objectStatus = medicalDocumentValue && typeof medicalDocumentValue === 'object'
    ? medicalDocumentValue.medical_document_verification_status
    : '';
  return String(verification?.status || objectStatus || '').toLowerCase();
};

const isMedicalDocumentVerified = (medicalDocumentValue, fallbackVerification = null) => (
  VERIFIED_MEDICAL_DOCUMENT_STATUSES.has(getMedicalDocumentVerificationStatus(
    medicalDocumentValue,
    fallbackVerification
  ))
);

const runWithTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        success: false,
        error: timeoutMessage,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

// ─── BadgeLogo ───────────────────────────────────────────────────────────────
// Rose-gold gradient border + dark wine inner card + cream logo plate.
// Consistent badge design used across splash / login / signup / onboarding.
function BadgeLogo({ resolvedTheme }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logoSrc = resolveBrandLogoSource(resolvedTheme, imageFailed);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedTheme?.logoIcon]);

  return (
    <View style={styles.badgeOuter}>
      <LinearGradient
        colors={BADGE_BORDER_GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.badgeInner}>
        <View style={styles.badgePlate}>
          <Image
            source={logoSrc}
            style={styles.badgeImg}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        </View>
      </View>
    </View>
  );
}

// ─── LoadingState ─────────────────────────────────────────────────────────────
// Shown while auth state resolves or while redirecting after onboarding.
// Uses the same dark wine gradient as the splash screen for visual continuity.
// eslint-disable-next-line no-unused-vars
function LoadingState() {
  const { resolvedTheme } = useAuth();
  const brandName = resolvedTheme?.brandName || 'Donivra';
  const tagline   = resolvedTheme?.brandTagline || 'Where Hair Becomes Hope';

  return (
    <View style={styles.loadShell}>
      <LinearGradient
        colors={['#0d0205', '#1e0508', '#360b12', '#4b1020']}
        start={{ x: 0.25, y: 0 }}
        end={{ x: 0.75, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Subtle concentric rings — echoes the splash screen */}
      <View style={styles.loadRing1} pointerEvents="none" />
      <View style={styles.loadRing2} pointerEvents="none" />

      <BadgeLogo resolvedTheme={resolvedTheme} />

      <Text
        style={[
          styles.loadBrand,
          resolvedTheme?.secondaryFontFamily
            ? { fontFamily: resolvedTheme.secondaryFontFamily }
            : null,
        ]}
      >
        {brandName}
      </Text>
      <Text style={styles.loadTagline}>{tagline}</Text>
    </View>
  );
}

const formatMedicalRecordDate = (value = '') => {
  const normalized = String(value || '').trim();
  if (!normalized) return 'Not detected';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00`)
    : new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parsed);
};

function MedicalVerificationResultModal({
  visible,
  roles,
  verification,
  documentValue,
  onClose,
  onReviewMismatchStep,
}) {
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const documentUri = typeof documentValue === 'string'
    ? documentValue
    : String(documentValue?.publicUrl || documentValue?.url || documentValue?.uri || documentValue?.previewUri || '');
  const previewUri = typeof documentValue === 'object'
    ? String(documentValue?.previewUri || documentValue?.uri || documentUri)
    : documentUri;
  const fileName = typeof documentValue === 'object'
    ? String(documentValue?.fileName || documentValue?.name || 'medical-certificate.pdf')
    : String(documentUri.split('?')[0].split('/').pop() || 'medical-certificate.pdf');
  const mimeType = typeof documentValue === 'object'
    ? String(documentValue?.contentType || documentValue?.mimeType || '')
    : '';
  const isImageDocument = mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)(?:$|[?#])/i.test(previewUri);
  const raw = verification?.raw || {};
  const detectedCondition = verification?.medicalCondition
    || raw.medical_condition
    || raw.medicalCondition
    || '';
  const detectedDiagnosisDate = verification?.diagnosisDate
    || raw.diagnosis_date
    || raw.diagnosisDate
    || '';
  const detectedHospital = verification?.hospitalName
    || raw.hospital_name
    || raw.hospitalName
    || '';
  const patientInputComparison = verification?.patientInputComparison || {};
  const mismatches = Array.isArray(patientInputComparison?.mismatches)
    ? patientInputComparison.mismatches
    : [];
  const isMismatch = verification?.status === 'patient_details_mismatch' || mismatches.length > 0;
  const mismatchSteps = [1, 2].filter((step) => mismatches.some((item) => item?.step === step));
  const effectiveMismatchSteps = mismatchSteps.length ? mismatchSteps : [2];
  const mismatchStepLabel = effectiveMismatchSteps.map((step) => `Step ${step}`).join(' and ');
  const detectedPatientBirthdateOrAge = verification?.patientBirthdate
    ? formatMedicalRecordDate(verification.patientBirthdate)
    : verification?.patientAge !== null && verification?.patientAge !== undefined
      ? `${verification.patientAge} years old`
      : 'Not detected';
  const verifiedAt = typeof documentValue === 'object'
    ? documentValue?.medical_document_verified_at
    : '';
  const reviewStatus = isMismatch
    ? `${mismatchStepLabel} details need correction`
    : verification?.documentLegitimacy === 'requires_prc_staff_review'
      ? 'PRC staff review pending'
      : String(verification?.documentLegitimacy || 'Verification completed').replace(/[._-]+/g, ' ');
  const detailItems = [
    { icon: 'account-outline', label: 'Patient', value: verification?.patientName || 'Not detected' },
    { icon: 'cake-variant-outline', label: 'Birthdate / age', value: detectedPatientBirthdateOrAge },
    { icon: 'gender-male-female', label: 'Gender', value: verification?.patientGender || 'Not detected' },
    { icon: 'hospital-building', label: 'Hospital / medical facility', value: detectedHospital || 'Not detected' },
    { icon: 'medical-bag', label: 'Medical condition', value: detectedCondition || 'Not detected' },
    { icon: 'calendar-check-outline', label: 'Diagnosis date', value: formatMedicalRecordDate(detectedDiagnosisDate) },
    { icon: 'doctor', label: 'Doctor', value: verification?.doctorName || 'Not detected' },
    { icon: 'card-account-details-outline', label: 'PRC / license number', value: verification?.licenseNumber || 'Not detected' },
    { icon: 'file-document-outline', label: 'Document', value: fileName },
    { icon: 'clock-check-outline', label: 'Verified on', value: formatMedicalRecordDate(verifiedAt) },
    { icon: 'shield-check-outline', label: 'Review status', value: reviewStatus },
  ];

  useEffect(() => {
    if (!visible) setIsImageViewerOpen(false);
  }, [visible]);

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.medicalResultModalOverlay}>
          <View style={[styles.medicalResultModalCard, { backgroundColor: roles.pageBackground }]}>
            <LinearGradient
              colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.medicalResultModalHeader}
            >
              <View pointerEvents="none" style={styles.medicalResultModalGlow} />
              <View style={styles.medicalResultHeaderIcon}>
                <MaterialCommunityIcons name="file-check-outline" size={27} color={roles.primaryActionText} />
              </View>
              <View style={styles.medicalResultHeaderCopy}>
                <Text style={[styles.medicalResultEyebrow, { color: roles.primaryActionText }]}>{isMismatch ? 'DETAILS NEED REVIEW' : 'OCR VERIFICATION COMPLETE'}</Text>
                <Text style={[styles.medicalResultTitle, { color: roles.primaryActionText }]}>{isMismatch ? 'Medical details mismatch' : 'Medical record details'}</Text>
                <Text style={[styles.medicalResultSubtitle, { color: roles.primaryActionText }]}>{isMismatch ? 'The certificate does not match information entered during patient setup.' : 'Review the extracted information against the original document.'}</Text>
              </View>
            </LinearGradient>

            <ScrollView
              style={styles.medicalResultScroll}
              contentContainerStyle={styles.medicalResultBody}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.medicalResultSuccessBanner, isMismatch ? styles.medicalResultMismatchBanner : null]}>
                <MaterialCommunityIcons name={isMismatch ? 'alert-circle-outline' : 'check-decagram-outline'} size={22} color={isMismatch ? '#9A5B00' : '#1E7A42'} />
                <View style={styles.medicalResultSuccessCopy}>
                  <Text style={[styles.medicalResultSuccessTitle, isMismatch ? styles.medicalResultMismatchTitle : null]}>{isMismatch ? `The document and ${mismatchStepLabel} do not match` : 'Certificate verified by OCR'}</Text>
                  <Text style={[styles.medicalResultSuccessText, isMismatch ? styles.medicalResultMismatchText : null]}>{isMismatch ? `Please review the differences below, then correct ${mismatchStepLabel} or upload the correct certificate.` : 'Important fields were detected. Final PRC review may still be required.'}</Text>
                </View>
              </View>

              {isMismatch ? (
                <View style={styles.medicalResultMismatchList}>
                  {mismatches.map((item) => (
                    <View key={item.field} style={styles.medicalResultMismatchItem}>
                      <Text style={styles.medicalResultMismatchField}>{item.field}</Text>
                      <View style={styles.medicalResultMismatchValueRow}>
                        <Text style={styles.medicalResultMismatchValueLabel}>STEP {item.step || effectiveMismatchSteps[0]}</Text>
                        <Text style={styles.medicalResultMismatchValue}>{item.entered}</Text>
                      </View>
                      <View style={styles.medicalResultMismatchValueRow}>
                        <Text style={styles.medicalResultMismatchValueLabel}>DOCUMENT</Text>
                        <Text style={styles.medicalResultMismatchValue}>{item.detected}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.medicalResultSectionHeader}>
                <MaterialCommunityIcons name="file-eye-outline" size={19} color={roles.primaryActionBackground} />
                <View style={styles.medicalResultSectionHeaderCopy}>
                  <Text style={[styles.medicalResultSectionTitle, { color: roles.headingText }]}>Document preview</Text>
                  <Text style={[styles.medicalResultSectionHint, { color: roles.metaText }]}>Tap the preview to enlarge the original certificate.</Text>
                </View>
              </View>

              {isImageDocument && previewUri ? (
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Enlarge medical certificate"
                  onPress={() => setIsImageViewerOpen(true)}
                  style={[styles.medicalResultImagePreview, { borderColor: roles.defaultCardBorder }]}
                >
                  <Image source={{ uri: previewUri }} style={styles.medicalResultImage} resizeMode="cover" />
                  <View style={[styles.medicalResultExpandBadge, { backgroundColor: roles.primaryActionBackground }]}>
                    <MaterialCommunityIcons name="fullscreen" size={16} color={roles.primaryActionText} />
                    <Text style={[styles.medicalResultExpandText, { color: roles.primaryActionText }]}>Enlarge</Text>
                  </View>
                </Pressable>
              ) : documentUri ? (
                <LegalDocumentPreview
                  document={{
                    title: 'Medical Certificate',
                    file_path: fileName,
                    pdf_url: documentUri,
                  }}
                  roles={roles}
                />
              ) : (
                <View style={[styles.medicalResultNoPreview, { borderColor: roles.defaultCardBorder }]}>
                  <MaterialCommunityIcons name="file-alert-outline" size={28} color={roles.metaText} />
                  <Text style={[styles.medicalResultNoPreviewText, { color: roles.metaText }]}>Document preview is unavailable.</Text>
                </View>
              )}

              <View style={styles.medicalResultSectionHeader}>
                <MaterialCommunityIcons name="clipboard-text-outline" size={19} color={roles.primaryActionBackground} />
                <View style={styles.medicalResultSectionHeaderCopy}>
                  <Text style={[styles.medicalResultSectionTitle, { color: roles.headingText }]}>Medical record summary</Text>
                  <Text style={[styles.medicalResultSectionHint, { color: roles.metaText }]}>Important fields extracted from the uploaded certificate.</Text>
                </View>
              </View>

              <View style={[styles.medicalResultDetails, { borderColor: roles.defaultCardBorder, backgroundColor: roles.defaultCardBackground }]}>
                {detailItems.map((item, index) => (
                  <View
                    key={item.label}
                    style={[
                      styles.medicalResultDetailRow,
                      index < detailItems.length - 1 ? { borderBottomColor: roles.defaultCardBorder, borderBottomWidth: 1 } : null,
                    ]}
                  >
                    <View style={[styles.medicalResultDetailIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                      <MaterialCommunityIcons name={item.icon} size={18} color={roles.primaryActionBackground} />
                    </View>
                    <View style={styles.medicalResultDetailCopy}>
                      <Text style={[styles.medicalResultDetailLabel, { color: roles.metaText }]}>{item.label}</Text>
                      <Text selectable style={[styles.medicalResultDetailValue, { color: roles.headingText }]}>{item.value}</Text>
                    </View>
                  </View>
                ))}
              </View>

            </ScrollView>

            <View style={[styles.medicalResultFooter, { borderTopColor: roles.defaultCardBorder }]}>
              {isMismatch ? (
                <View style={styles.medicalResultMismatchActions}>
                  {effectiveMismatchSteps.map((step) => (
                    <View key={step} style={styles.medicalResultMismatchActionItem}>
                      <AppButton
                        title={`Fix Step ${step}`}
                        onPress={() => onReviewMismatchStep?.(step)}
                        backgroundColorOverride={roles.primaryActionBackground}
                        borderColorOverride={roles.primaryActionBackground}
                        textColorOverride={roles.primaryActionText}
                      />
                    </View>
                  ))}
                </View>
              ) : (
                <AppButton
                  title="Done reviewing"
                  onPress={onClose}
                  backgroundColorOverride={roles.primaryActionBackground}
                  borderColorOverride={roles.primaryActionBackground}
                  textColorOverride={roles.primaryActionText}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isImageViewerOpen} animationType="fade" onRequestClose={() => setIsImageViewerOpen(false)}>
        <View style={styles.medicalResultImageViewer}>
          <View style={styles.medicalResultImageViewerHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to medical record details"
              onPress={() => setIsImageViewerOpen(false)}
              style={styles.medicalResultImageViewerBack}
            >
              <MaterialCommunityIcons name="arrow-left" size={23} color="#ffffff" />
            </Pressable>
            <Text numberOfLines={1} style={styles.medicalResultImageViewerTitle}>Medical Certificate</Text>
            <View style={styles.medicalResultImageViewerSpacer} />
          </View>
          <Image source={{ uri: previewUri }} style={styles.medicalResultImageViewerImage} resizeMode="contain" />
        </View>
      </Modal>
    </>
  );
}

function MinorPatientConsentModal({
  visible,
  roles,
  document,
  isLoading,
  error,
  onRetry,
  onCancel,
  onConfirm,
}) {
  const [isAccepted, setIsAccepted] = useState(false);
  const canAccept = Boolean(document?.legal_document_id && document?.pdf_url && !isLoading && !error);

  useEffect(() => {
    if (visible) setIsAccepted(false);
  }, [document?.legal_document_id, visible]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.minorConsentModalOverlay}>
        <Pressable style={styles.minorConsentModalBackdrop} onPress={onCancel} />
        <View style={[styles.minorConsentModalCard, { backgroundColor: roles.pageBackground }]}>
          <LinearGradient
            colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.minorConsentModalHeader}
          >
            <View pointerEvents="none" style={styles.minorConsentModalGlow} />
            <View style={styles.minorConsentModalHeaderIcon}>
              <MaterialCommunityIcons name="shield-account-outline" size={26} color={roles.primaryActionText} />
            </View>
            <View style={styles.minorConsentModalHeaderCopy}>
              <Text style={[styles.minorConsentModalEyebrow, { color: roles.primaryActionText }]}>MINOR ACCOUNT</Text>
              <Text style={[styles.minorConsentModalTitle, { color: roles.primaryActionText }]}>Guardian consent</Text>
              <Text style={[styles.minorConsentModalSubtitle, { color: roles.primaryActionText }]}>Review the current document before confirming.</Text>
            </View>
          </LinearGradient>

          <ScrollView
            style={styles.minorConsentModalScroll}
            contentContainerStyle={styles.minorConsentModalBody}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <View style={styles.minorConsentModalLoading}>
                <ActivityIndicator size="small" color={roles.primaryActionBackground} />
                <Text style={[styles.minorConsentModalLoadingText, { color: roles.bodyText }]}>Loading minor consent...</Text>
              </View>
            ) : error ? (
              <View style={styles.minorConsentModalErrorBlock}>
                <MaterialCommunityIcons name="alert-circle-outline" size={24} color={theme.colors.textError} />
                <Text style={styles.minorConsentModalErrorText}>{error}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={onRetry}
                  style={[styles.minorConsentModalRetry, { borderColor: roles.primaryActionBackground }]}
                >
                  <MaterialCommunityIcons name="refresh" size={18} color={roles.primaryActionBackground} />
                  <Text style={[styles.minorConsentModalRetryText, { color: roles.primaryActionBackground }]}>Try again</Text>
                </Pressable>
              </View>
            ) : document ? (
              <LegalDocumentPreview document={document} roles={roles} />
            ) : null}

            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Accept minor guardian consent"
              accessibilityState={{ checked: isAccepted, disabled: !canAccept }}
              disabled={!canAccept}
              onPress={() => setIsAccepted((current) => !current)}
              android_ripple={{ color: theme.colors.surfacePressed, borderless: false }}
              style={[
                styles.minorConsentAgreement,
                {
                  backgroundColor: roles.supportCardBackground,
                  borderColor: roles.supportCardBorder,
                },
                !canAccept ? styles.minorConsentAgreementDisabled : null,
              ]}
            >
              <View
                style={[
                  styles.minorConsentCheckbox,
                  isAccepted
                    ? {
                        backgroundColor: roles.primaryActionBackground,
                        borderColor: roles.primaryActionBackground,
                      }
                    : null,
                ]}
              >
                {isAccepted ? (
                  <MaterialCommunityIcons name="check" size={17} color={roles.primaryActionText} />
                ) : null}
              </View>
              <View style={styles.minorConsentAgreementCopy}>
                <Text style={[styles.minorConsentAgreementTitle, { color: roles.headingText }]}>Required confirmation</Text>
                <Text style={[styles.minorConsentAgreementText, { color: roles.bodyText }]}>I am the parent or legal guardian and agree to the minor consent document shown above.</Text>
              </View>
            </Pressable>
          </ScrollView>

          <View style={[styles.minorConsentModalFooter, { borderTopColor: roles.defaultCardBorder }]}>
            <View style={styles.minorConsentModalAction}>
              <AppButton
                title="Not now"
                variant="outline"
                onPress={onCancel}
                backgroundColorOverride={roles.defaultCardBackground}
                borderColorOverride={roles.secondaryActionBorder}
                textColorOverride={roles.secondaryActionText}
              />
            </View>
            <View style={styles.minorConsentModalAction}>
              <AppButton
                title="Confirm consent"
                onPress={() => onConfirm(document)}
                disabled={!canAccept || !isAccepted}
                backgroundColorOverride={roles.primaryActionBackground}
                borderColorOverride={roles.primaryActionBackground}
                textColorOverride={roles.primaryActionText}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FirstTimeOnboarding() {
  const router = useRouter();
  const { user, profile, refreshProfile, resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const [branchMode, setBranchMode] = useState('question');
  const [isIntroReady, setIsIntroReady] = useState(false);
  const [patientCode, setPatientCode] = useState('');
  const [patientPreview, setPatientPreview] = useState(null);
  const [isPatientPreviewModalVisible, setIsPatientPreviewModalVisible] = useState(false);
  const [patientCodeError, setPatientCodeError] = useState('');
  const [patientCodeErrorModalMessage, setPatientCodeErrorModalMessage] = useState('');
  const [isPatientCodeErrorModalVisible, setIsPatientCodeErrorModalVisible] = useState(false);
  const [screenError, setScreenError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const [manualPatientStep, setManualPatientStep] = useState(0);
  const [activeManualPicker, setActiveManualPicker] = useState('');
  const [manualGuardianRelationshipOption, setManualGuardianRelationshipOption] = useState('');
  const [isUploadingPatientPicture, setIsUploadingPatientPicture] = useState(false);
  const [isUploadingMedicalDocument, setIsUploadingMedicalDocument] = useState(false);
  const [medicalDocumentVerification, setMedicalDocumentVerification] = useState(null);
  const [isMedicalVerificationModalVisible, setIsMedicalVerificationModalVisible] = useState(false);
  const [manualImagePreview, setManualImagePreview] = useState(null);
  const [isMinorConsentModalVisible, setIsMinorConsentModalVisible] = useState(false);
  const [minorConsentDocument, setMinorConsentDocument] = useState(null);
  const [isLoadingMinorConsent, setIsLoadingMinorConsent] = useState(false);
  const [minorConsentError, setMinorConsentError] = useState('');
  const welcomeOpacity = useRef(new Animated.Value(0)).current;
  const startOpacity = useRef(new Animated.Value(0)).current;
  const patientCodeErrorModalTimerRef = useRef(null);
  const promptedMinorBirthdateRef = useRef('');

  const manualPatientForm = useForm({
    resolver: zodResolver(patientOnboardingSchema),
    mode: 'onBlur',
    shouldUnregister: false,
    defaultValues: {
      first_name: profile?.first_name || '',
      middle_name: profile?.middle_name || '',
      last_name: profile?.last_name || '',
      suffix: profile?.suffix || '',
      birthdate: profile?.birthdate || '',
      gender: profile?.gender || '',
      contact_number: profile?.contact_number || '',
      street: profile?.street || '',
      barangay: profile?.barangay || '',
      region: profile?.region || '',
      city: profile?.city || '',
      province: profile?.province || '',
      country: profile?.country || 'Philippines',
      latitude: profile?.latitude !== undefined && profile?.latitude !== null ? String(profile.latitude) : '',
      longitude: profile?.longitude !== undefined && profile?.longitude !== null ? String(profile.longitude) : '',
      medical_condition: '',
      date_of_diagnosis: '',
      guardian: '',
      guardian_relationship: '',
      guardian_contact_number: '',
      parental_consent: false,
      patient_picture: '',
      medical_document: '',
    },
  });

  const getManualPatientFieldValue = (fieldName) => manualPatientForm.getValues(fieldName) ?? '';
  const watchedManualBirthdate = manualPatientForm.watch('birthdate');
  const watchedParentalConsent = manualPatientForm.watch('parental_consent');
  const watchedMedicalDocument = manualPatientForm.watch('medical_document');

  const loadMinorConsentDocument = async () => {
    setIsLoadingMinorConsent(true);
    setMinorConsentError('');
    setMinorConsentDocument(null);
    const result = await fetchActiveMinorConsentDocument();
    setMinorConsentDocument(result.data || null);
    setMinorConsentError(result.error?.message || '');
    setIsLoadingMinorConsent(false);
  };

  useEffect(() => {
    if (!isMinorConsentModalVisible) return;
    loadMinorConsentDocument();
  }, [isMinorConsentModalVisible]);

  useEffect(() => {
    const birthdateKey = String(watchedManualBirthdate || '').trim();
    const age = calculateAgeFromBirthdate(birthdateKey);
    const isMinor = age !== null && age < 18;

    if (branchMode !== 'patient-manual' || !birthdateKey || !isMinor) {
      promptedMinorBirthdateRef.current = '';
      if (!isMinor && watchedParentalConsent) {
        manualPatientForm.setValue('parental_consent', false, { shouldValidate: true });
      }
      if (branchMode !== 'patient-manual' || !isMinor) setIsMinorConsentModalVisible(false);
      return;
    }

    if (promptedMinorBirthdateRef.current === birthdateKey) return;
    promptedMinorBirthdateRef.current = birthdateKey;
    manualPatientForm.setValue('parental_consent', false, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setIsMinorConsentModalVisible(true);
  }, [branchMode, manualPatientForm, watchedManualBirthdate, watchedParentalConsent]);

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.timing(welcomeOpacity, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
      Animated.delay(480),
      Animated.timing(welcomeOpacity, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(startOpacity, {
        toValue: 1,
        duration: 360,
        useNativeDriver: true,
      }),
    ]);

    animation.start(() => {
      setIsIntroReady(true);
    });

    return () => {
      animation.stop();
    };
  }, [startOpacity, welcomeOpacity]);

  useEffect(() => {
    const currentGuardianRelationship = String(manualPatientForm.getValues('guardian_relationship') || '').trim();
    if (!currentGuardianRelationship) {
      return;
    }

    const isPresetOption = guardianRelationshipOptions.some((option) => option.value === currentGuardianRelationship);
    setManualGuardianRelationshipOption(isPresetOption ? currentGuardianRelationship : 'Other');
  }, [manualPatientForm]);

  useEffect(() => (
    () => {
      if (patientCodeErrorModalTimerRef.current) {
        clearTimeout(patientCodeErrorModalTimerRef.current);
      }
    }
  ), []);

  const showPatientCodeErrorModal = (message) => {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) return;

    setPatientCodeErrorModalMessage(normalizedMessage);
    setIsPatientCodeErrorModalVisible(true);

    if (patientCodeErrorModalTimerRef.current) {
      clearTimeout(patientCodeErrorModalTimerRef.current);
    }

    patientCodeErrorModalTimerRef.current = setTimeout(() => {
      setIsPatientCodeErrorModalVisible(false);
    }, 2600);
  };

  const continueToRoleHome = async (targetRole) => {
    await refreshProfile(user?.id);
    router.replace(targetRole === 'patient' ? '/patient/home' : '/donor/home');
  };

  const finalizeOnboarding = async (payload) => {
    setIsSubmitting(true);
    setScreenError('');

    try {
      const result = await runWithTimeout(
        completePostLoginOnboarding({
          userId: user?.id,
          email: user?.email || profile?.email || '',
          ...payload,
        }),
        ONBOARDING_SUBMIT_TIMEOUT_MS,
        'Saving is taking too long. Please check your connection and try again.'
      );

      if (!result.success) {
        setScreenError(result.error || 'Unable to complete onboarding.');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await continueToRoleHome(result.role);
    } catch (error) {
      setScreenError(error?.message || 'Unable to complete onboarding.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContinueAsDonor = async () => {
    await Haptics.selectionAsync();
    await finalizeOnboarding({
      mode: 'donor',
    });
  };

  const handleValidatePatientCode = async () => {
    const normalizedCode = normalizePatientCode(patientCode);
    if (normalizedCode.length !== 6) {
      const message = 'Invalid Code';
      setPatientCodeError(message);
      showPatientCodeErrorModal(message);
      setPatientPreview(null);
      return;
    }

    await Haptics.selectionAsync();
    setIsValidatingCode(true);
    setPatientCodeError('');
    setPatientPreview(null);

    const result = await getPatientLinkPreview(normalizedCode, {
      currentAuthUserId: user?.id || '',
    });
    setIsValidatingCode(false);

    if (result.error) {
      const message = result.error || 'Patient code could not be validated.';
      setPatientCodeError(message);
      showPatientCodeErrorModal(message);
      return;
    }

    setPatientPreview(result.patient);
    setIsPatientPreviewModalVisible(true);
  };

  const handleConfirmPatientCode = async () => {
    await Haptics.selectionAsync();
    await finalizeOnboarding({
      mode: 'patient-linked',
      patientCode: normalizePatientCode(patientCode),
    });
  };

  const handleManualPatientSubmit = async (values) => {
    if (!isMedicalDocumentVerified(values?.medical_document, medicalDocumentVerification)) {
      setScreenError('Please upload or scan a valid medical certificate before continuing.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const currentVerification = getMedicalDocumentVerification(
      values?.medical_document,
      medicalDocumentVerification
    );
    const patientInputComparison = compareMedicalCertificateToPatientInput({
      verification: currentVerification,
      patientName: [values?.first_name, values?.middle_name, values?.last_name].filter(Boolean).join(' '),
      birthdate: values?.birthdate,
      gender: values?.gender,
      medicalCondition: values?.medical_condition,
      diagnosisDate: values?.date_of_diagnosis,
    });
    if (!patientInputComparison.matches) {
      const mismatchVerification = {
        ...currentVerification,
        passed: false,
        status: 'patient_details_mismatch',
        patientInputComparison,
        errorMessage: 'The certificate does not match the patient information entered in Step 1 or Step 2.',
      };
      if (values?.medical_document && typeof values.medical_document === 'object') {
        manualPatientForm.setValue('medical_document', {
          ...values.medical_document,
          verification: mismatchVerification,
          medical_document_verification_status: 'ocr_failed',
        }, { shouldDirty: true, shouldValidate: true });
      }
      setMedicalDocumentVerification(mismatchVerification);
      setScreenError('The certificate does not match the patient information entered during setup.');
      setIsMedicalVerificationModalVisible(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    await Haptics.selectionAsync();
    await finalizeOnboarding({
      mode: 'patient-manual',
      manualPatientDetails: values,
    });
  };

  const handleManualPatientInvalid = async (errors) => {
    const invalidFieldNames = Object.keys(errors || {});
    const blockingStep = manualPatientStepFieldGroups.findIndex((fieldNames) => (
      fieldNames.some((fieldName) => invalidFieldNames.includes(fieldName))
    ));

    setScreenError('Please complete the required patient details before creating the account.');

    if (blockingStep >= 0) {
      setManualPatientStep(blockingStep);
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const handleManualPatientNext = async () => {
    const isValid = await manualPatientForm.trigger(manualPatientStepFieldGroups[manualPatientStep]);

    if (!isValid) {
      setScreenError('Please complete the required fields before continuing.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    await Haptics.selectionAsync();
    setScreenError('');
    setManualPatientStep((currentStep) => Math.min(currentStep + 1, 2));
  };

  const verifyAndSaveManualMedicalDocument = async (mediaPayload) => {
    setMedicalDocumentVerification(null);

    const result = await verifyMedicalCertificateAsset({
      authUserId: user?.id,
      patientId: null,
      expectedPatientName: [
        manualPatientForm.getValues('first_name'),
        manualPatientForm.getValues('middle_name'),
        manualPatientForm.getValues('last_name'),
      ].filter(Boolean).join(' '),
      expectedBirthdate: manualPatientForm.getValues('birthdate'),
      expectedGender: manualPatientForm.getValues('gender'),
      expectedMedicalCondition: manualPatientForm.getValues('medical_condition'),
      expectedDiagnosisDate: manualPatientForm.getValues('date_of_diagnosis'),
      asset: {
        uri: mediaPayload.previewUri || mediaPayload.uri || '',
        mimeType: mediaPayload.contentType,
        fileName: mediaPayload.fileName,
        fileBody: mediaPayload.fileBody,
        publicUrl: mediaPayload.publicUrl || '',
      },
    });

    const verification = result.verification
      ? { ...result.verification, errorMessage: result.error || '' }
      : null;
    setMedicalDocumentVerification(verification);

    if (!result.success) {
      manualPatientForm.setValue('medical_document', {
        ...mediaPayload,
        publicUrl: result.documentUrl || '',
        verification,
        medical_document_verification_status: 'ocr_failed',
        medical_document_ocr_text: verification?.extractedText || '',
        medical_document_verified_at: new Date().toISOString(),
        doctor_name: verification?.doctorName || '',
        doctor_license_number: verification?.licenseNumber || '',
      }, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setScreenError('');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (verification?.status === 'patient_details_mismatch') {
        setIsMedicalVerificationModalVisible(true);
      }
      return false;
    }

    manualPatientForm.setValue('medical_document', {
      ...mediaPayload,
      publicUrl: result.documentUrl,
      verification,
      medical_document_verification_status: getDatabaseSafeMedicalDocumentStatus(
        verification?.status,
        true
      ),
      medical_document_ocr_text: verification?.extractedText || '',
      medical_document_verified_at: new Date().toISOString(),
      doctor_name: verification?.doctorName || '',
      doctor_license_number: verification?.licenseNumber || '',
    }, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setScreenError('');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsMedicalVerificationModalVisible(true);
    return true;
  };

  const retryManualPatientMedicalDocumentVerification = async () => {
    const currentDocument = manualPatientForm.getValues('medical_document');
    if (!currentDocument || typeof currentDocument !== 'object') {
      setScreenError('Upload or scan the medical certificate first.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    try {
      setIsUploadingMedicalDocument(true);
      await verifyAndSaveManualMedicalDocument(currentDocument);
    } catch (error) {
      setScreenError(error?.message || 'Unable to retry document verification.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUploadingMedicalDocument(false);
    }
  };

  const pickManualPatientAsset = async (fieldName, setUploading) => {
    try {
      setUploading(true);
      if (fieldName === 'medical_document') {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*'],
          copyToCacheDirectory: true,
          multiple: false,
        });

        if (result.canceled) {
          return;
        }

        const mediaPayload = await getPickedDocumentPayload(result.assets?.[0], 'patient-document');
        await verifyAndSaveManualMedicalDocument(mediaPayload);
        return;
      }

      if (Platform.OS !== 'android') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setScreenError('Please allow photo library access to continue.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      const mediaPayload = await getPickedMediaPayload(
        asset,
        fieldName === 'patient_picture' ? 'patient-picture' : 'patient-document'
      );
      manualPatientForm.setValue(fieldName, mediaPayload, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setScreenError('');
    } catch (error) {
      setScreenError(error?.message || 'Unable to use the selected file.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setUploading(false);
    }
  };

  const scanManualPatientMedicalDocument = async () => {
    try {
      setIsUploadingMedicalDocument(true);
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setScreenError('Please allow camera access to scan the medical certificate.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });

      if (result.canceled) {
        return;
      }

      const mediaPayload = await getPickedMediaPayload(
        result.assets?.[0],
        'patient-document-scan'
      );
      await verifyAndSaveManualMedicalDocument(mediaPayload);
    } catch (error) {
      setScreenError(error?.message || 'Unable to scan the medical certificate.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsUploadingMedicalDocument(false);
    }
  };

  const renderOnboardingCard = () => {
    if (branchMode === 'donor-info') {
      return (
        <View style={styles.donorInfoPlainSection}>
          <View style={styles.onboardingSection}>
            <View style={styles.donorInfoIconWrap}>
              <MaterialCommunityIcons
                name="hand-heart-outline"
                size={28}
                color={roles.primaryActionBackground}
              />
            </View>
            <Text style={[styles.onboardingQuestion, styles.donorInfoQuestionHighlight, { color: roles.primaryActionBackground }]}>
              Ready to donate hair?
            </Text>
            <Text style={styles.onboardingBody}>
              Continue to your donation dashboard to start tracking your hair donation journey.
            </Text>
          </View>

          <View style={styles.actionStack}>
            <LinearGradient
              colors={ACTION_BUTTON_BORDER_GRAD}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.continueGradientBorder}
            >
              <LinearGradient
                colors={ACTION_BUTTON_FILL_GRAD}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={styles.continueGradientFill}
              >
                <LinearGradient
                  colors={['rgba(255, 246, 222, 0)', 'rgba(255, 246, 222, 0.18)', 'rgba(255, 246, 222, 0)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.continueDiagonalShine}
                />
                <AppButton
                  title="Continue"
                  size="lg"
                  variant="outline"
                  loading={isSubmitting}
                  disabled={isSubmitting}
                  onPress={handleContinueAsDonor}
                  style={styles.continueButton}
                  textStyle={styles.continueButtonText}
                  backgroundColorOverride="transparent"
                  borderColorOverride="transparent"
                  textColorOverride={roles.primaryActionText}
                />
              </LinearGradient>
            </LinearGradient>
            <AppButton
              title="Back"
              size="lg"
              variant="outline"
              onPress={() => {
                setBranchMode('question');
                setScreenError('');
              }}
              style={[styles.backActionButton, styles.donorInfoSecondaryButton]}
              textStyle={styles.backActionButtonText}
              backgroundColorOverride={theme.colors.surfaceCard}
              borderColorOverride="#b87b44"
              textColorOverride={roles.primaryActionBackground}
            />
          </View>
        </View>
      );
    }

    if (branchMode === 'patient-code') {
      return (
        <View style={styles.patientCodePlainSection}>
          <View style={styles.onboardingSection}>
            <View style={styles.patientCodeIconWrap}>
              <MaterialCommunityIcons
                name="card-account-details-outline"
                size={28}
                color={roles.primaryActionBackground}
              />
            </View>
            <Text style={[styles.onboardingQuestion, styles.patientCodeQuestionHighlight, { color: roles.primaryActionBackground }]}>
              Have you received a patient code?
            </Text>
            <Text style={styles.onboardingBody}>
              Enter the code shared by your hospital or care team.
            </Text>
          </View>

          <OtpInput
            length={6}
            value={patientCode}
            onChange={(value) => {
              setPatientCode(normalizePatientCode(value));
              setPatientPreview(null);
              setIsPatientPreviewModalVisible(false);
              setPatientCodeError('');
              setIsPatientCodeErrorModalVisible(false);
              setScreenError('');
            }}
            keyboardType="default"
            characterSet="alphanumeric"
            autoCapitalize="characters"
            error={Boolean(patientCodeError)}
            style={styles.codeInput}
          />

          <View style={styles.actionStack}>
            <LinearGradient
              colors={ACTION_BUTTON_BORDER_GRAD}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.continueGradientBorder}
            >
              <LinearGradient
                colors={ACTION_BUTTON_FILL_GRAD}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={styles.continueGradientFill}
              >
                <LinearGradient
                  colors={['rgba(255, 246, 222, 0)', 'rgba(255, 246, 222, 0.18)', 'rgba(255, 246, 222, 0)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.continueDiagonalShine}
                />
                {patientPreview ? (
                  <AppButton
                    title="Continue"
                    size="lg"
                    variant="outline"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    onPress={handleConfirmPatientCode}
                    style={styles.continueButton}
                    textStyle={styles.continueButtonText}
                    backgroundColorOverride="transparent"
                    borderColorOverride="transparent"
                    textColorOverride={roles.primaryActionText}
                  />
                ) : (
                  <AppButton
                    title="Check Code"
                    size="lg"
                    variant="outline"
                    loading={isValidatingCode}
                    disabled={isValidatingCode || isSubmitting}
                    onPress={handleValidatePatientCode}
                    style={styles.continueButton}
                    textStyle={styles.continueButtonText}
                    backgroundColorOverride="transparent"
                    borderColorOverride="transparent"
                    textColorOverride={roles.primaryActionText}
                  />
                )}
              </LinearGradient>
            </LinearGradient>

            <View style={styles.patientCodeSecondaryRow}>
              <View style={styles.patientCodeSecondaryHalf}>
                <AppButton
                  title="I don't have a code"
                  size="md"
                  variant="outline"
                  disabled={isSubmitting || isValidatingCode}
                  onPress={() => {
                    setBranchMode('patient-manual');
                    setManualPatientStep(0);
                    setManualGuardianRelationshipOption('');
                    setPatientPreview(null);
                    setIsPatientPreviewModalVisible(false);
                    setScreenError('');
                  }}
                  style={[styles.backActionButton, styles.patientCodeSecondaryButton, styles.patientCodeRowButton]}
                  textStyle={[styles.backActionButtonText, styles.patientCodeCompactButtonText, styles.patientCodeOneLineText]}
                  backgroundColorOverride={theme.colors.surfaceCard}
                  borderColorOverride="#b87b44"
                  textColorOverride={roles.primaryActionBackground}
                />
              </View>
              <View style={styles.patientCodeSecondaryHalf}>
                <AppButton
                  title="Back"
                  size="md"
                  variant="outline"
                  onPress={() => {
                    setBranchMode('question');
                    setPatientPreview(null);
                    setIsPatientPreviewModalVisible(false);
                    setPatientCodeError('');
                    setIsPatientCodeErrorModalVisible(false);
                    setScreenError('');
                  }}
                  style={[styles.backActionButton, styles.patientCodeSecondaryButton, styles.patientCodeRowButton]}
                  textStyle={styles.backActionButtonText}
                  backgroundColorOverride={theme.colors.surfaceCard}
                  borderColorOverride="#b87b44"
                  textColorOverride={roles.primaryActionBackground}
                />
              </View>
            </View>
          </View>

          {isPatientCodeErrorModalVisible ? (
            <View pointerEvents="none" style={styles.patientCodeErrorModalRoot}>
              <View style={styles.patientCodeErrorModalCard}>
                <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#b4233a" />
                <Text style={styles.patientCodeErrorModalText} numberOfLines={2}>
                  {patientCodeErrorModalMessage}
                </Text>
              </View>
            </View>
          ) : null}

          {patientPreview && isPatientPreviewModalVisible ? (
            <View style={styles.patientPreviewModalRoot}>
              <Pressable
                style={styles.patientPreviewModalBackdrop}
                onPress={() => setIsPatientPreviewModalVisible(false)}
              />
              <View style={styles.patientPreviewModalCard}>
                <View style={styles.patientPreviewModalHead}>
                  <View style={styles.patientPreviewModalHeadCopy}>
                    <Text style={[styles.patientPreviewModalEyebrow, { color: roles.primaryActionBackground }]}>
                      Patient verified
                    </Text>
                    <Text style={[styles.patientPreviewModalTitle, { color: roles.headingText }]}>
                      Display Patient Details
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setIsPatientPreviewModalVisible(false)}
                    style={styles.patientPreviewModalCloseBtn}
                  >
                    <MaterialCommunityIcons name="close" size={20} color={roles.headingText} />
                  </Pressable>
                </View>

                <Text style={styles.patientPreviewModalBody}>
                  {(patientPreview?.full_name || 'Patient record')} from the{' '}
                  {(patientPreview?.hospital_name || 'selected hospital')}
                </Text>

                <View style={styles.patientPreviewModalMetaRow}>
                  <Text style={styles.patientPreviewModalMetaLabel}>Patient Code</Text>
                  <Text style={styles.patientPreviewModalMetaValue}>
                    {patientPreview?.patient_code || 'Not available'}
                  </Text>
                </View>
                <View style={styles.patientPreviewModalMetaRow}>
                  <Text style={styles.patientPreviewModalMetaLabel}>Hospital</Text>
                  <Text style={styles.patientPreviewModalMetaValue}>
                    {patientPreview?.hospital_name || 'Not available'}
                  </Text>
                </View>

                <Text style={styles.patientPreviewModalNote}>
                  An activation email will be sent to the hospital.
                </Text>

                <View style={styles.patientPreviewModalActions}>
                  <View style={styles.patientPreviewModalActionHalf}>
                    <AppButton
                      title="Use another code"
                      size="md"
                      variant="outline"
                      onPress={() => {
                        setPatientPreview(null);
                        setIsPatientPreviewModalVisible(false);
                        setPatientCode('');
                      }}
                      style={[styles.backActionButton, styles.patientCodeSecondaryButton]}
                      textStyle={styles.backActionButtonText}
                      backgroundColorOverride={theme.colors.surfaceCard}
                      borderColorOverride="#b87b44"
                      textColorOverride={roles.primaryActionBackground}
                    />
                  </View>
                  <View style={styles.patientPreviewModalActionHalf}>
                    <LinearGradient
                      colors={ACTION_BUTTON_BORDER_GRAD}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.continueGradientBorder}
                    >
                      <LinearGradient
                        colors={ACTION_BUTTON_FILL_GRAD}
                        start={{ x: 0.2, y: 0 }}
                        end={{ x: 0.8, y: 1 }}
                        style={styles.continueGradientFill}
                      >
                        <LinearGradient
                          colors={['rgba(255, 246, 222, 0)', 'rgba(255, 246, 222, 0.18)', 'rgba(255, 246, 222, 0)']}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.continueDiagonalShine}
                        />
                        <AppButton
                          title="Continue"
                          size="md"
                          variant="outline"
                          loading={isSubmitting}
                          disabled={isSubmitting}
                          onPress={handleConfirmPatientCode}
                          style={styles.continueButton}
                          textStyle={styles.continueButtonText}
                          backgroundColorOverride="transparent"
                          borderColorOverride="transparent"
                          textColorOverride={roles.primaryActionText}
                        />
                      </LinearGradient>
                    </LinearGradient>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      );
    }

    if (branchMode === 'patient-manual') {
      const patientPictureValue = manualPatientForm.watch('patient_picture');
      const medicalDocumentValue = manualPatientForm.watch('medical_document');
      const manualBirthdateValue = manualPatientForm.watch('birthdate');
      const parentalConsentValue = manualPatientForm.watch('parental_consent');
      const manualGenderValue = manualPatientForm.watch('gender');
      const manualSuffixValue = manualPatientForm.watch('suffix');
      const manualGuardianRelationshipValue = manualPatientForm.watch('guardian_relationship');
      const isManualGuardianRelationshipOther = manualGuardianRelationshipOption === 'Other';
      const manualPatientAge = calculateAgeFromBirthdate(manualBirthdateValue);
      const requiresParentalConsent = manualPatientAge !== null && manualPatientAge < 18;
      const patientPicturePreview = typeof patientPictureValue === 'string' ? patientPictureValue : patientPictureValue?.previewUri || '';
      const medicalDocumentPreview = typeof medicalDocumentValue === 'string' ? medicalDocumentValue : medicalDocumentValue?.previewUri || '';
      const medicalDocumentName = typeof medicalDocumentValue === 'object' ? medicalDocumentValue?.fileName || '' : '';
      const activeMedicalDocumentVerification = getMedicalDocumentVerification(
        medicalDocumentValue,
        medicalDocumentVerification
      );
      const medicalDocumentVerificationStatus = getMedicalDocumentVerificationStatus(
        medicalDocumentValue,
        medicalDocumentVerification
      );
      const isMedicalDocumentVerificationPassed = isMedicalDocumentVerified(
        medicalDocumentValue,
        medicalDocumentVerification
      );
      const canRetryMedicalDocumentVerification = Boolean(medicalDocumentValue)
        && typeof medicalDocumentValue === 'object'
        && Boolean(activeMedicalDocumentVerification)
        && !isMedicalDocumentVerificationPassed
        && !isUploadingMedicalDocument
        && !isSubmitting;
      const medicalDocumentVerificationLabel = isUploadingMedicalDocument
        ? 'Verifying document...'
        : isMedicalDocumentVerificationPassed
          ? 'Certificate verified. Tap to review the scanned record and document.'
          : activeMedicalDocumentVerification?.errorMessage
            ? activeMedicalDocumentVerification.errorMessage
          : activeMedicalDocumentVerification?.missing?.length
            ? `Missing: ${activeMedicalDocumentVerification.missing.join(', ')}`
            : 'Upload or scan the certificate to verify doctor and license details.';
      const medicalDocumentVerificationTitle = medicalDocumentVerificationStatus || isUploadingMedicalDocument
        ? 'Document verification'
        : 'Verification required';
      const hasMedicalDocumentImagePreview = typeof medicalDocumentValue === 'string'
        ? /\.(png|jpe?g|webp|gif)$/i.test(medicalDocumentValue)
        : String(medicalDocumentValue?.contentType || '').startsWith('image/');
      const stepOneValues = manualPatientForm.watch([
        'first_name',
        'last_name',
        'birthdate',
        'gender',
        'contact_number',
        'street',
        'barangay',
        'region',
        'city',
        'province',
        'country',
      ]);
      const stepTwoValues = manualPatientForm.watch([
        'medical_condition',
        'date_of_diagnosis',
        'guardian',
        'guardian_relationship',
        'guardian_contact_number',
      ]);
      const isNonEmpty = (value) => String(value ?? '').trim().length > 0;
      const isStepOneComplete = stepOneValues.every(isNonEmpty)
        && (!requiresParentalConsent || Boolean(parentalConsentValue));
      const isStepTwoComplete = stepTwoValues.every(isNonEmpty);
      const isStepThreeComplete = Boolean(patientPictureValue) && isMedicalDocumentVerificationPassed;
      const isManualNextDisabled = manualPatientStep === 0
        ? !isStepOneComplete
        : manualPatientStep === 1
          ? !isStepTwoComplete
          : !isStepThreeComplete;
      const patientFieldIconColor = roles.primaryActionBackground;
      const patientInputProps = {
        variant: 'default',
        placeholderTextColor: roles.headingText,
        style: styles.patientInputContainer,
        labelStyle: [styles.patientInputLabel, { color: roles.headingText }],
        shellStyle: [
          styles.patientInputShell,
          {
            borderColor: roles.defaultCardBorder,
            backgroundColor: theme.colors.surfaceCard,
          },
        ],
        inputStyle: [styles.patientInputText, { color: roles.headingText }],
      };
      const patientSelectProps = {
        labelStyle: [styles.patientInputLabel, { color: roles.headingText }],
        fieldStyle: [
          styles.patientInputShell,
          {
            borderColor: roles.defaultCardBorder,
            backgroundColor: theme.colors.surfaceCard,
          },
        ],
        valueStyle: [styles.patientInputText, { color: roles.headingText }],
        placeholderStyle: [styles.patientInputText, { color: roles.headingText }],
        helperTextStyle: styles.patientInputHelperText,
        errorTextStyle: styles.patientInputErrorText,
        leftIconColor: patientFieldIconColor,
        rightIconColor: roles.headingText,
      };
      const patientDateProps = {
        containerStyle: styles.patientInputContainer,
        labelStyle: [styles.patientInputLabel, { color: roles.headingText }],
        shellStyle: [
          styles.patientInputShell,
          {
            borderColor: roles.defaultCardBorder,
            backgroundColor: theme.colors.surfaceCard,
          },
        ],
        valueStyle: [styles.patientInputText, { color: roles.headingText }],
        placeholderStyle: [styles.patientInputText, { color: roles.headingText }],
        helperTextStyle: styles.patientInputHelperText,
        errorTextStyle: styles.patientInputErrorText,
        leftIconColor: patientFieldIconColor,
        rightIconColor: roles.headingText,
      };

      return (
        <View style={styles.patientManualPlainSection}>
          <LinearGradient
            colors={['#fffdfc', '#fbf7f5', '#f8f1ef']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.patientManualStickyHeader}
          >
            <View style={styles.stepIndicatorRow}>
              <Text style={[styles.stepIndicator, manualPatientStep === 0 ? styles.stepIndicatorActive : null]}>Step 1</Text>
              <Text style={[styles.stepIndicator, manualPatientStep === 1 ? styles.stepIndicatorActive : null]}>Step 2</Text>
              <Text style={[styles.stepIndicator, manualPatientStep === 2 ? styles.stepIndicatorActive : null]}>Step 3</Text>
            </View>

            <View style={styles.patientManualHeader}>
              <Text style={[styles.patientManualTitle, { color: roles.primaryActionBackground }]}>Patient information</Text>
              <View style={styles.patientManualDivider} />
            </View>
          </LinearGradient>

          <ScrollView
            style={styles.patientManualFormScroll}
            contentContainerStyle={[
              styles.patientManualFormScrollContent,
              manualPatientStep === 2 ? styles.patientManualFormScrollContentCompact : null,
            ]}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
          <View style={manualPatientStep === 0 ? styles.manualStepPanel : styles.manualStepPanelHidden}>
              <Controller
                control={manualPatientForm.control}
                name="first_name"
                defaultValue={getManualPatientFieldValue('first_name')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <AppInput
                    label="First Name"
                    required={true}
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={fieldState.error?.message}
                    placeholder="Enter your first name"
                    leftIcon="account-outline"
                    leftIconColor={patientFieldIconColor}
                    {...patientInputProps}
                  />
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="middle_name"
                defaultValue={getManualPatientFieldValue('middle_name')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <AppInput
                    label="Middle Name"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={fieldState.error?.message}
                    placeholder="Enter your middle name"
                    leftIcon="account-outline"
                    leftIconColor={patientFieldIconColor}
                    {...patientInputProps}
                  />
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="last_name"
                defaultValue={getManualPatientFieldValue('last_name')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <AppInput
                    label="Last Name"
                    required={true}
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={fieldState.error?.message}
                    placeholder="Enter your last name"
                    leftIcon="account-outline"
                    leftIconColor={patientFieldIconColor}
                    {...patientInputProps}
                  />
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="suffix"
                defaultValue={getManualPatientFieldValue('suffix')}
                render={({ fieldState }) => (
                  <>
                    <AddressSelectField
                      label="Suffix"
                      value={manualSuffixValue}
                      placeholder="Select suffix"
                      helperText=""
                      error={fieldState.error?.message}
                      leftIcon="format-letter-case"
                      {...patientSelectProps}
                      onPress={async () => {
                        await Haptics.selectionAsync();
                        setActiveManualPicker('suffix');
                      }}
                    />

                    <AddressOptionSheet
                      visible={activeManualPicker === 'suffix'}
                      title="Select Suffix"
                      placeholder="Search suffix"
                      options={profileSuffixOptions}
                      selectedValue={manualSuffixValue}
                      onClose={() => setActiveManualPicker('')}
                      onSelect={(option) => {
                        manualPatientForm.setValue('suffix', option.value, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        });
                      }}
                    />
                  </>
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="birthdate"
                defaultValue={getManualPatientFieldValue('birthdate')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <DatePickerField
                    label="Birthdate"
                    required={true}
                    value={value ?? ''}
                    placeholder="Select your birthdate"
                    helperText=""
                    error={fieldState.error?.message}
                    onChange={onChange}
                    onBlur={onBlur}
                    minimumDate={MINIMUM_BIRTHDATE}
                    maximumDate={getMaximumBirthdate()}
                    onPress={() => Haptics.selectionAsync()}
                    leftIcon="calendar-month-outline"
                    {...patientDateProps}
                  />
                )}
              />

              {requiresParentalConsent ? (
                <Controller
                  control={manualPatientForm.control}
                  name="parental_consent"
                  defaultValue={Boolean(getManualPatientFieldValue('parental_consent'))}
                  render={({ fieldState }) => (
                    <View style={styles.parentalConsentBlock}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={parentalConsentValue ? 'Review confirmed guardian consent' : 'Open required guardian consent'}
                        accessibilityState={{ disabled: isSubmitting }}
                        disabled={isSubmitting}
                        onPress={() => setIsMinorConsentModalVisible(true)}
                        android_ripple={{ color: theme.colors.surfacePressed, borderless: false }}
                        style={[
                          styles.parentalConsentRow,
                          {
                            backgroundColor: parentalConsentValue ? '#EAF8EF' : '#FFF4D8',
                            borderColor: parentalConsentValue ? '#BFE8CD' : '#F2D38B',
                          },
                          fieldState.error ? styles.parentalConsentRowError : null,
                        ]}
                      >
                        <View
                          style={[
                            styles.parentalConsentIcon,
                            { backgroundColor: parentalConsentValue ? 'rgba(30, 122, 66, 0.10)' : 'rgba(138, 90, 0, 0.10)' },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name={parentalConsentValue ? 'shield-check-outline' : 'shield-account-outline'}
                            size={19}
                            color={parentalConsentValue ? '#1E7A42' : '#8A5A00'}
                          />
                        </View>
                        <View style={styles.parentalConsentCopy}>
                          <Text style={[styles.parentalConsentEyebrow, { color: parentalConsentValue ? '#1E7A42' : '#8A5A00' }]}>MINOR ACCOUNT</Text>
                          <Text style={[styles.parentalConsentTitle, { color: parentalConsentValue ? '#1E7A42' : '#8A5A00' }]}>
                            {parentalConsentValue ? 'Guardian consent confirmed' : 'Guardian consent required'}
                          </Text>
                          <Text style={styles.parentalConsentText}>
                            {parentalConsentValue
                              ? 'Consent is recorded. Tap to review the document again.'
                              : 'A parent or legal guardian must review and confirm the consent document.'}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.parentalConsentAction,
                            { backgroundColor: parentalConsentValue ? 'rgba(30, 122, 66, 0.10)' : 'rgba(138, 90, 0, 0.10)' },
                          ]}
                        >
                          <MaterialCommunityIcons name="chevron-right" size={18} color={parentalConsentValue ? '#1E7A42' : '#8A5A00'} />
                        </View>
                      </Pressable>
                      {fieldState.error?.message ? (
                        <Text style={styles.parentalConsentError}>{fieldState.error.message}</Text>
                      ) : null}
                    </View>
                  )}
                />
              ) : null}

              <Controller
                control={manualPatientForm.control}
                name="gender"
                defaultValue={getManualPatientFieldValue('gender')}
                render={({ fieldState }) => (
                  <>
                    <AddressSelectField
                      label="Gender"
                      required={true}
                      value={manualGenderValue}
                      placeholder="Select gender"
                      helperText=""
                      error={fieldState.error?.message}
                      leftIcon="human-male-female"
                      {...patientSelectProps}
                      onPress={async () => {
                        await Haptics.selectionAsync();
                        setActiveManualPicker('gender');
                      }}
                    />

                    <AddressOptionSheet
                      visible={activeManualPicker === 'gender'}
                      title="Select Gender"
                      placeholder="Search gender"
                      options={profileGenderOptions}
                      selectedValue={manualGenderValue}
                      onClose={() => setActiveManualPicker('')}
                      onSelect={(option) => {
                        manualPatientForm.setValue('gender', option.value, {
                          shouldDirty: true,
                          shouldTouch: true,
                          shouldValidate: true,
                        });
                      }}
                    />
                  </>
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="contact_number"
                defaultValue={getManualPatientFieldValue('contact_number')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <AppInput
                    label="Contact Number"
                    required={true}
                    value={value ?? ''}
                    onChangeText={(nextValue) => onChange(formatPhilippineMobileInput(nextValue))}
                    onBlur={onBlur}
                    error={fieldState.error?.message}
                    placeholder="09123456789"
                    keyboardType="phone-pad"
                    maxLength={11}
                    leftIcon="phone-outline"
                    leftIconColor={patientFieldIconColor}
                    {...patientInputProps}
                  />
                )}
              />

              <SignupAddressSection
                control={manualPatientForm.control}
                errors={manualPatientForm.formState.errors}
                setValue={manualPatientForm.setValue}
                showHeader={false}
                showHelperText={false}
                showTopBorder={false}
                inputProps={{
                  ...patientInputProps,
                  leftIconColor: patientFieldIconColor,
                }}
                selectProps={patientSelectProps}
                countryInputProps={{
                  helperText: '',
                }}
              />
          </View>

          <View style={manualPatientStep === 1 ? styles.manualStepPanel : styles.manualStepPanelHidden}>
              <Controller
                control={manualPatientForm.control}
                name="medical_condition"
                defaultValue={getManualPatientFieldValue('medical_condition')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <AppInput
                    label="Medical Condition"
                    required={true}
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={fieldState.error?.message}
                    placeholder="Enter the medical condition"
                    leftIcon="heart-pulse"
                    leftIconColor={patientFieldIconColor}
                    {...patientInputProps}
                  />
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="date_of_diagnosis"
                defaultValue={getManualPatientFieldValue('date_of_diagnosis')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <DatePickerField
                    label="Date of Diagnosis"
                    required={true}
                    value={value ?? ''}
                    placeholder="Select diagnosis date"
                    helperText=""
                    error={fieldState.error?.message}
                    onChange={onChange}
                    onBlur={onBlur}
                    minimumDate={MINIMUM_DIAGNOSIS_DATE}
                    maximumDate={getMaximumDiagnosisDate()}
                    onPress={() => Haptics.selectionAsync()}
                    leftIcon="calendar-check-outline"
                    {...patientDateProps}
                  />
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="guardian"
                defaultValue={getManualPatientFieldValue('guardian')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <AppInput
                    label="Guardian"
                    required={true}
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={fieldState.error?.message}
                    placeholder="Enter guardian name"
                    leftIcon="account-heart-outline"
                    leftIconColor={patientFieldIconColor}
                    {...patientInputProps}
                  />
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="guardian_contact_number"
                defaultValue={getManualPatientFieldValue('guardian_contact_number')}
                render={({ field: { onChange, onBlur, value }, fieldState }) => (
                  <AppInput
                    label="Guardian Contact Number"
                    required={true}
                    value={value ?? ''}
                    onChangeText={(nextValue) => onChange(formatPhilippineMobileInput(nextValue))}
                    onBlur={onBlur}
                    error={fieldState.error?.message}
                    placeholder="09123456789"
                    keyboardType="phone-pad"
                    maxLength={11}
                    leftIcon="phone-outline"
                    leftIconColor={patientFieldIconColor}
                    {...patientInputProps}
                  />
                )}
              />

              <Controller
                control={manualPatientForm.control}
                name="guardian_relationship"
                defaultValue={getManualPatientFieldValue('guardian_relationship')}
                render={({ fieldState }) => (
                  <>
                    <AddressSelectField
                      label="Guardian Relationship"
                      required={true}
                      value={manualGuardianRelationshipOption}
                      placeholder="Select relationship"
                      helperText=""
                      error={fieldState.error?.message}
                      leftIcon="account-multiple-outline"
                      {...patientSelectProps}
                      onPress={async () => {
                        await Haptics.selectionAsync();
                        setActiveManualPicker('guardianRelationship');
                      }}
                    />

                    <AddressOptionSheet
                      visible={activeManualPicker === 'guardianRelationship'}
                      title="Select Relationship"
                      placeholder="Search relationship"
                      options={guardianRelationshipOptions}
                      selectedValue={manualGuardianRelationshipValue}
                      onClose={() => setActiveManualPicker('')}
                      onSelect={(option) => {
                        setManualGuardianRelationshipOption(option.value);

                        manualPatientForm.setValue(
                          'guardian_relationship',
                          option.value === 'Other' ? '' : option.value,
                          {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                          }
                        );
                      }}
                    />
                  </>
                )}
              />

              {isManualGuardianRelationshipOther ? (
                <Controller
                  control={manualPatientForm.control}
                  name="guardian_relationship"
                  defaultValue={getManualPatientFieldValue('guardian_relationship')}
                  render={({ field: { onChange, onBlur, value }, fieldState }) => (
                    <AppInput
                      label="Other Relationship"
                      required={true}
                      value={value ?? ''}
                      onChangeText={onChange}
                      onBlur={onBlur}
                      error={fieldState.error?.message}
                      placeholder="Enter relationship"
                      leftIcon="account-switch-outline"
                      leftIconColor={patientFieldIconColor}
                      {...patientInputProps}
                    />
                  )}
                />
              ) : null}

          </View>

          <View style={manualPatientStep === 2 ? styles.manualStepPanel : styles.manualStepPanelHidden}>
            <View style={styles.uploadSection}>
              <View style={styles.uploadFieldCard}>
                <Text style={[styles.patientInputLabel, { color: roles.headingText }]}>Patient Photo</Text>
                <View
                  style={[
                    styles.uploadFieldShell,
                    {
                      borderColor: roles.defaultCardBorder,
                      backgroundColor: theme.colors.surfaceCard,
                    },
                  ]}
                >
                  <View style={styles.uploadCardCopy}>
                    <MaterialCommunityIcons name="account-box-outline" size={22} color={roles.primaryActionBackground} />
                    <View style={styles.uploadCardTextGroup}>
                      <Text style={[styles.uploadCardTitle, { color: roles.headingText }]}>Add photo</Text>
                      <Text style={styles.uploadCardHint}>
                        Upload a clear face photo for patient identification.
                      </Text>
                    </View>
                  </View>
                  <AppButton
                    title={patientPictureValue ? 'Change' : 'Upload'}
                    size="sm"
                    variant="outline"
                    fullWidth={false}
                    style={styles.uploadActionButton}
                    loading={isUploadingPatientPicture}
                    disabled={isUploadingPatientPicture || isSubmitting}
                    onPress={() => pickManualPatientAsset('patient_picture', setIsUploadingPatientPicture)}
                    backgroundColorOverride={theme.colors.surfaceCard}
                    borderColorOverride="#b87b44"
                    textColorOverride={roles.primaryActionBackground}
                  />
                </View>
              </View>

              {patientPictureValue ? (
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Open patient photo preview"
                  onPress={() => setManualImagePreview({
                    uri: patientPicturePreview,
                    title: 'Patient Photo',
                  })}
                  style={({ pressed }) => [
                    styles.uploadPreviewButton,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Image source={{ uri: patientPicturePreview }} style={styles.uploadPreviewImage} />
                  <View style={styles.uploadPreviewHint}>
                    <MaterialCommunityIcons name="magnify-plus-outline" size={16} color="#ffffff" />
                  </View>
                </Pressable>
              ) : null}

              <View style={styles.uploadFieldCard}>
                <Text style={[styles.patientInputLabel, { color: roles.headingText }]}>Medical Document</Text>
                <View
                  style={[
                    styles.uploadFieldShell,
                    styles.uploadFieldShellStacked,
                    {
                      borderColor: roles.defaultCardBorder,
                      backgroundColor: theme.colors.surfaceCard,
                    },
                  ]}
                >
                  <View style={[styles.uploadCardCopy, styles.uploadCardCopyStacked]}>
                    <MaterialCommunityIcons name="file-document-outline" size={22} color={roles.primaryActionBackground} />
                    <View style={styles.uploadCardTextGroup}>
                      <Text style={[styles.uploadCardTitle, { color: roles.headingText }]}>Verify certificate</Text>
                      <Text style={styles.uploadCardHint}>
                        Upload a PDF/image or scan the certificate with the camera.
                      </Text>
                    </View>
                  </View>
                  <View style={styles.uploadActionGroup}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={medicalDocumentValue ? 'Change medical certificate' : 'Upload medical certificate'}
                      disabled={isUploadingMedicalDocument || isSubmitting}
                      onPress={() => pickManualPatientAsset('medical_document', setIsUploadingMedicalDocument)}
                      style={({ pressed }) => [
                        styles.documentActionButton,
                        isUploadingMedicalDocument || isSubmitting ? styles.documentActionButtonDisabled : null,
                        pressed ? styles.documentActionButtonPressed : null,
                      ]}
                    >
                      <LinearGradient
                        colors={[theme.colors.palette.wine600, theme.colors.palette.wine800, theme.colors.palette.wine900]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.documentActionGradient}
                      >
                        {isUploadingMedicalDocument ? (
                          <ActivityIndicator size="small" color={roles.primaryActionText} />
                        ) : (
                          <MaterialCommunityIcons
                            name={medicalDocumentValue ? 'file-replace-outline' : 'file-upload-outline'}
                            size={19}
                            color={roles.primaryActionText}
                          />
                        )}
                        <Text style={[styles.documentActionText, { color: roles.primaryActionText }]}>{isUploadingMedicalDocument ? 'Processing' : medicalDocumentValue ? 'Change' : 'Upload'}</Text>
                      </LinearGradient>
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Scan medical certificate with camera"
                      disabled={isUploadingMedicalDocument || isSubmitting}
                      onPress={scanManualPatientMedicalDocument}
                      style={({ pressed }) => [
                        styles.documentActionButton,
                        isUploadingMedicalDocument || isSubmitting ? styles.documentActionButtonDisabled : null,
                        pressed ? styles.documentActionButtonPressed : null,
                      ]}
                    >
                      <LinearGradient
                        colors={[theme.colors.palette.wine800, theme.colors.palette.wine700, theme.colors.palette.wine600]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.documentActionGradient}
                      >
                        <MaterialCommunityIcons name="line-scan" size={19} color={roles.primaryActionText} />
                        <Text style={[styles.documentActionText, { color: roles.primaryActionText }]}>Scan</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                </View>
              </View>

              {medicalDocumentValue && hasMedicalDocumentImagePreview ? (
                <Pressable
                  accessibilityRole="imagebutton"
                  accessibilityLabel="Open medical document preview"
                  onPress={() => setManualImagePreview({
                    uri: medicalDocumentPreview,
                    title: 'Medical Document',
                  })}
                  style={({ pressed }) => [
                    styles.uploadPreviewButton,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Image source={{ uri: medicalDocumentPreview }} style={styles.uploadPreviewImage} />
                  <View style={styles.uploadPreviewHint}>
                    <MaterialCommunityIcons name="magnify-plus-outline" size={16} color="#ffffff" />
                  </View>
                </Pressable>
              ) : medicalDocumentValue ? (
                <View style={styles.filePreviewRow}>
                  <MaterialCommunityIcons name="file-check-outline" size={20} color={roles.primaryActionBackground} />
                  <Text style={styles.filePreviewText} numberOfLines={1}>
                    {medicalDocumentName || 'File selected'}
                  </Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole={isMedicalDocumentVerificationPassed ? 'button' : undefined}
                accessibilityLabel={isMedicalDocumentVerificationPassed ? 'Open verified medical record details' : undefined}
                disabled={!isMedicalDocumentVerificationPassed}
                onPress={() => setIsMedicalVerificationModalVisible(true)}
                android_ripple={isMedicalDocumentVerificationPassed
                  ? { color: theme.colors.surfacePressed, borderless: false }
                  : undefined}
                style={[
                  styles.documentVerificationRow,
                  isMedicalDocumentVerificationPassed ? styles.documentVerificationRowSuccess : null,
                  activeMedicalDocumentVerification && !isMedicalDocumentVerificationPassed
                    ? styles.documentVerificationRowError
                    : null,
                ]}
              >
                <MaterialCommunityIcons
                  name={isMedicalDocumentVerificationPassed ? 'check-circle-outline' : 'shield-search'}
                  size={18}
                  color={isMedicalDocumentVerificationPassed ? '#2f6b45' : roles.primaryActionBackground}
                />
                <View style={styles.documentVerificationTextGroup}>
                  <Text
                    style={[
                      styles.documentVerificationTitle,
                      isMedicalDocumentVerificationPassed ? styles.documentVerificationTitleSuccess : null,
                    ]}
                  >
                    {medicalDocumentVerificationTitle}
                  </Text>
                  <Text style={styles.documentVerificationText}>
                    {medicalDocumentVerificationLabel}
                  </Text>
                  {canRetryMedicalDocumentVerification ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={isUploadingMedicalDocument || isSubmitting}
                      onPress={retryManualPatientMedicalDocumentVerification}
                      style={({ pressed }) => [
                        styles.documentRetryButton,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <MaterialCommunityIcons name="refresh" size={16} color={roles.primaryActionBackground} />
                      <Text style={[styles.documentRetryText, { color: roles.primaryActionBackground }]}>
                        Retry verification
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {isMedicalDocumentVerificationPassed ? (
                  <View style={styles.documentVerificationOpenAction}>
                    <MaterialCommunityIcons name="chevron-right" size={18} color="#2f6b45" />
                  </View>
                ) : null}
              </Pressable>

              {screenError ? (
                <Text style={styles.errorText}>{screenError}</Text>
              ) : null}
            </View>
          </View>

          {screenError && branchMode !== 'patient-manual' ? (
            <Text style={styles.errorText}>{screenError}</Text>
          ) : null}
          </ScrollView>

          {manualImagePreview?.uri ? (
            <View style={styles.manualImagePreviewRoot}>
              <Pressable
                style={styles.manualImagePreviewBackdrop}
                onPress={() => setManualImagePreview(null)}
              />
              <View style={styles.manualImagePreviewHeader}>
                <Text style={styles.manualImagePreviewTitle}>{manualImagePreview.title || 'Preview'}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close image preview"
                  onPress={() => setManualImagePreview(null)}
                  style={styles.manualImagePreviewClose}
                >
                  <MaterialCommunityIcons name="close" size={22} color="#ffffff" />
                </Pressable>
              </View>
              <Image
                source={{ uri: manualImagePreview.uri }}
                style={styles.manualImagePreviewImage}
                resizeMode="contain"
              />
            </View>
          ) : null}

          <View
            style={[
              styles.manualStickyActionBar,
              {
                bottom: 0,
                paddingBottom: 0,
              },
            ]}
          >
            <View style={styles.manualStepActionRow}>
              <View style={styles.manualStepActionHalf}>
                <AppButton
                  title="Back"
                  size="md"
                  variant="outline"
                  onPress={() => {
                    if (manualPatientStep > 0) {
                      setManualPatientStep((currentStep) => Math.max(currentStep - 1, 0));
                      setScreenError('');
                      return;
                    }

                    setBranchMode('patient-code');
                    setManualPatientStep(0);
                    setManualGuardianRelationshipOption('');
                    setMedicalDocumentVerification(null);
                    setScreenError('');
                  }}
                  style={[styles.backActionButton, styles.patientCodeSecondaryButton, styles.manualStepCompactButton]}
                  textStyle={styles.backActionButtonText}
                  backgroundColorOverride={theme.colors.surfaceCard}
                  borderColorOverride="#b87b44"
                  textColorOverride={roles.primaryActionBackground}
                />
              </View>

              <LinearGradient
                colors={ACTION_BUTTON_BORDER_GRAD}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={[styles.continueGradientBorder, styles.manualStepActionHalf]}
              >
                <LinearGradient
                  colors={ACTION_BUTTON_FILL_GRAD}
                  start={{ x: 0.2, y: 0 }}
                  end={{ x: 0.8, y: 1 }}
                  style={styles.continueGradientFill}
                >
                  <LinearGradient
                    colors={['rgba(255, 246, 222, 0)', 'rgba(255, 246, 222, 0.18)', 'rgba(255, 246, 222, 0)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.continueDiagonalShine}
                  />
                  {manualPatientStep < 2 ? (
                    <AppButton
                      title="Next"
                      size="md"
                      variant="outline"
                      disabled={isSubmitting || isManualNextDisabled}
                      onPress={handleManualPatientNext}
                      style={[styles.continueButton, styles.manualStepCompactButton]}
                      textStyle={styles.continueButtonText}
                      backgroundColorOverride="transparent"
                      borderColorOverride="transparent"
                      textColorOverride={roles.primaryActionText}
                    />
                  ) : (
                    <AppButton
                      title="Continue"
                      size="md"
                      variant="outline"
                      loading={isSubmitting}
                      disabled={isSubmitting || isUploadingPatientPicture || isUploadingMedicalDocument || isManualNextDisabled}
                      onPress={manualPatientForm.handleSubmit(handleManualPatientSubmit, handleManualPatientInvalid)}
                      style={[styles.continueButton, styles.manualStepCompactButton]}
                      textStyle={styles.continueButtonText}
                      backgroundColorOverride="transparent"
                      borderColorOverride="transparent"
                      textColorOverride={roles.primaryActionText}
                    />
                  )}
                </LinearGradient>
              </LinearGradient>
            </View>
          </View>
        </View>
      );
    }

    const roleOptions = [
      {
        key: 'donor',
        eyebrow: 'DONOR PATH',
        title: 'Donate Hair',
        description: 'Check your hair eligibility and begin a donation journey.',
        icon: 'content-cut',
        onPress: async () => {
          await Haptics.selectionAsync();
          setBranchMode('donor-info');
          setScreenError('');
        },
      },
      {
        key: 'patient',
        eyebrow: 'PATIENT PATH',
        title: 'I Need a Wig',
        description: 'Request a wig or hair prosthesis for medical support.',
        icon: 'account-heart-outline',
        onPress: async () => {
          await Haptics.selectionAsync();
          setBranchMode('patient-code');
          setScreenError('');
        },
      },
    ];

    const isDisabled = !isIntroReady || isSubmitting;

    return (
      <View style={styles.pathSection}>
        <View style={styles.pathIntro}>
          <View style={[styles.pathIconWrap, { backgroundColor: roles.iconPrimarySurface }]}>
            <MaterialCommunityIcons
              name="account-switch-outline"
              size={25}
              color={roles.primaryActionBackground}
            />
          </View>
          <Text style={[styles.pathEyebrow, { color: roles.primaryActionBackground }]}>CHOOSE YOUR PATH</Text>
          <Text style={[styles.pathHeading, { color: roles.headingText }]}>How will you use Donivra?</Text>
          <Text style={[styles.pathSubheading, { color: roles.bodyText }]}>Select the option that best matches what you need today.</Text>
        </View>

        <View style={styles.choiceStack}>
          {roleOptions.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityLabel={option.title}
              disabled={isDisabled}
              onPress={option.onPress}
              style={({ pressed }) => [
                styles.choicePressable,
                {
                  opacity: isDisabled ? 0.60 : pressed ? 0.88 : 1,
                  transform: [{ scale: pressed && !isDisabled ? 0.985 : 1 }],
                },
              ]}
            >
              <LinearGradient
                colors={option.key === 'donor'
                  ? [roles.defaultCardBackground, roles.iconPrimarySurface]
                  : [roles.defaultCardBackground, roles.supportCardBackground]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.choiceCard, { borderColor: roles.defaultCardBorder }]}
              >
                <View style={[styles.choiceAccent, { backgroundColor: roles.primaryActionBackground }]} />

                <View style={[styles.choiceIconBadge, { backgroundColor: roles.primaryActionBackground }]}>
                  <MaterialCommunityIcons name={option.icon} size={25} color={roles.primaryActionText} />
                </View>

                <View style={styles.choiceTextGroup}>
                  <Text style={[styles.choiceEyebrow, { color: roles.primaryActionBackground }]}>{option.eyebrow}</Text>
                  <Text style={[styles.choiceTitle, { color: roles.headingText }]}>{option.title}</Text>
                  <Text numberOfLines={2} style={[styles.choiceDesc, { color: roles.bodyText }]}>{option.description}</Text>
                </View>

                <View style={[styles.choiceArrow, { backgroundColor: roles.iconPrimarySurface }]}>
                  <MaterialCommunityIcons name="arrow-right" size={19} color={roles.primaryActionBackground} />
                </View>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
      </View>
    );
  };

  const brandName  = resolvedTheme?.brandName    || 'Donivra';
  const brandTagline = resolvedTheme?.brandTagline || 'Where Hair Becomes Hope';

  return (
    <ScreenContainer
      scrollable={branchMode !== 'patient-manual'}
      safeArea={false}
      variant="auth"
      keyboardAvoidingEnabled={branchMode !== 'patient-manual'}
      contentStyle={[styles.obScreenContent, { backgroundColor: theme.colors.surfaceCard }]}
    >
      <View style={styles.obPage}>

        {/* ── Dark wine hero — same system as login/signup ─────── */}
        <LinearGradient
          colors={['#0d0205', '#1e0508', '#360b12', '#4b1020']}
          start={{ x: 0.25, y: 0 }}
          end={{ x: 0.75, y: 1 }}
          style={styles.obHero}
        >
          <View style={styles.obHeroRingLg} pointerEvents="none" />
          <View style={styles.obHeroRingSm} pointerEvents="none" />
          <View style={styles.obHeroArc} pointerEvents="none" />

          <BadgeLogo resolvedTheme={resolvedTheme} />

          {/* "Welcome to Donivra" fades in, then cross-fades to "Get started" */}
          <Animated.Text
            style={[
              styles.obHeroBrand,
              resolvedTheme?.secondaryFontFamily
                ? { fontFamily: resolvedTheme.secondaryFontFamily }
                : null,
              { opacity: welcomeOpacity },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {brandName
              ? `Welcome to ${brandName}`
              : 'Welcome'}
          </Animated.Text>

          <Animated.Text
            style={[
              styles.obHeroBrand,
              resolvedTheme?.secondaryFontFamily
                ? { fontFamily: resolvedTheme.secondaryFontFamily }
                : null,
              { opacity: startOpacity },
            ]}
          >
            Get started
          </Animated.Text>

          <Text style={styles.obHeroTagline}>{brandTagline}</Text>
        </LinearGradient>

        {/* ── White form panel ─────────────────────────────────── */}
        <LinearGradient
          colors={['#ffffff', '#f4efee', '#ebe4e1']}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.obFormPanel}
        >

          {isIntroReady ? renderOnboardingCard() : <View style={styles.introSpacer} />}

          {screenError ? (
            <Text style={styles.errorText}>{screenError}</Text>
          ) : null}

        </LinearGradient>
      </View>

      <MinorPatientConsentModal
        visible={isMinorConsentModalVisible}
        roles={roles}
        document={minorConsentDocument}
        isLoading={isLoadingMinorConsent}
        error={minorConsentError}
        onRetry={loadMinorConsentDocument}
        onCancel={() => setIsMinorConsentModalVisible(false)}
        onConfirm={async () => {
          manualPatientForm.setValue('parental_consent', true, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true,
          });
          setScreenError('');
          setIsMinorConsentModalVisible(false);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
      />

      <MedicalVerificationResultModal
        visible={isMedicalVerificationModalVisible}
        roles={roles}
        verification={getMedicalDocumentVerification(watchedMedicalDocument, medicalDocumentVerification)}
        documentValue={watchedMedicalDocument}
        onClose={() => setIsMedicalVerificationModalVisible(false)}
        onReviewMismatchStep={(stepNumber) => {
          setIsMedicalVerificationModalVisible(false);
          setManualPatientStep(stepNumber - 1);
          setScreenError(`Update the Step ${stepNumber} information so it matches the certificate, then verify the document again.`);
        }}
      />
    </ScreenContainer>
  );
}

export default function LandingScreen() {
  const { user, needsOnboarding, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!user) {
    return <Redirect href="/auth/access" />;
  }

  if (needsOnboarding) {
    return <FirstTimeOnboarding />;
  }

  return null;
}

const styles = StyleSheet.create({

  // ── LoadingState ─────────────────────────────────────────────────
  loadShell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0205',
  },
  loadRing1: {
    position: 'absolute',
    width: 300, height: 300, borderRadius: 150,
    borderWidth: 1, borderColor: 'rgba(160, 55, 55, 0.16)',
    top: '50%', left: '50%', marginTop: -150, marginLeft: -150,
  },
  loadRing2: {
    position: 'absolute',
    width: 460, height: 460, borderRadius: 230,
    borderWidth: 1, borderColor: 'rgba(140, 45, 45, 0.09)',
    top: '50%', left: '50%', marginTop: -230, marginLeft: -230,
  },
  loadBrand: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 30,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 1.0,
    marginTop: 18,
    textAlign: 'center',
  },
  loadTagline: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: '300',
    color: 'rgba(240, 215, 200, 0.55)',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    marginTop: 6,
    textAlign: 'center',
  },

  // ── BadgeLogo ──────────────────────────────────────────────────
  badgeOuter: {
    width: 80, height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    elevation: 20,
    shadowColor: '#b8622a',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.80,
    shadowRadius: 18,
  },
  badgeInner: {
    width: 68, height: 68,
    borderRadius: 15,
    backgroundColor: '#1e0508',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePlate: {
    width: 50, height: 50,
    borderRadius: 12,
    backgroundColor: '#fff7f3',
    borderWidth: 1,
    borderColor: 'rgba(176, 122, 70, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeImg: {
    width: 38, height: 38,
  },

  // ── FirstTimeOnboarding layout ────────────────────────────────
  obScreenContent: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  obPage: {
    flex: 1,
    width: '100%',
    backgroundColor: theme.colors.surfaceCard,
  },
  obHero: {
    minHeight: 220,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 42,
    overflow: 'hidden',
    gap: 8,
  },
  obHeroRingLg: {
    position: 'absolute',
    width: 340, height: 340, borderRadius: 170,
    borderWidth: 1, borderColor: 'rgba(150, 30, 46, 0.28)',
    top: -190, right: -100,
  },
  obHeroRingSm: {
    position: 'absolute',
    width: 180, height: 180, borderRadius: 90,
    borderWidth: 1, borderColor: 'rgba(210, 90, 110, 0.14)',
    top: 8, left: -88,
  },
  obHeroArc: {
    position: 'absolute',
    width: 460, height: 200, borderRadius: 200,
    borderWidth: 1, borderColor: 'rgba(185, 38, 57, 0.18)',
    bottom: -88, left: -38,
    transform: [{ rotate: '-8deg' }],
  },
  obHeroBrand: {
    fontSize: 28,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: 0.6,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 34,
  },
  obHeroTagline: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: '300',
    color: 'rgba(240, 215, 200, 0.58)',
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  obFormPanel: {
    marginTop: -22,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: 0,
    flex: 1,
  },

  // ── Role-choice tiles ─────────────────────────────────────────
  pathSection: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
  },
  pathIntro: {
    width: '100%',
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  pathIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  pathEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  pathHeading: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  pathSubheading: {
    maxWidth: 310,
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    textAlign: 'center',
  },
  choiceStack: {
    width: '100%',
    gap: theme.spacing.md,
  },
  choicePressable: {
    width: '100%',
    borderRadius: 22,
    ...theme.shadows.card,
  },
  choiceCard: {
    width: '100%',
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingLeft: theme.spacing.lg,
    paddingRight: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  choiceAccent: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 16,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  choiceIconBadge: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    ...theme.shadows.soft,
  },
  choiceTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  choiceEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 8,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
  },
  choiceTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.tight,
  },
  choiceDesc: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  choiceArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // ── Legacy / ScreenContainer ───────────────────────────────────
  screenContent: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xxl,
    paddingVertical: theme.spacing.xxl,
  },
  landingCard: {
    width: '100%',
    maxWidth: 356,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xxxl,
  },
  landingBrandCluster: {
    width: '100%',
    alignItems: 'center',
    gap: theme.spacing.xl,
  },
  landingGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  landingPage: {
    width: '100%',
    minHeight: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  landingBackdropOrbLarge: {
    position: 'absolute',
    top: -120,
    right: -80,
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.08,
  },
  landingBackdropOrbSmall: {
    position: 'absolute',
    bottom: -72,
    left: -44,
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.1,
  },
  landingTopBar: {
    width: '100%',
    minHeight: 56,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    gap: theme.spacing.sm,
  },
  landingBrandBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    flexShrink: 1,
  },
  landingBrandText: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  landingTopPill: {
    minHeight: 28,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  landingTopPillText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.medium,
  },
  landingContent: {
    width: '100%',
    maxWidth: 980,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  landingHeroSection: {
    width: '100%',
    gap: theme.spacing.md,
  },
  landingPrimaryCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: theme.radius.xxl,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    shadowColor: theme.colors.palette.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  landingEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  landingTitle: {
    fontSize: 31,
    lineHeight: 38,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  landingSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  landingChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  landingChip: {
    minHeight: 32,
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  landingChipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.medium,
  },
  landingActionStack: {
    width: '100%',
    gap: theme.spacing.sm,
  },
  landingButtonPrimary: {
    minHeight: 48,
    borderRadius: theme.radius.lg,
  },
  landingButtonSecondary: {
    minHeight: 48,
    borderRadius: theme.radius.lg,
  },
  landingButtonText: {
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  landingVisualCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: theme.radius.xxl,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  landingVisualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  landingVisualIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  landingVisualHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  landingVisualTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
  },
  landingVisualSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  landingTimeline: {
    gap: theme.spacing.md,
  },
  landingTimelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  landingTimelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  landingTimelineCopy: {
    flex: 1,
    gap: 2,
  },
  landingTimelineTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  landingTimelineBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  landingFeatureGrid: {
    width: '100%',
    gap: theme.spacing.sm,
  },
  landingFeatureCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: theme.radius.xl,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  landingFeatureIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  landingFeatureTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
  },
  landingFeatureBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  landingFooter: {
    width: '100%',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderWidth: 1,
    borderRadius: theme.radius.xl,
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  landingFooterBrand: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
  },
  landingFooterText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  logoWrap: {
    width: 104,
    height: 104,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  logo: {
    width: 64,
    height: 64,
  },
  logoPlain: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  brandName: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.titleSm,
    lineHeight: theme.typography.compact.titleSm * theme.typography.lineHeights.tight,
    color: theme.colors.textPrimary,
    textAlign: 'center',
  },
  copyBlock: {
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  heroTitle: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    color: theme.colors.textPrimary,
  },
  heroSubtitle: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
    maxWidth: 300,
  },
  introSpacer: {
    minHeight: 220,
  },
  onboardingCard: {
    width: '100%',
    overflow: 'visible',
  },
  donorInfoPlainSection: {
    width: '100%',
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  donorInfoIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  donorInfoQuestionHighlight: {
    fontWeight: theme.typography.weights.bold,
  },
  patientCodeCard: {
    backgroundColor: '#ffffff',
  },
  patientCodePlainSection: {
    width: '100%',
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  patientManualPlainSection: {
    flex: 1,
    position: 'relative',
    width: '100%',
    paddingHorizontal: theme.spacing.xs,
    paddingTop: theme.spacing.sm,
    paddingBottom: 0,
  },
  patientManualFormScroll: {
    flex: 1,
    width: '100%',
  },
  patientManualFormScrollContent: {
    paddingBottom: 170,
  },
  patientManualFormScrollContentCompact: {
    paddingBottom: 104,
  },
  patientManualStickyHeader: {
    width: '100%',
    zIndex: 30,
    paddingTop: 2,
    paddingHorizontal: theme.spacing.xs,
    paddingBottom: theme.spacing.md,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    overflow: 'hidden',
  },
  patientInputLabel: {
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  patientInputContainer: {
    marginBottom: theme.spacing.sm,
    minHeight: 0,
  },
  patientInputShell: {
    minHeight: 52,
    borderRadius: 16,
    shadowOpacity: 0,
    elevation: 0,
  },
  patientInputText: {
    fontSize: theme.typography.semantic.body,
  },
  patientInputHelperText: {
    marginTop: 4,
  },
  patientInputErrorText: {
    marginTop: 4,
  },
  patientCodeSecondaryButton: {
    borderWidth: 1.4,
  },
  patientCodeSecondaryRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
  },
  patientCodeSecondaryHalf: {
    flex: 1,
  },
  patientCodeErrorModalRoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    zIndex: 30,
  },
  patientCodeErrorModalCard: {
    width: '100%',
    maxWidth: 460,
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: '#2f2f32',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 8,
  },
  patientCodeErrorModalText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: '#ffffff',
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.snug,
  },
  donorInfoSecondaryButton: {
    borderWidth: 1.4,
  },
  startupCard: {
    maxWidth: 328,
    alignSelf: 'center',
  },
  startupHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  startupQuestion: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.tight,
    color: theme.colors.textPrimary,
  },
  onboardingSection: {
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  patientCodeIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  onboardingQuestion: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
  },
  patientCodeQuestionHighlight: {
    fontWeight: theme.typography.weights.bold,
  },
  onboardingBody: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  stepIndicatorRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  stepIndicator: {
    flex: 1,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: '#efebe9',
    color: '#6f6661',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  stepIndicatorActive: {
    backgroundColor: '#6e0719',
    color: '#fffaf7',
  },
  patientManualHeader: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 0,
  },
  patientManualTitle: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: theme.typography.weights.semibold,
  },
  patientManualDivider: {
    width: 54,
    height: 3,
    marginTop: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: '#dfc3c3',
  },
  actionStack: {
    width: '100%',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  manualStepActionRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  manualStepActionHalf: {
    flex: 0,
    width: '45%',
  },
  manualStepCompactButton: {
    minHeight: 40,
    borderRadius: 11,
  },
  manualStickyActionBar: {
    position: 'absolute',
    left: -(theme.spacing.lg + theme.spacing.xs),
    right: -(theme.spacing.lg + theme.spacing.xs),
    bottom: 0,
    zIndex: 40,
    paddingTop: theme.spacing.xs,
    paddingHorizontal: 0,
    borderTopWidth: 0,
    backgroundColor: '#f4efee',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 6,
  },
  continueGradientBorder: {
    borderRadius: 16,
    padding: 3,
    overflow: 'hidden',
    shadowColor: '#c8864f',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
  continueGradientFill: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  continueDiagonalShine: {
    position: 'absolute',
    top: -54,
    left: 20,
    width: 40,
    height: 190,
    transform: [{ rotate: '22deg' }],
  },
  continueButton: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 0,
    marginTop: 0,
  },
  continueButtonText: {
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.4,
  },
  backActionButton: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 0,
  },
  backActionButtonText: {
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.2,
  },
  patientCodeCompactButtonText: {
    fontSize: theme.typography.compact.bodySm,
  },
  patientCodeOneLineText: {
    fontSize: theme.typography.compact.body,
    letterSpacing: 0,
  },
  patientCodeRowButton: {
    minHeight: 40,
    borderRadius: 11,
    paddingHorizontal: theme.spacing.sm,
  },
  choiceRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  choiceTile: {
    flex: 1,
    minHeight: 116,
    maxWidth: 140,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  choiceIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceLabel: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.semibold,
  },
  parentalConsentBlock: {
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  parentalConsentRow: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 18,
    borderColor: theme.colors.borderMuted,
    backgroundColor: theme.colors.surfaceSoft,
    overflow: 'hidden',
  },
  parentalConsentRowError: {
    borderColor: theme.colors.textError,
  },
  parentalConsentIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  parentalConsentCopy: {
    flex: 1,
    minWidth: 0,
  },
  parentalConsentEyebrow: {
    marginBottom: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
  },
  parentalConsentTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 18,
  },
  parentalConsentText: {
    marginTop: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  parentalConsentAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  parentalConsentError: {
    marginLeft: theme.spacing.md,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textError,
  },
  minorConsentModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xl,
    backgroundColor: theme.colors.overlay,
  },
  minorConsentModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  minorConsentModalCard: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '92%',
    alignSelf: 'center',
    borderRadius: 28,
    overflow: 'hidden',
    ...theme.shadows.card,
  },
  minorConsentModalHeader: {
    minHeight: 120,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    overflow: 'hidden',
  },
  minorConsentModalGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -44,
    top: -84,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  minorConsentModalHeaderIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    flexShrink: 0,
  },
  minorConsentModalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  minorConsentModalEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.1,
    opacity: 0.78,
  },
  minorConsentModalTitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  minorConsentModalSubtitle: {
    marginTop: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    opacity: 0.84,
  },
  minorConsentModalScroll: {
    minHeight: 0,
  },
  minorConsentModalBody: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  minorConsentModalLoading: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  minorConsentModalLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  minorConsentModalErrorBlock: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  minorConsentModalErrorText: {
    maxWidth: 290,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textError,
    textAlign: 'center',
  },
  minorConsentModalRetry: {
    minHeight: 40,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  minorConsentModalRetryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  minorConsentAgreement: {
    minHeight: 82,
    padding: theme.spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    overflow: 'hidden',
  },
  minorConsentAgreementDisabled: {
    opacity: 0.5,
  },
  minorConsentCheckbox: {
    width: 24,
    height: 24,
    marginTop: 2,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  minorConsentAgreementCopy: {
    flex: 1,
    minWidth: 0,
  },
  minorConsentAgreementTitle: {
    marginBottom: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  minorConsentAgreementText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  minorConsentModalFooter: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  minorConsentModalAction: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.75,
  },
  codeInput: {
    marginTop: 0,
    marginBottom: theme.spacing.sm,
  },
  patientPreviewModalRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 26,
    justifyContent: 'flex-end',
    padding: theme.spacing.md,
  },
  patientPreviewModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(22, 8, 12, 0.36)',
  },
  patientPreviewModalCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e8d8d2',
    backgroundColor: '#fffdfc',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 9,
  },
  patientPreviewModalHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  patientPreviewModalHeadCopy: {
    flex: 1,
  },
  patientPreviewModalEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: theme.typography.weights.semibold,
  },
  patientPreviewModalTitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
  },
  patientPreviewModalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6f1ef',
    borderWidth: 1,
    borderColor: '#e8d8d2',
  },
  patientPreviewModalBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textPrimary,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  patientPreviewModalMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0e4df',
    gap: theme.spacing.sm,
  },
  patientPreviewModalMetaLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.semibold,
  },
  patientPreviewModalMetaValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.weights.semibold,
  },
  patientPreviewModalNote: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    marginTop: 2,
  },
  patientPreviewModalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  patientPreviewModalActionHalf: {
    flex: 1,
  },
  uploadSection: {
    width: '100%',
    gap: theme.spacing.sm,
  },
  uploadFieldCard: {
    width: '100%',
    gap: theme.spacing.xs,
  },
  uploadFieldShell: {
    width: '100%',
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  uploadFieldShellStacked: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  manualStepPanel: {
    width: '100%',
    gap: 0,
    paddingTop: theme.spacing.lg,
  },
  manualStepPanelHidden: {
    width: '100%',
    display: 'none',
  },
  uploadCardCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  uploadCardCopyStacked: {
    flex: 0,
  },
  uploadCardTextGroup: {
    flex: 1,
    gap: 2,
  },
  uploadCardTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  uploadCardHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.normal,
  },
  uploadActionButton: {
    minWidth: 96,
    minHeight: 36,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: 12,
    borderWidth: 1.2,
  },
  uploadActionGroup: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  documentActionButton: {
    flex: 1,
    minWidth: 0,
    borderRadius: 14,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  documentActionButtonDisabled: {
    opacity: 0.55,
  },
  documentActionButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.98 }],
  },
  documentActionGradient: {
    minHeight: 46,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  documentActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.15,
  },
  uploadPreviewImage: {
    width: '100%',
    height: 112,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  uploadPreviewButton: {
    width: '100%',
    borderRadius: theme.radius.xl,
    overflow: 'hidden',
  },
  uploadPreviewHint: {
    position: 'absolute',
    right: theme.spacing.sm,
    bottom: theme.spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 8, 12, 0.58)',
  },
  manualImagePreviewRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 70,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 5, 8, 0.92)',
  },
  manualImagePreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  manualImagePreviewHeader: {
    position: 'absolute',
    top: theme.spacing.xl,
    left: theme.spacing.md,
    right: theme.spacing.md,
    zIndex: 2,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  manualImagePreviewTitle: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: '#ffffff',
  },
  manualImagePreviewClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  manualImagePreviewImage: {
    width: '100%',
    height: '100%',
  },
  filePreviewRow: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  filePreviewText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textPrimary,
  },
  documentVerificationRow: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  documentVerificationRowSuccess: {
    borderColor: '#9ec2aa',
    backgroundColor: '#f4faf6',
  },
  documentVerificationRowError: {
    borderColor: '#d8aaaa',
    backgroundColor: '#fff7f7',
  },
  documentVerificationTextGroup: {
    flex: 1,
    gap: 2,
  },
  documentVerificationTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
    textTransform: 'uppercase',
  },
  documentVerificationTitleSuccess: {
    color: '#2f6b45',
  },
  documentVerificationText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.normal,
  },
  documentVerificationOpenAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 122, 66, 0.10)',
    flexShrink: 0,
  },
  documentRetryButton: {
    alignSelf: 'flex-start',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: '#d7b7a1',
    backgroundColor: theme.colors.surfaceCard,
  },
  documentRetryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  medicalResultModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  medicalResultModalCard: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '94%',
    alignSelf: 'center',
    borderRadius: 28,
    overflow: 'hidden',
    ...theme.shadows.card,
  },
  medicalResultModalHeader: {
    minHeight: 126,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    overflow: 'hidden',
  },
  medicalResultModalGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    right: -48,
    top: -92,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  medicalResultHeaderIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    flexShrink: 0,
  },
  medicalResultHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  medicalResultEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.05,
    opacity: 0.78,
  },
  medicalResultTitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  medicalResultSubtitle: {
    marginTop: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    opacity: 0.84,
  },
  medicalResultScroll: {
    minHeight: 0,
  },
  medicalResultBody: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  medicalResultSuccessBanner: {
    padding: theme.spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BFE8CD',
    backgroundColor: '#EAF8EF',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  medicalResultSuccessCopy: {
    flex: 1,
    minWidth: 0,
  },
  medicalResultSuccessTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: '#1E7A42',
  },
  medicalResultSuccessText: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    color: '#315F43',
  },
  medicalResultMismatchBanner: {
    borderColor: '#EDC46C',
    backgroundColor: '#FFF5DA',
  },
  medicalResultMismatchTitle: {
    color: '#7A4700',
  },
  medicalResultMismatchText: {
    color: '#6B4B17',
  },
  medicalResultMismatchList: {
    gap: theme.spacing.sm,
  },
  medicalResultMismatchItem: {
    padding: theme.spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7C98A',
    backgroundColor: '#FFFAEE',
    gap: theme.spacing.xs,
  },
  medicalResultMismatchField: {
    marginBottom: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: '#6D3F00',
  },
  medicalResultMismatchValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  medicalResultMismatchValueLabel: {
    width: 68,
    paddingTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.65,
    color: '#9A6B1C',
  },
  medicalResultMismatchValue: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 17,
    color: '#4F3A18',
  },
  medicalResultSectionHeader: {
    marginTop: theme.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  medicalResultSectionHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  medicalResultSectionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  medicalResultSectionHint: {
    marginTop: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  medicalResultImagePreview: {
    height: 178,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceSoft,
    ...theme.shadows.soft,
  },
  medicalResultImage: {
    width: '100%',
    height: '100%',
  },
  medicalResultExpandBadge: {
    position: 'absolute',
    right: theme.spacing.sm,
    top: theme.spacing.sm,
    minHeight: 30,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  medicalResultExpandText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  medicalResultNoPreview: {
    minHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  medicalResultNoPreviewText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  medicalResultDetails: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  medicalResultDetailRow: {
    minHeight: 64,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  medicalResultDetailIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  medicalResultDetailCopy: {
    flex: 1,
    minWidth: 0,
  },
  medicalResultDetailLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  medicalResultDetailValue: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    fontWeight: theme.typography.weights.medium,
  },
  medicalResultFooter: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: 1,
  },
  medicalResultMismatchActions: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
  },
  medicalResultMismatchActionItem: {
    flex: 1,
    minWidth: 0,
  },
  medicalResultImageViewer: {
    flex: 1,
    backgroundColor: '#11080c',
  },
  medicalResultImageViewerHeader: {
    minHeight: 68,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.palette.wine900,
  },
  medicalResultImageViewerBack: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medicalResultImageViewerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: '#ffffff',
  },
  medicalResultImageViewerSpacer: {
    width: 48,
  },
  medicalResultImageViewerImage: {
    flex: 1,
    width: '100%',
  },
  errorText: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.medium,
  },
});
