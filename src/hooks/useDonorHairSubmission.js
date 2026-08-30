import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { analyzeHairPhotos } from '../features/hairAnalysis.service';
import { getHairDonationModuleContext, saveHairSubmissionFlow } from '../features/hairSubmission.service';
import { hairAnalysisRequiredViews } from '../features/hairSubmission.constants';
import { canSubmitHairDonation, mapDonationPermissionError } from '../features/donorCompliance.service';
import { logAppEvent } from '../utils/appErrors';

const MAX_PHOTO_COUNT = hairAnalysisRequiredViews.length;
const IMAGE_MEDIA_TYPES = ['images'];
const NATIVE_SLOT_IMAGE_MAX_SIZE = 1280;
const NATIVE_SLOT_IMAGE_QUALITY = 0.72;

const createErrorState = (title, message, extras = {}) => ({
  title,
  message,
  ...extras,
});

const createEmptyPhotoSlots = () => Array.from({ length: MAX_PHOTO_COUNT }, () => null);

const buildResizeAction = ({ width, height, maxSize }) => {
  const resolvedWidth = Number(width || 0);
  const resolvedHeight = Number(height || 0);

  if (!resolvedWidth || !resolvedHeight) return [];

  const scale = Math.min(1, maxSize / Math.max(resolvedWidth, resolvedHeight));
  if (scale >= 1) return [];

  // Constrain one edge only. Camera libraries can report dimensions before
  // EXIF orientation is applied; forcing both values can deform portrait
  // captures after the image manipulator decodes that orientation.
  const resizedLongestEdge = Math.max(1, Math.round(Math.max(resolvedWidth, resolvedHeight) * scale));

  return [{
    resize: resolvedWidth >= resolvedHeight
      ? { width: resizedLongestEdge }
      : { height: resizedLongestEdge },
  }];
};

const normalizeNativeAssetForHairAnalysis = async (asset) => {
  if (!asset?.uri) return asset;

  const normalizedAsset = await manipulateAsync(
    asset.uri,
    buildResizeAction({
      width: asset?.width,
      height: asset?.height,
      maxSize: NATIVE_SLOT_IMAGE_MAX_SIZE,
    }),
    {
      compress: NATIVE_SLOT_IMAGE_QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    }
  );

  if (!normalizedAsset?.uri || !normalizedAsset?.base64) {
    throw new Error('The selected hair photo could not be processed for AI analysis.');
  }

  return {
    ...asset,
    uri: normalizedAsset.uri,
    base64: normalizedAsset.base64,
    dataUrl: `data:image/jpeg;base64,${normalizedAsset.base64}`,
    mimeType: 'image/jpeg',
    file: null,
    width: normalizedAsset.width || asset?.width,
    height: normalizedAsset.height || asset?.height,
    fileName: asset?.fileName || '',
  };
};

const normalizeAssetForHairAnalysis = async (asset) => normalizeNativeAssetForHairAnalysis(asset);

const mapImagePickerError = (message = '') => {
  const normalized = message.toLowerCase();

  if (normalized.includes('photo library access')) {
    return createErrorState('Photo Access Needed', 'Allow photo library access first so you can upload hair images.');
  }

  if (normalized.includes('camera access')) {
    return createErrorState('Camera Access Needed', 'Allow camera access first so you can take guided hair photos.');
  }

  if (normalized.includes('camera capture is not available')) {
    return createErrorState('Camera Unavailable', 'Camera capture is not available here. Use Upload instead to continue this screening step.');
  }

  if (normalized.includes('read the selected hair images')) {
    return createErrorState('Photos Could Not Be Read', 'Please choose a clear image file again. The selected photo could not be processed.');
  }

  return createErrorState('Unable To Use Photo', 'We could not open that photo right now. Please try again.');
};

const mapAnalysisError = (message = '', extras = {}) => {
  const normalized = message.toLowerCase();
  const providerRequestAttempted = extras?.providerRequestAttempted === true;
  const edgeFunctionInvoked = extras?.edgeFunctionInvoked === true;
  const providerResponseStatus = Number(extras?.providerResponseStatus);
  const normalizedErrorType = String(extras?.errorType || '').trim().toLowerCase();
  const directRetryAfterSeconds = Number(extras?.retryAfterSeconds);
  const retryAfterSeconds = Number.isFinite(directRetryAfterSeconds) && directRetryAfterSeconds > 0
    ? Math.max(1, Math.ceil(directRetryAfterSeconds))
    : null;
  const createRetryState = (title, fallbackMessage) => createErrorState(
    title,
    retryAfterSeconds
      ? `Hair analysis is busy right now. Please wait ${retryAfterSeconds} seconds, then try again.`
      : fallbackMessage,
    {
      retryAfterSeconds,
      retryUntil: retryAfterSeconds ? Date.now() + (retryAfterSeconds * 1000) : null,
    }
  );

  if (
    providerRequestAttempted
    && (
      normalizedErrorType === 'provider_access_denied'
      || providerResponseStatus === 401
      || providerResponseStatus === 403
      || normalized.includes('denied access')
      || normalized.includes('permission denied')
      || normalized.includes('caller does not have permission')
      || normalized.includes('access denied')
      || normalized.includes('api key not valid')
      || normalized.includes('api key is invalid')
      || normalized.includes('key is invalid')
    )
  ) {
    return createErrorState(
      'AI Access Needs Admin Fix',
      'Hair analysis is connected, but the configured AI API key or model access is blocked. Ask an admin to check the Supabase AI provider secrets and vision model access.'
    );
  }

  if (normalized.includes('at least one hair photo')) {
    return createErrorState('Upload Photos First', 'Add the required hair photos before running the analysis.');
  }

  if (normalized.includes('guided donation questions') || normalized.includes('guided hair questions')) {
    return createErrorState('Questions Needed', 'Complete the screening questions first before analysis.');
  }

  if (normalized.includes('compliance checklist')) {
    return createErrorState('Checklist Needed', 'Confirm the photo checklist first before analysis.');
  }

  if (normalized.includes('response was incomplete')) {
    return createErrorState('Analysis Was Incomplete', 'The scan did not finish properly. Please try analyzing the photos again.');
  }

  if (
    normalizedErrorType === 'insufficient_detail'
    || normalized.includes('low-detail fields')
    || normalized.includes('tap "try again"')
  ) {
    return createErrorState(
      'Analysis Needs One More Pass',
      'Your photos passed validation, but the AI returned incomplete hair details. Tap Try again to rerun analysis.'
    );
  }

  if (
    normalized.includes('photos incomplete')
    || normalized.includes('required views')
    || normalized.includes('more hair views')
  ) {
    return createErrorState('Photos Incomplete', message);
  }

  if (
    normalized.includes('too dark')
    || normalized.includes('bright indirect light')
    || normalized.includes('underexposed')
  ) {
    return createErrorState('Lighting Too Dark', 'The photo looks too dark. Please move near bright indirect light and retake it.');
  }

  if (normalized.includes('not clear') || normalized.includes('unclear') || normalized.includes('blur')) {
    return createErrorState('Photos not clear, please re-capture', 'Photos not clear, please re-capture. Hold the camera steady, use bright light, and keep the front, left side, right side, scalp, hair ends, and back hair photos clear.');
  }

  if (
    normalized.includes('could not detect a person')
    || normalized.includes('no person')
    || normalized.includes('no human')
  ) {
    return createErrorState('Person Not Detected', 'We could not detect a person in the photo. Please retake it with your hair clearly visible.');
  }

  if (normalized.includes('multiple subjects') || normalized.includes('multiple subject')) {
    return createErrorState('Multiple Subject Detected, One Subject is needed', 'Multiple Subject Detected, One Subject is needed. Please retake the photo with only one person in frame.');
  }

  if (
    normalized.includes('inconsistent across views')
    || normalized.includes('views are inconsistent')
    || normalized.includes('different people')
    || normalized.includes('different person')
    || normalized.includes('different subject')
    || normalized.includes('same current hair')
    || normalized.includes('mismatched hair')
    || normalized.includes('mixed hair')
  ) {
    return createErrorState('Photos Do Not Match', 'The required photos do not look consistent. Please retake all views with the same person and the same current hair.');
  }

  if (
    normalized.includes('accessories detected')
    || normalized.includes('remove hats')
    || normalized.includes('glasses')
    || normalized.includes('sunglasses')
    || normalized.includes('eyeglasses')
    || normalized.includes('mask')
    || normalized.includes('hair ties')
    || normalized.includes('scarves')
    || normalized.includes('headphones')
    || normalized.includes('headbands')
    || normalized.includes('clips')
  ) {
    return createErrorState('Retake photos', 'The scan needs clearer hair visibility. Please retake the required views in bright light with your hair centered.');
  }

  if (
    normalized.includes('background makes')
    || normalized.includes('plain, uncluttered')
    || normalized.includes('distracting background')
  ) {
    return createErrorState('Background Too Busy', 'The background makes the analysis harder. Please retake the photo against a plain, uncluttered background.');
  }

  if (providerRequestAttempted && normalized.includes('cannot analyze hair right now')) {
    return createRetryState('Analysis Busy', 'Hair analysis is busy right now. Please try again in a moment.');
  }

  if (
    providerRequestAttempted
    && (
    normalized.includes('quota exceeded')
    || normalized.includes('retry in')
    || normalized.includes('rate limit')
    || normalized.includes('too many requests')
    || normalizedErrorType === 'quota_exceeded'
    )
  ) {
    return createRetryState(
      retryAfterSeconds ? 'Please Wait' : 'Analysis Busy',
      'Hair analysis is busy right now. Please try again in a moment.'
    );
  }

  if (
    providerRequestAttempted
    && (
    normalized.includes('high demand')
    || normalized.includes('temporarily busy')
    || normalized.includes('temporarily unavailable')
    || normalized.includes('service unavailable')
    || normalized.includes('retry later')
    || normalized.includes('resource exhausted')
    || normalizedErrorType === 'temporary_unavailable'
    )
  ) {
    return createErrorState(
      'Analysis Busy',
      'Hair analysis is temporarily busy right now. Please try again in a moment.'
    );
  }

  if (normalized.includes('not configured on the server')) {
    return createErrorState('Analysis Unavailable', 'Hair analysis is not configured on the server right now. Please try again later.');
  }

  if (!edgeFunctionInvoked && normalized.includes('could not reach the server')) {
    return createErrorState('Connection Problem', 'Hair analysis could not reach the server right now. Please try again.');
  }

  if (!edgeFunctionInvoked && normalized.includes('cannot start hair analysis')) {
    return createErrorState('Analysis Unavailable', 'Cannot start hair analysis right now. Please try again.');
  }

  if (edgeFunctionInvoked && !providerRequestAttempted && normalized.includes('could not start on the server')) {
    return createErrorState('Analysis Unavailable', 'Hair analysis could not start on the server right now. Please try again.');
  }

  if (normalized.includes('session has expired') || normalized.includes('sign in again')) {
    return createErrorState('Session Expired', 'Please sign in again to continue the hair analysis.');
  }

  if (normalized.includes('could not be read')) {
    return createErrorState('Photo Could Not Be Read', 'One of the uploaded photos could not be processed. Please upload or retake that hair view again.');
  }

  if (String(extras?.errorType || '').trim().toLowerCase() === 'photo_quality') {
    return createErrorState('Retake Photos', message || 'Please retake the front, left side, right side, scalp, hair ends, and back hair photos in bright light with one person visible and the scalp/crown area clear.');
  }

  if (normalized.includes('does not represent a valid image')) {
    return createErrorState('Photos Could Not Be Processed', 'One of the uploaded hair photos was saved in an unsupported image format. Please retake or upload that view again.');
  }

  if (normalized.includes('unsupported image') || normalized.includes('invalid image')) {
    return createErrorState('Photos Could Not Be Processed', 'One of the uploaded hair photos uses an unsupported image format. Please retake or upload that view again.');
  }

  if (normalized.includes('too large for analysis')) {
    return createErrorState('Photos Too Large', 'The uploaded hair photos are too large for AI analysis right now. Please retake or upload clearer but smaller images and try again.');
  }

  if (normalized.includes('could not be processed for ai analysis')) {
    return createErrorState('Photos Could Not Be Processed', 'One of the uploaded hair photos could not be processed for AI analysis. Please retake or upload that view again.');
  }

  if (
    normalized.includes('front view photo')
    || normalized.includes('left side photo')
    || normalized.includes('side profile photo')
    || normalized.includes('right side photo')
    || normalized.includes('side view photo')
    || normalized.includes('back view photo')
    || normalized.includes('back hair photo')
    || normalized.includes('hair ends close-up')
    || normalized.includes('hair scalp')
  ) {
    return createErrorState('More Hair Views Needed', message);
  }

  if (normalized.includes('not clear enough for a reliable hair analysis')) {
    return createErrorState('Photos Need Better Clarity', 'The uploaded hair photos were too unclear for a reliable result. Retake the front, left side, right side, scalp, hair ends, and back hair photos in brighter light with the hair and scalp/crown area clear.');
  }

  if (normalized.includes('invalid json') || normalized.includes('could not be parsed')) {
    return createErrorState('Analysis Could Not Be Read', 'The AI response could not be read properly. Please try the hair analysis again in a moment.');
  }

  return createErrorState('Analysis Unavailable', 'We could not analyze the uploaded hair photos right now. Please try again in a moment.');
};

const mapSaveError = (message = '') => {
  const normalized = message.toLowerCase();

  if (normalized.includes('session is not ready')) {
    return createErrorState('Session Not Ready', 'Please reopen CheckHair and try again.');
  }

  if (normalized.includes('upload at least one photo')) {
    return createErrorState('Photos Are Required', 'Upload the required hair photos first before saving this hair check.');
  }

  if (normalized.includes('run the ai analysis')) {
    return createErrorState('Analysis Needed', 'Wait for the AI result or run the analysis again before saving.');
  }

  if (normalized.includes('guardian consent') || normalized.includes('below 18')) {
    return createErrorState('Guardian Consent Required', 'Since the donor is below 18 years old, parent or guardian consent is required before hair donation submission.');
  }

  if (normalized.includes('complete your donor profile') || normalized.includes('birthdate')) {
    return createErrorState('Profile Incomplete', 'Please complete your donor profile, including birthdate, before continuing.');
  }

  if (normalized.includes('create the hair submission')) {
    return createErrorState('Hair Log Could Not Start', 'The hair check record could not be created right now. Please try again.');
  }

  if (normalized.includes('save the donor-confirmed hair details')) {
    return createErrorState('Details Could Not Be Saved', 'The analyzed hair details could not be saved right now. Please try again.');
  }

  if (normalized.includes('failed to upload one of the selected photos')
    || normalized.includes('uploaded image references')
    || normalized.includes('missing its upload source')
    || normalized.includes('failed to read one of the required hair photos before upload')) {
    return createErrorState('Photo Save Failed', 'One of the required hair photos could not be attached to the submission. Please retake or upload that image again and try saving.');
  }

  if (normalized.includes('storage bucket') || normalized.includes('bucket not found')) {
    return createErrorState('Photo Storage Unavailable', 'Hair photo storage is not ready right now. Please try again in a moment.');
  }

  if (normalized.includes('selected donation logistics path')) {
    return createErrorState('Hair Check Saved Partially', 'The hair log was saved without donation routing details. You can review donation options later.');
  }

  if (normalized.includes('ai screening result')) {
    return createErrorState('Screening Result Could Not Be Saved', 'The AI screening result could not be linked to your hair log right now. Please try again.');
  }

  return createErrorState('Unable To Save Hair Check', 'Your hair check was not saved yet. Please try again.');
};

const buildPhotoRecord = (asset, slotIndex, sourceType = 'upload', metadata = {}) => {
  if (!asset?.uri || !asset?.base64) return null;

  const view = hairAnalysisRequiredViews[slotIndex];
  return {
    id: asset.assetId || `${asset.uri}-${view?.key || slotIndex}`,
    uri: asset.uri,
    base64: asset.base64,
    mimeType: asset.mimeType || 'image/jpeg',
    width: asset.width,
    height: asset.height,
    dataUrl: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`,
    viewKey: view?.key || `view_${slotIndex + 1}`,
    viewLabel: view?.label || `View ${slotIndex + 1}`,
    file: asset.file || null,
    fileName: asset.fileName || asset.file?.name || '',
    sourceType,
    capturedAt: metadata.capturedAt || asset.capturedAt || asset.photoValidation?.capturedAt || null,
    captureSessionId: metadata.captureSessionId || asset.captureSessionId || null,
    photoValidation: metadata.photoValidation || asset.photoValidation || null,
  };
};

const normalizeCorrectedDetailsForAnalysis = (correctedDetails = null) => {
  if (!correctedDetails) return null;

  const lengthValue = Number(correctedDetails.correctedLengthValue);
  const lengthUnit = String(correctedDetails.correctedLengthUnit || 'in').trim().toLowerCase();
  const normalizedLengthCm = Number.isFinite(lengthValue)
    ? (lengthUnit === 'in' ? lengthValue * 2.54 : lengthValue)
    : null;

  return {
    length_value: Number.isFinite(lengthValue) ? lengthValue : null,
    length_unit: lengthUnit === 'in' ? 'in' : 'cm',
    normalized_length_cm: Number.isFinite(normalizedLengthCm) ? Number(normalizedLengthCm.toFixed(2)) : null,
    texture: correctedDetails.correctedTexture || '',
    density: correctedDetails.correctedDensity || '',
  };
};

export const useDonorHairSubmission = ({ userId, databaseUserId = null }) => {
  const [photos, setPhotos] = useState(createEmptyPhotoSlots);
  const [analysis, setAnalysis] = useState(null);
  const [analyzerContext, setAnalyzerContext] = useState({
    donationRequirement: null,
    logisticsSettings: null,
    upcomingHaircutSchedules: [],
    latestHaircutReservation: null,
    latestCertificate: null,
    latestSubmission: null,
    latestSubmissionDetail: null,
  });
  const [isPickingImages, setIsPickingImages] = useState(false);
  const [isCapturingImages, setIsCapturingImages] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const latestAnalysisRequestRef = useRef(0);
  const activeAnalysisRequestRef = useRef(null);
  const activeSaveRequestRef = useRef(null);
  const latestSaveRequestRef = useRef(0);

  const completedPhotoCount = useMemo(
    () => photos.filter(Boolean).length,
    [photos]
  );
  const hasCompletePhotoSet = completedPhotoCount === MAX_PHOTO_COUNT;
  const canAnalyze = hasCompletePhotoSet && !isAnalyzing;

  const guardDonationPermission = async () => {
    const permission = await canSubmitHairDonation(databaseUserId || userId);
    if (permission.allowed) return true;

    const mappedError = createErrorState(
      permission.reason === 'GUARDIAN_CONSENT_REQUIRED' ? 'Guardian Consent Required' : 'Profile Incomplete',
      mapDonationPermissionError(permission.reason),
      { reason: permission.reason }
    );
    setError(mappedError);
    return false;
  };

  const progressLabel = useMemo(() => {
    if (isSaving) return 'Saving your hair log';
    if (isAnalyzing) return 'Running AI analysis';
    if (analysis) return 'Review AI result';
    if (hasCompletePhotoSet) return 'Ready for AI analysis';
    if (completedPhotoCount) return `${MAX_PHOTO_COUNT - completedPhotoCount} more view${MAX_PHOTO_COUNT - completedPhotoCount === 1 ? '' : 's'} needed`;
    return 'Begin photo capture';
  }, [analysis, completedPhotoCount, hasCompletePhotoSet, isAnalyzing, isSaving]);

  const refreshContext = useCallback(async ({ silent = false } = {}) => {
    const contextUserId = databaseUserId || userId;
    if (!contextUserId) return null;

    if (!silent) setIsLoadingContext(true);
    try {
      const result = await getHairDonationModuleContext(contextUserId);

      setAnalyzerContext({
        donationRequirement: result.donationRequirement,
        logisticsSettings: result.logisticsSettings,
        upcomingHaircutSchedules: result.upcomingHaircutSchedules || [],
        latestHaircutReservation: result.latestHaircutReservation,
        latestCertificate: result.latestCertificate,
        latestSubmission: result.latestSubmission,
        latestSubmissionDetail: result.latestSubmissionDetail,
      });

      logAppEvent('donor_hair_submission.context', 'Hair analyzer context loaded.', {
        userId,
        databaseUserId,
        hasDonationRequirement: Boolean(result.donationRequirement?.donation_requirement_id),
        hasLogisticsDestination: Boolean(result.logisticsSettings?.destination_name),
        haircutScheduleCount: Array.isArray(result.upcomingHaircutSchedules) ? result.upcomingHaircutSchedules.length : 0,
        latestSubmissionId: result.latestSubmission?.submission_id || null,
        latestSubmissionDetailId: result.latestSubmissionDetail?.submission_detail_id || null,
        hasError: Boolean(result.error),
      });
      return result;
    } finally {
      if (!silent) setIsLoadingContext(false);
    }
  }, [databaseUserId, userId]);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  const setPhotoAtSlot = (slotIndex, photo) => {
    const invalidatedRequestId = activeAnalysisRequestRef.current;
    if (invalidatedRequestId) {
      latestAnalysisRequestRef.current = Math.max(latestAnalysisRequestRef.current, invalidatedRequestId + 1);
      activeAnalysisRequestRef.current = null;
      setIsAnalyzing(false);
    }

    logAppEvent('donor_hair_submission.photo_slot_state', 'Hair photo slot updated.', {
      userId,
      slotIndex,
      viewKey: photo?.viewKey || hairAnalysisRequiredViews[slotIndex]?.key || null,
      sourceType: photo?.sourceType || null,
      hasPhoto: Boolean(photo?.uri),
      invalidatedAnalysisRequestId: invalidatedRequestId || null,
    });

    setPhotos((current) => {
      const next = [...current];
      next[slotIndex] = photo;
      return next;
    });
    setAnalysis(null);
    setError(null);
    setSuccessMessage('');
  };

  const savePhotoAssetForSlot = async (slotIndex, asset, sourceType = 'upload', metadata = {}) => {
    const preparedAsset = await normalizeAssetForHairAnalysis(asset);
    const normalizedPhoto = buildPhotoRecord(preparedAsset, slotIndex, sourceType, metadata);

    if (!normalizedPhoto) {
      const mappedError = createErrorState('Photos Could Not Be Read', 'Please choose a clear image file again. The selected photo could not be processed.');
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    setPhotoAtSlot(slotIndex, normalizedPhoto);
    logAppEvent('donor_hair_submission.photo_slot', 'Hair photo saved for slot.', {
      userId,
      slotIndex,
      viewKey: normalizedPhoto.viewKey,
      sourceType,
    });

    return { success: true, photo: normalizedPhoto };
  };

  const pickPhotoForSlot = async (slotIndex) => {
    try {
      const hasPermission = await guardDonationPermission();
      if (!hasPermission) return { success: false, error: 'Donation permission is required before uploading hair photos.' };

      setError(null);
      setSuccessMessage('');
      setIsPickingImages(true);

      logAppEvent('donor_hair_submission.photo_picker', 'Upload button pressed for hair photo slot.', {
        userId,
        slotIndex,
        viewKey: hairAnalysisRequiredViews[slotIndex]?.key || null,
      });

      if (Platform.OS !== 'android') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        logAppEvent('donor_hair_submission.photo_picker', 'Upload permission resolved for hair photo slot.', {
          userId,
          slotIndex,
          granted: permission.granted,
        });

        if (!permission.granted) {
          throw new Error('Please allow photo library access to upload hair images.');
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        quality: 1,
        base64: true,
        selectionLimit: 1,
      });

      setIsPickingImages(false);
      if (result.canceled) {
        return { success: false, canceled: true };
      }

      logAppEvent('donor_hair_submission.photo_picker', 'Upload handler received image for hair photo slot.', {
        userId,
        slotIndex,
        hasAsset: Boolean(result.assets?.[0]?.uri),
      });

      const saveResult = await savePhotoAssetForSlot(slotIndex, result.assets?.[0], 'upload');
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Unable to read the selected hair images.');
      }

      return saveResult;
    } catch (pickedError) {
      setIsPickingImages(false);
      const mappedError = mapImagePickerError(pickedError.message);
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }
  };

  const capturePhotoForSlot = async (slotIndex) => {
    try {
      const hasPermission = await guardDonationPermission();
      if (!hasPermission) return { success: false, error: 'Donation permission is required before capturing hair photos.' };

      setError(null);
      setSuccessMessage('');
      setIsCapturingImages(true);

      logAppEvent('donor_hair_submission.photo_camera', 'Capture button pressed for hair photo slot.', {
        userId,
        slotIndex,
        viewKey: hairAnalysisRequiredViews[slotIndex]?.key || null,
        platform: Platform.OS,
      });

      const permission = await ImagePicker.requestCameraPermissionsAsync();
      logAppEvent('donor_hair_submission.photo_camera', 'Camera permission resolved for hair photo slot.', {
        userId,
        slotIndex,
        granted: permission.granted,
      });

      if (!permission.granted) {
        throw new Error('Please allow camera access to take guided hair photos.');
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        quality: 1,
        base64: true,
        cameraType: ImagePicker.CameraType.back,
      });

      setIsCapturingImages(false);
      if (result.canceled) {
        return { success: false, canceled: true };
      }

      logAppEvent('donor_hair_submission.photo_camera', 'Camera handler received image for hair photo slot.', {
        userId,
        slotIndex,
        hasAsset: Boolean(result.assets?.[0]?.uri),
      });

      const saveResult = await savePhotoAssetForSlot(slotIndex, result.assets?.[0], 'capture');
      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Unable to read the selected hair images.');
      }

      return saveResult;
    } catch (captureError) {
      setIsCapturingImages(false);
      const mappedError = mapImagePickerError(captureError.message);
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }
  };

  const removePhoto = (slotIndex) => {
    const invalidatedRequestId = activeAnalysisRequestRef.current;
    if (invalidatedRequestId) {
      latestAnalysisRequestRef.current = Math.max(latestAnalysisRequestRef.current, invalidatedRequestId + 1);
      activeAnalysisRequestRef.current = null;
      setIsAnalyzing(false);
    }

    setPhotos((current) => {
      const next = [...current];
      next[slotIndex] = null;
      return next;
    });
    setAnalysis(null);
    setError(null);
    setSuccessMessage('');
  };

  const analyzePhotos = async ({
    questionnaireAnswers,
    complianceContext,
    historyContext = null,
    correctedDetails = null,
    allowPhotoQualityFallback = false,
  } = {}) => {
    const hasPermission = await guardDonationPermission();
    if (!hasPermission) return { success: false, error: 'Donation permission is required before AI screening.' };

    const readyPhotos = photos.filter(Boolean);

    if (readyPhotos.length < MAX_PHOTO_COUNT) {
      const missingViews = hairAnalysisRequiredViews
        .filter((_view, index) => !photos[index])
        .map((view) => view.label)
        .join(', ');

      const mappedError = createErrorState(
        'More Hair Views Needed',
        `Please add these required hair views before analysis: ${missingViews}.`
      );
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    if (activeAnalysisRequestRef.current) {
      logAppEvent('donor_hair_submission.analysis', 'Duplicate donor hair analysis request ignored while another request is running.', {
        userId,
        activeRequestId: activeAnalysisRequestRef.current,
      }, 'info');
      return {
        success: false,
        pending: true,
        skipped: true,
      };
    }

    const requestId = latestAnalysisRequestRef.current + 1;
    latestAnalysisRequestRef.current = requestId;
    activeAnalysisRequestRef.current = requestId;

    setIsAnalyzing(true);
    setAnalysis(null);
    setError(null);
    setSuccessMessage('');

    logAppEvent('donor_hair_submission.analysis', 'Stale-result prevention cleared the previous donor hair analysis before the new OpenAI request.', {
      userId,
      requestId,
      hadPreviousAnalysis: Boolean(analysis),
    });

    logAppEvent('donor_hair_submission.analysis', 'Fresh donor hair analysis request started.', {
      userId,
      requestId,
      photoCount: readyPhotos.length,
      questionKeys: Object.keys(questionnaireAnswers || {}),
      hasHistoryContext: Boolean(historyContext?.entries?.length),
      hasCorrectedDetails: Boolean(correctedDetails),
      allowPhotoQualityFallback: Boolean(allowPhotoQualityFallback),
    });

    const normalizedHistoryContext = questionnaireAnswers?.questionnaireMode === 'returning_follow_up'
      ? historyContext
      : null;
    const normalizedCorrectedDetails = normalizeCorrectedDetailsForAnalysis(correctedDetails);

    logAppEvent('donor_hair_submission.analysis', 'Normalized image payload built for donor hair analysis.', {
      userId,
      imageCount: readyPhotos.length,
      imageViews: readyPhotos.map((photo) => photo?.viewLabel || photo?.viewKey || null).filter(Boolean),
      mimeTypes: readyPhotos.map((photo) => photo?.mimeType || '').filter(Boolean),
      sourceTypes: readyPhotos.map((photo) => photo?.sourceType || '').filter(Boolean),
      hasDonationRequirementContext: Boolean(analyzerContext.donationRequirement?.donation_requirement_id),
      hasHistoryContext: Boolean(normalizedHistoryContext?.entries?.length),
      hasCorrectedDetails: Boolean(normalizedCorrectedDetails),
      complianceAcknowledged: Boolean(complianceContext?.acknowledged),
      allowPhotoQualityFallback: Boolean(allowPhotoQualityFallback),
    });

    let result;
    try {
      result = await analyzeHairPhotos({
        images: readyPhotos,
        questionnaireAnswers,
        complianceContext,
        donationRequirementContext: analyzerContext.donationRequirement,
        submissionContext: null,
        historyContext: normalizedHistoryContext,
        correctedDetails: normalizedCorrectedDetails,
        allowPhotoQualityFallback,
      });
    } catch (analysisError) {
      if (latestAnalysisRequestRef.current !== requestId || activeAnalysisRequestRef.current !== requestId) {
        logAppEvent('donor_hair_submission.analysis', 'Late donor hair analysis exception ignored after a newer request started.', {
          userId,
          requestId,
          latestRequestId: latestAnalysisRequestRef.current,
          message: analysisError?.message || 'Unknown analysis error.',
        }, 'info');
        return { success: false, stale: true, skipped: true };
      }

      activeAnalysisRequestRef.current = null;
      setIsAnalyzing(false);
      const mappedError = mapAnalysisError(analysisError?.message || 'Hair analysis could not start right now. Please try again.');
      setAnalysis(null);
      setError(mappedError);
      logAppEvent('donor_hair_submission.analysis', 'Donor hair analysis request crashed before returning a result.', {
        userId,
        requestId,
        errorTitle: mappedError.title,
        errorMessage: mappedError.message,
      }, 'error');
      return { success: false, error: mappedError.message, mappedError };
    }

    if (latestAnalysisRequestRef.current !== requestId || activeAnalysisRequestRef.current !== requestId) {
      logAppEvent('donor_hair_submission.analysis', 'Late donor hair analysis response ignored after a newer request started.', {
        userId,
        requestId,
        latestRequestId: latestAnalysisRequestRef.current,
      }, 'info');
      return { success: false, stale: true, skipped: true };
    }

    if (!result || typeof result !== 'object') {
      result = { error: 'Hair analysis response was incomplete. Please try analyzing the photos again.' };
    }

    activeAnalysisRequestRef.current = null;
    setIsAnalyzing(false);

    if (result.error) {
      setAnalysis(null);
      const mappedError = mapAnalysisError(result.error, {
        errorType: result.errorType || null,
        retryAfterSeconds: result.retryAfterSeconds ?? null,
        edgeFunctionInvoked: result.edgeFunctionInvoked ?? null,
        providerRequestAttempted: result.providerRequestAttempted ?? null,
        providerResponseStatus: result.providerResponseStatus ?? null,
      });
      setError(mappedError);
      const isPhotoQualityError = String(result.errorType || '').trim().toLowerCase() === 'photo_quality';
      logAppEvent('donor_hair_submission.analysis', 'Donor hair analysis request failed.', {
        userId,
        requestId,
        errorTitle: mappedError.title,
        errorMessage: mappedError.message,
        edgeFunctionInvoked: result.edgeFunctionInvoked ?? null,
        providerRequestAttempted: result.providerRequestAttempted ?? null,
        providerResponseStatus: result.providerResponseStatus ?? null,
      }, isPhotoQualityError ? 'info' : 'warn');
      return { success: false, error: mappedError.message, mappedError };
    }

    setAnalysis(result.analysis);
    setError(null);
    logAppEvent('donor_hair_submission.analysis', 'Hair analysis ready for rendering.', {
      userId,
      requestId,
      screeningIntent: questionnaireAnswers?.screeningIntent || null,
      analysisKeys: result.analysis ? Object.keys(result.analysis) : [],
      renderKeys: [
        'estimated_length',
        'length_assessment',
        'detected_color',
        'detected_texture',
        'detected_density',
        'detected_condition',
        'visible_damage_notes',
        'confidence_score',
        'bald_spots_present',
        'affected_regions',
        'hair_density_score',
        'shedding_level',
        'visible_scalp_area',
        'scalp_coverage_notes',
        'improvement_tracking_status',
        'improvement_recommendation',
        'decision',
        'summary',
        'recommendations',
      ],
    });

    return { success: true, analysis: result.analysis };
  };

  const clearAnalysisError = useCallback(() => {
    setError(null);
  }, []);

  const submitSubmission = async (confirmedValues, options = {}) => {
    if (activeSaveRequestRef.current) {
      logAppEvent('donor_hair_submission.save', 'Duplicate hair submission save ignored while another save is running.', {
        userId,
        activeSaveRequestId: activeSaveRequestRef.current,
      }, 'info');
      return {
        success: false,
        pending: true,
        skipped: true,
      };
    }

    const saveRequestId = latestSaveRequestRef.current + 1;
    latestSaveRequestRef.current = saveRequestId;
    activeSaveRequestRef.current = saveRequestId;

    setIsSaving(true);
    setError(null);
    setSuccessMessage('');

    logAppEvent('donor_hair_submission.save', 'Hair check save started from AI result step.', {
      userId,
      databaseUserId,
      saveRequestId,
      photoCount: photos.filter(Boolean).length,
      hasAnalysis: Boolean(analysis),
      donationModeValue: options.donationModeValue || '',
      confirmedValueKeys: Object.keys(confirmedValues || {}),
    });

    const analysisForSave = options.aiAnalysisOverride || analysis;

    let result;
    try {
      result = await saveHairSubmissionFlow({
        userId,
        databaseUserId,
        photos: photos.filter(Boolean),
        aiAnalysis: analysisForSave,
        confirmedValues,
        questionnaireAnswers: options.questionnaireAnswers,
        donationModeValue: options.donationModeValue || '',
        logisticsSettings: analyzerContext.logisticsSettings,
      });
    } finally {
      if (activeSaveRequestRef.current === saveRequestId) {
        activeSaveRequestRef.current = null;
      }
      setIsSaving(false);
    }

    if (latestSaveRequestRef.current !== saveRequestId) {
      logAppEvent('donor_hair_submission.save', 'Late hair submission save response ignored after a newer save request.', {
        userId,
        saveRequestId,
        latestSaveRequestId: latestSaveRequestRef.current,
      }, 'info');
      return { success: false, stale: true, skipped: true };
    }

    if (result.error) {
      logAppEvent('donor_hair_submission.save', 'Hair check save failed in hook.', {
        userId,
        saveRequestId,
        message: result.error,
      }, 'error');

      const mappedError = mapSaveError(result.error);
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    logAppEvent('donor_hair_submission.save', 'Hair check save completed in hook.', {
      userId,
      saveRequestId,
      submissionId: result.submission?.submission_id || null,
    });

    setSuccessMessage(
      result.submission?.donation_reference
        ? `Hair check saved. Attach the QR label for ${result.submission.donation_reference} to your parcel before shipment.`
        : 'Hair check saved successfully. Your AI result is now added to your hair log.'
    );
    setPhotos(createEmptyPhotoSlots());
    setAnalysis(null);
    return { success: true, submission: result.submission };
  };

  const resetFlow = () => {
    setPhotos(createEmptyPhotoSlots());
    setAnalysis(null);
    setError(null);
    setSuccessMessage('');
  };

  return {
    photos,
    requiredViews: hairAnalysisRequiredViews,
    analysis,
    donationRequirement: analyzerContext.donationRequirement,
    logisticsSettings: analyzerContext.logisticsSettings,
    upcomingHaircutSchedules: analyzerContext.upcomingHaircutSchedules,
    latestHaircutReservation: analyzerContext.latestHaircutReservation,
    latestCertificate: analyzerContext.latestCertificate,
    latestSubmission: analyzerContext.latestSubmission,
    latestSubmissionDetail: analyzerContext.latestSubmissionDetail,
    error,
    successMessage,
    isLoadingContext,
    isPickingImages,
    isCapturingImages,
    isAnalyzing,
    isSaving,
    canAnalyze,
    completedPhotoCount,
    progressLabel,
    pickPhotoForSlot,
    capturePhotoForSlot,
    savePhotoAssetForSlot,
    removePhoto,
    analyzePhotos,
    submitSubmission,
    resetFlow,
    clearAnalysisError,
    refreshContext,
  };
};
