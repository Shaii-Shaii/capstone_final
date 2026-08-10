import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text, Pressable, Alert, ScrollView, Modal, KeyboardAvoidingView, Platform, useWindowDimensions, Image, Linking, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { DashboardLayout } from '../src/components/layout/DashboardLayout';
import { AppCard } from '../src/components/ui/AppCard';
import { AppInput } from '../src/components/ui/AppInput';
import { PasswordInput } from '../src/components/ui/PasswordInput';
import { AppButton } from '../src/components/ui/AppButton';
import { AppTextLink } from '../src/components/ui/AppTextLink';
import { AppIcon } from '../src/components/ui/AppIcon';
import { DatePickerField } from '../src/components/ui/DatePickerField';
import { StatusBanner } from '../src/components/ui/StatusBanner';
import { SectionTitleRow } from '../src/components/ui/SectionTitleRow';
import { DashboardSectionHeader } from '../src/components/ui/DashboardSectionHeader';
import { AddressOptionSheet, AddressSelectField, SignupAddressSection } from '../src/components/auth/SignupAddressSection';
import { DonorTopBar } from '../src/components/donor/DonorTopBar';
import { DonorTutorialModal } from '../src/components/donor/DonorTutorialModal';
import { PatientTutorialModal } from '../src/components/patient/PatientTutorialModal';
import { useProfileActions } from '../src/hooks/useProfileActions';
import { useNotifications } from '../src/hooks/useNotifications';
import { useAuth } from '../src/providers/AuthProvider';
import { resolveThemeRoles, theme } from '../src/design-system/theme';
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
  ensureCertificatesForScannedEventDonations,
  fetchDonationCertificatesByUserId,
  fetchHairSubmissionsByUserId,
  hasDonationFlowProgress,
  isCompletedDonationSubmission,
} from '../src/features/hairSubmission.api';
import {
  fetchActiveGuardianConsent,
  fetchActiveLegalDocument,
  getDonorProfileBadge,
  GUARDIAN_CONSENT_TEXT,
  saveGuardianConsent,
} from '../src/features/donorCompliance.service';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const MINIMUM_BIRTHDATE = new Date(1900, 0, 1);
const REQUIRED_PROFILE_FIELDS = new Set(['firstName', 'lastName', 'birthdate', 'gender', 'phone']);
const APP_VERSION_LABEL = 'Donivra v1.0.0';
const PROFILE_ACTION_BORDER_GRAD = ['#5f2f12', '#8e4f24', '#c8864f', '#ffe7ac', '#c8864f', '#8e4f24', '#5f2f12'];
const PROFILE_ACTION_FILL_GRAD = ['#8a111d', '#740c15', '#5c0910'];
const PROFILE_ACTION_MUTED_FILL_GRAD = ['#f7f2eb', '#f1ebe4'];
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

function ProfileMenuRow({ icon, title, badge, danger = false, onPress, roles: rowRoles, textColor = null }) {
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
        rowRoles ? { borderBottomColor: rowRoles.defaultCardBorder } : null,
        animatedStyle,
      ]}
    >
      <View style={[
        styles.profileMenuIconWrap,
        danger ? styles.profileMenuIconDanger : (rowRoles ? { backgroundColor: rowRoles.pageBackground } : null),
      ]}>
        <AppIcon name={icon} size="md" color={danger ? theme.colors.textError : (rowRoles?.iconPrimaryColor || theme.colors.brandPrimary)} />
      </View>
      <View style={styles.profileMenuCopy}>
        <Text style={[
          styles.profileMenuTitle,
          danger ? styles.profileMenuTitleDanger : null,
          rowRoles && !danger ? { color: textColor || rowRoles.headingText } : null,
        ]}>{title}</Text>
      </View>
      {badge != null ? (
        <View style={[styles.profileMenuBadge, rowRoles ? { backgroundColor: rowRoles.primaryActionBackground } : null]}>
          <Text style={[styles.profileMenuBadgeText, rowRoles ? { color: rowRoles.primaryActionText } : null]}>{badge}</Text>
        </View>
      ) : null}
      <AppIcon name="chevronRight" state="muted" color={rowRoles?.metaText} />
    </AnimatedPressable>
  );
}

function ProfileMoreRow({ icon, title, onPress, roles: rowRoles, textColor = null }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileMoreRow,
        rowRoles ? { borderBottomColor: rowRoles.defaultCardBorder } : null,
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[
        styles.profileMoreIconWrap,
        rowRoles ? { backgroundColor: rowRoles.pageBackground } : null,
      ]}>
        <AppIcon name={icon} size="md" color={rowRoles?.iconPrimaryColor || theme.colors.brandPrimary} />
      </View>
      <View style={styles.profileMoreCopy}>
        <Text style={[styles.profileMoreText, rowRoles ? { color: textColor || rowRoles.bodyText } : null]}>{title}</Text>
      </View>
      <AppIcon name="chevronRight" size="sm" state="muted" color={rowRoles?.metaText} />
    </Pressable>
  );
}

function PatientProfileRow({ icon, title, value, badge, onPress, danger = false, roles = null, textColor = null }) {
  const disabled = !onPress;
  const rowRoles = roles || {};

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.patientProfileRow,
        {
          opacity: pressed ? 0.72 : 1,
          borderBottomColor: rowRoles.supportCardBorder || theme.colors.borderSubtle,
        },
      ]}
    >
      <View
        style={[
          styles.patientProfileRowIcon,
          { backgroundColor: danger ? theme.colors.surfaceSoft : rowRoles.iconPrimarySurface || theme.colors.brandPrimaryMuted },
        ]}
      >
        <AppIcon
          name={icon}
          size="md"
          color={danger ? theme.colors.textError : rowRoles.iconPrimaryColor || theme.colors.brandPrimary}
        />
      </View>
      <View style={styles.patientProfileRowCopy}>
        <Text
          numberOfLines={1}
          style={[
            styles.patientProfileRowTitle,
            { color: danger ? theme.colors.textError : textColor || rowRoles.headingText || theme.colors.textPrimary },
          ]}
        >
          {title}
        </Text>
        {value ? (
          <Text numberOfLines={1} style={[styles.patientProfileRowValue, { color: textColor || rowRoles.bodyText || theme.colors.textSecondary }]}>
            {value}
          </Text>
        ) : null}
      </View>
      {badge ? (
        <View style={[styles.patientProfileRowBadge, { backgroundColor: rowRoles.badgeBackground || theme.colors.brandPrimaryMuted }]}>
          <Text style={[styles.patientProfileRowBadgeText, { color: rowRoles.badgeText || theme.colors.brandPrimary }]}>{badge}</Text>
        </View>
      ) : null}
      {!disabled ? <AppIcon name="chevronRight" state="muted" color={rowRoles.metaText} /> : null}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { width, height: viewportHeight } = useWindowDimensions();
  const { resolvedTheme } = useAuth();
  const isMobileViewport = width < 768;
  const roles = resolveThemeRoles(resolvedTheme, { isMobile: isMobileViewport });
  const {
    user,
    profile,
    patientProfile,
    hospitalProfile,
    defaultValues,
    profileCompletionMeta,
    isLoadingRoleProfile,
    isSavingProfile,
    isChangingPassword,
    isUploadingAvatar,
    getProfileCompletionMeta,
    hasUnsavedProfileChanges,
    saveSharedProfile,
    uploadAvatar,
    changePassword,
    logout,
  } = useProfileActions();
  const normalizedRole = String(profile?.role || '').trim().toLowerCase();
  const resolvedRole = normalizedRole === 'patient' ? 'patient' : 'donor';
  const { unreadCount } = useNotifications({ role: resolvedRole, userId: user?.id, databaseUserId: profile?.user_id });
  const headerPrimaryColor = resolvedTheme?.primaryColor || roles.primaryActionBackground;
  const primaryTextColor = resolvedTheme?.primaryTextColor || theme.colors.textPrimary;

  const [mode, setMode] = useState('view');
  const [feedback, setFeedback] = useState(null);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [activeProfilePicker, setActiveProfilePicker] = useState('');
  const [guardianConsent, setGuardianConsent] = useState(null);
  const [isGuardianConsentModalOpen, setIsGuardianConsentModalOpen] = useState(false);
  const [isSavingGuardianConsent, setIsSavingGuardianConsent] = useState(false);
  const [guardianConsentDocument, setGuardianConsentDocument] = useState(null);
  const [guardianConsentDocumentError, setGuardianConsentDocumentError] = useState('');
  const [isLoadingGuardianConsentDocument, setIsLoadingGuardianConsentDocument] = useState(false);
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

      const submissionsResult = await fetchHairSubmissionsByUserId(user.id, 100);
      await ensureCertificatesForScannedEventDonations(user.id, 100);
      const certificatesResult = await fetchDonationCertificatesByUserId(user.id, 100);

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
  const profileEditFieldHelper = [styles.profileEditFieldHelper, { color: primaryTextColor }];
  const profileEditFieldError = [styles.profileEditFieldError];
  const profileEditInputProps = {
    variant: 'default',
    placeholderTextColor: primaryTextColor,
    style: styles.profileEditFieldContainer,
    labelStyle: profileEditFieldLabel,
    shellStyle: profileEditFieldShell,
    inputStyle: profileEditFieldText,
    helperTextStyle: profileEditFieldHelper,
    errorTextStyle: profileEditFieldError,
    leftIconColor: roles.primaryActionBackground,
  };
  const profileEditSelectProps = {
    labelStyle: profileEditFieldLabel,
    fieldStyle: profileEditFieldShell,
    valueStyle: profileEditFieldText,
    placeholderStyle: profileEditFieldText,
    helperTextStyle: profileEditFieldHelper,
    errorTextStyle: profileEditFieldError,
    leftIconColor: roles.primaryActionBackground,
    rightIconColor: roles.headingText,
  };
  const profileEditDateProps = {
    containerStyle: styles.profileEditFieldContainer,
    labelStyle: profileEditFieldLabel,
    shellStyle: profileEditFieldShell,
    valueStyle: profileEditFieldText,
    placeholderStyle: profileEditFieldText,
    helperTextStyle: profileEditFieldHelper,
    errorTextStyle: profileEditFieldError,
    leftIconColor: roles.primaryActionBackground,
    rightIconColor: roles.headingText,
  };
  const watchedNewPassword = passwordForm.watch('newPassword');
  const patientHospitalName = hospitalProfile?.hospital_name || patientProfile?.hospital_name || '';
  const patientMedicalDocument = patientProfile?.medical_document || patientProfile?.medical_document_url || '';
  const watchedGender = useWatch({ control: profileForm.control, name: 'gender' });
  const watchedBirthdate = useWatch({ control: profileForm.control, name: 'birthdate' });
  const setupDonorAgeBadge = useMemo(() => (
    getDonorProfileBadge({ birthdate: watchedBirthdate, guardianConsent })
  ), [guardianConsent, watchedBirthdate]);
  const isMinorProfileDraft = setupDonorAgeBadge && setupDonorAgeBadge.category !== 'Adult';
  const isAdultDonorBadge = setupDonorAgeBadge?.category === 'Adult';
  const hasActiveGuardianConsent = Boolean(guardianConsent?.guardian_consent_id || guardianConsent?.Guardian_Consent_ID);
  const guardianConsentText = guardianConsentDocument?.content || guardianConsentDocument?.summary || GUARDIAN_CONSENT_TEXT;
  const passwordStrengthMessage = getPasswordStrengthMessage(watchedNewPassword);
  const passwordStrengthVariant = watchedNewPassword
    ? passwordStrengthMessage === 'Strong password'
      ? 'success'
      : 'info'
    : 'info';
  const isPopupVisible = mode !== 'view';
  const modalMaxHeight = Math.max(360, viewportHeight - theme.spacing.xl * 2);
  const liveProfileCompletionMeta = useMemo(() => (
    getProfileCompletionMeta(watchedProfileValues)
  ), [getProfileCompletionMeta, watchedProfileValues]);
  const activeProfileCompletionMeta = watchedProfileValues
    ? liveProfileCompletionMeta
    : profileCompletionMeta;
  const isProfileCompletionLoading = isLoadingRoleProfile && mode === 'edit';
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

  const openGuardianConsentModal = useCallback(async () => {
    setIsGuardianConsentModalOpen(true);
    if (guardianConsentDocument || isLoadingGuardianConsentDocument) return;

    setGuardianConsentDocumentError('');
    setIsLoadingGuardianConsentDocument(true);
    const result = await fetchActiveLegalDocument('Guardian Consent');
    setIsLoadingGuardianConsentDocument(false);

    if (result.error) {
      setGuardianConsentDocumentError(result.error.message || 'Guardian consent document could not be loaded.');
      return;
    }

    setGuardianConsentDocument(result.data);
  }, [guardianConsentDocument, isLoadingGuardianConsentDocument]);

  const submitGuardianConsent = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!profile?.user_id) {
      setFloatingFeedback('error', 'Profile Not Ready', 'Please save your donor account first, then complete guardian consent.');
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
  }, [guardianConsentForm, guardianConsentText, profile?.user_id, setFloatingFeedback, validateGuardianConsentForm]);

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

  const handleMorePress = useCallback((label) => {
    if (label === 'Help') {
      setFloatingFeedback('info', 'Help', 'Help includes Terms and About.');
      return;
    }

    setFloatingFeedback('info', label, `${label} settings will be available in the next update.`);
  }, [setFloatingFeedback]);

  const handleOpenMedicalDocument = useCallback(async () => {
    if (!patientMedicalDocument) {
      setFloatingFeedback('info', 'No Document', 'No medical document is linked yet.');
      return;
    }

    try {
      const canOpen = await Linking.canOpenURL(patientMedicalDocument);
      if (!canOpen) {
        setFloatingFeedback('error', 'Cannot Open File', 'The linked document cannot be opened on this device.');
        return;
      }
      await Linking.openURL(patientMedicalDocument);
    } catch (error) {
      setFloatingFeedback('error', 'Cannot Open File', error?.message || 'Unable to open the medical document.');
    }
  }, [patientMedicalDocument, setFloatingFeedback]);

  const handleLogoutPress = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await logout();
    if (result?.success && !result?.error) {
      router.replace('/auth/access');
      return;
    }
    if (result?.error) {
      setFloatingFeedback('error', 'Logout Failed', result.error || 'Unable to log out right now.');
    }
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

  const renderDonorProfileContent = () => (
    <View style={styles.profileMainShell}>
      <View style={styles.profileHeroPanel}>
        <Pressable
          onPress={() => handlePhotoPress()}
          disabled={isUploadingAvatar}
          style={({ pressed }) => [styles.profileHeroPhotoButton, { opacity: pressed ? 0.86 : 1 }]}
        >
          <View style={[styles.profileHeroPhoto, { borderColor: roles.pageBackground }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.profileHeroAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={[styles.profileHeroAvatarText, { color: roles.primaryActionBackground }]}>
                {(avatarInitials || 'DN').toUpperCase().slice(0, 2)}
              </Text>
            )}
          </View>
        </Pressable>

        <View style={styles.profileHeroCopyCentered}>
        <Text numberOfLines={2} style={[styles.profileHeroDisplayName, { color: primaryTextColor }]}>
          {fullName || 'Profile'}
        </Text>
        <View style={styles.profileHeroContactRow}>
          <View style={styles.profileHeroContactItem}>
            <AppIcon name="email" size="sm" color={roles.primaryActionBackground} />
            <Text numberOfLines={1} style={[styles.profileHeroContactText, { color: primaryTextColor }]}>
              {user?.email || 'No email linked'}
            </Text>
          </View>
          {profileLocation ? (
            <View style={styles.profileHeroContactItem}>
              <AppIcon name="location" size="sm" color={roles.primaryActionBackground} />
              <Text numberOfLines={1} style={[styles.profileHeroContactText, { color: primaryTextColor }]}>
                {profileLocation}
              </Text>
            </View>
          ) : null}
        </View>
        </View>

        <View style={styles.profileHeroMetricsRow}>
          {[
            {
              key: 'donations',
              label: 'Donations',
              value: donorStats.donations,
              valueColor: primaryTextColor,
              labelColor: primaryTextColor,
            },
            {
              key: 'achievements',
              label: 'Achievements',
              value: donorStats.achievements,
              valueColor: primaryTextColor,
              labelColor: primaryTextColor,
            },
          ].map((item) => (
            <View
              key={item.key}
              style={[
                styles.profileHeroMetricCard,
                { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder },
              ]}
            >
              <Text style={[styles.profileHeroMetricValue, { color: item.valueColor || primaryTextColor }]}>
                {item.value}
              </Text>
              <Text style={[styles.profileHeroMetricLabel, { color: item.labelColor || primaryTextColor }]}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.profileSection}>
        <SectionTitleRow
          title="Account"
          icon="profile"
          color={primaryTextColor}
          iconColor={roles.primaryActionBackground}
          accentColor={roles.primaryActionBackground}
          style={styles.profileSectionHeader}
        />
        <View style={[styles.profileSectionShell, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
          <ProfileMenuRow
            roles={roles}
            icon="editProfile"
            title="Edit Profile"
            textColor={primaryTextColor}
            onPress={() => setMode('edit')}
          />
          <ProfileMenuRow
            roles={roles}
            icon="changePassword"
            title="Change Password"
            textColor={primaryTextColor}
            onPress={() => setMode('password')}
          />
          <ProfileMenuRow
            roles={roles}
            icon="updates"
            title="History"
            badge={donorStats.donations}
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/donation-history')}
          />
          <ProfileMenuRow
            roles={roles}
            icon="sparkle"
            title="Achievements"
            badge={donorStats.achievements}
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/achievements')}
          />
        </View>
      </View>

      <View style={styles.profileSection}>
        <SectionTitleRow
          title="More"
          icon="quickActions"
          color={primaryTextColor}
          iconColor={roles.primaryActionBackground}
          accentColor={roles.primaryActionBackground}
          style={styles.profileSectionHeader}
        />
        <View style={[styles.profileSectionShell, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
          <ProfileMoreRow
            roles={roles}
            icon="bell-outline"
            title="Notifications"
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/notifications')}
          />
          <ProfileMoreRow
            roles={roles}
            icon="message-alert-outline"
            title="Feedback"
            textColor={primaryTextColor}
            onPress={() => router.navigate('/donor/feedback')}
          />
          <ProfileMoreRow
            roles={roles}
            icon="help-circle-outline"
            title="Help"
            textColor={primaryTextColor}
            onPress={() => handleMorePress('Help')}
          />
        </View>
      </View>

      <View style={styles.profileLogoutSection}>
        <AppButton
          title="Logout"
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

  const renderPatientProfileContent = () => (
    <View style={styles.patientProfileShell}>
      <View style={styles.patientProfileHero}>
        <Pressable
          accessibilityLabel="Change profile photo"
          onPress={() => handlePhotoPress()}
          disabled={isUploadingAvatar}
          style={({ pressed }) => [styles.patientProfileAvatarButton, { opacity: pressed ? 0.86 : 1 }]}
        >
          <View
            style={[
              styles.patientProfileAvatar,
              {
                backgroundColor: roles.supportCardBackground,
                borderColor: roles.supportCardBorder,
              },
            ]}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.profileHeroAvatarImage} resizeMode="cover" />
            ) : (
              <Text style={[styles.patientProfileAvatarText, { color: primaryTextColor }]}>
                {(avatarInitials || 'PT').toUpperCase().slice(0, 2)}
              </Text>
            )}
          </View>
          <View
            style={[
              styles.patientProfileVerifiedBadge,
              {
                backgroundColor: roles.primaryActionBackground,
                borderColor: roles.pageBackground,
              },
            ]}
          >
            <AppIcon name="check-decagram" size="sm" color={roles.primaryActionText} />
          </View>
        </Pressable>

        <Text numberOfLines={2} style={[styles.patientProfileName, { color: primaryTextColor }]}>
          {fullName || 'Patient account'}
        </Text>
        <View style={[styles.patientProfileStatusPill, { backgroundColor: roles.badgeStrongBackground }]}>
          <AppIcon name="checkmarkCircle" size="sm" color={roles.badgeStrongText} />
          <Text style={[styles.patientProfileStatusText, { color: primaryTextColor }]}>Verified Patient</Text>
        </View>
        {patientProfile?.patient_code ? (
          <Text numberOfLines={1} style={[styles.patientProfileCode, { color: primaryTextColor }]}>
            {patientProfile.patient_code}
          </Text>
        ) : null}
      </View>

      <View style={styles.patientProfileGrid}>
        <View style={styles.profileSection}>
          <SectionTitleRow
            title="Medical Information"
            icon="shield"
            color={primaryTextColor}
            iconColor={roles.primaryActionBackground}
            accentColor={roles.primaryActionBackground}
            style={styles.profileSectionHeader}
          />
          <View style={[styles.profileSectionShell, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <PatientProfileRow
              icon="hospital-building"
              title="Clinic / Hospital"
              value={patientHospitalName || 'Not linked'}
              roles={roles}
              textColor={primaryTextColor}
            />
            <PatientProfileRow
              icon="clipboard-pulse-outline"
              title="Condition"
              value={patientProfile?.medical_condition || 'Not provided'}
              roles={roles}
              textColor={primaryTextColor}
            />
            <PatientProfileRow
              icon="account-heart-outline"
              title="Guardian"
              value={patientProfile?.guardian || 'Not provided'}
              roles={roles}
              textColor={primaryTextColor}
            />
            <PatientProfileRow
              icon="folder-account-outline"
              title="Medical Document"
              value={patientMedicalDocument ? 'View file' : 'No file'}
              onPress={patientMedicalDocument ? handleOpenMedicalDocument : undefined}
              roles={roles}
              textColor={primaryTextColor}
            />
          </View>
        </View>

        <View style={styles.profileSection}>
          <SectionTitleRow
            title="Account Settings"
            icon="settings"
            color={primaryTextColor}
            iconColor={roles.primaryActionBackground}
            accentColor={roles.primaryActionBackground}
            style={styles.profileSectionHeader}
          />
          <View style={[styles.profileSectionShell, { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder }]}>
            <PatientProfileRow
              icon="profile"
              title="Personal Information"
              onPress={() => setMode('edit')}
              roles={roles}
              textColor={primaryTextColor}
            />
            <PatientProfileRow
              icon="feedback"
              title="Feedback"
              onPress={() => router.navigate('/patient/feedback')}
              roles={roles}
              textColor={primaryTextColor}
            />
          </View>
        </View>
      </View>

      <View style={styles.profileLogoutSection}>
        <AppButton
          title="Log Out"
          variant="outline"
          fullWidth={false}
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
        header={(
          <View style={[styles.profileHeaderSurface, { backgroundColor: headerPrimaryColor }]}>
            <DonorTopBar
              title={resolvedTheme?.brandName || 'Donivra'}
              unreadCount={unreadCount}
              showTutorialAction={role === 'donor' || role === 'patient'}
              onTutorialPress={() => setIsTutorialOpen(true)}
              showProfileAction={true}
              showLogoutAction={false}
              onNotificationsPress={() => router.navigate(role === 'donor' ? '/donor/notifications' : '/patient/notifications')}
              onProfilePress={() => router.navigate('/profile')}
            />
          </View>
        )}
      >
        {role === 'donor' ? (
          <DonorTutorialModal
            visible={isTutorialOpen}
            tabKey="profile"
            onClose={() => setIsTutorialOpen(false)}
          />
        ) : (
          <PatientTutorialModal
            visible={isTutorialOpen}
            tabKey="profile"
            onClose={() => setIsTutorialOpen(false)}
          />
        )}
        {role === 'donor' ? renderDonorProfileContent() : renderPatientProfileContent()}

        <Modal transparent visible={isPopupVisible} animationType="fade" onRequestClose={handleModalClose}>
          <KeyboardAvoidingView
            style={styles.modalKeyboardWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={handleModalClose} />

              <AppCard
                variant="elevated"
                radius="md"
                padding="lg"
                style={[styles.modalCard, { maxHeight: modalMaxHeight }]}
                contentStyle={styles.modalCardContent}
              >
                {mode === 'edit' ? (
                  <>
                    <View style={styles.modalHeaderBlock}>
                      <View style={styles.completionCard}>
                        <View style={styles.completionHeader}>
                          <Text style={[styles.completionTitle, { color: primaryTextColor }]}>Profile Completion</Text>
                          <Text style={[styles.completionPercent, { color: primaryTextColor }]}>{activeProfileCompletionMeta.percentage}%</Text>
                        </View>
                        <View style={styles.completionBarTrack}>
                          <View
                            style={[
                              styles.completionBarFill,
                              { width: `${activeProfileCompletionMeta.percentage}%` },
                            ]}
                          />
                        </View>
                        {isProfileCompletionLoading ? (
                          <View style={styles.completionLoadingRow}>
                            <ActivityIndicator size="small" color={roles.primaryActionBackground} />
                            <Text style={[styles.completionLoadingText, { color: primaryTextColor }]}>
                              Loading profile completion...
                            </Text>
                          </View>
                        ) : activeProfileCompletionMeta.isComplete ? (
                          <View style={styles.completionCompleteRow}>
                            <AppIcon name="check-decagram" size="sm" color={roles.primaryActionBackground} />
                            <Text style={[styles.completionCompleteText, { color: primaryTextColor }]}>
                              All required fields are complete.
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <ScrollView
                      style={[styles.modalBodyScroll, { maxHeight: modalMaxHeight - 210 }]}
                      contentContainerStyle={styles.modalBodyContent}
                      showsVerticalScrollIndicator={true}
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
                          <View style={styles.profileEditPhotoAvatarWrap}>
                            <View style={[styles.profileEditPhotoAvatar, { backgroundColor: theme.colors.surfaceCard, borderColor: roles.defaultCardBorder }]}>
                              {avatarUri ? (
                                <Image source={{ uri: avatarUri }} style={styles.profileEditPhotoAvatarImage} resizeMode="cover" />
                              ) : (
                                <Text style={[styles.profileEditPhotoAvatarText, { color: roles.primaryActionBackground }]}>
                                  {(avatarInitials || 'DN').toUpperCase().slice(0, 2)}
                                </Text>
                              )}
                            </View>
                            <View style={[styles.profileEditPhotoBadge, { backgroundColor: '#F7D86A', borderColor: theme.colors.surfaceCard }]}>
                              <AppIcon name="pencil-outline" size="sm" color={roles.primaryActionBackground} />
                            </View>
                          </View>
                        </Pressable>
                      </View>

                      {profileFieldConfig.map((field) => {
                        if (field.formKey === 'street') {
                          return (
                            <SignupAddressSection
                              key="profile-address-section"
                              control={profileForm.control}
                              errors={profileErrors}
                              setValue={profileForm.setValue}
                              showHeader={false}
                              showHelperText={false}
                              showTopBorder={false}
                              inputProps={profileEditInputProps}
                              selectProps={profileEditSelectProps}
                              countryInputProps={{ helperText: '' }}
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
                                      required={REQUIRED_PROFILE_FIELDS.has(field.formKey)}
                                      value={controllerField.value}
                                      placeholder={field.placeholder}
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
                                      <View
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
                                              Complete guardian consent now so donation features are ready after account setup.
                                            </Text>
                                          ) : null}
                                        </View>
                                      </View>
                                    ) : null}
                                  </View>
                                );
                              }

                              if (field.formKey === 'suffix') {
                                return (
                                  <>
                                    <AddressSelectField
                                      label={field.label}
                                      required={REQUIRED_PROFILE_FIELDS.has(field.formKey)}
                                      value={controllerField.value}
                                      placeholder={field.placeholder}
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
                                      onClose={() => setActiveProfilePicker('')}
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
                                      required={REQUIRED_PROFILE_FIELDS.has(field.formKey)}
                                      value={watchedGender}
                                      placeholder={field.placeholder}
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
                                  required={REQUIRED_PROFILE_FIELDS.has(field.formKey)}
                                  placeholder={field.placeholder}
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

                      {isMinorProfileDraft ? (
                        <Pressable
                          onPress={async () => {
                            await Haptics.selectionAsync();
                            if (hasActiveGuardianConsent) return;
                            openGuardianConsentModal();
                          }}
                          style={({ pressed }) => [
                            styles.setupConsentPrompt,
                            hasActiveGuardianConsent ? styles.setupConsentPromptDone : null,
                            { opacity: pressed ? 0.84 : 1 },
                          ]}
                        >
                          <View style={styles.setupConsentPromptIcon}>
                            <AppIcon
                              name={hasActiveGuardianConsent ? 'success' : 'shield'}
                              size="sm"
                              color={hasActiveGuardianConsent ? '#1E7A42' : theme.colors.brandPrimary}
                            />
                          </View>
                          <View style={styles.setupConsentPromptCopy}>
                            <Text style={styles.setupConsentPromptTitle}>
                              {hasActiveGuardianConsent ? 'Guardian consent completed' : 'Guardian consent needed'}
                            </Text>
                            <Text style={styles.setupConsentPromptText}>
                              {hasActiveGuardianConsent
                                ? 'This account can continue to donation steps after the profile is saved.'
                                : 'Ask a parent or legal guardian to review and complete this before saving.'}
                            </Text>
                          </View>
                          {!hasActiveGuardianConsent ? (
                            <AppIcon name="chevronRight" size="sm" color={theme.colors.brandPrimary} />
                          ) : null}
                        </Pressable>
                      ) : null}

                      <View style={styles.profileModalActionRow}>
                        <ProfileGradientActionButton
                          title="Close"
                          onPress={requestEditModalClose}
                          textColor={primaryTextColor}
                          fillColors={PROFILE_ACTION_MUTED_FILL_GRAD}
                          borderColors={PROFILE_ACTION_BORDER_GRAD}
                          variant="outline"
                          showShine={false}
                          style={styles.profileModalActionShell}
                          buttonStyle={styles.profileModalActionButton}
                        />
                        <ProfileGradientActionButton
                          title="Save Changes"
                          loading={isSavingProfile}
                          success={saveSuccess}
                          onPress={profileForm.handleSubmit(
                            submitProfile,
                            () => setFloatingFeedback('error', 'Check Your Details', 'Please correct the highlighted profile fields before saving.')
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

                {mode === 'password' ? (
                  <>
                    <View style={styles.modalHeaderBlock}>
                      <DashboardSectionHeader
                        title="Change Password"
                        description=""
                        style={styles.sectionHeaderCompact}
                        showAccent={false}
                      />
                    </View>

                    <ScrollView
                      style={[styles.modalBodyScroll, { maxHeight: modalMaxHeight - 130 }]}
                      contentContainerStyle={styles.modalBodyContent}
                      showsVerticalScrollIndicator={true}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode="interactive"
                      nestedScrollEnabled={true}
                    >
                      <View style={styles.passwordMeterCard}>
                        <View style={styles.passwordMeterHeader}>
                          <AppIcon
                            name={passwordStrengthVariant === 'success' ? 'success' : 'shield'}
                            state={passwordStrengthVariant === 'success' ? 'success' : 'muted'}
                            size="sm"
                          />
                          <Text style={styles.passwordMeterTitle}>Password strength</Text>
                        </View>
                        <Text style={styles.passwordMeterMessage}>
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
          visible={isGuardianConsentModalOpen}
          animationType="fade"
          onRequestClose={closeGuardianConsentModal}
        >
          <KeyboardAvoidingView
            style={styles.modalKeyboardWrap}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalOverlay}>
              <Pressable style={styles.modalBackdrop} onPress={closeGuardianConsentModal} />

              <AppCard
                variant="elevated"
                radius="md"
                padding="lg"
                style={[styles.guardianConsentModalCard, { maxHeight: modalMaxHeight }]}
                contentStyle={styles.modalCardContent}
              >
                <View style={styles.guardianConsentHeader}>
                  <View style={styles.guardianConsentHeaderIcon}>
                    <AppIcon name="shield" color={theme.colors.brandPrimary} />
                  </View>
                  <View style={styles.guardianConsentHeaderCopy}>
                    <Text style={styles.guardianConsentTitle}>Guardian Consent</Text>
                    <Text style={styles.guardianConsentSubtitle}>
                      Required because the entered birthdate is below 18 years old.
                    </Text>
                  </View>
                  <Pressable
                    onPress={closeGuardianConsentModal}
                    style={({ pressed }) => [styles.guardianConsentCloseButton, { opacity: pressed ? 0.72 : 1 }]}
                  >
                    <AppIcon name="close" size="sm" color={theme.colors.textSecondary} />
                  </Pressable>
                </View>

                <ScrollView
                  style={[styles.modalBodyScroll, { maxHeight: modalMaxHeight - 170 }]}
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
                    <Text style={styles.guardianConsentNoticeTitle}>
                      {guardianConsentDocument?.title || 'Guardian Consent Agreement'}
                    </Text>
                    <Text style={styles.guardianConsentNoticeText}>
                      {isLoadingGuardianConsentDocument
                        ? 'Loading guardian consent document...'
                        : guardianConsentDocumentError || guardianConsentText}
                    </Text>
                  </View>

                  <View style={styles.guardianAgreementBlock}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: Boolean(guardianConsentForm.guardianAgreementAccepted), disabled: isSavingGuardianConsent }}
                      disabled={isSavingGuardianConsent}
                      onPress={() => updateGuardianConsentField('guardianAgreementAccepted', !guardianConsentForm.guardianAgreementAccepted)}
                      style={({ pressed }) => [
                        styles.guardianAgreementRow,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.guardianAgreementCheckbox,
                          guardianConsentForm.guardianAgreementAccepted ? styles.guardianAgreementCheckboxActive : null,
                        ]}
                      >
                        {guardianConsentForm.guardianAgreementAccepted ? (
                          <AppIcon name="checkmark" size="xs" state="inverse" />
                        ) : null}
                      </View>
                      <Text style={styles.guardianAgreementText}>
                        As a guardian, I agree to the{' '}
                        <Text style={styles.guardianAgreementLink}>Guardian Consent</Text>
                        {' '}terms and confirm that the information I provided is true.
                      </Text>
                    </Pressable>
                    {guardianConsentErrors.guardianAgreementAccepted ? (
                      <Text style={styles.guardianConsentError}>{guardianConsentErrors.guardianAgreementAccepted}</Text>
                    ) : null}
                  </View>

                  <View style={styles.formActions}>
                    <AppButton
                      title="Save Guardian Consent"
                      size="lg"
                      loading={isSavingGuardianConsent}
                      onPress={submitGuardianConsent}
                      leading={<AppIcon name="save" state="inverse" />}
                    />
                    <AppTextLink title="Cancel" variant="muted" onPress={closeGuardianConsentModal} />
                  </View>
                </ScrollView>
              </AppCard>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </DashboardLayout>

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
    gap: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
  profileHeaderSurface: {
    marginHorizontal: -theme.layout.screenPaddingX,
    paddingHorizontal: 0,
    paddingVertical: theme.spacing.xs,
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
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  profileHeroPhotoButton: {
    position: 'relative',
    marginBottom: theme.spacing.xs,
  },
  profileHeroPhoto: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 3,
    borderColor: theme.colors.surfaceCard,
  },
  profileHeroCopyCentered: {
    alignItems: 'center',
    gap: theme.spacing.xs,
    width: '100%',
  },
  profileHeroDisplayName: {
    maxWidth: '94%',
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  profileHeroContactRow: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'nowrap',
    gap: 6,
  },
  profileHeroContactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 0,
  },
  profileHeroContactText: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: 'center',
  },
  profileHeroMetricsRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  profileHeroMetricCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 66,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 3,
    paddingHorizontal: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    ...theme.shadows.soft,
  },
  profileHeroMetricValue: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.tight,
  },
  profileHeroMetricLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.snug,
    textAlign: 'center',
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
    gap: theme.spacing.xs,
  },
  profileSectionHeader: {
    paddingHorizontal: theme.spacing.xs,
  },
  profileSectionShell: {
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
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
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: 'transparent',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderSubtle,
  },
  profileMenuIconWrap: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
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
  profileMoreRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderSubtle,
    backgroundColor: 'transparent',
    paddingVertical: theme.spacing.sm,
  },
  profileMoreIconWrap: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
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
  profileLogoutSection: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.lg,
  },
  profileLogoutButton: {
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceCard,
  },
  profileVersionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.4,
    color: theme.colors.textMuted,
  },
  patientProfileShell: {
    gap: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
  },
  patientProfileHero: {
    alignItems: 'center',
    gap: 2,
    paddingTop: theme.spacing.xs,
  },
  patientProfileAvatarButton: {
    position: 'relative',
    marginBottom: theme.spacing.sm,
  },
  patientProfileAvatar: {
    width: 94,
    height: 94,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    ...theme.shadows.soft,
  },
  patientProfileAvatarText: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  patientProfileVerifiedBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
  patientProfileName: {
    maxWidth: '92%',
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  patientProfileStatusPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    marginTop: theme.spacing.xs,
  },
  patientProfileStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
  },
  patientProfileCode: {
    maxWidth: '90%',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  patientProfileGrid: {
    gap: theme.spacing.lg,
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
    minWidth: 148,
    borderRadius: theme.radius.full,
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
    marginTop: -theme.spacing.xs,
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
    marginTop: -theme.spacing.xxs,
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
  setupConsentPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    minHeight: 62,
    borderRadius: 20,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginTop: -theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceCard,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  setupConsentPromptDone: {
    backgroundColor: '#EAF8EF',
    borderColor: '#BFE8CD',
  },
  setupConsentPromptIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  setupConsentPromptCopy: {
    flex: 1,
    gap: 2,
  },
  setupConsentPromptTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  setupConsentPromptText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
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
  sectionHeaderCompact: {
    marginBottom: theme.spacing.md,
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
  completionCard: {
    marginBottom: theme.spacing.xs,
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  completionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  completionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  completionPercent: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  completionBarTrack: {
    height: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.borderSubtle,
    overflow: 'hidden',
  },
  completionBarFill: {
    height: '100%',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  completionLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  completionLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  completionCompleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  completionCompleteText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  profileEditPhotoSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
    paddingVertical: 0,
  },
  profileEditPhotoPressable: {
    alignSelf: 'center',
  },
  profileEditPhotoAvatarWrap: {
    width: 120,
    height: 120,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileEditPhotoAvatar: {
    width: 110,
    height: 110,
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
    shadowOpacity: 0,
    elevation: 0,
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
  modalCardContent: {
    minHeight: 0,
  },
  modalHeaderBlock: {
    flexShrink: 0,
  },
  modalBodyScroll: {
    minHeight: 0,
  },
  modalBodyContent: {
    paddingBottom: theme.spacing.giant,
  },
  guardianConsentModalCard: {
    width: '100%',
    alignSelf: 'center',
    maxWidth: theme.layout.authCardMaxWidth,
    borderRadius: 18,
    minHeight: 0,
    overflow: 'hidden',
    flexShrink: 1,
  },
  guardianConsentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  guardianConsentHeaderIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  guardianConsentHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  guardianConsentTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  guardianConsentSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  guardianConsentCloseButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  guardianConsentBody: {
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  guardianConsentNotice: {
    marginBottom: theme.spacing.md,
    borderRadius: 18,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    gap: theme.spacing.xs,
  },
  guardianConsentNoticeTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  guardianConsentNoticeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  guardianAgreementBlock: {
    gap: 4,
    marginBottom: theme.spacing.sm,
  },
  guardianAgreementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  guardianAgreementCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceCard,
    marginTop: 1,
  },
  guardianAgreementCheckboxActive: {
    backgroundColor: theme.colors.brandPrimary,
    borderColor: theme.colors.brandPrimary,
  },
  guardianAgreementText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.normal,
    color: theme.colors.textPrimary,
  },
  guardianAgreementLink: {
    fontFamily: theme.typography.fontFamily,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
  },
  guardianConsentError: {
    marginLeft: 28,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textError,
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
