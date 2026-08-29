import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { DashboardLayout } from './DashboardLayout';
import { AppCard } from '../ui/AppCard';
import { AppButton } from '../ui/AppButton';
import { AppIcon } from '../ui/AppIcon';
import { AppInput } from '../ui/AppInput';
import { StatusBanner } from '../ui/StatusBanner';
import { DonorTabHeader } from '../donor/DonorTabHeader';
import { SectionTitleRow } from '../ui/SectionTitleRow';
import { HairLogDetailModal } from '../hair/HairLogDetailModal';
import { EmptyDataState } from '../ui/EmptyDataState';
import { resolveBrandLogoSource, resolveThemeRoles, theme } from '../../design-system/theme';
import { donorDashboardNavItems } from '../../constants/dashboard';
import { useAuth } from '../../providers/AuthProvider';
import { useNotifications } from '../../hooks/useNotifications';
import { useDonorHairSubmission } from '../../hooks/useDonorHairSubmission';
import { fetchRegisteredDonationDrivesByUserId } from '../../features/donorHome.api';
import {
  fetchHairSubmissionsByUserId,
} from '../../features/hairSubmission.api';
import { invalidateHairAnalysisHomeCache } from '../../features/hairAnalysisHomeCache';
import {
  hairAnalyzerComplianceDefaultValues,
  hairAnalyzerComplianceSchema,
  hairAnalyzerQuestionDefaultValues,
  hairAnalyzerQuestionSchema,
  buildHairReviewDefaultValues,
} from '../../features/hairSubmission.schema';
import { hairAnalyzerQuestionChoices } from '../../features/hairSubmission.constants';
import { buildProfileCompletionMeta } from '../../features/profile/services/profile.service';
import { validateHairPhotosBeforeAnalysis } from '../../features/photoPreflight.service';
import { logAppEvent } from '../../utils/appErrors';
import { resolveEstimatedLengthCm } from '../../utils/hairLength';

let NativeVisionCamera = null;
let NativeFaceCamera = null;
let useNativeCameraDevice = null;
let useNativeFrameProcessor = null;
let useNativeFaceDetector = null;
let NativeWorklets = null;
let nativeVisionCameraLoadError = '';
let nativeFaceCameraLoadError = '';
const isExpoGoRuntime = Constants?.appOwnership === 'expo';

try {
  if (!isExpoGoRuntime) {
    const visionCameraModule = require('react-native-vision-camera');
    NativeVisionCamera = visionCameraModule?.Camera || null;
    useNativeCameraDevice = visionCameraModule?.useCameraDevice || null;
    useNativeFrameProcessor = visionCameraModule?.useFrameProcessor || null;
  }
} catch (_nativeCameraError) {
  NativeVisionCamera = null;
  useNativeCameraDevice = null;
  useNativeFrameProcessor = null;
  nativeVisionCameraLoadError = _nativeCameraError?.message || 'Vision Camera module could not be loaded.';
}

try {
  if (!isExpoGoRuntime) {
    const faceDetectorModule = require('react-native-vision-camera-face-detector');
    NativeFaceCamera = faceDetectorModule?.Camera || null;
    useNativeFaceDetector = faceDetectorModule?.useFaceDetector || null;
  }
} catch (error) {
  NativeFaceCamera = null;
  useNativeFaceDetector = null;
  nativeFaceCameraLoadError = error?.message || 'Face detector module could not be loaded.';
}

if (!NativeFaceCamera && !isExpoGoRuntime) {
  try {
    const faceDetectorCameraModule = require('react-native-vision-camera-face-detector/lib/commonjs/Camera');
    NativeFaceCamera = faceDetectorCameraModule?.Camera || null;
    nativeFaceCameraLoadError = '';
  } catch (error) {
    nativeFaceCameraLoadError = nativeFaceCameraLoadError || error?.message || 'Face detector camera wrapper could not be loaded.';
  }
}

try {
  if (!isExpoGoRuntime) {
    const workletsModule = require('react-native-worklets-core');
    NativeWorklets = workletsModule?.Worklets || null;
  }
} catch (error) {
  NativeWorklets = null;
  nativeFaceCameraLoadError = nativeFaceCameraLoadError || error?.message || 'Worklets Core module could not be loaded.';
}

const HAIR_TEXTURE_REVIEW_OPTIONS = ['Straight', 'Wavy', 'Curly', 'Coily'];
const HAIR_DENSITY_REVIEW_OPTIONS = ['Light', 'Medium', 'Thick', 'Dense'];

const QUESTION_TRANSITION_FADE_MS = 180;

const normalizePhotoReviewText = (value = '') => String(value || '').trim().toLowerCase();

const buildPhotoViewAliases = (view = {}) => {
  const label = normalizePhotoReviewText(view?.label);
  const key = normalizePhotoReviewText(view?.key).replace(/_/g, ' ');
  const aliases = [label, key].filter(Boolean);

  if (label.includes('front')) aliases.push('front view', 'front photo', 'front');
  if (label.includes('left') || label.includes('side profile')) aliases.push('left side', 'side profile');
  if (label.includes('right')) aliases.push('right side');
  if (label.includes('scalp')) aliases.push('scalp', 'crown');
  if (label.includes('ends')) aliases.push('hair ends', 'ends close-up', 'ends close up');
  if (label.includes('back')) aliases.push('back hair', 'back view', 'back photo');

  return aliases.filter(Boolean);
};

const buildRetakeSlotIndexes = ({ validation = null, requiredViews = [] }) => {
  if (!validation || validation.ok !== false) return new Set();

  const details = Array.isArray(validation?.details) ? validation.details : [];
  const combinedText = normalizePhotoReviewText([
    validation?.title,
    validation?.message,
    ...details.flatMap((detail) => [detail?.viewKey, detail?.viewLabel, detail?.error]),
  ].filter(Boolean).join(' '));

  if (
    combinedText.includes('retake all')
    || combinedText.includes('all required views')
    || combinedText.includes('front, left side, right side, scalp, hair ends, and back hair')
    || combinedText.includes('same person')
    || combinedText.includes('same current hair')
    || combinedText.includes('do not match')
  ) {
    return new Set(requiredViews.map((_view, index) => index));
  }

  const retakeIndexes = new Set();
  details.forEach((detail) => {
    const detailText = normalizePhotoReviewText([
      detail?.viewKey,
      detail?.viewLabel,
      detail?.error,
    ].filter(Boolean).join(' '));

    requiredViews.forEach((view, index) => {
      const viewAliases = buildPhotoViewAliases(view);
      if (viewAliases.some((alias) => detailText.includes(alias))) {
        retakeIndexes.add(index);
      }
    });
  });

  if (!details.length) {
    requiredViews.forEach((view, index) => {
      const viewAliases = buildPhotoViewAliases(view);
      if (viewAliases.some((alias) => combinedText.includes(alias))) {
        retakeIndexes.add(index);
      }
    });
  }

  return retakeIndexes;
};

const isAnswered = (question, answers = {}) => {
  const value = answers?.[question?.key];

  if (!question) return false;
  if (question.type === 'multi') return Array.isArray(value) && value.length > 0;
  if (question.type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }

  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
};

const findFirstUnansweredQuestionIndex = (questions = [], answers = {}) => (
  questions.findIndex((question) => !isAnswered(question, answers))
);

const formatLengthLabel = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 'For review';
  const inches = numericValue / 2.54;
  return `${inches.toFixed(1)} inches`;
};

const cmToInches = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
  return numericValue / 2.54;
};

const formatScheduleDateLabel = (dateValue, startTime = '', endTime = '') => {
  if (!dateValue) return 'Schedule to be announced';

  try {
    const formattedDate = new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(dateValue));
    return [formattedDate, startTime && endTime ? `${startTime} to ${endTime}` : ''].filter(Boolean).join(' • ');
  } catch {
    return [dateValue, startTime, endTime].filter(Boolean).join(' • ');
  }
};

void formatScheduleDateLabel;

const isSideProfileView = (view = {}) => String(view?.key || view?.label || '').toLowerCase().includes('side');
const isHairScalpView = (view = {}) => {
  const value = String(view?.key || view?.label || '').toLowerCase();
  return value.includes('scalp') || value.includes('crown');
};

const isHairEndsView = (view = {}) => {
  const value = String(view?.key || view?.label || '').toLowerCase();
  return value.includes('ends');
};

const isBackHairView = (view = {}) => {
  const value = String(view?.key || view?.label || '').toLowerCase();
  return value.includes('back');
};

const requiresFaceVerification = (view = {}) => String(view?.key || view?.label || '').toLowerCase().includes('front')
  || isSideProfileView(view);

const getViewCaptureLabel = (view = {}) => {
  const value = String(view?.key || view?.label || '').toLowerCase();

  if (value.includes('front')) return 'Front view';
  if (value.includes('left') && value.includes('side')) return 'Left side';
  if (value.includes('right') && value.includes('side')) return 'Right side';
  if (value.includes('side')) return 'Side view';
  if (value.includes('scalp') || value.includes('crown')) return 'Hair scalp';
  if (value.includes('ends')) return 'Hair ends';
  if (value.includes('back')) return 'Back hair';
  return 'Hair view';
};

const getInitialLiveFaceStatus = (view = null) => ({
  valid: !requiresFaceVerification(view),
  faceCount: 0,
  message: requiresFaceVerification(view)
    ? isSideProfileView(view)
      ? `Turn to the ${getViewCaptureLabel(view).toLowerCase()} so your hair length is visible.`
      : 'Face the camera directly and keep your hair fully visible.'
    : isHairScalpView(view)
      ? 'Frame the scalp/crown area clearly with bright, even light.'
    : isHairEndsView(view)
      ? 'Frame the hair ends clearly with bright, even light.'
      : isBackHairView(view)
        ? 'Frame the back of your hair clearly with bright, even light.'
        : `Frame the ${getViewCaptureLabel(view).toLowerCase()} clearly with bright, even light.`,
  tone: 'info',
});

const resolveLiveFaceStatus = (faces = [], view = null) => {
  const faceList = Array.isArray(faces) ? faces : [];
  const expectsFace = requiresFaceVerification(view);
  const expectsSideProfile = isSideProfileView(view);
  const viewLabel = getViewCaptureLabel(view);

  if (!faceList.length) {
    if (!expectsFace) {
      return {
        valid: true,
        faceCount: 0,
        message: `${viewLabel} ready. Keep the hair sharp, centered, and well lit.`,
        tone: 'success',
      };
    }

    return {
      valid: false,
      faceCount: 0,
      message: expectsSideProfile
        ? `No ${viewLabel.toLowerCase()} detected. Turn to the ${viewLabel.toLowerCase()} and keep your hair visible.`
        : 'No person detected. Center your face and hair.',
      tone: 'error',
    };
  }

  if (faceList.length > 1) {
    return {
      valid: false,
      faceCount: faceList.length,
      message: 'Multiple subjects detected. Only one person is allowed.',
      tone: 'error',
    };
  }

  const face = faceList[0] || {};
  const bounds = face.bounds || {};
  const width = Number(bounds.width || 0);
  const height = Number(bounds.height || 0);
  const rollAngle = Math.abs(Number(face.rollAngle || 0));
  const yawAngle = Math.abs(Number(face.yawAngle || 0));

  if (!expectsFace) {
    return {
      valid: true,
      faceCount: 1,
      message: `${viewLabel} detected. Keep the hair centered and well lit.`,
      tone: 'success',
    };
  }

  if (width < 90 || height < 90) {
    return {
      valid: false,
      faceCount: 1,
      message: expectsSideProfile
          ? `Move closer so your ${viewLabel.toLowerCase()} and hair length are clearly visible.`
          : 'Move closer so your face and hair are clearly visible.',
      tone: 'warning',
    };
  }

  if (rollAngle > 24) {
    return {
      valid: false,
      faceCount: 1,
      message: 'Keep your head steady and upright for a clearer hair analysis photo.',
      tone: 'warning',
    };
  }

  if (expectsSideProfile) {
    if (yawAngle < 18) {
      return {
        valid: false,
        faceCount: 1,
        message: `Turn your head to the ${viewLabel.toLowerCase()}. This required view should show your hair length.`,
        tone: 'warning',
      };
    }

    return {
      valid: true,
      faceCount: 1,
      message: 'Side profile detected. Keep hair length and ends visible.',
      tone: 'success',
    };
  }

  if (!expectsSideProfile && yawAngle > 34) {
    return {
      valid: false,
      faceCount: 1,
      message: 'Face the camera directly for the front view. Use the next view for your side profile.',
      tone: 'warning',
    };
  }

  return {
    valid: true,
    faceCount: 1,
    message: 'Front view detected. Keep your face and hair centered.',
    tone: 'success',
  };
};

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const buildLiveScanStatus = ({
  autoCaptureEnabled = false,
  brightness = -1,
  completedPhotoCount = 0,
  currentPhoto = null,
  currentView = null,
  isCapturing = false,
  liveFaceStatus = null,
  requiredCount = 1,
}) => {
  const viewLabel = getViewCaptureLabel(currentView);
  const brightnessKnown = Number(brightness) >= 0;
  const brightnessReady = !brightnessKnown || Number(brightness) >= 82;
  const progressBase = requiredCount > 0 ? (completedPhotoCount / requiredCount) * 100 : 0;

  if (currentPhoto?.uri) {
    return {
      conditionLabel: 'Photo ready',
      instruction: 'Photo captured',
      lengthLabel: 'Captured',
      progress: clampPercent(Math.max(72, progressBase)),
      statusLabel: 'Photo ready',
      typeLabel: viewLabel,
    };
  }

  if (isCapturing) {
    return {
      conditionLabel: 'Saving...',
      instruction: 'Capturing automatically...',
      lengthLabel: 'Capturing',
      progress: 100,
      statusLabel: 'Capturing...',
      typeLabel: viewLabel,
    };
  }

  if (autoCaptureEnabled) {
    return {
      conditionLabel: 'Ready',
      instruction: 'Hold still. Auto capture will run now...',
      lengthLabel: 'Ready',
      progress: 96,
      statusLabel: 'Auto ready',
      typeLabel: viewLabel,
    };
  }

  if (!liveFaceStatus?.valid) {
    return {
      conditionLabel: liveFaceStatus?.message || 'Aligning...',
      instruction: liveFaceStatus?.message || 'Center your face and hair.',
      lengthLabel: 'Scanning',
      progress: 38,
      statusLabel: 'Scanning...',
      typeLabel: viewLabel,
    };
  }

  if (!brightnessReady) {
    return {
      conditionLabel: 'Need more light',
      instruction: 'Move near bright, even lighting.',
      lengthLabel: 'Measuring',
      progress: 68,
      statusLabel: 'More light',
      typeLabel: viewLabel,
    };
  }

  return {
    conditionLabel: 'Analyzing...',
    instruction: 'Hold still...',
    lengthLabel: 'Measuring',
    progress: 82,
    statusLabel: 'Scanning...',
    typeLabel: viewLabel,
  };
};

const hasHardDonationBlocker = (analysis = {}) => {
  const condition = String(analysis?.detected_condition || '').toLowerCase();
  const notes = String(analysis?.visible_damage_notes || '').toLowerCase();
  const summary = String(analysis?.summary || '').toLowerCase();
  const combined = `${condition} ${notes} ${summary}`;
  const confidenceScore = Number(analysis?.confidence_score);

  if (analysis?.is_hair_detected === false) return true;
  if (Array.isArray(analysis?.missing_views) && analysis.missing_views.length) return true;
  if (Number.isFinite(confidenceScore) && confidenceScore < 0.75) return true;
  if (
    /\b(shoulder|shoulder-length|collarbone|neck-length|chin-length|jaw-length)\b/i.test(combined)
    && !/\b(armpit|underarm|mid-back|waist|lower back|chest)\b/i.test(combined)
  ) return true;
  if (analysis?.bald_spots_present === true) return true;
  if (['moderate', 'high'].includes(String(analysis?.visible_scalp_area || '').toLowerCase())) return true;
  if (['moderate', 'severe'].includes(String(analysis?.shedding_level || '').toLowerCase())) return true;

  return [
    'severe damage',
    'major damage',
    'extensive damage',
    'heavy breakage',
    'significant breakage',
    'chemical damage',
    'bleached',
    'rebonded',
    'split ends throughout',
    'not suitable',
  ].some((keyword) => combined.includes(keyword));
};

const hasShortDonationEndpoint = (analysis = {}) => {
  const notes = [
    analysis?.length_assessment,
    analysis?.visible_damage_notes,
    analysis?.summary,
    Array.isArray(analysis?.per_view_notes)
      ? analysis.per_view_notes.map((item) => item?.notes || '').join(' ')
      : '',
  ].join(' ').toLowerCase();

  if (!notes) return false;
  if (/\b(armpit|underarm|mid-back|mid back|middle of the back|lower back|low back|waist)\b/i.test(notes)) {
    return false;
  }

  return /\b(shoulder|shoulder-length|collarbone|clavicle|upper chest|chest length|reaches the chest|neck-length|chin-length|jaw-length)\b/i.test(notes);
};

const hasScalpCoverageTracking = (analysis = {}) => Boolean(
  analysis?.bald_spots_present === true
  || (Array.isArray(analysis?.affected_regions) && analysis.affected_regions.length)
  || analysis?.hair_density_score != null
  || analysis?.shedding_level
  || analysis?.visible_scalp_area
  || analysis?.scalp_coverage_notes
  || analysis?.improvement_tracking_status
  || analysis?.improvement_recommendation
);

const hasScalpFindingTracking = (analysis = {}) => Boolean(
  analysis?.dandruff_detected === true
  || analysis?.dandruff_severity
  || analysis?.dandruff_notes
  || analysis?.lice_detected === true
  || analysis?.lice_confidence
  || analysis?.lice_notes
);

const hasScalpCoverageConcern = (analysis = {}) => (
  analysis?.bald_spots_present === true
  || ['moderate', 'high'].includes(String(analysis?.visible_scalp_area || '').toLowerCase())
  || ['moderate', 'severe'].includes(String(analysis?.shedding_level || '').toLowerCase())
);

const isPhotoRetakeErrorState = (errorState = null) => {
  const title = String(errorState?.title || '').toLowerCase();
  const message = String(errorState?.message || '').toLowerCase();
  const combined = `${title} ${message}`;
  return (
    combined.includes('retake')
    || combined.includes('photo')
    || combined.includes('clearer')
    || combined.includes('multiple subject')
    || combined.includes('person not detected')
    || combined.includes('photos do not match')
    || combined.includes('more hair views needed')
    || combined.includes('photos need better clarity')
  );
};

const formatAffectedRegions = (regions = []) => (
  Array.isArray(regions) && regions.length
    ? regions.join(', ')
    : 'none'
);

const formatDetectedLabel = (value) => (value === true ? 'Detected' : 'Not detected');

const formatDensityScore = (value) => {
  const score = Number(value);
  return Number.isFinite(score) ? `${Math.round(score)} / 100` : 'Not enough data';
};

const buildDonationAssessment = ({ analysis = {}, donationRequirement = null }) => {
  const totalLengthCm = Number(resolveEstimatedLengthCm(analysis));
  const configuredMinimumCm = Number(donationRequirement?.minimum_hair_length_cm);
  const minimumLengthCm = Number.isFinite(configuredMinimumCm) && configuredMinimumCm > 0
    ? configuredMinimumCm
    : null;
  const totalInches = cmToInches(totalLengthCm);
  const minimumInches = minimumLengthCm ? cmToInches(minimumLengthCm) : null;
  const isLengthDetected = Number.isFinite(totalLengthCm) && totalLengthCm > 0;
  const shortEndpoint = hasShortDonationEndpoint(analysis);
  const hasRequirement = Boolean(donationRequirement?.donation_requirement_id) && Boolean(minimumLengthCm);
  const meetsLengthRequirement = hasRequirement && isLengthDetected && totalLengthCm >= minimumLengthCm && !shortEndpoint;
  const hasHardBlocker = hasHardDonationBlocker(analysis);
  const isDonationReady = meetsLengthRequirement && !hasHardBlocker;
  const donatableLengthCm = meetsLengthRequirement && !hasHardBlocker ? totalLengthCm : 0;
  const neededLengthCm = hasRequirement && isLengthDetected ? Math.max(0, minimumLengthCm - totalLengthCm) : null;
  const cutLineBottomPercent = isDonationReady && totalLengthCm > 0
    ? Math.max(24, Math.min(82, (minimumLengthCm / totalLengthCm) * 100))
    : 18;
  const hairLengthLabel = isLengthDetected
    ? `${totalInches.toFixed(1)} inches`
    : 'For review';
  const donatableLengthLabel = isDonationReady
    ? `${cmToInches(donatableLengthCm).toFixed(1)} inches`
    : isLengthDetected
      ? shortEndpoint || hasHardBlocker
        ? '0.0 inches'
        : `${cmToInches(neededLengthCm).toFixed(1)} inches more needed`
      : 'Manual check';

  return {
    cutLineBottomPercent,
    donatableLengthLabel,
    hairLengthLabel,
    isDonationReady,
    meetsLengthRequirement,
    minimumLengthLabel: minimumInches ? `${minimumInches.toFixed(1)} inches` : 'Not configured',
    summary: isDonationReady
      ? (analysis?.donation_readiness_note || 'Your hair appears long enough for donation. You can prepare for a haircut assessment and final partner review.')
      : !hasRequirement
        ? 'Donation requirements are not configured. Please contact the team before using this result for donation eligibility.'
      : hasScalpCoverageConcern(analysis)
        ? 'Not eligible for donation yet. This check can still track visible scalp coverage, density, and hair wellness progress over time.'
      : meetsLengthRequirement && !hasHardBlocker
        ? 'Your hair length may be enough, but the scan found a concern that needs review before donation.'
      : shortEndpoint
        ? `Not eligible for donation yet. Donatable length is measured from the lower cheek or neck to the lowest visible ends, and the current endpoint appears above the required ${minimumInches.toFixed(1)} inches.`
        : isLengthDetected && minimumInches
          ? `Not eligible for donation yet. The estimated donation length is ${totalInches.toFixed(1)} inches, below the ${minimumInches.toFixed(1)}-inch requirement. Continue caring for and growing your hair before checking again.`
          : 'Your hair is not ready for donation yet. Continue hair care and check again after more growth.',
  };
};

const buildDonationAlignedAnalysis = (analysis = {}, donationAssessment = {}) => {
  const decision = donationAssessment.isDonationReady
    ? 'Eligible for hair donation'
    : 'Not eligible for donation yet';
  const trackingStatus = donationAssessment.isDonationReady
    ? 'Ready for donation'
    : 'Not eligible for donation yet';

  return {
    ...analysis,
    decision,
    donation_readiness_note: donationAssessment.summary,
    improvement_tracking_status: trackingStatus,
    improvement_recommendation: donationAssessment.isDonationReady
      ? analysis?.improvement_recommendation
      : donationAssessment.summary,
    summary: analysis?.summary || donationAssessment.summary,
  };
};

const HAIR_RECOMMENDATION_KEYWORDS = [
  'hair',
  'scalp',
  'root',
  'roots',
  'shaft',
  'strands',
  'ends',
  'length',
  'breakage',
  'split',
  'dry',
  'dryness',
  'frizz',
  'shine',
  'oil',
  'conditioner',
  'conditioning',
  'shampoo',
  'moisture',
  'heat',
  'trim',
  'donation',
];

const cleanHairRecommendationText = (value = '') => (
  String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/ingredient or product-type options to consider:.*?(?:\.|$)/gi, '')
    .replace(/(?:neutral care|generic|local|country)?\s*product options? to consider:.*?(?:\.|$)/gi, '')
    .replace(/Ingredients that may help:.*?(?:\.|$)/gi, '')
    .trim()
);

const isPhotoCaptureRecommendation = (recommendation = {}) => {
  const combined = `${recommendation?.title || ''} ${recommendation?.recommendation_text || ''}`.toLowerCase();
  const photoTerms = [
    'photo',
    'image',
    'camera',
    'capture',
    'retake',
    'rescan',
    'scan again',
    'next checkhair scan',
    'next scan',
    'recheck',
    'lighting',
    'background',
    'centered',
    'fully visible',
    'upload',
    'frame',
  ];
  return photoTerms.some((term) => combined.includes(term));
};

const isHairRecommendation = (recommendation = {}) => {
  const combined = `${recommendation?.title || ''} ${recommendation?.recommendation_text || ''}`.toLowerCase();
  return !isPhotoCaptureRecommendation(recommendation)
    && HAIR_RECOMMENDATION_KEYWORDS.some((keyword) => combined.includes(keyword));
};

const buildHairRecommendationFallbacks = ({ analysis = {}, donationAssessment = {} }) => {
  const rows = [];
  const dryness = Number(analysis?.dryness_level);
  const damage = Number(analysis?.damage_level);
  const frizz = Number(analysis?.frizz_level);

  if (!donationAssessment.meetsLengthRequirement) {
    rows.push({
      title: 'Grow and retain length',
      recommendation_text: 'Your scanned hair is still below the donation length. Reduce heat styling, avoid tight pulling styles, and trim only visibly damaged ends so the hair can keep growing with less breakage.',
      priority_order: 1,
    });
  }

  if (Number.isFinite(damage) && damage >= 5) {
    rows.push({
      title: 'Protect damaged ends',
      recommendation_text: 'The scan suggests stressed or uneven ends. Use gentle detangling, avoid harsh brushing when wet, and consider a small trim if split ends are visible before your next scan.',
      priority_order: rows.length + 1,
    });
  }

  if (Number.isFinite(dryness) && dryness >= 5) {
    rows.push({
      title: 'Improve moisture',
      recommendation_text: 'Your hair appears dry or dull in the scan. Focus conditioner on the mid-lengths and ends, then use a weekly moisturizing treatment to improve softness and shine.',
      priority_order: rows.length + 1,
    });
  }

  if (Number.isFinite(frizz) && frizz >= 5) {
    rows.push({
      title: 'Reduce frizz',
      recommendation_text: 'Visible frizz can make the hair shaft look rough during analysis. Dry with a soft towel, avoid high heat, and keep the ends smoothed before rescanning.',
      priority_order: rows.length + 1,
    });
  }

  rows.push({
    title: 'Maintain hair between checks',
    recommendation_text: 'Keep a gentle routine while the hair grows. Avoid tight pulling styles, reduce high heat, detangle carefully, and protect the ends from breakage.',
    priority_order: rows.length + 1,
  });

  return rows.slice(0, 3);
};

const buildVisibleHairRecommendations = ({ analysis = {}, donationAssessment = {} }) => {
  const aiRecommendations = Array.isArray(analysis?.recommendations)
    ? analysis.recommendations
    : [];
  const cleanedRecommendations = aiRecommendations
    .map((recommendation, index) => ({
      title: cleanHairRecommendationText(recommendation?.title) || `Hair care step ${index + 1}`,
      recommendation_text: cleanHairRecommendationText(recommendation?.recommendation_text),
      priority_order: Number(recommendation?.priority_order) || index + 1,
    }))
    .filter((recommendation) => recommendation.recommendation_text && isHairRecommendation(recommendation));

  return (cleanedRecommendations.length
    ? cleanedRecommendations
    : buildHairRecommendationFallbacks({ analysis, donationAssessment }))
    .slice(0, 3);
};

const getHairImprovementRecommendation = (analysis = {}) => {
  const rawText = cleanHairRecommendationText(analysis?.improvement_recommendation || '');
  const fallbackText = 'Focus on gentle handling, moisture balance, scalp comfort, and protecting the ends from breakage while you continue tracking hair progress.';

  if (!rawText) return fallbackText;
  if (isPhotoCaptureRecommendation({ recommendation_text: rawText })) return fallbackText;
  return rawText;
};

const buildFinalAiResultNote = () => (
  'Final donation eligibility should still be reviewed by a qualified staff member or professional.'
);

const normalizeReviewOption = (value = '', options = []) => {
  const normalized = String(value || '').trim().toLowerCase();
  return options.find((option) => option.toLowerCase() === normalized) || '';
};

const buildHumanReviewValuesForSave = (values = {}, analysis = {}) => {
  const fallback = buildHairReviewDefaultValues(analysis);
  const lengthValue = String(values.declaredLength ?? fallback.declaredLength ?? '').trim();

  return {
    declaredLength: lengthValue || fallback.declaredLength,
    declaredColor: String(values.declaredColor ?? fallback.declaredColor ?? '').trim(),
    declaredTexture: String(values.declaredTexture ?? fallback.declaredTexture ?? '').trim(),
    declaredDensity: String(values.declaredDensity ?? fallback.declaredDensity ?? '').trim(),
    declaredCondition: String(fallback.declaredCondition ?? '').trim(),
    detailNotes: String(fallback.detailNotes ?? '').trim(),
  };
};

const getReviewDisplayValue = (value, fallback = 'For review') => {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
};

const buildReviewSummaryRows = (values = {}) => ([
  ['Hair length', String(values.declaredLength ?? '').trim() && Number(values.declaredLength) > 0 ? `${values.declaredLength} inches` : 'For review'],
  ['Color', getReviewDisplayValue(values.declaredColor)],
  ['Texture', getReviewDisplayValue(values.declaredTexture)],
  ['Density', getReviewDisplayValue(values.declaredDensity)],
  ['AI condition', getReviewDisplayValue(values.declaredCondition)],
]);

const getQuestionChoiceIcon = (questionKey = '', optionValue = '', optionIndex = 0) => {
  const normalized = String(optionValue || '').trim().toLowerCase();
  if (questionKey === 'followedPreviousAdvice') {
    if (normalized.includes('consistent')) return 'check-decagram-outline';
    if (normalized.includes('sometimes')) return 'progress-clock';
    return 'leaf-off';
  }
  if (normalized === 'yes' || normalized.includes('healthy') || normalized.includes('improved')) return 'check-circle-outline';
  if (normalized === 'no' || normalized.includes('not_yet') || normalized.includes('worse')) return 'close-circle-outline';
  if (normalized.includes('sometimes') || normalized.includes('moderate')) return 'circle-half-full';
  return ['leaf', 'water-outline', 'weather-sunny', 'hair-dryer-outline', 'heart-pulse'][optionIndex % 5];
};

function ChoiceList({ value, options, onChange, multi = false, questionKey = '' }) {
  const values = Array.isArray(value) ? value : [];

  return (
    <View style={styles.choiceList}>
      {options.map((option) => {
        const isActive = multi ? values.includes(option.value) : value === option.value;
        const detailText = getChoiceDetailText(questionKey, option.value);
        const optionIcon = getQuestionChoiceIcon(questionKey, option.value, options.indexOf(option));

        return (
          <Pressable
            key={option.value}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={multi ? { checked: isActive } : { selected: isActive }}
            onPress={() => {
              if (multi) {
                const nextValues = isActive
                  ? values.filter((item) => item !== option.value)
                  : [...values, option.value];
                onChange(nextValues);
                return;
              }

              onChange(option.value);
            }}
            style={({ pressed }) => [
              styles.choiceCard,
              isActive ? styles.choiceCardActive : null,
              pressed ? styles.choiceCardPressed : null,
            ]}
          >
            <LinearGradient
              pointerEvents="none"
              colors={isActive ? ['#FFF5F8', '#F1D7DF'] : ['#FFFFFF', '#FFF9FA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.choiceCardGradient}
            />
            {isActive ? <View pointerEvents="none" style={styles.choiceCardActiveAccent} /> : null}
            <View style={styles.choiceCardContent}>
              <View style={[styles.choiceIconWrap, isActive ? styles.choiceIconWrapActive : null]}>
                <MaterialCommunityIcons
                  name={optionIcon}
                  size={20}
                  color={isActive ? theme.colors.textOnBrand : theme.colors.brandPrimary}
                />
              </View>
              <View style={styles.choiceCardCopy}>
                <Text style={[styles.choiceLabel, isActive ? styles.choiceLabelActive : null]}>{option.label}</Text>
                {detailText ? <Text style={styles.choiceDescription}>{detailText}</Text> : null}
              </View>
              <View style={[styles.choiceRadio, isActive ? styles.choiceRadioActive : null]}>
                {isActive ? (
                  <MaterialCommunityIcons name="check" size={16} color={theme.colors.textOnBrand} />
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function HairAnalysisTopBar({
  title,
  onBack,
  iconColor,
  textColor,
  showBackButton = true,
}) {
  const { height } = useWindowDimensions();
  const horizontalInset = height < theme.layout.shortScreenHeight
    ? theme.layout.screenPaddingXCompact
    : theme.layout.screenPaddingX;

  return (
    <View style={styles.analysisFlowTopBarShell}>
      <LinearGradient
        colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.analysisFlowTopBar,
          {
            marginHorizontal: -horizontalInset,
            paddingHorizontal: horizontalInset,
          },
        ]}
      >
        <View pointerEvents="none" style={styles.analysisFlowTopBarGlowLarge} />
        <View pointerEvents="none" style={styles.analysisFlowTopBarGlowSmall} />
        <View style={[styles.analysisFlowTopBarSide, styles.analysisFlowTopBarSideStart]}>
          {showBackButton ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onBack}
              style={({ pressed }) => [
                styles.analysisFlowTopBarButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <AppIcon name="arrowLeft" state="inverse" color={iconColor} />
            </Pressable>
          ) : (
            <View style={styles.analysisFlowTopBarButton} />
          )}
        </View>
        <Text numberOfLines={1} style={[styles.analysisFlowTopBarTitle, { color: textColor }]}>
          {title}
        </Text>
        <View style={[styles.analysisFlowTopBarSide, styles.analysisFlowTopBarSideEnd]}>
          <View style={styles.analysisFlowTopBarBalance} />
        </View>
      </LinearGradient>
    </View>
  );
}

function ReviewOptionChips({ value, options, onChange }) {
  return (
    <View style={styles.reviewChipGroup}>
      {options.map((option) => {
        const isActive = value === option;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[styles.reviewChip, isActive ? styles.reviewChipActive : null]}
          >
            {isActive ? <AppIcon name="checkmark" size="sm" state="inverse" /> : null}
            <Text style={[styles.reviewChipText, isActive ? styles.reviewChipTextActive : null]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function HairCaptureTutorialModal({
  currentView,
  requiredViews = [],
  visible,
  onClose,
}) {
  const activeViewKey = currentView?.key || '';

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.captureTutorialOverlay}>
        <Pressable
          style={styles.captureTutorialBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close capture tutorial"
        />
        <View style={styles.captureTutorialSheet}>
          <View style={styles.captureTutorialHeader}>
            <View style={styles.captureTutorialHeaderCopy}>
              <Text style={styles.captureTutorialEyebrow}>6 scan photos</Text>
              <Text style={styles.captureTutorialTitle}>How to show your hair</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.captureTutorialClose, pressed ? styles.pressedMuted : null]}
              accessibilityRole="button"
              accessibilityLabel="Close capture tutorial"
            >
              <AppIcon name="close" size="sm" state="inverse" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.captureTutorialScroll}
            contentContainerStyle={styles.captureTutorialList}
            showsVerticalScrollIndicator={false}
          >
            {requiredViews.map((view, index) => {
              const isActive = view?.key === activeViewKey;
              const tips = Array.isArray(view?.tutorialTips) ? view.tutorialTips : [];

              return (
                <View
                  key={view?.key || `${view?.label}-${index}`}
                  style={[
                    styles.captureTutorialItem,
                    isActive ? styles.captureTutorialItemActive : null,
                  ]}
                >
                  <View style={styles.captureTutorialNumberWrap}>
                    <Text style={styles.captureTutorialNumber}>{index + 1}</Text>
                  </View>
                  <View style={styles.captureTutorialCopy}>
                    <Text style={styles.captureTutorialItemTitle}>
                      {view?.tutorialTitle || view?.label || `Photo ${index + 1}`}
                    </Text>
                    <Text style={styles.captureTutorialDisplayTip}>
                      {view?.displayTip || view?.helperText || 'Keep hair clear and well lit.'}
                    </Text>
                    {tips.length ? (
                      <View style={styles.captureTutorialTipRow}>
                        {tips.slice(0, 3).map((tip) => (
                          <Text key={tip} style={styles.captureTutorialTip}>
                            {tip}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CaptureInstructionPopup({
  completedPhotoCount = 0,
  currentView,
  requiredCount = 0,
  tips = [],
  visible,
  onClose,
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [shouldRender, setShouldRender] = useState(visible);
  const viewTitle = currentView?.tutorialTitle || getViewCaptureLabel(currentView);
  const displayTip = currentView?.displayTip || 'Keep hair loose, centered, and well lit.';
  const activePhotoNumber = Math.min(completedPhotoCount + 1, requiredCount);
  const popupCardAnimatedStyle = {
    transform: [
      {
        translateY: fadeAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [24, 0],
        }),
      },
      {
        scale: fadeAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.97, 1],
        }),
      },
    ],
  };

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
      return undefined;
    }

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShouldRender(false);
    });
    return undefined;
  }, [fadeAnim, visible]);

  if (!shouldRender) return null;

  return (
    <Modal
      transparent
      visible={shouldRender}
      animationType="none"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.captureInstructionPopupOverlay, { opacity: fadeAnim }]}>
        <Pressable
          style={styles.captureInstructionPopupBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo instruction"
        />
        <Animated.View style={[styles.captureInstructionPopupCard, popupCardAnimatedStyle]}>
          <LinearGradient
            colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.captureInstructionPopupHero}
          >
            <View pointerEvents="none" style={styles.captureInstructionPopupGlow} />
            <View style={styles.captureInstructionPopupHeader}>
              <View style={styles.captureInstructionPopupIconWrap}>
                <MaterialCommunityIcons name="image-filter-center-focus" size={23} color="#FFFFFF" />
              </View>
              <View style={styles.captureInstructionPopupCopy}>
                <Text style={styles.captureInstructionPopupStep}>
                  PHOTO {activePhotoNumber} OF {requiredCount}
                </Text>
                <Text style={styles.captureInstructionPopupTitle}>{viewTitle}</Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                style={({ pressed }) => [styles.captureInstructionPopupClose, pressed ? styles.pressedMuted : null]}
                accessibilityRole="button"
                accessibilityLabel="Close photo instruction"
              >
                <MaterialCommunityIcons name="close" size={19} color="#FFFFFF" />
              </Pressable>
            </View>
            <Text style={styles.captureInstructionPopupHeroText}>Set up this view before the camera starts.</Text>
          </LinearGradient>

          <View style={styles.captureInstructionPopupBody}>
            <View style={styles.captureInstructionPopupProgress}>
              {Array.from({ length: requiredCount }).map((_, index) => (
                <View
                  key={`capture-popup-progress-${index}`}
                  style={[
                    styles.captureInstructionPopupProgressDot,
                    index < activePhotoNumber ? styles.captureInstructionPopupProgressDotActive : null,
                    index === activePhotoNumber - 1 ? styles.captureInstructionPopupProgressDotCurrent : null,
                  ]}
                />
              ))}
            </View>

            <View style={styles.captureInstructionPopupFocusRow}>
              <View style={styles.captureInstructionPopupFocusIcon}>
                <MaterialCommunityIcons name="account-box-outline" size={21} color={theme.colors.brandPrimary} />
              </View>
              <View style={styles.captureInstructionPopupFocusCopy}>
                <Text style={styles.captureInstructionPopupFocusLabel}>How to position your hair</Text>
                <Text style={styles.captureInstructionPopupTip}>{displayTip}</Text>
              </View>
            </View>

            {tips.length ? (
              <View style={styles.captureInstructionPopupTips}>
                {tips.slice(0, 2).map((tip) => (
                  <View key={tip} style={styles.captureInstructionPopupTipRow}>
                    <View style={styles.captureInstructionPopupCheck}>
                      <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
                    </View>
                    <Text style={styles.captureInstructionPopupTipText}>{tip}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close instructions and start this photo"
              onPress={onClose}
              style={({ pressed }) => [styles.captureInstructionPopupAction, pressed ? styles.questionDockButtonPressed : null]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={[theme.colors.palette.wine700, theme.colors.palette.wine900]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.captureInstructionPopupActionSurface}
              >
                <MaterialCommunityIcons name="camera-outline" size={20} color="#FFFFFF" />
                <Text style={styles.captureInstructionPopupActionText}>I&apos;m ready for this photo</Text>
                <View style={styles.captureInstructionPopupActionArrow}>
                  <MaterialCommunityIcons name="arrow-right" size={17} color="#FFFFFF" />
                </View>
              </LinearGradient>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function DonationRequirementsIntroModal({
  donationRequirement = null,
  visible,
  onContinue,
  onBack,
}) {
  const hasCurrentRequirement = Boolean(donationRequirement?.donation_requirement_id);
  const minimumLength = Number(donationRequirement?.minimum_hair_length_inches);
  const minimumDonorCount = Number(donationRequirement?.minimum_number_donor);
  const requirementUpdatedAt = donationRequirement?.updated_at
    ? new Date(donationRequirement.updated_at)
    : null;
  const requirementUpdatedLabel = requirementUpdatedAt && !Number.isNaN(requirementUpdatedAt.getTime())
    ? `Updated ${requirementUpdatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : hasCurrentRequirement
      ? 'Current guide'
      : 'Guide unavailable';
  const restrictedTreatments = [
    donationRequirement?.chemical_treatment_status === false ? 'chemical treatments' : '',
    donationRequirement?.colored_hair_status === false ? 'hair color' : '',
    donationRequirement?.bleached_hair_status === false ? 'bleach' : '',
    donationRequirement?.rebonded_hair_status === false ? 'rebonding' : '',
  ].filter(Boolean);
  const textureRequirement = String(donationRequirement?.hair_texture_status || '').trim();
  const organizationNotes = String(donationRequirement?.notes || '').trim();
  const treatmentCopy = restrictedTreatments.length
    ? `Hair with ${restrictedTreatments.join(', ')} may need extra review or may not qualify.`
    : 'Share any coloring or treatment history so the result can be reviewed correctly.';

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onBack}
    >
      <View style={styles.requirementsIntroOverlay}>
        <View style={styles.requirementsIntroBackdrop} />
        <View style={styles.requirementsIntroCard}>
          <LinearGradient
            colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.requirementsIntroHero}
          >
            <View pointerEvents="none" style={styles.requirementsIntroGlowLarge} />
            <View pointerEvents="none" style={styles.requirementsIntroGlowSmall} />
            <View style={styles.requirementsIntroHeroTopRow}>
              <View style={styles.requirementsIntroIconWrap}>
                <MaterialCommunityIcons name="clipboard-check-outline" size={25} color="#FFFFFF" />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={10}
                onPress={onBack}
                style={({ pressed }) => [styles.requirementsIntroClose, pressed ? styles.pressedMuted : null]}
              >
                <MaterialCommunityIcons name="close" size={20} color="#FFFFFF" />
              </Pressable>
            </View>
            <Text style={styles.requirementsIntroEyebrow}>BEFORE YOUR HAIR CHECK</Text>
            <Text style={styles.requirementsIntroTitle}>Know the donation requirements</Text>
            <Text style={styles.requirementsIntroSubtitle}>
              These details help the AI compare your photos with the organization&apos;s current guidelines.
            </Text>
          </LinearGradient>

          <ScrollView
            style={styles.requirementsIntroScroll}
            contentContainerStyle={styles.requirementsIntroBody}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.requirementsIntroSectionHeading}>
              <Text style={styles.requirementsIntroSectionTitle}>What we will check</Text>
              <View
                style={[
                  styles.requirementsIntroCurrentChip,
                  !hasCurrentRequirement ? styles.requirementsIntroCurrentChipUnavailable : null,
                ]}
              >
                <View
                  style={[
                    styles.requirementsIntroCurrentDot,
                    !hasCurrentRequirement ? styles.requirementsIntroCurrentDotUnavailable : null,
                  ]}
                />
                <Text
                  style={[
                    styles.requirementsIntroCurrentText,
                    !hasCurrentRequirement ? styles.requirementsIntroCurrentTextUnavailable : null,
                  ]}
                >
                  {requirementUpdatedLabel}
                </Text>
              </View>
            </View>

            {!hasCurrentRequirement ? (
              <View style={styles.requirementsIntroUnavailableNotice}>
                <MaterialCommunityIcons name="cloud-alert-outline" size={20} color={theme.colors.brandPrimary} />
                <Text style={styles.requirementsIntroUnavailableText}>
                  The current donation guide could not be loaded. You may continue with a hair health check, but the organization must confirm donation eligibility.
                </Text>
              </View>
            ) : null}

            <View style={styles.requirementsIntroRequirementList}>
              <View style={styles.requirementsIntroRequirementRow}>
                <View style={styles.requirementsIntroRequirementIcon}>
                  <MaterialCommunityIcons name="ruler" size={20} color={theme.colors.brandPrimary} />
                </View>
                <View style={styles.requirementsIntroRequirementCopy}>
                  <Text style={styles.requirementsIntroRequirementLabel}>Hair length</Text>
                  <Text style={styles.requirementsIntroRequirementValue}>
                    {Number.isFinite(minimumLength) && minimumLength > 0
                      ? `At least ${minimumLength.toFixed(1)} inches`
                      : 'The organization will confirm the minimum length.'}
                  </Text>
                </View>
              </View>

              {Number.isFinite(minimumDonorCount) && minimumDonorCount > 0 ? (
                <>
                  <View style={styles.requirementsIntroDivider} />
                  <View style={styles.requirementsIntroRequirementRow}>
                    <View style={styles.requirementsIntroRequirementIcon}>
                      <MaterialCommunityIcons name="account-group-outline" size={20} color={theme.colors.brandPrimary} />
                    </View>
                    <View style={styles.requirementsIntroRequirementCopy}>
                      <Text style={styles.requirementsIntroRequirementLabel}>Donor contributions</Text>
                      <Text style={styles.requirementsIntroRequirementValue}>
                        A completed wig may need hair from at least {minimumDonorCount} {minimumDonorCount === 1 ? 'donor' : 'donors'}.
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}

              <View style={styles.requirementsIntroDivider} />

              <View style={styles.requirementsIntroRequirementRow}>
                <View style={styles.requirementsIntroRequirementIcon}>
                  <MaterialCommunityIcons name="flask-outline" size={20} color={theme.colors.brandPrimary} />
                </View>
                <View style={styles.requirementsIntroRequirementCopy}>
                  <Text style={styles.requirementsIntroRequirementLabel}>Color and treatments</Text>
                  <Text style={styles.requirementsIntroRequirementValue}>{treatmentCopy}</Text>
                </View>
              </View>

              {textureRequirement ? (
                <>
                  <View style={styles.requirementsIntroDivider} />
                  <View style={styles.requirementsIntroRequirementRow}>
                    <View style={styles.requirementsIntroRequirementIcon}>
                      <MaterialCommunityIcons name="waves" size={20} color={theme.colors.brandPrimary} />
                    </View>
                    <View style={styles.requirementsIntroRequirementCopy}>
                      <Text style={styles.requirementsIntroRequirementLabel}>Hair texture</Text>
                      <Text style={styles.requirementsIntroRequirementValue}>{textureRequirement}</Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>

            {organizationNotes ? (
              <View style={styles.requirementsIntroNote}>
                <MaterialCommunityIcons name="information-outline" size={19} color={theme.colors.brandPrimary} />
                <View style={styles.requirementsIntroNoteCopy}>
                  <Text style={styles.requirementsIntroNoteTitle}>Organization note</Text>
                  <Text style={styles.requirementsIntroNoteText}>{organizationNotes}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.requirementsIntroReminder}>
              <MaterialCommunityIcons name="shield-check-outline" size={20} color="#FFFFFF" />
              <Text style={styles.requirementsIntroReminderText}>
                The AI result is a guide. The organization makes the final donation decision.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.requirementsIntroActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Continue to hair check questions"
              onPress={onContinue}
              style={({ pressed }) => [styles.requirementsIntroContinue, pressed ? styles.questionDockButtonPressed : null]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={[theme.colors.palette.wine700, theme.colors.palette.wine900]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.requirementsIntroContinueSurface}
              >
                <Text style={styles.requirementsIntroContinueText}>Continue to questions</Text>
                <View style={styles.requirementsIntroContinueIcon}>
                  <MaterialCommunityIcons name="arrow-right" size={18} color="#FFFFFF" />
                </View>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LiveHairCameraPanel({
  autoCaptureEnabled,
  autoCaptureCountdown,
  cameraFacing,
  currentView,
  currentPhoto,
  flashMode,
  requiredViews,
  completedPhotoCount,
  hasCameraPermission,
  cameraRef,
  liveScanStatus,
  liveFaceStatus,
  canUseNativeLiveCamera,
  isCapturing,
  isUploading,
  isAnalyzing,
  onCapture,
  onToggleCamera,
  onToggleFlash,
  onRemove,
  onConfirmPhoto,
  onClose,
  onRequestPermission,
  onFacesChange,
  onCameraError,
}) {
  const [isCaptureTutorialOpen, setIsCaptureTutorialOpen] = useState(false);
  const [isInstructionPopupVisible, setIsInstructionPopupVisible] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const cameraStageWidth = Math.min(Math.max(windowWidth - theme.spacing.sm * 2, 320), 520);
  const cameraStageHeight = Math.min(Math.max(windowWidth * 1.28, 460), 620);
  const scanLineProgress = useRef(new Animated.Value(0)).current;
  const statusToneStyle = liveFaceStatus?.valid
    ? styles.liveStatusPillSuccess
    : liveFaceStatus?.tone === 'error'
      ? styles.liveStatusPillError
      : styles.liveStatusPillWarning;
  const liveStatusDotStyle = liveFaceStatus?.valid
    ? styles.liveStatusDotValid
    : liveFaceStatus?.tone === 'error' || !canUseNativeLiveCamera
      ? styles.liveStatusDotError
      : styles.liveStatusDotActive;
  const shortViewHint = getViewCaptureLabel(currentView);
  const hairDisplayTip = currentView?.displayTip || 'Keep hair loose, centered, and well lit.';
  const currentTutorialTips = Array.isArray(currentView?.tutorialTips) ? currentView.tutorialTips.slice(0, 2) : [];
  const currentViewKey = currentView?.key || currentView?.label || '';

  useEffect(() => {
    if (currentPhoto?.uri) return undefined;

    scanLineProgress.setValue(0);
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineProgress, {
          toValue: 1,
          duration: 1650,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineProgress, {
          toValue: 0,
          duration: 1650,
          useNativeDriver: true,
        }),
      ])
    );
    scanLoop.start();

    return () => {
      scanLoop.stop();
    };
  }, [currentPhoto?.uri, scanLineProgress]);

  useEffect(() => {
    if (currentViewKey && !currentPhoto?.uri) {
      setIsInstructionPopupVisible(true);
    }
  }, [currentPhoto?.uri, currentViewKey]);

  const scanLineTravel = Math.max(cameraStageHeight - 220, 120);
  const scanLineStyle = {
    transform: [
      {
        translateY: scanLineProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, scanLineTravel],
        }),
      },
    ],
  };

  return (
    <View style={styles.liveCameraPanel}>
      <HairCaptureTutorialModal
        currentView={currentView}
        requiredViews={requiredViews}
        visible={isCaptureTutorialOpen}
        onClose={() => setIsCaptureTutorialOpen(false)}
      />
      <CaptureInstructionPopup
        completedPhotoCount={completedPhotoCount}
        currentView={currentView}
        requiredCount={requiredViews.length}
        tips={currentTutorialTips}
        visible={isInstructionPopupVisible}
        onClose={() => setIsInstructionPopupVisible(false)}
      />
      <View style={[styles.liveCameraStage, { width: cameraStageWidth, height: cameraStageHeight }]}>
        {currentPhoto?.uri ? (
          <Image source={{ uri: currentPhoto.uri }} style={styles.liveCameraPreview} resizeMode="cover" />
        ) : hasCameraPermission ? (
          canUseNativeLiveCamera ? (
            <NativeLiveFaceCamera
              cameraRef={cameraRef}
              facing={cameraFacing}
              flashMode={flashMode}
              isActive
              onFacesChange={onFacesChange}
              onCameraError={onCameraError}
            />
          ) : (
            <CameraView
              ref={cameraRef}
              style={styles.liveCameraPreview}
              facing={cameraFacing}
              enableTorch={flashMode === 'on' && cameraFacing === 'back'}
              flash={flashMode === 'on' && cameraFacing === 'back' ? 'on' : 'off'}
              mode="picture"
              animateShutter
            />
          )
        ) : (
          <View style={styles.liveCameraPermission}>
            <AppIcon name="camera" size="xl" state="active" />
            <Text style={styles.liveCameraPermissionTitle}>Camera access needed</Text>
            <Text style={styles.liveCameraPermissionBody}>Allow camera access for live hair scanning.</Text>
            <AppButton
              title="Allow camera access"
              fullWidth={false}
              leading={<AppIcon name="camera" size="md" state="inverse" />}
              onPress={onRequestPermission}
              disabled={isCapturing || isUploading || isAnalyzing}
              style={styles.livePermissionAction}
            />
          </View>
        )}

        <View style={styles.liveCameraTopBar}>
          <Pressable
            onPress={currentPhoto ? onRemove : onClose}
            disabled={isCapturing || isUploading || isAnalyzing}
            style={styles.liveCameraOverlayIcon}
          >
            <AppIcon name="close" size="sm" state="inverse" />
          </Pressable>
          <View style={[styles.liveStatusPill, statusToneStyle]}>
            <View style={[styles.liveStatusDot, liveStatusDotStyle, isAnalyzing ? styles.liveStatusDotActive : null]} />
            <Text style={styles.liveStatusText}>
              {isAnalyzing
                ? 'AI analyzing'
                : autoCaptureCountdown > 0
                  ? `Capturing in ${autoCaptureCountdown}`
                  : liveScanStatus.statusLabel}
            </Text>
          </View>
          <View style={styles.liveCameraTopActions}>
            <Pressable
              onPress={() => setIsCaptureTutorialOpen(true)}
              disabled={Boolean(isCapturing || isUploading || isAnalyzing)}
              style={styles.liveCameraOverlayIcon}
              accessibilityRole="button"
              accessibilityLabel="Open photo capture tutorial"
            >
              <AppIcon name="help-circle-outline" size="sm" state="inverse" />
            </Pressable>
            <Pressable
              onPress={onToggleFlash}
              disabled={Boolean(isCapturing || isUploading || isAnalyzing || currentPhoto?.uri)}
              style={styles.liveCameraOverlayIcon}
              accessibilityRole="button"
              accessibilityLabel={flashMode === 'on' ? 'Turn flash off' : 'Turn flash on'}
            >
              <AppIcon name={flashMode === 'on' ? 'flash' : 'flash-off'} size="sm" state="inverse" />
            </Pressable>
          </View>
        </View>

        <View style={styles.liveFrameGuide} pointerEvents="none">
          {!currentPhoto ? (
            <Animated.View style={[styles.liveScanLine, scanLineStyle]} />
          ) : null}
          {!currentPhoto && autoCaptureCountdown > 0 ? (
            <View style={styles.liveCountdownOverlay}>
              <Text style={styles.liveCountdownNumber}>{autoCaptureCountdown}</Text>
            </View>
          ) : null}
          <View style={styles.liveFrameCornerTopLeft} />
          <View style={styles.liveFrameCornerTopRight} />
          <View style={styles.liveFrameCornerBottomLeft} />
          <View style={styles.liveFrameCornerBottomRight} />
        </View>

      </View>

      <View style={styles.liveCameraBottomSheet}>
        <View style={styles.liveCaptureInstructionCard}>
          <View style={styles.liveCaptureInstructionHeader}>
            <View style={styles.liveCaptureInstructionCopy}>
              <Text style={styles.liveCaptureInstructionStep}>
                Photo {Math.min(completedPhotoCount + 1, requiredViews.length)} of {requiredViews.length}
              </Text>
              <Text style={styles.liveCaptureInstructionTitle}>
                {currentView?.tutorialTitle || shortViewHint}
              </Text>
            </View>
            <Pressable
              onPress={() => setIsCaptureTutorialOpen(true)}
              disabled={Boolean(isCapturing || isUploading || isAnalyzing)}
              style={styles.liveCaptureInstructionIcon}
              accessibilityRole="button"
              accessibilityLabel="Open photo capture tutorial"
            >
              <AppIcon name="tutorial" size="sm" state="inverse" />
            </Pressable>
          </View>
          <Text style={styles.liveCaptureInstructionTip} numberOfLines={2}>
            {hairDisplayTip}
          </Text>
          {currentTutorialTips.length ? (
            <View style={styles.liveCaptureInstructionBullets}>
              {currentTutorialTips.map((tip) => (
                <View key={tip} style={styles.liveCaptureInstructionBullet}>
                  <View style={styles.liveCaptureInstructionDot} />
                  <Text style={styles.liveCaptureInstructionBulletText} numberOfLines={1}>
                    {tip}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
        <View style={styles.liveBottomStatusRow}>
          <Text style={styles.liveHoldStillText}>
            {currentPhoto
              ? 'Preview ready. Confirm to continue.'
              : autoCaptureCountdown > 0
                ? `Hold still. Taking photo in ${autoCaptureCountdown}...`
                : liveScanStatus.instruction}
          </Text>
          <Text style={styles.liveViewHintDark}>{liveScanStatus.typeLabel || shortViewHint}</Text>
        </View>
        <View style={styles.liveCaptureControls}>
          <View style={styles.liveRoundControlPlaceholder} />
          <Pressable
            onPress={currentPhoto ? onConfirmPhoto : hasCameraPermission ? onCapture : onRequestPermission}
            disabled={isCapturing || isUploading || isAnalyzing}
            style={[
              styles.liveCaptureButton,
              autoCaptureEnabled ? styles.liveCaptureButtonReady : null,
              (isCapturing || isAnalyzing) ? styles.liveCaptureButtonDisabled : null,
            ]}
          >
            {isCapturing ? <ActivityIndicator color={theme.colors.brandPrimary} /> : null}
            {currentPhoto && !isCapturing ? <AppIcon name="check" size="lg" state="success" /> : null}
          </Pressable>
          <Pressable
            onPress={currentPhoto ? onRemove : onToggleCamera}
            disabled={isCapturing || isUploading || isAnalyzing}
            style={styles.liveRoundControl}
          >
            <AppIcon name={currentPhoto ? 'refresh' : 'camera-retake-outline'} size="md" state="inverse" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function NativeLiveFaceCamera({ cameraRef, facing = 'front', flashMode = 'off', isActive, onFacesChange, onCameraError }) {
  const normalizedFacing = facing === 'back' ? 'back' : 'front';
  const device = useNativeCameraDevice(normalizedFacing);
  const supportsTorch = Boolean(device?.hasTorch || device?.hasFlash);
  const safeTorchMode = flashMode === 'on' && supportsTorch ? 'on' : 'off';
  const faceDetectionOptions = React.useMemo(() => ({
    performanceMode: 'fast',
    landmarkMode: 'none',
    contourMode: 'none',
    classificationMode: 'all',
    minFaceSize: 0.18,
    trackingEnabled: true,
    cameraFacing: normalizedFacing,
  }), [normalizedFacing]);
  const { detectFaces, stopListeners } = useNativeFaceDetector(faceDetectionOptions);
  const handleFacesOnJs = React.useMemo(
    () => NativeWorklets.createRunOnJS((faces = [], brightness = -1) => {
      onFacesChange?.(faces, brightness);
    }),
    [onFacesChange]
  );
  const frameProcessor = useNativeFrameProcessor((frame) => {
    'worklet';
    const faces = detectFaces(frame);
    let avgBrightness = -1;
    try {
      if (typeof frame.toArrayBuffer === 'function') {
        const buffer = frame.toArrayBuffer();
        const bytes = new Uint8Array(buffer);
        const sampleEnd = Math.min(frame.width * frame.height, bytes.length);
        const step = Math.max(1, Math.floor(sampleEnd / 250));
        let sum = 0;
        let count = 0;
        for (let i = 0; i < sampleEnd; i += step) {
          sum += bytes[i];
          count++;
        }
        avgBrightness = count > 0 ? Math.round(sum / count) : -1;
      }
    } catch (_e) {
      avgBrightness = -1;
    }
    handleFacesOnJs(faces, avgBrightness);
  }, [detectFaces, handleFacesOnJs]);

  React.useEffect(() => (
    () => {
      stopListeners?.();
    }
  ), [stopListeners]);

  if (!NativeVisionCamera || !device) {
    return (
      <View style={styles.liveCameraPermission}>
        <AppIcon name="camera" size="xl" state="active" />
        <Text style={styles.liveCameraPermissionTitle}>Live scanner starting</Text>
        <Text style={styles.liveCameraPermissionBody}>
          {nativeVisionCameraLoadError || nativeFaceCameraLoadError || 'Camera device is not ready yet. Please try again in a moment.'}
        </Text>
      </View>
    );
  }

  return (
    <NativeVisionCamera
      ref={cameraRef}
      style={styles.liveCameraPreview}
      device={device}
      isActive={isActive}
      photo
      frameProcessor={frameProcessor}
      pixelFormat="yuv"
      torch={safeTorchMode}
      onError={onCameraError}
    />
  );
}

function PreAnalysisPhotoReview({
  photos = [],
  requiredViews = [],
  cardBackground,
  isAnalyzing = false,
  isSaving = false,
  isValidating = false,
  validation = null,
  onPreview,
  onRetake,
  onRunAnalysis,
}) {
  const readyCount = photos.filter(Boolean).length;
  const allReady = readyCount === requiredViews.length && requiredViews.length > 0;
  const validationMessage = typeof validation?.message === 'string'
    ? validation.message
    : validation?.message?.message || '';
  const validationFailed = Boolean(validation && validation.ok === false);
  const validationDetails = Array.isArray(validation?.details) ? validation.details : [];
  const retakeSlotIndexes = buildRetakeSlotIndexes({ validation, requiredViews });
  const uniqueValidationDetails = validationDetails.filter((detail, index, collection) => {
    const viewLabel = String(detail?.viewLabel || '').trim().toLowerCase();
    const errorText = String(detail?.error || '').trim().toLowerCase();
    if (!errorText) return false;
    return collection.findIndex((entry) => (
      String(entry?.viewLabel || '').trim().toLowerCase() === viewLabel
      && String(entry?.error || '').trim().toLowerCase() === errorText
    )) === index;
  });
  const validationSummaryText = validationFailed && uniqueValidationDetails.length
    ? uniqueValidationDetails.length === 1
      ? 'Retake required for 1 photo.'
      : `Retake required for ${uniqueValidationDetails.length} photos.`
    : '';
  const statusText = isValidating
    ? 'Checking photos...'
    : validationSummaryText || validationMessage || `${readyCount}/${requiredViews.length} photos ready`;

  return (
    <View style={styles.analysisResultPanel}>
      <View style={styles.analysisResultTopBar}>
        <View style={styles.resultHeaderButtonPlaceholder} />
        <Text style={styles.analysisResultScreenTitle}>Review Photos</Text>
        <View style={styles.resultHeaderButtonPlaceholder} />
      </View>

      <View style={[styles.preAnalysisReviewCard, { backgroundColor: cardBackground }]}>
        <View style={styles.preAnalysisStatusRow}>
          <View style={styles.preAnalysisStatusCopy}>
            <AppIcon
              name={isValidating ? 'magnify' : validation?.ok ? 'check-circle-outline' : validationFailed ? 'alert-circle-outline' : 'image-check-outline'}
              size="sm"
              state={!isValidating && validation?.ok ? 'success' : validationFailed ? 'danger' : 'active'}
            />
            <Text
              style={[
                styles.preAnalysisValidationText,
                validationFailed ? styles.preAnalysisValidationTextError : null,
              ]}
              numberOfLines={2}
            >
              {statusText}
            </Text>
          </View>
          <View style={[
            styles.preAnalysisCountBadge,
            validation?.ok ? styles.preAnalysisCountBadgeOk : null,
          ]}>
            <Text style={styles.preAnalysisCountText}>{readyCount}/{requiredViews.length}</Text>
          </View>
        </View>
        {validationFailed && uniqueValidationDetails.length ? (
          <View style={styles.preAnalysisIssueList}>
            {uniqueValidationDetails.slice(0, 2).map((detail, index) => (
              <View key={`${detail?.viewLabel || 'photo'}-${index}`} style={styles.preAnalysisIssueRow}>
                <AppIcon name="alert-circle-outline" size="sm" state="danger" />
                <Text style={styles.preAnalysisIssueText} numberOfLines={2}>
                  {String(detail?.error || '').toLowerCase().startsWith(String(detail?.viewLabel || '').toLowerCase())
                    ? String(detail?.error || '')
                    : [detail?.viewLabel, detail?.error].filter(Boolean).join(': ')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.preAnalysisList}>
          {requiredViews.map((view, index) => {
            const photo = photos[index];
            const canRetakePhoto = retakeSlotIndexes.has(index);
            return (
              <View
                key={view?.key || view?.label || index}
                style={[styles.preAnalysisPhotoCard, { backgroundColor: cardBackground }]}
              >
                <Pressable
                  onPress={() => onPreview?.(photo?.uri)}
                  disabled={!photo?.uri}
                  style={({ pressed }) => [
                    styles.preAnalysisPhotoFrame,
                    pressed ? styles.preAnalysisPhotoPressed : null,
                  ]}
                >
                  {photo?.uri ? (
                    <Image source={{ uri: photo.uri }} style={styles.preAnalysisPhoto} resizeMode="cover" />
                  ) : (
                    <View style={styles.preAnalysisPhotoEmpty}>
                      <AppIcon name="image" size="md" state="muted" />
                    </View>
                  )}
                </Pressable>
                <View style={styles.preAnalysisPhotoMeta}>
                  <Text style={styles.preAnalysisPhotoTitle} numberOfLines={1}>
                    {view?.label || `Photo ${index + 1}`}
                  </Text>
                  <Text style={styles.preAnalysisPhotoSubtitle}>
                    {photo?.uri ? 'Tap to preview' : 'Photo needed'}
                  </Text>
                </View>
                {canRetakePhoto ? (
                  <Pressable
                    onPress={() => onRetake?.(index)}
                    disabled={isAnalyzing || isSaving}
                    style={({ pressed }) => [
                      styles.preAnalysisRetakeButton,
                      pressed ? styles.preAnalysisPhotoPressed : null,
                    ]}
                  >
                    <AppIcon name="camera-retake-outline" size="sm" state="active" />
                    <Text style={styles.preAnalysisRetakeText}>Retake</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.preAnalysisActions}>
        <AppButton
          title={isValidating
            ? 'Checking photos...'
            : isAnalyzing
              ? 'Analyzing...'
              : validation?.ok
                ? 'Run analysis'
                : 'Retake required'}
          onPress={onRunAnalysis}
          loading={isValidating || isAnalyzing}
          disabled={!allReady || !validation?.ok || isValidating || isAnalyzing || isSaving}
          fullWidth
        />
      </View>
    </View>
  );
}

function AnalysisLoadingSplash({ resolvedTheme, photos = [], completedPhotoCount = 0 }) {
  const [imageFailed, setImageFailed] = useState(false);
  const logoSource = resolveBrandLogoSource(resolvedTheme, imageFailed);
  const primaryPhoto = photos.find((photo) => photo?.uri);
  const progressPercent = Math.min(95, Math.max(35, 35 + completedPhotoCount * 18));

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedTheme?.logoIcon]);

  return (
    <View style={styles.analysisSplash}>
      <View style={styles.analysisScanHeader}>
        <View>
          <Text style={styles.analysisSplashTitle}>Analyzing hair</Text>
          <Text style={styles.analysisSplashText}>Checking photos, length, texture, and condition.</Text>
        </View>
        <Text style={styles.analysisScanPercent}>{progressPercent}%</Text>
      </View>

      <View style={styles.analysisScanRow}>
        <View style={styles.analysisScanPreview}>
          {primaryPhoto?.uri ? (
            <Image source={{ uri: primaryPhoto.uri }} style={styles.analysisScanImage} resizeMode="cover" />
          ) : (
            <Image
              source={logoSource}
              style={styles.analysisSplashLogo}
              resizeMode="contain"
              onError={() => setImageFailed(true)}
            />
          )}
          <View style={styles.analysisScanGrid} pointerEvents="none" />
          <View style={styles.analysisScanBadge}>
            <View style={styles.analysisScanDot} />
            <Text style={styles.analysisScanBadgeText}>AI scan</Text>
          </View>
        </View>

        <View style={styles.analysisScanChecks}>
          {[
            ['hair-dryer-outline', 'Texture'],
            ['ruler', 'Length'],
            ['checkHair', 'Condition'],
          ].map(([icon, label], index) => (
            <View key={label} style={styles.analysisScanCheck}>
              {index < 2 ? (
                <AppIcon name="check-circle-outline" size="sm" state="success" />
              ) : (
                <ActivityIndicator size="small" color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
              )}
              <Text style={styles.analysisScanCheckText}>{label}</Text>
              <AppIcon name={icon} size="sm" state="muted" />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.analysisScanProgressTrack}>
        <View style={[styles.analysisScanProgressFill, { width: `${progressPercent}%` }]} />
      </View>
    </View>
  );
}

function ProfileSetupGate({ completionMeta, onManageProfile }) {
  return (
    <Pressable onPress={onManageProfile} style={({ pressed }) => [styles.profileGateCard, pressed ? styles.interactivePressed : null]}>
      <View style={styles.profileGateTop}>
        <View style={styles.profileGateIcon}>
          <AppIcon name="shield-check-outline" size="lg" state="active" />
        </View>
        <View style={styles.profileGateCopy}>
          <Text style={styles.profileGateTitle}>Finish Setting Up Your Account</Text>
          <Text style={styles.profileGateBody}>{completionMeta?.percentage || 0}% complete</Text>
        </View>
        <AppIcon name="chevronRight" size="md" state="muted" />
      </View>
    </Pressable>
  );
}

const FIRST_TIME_QUESTION_STEPS = [
  {
    key: 'hairTexture',
    title: 'What is your hair pattern?',
    type: 'choice',
    optionsKey: 'hairTexture',
  },
  {
    key: 'washFrequency',
    title: 'How often do you wash your hair?',
    type: 'choice',
    optionsKey: 'washFrequency',
  },
  {
    key: 'scalpItch',
    title: 'Does your scalp itch?',
    type: 'choice',
    optionsKey: 'itchFrequency',
  },
  {
    key: 'dandruffOrFlakes',
    title: 'Do you notice dandruff or flakes?',
    type: 'choice',
    optionsKey: 'dandruffLevel',
  },
  {
    key: 'oilyAfterWash',
    title: 'Does your scalp get oily quickly after washing?',
    type: 'choice',
    optionsKey: 'quickOiliness',
  },
  {
    key: 'dryOrRough',
    title: 'Which best describes your hair condition?',
    type: 'choice',
    optionsKey: 'drynessLevel',
  },
  {
    key: 'hairFall',
    title: 'Have you noticed increased hair breakage or hair fall recently?',
    type: 'choice',
    optionsKey: 'hairFallLevel',
  },
  {
    key: 'chemicalProcessHistory',
    title: 'Have you used bleach, hair color, rebond, relax, or perm?',
    type: 'choice',
    optionsKey: 'chemicalProcessHistory',
  },
  {
    key: 'heatUse',
    title: 'Do you often use heat on your hair?',
    type: 'choice',
    optionsKey: 'heatUseFrequency',
  },
];

const RETURNING_QUESTION_STEPS = [
  {
    key: 'followedPreviousAdvice',
    title: 'Since your last hair check, did you follow the recommended hair-care advice?',
    helperText: 'This helps compare your current result with your last saved recommendations.',
    type: 'choice',
    optionsKey: 'recommendationFollowThrough',
  },
  {
    key: 'hairConditionProgress',
    title: 'Since your last check, how would you describe your hair now?',
    type: 'choice',
    optionsKey: 'hairProgress',
  },
  {
    key: 'hairTexture',
    title: 'What is your hair pattern?',
    type: 'choice',
    optionsKey: 'hairTexture',
  },
  {
    key: 'noticedChanges',
    title: 'What changes have you noticed since your last check?',
    helperText: 'Choose all that apply.',
    type: 'multi',
    optionsKey: 'followUpChanges',
  },
  {
    key: 'heatUseSinceLastCheck',
    title: 'Have you used heat styling since your last hair check?',
    type: 'choice',
    optionsKey: 'heatUseFrequency',
  },
  {
    key: 'chemicalTreatmentSinceLastCheck',
    title: 'Have you used bleach, color, rebond, relax, or perm since your last check?',
    type: 'choice',
    optionsKey: 'chemicalProcessHistory',
  },
  {
    key: 'routineChangedSinceLastCheck',
    title: 'Have you changed your hair-care routine since your last check?',
    type: 'choice',
    optionsKey: 'yesNo',
  },
  {
    key: 'routineChangeFocus',
    title: 'If yes, what changed most?',
    type: 'choice',
    optionsKey: 'routineChangeFocus',
    showWhen: (answers = {}) => answers?.routineChangedSinceLastCheck === 'yes',
  },
  {
    key: 'healthierNow',
    title: 'Do you feel your hair is healthier now than before?',
    type: 'choice',
    optionsKey: 'healthyNow',
  },
];

const getQuestionStepsForMode = (questionnaireMode = 'first_time') => (
  questionnaireMode === 'returning_follow_up'
    ? RETURNING_QUESTION_STEPS
    : FIRST_TIME_QUESTION_STEPS
);

const getVisibleQuestions = (answers = {}, questionnaireMode = 'first_time') => (
  getQuestionStepsForMode(questionnaireMode).filter((item) => !item.showWhen || item.showWhen(answers))
);

const getChoiceDisplayLabel = (optionsKey, value) => {
  if (Array.isArray(value)) {
    return value.map((item) => getChoiceDisplayLabel(optionsKey, item)).filter(Boolean).join(', ');
  }

  const option = (hairAnalyzerQuestionChoices[optionsKey] || []).find((item) => item.value === value);
  return option?.label || value || 'Not answered';
};

const QUESTION_MATTER_COPY = {
  washFrequency: {
    default: 'Washing frequency helps the AI interpret oiliness, dryness, scalp buildup, and shine in your photos.',
    daily: 'Daily washing can make some hair look cleaner but may also dry out the ends, so the AI checks if dryness or frizz is routine-related.',
    every_2_3_days: 'Washing every 2-3 days is a common routine. It helps the AI compare visible oil, shine, and scalp condition against a balanced wash pattern.',
    '1_2_times_weekly': 'Washing 1-2 times a week may allow more oil or buildup to appear, so the AI weighs scalp shine and flakes more carefully.',
    less_often: 'Washing less often matters because oil, buildup, dandruff, or dullness can affect how healthy the hair appears during the scan.',
  },
  scalpItch: {
    default: 'Scalp itch helps the AI understand whether visible redness, flakes, or scalp irritation may be affecting hair condition.',
    never: 'No itch suggests fewer scalp irritation signals, so the AI can focus more on length, ends, texture, and visible damage.',
    sometimes: 'Occasional itch may point to dryness, buildup, or sensitivity, so the AI checks the scalp and flakes more carefully.',
    often: 'Frequent itch can signal scalp irritation or buildup, which matters because poor scalp condition can affect donation readiness.',
  },
  dandruffOrFlakes: {
    default: 'Dandruff or flakes help the AI separate scalp buildup from hair texture, shine, and dryness in the photos.',
    no: 'No flakes means the AI can treat visible white marks or dullness as less likely to be dandruff-related.',
    a_little: 'A little dandruff may affect scalp appearance, so the AI checks whether flakes are minor or visually affecting the scan.',
    a_lot: 'A lot of flakes can signal scalp buildup or irritation, which may require care before donation review.',
  },
  oilyAfterWash: {
    default: 'Oiliness after washing helps the AI judge whether shine in the photo is healthy shine or excess scalp oil.',
    no: 'If your scalp does not get oily quickly, visible shine is more likely to be normal hair shine than excess oil.',
    sometimes: 'Sometimes getting oily helps the AI treat shine and scalp appearance as variable instead of automatically unhealthy.',
    yes: 'Quick oiliness can make hair look heavy or greasy, so the AI checks whether oil is affecting visible condition.',
  },
  hairFall: {
    default: 'Hair breakage or hair fall helps the AI understand whether density, scalp visibility, or thinning signs need closer review.',
    no: 'No noticeable breakage or hair fall means the AI can focus less on thinning risk and more on length and visible strand condition.',
    not_sure: 'Not being sure tells the AI to treat density signals carefully and avoid overconfident thinning conclusions.',
    yes: 'Increased breakage or hair fall matters because the AI checks density, scalp visibility, and whether the hair still appears strong enough.',
  },
  chemicalProcessHistory: {
    default: 'Chemical processing matters because bleaching, coloring, rebonding, relaxing, or perming can affect donation acceptance.',
    no: 'No chemical processing supports donation readiness because untreated hair is usually easier for partners to review and use.',
    yes: 'Chemical processing can weaken strands or conflict with partner rules, so the AI checks damage and flags final manual review.',
  },
  heatUse: {
    default: 'Heat use helps the AI judge whether dryness, frizz, split ends, or dullness may come from styling damage.',
    never: 'No heat use lowers the chance that visible dryness or frizz is heat-related, so the AI weighs natural texture more.',
    sometimes: 'Occasional heat use may affect ends, so the AI checks for mild dryness, frizz, or breakage near the tips.',
    often: 'Frequent heat use can damage ends and reduce donation quality, so the AI looks more closely for dryness and breakage.',
  },
  followedPreviousAdvice: {
    default: 'This helps the AI compare your current scan with the care plan from your last saved result.',
    yes_consistently: 'Consistent care helps explain improvement and lets the AI compare whether dryness, shine, and ends changed as expected.',
    sometimes: 'Partial follow-through helps the AI interpret mixed results, such as some improvement but remaining dryness or frizz.',
    not_yet: 'If advice was not followed yet, the AI expects fewer condition changes and may keep similar care recommendations.',
  },
  hairConditionProgress: {
    default: 'Your own progress report gives the AI context before comparing today\'s photos with your last scan.',
    better: 'Feeling improvement helps the AI check whether photos also show better shine, smoother texture, or healthier ends.',
    same: 'If it feels the same, the AI compares today\'s scan carefully for small changes in length, dryness, and damage.',
    worse: 'Feeling worse matters because the AI looks for new dryness, frizz, flakes, hair fall, or visible damage.',
    not_sure: 'Not sure tells the AI to rely more heavily on the current photos and saved history instead of subjective progress.',
  },
  hairTexture: {
    default: 'Hair pattern helps the AI interpret shrinkage, shape, and how your length appears in the photos.',
    Straight: 'Straight hair usually shows length clearly, so the AI can compare the visible ends more directly.',
    Wavy: 'Wavy hair pattern can add some bend and shrinkage, so the AI checks the shape and ends more carefully.',
    Curly: 'Curly hair pattern can hide some true length, so the AI looks at curl pattern and visible endpoint placement.',
    Coily: 'Coily hair pattern can shrink more in photos, so the AI weighs visible length and shape together.',
  },
  dryOrRough: {
    default: 'Hair condition helps the AI interpret whether today\'s look reflects balance, dryness, roughness, oiliness, damage, brittleness, or frizz.',
    normal_balanced: 'Normal or balanced hair gives the AI a cleaner baseline for checking shine, softness, and visible strand health.',
    dry: 'Dry hair can make ends look dull or frizzy, so the AI checks whether moisture loss is affecting the scan.',
    rough: 'Rough hair can point to friction, dryness, or surface damage, which affects how the AI reads texture and ends.',
    oily: 'Oily hair can make strands look heavier or shinier, so the AI checks whether scalp oil is affecting the scan.',
    damaged: 'Damaged hair matters because split ends, breakage, or weakness can change how donation readiness is assessed.',
    brittle: 'Brittle hair can break more easily, so the AI looks more closely at strand strength and visible damage.',
    frizzy: 'Frizzy hair can make the surface look uneven, so the AI weighs frizz alongside true dryness or damage.',
  },
  noticedChanges: {
    default: 'Noticed changes help the AI focus its comparison between your previous scan and today\'s photos.',
    less_dryness: 'Less dryness helps the AI check if the ends now look smoother, less dull, and more donation-ready.',
    less_oiliness: 'Less oiliness helps the AI judge whether scalp shine and heaviness improved since the last scan.',
    less_hair_fall: 'Less hair fall helps the AI compare density and scalp visibility with your previous result.',
    less_dandruff: 'Less dandruff helps the AI review whether flakes or scalp buildup are less visible now.',
    softer_hair: 'Softer hair helps the AI look for smoother texture, better shine, and fewer rough-looking areas.',
    no_major_change: 'No major change tells the AI to expect a similar result and focus on small differences in length or ends.',
    got_worse: 'Worse condition tells the AI to look for new dryness, flakes, frizz, breakage, or scalp concerns.',
  },
  heatUseSinceLastCheck: {
    default: 'Recent heat styling helps the AI explain new dryness, frizz, or end damage compared with the last check.',
    never: 'No recent heat use means new dryness or frizz is less likely to come from styling tools.',
    sometimes: 'Some heat use may explain mild frizz or dry ends, so the AI checks whether the tips look affected.',
    often: 'Frequent recent heat use can quickly affect the ends, so the AI checks for breakage and donation quality concerns.',
  },
  chemicalTreatmentSinceLastCheck: {
    default: 'Recent chemical treatment is important because it can change donation eligibility even if the hair is long enough.',
    no: 'No recent chemical treatment supports a cleaner comparison with your previous scan and reduces eligibility conflicts.',
    yes: 'Recent bleach, color, rebond, relax, or perm can weaken hair and may require manual review before donation.',
  },
  routineChangedSinceLastCheck: {
    default: 'Routine changes help the AI explain why today\'s result may differ from your last saved scan.',
    yes: 'A changed routine can affect oiliness, dryness, shine, and frizz, so the AI links visible changes to the new habit.',
    no: 'No routine change means the AI compares today\'s photos against your last result without expecting major care-related changes.',
  },
  routineChangeFocus: {
    default: 'The changed routine tells the AI which hair condition signals should be expected to improve first.',
    washing_routine: 'A washing routine change can affect oiliness, flakes, scalp buildup, and dryness in the scan.',
    hair_products: 'Product changes can affect shine, smoothness, buildup, and frizz, so the AI checks those signals.',
    reduced_heat_styling: 'Reduced heat styling should help the AI look for less dryness, smoother ends, and fewer breakage signs.',
    stopped_chemical_treatment: 'Stopping chemical treatment helps the AI watch for recovery in strand strength and reduced visible damage.',
    started_scalp_care: 'Scalp care can affect flakes, itch, oiliness, and scalp visibility, so the AI reviews those areas.',
    other: 'Other changes give the AI general context that your current scan may not match your previous routine.',
  },
  healthierNow: {
    default: 'This helps the AI compare your own condition impression with visible changes in the photos.',
    yes: 'If you feel it is healthier, the AI checks for supporting signs like better shine, smoother texture, and healthier ends.',
    no: 'If it does not feel healthier, the AI looks for remaining dryness, frizz, flakes, or damage that may need care.',
    not_sure: 'Not sure tells the AI to rely more on the photo evidence and saved history before judging progress.',
  },
};

const QUESTION_HELPER_COPY = {
  scalpItch: 'Understanding your scalp health helps us ensure the highest quality for hair recipients.',
};

const QUESTION_CHOICE_COPY = {
  scalpItch: {
    never: 'My scalp feels healthy and calm daily.',
    sometimes: 'Occasional dryness or mild irritation.',
    often: 'Frequent itching or visible redness.',
  },
};

const getQuestionHelperText = (question) => (
  QUESTION_HELPER_COPY[question?.key]
  || question?.helperText
  || 'Answering this helps us personalize the next step.'
);

const getChoiceDetailText = (questionKey, value) => (
  QUESTION_CHOICE_COPY[questionKey]?.[value] || ''
);

const getQuestionMatterText = (question, answers = {}) => {
  if (!question?.key) {
    return 'Your answers help the AI compare your photos with donation readiness rules before it checks length, texture, dryness, and visible damage.';
  }

  const copyByAnswer = QUESTION_MATTER_COPY[question.key];
  if (!copyByAnswer) {
    return 'Your answer gives the AI context for checking hair length, texture, dryness, scalp condition, and visible damage.';
  }

  const answerValue = answers?.[question.key];
  if (Array.isArray(answerValue)) {
    const selectedCopies = answerValue.map((value) => copyByAnswer[value]).filter(Boolean);
    if (selectedCopies.length) return selectedCopies.join(' ');
    return copyByAnswer.default;
  }

  return copyByAnswer[answerValue] || copyByAnswer.default;
};

const weekdayLabels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const formatCalendarMonthLabel = (value) => (
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(value)
);

const formatCalendarDayLabel = (value) => (
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))
);

const buildCalendarDays = (visibleMonth) => {
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const firstWeekday = firstDay.getDay();
  const firstCalendarDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1 - firstWeekday);

  return Array.from({ length: 35 }, (_, index) => {
    const day = new Date(firstCalendarDay);
    day.setDate(firstCalendarDay.getDate() + index);
    return day;
  });
};

const buildWeekDays = (anchorDate = new Date()) => {
  const start = new Date(anchorDate);
  start.setDate(anchorDate.getDate() - anchorDate.getDay());

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
};

const normalizeConditionTone = (condition = '') => {
  const normalized = String(condition || '').trim().toLowerCase();

  if (normalized.includes('healthy') || normalized.includes('good')) {
    return {
      dotColor: '#4FAE71',
      label: 'Healthy',
      icon: 'check-decagram-outline',
      iconColor: '#2B7A4B',
      toneSurface: '#E9F8EE',
    };
  }

  if (normalized.includes('dry') || normalized.includes('damaged')) {
    return {
      dotColor: '#E49C49',
      label: 'Needs care',
      icon: 'alert-circle-outline',
      iconColor: '#9B5F1B',
      toneSurface: '#FFF4E8',
    };
  }

  if (normalized.includes('treated') || normalized.includes('rebonded') || normalized.includes('colored')) {
    return {
      dotColor: '#7A8AE6',
      label: 'Treated',
      icon: 'palette-outline',
      iconColor: '#485CC5',
      toneSurface: '#EEF1FF',
    };
  }

  return {
    dotColor: theme.colors.brandPrimary,
    label: condition || 'Checked',
    icon: 'line-scan',
    iconColor: theme.colors.brandPrimary,
    toneSurface: theme.colors.brandPrimaryMuted,
  };
};

// Converts a Date object or ISO string to the user's LOCAL calendar date key (YYYY-MM-DD).
// Using toISOString() on local-midnight Date objects shifts the day in UTC+N timezones,
// causing a one-day mismatch between calendar cells and stored screening dates.
const toLocalDateKey = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getRegisteredDriveActivityDate = (drive = null) => (
  drive?.registration?.registered_at
  || drive?.registration?.updated_at
  || drive?.start_date
  || drive?.updated_at
  || ''
);

const buildRegisteredEventHistory = (registeredDrives = []) => {
  const events = (registeredDrives || [])
    .filter((drive) => drive?.donation_drive_id)
    .map((drive) => ({
      ...drive,
      calendar_date: getRegisteredDriveActivityDate(drive),
    }))
    .filter((drive) => drive.calendar_date);

  const markers = new Map();

  events.forEach((eventDrive) => {
    const key = toLocalDateKey(eventDrive.calendar_date);
    const current = markers.get(key) || [];
    current.push(eventDrive);
    current.sort((left, right) => new Date(right.calendar_date).getTime() - new Date(left.calendar_date).getTime());
    markers.set(key, current);
  });

  const latestEvent = [...events].sort((left, right) => (
    new Date(right.calendar_date).getTime() - new Date(left.calendar_date).getTime()
  ))[0] || null;

  return {
    markers,
    events,
    latestEvent,
  };
};

const buildHairConditionHistory = (submissions = []) => {
  const entries = submissions
    .flatMap((submission) => {
      const latestDetail = [...(submission?.submission_details || [])]
        .sort((left, right) => new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime())[0] || null;

      return (submission?.ai_screenings || [])
        .filter((screening) => screening?.created_at)
        .map((screening) => ({
          screening,
          submission,
          detail: latestDetail,
          images: latestDetail?.images || [],
          recommendations: submission?.donor_recommendations || [],
        }));
    });

  const markers = new Map();

  entries.forEach((entry) => {
    const key = toLocalDateKey(entry.screening.created_at);
    const current = markers.get(key) || [];
    current.push(entry);
    current.sort((left, right) => new Date(right.screening.created_at).getTime() - new Date(left.screening.created_at).getTime());
    markers.set(key, current);
  });

  const latestEntry = [...entries].sort((left, right) => (
    new Date(right.screening.created_at).getTime() - new Date(left.screening.created_at).getTime()
  ))[0] || null;

  return {
    markers,
    latestEntry,
    latestScreening: latestEntry?.screening || null,
    screenings: entries.map((entry) => entry.screening),
    entries,
  };
};

const buildHairActivityHistory = ({ submissions = [], registeredDrives = [] } = {}) => {
  const hairHistory = buildHairConditionHistory(submissions);
  const eventHistory = buildRegisteredEventHistory(registeredDrives);
  const mergedMarkers = new Map();
  const allDateKeys = new Set([
    ...hairHistory.markers.keys(),
    ...eventHistory.markers.keys(),
  ]);

  allDateKeys.forEach((dateKey) => {
    mergedMarkers.set(dateKey, {
      screenings: hairHistory.markers.get(dateKey) || [],
      events: eventHistory.markers.get(dateKey) || [],
    });
  });

  return {
    ...hairHistory,
    markers: mergedMarkers,
    registeredEvents: eventHistory.events,
    latestEvent: eventHistory.latestEvent,
  };
};

const buildAnalysisHistoryContext = (submissions = []) => {
  const history = buildHairConditionHistory(submissions);
  const sortedEntries = [...history.entries]
    .sort((left, right) => new Date(right.screening.created_at).getTime() - new Date(left.screening.created_at).getTime());
  const latestEntry = sortedEntries[0] || null;
  const entries = sortedEntries
    .slice(0, 6)
    .map((entry) => ({
      created_at: entry.screening?.created_at || '',
      detected_condition: entry.screening?.detected_condition || '',
      decision: entry.screening?.decision || '',
      summary: entry.screening?.summary || '',
      estimated_length: entry.screening?.estimated_length ?? null,
      recommendations: Array.isArray(entry.recommendations)
        ? entry.recommendations
          .slice(0, 4)
          .map((recommendation) => ({
            title: recommendation?.title || '',
            recommendation_text: recommendation?.recommendation_text || '',
            priority_order: recommendation?.priority_order ?? null,
          }))
        : [],
    }));

  return {
    total_checks: history.screenings.length,
    latest_condition: history.latestScreening?.detected_condition || '',
    latest_check_at: history.latestScreening?.created_at || '',
    latest_result: latestEntry?.screening
      ? {
          created_at: latestEntry.screening.created_at || '',
          detected_condition: latestEntry.screening.detected_condition || '',
          decision: latestEntry.screening.decision || '',
          summary: latestEntry.screening.summary || '',
          estimated_length: latestEntry.screening.estimated_length ?? null,
        }
      : null,
    latest_recommendations: Array.isArray(latestEntry?.recommendations)
      ? latestEntry.recommendations
        .slice(0, 4)
        .map((recommendation) => ({
          title: recommendation?.title || '',
          recommendation_text: recommendation?.recommendation_text || '',
          priority_order: recommendation?.priority_order ?? null,
        }))
      : [],
    entries,
  };
};

const buildHistoryTrendLabel = (submissions = []) => {
  const screenings = submissions
    .flatMap((submission) => submission?.ai_screenings || [])
    .filter((screening) => screening?.created_at && screening?.detected_condition)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, 2);

  if (screenings.length < 2) return '';

  const scoreCondition = (condition = '') => {
    const normalized = String(condition || '').toLowerCase();
    if (normalized.includes('healthy') || normalized.includes('good')) return 3;
    if (normalized.includes('dry') || normalized.includes('frizz')) return 2;
    if (normalized.includes('damaged') || normalized.includes('treated')) return 1;
    return 2;
  };

  const latestScore = scoreCondition(screenings[0]?.detected_condition);
  const previousScore = scoreCondition(screenings[1]?.detected_condition);

  if (latestScore > previousScore) return 'Trend looks better than your last check.';
  if (latestScore < previousScore) return 'Trend suggests your hair may need more care than last time.';
  return 'Trend looks similar to your last hair check.';
};

const buildRetryCountdownMessage = (errorState, secondsRemaining) => {
  if (!errorState) return '';
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) {
    const normalizedMessage = String(errorState.message || '');
    if (/retry\s+in\s+\d+(?:\.\d+)?\s*seconds?/i.test(normalizedMessage)) {
      return 'Hair analysis is ready to try again.';
    }
    return normalizedMessage || 'Hair analysis is busy right now. Please try again in a moment.';
  }

  return `Hair analysis is busy right now. Please wait ${secondsRemaining} seconds, then try again.`;
};

const WEEKLY_SCAN_INTERVAL_DAYS = 7;
const WEEKLY_SCAN_INTERVAL_MS = WEEKLY_SCAN_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

const formatWeeklyScanDateTime = (value) => {
  if (!value) return 'next week';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'next week';

  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const getLatestAiRecommendation = (entry = null) => {
  const recommendations = Array.isArray(entry?.recommendations)
    ? [...entry.recommendations].sort((left, right) => (
      Number(left?.priority_order || 99) - Number(right?.priority_order || 99)
    ))
    : [];

  return recommendations.find((recommendation) => (
    String(recommendation?.recommendation_text || recommendation?.title || '').trim()
  )) || null;
};

const buildWeeklyScanTip = (latestEntry = null) => {
  const screening = latestEntry?.screening || null;
  const condition = String(screening?.detected_condition || '').trim();
  const summary = String(screening?.summary || '').trim();
  const recommendation = getLatestAiRecommendation(latestEntry);
  const recommendationTitle = String(recommendation?.title || '').trim();
  const recommendationText = String(recommendation?.recommendation_text || '').trim();
  const normalizedCondition = condition.toLowerCase();
  const isHealthy = normalizedCondition.includes('healthy')
    && !normalizedCondition.includes('dry')
    && !normalizedCondition.includes('damage')
    && !normalizedCondition.includes('frizz')
    && !normalizedCondition.includes('oily');

  if (isHealthy) {
    if (recommendationText) {
      return `Your last AI scan marked your hair as ${condition}. To maintain it this week: ${recommendationText}`;
    }
    if (summary) {
      return `Your last AI scan marked your hair as ${condition}. Keep the same routine this week and avoid extra heat or chemical treatment so the next scan can compare your progress clearly.`;
    }
    return 'Your last AI scan looked healthy. Maintain your current routine this week, protect the ends, and avoid extra heat styling before your next scan.';
  }

  if (recommendationText) {
    return `Based on your last AI result${condition ? ` showing ${condition}` : ''}, focus on this before the next scan: ${recommendationTitle ? `${recommendationTitle} - ` : ''}${recommendationText}`;
  }

  if (summary) {
    return `Your last AI scan noted: ${summary} Use this week to follow the care advice from your saved result before scanning again.`;
  }

  return 'Use this week to follow your saved hair-care recommendations before scanning again, so the next AI result can show a more meaningful change.';
};

const buildWeeklyScanLimitState = (latestEntry = null, now = Date.now()) => {
  const latestScanTime = new Date(latestEntry?.screening?.created_at || 0).getTime();
  if (!Number.isFinite(latestScanTime) || latestScanTime <= 0) {
    return {
      isLocked: false,
      nextScanDate: null,
      nextScanLabel: '',
      lastScanLabel: '',
      tip: '',
      message: '',
    };
  }

  const nextScanDate = new Date(latestScanTime + WEEKLY_SCAN_INTERVAL_MS);
  const isLocked = now < nextScanDate.getTime();
  const nextScanLabel = formatWeeklyScanDateTime(nextScanDate);
  const lastScanLabel = formatWeeklyScanDateTime(new Date(latestScanTime));
  const tip = buildWeeklyScanTip(latestEntry);

  return {
    isLocked,
    nextScanDate,
    nextScanLabel,
    lastScanLabel,
    tip,
    message: isLocked
      ? `You already used your AI hair scan for this week. You can scan again on ${nextScanLabel}. Fun fact: weekly scanning gives your hair enough time to show clearer changes in length, shine, dryness, frizz, and visible damage.`
      : '',
  };
};

function HairConditionLogCard({
  submissions,
  registeredDrives = [],
  onOpenAnalyzer,
  onSelectDate,
  trendLabel = '',
}) {
  const history = useMemo(
    () => buildHairActivityHistory({ submissions, registeredDrives }),
    [registeredDrives, submissions]
  );
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [calendarMode, setCalendarMode] = useState('week');
  const [pressedDateKey, setPressedDateKey] = useState('');
  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const weekDays = useMemo(() => buildWeekDays(new Date()), []);
  const visibleDays = calendarMode === 'week' ? weekDays : calendarDays;
  const hasHistory = history.markers.size > 0;
  const latestScreeningTime = new Date(history.latestScreening?.created_at || 0).getTime();
  const latestEventTime = new Date(getRegisteredDriveActivityDate(history.latestEvent) || 0).getTime();
  const latestActivityType = latestEventTime > latestScreeningTime ? 'event' : 'screening';
  const latestTone = latestActivityType === 'event'
    ? {
        dotColor: theme.colors.brandPrimary,
        label: 'Registered event',
        icon: 'calendar-check-outline',
        iconColor: theme.colors.brandPrimary,
        toneSurface: theme.colors.brandPrimaryMuted,
      }
    : normalizeConditionTone(history.latestScreening?.detected_condition);
  const latestLengthLabel = history.latestScreening?.estimated_length
    ? formatLengthLabel(history.latestScreening.estimated_length)
    : '';
  const latestSummary = latestActivityType === 'event'
    ? `Registered for ${history.latestEvent?.event_title || 'a donation event'}.`
    : (history.latestScreening?.summary || 'No summary yet.');
  const latestDateKey = history.latestScreening?.created_at
    ? toLocalDateKey(history.latestScreening.created_at)
    : '';
  const latestActivityDate = latestActivityType === 'event'
    ? getRegisteredDriveActivityDate(history.latestEvent)
    : history.latestScreening?.created_at;

  useEffect(() => {
    if (!latestActivityDate) return;

    const latestMonth = new Date(latestActivityDate);
    if (Number.isNaN(latestMonth.getTime())) return;

    setVisibleMonth(new Date(latestMonth.getFullYear(), latestMonth.getMonth(), 1));
  }, [latestActivityDate]);

  if (!hasHistory) {
    return (
      <Pressable
        onPress={onOpenAnalyzer}
        accessibilityRole="button"
        accessibilityLabel="Start hair check"
        style={({ pressed }) => [styles.emptyCalendarState, pressed ? styles.interactivePressed : null]}
      >
        <EmptyDataState
          compact
          showCountBadge={false}
          title="No hair checks yet"
        />
      </Pressable>
    );
  }

  return (
    <View style={styles.calendarWidget}>
      <View style={styles.calendarLeadCard}>
        <View style={[styles.calendarLeadIconWrap, { backgroundColor: latestTone.toneSurface }]}>
          <AppIcon name={latestTone.icon} size="lg" color={latestTone.iconColor} />
        </View>
        <View style={styles.calendarLeadCopy}>
          <Text style={styles.calendarLeadTitle}>{latestTone.label}</Text>
          <Text style={styles.calendarLeadBody} numberOfLines={1}>
            {latestSummary}
          </Text>
        </View>
        <View style={styles.calendarLeadMeta}>
          <Text style={styles.calendarLeadMetaValue}>{formatCalendarDayLabel(latestActivityDate)}</Text>
          <View style={[styles.calendarLeadStatusChip, { backgroundColor: latestTone.toneSurface }]}>
            <View style={[styles.conditionDot, { backgroundColor: latestTone.dotColor }]} />
            <Text style={[styles.calendarLeadStatusText, { color: latestTone.iconColor }]}>{latestTone.label}</Text>
          </View>
        </View>
      </View>

      <View style={styles.calendarHeaderRow}>
        <View style={styles.calendarHeaderCopy}>
          <Text style={styles.calendarMonthLabel}>
            {calendarMode === 'week' ? 'This week' : formatCalendarMonthLabel(visibleMonth)}
          </Text>
          <Text style={styles.calendarSummaryText}>
            {history.screenings.length} check{history.screenings.length === 1 ? '' : 's'} • {history.registeredEvents.length} event{history.registeredEvents.length === 1 ? '' : 's'}
          </Text>
        </View>

        <View style={styles.calendarModeSwitch}>
          {['week', 'month'].map((mode) => (
            <Pressable
              key={mode}
              onPress={() => setCalendarMode(mode)}
              style={[styles.calendarModeButton, calendarMode === mode ? styles.calendarModeButtonActive : null]}
            >
              <Text style={[styles.calendarModeText, calendarMode === mode ? styles.calendarModeTextActive : null]}>
                {mode === 'week' ? 'Week' : 'Month'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {calendarMode === 'month' ? (
        <View style={styles.calendarMonthControls}>
          <Pressable
            onPress={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            style={styles.calendarMonthButton}
          >
            <AppIcon name="chevron-left" size="sm" state="muted" />
          </Pressable>
          <Pressable
            onPress={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
            style={styles.calendarMonthButton}
          >
            <AppIcon name="chevron-right" size="sm" state="muted" />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.weekdayRow}>
        {weekdayLabels.map((label) => (
          <Text key={label} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      <View style={[styles.calendarGrid, calendarMode === 'week' ? styles.calendarGridWeek : null]}>
        {visibleDays.map((day) => {
          const key = toLocalDateKey(day); // local calendar date — avoids UTC midnight shift
          const dateEntries = history.markers.get(key) || { screenings: [], events: [] };
          const screeningEntries = dateEntries.screenings || [];
          const eventEntries = dateEntries.events || [];
          const screening = screeningEntries[0]?.screening || null;
          const tone = screening
            ? normalizeConditionTone(screening?.detected_condition)
            : {
                dotColor: theme.colors.brandPrimary,
                label: 'Registered event',
                icon: 'calendar-check-outline',
                iconColor: theme.colors.brandPrimary,
                toneSurface: theme.colors.brandPrimaryMuted,
              };
          const isCurrentMonth = day.getMonth() === visibleMonth.getMonth();
          const isPressed = pressedDateKey === key;
          const activityCount = screeningEntries.length + eventEntries.length;

          return (
            <Pressable
              key={key}
              disabled={!activityCount}
              onPressIn={() => setPressedDateKey(key)}
              onPressOut={() => setPressedDateKey('')}
              onPress={() => {
                if (activityCount) onSelectDate?.(key, screeningEntries, eventEntries);
              }}
              style={[
                styles.calendarCell,
                calendarMode === 'week' ? styles.calendarCellWeek : null,
                activityCount ? styles.calendarCellActive : null,
                key === latestDateKey ? styles.calendarCellLatest : null,
                calendarMode === 'month' && !isCurrentMonth ? styles.calendarCellMuted : null,
                isPressed ? styles.interactivePressed : null,
              ]}
            >
              {activityCount ? (
                <View style={[styles.calendarCellIconWrap, { backgroundColor: tone.toneSurface }]}>
                  <AppIcon name={tone.icon} size="sm" color={tone.iconColor} />
                </View>
              ) : (
                <View style={styles.calendarCellPlaceholder} />
              )}
              <Text style={styles.calendarCellLabel}>{day.getDate()}</Text>
              {activityCount > 1 ? <Text style={styles.calendarCellCount}>{activityCount}</Text> : null}
              <View
                style={[
                  styles.conditionDot,
                  { backgroundColor: activityCount ? tone.dotColor : theme.colors.transparent },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.calendarSupportRow}>
        <View style={styles.calendarSupportCard}>
          <Text style={styles.calendarSupportLabel}>Hair checks</Text>
          <Text style={styles.calendarSupportValue}>{history.screenings.length}</Text>
        </View>
        <View style={styles.calendarSupportCard}>
          <Text style={styles.calendarSupportLabel}>Registered events</Text>
          <Text style={styles.calendarSupportValue}>{history.registeredEvents.length}</Text>
        </View>
        {history.latestEvent ? (
          <View style={styles.calendarSupportCard}>
            <Text style={styles.calendarSupportLabel}>Latest event</Text>
            <Text style={styles.calendarSupportValue}>{formatCalendarDayLabel(getRegisteredDriveActivityDate(history.latestEvent))}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.calendarQuickStats}>
        <Text style={styles.calendarQuickStat}>
          {latestLengthLabel || (latestActivityType === 'event' ? 'Registered event saved' : latestTone.label)}
        </Text>
        {trendLabel ? <Text style={styles.calendarQuickStat}>{trendLabel}</Text> : null}
      </View>
    </View>
  );
}

export function DonorHairSubmissionScreen() {
  const router = useRouter();
  const cameraRef = useRef(null);
  const lastTransientErrorKeyRef = useRef('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isAnalyzerActive, setIsAnalyzerActive] = useState(true);
  const [hasAcknowledgedRequirementIntro, setHasAcknowledgedRequirementIntro] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [, setCameraModalError] = useState('');
  const [nativeCameraPermission, setNativeCameraPermission] = useState('not-determined');
  const [cameraFacing, setCameraFacing] = useState('front');
  const [flashMode, setFlashMode] = useState('off');
  const [previewImageUri, setPreviewImageUri] = useState('');
  const [previewImageUris, setPreviewImageUris] = useState([]);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const [liveFaceStatus, setLiveFaceStatus] = useState(getInitialLiveFaceStatus);
  const [liveFrameBrightness, setLiveFrameBrightness] = useState(-1);
  const lastLiveFaceStatusKeyRef = useRef('');
  const autoCaptureTimeoutRef = useRef(null);
  const autoCaptureCooldownUntilRef = useRef(0);
  const autoCaptureActiveKeyRef = useRef('');
  const latestAutoCaptureRef = useRef(null);
  const photoPreflightKeyRef = useRef('');
  const captureSessionIdRef = useRef(`cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const pendingQuestionAdvanceTimeoutRef = useRef(null);
  const questionContentOpacity = useRef(new Animated.Value(1)).current;
  const readinessEntrance = useRef(new Animated.Value(0)).current;
  const readinessPulse = useRef(new Animated.Value(0)).current;
  const [autoCaptureCountdown, setAutoCaptureCountdown] = useState(0);
  const [analysisHistory, setAnalysisHistory] = useState([]);
  const [registeredEventDrives, setRegisteredEventDrives] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [selectedHistoryDate, setSelectedHistoryDate] = useState('');
  const [selectedHistoryEntries, setSelectedHistoryEntries] = useState([]);
  const [selectedHistoryEvents, setSelectedHistoryEvents] = useState([]);
  const [, setResultConfirmationMode] = useState('pending');
  const [retryCountdownSeconds, setRetryCountdownSeconds] = useState(0);
  const [transientErrorNotice, setTransientErrorNotice] = useState(null);
  const [photoPreflightState, setPhotoPreflightState] = useState(null);
  const [isPhotoPreflightRunning, setIsPhotoPreflightRunning] = useState(false);
  const [isAnalysisLaunching, setIsAnalysisLaunching] = useState(false);
  const [analysisReviewValues, setAnalysisReviewValues] = useState(() => buildHairReviewDefaultValues(null));
  const [isEditingAnalysisReview, setIsEditingAnalysisReview] = useState(false);
  const { user, profile, resolvedTheme } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const roles = resolveThemeRoles(resolvedTheme);
  const {
    unreadCount,
  } = useNotifications({
    role: 'donor',
    userId: user?.id,
    userEmail: user?.email || profile?.email || '',
    databaseUserId: profile?.user_id,
    mode: 'badge',
    liveUpdates: true,
  });
  const {
    photos,
    requiredViews,
    analysis,
    donationRequirement,
    error,
    successMessage,
    isLoadingContext,
    isPickingImages,
    isCapturingImages,
    isAnalyzing,
    isSaving,
    completedPhotoCount,
    savePhotoAssetForSlot,
    removePhoto,
    analyzePhotos,
    submitSubmission,
    resetFlow,
    clearAnalysisError,
  } = useDonorHairSubmission({ userId: user?.id, databaseUserId: profile?.user_id });

  const questionForm = useForm({
    resolver: zodResolver(hairAnalyzerQuestionSchema),
    mode: 'onChange',
    defaultValues: hairAnalyzerQuestionDefaultValues,
  });
  const complianceForm = useForm({
    resolver: zodResolver(hairAnalyzerComplianceSchema),
    mode: 'onChange',
    defaultValues: hairAnalyzerComplianceDefaultValues,
  });
  const [questionnaireDraftAnswers, setQuestionnaireDraftAnswers] = useState(() => ({
    ...hairAnalyzerQuestionDefaultValues,
  }));
  const questionnaireValues = useWatch({ control: questionForm.control });
  const complianceAcknowledged = useWatch({ control: complianceForm.control, name: 'acknowledged' });
  const savedHistory = useMemo(() => buildHairConditionHistory(analysisHistory), [analysisHistory]);
  const isReturningUser = savedHistory.entries.length > 0;
  const questionnaireMode = isReturningUser ? 'returning_follow_up' : 'first_time';
  const effectiveQuestionnaireValues = useMemo(() => ({
    ...hairAnalyzerQuestionDefaultValues,
    ...questionForm.getValues(),
    ...(questionnaireValues || {}),
    ...questionnaireDraftAnswers,
    questionnaireMode,
  }), [questionForm, questionnaireDraftAnswers, questionnaireMode, questionnaireValues]);
  const getCurrentQuestionnaireAnswers = React.useCallback((overrides = {}) => ({
    ...hairAnalyzerQuestionDefaultValues,
    ...questionForm.getValues(),
    ...(questionnaireValues || {}),
    ...questionnaireDraftAnswers,
    questionnaireMode,
    ...overrides,
  }), [questionForm, questionnaireDraftAnswers, questionnaireMode, questionnaireValues]);
  const donorProfileCompletionMeta = useMemo(() => buildProfileCompletionMeta({
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
  }), [
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
  const isDonorProfileComplete = donorProfileCompletionMeta.isComplete;

  useEffect(() => {
    questionForm.setValue('questionnaireMode', questionnaireMode, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
    setQuestionnaireDraftAnswers((current) => ({
      ...current,
      questionnaireMode,
    }));
  }, [questionForm, questionnaireMode]);

  useEffect(() => {
    if (!isDonorProfileComplete && isAnalyzerActive) {
      setIsAnalyzerActive(false);
    }
  }, [isAnalyzerActive, isDonorProfileComplete]);

  useEffect(() => {
    if (stepIndex !== 1) {
      readinessEntrance.stopAnimation();
      readinessPulse.stopAnimation();
      readinessEntrance.setValue(0);
      readinessPulse.setValue(0);
      return undefined;
    }

    readinessEntrance.setValue(0);
    readinessPulse.setValue(0);
    Animated.spring(readinessEntrance, {
      toValue: 1,
      friction: 8,
      tension: 54,
      useNativeDriver: true,
    }).start();

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(readinessPulse, {
          toValue: 1,
          duration: 1250,
          useNativeDriver: true,
        }),
        Animated.timing(readinessPulse, {
          toValue: 0,
          duration: 1250,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseAnimation.start();

    return () => {
      readinessEntrance.stopAnimation();
      pulseAnimation.stop();
    };
  }, [readinessEntrance, readinessPulse, stepIndex]);

  useEffect(() => {
    if (!canUseNativeLiveCamera || !NativeVisionCamera?.getCameraPermissionStatus) return;

    let mounted = true;
    Promise.resolve(NativeVisionCamera.getCameraPermissionStatus())
      .then((status) => {
        if (mounted) setNativeCameraPermission(status || 'not-determined');
      })
      .catch(() => {
        if (mounted) setNativeCameraPermission('not-determined');
      });

    return () => {
      mounted = false;
    };
  }, [canUseNativeLiveCamera]);

  const visibleQuestions = useMemo(
    () => getVisibleQuestions(effectiveQuestionnaireValues, questionnaireMode),
    [effectiveQuestionnaireValues, questionnaireMode]
  );
  const currentQuestion = visibleQuestions[questionIndex] || visibleQuestions[0];
  const currentQuestionMatterText = getQuestionMatterText(currentQuestion, effectiveQuestionnaireValues);
  const questionContentAnimatedStyle = {
    opacity: questionContentOpacity,
  };
  const readinessAnimatedStyle = {
    opacity: readinessEntrance,
    transform: [{
      translateY: readinessEntrance.interpolate({
        inputRange: [0, 1],
        outputRange: [18, 0],
      }),
    }],
  };
  const readinessPulseStyle = {
    transform: [{
      scale: readinessPulse.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.06],
      }),
    }],
  };
  const currentView = requiredViews[photoIndex];
  const currentPhoto = photos[photoIndex];
  const photoReviewValidationKey = useMemo(() => (
    photos
      .map((photo, index) => `${requiredViews[index]?.key || index}:${photo?.uri || ''}:${String(photo?.dataUrl || '').length}`)
      .join('|')
  ), [photos, requiredViews]);
  const canUseNativeLiveCamera = Boolean(
    NativeVisionCamera
    && useNativeCameraDevice
    && useNativeFrameProcessor
    && useNativeFaceDetector
    && NativeWorklets?.createRunOnJS
  );
  const hasCameraPermission = canUseNativeLiveCamera
    ? nativeCameraPermission === 'granted'
    : Boolean(cameraPermission?.granted);
  const toggleCameraFacing = React.useCallback(() => {
    setCameraFacing((current) => (current === 'front' ? 'back' : 'front'));
    setFlashMode('off');
    const initialStatus = getInitialLiveFaceStatus(currentView);
    lastLiveFaceStatusKeyRef.current = '';
    setLiveFaceStatus(initialStatus);
    setLiveFrameBrightness(-1);
  }, [currentView]);
  const toggleFlashMode = React.useCallback(() => {
    if (cameraFacing !== 'back') {
      setFlashMode('off');
      setCameraModalError('Flash is available only on supported rear cameras.');
      return;
    }
    setCameraModalError('');
    setFlashMode((current) => (current === 'on' ? 'off' : 'on'));
  }, [cameraFacing]);

  const stepTitles = useMemo(() => ([
    'Hair History',
    'Scan Readiness',
    'Camera Scan',
    'AI Result',
  ]), []);
  const latestAnalyzedSubmission = useMemo(
    () => analysisHistory.find((submission) => Array.isArray(submission?.ai_screenings) && submission.ai_screenings.length) || null,
    [analysisHistory]
  );
  const latestSavedScreening = latestAnalyzedSubmission?.ai_screenings?.[0] || null;
  const hasSavedAnalysis = Boolean(latestAnalyzedSubmission && latestSavedScreening);
  const latestTrendLabel = useMemo(() => buildHistoryTrendLabel(analysisHistory), [analysisHistory]);
  const weeklyScanLimit = useMemo(
    () => buildWeeklyScanLimitState(savedHistory.latestEntry),
    [savedHistory.latestEntry]
  );
  const shouldShowRequirementIntro = (
    isDonorProfileComplete
    && isAnalyzerActive
    && stepIndex === 0
    && questionIndex === 0
    && !isLoadingContext
    && !isLoadingHistory
    && !weeklyScanLimit.isLocked
    && !hasAcknowledgedRequirementIntro
  );
  const isRetryCooldownActive = Boolean(error?.retryUntil && retryCountdownSeconds > 0);
  const countdownErrorMessage = useMemo(
    () => buildRetryCountdownMessage(error, retryCountdownSeconds),
    [error, retryCountdownSeconds]
  );
  const pageErrorState = useMemo(
    () => error ? {
      ...error,
      message: countdownErrorMessage || error.message,
    } : null,
    [countdownErrorMessage, error]
  );
  const analysisAttemptInFlightRef = useRef(false);

  const runFreshAnalysisAttempt = React.useCallback(async (source, options = {}) => {
    if (weeklyScanLimit.isLocked) {
      logAppEvent('donor_hair_submission.weekly_limit', 'Weekly AI hair scan limit prevented a new provider request.', {
        userId: user?.id || null,
        source,
        latestCheckAt: savedHistory.latestScreening?.created_at || null,
        nextScanAt: weeklyScanLimit.nextScanDate?.toISOString?.() || null,
      }, 'info');
      return {
        success: false,
        error: weeklyScanLimit.message,
        weeklyLimit: true,
        nextScanDate: weeklyScanLimit.nextScanDate,
      };
    }

    if (analysisAttemptInFlightRef.current) {
      logAppEvent('donor_hair_submission.analysis_retry', 'Duplicate donor hair analysis trigger skipped while an attempt is already running.', {
        userId: user?.id || null,
        source,
      }, 'info');
      return {
        success: false,
        pending: true,
        skipped: true,
      };
    }

    analysisAttemptInFlightRef.current = true;

    logAppEvent('donor_hair_submission.analysis_retry', 'Retry button tapped for a fresh donor hair analysis attempt.', {
      userId: user?.id || null,
      source,
      previousErrorTitle: error?.title || null,
      previousRetryUntil: error?.retryUntil ?? null,
    });

    clearAnalysisError();
    setTransientErrorNotice(null);
    setRetryCountdownSeconds(0);

    logAppEvent('donor_hair_submission.analysis_retry', 'Stale donor hair analysis state cleared before retry.', {
      userId: user?.id || null,
      source,
      clearedRetryState: true,
    });

    const currentAnswers = getCurrentQuestionnaireAnswers();
    try {
      return await analyzePhotos({
        questionnaireAnswers: {
          ...currentAnswers,
        },
        complianceContext: { acknowledged: Boolean(complianceAcknowledged) },
        historyContext: buildAnalysisHistoryContext(analysisHistory),
        correctedDetails: options.correctedDetails || null,
        allowPhotoQualityFallback: Boolean(options.allowPhotoQualityFallback),
      });
    } finally {
      analysisAttemptInFlightRef.current = false;
    }
  }, [
    analysisHistory,
    analyzePhotos,
    clearAnalysisError,
    complianceAcknowledged,
    error?.title,
    getCurrentQuestionnaireAnswers,
    error?.retryUntil,
    savedHistory.latestScreening?.created_at,
    user?.id,
    weeklyScanLimit.isLocked,
    weeklyScanLimit.message,
    weeklyScanLimit.nextScanDate,
  ]);

  const loadAnalysisHistory = React.useCallback(async () => {
    if (!user?.id) return;

    setIsLoadingHistory(true);
    setHistoryError('');

    const [submissionsResult, registeredDrivesResult] = await Promise.all([
      fetchHairSubmissionsByUserId(user.id, 12),
      fetchRegisteredDonationDrivesByUserId({
        databaseUserId: profile?.user_id || null,
        limit: 24,
      }),
    ]);
    const submissions = submissionsResult.data || [];
    const registeredDrives = registeredDrivesResult.data || [];
    setAnalysisHistory(submissions);
    setRegisteredEventDrives(registeredDrives);

    if (submissionsResult.error || registeredDrivesResult.error) {
      setHistoryError(
        registeredDrivesResult.error?.isTransient
          ? registeredDrivesResult.error.message
          : 'Calendar history could not be loaded right now. Pull down to try again.',
      );
    }

    setIsLoadingHistory(false);
  }, [profile?.user_id, user?.id]);

  useEffect(() => {
    loadAnalysisHistory();
  }, [loadAnalysisHistory]);

  useEffect(() => {
    if (successMessage) {
      setIsAnalyzerActive(false);
      loadAnalysisHistory();
    }
  }, [loadAnalysisHistory, successMessage]);

  useEffect(() => {
    setResultConfirmationMode('pending');
    if (!analysis) {
      setAnalysisReviewValues(buildHairReviewDefaultValues(null));
      setIsEditingAnalysisReview(false);
      return;
    }

    const donationAssessment = buildDonationAssessment({ analysis, donationRequirement });
    const analysisForReview = buildDonationAlignedAnalysis(analysis, donationAssessment);
    const defaults = buildHairReviewDefaultValues(analysisForReview);

    setAnalysisReviewValues({
      ...defaults,
      declaredTexture: normalizeReviewOption(defaults.declaredTexture, HAIR_TEXTURE_REVIEW_OPTIONS) || defaults.declaredTexture,
      declaredDensity: normalizeReviewOption(defaults.declaredDensity, HAIR_DENSITY_REVIEW_OPTIONS) || defaults.declaredDensity,
    });
    setIsEditingAnalysisReview(false);
  }, [analysis, donationRequirement]);

  useEffect(() => {
    if (!error?.retryUntil) {
      setRetryCountdownSeconds(0);
      lastTransientErrorKeyRef.current = '';
      return undefined;
    }

    const activeRetryUntil = Number(error.retryUntil);
    let didClearExpiredState = false;

    logAppEvent('donor_hair_submission.analysis_retry', 'Countdown started for provider retry wait.', {
      userId: user?.id || null,
      retryUntil: activeRetryUntil,
      retryAfterSeconds: error?.retryAfterSeconds ?? null,
    });

    const updateCountdown = () => {
      const remainingSeconds = Math.max(0, Math.ceil((activeRetryUntil - Date.now()) / 1000));
      setRetryCountdownSeconds(remainingSeconds);

      if (remainingSeconds === 0 && !didClearExpiredState) {
        didClearExpiredState = true;
        logAppEvent('donor_hair_submission.analysis_retry', 'Countdown ended. Clearing stale provider error state.', {
          userId: user?.id || null,
          retryUntil: activeRetryUntil,
        });
        clearAnalysisError();
        setTransientErrorNotice(null);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [clearAnalysisError, error?.retryAfterSeconds, error?.retryUntil, user?.id]);

  useEffect(() => {
    if (!error) {
      lastTransientErrorKeyRef.current = '';
      setTransientErrorNotice(null);
      return undefined;
    }

    const transientErrorKey = `${error.title || 'error'}:${error.message || ''}:${error.retryUntil || 'none'}`;
    if (lastTransientErrorKeyRef.current === transientErrorKey) {
      return undefined;
    }

    lastTransientErrorKeyRef.current = transientErrorKey;
    logAppEvent('donor_hair_submission.analysis_retry', 'Transient provider error popup shown.', {
      userId: user?.id || null,
      title: error.title,
      retryUntil: error?.retryUntil ?? null,
    });
    setTransientErrorNotice({
      title: error.title,
      message: error.message,
    });
    return undefined;
  }, [error, user?.id]);

  const openHistoryDate = React.useCallback((dateKey, entries, events = []) => {
    setSelectedHistoryDate(dateKey);
    setSelectedHistoryEntries(entries || []);
    setSelectedHistoryEvents(events || []);
  }, []);

  const closeAnalyzerToHome = React.useCallback(() => {
    setIsAnalyzerActive(false);
    router.replace('/donor/donations');
  }, [router]);

  const openAnalyzerWithRequirements = React.useCallback(() => {
    setHasAcknowledgedRequirementIntro(false);
    setQuestionIndex(0);
    setStepIndex(0);
    setIsAnalyzerActive(true);
  }, []);

  const openScanImagePreview = React.useCallback((uri, galleryPhotos = []) => {
    if (!uri) return;
    const fallbackGallery = photos
      .map((photo, index) => ({
        uri: photo?.uri || '',
        label: requiredViews[index]?.label || photo?.viewLabel || `Photo ${index + 1}`,
      }))
      .filter((photo) => photo.uri);
    const gallery = (Array.isArray(galleryPhotos) && galleryPhotos.length ? galleryPhotos : fallbackGallery)
      .map((photo, index) => ({
        uri: typeof photo === 'string' ? photo : photo?.uri || '',
        label: typeof photo === 'string'
          ? `Photo ${index + 1}`
          : photo?.label || photo?.viewLabel || requiredViews[index]?.label || `Photo ${index + 1}`,
      }))
      .filter((photo) => photo.uri);
    const galleryIndex = Math.max(0, gallery.findIndex((photo) => photo.uri === uri));

    logAppEvent('donor_hair_submission.scan_preview', 'Full scan image preview opened from analysis result.', {
      userId: user?.id || null,
      hasUri: Boolean(uri),
      galleryCount: gallery.length || 1,
      galleryIndex: galleryIndex >= 0 ? galleryIndex : 0,
    });
    setPreviewImageUris(gallery.length ? gallery : [{ uri, label: 'Photo 1' }]);
    setPreviewImageIndex(galleryIndex >= 0 ? galleryIndex : 0);
    setPreviewImageUri(uri);
  }, [photos, requiredViews, user?.id]);

  useEffect(() => {
    logAppEvent('donor_hair_submission.flow', 'Donor screening flow initialized without intro wizard steps.', {
      userId: user?.id || null,
      databaseUserId: profile?.user_id || null,
      visibleSteps: stepTitles,
    });
  }, [profile?.user_id, stepTitles, user?.id]);

  const canMovePastQuestion = isAnswered(currentQuestion, effectiveQuestionnaireValues);
  const isCurrentPhotoComplete = Boolean(photos[photoIndex]);
  const isNextDisabled = (
    (stepIndex === 0 && !canMovePastQuestion)
    || (stepIndex === 2 && !isCurrentPhotoComplete)
    || (stepIndex === 3 && (!analysis || isAnalyzing || isSaving))
  );

  const nextButtonTitle = useMemo(() => {
    if (stepIndex === 0) return questionIndex === visibleQuestions.length - 1 ? 'Continue' : 'Next';
    if (stepIndex === 1) return 'Start Camera Scan';
    if (stepIndex === 2) return photoIndex === requiredViews.length - 1 ? 'Analyze' : 'Next';
    return analysis ? (isSaving ? 'Saving...' : 'Save to hair log') : 'Retry analysis';
  }, [analysis, isSaving, photoIndex, questionIndex, requiredViews.length, stepIndex, visibleQuestions.length]);

  const runQuestionTransition = React.useCallback((applyQuestionChange) => {
    Animated.timing(questionContentOpacity, {
      toValue: 0,
      duration: QUESTION_TRANSITION_FADE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (typeof applyQuestionChange === 'function') {
        applyQuestionChange();
      }

      if (!finished) return;

      requestAnimationFrame(() => {
        Animated.timing(questionContentOpacity, {
          toValue: 1,
          duration: QUESTION_TRANSITION_FADE_MS,
          useNativeDriver: true,
        }).start();
      });
    });
  }, [questionContentOpacity]);

  useEffect(() => (
    () => {
      if (pendingQuestionAdvanceTimeoutRef.current) {
        clearTimeout(pendingQuestionAdvanceTimeoutRef.current);
        pendingQuestionAdvanceTimeoutRef.current = null;
      }
    }
  ), []);

  const saveConfirmedAnalysis = async () => {
    if (!analysis) return;
    const donationAssessment = buildDonationAssessment({ analysis, donationRequirement });
    const analysisForSave = buildDonationAlignedAnalysis(analysis, donationAssessment);

    logAppEvent('donor_hair_submission.confirmation', 'User confirmed AI result for saving.', {
      userId: user?.id || null,
      analysisKeys: Object.keys(analysisForSave || {}),
      adjustedDecision: analysisForSave?.decision || null,
      humanReviewedSpecs: true,
    });

    const currentAnswers = getCurrentQuestionnaireAnswers();
    const confirmedReviewValues = buildHumanReviewValuesForSave(analysisReviewValues, analysisForSave);
    const result = await submitSubmission(confirmedReviewValues, {
      questionnaireAnswers: {
        ...currentAnswers,
      },
      aiAnalysisOverride: analysisForSave,
      donationModeValue: '',
    });

    if (result?.success) {
      invalidateHairAnalysisHomeCache(user?.id);
      questionForm.reset({
        ...hairAnalyzerQuestionDefaultValues,
        questionnaireMode,
      });
      setQuestionnaireDraftAnswers({
        ...hairAnalyzerQuestionDefaultValues,
        questionnaireMode,
      });
      complianceForm.reset(hairAnalyzerComplianceDefaultValues);
      setAnalysisReviewValues(buildHairReviewDefaultValues(null));
      setIsEditingAnalysisReview(false);
      setQuestionIndex(0);
      setPhotoIndex(0);
      setStepIndex(0);
      setResultConfirmationMode('pending');
      setIsAnalyzerActive(false);
      router.replace('/donor/donations');
    }
  };

  const goToNextQuestionStep = (answersSnapshot = null, currentQuestionKey = currentQuestion?.key) => {
    const currentAnswersSnapshot = answersSnapshot || getCurrentQuestionnaireAnswers();
    const nextVisibleQuestions = getVisibleQuestions({
      ...currentAnswersSnapshot,
      questionnaireMode,
    }, questionnaireMode);
    const activeQuestionIndex = nextVisibleQuestions.findIndex((item) => item.key === currentQuestionKey);

    if (activeQuestionIndex >= 0 && activeQuestionIndex < nextVisibleQuestions.length - 1) {
      runQuestionTransition(() => {
        setQuestionIndex(activeQuestionIndex + 1);
      });
      return;
    }

    runQuestionTransition(() => {
      setStepIndex(1);
    });
  };

  const handleQuestionChoiceChange = async ({ fieldName, nextValue, fieldOnChange }) => {
    logAppEvent('donor_hair_submission.questionnaire', 'Question choice selected.', {
      userId: user?.id || null,
      questionKey: fieldName,
      questionType: currentQuestion?.type || null,
      value: nextValue,
    });

    questionForm.setValue(fieldName, nextValue, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: false,
    });
    setQuestionnaireDraftAnswers((current) => ({
      ...current,
      [fieldName]: nextValue,
      questionnaireMode,
    }));
    if (typeof fieldOnChange === 'function') {
      fieldOnChange(nextValue);
    }

    const nextAnswers = getCurrentQuestionnaireAnswers({ [fieldName]: nextValue });
    const isValid = isAnswered(currentQuestion, nextAnswers);

    logAppEvent('donor_hair_submission.questionnaire', 'Question choice validation completed.', {
      userId: user?.id || null,
      questionKey: fieldName,
      questionType: currentQuestion?.type || null,
      isValid,
    });

  };

  const goPrevious = React.useCallback(() => {
    if (stepIndex === 0 && questionIndex > 0) {
      runQuestionTransition(() => {
        setQuestionIndex((current) => current - 1);
      });
      return;
    }
    if (stepIndex === 2 && photoIndex > 0) {
      setPhotoIndex((current) => current - 1);
      return;
    }
    if (stepIndex > 0) {
      setStepIndex((current) => current - 1);
    }
  }, [photoIndex, questionIndex, runQuestionTransition, stepIndex]);

  const handleHeaderBack = React.useCallback(() => {
    if (stepIndex === 0) {
      closeAnalyzerToHome();
      return;
    }

    goPrevious();
  }, [closeAnalyzerToHome, goPrevious, stepIndex]);

  const requestLiveCameraPermission = React.useCallback(async () => {
    if (canUseNativeLiveCamera && NativeVisionCamera?.requestCameraPermission) {
      const status = await NativeVisionCamera.requestCameraPermission();
      setNativeCameraPermission(status || 'denied');
      if (status !== 'granted') {
        try {
          await Linking.openSettings();
        } catch (_settingsError) {
          // The app settings shortcut is best-effort; the permission message remains visible.
        }
      }
      return status === 'granted';
    }

    const permissionResult = await requestCameraPermission();
    if (!permissionResult?.granted && permissionResult?.canAskAgain === false) {
      try {
        await Linking.openSettings();
      } catch (_settingsError) {
        // The app settings shortcut is best-effort; the permission message remains visible.
      }
    }
    return Boolean(permissionResult?.granted);
  }, [canUseNativeLiveCamera, requestCameraPermission]);

  const handleLiveFacesChange = React.useCallback((faces = [], brightness = -1) => {
    const baseStatus = resolveLiveFaceStatus(faces, currentView);
    const nextStatus = brightness >= 0 && brightness < 82
      ? {
          ...baseStatus,
          valid: false,
          tone: 'warning',
          message: `Lighting is too low for a reliable scan. Move near bright indirect light and keep the ${getViewCaptureLabel(currentView).toLowerCase()} visible.`,
        }
      : baseStatus;
    const nextKey = `${nextStatus.valid}:${nextStatus.faceCount}:${nextStatus.message}`;
    if (lastLiveFaceStatusKeyRef.current !== nextKey) {
      lastLiveFaceStatusKeyRef.current = nextKey;
      setLiveFaceStatus(nextStatus);
    }
    setLiveFrameBrightness(brightness);
  }, [currentView]);

  const handleNativeCameraError = React.useCallback((cameraError) => {
    const code = String(cameraError?.code || cameraError?.name || '').toLowerCase();
    const message = String(cameraError?.message || cameraError || '').trim();
    const isRestricted = code.includes('camera-is-restricted') || message.toLowerCase().includes('restricted');

    logAppEvent('donor_hair_submission.camera.native_error', 'Native live camera reported an error.', {
      userId: user?.id || null,
      code: cameraError?.code || null,
      message,
      isRestricted,
    }, isRestricted ? 'warn' : 'error');

    if (isRestricted) {
      setNativeCameraPermission('restricted');
      setCameraModalError('Camera is restricted on this device. Camera access is required for this scan.');
      return;
    }

    setCameraModalError(message || 'Live camera is unavailable. Camera access is required for this scan.');
  }, [user?.id]);

  useEffect(() => {
    if (questionIndex > visibleQuestions.length - 1) {
      setQuestionIndex(Math.max(visibleQuestions.length - 1, 0));
    }
  }, [questionIndex, visibleQuestions.length]);

  useEffect(() => {
    if (stepIndex === 2) {
      const initialStatus = getInitialLiveFaceStatus(currentView);
      lastLiveFaceStatusKeyRef.current = '';
      setLiveFaceStatus(initialStatus);
      setLiveFrameBrightness(-1);
    }
  }, [cameraFacing, currentView, photoIndex, stepIndex]);

  const renderQuestionInput = () => {
    if (!currentQuestion) return null;
    const fieldName = currentQuestion.key;
    const fieldError = questionForm.formState.errors[fieldName]?.message;

    if (currentQuestion.type === 'number') {
      const minimumLengthPlaceholder = donationRequirement?.minimum_hair_length_inches
        ? String(donationRequirement.minimum_hair_length_inches)
        : '';
      return (
        <Controller
          control={questionForm.control}
          name={fieldName}
          render={({ field }) => (
            <AppInput
              label={currentQuestion.title}
              placeholder={minimumLengthPlaceholder || 'Length'}
              keyboardType="decimal-pad"
              variant="filled"
              helperText={currentQuestion.helperText}
              value={effectiveQuestionnaireValues?.[fieldName] ?? field.value}
              onChangeText={(nextValue) => {
                questionForm.setValue(fieldName, nextValue, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: false,
                });
                setQuestionnaireDraftAnswers((current) => ({
                  ...current,
                  [fieldName]: nextValue,
                  questionnaireMode,
                }));
                field.onChange(nextValue);
              }}
              onBlur={field.onBlur}
              error={fieldError}
            />
          )}
        />
      );
    }

    const questionSubtitle = getQuestionHelperText(currentQuestion);

    return (
      <View style={styles.questionContentCard}>
        <LinearGradient
          colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.questionHeroCard}
        >
          <View pointerEvents="none" style={styles.questionHeroGlowLarge} />
          <View pointerEvents="none" style={styles.questionHeroGlowSmall} />
          <View style={styles.questionHeroTopRow}>
            <View style={styles.questionHeroIdentity}>
              <View style={styles.questionHeroIcon}>
                <MaterialCommunityIcons name="head-heart-outline" size={21} color="#FFFFFF" />
              </View>
              <Text style={styles.questionHeroEyebrow}>
                {questionnaireMode === 'returning_follow_up' ? 'YOUR HAIR FOLLOW-UP' : 'YOUR HAIR PROFILE'}
              </Text>
            </View>
            <View style={styles.questionHeroStepChip}>
              <Text style={styles.questionHeroStepText}>{currentQuestion.multi ? 'SELECT ALL' : 'SELECT ONE'}</Text>
            </View>
          </View>
          <Text style={styles.questionHeroTitle}>{currentQuestion.title}</Text>
          {questionSubtitle ? <Text style={styles.questionHeroHelper}>{questionSubtitle}</Text> : null}
          <View style={styles.questionHeroProgressRow}>
            {visibleQuestions.map((question, index) => (
              <View
                key={question.key}
                style={[
                  styles.questionHeroProgressDot,
                  index <= questionIndex ? styles.questionHeroProgressDotActive : null,
                  index === questionIndex ? styles.questionHeroProgressDotCurrent : null,
                ]}
              />
            ))}
          </View>
        </LinearGradient>
        <Controller
          control={questionForm.control}
          name={fieldName}
          render={({ field }) => (
            <ChoiceList
              questionKey={currentQuestion.key}
              value={effectiveQuestionnaireValues?.[fieldName] ?? field.value}
              options={hairAnalyzerQuestionChoices[currentQuestion.optionsKey]}
              onChange={(nextValue) => {
                if (currentQuestion.type === 'choice') {
                  handleQuestionChoiceChange({
                    fieldName,
                    nextValue,
                    fieldOnChange: field.onChange,
                  });
                  return;
                }

                questionForm.setValue(fieldName, nextValue, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                });
                setQuestionnaireDraftAnswers((current) => ({
                  ...current,
                  [fieldName]: nextValue,
                  questionnaireMode,
                }));
                field.onChange(nextValue);
              }}
              multi={currentQuestion.type === 'multi'}
            />
          )}
        />
        {fieldError ? <Text style={styles.questionError}>{fieldError}</Text> : null}
      </View>
    );
  };

  const handleCapturePhoto = React.useCallback(async (slotIndex = photoIndex, captureSource = 'manual') => {
    if (slotIndex == null) return;

    if (captureSource === 'auto' && canUseNativeLiveCamera && !liveFaceStatus.valid) {
      setCameraModalError(liveFaceStatus.message || 'Center your face and hair before scanning.');
      return;
    }

    logAppEvent('donor_hair_submission.photo_camera', 'Camera capture requested from donation photo modal.', {
      userId: user?.id || null,
      slotIndex,
      viewKey: requiredViews[slotIndex]?.key || null,
      platform: Platform.OS,
      hasCameraPermission,
      captureSource,
    });

    if (!hasCameraPermission) {
      const permissionGranted = await requestLiveCameraPermission();
      logAppEvent('donor_hair_submission.photo_camera', 'Camera permission re-requested before capture.', {
        userId: user?.id || null,
        slotIndex,
        granted: permissionGranted,
      });

      if (!permissionGranted) {
        setCameraModalError('Camera access was not granted. Allow camera access for live scanning.');
        return;
      }
    }

    if (!cameraRef.current || isCapturingPhoto) {
      setCameraModalError('The camera is still starting. Please wait a moment and try again.');
      return;
    }

    setIsCapturingPhoto(true);
    setCameraModalError('');

    try {
      let rawPhoto;
      try {
        rawPhoto = typeof cameraRef.current.takePhoto === 'function'
          ? await cameraRef.current.takePhoto({ flash: flashMode })
          : await cameraRef.current.takePictureAsync({
              quality: 0.8,
              base64: true,
            });
      } catch (flashCaptureError) {
        if (flashMode !== 'on' || typeof cameraRef.current.takePhoto !== 'function') throw flashCaptureError;
        rawPhoto = await cameraRef.current.takePhoto({ flash: 'off' });
      }
      const photo = rawPhoto?.path
        ? {
            ...rawPhoto,
            uri: rawPhoto.path.startsWith('file://') ? rawPhoto.path : `file://${rawPhoto.path}`,
          }
        : rawPhoto;

      logAppEvent('donor_hair_submission.photo_camera', 'Camera photo captured from donation photo modal.', {
        userId: user?.id || null,
        slotIndex,
        viewKey: requiredViews[slotIndex]?.key || null,
        hasUri: Boolean(photo?.uri),
        captureSource,
      });

      const saveResult = await savePhotoAssetForSlot(slotIndex, photo, 'capture', {
        capturedAt: new Date().toISOString(),
        captureSessionId: captureSessionIdRef.current,
        photoValidation: {
          validationMode: 'live_face',
          faceRequired: requiresFaceVerification(requiredViews[slotIndex]),
          valid: Boolean(liveFaceStatus.valid),
          faceCount: Number(liveFaceStatus.faceCount || 0),
          message: liveFaceStatus.message || '',
          capturedAt: new Date().toISOString(),
        },
      });
      if (!saveResult?.success) {
        setCameraModalError(saveResult?.error || 'The captured photo could not be saved to this slot.');
        return;
      }

      setPhotoPreflightState(null);
      photoPreflightKeyRef.current = '';
      autoCaptureCooldownUntilRef.current = Date.now() + 3500;
      setAutoCaptureCountdown(0);
    } catch (captureError) {
      logAppEvent('donor_hair_submission.photo_camera', 'Camera capture failed from donation photo modal.', {
        userId: user?.id || null,
        slotIndex,
        viewKey: requiredViews[slotIndex]?.key || null,
        message: captureError?.message || 'Unknown camera capture error.',
      }, 'error');

      setCameraModalError('The camera could not capture a photo right now. Please try again.');
    } finally {
      setIsCapturingPhoto(false);
    }
  }, [
    canUseNativeLiveCamera,
    flashMode,
    hasCameraPermission,
    isCapturingPhoto,
    photoIndex,
    requiredViews,
    requestLiveCameraPermission,
    savePhotoAssetForSlot,
    user?.id,
    liveFaceStatus.faceCount,
    liveFaceStatus.valid,
    liveFaceStatus.message,
  ]);

  const autoCaptureEnabled = useMemo(() => {
    if (stepIndex !== 2) return false;
    if (!hasCameraPermission) return false;
    if (Boolean(currentPhoto)) return false;
    if (isCapturingPhoto || isCapturingImages || isPickingImages || isAnalyzing) return false;
    if (!canUseNativeLiveCamera || !requiresFaceVerification(currentView)) return false;

    const brightnessReady = liveFrameBrightness < 0 || liveFrameBrightness >= 82;
    return Boolean(liveFaceStatus?.valid && brightnessReady);
  }, [
    canUseNativeLiveCamera,
    currentView,
    currentPhoto,
    hasCameraPermission,
    isAnalyzing,
    isCapturingImages,
    isCapturingPhoto,
    isPickingImages,
    liveFaceStatus?.valid,
    liveFrameBrightness,
    stepIndex,
  ]);

  const liveScanStatus = useMemo(() => buildLiveScanStatus({
    autoCaptureEnabled,
    brightness: liveFrameBrightness,
    completedPhotoCount,
    currentPhoto,
    currentView,
    isCapturing: isCapturingPhoto || isCapturingImages,
    liveFaceStatus,
    requiredCount: requiredViews.length,
  }), [
    autoCaptureEnabled,
    completedPhotoCount,
    currentPhoto,
    currentView,
    isCapturingImages,
    isCapturingPhoto,
    liveFaceStatus,
    liveFrameBrightness,
    requiredViews.length,
  ]);

  useEffect(() => {
    latestAutoCaptureRef.current = () => handleCapturePhoto(photoIndex, 'auto');
  }, [handleCapturePhoto, photoIndex]);

  useEffect(() => {
    const clearAutoCaptureTimer = () => {
      if (autoCaptureTimeoutRef.current) {
        clearInterval(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
      }
      autoCaptureActiveKeyRef.current = '';
      setAutoCaptureCountdown(0);
    };

    if (!autoCaptureEnabled) {
      clearAutoCaptureTimer();
      return undefined;
    }

    if (Date.now() < autoCaptureCooldownUntilRef.current) {
      clearAutoCaptureTimer();
      return undefined;
    }

    const captureKey = `${photoIndex}:${currentView?.key || currentView?.label || 'view'}`;
    if (autoCaptureActiveKeyRef.current === captureKey && autoCaptureTimeoutRef.current) {
      return undefined;
    }

    clearAutoCaptureTimer();
    autoCaptureActiveKeyRef.current = captureKey;
    let nextCount = 3;
    setAutoCaptureCountdown(nextCount);

    autoCaptureTimeoutRef.current = setInterval(() => {
      nextCount -= 1;
      setAutoCaptureCountdown(Math.max(nextCount, 0));

      if (nextCount <= 0) {
        clearInterval(autoCaptureTimeoutRef.current);
        autoCaptureTimeoutRef.current = null;
        autoCaptureActiveKeyRef.current = '';
        autoCaptureCooldownUntilRef.current = Date.now() + 3500;
        latestAutoCaptureRef.current?.();
      }
    }, 1000);

    return undefined;
  }, [autoCaptureEnabled, currentView?.key, currentView?.label, photoIndex]);

  const handleConfirmCurrentPhoto = React.useCallback(() => {
    setPhotoPreflightState(null);
    photoPreflightKeyRef.current = '';
    const nextFilledSlots = photos.map(Boolean);
    const nextMissingIndex = nextFilledSlots.findIndex((isFilled) => !isFilled);

    if (nextMissingIndex >= 0) {
      setPhotoIndex(nextMissingIndex);
      return;
    }

    setStepIndex(3);
  }, [photos]);

  const handleRemoveCurrentPhoto = React.useCallback(() => {
    setPhotoPreflightState(null);
    photoPreflightKeyRef.current = '';
    removePhoto(photoIndex);
  }, [photoIndex, removePhoto]);

  const validatePhotoReview = React.useCallback(async (source = 'review_auto') => {
    if (photos.filter(Boolean).length !== requiredViews.length) {
      setPhotoPreflightState({
        ok: false,
        title: 'Photos Incomplete',
        message: 'Complete all required photos before running analysis.',
      });
      return { ok: false };
    }

    setIsPhotoPreflightRunning(true);
    setPhotoPreflightState(null);

    try {
      const validation = await validateHairPhotosBeforeAnalysis({ photos, requiredViews });
      setPhotoPreflightState(validation);

      logAppEvent('donor_hair_submission.photo_preflight', 'Review module photo validation completed.', {
        userId: user?.id || null,
        source,
        ok: validation?.ok || false,
        skipped: validation?.skipped || false,
        title: validation?.title || null,
        message: validation?.message || null,
        details: validation?.details || [],
      }, 'info');

      return validation;
    } catch (validationError) {
      const validation = {
        ok: false,
        title: 'Photo Check Failed',
        message: 'Photo validation could not run. Please try again before analysis.',
      };
      setPhotoPreflightState(validation);
      logAppEvent('donor_hair_submission.photo_preflight', 'Review module photo validation crashed.', {
        userId: user?.id || null,
        source,
        message: validationError?.message || String(validationError || ''),
      }, 'error');
      return validation;
    } finally {
      setIsPhotoPreflightRunning(false);
    }
  }, [photos, requiredViews, user?.id]);

  useEffect(() => {
    if (stepIndex !== 3 || analysis || isAnalyzing || isSaving) return;
    if (photos.filter(Boolean).length !== requiredViews.length) return;
    if (!photoReviewValidationKey || photoPreflightKeyRef.current === photoReviewValidationKey) return;

    photoPreflightKeyRef.current = photoReviewValidationKey;
    validatePhotoReview('review_module_open');
  }, [
    analysis,
    isAnalyzing,
    isSaving,
    photoReviewValidationKey,
    photos,
    requiredViews.length,
    stepIndex,
    validatePhotoReview,
  ]);

  const runReviewedAnalysis = React.useCallback(async ({ overridePhotoValidation = false } = {}) => {
    if (!photoPreflightState?.ok && !overridePhotoValidation) return;

    setIsAnalysisLaunching(true);

    if (overridePhotoValidation) {
      const validationDetails = Array.isArray(photoPreflightState?.details)
        ? photoPreflightState.details.map((detail) => [
            detail?.viewLabel,
            detail?.error,
          ].filter(Boolean).join(': ')).filter(Boolean)
        : [];

      logAppEvent('donor_hair_submission.photo_preflight', 'User chose to continue after photo validation warning.', {
        userId: user?.id || null,
        title: photoPreflightState?.title || null,
        message: photoPreflightState?.message || null,
        details: validationDetails,
        overridePhotoValidation: true,
      }, 'info');
    }

    try {
      const result = await runFreshAnalysisAttempt('pre_analysis_photo_review', {
        // Keep the visible result tied to the AI provider response instead of a generic photo-quality fallback.
        allowPhotoQualityFallback: false,
      });

      if (overridePhotoValidation && !result?.success && isPhotoRetakeErrorState(result?.mappedError)) {
        setPhotoPreflightState((current) => ({
          ok: false,
          skipped: false,
          hardBlock: true,
          title: 'Retake required',
          message: result?.mappedError?.message || current?.message || 'Retake required before analysis.',
          details: Array.isArray(current?.details) ? current.details : [],
          validationMode: 'analysis_bounced_to_preflight',
        }));
        clearAnalysisError();
      }
    } finally {
      setIsAnalysisLaunching(false);
    }
  }, [clearAnalysisError, photoPreflightState, runFreshAnalysisAttempt, user?.id]);

  const handleNext = async () => {
    if (stepIndex === 0) {
      const fieldName = currentQuestion?.key;
      const answersSnapshot = getCurrentQuestionnaireAnswers();
      const isValid = fieldName ? isAnswered(currentQuestion, answersSnapshot) : false;
      if (!isValid) return;

      logAppEvent('donor_hair_submission.questionnaire', 'Manual question advance triggered.', {
        userId: user?.id || null,
        questionKey: fieldName || null,
        questionType: currentQuestion?.type || null,
      });

      goToNextQuestionStep(answersSnapshot, fieldName);
      return;
    }

    if (stepIndex === 1) {
      complianceForm.setValue('acknowledged', true, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      setStepIndex(2);
      return;
    }

    if (stepIndex === 2) {
      if (!photos[photoIndex]) return;
      if (photoIndex < requiredViews.length - 1) {
        setPhotoIndex((current) => current + 1);
        return;
      }

      if (photos.filter(Boolean).length !== requiredViews.length) return;
      setStepIndex(3);
      return;
    }

    if (stepIndex === 3) {
      if (!analysis) {
        await runFreshAnalysisAttempt('step_4_retry');
        return;
      }
      return;
    }
  };

  const renderQuestionNavigationDock = () => {
    if (
      stepIndex !== 0
      || isLoadingHistory
      || isLoadingContext
      || weeklyScanLimit.isLocked
      || !hasAcknowledgedRequirementIntro
    ) return null;

    return (
      <View
        style={styles.questionNavigationDock}
      >
        <View style={styles.questionNavigationActions}>
          {questionIndex > 0 ? (
            <View style={styles.questionPreviousButtonWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go to previous question"
                onPress={goPrevious}
                style={({ pressed }) => [
                  styles.questionDockButton,
                  styles.questionPreviousButton,
                  pressed ? styles.questionDockButtonPressed : null,
                ]}
              >
                <View style={styles.questionPreviousButtonContent}>
                  <View style={styles.questionPreviousIconWrap}>
                    <MaterialCommunityIcons name="arrow-left" size={18} color={theme.colors.brandPrimary} />
                  </View>
                  <Text numberOfLines={1} style={styles.questionPreviousButtonText}>Previous</Text>
                </View>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.questionNextButtonWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isNextDisabled ? 'Choose an option to continue' : nextButtonTitle}
              accessibilityState={{ disabled: isNextDisabled }}
              onPress={handleNext}
              disabled={isNextDisabled}
              style={({ pressed }) => [
                styles.questionDockButton,
                styles.questionNextButton,
                isNextDisabled ? styles.questionNextButtonDisabled : null,
                pressed && !isNextDisabled ? styles.questionDockButtonPressed : null,
              ]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={isNextDisabled ? ['#FFF9FA', '#F3E5E9'] : [theme.colors.palette.wine700, theme.colors.palette.wine900]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.questionNextButtonSurface,
                  isNextDisabled ? styles.questionNextButtonSurfaceDisabled : null,
                ]}
              >
                <Text style={isNextDisabled ? styles.questionNextButtonTextDisabled : styles.questionNextButtonText}>
                  {isNextDisabled ? 'Choose an option' : nextButtonTitle}
                </Text>
                <View style={[styles.questionNextArrow, isNextDisabled ? styles.questionNextArrowDisabled : null]}>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={18}
                    color={isNextDisabled ? '#A58B93' : theme.colors.textOnBrand}
                  />
                </View>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  const renderStepContent = () => {
    if ((isAnalysisLaunching || isAnalyzing) && stepIndex === 3 && !analysis) {
      return (
        <AnalysisLoadingSplash
          resolvedTheme={resolvedTheme}
          photos={photos}
          completedPhotoCount={completedPhotoCount}
        />
      );
    }

    if (weeklyScanLimit.isLocked) {
      return (
        <View style={styles.analysisResultPanel}>
          <Text style={styles.weeklyLimitScreenTitle}>Weekly AI Scan</Text>

          <View style={[styles.resultSectionCard, styles.weeklyLimitCard]}>
            <View style={styles.weeklyLimitIconWrap}>
              <AppIcon name="calendar-clock" size="lg" state="active" />
            </View>
            <Text style={styles.weeklyLimitTitle}>You already scanned this week</Text>
            <Text style={styles.weeklyLimitBody}>{weeklyScanLimit.message}</Text>

            <View style={styles.weeklyLimitDateBox}>
              <Text style={styles.weeklyLimitDateLabel}>Next AI scan available</Text>
              <Text style={styles.weeklyLimitDateValue}>{weeklyScanLimit.nextScanLabel}</Text>
            </View>

            {weeklyScanLimit.tip ? (
              <View style={styles.weeklyLimitTipBox}>
                <Text style={styles.weeklyLimitTipLabel}>AI tip from your last log</Text>
                <Text style={styles.weeklyLimitTipText}>{weeklyScanLimit.tip}</Text>
              </View>
            ) : null}
          </View>
        </View>
      );
    }

    switch (stepIndex) {
      case 0:
        if (isLoadingHistory || isLoadingContext || !hasAcknowledgedRequirementIntro) {
          return (
            <View style={styles.inlineLoadingState}>
              <ActivityIndicator size="small" color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
              <Text style={styles.inlineLoadingText}>Preparing your hair check...</Text>
            </View>
          );
        }

        return (
          <View style={styles.questionnaireStage}>
            <Animated.View style={[styles.questionTransitionWrap, questionContentAnimatedStyle]}>
              <View style={styles.questionPanel}>
                {renderQuestionInput()}
              </View>
            </Animated.View>
            <View style={styles.questionnaireFooterDock}>
              {currentQuestionMatterText ? (
                <LinearGradient
                  colors={[theme.colors.brandPrimaryMuted, theme.colors.backgroundPrimary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.questionInfoCard}
                >
                  <View style={styles.questionInfoAccent} />
                  <View style={styles.questionInfoIconWrap}>
                    <MaterialCommunityIcons name="lightbulb-on-outline" size={19} color={theme.colors.brandPrimary} />
                  </View>
                  <View style={styles.questionInfoCopy}>
                    <Text style={styles.questionInfoTitle}>Why does this matter?</Text>
                    <Text style={styles.questionInfoBody}>{currentQuestionMatterText}</Text>
                  </View>
                </LinearGradient>
              ) : null}
              <View style={styles.questionDisclaimerRow}>
                <MaterialCommunityIcons name="shield-check-outline" size={15} color={theme.colors.textMuted} />
                <Text style={styles.questionDisclaimer}>
                  General hair-care guidance only. This is not a medical diagnosis.
                </Text>
              </View>
            </View>
          </View>
        );
      case 1:
        {
          const reviewAnswers = getCurrentQuestionnaireAnswers();
          const reviewVisibleQuestions = getVisibleQuestions(reviewAnswers, questionnaireMode);
          const chemicalQuestion = reviewVisibleQuestions.find((question) => (
            question.key === 'chemicalProcessHistory' || question.key === 'chemicalTreatmentSinceLastCheck'
          ));
          const lengthAnswer = 'Measured by camera';
          const textureAnswer = reviewAnswers?.hairTexture
            ? getChoiceDisplayLabel('hairTexture', reviewAnswers?.hairTexture)
            : 'Checked by camera';
          const bleachValue = chemicalQuestion
            ? getChoiceDisplayLabel(chemicalQuestion.optionsKey, reviewAnswers?.[chemicalQuestion.key])
            : 'No Bleach';
          const heatValue = getChoiceDisplayLabel(
            questionnaireMode === 'returning_follow_up' ? 'heatUseFrequency' : 'heatUseFrequency',
            questionnaireMode === 'returning_follow_up'
              ? reviewAnswers?.heatUseSinceLastCheck
              : reviewAnswers?.heatUse
          );
          const reviewItems = [
            { label: 'Treatment history', value: bleachValue, icon: 'flask-outline' },
            { label: 'Heat styling', value: heatValue, icon: 'weather-sunny' },
            { label: 'Hair length', value: lengthAnswer, icon: 'ruler' },
            { label: 'Hair texture', value: textureAnswer, icon: 'waves' },
          ];
          const scanTips = [
            'Use bright, even light so your hair details are clear.',
            'Keep your full hair in frame and avoid shadows or backlight.',
            'Make sure only one person appears against a simple background.',
          ];

        return (
          <Animated.View style={[styles.readinessStage, readinessAnimatedStyle]}>
            <LinearGradient
              colors={[theme.colors.palette.wine900, theme.colors.palette.wine700]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.readinessHero}
            >
              <View pointerEvents="none" style={styles.readinessHeroGlowLarge} />
              <View pointerEvents="none" style={styles.readinessHeroGlowSmall} />
              <View style={styles.readinessHeroContent}>
                <Animated.View style={[styles.readinessScanOrb, readinessPulseStyle]}>
                  <View style={styles.readinessScanOrbInner}>
                    <MaterialCommunityIcons name="camera-iris" size={31} color="#FFFFFF" />
                  </View>
                </Animated.View>
                <View style={styles.readinessHeroCopy}>
                  <Text style={styles.readinessEyebrow}>PHOTO CHECK</Text>
                  <Text style={styles.readinessTitle}>Your guided scan is ready</Text>
                  <Text style={styles.readinessBody}>
                    Check your answers, then capture six clear views of your hair.
                  </Text>
                </View>
              </View>
              <View style={styles.readinessStatusRow}>
                <View style={styles.readinessStatusChip}>
                  <MaterialCommunityIcons name="camera-outline" size={15} color="#FFFFFF" />
                  <Text style={styles.readinessStatusText}>6 guided photos</Text>
                </View>
                <View style={styles.readinessStatusChip}>
                  <MaterialCommunityIcons name="shield-check-outline" size={15} color="#FFFFFF" />
                  <Text style={styles.readinessStatusText}>Quality checked</Text>
                </View>
              </View>
            </LinearGradient>

            <View style={styles.recapCard}>
              <View style={styles.recapHeader}>
                <View style={styles.recapHeaderIcon}>
                  <MaterialCommunityIcons name="clipboard-check-outline" size={20} color={theme.colors.brandPrimary} />
                </View>
                <View style={styles.recapHeaderCopy}>
                  <Text style={styles.recapTitle}>Your scan profile</Text>
                  <Text style={styles.recapSubtitle}>Answers you can review before opening the camera</Text>
                </View>
              </View>
              {reviewItems.map((item, index) => (
                <React.Fragment key={item.label}>
                  {index > 0 ? <View style={styles.recapDivider} /> : null}
                  <View style={styles.recapDetailRow}>
                    <View style={styles.recapDetailIcon}>
                      <MaterialCommunityIcons name={item.icon} size={18} color={theme.colors.brandPrimary} />
                    </View>
                    <Text style={styles.recapLabel}>{item.label}</Text>
                    <Text style={styles.recapValue}>{item.value}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>

            <View style={styles.tipsCard}>
              <View style={styles.tipsHeader}>
                <View style={styles.tipsHeaderIcon}>
                  <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={theme.colors.brandPrimary} />
                </View>
                <View style={styles.tipsHeaderCopy}>
                  <Text style={styles.tipsTitle}>Set up a clear photo</Text>
                  <Text style={styles.tipsSubtitle}>Three quick steps for a better result</Text>
                </View>
              </View>
              {scanTips.map((item, index) => (
                <View key={item} style={styles.tipRow}>
                  <View style={styles.tipNumberWrap}>
                    <Text style={styles.tipNumber}>{index + 1}</Text>
                  </View>
                  <Text style={styles.tipText}>{item}</Text>
                </View>
              ))}
            </View>

            <View style={styles.readinessQualityNotice}>
              <View style={styles.readinessQualityIcon}>
                <MaterialCommunityIcons name="image-check-outline" size={20} color={theme.colors.brandPrimary} />
              </View>
              <Text style={styles.readinessQualityText}>
                Clear photos help the AI notice hair length, texture, dryness, and visible damage.
              </Text>
            </View>

            <View style={styles.readinessActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open the guided hair camera"
                onPress={async () => {
                  const currentReviewAnswers = getCurrentQuestionnaireAnswers();
                  const reviewQuestions = getVisibleQuestions(currentReviewAnswers, questionnaireMode);
                  const firstUnansweredIndex = findFirstUnansweredQuestionIndex(reviewQuestions, currentReviewAnswers);

                  if (firstUnansweredIndex >= 0) {
                    setQuestionIndex(firstUnansweredIndex);
                    setStepIndex(0);
                    return;
                  }

                  Object.entries(currentReviewAnswers).forEach(([key, value]) => {
                    questionForm.setValue(key, value, {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: false,
                    });
                  });

                  const isValid = await questionForm.trigger();
                  if (!isValid) {
                    const latestAnswers = getCurrentQuestionnaireAnswers();
                    const latestQuestions = getVisibleQuestions(latestAnswers, questionnaireMode);
                    const latestMissingIndex = findFirstUnansweredQuestionIndex(latestQuestions, latestAnswers);
                    setQuestionIndex(Math.max(latestMissingIndex, 0));
                    setStepIndex(0);
                    return;
                  }

                  complianceForm.setValue('acknowledged', true, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                  setStepIndex(2);
                  requestLiveCameraPermission().catch(() => {
                    setCameraModalError('Camera permission could not be checked. Tap Allow Camera to continue.');
                  });
                }}
                style={({ pressed }) => [styles.readinessPrimaryAction, pressed ? styles.questionDockButtonPressed : null]}
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={[theme.colors.palette.wine700, theme.colors.palette.wine900]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.readinessPrimarySurface}
                >
                  <View style={styles.readinessPrimaryIcon}>
                    <MaterialCommunityIcons name="camera-outline" size={23} color="#FFFFFF" />
                  </View>
                  <View style={styles.readinessPrimaryCopy}>
                    <Text style={styles.readinessPrimaryTitle}>Open guided camera</Text>
                    <Text style={styles.readinessPrimarySubtitle}>Capture six hair views</Text>
                  </View>
                  <View style={styles.readinessPrimaryArrow}>
                    <MaterialCommunityIcons name="arrow-right" size={19} color="#FFFFFF" />
                  </View>
                </LinearGradient>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit questionnaire answers"
                onPress={() => {
                  setQuestionIndex(0);
                  setStepIndex(0);
                }}
                style={({ pressed }) => [styles.readinessEditAction, pressed ? styles.pressedMuted : null]}
              >
                <View style={styles.readinessEditContent}>
                  <View style={styles.readinessEditIconWrap}>
                    <MaterialCommunityIcons name="pencil-outline" size={17} color={theme.colors.brandPrimary} />
                  </View>
                  <Text numberOfLines={1} style={styles.readinessEditText}>Edit my answers</Text>
                </View>
              </Pressable>
            </View>
          </Animated.View>
        );
        }
      case 2:
        return (
          <LiveHairCameraPanel
            autoCaptureEnabled={autoCaptureEnabled}
            autoCaptureCountdown={autoCaptureCountdown}
            cameraFacing={cameraFacing}
            currentView={currentView}
            currentPhoto={currentPhoto}
            flashMode={flashMode}
            requiredViews={requiredViews}
            completedPhotoCount={completedPhotoCount}
            hasCameraPermission={hasCameraPermission}
            cameraRef={cameraRef}
            liveScanStatus={liveScanStatus}
            liveFaceStatus={liveFaceStatus}
            canUseNativeLiveCamera={canUseNativeLiveCamera}
            isCapturing={isCapturingPhoto || isCapturingImages}
            isUploading={isPickingImages}
            isAnalyzing={isAnalyzing}
            onCapture={() => handleCapturePhoto(photoIndex)}
            onToggleCamera={toggleCameraFacing}
            onToggleFlash={toggleFlashMode}
            onRemove={handleRemoveCurrentPhoto}
            onConfirmPhoto={handleConfirmCurrentPhoto}
            onClose={closeAnalyzerToHome}
            onFacesChange={handleLiveFacesChange}
            onCameraError={handleNativeCameraError}
            onRequestPermission={async () => {
              const granted = await requestLiveCameraPermission();
              if (!granted) {
                setCameraModalError('Camera access was not granted. Allow camera access for live scanning.');
              } else {
                setCameraModalError('');
              }
            }}
          />
        );
      case 3:
        if (analysis) {
          const donationAssessment = buildDonationAssessment({ analysis, donationRequirement });
          const displayAnalysis = buildDonationAlignedAnalysis(analysis, donationAssessment);
          const sideProfileIndex = requiredViews.findIndex((view) => view?.key === 'side_profile');
          const frontViewIndex = requiredViews.findIndex((view) => view?.key === 'front_view');
          const scanPhoto = photos[sideProfileIndex]?.uri
            ? photos[sideProfileIndex]
            : photos[frontViewIndex]?.uri
              ? photos[frontViewIndex]
              : photos.find((photo) => photo?.uri);
          const resultPhotoGallery = photos
            .map((photo, index) => ({
              uri: photo?.uri || '',
              label: requiredViews[index]?.label || photo?.viewLabel || `Photo ${index + 1}`,
            }))
            .filter((photo) => photo.uri);
          const hairRecommendations = buildVisibleHairRecommendations({
            analysis,
            donationAssessment,
          });
          const hairImprovementRecommendation = getHairImprovementRecommendation(displayAnalysis);
          const questionnaireGuidanceNote = String(displayAnalysis?.history_assessment || '').trim();
          const reviewSummaryRows = buildReviewSummaryRows(analysisReviewValues);
          const finalAiResultNote = buildFinalAiResultNote(analysisReviewValues);

          return (
            <View style={styles.analysisResultPanel}>
              <View style={styles.analysisResultTopBar}>
                <Pressable onPress={() => setStepIndex(2)} style={styles.resultHeaderButton}>
                  <AppIcon name="arrow-left" size="md" state="default" />
                </Pressable>
                <Text style={styles.analysisResultScreenTitle}>Analysis Results</Text>
                <View style={styles.resultHeaderButtonPlaceholder} />
              </View>

              <View style={styles.donationAssessmentCard}>
                <Pressable
                  onPress={() => openScanImagePreview(scanPhoto?.uri, resultPhotoGallery)}
                  disabled={!scanPhoto?.uri}
                  style={({ pressed }) => [
                    styles.cutLineImageWrap,
                    scanPhoto?.uri ? styles.cutLineImageTouchable : null,
                    pressed ? styles.cutLineImagePressed : null,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={scanPhoto?.uri ? 'Open full hair scan photo preview' : 'Hair scan photo unavailable'}
                >
                  {scanPhoto?.uri ? (
                    <>
                      <Image source={{ uri: scanPhoto.uri }} style={styles.cutLineImage} resizeMode="cover" />
                      <View style={styles.cutLinePreviewHint} pointerEvents="none">
                        <AppIcon name="image-search-outline" size="sm" state="inverse" />
                        <Text style={styles.cutLinePreviewHintText}>Tap to view</Text>
                      </View>
                    </>
                  ) : (
                    <View style={styles.cutLineImageFallback}>
                      <AppIcon name="image" size="xl" state="muted" />
                    </View>
                  )}
                  {donationAssessment.isDonationReady ? (
                    <>
                      <View style={styles.cutLineLabel} pointerEvents="none">
                        <Text style={styles.cutLineLabelText}>
                          Cut guide - {donationAssessment.donatableLengthLabel}
                        </Text>
                      </View>
                      <View
                        pointerEvents="none"
                        style={[styles.cutLineOverlay, { bottom: `${donationAssessment.cutLineBottomPercent}%` }]}
                      >
                        <View style={styles.cutLineDashed} />
                        <View style={styles.cutLineScissorBadge}>
                          <AppIcon name="content-cut" size="sm" state="inverse" />
                        </View>
                        <View style={styles.cutLineDashed} />
                      </View>
                    </>
                  ) : null}
                </Pressable>
                <View style={styles.donationAssessmentBody}>
                  <View style={styles.donationAssessmentHeader}>
                    <Text style={styles.resultSectionTitle}>Hair Donation Assessment</Text>
                    <View style={[
                      styles.donationReadyBadge,
                      donationAssessment.isDonationReady ? styles.donationReadyBadgeOk : styles.donationReadyBadgeReview,
                    ]}>
                      <Text style={[
                        styles.donationReadyBadgeText,
                        donationAssessment.isDonationReady ? styles.donationReadyBadgeTextOk : styles.donationReadyBadgeTextReview,
                      ]}>
                        {donationAssessment.isDonationReady ? 'Can donate' : 'Needs review'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.assessmentRows}>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Donatable Length</Text>
                      <Text style={styles.assessmentValue}>{donationAssessment.donatableLengthLabel}</Text>
                    </View>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Hair Length</Text>
                      <Text style={styles.assessmentValue}>{donationAssessment.hairLengthLabel}</Text>
                    </View>
                  </View>
                  <View style={styles.assessmentNote}>
                    <AppIcon
                      name={donationAssessment.isDonationReady ? 'content-cut' : 'alert-circle-outline'}
                      size="md"
                      state="active"
                    />
                    <Text style={styles.assessmentNoteText} numberOfLines={2}>{donationAssessment.summary}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.aiAssessmentNotice}>
                <AppIcon name="info" size="md" state="active" />
                <Text style={styles.aiAssessmentNoticeText}>
                  AI results are guidance only and may not be fully accurate. For hair health concerns, consult a hair specialist.
                </Text>
              </View>

              <View style={styles.resultInlineSection}>
                <View style={styles.resultSectionHeader}>
                  <View>
                    <Text style={styles.resultSectionTitle}>Review detected details</Text>
                    <Text style={styles.resultSectionHint}>
                      Edit only obvious measurement or classification mistakes.
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setIsEditingAnalysisReview((current) => !current)}
                    style={({ pressed }) => [
                      styles.reviewEditButton,
                      isEditingAnalysisReview ? styles.reviewEditButtonActive : null,
                      pressed ? styles.interactivePressed : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={isEditingAnalysisReview ? 'Close result editing' : 'Edit detected result'}
                  >
                    <AppIcon
                      name={isEditingAnalysisReview ? 'close' : 'pencil-outline'}
                      size="md"
                      state={isEditingAnalysisReview ? 'inverse' : 'active'}
                    />
                  </Pressable>
                </View>

                {!isEditingAnalysisReview ? (
                  <View style={styles.reviewSummaryList}>
                    {reviewSummaryRows.map(([label, value]) => (
                      <View key={label} style={styles.reviewSummaryRow}>
                        <Text style={styles.reviewSummaryLabel}>{label}</Text>
                        <Text style={styles.reviewSummaryValue}>{value}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.reviewEditPanel}>
                    <View style={styles.reviewFieldsGrid}>
                      <AppInput
                        label="Hair length"
                        value={analysisReviewValues.declaredLength}
                        onChangeText={(nextValue) => setAnalysisReviewValues((current) => ({
                          ...current,
                          declaredLength: nextValue,
                        }))}
                        keyboardType="decimal-pad"
                        variant="filled"
                        helperText="inches"
                      />
                      <AppInput
                        label="Color"
                        value={analysisReviewValues.declaredColor}
                        onChangeText={(nextValue) => setAnalysisReviewValues((current) => ({
                          ...current,
                          declaredColor: nextValue,
                        }))}
                        variant="filled"
                        placeholder="Black, brown, dyed..."
                      />
                    </View>

                    <View style={styles.correctionFieldGroup}>
                      <Text style={styles.correctionFieldLabel}>Texture</Text>
                      <ReviewOptionChips
                        value={analysisReviewValues.declaredTexture}
                        options={HAIR_TEXTURE_REVIEW_OPTIONS}
                        onChange={(nextValue) => setAnalysisReviewValues((current) => ({
                          ...current,
                          declaredTexture: nextValue,
                        }))}
                      />
                    </View>

                    <View style={styles.correctionFieldGroup}>
                      <Text style={styles.correctionFieldLabel}>Density</Text>
                      <ReviewOptionChips
                        value={analysisReviewValues.declaredDensity}
                        options={HAIR_DENSITY_REVIEW_OPTIONS}
                        onChange={(nextValue) => setAnalysisReviewValues((current) => ({
                          ...current,
                          declaredDensity: nextValue,
                        }))}
                      />
                    </View>

                    <View style={styles.aiReadOnlyBlock}>
                      <Text style={styles.aiReadOnlyLabel}>AI condition assessment</Text>
                      <Text style={styles.aiReadOnlyValue}>
                        {getReviewDisplayValue(analysisReviewValues.declaredCondition)}
                      </Text>
                    </View>
                    <AppButton
                      title="Done editing"
                      variant="outline"
                      onPress={() => setIsEditingAnalysisReview(false)}
                      disabled={isSaving || isAnalyzing}
                      fullWidth
                    />
                  </View>
                )}
              </View>

              {hasScalpCoverageTracking(displayAnalysis) ? (
                <View style={styles.resultInlineSection}>
                  <View style={styles.resultSectionHeader}>
                    <Text style={styles.resultSectionTitle}>Scalp coverage tracking</Text>
                    <View style={styles.conditionBadge}>
                      <View style={styles.conditionBadgeDot} />
                      <Text style={styles.conditionBadgeText}>WELLNESS</Text>
                    </View>
                  </View>
                  <View style={styles.assessmentRows}>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Visible scalp area</Text>
                      <Text style={styles.assessmentValue}>{displayAnalysis.visible_scalp_area || 'low'}</Text>
                    </View>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Affected area</Text>
                      <Text style={styles.assessmentValue}>{formatAffectedRegions(displayAnalysis.affected_regions)}</Text>
                    </View>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Density score</Text>
                      <Text style={styles.assessmentValue}>{formatDensityScore(displayAnalysis.hair_density_score)}</Text>
                    </View>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Shedding level</Text>
                      <Text style={styles.assessmentValue}>{displayAnalysis.shedding_level || 'mild'}</Text>
                    </View>
                  </View>
                  <View style={styles.assessmentNote}>
                    <AppIcon name="chart-line" size="md" state="active" />
                    <Text style={styles.assessmentNoteText} numberOfLines={2}>
                      {displayAnalysis.scalp_coverage_notes || 'This check tracks visible scalp coverage for progress monitoring only.'}
                    </Text>
                  </View>
                </View>
              ) : null}

              {hasScalpFindingTracking(displayAnalysis) ? (
                <View style={styles.resultInlineSection}>
                  <View style={styles.resultSectionHeader}>
                    <Text style={styles.resultSectionTitle}>Scalp findings</Text>
                    <View style={styles.conditionBadge}>
                      <View style={styles.conditionBadgeDot} />
                      <Text style={styles.conditionBadgeText}>VISIBLE CHECK</Text>
                    </View>
                  </View>
                  <View style={styles.assessmentRows}>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Dandruff / flakes</Text>
                      <Text style={styles.assessmentValue}>
                        {formatDetectedLabel(displayAnalysis.dandruff_detected)}
                      </Text>
                    </View>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Dandruff severity</Text>
                      <Text style={styles.assessmentValue}>{displayAnalysis.dandruff_severity || 'none'}</Text>
                    </View>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Lice / nits</Text>
                      <Text style={styles.assessmentValue}>
                        {formatDetectedLabel(displayAnalysis.lice_detected)}
                      </Text>
                    </View>
                    <View style={styles.assessmentRow}>
                      <Text style={styles.assessmentLabel}>Lice confidence</Text>
                      <Text style={styles.assessmentValue}>{displayAnalysis.lice_confidence || 'none'}</Text>
                    </View>
                  </View>
                  <View style={styles.assessmentNote}>
                    <AppIcon name="info" size="md" state="active" />
                    <Text style={styles.assessmentNoteText} numberOfLines={3}>
                      {[displayAnalysis.dandruff_notes, displayAnalysis.lice_notes].filter(Boolean).join(' ')}
                    </Text>
                  </View>
                </View>
              ) : null}

              {hairRecommendations.length ? (
                <View style={styles.resultInlineSection}>
                  <View style={styles.resultSectionHeader}>
                    <Text style={styles.resultSectionTitle}>Hair recommendations</Text>
                    <View style={styles.conditionBadge}>
                      <View style={styles.conditionBadgeDot} />
                      <Text style={styles.conditionBadgeText}>HAIR CARE</Text>
                    </View>
                  </View>
                  <Text style={styles.resultSectionHint}>{hairImprovementRecommendation}</Text>
                  <View style={styles.recommendationList}>
                    {hairRecommendations.map((recommendation, index) => (
                      <View
                        key={`${recommendation.title}-${index}`}
                        style={[
                          styles.recommendationCard,
                          index === 0 ? styles.recommendationCardPrimary : null,
                        ]}
                      >
                        <Text style={styles.recommendationPill}>Step {index + 1}</Text>
                        <Text style={styles.recommendationTitle}>{recommendation.title}</Text>
                        <Text style={styles.recommendationBody}>{recommendation.recommendation_text}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {questionnaireGuidanceNote ? (
                <View style={styles.resultInlineSection}>
                  <View style={styles.resultSectionHeader}>
                    <Text style={styles.resultSectionTitle}>Based on your answers</Text>
                    <View style={styles.conditionBadge}>
                      <View style={styles.conditionBadgeDot} />
                      <Text style={styles.conditionBadgeText}>GUIDE</Text>
                    </View>
                  </View>
                  <Text style={styles.resultSectionHint}>{questionnaireGuidanceNote}</Text>
                </View>
              ) : null}

              <View style={styles.resultActions}>
                {donationAssessment.isDonationReady ? (
                  <AppButton
                    title="Find Donation Drives"
                    onPress={() => router.replace('/donor/home?tab=drives')}
                    disabled={isSaving || isAnalyzing}
                    fullWidth
                  />
                ) : null}
                <AppButton
                  title={isSaving ? 'Saving...' : 'Save Results'}
                  variant={donationAssessment.isDonationReady ? 'outline' : 'primary'}
                  onPress={saveConfirmedAnalysis}
                  loading={isSaving}
                  disabled={isSaving || isAnalyzing}
                  fullWidth
                />
                <Pressable
                  onPress={() => {
                    resetFlow();
                    setAnalysisReviewValues(buildHairReviewDefaultValues(null));
                    setIsEditingAnalysisReview(false);
                    setResultConfirmationMode('pending');
                    setPhotoIndex(0);
                    setQuestionIndex(0);
                    setStepIndex(0);
                    setHasAcknowledgedRequirementIntro(false);
                  }}
                  disabled={isSaving || isAnalyzing}
                  style={styles.scanAgainLink}
                >
                  <Text style={styles.scanAgainText}>Scan Again</Text>
                </Pressable>
              </View>

              <View style={styles.finalAiNote}>
                <AppIcon name="information-outline" size="sm" state="muted" />
                <Text style={styles.finalAiNoteText}>{finalAiResultNote}</Text>
              </View>
            </View>
          );
        }

        if (pageErrorState && isPhotoRetakeErrorState(pageErrorState)) {
          return (
            <PreAnalysisPhotoReview
              photos={photos}
              requiredViews={requiredViews}
              cardBackground={resolvedTheme?.backgroundColor || theme.colors.backgroundPrimary}
              isAnalyzing={isAnalyzing || isAnalysisLaunching}
              isSaving={isSaving}
              isValidating={isPhotoPreflightRunning}
              validation={{
                ok: false,
                skipped: false,
                hardBlock: true,
                title: 'Retake required',
                message: pageErrorState?.message || 'Retake required before analysis.',
                details: Array.isArray(photoPreflightState?.details) ? photoPreflightState.details : [],
                validationMode: 'analysis_error_to_preflight',
              }}
              onPreview={openScanImagePreview}
              onRetake={(slotIndex = 0) => {
                setPhotoPreflightState(null);
                photoPreflightKeyRef.current = '';
                clearAnalysisError();
                removePhoto(slotIndex);
                setPhotoIndex(slotIndex);
                setStepIndex(2);
              }}
              onRunAnalysis={runReviewedAnalysis}
            />
          );
        }

        return pageErrorState ? (
          <View style={styles.analysisResultPanel}>
            <View style={styles.analysisResultTopBar}>
              <Pressable
                onPress={() => {
                  setStepIndex(2);
                  setPhotoIndex(0);
                  clearAnalysisError();
                }}
                style={styles.resultHeaderButton}
              >
                <AppIcon name="arrow-left" size="md" state="default" />
              </Pressable>
              <Text style={styles.analysisResultScreenTitle}>Analysis Results</Text>
              <View style={styles.resultHeaderButtonPlaceholder} />
            </View>

            <View style={styles.resultSectionCard}>
              <View style={styles.resultSectionHeader}>
                <Text style={styles.resultSectionTitle}>
                  {pageErrorState?.title || 'Analysis unavailable'}
                </Text>
                <View style={styles.conditionBadge}>
                  <View style={styles.conditionBadgeDotWarning} />
                  <Text style={styles.conditionBadgeText}>
                    {isRetryCooldownActive ? 'WAIT' : 'TRY AGAIN'}
                  </Text>
                </View>
              </View>
              <Text style={styles.resultErrorBody}>
                {pageErrorState?.message || 'Hair analysis could not finish right now. Please try again.'}
              </Text>
              <View style={styles.resultActions}>
                <AppButton
                  title={isRetryCooldownActive
                    ? `Try again in ${retryCountdownSeconds}s`
                    : isAnalyzing
                      ? 'Retrying...'
                      : 'Try again'}
                  onPress={async () => {
                    await runFreshAnalysisAttempt('error_result_retry');
                  }}
                  loading={isAnalyzing}
                  disabled={isAnalyzing || isSaving || isRetryCooldownActive}
                  fullWidth
                />
              </View>
            </View>
          </View>
        ) : (
          <PreAnalysisPhotoReview
            photos={photos}
            requiredViews={requiredViews}
            cardBackground={resolvedTheme?.backgroundColor || theme.colors.backgroundPrimary}
            isAnalyzing={isAnalyzing || isAnalysisLaunching}
            isSaving={isSaving}
            isValidating={isPhotoPreflightRunning}
            validation={photoPreflightState}
            onPreview={openScanImagePreview}
            onRetake={(slotIndex = 0) => {
              setPhotoPreflightState(null);
              photoPreflightKeyRef.current = '';
              removePhoto(slotIndex);
              setPhotoIndex(slotIndex);
              setStepIndex(2);
            }}
            onRunAnalysis={runReviewedAnalysis}
          />
        );
      default:
        return null;
    }
  };

  const previewGallery = previewImageUris.length
    ? previewImageUris
    : previewImageUri
      ? [{ uri: previewImageUri, label: 'Photo Preview' }]
      : [];
  const previewPageWidth = Math.max(1, viewportWidth - theme.spacing.md * 2);
  const closeImagePreview = () => {
    setPreviewImageUri('');
    setPreviewImageUris([]);
    setPreviewImageIndex(0);
  };
  const donationRequirementsIntroModal = (
    <DonationRequirementsIntroModal
      donationRequirement={donationRequirement}
      visible={shouldShowRequirementIntro}
      onContinue={() => setHasAcknowledgedRequirementIntro(true)}
      onBack={closeAnalyzerToHome}
    />
  );
  const previewImageModal = (
    <Modal
      transparent
      visible={Boolean(previewImageUri)}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={closeImagePreview}
    >
      <View style={styles.imagePreviewOverlay}>
        <Pressable style={styles.imagePreviewBackdrop} onPress={closeImagePreview} />
        <View style={styles.imagePreviewCard}>
          <View style={styles.imagePreviewHeader}>
            <View style={styles.imagePreviewHeaderCopy}>
              <Text style={styles.imagePreviewTitle}>
                {previewGallery[previewImageIndex]?.label || 'Photo Preview'}
              </Text>
              {previewGallery.length > 1 ? (
                <Text style={styles.imagePreviewMeta}>
                  {previewImageIndex + 1} of {previewGallery.length}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={closeImagePreview}
              style={({ pressed }) => [styles.imagePreviewClose, pressed ? styles.pressedMuted : null]}
              accessibilityRole="button"
              accessibilityLabel="Close photo preview"
            >
              <AppIcon name="close" size="sm" state="inverse" />
            </Pressable>
          </View>
          {previewGallery.length ? (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                contentOffset={{ x: previewPageWidth * previewImageIndex, y: 0 }}
                onMomentumScrollEnd={(event) => {
                  const nextIndex = Math.round(event.nativeEvent.contentOffset.x / previewPageWidth);
                  const boundedIndex = Math.max(0, Math.min(previewGallery.length - 1, nextIndex));
                  setPreviewImageIndex(boundedIndex);
                  setPreviewImageUri(previewGallery[boundedIndex]?.uri || '');
                }}
                style={styles.imagePreviewPager}
              >
                {previewGallery.map((photo, index) => (
                  <View key={`${photo.uri}-${index}`} style={[styles.imagePreviewPage, { width: previewPageWidth }]}>
                    <Image source={{ uri: photo.uri }} style={styles.imagePreviewImage} resizeMode="contain" />
                  </View>
                ))}
              </ScrollView>
              {previewGallery.length > 1 ? (
                <View style={styles.imagePreviewDots}>
                  {previewGallery.map((photo, index) => (
                    <View
                      key={`${photo.uri}-dot`}
                      style={[
                        styles.imagePreviewDot,
                        index === previewImageIndex ? styles.imagePreviewDotActive : null,
                      ]}
                    />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );

  if (isDonorProfileComplete && isAnalyzerActive) {
    const analyzerContent = (
      <View
        style={[
          stepIndex === 2 ? styles.cameraWizardStage : styles.wizardStage,
          stepIndex === 0 ? styles.questionnaireWizardStage : null,
        ]}
      >
        <View style={styles.stepContentWrap}>
          {renderStepContent()}
        </View>
      </View>
    );

    return (
      <>
        <View style={[styles.analyzerStandalone, { backgroundColor: roles.pageBackground }]}>
          {stepIndex === 2 ? null : (
            <HairAnalysisTopBar
              title="Check Hair"
              onBack={handleHeaderBack}
              iconColor={theme.colors.backgroundPrimary}
              textColor={theme.colors.backgroundPrimary}
              showBackButton
            />
          )}
          {stepIndex === 2 ? analyzerContent : (
            <ScrollView
              style={styles.analyzerScroll}
              contentContainerStyle={styles.analyzerScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {analyzerContent}
            </ScrollView>
          )}
          {renderQuestionNavigationDock()}
        </View>
        {donationRequirementsIntroModal}
        {previewImageModal}
      </>
    );
  }

  return (
    <DashboardLayout
      showSupportChat
      navItems={donorDashboardNavItems}
      activeNavKey="checkhair"
      navVariant="donor"
      screenVariant="default"
      onNavPress={(item) => {
        if (!item.route || item.route === '/donor/donations') return;
        router.navigate(item.route);
      }}
      header={<DonorTabHeader unreadCount={unreadCount} />}
    >
      {transientErrorNotice && !isAnalyzerActive ? (
        <StatusBanner
          title={transientErrorNotice.title}
          message={transientErrorNotice.message}
          variant="error"
          presentation="floating"
          visible={Boolean(transientErrorNotice)}
          autoDismissMs={3000}
          onDismiss={() => {
            logAppEvent('donor_hair_submission.analysis_retry', 'Transient provider error popup dismissed.', {
              userId: user?.id || null,
              title: transientErrorNotice?.title || null,
            });
            setTransientErrorNotice(null);
          }}
        />
      ) : null}
      {successMessage ? (
        <StatusBanner
          message={successMessage}
          variant="success"
          title="Hair check saved"
          presentation="floating"
          visible={Boolean(successMessage)}
          autoDismissMs={3000}
        />
      ) : null}
      {historyError ? (
        <StatusBanner
          message={historyError}
          variant="info"
          presentation="floating"
          visible={Boolean(historyError)}
          autoDismissMs={3000}
          onDismiss={() => setHistoryError('')}
        />
      ) : null}
      {isLoadingContext ? (
        <StatusBanner
          title="Loading CheckHair"
          message="Preparing your analyzer context."
          variant="info"
          presentation="floating"
          visible={isLoadingContext}
          autoDismissMs={3000}
        />
      ) : null}

      {!isDonorProfileComplete ? (
        <View style={styles.summaryStage}>
          <ProfileSetupGate
            completionMeta={donorProfileCompletionMeta}
            onManageProfile={() => router.navigate('/profile')}
          />
        </View>
      ) : !isAnalyzerActive ? (
        <View style={styles.summaryStage}>
          {isLoadingHistory || hasSavedAnalysis ? (
            <View style={styles.sectionGroup}>
              <View style={styles.sectionHeaderCompact}>
                <SectionTitleRow
                  title="Hair log"
                  icon="file-document-outline"
                  color={theme.colors.textPrimary}
                  iconColor={theme.colors.textSecondary}
                  accentColor={theme.colors.brandPrimary}
                  titleStyle={styles.sectionTitleCompact}
                />
                {latestTrendLabel ? (
                  <Text style={styles.sectionMetaCompact}>{latestTrendLabel}</Text>
                ) : null}
              </View>
              {isLoadingHistory ? (
                <AppCard variant="default" radius="xl" padding="md">
                  <View style={styles.loadingState}>
                    <ActivityIndicator color={resolvedTheme?.primaryColor || theme.colors.brandPrimary} />
                    <Text style={styles.loadingStateText}>Loading hair log</Text>
                  </View>
                </AppCard>
              ) : (
                <HairConditionLogCard
                  submissions={analysisHistory}
                  registeredDrives={registeredEventDrives}
                  onOpenAnalyzer={openAnalyzerWithRequirements}
                  onSelectDate={openHistoryDate}
                  trendLabel={latestTrendLabel}
                />
              )}
            </View>
          ) : null}
        </View>
      ) : (
        <View
          style={[
            stepIndex === 2 ? styles.cameraWizardStage : styles.wizardStage,
            stepIndex === 0 ? styles.questionnaireWizardStage : null,
          ]}
        >
          {stepIndex === 2 ? null : (
            <View style={styles.closeOnlyHeader}>
              <Pressable onPress={closeAnalyzerToHome} style={styles.iconNavButton}>
                <AppIcon name="close" size="md" state="muted" />
              </Pressable>
            </View>
          )}

          <View style={styles.stepContentWrap}>
            {renderStepContent()}
          </View>
          {renderQuestionNavigationDock()}
        </View>
      )}

      <HairLogDetailModal
        visible={Boolean(selectedHistoryDate)}
        dateKey={selectedHistoryDate}
        entries={selectedHistoryEntries}
        events={selectedHistoryEvents}
        donationRequirement={donationRequirement}
        onStartAnalysis={() => {
          setSelectedHistoryDate('');
          setSelectedHistoryEntries([]);
          setSelectedHistoryEvents([]);
          openAnalyzerWithRequirements();
        }}
        onClose={() => {
          setSelectedHistoryDate('');
          setSelectedHistoryEntries([]);
          setSelectedHistoryEvents([]);
        }}
      />

      {donationRequirementsIntroModal}
      {previewImageModal}
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  analyzerStandalone: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: theme.colors.backgroundSecondary,
    paddingTop: theme.spacing.xl,
    paddingBottom: 0,
  },
  pressedMuted: {
    opacity: 0.72,
  },
  analyzerScroll: {
    flex: 1,
  },
  analyzerScrollContent: {
    flexGrow: 1,
    paddingBottom: 124,
  },
  wizardStage: {
    width: '100%',
    maxWidth: theme.layout.contentMaxWidth,
    alignSelf: 'center',
    flex: 1,
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  questionnaireWizardStage: {
    paddingBottom: 112,
  },
  cameraWizardStage: {
    width: '100%',
    alignSelf: 'center',
    flex: 1,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: 0,
  },
  closeOnlyHeader: {
    alignItems: 'flex-end',
  },
  summaryStage: {
    gap: theme.spacing.md,
    width: '100%',
    maxWidth: theme.layout.contentMaxWidth,
    alignSelf: 'center',
  },
  flowRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  analysisFlowTopBarShell: {
    paddingTop: 0,
    paddingBottom: theme.spacing.sm,
  },
  analysisFlowTopBar: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: 0,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    borderBottomWidth: 0,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    ...theme.shadows.card,
  },
  analysisFlowTopBarGlowLarge: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    right: -36,
    top: -72,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  analysisFlowTopBarGlowSmall: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    left: -18,
    bottom: -30,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  analysisFlowTopBarSide: {
    width: 96,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  analysisFlowTopBarSideStart: {
    paddingLeft: theme.spacing.sm,
  },
  analysisFlowTopBarSideEnd: {
    justifyContent: 'flex-end',
    paddingRight: theme.spacing.sm,
  },
  analysisFlowTopBarButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  analysisFlowTopBarBalance: {
    width: 40,
    height: 40,
  },
  analysisFlowTopBarTitle: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    marginHorizontal: theme.spacing.sm,
  },
  flowStep: {
    minWidth: 126,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceCard,
  },
  flowStepActive: {
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  flowStepIcon: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  flowStepIconActive: {
    backgroundColor: theme.colors.brandPrimary,
  },
  flowStepIconComplete: {
    backgroundColor: theme.colors.textSuccess,
  },
  flowStepCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  flowStepTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textPrimary,
  },
  flowStepTitleActive: {
    color: theme.colors.brandPrimary,
  },
  flowStepBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textSecondary,
  },
  profileGateCard: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  profileGateTop: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    alignItems: 'flex-start',
  },
  profileGateIcon: {
    width: 54,
    height: 54,
    borderRadius: theme.radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  profileGateCopy: {
    flex: 1,
    gap: 5,
  },
  profileGateEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
  },
  profileGateTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
  },
  profileGateBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  profileGateProgressTrack: {
    height: 10,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceSoft,
    overflow: 'hidden',
  },
  profileGateProgressFill: {
    height: '100%',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  profileGateMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  profileGateMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  missingFieldWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  missingFieldChip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  missingFieldChipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  summaryHeroCard: {
    borderColor: theme.colors.brandPrimaryMuted,
  },
  summaryHeroCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  summaryHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  summaryIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  summaryHeroBadge: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  summaryHeroBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  summaryHeroCopy: {
    gap: 4,
    alignItems: 'center',
  },
  summaryHeroTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
    textAlign: 'left',
  },
  summaryHeroBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
    textAlign: 'left',
  },
  startHairWidget: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  startHairCopy: {
    flex: 1,
    gap: 3,
  },
  interactivePressed: {
    transform: [{ scale: 0.98 }],
  },
  summaryHeroMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  sectionGroup: {
    gap: theme.spacing.sm,
  },
  actionGroups: {
    gap: theme.spacing.md,
  },
  actionSection: {
    gap: theme.spacing.sm,
  },
  actionSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
  },
  actionSectionBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  sectionTitleCompact: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
    lineHeight: theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
  },
  sectionHeaderCompact: {
    gap: 4,
  },
  sectionMetaCompact: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  loadingState: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  loadingStateText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textSecondary,
  },
  inlineLoadingState: {
    minHeight: 520,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingBottom: 120,
  },
  inlineLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textMuted,
  },
  postAnalysisActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  correctionFieldGroup: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  correctionFieldLabel: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    color: theme.colors.textPrimary,
  },
  resultSectionHint: {
    marginTop: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  reviewFieldsGrid: {
    gap: theme.spacing.sm,
  },
  aiReadOnlyBlock: {
    gap: 5,
    padding: theme.spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
  },
  aiReadOnlyLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  aiReadOnlyValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  aiReadOnlyNote: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  correctionLengthRow: {
    gap: theme.spacing.sm,
  },
  correctionLengthInputWrap: {
    width: '100%',
  },
  correctionUnitWrap: {
    width: '100%',
  },
  emptyCalendarState: {
    width: '100%',
  },
  calendarHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  calendarWidget: {
    padding: theme.spacing.lg,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  calendarLeadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceCardMuted,
    borderRadius: theme.radius.xl,
  },
  calendarLeadIconWrap: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarLeadCopy: {
    flex: 1,
    gap: 2,
  },
  calendarLeadEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
  },
  calendarLeadTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  calendarLeadBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  calendarLeadMeta: {
    alignItems: 'flex-end',
    gap: 6,
  },
  calendarLeadMetaLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
  },
  calendarLeadMetaValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  calendarLeadStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  calendarLeadStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
  },
  calendarHeaderCopy: {
    flex: 1,
  },
  calendarMonthLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  calendarSummaryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  calendarMonthControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-end',
    marginBottom: theme.spacing.sm,
  },
  calendarMonthButton: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.xs,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textMuted,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  calendarGridWeek: {
    flexWrap: 'nowrap',
    gap: 6,
  },
  calendarCell: {
    width: '13.5%',
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  calendarCellWeek: {
    flex: 1,
    width: undefined,
    minHeight: 86,
    borderRadius: 20,
  },
  calendarCellActive: {
    backgroundColor: theme.colors.surfaceSoft,
  },
  calendarCellLatest: {
    borderColor: theme.colors.brandPrimary,
    borderWidth: 1.5,
  },
  calendarCellMuted: {
    opacity: 0.42,
  },
  calendarCellLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  calendarCellIconWrap: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarCellPlaceholder: {
    width: 22,
    height: 22,
  },
  conditionDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
  },
  calendarCellCount: {
    position: 'absolute',
    top: 6,
    right: 6,
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    color: theme.colors.textMuted,
  },
  calendarSupportRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  calendarSupportCard: {
    minWidth: '30%',
    flexGrow: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
  },
  calendarSupportLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  calendarSupportValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  calendarTrendText: {
    marginTop: theme.spacing.sm,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  calendarModeSwitch: {
    flexDirection: 'row',
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceCardMuted,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  calendarModeButton: {
    minHeight: 34,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
  },
  calendarModeButtonActive: {
    backgroundColor: theme.colors.brandPrimary,
    ...theme.shadows.pressed,
  },
  calendarModeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.semibold,
  },
  calendarModeTextActive: {
    color: theme.colors.textOnBrand,
  },
  calendarQuickStats: {
    gap: 4,
  },
  calendarQuickStat: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  stepContentWrap: {
    width: '100%',
    maxWidth: theme.layout.contentMaxWidth,
    alignSelf: 'center',
    flex: 1,
  },
  stepStack: {
    gap: theme.spacing.md,
    width: '100%',
  },
  bannerGap: {
    marginBottom: theme.spacing.md,
  },
  stepTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  stepDescription: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  stepFootnote: {
    marginTop: theme.spacing.sm,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
  },
  guideHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  guideIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  guideHeaderCopy: {
    flex: 1,
  },
  guideGrid: {
    gap: theme.spacing.md,
  },
  guidelineSection: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  guidelineTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
  },
  bulletList: {
    gap: theme.spacing.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  bulletDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
    marginTop: 7,
    backgroundColor: theme.colors.brandPrimary,
  },
  bulletText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  captureTargetList: {
    gap: theme.spacing.sm,
  },
  captureTargetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.surfaceSoft,
  },
  captureTargetBadge: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
  },
  captureTargetBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textOnBrand,
  },
  captureTargetText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textPrimary,
  },
  choiceList: {
    gap: theme.spacing.md,
  },
  choiceCard: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 72,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
    ...theme.shadows.soft,
  },
  choiceCardActive: {
    borderColor: theme.colors.brandPrimary,
    borderWidth: 1.5,
    ...theme.shadows.card,
  },
  choiceCardActiveAccent: {
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: theme.colors.brandPrimary,
  },
  choiceCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  choiceCardGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  choiceCardContent: {
    width: '100%',
    minHeight: 44,
    position: 'relative',
    justifyContent: 'center',
  },
  choiceIconWrap: {
    position: 'absolute',
    left: 0,
    top: '50%',
    marginTop: -21,
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: theme.colors.brandPrimaryMuted,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  choiceIconWrapActive: {
    backgroundColor: theme.colors.brandPrimary,
    borderColor: theme.colors.brandPrimary,
  },
  choiceCardCopy: {
    width: '100%',
    paddingLeft: 54,
    paddingRight: 44,
    gap: 2,
  },
  choiceLabel: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  choiceLabelActive: {
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
  },
  choiceDescription: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  choiceRadio: {
    position: 'absolute',
    right: 0,
    top: '50%',
    marginTop: -15,
    width: 30,
    height: 30,
    borderRadius: theme.radius.full,
    borderWidth: 1.5,
    borderColor: '#C9ABB4',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  choiceRadioActive: {
    backgroundColor: theme.colors.brandPrimary,
    borderColor: theme.colors.brandPrimary,
  },
  questionnaireStage: {
    flex: 1,
    gap: theme.spacing.md,
  },
  questionTransitionWrap: {
    gap: theme.spacing.lg,
  },
  questionPanel: {
    gap: theme.spacing.md,
    paddingVertical: 0,
  },
  questionContentCard: {
    gap: theme.spacing.lg,
  },
  questionHeroCard: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 24,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
    ...theme.shadows.card,
  },
  questionHeroGlowLarge: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -54,
    top: -78,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  questionHeroGlowSmall: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    right: 38,
    bottom: -52,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  questionHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  questionHeroIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  questionHeroIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  questionHeroEyebrow: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
    color: '#F7DCE3',
  },
  questionHeroStepChip: {
    minWidth: 48,
    height: 30,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  questionHeroStepText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  questionHeroTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  questionHeroHelper: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: '#F9EDEF',
  },
  questionHeroProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  questionHeroProgressDot: {
    flex: 1,
    height: 4,
    maxWidth: 28,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  questionHeroProgressDotActive: {
    backgroundColor: 'rgba(255,255,255,0.58)',
  },
  questionHeroProgressDotCurrent: {
    height: 6,
    backgroundColor: '#FFFFFF',
  },
  questionnaireFooterDock: {
    marginTop: 'auto',
    gap: theme.spacing.md,
  },
  questionInfoCard: {
    position: 'relative',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    paddingLeft: theme.spacing.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  questionInfoAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: theme.colors.brandPrimary,
  },
  questionInfoIconWrap: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  questionInfoCopy: {
    flex: 1,
    gap: 3,
  },
  questionInfoTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  questionInfoBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  readinessStage: {
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  readinessHero: {
    position: 'relative',
    overflow: 'hidden',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: 26,
    ...theme.shadows.card,
  },
  readinessHeroGlowLarge: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    right: -62,
    top: -92,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  readinessHeroGlowSmall: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    left: -34,
    bottom: -48,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  readinessHeroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  readinessScanOrb: {
    width: 74,
    height: 74,
    borderRadius: 37,
    padding: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
  },
  readinessScanOrbInner: {
    width: '100%',
    height: '100%',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  readinessHeroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  readinessEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.1,
    color: '#F5D9E1',
  },
  readinessTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  readinessBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: '#FAEDF1',
  },
  readinessStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  readinessStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  readinessStatusText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
  },
  recapCard: {
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E7D4DA',
    backgroundColor: '#FFFCFD',
    ...theme.shadows.soft,
  },
  recapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: '#FAEEF1',
  },
  recapHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9D4DA',
  },
  recapHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  recapTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  recapSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
  },
  recapDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    minHeight: 54,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  recapDetailIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7E9ED',
  },
  recapLabel: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textSecondary,
  },
  recapValue: {
    maxWidth: '45%',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    textAlign: 'right',
  },
  recapDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 62,
    backgroundColor: '#EBDCE0',
  },
  tipsCard: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E7D4DA',
    backgroundColor: '#FFFFFF',
    ...theme.shadows.soft,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  tipsHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF0F4',
  },
  tipsHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  tipsTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  tipsSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  tipNumberWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
  },
  tipNumber: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  tipText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  readinessQualityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ECD7DD',
    backgroundColor: '#FFF4F7',
  },
  readinessQualityIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  readinessQualityText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  readinessActions: {
    gap: theme.spacing.sm,
  },
  readinessPrimaryAction: {
    overflow: 'hidden',
    minHeight: 66,
    borderRadius: 21,
    ...theme.shadows.card,
  },
  readinessPrimarySurface: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 21,
  },
  readinessPrimaryIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  readinessPrimaryCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  readinessPrimaryTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  readinessPrimarySubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    color: '#F7E7EB',
  },
  readinessPrimaryArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  readinessEditAction: {
    width: 184,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: '#E4CCD3',
    backgroundColor: '#FFF9FA',
    ...theme.shadows.soft,
  },
  readinessEditContent: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  readinessEditIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5E4E9',
  },
  readinessEditText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    textAlign: 'center',
  },
  requirementsIntroOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xxl,
  },
  requirementsIntroBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(35, 8, 16, 0.68)',
  },
  requirementsIntroCard: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '88%',
    overflow: 'hidden',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.36)',
    backgroundColor: '#FFFBFC',
    ...theme.shadows.card,
  },
  requirementsIntroHero: {
    position: 'relative',
    overflow: 'hidden',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: 7,
  },
  requirementsIntroGlowLarge: {
    position: 'absolute',
    width: 190,
    height: 190,
    borderRadius: 95,
    right: -72,
    top: -98,
    backgroundColor: 'rgba(255,255,255,0.11)',
  },
  requirementsIntroGlowSmall: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    left: -38,
    bottom: -54,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  requirementsIntroHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  requirementsIntroIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  requirementsIntroClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  requirementsIntroEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.1,
    color: '#F6DCE3',
  },
  requirementsIntroTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  requirementsIntroSubtitle: {
    maxWidth: 340,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: '#F9EDEF',
  },
  requirementsIntroScroll: {
    flexShrink: 1,
  },
  requirementsIntroBody: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  requirementsIntroSectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  requirementsIntroSectionTitle: {
    flex: 1,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  requirementsIntroCurrentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: '#F5E8EC',
  },
  requirementsIntroCurrentChipUnavailable: {
    backgroundColor: '#F2EFF0',
  },
  requirementsIntroCurrentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.brandPrimary,
  },
  requirementsIntroCurrentDotUnavailable: {
    backgroundColor: theme.colors.textMuted,
  },
  requirementsIntroCurrentText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
  },
  requirementsIntroCurrentTextUnavailable: {
    color: theme.colors.textMuted,
  },
  requirementsIntroUnavailableNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#E8CED5',
    backgroundColor: '#FFF5F7',
  },
  requirementsIntroUnavailableText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  requirementsIntroRequirementList: {
    overflow: 'hidden',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8D6DB',
    backgroundColor: '#FFFFFF',
  },
  requirementsIntroRequirementRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  requirementsIntroRequirementIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7E9ED',
  },
  requirementsIntroRequirementCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  requirementsIntroRequirementLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
    color: theme.colors.brandPrimary,
  },
  requirementsIntroRequirementValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  requirementsIntroDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
    backgroundColor: '#ECDDE1',
  },
  requirementsIntroNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 17,
    backgroundColor: '#FFF3F6',
    borderWidth: 1,
    borderColor: '#F0D5DC',
  },
  requirementsIntroNoteCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  requirementsIntroNoteTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  requirementsIntroNoteText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  requirementsIntroReminder: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 17,
    backgroundColor: theme.colors.palette.wine700,
  },
  requirementsIntroReminderText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: '#FFFFFF',
  },
  requirementsIntroActions: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ECDDE1',
    backgroundColor: '#FFFBFC',
  },
  requirementsIntroContinue: {
    overflow: 'hidden',
    minHeight: 56,
    borderRadius: 18,
    ...theme.shadows.soft,
  },
  requirementsIntroContinueSurface: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 18,
  },
  requirementsIntroContinueText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  requirementsIntroContinueIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  captureTutorialOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  captureTutorialBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  captureTutorialSheet: {
    maxHeight: '86%',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: theme.colors.backgroundPrimary,
    gap: theme.spacing.md,
  },
  captureTutorialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  captureTutorialHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  captureTutorialEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase',
  },
  captureTutorialTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  captureTutorialClose: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
  },
  captureTutorialList: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  captureTutorialScroll: {
    flexGrow: 0,
  },
  captureTutorialItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
  },
  captureTutorialItemActive: {
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  captureTutorialNumberWrap: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
  },
  captureTutorialNumber: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textOnBrand,
  },
  captureTutorialCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  captureTutorialItemTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  captureTutorialDisplayTip: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.normal,
    color: theme.colors.textSecondary,
  },
  captureTutorialTipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  captureTutorialTip: {
    overflow: 'hidden',
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    backgroundColor: theme.colors.backgroundPrimary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  captureInstructionPopupOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xxl,
    backgroundColor: 'rgba(17, 4, 8, 0.64)',
  },
  captureInstructionPopupBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  captureInstructionPopupCard: {
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
    borderRadius: 27,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
    backgroundColor: '#FFFBFC',
    ...theme.shadows.card,
  },
  captureInstructionPopupHero: {
    position: 'relative',
    overflow: 'hidden',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  captureInstructionPopupGlow: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    right: -58,
    top: -86,
    backgroundColor: 'rgba(255,255,255,0.11)',
  },
  captureInstructionPopupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  captureInstructionPopupIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  captureInstructionPopupCopy: {
    flex: 1,
    minWidth: 0,
  },
  captureInstructionPopupStep: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.9,
    color: '#F4D7DF',
  },
  captureInstructionPopupTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  captureInstructionPopupClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  captureInstructionPopupHeroText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: '#F9EDEF',
  },
  captureInstructionPopupBody: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
  },
  captureInstructionPopupProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  captureInstructionPopupProgressDot: {
    width: 18,
    height: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: '#E8D9DD',
  },
  captureInstructionPopupProgressDotActive: {
    backgroundColor: '#C98B9B',
  },
  captureInstructionPopupProgressDotCurrent: {
    width: 30,
    backgroundColor: theme.colors.brandPrimary,
  },
  captureInstructionPopupFocusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  captureInstructionPopupFocusIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7E8EC',
  },
  captureInstructionPopupFocusCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  captureInstructionPopupFocusLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.25,
    color: theme.colors.brandPrimary,
  },
  captureInstructionPopupTip: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  captureInstructionPopupTips: {
    gap: theme.spacing.sm,
  },
  captureInstructionPopupTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  captureInstructionPopupCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
  },
  captureInstructionPopupTipText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  captureInstructionPopupAction: {
    overflow: 'hidden',
    minHeight: 56,
    marginTop: theme.spacing.xs,
    borderRadius: 18,
    ...theme.shadows.soft,
  },
  captureInstructionPopupActionSurface: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 18,
  },
  captureInstructionPopupActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  captureInstructionPopupActionArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  answerSummaryCompact: {
    gap: theme.spacing.xs,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  stepProgressTrack: {
    height: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceSoft,
    overflow: 'hidden',
    marginBottom: theme.spacing.xs,
  },
  stepProgressFill: {
    height: '100%',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  progressText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase',
  },
  progressHelper: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
  },
  questionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  questionHelper: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  questionDisclaimer: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textMuted,
  },
  questionDisclaimerRow: {
    maxWidth: 300,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
  },
  questionError: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textError,
  },
  errorStateHeader: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    alignItems: 'flex-start',
    marginBottom: theme.spacing.lg,
  },
  errorStateIcon: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.errorSurface,
  },
  errorStateCopy: {
    flex: 1,
    minWidth: 0,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  checkBox: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.backgroundPrimary,
  },
  checkBoxActive: {
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimary,
  },
  checkLabel: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textPrimary,
  },
  slotRail: {
    gap: theme.spacing.xs,
  },
  slotRailItem: {
    padding: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
  },
  slotRailItemActive: {
    borderWidth: 1,
    borderColor: theme.colors.brandPrimary,
  },
  slotRailLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  slotRailLabelDone: {
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.weights.semibold,
  },
  liveCameraPanel: {
    gap: theme.spacing.sm,
    paddingBottom: 0,
    alignItems: 'center',
    borderRadius: 28,
    backgroundColor: '#111111',
    overflow: 'hidden',
  },
  liveCameraStage: {
    alignSelf: 'center',
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: theme.colors.backgroundDark,
    position: 'relative',
  },
  liveCameraPreview: {
    width: '100%',
    height: '100%',
  },
  liveCameraPermission: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceSoft,
  },
  liveCameraPermissionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.compact.body,
    color: theme.colors.textPrimary,
  },
  liveCameraPermissionBody: {
    maxWidth: 220,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  livePermissionAction: {
    marginTop: theme.spacing.xs,
    minWidth: 190,
  },
  liveCameraTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.24)',
    zIndex: 4,
  },
  liveCameraOverlayIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  liveCameraTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveStatusPill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    maxWidth: '44%',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(17,17,17,0.58)',
  },
  liveStatusPillSuccess: {
    backgroundColor: 'rgba(17,17,17,0.58)',
  },
  liveStatusPillWarning: {
    backgroundColor: 'rgba(17,17,17,0.58)',
  },
  liveStatusPillError: {
    backgroundColor: 'rgba(17,17,17,0.58)',
  },
  liveStatusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.textSuccess,
  },
  liveStatusDotActive: {
    backgroundColor: theme.colors.brandPrimary,
  },
  liveStatusDotError: {
    backgroundColor: theme.colors.textError,
  },
  liveStatusDotValid: {
    backgroundColor: theme.colors.textSuccess,
  },
  liveStatusText: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  liveCounterText: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.88)',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  liveFrameGuide: {
    position: 'absolute',
    top: 116,
    left: 42,
    right: 42,
    bottom: 72,
    borderRadius: 18,
  },
  liveLengthGuide: {
    position: 'absolute',
    top: 12,
    bottom: 12,
    left: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  liveLengthGuideLine: {
    flex: 1,
    width: 2,
    marginVertical: 6,
    borderRadius: theme.radius.full,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  liveLengthGuideLabelTop: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
    textTransform: 'uppercase',
  },
  liveLengthGuideLabelBottom: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
    textTransform: 'uppercase',
  },
  liveScanLine: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 16,
    height: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
    shadowColor: theme.colors.brandPrimary,
    shadowOpacity: 0.45,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    zIndex: 2,
  },
  liveCountdownOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  liveCountdownNumber: {
    width: 88,
    height: 88,
    borderRadius: 44,
    overflow: 'hidden',
    textAlign: 'center',
    textAlignVertical: 'center',
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 46,
    lineHeight: 88,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  liveFrameCornerTopLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 44,
    height: 44,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: theme.colors.brandPrimary,
    borderTopLeftRadius: 22,
  },
  liveFrameCornerTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: theme.colors.brandPrimary,
    borderTopRightRadius: 22,
  },
  liveFrameCornerBottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 44,
    height: 44,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: theme.colors.brandPrimary,
    borderBottomLeftRadius: 22,
  },
  liveFrameCornerBottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 44,
    height: 44,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: theme.colors.brandPrimary,
    borderBottomRightRadius: 22,
  },
  liveCameraBottomSheet: {
    width: '100%',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderRadius: 0,
    backgroundColor: '#111111',
    gap: theme.spacing.xs,
  },
  liveCaptureInstructionCard: {
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  liveCaptureInstructionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  liveCaptureInstructionCopy: {
    flex: 1,
    minWidth: 0,
  },
  liveCaptureInstructionStep: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase',
  },
  liveCaptureInstructionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
  },
  liveCaptureInstructionIcon: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  liveCaptureInstructionTip: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  liveCaptureInstructionBullets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  liveCaptureInstructionBullet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '48%',
  },
  liveCaptureInstructionDot: {
    width: 5,
    height: 5,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  liveCaptureInstructionBulletText: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: 'rgba(255,255,255,0.82)',
  },
  liveHairDisplayTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  liveHairDisplayTipText: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  liveBottomStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    width: '100%',
  },
  liveViewHintDark: {
    overflow: 'hidden',
    maxWidth: 92,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  liveHoldStillText: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.normal,
    color: theme.colors.textInverse,
  },
  liveCaptureControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xs,
  },
  liveRoundControl: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  liveRoundControlPlaceholder: {
    width: 48,
    height: 48,
  },
  liveCaptureButton: {
    width: 68,
    height: 68,
    borderRadius: theme.radius.full,
    borderWidth: 5,
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.backgroundPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.md,
  },
  liveCaptureButtonReady: {
    borderColor: theme.colors.textSuccess,
    shadowColor: theme.colors.textSuccess,
  },
  liveCaptureButtonDisabled: {
    opacity: 0.6,
  },
  liveAnalysisToast: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.xl,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  liveAnalysisToastText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: theme.typography.compact.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.weights.semibold,
  },
  liveStepLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase',
  },
  liveViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  liveViewHint: {
    overflow: 'hidden',
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    backgroundColor: theme.colors.surfaceSoft,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  liveCameraTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textInverse,
  },
  liveCameraBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: 'rgba(255,255,255,0.78)',
  },
  liveChecklist: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: 0,
  },
  liveChecklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  liveChecklistText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textInverse,
  },
  liveAutoCaptureText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.brandPrimary,
    fontWeight: theme.typography.weights.semibold,
  },
  liveActionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  livePrimaryAction: {
    flex: 1,
    minWidth: 0,
  },
  liveSecondaryAction: {
    flex: 1,
    minWidth: 0,
  },
  liveRemoveAction: {
    alignSelf: 'center',
  },
  livePhotoOverlayActions: {
    position: 'absolute',
    right: theme.spacing.sm,
    bottom: 58,
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  livePhotoIconButton: {
    minWidth: 74,
    minHeight: 38,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(17,17,17,0.72)',
  },
  livePhotoIconButtonPressed: {
    opacity: 0.78,
  },
  livePhotoIconText: {
    color: theme.colors.textInverse,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  liveThumbRail: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    width: '100%',
  },
  liveThumbItem: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    overflow: 'hidden',
  },
  liveThumbItemActive: {
    borderColor: theme.colors.brandPrimary,
  },
  liveThumbItemDone: {
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  liveThumbImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.52,
  },
  liveThumbLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
  },
  liveThumbLabelActive: {
    color: theme.colors.brandPrimary,
  },
  metricCard: {
    flex: 1,
    minWidth: '30%',
    flexGrow: 1,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
  },
  metricLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  metricValue: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    color: theme.colors.textPrimary,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  summaryLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.xs,
  },
  answerSummaryList: {
    gap: theme.spacing.xs,
  },
  answerSummaryItem: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  recommendationList: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  recommendationCard: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: 0,
    borderRadius: theme.radius.lg,
    borderBottomWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  recommendationCardPrimary: {
    borderColor: theme.colors.borderSubtle,
  },
  recommendationPill: {
    alignSelf: 'flex-start',
    marginBottom: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSoft,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.brandPrimary,
  },
  recommendationTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  recommendationBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  analysisSplash: {
    width: '100%',
    minHeight: 360,
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  analysisScanHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  analysisSplashLogo: {
    width: 70,
    height: 70,
  },
  analysisSplashTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
  },
  analysisSplashText: {
    maxWidth: 280,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  analysisScanPercent: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  analysisScanRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: theme.spacing.md,
  },
  analysisScanPreview: {
    flex: 1,
    aspectRatio: 1,
    minWidth: 148,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  analysisScanImage: {
    width: '100%',
    height: '100%',
  },
  analysisScanGrid: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  analysisScanBadge: {
    position: 'absolute',
    left: theme.spacing.sm,
    bottom: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 7,
    backgroundColor: 'rgba(17,17,17,0.72)',
  },
  analysisScanDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  analysisScanBadgeText: {
    color: theme.colors.textInverse,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'uppercase',
  },
  analysisScanChecks: {
    width: 132,
    gap: theme.spacing.sm,
  },
  analysisScanCheck: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
    paddingHorizontal: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  analysisScanCheckText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.weights.semibold,
  },
  analysisScanProgressTrack: {
    height: 8,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  analysisScanProgressFill: {
    height: '100%',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  analysisResultPanel: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  analysisResultTopBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  resultHeaderButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  analysisResultScreenTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  weeklyLimitScreenTitle: {
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  resultSectionCard: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  resultInlineSection: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  resultSectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  resultSectionTitle: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  aiAssessmentNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
  },
  aiAssessmentNoticeText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  finalAiNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  finalAiNoteText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  reviewEditButton: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
  },
  reviewEditButtonActive: {
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimary,
  },
  reviewSummaryList: {
    gap: theme.spacing.xs,
  },
  reviewSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    minHeight: 38,
    paddingBottom: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  reviewSummaryLabel: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  reviewSummaryValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  reviewSummaryNote: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  reviewEditPanel: {
    gap: theme.spacing.md,
  },
  reviewChipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  reviewChip: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  reviewChipActive: {
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimary,
  },
  reviewChipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  reviewChipTextActive: {
    color: theme.colors.textOnBrand,
  },
  conditionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceCardMuted,
  },
  conditionBadgeDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  conditionBadgeDotWarning: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.textError,
  },
  conditionBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  healthScoreBlock: {
    gap: theme.spacing.xs,
  },
  healthScoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
  },
  healthScoreValue: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 38,
    lineHeight: 44,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  healthScoreMax: {
    paddingBottom: 5,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  healthScoreTrack: {
    height: 8,
    borderRadius: theme.radius.full,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceSoft,
  },
  healthScoreFill: {
    height: '100%',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  conditionInsightList: {
    gap: theme.spacing.sm,
  },
  conditionInsightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  conditionInsightText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    color: theme.colors.textPrimary,
  },
  conditionInsightTextMuted: {
    color: theme.colors.textSecondary,
  },
  aiRecommendationList: {
    gap: theme.spacing.md,
  },
  aiRecommendationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  aiRecommendationIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  aiRecommendationCopy: {
    flex: 1,
    gap: 2,
  },
  aiRecommendationTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  aiRecommendationText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  donationAssessmentCard: {
    overflow: 'hidden',
    borderRadius: 12,
    backgroundColor: theme.colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  cutLineImageWrap: {
    height: 224,
    backgroundColor: theme.colors.surfaceSoft,
    position: 'relative',
  },
  cutLineImageTouchable: {
    overflow: 'hidden',
  },
  cutLineImagePressed: {
    opacity: 0.9,
  },
  cutLineImage: {
    width: '100%',
    height: '100%',
  },
  cutLinePreviewHint: {
    position: 'absolute',
    right: theme.spacing.sm,
    bottom: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.full,
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  cutLinePreviewHintText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  cutLineImageFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cutLineOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cutLineDashed: {
    flex: 1,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: theme.colors.brandPrimary,
  },
  cutLineScissorBadge: {
    width: 34,
    height: 34,
    marginHorizontal: theme.spacing.xs,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
    ...theme.shadows.soft,
  },
  cutLineLabel: {
    position: 'absolute',
    top: theme.spacing.sm,
    alignSelf: 'center',
    maxWidth: '88%',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
    ...theme.shadows.soft,
  },
  cutLineLabelText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textOnBrand,
  },
  donationAssessmentBody: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  donationAssessmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  donationReadyBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.full,
  },
  donationReadyBadgeOk: {
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  donationReadyBadgeReview: {
    backgroundColor: theme.colors.surfaceCardMuted,
  },
  donationReadyBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
  },
  donationReadyBadgeTextOk: {
    color: theme.colors.brandPrimary,
  },
  donationReadyBadgeTextReview: {
    color: theme.colors.textSecondary,
  },
  imagePreviewOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xl,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
  },
  imagePreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  imagePreviewCard: {
    flex: 1,
    maxHeight: '92%',
    borderRadius: 18,
    overflow: 'hidden',
  },
  imagePreviewHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
  },
  imagePreviewHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  imagePreviewTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  imagePreviewMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textInverse,
    opacity: 0.78,
  },
  imagePreviewClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  imagePreviewImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  imagePreviewPager: {
    flex: 1,
  },
  imagePreviewPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePreviewDots: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingBottom: theme.spacing.xs,
  },
  imagePreviewDot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.full,
    backgroundColor: 'rgba(255, 255, 255, 0.36)',
  },
  imagePreviewDotActive: {
    width: 18,
    backgroundColor: theme.colors.textInverse,
  },
  assessmentRows: {
    gap: theme.spacing.xs,
  },
  assessmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  assessmentLabel: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    color: theme.colors.textSecondary,
  },
  assessmentValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  assessmentNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  assessmentNoteText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
  },
  resultActions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  resultErrorBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  preAnalysisReviewCard: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  preAnalysisList: {
    gap: theme.spacing.sm,
  },
  preAnalysisStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  preAnalysisStatusCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  preAnalysisValidationText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
  },
  preAnalysisValidationTextError: {
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.semibold,
  },
  preAnalysisCountBadge: {
    minHeight: 34,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceCardMuted,
  },
  preAnalysisCountBadgeOk: {
    backgroundColor: '#E9F8EE',
  },
  preAnalysisCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  preAnalysisIssueList: {
    gap: 6,
    padding: theme.spacing.sm,
    borderRadius: 10,
    backgroundColor: theme.colors.errorSurface,
  },
  preAnalysisIssueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
  },
  preAnalysisIssueText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textError,
  },
  preAnalysisPhotoCard: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
  },
  preAnalysisPhotoFrame: {
    width: 86,
    height: 86,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: theme.colors.backgroundPrimary,
  },
  preAnalysisPhotoPressed: {
    opacity: 0.9,
  },
  preAnalysisPhoto: {
    width: '100%',
    height: '100%',
  },
  preAnalysisPhotoEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preAnalysisPhotoMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  preAnalysisPhotoTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  preAnalysisPhotoSubtitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textSecondary,
  },
  preAnalysisRetakeButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  preAnalysisRetakeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  preAnalysisActions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    marginBottom: 112,
  },
  preAnalysisChecklist: {
    gap: theme.spacing.sm,
  },
  preAnalysisChecklistItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  preAnalysisChecklistText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  preAnalysisChecklistTextError: {
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.semibold,
  },
  resultHeaderButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  weeklyLimitCard: {
    alignItems: 'stretch',
  },
  weeklyLimitIconWrap: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  weeklyLimitTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  weeklyLimitBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight: theme.typography.semantic.body * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  weeklyLimitDateBox: {
    gap: 4,
    padding: theme.spacing.md,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceSoft,
  },
  weeklyLimitDateLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  weeklyLimitDateValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  weeklyLimitTipBox: {
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    borderRadius: 14,
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  weeklyLimitTipLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
    textTransform: 'uppercase',
  },
  weeklyLimitTipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
  },
  scanAgainLink: {
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  scanAgainText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  analysisResultHero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
  },
  analysisResultHeroCopy: {
    flex: 1,
    gap: 5,
  },
  analysisResultLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
  },
  analysisResultTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
  },
  analysisResultSummary: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  analysisResultScore: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.brandPrimary,
  },
  analysisFactsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  analysisLevels: {
    gap: theme.spacing.sm,
  },
  analysisLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  analysisLevelLabel: {
    width: 68,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  analysisLevelTrack: {
    flex: 1,
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceSoft,
    overflow: 'hidden',
  },
  analysisLevelFill: {
    height: '100%',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.textError,
  },
  analysisLevelFillPositive: {
    backgroundColor: theme.colors.brandPrimary,
  },
  analysisLevelValue: {
    width: 18,
    textAlign: 'right',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textPrimary,
  },
  analysisNoteBlock: {
    gap: 6,
  },
  analysisNoteText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textSecondary,
  },
  analysisRecommendationBlock: {
    gap: theme.spacing.xs,
  },
  donationInstructionCard: {
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  donationInstructionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  donationInstructionIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  donationInstructionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  donationInstructionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    color: theme.colors.textPrimary,
  },
  donationInstructionBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  donationSteps: {
    gap: theme.spacing.sm,
  },
  donationStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  donationStepBadge: {
    width: 24,
    height: 24,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
  },
  donationStepBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.brandPrimary,
  },
  donationStepText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
  },
  destinationBox: {
    gap: 4,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
  },
  destinationLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
  },
  destinationText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    color: theme.colors.textPrimary,
  },
  destinationMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  confirmResultBlock: {
    gap: theme.spacing.sm,
  },
  modeList: {
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.md,
  },
  modeCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  modeCardActive: {
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimaryMuted,
  },
  modeCardDisabled: {
    opacity: 0.6,
  },
  modeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  modeTitle: {
    flex: 1,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
  },
  modeIndicator: {
    width: 26,
    height: 26,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.backgroundPrimary,
  },
  modeIndicatorActive: {
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimary,
  },
  modeBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  modeHelper: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textMuted,
  },
  multilineInput: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  questionNavigationDock: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    zIndex: 30,
    elevation: 18,
  },
  questionNavigationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: 7,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(122, 38, 62, 0.16)',
    backgroundColor: 'rgba(255, 252, 253, 0.98)',
    ...theme.shadows.card,
  },
  questionPreviousButtonWrap: {
    flex: 0.85,
    minWidth: 0,
  },
  questionDockButton: {
    position: 'relative',
    overflow: 'hidden',
    width: '100%',
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
  },
  questionDockButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  questionPreviousButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderColor: '#D7BCC4',
    ...theme.shadows.soft,
  },
  questionPreviousButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  questionPreviousIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7E9ED',
  },
  questionPreviousButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
  },
  iconNavButton: {
    width: 54,
    height: 54,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    ...theme.shadows.soft,
  },
  questionNextButtonWrap: {
    flex: 1.15,
    minWidth: 0,
  },
  questionNextButton: {
    minHeight: 56,
    borderRadius: 18,
    borderColor: theme.colors.brandPrimary,
    padding: 0,
    ...theme.shadows.soft,
  },
  questionNextButtonDisabled: {
    borderColor: '#E2CBD2',
    ...theme.shadows.none,
  },
  questionNextButtonSurface: {
    width: '100%',
    minHeight: 56,
    paddingHorizontal: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderRadius: 17,
  },
  questionNextButtonSurfaceDisabled: {
    opacity: 0.92,
  },
  questionNextButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.2,
    color: theme.colors.textOnBrand,
  },
  questionNextButtonTextDisabled: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: '#806770',
  },
  questionNextArrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  questionNextArrowDisabled: {
    backgroundColor: 'rgba(122, 38, 62, 0.08)',
  },
});
