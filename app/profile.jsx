import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text, Pressable, Alert, ScrollView, Modal, KeyboardAvoidingView, Platform, useWindowDimensions, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { DashboardLayout } from '../src/components/layout/DashboardLayout';
import { DashboardHeaderSurface } from '../src/components/layout/DashboardHeaderSurface';
import { AppCard } from '../src/components/ui/AppCard';
import { AppInput } from '../src/components/ui/AppInput';
import { PasswordInput } from '../src/components/ui/PasswordInput';
import { AppButton } from '../src/components/ui/AppButton';
import { AppIcon } from '../src/components/ui/AppIcon';
import { DatePickerField } from '../src/components/ui/DatePickerField';
import { StatusBanner } from '../src/components/ui/StatusBanner';
import { AddressOptionSheet, AddressSelectField, SignupAddressSection } from '../src/components/auth/SignupAddressSection';
import { DonorTopBar } from '../src/components/donor/DonorTopBar';
import { LegalDocumentPreview } from '../src/components/legal/LegalDocumentPreview';
import { useProfileActions } from '../src/hooks/useProfileActions';
import { useNotifications } from '../src/hooks/useNotifications';
import { useAuth } from '../src/providers/AuthProvider';
import { useLanguage } from '../src/providers/LanguageProvider';
import { resolvePatientThemeRoles, resolveThemeRoles, theme } from '../src/design-system/theme';
import { getPasswordStrengthMessage } from '../src/utils/passwordRules';
import { logAppEvent } from '../src/utils/appErrors';
import {
  passwordFieldConfig,
  profileFieldConfig,
  profileGenderOptions,
  profileSuffixOptions,
} from '../src/constants/profile';
import { changePasswordSchema, profileUpdateSchema } from '../src/features/profile/profile.schema';
import { donorDashboardNavItems, patientDashboardNavItems } from '../src/constants/dashboard';
import {
  fetchDonationCertificatesByUserId,
  fetchHairSubmissionProgressSummariesByUserId,
  hasDonationFlowProgress,
  isCompletedDonationSubmission,
} from '../src/features/hairSubmission.api';
import {
  fetchActiveGuardianConsent,
  fetchActiveMinorConsentDocument,
  getDonorProfileBadge,
  GUARDIAN_CONSENT_TEXT,
  saveGuardianConsent,
} from '../src/features/donorCompliance.service';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const MINIMUM_BIRTHDATE = new Date(1900, 0, 1);
const REQUIRED_PROFILE_FIELDS = new Set(['firstName', 'lastName', 'birthdate', 'gender', 'phone']);
const APP_VERSION_LABEL = 'Donivra v1.0.0';
const PROFILE_ACTION_BORDER_GRAD = ['#4b1020', '#7f2039', '#f4d8de', '#7f2039', '#4b1020'];
const PROFILE_ACTION_FILL_GRAD = ['#92294a', '#681a2e', '#4b1020'];
const PROFILE_ACTION_MUTED_FILL_GRAD = ['#fffaf7', '#faedf0'];

const formatPhilippineMobileInput = (value) => String(value || '').replace(/\D/g, '').slice(0, 11);

const getMaximumBirthdate = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

function ProfileGradientActionButton({
  title,
  onPress,
  loading = false,
  success = false,
  disabled = false,
  textColor,
  fillColors = PROFILE_ACTION_FILL_GRAD,
  borderColors = PROFILE_ACTION_BORDER_GRAD,
  variant = 'outline',
  showShine = true,
  style,
  buttonStyle,
  textStyle,
}) {
  return (
    <LinearGradient
      colors={borderColors}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={[styles.profileActionGradientBorder, style]}
    >
      <LinearGradient
        colors={fillColors}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={styles.profileActionGradientFill}
      >
        {showShine ? (
          <LinearGradient
            colors={['rgba(255, 246, 222, 0)', 'rgba(255, 246, 222, 0.16)', 'rgba(255, 246, 222, 0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.profileActionDiagonalShine}
          />
        ) : null}
        <AppButton
          title={title}
          size="sm"
          variant={variant}
          loading={loading}
          success={success}
          disabled={disabled}
          onPress={onPress}
          fullWidth
          backgroundColorOverride="transparent"
          borderColorOverride="transparent"
          textColorOverride={textColor}
          style={[styles.profileActionButton, buttonStyle]}
          textNumberOfLines={1}
          textAdjustsFontSizeToFit={true}
          textMinimumFontScale={0.88}
          textStyle={[styles.profileActionButtonText, textStyle]}
        />
      </LinearGradient>
    </LinearGradient>
  );
}

function ProfileMenuRow({ icon, title, subtitle = '', badge, danger = false, isLast = false, onPress, roles: rowRoles, textColor = null }) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.985, theme.motion.spring);
      }}
      onPressOut={() => {
        scale.value = withSpring(1, theme.motion.spring);
      }}
      style={[
        styles.profileMenuRow,
        rowRoles ? {
          backgroundColor: rowRoles.defaultCardBackground,
          borderColor: rowRoles.defaultCardBorder,
        } : null,
        isLast ? styles.profileRowLast : null,
        animatedStyle,
      ]}
    >
      <View style={[
        styles.profileMenuIconWrap,
        danger ? styles.profileMenuIconDanger : (rowRoles ? { backgroundColor: rowRoles.iconPrimarySurface } : null),
      ]}>
        <AppIcon name={icon} size="md" color={danger ? theme.colors.textError : (rowRoles?.iconPrimaryColor || theme.colors.brandPrimary)} />
      </View>
      <View style={styles.profileMenuCopy}>
        <Text style={[
          styles.profileMenuTitle,
          danger ? styles.profileMenuTitleDanger : null,
          rowRoles && !danger ? { color: textColor || rowRoles.headingText } : null,
        ]}>{title}</Text>
        {subtitle ? (
          <Text
            numberOfLines={2}
            style={[styles.profileMenuSubtitle, rowRoles ? { color: rowRoles.metaText } : null]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge != null && Number(badge) > 0 ? (
        <View style={[styles.profileMenuBadge, rowRoles ? { backgroundColor: rowRoles.primaryActionBackground } : null]}>
          <Text style={[styles.profileMenuBadgeText, rowRoles ? { color: rowRoles.primaryActionText } : null]}>{badge}</Text>
        </View>
      ) : null}
      <AppIcon name="chevronRight" state="muted" color={rowRoles?.metaText} />
    </AnimatedPressable>
  );
}

function ProfileMoreRow({ icon, title, subtitle, badge = null, isLast = false, onPress, roles: rowRoles, textColor = null }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileMorePressable,
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[
        styles.profileMoreRow,
        rowRoles ? {
          backgroundColor: rowRoles.defaultCardBackground,
          borderColor: rowRoles.defaultCardBorder,
        } : null,
        isLast ? styles.profileRowLast : null,
      ]}>
        <View style={[
          styles.profileMoreIconWrap,
          rowRoles ? { backgroundColor: rowRoles.iconPrimarySurface } : null,
        ]}>
          <AppIcon name={icon} size="md" color={rowRoles?.iconPrimaryColor || theme.colors.brandPrimary} />
        </View>
        <View style={styles.profileMoreCopy}>
          <Text style={[styles.profileMoreText, rowRoles ? { color: textColor || rowRoles.bodyText } : null]}>{title}</Text>
          {subtitle ? (
            <Text numberOfLines={2} style={[styles.profileMoreSubtitle, rowRoles ? { color: rowRoles.metaText } : null]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {badge != null && Number(badge) > 0 ? (
          <View style={[styles.profileMenuBadge, rowRoles ? { backgroundColor: rowRoles.primaryActionBackground } : null]}>
            <Text style={[styles.profileMenuBadgeText, rowRoles ? { color: rowRoles.primaryActionText } : null]}>{badge}</Text>
          </View>
        ) : null}
        <View style={styles.profileMoreChevron}>
          <AppIcon name="chevronRight" size="sm" state="muted" color={rowRoles?.metaText} />
        </View>
      </View>
    </Pressable>
  );
}

function ProfileSectionHeading({ icon, title, roles, textColor }) {
  return (
    <View style={styles.profileSectionHeadingRow}>
      <LinearGradient
        colors={[theme.colors.palette.wine700, theme.colors.palette.wine900]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.profileSectionHeadingIcon}
      >
        <AppIcon name={icon} size="sm" color={roles.primaryActionText} />
      </LinearGradient>
      <Text style={[styles.profileSectionHeadingText, { color: textColor || roles.headingText }]}>{title}</Text>
    </View>
  );
}

function ProfileModalActionButton({
  title,
  icon,
  onPress,
  roles,
  variant = 'primary',
  loading = false,
  disabled = false,
}) {
  const isPrimary = variant === 'primary';
  const isInactive = loading || disabled;
  const foregroundColor = isPrimary ? roles.primaryActionText : roles.primaryActionBackground;

  return (
    <View style={styles.editModalActionSlot}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: isInactive, busy: loading }}
        disabled={isInactive}
        onPress={onPress}
        style={({ pressed }) => [
          styles.editModalActionButton,
          {
            opacity: isInactive ? 0.68 : pressed ? 0.88 : 1,
            transform: [{ scale: pressed && !isInactive ? 0.985 : 1 }],
          },
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={PROFILE_ACTION_BORDER_GRAD}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.editModalActionGradientBorder}
        >
          <LinearGradient
            colors={isPrimary ? PROFILE_ACTION_FILL_GRAD : PROFILE_ACTION_MUTED_FILL_GRAD}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={styles.editModalActionContent}
          >
            {isPrimary ? <View style={styles.editModalActionShine} /> : null}
            {loading ? (
              <ActivityIndicator size="small" color={foregroundColor} />
            ) : (
              <AppIcon name={icon} size="sm" color={foregroundColor} />
            )}
            <Text numberOfLines={1} style={[styles.editModalActionText, { color: foregroundColor }]}>{title}</Text>
          </LinearGradient>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { width, height: viewportHeight } = useWindowDimensions();
  const { resolvedTheme } = useAuth();
  const { language, setLanguage, supportedLanguages, t } = useLanguage();
  const isMobileViewport = width < 768;
  const baseRoles = resolveThemeRoles(resolvedTheme, { isMobile: isMobileViewport });
  const {
    user,
    profile,
    patientProfile,
    defaultValues,
    isSavingProfile,
    isChangingPassword,
    isUploadingAvatar,
    hasUnsavedProfileChanges,
    saveSharedProfile,
    uploadAvatar,
    changePassword,
    logout,
  } = useProfileActions();
  const normalizedRole = String(profile?.role || '').trim().toLowerCase();
  const resolvedRole = normalizedRole === 'patient' ? 'patient' : 'donor';
  const roles = resolvedRole === 'patient'
    ? resolvePatientThemeRoles(resolvedTheme, { isMobile: isMobileViewport })
    : baseRoles;
  const { unreadCount } = useNotifications({ role: resolvedRole, userId: user?.id, databaseUserId: profile?.user_id });
  const primaryTextColor = resolvedRole === 'patient'
    ? roles.headingText
    : resolvedTheme?.primaryTextColor || theme.colors.textPrimary;

  const [mode, setMode] = useState('view');
  const [feedback, setFeedback] = useState(null);
  const [isLogoutConfirmationOpen, setIsLogoutConfirmationOpen] = useState(false);
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [activeProfilePicker, setActiveProfilePicker] = useState('');
  const [guardianConsent, setGuardianConsent] = useState(null);
  const [isGuardianConsentModalOpen, setIsGuardianConsentModalOpen] = useState(false);
  const [isSavingGuardianConsent, setIsSavingGuardianConsent] = useState(false);
  const [guardianConsentDocument, setGuardianConsentDocument] = useState(null);
  const [isLoadingGuardianConsentDocument, setIsLoadingGuardianConsentDocument] = useState(false);
  const [guardianConsentDocumentError, setGuardianConsentDocumentError] = useState('');
  const [guardianConsentForm, setGuardianConsentForm] = useState({
    guardianFullName: '',
    guardianRelationship: '',
    guardianContactNumber: '',
    guardianEmail: '',
    guardianAgreementAccepted: false,
  });
  const [guardianConsentErrors, setGuardianConsentErrors] = useState({});
  const [donorStats, setDonorStats] = useState({
    donations: 0,
    achievements: 0,
  });
  const successTimerRef = useRef(null);
  const logoutRequestRef = useRef(false);
  const guardianConsentPromptedBirthdateRef = useRef('');

  const profileForm = useForm({
    resolver: zodResolver(profileUpdateSchema),
    mode: 'onBlur',
    defaultValues,
  });

  const passwordForm = useForm({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onBlur',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });
  const watchedProfileValues = useWatch({
    control: profileForm.control,
  });
  const profileErrors = profileForm.formState.errors;
  const role = resolvedRole;

  useEffect(() => {
    if (mode !== 'edit') {
      profileForm.reset(defaultValues);
    }
  }, [defaultValues, mode, profileForm]);

  useEffect(() => {
    let isMounted = true;
    const loadGuardianConsent = async () => {
      if (role !== 'donor' || !profile?.user_id) {
        if (isMounted) setGuardianConsent(null);
        return;
      }

      const result = await fetchActiveGuardianConsent(profile.user_id);
      if (isMounted) {
        setGuardianConsent(result.data || null);
      }
    };

    loadGuardianConsent();
    return () => {
      isMounted = false;
    };
  }, [profile?.user_id, role]);

  useEffect(() => {
    let isMounted = true;

    const loadDonorStats = async () => {
      if (role !== 'donor' || !user?.id) {
        if (isMounted) {
          setDonorStats({ donations: 0, achievements: 0 });
        }
        return;
      }

      const [submissionsResult, certificatesResult] = await Promise.all([
        fetchHairSubmissionProgressSummariesByUserId(user.id, 100),
        fetchDonationCertificatesByUserId(user.id, 100),
      ]);

      if (!isMounted) return;

      const submissionsById = new Map(
        (submissionsResult.data || [])
          .filter((submission) => submission?.submission_id)
          .map((submission) => [Number(submission.submission_id), submission])
      );
      const completedCertificates = (certificatesResult.data || []).filter((certificate) => (
        isCompletedDonationSubmission(submissionsById.get(Number(certificate?.submission_id)))
      ));

      setDonorStats({
        donations: (submissionsResult.data || []).filter((submission) => hasDonationFlowProgress(submission)).length,
        achievements: completedCertificates.length,
      });
    };

    loadDonorStats();

    return () => {
      isMounted = false;
    };
  }, [profile?.user_id, role, user?.id]);

  useEffect(() => () => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }
  }, []);

  const navItems = role === 'donor' ? donorDashboardNavItems : patientDashboardNavItems;
  const firstName = (profile?.first_name || '').trim();
  const middleName = (profile?.middle_name || '').trim();
  const lastName = (profile?.last_name || '').trim();
  const suffix = profile?.suffix || '';
  const avatarUri = profile?.avatar_url || profile?.photo_path || patientProfile?.patient_picture || '';
  const avatarInitials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.trim();
  const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ');
  const profileLocation = [profile?.city, profile?.province || profile?.region]
    .filter(Boolean)
    .join(', ')
    .toLowerCase();
  const profileEditFieldIcons = {
    firstName: 'account-outline',
    middleName: 'account-outline',
    lastName: 'account-outline',
    suffix: 'format-letter-case',
    birthdate: 'calendar-month-outline',
    gender: 'human-male-female',
    phone: 'phone-outline',
  };
  const passwordFieldIcons = {
    currentPassword: 'lock-outline',
    newPassword: 'lock-plus-outline',
    confirmPassword: 'lock-check-outline',
  };
  const guardianConsentFieldIcons = {
    guardianFullName: 'account-supervisor-outline',
    guardianRelationship: 'account-heart-outline',
    guardianContactNumber: 'phone-outline',
    guardianEmail: 'email-outline',
  };
  const profileEditFieldShell = [
    styles.profileEditFieldShell,
    {
      borderColor: roles.defaultCardBorder,
      backgroundColor: theme.colors.surfaceCard,
    },
  ];
  const profileEditFieldLabel = [styles.profileEditFieldLabel, { color: primaryTextColor }];
  const profileEditFieldText = [styles.profileEditFieldText, { color: primaryTextColor }];
  const profileEditFieldPlaceholder = [styles.profileEditFieldText, { color: theme.colors.textMuted }];
  const profileEditFieldHelper = [styles.profileEditFieldHelper, { color: primaryTextColor }];
  const profileEditFieldError = [styles.profileEditFieldError];
  const profileEditInputProps = {
    variant: 'default',
    placeholderTextColor: theme.colors.textMuted,
    style: styles.profileEditFieldContainer,
    labelStyle: profileEditFieldLabel,
    shellStyle: profileEditFieldShell,
    inputStyle: profileEditFieldText,
    helperTextStyle: profileEditFieldHelper,
    errorTextStyle: profileEditFieldError,
    leftIconColor: roles.primaryActionBackground,
    leftIconContainerStyle: [
      styles.profileEditInputIconSurface,
      { backgroundColor: roles.iconPrimarySurface },
    ],
  };
  const profileEditSelectProps = {
    labelStyle: profileEditFieldLabel,
    fieldStyle: profileEditFieldShell,
    valueStyle: profileEditFieldText,
    placeholderStyle: profileEditFieldPlaceholder,
    helperTextStyle: profileEditFieldHelper,
    errorTextStyle: profileEditFieldError,
    leftIconColor: roles.primaryActionBackground,
    rightIconColor: roles.primaryActionBackground,
    leftIconContainerStyle: [
      styles.profileEditFieldIconSurface,
      { backgroundColor: roles.iconPrimarySurface },
    ],
    rightIconContainerStyle: [
      styles.profileEditFieldActionSurface,
      { backgroundColor: roles.iconPrimarySurface },
    ],
  };
  const profileEditDateProps = {
    containerStyle: styles.profileEditFieldContainer,
    labelStyle: profileEditFieldLabel,
    shellStyle: profileEditFieldShell,
    valueStyle: profileEditFieldText,
    placeholderStyle: profileEditFieldPlaceholder,
    helperTextStyle: profileEditFieldHelper,
    errorTextStyle: profileEditFieldError,
    leftIconColor: roles.primaryActionBackground,
    rightIconColor: roles.primaryActionBackground,
    leftIconContainerStyle: [
      styles.profileEditFieldIconSurface,
      { backgroundColor: roles.iconPrimarySurface },
    ],
    rightIconContainerStyle: [
      styles.profileEditFieldActionSurface,
      { backgroundColor: roles.iconPrimarySurface },
    ],
  };
  const watchedNewPassword = passwordForm.watch('newPassword');
  const watchedGender = useWatch({ control: profileForm.control, name: 'gender' });
  const watchedBirthdate = useWatch({ control: profileForm.control, name: 'birthdate' });
  const setupDonorAgeBadge = useMemo(() => (
    getDonorProfileBadge({ birthdate: watchedBirthdate, guardianConsent })
  ), [guardianConsent, watchedBirthdate]);
  const isMinorProfileDraft = setupDonorAgeBadge && setupDonorAgeBadge.category !== 'Adult';
  const isAdultDonorBadge = setupDonorAgeBadge?.category === 'Adult';
  const hasActiveGuardianConsent = Boolean(guardianConsent?.guardian_consent_id || guardianConsent?.Guardian_Consent_ID);
  const guardianConsentText = String(
    guardianConsentDocument?.content
    || guardianConsent?.consent_text_snapshot
    || GUARDIAN_CONSENT_TEXT
  ).trim();
  const hasCurrentGuardianConsentDocument = Boolean(
    guardianConsentDocument?.legal_document_id
    && String(guardianConsentDocument?.content || '').trim()
  );
  const passwordStrengthMessage = getPasswordStrengthMessage(watchedNewPassword);
  const passwordStrengthVariant = watchedNewPassword
    ? passwordStrengthMessage === 'Strong password'
      ? 'success'
      : 'info'
    : 'info';
  const isPopupVisible = mode !== 'view';
  const modalMaxHeight = Math.max(360, viewportHeight - theme.spacing.xl * 2);
  const hasDirtyProfileDraft = mode === 'edit' && hasUnsavedProfileChanges(watchedProfileValues);
  const setFloatingFeedback = useCallback((type, title, message) => {
    setFeedback({ type, title, message });
  }, []);

  const updateGuardianConsentField = useCallback((field, value) => {
    setGuardianConsentForm((current) => ({
      ...current,
      [field]: value,
    }));
    setGuardianConsentErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const validateGuardianConsentForm = useCallback(() => {
    const nextErrors = {};
    const fullName = guardianConsentForm.guardianFullName.trim();
    const relationship = guardianConsentForm.guardianRelationship.trim();
    const contactNumber = guardianConsentForm.guardianContactNumber.trim();

    if (!fullName) nextErrors.guardianFullName = 'Guardian full name is required.';
    if (!relationship) nextErrors.guardianRelationship = 'Relationship is required.';
    if (!contactNumber) nextErrors.guardianContactNumber = 'Guardian contact number is required.';
    if (!guardianConsentForm.guardianAgreementAccepted) nextErrors.guardianAgreementAccepted = 'Please confirm guardian consent to continue.';

    setGuardianConsentErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }, [guardianConsentForm]);

  const closeGuardianConsentModal = useCallback(() => {
    if (isSavingGuardianConsent) return;
    setIsGuardianConsentModalOpen(false);
    setGuardianConsentErrors({});
  }, [isSavingGuardianConsent]);

  const openGuardianConsentModal = useCallback(() => {
    setIsGuardianConsentModalOpen(true);
  }, []);

  const loadGuardianConsentDocument = useCallback(async () => {
    setIsLoadingGuardianConsentDocument(true);
    setGuardianConsentDocumentError('');
    setGuardianConsentForm((current) => ({
      ...current,
      guardianAgreementAccepted: false,
    }));

    const result = await fetchActiveMinorConsentDocument();
    if (result.error || !result.data) {
      setGuardianConsentDocument(null);
      setGuardianConsentDocumentError(
        result.error?.message || 'Guardian consent could not be loaded. Please try again.'
      );
    } else {
      setGuardianConsentDocument(result.data);
    }

    setIsLoadingGuardianConsentDocument(false);
  }, []);

  useEffect(() => {
    if (!isGuardianConsentModalOpen) return;
    loadGuardianConsentDocument();
  }, [isGuardianConsentModalOpen, loadGuardianConsentDocument]);

  useEffect(() => {
    if (mode !== 'edit' || role !== 'donor' || hasActiveGuardianConsent) {
      if (mode !== 'edit') guardianConsentPromptedBirthdateRef.current = '';
      return undefined;
    }

    const birthdateKey = String(watchedBirthdate || '').trim();
    if (!isMinorProfileDraft || !birthdateKey) {
      guardianConsentPromptedBirthdateRef.current = '';
      return undefined;
    }

    if (guardianConsentPromptedBirthdateRef.current === birthdateKey) return undefined;
    guardianConsentPromptedBirthdateRef.current = birthdateKey;
    const promptTimer = setTimeout(() => setIsGuardianConsentModalOpen(true), 260);
    return () => clearTimeout(promptTimer);
  }, [hasActiveGuardianConsent, isMinorProfileDraft, mode, role, watchedBirthdate]);

  const submitGuardianConsent = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!profile?.user_id) {
      setFloatingFeedback('error', 'Profile Not Ready', 'Please save your donor account first, then complete guardian consent.');
      return;
    }

    if (!hasCurrentGuardianConsentDocument) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setGuardianConsentDocumentError('Load the current guardian consent before continuing.');
      return;
    }

    if (!validateGuardianConsentForm()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setIsSavingGuardianConsent(true);
    const result = await saveGuardianConsent({
      userId: profile.user_id,
      guardianFullName: guardianConsentForm.guardianFullName,
      guardianRelationship: guardianConsentForm.guardianRelationship,
      guardianContactNumber: guardianConsentForm.guardianContactNumber,
      guardianEmail: guardianConsentForm.guardianEmail,
      publicPostingAllowed: false,
      consentTextSnapshot: guardianConsentText,
    });
    setIsSavingGuardianConsent(false);

    if (result.error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFloatingFeedback('error', 'Consent Not Saved', result.error.message || 'Guardian consent could not be saved. Please try again.');
      return;
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const refreshed = await fetchActiveGuardianConsent(profile.user_id);
    setGuardianConsent(refreshed.data || result.data || { guardian_consent_id: true });
    setGuardianConsentForm({
      guardianFullName: '',
      guardianRelationship: '',
      guardianContactNumber: '',
      guardianEmail: '',
      guardianAgreementAccepted: false,
    });
    setIsGuardianConsentModalOpen(false);
    setFloatingFeedback('success', 'Consent Completed', 'Guardian consent is now saved for this donor account.');
  }, [guardianConsentForm, guardianConsentText, hasCurrentGuardianConsentDocument, profile?.user_id, setFloatingFeedback, validateGuardianConsentForm]);

  const closeEditModal = useCallback(() => {
    profileForm.reset(defaultValues);
    setMode('view');
  }, [defaultValues, profileForm]);

  const handleDiscardProfileChanges = useCallback(() => {
    logAppEvent('profile_completion.discard', 'Unsaved profile changes were discarded.', {
      authUserId: user?.id || null,
      databaseUserId: profile?.user_id || null,
      role,
    });
    closeEditModal();
  }, [closeEditModal, profile?.user_id, role, user?.id]);

  const requestEditModalClose = useCallback(() => {
    if (!hasDirtyProfileDraft) {
      closeEditModal();
      return;
    }

    Alert.alert(
      'Discard changes?',
      'Unsaved changes will not be saved.',
      [
        {
          text: 'Continue Editing',
          style: 'cancel',
        },
        {
          text: 'Discard Changes',
          style: 'destructive',
          onPress: handleDiscardProfileChanges,
        },
      ]
    );
  }, [closeEditModal, handleDiscardProfileChanges, hasDirtyProfileDraft]);

  const handleModalClose = useCallback(() => {
    setActiveProfilePicker('');
    if (mode === 'edit') {
      requestEditModalClose();
      return;
    }

    if (mode === 'password') {
      passwordForm.reset({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    }

    setMode('view');
  }, [mode, passwordForm, requestEditModalClose]);

  const handleNavPress = async (item) => {
    if (item.route === '/profile') return;
    if (item.isPlaceholder) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Alert.alert('Coming Soon', `${item.label} will be added in the next update.`);
      return;
    }
    router.replace(item.route);
  };

  const handleLogoutPress = useCallback(async () => {
    if (logoutRequestRef.current) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsLogoutConfirmationOpen(true);
  }, []);

  const closeLogoutConfirmation = useCallback(() => {
    if (logoutRequestRef.current) return;
    setIsLogoutConfirmationOpen(false);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    if (logoutRequestRef.current) return;
    logoutRequestRef.current = true;
    setIsLoggingOut(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    const result = await logout();
    if (result?.success && !result?.error) {
      setIsLogoutConfirmationOpen(false);
      router.replace('/auth/access');
      return;
    }

    logoutRequestRef.current = false;
    setIsLoggingOut(false);
    setIsLogoutConfirmationOpen(false);
    setFloatingFeedback('error', 'Logout Failed', result?.error || 'Unable to log out right now.');
  }, [logout, router, setFloatingFeedback]);

  const submitProfile = async (values) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await saveSharedProfile(values);
    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaveSuccess(true);
      setFloatingFeedback('success', 'Profile Updated', 'Your account details were saved successfully.');
      setMode('view');
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFloatingFeedback('error', 'Update Failed', result.error || 'Unable to update your profile.');
    }
  };

  const submitPassword = async (values) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await changePassword(values);
    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      passwordForm.reset();
      setPasswordSuccess(true);
      setFloatingFeedback('success', 'Password Changed', 'Your password was updated successfully.');
      setMode('view');
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFloatingFeedback('error', 'Password Update Failed', result.error || 'Unable to change your password.');
    }
  };

  const handlePhotoPress = async ({ keepEditing = false } = {}) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveProfilePicker('');
    if (!keepEditing) {
      setMode('view');
    }
    const result = await uploadAvatar();
    if (result.canceled) return;

    if (result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFloatingFeedback('success', 'Photo Updated', 'Your profile photo is now visible across your account.');
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFloatingFeedback('error', 'Photo Update Failed', result.error || 'Unable to update your profile photo.');
    }
  };

  useEffect(() => {
    if (!saveSuccess && !passwordSuccess) return;
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }
    successTimerRef.current = setTimeout(() => {
      setSaveSuccess(false);
      setPasswordSuccess(false);
    }, 1400);
  }, [passwordSuccess, saveSuccess]);

  useEffect(() => {
    if (mode === 'edit') {
      setActiveProfilePicker('');
      profileForm.reset(defaultValues);
    }

    if (mode === 'password') {
      setActiveProfilePicker('');
      passwordForm.reset({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    }

    if (mode === 'view') {
      setActiveProfilePicker('');
    }
  }, [defaultValues, mode, passwordForm, profileForm]);

  const renderDonorProfileHero = () => (
    <LinearGradient
        colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, '#9E3652']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.profileHeroPanel}
      >
        <View pointerEvents="none" style={styles.profileHeroGlowLarge} />
        <View pointerEvents="none" style={styles.profileHeroGlowSmall} />

        <View style={styles.profileHeroIdentityRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isUploadingAvatar ? 'Updating profile photo' : 'Change profile photo'}
            onPress={() => handlePhotoPress()}
            disabled={isUploadingAvatar}
            style={({ pressed }) => [styles.profileHeroPhotoButton, { opacity: pressed ? 0.86 : 1 }]}
          >
            <View style={styles.profileHeroPhoto}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.profileHeroAvatarImage} resizeMode="cover" />
              ) : (
                <Text style={styles.profileHeroAvatarText}>
                  {(avatarInitials || 'DN').toUpperCase().slice(0, 2)}
                </Text>
              )}
            </View>
            <View style={styles.profileHeroPhotoBadge}>
              {isUploadingAvatar ? (
                <ActivityIndicator size="small" color={theme.colors.palette.wine900} />
              ) : (
                <AppIcon name="camera" size="sm" color={theme.colors.palette.wine900} />
              )}
            </View>
          </Pressable>

          <View style={styles.profileHeroCopyCentered}>
            <Text numberOfLines={2} style={styles.profileHeroDisplayName}>
              {fullName || 'Profile'}
            </Text>
            <View style={styles.profileHeroContactRow}>
              <View style={styles.profileHeroContactItem}>
                <AppIcon name="email" size="sm" color="#F7DDE4" />
                <Text numberOfLines={1} style={styles.profileHeroContactText}>
                  {user?.email || 'No email linked'}
                </Text>
              </View>
              {profileLocation ? (
                <View style={styles.profileHeroContactItem}>
                  <AppIcon name="location" size="sm" color="#F7DDE4" />
                  <Text numberOfLines={1} style={styles.profileHeroContactText}>
                    {profileLocation}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.profileHeroMetricsRow}>
          {[
            {
              key: 'donations',
              label: t('profile.donations'),
              value: donorStats.donations,
              icon: 'donations',
              route: '/donor/donation-history',
              emphasized: false,
            },
            {
              key: 'achievements',
              label: t('profile.achievements'),
              value: donorStats.achievements,
              icon: 'sparkle',
              route: '/donor/achievements',
              emphasized: true,
            },
          ].map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.value} ${item.label}`}
              onPress={() => router.navigate(item.route)}
              style={({ pressed }) => [styles.profileHeroMetricPressable, pressed ? styles.profileHeroMetricCardPressed : null]}
            >
              <LinearGradient
                colors={item.emphasized
                  ? [theme.colors.palette.wine600, theme.colors.palette.wine700, theme.colors.palette.wine900]
                  : ['#FFF9FA', '#F6E6EA', '#F1D8DF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.profileHeroMetricCard}
              >
                <View style={[
                  styles.profileHeroMetricIcon,
                  item.emphasized ? styles.profileHeroMetricIconEmphasized : null,
                ]}>
                  <AppIcon
                    name={item.icon}
                    size="sm"
                    color={item.emphasized ? '#FFFFFF' : theme.colors.palette.wine700}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  style={[
                    styles.profileHeroMetricTitle,
                    item.emphasized ? styles.profileHeroMetricTitleEmphasized : null,
                  ]}
                >
                  {item.label}
                </Text>
                <View style={[
                  styles.profileHeroMetricCount,
                  item.emphasized ? styles.profileHeroMetricCountEmphasized : null,
                ]}>
                  <Text style={[
                    styles.profileHeroMetricCountText,
                    item.emphasized ? styles.profileHeroMetricCountTextEmphasized : null,
                  ]}>{item.value}</Text>
                </View>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
    </LinearGradient>
  );

  const renderDonorProfileContent = () => (
    <View style={styles.profileMainShell}>
      <View style={styles.profileSection}>
        <ProfileSectionHeading
          title={t('profile.account')}
          icon="profile"
          roles={roles}
          textColor={primaryTextColor}
        />
        <View style={styles.profileDonorSectionShell}>
          <ProfileMenuRow
            roles={roles}
            icon="editProfile"
            title={t('profile.edit')}
            subtitle={t('profile.editSubtitle')}
            textColor={primaryTextColor}
            onPress={() => setMode('edit')}
          />
          <ProfileMenuRow
            roles={roles}
            icon="changePassword"
            title={t('profile.changePassword')}
            subtitle={t('profile.changePasswordSubtitle')}
            textColor={primaryTextColor}
            onPress={() => setMode('password')}
          />
          <ProfileMenuRow
            roles={roles}
            icon="updates"
            title={t('profile.history')}
            subtitle={t('profile.historySubtitle')}
            badge={donorStats.donations}
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/donation-history')}
          />
          <ProfileMenuRow
            roles={roles}
            icon="sparkle"
            title={t('profile.achievements')}
            subtitle={t('profile.achievementsSubtitle')}
            badge={donorStats.achievements}
            isLast
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/achievements')}
          />
        </View>
      </View>

      <View style={styles.profileSection}>
        <ProfileSectionHeading
          title={t('profile.preferences')}
          icon="quickActions"
          roles={roles}
          textColor={primaryTextColor}
        />
        <View style={styles.profileDonorSectionShell}>
          <ProfileMoreRow
            roles={roles}
            icon="translate"
            title={t('profile.language')}
            subtitle={language === 'fil' ? 'Filipino' : 'English'}
            textColor={primaryTextColor}
            onPress={() => setIsLanguageModalOpen(true)}
          />
          <ProfileMoreRow
            roles={roles}
            icon="bell-outline"
            title={t('profile.notifications')}
            subtitle={t('profile.notificationsSubtitle')}
            badge={unreadCount}
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/notifications')}
          />
          <ProfileMoreRow
            roles={roles}
            icon="message-alert-outline"
            title={t('profile.feedback')}
            subtitle={t('profile.feedbackSubtitle')}
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/feedback')}
          />
          <ProfileMoreRow
            roles={roles}
            icon="help-circle-outline"
            title={t('profile.help')}
            subtitle={t('profile.helpSubtitle')}
            isLast
            textColor={primaryTextColor}
            onPress={() => router.navigate('/help')}
          />
        </View>
      </View>

      <View style={styles.profileLogoutSection}>
        <AppButton
          title={t('profile.logout')}
          variant="outline"
          fullWidth
          onPress={handleLogoutPress}
          leading={<AppIcon name="signOut" state="danger" />}
          style={styles.profileLogoutButton}
          textColorOverride={theme.colors.textError}
          borderColorOverride={theme.colors.textError}
        />
        <Text style={[styles.profileVersionText, { color: primaryTextColor }]}>{APP_VERSION_LABEL}</Text>
      </View>
    </View>
  );

  const renderPatientProfileHero = () => (
    <LinearGradient
      colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.patientProfileHero}
    >
      <View pointerEvents="none" style={styles.patientProfileHeroGlow} />
      <View style={styles.patientProfileIdentityRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          onPress={() => handlePhotoPress()}
          disabled={isUploadingAvatar}
          style={({ pressed }) => [styles.patientProfileAvatarButton, { opacity: pressed ? 0.86 : 1 }]}
        >
          <View style={styles.patientProfileAvatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.profileHeroAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={styles.patientProfileAvatarText}>
                {(avatarInitials || 'PT').toUpperCase().slice(0, 2)}
              </Text>
            )}
          </View>
          <View style={styles.patientProfileCameraBadge}>
            {isUploadingAvatar ? (
              <ActivityIndicator size="small" color={theme.colors.palette.wine900} />
            ) : (
              <AppIcon name="camera" size="sm" color={theme.colors.palette.wine900} />
            )}
          </View>
        </Pressable>

        <View style={styles.patientProfileIdentityCopy}>
          <Text numberOfLines={2} style={styles.patientProfileName}>
            {fullName || 'Patient account'}
          </Text>
          <View style={styles.patientProfileStatusPill}>
            <AppIcon name="checkmarkCircle" size="sm" color="#FFFFFF" />
            <Text style={styles.patientProfileStatusText}>Verified patient</Text>
          </View>
          {patientProfile?.patient_code ? (
            <Text numberOfLines={1} style={styles.patientProfileCode}>
              Patient ID: {patientProfile.patient_code}
            </Text>
          ) : null}
        </View>
      </View>
    </LinearGradient>
  );

  const renderPatientProfileContent = () => (
    <View style={styles.patientProfileShell}>
      <View style={styles.patientProfileGrid}>
        <View style={styles.profileSection}>
          <ProfileSectionHeading
            title="Private health record"
            icon="shield"
            roles={roles}
            textColor={primaryTextColor}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open medical information"
            accessibilityHint="Opens your protected medical record and document preview"
            onPress={() => router.navigate('/patient/medical-information')}
            style={({ pressed }) => [
              styles.patientMedicalAccessButton,
              pressed ? styles.patientMedicalAccessButtonPressed : null,
            ]}
          >
            <LinearGradient
              colors={[roles.defaultCardBackground, roles.supportCardBackground]}
              start={{ x: 0.08, y: 0 }}
              end={{ x: 0.92, y: 1 }}
              style={[
                styles.patientMedicalAccessCard,
                { borderColor: roles.defaultCardBorder },
              ]}
            >
              <View style={[styles.patientMedicalAccessIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <AppIcon name="folder-account-outline" size="lg" color={roles.primaryActionBackground} />
              </View>
              <View style={styles.patientMedicalAccessCopy}>
                <Text style={[styles.patientMedicalAccessTitle, { color: primaryTextColor }]}>Medical information</Text>
                <Text style={[styles.patientMedicalAccessText, { color: roles.bodyText }]}>
                  View your care details and medical certificate securely.
                </Text>
                <View style={[styles.patientMedicalAccessBadge, { backgroundColor: roles.iconPrimarySurface }]}>
                  <AppIcon name="lock-outline" size="sm" color={roles.primaryActionBackground} />
                  <Text style={[styles.patientMedicalAccessBadgeText, { color: roles.primaryActionBackground }]}>Private record</Text>
                </View>
              </View>
              <View style={[styles.patientMedicalAccessArrow, { backgroundColor: roles.primaryActionBackground }]}>
                <AppIcon name="chevronRight" size="sm" color={roles.primaryActionText} />
              </View>
            </LinearGradient>
          </Pressable>
        </View>

        <View style={styles.profileSection}>
          <ProfileSectionHeading
            title={t('profile.accountSettings')}
            icon="settings"
            roles={roles}
            textColor={primaryTextColor}
          />
          <View style={styles.patientSettingsList}>
            <ProfileMenuRow
              icon="editProfile"
              title={t('profile.personalInformation')}
              subtitle="Update your name, contact details, and address."
              onPress={() => setMode('edit')}
              roles={roles}
              textColor={primaryTextColor}
            />
            <ProfileMenuRow
              icon="feedback"
              title={t('profile.feedback')}
              subtitle="Share feedback about your Donivra experience."
              onPress={() => router.navigate('/patient/feedback')}
              roles={roles}
              textColor={primaryTextColor}
            />
            <ProfileMenuRow
              icon="translate"
              title={t('profile.language')}
              subtitle={language === 'fil' ? 'Filipino' : 'English'}
              onPress={() => setIsLanguageModalOpen(true)}
              roles={roles}
              textColor={primaryTextColor}
            />
            <ProfileMenuRow
              icon="help-circle-outline"
              title={t('profile.helpGuide')}
              subtitle={t('profile.helpGuideSubtitle')}
              onPress={() => router.navigate('/help')}
              roles={roles}
              textColor={primaryTextColor}
            />
          </View>
        </View>
      </View>

      <View style={styles.profileLogoutSection}>
        <AppButton
          title={t('profile.logout')}
          variant="outline"
          fullWidth
          onPress={handleLogoutPress}
          leading={<AppIcon name="signOut" state="danger" />}
          style={styles.patientProfileLogoutButton}
          textColorOverride={theme.colors.textError}
          borderColorOverride={theme.colors.textError}
        />
        <Text style={[styles.profileVersionText, { color: primaryTextColor }]}>{APP_VERSION_LABEL}</Text>
      </View>
    </View>
  );

  return (
    <>
      <DashboardLayout
        screenVariant={role === 'donor' ? 'default' : 'dashboard'}
        navItems={navItems}
        activeNavKey="profile"
        navVariant={role === 'donor' ? 'donor' : 'patient'}
        onNavPress={handleNavPress}
        stickyContent={role === 'donor' ? (
          <View style={[styles.profileStickyHeroHost, { backgroundColor: roles.pageBackground }]}>
            {renderDonorProfileHero()}
          </View>
        ) : (
          <View style={[styles.profileStickyHeroHost, styles.patientStickyHeroHost, { backgroundColor: roles.pageBackground }]}>
            {renderPatientProfileHero()}
          </View>
        )}
        header={(
          <DashboardHeaderSurface>
            <DonorTopBar
              title={t('profile.title')}
              subtitle={t('profile.subtitle')}
              showBack
              showNotificationsAction={false}
              showLogoutAction={false}
              onBackPress={() => router.replace(role === 'donor' ? '/donor/home' : '/patient/home')}
            />
          </DashboardHeaderSurface>
        )}
      >
        {role === 'donor' ? renderDonorProfileContent() : renderPatientProfileContent()}

        <Modal
          transparent
          statusBarTranslucent
          navigationBarTranslucent
          visible={isPopupVisible}
          animationType="fade"
          onRequestClose={handleModalClose}
        >
          <KeyboardAvoidingView
            style={styles.modalKeyboardWrap}
            behavior="padding"
            enabled={Platform.OS === 'ios'}
          >
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={handleModalClose} />

              <AppCard
                variant="elevated"
                radius="md"
                padding={mode === 'edit' || mode === 'password' ? 'none' : 'lg'}
                style={[
                  styles.modalCard,
                  mode === 'edit' ? styles.editProfileModalCard : null,
                  mode === 'password' ? styles.passwordModalCard : null,
                  { maxHeight: modalMaxHeight },
                ]}
                contentStyle={[
                  styles.modalCardContent,
                  mode === 'edit' ? styles.editModalCardContent : null,
                  mode === 'password' ? styles.passwordModalCardContent : null,
                ]}
              >
                {mode === 'edit' ? (
                  <>
                    <LinearGradient
                      colors={role === 'patient'
                        ? [theme.colors.dashboardPatientFrom, theme.colors.dashboardPatientTo]
                        : [theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[
                        styles.editModalHeader,
                        { borderBottomColor: roles.primaryActionBackground },
                      ]}
                    >
                      <View pointerEvents="none" style={styles.editModalHeaderGlow} />
                      <View style={styles.editModalHeaderCopy}>
                        <Text style={[styles.editModalTitle, { color: roles.primaryActionText }]}>Edit profile</Text>
                        <Text style={[styles.editModalSubtitle, { color: roles.primaryActionText }]}>
                          Keep your personal details accurate and up to date.
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close edit profile"
                        onPress={requestEditModalClose}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.editModalCloseButton,
                          { backgroundColor: 'rgba(255,255,255,0.16)', opacity: pressed ? 0.72 : 1 },
                        ]}
                      >
                        <AppIcon name="close" size="sm" color={roles.primaryActionText} />
                      </Pressable>
                    </LinearGradient>

                    <ScrollView
                      style={styles.editModalBodyScroll}
                      contentContainerStyle={styles.editModalBodyContent}
                      showsVerticalScrollIndicator={true}
                      persistentScrollbar={false}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode="interactive"
                      nestedScrollEnabled={true}
                    >
                      <View style={styles.profileEditPhotoSection}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Change profile picture"
                          onPress={() => handlePhotoPress({ keepEditing: true })}
                          disabled={isUploadingAvatar}
                          hitSlop={10}
                          style={({ pressed }) => [
                            styles.profileEditPhotoPressable,
                            { opacity: pressed ? 0.9 : 1 },
                          ]}
                        >
                          <LinearGradient
                            pointerEvents="none"
                            colors={[roles.iconPrimarySurface, roles.defaultCardBackground]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={[styles.profileEditPhotoSurface, { borderColor: roles.defaultCardBorder }]}
                          >
                            <View style={styles.profileEditPhotoAvatarWrap}>
                              <View style={[styles.profileEditPhotoAvatar, { backgroundColor: roles.defaultCardBackground, borderColor: roles.primaryActionBackground }]}>
                                {avatarUri ? (
                                  <Image source={{ uri: avatarUri }} style={styles.profileEditPhotoAvatarImage} resizeMode="cover" />
                                ) : (
                                  <Text style={[styles.profileEditPhotoAvatarText, { color: roles.primaryActionBackground }]}>
                                    {(avatarInitials || 'DN').toUpperCase().slice(0, 2)}
                                  </Text>
                                )}
                              </View>
                              <View style={[styles.profileEditPhotoBadge, { backgroundColor: roles.iconAccentSurface, borderColor: roles.defaultCardBackground }]}>
                                <AppIcon name="pencil-outline" size="sm" color={roles.iconAccentColor} />
                              </View>
                            </View>
                            <View style={styles.profileEditPhotoCopy}>
                              <Text style={[styles.profileEditPhotoTitle, { color: roles.headingText }]}>Profile photo</Text>
                              <Text style={[styles.profileEditPhotoHint, { color: roles.bodyText }]}>Use a clear photo so your account is easy to recognize.</Text>
                              <View style={[styles.profileEditPhotoLabel, { backgroundColor: roles.primaryActionBackground }]}>
                                <AppIcon name="camera" size="sm" color={roles.primaryActionText} />
                                <Text style={[styles.profileEditPhotoLabelText, { color: roles.primaryActionText }]}>Change photo</Text>
                              </View>
                            </View>
                          </LinearGradient>
                        </Pressable>
                      </View>

                      <View style={styles.editModalSectionHeading}>
                        <View style={[styles.editModalSectionIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                          <AppIcon name="profile" size="md" color={roles.iconPrimaryColor} />
                        </View>
                        <View style={styles.editModalSectionCopy}>
                          <Text style={[styles.editModalSectionTitle, { color: roles.headingText }]}>Personal details</Text>
                          <Text style={[styles.editModalSectionText, { color: roles.metaText }]}>Required fields are marked with *</Text>
                        </View>
                      </View>

                      {profileFieldConfig.map((field) => {
                        const isRequiredField = REQUIRED_PROFILE_FIELDS.has(field.formKey);
                        const emptyFieldText = isRequiredField ? 'Required' : 'N/A';

                        if (field.formKey === 'street') {
                          return (
                            <SignupAddressSection
                              key="profile-address-section"
                              control={profileForm.control}
                              errors={profileErrors}
                              setValue={profileForm.setValue}
                              showHeader
                              showHelperText={false}
                              showTopBorder={false}
                              inputProps={profileEditInputProps}
                              selectProps={profileEditSelectProps}
                              countryInputProps={{ helperText: '' }}
                              emptyValuePlaceholder="N/A"
                            />
                          );
                        }

                        if (['barangay', 'region', 'city', 'province', 'country'].includes(field.formKey)) {
                          return null;
                        }

                        return (
                          <Controller
                            key={field.formKey}
                            control={profileForm.control}
                            name={field.formKey}
                            render={({ field: controllerField, fieldState }) => {
                              if (field.formKey === 'birthdate') {
                                return (
                                  <View>
                                    <DatePickerField
                                      label={field.label}
                                      required={isRequiredField}
                                      value={controllerField.value}
                                      placeholder={emptyFieldText}
                                      helperText={field.helperText}
                                      error={fieldState.error?.message}
                                      onChange={controllerField.onChange}
                                      onBlur={controllerField.onBlur}
                                      minimumDate={MINIMUM_BIRTHDATE}
                                      maximumDate={getMaximumBirthdate()}
                                      onPress={() => Haptics.selectionAsync()}
                                      leftIcon={profileEditFieldIcons.birthdate}
                                      {...profileEditDateProps}
                                    />
                                    {setupDonorAgeBadge ? (
                                      <Pressable
                                        accessibilityRole={isAdultDonorBadge || hasActiveGuardianConsent ? undefined : 'button'}
                                        accessibilityLabel="Open guardian consent"
                                        disabled={isAdultDonorBadge || hasActiveGuardianConsent}
                                        onPress={openGuardianConsentModal}
                                        style={[
                                          styles.setupAgeBadge,
                                          setupDonorAgeBadge.tone === 'success'
                                            ? styles.setupAgeBadgeSuccess
                                            : styles.setupAgeBadgeWarning,
                                          isAdultDonorBadge
                                            ? styles.setupAgeBadgeCompact
                                            : null,
                                        ]}
                                      >
                                        <AppIcon
                                          name={setupDonorAgeBadge.tone === 'success' ? 'success' : 'shield'}
                                          size="sm"
                                          color={setupDonorAgeBadge.tone === 'success' ? '#1E7A42' : '#8A5A00'}
                                        />
                                        <View style={isAdultDonorBadge ? styles.setupAgeBadgeCopyCompact : styles.setupAgeBadgeCopy}>
                                          <Text
                                            style={[
                                              styles.setupAgeBadgeTitle,
                                              isAdultDonorBadge ? styles.setupAgeBadgeTitleCompact : null,
                                              setupDonorAgeBadge.tone === 'success'
                                                ? styles.setupAgeBadgeTextSuccess
                                                : styles.setupAgeBadgeTextWarning,
                                            ]}
                                          >
                                            {setupDonorAgeBadge.label}
                                          </Text>
                                          {setupDonorAgeBadge.category !== 'Adult' ? (
                                            <Text style={styles.setupAgeBadgeHint}>
                                              Guardian consent is required before this account can join donation events.
                                            </Text>
                                          ) : null}
                                        </View>
                                        {!isAdultDonorBadge && !hasActiveGuardianConsent ? (
                                          <View style={styles.setupAgeBadgeAction}>
                                            <AppIcon name="chevronRight" size="sm" color="#8A5A00" />
                                          </View>
                                        ) : null}
                                      </Pressable>
                                    ) : null}
                                  </View>
                                );
                              }

                              if (field.formKey === 'suffix') {
                                return (
                                  <>
                                    <AddressSelectField
                                      label={field.label}
                                      required={isRequiredField}
                                      value={controllerField.value}
                                      placeholder={emptyFieldText}
                                      helperText={field.helperText}
                                      error={fieldState.error?.message}
                                      onPress={async () => {
                                        await Haptics.selectionAsync();
                                        setActiveProfilePicker('suffix');
                                      }}
                                      leftIcon={profileEditFieldIcons.suffix}
                                      {...profileEditSelectProps}
                                    />

                                    <AddressOptionSheet
                                      visible={activeProfilePicker === 'suffix'}
                                      title="Select Suffix"
                                      placeholder="Search suffix"
                                      options={profileSuffixOptions}
                                      selectedValue={controllerField.value}
                                      allowDeselect
                                      onClose={() => setActiveProfilePicker('')}
                                      onClearSelection={() => {
                                        profileForm.setValue('suffix', '', {
                                          shouldDirty: true,
                                          shouldTouch: true,
                                          shouldValidate: true,
                                        });
                                      }}
                                      onSelect={(option) => {
                                        profileForm.setValue('suffix', option.value, {
                                          shouldDirty: true,
                                          shouldTouch: true,
                                          shouldValidate: true,
                                        });
                                      }}
                                    />
                                  </>
                                );
                              }

                              if (field.formKey === 'gender') {
                                return (
                                  <>
                                    <AddressSelectField
                                      label={field.label}
                                      required={isRequiredField}
                                      value={watchedGender}
                                      placeholder={emptyFieldText}
                                      helperText={field.helperText}
                                      error={fieldState.error?.message}
                                      onPress={async () => {
                                        await Haptics.selectionAsync();
                                        setActiveProfilePicker('gender');
                                      }}
                                      leftIcon={profileEditFieldIcons.gender}
                                      {...profileEditSelectProps}
                                    />

                                    <AddressOptionSheet
                                      visible={activeProfilePicker === 'gender'}
                                      title="Select Gender"
                                      placeholder="Search gender"
                                      options={profileGenderOptions}
                                      selectedValue={watchedGender}
                                      onClose={() => setActiveProfilePicker('')}
                                      onSelect={(option) => {
                                        profileForm.setValue('gender', option.value, {
                                          shouldDirty: true,
                                          shouldTouch: true,
                                          shouldValidate: true,
                                        });
                                      }}
                                    />
                                  </>
                                );
                              }

                              return (
                                <AppInput
                                  label={field.label}
                                  required={isRequiredField}
                                  placeholder={emptyFieldText}
                                  keyboardType={field.keyboardType}
                                  helperText={field.helperText}
                                  disabled={field.editable === false}
                                  value={controllerField.value}
                                  onChangeText={(nextValue) => {
                                    controllerField.onChange(
                                      field.formKey === 'phone' ? formatPhilippineMobileInput(nextValue) : nextValue
                                    );
                                  }}
                                  maxLength={field.formKey === 'phone' ? 11 : undefined}
                                  onBlur={controllerField.onBlur}
                                  error={fieldState.error?.message}
                                  leftIcon={profileEditFieldIcons[field.formKey]}
                                  {...profileEditInputProps}
                                />
                              );
                            }}
                          />
                        );
                      })}

                    </ScrollView>

                    <View
                      style={[
                        styles.editModalFooter,
                        {
                          backgroundColor: roles.defaultCardBackground,
                          borderTopColor: roles.defaultCardBorder,
                        },
                      ]}
                    >
                      <ProfileModalActionButton
                        title="Cancel"
                        icon="arrow-left"
                        onPress={requestEditModalClose}
                        roles={roles}
                        variant="secondary"
                        disabled={isSavingProfile}
                      />
                      <ProfileModalActionButton
                        title={saveSuccess ? 'Saved' : 'Save changes'}
                        icon={saveSuccess ? 'check-circle-outline' : 'content-save-check-outline'}
                        loading={isSavingProfile}
                        disabled={isSavingProfile}
                        onPress={profileForm.handleSubmit(
                          submitProfile,
                          () => setFloatingFeedback('error', 'Check Your Details', 'Please correct the highlighted profile fields before saving.')
                        )}
                        roles={roles}
                      />
                    </View>
                  </>
                ) : null}

                {mode === 'password' ? (
                  <>
                    <LinearGradient
                      colors={role === 'patient'
                        ? [theme.colors.dashboardPatientFrom, theme.colors.dashboardPatientTo]
                        : [theme.colors.dashboardDonorFrom, theme.colors.dashboardDonorTo]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[
                        styles.passwordModalHeader,
                        { borderBottomColor: roles.primaryActionBackground },
                      ]}
                    >
                      <View pointerEvents="none" style={styles.editModalHeaderGlow} />
                      <View style={styles.passwordModalHeaderIcon}>
                        <AppIcon name="lock-outline" size="md" color={roles.primaryActionText} />
                      </View>
                      <View style={styles.passwordModalHeaderCopy}>
                        <Text style={[styles.passwordModalTitle, { color: roles.primaryActionText }]}>Change password</Text>
                        <Text style={[styles.passwordModalSubtitle, { color: roles.primaryActionText }]}>Create a secure password for your account.</Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close change password"
                        onPress={handleModalClose}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.editModalCloseButton,
                          { backgroundColor: 'rgba(255,255,255,0.16)', opacity: pressed ? 0.72 : 1 },
                        ]}
                      >
                        <AppIcon name="close" size="sm" color={roles.primaryActionText} />
                      </Pressable>
                    </LinearGradient>

                    <ScrollView
                      style={[styles.passwordModalBodyScroll, { maxHeight: modalMaxHeight - 92 }]}
                      contentContainerStyle={styles.passwordModalBodyContent}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode="interactive"
                      nestedScrollEnabled={true}
                    >
                      <View style={[styles.passwordMeterCard, { backgroundColor: roles.supportCardBackground }]}>
                        <View style={styles.passwordMeterHeader}>
                          <AppIcon
                            name={passwordStrengthVariant === 'success' ? 'success' : 'shield'}
                            color={passwordStrengthVariant === 'success' ? theme.colors.textSuccess : roles.iconPrimaryColor}
                            size="sm"
                          />
                          <Text style={[styles.passwordMeterTitle, { color: roles.headingText }]}>Password strength</Text>
                        </View>
                        <Text style={[styles.passwordMeterMessage, { color: roles.bodyText }]}>
                          {watchedNewPassword
                            ? passwordStrengthMessage
                            : 'Use at least 8 characters with uppercase, lowercase, a number, and a special character.'}
                        </Text>
                      </View>

                      {passwordFieldConfig.map((field) => (
                        <Controller
                          key={field.key}
                          control={passwordForm.control}
                          name={field.key}
                          render={({ field: controllerField, fieldState }) => (
                            <PasswordInput
                              label={field.label}
                              placeholder={field.placeholder}
                              helperText={field.helperText}
                              value={controllerField.value}
                              onChangeText={controllerField.onChange}
                              onBlur={controllerField.onBlur}
                              error={fieldState.error?.message}
                              leftIcon={passwordFieldIcons[field.key]}
                              toggleIconColor={roles.primaryActionBackground}
                              {...profileEditInputProps}
                            />
                          )}
                        />
                      ))}

                      <View style={styles.profileModalActionRow}>
                        <ProfileGradientActionButton
                          title="Close"
                          onPress={handleModalClose}
                          textColor={primaryTextColor}
                          fillColors={PROFILE_ACTION_MUTED_FILL_GRAD}
                          borderColors={PROFILE_ACTION_BORDER_GRAD}
                          variant="outline"
                          showShine={false}
                          style={styles.profileModalActionShell}
                          buttonStyle={styles.profileModalActionButton}
                        />
                        <ProfileGradientActionButton
                          title="Update Password"
                          loading={isChangingPassword}
                          success={passwordSuccess}
                          onPress={passwordForm.handleSubmit(
                            submitPassword,
                            () => setFloatingFeedback('error', 'Password Not Ready', 'Please resolve the highlighted password fields before continuing.')
                          )} 
                          textColor={roles.primaryActionText}
                          fillColors={PROFILE_ACTION_FILL_GRAD}
                          borderColors={PROFILE_ACTION_BORDER_GRAD}
                          variant="outline"
                          style={styles.profileModalActionShell}
                          buttonStyle={styles.profileModalActionButton}
                        />
                      </View>
                    </ScrollView>
                  </>
                ) : null}
              </AppCard>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        <Modal
          transparent
          statusBarTranslucent
          navigationBarTranslucent
          visible={isGuardianConsentModalOpen}
          animationType="fade"
          onRequestClose={closeGuardianConsentModal}
        >
          <KeyboardAvoidingView
            style={styles.modalKeyboardWrap}
            behavior="padding"
            enabled={Platform.OS === 'ios'}
          >
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={closeGuardianConsentModal} />

              <AppCard
                variant="elevated"
                radius="xl"
                padding="none"
                style={[styles.guardianConsentModalCard, { maxHeight: modalMaxHeight }]}
                contentStyle={styles.guardianConsentModalContent}
              >
                <LinearGradient
                  colors={[theme.colors.palette.wine900, roles.primaryActionBackground, theme.colors.palette.wine700]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.guardianConsentHeader}
                >
                  <View pointerEvents="none" style={styles.guardianConsentHeaderGlow} />
                  <View style={styles.guardianConsentHeaderIcon}>
                    <AppIcon name="shield-account-outline" color={roles.primaryActionText} size="lg" />
                  </View>
                  <View style={styles.guardianConsentHeaderCopy}>
                    <Text style={[styles.guardianConsentEyebrow, { color: roles.primaryActionText }]}>MINOR ACCOUNT</Text>
                    <Text style={[styles.guardianConsentTitle, { color: roles.primaryActionText }]}>Guardian consent</Text>
                    <Text style={[styles.guardianConsentSubtitle, { color: roles.primaryActionText }]}>
                      A parent or legal guardian must review and approve participation.
                    </Text>
                  </View>
                </LinearGradient>

                <ScrollView
                  style={styles.guardianConsentBodyScroll}
                  contentContainerStyle={styles.guardianConsentBody}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  nestedScrollEnabled={true}
                >
                  <AppInput
                    label="Guardian Full Name"
                    required
                    placeholder="Parent or legal guardian name"
                    value={guardianConsentForm.guardianFullName}
                    onChangeText={(value) => updateGuardianConsentField('guardianFullName', value)}
                    error={guardianConsentErrors.guardianFullName}
                    leftIcon={guardianConsentFieldIcons.guardianFullName}
                    {...profileEditInputProps}
                  />
                  <AppInput
                    label="Relationship"
                    required
                    placeholder="Mother, father, legal guardian"
                    value={guardianConsentForm.guardianRelationship}
                    onChangeText={(value) => updateGuardianConsentField('guardianRelationship', value)}
                    error={guardianConsentErrors.guardianRelationship}
                    leftIcon={guardianConsentFieldIcons.guardianRelationship}
                    {...profileEditInputProps}
                  />
                  <AppInput
                    label="Guardian Contact Number"
                    required
                    placeholder="09XXXXXXXXX"
                    keyboardType="phone-pad"
                    value={guardianConsentForm.guardianContactNumber}
                    onChangeText={(value) => updateGuardianConsentField('guardianContactNumber', formatPhilippineMobileInput(value))}
                    maxLength={11}
                    error={guardianConsentErrors.guardianContactNumber}
                    leftIcon={guardianConsentFieldIcons.guardianContactNumber}
                    {...profileEditInputProps}
                  />
                  <AppInput
                    label="Guardian Email"
                    placeholder="Optional email address"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={guardianConsentForm.guardianEmail}
                    onChangeText={(value) => updateGuardianConsentField('guardianEmail', value)}
                    leftIcon={guardianConsentFieldIcons.guardianEmail}
                    {...profileEditInputProps}
                  />

                  <View style={styles.guardianConsentNotice}>
                    <View style={styles.guardianConsentNoticeHeader}>
                      <View style={[styles.guardianConsentNoticeIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                        <AppIcon name="file-document-check-outline" size="sm" color={roles.primaryActionBackground} />
                      </View>
                      <View style={styles.guardianConsentNoticeHeadingCopy}>
                        <Text style={[styles.guardianConsentNoticeTitle, { color: roles.headingText }]}>
                          Consent document preview
                        </Text>
                        <Text style={[styles.guardianConsentNoticeMeta, { color: roles.metaText }]}>
                          {isLoadingGuardianConsentDocument
                            ? 'Loading the current consent...'
                            : guardianConsentDocument?.version
                              ? `Version ${guardianConsentDocument.version} · Tap the preview to read`
                              : 'Tap the preview to read the complete document'}
                        </Text>
                      </View>
                    </View>

                    {isLoadingGuardianConsentDocument ? (
                      <View style={styles.guardianConsentLoadingRow}>
                        <ActivityIndicator size="small" color={roles.primaryActionBackground} />
                        <Text style={[styles.guardianConsentLoadingText, { color: roles.bodyText }]}>Loading consent from the database</Text>
                      </View>
                    ) : guardianConsentDocumentError ? (
                      <View style={styles.guardianConsentLoadError}>
                        <View style={styles.guardianConsentLoadErrorCopy}>
                          <AppIcon name="alert-circle-outline" size="sm" color={theme.colors.textError} />
                          <Text style={styles.guardianConsentLoadErrorText}>{guardianConsentDocumentError}</Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Retry loading guardian consent"
                          onPress={loadGuardianConsentDocument}
                          style={[styles.guardianConsentRetryButton, { borderColor: roles.primaryActionBackground }]}
                        >
                          <AppIcon name="refresh" size="sm" color={roles.primaryActionBackground} />
                          <Text style={[styles.guardianConsentRetryText, { color: roles.primaryActionBackground }]}>Try again</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <LegalDocumentPreview document={guardianConsentDocument} roles={roles} />
                    )}
                  </View>

                  <View style={styles.guardianAgreementBlock}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel="Accept the guardian consent agreement"
                      accessibilityState={{
                        checked: Boolean(guardianConsentForm.guardianAgreementAccepted),
                        disabled: isSavingGuardianConsent || isLoadingGuardianConsentDocument || !hasCurrentGuardianConsentDocument,
                      }}
                      disabled={isSavingGuardianConsent || isLoadingGuardianConsentDocument || !hasCurrentGuardianConsentDocument}
                      onPress={() => updateGuardianConsentField('guardianAgreementAccepted', !guardianConsentForm.guardianAgreementAccepted)}
                      android_ripple={{ color: theme.colors.surfacePressed, borderless: false }}
                      style={[
                        styles.guardianAgreementRow,
                        {
                          backgroundColor: roles.supportCardBackground,
                          borderColor: guardianConsentErrors.guardianAgreementAccepted
                            ? theme.colors.borderError
                            : roles.supportCardBorder,
                        },
                        isLoadingGuardianConsentDocument || !hasCurrentGuardianConsentDocument
                          ? styles.guardianAgreementRowDisabled
                          : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.guardianAgreementCheckbox,
                          guardianConsentForm.guardianAgreementAccepted
                            ? {
                                backgroundColor: roles.primaryActionBackground,
                                borderColor: roles.primaryActionBackground,
                              }
                            : null,
                        ]}
                      >
                        {guardianConsentForm.guardianAgreementAccepted ? (
                          <AppIcon name="checkmark" size="sm" color={roles.primaryActionText} />
                        ) : null}
                      </View>
                      <View style={styles.guardianAgreementCopy}>
                        <Text style={[styles.guardianAgreementTitle, { color: roles.headingText }]}>Required confirmation</Text>
                        <Text style={[styles.guardianAgreementText, { color: roles.bodyText }]}>
                          I have read and agree to the{' '}
                          <Text style={[styles.guardianAgreementLink, { color: roles.primaryActionBackground }]}>Guardian Consent</Text>
                          . I confirm that I am authorized to provide consent and that the information above is correct.
                        </Text>
                      </View>
                    </Pressable>
                    {guardianConsentErrors.guardianAgreementAccepted ? (
                      <Text style={styles.guardianConsentError}>{guardianConsentErrors.guardianAgreementAccepted}</Text>
                    ) : null}
                  </View>

                </ScrollView>

                <View style={[styles.guardianConsentFooter, { backgroundColor: roles.defaultCardBackground, borderTopColor: roles.defaultCardBorder }]}>
                  <ProfileModalActionButton
                    title="Cancel"
                    icon="arrow-left"
                    onPress={closeGuardianConsentModal}
                    roles={roles}
                    variant="secondary"
                    disabled={isSavingGuardianConsent}
                  />
                  <ProfileModalActionButton
                    title="Save consent"
                    icon="shield-check-outline"
                    loading={isSavingGuardianConsent}
                    onPress={submitGuardianConsent}
                    roles={roles}
                    disabled={isLoadingGuardianConsentDocument || !hasCurrentGuardianConsentDocument}
                  />
                </View>
              </AppCard>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </DashboardLayout>

      <Modal
        transparent
        visible={isLanguageModalOpen}
        animationType="fade"
        onRequestClose={() => setIsLanguageModalOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.languageModalOverlay}>
          <Pressable
            accessibilityLabel={t('common.close')}
            onPress={() => setIsLanguageModalOpen(false)}
            style={styles.languageModalBackdrop}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.languageModalCard,
              { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder },
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={[roles.primaryActionBackground, theme.colors.palette.wine700]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.languageModalAccent}
            />
            <View style={styles.languageModalHeader}>
              <View style={[styles.languageModalHeaderIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <AppIcon name="translate" size="lg" color={roles.primaryActionBackground} />
              </View>
              <View style={styles.languageModalHeaderCopy}>
                <Text style={[styles.languageModalTitle, { color: primaryTextColor }]}>{t('language.title')}</Text>
                <Text style={[styles.languageModalSubtitle, { color: roles.metaText }]}>{t('language.subtitle')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                hitSlop={8}
                onPress={() => setIsLanguageModalOpen(false)}
                style={[styles.languageModalClose, { backgroundColor: roles.iconPrimarySurface }]}
              >
                <AppIcon name="close" size="sm" color={roles.primaryActionBackground} />
              </Pressable>
            </View>

            <View style={styles.languageOptionList}>
              {supportedLanguages.map((option) => {
                const selected = language === option.code;
                const descriptionKey = option.code === 'fil'
                  ? 'language.filipinoDescription'
                  : 'language.englishDescription';
                return (
                  <Pressable
                    key={option.code}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      void setLanguage(option.code);
                      void Haptics.selectionAsync();
                    }}
                    style={({ pressed }) => [
                      styles.languageOptionPressable,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.languageOptionSurface,
                        {
                          backgroundColor: selected ? roles.iconPrimarySurface : roles.pageBackground,
                          borderColor: selected ? roles.primaryActionBackground : roles.defaultCardBorder,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.languageOptionCode,
                          { backgroundColor: selected ? roles.primaryActionBackground : roles.supportCardBackground },
                        ]}
                      >
                        <Text style={[styles.languageOptionCodeText, { color: selected ? roles.primaryActionText : roles.headingText }]}>
                          {option.code === 'fil' ? 'FIL' : 'EN'}
                        </Text>
                      </View>
                      <View style={styles.languageOptionCopy}>
                        <Text style={[styles.languageOptionTitle, { color: primaryTextColor }]}>{option.nativeLabel}</Text>
                        <Text numberOfLines={2} style={[styles.languageOptionSubtitle, { color: roles.metaText }]}>
                          {t(descriptionKey)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.languageRadio,
                          { borderColor: selected ? roles.primaryActionBackground : roles.defaultCardBorder },
                          selected ? { backgroundColor: roles.primaryActionBackground } : null,
                        ]}
                      >
                        {selected ? <AppIcon name="checkmark" size="sm" color={roles.primaryActionText} /> : null}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={isLogoutConfirmationOpen}
        animationType="fade"
        onRequestClose={closeLogoutConfirmation}
        statusBarTranslucent
      >
        <View style={styles.logoutConfirmationOverlay}>
          <Pressable
            accessibilityLabel="Keep account signed in"
            disabled={isLoggingOut}
            onPress={closeLogoutConfirmation}
            style={styles.logoutConfirmationBackdrop}
          />

          <View
            accessibilityViewIsModal
            style={[
              styles.logoutConfirmationCard,
              {
                backgroundColor: theme.colors.surfaceCard,
                borderColor: theme.colors.borderSubtle,
              },
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.logoutConfirmationAccent}
            />

            <View style={[styles.logoutConfirmationIcon, { backgroundColor: theme.colors.surfaceSoft }]}>
              <AppIcon name="signOut" size="lg" color={theme.colors.textError} />
            </View>

            <Text style={[styles.logoutConfirmationEyebrow, { color: theme.colors.brandPrimary }]}>{t('logout.eyebrow')}</Text>
            <Text style={[styles.logoutConfirmationTitle, { color: theme.colors.textPrimary }]}>{t('logout.title')}</Text>
            <Text style={[styles.logoutConfirmationBody, { color: theme.colors.textSecondary }]}>
              {t('logout.body')}
            </Text>

            <View style={[styles.logoutConfirmationNote, { backgroundColor: theme.colors.surfaceSoft, borderColor: theme.colors.borderSubtle }]}>
              <AppIcon name="shield" size="sm" color={theme.colors.brandPrimary} />
              <Text style={[styles.logoutConfirmationNoteText, { color: theme.colors.textSecondary }]}>{t('logout.note')}</Text>
            </View>

            <View style={styles.logoutConfirmationActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm logout"
                accessibilityState={{ busy: isLoggingOut, disabled: isLoggingOut }}
                disabled={isLoggingOut}
                onPress={handleConfirmLogout}
                style={({ pressed }) => [
                  styles.logoutConfirmationActionPressable,
                  pressed && !isLoggingOut ? styles.logoutConfirmationButtonPressed : null,
                  isLoggingOut ? styles.logoutConfirmationButtonDisabled : null,
                ]}
              >
                <LinearGradient
                  colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.logoutConfirmationButtonSurface}
                >
                  {isLoggingOut ? (
                    <ActivityIndicator size="small" color={theme.colors.textOnBrand} />
                  ) : (
                    <AppIcon name="signOut" size="sm" color={theme.colors.textOnBrand} />
                  )}
                  <Text style={[styles.logoutConfirmationButtonText, { color: theme.colors.textOnBrand }]}>
                    {isLoggingOut ? t('logout.loading') : t('profile.logout')}
                  </Text>
                </LinearGradient>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stay signed in"
                disabled={isLoggingOut}
                onPress={closeLogoutConfirmation}
                style={({ pressed }) => [
                  styles.logoutConfirmationActionPressable,
                  pressed && !isLoggingOut ? styles.logoutConfirmationButtonPressed : null,
                  isLoggingOut ? styles.logoutConfirmationButtonDisabled : null,
                ]}
              >
                <View
                  style={[
                    styles.logoutConfirmationButtonSurface,
                    {
                      backgroundColor: theme.colors.surfaceCard,
                      borderColor: theme.colors.borderStrong,
                    },
                  ]}
                >
                  <AppIcon name="close" size="sm" color={theme.colors.textPrimary} />
                  <Text style={[styles.logoutConfirmationButtonText, { color: theme.colors.textPrimary }]}>{t('logout.stay')}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <StatusBanner
        presentation="floating"
        visible={Boolean(feedback?.message)}
        variant={feedback?.type || 'info'}
        title={feedback?.title}
        message={feedback?.message}
        onDismiss={() => setFeedback(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  profileMainShell: {
    gap: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  profileStickyHeroHost: {
    width: '100%',
    alignSelf: 'stretch',
    paddingBottom: 2,
  },
  patientStickyHeroHost: {
    paddingTop: 0,
    paddingBottom: theme.spacing.xs,
    zIndex: 2,
  },
  profileTopAppBar: {
    minHeight: 56,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  profileTopIconButton: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileBrandTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
    letterSpacing: 0.3,
  },
  profileHeroPanel: {
    position: 'relative',
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    padding: theme.spacing.md,
    gap: 10,
    ...theme.shadows.card,
  },
  profileHeroGlowLarge: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    right: -62,
    top: -102,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  profileHeroGlowSmall: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    left: -52,
    bottom: -68,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  profileHeroIdentityRow: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  profileHeroPhotoButton: {
    position: 'relative',
    flexShrink: 0,
  },
  profileHeroPhoto: {
    width: 68,
    height: 68,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7F9',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.82)',
  },
  profileHeroPhotoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: theme.colors.palette.wine700,
  },
  profileHeroCopyCentered: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
  },
  profileHeroDisplayName: {
    width: '100%',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  profileHeroContactRow: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 5,
  },
  profileHeroContactItem: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  profileHeroContactText: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: '#F9EDEF',
  },
  profileHeroMetricsRow: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: theme.spacing.sm,
  },
  profileHeroMetricPressable: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    maxWidth: '50%',
    alignSelf: 'stretch',
    borderRadius: 16,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  profileHeroMetricCard: {
    flex: 1,
    alignSelf: 'stretch',
    minHeight: 52,
    borderWidth: 1,
    borderColor: 'rgba(116,20,43,0.08)',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  profileHeroMetricCardPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  profileHeroMetricIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'rgba(116,20,43,0.10)',
    backgroundColor: 'rgba(116,20,43,0.08)',
  },
  profileHeroMetricIconEmphasized: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  profileHeroMetricTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.palette.wine900,
  },
  profileHeroMetricTitleEmphasized: {
    color: '#FFFFFF',
  },
  profileHeroMetricCount: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: 'rgba(114,20,43,0.10)',
  },
  profileHeroMetricCountEmphasized: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  profileHeroMetricCountText: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.palette.wine900,
  },
  profileHeroMetricCountTextEmphasized: {
    color: '#FFFFFF',
  },
  profileActionGradientBorder: {
    flex: 1,
    borderRadius: 14,
    padding: 2,
    overflow: 'hidden',
    shadowColor: '#c8864f',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 2,
  },
  profileActionGradientFill: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  profileActionDiagonalShine: {
    position: 'absolute',
    top: -44,
    left: 18,
    width: 34,
    height: 150,
    transform: [{ rotate: '22deg' }],
  },
  profileActionButton: {
    minHeight: 40,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 0,
    marginTop: 0,
  },
  profileActionButtonText: {
    textAlign: 'center',
  },
  profileSection: {
    gap: theme.spacing.md,
  },
  profileSectionHeader: {
    paddingHorizontal: theme.spacing.xs,
  },
  profileSectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: 2,
  },
  profileSectionHeadingIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.soft,
  },
  profileSectionHeadingText: {
    flex: 1,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  profileDonorSectionShell: {
    gap: theme.spacing.sm,
  },
  profileSectionShell: {
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    ...theme.shadows.soft,
  },
  profileSectionEyebrow: {
    paddingHorizontal: theme.spacing.xs,
    marginBottom: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: theme.colors.textSecondary,
  },
  profileMenuRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 18,
    ...theme.shadows.soft,
  },
  profileMenuIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  profileMenuIconDanger: {
    backgroundColor: '#FBE8EC',
  },
  profileMenuCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileMenuTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  profileMenuSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: 17,
    color: theme.colors.textMuted,
  },
  profileMenuTitleDanger: {
    color: theme.colors.textError,
  },
  profileMenuBadge: {
    minWidth: 26,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
  },
  profileMenuBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textOnBrand,
  },
  profileMoreCard: {
    overflow: 'hidden',
    borderRadius: 18,
    paddingVertical: theme.spacing.xs,
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  profileMorePressable: {
    width: '100%',
  },
  profileMoreRow: {
    width: '100%',
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 18,
    ...theme.shadows.soft,
  },
  profileMoreIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  profileMoreCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileMoreText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  profileMoreSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: 17,
    color: theme.colors.textMuted,
  },
  profileMoreChevron: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRowLast: {
    borderBottomWidth: 1,
  },
  profileLogoutSection: {
    width: '100%',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.lg,
  },
  profileLogoutButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: theme.radius.lg,
    backgroundColor: '#FFF8F9',
  },
  profileVersionText: {
    width: '100%',
    textAlign: 'center',
    alignSelf: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.4,
    color: theme.colors.textMuted,
  },
  patientProfileShell: {
    gap: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
  },
  patientProfileHero: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 24,
    padding: theme.spacing.lg,
    ...theme.shadows.card,
  },
  patientProfileHeroGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -46,
    top: -82,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  patientProfileIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  patientProfileAvatarButton: {
    position: 'relative',
    flexShrink: 0,
  },
  patientProfileAvatar: {
    width: 82,
    height: 82,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF9FA',
    borderColor: 'rgba(255,255,255,0.72)',
    borderWidth: 3,
    ...theme.shadows.soft,
  },
  patientProfileAvatarText: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.palette.wine800,
  },
  patientProfileCameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.palette.wine800,
    backgroundColor: '#FFFFFF',
  },
  patientProfileIdentityCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    gap: 7,
  },
  patientProfileName: {
    maxWidth: '100%',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  patientProfileStatusPill: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  patientProfileStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  patientProfileCode: {
    maxWidth: '100%',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: '#F7DDE4',
  },
  patientProfileGrid: {
    gap: theme.spacing.lg,
  },
  patientMedicalAccessButton: {
    width: '100%',
    borderRadius: 22,
  },
  patientMedicalAccessButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  patientMedicalAccessCard: {
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.md,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  patientMedicalAccessIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  patientMedicalAccessCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  patientMedicalAccessTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  patientMedicalAccessText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: 17,
  },
  patientMedicalAccessBadge: {
    alignSelf: 'flex-start',
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    marginTop: 3,
  },
  patientMedicalAccessBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  patientMedicalAccessArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  patientSettingsList: {
    gap: theme.spacing.sm,
  },
  patientProfileCard: {
    gap: theme.spacing.md,
    borderRadius: 18,
  },
  patientProfileCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  patientProfileCardTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    marginBottom: theme.spacing.md,
  },
  patientProfileRows: {
    gap: theme.spacing.sm,
  },
  patientProfileRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderSubtle,
  },
  patientProfileRowIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patientProfileRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  patientProfileRowTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
  },
  patientProfileRowValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  patientProfileRowBadge: {
    minHeight: 28,
    maxWidth: 96,
    justifyContent: 'center',
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
  },
  patientProfileRowBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  patientProfileLogoutButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceCard,
  },
  donorProfileShell: {
    overflow: 'hidden',
    borderRadius: 18,
  },
  donorProfileHeader: {
    minHeight: 242,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
    borderRadius: 18,
    borderWidth: 1,
  },
  donorTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  donorHeaderEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  donorHeaderTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  donorHeaderIconButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  donorIdentityBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.lg,
  },
  donorAvatarButton: {
    marginBottom: theme.spacing.xs,
  },
  donorProfileAvatar: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 4,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.surfaceCard,
  },
  donorProfileName: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  donorProfileMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: 'center',
  },
  donorAgeBadge: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 7,
    marginTop: theme.spacing.xs,
  },
  donorAgeBadgeSuccess: {
    backgroundColor: '#EAF8EF',
  },
  donorAgeBadgeWarning: {
    backgroundColor: '#FFF4D8',
  },
  donorAgeBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    textAlign: 'center',
  },
  donorAgeBadgeTextSuccess: {
    color: '#1E7A42',
  },
  donorAgeBadgeTextWarning: {
    color: '#8A5A00',
  },
  setupAgeBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    borderRadius: 18,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
  },
  setupAgeBadgeCompact: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xxs,
    minHeight: 0,
  },
  setupAgeBadgeSuccess: {
    backgroundColor: '#EAF8EF',
    borderColor: '#BFE8CD',
  },
  setupAgeBadgeWarning: {
    backgroundColor: '#FFF4D8',
    borderColor: '#F2D38B',
  },
  setupAgeBadgeCopy: {
    flex: 1,
    gap: 2,
  },
  setupAgeBadgeCopyCompact: {
    flex: 0,
    gap: 0,
  },
  setupAgeBadgeTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  setupAgeBadgeTitleCompact: {
    fontSize: theme.typography.compact.label,
    lineHeight: theme.typography.compact.label * theme.typography.lineHeights.snug,
  },
  setupAgeBadgeHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: '#526078',
  },
  setupAgeBadgeTextSuccess: {
    color: '#1E7A42',
  },
  setupAgeBadgeTextWarning: {
    color: '#8A5A00',
  },
  setupAgeBadgeAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(138, 90, 0, 0.10)',
    flexShrink: 0,
  },
  donorActionPanel: {
    marginTop: -theme.spacing.xl,
    minHeight: 360,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
  },
  donorActionHeader: {
    gap: 4,
    marginBottom: theme.spacing.md,
  },
  donorActionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  donorActionSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  profileHeroCard: {
    overflow: 'hidden',
  },
  profileHeroTopRow: {
    marginBottom: theme.spacing.md,
  },
  profileHeroIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  profileHeroAvatar: {
    width: 74,
    height: 74,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  profileHeroAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileHeroAvatarText: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.brandPrimary,
  },
  profileHeroCopy: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  profileHeroName: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
  },
  profileHeroEmail: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  profileHeroBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  profileHeroBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  profileHeroBadgeMuted: {
    backgroundColor: theme.colors.surfaceSoft,
  },
  profileHeroBadgeSuccess: {
    backgroundColor: theme.colors.brandPrimaryMuted,
    borderColor: theme.colors.borderSubtle,
  },
  profileHeroBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  profileHeroBadgeTextSuccess: {
    color: theme.colors.textSuccess,
  },
  profileHeroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
  },
  profileHeroJoined: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  overviewTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 148,
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  overviewTileWide: {
    flexBasis: '100%',
  },
  overviewTileLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.textSecondary,
  },
  overviewTileValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
  },
  previewList: {
    gap: theme.spacing.sm,
  },
  overviewButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  overviewButton: {
    minWidth: 148,
  },
  overviewList: {
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceCard,
    overflow: 'hidden',
  },
  overviewRow: {
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  overviewLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.textSecondary,
  },
  overviewValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    color: theme.colors.textPrimary,
  },
  sectionHeader: {
    marginBottom: theme.spacing.lg,
  },
  actionList: {
    gap: theme.spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: 76,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 20,
    ...theme.shadows.soft,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  actionIconWrapDanger: {
    backgroundColor: theme.colors.surfaceSoft,
  },
  actionTextWrap: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  summaryCompactCard: {
    paddingVertical: theme.spacing.sm,
  },
  summaryCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryCompactCell: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  summaryCompactDivider: {
    width: 1,
    height: 40,
    backgroundColor: theme.colors.borderSubtle,
    marginHorizontal: theme.spacing.md,
  },
  summaryCompactLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: theme.colors.textSecondary,
  },
  summaryCompactValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  summaryCompactValueReady: {
    color: theme.colors.textSuccess,
  },
  actionTitleDanger: {
    color: theme.colors.textError,
  },
  actionDescription: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  profileModalActionRow: {
    marginTop: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
  },
  profileModalActionShell: {
    flex: 1,
    minWidth: 0,
  },
  profileModalActionButton: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 0,
    marginTop: 0,
    paddingVertical: 7,
  },
  passwordMeterCard: {
    marginBottom: theme.spacing.md,
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
  },
  passwordMeterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  passwordMeterTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  passwordMeterMessage: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  profileEditPhotoSection: {
    width: '100%',
    marginBottom: theme.spacing.lg,
    paddingVertical: 0,
  },
  profileEditPhotoPressable: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  profileEditPhotoSurface: {
    width: '100%',
    minHeight: 122,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...theme.shadows.soft,
  },
  profileEditPhotoAvatarWrap: {
    width: 92,
    height: 92,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditPhotoAvatar: {
    width: 84,
    height: 84,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    ...theme.shadows.soft,
  },
  profileEditPhotoAvatarImage: {
    width: '100%',
    height: '100%',
  },
  profileEditPhotoAvatarText: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  profileEditPhotoBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 30,
    height: 30,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    ...theme.shadows.soft,
  },
  profileEditPhotoCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: theme.spacing.md,
  },
  profileEditPhotoTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 22,
  },
  profileEditPhotoHint: {
    marginTop: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  profileEditPhotoLabel: {
    minHeight: 30,
    alignSelf: 'flex-start',
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  profileEditPhotoLabelText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  profileEditFieldContainer: {
    marginBottom: theme.spacing.xs,
    minHeight: 0,
  },
  profileEditFieldLabel: {
    fontSize: theme.typography.compact.label,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  profileEditFieldShell: {
    minHeight: 52,
    borderRadius: 16,
    shadowColor: theme.colors.palette.wine900,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    shadowOpacity: 0.06,
    elevation: 1,
  },
  profileEditInputIconSurface: {
    left: 10,
    top: 9,
    width: 34,
    height: 34,
    borderRadius: 12,
  },
  profileEditFieldIconSurface: {
    width: 34,
    height: 34,
    borderRadius: 12,
  },
  profileEditFieldActionSurface: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  profileEditFieldText: {
    fontSize: theme.typography.semantic.body,
  },
  profileEditFieldHelper: {
    fontSize: theme.typography.compact.caption,
  },
  profileEditFieldError: {
    fontSize: theme.typography.compact.caption,
  },
  modalCard: {
    width: '100%',
    alignSelf: 'center',
    maxWidth: theme.layout.authCardMaxWidth,
    borderRadius: 18,
    minHeight: 0,
    overflow: 'hidden',
    flexShrink: 1,
  },
  editProfileModalCard: {
    height: '100%',
  },
  passwordModalCard: {
    borderRadius: 26,
  },
  modalCardContent: {
    minHeight: 0,
  },
  editModalCardContent: {
    flex: 1,
    minHeight: 0,
  },
  editModalHeader: {
    minHeight: 76,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  editModalHeaderGlow: {
    position: 'absolute',
    width: 118,
    height: 118,
    borderRadius: 59,
    right: -34,
    top: -70,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  editModalHeaderCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: theme.spacing.md,
  },
  editModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 24,
  },
  editModalSubtitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    opacity: 0.82,
  },
  editModalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  editModalBodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  editModalBodyContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  editModalSectionHeading: {
    minHeight: 48,
    marginBottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  editModalSectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: theme.spacing.md,
  },
  editModalSectionCopy: {
    flex: 1,
    minWidth: 0,
  },
  editModalSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 22,
  },
  editModalSectionText: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  editModalFooter: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
  },
  editModalActionButton: {
    width: '100%',
    minHeight: 52,
    borderRadius: 18,
    overflow: 'hidden',
  },
  editModalActionSlot: {
    flex: 1,
    minWidth: 0,
    ...theme.shadows.soft,
  },
  editModalActionGradientBorder: {
    width: '100%',
    minHeight: 52,
    borderRadius: 18,
    padding: 2,
    overflow: 'hidden',
  },
  editModalActionContent: {
    width: '100%',
    minHeight: 48,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    overflow: 'hidden',
  },
  editModalActionShine: {
    position: 'absolute',
    top: -42,
    left: 18,
    width: 34,
    height: 136,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    transform: [{ rotate: '22deg' }],
  },
  editModalActionText: {
    marginLeft: 6,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  passwordModalCardContent: {
    minHeight: 0,
    overflow: 'hidden',
  },
  passwordModalHeader: {
    minHeight: 88,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    overflow: 'hidden',
    flexShrink: 0,
  },
  passwordModalHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    flexShrink: 0,
  },
  passwordModalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  passwordModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 24,
  },
  passwordModalSubtitle: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    opacity: 0.82,
  },
  passwordModalBodyScroll: {
    minHeight: 0,
    flexGrow: 0,
  },
  passwordModalBodyContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
  },
  guardianConsentModalCard: {
    width: '100%',
    height: '100%',
    alignSelf: 'center',
    maxWidth: theme.layout.authCardMaxWidth,
    borderRadius: 28,
    minHeight: 0,
    overflow: 'hidden',
    flexShrink: 1,
    ...theme.shadows.card,
  },
  guardianConsentModalContent: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  guardianConsentHeader: {
    minHeight: 126,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    overflow: 'hidden',
    flexShrink: 0,
  },
  guardianConsentHeaderGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -45,
    top: -86,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  guardianConsentHeaderIcon: {
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
  guardianConsentHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  guardianConsentEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.2,
    opacity: 0.76,
  },
  guardianConsentTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  guardianConsentSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    opacity: 0.82,
  },
  guardianConsentBodyScroll: {
    flex: 1,
    minHeight: 0,
  },
  guardianConsentBody: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  guardianConsentNotice: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  guardianConsentNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  guardianConsentNoticeIcon: {
    width: 30,
    height: 30,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
    flexShrink: 0,
  },
  guardianConsentNoticeHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  guardianConsentNoticeTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  guardianConsentNoticeMeta: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  guardianConsentNoticeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  guardianConsentLoadingRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  guardianConsentLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
  },
  guardianConsentLoadError: {
    gap: theme.spacing.md,
  },
  guardianConsentLoadErrorCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  guardianConsentLoadErrorText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textError,
  },
  guardianConsentRetryButton: {
    minHeight: 38,
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  guardianConsentRetryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  guardianAgreementBlock: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  guardianAgreementRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  guardianAgreementRowDisabled: {
    opacity: 0.52,
  },
  guardianAgreementCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surfaceCard,
    marginTop: 2,
    flexShrink: 0,
  },
  guardianAgreementCopy: {
    flex: 1,
    minWidth: 0,
  },
  guardianAgreementTitle: {
    marginBottom: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  guardianAgreementText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
  },
  guardianAgreementLink: {
    fontFamily: theme.typography.fontFamily,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
  },
  guardianConsentError: {
    marginTop: 2,
    marginLeft: 36,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textError,
  },
  guardianConsentFooter: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: 1,
    flexShrink: 0,
  },
  documentModal: {
    flex: 1,
  },
  documentModalHeader: {
    minHeight: 64,
    paddingHorizontal: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  documentModalTitle: {
    color: '#fff',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  documentModalClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentModalContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  documentPdf: {
    flex: 1,
    width: '100%',
  },
  documentImage: {
    width: '100%',
    height: '100%',
  },
  documentUnavailable: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.xl,
  },
  documentUnavailableTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  documentUnavailableText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    textAlign: 'center',
  },
  documentModalActions: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  languageModalOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
    backgroundColor: 'rgba(37, 6, 14, 0.48)',
  },
  languageModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  languageModalCard: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
    overflow: 'hidden',
    ...theme.shadows.lg,
  },
  languageModalAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
  },
  languageModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  languageModalHeaderIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  languageModalHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  languageModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  languageModalSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  languageModalClose: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  languageOptionList: {
    width: '100%',
    gap: theme.spacing.sm,
  },
  languageOptionPressable: {
    width: '100%',
    borderRadius: 18,
  },
  languageOptionSurface: {
    width: '100%',
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  languageOptionCode: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  languageOptionCodeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.7,
  },
  languageOptionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  languageOptionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  languageOptionSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: 17,
  },
  languageRadio: {
    width: 28,
    height: 28,
    borderWidth: 1.5,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logoutConfirmationOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  logoutConfirmationBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  logoutConfirmationCard: {
    width: '100%',
    maxWidth: 370,
    borderWidth: 1,
    borderRadius: 26,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
    alignItems: 'center',
    overflow: 'hidden',
    ...theme.shadows.lg,
  },
  logoutConfirmationAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 6,
  },
  logoutConfirmationIcon: {
    width: 62,
    height: 62,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  logoutConfirmationEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  logoutConfirmationTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  logoutConfirmationBody: {
    marginTop: theme.spacing.sm,
    maxWidth: 300,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    textAlign: 'center',
  },
  logoutConfirmationNote: {
    width: '100%',
    minHeight: 46,
    marginTop: theme.spacing.lg,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  logoutConfirmationNoteText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
  },
  logoutConfirmationActions: {
    width: '100%',
    marginTop: theme.spacing.lg,
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  logoutConfirmationActionPressable: {
    width: '100%',
    minHeight: 52,
    borderRadius: 17,
    ...theme.shadows.soft,
  },
  logoutConfirmationButtonSurface: {
    width: '100%',
    minHeight: 52,
    borderWidth: 1,
    borderColor: theme.colors.palette.wine700,
    borderRadius: 17,
    paddingHorizontal: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  logoutConfirmationButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  logoutConfirmationButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  logoutConfirmationButtonDisabled: {
    opacity: 0.68,
  },
  modalKeyboardWrap: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    backgroundColor: theme.colors.overlay,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
});
