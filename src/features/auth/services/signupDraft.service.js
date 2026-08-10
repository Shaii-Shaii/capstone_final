import AsyncStorage from '@react-native-async-storage/async-storage';
import { linkPatientRecordByCode, saveAvatar, saveProfile } from '../../profile/services/profile.service';
import { ensureSystemUserRecord, ensureUserDetailsRecord } from '../../profile/api/profile.api';
import { createNotifications } from '../../notification.api';
import { notificationTypes } from '../../notification.constants';

const SIGNUP_DRAFT_STORAGE_KEY = 'donivra.signupDrafts';

const normalizeEmailKey = (email) => email?.trim().toLowerCase() || '';

const sanitizeDraft = (draft = {}) => ({
  email: draft.email?.trim() || '',
  role: draft.role || '',
  isPatient: draft.isPatient || '',
  patientFlowMode: draft.patientFlowMode || '',
  firstName: draft.firstName?.trim() || '',
  middleName: draft.middleName?.trim?.() || '',
  lastName: draft.lastName?.trim() || '',
  suffix: draft.suffix?.trim?.() || '',
  phone: draft.phone?.trim() || '',
  birthdate: draft.birthdate?.trim?.() || '',
  gender: draft.gender?.trim?.() || '',
  joinedDate: draft.joinedDate?.trim?.() || new Date().toISOString().slice(0, 10),
  linkedPatientCode: draft.linkedPatientCode?.trim?.() || '',
  linkedPatientId: draft.linkedPatientId || '',
  linkedPatientHospitalId: draft.linkedPatientHospitalId || '',
  patientMedicalCondition: draft.patientMedicalCondition?.trim?.() || '',
  patientPicture: draft.patientPicture?.trim?.() || '',
  patientMedicalDocument: draft.patientMedicalDocument?.trim?.() || '',
  street: draft.street?.trim() || '',
  barangay: draft.barangay?.trim() || '',
  city: draft.city?.trim() || '',
  province: draft.province?.trim() || '',
  region: draft.region?.trim() || '',
  country: draft.country?.trim() || 'Philippines',
  latitude: draft.latitude?.trim?.() || '',
  longitude: draft.longitude?.trim?.() || '',
  profilePhoto: draft.profilePhoto?.trim?.() || '',
});

const readDraftMap = async () => {
  try {
    const raw = await AsyncStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    return {};
  }
};

const writeDraftMap = async (draftMap) => {
  await AsyncStorage.setItem(SIGNUP_DRAFT_STORAGE_KEY, JSON.stringify(draftMap));
};

export const savePendingSignupDraft = async (draft) => {
  const emailKey = normalizeEmailKey(draft?.email);
  if (!emailKey) return;

  const draftMap = await readDraftMap();
  draftMap[emailKey] = sanitizeDraft(draft);
  await writeDraftMap(draftMap);
};

export const getPendingSignupDraft = async (email) => {
  const emailKey = normalizeEmailKey(email);
  if (!emailKey) return null;

  const draftMap = await readDraftMap();
  return draftMap[emailKey] || null;
};

export const clearPendingSignupDraft = async (email) => {
  const emailKey = normalizeEmailKey(email);
  if (!emailKey) return;

  const draftMap = await readDraftMap();
  if (!(emailKey in draftMap)) return;
  delete draftMap[emailKey];
  await writeDraftMap(draftMap);
};

export const syncPendingSignupDraft = async ({ userId, email, role }) => {
  try {
    if (!userId || !email) {
      return { success: false, error: 'Missing signup sync context.' };
    }

    const draft = await getPendingSignupDraft(email);
    if (!draft) {
      return { success: true, synced: false, error: null };
    }

    const manualPatientRoleSpecific = draft.isPatient === 'yes' && draft.patientFlowMode === 'manual'
      ? {
          medical_condition: draft.patientMedicalCondition,
          patient_picture: draft.patientPicture || draft.profilePhoto || '',
          medical_document: draft.patientMedicalDocument || '',
        }
      : null;

    const systemUserResult = await ensureSystemUserRecord({
      authUserId: userId,
      email,
      role,
    });

    if (systemUserResult.error || !systemUserResult.data?.user_id) {
      return {
        success: false,
        synced: false,
        error: systemUserResult.error?.message || 'The app user record could not be created.',
      };
    }

    const userDetailsResult = await ensureUserDetailsRecord({
      systemUserId: systemUserResult.data.user_id,
      details: {
        first_name: draft.firstName,
        middle_name: draft.middleName,
        last_name: draft.lastName,
        suffix: draft.suffix,
        birthdate: draft.birthdate,
        gender: draft.gender,
        street: draft.street,
        region: draft.region,
        barangay: draft.barangay,
        city: draft.city,
        province: draft.province,
        country: draft.country,
        contact_number: draft.phone,
        joined_date: draft.joinedDate,
        photo_path: draft.profilePhoto || null,
        latitude: draft.latitude,
        longitude: draft.longitude,
      },
    });

    if (userDetailsResult.error) {
      return {
        success: false,
        synced: false,
        error: userDetailsResult.error.message || 'The user details record could not be created.',
      };
    }

    const result = await saveProfile(userId, {
      first_name: draft.firstName,
      middle_name: draft.middleName,
      last_name: draft.lastName,
      suffix: draft.suffix,
      phone: draft.phone,
      birthdate: draft.birthdate,
      gender: draft.gender,
      street: draft.street,
      barangay: draft.barangay,
      region: draft.region,
      country: draft.country,
      latitude: draft.latitude,
      longitude: draft.longitude,
      city: draft.city,
      province: draft.province,
      joined_date: draft.joinedDate,
      roleSpecific: manualPatientRoleSpecific,
    }, role);

    if (result.error) {
      return { success: false, synced: false, error: result.error };
    }

    if (draft.profilePhoto) {
      const avatarResult = await saveAvatar(userId, draft.profilePhoto);
      if (avatarResult.error) {
        return { success: false, synced: false, error: avatarResult.error };
      }
    }

    if (draft.isPatient === 'yes' && draft.patientFlowMode === 'linked' && draft.linkedPatientCode) {
      const patientLinkResult = await linkPatientRecordByCode({
        userId,
        patientCode: draft.linkedPatientCode,
        patientPicture: draft.patientPicture || draft.profilePhoto || '',
      });

      if (patientLinkResult.error) {
        return { success: false, synced: false, error: patientLinkResult.error };
      }
    }

    const accountRole = draft.isPatient === 'yes' ? 'patient' : 'donor';
    await createNotifications([{
      user_id: systemUserResult.data.user_id,
      type: notificationTypes.accountCreated,
      title: 'Welcome to Donivra',
      message: accountRole === 'patient'
        ? 'Your patient account has been created. You can now explore wig support and manage requests.'
        : 'Your donor account has been created. You can now analyze your hair, RSVP to events, and manage donations.',
      status: 'Unread',
      reference_type: 'route',
      reference_id: accountRole === 'patient' ? '/patient/home' : '/donor/home',
      updated_at: systemUserResult.data.created_at || new Date().toISOString(),
    }]).catch(() => ({ data: [], error: null }));

    await clearPendingSignupDraft(email);
    return { success: true, synced: true, error: null };
  } catch (error) {
    return { success: false, synced: false, error: error.message || 'Failed to save signup details.' };
  }
};
