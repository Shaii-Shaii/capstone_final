import * as ProfileAPI from '../api/profile.api';
import { logAppError, logAppEvent, writeAuditLog } from '../../../utils/appErrors';
import { profileCompletionFieldLabels, profileCompletionSections } from '../../../constants/profile';

const SYSTEM_ROLE_KEYS = new Set(['id', 'created_at', 'updated_at', 'user_id', 'profile_id']);

const normalizeOptionalString = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' ? value.trim() : value;
};

const normalizeOptionalDate = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : null;
  }
  return value;
};

const sanitizeSharedProfileUpdates = (updates = {}) => ({
  first_name: normalizeOptionalString(updates.first_name),
  middle_name: normalizeOptionalString(updates.middle_name),
  last_name: normalizeOptionalString(updates.last_name),
  suffix: normalizeOptionalString(updates.suffix),
  phone: normalizeOptionalString(updates.phone),
  birthdate: normalizeOptionalDate(updates.birthdate),
  gender: normalizeOptionalString(updates.gender),
  street: normalizeOptionalString(updates.street),
  barangay: normalizeOptionalString(updates.barangay),
  region: normalizeOptionalString(updates.region),
  city: normalizeOptionalString(updates.city),
  province: normalizeOptionalString(updates.province),
  country: normalizeOptionalString(updates.country),
  joined_date: normalizeOptionalDate(updates.joined_date),
});

const getTodayDate = () => new Date().toISOString().slice(0, 10);
const dataUrlPattern = /^data:([^;]+);base64,(.+)$/i;
const getPatientCodeLogMeta = (patientCode) => {
  const normalizedCode = String(patientCode || '').trim().toUpperCase();
  return {
    patientCodeLength: normalizedCode.length,
    patientCodeSuffix: normalizedCode ? normalizedCode.slice(-2) : '',
  };
};

export const needsPostLoginOnboarding = ({
  profile,
  patientProfile,
  staffProfile,
  onboardingCompleted = null,
}) => {
  const normalizedRole = String(profile?.role || '').trim().toLowerCase();

  if (!normalizedRole) {
    return true;
  }

  if (normalizedRole === 'tentative') {
    return onboardingCompleted !== true;
  }

  if (normalizedRole === 'patient') {
    return !patientProfile?.patient_id;
  }

  if (normalizedRole === 'donor') {
    return false;
  }

  if (onboardingCompleted === false) {
    return true;
  }

  return !profile?.user_details_id && !patientProfile?.patient_id && !staffProfile?.link_id;
};

const normalizeComparableFormValues = (values = {}) => ({
  firstName: String(values.firstName || '').trim(),
  middleName: String(values.middleName || '').trim(),
  lastName: String(values.lastName || '').trim(),
  suffix: String(values.suffix || '').trim(),
  birthdate: String(values.birthdate || '').trim(),
  gender: String(values.gender || '').trim(),
  phone: String(values.phone || '').trim(),
  street: String(values.street || '').trim(),
  barangay: String(values.barangay || '').trim(),
  region: String(values.region || '').trim(),
  city: String(values.city || '').trim(),
  province: String(values.province || '').trim(),
  country: String(values.country || '').trim(),
});

const normalizeProfileCompletionSource = (source = {}) => ({
  photo_path: source.photo_path || source.avatar_url || '',
  first_name: source.first_name || '',
  last_name: source.last_name || '',
  birthdate: source.birthdate || '',
  gender: source.gender || '',
  contact_number: source.contact_number || source.phone || '',
  street: source.street || '',
  barangay: source.barangay || '',
  city: source.city || '',
  province: source.province || '',
  region: source.region || '',
  country: source.country || '',
});

const isFilledField = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
};

export const buildProfileCompletionMeta = (source = {}) => {
  const normalizedSource = normalizeProfileCompletionSource(source);
  const sections = profileCompletionSections.map((section) => {
    const completedFieldCount = section.fields.filter((fieldKey) => isFilledField(normalizedSource[fieldKey])).length;
    const missingFields = section.fields.filter((fieldKey) => !isFilledField(normalizedSource[fieldKey]));

    return {
      ...section,
      completedFieldCount,
      totalFieldCount: section.fields.length,
      isComplete: missingFields.length === 0,
      missingFields,
    };
  });

  const totalFieldCount = sections.reduce((sum, section) => sum + section.totalFieldCount, 0);
  const completedFieldCount = sections.reduce((sum, section) => sum + section.completedFieldCount, 0);
  const percentage = totalFieldCount > 0 ? Math.round((completedFieldCount / totalFieldCount) * 100) : 0;
  const currentStep = Math.max(
    0,
    sections.findIndex((section) => !section.isComplete)
  );
  const hasIncompleteSection = sections.some((section) => !section.isComplete);
  const missingFieldLabels = sections
    .flatMap((section) => section.missingFields)
    .map((fieldKey) => profileCompletionFieldLabels[fieldKey] || fieldKey);

  return {
    percentage,
    completedFieldCount,
    totalFieldCount,
    sections,
    steps: sections.map((section) => ({
      key: section.key,
      label: section.label,
      shortLabel: section.shortLabel,
    })),
    currentStep: hasIncompleteSection ? currentStep : Math.max(sections.length - 1, 0),
    missingFieldLabels,
    isComplete: missingFieldLabels.length === 0,
  };
};

export const needsPersonalDetailsCompletion = (profile) => !buildProfileCompletionMeta(profile).isComplete;

export const hasProfileFormChanges = (initialValues, currentValues) => (
  JSON.stringify(normalizeComparableFormValues(initialValues))
  !== JSON.stringify(normalizeComparableFormValues(currentValues))
);

const fetchRoleProfile = async (role, userId) => {
  if (role === 'patient') {
    return await ProfileAPI.fetchPatientDetailsByUserId(userId);
  }

  return { data: null, error: null };
};

const persistSchemaSafeMediaValue = async ({ authUserId, mediaValue, documentType }) => {
  if (!mediaValue) return '';

  if (typeof mediaValue === 'object' && mediaValue !== null) {
    if (mediaValue.publicUrl || mediaValue.path) {
      return mediaValue.publicUrl || mediaValue.path || '';
    }

    if (mediaValue.fileBody) {
      const uploadResult = await ProfileAPI.uploadPatientOnboardingMedia({
        authUserId,
        fileBody: mediaValue.fileBody,
        contentType: mediaValue.contentType,
        fileName: mediaValue.fileName,
        documentType,
      });

      if (uploadResult.error || !uploadResult.data?.publicUrl) {
        throw new Error(uploadResult.error?.message || 'File upload failed.');
      }

      return uploadResult.data.publicUrl;
    }

    return '';
  }

  if (typeof mediaValue === 'string' && dataUrlPattern.test(mediaValue)) {
    const [, mimeType] = mediaValue.match(dataUrlPattern) || [];
    const fileResponse = await fetch(mediaValue);
    if (!fileResponse.ok) {
      throw new Error('Selected file could not be read.');
    }

    const uploadResult = await ProfileAPI.uploadPatientOnboardingMedia({
      authUserId,
      fileBody: await fileResponse.arrayBuffer(),
      contentType: mimeType || 'image/jpeg',
      documentType,
    });

    if (uploadResult.error || !uploadResult.data?.publicUrl) {
      throw new Error(uploadResult.error?.message || 'File upload failed.');
    }

    return uploadResult.data.publicUrl;
  }

  return typeof mediaValue === 'string' ? mediaValue : '';
};

const updateRoleProfile = async (role, userId, updates) => {
  if (role === 'patient') {
    return await ProfileAPI.updatePatientDetails(userId, updates);
  }

  return { data: null, error: null };
};

export const getPatientLinkPreview = async (patientCode, options = {}) => {
  try {
    const currentAuthUserId = String(options?.currentAuthUserId || '').trim();
    logAppEvent('patient.code_validation', 'Patient code validation started.', getPatientCodeLogMeta(patientCode));

    const { data, error } = await ProfileAPI.fetchPatientDetailsByCode(patientCode);
    if (error) throw new Error(error.message);
    if (!data?.patient_id) {
      throw new Error('We could not find a patient record for that code.');
    }
    if (data.linked_auth_user_id && data.linked_auth_user_id !== currentAuthUserId) {
      throw new Error('This patient code is already linked to another account.');
    }

    logAppEvent('patient.preview_fetch', 'Patient preview fetched successfully.', {
      ...getPatientCodeLogMeta(patientCode),
      patientId: data.patient_id,
      hospitalId: data.hospital_id || null,
      hasHospitalName: Boolean(data.hospital_name),
      hasLinkedAuthUser: Boolean(data.linked_auth_user_id),
    });

    return { patient: data, error: null };
  } catch (error) {
    logAppError('patient.code_validation', error, getPatientCodeLogMeta(patientCode));
    return { patient: null, error: error.message };
  }
};

export const linkPatientRecordByCode = async ({ userId, patientCode, patientPicture }) => {
  try {
    if (!userId) throw new Error('User ID is required');
    if (!patientCode) throw new Error('Patient code is required');

    logAppEvent('patient.link_code', 'Patient record link started.', {
      authUserId: userId,
      ...getPatientCodeLogMeta(patientCode),
      hasPatientPicture: Boolean(patientPicture),
    });

    const { data, error } = await ProfileAPI.linkPatientDetailsToUserByCode({
      userIdentifier: userId,
      patientCode,
      patientPicture,
    });

    if (error) throw new Error(error.message);

    await writeAuditLog({
      authUserId: userId,
      databaseUserId: data?.user_id || null,
      action: 'patient.link_code',
      description: `Linked patient code ${patientCode}.`,
      resource: 'patients',
      status: 'success',
    });

    logAppEvent('patient.link_code', 'Patient record linked successfully.', {
      authUserId: userId,
      databaseUserId: data?.user_id || null,
      patientId: data?.patient_id || null,
      hospitalId: data?.hospital_id || null,
    });

    return { patient: data, error: null };
  } catch (error) {
    logAppError('patient.link_code', error, {
      authUserId: userId,
      ...getPatientCodeLogMeta(patientCode),
    });

    await writeAuditLog({
      authUserId: userId,
      action: 'patient.link_code',
      description: error.message || 'Unable to link patient code.',
      resource: 'patients',
      status: 'failed',
    });
    return { patient: null, error: error.message };
  }
};

export const completePostLoginOnboarding = async ({
  userId,
  email,
  mode,
  patientCode,
  manualPatientDetails,
}) => {
  try {
    if (!userId) throw new Error('User ID is required.');
    if (!mode) throw new Error('Onboarding mode is required.');

    logAppEvent('onboarding.complete', 'Post-login onboarding started.', {
      authUserId: userId,
      mode,
      hasPatientCode: Boolean(patientCode),
      hasManualPatientDetails: Boolean(manualPatientDetails),
    });

    const targetRole = mode === 'patient-linked' || mode === 'patient-manual' ? 'patient' : 'donor';
    const shouldUpdateRoleImmediately = targetRole === 'patient' || targetRole === 'donor';
    const systemUserResult = await ProfileAPI.ensureSystemUserRecord({
      authUserId: userId,
      email,
      role: 'tentative',
    });

    if (systemUserResult.error || !systemUserResult.data?.user_id) {
      throw new Error(systemUserResult.error?.message || 'The app user record could not be loaded.');
    }

    const userDetailsResult = await ProfileAPI.ensureUserDetailsRecord({
      systemUserId: systemUserResult.data.user_id,
      details: {
        joined_date: getTodayDate(),
      },
    });

    if (userDetailsResult.error) {
      throw new Error(userDetailsResult.error.message || 'The user details record could not be created.');
    }

    if (mode === 'patient-linked') {
      if (!patientCode) {
        throw new Error('Patient code is required.');
      }

      const patientLinkResult = await linkPatientRecordByCode({
        userId,
        patientCode,
      });

      if (patientLinkResult.error) {
        throw new Error(patientLinkResult.error);
      }
    }

    if (mode === 'patient-manual') {
      logAppEvent('patient.manual_submission', 'Manual patient detail submission started.', {
        authUserId: userId,
        hasFirstName: Boolean(manualPatientDetails?.first_name),
        hasLastName: Boolean(manualPatientDetails?.last_name),
        hasBirthdate: Boolean(manualPatientDetails?.birthdate),
        hasGender: Boolean(manualPatientDetails?.gender),
        hasContactNumber: Boolean(manualPatientDetails?.contact_number),
        hasStreet: Boolean(manualPatientDetails?.street),
        hasBarangay: Boolean(manualPatientDetails?.barangay),
        hasCity: Boolean(manualPatientDetails?.city),
        hasProvince: Boolean(manualPatientDetails?.province),
        hasRegion: Boolean(manualPatientDetails?.region),
        hasCountry: Boolean(manualPatientDetails?.country),
        hasLatitude: Boolean(manualPatientDetails?.latitude),
        hasLongitude: Boolean(manualPatientDetails?.longitude),
        hasMedicalCondition: Boolean(manualPatientDetails?.medical_condition),
        hasDiagnosisDate: Boolean(manualPatientDetails?.date_of_diagnosis),
        hasGuardian: Boolean(manualPatientDetails?.guardian),
        hasGuardianRelationship: Boolean(manualPatientDetails?.guardian_relationship),
        hasGuardianContactNumber: Boolean(manualPatientDetails?.guardian_contact_number),
        hasPatientPicture: Boolean(manualPatientDetails?.patient_picture),
        hasMedicalDocument: Boolean(manualPatientDetails?.medical_document),
      });

      const userDetailsSaveResult = await ProfileAPI.updateProfile(userId, {
        first_name: manualPatientDetails?.first_name || '',
        middle_name: manualPatientDetails?.middle_name || '',
        last_name: manualPatientDetails?.last_name || '',
        suffix: manualPatientDetails?.suffix || '',
        birthdate: manualPatientDetails?.birthdate || null,
        gender: manualPatientDetails?.gender || '',
        contact_number: manualPatientDetails?.contact_number || '',
        street: manualPatientDetails?.street || '',
        barangay: manualPatientDetails?.barangay || '',
        region: manualPatientDetails?.region || '',
        city: manualPatientDetails?.city || '',
        province: manualPatientDetails?.province || '',
        country: manualPatientDetails?.country || '',
        latitude: manualPatientDetails?.latitude || '',
        longitude: manualPatientDetails?.longitude || '',
      });

      if (userDetailsSaveResult.error) {
        throw new Error(userDetailsSaveResult.error.message || 'Personal details could not be saved.');
      }

      const patientPictureUrl = await persistSchemaSafeMediaValue({
        authUserId: userId,
        mediaValue: manualPatientDetails?.patient_picture,
        documentType: 'patient-picture',
      });
      const medicalDocumentUrl = await persistSchemaSafeMediaValue({
        authUserId: userId,
        mediaValue: manualPatientDetails?.medical_document,
        documentType: 'patient-document',
      });
      const medicalDocumentMeta = manualPatientDetails?.medical_document
        && typeof manualPatientDetails.medical_document === 'object'
        ? manualPatientDetails.medical_document
        : {};
      const medicalDocumentVerification = medicalDocumentMeta.verification || {};

      if (patientPictureUrl) {
        const profilePhotoResult = await ProfileAPI.updateProfile(userId, {
          photo_path: patientPictureUrl,
        });

        if (profilePhotoResult.error) {
          throw new Error(profilePhotoResult.error.message || 'Patient photo could not be saved to the profile.');
        }
      }

      const patientResult = await ProfileAPI.updatePatientDetails(userId, {
        medical_condition: manualPatientDetails?.medical_condition || '',
        patient_picture: patientPictureUrl || '',
        date_of_diagnosis: manualPatientDetails?.date_of_diagnosis || null,
        guardian: manualPatientDetails?.guardian || '',
        guardian_relationship: manualPatientDetails?.guardian_relationship || '',
        guardian_contact_number: manualPatientDetails?.guardian_contact_number || '',
        medical_document: medicalDocumentUrl || '',
        medical_document_verification_status:
          medicalDocumentMeta.medical_document_verification_status
          || medicalDocumentVerification.status
          || null,
        medical_document_ocr_text:
          medicalDocumentMeta.medical_document_ocr_text
          || medicalDocumentVerification.extractedText
          || null,
        medical_document_verified_at:
          medicalDocumentMeta.medical_document_verified_at
          || (medicalDocumentVerification.status ? new Date().toISOString() : null),
        doctor_name:
          medicalDocumentMeta.doctor_name
          || medicalDocumentVerification.doctorName
          || null,
        doctor_license_number:
          medicalDocumentMeta.doctor_license_number
          || medicalDocumentVerification.licenseNumber
          || null,
      });

      if (patientResult.error) {
        throw new Error(patientResult.error.message || 'Patient details could not be saved.');
      }

      await writeAuditLog({
        authUserId: userId,
        databaseUserId: systemUserResult.data.user_id,
        userEmail: email || '',
        action: 'patient.manual_submission',
        description: 'Manual patient details were submitted successfully.',
        resource: 'patients',
        status: 'success',
      });

      logAppEvent('patient.manual_submission', 'Manual patient detail submission succeeded.', {
        authUserId: userId,
        databaseUserId: systemUserResult.data.user_id,
        patientId: patientResult.data?.patient_id || null,
      });
    }

    if (shouldUpdateRoleImmediately) {
      const roleUpdateResult = await ProfileAPI.updateSystemUserRoleByAuthUserId({
        authUserId: userId,
        role: targetRole,
        email,
      });

      if (roleUpdateResult.error) {
        throw new Error(roleUpdateResult.error.message || 'The account role could not be updated.');
      }
    }

    await writeAuditLog({
      authUserId: userId,
      databaseUserId: systemUserResult.data.user_id,
      userEmail: email || '',
      action: 'onboarding.complete',
      description: `Completed post-login onboarding as ${targetRole} using ${mode}.`,
      resource: targetRole === 'patient' ? 'users,user_details,patients' : 'users,user_details',
      status: 'success',
    });

    return {
      success: true,
      role: targetRole,
      roleUpdated: shouldUpdateRoleImmediately,
      error: null,
    };
  } catch (error) {
    if (mode === 'patient-manual') {
      logAppError('patient.manual_submission', error, {
        authUserId: userId,
      });

      await writeAuditLog({
        authUserId: userId,
        userEmail: email || '',
        action: 'patient.manual_submission',
        description: error.message || 'Manual patient detail submission failed.',
        resource: 'patients',
        status: 'failed',
      });
    }

    logAppError('onboarding.complete', error, {
      authUserId: userId,
      mode,
      hasPatientCode: Boolean(patientCode),
      hasManualPatientDetails: Boolean(manualPatientDetails),
    });

    await writeAuditLog({
      authUserId: userId,
      userEmail: email || '',
      action: 'onboarding.complete',
      description: error.message || 'Post-login onboarding failed.',
      resource: 'users,user_details,patients',
      status: 'failed',
    });

    return {
      success: false,
      role: null,
      error: error.message,
    };
  }
};

export const getProfile = async (userId) => {
  try {
    if (!userId) throw new Error('User ID is required');

    const { data, error } = await ProfileAPI.fetchProfileById(userId);
    if (error) throw new Error(error.message);

    return { profile: data, error: null };
  } catch (error) {
    return { profile: null, error: error.message };
  }
};

export const getRoleProfile = async (userId, role) => {
  try {
    if (!userId || role !== 'patient') {
      return { roleProfile: null, error: null };
    }

    const { data, error } = await fetchRoleProfile(role, userId);
    if (error) throw new Error(error.message);

    return { roleProfile: data, error: null };
  } catch (error) {
    return { roleProfile: null, error: error.message };
  }
};

export const getProfileBundle = async (userId, role) => {
  const [{ profile, error: profileError }, { roleProfile, error: roleError }] = await Promise.all([
    getProfile(userId),
    getRoleProfile(userId, role),
  ]);

  return {
    profile,
    roleProfile,
    error: profileError || roleError || null,
  };
};

export const getCurrentAccountBundle = async (userId) => {
  try {
    const { profile, error: profileError } = await getProfile(userId);
    if (profileError) {
      throw new Error(profileError);
    }

    const roleKey = String(profile?.role || '').trim().toLowerCase();
    const databaseUserId = profile?.user_id || null;

    if (roleKey === 'donor') {
      return {
        profile,
        patientProfile: null,
        staffProfile: null,
        hospitalProfile: null,
        databaseUserId,
        onboardingCompleted: null,
        error: null,
      };
    }

    let patientProfile = null;
    let staffProfile = null;
    let hospitalProfile = null;
    let patientError = null;
    let staffError = null;
    let hospitalError = null;
    let onboardingAuditLog = null;

    if (roleKey === 'patient') {
      const patientResult = await ProfileAPI.fetchPatientDetailsByUserId(userId);
      patientProfile = patientResult.data || null;
      patientError = patientResult.error || null;
    } else if (['admin', 'staff', 'qa_stylist', 'organization', 'super_admin', 'hospital', 'hospital_representative'].includes(roleKey)) {
      const staffResult = await ProfileAPI.fetchHospitalStaffByUserId(userId);
      staffProfile = staffResult.data || null;
      staffError = staffResult.error || null;

      if (!staffError && !staffProfile) {
        logAppEvent('profile.redirect.no_hospital_representative', 'No Hospital_Representative row found for the current user during redirect check.', {
          authUserId: userId,
          databaseUserId,
        }, 'info');
      }
    } else {
      const [patientResult, staffResult] = await Promise.all([
        ProfileAPI.fetchPatientDetailsByUserId(userId),
        ProfileAPI.fetchHospitalStaffByUserId(userId),
      ]);
      patientProfile = patientResult.data || null;
      patientError = patientResult.error || null;
      staffProfile = staffResult.data || null;
      staffError = staffResult.error || null;
    }

    const linkedHospitalId = patientProfile?.hospital_id || staffProfile?.hospital_id || null;

    if (linkedHospitalId) {
      const hospitalResult = await ProfileAPI.fetchHospitalRepresentativeById(linkedHospitalId);
      hospitalProfile = hospitalResult.data || null;
      hospitalError = hospitalResult.error || null;
    }

    if (databaseUserId && (roleKey === 'tentative' || !roleKey)) {
      const auditResult = await ProfileAPI.fetchLatestAuditLogByAction({
        databaseUserId,
        action: 'onboarding.complete',
        status: 'success',
      });
      onboardingAuditLog = auditResult.data || null;
    }

    return {
      profile,
      patientProfile: patientError ? null : patientProfile,
      staffProfile: staffError ? null : staffProfile,
      hospitalProfile: hospitalError ? null : hospitalProfile,
      databaseUserId,
      onboardingCompleted: Boolean(onboardingAuditLog?.log_id),
      error: null,
    };
  } catch (error) {
    return {
      profile: null,
      patientProfile: null,
      staffProfile: null,
      hospitalProfile: null,
      databaseUserId: null,
      onboardingCompleted: null,
      error: error.message,
    };
  }
};

export const saveProfile = async (userId, updates, role) => {
  try {
    if (!userId) throw new Error('User ID is required');

    logAppEvent('profile.update', 'Profile save started.', {
      authUserId: userId,
      role: role || null,
      updatedFieldCount: Object.keys(updates || {}).length,
    });

    const sharedUpdates = sanitizeSharedProfileUpdates(updates);
    const { data, error } = await ProfileAPI.updateProfile(userId, sharedUpdates);
    if (error) throw new Error(error.message);

    let nextProfile = data;

    let roleProfile = null;
    if (role === 'patient' && updates?.roleSpecific && Object.keys(updates.roleSpecific).length) {
      const roleResult = await updateRoleProfile(role, userId, updates.roleSpecific);
      if (roleResult.error) throw new Error(roleResult.error.message);
      roleProfile = roleResult.data || null;
    }

    if (String(role || '').trim().toLowerCase() === 'tentative') {
      const completionMeta = buildProfileCompletionMeta(nextProfile);

      if (completionMeta.isComplete) {
        const roleUpdateResult = await ProfileAPI.updateSystemUserRoleByAuthUserId({
          authUserId: userId,
          role: 'donor',
          email: nextProfile?.email || undefined,
        });

        if (roleUpdateResult.error) {
          throw new Error(roleUpdateResult.error.message || 'The donor role could not be updated.');
        }

        nextProfile = {
          ...nextProfile,
          role: 'donor',
        };

        void writeAuditLog({
          authUserId: userId,
          databaseUserId: nextProfile?.user_id || null,
          action: 'role.transition',
          description: 'Completed donor account setup and updated role to donor.',
          resource: 'users,user_details',
          status: 'success',
        });
      }
    }

    void writeAuditLog({
      authUserId: userId,
      databaseUserId: nextProfile?.user_id || null,
      action: 'profile.update',
      description: role === 'patient'
        ? 'Updated profile and patient details.'
        : 'Updated profile details.',
      resource: role === 'patient' ? 'user_details,patients' : 'user_details',
      status: 'success',
    });

    logAppEvent('profile.update', 'Profile save succeeded.', {
      authUserId: userId,
      databaseUserId: nextProfile?.user_id || null,
      role: role || null,
    });

    return {
      profile: nextProfile,
      roleProfile,
      error: null,
    };
  } catch (error) {
    logAppError('profile.update', error, {
      authUserId: userId,
      role: role || null,
      updatedFieldCount: Object.keys(updates || {}).length,
    });

    void writeAuditLog({
      authUserId: userId,
      action: 'profile.update',
      description: error.message || 'Profile update failed.',
      resource: role === 'patient' ? 'user_details,patients' : 'user_details',
      status: 'failed',
    });
    return {
      profile: null,
      roleProfile: null,
      error: error.message,
    };
  }
};

export const saveAvatar = async (userId, avatarUrl) => {
  try {
    if (!userId) throw new Error('User ID is required');
    if (!avatarUrl) throw new Error('Avatar image is required');

    let normalizedAvatarUrl = avatarUrl;

    if (typeof avatarUrl === 'object' && avatarUrl !== null) {
      if (avatarUrl.fileBody) {
        const uploadResult = await ProfileAPI.uploadProfileAvatar({
          authUserId: userId,
          fileBody: avatarUrl.fileBody,
          contentType: avatarUrl.contentType,
          fileName: avatarUrl.fileName,
        });

        if (uploadResult.error || !uploadResult.data?.publicUrl) {
          throw new Error(uploadResult.error?.message || 'Profile photo could not be uploaded.');
        }

        normalizedAvatarUrl = uploadResult.data.publicUrl;
      } else {
        normalizedAvatarUrl = avatarUrl.publicUrl || avatarUrl.path || '';
      }
    }

    if (typeof normalizedAvatarUrl === 'string' && dataUrlPattern.test(normalizedAvatarUrl)) {
      const [, mimeType] = normalizedAvatarUrl.match(dataUrlPattern) || [];
      const fileResponse = await fetch(normalizedAvatarUrl);
      if (!fileResponse.ok) {
        throw new Error('Profile photo could not be read.');
      }

      const uploadResult = await ProfileAPI.uploadProfileAvatar({
        authUserId: userId,
        fileBody: await fileResponse.arrayBuffer(),
        contentType: mimeType || 'image/jpeg',
      });

      if (uploadResult.error || !uploadResult.data?.publicUrl) {
        throw new Error(uploadResult.error?.message || 'Profile photo could not be uploaded.');
      }

      normalizedAvatarUrl = uploadResult.data.publicUrl;
    }

    if (!normalizedAvatarUrl || typeof normalizedAvatarUrl !== 'string') {
      throw new Error('Profile photo could not be prepared.');
    }

    const { data, error } = await ProfileAPI.updateProfile(userId, {
      avatar_url: normalizedAvatarUrl,
    });

    if (error) throw new Error(error.message);
    await writeAuditLog({
      authUserId: userId,
      databaseUserId: data?.user_id || null,
      action: 'profile.update_avatar',
      description: 'Updated profile photo.',
      resource: 'user_details',
      status: 'success',
    });
    return { profile: data, error: null };
  } catch (error) {
    await writeAuditLog({
      authUserId: userId,
      action: 'profile.update_avatar',
      description: error.message || 'Profile photo update failed.',
      resource: 'user_details',
      status: 'failed',
    });
    return { profile: null, error: error.message };
  }
};

export const getVisibleRoleFields = (roleProfile) => {
  if (!roleProfile) return [];

  return Object.entries(roleProfile)
    .filter(([key, value]) => !SYSTEM_ROLE_KEYS.has(key) && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()),
      value: String(value),
    }));
};
