import { invokeEdgeFunction } from '../api/supabase/client';

const normalizeDetectedAccessories = (value = []) => (
  Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : []
);

const buildDetectedMessage = (items = []) => {
  const label = items.length ? items.join(' and ').toLowerCase() : 'an accessory';
  return `We found ${label}. Remove it, then take this photo again.`;
};

const buildPresentationMessage = (issues = []) => {
  if (issues.length) {
    return `${issues.join(' and ')}. Wear your hair loose and fully visible, then take this photo again.`;
  }
  return 'Wear your hair loose and fully visible with no cap, tie, bun, ponytail, or covering, then take this photo again.';
};

export const checkHairCaptureAccessories = async ({ photo, view } = {}) => {
  if (!photo?.dataUrl) {
    return {
      ok: false,
      blocked: false,
      retryable: true,
      title: 'Photo Check Unavailable',
      message: 'We could not check this photo. Please try again.',
      detectedAccessories: [],
    };
  }

  const result = await invokeEdgeFunction('validate-hair-capture-accessories', {
    body: {
      image: {
        dataUrl: photo.dataUrl,
        mimeType: photo.mimeType || 'image/jpeg',
      },
      view: {
        key: view?.key || '',
        label: view?.label || 'Hair photo',
      },
    },
  });

  if (result.error) {
    return {
      ok: false,
      blocked: false,
      retryable: true,
      title: 'Accessory Check Unavailable',
      message: 'We could not check for accessories. Please try again.',
      detectedAccessories: [],
    };
  }

  const check = result.data?.check || {};
  const detectedAccessories = normalizeDetectedAccessories(check.detected_accessories);
  const presentationIssues = normalizeDetectedAccessories(check.presentation_issues);
  const screeningCompleted = check.visual_screening_completed === true;
  const blocked = check.accessory_detected === true || detectedAccessories.length > 0;
  const hasPresentationDecision = typeof check.hair_fully_visible === 'boolean'
    && typeof check.hair_loose_and_down === 'boolean';
  const presentationBlocked = check.hair_fully_visible !== true
    || check.hair_loose_and_down !== true
    || presentationIssues.length > 0;

  if (blocked) {
    return {
      ok: false,
      blocked: true,
      retryable: false,
      title: 'Remove All Accessories',
      message: `${buildDetectedMessage(detectedAccessories)} Wear your hair loose and fully visible.`,
      detectedAccessories,
      presentationIssues,
      confidence: Number(check.confidence || 0),
    };
  }

  if (!screeningCompleted || typeof check.accessory_detected !== 'boolean' || !hasPresentationDecision) {
    return {
      ok: false,
      blocked: false,
      retryable: true,
      title: 'Accessory Check Unavailable',
      message: 'We could not finish checking this photo. Please try again.',
      detectedAccessories: [],
    };
  }

  if (presentationBlocked || check.can_capture !== true) {
    return {
      ok: false,
      blocked: true,
      retryable: false,
      title: 'Show Your Hair Properly',
      message: buildPresentationMessage(presentationIssues),
      detectedAccessories: [],
      presentationIssues,
      confidence: Number(check.confidence || 0),
    };
  }

  return {
    ok: true,
    blocked: false,
    retryable: false,
    title: '',
    message: '',
    detectedAccessories: [],
    confidence: Number(check.confidence || 0),
  };
};
