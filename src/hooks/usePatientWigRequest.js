import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  cancelPatientWigRequest,
  getActiveWigTryOnFilters,
  getPatientWigRequestContext,
  getWigPreferenceOptions,
  savePatientWigRequestFlow,
} from '../features/wigRequest.service';
import { detectWigHeadFrame } from '../features/wigHeadDetection.service';
import { generatePatientWigPreview } from '../features/wigGeneration.service';
import { createAppError, getErrorMessage, logAppError, logAppEvent } from '../utils/appErrors';

const IMAGE_MEDIA_TYPES = ['images'];
const PREVIEW_IMAGE_MAX_SIZE = 768;
const PREVIEW_IMAGE_QUALITY = 0.48;

const FRONT_PHOTO_REQUIRED_ERROR = createAppError(
  'Front Photo Required',
  'Add one clear front photo first so we can suggest a wig for your request.'
);

const COMPLETED_REQUEST_TOKENS = ['completed', 'claimed', 'released', 'cancelled', 'canceled', 'rejected', 'closed'];

const isOngoingWigRequest = (request) => {
  if (!request?.req_id) return false;
  const status = String(request.status || '').trim().toLowerCase();
  if (!status) return true;
  return !COMPLETED_REQUEST_TOKENS.some((token) => status.includes(token));
};

const mapPatientWigRequestError = (type, error) => {
  const resolvedMessage = getErrorMessage(error);
  const message = resolvedMessage.toLowerCase();

  if (type === 'context') {
    if (message.includes('session has expired') || message.includes('session changed') || message.includes('sign in again')) {
      return createAppError(
        'Session Expired',
        'Please sign in again before requesting a wig preview.'
      );
    }

    return createAppError(
      'Unable To Load Request',
      'We could not load your wig request details right now. Please try again.'
    );
  }

  if (type === 'picker') {
    if (message.includes('photo library access')) {
      return createAppError(
        'Photo Access Needed',
        'Allow photo library access first so you can upload your front photo.'
      );
    }

    if (message.includes('read the selected front photo')) {
      return createAppError(
        'Photo Could Not Be Read',
        'Please choose the front photo again.'
      );
    }

    return createAppError(
      'Unable To Add Photo',
      'We could not attach that front photo right now. Please try again.'
    );
  }

  if (type === 'capture') {
    return createAppError(
      'Camera Photo Unavailable',
      'We could not save that front photo. Please take it again.'
    );
  }

  if (type === 'preview') {
    if (message.includes('front photo')) {
      return createAppError(
        'Front Photo Required',
        'Please upload a clear front photo first.'
      );
    }

    if (message.includes('sign in again') || message.includes('session has expired')) {
      return createAppError(
        'Session Expired',
        'Please sign in again to continue the wig preview.'
      );
    }

    if (message.includes('not configured') || message.includes('api key')) {
      return createAppError(
        'AI Configuration Required',
        'The OpenAI wig preview service is not configured correctly on the server.'
      );
    }

    if (message.includes('three active wigs') || message.includes('valid reference images')) {
      return createAppError(
        'Wigs Unavailable',
        'At least three active wigs with valid reference images are required.'
      );
    }

    return createAppError(
      'AI Preview Error',
      resolvedMessage || 'Preview could not be generated right now.'
    );
  }

  if (type === 'save') {
    if (message.includes('sign in again') || message.includes('session') || message.includes('authenticated')) {
      return createAppError(
        'Session Expired',
        'Please sign in again before submitting your wig request.'
      );
    }

    return createAppError(
      'Unable To Save Request',
      'Your wig request was not saved yet. Please review the details and try again.'
    );
  }

  if (type === 'cancel') {
    if (message.includes('no longer') || message.includes('active')) {
      return createAppError(
        'Request Already In Review',
        'This request can no longer be cancelled.'
      );
    }

    return createAppError(
      'Unable To Cancel Request',
      'Please try again.'
    );
  }

  return createAppError(
    'Something Went Wrong',
    'Please try again.'
  );
};

const buildResizeAction = ({ width, height, maxSize }) => {
  const resolvedWidth = Number(width || 0);
  const resolvedHeight = Number(height || 0);

  if (!resolvedWidth || !resolvedHeight) return [];

  const scale = Math.min(1, maxSize / Math.max(resolvedWidth, resolvedHeight));
  if (scale >= 1) return [];

  return [{
    resize: {
      width: Math.max(1, Math.round(resolvedWidth * scale)),
      height: Math.max(1, Math.round(resolvedHeight * scale)),
    },
  }];
};

const prepareFrontPhotoAsset = async (asset) => {
  if (!asset?.uri) return null;

  const normalizedAsset = await manipulateAsync(
    asset.uri,
    buildResizeAction({
      width: asset.width,
      height: asset.height,
      maxSize: PREVIEW_IMAGE_MAX_SIZE,
    }),
    {
      compress: PREVIEW_IMAGE_QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    }
  );

  if (!normalizedAsset?.uri || !normalizedAsset?.base64) return null;

  return {
    ...asset,
    uri: normalizedAsset.uri,
    base64: normalizedAsset.base64,
    dataUrl: `data:image/jpeg;base64,${normalizedAsset.base64}`,
    mimeType: 'image/jpeg',
    width: normalizedAsset.width || asset.width,
    height: normalizedAsset.height || asset.height,
  };
};

const normalizeFrontPhotoAsset = (asset) => {
  if (!asset?.uri || !asset?.base64) return null;

  return {
    id: asset.assetId || asset.uri,
    uri: asset.uri,
    mimeType: asset.mimeType || 'image/jpeg',
    width: asset.width,
    height: asset.height,
    dataUrl: `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`,
    sourceType: asset.sourceType || 'upload',
    placement: asset.placement || null,
  };
};

const attachDetectedWigPlacement = async (photo) => {
  if (!photo?.dataUrl || !photo?.width || !photo?.height) return photo;

  const detection = await detectWigHeadFrame(photo);
  if (!detection?.placement?.faceFrame) {
    return photo;
  }

  return {
    ...photo,
    placement: detection.placement,
  };
};

const buildStoredFrontPhoto = (uri, requestId) => (
  uri
    ? {
        id: `stored-front-photo-${requestId || 'latest'}`,
        uri,
        mimeType: 'image/jpeg',
        sourceType: 'stored',
      }
    : null
);

const buildStoredPreview = (specification, wigRequest) => {
  const hasStoredGuidance = Boolean(
    specification?.style_preference
    || specification?.preferred_length
    || specification?.preferred_color
    || specification?.notes
    || wigRequest?.notes
    || specification?.ai_wig_preview_url
  );

  if (!hasStoredGuidance) {
    return null;
  }

  const summaryParts = [
    wigRequest?.notes || '',
    specification?.notes || '',
  ].filter(Boolean);

  return {
    summary: summaryParts.join('\n\n') || 'Saved wig.',
    style_notes: specification?.notes || '',
    recommended_style_name: specification?.style_preference || 'Saved wig',
    recommended_style_family: specification?.preferred_length || 'Saved wig',
    preview_url: specification?.ai_wig_preview_url || '',
    generated_image_data_url: specification?.ai_wig_preview_url || '',
    options: [],
  };
};

const buildSelectedPreview = (preview, selectedOptionId) => {
  if (!preview) return null;

  const options = Array.isArray(preview?.options) ? preview.options : [];
  const selectedOption = options.find((option) => option.id === selectedOptionId) || options[0] || null;

  if (!selectedOption) {
    return preview;
  }

  return {
    ...preview,
    summary: selectedOption.summary || selectedOption.note || preview.summary || '',
    style_notes: selectedOption.style_notes || selectedOption.note || preview.style_notes || '',
    recommended_style_name: selectedOption.name || preview.recommended_style_name || '',
    recommended_style_family: selectedOption.family || preview.recommended_style_family || '',
    preview_url: selectedOption.preview_url || selectedOption.generated_image_data_url || preview.preview_url || preview.generated_image_data_url || '',
    generated_image_data_url: selectedOption.generated_image_data_url || selectedOption.preview_url || preview.generated_image_data_url || preview.preview_url || '',
    selected_wig: selectedOption.selected_wig || preview.selected_wig || null,
    suitability_reason: selectedOption.suitability_reason || selectedOption.note || '',
    selected_option_id: selectedOption.id || '',
    selected_option_index: selectedOption.option_index || null,
    options,
  };
};

export const usePatientWigRequest = ({ userId }) => {
  const [referenceImage, setReferenceImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [context, setContext] = useState({
    patientDetails: null,
    latestAllocation: null,
    latestWigRequest: null,
    latestWigSpecification: null,
    requestHospital: null,
    requestWig: null,
    latestReleaseSchedule: null,
    safetyAssessment: null,
  });
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isPickingReference, setIsPickingReference] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isSavingRequest, setIsSavingRequest] = useState(false);
  const [isCancellingRequest, setIsCancellingRequest] = useState(false);
  const [availableWigs, setAvailableWigs] = useState([]);
  const [isLoadingAvailableWigs, setIsLoadingAvailableWigs] = useState(false);
  const [wigPreferenceOptions, setWigPreferenceOptions] = useState({
    lengths: [],
    colors: [],
    textures: [],
    densities: [],
    capSizes: [],
    styles: [],
  });
  const [isLoadingWigPreferenceOptions, setIsLoadingWigPreferenceOptions] = useState(false);
  const [, setRequestedSavedPreviewId] = useState(null);

  const hasSubmittedRequest = isOngoingWigRequest(context.latestWigRequest);

  const progressLabel = useMemo(() => {
    if (isSavingRequest) return 'Submitting wig request';
    if (isGeneratingPreview) return hasSubmittedRequest ? 'Refreshing wig suggestion' : 'Generating wig suggestion';
    if (hasSubmittedRequest) return 'Wig request submitted';
    if (preview) return 'Review wig suggestion';
    return 'Start a wig request';
  }, [hasSubmittedRequest, isGeneratingPreview, isSavingRequest, preview]);

  const refreshContext = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setIsLoadingContext(true);
    }
    setError(null);

    const result = await getPatientWigRequestContext(userId);

    if (!silent) {
      setIsLoadingContext(false);
    }
    setContext({
      patientDetails: result.patientDetails,
      latestAllocation: result.latestAllocation,
      latestWigRequest: result.latestWigRequest,
      latestWigSpecification: result.latestWigSpecification,
      requestHospital: result.requestHospital,
      requestWig: result.requestWig,
      latestReleaseSchedule: result.latestReleaseSchedule,
      safetyAssessment: result.safetyAssessment,
    });

    if (isOngoingWigRequest(result.latestWigRequest) && result.latestWigSpecification?.patient_picture) {
      const storedFrontPhoto = buildStoredFrontPhoto(
        result.latestWigSpecification.patient_picture,
        result.latestWigRequest.req_id
      );

      setReferenceImage((current) => {
        if (current?.dataUrl) return current;
        if (current?.uri === storedFrontPhoto?.uri) return current;
        return storedFrontPhoto;
      });
    } else if (!isOngoingWigRequest(result.latestWigRequest)) {
      setReferenceImage(null);
    }

    const storedPreview = isOngoingWigRequest(result.latestWigRequest)
      ? buildStoredPreview(result.latestWigSpecification, result.latestWigRequest)
      : null;
    if (storedPreview) {
      setPreview((current) => current || storedPreview);
    } else if (!isOngoingWigRequest(result.latestWigRequest)) {
      setPreview(null);
    }

    if (result.error) {
      logAppError('patientWigRequest.refreshContext', result.error, { userId });
      const mappedError = mapPatientWigRequestError('context', result.error);
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    return { success: true };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    refreshContext();
  }, [refreshContext, userId]);

  const refreshAvailableWigs = useCallback(async () => {
    setIsLoadingAvailableWigs(true);

    const result = await getActiveWigTryOnFilters();
    setAvailableWigs(result.wigs || []);
    setIsLoadingAvailableWigs(false);

    if (result.error) {
      logAppError('patientWigRequest.refreshAvailableWigs', result.error, { userId });
    }

    return { success: !result.error, wigs: result.wigs || [], error: result.error };
  }, [userId]);

  useEffect(() => {
    refreshAvailableWigs();
  }, [refreshAvailableWigs]);

  const refreshWigPreferenceOptions = useCallback(async () => {
    setIsLoadingWigPreferenceOptions(true);

    const result = await getWigPreferenceOptions();
    setWigPreferenceOptions(result.options || {
      lengths: [],
      colors: [],
      textures: [],
      densities: [],
      capSizes: [],
      styles: [],
    });
    setIsLoadingWigPreferenceOptions(false);

    if (result.error) {
      logAppError('patientWigRequest.refreshWigPreferenceOptions', result.error, { userId });
    }

    return { success: !result.error, options: result.options || {}, error: result.error };
  }, [userId]);

  useEffect(() => {
    refreshWigPreferenceOptions();
  }, [refreshWigPreferenceOptions]);

  useEffect(() => {
    setRequestedSavedPreviewId(null);
  }, [context.latestWigRequest?.req_id]);

  const pickReferenceImage = async () => {
    try {
      setIsPickingReference(true);
      setError(null);
      setSuccessMessage('');

      if (Platform.OS !== 'android') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          throw new Error('Please allow photo library access to attach your front photo.');
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        quality: 0.8,
        base64: true,
        allowsMultipleSelection: false,
      });

      setIsPickingReference(false);
      if (result.canceled) return { success: false, canceled: true };

      const selectedImage = normalizeFrontPhotoAsset(await prepareFrontPhotoAsset({
        ...result.assets?.[0],
        sourceType: 'upload',
      }));
      if (!selectedImage) {
        throw new Error('Unable to read the selected front photo.');
      }

      setReferenceImage(selectedImage);
      setPreview(null);
      return { success: true, image: selectedImage };
    } catch (pickerError) {
      setIsPickingReference(false);
      logAppError('patientWigRequest.pickReferenceImage', pickerError, { userId });
      const mappedError = mapPatientWigRequestError('picker', pickerError);
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }
  };

  const saveCapturedReferenceImage = async (asset, placement = null) => {
    const capturedImage = normalizeFrontPhotoAsset(await prepareFrontPhotoAsset({
      ...asset,
      sourceType: 'camera',
      placement,
    }));

    if (!capturedImage) {
      const mappedError = mapPatientWigRequestError('capture', new Error('Front photo could not be processed.'));
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    setReferenceImage(capturedImage);
    setPreview(null);
    setError(null);
    setSuccessMessage('');
    return { success: true, image: capturedImage };
  };

  const clearReferenceImage = () => {
    setReferenceImage(null);
    setPreview(null);
    setError(null);
    setSuccessMessage('');
  };

  const clearPreview = () => {
    setPreview(null);
    setRequestedSavedPreviewId(null);
    setError(null);
    setSuccessMessage('');
  };

  const generatePreview = async (preferences, selectedWig = null, referenceImageOverride = null) => {
    const sourceReferenceImage = referenceImageOverride || referenceImage;
    if (!sourceReferenceImage?.uri) {
      setError(FRONT_PHOTO_REQUIRED_ERROR);
      return { success: false, error: FRONT_PHOTO_REQUIRED_ERROR.message };
    }

    if (availableWigs.length < 3) {
      const mappedError = createAppError('Wigs Unavailable', 'At least three active wigs are needed for AI recommendations.');
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    setIsGeneratingPreview(true);
    setError(null);
    setSuccessMessage('');

    const preparedReferenceImage = sourceReferenceImage?.placement?.faceFrame
      ? sourceReferenceImage
      : await attachDetectedWigPlacement(sourceReferenceImage);
    if (preparedReferenceImage !== referenceImage) {
      setReferenceImage(preparedReferenceImage);
    }

    const result = await generatePatientWigPreview({
      preferences,
      referenceImage: preparedReferenceImage,
      selectedWig,
      availableWigs,
    });

    setIsGeneratingPreview(false);

    if (result.error || !result.preview) {
      const mappedError = mapPatientWigRequestError('preview', new Error(result.error || 'Preview could not be generated.'));
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    setPreview(result.preview);

    logAppEvent('patient_wig_request.preview', 'Generated ranked AI wig recommendations.', {
      userId,
      selectedWigId: selectedWig?.wig_id || null,
      recommendationCount: result.preview?.options?.length || 0,
      previewKeys: Object.keys(result.preview),
      hasGeneratedImage: Boolean(result.preview?.generated_image_data_url),
    });

    return { success: true, preview: result.preview };
  };

  const regenerateSavedRecommendation = useCallback(async () => {
    const storedPreview = buildStoredPreview(context.latestWigSpecification, context.latestWigRequest);
    if (!storedPreview) return { success: false, error: 'No saved preview.' };
    setPreview(storedPreview);
    return { success: true, preview: storedPreview };
  }, [context.latestWigRequest, context.latestWigSpecification]);

  const saveRequest = async (
    preferences,
    selectedOptionId = '',
    selectedWigId = null,
    previewImage = null
  ) => {
    setIsSavingRequest(true);
    setError(null);
    setSuccessMessage('');

    const selectedPreview = buildSelectedPreview(preview, selectedOptionId);

    logAppEvent('patient_wig_request.save_selection', 'Selected wig preview prepared for saving.', {
      userId,
      selectedOptionId: selectedPreview?.selected_option_id || '',
      selectedOptionIndex: selectedPreview?.selected_option_index || null,
      hasSelectedPreviewImage: Boolean(selectedPreview?.generated_image_data_url || selectedPreview?.preview_url),
      hasCapturedPreviewImage: Boolean(previewImage?.uri),
      hasReferenceImage: Boolean(referenceImage?.uri),
    });

    const result = await savePatientWigRequestFlow({
      userId,
      preferences,
      preview: selectedPreview,
      previewImage,
      referenceImage,
      selectedWigId,
    });

    setIsSavingRequest(false);

    if (result.error) {
      logAppError('patientWigRequest.saveRequest', result.error, { userId });
      const mappedError = mapPatientWigRequestError('save', result.error);
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    setContext((current) => ({
      ...current,
      latestWigRequest: result.wigRequest || current.latestWigRequest,
      latestWigSpecification: result.wigSpecification || current.latestWigSpecification,
      requestWig: selectedWigId ? (current.requestWig || { wig_id: selectedWigId }) : current.requestWig,
    }));
    setSuccessMessage(
      result.alreadyExists
        ? 'You already have a pending request.'
        : 'Wig request submitted successfully. Waiting for organization approval.'
    );
    void refreshContext({ silent: true }).catch((refreshError) => {
      logAppError('patientWigRequest.refreshAfterSave', refreshError, { userId });
    });
    return { success: true, wigRequest: result.wigRequest, alreadyExists: Boolean(result.alreadyExists) };
  };

  const cancelRequest = async () => {
    const wigRequestId = context.latestWigRequest?.req_id || null;
    if (!wigRequestId) {
      const mappedError = mapPatientWigRequestError('cancel', new Error('No active request.'));
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    setIsCancellingRequest(true);
    setError(null);
    setSuccessMessage('');

    const result = await cancelPatientWigRequest({
      userId,
      wigRequestId,
    });

    setIsCancellingRequest(false);

    if (result.error) {
      const mappedError = mapPatientWigRequestError('cancel', result.error);
      setError(mappedError);
      return { success: false, error: mappedError.message };
    }

    setSuccessMessage('Request cancelled.');
    setReferenceImage(null);
    setPreview(null);
    await refreshContext();
    return { success: true, wigRequest: result.wigRequest };
  };

  return {
    patientDetails: context.patientDetails,
    latestAllocation: context.latestAllocation,
    latestWigRequest: context.latestWigRequest,
    latestWigSpecification: context.latestWigSpecification,
    requestHospital: context.requestHospital,
    requestWig: context.requestWig,
    latestReleaseSchedule: context.latestReleaseSchedule,
    safetyAssessment: context.safetyAssessment,
    hasSubmittedRequest,
    referenceImage,
    preview,
    error,
    successMessage,
    isLoadingContext,
    isPickingReference,
    isGeneratingPreview,
    isSavingRequest,
    isCancellingRequest,
    availableWigs,
    isLoadingAvailableWigs,
    wigPreferenceOptions,
    isLoadingWigPreferenceOptions,
    progressLabel,
    pickReferenceImage,
    saveCapturedReferenceImage,
    clearReferenceImage,
    clearPreview,
    generatePreview,
    regenerateSavedRecommendation,
    saveRequest,
    cancelRequest,
    refreshContext,
    refreshAvailableWigs,
    refreshWigPreferenceOptions,
  };
};
