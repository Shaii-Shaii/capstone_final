import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { useAuth } from '../providers/AuthProvider';
import { useAuthActions } from '../features/auth/hooks/useAuthActions';
import {
  buildProfileCompletionMeta,
  getProfileBundle,
  getVisibleRoleFields,
  hasProfileFormChanges,
  saveAvatar,
  saveProfile,
} from '../features/profile/services/profile.service';
import { logAppError, logAppEvent } from '../utils/appErrors';

const IMAGE_MEDIA_TYPES = ['images'];
const BASE64_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const getFileExtension = (mimeType = '', fileName = '') => {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  const normalizedFileName = String(fileName || '').trim().toLowerCase();

  if (normalizedMimeType.includes('png') || normalizedFileName.endsWith('.png')) return 'png';
  if (normalizedMimeType.includes('webp') || normalizedFileName.endsWith('.webp')) return 'webp';
  if (normalizedMimeType.includes('gif') || normalizedFileName.endsWith('.gif')) return 'gif';
  return 'jpg';
};

const decodeBase64ToArrayBuffer = (value = '') => {
  const normalizedValue = String(value || '').replace(/\s/g, '');
  if (!normalizedValue) {
    return new ArrayBuffer(0);
  }

  const paddingLength = normalizedValue.endsWith('==')
    ? 2
    : (normalizedValue.endsWith('=') ? 1 : 0);
  const outputLength = Math.floor((normalizedValue.length * 3) / 4) - paddingLength;
  const bytes = new Uint8Array(outputLength);

  let byteIndex = 0;
  for (let index = 0; index < normalizedValue.length; index += 4) {
    const chunk =
      (BASE64_CHARACTERS.indexOf(normalizedValue[index]) << 18)
      | (BASE64_CHARACTERS.indexOf(normalizedValue[index + 1]) << 12)
      | ((normalizedValue[index + 2] === '=' ? 0 : BASE64_CHARACTERS.indexOf(normalizedValue[index + 2])) << 6)
      | (normalizedValue[index + 3] === '=' ? 0 : BASE64_CHARACTERS.indexOf(normalizedValue[index + 3]));

    if (byteIndex < outputLength) {
      bytes[byteIndex++] = (chunk >> 16) & 0xff;
    }

    if (byteIndex < outputLength && normalizedValue[index + 2] !== '=') {
      bytes[byteIndex++] = (chunk >> 8) & 0xff;
    }

    if (byteIndex < outputLength && normalizedValue[index + 3] !== '=') {
      bytes[byteIndex++] = chunk & 0xff;
    }
  }

  return bytes.buffer;
};

const getAssetUploadPayload = async (asset) => {
  if (!asset) {
    throw new Error('Unable to read the selected image.');
  }

  const contentType = asset.mimeType || asset.file?.type || 'image/jpeg';
  const fileName = asset.fileName || asset.file?.name || `profile-photo.${getFileExtension(contentType)}`;

  if (asset.base64) {
    return {
      fileBody: decodeBase64ToArrayBuffer(asset.base64),
      contentType,
      fileName,
    };
  }

  if (asset.file && typeof asset.file.arrayBuffer === 'function') {
    return {
      fileBody: await asset.file.arrayBuffer(),
      contentType,
      fileName,
    };
  }

  if (asset.uri) {
    const base64File = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: 'base64',
    });

    return {
      fileBody: decodeBase64ToArrayBuffer(base64File),
      contentType,
      fileName,
    };
  }

  throw new Error('Unable to read the selected image.');
};

const formFromProfile = (profile) => ({
  firstName: profile?.first_name || '',
  middleName: profile?.middle_name || '',
  lastName: profile?.last_name || '',
  suffix: profile?.suffix || '',
  birthdate: profile?.birthdate || '',
  gender: profile?.gender || '',
  phone: profile?.phone || '',
  street: profile?.street || '',
  barangay: profile?.barangay || '',
  region: profile?.region || '',
  city: profile?.city || '',
  province: profile?.province || '',
  country: profile?.country || 'Philippines',
});

export const useProfileActions = () => {
  const { user, profile, patientProfile, staffProfile, hospitalProfile, refreshProfile } = useAuth();
  const { logout, updatePassword, isLoading: isAuthLoading } = useAuthActions();
  const [roleProfile, setRoleProfile] = useState(null);
  const [visibleRoleFields, setVisibleRoleFields] = useState([]);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isLoadingRoleProfile, setIsLoadingRoleProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const defaultValues = useMemo(() => formFromProfile(profile), [profile]);
  const profileCompletionMeta = useMemo(() => (
    buildProfileCompletionMeta({
      photo_path: profile?.photo_path || profile?.avatar_url || '',
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
      birthdate: profile?.birthdate || '',
      gender: profile?.gender || '',
      contact_number: profile?.contact_number || profile?.phone || '',
      street: profile?.street || '',
      barangay: profile?.barangay || '',
      city: profile?.city || '',
      province: profile?.province || '',
      region: profile?.region || '',
      country: profile?.country || 'Philippines',
    })
  ), [
    profile?.avatar_url,
    profile?.barangay,
    profile?.birthdate,
    profile?.city,
    profile?.contact_number,
    profile?.country,
    profile?.first_name,
    profile?.gender,
    profile?.last_name,
    profile?.phone,
    profile?.photo_path,
    profile?.province,
    profile?.region,
    profile?.street,
  ]);

  const getProfileCompletionMeta = useCallback((values = defaultValues) => (
    buildProfileCompletionMeta({
      photo_path: profile?.photo_path || profile?.avatar_url || '',
      first_name: values?.firstName,
      last_name: values?.lastName,
      birthdate: values?.birthdate,
      gender: values?.gender,
      contact_number: values?.phone,
      street: values?.street,
      barangay: values?.barangay,
      city: values?.city,
      province: values?.province,
      region: values?.region,
      country: values?.country || profile?.country || 'Philippines',
    })
  ), [
    defaultValues,
    profile?.avatar_url,
    profile?.country,
    profile?.photo_path,
  ]);

  const hasUnsavedProfileChanges = useCallback((values = defaultValues) => (
    hasProfileFormChanges(defaultValues, values)
  ), [defaultValues]);

  const loadProfileBundle = useCallback(async () => {
    if (!user?.id || !profile?.role) return;
    setIsLoadingRoleProfile(true);
    logAppEvent('profile_completion.modal_fetch', 'Profile completion context fetch started.', {
      authUserId: user.id,
      role: profile.role,
    });

    try {
      const { roleProfile: fetchedRoleProfile, error } = await getProfileBundle(user.id, profile.role);

      if (error) {
        throw new Error(error);
      }

      setRoleProfile(fetchedRoleProfile);
      setVisibleRoleFields(getVisibleRoleFields(fetchedRoleProfile));

      logAppEvent('profile_completion.modal_fetch', 'Profile completion context fetch succeeded.', {
        authUserId: user.id,
        role: profile.role,
        hasRoleProfile: Boolean(fetchedRoleProfile),
      });
    } catch (error) {
      logAppError('profile_completion.modal_fetch', error, {
        authUserId: user?.id || null,
        role: profile?.role || null,
      });
      setRoleProfile(null);
      setVisibleRoleFields([]);
    } finally {
      setIsLoadingRoleProfile(false);
    }
  }, [profile?.role, user?.id]);

  useEffect(() => {
    loadProfileBundle();
  }, [loadProfileBundle]);

  const saveSharedProfile = async (values) => {
    if (!user?.id) {
      return { success: false, error: 'Session not found.' };
    }

    setIsSavingProfile(true);
    logAppEvent('profile_completion.save', 'Profile completion save started.', {
      authUserId: user.id,
      role: profile?.role || null,
    });

    const payload = {
      first_name: values.firstName,
      middle_name: values.middleName,
      last_name: values.lastName,
      suffix: values.suffix,
      birthdate: values.birthdate,
      gender: values.gender,
      phone: values.phone,
      street: values.street,
      barangay: values.barangay,
      region: values.region,
      city: values.city,
      province: values.province,
      country: values.country,
    };

    try {
      const result = await saveProfile(user.id, payload, profile?.role);

      if (result.error) {
        logAppError('profile_completion.save', new Error(result.error), {
          authUserId: user.id,
          role: profile?.role || null,
        });
        return { success: false, error: result.error };
      }

      void refreshProfile(user.id).catch((refreshError) => {
        logAppError('profile_completion.save.refresh', refreshError, {
          authUserId: user.id,
          role: profile?.role || null,
        });
      });
      void loadProfileBundle().catch((bundleError) => {
        logAppError('profile_completion.save.bundle_refresh', bundleError, {
          authUserId: user.id,
          role: profile?.role || null,
        });
      });

      logAppEvent('profile_completion.save', 'Profile completion save succeeded.', {
        authUserId: user.id,
        role: profile?.role || null,
      });

      return { success: true };
    } finally {
      setIsSavingProfile(false);
    }
  };

  const uploadAvatar = async () => {
    setIsUploadingAvatar(true);

    try {
      if (!user?.id) {
        return { success: false, error: 'Session not found.' };
      }

      logAppEvent('profile_photo.upload', 'Profile photo upload started.', {
        authUserId: user.id,
        platform: Platform.OS,
      });

      if (Platform.OS !== 'android') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          return { success: false, error: 'Please allow photo library access to choose a profile image.' };
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.55,
        base64: true,
      });

      if (result.canceled) {
        return { success: false, canceled: true };
      }

      const asset = result.assets?.[0];
      const avatarUploadPayload = await getAssetUploadPayload(asset);
      const uploadResult = await saveAvatar(user.id, avatarUploadPayload);

      if (uploadResult.error) {
        logAppError('profile_photo.upload', new Error(uploadResult.error), {
          authUserId: user.id,
          platform: Platform.OS,
        });
        return { success: false, error: uploadResult.error };
      }

      await refreshProfile(user.id);
      await loadProfileBundle();
      logAppEvent('profile_photo.upload', 'Profile photo upload succeeded.', {
        authUserId: user.id,
        platform: Platform.OS,
      });
      return { success: true, avatarUrl: uploadResult.profile?.avatar_url || uploadResult.profile?.photo_path || '' };
    } catch (error) {
      logAppError('profile_photo.upload', error, {
        authUserId: user?.id || null,
        platform: Platform.OS,
      });
      return { success: false, error: error.message || 'Unable to update your photo.' };
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  return {
    user,
    profile,
    patientProfile,
    staffProfile,
    hospitalProfile,
    roleProfile,
    visibleRoleFields,
    defaultValues,
    profileCompletionMeta,
    isSavingProfile,
    isLoadingRoleProfile,
    isUploadingAvatar,
    isChangingPassword: isAuthLoading,
    loadProfileBundle,
    getProfileCompletionMeta,
    hasUnsavedProfileChanges,
    saveSharedProfile,
    uploadAvatar,
    changePassword: (values) => updatePassword(values),
    logout,
  };
};
