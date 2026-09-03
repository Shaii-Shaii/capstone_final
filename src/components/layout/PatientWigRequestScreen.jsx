import { zodResolver } from "@hookform/resolvers/zod";
import { CameraView, useCameraPermissions } from "expo-camera";
import Constants from "expo-constants";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useFocusEffect } from "@react-navigation/native";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Image,
    KeyboardAvoidingView,
    Modal,
    PanResponder,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { patientDashboardNavItems } from "../../constants/dashboard";
import { resolvePatientThemeRoles, theme } from "../../design-system/theme";
import {
    wigRequestDefaultValues,
    wigRequestSchema,
} from "../../features/wigRequest.schema";
import { upsertPatientWigSafetyAssessment } from "../../features/wigRequest.api";
import { useNotifications } from "../../hooks/useNotifications";
import { usePatientWigRequest } from "../../hooks/usePatientWigRequest";
import { useProcessTracking } from "../../hooks/useProcessTracking";
import { useAuth } from "../../providers/AuthProvider";
import { verifyMedicalCertificateAsset } from "../../features/patientMedicalCertificate.service";
import { getWigRequestCancellationEligibility } from "../../features/wigRequest.service";
import { logAppError } from "../../utils/appErrors";
import { DonorTopBar } from "../donor/DonorTopBar";
import { LegalDocumentPreview } from "../legal/LegalDocumentPreview";
import { AppButton } from "../ui/AppButton";
import { AppCard } from "../ui/AppCard";
import { AppIcon } from "../ui/AppIcon";
import { AppInput } from "../ui/AppInput";
import { StatusBanner } from "../ui/StatusBanner";
import { DashboardHeaderSurface } from "./DashboardHeaderSurface";
import { DashboardLayout } from "./DashboardLayout";
import { fetchActiveLegalDocuments } from "../../features/donorCompliance.service";

let NativeVisionCamera = null;
let useNativeCameraDevice = null;
let useNativeFrameProcessor = null;
let useNativeFaceDetector = null;
let NativeWorklets = null;
let MediaPipeCamera = null;
let useMediaPipeFaceLandmarkDetection = null;
let MediaPipeRunningMode = null;
let MediaPipeDelegate = null;
let viewShotCaptureRef = null;
let didTryLoadViewShot = false;
const isExpoGoRuntime = Constants?.appOwnership === "expo";
let Pdf = null;

const SAFETY_ASSESSMENT_DEFAULTS = {
  hasKnownAllergies: null,
  allergyDetails: "",
  hasSensitiveScalp: null,
  hasScalpIrritation: null,
  hasOpenScalpWounds: null,
  hasMedicalRestriction: null,
  medicalRestrictionDetails: "",
  informationConfirmed: false,
};

const getPatientGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const wigRequestGuideSteps = [
  {
    key: "details",
    icon: "clipboard-account-outline",
    label: "Confirm details",
  },
  {
    key: "preference",
    icon: "creation-outline",
    label: "Choose a style",
  },
  {
    key: "review",
    icon: "shield-check-outline",
    label: "Submit for review",
  },
];

try {
  if (!isExpoGoRuntime) {
    const pdfModule = require("react-native-pdf");
    Pdf = pdfModule?.default || pdfModule;
  }
} catch {
  Pdf = null;
}

try {
  if (!isExpoGoRuntime) {
    const visionCameraModule = require("react-native-vision-camera");
    NativeVisionCamera = visionCameraModule?.Camera || null;
    useNativeCameraDevice = visionCameraModule?.useCameraDevice || null;
    useNativeFrameProcessor = visionCameraModule?.useFrameProcessor || null;
  }
} catch {
  NativeVisionCamera = null;
  useNativeCameraDevice = null;
  useNativeFrameProcessor = null;
}

try {
  if (!isExpoGoRuntime) {
    const faceDetectorModule = require("react-native-vision-camera-face-detector");
    useNativeFaceDetector = faceDetectorModule?.useFaceDetector || null;
  }
} catch {
  useNativeFaceDetector = null;
}

try {
  if (!isExpoGoRuntime) {
    const workletsModule = require("react-native-worklets-core");
    NativeWorklets = workletsModule?.Worklets || null;
  }
} catch {
  NativeWorklets = null;
}

try {
  if (!isExpoGoRuntime) {
    const mediaPipeModule = require("react-native-mediapipe");
    MediaPipeCamera = mediaPipeModule?.MediapipeCamera || null;
    useMediaPipeFaceLandmarkDetection =
      mediaPipeModule?.useFaceLandmarkDetection || null;
    MediaPipeRunningMode = mediaPipeModule?.RunningMode || null;
    MediaPipeDelegate = mediaPipeModule?.Delegate || null;
  }
} catch {
  MediaPipeCamera = null;
  useMediaPipeFaceLandmarkDetection = null;
  MediaPipeRunningMode = null;
  MediaPipeDelegate = null;
}

const canUseMediaPipeTryOnCamera = Boolean(
  MediaPipeCamera &&
  useMediaPipeFaceLandmarkDetection &&
  MediaPipeRunningMode &&
  MediaPipeDelegate &&
  NativeVisionCamera &&
  useNativeCameraDevice,
);

const canUseNativeTryOnCamera = Boolean(
  NativeVisionCamera &&
  useNativeCameraDevice &&
  useNativeFrameProcessor &&
  useNativeFaceDetector &&
  NativeWorklets?.createRunOnJS,
);

const canUseFaceTrackingTryOnCamera =
  canUseMediaPipeTryOnCamera || canUseNativeTryOnCamera;

const getViewShotCaptureRef = () => {
  if (didTryLoadViewShot) return viewShotCaptureRef;
  didTryLoadViewShot = true;

  try {
    viewShotCaptureRef = require("react-native-view-shot")?.captureRef || null;
  } catch {
    viewShotCaptureRef = null;
  }

  return viewShotCaptureRef;
};

const FACE_LANDMARKER_MODEL = "face_landmarker.task";
const CAPTURE_FRAME_INSET = 20;
const CAPTURE_FACE_GUIDE_TOP = 46;
const CAPTURE_FACE_GUIDE_WIDTH = 142;
const CAPTURE_FACE_GUIDE_HEIGHT = 190;
const CAPTURE_FACE_GUIDE_RADIUS = 72;
const DEFAULT_WIG_CALIBRATION = {
  offsetX: 0,
  offsetY: 0,
  scale: 1.08,
};

const formatRequestStatus = (value) => {
  const raw = String(value || "Pending").trim();
  if (!raw) return "Pending";
  return raw
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const formatPatientFieldValue = (value, fallback = "Not provided") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const getFileNameFromUrl = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const pathname = decodeURIComponent(url.pathname || "");
    return pathname.split("/").filter(Boolean).pop() || normalized;
  } catch {
    return normalized.split("/").filter(Boolean).pop() || normalized;
  }
};

const isImageDocumentUrl = (value = "") => (
  /^data:image\//i.test(String(value || ""))
  || /\.(png|jpe?g|webp|gif)(?:\?|#|$)/i.test(String(value || ""))
);

const isPdfDocumentUrl = (value = "") => (
  /^data:application\/pdf/i.test(String(value || ""))
  || /\.pdf(?:\?|#|$)/i.test(String(value || ""))
);

const buildRecommendationOptions = ({
  preview,
  specification,
  draftValues,
}) => {
  if (Array.isArray(preview?.options) && preview.options.length) {
    return preview.options.slice(0, 3).map((option, index) => ({
      id: option.id || `option-${index}`,
      name: option.name || `Style ${index + 1}`,
      note: option.note || "Suggested wig option",
      summary: option.summary || option.note || "",
      styleNotes: option.style_notes || option.note || "",
      family: option.family || "",
      matchLabel: index === 0
        ? "#1 - Best overall match"
        : index === 1
          ? "#2 - Great alternative"
          : "#3 - Another flattering option",
      suitabilityReason: option.suitability_reason || option.note || "",
      selectedWig: option.selected_wig || option.selectedWig || null,
      optionIndex: option.option_index || index + 1,
      generatedImageUri:
        option.generated_image_data_url || option.generatedImageDataUrl || "",
      previewUrl:
        option.preview_url ||
        option.generated_image_data_url ||
        option.generatedImageDataUrl ||
        "",
    }));
  }

  const fallbackOptions = [
    specification?.preferred_length || draftValues?.preferredLength
      ? {
          id: "preferred-length",
          name: specification?.preferred_length || draftValues?.preferredLength,
          note: "Suggested length direction",
          family: "",
          matchLabel: "Suggested",
          generatedImageUri: "",
        }
      : null,
    specification?.preferred_color || draftValues?.preferredColor
      ? {
          id: "preferred-color",
          name: specification?.preferred_color || draftValues?.preferredColor,
          note: "Suggested color direction",
          family: "",
          matchLabel: "Selected",
          generatedImageUri: "",
        }
      : null,
    preview?.style_notes
      ? {
          id: "fit-notes",
          name: "Fit Notes",
          note: preview.style_notes,
          family: "",
          matchLabel: "Note",
          generatedImageUri: "",
        }
      : null,
  ].filter(Boolean);

  return fallbackOptions.slice(0, 3);
};

const LAYER_SETTING_KEYS = {
  fullWig: [
    "fullWig",
    "full_wig",
    "full-wig",
    "FullWig",
    "Full Wig",
    "full_wig_layer",
  ],
  backHair: [
    "backHair",
    "back_hair",
    "back-hair",
    "BackHair",
    "Back Hair",
    "back_hair_layer",
  ],
  frontBangs: [
    "frontBangs",
    "front_bangs",
    "front-bangs",
    "FrontBangs",
    "Front Bangs",
    "front_bangs_layer",
  ],
};

const getLayerSettingsCandidates = (fitSettings = {}, layerKey = "fullWig") => {
  const keys = LAYER_SETTING_KEYS[layerKey] || [layerKey];
  const scopedSources = [
    fitSettings?.layers,
    fitSettings?.Layers,
    fitSettings?.layerSettings,
    fitSettings?.layer_settings,
    fitSettings,
  ].filter(Boolean);

  return [
    ...scopedSources.flatMap((source) => keys.map((key) => source?.[key])),
    fitSettings,
  ].filter(Boolean);
};

const resolveLayerFit = (fitSettings = {}, layerKey = "fullWig") => {
  const candidates = getLayerSettingsCandidates(fitSettings, layerKey);
  const source = candidates[0] || {};
  const offsetSource =
    source.offset || source.position || source.translate || {};
  const width = source.width ?? source.w ?? (layerKey === "fullWig" ? 72 : 64);
  const height =
    source.height ?? source.h ?? (layerKey === "fullWig" ? 70 : 42);
  const x =
    source.x ??
    source.left ??
    offsetSource.x ??
    source.offsetX ??
    source.offset_x ??
    (layerKey === "fullWig" ? 14 : 18);
  const y =
    source.y ??
    source.top ??
    offsetSource.y ??
    source.offsetY ??
    source.offset_y ??
    (layerKey === "frontBangs" ? 18 : 12);
  const scale = Number(source.scale ?? fitSettings?.scale ?? 1) || 1;
  const rotation =
    source.rotation ?? source.rotate ?? fitSettings?.rotation ?? 0;
  const opacity = source.opacity ?? 1;
  const offsetX =
    Number(
      source.offsetX ??
        source.offset_x ??
        source.translateX ??
        source.translate_x ??
        source.xOffset ??
        source.x_offset ??
        offsetSource.x ??
        0,
    ) || 0;
  const offsetY =
    Number(
      source.offsetY ??
        source.offset_y ??
        source.translateY ??
        source.translate_y ??
        source.yOffset ??
        source.y_offset ??
        offsetSource.y ??
        0,
    ) || 0;

  return {
    width,
    height,
    x,
    y,
    scale,
    rotation,
    opacity,
    offsetX,
    offsetY,
  };
};

const toPercent = (value, fallback) => {
  if (typeof value === "string") return value;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return `${fallback}%`;
  return `${numericValue > 1 ? numericValue : numericValue * 100}%`;
};

const buildTryOnLayerStyle = (fitSettings, layerKey, zIndex) => {
  const fit = resolveLayerFit(fitSettings, layerKey);

  return {
    position: "absolute",
    left: toPercent(fit.x, 50),
    top: toPercent(fit.y, 12),
    width: toPercent(fit.width, 72),
    height: toPercent(fit.height, 70),
    opacity: fit.opacity,
    zIndex,
    elevation: zIndex,
    transform: [
      { scale: fit.scale },
      {
        rotate:
          typeof fit.rotation === "number"
            ? `${fit.rotation}deg`
            : String(fit.rotation || "0deg"),
      },
    ],
  };
};

const getFacePoint = (faceFrame, key) => {
  const point = faceFrame?.landmarks?.[key];
  const x = Number(point?.x);
  const y = Number(point?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

const averagePoints = (points = []) => {
  const validPoints = points.filter(Boolean);
  if (!validPoints.length) return null;

  return {
    x:
      validPoints.reduce((total, point) => total + point.x, 0) /
      validPoints.length,
    y:
      validPoints.reduce((total, point) => total + point.y, 0) /
      validPoints.length,
  };
};

const distanceBetweenPoints = (a, b) => {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
};

const lerp = (from, to, amount = 0.35) => from + (to - from) * amount;

const lerpPoint = (previous, next, amount) => {
  if (!previous || !next) return next || null;
  return {
    x: lerp(previous.x, next.x, amount),
    y: lerp(previous.y, next.y, amount),
  };
};

const smoothFaceFrame = (previous, next, amount = 0.35) => {
  if (!next) return null;
  if (!previous) return next;

  const nextBounds = next.bounds || next;
  const previousBounds = previous.bounds || previous;
  const landmarks = Object.keys(next.landmarks || {}).reduce(
    (result, key) => ({
      ...result,
      [key]: lerpPoint(
        previous.landmarks?.[key],
        next.landmarks?.[key],
        amount,
      ),
    }),
    {},
  );

  return {
    ...next,
    rollAngle: lerp(
      Number(previous.rollAngle || 0),
      Number(next.rollAngle || 0),
      amount,
    ),
    yawAngle: lerp(
      Number(previous.yawAngle || 0),
      Number(next.yawAngle || 0),
      amount,
    ),
    bounds: {
      x: lerp(
        Number(previousBounds.x ?? previousBounds.left ?? 0),
        Number(nextBounds.x ?? nextBounds.left ?? 0),
        amount,
      ),
      y: lerp(
        Number(previousBounds.y ?? previousBounds.top ?? 0),
        Number(nextBounds.y ?? nextBounds.top ?? 0),
        amount,
      ),
      width: lerp(
        Number(previousBounds.width || 0),
        Number(nextBounds.width || 0),
        amount,
      ),
      height: lerp(
        Number(previousBounds.height || 0),
        Number(nextBounds.height || 0),
        amount,
      ),
    },
    landmarks,
  };
};

const normalizeFaceTiltDegrees = (angle) => {
  let normalized = Number(angle) || 0;
  normalized = ((normalized + 180) % 360) - 180;
  if (normalized > 90) normalized -= 180;
  if (normalized < -90) normalized += 180;
  return normalized;
};

const rotateNormalizedMediaPipePoint = (point, rotation = 0) => {
  const normalizedRotation = ((Number(rotation) || 0) + 360) % 360;
  if (normalizedRotation === 90) return { x: point.y, y: 1 - point.x };
  if (normalizedRotation === 180) return { x: 1 - point.x, y: 1 - point.y };
  if (normalizedRotation === 270) return { x: 1 - point.y, y: point.x };
  return point;
};

const resolveRotatedFrameSize = (width, height, rotation = 0) => {
  const normalizedRotation = ((Number(rotation) || 0) + 360) % 360;
  if (normalizedRotation === 90 || normalizedRotation === 270) {
    return { width: height, height: width };
  }
  return { width, height };
};

const mapFramePointToView = (point, frameSize, viewSize, mirrored = false) => {
  if (
    !point ||
    !frameSize?.width ||
    !frameSize?.height ||
    !viewSize?.width ||
    !viewSize?.height
  ) {
    return null;
  }

  const framePoint = {
    x: mirrored ? frameSize.width - point.x : point.x,
    y: point.y,
  };
  const frameRatio = frameSize.width / frameSize.height;
  const viewRatio = viewSize.width / viewSize.height;
  const scale =
    frameRatio > viewRatio
      ? viewSize.height / frameSize.height
      : viewSize.width / frameSize.width;
  const offsetX =
    frameRatio > viewRatio ? (viewSize.width - frameSize.width * scale) / 2 : 0;
  const offsetY =
    frameRatio > viewRatio
      ? 0
      : (viewSize.height - frameSize.height * scale) / 2;

  return {
    x: framePoint.x * scale + offsetX,
    y: framePoint.y * scale + offsetY,
  };
};

const getNumericFitValue = (source, keys, fallback) => {
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const value = source?.[key];
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return numericValue;
  }
  return fallback;
};

const resolveLayerAnchor = (fitSettings = {}, layerKey = "fullWig") => {
  const layerFit = resolveLayerFit(fitSettings, layerKey);
  const layerSettings =
    getLayerSettingsCandidates(fitSettings, layerKey)[0] || {};
  const anchorSettings =
    layerSettings?.anchor ||
    layerSettings?.face_anchor ||
    fitSettings?.anchor ||
    fitSettings?.face_anchor ||
    {};

  return {
    faceCenterX: getNumericFitValue(
      anchorSettings,
      [
        "faceCenterX",
        "face_center_x",
        "cutoutCenterX",
        "cutout_center_x",
        "anchorX",
        "anchor_x",
      ],
      layerKey === "frontBangs" ? 0.5 : 0.52,
    ),
    foreheadY: getNumericFitValue(
      anchorSettings,
      [
        "foreheadY",
        "forehead_y",
        "hairlineY",
        "hairline_y",
        "anchorY",
        "anchor_y",
      ],
      layerKey === "frontBangs" ? 0.42 : 0.34,
    ),
    faceWidthRatio: getNumericFitValue(
      anchorSettings,
      [
        "faceWidthRatio",
        "face_width_ratio",
        "cutoutWidthRatio",
        "cutout_width_ratio",
      ],
      layerKey === "frontBangs" ? 0.68 : 0.5,
    ),
    faceHeightRatio: getNumericFitValue(
      anchorSettings,
      [
        "faceHeightRatio",
        "face_height_ratio",
        "cutoutHeightRatio",
        "cutout_height_ratio",
      ],
      layerKey === "frontBangs" ? 0.38 : 0.62,
    ),
    userOffsetX: layerFit.offsetX,
    userOffsetY: layerFit.offsetY,
  };
};

const resolveTryOnConfig = (fitSettings = {}, layerKey = "fullWig") => {
  const globalConfig =
    fitSettings?.try_on || fitSettings?.tryOn || fitSettings?.filter || {};
  const layerKeys = LAYER_SETTING_KEYS[layerKey] || [layerKey];
  const layerConfig =
    [
      ...layerKeys.map((key) => globalConfig?.layers?.[key]),
      ...layerKeys.map((key) => globalConfig?.[key]),
      ...getLayerSettingsCandidates(fitSettings, layerKey).map(
        (settings) => settings?.try_on || settings?.tryOn,
      ),
    ].filter(Boolean)[0] || {};
  const source = { ...globalConfig, ...layerConfig };
  const faceHoleSource =
    source?.faceHole ||
    source?.face_hole ||
    source?.faceOpening ||
    source?.face_opening ||
    {};
  const defaultFaceHole =
    layerKey === "frontBangs"
      ? { x: 0.18, y: 0.28, width: 0.64, height: 0.58 }
      : { x: 0.2, y: 0.25, width: 0.6, height: 0.62 };

  return {
    scaleMultiplier: getNumericFitValue(
      source,
      [
        "scaleMultiplier",
        "scale_multiplier",
        "widthMultiplier",
        "width_multiplier",
      ],
      layerKey === "frontBangs" ? 1 : 1.08,
    ),
    scaleY: getNumericFitValue(
      source,
      ["scaleY", "scale_y", "heightScale", "height_scale"],
      layerKey === "frontBangs" ? 0.94 : 1,
    ),
    heightMultiplier: getNumericFitValue(
      source,
      ["heightMultiplier", "height_multiplier", "aspectRatio", "aspect_ratio"],
      layerKey === "frontBangs" ? 0.42 : 1.9,
    ),
    verticalOffset: getNumericFitValue(
      source,
      ["verticalOffset", "vertical_offset", "offsetYRatio", "offset_y_ratio"],
      layerKey === "frontBangs" ? -0.08 : -0.1,
    ),
    horizontalOffset: getNumericFitValue(
      source,
      [
        "horizontalOffset",
        "horizontal_offset",
        "offsetXRatio",
        "offset_x_ratio",
      ],
      0,
    ),
    rotationOffset: getNumericFitValue(
      source,
      ["rotationOffset", "rotation_offset"],
      0,
    ),
    anchor: source?.anchor || "forehead",
    faceHole: {
      x: getNumericFitValue(faceHoleSource, ["x", "left"], defaultFaceHole.x),
      y: getNumericFitValue(faceHoleSource, ["y", "top"], defaultFaceHole.y),
      width: getNumericFitValue(
        faceHoleSource,
        ["width", "w"],
        defaultFaceHole.width,
      ),
      height: getNumericFitValue(
        faceHoleSource,
        ["height", "h"],
        defaultFaceHole.height,
      ),
    },
  };
};

const normalizeMediaPipeLandmarkPoint = (landmark, coordinateSpace) => {
  const x = Number(landmark?.x);
  const y = Number(landmark?.y);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !coordinateSpace?.viewSize?.width ||
    !coordinateSpace?.viewSize?.height
  ) {
    return null;
  }

  const rotatedPoint = rotateNormalizedMediaPipePoint(
    { x, y },
    coordinateSpace.rotation,
  );
  const framePoint = {
    x: rotatedPoint.x * coordinateSpace.frameSize.width,
    y: rotatedPoint.y * coordinateSpace.frameSize.height,
  };

  return mapFramePointToView(
    framePoint,
    coordinateSpace.frameSize,
    coordinateSpace.viewSize,
    coordinateSpace.mirrored,
  );
};

const averageMediaPipeLandmarks = (landmarks, indices, coordinateSpace) =>
  averagePoints(
    indices.map((index) =>
      normalizeMediaPipeLandmarkPoint(landmarks?.[index], coordinateSpace),
    ),
  );

const buildMediaPipeFaceFrame = (resultBundle, viewSize, mirrored) => {
  const landmarks = resultBundle?.results?.[0]?.faceLandmarks?.[0];
  if (
    !Array.isArray(landmarks) ||
    !landmarks.length ||
    !viewSize?.width ||
    !viewSize?.height
  ) {
    return null;
  }

  const inputWidth = Number(resultBundle?.inputImageWidth || viewSize.width);
  const inputHeight = Number(resultBundle?.inputImageHeight || viewSize.height);
  const rotation = Number(resultBundle?.inputImageRotation || 0);
  const coordinateSpace = {
    frameSize: resolveRotatedFrameSize(inputWidth, inputHeight, rotation),
    mirrored,
    rotation,
    viewSize,
  };
  const points = landmarks
    .map((landmark) =>
      normalizeMediaPipeLandmarkPoint(landmark, coordinateSpace),
    )
    .filter(Boolean);
  if (!points.length) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const leftTemple = averageMediaPipeLandmarks(
    landmarks,
    [127, 234, 93],
    coordinateSpace,
  );
  const rightTemple = averageMediaPipeLandmarks(
    landmarks,
    [356, 454, 323],
    coordinateSpace,
  );

  return {
    mediapipe: true,
    autoMode: true,
    frameWidth: viewSize.width,
    frameHeight: viewSize.height,
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    landmarks: {
      LEFT_EYE: averageMediaPipeLandmarks(
        landmarks,
        [33, 133, 159, 145],
        coordinateSpace,
      ),
      RIGHT_EYE: averageMediaPipeLandmarks(
        landmarks,
        [263, 362, 386, 374],
        coordinateSpace,
      ),
      LEFT_EAR: leftTemple,
      RIGHT_EAR: rightTemple,
      LEFT_TEMPLE: leftTemple,
      RIGHT_TEMPLE: rightTemple,
      FOREHEAD: normalizeMediaPipeLandmarkPoint(landmarks[10], coordinateSpace),
      CHIN: normalizeMediaPipeLandmarkPoint(landmarks[152], coordinateSpace),
      NOSE: normalizeMediaPipeLandmarkPoint(landmarks[1], coordinateSpace),
    },
  };
};

const resolveFaceBoxInStage = (faceFrame, stageLayout) => {
  const faceBounds = faceFrame?.bounds || faceFrame;
  if (!faceBounds || !stageLayout?.width || !stageLayout?.height) {
    return null;
  }

  const stageWidth = Number(stageLayout.width || 0);
  const stageHeight = Number(stageLayout.height || 0);
  const rawX = Number(faceBounds.x ?? faceBounds.left ?? 0);
  const rawY = Number(faceBounds.y ?? faceBounds.top ?? 0);
  const rawWidth = Number(faceBounds.width || 0);
  const rawHeight = Number(faceBounds.height || 0);
  if (!rawWidth || !rawHeight) return null;

  const frameWidth = Number(faceFrame?.frameWidth || 0);
  const frameHeight = Number(faceFrame?.frameHeight || 0);
  if (!frameWidth || !frameHeight) {
    const scaleX =
      rawX + rawWidth > stageWidth
        ? stageWidth / Math.max(rawX + rawWidth, 1)
        : 1;
    const scaleY =
      rawY + rawHeight > stageHeight
        ? stageHeight / Math.max(rawY + rawHeight, 1)
        : 1;
    return {
      x: rawX * scaleX,
      y: rawY * scaleY,
      width: rawWidth * scaleX,
      height: rawHeight * scaleY,
    };
  }

  if (faceFrame?.autoMode) {
    return {
      x: rawX,
      y: rawY,
      width: rawWidth,
      height: rawHeight,
    };
  }

  // Vision Camera frame coordinates come from the camera buffer, while the UI
  // displays that buffer with cover scaling. Front camera preview is mirrored.
  const frameIsPortrait = frameHeight >= frameWidth;
  const viewIsPortrait = stageHeight >= stageWidth;
  const sourceWidth =
    frameIsPortrait === viewIsPortrait ? frameWidth : frameHeight;
  const sourceHeight =
    frameIsPortrait === viewIsPortrait ? frameHeight : frameWidth;
  const sourceX = frameIsPortrait === viewIsPortrait ? rawX : rawY;
  const sourceY = frameIsPortrait === viewIsPortrait ? rawY : rawX;
  const sourceFaceWidth =
    frameIsPortrait === viewIsPortrait ? rawWidth : rawHeight;
  const sourceFaceHeight =
    frameIsPortrait === viewIsPortrait ? rawHeight : rawWidth;
  const coverScale = Math.max(
    stageWidth / sourceWidth,
    stageHeight / sourceHeight,
  );
  const renderedWidth = sourceWidth * coverScale;
  const renderedHeight = sourceHeight * coverScale;
  const offsetX = (renderedWidth - stageWidth) / 2;
  const offsetY = (renderedHeight - stageHeight) / 2;
  const mirroredX = sourceWidth - sourceX - sourceFaceWidth;

  return {
    x: mirroredX * coverScale - offsetX,
    y: sourceY * coverScale - offsetY,
    width: sourceFaceWidth * coverScale,
    height: sourceFaceHeight * coverScale,
  };
};

const mapStaticImagePointToStage = (point, frameSize, stageLayout) => {
  if (
    !point ||
    !frameSize?.width ||
    !frameSize?.height ||
    !stageLayout?.width ||
    !stageLayout?.height
  ) {
    return null;
  }

  const coverScale = Math.max(
    stageLayout.width / frameSize.width,
    stageLayout.height / frameSize.height,
  );
  const renderedWidth = frameSize.width * coverScale;
  const renderedHeight = frameSize.height * coverScale;
  const offsetX = (renderedWidth - stageLayout.width) / 2;
  const offsetY = (renderedHeight - stageLayout.height) / 2;

  return {
    x: Number(point.x || 0) * coverScale - offsetX,
    y: Number(point.y || 0) * coverScale - offsetY,
  };
};

const mapStaticImageFaceFrameToStage = (faceFrame, stageLayout) => {
  if (
    faceFrame?.source !== "ai_photo_detection" &&
    faceFrame?.source !== "mediapipe_static_image"
  ) {
    return faceFrame;
  }

  const frameSize = {
    width: Number(faceFrame.frameWidth || 0),
    height: Number(faceFrame.frameHeight || 0),
  };
  const bounds = faceFrame.bounds || {};
  const topLeft = mapStaticImagePointToStage(
    { x: bounds.x, y: bounds.y },
    frameSize,
    stageLayout,
  );
  const bottomRight = mapStaticImagePointToStage(
    {
      x: Number(bounds.x || 0) + Number(bounds.width || 0),
      y: Number(bounds.y || 0) + Number(bounds.height || 0),
    },
    frameSize,
    stageLayout,
  );
  if (!topLeft || !bottomRight) return null;

  const landmarks = Object.entries(faceFrame.landmarks || {}).reduce(
    (result, [key, point]) => {
      const mappedPoint = mapStaticImagePointToStage(point, frameSize, stageLayout);
      return mappedPoint ? { ...result, [key]: mappedPoint } : result;
    },
    {},
  );

  return {
    ...faceFrame,
    autoMode: true,
    frameWidth: stageLayout.width,
    frameHeight: stageLayout.height,
    bounds: {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    },
    landmarks,
  };
};

const normalizeLayerScale = (scale) => {
  const numericScale = Number(scale);
  if (!Number.isFinite(numericScale)) return 1;
  return Math.min(1.18, Math.max(0.82, 1 + (numericScale - 1) * 0.45));
};

const normalizeLayerOffset = (offset, stageLayout) => {
  const numericOffset = Number(offset);
  if (!Number.isFinite(numericOffset)) return 0;
  const baseSize = Math.min(
    Number(stageLayout?.width || 0),
    Number(stageLayout?.height || 0),
  );
  return numericOffset * (baseSize ? baseSize / 1024 : 1);
};

const getTouchDistance = (touches = []) => {
  if (!Array.isArray(touches) || touches.length < 2) return 0;
  const [firstTouch, secondTouch] = touches;
  return Math.hypot(
    Number(secondTouch.pageX || 0) - Number(firstTouch.pageX || 0),
    Number(secondTouch.pageY || 0) - Number(firstTouch.pageY || 0),
  );
};

const resolveLandmarkHeadBox = ({
  fallbackFaceBox,
  forehead,
  chin,
  leftEye,
  rightEye,
  nose,
  leftTemple,
  rightTemple,
}) => {
  if (!fallbackFaceBox) return null;

  const eyeCenter = averagePoints([leftEye, rightEye]);
  const templeCenter = averagePoints([leftTemple, rightTemple]);
  const centerPoint = averagePoints([eyeCenter, nose, templeCenter]);
  const faceCenterX =
    centerPoint?.x || fallbackFaceBox.x + fallbackFaceBox.width / 2;
  const templeDistance = distanceBetweenPoints(leftTemple, rightTemple);
  const eyeDistance = distanceBetweenPoints(leftEye, rightEye);
  const landmarkWidth = Math.max(
    templeDistance ? templeDistance * 1.16 : 0,
    eyeDistance ? eyeDistance * 2.62 : 0,
    fallbackFaceBox.width * 1.06,
  );
  const faceWidth = landmarkWidth || fallbackFaceBox.width;
  const faceTop = Math.min(
    forehead?.y ?? fallbackFaceBox.y,
    eyeCenter ? eyeCenter.y - faceWidth * 0.34 : fallbackFaceBox.y,
  );
  const faceBottom = chin?.y ?? fallbackFaceBox.y + fallbackFaceBox.height;
  const landmarkHeight = Math.max(
    faceBottom - faceTop,
    fallbackFaceBox.height * 0.72,
  );
  const faceHeight = landmarkHeight || fallbackFaceBox.height;

  return {
    x: faceCenterX - faceWidth / 2,
    y: faceTop - faceHeight * 0.04,
    width: faceWidth,
    height: faceHeight * 1.04,
  };
};

const resolveGuideHeadBox = (stageLayout) => {
  const stageWidth = Number(stageLayout?.width || 0);
  const stageHeight = Number(stageLayout?.height || 0);
  if (!stageWidth || !stageHeight) return null;

  return {
    x: (stageWidth - CAPTURE_FACE_GUIDE_WIDTH) / 2,
    y: CAPTURE_FRAME_INSET + CAPTURE_FACE_GUIDE_TOP,
    width: CAPTURE_FACE_GUIDE_WIDTH,
    height: CAPTURE_FACE_GUIDE_HEIGHT,
  };
};

const buildGuideFaceFrame = (stageLayout) => {
  const guideHeadBox = resolveGuideHeadBox(stageLayout);
  if (!guideHeadBox) return null;

  return {
    autoMode: true,
    frameWidth: stageLayout.width,
    frameHeight: stageLayout.height,
    bounds: guideHeadBox,
    landmarks: {
      FOREHEAD: {
        x: guideHeadBox.x + guideHeadBox.width / 2,
        y: guideHeadBox.y + guideHeadBox.height * 0.04,
      },
      CHIN: {
        x: guideHeadBox.x + guideHeadBox.width / 2,
        y: guideHeadBox.y + guideHeadBox.height * 0.96,
      },
      NOSE: {
        x: guideHeadBox.x + guideHeadBox.width / 2,
        y: guideHeadBox.y + guideHeadBox.height * 0.5,
      },
      LEFT_EYE: {
        x: guideHeadBox.x + guideHeadBox.width * 0.36,
        y: guideHeadBox.y + guideHeadBox.height * 0.38,
      },
      RIGHT_EYE: {
        x: guideHeadBox.x + guideHeadBox.width * 0.64,
        y: guideHeadBox.y + guideHeadBox.height * 0.38,
      },
      LEFT_TEMPLE: {
        x: guideHeadBox.x + guideHeadBox.width * 0.16,
        y: guideHeadBox.y + guideHeadBox.height * 0.42,
      },
      RIGHT_TEMPLE: {
        x: guideHeadBox.x + guideHeadBox.width * 0.84,
        y: guideHeadBox.y + guideHeadBox.height * 0.42,
      },
    },
  };
};

const buildFaceAnchoredTryOnLayerStyle = (
  faceFrame,
  stageLayout,
  layerKey,
  zIndex,
  fitSettings = {},
  userCalibration = DEFAULT_WIG_CALIBRATION,
) => {
  const faceBox = resolveFaceBoxInStage(faceFrame, stageLayout);
  if (!faceBox) {
    return null;
  }
  const fit = resolveLayerFit(fitSettings, layerKey);
  const anchor = resolveLayerAnchor(fitSettings, layerKey);
  const tryOnConfig = resolveTryOnConfig(fitSettings, layerKey);
  const calibrationScale = Math.min(
    1.6,
    Math.max(0.75, Number(userCalibration?.scale || 1)),
  );
  const calibrationOffsetX = Number(userCalibration?.offsetX || 0);
  const calibrationOffsetY = Number(userCalibration?.offsetY || 0);

  const leftEye = getFacePoint(faceFrame, "LEFT_EYE");
  const rightEye = getFacePoint(faceFrame, "RIGHT_EYE");
  const leftEar = getFacePoint(faceFrame, "LEFT_EAR");
  const rightEar = getFacePoint(faceFrame, "RIGHT_EAR");
  const forehead = getFacePoint(faceFrame, "FOREHEAD");
  const chin = getFacePoint(faceFrame, "CHIN");
  const nose = getFacePoint(faceFrame, "NOSE");
  const leftTemple = getFacePoint(faceFrame, "LEFT_TEMPLE") || leftEar;
  const rightTemple = getFacePoint(faceFrame, "RIGHT_TEMPLE") || rightEar;
  const eyeCenter = averagePoints([leftEye, rightEye]);
  const templeCenter = averagePoints([leftTemple, rightTemple]);
  const faceCenterPoint = averagePoints([eyeCenter, nose, templeCenter]);
  const faceCenterX =
    faceCenterPoint?.x || eyeCenter?.x || faceBox.x + faceBox.width / 2;
  const eyeLineY = eyeCenter?.y || faceBox.y + faceBox.height * 0.38;
  const earDistance = distanceBetweenPoints(leftEar, rightEar);
  const eyeDistance = distanceBetweenPoints(leftEye, rightEye);
  const templeDistance = distanceBetweenPoints(leftTemple, rightTemple);
  const anchorWidth = Math.max(
    faceBox.width,
    templeDistance || 0,
    earDistance || 0,
    eyeDistance ? eyeDistance * 2.35 : 0,
  );
  const eyeRollAngle =
    leftEye && rightEye
      ? Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) *
        (180 / Math.PI)
      : 0;
  const rollAngle = normalizeFaceTiltDegrees(
    faceFrame?.rollAngle ?? eyeRollAngle ?? 0,
  );
  const yawAngle = Math.abs(Number(faceFrame?.yawAngle || 0));
  const yawScale = Math.max(0.82, 1 - yawAngle / 120);

  if (faceFrame?.mediapipe && forehead && chin) {
    const detectedHeadBox =
      resolveLandmarkHeadBox({
        fallbackFaceBox: faceBox,
        forehead,
        chin,
        leftEye,
        rightEye,
        nose,
        leftTemple,
        rightTemple,
      }) || faceBox;
    const headBox = detectedHeadBox;
    const layerScale = normalizeLayerScale(fit.scale);
    const offsetX =
      normalizeLayerOffset(anchor.userOffsetX, stageLayout) +
      calibrationOffsetX;
    const offsetY =
      normalizeLayerOffset(anchor.userOffsetY, stageLayout) +
      calibrationOffsetY;
    const targetFaceWidth = headBox.width * tryOnConfig.scaleMultiplier;
    const targetFaceHeight = headBox.height * tryOnConfig.scaleY;
    const faceHole = tryOnConfig.faceHole;
    const layerWidth =
      (targetFaceWidth / Math.max(faceHole.width, 0.12)) *
      layerScale *
      calibrationScale;
    const layerHeight =
      (targetFaceHeight / Math.max(faceHole.height, 0.12)) *
      layerScale *
      calibrationScale;
    const faceHoleCenterX = faceHole.x + faceHole.width / 2;
    const rotation =
      Number(fit.rotation || 0) + rollAngle + tryOnConfig.rotationOffset;
    const rawLeft =
      headBox.x +
      headBox.width / 2 -
      layerWidth * faceHoleCenterX +
      headBox.width * tryOnConfig.horizontalOffset +
      offsetX;
    const eyeLift =
      eyeCenter && forehead
        ? Math.max(0, (eyeCenter.y - forehead.y) * 0.18)
        : headBox.height * 0.04;
    const rawTop =
      headBox.y -
      layerHeight * faceHole.y +
      headBox.height * tryOnConfig.verticalOffset -
      eyeLift +
      offsetY;

    return {
      position: "absolute",
      left: Math.min(
        stageLayout.width - layerWidth * 0.18,
        Math.max(-stageLayout.width * 0.28, rawLeft),
      ),
      top: Math.min(
        stageLayout.height - layerHeight * 0.18,
        Math.max(0, rawTop),
      ),
      width: layerWidth,
      height: layerHeight,
      opacity: fit.opacity,
      zIndex,
      elevation: zIndex,
      transform: [{ rotate: `${rotation}deg` }],
    };
  }

  const layerSize =
    layerKey === "frontBangs"
      ? {
          width: anchorWidth * 1.08 * yawScale * fit.scale * calibrationScale,
          height: faceBox.height * 0.44 * fit.scale * calibrationScale,
          top: eyeLineY - faceBox.height * 0.5 * fit.scale * calibrationScale,
        }
      : {
          width: anchorWidth * 1.82 * yawScale * fit.scale * calibrationScale,
          height: faceBox.height * 1.42 * fit.scale * calibrationScale,
          top: eyeLineY - faceBox.height * 0.88 * fit.scale * calibrationScale,
        };
  const left =
    faceCenterX - layerSize.width / 2 + fit.offsetX + calibrationOffsetX;
  const top = layerSize.top + fit.offsetY + calibrationOffsetY;
  const rotation = Number(fit.rotation || 0) + rollAngle;

  if (faceFrame?.autoMode) {
    return {
      position: "absolute",
      left: Math.max(-stageLayout.width * 0.25, left),
      top: Math.max(-stageLayout.height * 0.35, top),
      width: layerSize.width,
      height: layerSize.height,
      opacity: fit.opacity,
      zIndex,
      elevation: zIndex,
      transform: [{ rotate: `${rotation}deg` }],
    };
  }

  const faceX = faceBox.x;
  const faceY = faceBox.y;
  const faceWidth = faceBox.width;
  const faceHeight = faceBox.height;

  const widthMultiplier =
    (layerKey === "frontBangs" ? 1.16 : 1.82) * fit.scale * calibrationScale;
  const heightMultiplier =
    (layerKey === "frontBangs" ? 0.5 : 1.42) * fit.scale * calibrationScale;
  const topOffset =
    (layerKey === "frontBangs" ? 0.3 : 0.78) * fit.scale * calibrationScale;

  return {
    position: "absolute",
    left: Math.max(
      -stageLayout.width * 0.25,
      faceX +
        faceWidth / 2 -
        (faceWidth * widthMultiplier) / 2 +
        fit.offsetX +
        calibrationOffsetX,
    ),
    top: Math.max(
      -stageLayout.height * 0.35,
      faceY - faceHeight * topOffset + fit.offsetY + calibrationOffsetY,
    ),
    width: faceWidth * widthMultiplier,
    height: faceHeight * heightMultiplier,
    opacity: fit.opacity,
    zIndex,
    elevation: zIndex,
    transform: [{ rotate: `${Number(fit.rotation || 0)}deg` }],
  };
};

const getPrimaryTryOnImageUrl = (wig) =>
  wig?.layer_full_wig_url ||
  wig?.layer_front_bangs_url ||
  wig?.layer_back_hair_url ||
  "";

const getWigPreviewImageUrl = (wig) =>
  wig?.thumbnail_url ||
  wig?.layer_full_wig_url ||
  wig?.layer_front_bangs_url ||
  wig?.layer_back_hair_url ||
  "";

function WigLayerImage({ sourceUri, style }) {
  return (
    <Image
      source={{ uri: sourceUri }}
      resizeMode="contain"
      fadeDuration={0}
      style={style}
    />
  );
}

const getCameraRuntimeMessage = (error) => {
  const code = String(error?.code || "");
  if (code === "system/camera-is-restricted") {
    return "Camera is restricted by this device. Use upload instead or allow camera access in device policy/settings.";
  }
  if (code.includes("permission")) {
    return "Camera permission is not available. Allow camera access or upload a photo.";
  }
  return "Camera is unavailable right now. Use upload instead.";
};

function CameraUnavailablePlaceholder({ message }) {
  return (
    <View style={styles.captureStagePlaceholder}>
      <AppIcon name="camera" state="active" size="xl" />
      <Text style={styles.captureStagePlaceholderTitle}>
        Camera unavailable
      </Text>
      <Text style={styles.captureStagePlaceholderBody}>{message}</Text>
    </View>
  );
}

function MediaPipeTryOnFaceCamera({
  cameraRef,
  onFaceBoundsChange,
  onCameraReady,
  onCameraUnavailable,
}) {
  const device = useNativeCameraDevice("front");
  const handleResults = React.useCallback(
    (resultBundle, viewSize, mirrored) => {
      onFaceBoundsChange?.(
        buildMediaPipeFaceFrame(resultBundle, viewSize, mirrored),
      );
    },
    [onFaceBoundsChange],
  );

  const handleError = React.useCallback(
    (error) => {
      logAppError("MediaPipe face landmark detection failed", error);
      onFaceBoundsChange?.(null);
    },
    [onFaceBoundsChange],
  );

  const solution = useMediaPipeFaceLandmarkDetection(
    handleResults,
    handleError,
    MediaPipeRunningMode.LIVE_STREAM,
    FACE_LANDMARKER_MODEL,
    {
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      delegate: MediaPipeDelegate.GPU,
      mirrorMode: "mirror-front-only",
    },
  );

  React.useEffect(() => {
    if (device) {
      solution.cameraDeviceChangeHandler(device);
      onCameraReady?.();
    }
  }, [device, onCameraReady, solution]);

  React.useEffect(() => {
    solution.resizeModeChangeHandler("cover");
  }, [solution]);

  const handleCameraRuntimeError = React.useCallback(
    (error) => {
      logAppError("Vision camera unavailable for live wig try-on", error);
      onFaceBoundsChange?.(null);
      onCameraUnavailable?.(error);
    },
    [onCameraUnavailable, onFaceBoundsChange],
  );

  if (!device) {
    return (
      <View style={styles.captureStagePlaceholder}>
        <AppIcon name="camera" state="active" size="xl" />
        <Text style={styles.captureStagePlaceholderTitle}>Camera starting</Text>
      </View>
    );
  }

  return (
    <NativeVisionCamera
      ref={cameraRef}
      style={styles.captureStageImage}
      device={device}
      isActive
      photo
      frameProcessor={solution.frameProcessor}
      onLayout={solution.cameraViewLayoutChangeHandler}
      onOutputOrientationChanged={solution.cameraOrientationChangedHandler}
      onError={handleCameraRuntimeError}
      resizeMode="cover"
      pixelFormat="rgb"
    />
  );
}

function NativeTryOnFaceCamera({
  cameraRef,
  stageLayout,
  onFaceBoundsChange,
  onCameraReady,
  onCameraUnavailable,
}) {
  const device = useNativeCameraDevice("front");
  const faceDetectionOptions = React.useMemo(
    () => ({
      performanceMode: "fast",
      landmarkMode: "all",
      contourMode: "all",
      classificationMode: "none",
      minFaceSize: 0.16,
      trackingEnabled: false,
      cameraFacing: "front",
      autoMode: true,
      windowWidth: Math.max(1, Number(stageLayout?.width || 1)),
      windowHeight: Math.max(1, Number(stageLayout?.height || 1)),
    }),
    [stageLayout?.height, stageLayout?.width],
  );
  const { detectFaces, stopListeners } =
    useNativeFaceDetector(faceDetectionOptions);
  const handleFacesOnJs = React.useMemo(
    () =>
      NativeWorklets.createRunOnJS((faceFrame = null) => {
        onFaceBoundsChange?.(faceFrame);
      }),
    [onFaceBoundsChange],
  );
  const frameProcessor = useNativeFrameProcessor(
    (frame) => {
      "worklet";
      const faces = detectFaces(frame);
      const face = Array.isArray(faces) && faces.length ? faces[0] : null;
      handleFacesOnJs(
        face?.bounds
          ? {
              ...face,
              autoMode: true,
              frameWidth: frame.width,
              frameHeight: frame.height,
            }
          : null,
      );
    },
    [detectFaces, handleFacesOnJs],
  );

  React.useEffect(
    () => () => {
      stopListeners?.();
    },
    [stopListeners],
  );

  React.useEffect(() => {
    if (device) onCameraReady?.();
  }, [device, onCameraReady]);

  const handleCameraRuntimeError = React.useCallback(
    (error) => {
      logAppError("Vision camera unavailable for fallback wig try-on", error);
      onFaceBoundsChange?.(null);
      onCameraUnavailable?.(error);
    },
    [onCameraUnavailable, onFaceBoundsChange],
  );

  if (!device) {
    return (
      <View style={styles.captureStagePlaceholder}>
        <AppIcon name="camera" state="active" size="xl" />
        <Text style={styles.captureStagePlaceholderTitle}>Camera starting</Text>
      </View>
    );
  }

  return (
    <NativeVisionCamera
      ref={cameraRef}
      style={styles.captureStageImage}
      device={device}
      isActive
      photo
      frameProcessor={frameProcessor}
      pixelFormat="yuv"
      onError={handleCameraRuntimeError}
    />
  );
}

const toFriendlyPreferenceLabel = (value, name) => {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return "";

  if (name === "preferredLength") {
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return `${Number.isInteger(numericValue) ? numericValue : numericValue.toFixed(1)} inches`;
    }
  }

  return rawValue
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const normalizeRecommendationKey = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeLengthRecommendation = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return normalizeRecommendationKey(value);
  }

  return normalizeRecommendationKey(
    Number.isInteger(numericValue)
      ? numericValue
      : Number(numericValue.toFixed(2)),
  );
};

const normalizePreferenceMatchValue = (value, name) =>
  name === "preferredLength"
    ? normalizeLengthRecommendation(value)
    : normalizeRecommendationKey(value);

const getWigPreferenceValue = (wig, name) => {
  const specification = wig?.physical_specification || {};

  if (name === "preferredLength") return specification.length;
  if (name === "preferredColor") return specification.color;
  if (name === "hairTexture") return specification.hair_texture;
  if (name === "hairDensity") return specification.hair_density;
  if (name === "capSize") return specification.cap_size;
  if (name === "stylePreference") return specification.style;

  return "";
};

const scoreWigRecommendation = (wig, values = {}) => {
  const fields = [
    "preferredLength",
    "preferredColor",
    "hairTexture",
    "hairDensity",
    "capSize",
    "stylePreference",
  ];
  const selectedFields = fields.filter((fieldName) =>
    normalizePreferenceMatchValue(values?.[fieldName], fieldName),
  );
  const hasPreviewAsset = Boolean(
    wig?.layer_full_wig_url ||
      wig?.layer_front_bangs_url ||
      wig?.layer_back_hair_url ||
      wig?.thumbnail_url,
  );
  const stockScore = Number(wig?.stock_count || 0) > 0 ? 0.1 : hasPreviewAsset ? 0.05 : 0;

  if (!selectedFields.length) return stockScore;

  return selectedFields.reduce((score, fieldName) => {
    const selectedValue = normalizePreferenceMatchValue(
      values?.[fieldName],
      fieldName,
    );
    const wigValue = normalizePreferenceMatchValue(
      getWigPreferenceValue(wig, fieldName),
      fieldName,
    );
    return score + (selectedValue && selectedValue === wigValue ? 1 : 0);
  }, stockScore);
};

const validateAiTryOnPhoto = (photo) => {
  if (!photo?.uri) {
    return {
      valid: false,
      message: "Take a clear front-facing photo first.",
    };
  }

  const mimeType = String(photo?.mimeType || "").toLowerCase();
  const uri = String(photo?.uri || "").toLowerCase();
  const hasAcceptedFormat =
    mimeType.includes("jpeg") ||
    mimeType.includes("jpg") ||
    mimeType.includes("png") ||
    uri.endsWith(".jpg") ||
    uri.endsWith(".jpeg") ||
    uri.endsWith(".png") ||
    uri.startsWith("file:") ||
    uri.startsWith("content:");

  if (!hasAcceptedFormat) {
    return {
      valid: false,
      message: "Use a JPG, JPEG, or PNG photo.",
    };
  }

  const width = Number(photo?.width || 0);
  const height = Number(photo?.height || 0);
  if ((width && width < 512) || (height && height < 512)) {
    return {
      valid: false,
      message: "The photo resolution is too low. Retake a sharper photo.",
    };
  }

  if (width && height) {
    const aspectRatio = width / height;
    if (aspectRatio < 0.45 || aspectRatio > 2.1) {
      return {
        valid: false,
        message: "Make sure your full head is visible and not cropped.",
      };
    }
  }

  const faceFrame = photo?.placement?.faceFrame;
  const bounds = faceFrame?.bounds || faceFrame;
  if (bounds?.width && bounds?.height) {
    const left = Number(bounds.x ?? bounds.left ?? 0);
    const top = Number(bounds.y ?? bounds.top ?? 0);
    const faceWidth = Number(bounds.width || 0);
    const faceHeight = Number(bounds.height || 0);
    const stageWidth = Number(photo?.placement?.stageLayout?.width || width || 0);
    const stageHeight = Number(photo?.placement?.stageLayout?.height || height || 0);
    const isSeverelyOutsideFrame =
      stageWidth &&
      stageHeight &&
      (left < -stageWidth * 0.03 ||
        top < -stageHeight * 0.03 ||
        left + faceWidth > stageWidth * 1.03 ||
        top + faceHeight > stageHeight * 1.03);
    const faceFillsTooMuchFrame =
      stageWidth &&
      stageHeight &&
      (faceWidth > stageWidth * 0.92 || faceHeight > stageHeight * 0.92);

    if (isSeverelyOutsideFrame || faceFillsTooMuchFrame) {
      return {
        valid: false,
        message: "Your head appears cropped. Retake the photo with your full head visible.",
      };
    }
  }

  return {
    valid: true,
    message: "Review the photo, then use it or retake it.",
  };
};

function PreferenceChipGroup({
  control,
  name,
  title,
  helperText,
  options,
  recommendedOptions,
  roles,
}) {
  if (!Array.isArray(options) || !options.length) return null;
  const recommendedOptionKeys = new Set(
    (recommendedOptions || [])
      .map((option) => normalizePreferenceMatchValue(option, name))
      .filter(Boolean),
  );

  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <View style={styles.preferenceSection}>
          <View style={styles.preferenceSectionHeader}>
            <Text
              style={[
                styles.preferenceSectionTitle,
                { color: roles.headingText },
              ]}
            >
              {title}
            </Text>
            {helperText ? (
              <Text
                style={[
                  styles.preferenceSectionHint,
                  { color: roles.bodyText },
                ]}
              >
                {helperText}
              </Text>
            ) : null}
          </View>
          <View style={styles.preferenceChipWrap}>
            {options.map((option) => {
              const isSelected = field.value === option;
              const isAiRecommended = recommendedOptionKeys.has(
                normalizePreferenceMatchValue(option, name),
              );
              const label = toFriendlyPreferenceLabel(option, name);
              return (
                <Pressable
                  key={`${name}-${option}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${title}: ${label}`}
                  onPress={() => field.onChange(option)}
                  style={({ pressed }) => [
                    styles.preferenceChip,
                    {
                      borderColor:
                        isSelected || isAiRecommended
                          ? roles.primaryActionBackground
                          : roles.defaultCardBorder,
                      backgroundColor: isSelected
                        ? roles.iconPrimarySurface
                        : roles.pageBackground,
                    },
                    isAiRecommended && !isSelected
                      ? styles.preferenceChipRecommended
                      : null,
                    pressed ? styles.preferencePressed : null,
                  ]}
                >
                  {isSelected ? (
                    <AppIcon
                      name="success"
                      size="sm"
                      color={roles.iconPrimaryColor}
                    />
                  ) : null}
                  <Text
                    style={[
                      styles.preferenceChipText,
                      {
                        color: isSelected
                          ? roles.iconPrimaryColor
                          : roles.bodyText,
                      },
                      isSelected ? styles.preferenceChipTextSelected : null,
                    ]}
                  >
                    {label}
                  </Text>
                  {isAiRecommended ? (
                    <View
                      style={[
                        styles.aiChipBadge,
                        {
                          backgroundColor: roles.pageBackground,
                          borderColor: roles.defaultCardBorder,
                        },
                      ]}
                    >
                      <AppIcon
                        name="sparkle"
                        size="sm"
                        color={roles.iconPrimaryColor}
                      />
                      <Text
                        style={[
                          styles.aiChipBadgeText,
                          { color: roles.iconPrimaryColor },
                        ]}
                      >
                        AI
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {field.value ? (
            <Text
              style={[styles.preferenceSelectedText, { color: roles.metaText }]}
            >
              Selected: {toFriendlyPreferenceLabel(field.value, name)}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

const resolveHairColorSwatch = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("black")) return "#1F1712";
  if (normalized.includes("brown"))
    return normalized.includes("light") ? "#B98255" : "#4B3621";
  if (normalized.includes("blonde") || normalized.includes("gold"))
    return "#C99A4A";
  if (
    normalized.includes("gray") ||
    normalized.includes("grey") ||
    normalized.includes("silver")
  )
    return "#A8A8A8";
  if (normalized.includes("red") || normalized.includes("auburn"))
    return "#8F3D2D";
  return theme.colors.borderStrong;
};

function ColorPaletteGroup({ control, roles, options, recommendedOptions }) {
  const colors = Array.isArray(options)
    ? options
        .filter(Boolean)
        .map((value) => ({ value, color: resolveHairColorSwatch(value) }))
    : [];
  const recommendedOptionKeys = new Set(
    (recommendedOptions || [])
      .map((option) => normalizePreferenceMatchValue(option, "preferredColor"))
      .filter(Boolean),
  );

  if (!colors.length) return null;

  return (
    <Controller
      control={control}
      name="preferredColor"
      render={({ field }) => {
        const selected = colors.find((item) => item.value === field.value);

        return (
          <View style={styles.preferenceSection}>
            <View style={styles.preferenceSectionHeader}>
              <Text
                style={[
                  styles.preferenceSectionTitle,
                  { color: roles.headingText },
                ]}
              >
                Hair Color
              </Text>
              <Text
                style={[
                  styles.preferenceSectionHint,
                  { color: roles.bodyText },
                ]}
              >
                Pick the closest available color.
              </Text>
            </View>
            <View
              style={[
                styles.colorPaletteCard,
                {
                  backgroundColor: roles.pageBackground,
                  borderColor: roles.defaultCardBorder,
                },
              ]}
            >
              <View style={styles.colorSwatchGrid}>
                {colors.map((item) => {
                  const isSelected = field.value === item.value;
                  const isAiRecommended = recommendedOptionKeys.has(
                    normalizePreferenceMatchValue(item.value, "preferredColor"),
                  );
                  const label = toFriendlyPreferenceLabel(
                    item.value,
                    "preferredColor",
                  );
                  return (
                    <Pressable
                      key={item.value}
                      accessibilityRole="button"
                      accessibilityLabel={`Hair color: ${label}`}
                      onPress={() => field.onChange(item.value)}
                      style={({ pressed }) => [
                        styles.colorSwatchButton,
                        {
                          borderColor:
                            isSelected || isAiRecommended
                              ? roles.primaryActionBackground
                              : "transparent",
                        },
                        isAiRecommended && !isSelected
                          ? styles.preferenceChipRecommended
                          : null,
                        pressed ? styles.preferencePressed : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.colorSwatch,
                          { backgroundColor: item.color },
                        ]}
                      >
                        {isSelected ? (
                          <AppIcon
                            name="checkmark"
                            size="sm"
                            color={theme.colors.textInverse}
                          />
                        ) : null}
                      </View>
                      {isAiRecommended ? (
                        <View
                          style={[
                            styles.colorAiBadge,
                            {
                              backgroundColor: roles.defaultCardBackground,
                              borderColor: roles.defaultCardBorder,
                            },
                          ]}
                        >
                          <AppIcon
                            name="sparkle"
                            size="sm"
                            color={roles.iconPrimaryColor}
                          />
                        </View>
                      ) : null}
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.colorSwatchLabel,
                          { color: roles.bodyText },
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text
                style={[styles.colorSelectedText, { color: roles.bodyText }]}
              >
                Selected:{" "}
                {selected
                  ? toFriendlyPreferenceLabel(selected.value, "preferredColor")
                  : "None"}
              </Text>
            </View>
          </View>
        );
      }}
    />
  );
}

function IconCircleButton({
  icon,
  onPress,
  variant = "secondary",
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
}) {
  const isPrimary = variant === "primary";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconCircleButton,
        isPrimary
          ? styles.iconCircleButtonPrimary
          : styles.iconCircleButtonSecondary,
        pressed ? styles.iconCircleButtonPressed : null,
        disabled || loading ? styles.iconCircleButtonDisabled : null,
        style,
      ]}
    >
      <AppIcon
        name={icon}
        state={isPrimary ? "inverse" : "active"}
        size={isPrimary ? "xl" : "lg"}
      />
    </Pressable>
  );
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function CalibrationSlider({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const normalizedPercent = clamp(percent, 0, 100);
  const commitFromLocation = React.useCallback(
    (locationX) => {
      if (!trackWidth) return;
      const raw =
        min + (clamp(locationX, 0, trackWidth) / trackWidth) * (max - min);
      const stepped = Math.round(raw / step) * step;
      onChange(Math.round(clamp(stepped, min, max) * 100) / 100);
    },
    [max, min, onChange, step, trackWidth],
  );
  const sliderPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          commitFromLocation(Number(event.nativeEvent.locationX || 0));
        },
        onPanResponderMove: (event) => {
          commitFromLocation(Number(event.nativeEvent.locationX || 0));
        },
      }),
    [commitFromLocation],
  );

  return (
    <View style={styles.calibrationControl}>
      <View style={styles.calibrationControlHeader}>
        <Text style={styles.calibrationControlLabel}>{label}</Text>
        <Text style={styles.calibrationValue}>{formatValue(value)}</Text>
      </View>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        style={styles.calibrationSliderTouchArea}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        {...sliderPanResponder.panHandlers}
      >
        <View style={styles.calibrationSliderTrack}>
          <View
            style={[
              styles.calibrationSliderFill,
              { width: `${normalizedPercent}%` },
            ]}
          />
          <View
            style={[
              styles.calibrationSliderThumb,
              { left: `${normalizedPercent}%` },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

function WigInfoList({ rows, roles }) {
  const visibleRows = rows.filter((row) => {
    const normalizedValue = String(row?.value ?? "").trim().toLowerCase();
    return normalizedValue && normalizedValue !== "not provided" && normalizedValue !== "pending";
  });

  if (!visibleRows.length) {
    return (
      <View style={styles.requestedWigPendingNote}>
        <AppIcon name="requests" size="sm" color={roles.primaryActionBackground} />
        <Text style={[styles.requestedWigPendingText, { color: roles.bodyText }]}>
          Wig preferences will appear after your request is reviewed.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.inlineWigDetailsList}>
      {visibleRows.map((row, index) => (
        <View key={row.label}>
          <View style={styles.inlineWigDetailRow}>
            <Text style={[styles.inlineWigDetailLabel, { color: roles.metaText }]}>{row.label}</Text>
            <Text numberOfLines={2} style={[styles.inlineWigDetailValue, { color: roles.headingText }]}>{row.value}</Text>
          </View>
          {index < visibleRows.length - 1 ? (
            <View style={[styles.inlineWigDetailDivider, { backgroundColor: roles.defaultCardBorder }]} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function InlineWigDetails({ rows, code, imageUrl, selectedStyle, roles }) {
  return (
    <View style={styles.inlineWigDetailsSection}>
      <View style={styles.inlineWigDetailsHeader}>
        <LinearGradient
          colors={[theme.colors.palette.wine600, theme.colors.palette.wine900]}
          style={styles.inlineWigDetailsIcon}
        >
          <MaterialCommunityIcons name="creation-outline" size={22} color="#FFFFFF" />
        </LinearGradient>
        <View style={styles.inlineWigDetailsHeaderCopy}>
          <Text style={[styles.inlineWigDetailsTitle, { color: roles.headingText }]}>Wig details</Text>
          <Text style={[styles.inlineWigDetailsHint, { color: roles.metaText }]}>Your selected wig preferences</Text>
        </View>
        {code && code !== "Pending" ? (
          <View style={[styles.inlineWigCodePill, { backgroundColor: roles.iconPrimarySurface }]}>
            <Text numberOfLines={1} style={[styles.inlineWigCodeText, { color: roles.iconPrimaryColor }]}>{code}</Text>
          </View>
        ) : null}
      </View>

      {imageUrl ? (
        <View style={styles.inlineWigSelection}>
          <Image source={{ uri: imageUrl }} style={styles.inlineWigSelectionImage} resizeMode="contain" />
          <View style={styles.inlineWigSelectionCopy}>
            <Text style={[styles.inlineWigSelectionLabel, { color: roles.metaText }]}>SELECTED STYLE</Text>
            <Text numberOfLines={2} style={[styles.inlineWigSelectionName, { color: roles.headingText }]}>{selectedStyle || "Selected wig"}</Text>
            <Text style={[styles.inlineWigSelectionHint, { color: roles.bodyText }]}>Preview saved with your request</Text>
          </View>
        </View>
      ) : null}

      <View style={[styles.inlineWigDetailsDivider, { backgroundColor: roles.defaultCardBorder }]} />
      <WigInfoList rows={rows} roles={roles} />
    </View>
  );
}

const wigJourneyIcons = {
  approval: "clipboard-check-outline",
  preparing: "creation-outline",
  dropoff: "truck-delivery-outline",
  received: "account-check-outline",
};

function WigJourneyTimeline({ tracker, roles }) {
  const enterAnimation = useRef(new Animated.Value(0)).current;
  const pulseAnimation = useRef(new Animated.Value(0)).current;
  const steps = tracker?.steps?.length ? tracker.steps : [{
    key: "approval",
    title: "Request submitted",
    state: "current",
  }];
  const currentIndex = steps.findIndex((step) => (
    step?.state === "current" || step?.state === "attention"
  ));
  const nextIndex = steps.findIndex((step) => step?.state !== "completed");
  const effectiveCurrentIndex = currentIndex >= 0
    ? currentIndex
    : nextIndex >= 0
      ? nextIndex
      : Math.max(0, steps.length - 1);
  const currentStep = steps[effectiveCurrentIndex] || steps[0] || null;
  const gradientColors = [
    theme.colors.palette.wine900,
    theme.colors.palette.wine700,
    theme.colors.palette.wine600,
  ];
  const referenceValue = String(tracker?.summary?.referenceValue || "").trim();
  const shouldShowReference = Boolean(
    referenceValue
    && !["not assigned", "pending", "not available", "n/a"].includes(referenceValue.toLowerCase())
  );

  useEffect(() => {
    Animated.timing(enterAnimation, {
      toValue: 1,
      duration: theme.motion.cardEnter,
      useNativeDriver: true,
    }).start();
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnimation, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnimation, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [enterAnimation, pulseAnimation]);

  return (
    <Animated.View style={[
      styles.wigJourneyAnimatedHost,
      {
        opacity: enterAnimation,
        transform: [{
          translateY: enterAnimation.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
        }],
      },
    ]}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.wigJourneyCard, { borderColor: roles.heroBorder }]}
      >
        <View pointerEvents="none" style={styles.wigJourneyShade} />
        <View pointerEvents="none" style={styles.wigJourneyGlow} />
        <View style={styles.wigJourneyTopRow}>
          <View style={styles.wigJourneyHeaderIdentity}>
            <View style={styles.wigJourneyTopIcon}>
              <MaterialCommunityIcons name="creation-outline" size={21} color="#FFFFFF" />
            </View>
            <View style={styles.wigJourneyHeaderCopy}>
              <Text style={styles.wigJourneyHeaderEyebrow}>WIG REQUEST</Text>
              <Text style={styles.wigJourneyHeaderTitle}>Journey progress</Text>
            </View>
          </View>
        </View>

        <View style={styles.wigJourneyHeadingCopy}>
          <Text style={styles.wigJourneyEyebrow}>CURRENT STAGE</Text>
          <Text numberOfLines={2} style={styles.wigJourneyTitle}>
            {currentStep?.title || "Request in progress"}
          </Text>
          {shouldShowReference ? (
            <Text numberOfLines={1} style={styles.wigJourneyReference}>
              {tracker?.summary?.referenceLabel || "Patient code"}: {referenceValue}
            </Text>
          ) : null}
        </View>

        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.wigJourneyTimelineContent}
        >
          {steps.map((step, index) => {
            const isCompleted = step.state === "completed";
            const isCurrent = index === effectiveCurrentIndex;
            const isReached = isCompleted || isCurrent;
            const iconName = isCompleted ? "check" : (wigJourneyIcons[step.key] || "circle-small");
            const marker = (
              <View style={[
                styles.wigJourneyStageMarker,
                {
                  backgroundColor: isReached ? roles.defaultCardBackground : "rgba(255,255,255,0.16)",
                  borderColor: isReached ? roles.defaultCardBackground : "rgba(255,255,255,0.34)",
                },
              ]}>
                <MaterialCommunityIcons
                  name={iconName}
                  size={16}
                  color={isReached ? roles.primaryActionBackground : roles.primaryActionText}
                />
              </View>
            );
            return (
              <View key={step.key || `${step.title}-${index}`} style={styles.wigJourneyStage}>
                {index > 0 ? (
                  <View style={[
                    styles.wigJourneyConnector,
                    { backgroundColor: index <= effectiveCurrentIndex ? roles.primaryActionText : "rgba(255,255,255,0.24)" },
                  ]} />
                ) : null}
                {isCurrent ? (
                  <Animated.View style={{
                    transform: [{ scale: pulseAnimation.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
                  }}>
                    {marker}
                  </Animated.View>
                ) : marker}
                <Text numberOfLines={2} style={[styles.wigJourneyStageLabel, { color: roles.primaryActionText }]}>
                  {step.title}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </LinearGradient>
    </Animated.View>
  );
}

function CancelWigRequestModal({
  visible,
  requestCode,
  daysRemaining,
  isCancelling,
  onClose,
  onConfirm,
  roles,
}) {
  const remainingLabel = daysRemaining === 1 ? "1 day" : `${daysRemaining} days`;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={isCancelling ? undefined : onClose}>
      <View style={styles.cancelRequestModalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keep wig request"
          disabled={isCancelling}
          onPress={onClose}
          style={styles.cancelRequestModalBackdrop}
        />
        <View
          accessibilityRole="alert"
          style={[
            styles.cancelRequestModalCard,
            {
              backgroundColor: roles.defaultCardBackground,
              borderColor: roles.defaultCardBorder,
            },
          ]}
        >
          <View style={styles.cancelRequestModalIcon}>
            <MaterialCommunityIcons name="clipboard-remove-outline" size={28} color={theme.colors.actionDanger} />
          </View>

          <View style={styles.cancelRequestModalCopy}>
            <Text style={[styles.cancelRequestModalTitle, { color: roles.headingText }]}>Cancel this wig request?</Text>
            <Text style={[styles.cancelRequestModalText, { color: roles.bodyText }]}>Your active request will be closed. You can submit a new request later if you still need one.</Text>
          </View>

          <View style={[styles.cancelRequestPolicyCard, { backgroundColor: roles.supportCardBackground, borderColor: roles.supportCardBorder }]}>
            <MaterialCommunityIcons name="calendar-clock-outline" size={21} color={roles.primaryActionBackground} />
            <View style={styles.cancelRequestPolicyCopy}>
              <Text style={[styles.cancelRequestPolicyTitle, { color: roles.headingText }]}>Cancellation window</Text>
              <Text style={[styles.cancelRequestPolicyText, { color: roles.bodyText }]}>You have {remainingLabel} remaining. Cancellation is available only within seven days and before wig preparation begins.</Text>
            </View>
          </View>

          {requestCode && requestCode !== "Pending" ? (
            <Text style={[styles.cancelRequestCode, { color: roles.metaText }]}>Request {requestCode}</Text>
          ) : null}

          <View style={styles.cancelRequestModalActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Keep wig request"
              disabled={isCancelling}
              onPress={onClose}
              style={({ pressed }) => [
                styles.cancelRequestKeepButton,
                pressed && !isCancelling ? styles.cancelRequestActionPressed : null,
              ]}
            >
              <LinearGradient
                colors={[theme.colors.actionPrimary, theme.colors.actionPrimaryPressed]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cancelRequestActionGradient}
              >
                <MaterialCommunityIcons name="arrow-left-circle-outline" size={19} color="#FFFFFF" />
                <Text style={styles.cancelRequestKeepText}>Keep request</Text>
              </LinearGradient>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm cancellation"
              disabled={isCancelling}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.cancelRequestConfirmButton,
                pressed && !isCancelling ? styles.cancelRequestActionPressed : null,
              ]}
            >
              <LinearGradient
                colors={[theme.colors.actionDanger, theme.colors.actionDangerPressed]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cancelRequestActionGradient}
              >
                {isCancelling ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
                  <MaterialCommunityIcons name="close-circle-outline" size={19} color="#FFFFFF" />
                )}
                <Text style={styles.cancelRequestConfirmText}>{isCancelling ? "Cancelling..." : "Cancel request"}</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RequestFlowHeader({ title, onBack, roles }) {
  return (
    <View style={styles.requestFlowHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        style={({ pressed }) => [
          styles.requestFlowBackButton,
          pressed ? styles.preferencePressed : null,
        ]}
      >
        <AppIcon name="arrowLeft" size="md" color={roles.primaryActionText} />
      </Pressable>
      <Text
        numberOfLines={1}
        style={[
          styles.requestFlowHeaderTitle,
          { color: roles.primaryActionText },
        ]}
      >
        {title}
      </Text>
      <View style={styles.requestFlowHeaderSpacer} />
    </View>
  );
}

function SafetyChoiceRow({ label, value, onChange, roles }) {
  return (
    <View style={[styles.safetyChoiceRow, { borderBottomColor: roles.defaultCardBorder }]}>
      <Text style={[styles.safetyChoiceLabel, { color: roles.headingText }]}>{label}</Text>
      <View style={styles.safetyChoiceActions}>
        {[true, false].map((choice) => {
          const selected = value === choice;
          return (
            <Pressable
              key={String(choice)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(choice)}
              style={[
                styles.safetyChoiceButton,
                {
                  backgroundColor: selected ? roles.primaryActionBackground : roles.pageBackground,
                  borderColor: selected ? roles.primaryActionBackground : roles.defaultCardBorder,
                },
              ]}
            >
              <Text style={[
                styles.safetyChoiceButtonText,
                { color: selected ? roles.primaryActionText : roles.headingText },
              ]}>
                {choice ? "Yes" : "No"}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SafetyAssessmentAnswersModal({ visible, assessment, onClose, roles, resolvedTheme }) {
  if (!assessment) return null;

  const answerRows = [
    ["Known allergies", assessment.has_known_allergies],
    ["Sensitive scalp", assessment.has_sensitive_scalp],
    ["Scalp irritation", assessment.has_scalp_irritation],
    ["Open scalp wounds", assessment.has_open_scalp_wounds],
    ["Medical restriction", assessment.has_medical_restriction],
    ["Information confirmed", assessment.information_confirmed],
  ];
  const formatAnswer = (value) => (
    typeof value === "boolean" ? (value ? "Yes" : "No") : "Not answered"
  );
  const gradientColors = [
    resolvedTheme?.primaryColor || roles.primaryActionBackground || theme.colors.palette.wine700,
    resolvedTheme?.secondaryColor || resolvedTheme?.tertiaryColor || theme.colors.palette.wine900,
  ];

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.safetyAnswersModalRoot}>
        <Pressable style={styles.safetyAnswersBackdrop} onPress={onClose} />
        <View style={[
          styles.safetyAnswersSheet,
          {
            backgroundColor: roles.pageBackground,
            borderColor: roles.defaultCardBorder,
          },
        ]}>
          <View style={styles.safetyAnswersHandle} />
          <LinearGradient colors={gradientColors} style={styles.safetyAnswersHeader}>
            <View style={styles.safetyAnswersHeaderIcon}>
              <MaterialCommunityIcons name="shield-check-outline" size={23} color={roles.primaryActionText} />
            </View>
            <View style={styles.safetyAnswersHeaderCopy}>
              <Text style={[styles.safetyAnswersTitle, { color: roles.primaryActionText }]}>Safety information</Text>
              <Text style={[styles.safetyAnswersStatus, { color: roles.primaryActionText }]}>
                {assessment.review_status || "Pending review"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close safety assessment"
              onPress={onClose}
              hitSlop={10}
              style={styles.safetyAnswersClose}
            >
              <MaterialCommunityIcons name="close" size={22} color={roles.primaryActionText} />
            </Pressable>
          </LinearGradient>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.safetyAnswersList}>
            {answerRows.map(([label, value]) => (
              <View
                key={label}
                style={[
                  styles.safetyAnswerRow,
                  { backgroundColor: roles.defaultCardBackground, borderColor: roles.defaultCardBorder },
                ]}
              >
                <View style={[styles.safetyAnswerIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                  <MaterialCommunityIcons
                    name={value === true ? "check" : value === false ? "minus" : "help"}
                    size={16}
                    color={roles.iconPrimaryColor}
                  />
                </View>
                <Text style={[styles.safetyAnswerLabel, { color: roles.headingText }]}>{label}</Text>
                <View style={[styles.safetyAnswerPill, { backgroundColor: roles.iconPrimarySurface }]}>
                  <Text style={[styles.safetyAnswerValue, { color: roles.iconPrimaryColor }]}>{formatAnswer(value)}</Text>
                </View>
              </View>
            ))}
            {assessment.has_known_allergies ? (
              <View style={[styles.safetyAnswerDetails, { backgroundColor: roles.supportCardBackground, borderColor: roles.supportCardBorder }]}>
                <Text style={[styles.safetyAnswerLabel, { color: roles.headingText }]}>Allergy details</Text>
                <Text style={[styles.safetyAnswerDetailsText, { color: roles.bodyText }]}>
                  {assessment.allergy_details || "No details provided"}
                </Text>
              </View>
            ) : null}
            {assessment.has_medical_restriction ? (
              <View style={[styles.safetyAnswerDetails, { backgroundColor: roles.supportCardBackground, borderColor: roles.supportCardBorder }]}>
                <Text style={[styles.safetyAnswerLabel, { color: roles.headingText }]}>Medical restriction details</Text>
                <Text style={[styles.safetyAnswerDetailsText, { color: roles.bodyText }]}>
                  {assessment.medical_restriction_details || "No details provided"}
                </Text>
              </View>
            ) : null}
            {assessment.review_notes ? (
              <View style={[styles.safetyAnswerDetails, { backgroundColor: roles.supportCardBackground, borderColor: roles.supportCardBorder }]}>
                <Text style={[styles.safetyAnswerLabel, { color: roles.headingText }]}>Review notes</Text>
                <Text style={[styles.safetyAnswerDetailsText, { color: roles.bodyText }]}>
                  {assessment.review_notes}
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// eslint-disable-next-line no-unused-vars
function CaptureModal({
  visible,
  referenceImage,
  availableWigs,
  selectedWig,
  selectedWigId,
  recommendedWigId,
  isLoadingAvailableWigs,
  hasCameraPermission,
  cameraRef,
  onCameraReady,
  isCapturingPhoto,
  isPickingReference,
  onClose,
  onUpload,
  onCapture,
  onSelectWig,
  onGeneratePreview,
  onRequestPermission,
  roles,
}) {
  const insets = useSafeAreaInsets();
  const [stageLayout, setStageLayout] = useState({ width: 0, height: 320 });
  const [faceFrame, setFaceFrame] = useState(null);
  const [cameraRuntimeError, setCameraRuntimeError] = useState(null);
  const [isCalibrationOpen, setIsCalibrationOpen] = useState(false);
  const [wigCalibration, setWigCalibration] = useState(DEFAULT_WIG_CALIBRATION);
  const gestureStartRef = useRef({
    ...DEFAULT_WIG_CALIBRATION,
    distance: 0,
  });
  const handleFaceFrameChange = React.useCallback((nextFaceFrame) => {
    setFaceFrame((previousFaceFrame) =>
      smoothFaceFrame(previousFaceFrame, nextFaceFrame),
    );
  }, []);
  const setCalibrationValue = React.useCallback((key, value) => {
    setWigCalibration((current) => {
      return {
        ...current,
        [key]: Math.round(Number(value || 0) * 100) / 100,
      };
    });
  }, []);
  const resetCalibration = React.useCallback(() => {
    setWigCalibration(DEFAULT_WIG_CALIBRATION);
  }, []);
  useEffect(() => {
    if (
      visible &&
      hasCameraPermission &&
      (!canUseFaceTrackingTryOnCamera || cameraRuntimeError)
    ) {
      onCameraReady?.();
    }
  }, [cameraRuntimeError, hasCameraPermission, onCameraReady, visible]);

  useEffect(() => {
    if (visible) {
      setCameraRuntimeError(null);
      setFaceFrame(null);
    }
  }, [visible]);

  useEffect(() => {
    setWigCalibration(DEFAULT_WIG_CALIBRATION);
  }, [selectedWigId]);

  const primaryTryOnImageUrl = getPrimaryTryOnImageUrl(selectedWig);
  const calibrationPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          Boolean(
            selectedWig &&
            primaryTryOnImageUrl &&
            (event.nativeEvent.touches || []).length >= 2,
          ),
        onStartShouldSetPanResponderCapture: (event) =>
          Boolean(
            selectedWig &&
            primaryTryOnImageUrl &&
            (event.nativeEvent.touches || []).length >= 2,
          ),
        onMoveShouldSetPanResponder: (event, gestureState) =>
          Boolean(
            selectedWig &&
            primaryTryOnImageUrl &&
            ((event.nativeEvent.touches || []).length >= 2 ||
              Math.abs(gestureState.dx) > 2 ||
              Math.abs(gestureState.dy) > 2),
          ),
        onMoveShouldSetPanResponderCapture: (event, gestureState) =>
          Boolean(
            selectedWig &&
            primaryTryOnImageUrl &&
            ((event.nativeEvent.touches || []).length >= 2 ||
              Math.abs(gestureState.dx) > 2 ||
              Math.abs(gestureState.dy) > 2),
          ),
        onPanResponderGrant: (event) => {
          gestureStartRef.current = {
            ...wigCalibration,
            distance: getTouchDistance(event.nativeEvent.touches),
          };
        },
        onPanResponderMove: (event, gestureState) => {
          const touches = event.nativeEvent.touches || [];
          const start = gestureStartRef.current || DEFAULT_WIG_CALIBRATION;
          if (touches.length >= 2) {
            const currentDistance = getTouchDistance(touches);
            if (!start.distance) {
              gestureStartRef.current = {
                ...wigCalibration,
                distance: currentDistance,
              };
              return;
            }
            const nextScale = Math.min(
              1.6,
              Math.max(0.75, start.scale * (currentDistance / start.distance)),
            );
            setWigCalibration((current) => ({
              ...current,
              scale: Math.round(nextScale * 100) / 100,
            }));
            return;
          }

          setWigCalibration((current) => ({
            ...current,
            offsetX: Math.round(
              Math.min(140, Math.max(-140, start.offsetX + gestureState.dx)),
            ),
            offsetY: Math.round(
              Math.min(140, Math.max(-140, start.offsetY + gestureState.dy)),
            ),
          }));
        },
      }),
    [primaryTryOnImageUrl, selectedWig, wigCalibration],
  );

  if (!visible) return null;

  const shouldShowReferencePhoto = Boolean(referenceImage?.uri);
  const shouldRenderFullWigLayer = Boolean(selectedWig?.layer_full_wig_url);
  const shouldRenderFrontWigLayer = false;
  const shouldUseSingleTryOnImage = Boolean(
    selectedWig &&
    primaryTryOnImageUrl &&
    !selectedWig.layer_full_wig_url &&
    !selectedWig.layer_front_bangs_url &&
    !selectedWig.layer_back_hair_url,
  );
  const selectedWigNeedsLayer = Boolean(selectedWig && !primaryTryOnImageUrl);
  const isLiveCameraTryOn = Boolean(
    !shouldShowReferencePhoto &&
    hasCameraPermission &&
    canUseFaceTrackingTryOnCamera &&
    !cameraRuntimeError,
  );
  const activeFaceFrame = faceFrame || buildGuideFaceFrame(stageLayout);
  const shouldRenderBackWigLayer = false;
  const canCaptureLivePhoto = true;
  const canUseSelectedPhoto = Boolean(referenceImage?.uri);
  const shouldShowWigLayer = Boolean(selectedWig && primaryTryOnImageUrl);
  const cameraRuntimeMessage = getCameraRuntimeMessage(cameraRuntimeError);
  const getLayerStyle = (layerKey, zIndex) => {
    const faceAnchoredStyle = buildFaceAnchoredTryOnLayerStyle(
      activeFaceFrame,
      stageLayout,
      layerKey,
      zIndex,
      selectedWig?.fit_settings,
      wigCalibration,
    );
    if (faceAnchoredStyle) return faceAnchoredStyle;
    if (isLiveCameraTryOn) return styles.tryOnLayerHidden;
    return buildTryOnLayerStyle(selectedWig?.fit_settings, layerKey, zIndex);
  };

  return (
    <Modal
      transparent={false}
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.captureFullScreen,
          { backgroundColor: roles.pageBackground },
        ]}
      >
        <View
          style={[
            styles.captureHeaderBar,
            {
              backgroundColor: roles.primaryActionBackground,
              paddingTop: insets.top,
            },
          ]}
        >
          <View style={styles.captureHeaderRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onClose}
              style={({ pressed }) => [
                styles.captureHeaderButton,
                { backgroundColor: "rgba(255, 255, 255, 0.10)" },
                pressed ? styles.preferencePressed : null,
              ]}
            >
              <AppIcon
                name="arrowLeft"
                size="md"
                color={roles.primaryActionText}
              />
            </Pressable>

            <Text
              numberOfLines={1}
              style={[
                styles.captureHeaderTitle,
                { color: roles.primaryActionText },
              ]}
            >
              Front Photo
            </Text>

            <View style={styles.captureHeaderActions}>
              {selectedWig ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Adjust wig calibration"
                  onPress={() => setIsCalibrationOpen(true)}
                  style={({ pressed }) => [
                    styles.captureHeaderButton,
                    { backgroundColor: "rgba(255, 255, 255, 0.10)" },
                    pressed ? styles.preferencePressed : null,
                  ]}
                >
                  <AppIcon
                    name="settings"
                    state="muted"
                    color={roles.primaryActionText}
                  />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close front photo"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.captureHeaderButton,
                  { backgroundColor: "rgba(255, 255, 255, 0.10)" },
                  pressed ? styles.preferencePressed : null,
                ]}
              >
                <AppIcon
                  name="close"
                  state="muted"
                  color={roles.primaryActionText}
                />
              </Pressable>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.captureScroll}
          contentContainerStyle={[
            styles.captureScrollContent,
            { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={styles.captureStage}
            onLayout={(event) =>
              setStageLayout({
                width: event.nativeEvent.layout.width,
                height: event.nativeEvent.layout.height,
              })
            }
          >
            {shouldShowReferencePhoto ? (
              <Image
                source={{ uri: referenceImage.uri }}
                resizeMode="contain"
                style={styles.captureStagePhotoPreview}
              />
            ) : cameraRuntimeError ? (
              <CameraUnavailablePlaceholder message={cameraRuntimeMessage} />
            ) : hasCameraPermission ? (
              canUseFaceTrackingTryOnCamera ? (
                canUseMediaPipeTryOnCamera ? (
                  <MediaPipeTryOnFaceCamera
                    cameraRef={cameraRef}
                    onFaceBoundsChange={handleFaceFrameChange}
                    onCameraReady={onCameraReady}
                    onCameraUnavailable={setCameraRuntimeError}
                  />
                ) : (
                  <NativeTryOnFaceCamera
                    cameraRef={cameraRef}
                    stageLayout={stageLayout}
                    onFaceBoundsChange={handleFaceFrameChange}
                    onCameraReady={onCameraReady}
                    onCameraUnavailable={setCameraRuntimeError}
                  />
                )
              ) : (
                <CameraView
                  ref={cameraRef}
                  style={styles.captureStageImage}
                  facing="front"
                  mode="picture"
                  animateShutter
                  onMountError={setCameraRuntimeError}
                />
              )
            ) : (
              <View style={styles.captureStagePlaceholder}>
                <AppIcon name="camera" state="active" size="xl" />
                <Text style={styles.captureStagePlaceholderTitle}>
                  Camera access needed
                </Text>
                <Text style={styles.captureStagePlaceholderBody}>
                  Allow camera or upload a photo.
                </Text>
              </View>
            )}

            <View pointerEvents="none" style={styles.captureFrame}>
              <View style={styles.captureFaceGuide} />
              <View
                style={[styles.captureCorner, styles.captureCornerTopLeft]}
              />
              <View
                style={[styles.captureCorner, styles.captureCornerTopRight]}
              />
              <View
                style={[styles.captureCorner, styles.captureCornerBottomLeft]}
              />
              <View
                style={[styles.captureCorner, styles.captureCornerBottomRight]}
              />
              <View style={styles.captureHintPill}>
                <Text style={styles.captureHintText}>Front</Text>
              </View>
            </View>

            {shouldShowWigLayer ? (
              <View
                key={selectedWig.id || primaryTryOnImageUrl}
                pointerEvents="auto"
                style={styles.tryOnLayerWrap}
                renderToHardwareTextureAndroid
                shouldRasterizeIOS
                {...calibrationPanResponder.panHandlers}
              >
                {shouldRenderBackWigLayer ? (
                  <WigLayerImage
                    sourceUri={selectedWig.layer_back_hair_url}
                    style={getLayerStyle("backHair", 1)}
                  />
                ) : null}
                {shouldRenderFullWigLayer ? (
                  <WigLayerImage
                    sourceUri={selectedWig.layer_full_wig_url}
                    style={getLayerStyle("fullWig", 3)}
                  />
                ) : null}
                {shouldRenderFrontWigLayer ? (
                  <Image
                    source={{ uri: selectedWig.layer_front_bangs_url }}
                    resizeMode="contain"
                    fadeDuration={0}
                    style={getLayerStyle("frontBangs", 4)}
                  />
                ) : null}
                {shouldUseSingleTryOnImage ? (
                  <WigLayerImage
                    sourceUri={primaryTryOnImageUrl}
                    style={getLayerStyle("fullWig", 3)}
                  />
                ) : null}
              </View>
            ) : null}
            {selectedWigNeedsLayer ? (
              <View pointerEvents="none" style={styles.tryOnLayerMissingBanner}>
                <Text style={styles.tryOnLayerMissingText}>
                  Try-on layer missing
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.availableWigsSection}>
            <View style={styles.availableWigsHeader}>
              <Text style={styles.availableWigsTitle}>Available wigs</Text>
              {isLoadingAvailableWigs ? (
                <Text style={styles.availableWigsMeta}>Loading</Text>
              ) : (
                <Text style={styles.availableWigsMeta}>
                  {availableWigs.length} active
                </Text>
              )}
            </View>

            {availableWigs.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.availableWigsRow}
              >
                {availableWigs.map((wig) => {
                  const isSelected = selectedWigId === wig.id;
                  const isAiRecommended = recommendedWigId === wig.id;

                  return (
                    <Pressable
                      key={wig.id || `${wig.wig_id}-${wig.wig_name}`}
                      accessibilityRole="button"
                      accessibilityLabel={wig.wig_name}
                      onPress={() => onSelectWig(wig.id)}
                      style={({ pressed }) => [
                        styles.tryOnWigCard,
                        isSelected ? styles.tryOnWigCardActive : null,
                        pressed ? styles.optionCardPressed : null,
                      ]}
                    >
                      <View style={styles.tryOnWigImageWrap}>
                        {isAiRecommended ? (
                          <View style={styles.tryOnWigAiBadge}>
                            <AppIcon
                              name="sparkle"
                              size="sm"
                              color={theme.colors.textInverse}
                            />
                            <Text style={styles.tryOnWigAiBadgeText}>AI</Text>
                          </View>
                        ) : null}
                        {wig.thumbnail_url ? (
                          <Image
                            source={{ uri: wig.thumbnail_url }}
                            resizeMode="cover"
                            style={styles.tryOnWigImage}
                          />
                        ) : (
                          <View style={styles.tryOnWigImagePlaceholder}>
                            <AppIcon
                              name="image"
                              size="lg"
                              color={theme.colors.brandPrimary}
                            />
                          </View>
                        )}
                      </View>
                      <Text numberOfLines={1} style={styles.tryOnWigName}>
                        {wig.wig_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.availableWigsEmpty}>
                <Text style={styles.availableWigsEmptyText}>
                  No active try-on wigs yet.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.captureControls}>
            <IconCircleButton
              icon="image"
              accessibilityLabel="Upload front photo"
              loading={isPickingReference}
              onPress={() => {
                onUpload?.();
              }}
            />
            <IconCircleButton
              icon="camera"
              accessibilityLabel="Capture front photo"
              variant="primary"
              loading={isCapturingPhoto}
              disabled={!canCaptureLivePhoto}
              onPress={
                hasCameraPermission
                  ? () =>
                      onCapture?.({
                        faceFrame: activeFaceFrame,
                        stageLayout,
                        wigCalibration,
                      })
                  : onRequestPermission
              }
              style={styles.captureButtonPrimary}
            />
            <View style={styles.captureControlsSpacer} />
          </View>

          <View style={styles.modalFooter}>
            <Text style={styles.modalFooterText}>
              {referenceImage?.uri
                ? "Photo ready."
                : selectedWig
                  ? "Wig is placed automatically."
                  : "Add a front photo."}
            </Text>

            {referenceImage?.uri ? (
              <AppButton
                title="Use Photo"
                disabled={!canUseSelectedPhoto}
                onPress={onGeneratePreview}
                leading={<AppIcon name="success" state="inverse" />}
              />
            ) : null}
          </View>
        </ScrollView>
      </View>
      <Modal
        transparent
        visible={isCalibrationOpen}
        animationType="fade"
        onRequestClose={() => setIsCalibrationOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close wig calibration"
            style={styles.modalBackdrop}
            onPress={() => setIsCalibrationOpen(false)}
          />
          <View style={styles.calibrationCard}>
            <View style={styles.calibrationHeader}>
              <Text style={styles.calibrationTitle}>Wig calibration</Text>
              <Pressable
                onPress={() => setIsCalibrationOpen(false)}
                style={styles.headerIconButton}
              >
                <AppIcon name="close" state="muted" />
              </Pressable>
            </View>
            <CalibrationSlider
              label="Horizontal"
              value={wigCalibration.offsetX}
              min={-140}
              max={140}
              step={2}
              formatValue={(value) => `${Math.round(value)}px`}
              onChange={(value) => setCalibrationValue("offsetX", value)}
            />
            <CalibrationSlider
              label="Vertical"
              value={wigCalibration.offsetY}
              min={-140}
              max={140}
              step={2}
              formatValue={(value) => `${Math.round(value)}px`}
              onChange={(value) => setCalibrationValue("offsetY", value)}
            />
            <CalibrationSlider
              label="Scale"
              value={wigCalibration.scale}
              min={0.75}
              max={1.6}
              step={0.01}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              onChange={(value) => setCalibrationValue("scale", value)}
            />
            <View style={styles.calibrationActions}>
              <AppButton
                title="Reset"
                variant="secondary"
                fullWidth={false}
                onPress={resetCalibration}
              />
              <AppButton
                title="Done"
                fullWidth={false}
                onPress={() => setIsCalibrationOpen(false)}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// eslint-disable-next-line no-unused-vars
function AiMatcherSkeleton({ roles }) {
  return (
    <View
      style={[
        styles.matcherSkeletonCard,
        {
          backgroundColor: roles.supportCardBackground,
          borderColor: roles.supportCardBorder,
        },
      ]}
    >
      <View style={styles.matcherLoadingRow}>
        <View
          style={[
            styles.matcherLoadingDot,
            { backgroundColor: roles.primaryActionBackground },
          ]}
        />
        <Text
          style={[styles.matcherLoadingText, { color: roles.iconPrimaryColor }]}
        >
          Analyzing styles...
        </Text>
      </View>
      <View style={styles.matcherSkeletonGrid}>
        <View style={styles.matcherSkeletonMain}>
          <View
            style={[styles.matcherSkeletonBlock, styles.matcherSkeletonHero]}
          />
          <View style={styles.matcherSkeletonPills}>
            <View
              style={[
                styles.matcherSkeletonBlock,
                styles.matcherSkeletonPillWide,
              ]}
            />
            <View
              style={[styles.matcherSkeletonBlock, styles.matcherSkeletonPill]}
            />
          </View>
        </View>
        <View style={styles.matcherSkeletonSide}>
          {[0, 1, 2, 3].map((item) => (
            <View
              key={item}
              style={[styles.matcherSkeletonBlock, styles.matcherSkeletonLine]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function MatcherRecommendationCard({
  option,
  optionIndex,
  isActive,
  imageUri,
  selectedWig,
  onPress,
  roles,
}) {
  const [previewLayout, setPreviewLayout] = useState({ width: 0, height: 0 });
  const selectedWigLayerUrl = getPrimaryTryOnImageUrl(selectedWig);
  const placement = option?.placement || null;
  const selectedWigLayerStyle =
    placement?.faceFrame && previewLayout.width && previewLayout.height
      ? buildFaceAnchoredTryOnLayerStyle(
          placement.faceFrame,
          previewLayout,
          "fullWig",
          3,
          selectedWig?.fit_settings,
          placement.wigCalibration || DEFAULT_WIG_CALIBRATION,
        )
      : buildTryOnLayerStyle(selectedWig?.fit_settings, "fullWig", 3);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Wig match ${optionIndex + 1}: ${option.name}`}
      accessibilityState={{ selected: isActive }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.matcherCard,
        {
          backgroundColor: roles.defaultCardBackground,
          borderColor: isActive
            ? roles.primaryActionBackground
            : roles.defaultCardBorder,
        },
        pressed ? styles.preferencePressed : null,
      ]}
    >
      <View
        style={[
          styles.matcherImageWrap,
          { backgroundColor: roles.supportCardBackground },
        ]}
        onLayout={(event) =>
          setPreviewLayout({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          })
        }
      >
        {imageUri ? (
          <>
            <Image source={{ uri: imageUri }} style={styles.matcherImage} />
            {selectedWigLayerUrl ? (
              <Image
                source={{ uri: selectedWigLayerUrl }}
                resizeMode="contain"
                fadeDuration={0}
                style={[selectedWigLayerStyle, styles.matcherWigOverlay]}
              />
            ) : null}
          </>
        ) : (
          <View style={styles.matcherImagePlaceholder}>
            <AppIcon name="image" size="xl" color={roles.iconPrimaryColor} />
          </View>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", "rgba(75,16,32,0.58)"]}
          start={{ x: 0.5, y: 0.5 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.matcherImageShade}
        />
        <View style={styles.matcherRankBadge}>
          <MaterialCommunityIcons name="creation" size={13} color={theme.colors.palette.wine800} />
          <Text style={styles.matcherRankText}>MATCH {optionIndex + 1}</Text>
        </View>
        {isActive ? (
          <View style={styles.matcherSelectedBadge}>
            <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
            <Text style={styles.matcherSelectedBadgeText}>Selected</Text>
          </View>
        ) : null}
      </View>

      <LinearGradient
        colors={
          isActive
            ? [theme.colors.palette.blush100, theme.colors.palette.warm50]
            : [theme.colors.palette.white, theme.colors.palette.warm50]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.matcherCardBody}
      >
        <Text
          numberOfLines={2}
          style={[styles.matcherCardTitle, { color: roles.headingText }]}
        >
          {option.name}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.matcherCardMeta, { color: roles.bodyText }]}
        >
          {option.family || option.matchLabel || "Personalized style"}
        </Text>
        <View style={styles.matcherCardFooter}>
          <Text
            numberOfLines={2}
            style={[styles.matcherCardPrice, { color: roles.iconPrimaryColor }]}
          >
            {option.matchLabel || "Selected"}
          </Text>
          <View
            style={[
              styles.matcherFavoriteButton,
              {
                backgroundColor: isActive
                  ? roles.primaryActionBackground
                  : roles.iconPrimarySurface,
              },
            ]}
          >
            <AppIcon
              name={isActive ? "checkmarkCircle" : "gesture-tap"}
              size="md"
              color={isActive ? roles.primaryActionText : roles.iconPrimaryColor}
            />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function AiWigCompositePreview({
  baseImageUri,
  selectedWig,
  placement,
  previewCaptureRef,
  roles,
}) {
  const [previewLayout, setPreviewLayout] = useState({ width: 0, height: 0 });
  const [manualFit, setManualFit] = useState({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const holdDelayRef = useRef(null);
  const holdIntervalRef = useRef(null);
  const detectedFaceFrame =
    previewLayout.width && previewLayout.height
      ? mapStaticImageFaceFrameToStage(placement?.faceFrame, previewLayout)
      : null;
  const activeFaceFrame =
    detectedFaceFrame ||
    (previewLayout.width && previewLayout.height ? buildGuideFaceFrame(previewLayout) : null);
  const mainWigUrl = selectedWig?.layer_full_wig_url || getPrimaryTryOnImageUrl(selectedWig);
  const faceBox =
    activeFaceFrame && previewLayout.width && previewLayout.height
      ? resolveFaceBoxInStage(activeFaceFrame, previewLayout)
      : null;
  const forehead = getFacePoint(activeFaceFrame, "FOREHEAD");
  const chin = getFacePoint(activeFaceFrame, "CHIN");
  const leftEye = getFacePoint(activeFaceFrame, "LEFT_EYE");
  const rightEye = getFacePoint(activeFaceFrame, "RIGHT_EYE");
  const leftTemple = getFacePoint(activeFaceFrame, "LEFT_TEMPLE");
  const rightTemple = getFacePoint(activeFaceFrame, "RIGHT_TEMPLE");
  const leftEar = getFacePoint(activeFaceFrame, "LEFT_EAR");
  const rightEar = getFacePoint(activeFaceFrame, "RIGHT_EAR");
  const nose = getFacePoint(activeFaceFrame, "NOSE");
  const eyeCenter = averagePoints([leftEye, rightEye]);
  const templeCenter = averagePoints([leftTemple, rightTemple]);
  const earCenter = averagePoints([leftEar, rightEar]);
  const faceCenter = averagePoints([templeCenter, earCenter, eyeCenter, nose]);
  const templeDistance = distanceBetweenPoints(leftTemple, rightTemple);
  const earDistance = distanceBetweenPoints(leftEar, rightEar);
  const eyeDistance = distanceBetweenPoints(leftEye, rightEye);
  const landmarkFaceWidth = Math.max(
    earDistance ? earDistance * 0.94 : 0,
    templeDistance ? templeDistance * 1.08 : 0,
    eyeDistance ? eyeDistance * 2.32 : 0,
    faceBox?.width ? faceBox.width * 0.96 : 0,
  );
  const landmarkFaceTop =
    forehead?.y ??
    (eyeCenter && landmarkFaceWidth
      ? eyeCenter.y - landmarkFaceWidth * 0.34
      : faceBox?.y);
  const landmarkFaceBottom = chin?.y ?? (faceBox ? faceBox.y + faceBox.height : 0);
  const landmarkFaceHeight = Math.max(
    landmarkFaceBottom - landmarkFaceTop,
    faceBox?.height || 0,
  );
  const mainWigStyle = faceBox
    ? (() => {
        const centerX = faceCenter?.x || faceBox.x + faceBox.width / 2;
        const faceWidth = landmarkFaceWidth || faceBox.width;
        const faceTop = landmarkFaceTop ?? faceBox.y;
        const faceHeight = landmarkFaceHeight || faceBox.height;
        const fitSettings = selectedWig?.fit_settings || {};
        const layerFit = resolveLayerFit(fitSettings, "fullWig");
        const tryOnConfig = resolveTryOnConfig(fitSettings, "fullWig");
        const faceHole = tryOnConfig.faceHole || {
          x: 0.24,
          y: 0.26,
          width: 0.52,
          height: 0.66,
        };
        const layerScale = normalizeLayerScale(layerFit.scale);
        const targetFaceWidth = faceWidth * 0.9;
        const targetFaceHeight = faceHeight * 0.98;
        const baseWidth =
          (targetFaceWidth / Math.max(faceHole.width, 0.18)) *
          layerScale *
          manualFit.scale;
        const baseHeight =
          (targetFaceHeight / Math.max(faceHole.height, 0.24)) *
          layerScale *
          manualFit.scale;
        const faceHoleCenterX = faceHole.x + faceHole.width / 2;
        const hairlineLift = -faceHeight * 0.08;
        return {
          position: "absolute",
          left:
            centerX -
            baseWidth * faceHoleCenterX +
            faceWidth * 0.005 +
            manualFit.offsetX +
            normalizeLayerOffset(layerFit.offsetX, previewLayout),
          top:
            faceTop -
            baseHeight * faceHole.y -
            hairlineLift +
            manualFit.offsetY +
            normalizeLayerOffset(layerFit.offsetY, previewLayout),
          width: baseWidth,
          height: baseHeight,
          zIndex: 3,
          elevation: 3,
        };
      })()
    : buildTryOnLayerStyle(selectedWig?.fit_settings, "fullWig", 3);
  const nudge = (key, amount) => {
    setManualFit((current) => ({
      ...current,
      [key]: key === "scale"
        ? Math.min(1.35, Math.max(0.7, current.scale + amount))
        : current[key] + amount,
    }));
  };
  const resetFit = () => setManualFit({ offsetX: 0, offsetY: 0, scale: 1 });
  const stopHold = () => {
    if (holdDelayRef.current) {
      clearTimeout(holdDelayRef.current);
      holdDelayRef.current = null;
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };
  const startHold = (action) => {
    stopHold();
    holdDelayRef.current = setTimeout(() => {
      action();
      holdIntervalRef.current = setInterval(action, 70);
    }, 300);
  };

  useEffect(() => () => {
    if (holdDelayRef.current) clearTimeout(holdDelayRef.current);
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
  }, []);

  return (
    <View style={styles.aiCompositeShell}>
      <View
        ref={previewCaptureRef}
        collapsable={false}
        style={[
          styles.aiResultImage,
          styles.aiCompositeFrame,
          { backgroundColor: roles.supportCardBackground },
        ]}
        onLayout={(event) =>
          setPreviewLayout({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          })
        }
      >
        {baseImageUri ? (
          <Image
            source={{ uri: baseImageUri }}
            resizeMode="cover"
            style={styles.aiCompositeBaseImage}
          />
        ) : null}
        {mainWigUrl ? (
          <WigLayerImage
            sourceUri={mainWigUrl}
            style={[mainWigStyle, styles.matcherWigOverlay]}
          />
        ) : null}
      </View>
      <Text style={[styles.wigFitSectionLabel, { color: roles.headingText }]}>Adjust fit</Text>
      <View style={styles.wigFitControls}>
        {[
          { key: "left", label: "Move left", icon: "arrow-left", action: () => nudge("offsetX", -8) },
          { key: "up", label: "Move up", icon: "arrow-up", action: () => nudge("offsetY", -8) },
          { key: "down", label: "Move down", icon: "arrow-down", action: () => nudge("offsetY", 8) },
          { key: "right", label: "Move right", icon: "arrow-right", action: () => nudge("offsetX", 8) },
          { key: "smaller", label: "Make smaller", icon: "minus", action: () => nudge("scale", -0.05) },
          { key: "larger", label: "Make larger", icon: "plus", action: () => nudge("scale", 0.05) },
          { key: "reset", label: "Reset fit", icon: "restore", action: resetFit },
        ].map((control) => (
          <Pressable
            key={control.key}
            accessibilityRole="button"
            accessibilityLabel={control.label}
            onPress={control.action}
            onPressIn={control.key === "reset" ? undefined : () => startHold(control.action)}
            onPressOut={control.key === "reset" ? undefined : stopHold}
            style={({ pressed }) => [
              styles.wigFitButton,
              {
                backgroundColor: roles.pageBackground,
                borderColor: roles.defaultCardBorder,
              },
              pressed ? styles.preferencePressed : null,
            ]}
          >
            <MaterialCommunityIcons name={control.icon} size={18} color={roles.primaryActionBackground} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RequestFlowModal({
  visible,
  step,
  control,
  errors,
  patientName,
  patientDetails,
  medicalCondition,
  availableWigs,
  referenceImage,
  selectedWig,
  recommendedPreferenceOptions,
  recommendationOptions,
  selectedOptionId,
  onSelectOption,
  wigPreferenceOptions,
  isLoadingWigPreferenceOptions,
  generatedImageUri,
  preview,
  hasGeneratedPreview,
  isGeneratingPreview,
  isSavingRequest,
  isCapturingPhoto,
  certificateVerification,
  isVerifyingCertificate,
  termsDocument,
  isLoadingTermsDocument,
  termsDocumentError,
  onRetryTermsDocument,
  photoValidation,
  hasCameraPermission,
  cameraRef,
  onClose,
  onContinueToDetails,
  onCapturePhoto,
  onUploadCertificate,
  onScanCertificate,
  onRequestCameraPermission,
  onContinueToWigs,
  onStartGeneration,
  onTryAnotherWig,
  onUploadAnotherPhoto,
  onDownloadImage,
  previewCaptureRef,
  onSubmitRequest,
  onSelectWig,
  onRequestOwnWig,
  safetyAssessment,
  isSavingSafety,
  onChangeSafety,
  onSubmitSafety,
  roles,
}) {
  const insets = useSafeAreaInsets();
  const [isRetakingPhoto, setIsRetakingPhoto] = useState(false);
  const [documentPreviewUri, setDocumentPreviewUri] = useState("");
  const [documentPreviewFailed, setDocumentPreviewFailed] = useState(false);
  const [isDocumentPreviewLoading, setIsDocumentPreviewLoading] = useState(false);
  const [isPatientApproveDocked, setIsPatientApproveDocked] = useState(true);
  const [recommendationViewportWidth, setRecommendationViewportWidth] = useState(0);
  const recommendationCarouselRef = useRef(null);
  const recommendationScrollX = useRef(new Animated.Value(0)).current;
  const patientScrollMetricsRef = useRef({
    contentHeight: 0,
    viewportHeight: 0,
    offsetY: 0,
  });
  const hasPreferenceOptions = Boolean(
    wigPreferenceOptions?.lengths?.length ||
    wigPreferenceOptions?.colors?.length ||
    wigPreferenceOptions?.textures?.length ||
    wigPreferenceOptions?.densities?.length ||
    wigPreferenceOptions?.capSizes?.length ||
    wigPreferenceOptions?.styles?.length,
  );
  const hasAvailableWigs =
    Array.isArray(availableWigs) && availableWigs.length > 0;
  const activeRecommendation = (recommendationOptions || []).find(
    (option) => option.id === selectedOptionId,
  ) || recommendationOptions?.[0] || null;
  const activeRecommendationIndex = Math.max(
    0,
    (recommendationOptions || []).findIndex(
      (option) => option.id === activeRecommendation?.id,
    ),
  );
  const recommendationCardWidth = recommendationViewportWidth || 280;
  const recommendationSnapInterval = recommendationCardWidth + theme.spacing.md;
  const selectRecommendationAtIndex = (index, shouldScroll = false) => {
    const boundedIndex = Math.max(
      0,
      Math.min(index, Math.max(0, (recommendationOptions || []).length - 1)),
    );
    const option = recommendationOptions?.[boundedIndex];
    if (!option) return;
    onSelectOption?.(option.id);
    if (shouldScroll) {
      recommendationCarouselRef.current?.scrollTo({
        x: boundedIndex * recommendationSnapInterval,
        animated: true,
      });
    }
  };
  const patientPicture = patientDetails?.patient_picture || "";
  const medicalDocument = patientDetails?.medical_document || "";
  const patientHeroName = patientName || "Patient account";
  const patientHeroNameSize =
    patientHeroName.length > 24
      ? theme.typography.semantic.body
      : theme.typography.semantic.titleSm;

  const syncPatientApproveDocking = React.useCallback(() => {
    if (step !== "patient") return;
    const { contentHeight, viewportHeight, offsetY } = patientScrollMetricsRef.current;
    if (!contentHeight || !viewportHeight) return;
    const canScroll = contentHeight > viewportHeight + 24;
    const distanceFromEnd = Math.max(0, contentHeight - viewportHeight - offsetY);
    setIsPatientApproveDocked(canScroll && distanceFromEnd > 72);
  }, [step]);
  const medicalDocumentName = medicalDocument
    ? getFileNameFromUrl(medicalDocument)
    : "No document uploaded";
  const hasMedicalDocumentPreview = Boolean(medicalDocument);
  const isMedicalDocumentImage = isImageDocumentUrl(medicalDocument);
  const isMedicalDocumentPdf = isPdfDocumentUrl(medicalDocument);
  const persistedVerificationStatus = patientDetails?.medical_document_verification_status || "";
  const effectiveVerification = certificateVerification || {
    status: persistedVerificationStatus,
    doctorName: patientDetails?.doctor_name || "",
    licenseNumber: patientDetails?.doctor_license_number || "",
  };
  const certificatePassed = ["ocr_passed_prc_pending", "verified", "prc_verified"].includes(
    String(effectiveVerification?.status || "").toLowerCase(),
  );
  const medicalDocumentStatus = certificatePassed
    ? "OCR passed"
    : medicalDocument
      ? "Needs OCR"
      : "Required";
  const shouldShowCapturedPhoto = Boolean(referenceImage?.uri && !isRetakingPhoto);
  const captureButtonTitle = !hasCameraPermission
    ? "Allow Camera"
    : isCapturingPhoto
      ? "Capturing..."
      : shouldShowCapturedPhoto
        ? "Retake Photo"
        : "Take Photo";
  const handleCameraAction = () => {
    if (!hasCameraPermission) {
      onRequestCameraPermission?.();
      return;
    }

    if (shouldShowCapturedPhoto) {
      setIsRetakingPhoto(true);
      return;
    }

    onCapturePhoto?.();
  };

  useEffect(() => {
    if (referenceImage?.uri) {
      setIsRetakingPhoto(false);
    }
  }, [referenceImage?.uri]);

  useEffect(() => {
    if (step !== "summary") return;
    recommendationScrollX.setValue(0);
    recommendationCarouselRef.current?.scrollTo({ x: 0, animated: false });
  }, [recommendationOptions, recommendationScrollX, step]);

  useEffect(() => {
    setDocumentPreviewFailed(false);
    setIsDocumentPreviewLoading(Boolean(medicalDocument && isMedicalDocumentImage));
  }, [isMedicalDocumentImage, medicalDocument]);

  const patientIdentityWidget = (
    <LinearGradient
      colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
      start={{ x: 0.05, y: 0 }}
      end={{ x: 0.95, y: 1 }}
      style={styles.confirmDetailsHero}
    >
      <View pointerEvents="none" style={styles.confirmDetailsGlow} />
      <View style={styles.patientRecordPill}>
        <MaterialCommunityIcons name="shield-account-outline" size={13} color="#FFFFFF" />
        <Text style={styles.confirmDetailsEyebrow}>PATIENT RECORD</Text>
      </View>
      <View style={styles.patientHeroRow}>
        <View
          style={[
            styles.patientAvatarCircle,
            {
              backgroundColor: "#FFFFFF",
              borderColor: "rgba(255,255,255,0.76)",
            },
          ]}
        >
          {patientPicture ? (
            <Image source={{ uri: patientPicture }} style={styles.patientAvatarImage} resizeMode="cover" />
          ) : (
            <AppIcon name="image" size="md" color={theme.colors.palette.wine700} />
          )}
        </View>
        <View style={styles.patientHeroCopy}>
          <Text
            style={[styles.patientHeroName, { color: "#FFFFFF", fontSize: patientHeroNameSize }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {patientHeroName}
          </Text>
          <Text style={[styles.patientHeroMeta, { color: "#F7DDE4" }]} numberOfLines={1}>
            {medicalCondition || patientDetails?.medical_condition || "Medical condition"}
          </Text>
        </View>
        <View style={styles.patientIdentityVerifiedBadge}>
          <MaterialCommunityIcons name="check-decagram" size={19} color={theme.colors.palette.wine800} />
        </View>
      </View>
    </LinearGradient>
  );

  if (!visible) return null;

  return (
    <Modal
      transparent={false}
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[
          styles.flowKeyboardWrap,
          { backgroundColor: roles.pageBackground },
        ]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.bottom : 0}
      >
        <View
          style={[
            styles.flowFullScreen,
            {
              paddingTop: insets.top,
              backgroundColor: roles.pageBackground,
            },
          ]}
        >
          <LinearGradient
            colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.flowTopBar}
          >
            <View pointerEvents="none" style={styles.flowTopBarGlow} />
            <RequestFlowHeader
              title="Request Wig"
              onBack={onClose}
              roles={roles}
            />
          </LinearGradient>

          {step === "patient" ? (
            <View style={[styles.patientIdentityStickyHost, { backgroundColor: roles.pageBackground }]}>
              {patientIdentityWidget}
            </View>
          ) : null}

          <ScrollView
            style={styles.flowScroll}
            contentContainerStyle={[
              styles.flowScrollContent,
              {
                paddingBottom:
                  Math.max(insets.bottom, theme.spacing.xl) +
                  (["styles", "summary"].includes(step) ? 112 : 0),
              },
            ]}
            onLayout={(event) => {
              if (step !== "patient") return;
              patientScrollMetricsRef.current.viewportHeight = event.nativeEvent.layout.height;
              syncPatientApproveDocking();
            }}
            onContentSizeChange={(_width, height) => {
              if (step !== "patient") return;
              patientScrollMetricsRef.current.contentHeight = height;
              syncPatientApproveDocking();
            }}
            onScroll={(event) => {
              if (step !== "patient") return;
              patientScrollMetricsRef.current.offsetY = event.nativeEvent.contentOffset.y;
              syncPatientApproveDocking();
            }}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            showsVerticalScrollIndicator={false}
          >
            {step === "patient" ? (
              <View style={styles.flowSection}>
                <LinearGradient
                  colors={[roles.defaultCardBackground, roles.supportCardBackground]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[
                    styles.documentPreviewCard,
                    {
                      borderColor: roles.defaultCardBorder,
                    },
                  ]}
                >
                  <View style={styles.documentPreviewHeader}>
                    <View style={styles.documentRowIcon}>
                      <MaterialCommunityIcons
                        name="file-document-outline"
                        size={18}
                        color={roles.primaryActionBackground}
                      />
                    </View>
                    <View style={styles.documentRowCopy}>
                      <Text style={[styles.documentRowLabel, { color: roles.bodyText }]}>
                        Medical certificate
                      </Text>
                      <Text style={[styles.documentModuleHint, { color: roles.metaText }]}>Review or replace your uploaded record.</Text>
                    </View>
                    <View style={[styles.documentStatusPill, { backgroundColor: roles.iconPrimarySurface }]}>
                      <MaterialCommunityIcons
                        name={certificatePassed ? "check-circle-outline" : "clock-outline"}
                        size={13}
                        color={certificatePassed ? roles.successText : roles.primaryActionBackground}
                      />
                      <Text
                        style={[
                          styles.documentRowStatus,
                          { color: certificatePassed ? roles.successText : roles.primaryActionBackground },
                        ]}
                        numberOfLines={1}
                      >
                        {medicalDocumentStatus}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.documentFileRow, { backgroundColor: roles.iconPrimarySurface }]}>
                    <MaterialCommunityIcons name="file-pdf-box" size={18} color={roles.primaryActionBackground} />
                    <Text style={[styles.documentFileName, { color: roles.headingText }]} numberOfLines={2}>
                      {medicalDocumentName}
                    </Text>
                  </View>

                  {hasMedicalDocumentPreview && isMedicalDocumentPdf ? (
                    <LegalDocumentPreview
                      document={{
                        title: "Medical Certificate",
                        document_type: "medical_certificate",
                        content: medicalDocumentName,
                        pdf_url: medicalDocument,
                      }}
                      roles={roles}
                      showFooter={false}
                      viewportHeight={190}
                      actionLabel="Preview"
                      actionPlacement="bottomCenter"
                    />
                  ) : (
                    <View style={[styles.documentPreviewFrame, { backgroundColor: roles.pageBackground, borderColor: roles.defaultCardBorder }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open medical certificate preview"
                      disabled={!hasMedicalDocumentPreview}
                      onPress={() => setDocumentPreviewUri(medicalDocument)}
                      style={({ pressed }) => [
                        styles.documentPreviewPressable,
                        pressed ? styles.preferencePressed : null,
                      ]}
                    >
                      {hasMedicalDocumentPreview && isMedicalDocumentImage && !documentPreviewFailed ? (
                        <Image
                          source={{ uri: medicalDocument }}
                          style={styles.documentPreviewImage}
                          resizeMode="contain"
                          onLoadStart={() => setIsDocumentPreviewLoading(true)}
                          onLoadEnd={() => setIsDocumentPreviewLoading(false)}
                          onError={() => {
                            setDocumentPreviewFailed(true);
                            setIsDocumentPreviewLoading(false);
                          }}
                        />
                      ) : (
                        <View style={styles.documentPreviewPlaceholder}>
                          <MaterialCommunityIcons
                            name={hasMedicalDocumentPreview ? "file-document-outline" : "file-upload-outline"}
                            size={34}
                            color={roles.primaryActionBackground}
                          />
                          <Text style={[styles.documentPreviewPlaceholderText, { color: roles.bodyText }]}>
                            {hasMedicalDocumentPreview
                              ? documentPreviewFailed
                                ? "The thumbnail is unavailable. Tap Preview to open the certificate."
                                : "Tap Preview to open the uploaded certificate."
                              : "Upload or scan the medical certificate."}
                          </Text>
                        </View>
                      )}
                      {isDocumentPreviewLoading ? (
                        <View pointerEvents="none" style={[styles.documentPreviewLoading, { backgroundColor: roles.pageBackground }]}>
                          <ActivityIndicator color={roles.primaryActionBackground} />
                          <Text style={[styles.documentPreviewLoadingText, { color: roles.metaText }]}>Preparing certificate preview…</Text>
                        </View>
                      ) : null}
                      {hasMedicalDocumentPreview ? (
                        <View pointerEvents="none" style={styles.documentPreviewZoomAnchor}>
                          <View style={[styles.documentPreviewZoomBadge, { backgroundColor: roles.primaryActionBackground }]}>
                            <MaterialCommunityIcons name="fullscreen" size={15} color={roles.primaryActionText} />
                            <Text style={[styles.documentPreviewZoomText, { color: roles.primaryActionText }]}>Preview</Text>
                          </View>
                        </View>
                      ) : null}
                    </Pressable>
                    </View>
                  )}

                  <View style={styles.certificateActionRow}>
                    <View style={styles.certificateActionCell}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Upload medical certificate"
                        disabled={isVerifyingCertificate}
                        onPress={onUploadCertificate}
                        style={({ pressed }) => [
                          styles.certificateActionButton,
                          pressed ? styles.preferencePressed : null,
                          isVerifyingCertificate ? styles.certificateIconButtonDisabled : null,
                        ]}
                      >
                        <LinearGradient
                          colors={[roles.iconPrimarySurface, roles.defaultCardBackground]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[styles.certificateActionGradient, { borderColor: roles.primaryActionBackground }]}
                        >
                          <MaterialCommunityIcons
                            name="file-upload-outline"
                            size={19}
                            color={roles.primaryActionBackground}
                          />
                          <Text
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.72}
                            style={[styles.certificateActionText, { color: roles.primaryActionBackground }]}
                          >
                            Replace document
                          </Text>
                        </LinearGradient>
                      </Pressable>
                    </View>
                    <View style={styles.certificateActionCell}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Scan medical certificate"
                        disabled={isVerifyingCertificate}
                        onPress={onScanCertificate}
                        style={({ pressed }) => [
                          styles.certificateActionButton,
                          pressed ? styles.preferencePressed : null,
                          isVerifyingCertificate ? styles.certificateIconButtonDisabled : null,
                        ]}
                      >
                        <LinearGradient
                          colors={[theme.colors.palette.wine600, theme.colors.palette.wine800, theme.colors.palette.wine900]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[styles.certificateActionGradient, { borderColor: theme.colors.palette.wine700 }]}
                        >
                          {isVerifyingCertificate ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : (
                            <>
                              <MaterialCommunityIcons name="camera-outline" size={19} color={roles.primaryActionText} />
                              <Text
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.72}
                                style={[styles.certificateActionText, { color: roles.primaryActionText }]}
                              >
                                Scan document
                              </Text>
                            </>
                          )}
                        </LinearGradient>
                      </Pressable>
                    </View>
                  </View>
                </LinearGradient>

                <View style={styles.termsAgreementCard}>
                  <LinearGradient
                    colors={[theme.colors.palette.wine900, theme.colors.palette.wine700, theme.colors.palette.wine600]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.termsAgreementHeader}
                  >
                    <View style={styles.termsAgreementHeaderGlow} />
                    <View style={styles.termsAgreementIcon}>
                      <MaterialCommunityIcons name="file-sign" size={20} color="#FFFFFF" />
                    </View>
                    <View style={styles.termsAgreementHeaderCopy}>
                      <Text style={styles.termsAgreementTitle} numberOfLines={2}>
                        {termsDocument?.title || "Terms and agreement"}
                      </Text>
                      <Text style={styles.termsAgreementHint}>Tap the preview to read the active legal document.</Text>
                    </View>
                    {termsDocument?.version ? (
                      <View style={styles.termsVersionPill}>
                        <Text style={styles.termsVersionText}>v{termsDocument.version}</Text>
                      </View>
                    ) : null}
                  </LinearGradient>

                  {isLoadingTermsDocument ? (
                    <View style={styles.termsLoadingRow}>
                      <ActivityIndicator size="small" color={roles.primaryActionBackground} />
                      <Text style={[styles.termsLoadingText, { color: roles.bodyText }]}>Loading the active agreement…</Text>
                    </View>
                  ) : termsDocumentError ? (
                    <View style={[styles.termsErrorRow, { backgroundColor: roles.supportCardBackground }]}>
                      <MaterialCommunityIcons name="alert-circle-outline" size={19} color={roles.primaryActionBackground} />
                      <Text style={[styles.termsErrorText, { color: roles.bodyText }]}>{termsDocumentError}</Text>
                      <Pressable accessibilityRole="button" onPress={onRetryTermsDocument} style={styles.termsRetryButton}>
                        <Text style={[styles.termsRetryText, { color: roles.primaryActionBackground }]}>Retry</Text>
                      </Pressable>
                    </View>
                  ) : termsDocument ? (
                    <LegalDocumentPreview document={termsDocument} roles={roles} />
                  ) : null}

                  <Controller
                    control={control}
                    name="acceptedTerms"
                    render={({ field }) => (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked: Boolean(field.value),
                          disabled: !termsDocument || isLoadingTermsDocument,
                        }}
                        disabled={!termsDocument || isLoadingTermsDocument}
                        onPress={() => field.onChange(!field.value)}
                        style={({ pressed }) => [
                          styles.agreementRowCompact,
                          styles.termsAgreementCheckRow,
                          {
                            backgroundColor: field.value ? roles.iconPrimarySurface : roles.pageBackground,
                            borderColor: field.value ? roles.primaryActionBackground : roles.defaultCardBorder,
                          },
                          pressed ? styles.preferencePressed : null,
                          !termsDocument || isLoadingTermsDocument
                            ? styles.termsAgreementCheckRowDisabled
                            : null,
                        ]}
                      >
                        <View style={styles.termsAgreementContentRow}>
                          <View style={[
                            styles.checkBox,
                            styles.termsAgreementCheckBox,
                            field.value ? styles.checkBoxActive : null,
                          ]}>
                            {field.value ? <AppIcon name="success" state="inverse" size="sm" /> : null}
                          </View>
                          <Text style={[styles.termsAgreementLabel, { color: roles.headingText }]}>I agree to the terms above.</Text>
                          <View style={[styles.termsRequiredPill, { backgroundColor: roles.defaultCardBackground }]}>
                            <Text style={[styles.termsRequiredText, { color: roles.primaryActionBackground }]}>Required</Text>
                          </View>
                        </View>
                      </Pressable>
                    )}
                  />
                  {errors.acceptedTerms?.message ? <Text style={styles.fieldError}>{errors.acceptedTerms.message}</Text> : null}
                </View>

                <View style={styles.patientInlineApproveSlot}>
                  {!isPatientApproveDocked ? (
                    <AppButton
                      title="Approve Details"
                      onPress={onContinueToDetails}
                      fullWidth={true}
                      leading={<AppIcon name="success" state="inverse" />}
                    />
                  ) : null}
                </View>

              </View>
            ) : null}

            {step === "photo" ? (
              <View style={[styles.flowSection, styles.photoFlowSection]}>
                <LinearGradient
                  colors={[
                    theme.colors.palette.wine900,
                    theme.colors.palette.wine700,
                    theme.colors.palette.wine600,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.photoGuideCard}
                >
                  <View pointerEvents="none" style={styles.photoGuideGlow} />
                  <View style={styles.photoGuideIcon}>
                    <MaterialCommunityIcons name="camera-outline" size={24} color="#FFFFFF" />
                  </View>
                  <View style={styles.photoGuideCopy}>
                    <Text style={styles.photoGuideEyebrow}>PHOTO FOR YOUR WIG PREVIEW</Text>
                    <Text style={styles.photoGuideTitle}>Take a clear front photo</Text>
                    <Text style={styles.photoGuideBody}>
                      Center your full head in soft, even lighting.
                    </Text>
                  </View>
                </LinearGradient>

                <View
                  style={[
                    styles.aiPhotoStage,
                    {
                      backgroundColor: roles.supportCardBackground,
                      borderColor: roles.supportCardBorder,
                    },
                  ]}
                >
                  {shouldShowCapturedPhoto ? (
                    <Image
                      source={{ uri: referenceImage.uri }}
                      resizeMode="cover"
                      style={styles.aiPhotoPreview}
                    />
                  ) : hasCameraPermission ? (
                    <CameraView
                      ref={cameraRef}
                      style={styles.aiPhotoPreview}
                      facing="front"
                      mirror={true}
                    />
                  ) : (
                    <View style={styles.aiPhotoPlaceholder}>
                      <View
                        style={[
                          styles.aiPhotoPlaceholderIcon,
                          { backgroundColor: roles.iconPrimarySurface },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="face-recognition"
                          size={34}
                          color={roles.iconPrimaryColor}
                        />
                      </View>
                      <View style={styles.aiPhotoPlaceholderCopy}>
                        <Text style={[styles.aiPhotoPlaceholderTitle, { color: roles.headingText }]}>
                          Camera access needed
                        </Text>
                        <Text style={[styles.aiPhotoPlaceholderText, { color: roles.bodyText }]}>
                          Use the front camera to take your photo.
                        </Text>
                      </View>
                      <View style={styles.photoTipsRow}>
                        {["Front view", "Full head", "Good light"].map((tip) => (
                          <View
                            key={tip}
                            style={[
                              styles.photoTipPill,
                              {
                                backgroundColor: roles.defaultCardBackground,
                                borderColor: roles.defaultCardBorder,
                              },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="check"
                              size={13}
                              color={roles.primaryActionBackground}
                            />
                            <Text style={[styles.photoTipText, { color: roles.bodyText }]}>{tip}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {hasCameraPermission && !shouldShowCapturedPhoto ? (
                    <View pointerEvents="none" style={styles.photoCameraGuideOverlay}>
                      <View style={styles.photoFaceGuide} />
                      <View style={styles.photoCameraGuidePill}>
                        <MaterialCommunityIcons name="account-check-outline" size={16} color="#FFFFFF" />
                        <Text style={styles.photoCameraGuideText}>Center your face and full head</Text>
                      </View>
                    </View>
                  ) : null}

                  {shouldShowCapturedPhoto ? (
                    <View pointerEvents="none" style={styles.photoReadyPill}>
                      <MaterialCommunityIcons name="check-circle" size={16} color="#FFFFFF" />
                      <Text style={styles.photoReadyText}>Photo ready</Text>
                    </View>
                  ) : null}
                </View>

                {photoValidation?.message ? (
                  <StatusBanner
                    title={photoValidation.valid ? "Photo ready" : "Photo needs review"}
                    message={photoValidation.message}
                    variant={photoValidation.valid ? "success" : "error"}
                    presentation="inline"
                    visible={true}
                  />
                ) : null}

                {shouldShowCapturedPhoto ? (
                  <View style={styles.photoReviewActions}>
                    <View style={styles.photoReviewActionCell}>
                      <AppButton
                        title="Retake"
                        variant="outline"
                        onPress={handleCameraAction}
                        fullWidth={true}
                        leading={<AppIcon name="camera" state="active" />}
                        style={styles.photoCameraAction}
                      />
                    </View>
                    <View style={styles.photoReviewActionCell}>
                      <AppButton
                        title={isGeneratingPreview ? "Creating..." : "Use Photo"}
                        disabled={!photoValidation?.valid}
                        loading={isGeneratingPreview}
                        onPress={onContinueToWigs}
                        fullWidth={true}
                        leading={<AppIcon name="success" state="inverse" />}
                        style={styles.photoCameraAction}
                      />
                    </View>
                  </View>
                ) : (
                  <AppButton
                    title={captureButtonTitle}
                    loading={isCapturingPhoto}
                    onPress={handleCameraAction}
                    fullWidth={true}
                    leading={<AppIcon name="camera" state="inverse" />}
                    style={styles.photoCameraAction}
                  />
                )}

              </View>
            ) : null}

            {step === "styles" ? (
              <View style={styles.flowSection}>
                <View style={styles.requestFlowSectionHeader}>
                  <Text style={[styles.flowTitle, { color: roles.headingText }]}>Choose a Wig</Text>
                  <Text style={[styles.flowBody, { color: roles.bodyText }]}>
                    Tap a wig card to choose it. Its reference image will be
                    sent with your photo to create the preview.
                  </Text>
                </View>

                {hasAvailableWigs ? (
                  <View style={styles.wigStyleList}>
                    {availableWigs.map((wig) => {
                      const isSelected = selectedWig?.id === wig.id;
                      const wigSpec = wig?.physical_specification || {};
                      const specSummary = [
                        wigSpec?.color ? `Color: ${wigSpec.color}` : "",
                        wigSpec?.length != null ? `Length: ${wigSpec.length}` : "",
                        wigSpec?.style ? `Style: ${wigSpec.style}` : "",
                        wigSpec?.hair_texture ? `Texture: ${wigSpec.hair_texture}` : "",
                      ]
                        .filter(Boolean)
                        .join("\n");
                      const previewUrl = getWigPreviewImageUrl(wig);

                      return (
                        <Pressable
                          key={wig.id || `${wig.wig_id}-${wig.wig_name}`}
                          accessibilityRole="radio"
                          accessibilityLabel={`${wig.wig_name}${specSummary ? `, ${specSummary.replace(/\n/g, ", ")}` : ""}`}
                          accessibilityHint="Selects this wig for your preview"
                          accessibilityState={{ checked: isSelected }}
                          onPress={() => onSelectWig?.(wig.id)}
                          style={({ pressed }) => [
                            styles.wigStyleCard,
                            {
                              backgroundColor: isSelected
                                ? roles.supportCardBackground
                                : roles.pageBackground,
                              borderColor: isSelected
                                ? roles.primaryActionBackground
                                : roles.defaultCardBorder,
                            },
                            isSelected ? styles.wigStyleCardSelected : null,
                            pressed ? styles.wigStyleCardPressed : null,
                          ]}
                        >
                          <View style={styles.wigStyleThumbWrap}>
                            {previewUrl ? (
                              <Image
                                source={{ uri: previewUrl }}
                                resizeMode="cover"
                                style={styles.wigStyleThumb}
                              />
                            ) : (
                              <View
                                style={[
                                  styles.wigStyleThumb,
                                  styles.wigStyleThumbPlaceholder,
                                  {
                                    backgroundColor:
                                      roles.supportCardBackground,
                                  },
                                ]}
                              >
                                <AppIcon
                                  name="image"
                                  size="md"
                                  color={roles.primaryActionBackground}
                                />
                              </View>
                            )}
                          </View>

                          <View style={styles.wigStyleCopy}>
                            <Text
                              style={[
                                styles.wigStyleTitle,
                                { color: roles.headingText },
                              ]}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {wig.wig_name}
                            </Text>
                            {specSummary ? (
                              <Text
                                style={[
                                  styles.wigStyleSpec,
                                  { color: roles.bodyText },
                                ]}
                                numberOfLines={4}
                              >
                                {specSummary}
                              </Text>
                            ) : null}
                          </View>

                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View
                    style={[
                      styles.availableWigsEmpty,
                      {
                        borderColor: roles.defaultCardBorder,
                        backgroundColor: roles.defaultCardBackground,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.availableWigsEmptyText,
                        { color: roles.headingText },
                      ]}
                    >
                      No wig preview is available right now.
                    </Text>
                    <Text style={[styles.flowBody, { color: roles.bodyText }]}>
                      Request a custom wig specification instead.
                    </Text>
                  </View>
                )}

              </View>
            ) : null}

            {step === "generating" ? (
              <View style={styles.aiGeneratingState}>
                <ActivityIndicator
                  size="large"
                  color={roles.primaryActionBackground}
                />
                <Text style={[styles.flowTitle, { textAlign: "center" }]}>
                  AI is ranking facial-fit styles and generating three try-on images...
                </Text>
              </View>
            ) : null}

            {step === "customSpec" ? (
              <View style={styles.flowSection}>
                <View style={styles.requestFlowSectionHeader}>
                  <Text style={[styles.flowTitle, { color: roles.headingText }]}>Custom Wig Specification</Text>
                  <Text style={[styles.flowBody, { color: roles.bodyText }]}>
                    Provide the wig details if none of the stock styles fit.
                  </Text>
                </View>

                {isLoadingWigPreferenceOptions ? (
                  <Text
                    style={[
                      styles.preferenceHelperText,
                      { color: roles.metaText },
                    ]}
                  >
                    Loading specification options.
                  </Text>
                ) : null}

                {!isLoadingWigPreferenceOptions && !hasPreferenceOptions ? (
                  <Text
                    style={[
                      styles.preferenceHelperText,
                      { color: roles.metaText },
                    ]}
                  >
                    No specification options yet.
                  </Text>
                ) : null}

                <PreferenceChipGroup
                  control={control}
                  name="preferredLength"
                  title="Length"
                  options={wigPreferenceOptions?.lengths || []}
                  recommendedOptions={
                    recommendedPreferenceOptions?.preferredLength || []
                  }
                  roles={roles}
                />

                <ColorPaletteGroup
                  control={control}
                  roles={roles}
                  options={wigPreferenceOptions?.colors || []}
                  recommendedOptions={
                    recommendedPreferenceOptions?.preferredColor || []
                  }
                />

                <PreferenceChipGroup
                  control={control}
                  name="hairTexture"
                  title="Texture"
                  options={wigPreferenceOptions?.textures || []}
                  recommendedOptions={
                    recommendedPreferenceOptions?.hairTexture || []
                  }
                  roles={roles}
                />

                <PreferenceChipGroup
                  control={control}
                  name="hairDensity"
                  title="Density"
                  options={wigPreferenceOptions?.densities || []}
                  recommendedOptions={
                    recommendedPreferenceOptions?.hairDensity || []
                  }
                  roles={roles}
                />

                <PreferenceChipGroup
                  control={control}
                  name="capSize"
                  title="Cap Size"
                  options={wigPreferenceOptions?.capSizes || []}
                  recommendedOptions={
                    recommendedPreferenceOptions?.capSize || []
                  }
                  roles={roles}
                />

                <PreferenceChipGroup
                  control={control}
                  name="stylePreference"
                  title="Style"
                  options={wigPreferenceOptions?.styles || []}
                  recommendedOptions={
                    recommendedPreferenceOptions?.stylePreference || []
                  }
                  roles={roles}
                />

                <View style={styles.preferenceSection}>
                  <View style={styles.preferenceLabelRow}>
                    <Text
                      style={[
                        styles.preferenceSectionTitle,
                        { color: roles.headingText },
                      ]}
                    >
                      Additional notes
                    </Text>
                  </View>
                  <Controller
                    control={control}
                    name="specialNotes"
                    render={({ field }) => (
                      <AppInput
                        placeholder="Any sizing, color, or production notes"
                        variant="default"
                        multiline={true}
                        numberOfLines={4}
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={errors.specialNotes?.message}
                        shellStyle={[
                          styles.multilineInputShell,
                          {
                            backgroundColor: roles.defaultCardBackground,
                            borderColor: roles.defaultCardBorder,
                          },
                        ]}
                        inputStyle={styles.multilineInput}
                      />
                    )}
                  />
                </View>

                <View style={styles.singleActionRow}>
                  <AppButton
                    title="Submit Custom Request"
                    loading={isSavingRequest}
                    onPress={onSubmitRequest}
                    fullWidth={true}
                    leading={<AppIcon name="requests" state="inverse" />}
                  />
                </View>
              </View>
            ) : null}

            {step === "summary" ? (
              <View style={styles.matcherFlow}>
                <LinearGradient
                  colors={[
                    theme.colors.palette.wine900,
                    theme.colors.palette.wine700,
                    theme.colors.palette.wine600,
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.matcherHeroHeader}
                >
                  <View pointerEvents="none" style={styles.matcherHeroGlow} />
                  <View style={styles.matcherHeroTopRow}>
                    <View style={styles.matcherHeroIcon}>
                      <MaterialCommunityIcons name="creation-outline" size={23} color="#FFFFFF" />
                    </View>
                    <View style={styles.matcherCountPill}>
                      <Text style={styles.matcherCountText}>3 PERSONALIZED LOOKS</Text>
                    </View>
                  </View>
                  <Text style={styles.matcherHeroTitle}>Your Top 3 Wig Matches</Text>
                  <Text style={styles.matcherHeroBody}>
                    Swipe through each look and tap your favorite.
                  </Text>
                </LinearGradient>

                {hasGeneratedPreview ? (
                  <View style={styles.aiResultGrid}>
                    <View
                      style={styles.matcherCarouselViewport}
                      onLayout={(event) => {
                        const nextWidth = Math.round(event.nativeEvent.layout.width);
                        if (nextWidth > 0 && nextWidth !== recommendationViewportWidth) {
                          setRecommendationViewportWidth(nextWidth);
                        }
                      }}
                    >
                      <Animated.ScrollView
                        ref={recommendationCarouselRef}
                        horizontal
                        pagingEnabled={false}
                        snapToInterval={recommendationSnapInterval}
                        snapToAlignment="start"
                        decelerationRate="fast"
                        disableIntervalMomentum
                        nestedScrollEnabled
                        bounces={false}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.aiRecommendationRow}
                        onScroll={Animated.event(
                          [{ nativeEvent: { contentOffset: { x: recommendationScrollX } } }],
                          { useNativeDriver: true },
                        )}
                        onMomentumScrollEnd={(event) => {
                          const index = Math.round(
                            event.nativeEvent.contentOffset.x / recommendationSnapInterval,
                          );
                          selectRecommendationAtIndex(index);
                        }}
                        scrollEventThrottle={16}
                      >
                        {recommendationOptions.map((option, index) => {
                          const inputRange = [
                            (index - 1) * recommendationSnapInterval,
                            index * recommendationSnapInterval,
                            (index + 1) * recommendationSnapInterval,
                          ];
                          const scale = recommendationScrollX.interpolate({
                            inputRange,
                            outputRange: [0.965, 1, 0.965],
                            extrapolate: "clamp",
                          });
                          const opacity = recommendationScrollX.interpolate({
                            inputRange,
                            outputRange: [0.72, 1, 0.72],
                            extrapolate: "clamp",
                          });

                          return (
                            <Animated.View
                              key={option.id}
                              style={[
                                styles.aiRecommendationCard,
                                {
                                  width: recommendationCardWidth,
                                  opacity,
                                  transform: [{ scale }],
                                },
                              ]}
                            >
                              <MatcherRecommendationCard
                                option={option}
                                optionIndex={index}
                                isActive={option.id === activeRecommendation?.id}
                                imageUri={option.generatedImageUri || option.previewUrl}
                                selectedWig={null}
                                onPress={() => selectRecommendationAtIndex(index)}
                                roles={roles}
                              />
                            </Animated.View>
                          );
                        })}
                      </Animated.ScrollView>
                    </View>

                    <View style={styles.matcherCarouselNavigation}>
                      <View style={styles.matcherPagination}>
                        {recommendationOptions.map((option, index) => {
                          const isSelected = index === activeRecommendationIndex;
                          return (
                            <Pressable
                              key={option.id}
                              accessibilityRole="button"
                              accessibilityLabel={`Show wig match ${index + 1}`}
                              onPress={() => selectRecommendationAtIndex(index, true)}
                              hitSlop={8}
                              style={[
                                styles.matcherPaginationDot,
                                {
                                  backgroundColor: isSelected
                                    ? roles.primaryActionBackground
                                    : roles.defaultCardBorder,
                                },
                                isSelected ? styles.matcherPaginationDotActive : null,
                              ]}
                            />
                          );
                        })}
                      </View>
                      <View style={[styles.matcherSwipeHint, { backgroundColor: roles.iconPrimarySurface }]}>
                        <MaterialCommunityIcons
                          name="gesture-swipe-horizontal"
                          size={17}
                          color={roles.iconPrimaryColor}
                        />
                        <Text style={[styles.matcherSwipeHintText, { color: roles.bodyText }]}>Swipe to compare</Text>
                      </View>
                    </View>

                    {activeRecommendation?.suitabilityReason ? (
                      <LinearGradient
                        colors={[theme.colors.palette.blush100, theme.colors.palette.warm50]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[
                          styles.aiRecommendationReason,
                          { borderColor: roles.defaultCardBorder },
                        ]}
                      >
                        <View style={styles.aiRecommendationReasonHeader}>
                          <View style={[styles.aiRecommendationReasonIcon, { backgroundColor: roles.primaryActionBackground }]}>
                            <MaterialCommunityIcons name="creation" size={17} color={roles.primaryActionText} />
                          </View>
                          <View style={styles.aiRecommendationReasonHeading}>
                            <Text style={[styles.aiRecommendationReasonTitle, { color: roles.headingText }]}>
                              Why this look works
                            </Text>
                            <Text style={[styles.aiRecommendationReasonMatch, { color: roles.iconPrimaryColor }]} numberOfLines={1}>
                              {activeRecommendation.matchLabel || "Personalized for you"}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.flowBody, { color: roles.bodyText }]}>
                          {activeRecommendation.suitabilityReason}
                        </Text>
                      </LinearGradient>
                    ) : null}

                    <View style={[
                      styles.aiResultPanel,
                      styles.aiPreviewCard,
                      {
                        backgroundColor: roles.pageBackground,
                        borderColor: roles.defaultCardBorder,
                      },
                    ]}>
                      <View style={styles.aiPreviewCardHeader}>
                        <View>
                          <Text style={[styles.aiResultLabel, { color: roles.headingText }]}>
                            Selected AI try-on
                          </Text>
                          <Text style={[styles.aiPreviewHint, { color: roles.headingText }]}>
                            {activeRecommendation?.matchLabel || "AI-recommended style"}
                          </Text>
                        </View>
                      </View>
                      {preview?.render_mode === "wig_overlay" ? (
                        <AiWigCompositePreview
                          baseImageUri={referenceImage?.uri || generatedImageUri}
                          selectedWig={preview?.selected_wig || selectedWig}
                          placement={preview?.placement || referenceImage?.placement}
                          previewCaptureRef={previewCaptureRef}
                          roles={roles}
                        />
                      ) : (
                        <Image
                          source={{ uri: generatedImageUri }}
                          resizeMode="cover"
                          style={styles.aiResultImage}
                        />
                      )}
                    </View>

                    <View style={[
                      styles.previewReferenceCard,
                      {
                        backgroundColor: roles.pageBackground,
                        borderColor: roles.defaultCardBorder,
                      },
                    ]}>
                      <Image
                        source={{ uri: referenceImage?.uri }}
                        resizeMode="cover"
                        style={styles.previewReferenceImage}
                      />
                      <View style={styles.previewReferenceCopy}>
                        <Text style={[styles.aiResultLabel, { color: roles.headingText }]}>Original photo</Text>
                        <Text style={[styles.previewReferenceText, { color: roles.headingText }]}>
                          Used as the reference for this preview.
                        </Text>
                      </View>
                    </View>

                    {selectedWig ? (
                      <View style={[
                        styles.summaryNoteCard,
                        {
                          backgroundColor: roles.pageBackground,
                          borderColor: roles.defaultCardBorder,
                        },
                      ]}>
                        <Text style={[styles.summaryNoteTitle, { color: roles.headingText }]}>
                          {selectedWig.wig_name}
                        </Text>
                        <View style={styles.wigSpecificationGrid}>
                          {[
                            ["Color", selectedWig?.physical_specification?.color],
                            ["Length", selectedWig?.physical_specification?.length],
                            ["Style", selectedWig?.physical_specification?.style],
                            ["Texture", selectedWig?.physical_specification?.hair_texture],
                          ].filter(([, value]) => value !== null && value !== undefined && value !== "").map(([label, value]) => (
                            <View key={label} style={[styles.wigSpecificationItem, { borderColor: roles.defaultCardBorder }]}>
                              <Text style={[styles.wigSpecificationLabel, { color: roles.headingText }]}>{label}</Text>
                              <Text style={[styles.wigSpecificationValue, { color: roles.headingText }]}>{String(value)}</Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <AppCard
                    variant="soft"
                    radius="sm"
                    padding="md"
                    style={styles.summaryNoteCard}
                  >
                    <Text
                      style={[
                        styles.summaryNoteTitle,
                        { color: roles.headingText },
                      ]}
                    >
                      Preview unavailable
                    </Text>
                    <Text style={[styles.flowBody, { color: roles.bodyText }]}>
                      We could not prepare your wig preview. Please try again or choose another photo.
                    </Text>
                  </AppCard>
                )}

                <View style={styles.previewActionSection}>
                  <Text style={[styles.previewActionTitle, { color: roles.headingText }]}>Your selected look</Text>
                  <AppButton
                    title="Download Preview"
                    variant="outline"
                    disabled={!generatedImageUri && preview?.render_mode !== "wig_overlay"}
                    onPress={onDownloadImage}
                    leading={<AppIcon name="image" state="active" />}
                  />
                  <View style={styles.previewAlternativeActions}>
                    <View style={styles.previewAlternativeAction}>
                      <AppButton
                        title="Change Wig"
                        variant="outline"
                        size="sm"
                        onPress={onTryAnotherWig}
                        leading={<AppIcon name="sparkle" state="active" size="sm" />}
                      />
                    </View>
                    <View style={styles.previewAlternativeAction}>
                      <AppButton
                        title="New Photo"
                        variant="outline"
                        size="sm"
                        onPress={onUploadAnotherPhoto}
                        leading={<AppIcon name="image" state="active" size="sm" />}
                      />
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {step === "safety" ? (
              <View style={styles.flowSection}>
                <View style={styles.requestFlowSectionHeader}>
                  <Text style={[styles.flowTitle, { color: roles.headingText }]}>Safety Assessment</Text>
                  <Text style={[styles.flowBody, { color: roles.headingText }]}>
                    Tell us about scalp sensitivities or restrictions before your wig request is reviewed.
                  </Text>
                </View>

                <View style={[styles.safetyAssessmentCard, {
                  backgroundColor: roles.pageBackground,
                  borderColor: roles.defaultCardBorder,
                }]}>
                  <SafetyChoiceRow
                    label="Known allergies"
                    value={safetyAssessment.hasKnownAllergies}
                    onChange={(value) => onChangeSafety("hasKnownAllergies", value)}
                    roles={roles}
                  />
                  {safetyAssessment.hasKnownAllergies ? (
                    <AppInput
                      label="Allergy details"
                      value={safetyAssessment.allergyDetails}
                      onChangeText={(value) => onChangeSafety("allergyDetails", value)}
                      placeholder="List known allergies"
                      multiline
                      shellStyle={[
                        styles.safetyDetailInput,
                        {
                          backgroundColor: roles.pageBackground,
                          borderColor: roles.defaultCardBorder,
                        },
                      ]}
                    />
                  ) : null}
                  <SafetyChoiceRow
                    label="Sensitive scalp"
                    value={safetyAssessment.hasSensitiveScalp}
                    onChange={(value) => onChangeSafety("hasSensitiveScalp", value)}
                    roles={roles}
                  />
                  <SafetyChoiceRow
                    label="Scalp irritation"
                    value={safetyAssessment.hasScalpIrritation}
                    onChange={(value) => onChangeSafety("hasScalpIrritation", value)}
                    roles={roles}
                  />
                  <SafetyChoiceRow
                    label="Open scalp wounds"
                    value={safetyAssessment.hasOpenScalpWounds}
                    onChange={(value) => onChangeSafety("hasOpenScalpWounds", value)}
                    roles={roles}
                  />
                  <SafetyChoiceRow
                    label="Medical restriction"
                    value={safetyAssessment.hasMedicalRestriction}
                    onChange={(value) => onChangeSafety("hasMedicalRestriction", value)}
                    roles={roles}
                  />
                  {safetyAssessment.hasMedicalRestriction ? (
                    <AppInput
                      label="Medical restriction details"
                      value={safetyAssessment.medicalRestrictionDetails}
                      onChangeText={(value) => onChangeSafety("medicalRestrictionDetails", value)}
                      placeholder="Describe the restriction"
                      multiline
                      shellStyle={[
                        styles.safetyDetailInput,
                        {
                          backgroundColor: roles.pageBackground,
                          borderColor: roles.defaultCardBorder,
                        },
                      ]}
                    />
                  ) : null}
                </View>

                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: safetyAssessment.informationConfirmed }}
                  onPress={() => onChangeSafety("informationConfirmed", !safetyAssessment.informationConfirmed)}
                  style={styles.agreementRowCompact}
                >
                  <View style={[
                    styles.checkBox,
                    safetyAssessment.informationConfirmed ? styles.checkBoxActive : null,
                  ]}>
                    {safetyAssessment.informationConfirmed ? (
                      <AppIcon name="success" state="inverse" size="sm" />
                    ) : null}
                  </View>
                  <Text style={[styles.agreementText, { color: roles.headingText }]}>
                    I confirm that this safety information is complete and accurate.
                  </Text>
                </Pressable>

                <AppButton
                  title="Submit Safety Assessment"
                  onPress={onSubmitSafety}
                  loading={isSavingSafety}
                  disabled={isSavingSafety}
                  leading={<AppIcon name="success" state="inverse" />}
                />
              </View>
            ) : null}
          </ScrollView>

          {step === "patient" && isPatientApproveDocked ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.patientApproveFooter,
                { paddingBottom: Math.max(insets.bottom, theme.spacing.md) },
              ]}
            >
              <AppButton
                title="Approve Details"
                onPress={onContinueToDetails}
                fullWidth={true}
                leading={<AppIcon name="success" state="inverse" />}
              />
            </View>
          ) : null}

          {step === "styles" ? (
            <View
              style={[
                styles.stylesActionFooter,
                {
                  paddingBottom: Math.max(insets.bottom, theme.spacing.md),
                  backgroundColor: roles.pageBackground,
                  borderTopColor: roles.defaultCardBorder,
                },
              ]}
            >
              <AppButton
                title="Create Wig Preview"
                disabled={!selectedWig}
                onPress={onStartGeneration}
                fullWidth={true}
                leading={<AppIcon name="sparkle" state="inverse" />}
              />
            </View>
          ) : null}

          {step === "summary" ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.summarySubmitFooter,
                { paddingBottom: Math.max(insets.bottom, theme.spacing.md) },
              ]}
            >
              <AppButton
                title="Submit Wig Request"
                loading={isSavingRequest}
                onPress={onSubmitRequest}
                fullWidth={true}
                leading={<AppIcon name="requests" state="inverse" />}
                style={styles.summarySubmitButton}
              />
            </View>
          ) : null}
        </View>
        <Modal
          transparent
          visible={Boolean(documentPreviewUri)}
          animationType="fade"
          onRequestClose={() => setDocumentPreviewUri("")}
        >
          <View style={styles.documentFullPreviewRoot}>
            <Pressable
              style={styles.documentFullPreviewBackdrop}
              onPress={() => setDocumentPreviewUri("")}
            />
            <View style={styles.documentFullPreviewHeader}>
              <Text style={styles.documentFullPreviewTitle}>
                Medical Certificate
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close medical certificate preview"
                onPress={() => setDocumentPreviewUri("")}
                style={styles.documentFullPreviewClose}
              >
                <MaterialCommunityIcons name="close" size={22} color="#ffffff" />
              </Pressable>
            </View>
            {isPdfDocumentUrl(documentPreviewUri) && Pdf ? (
              <Pdf
                source={{ uri: documentPreviewUri, cache: true }}
                style={styles.documentFullPreviewPdf}
                trustAllCerts={false}
              />
            ) : (
              <Image
                source={{ uri: documentPreviewUri }}
                style={styles.documentFullPreviewImage}
                resizeMode="contain"
              />
            )}
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function PatientWigRequestScreen({ showFlowOnly = false } = {}) {
  const router = useRouter();
  const cameraRef = useRef(null);
  const wigPreviewCaptureRef = useRef(null);
  const hasFocusedRequestTabRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [selectedWigFilterId, setSelectedWigFilterId] = useState("");
  const [isCancelRequestModalOpen, setIsCancelRequestModalOpen] = useState(false);
  const [flowStep, setFlowStep] = useState("patient");
  const [requestMode, setRequestMode] = useState("selected");
  const [photoValidation, setPhotoValidation] = useState(null);
  const [certificateVerification, setCertificateVerification] = useState(null);
  const [isVerifyingCertificate, setIsVerifyingCertificate] = useState(false);
  const [safetyAssessment, setSafetyAssessment] = useState(SAFETY_ASSESSMENT_DEFAULTS);
  const [safetyAssessmentRequestId, setSafetyAssessmentRequestId] = useState(null);
  const [isSavingSafety, setIsSavingSafety] = useState(false);
  const [isSafetyAnswersOpen, setIsSafetyAnswersOpen] = useState(false);
  const [termsDocument, setTermsDocument] = useState(null);
  const [isLoadingTermsDocument, setIsLoadingTermsDocument] = useState(false);
  const [termsDocumentError, setTermsDocumentError] = useState("");
  const { user, profile, patientProfile, resolvedTheme } = useAuth();
  const roles = resolvePatientThemeRoles(resolvedTheme);
  const requestFlowPrimaryTextColor = roles.headingText;
  const requestFlowRoles = {
    ...roles,
    headingText: requestFlowPrimaryTextColor,
    bodyText: requestFlowPrimaryTextColor,
    metaText: requestFlowPrimaryTextColor,
  };
  const dashboardNavItems = showFlowOnly ? [] : patientDashboardNavItems;
  const firstName = String(profile?.first_name || "").trim();
  const lastName = String(profile?.last_name || "").trim();
  const avatarInitials = [firstName?.[0], lastName?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase();
  const greeting = useMemo(getPatientGreeting, []);

  const loadTermsDocument = React.useCallback(async () => {
    setIsLoadingTermsDocument(true);
    setTermsDocumentError("");
    const result = await fetchActiveLegalDocuments();
    setIsLoadingTermsDocument(false);
    const activeDocuments = (result.data || []).filter((document) => document?.legal_document_id);
    const preferredDocumentTypes = new Set([
      "patient_wig_request_terms",
      "wig_request_terms",
      "patient_terms_and_agreement",
      "terms_and_agreement",
      "terms_and_conditions",
      "terms_of_service",
      "terms of service",
      "terms and conditions",
    ]);
    const selectedDocument = activeDocuments.find((document) => (
      preferredDocumentTypes.has(String(document?.document_type || "").trim().toLowerCase())
    )) || activeDocuments[0] || null;

    if (result.error || !selectedDocument) {
      setTermsDocument(null);
      setTermsDocumentError(
        result.error?.message || "No active legal document is available right now.",
      );
      return;
    }
    setTermsDocument(selectedDocument);
  }, []);

  useEffect(() => {
    if (!showFlowOnly || termsDocument || isLoadingTermsDocument || termsDocumentError) return;
    void loadTermsDocument();
  }, [isLoadingTermsDocument, loadTermsDocument, showFlowOnly, termsDocument, termsDocumentError]);
  const { unreadCount } = useNotifications({
    role: "patient",
    userId: user?.id,
    databaseUserId: profile?.user_id,
  });
  const {
    tracker,
    refreshTracking,
  } = useProcessTracking({
    role: "patient",
    userId: user?.id,
    databaseUserId: profile?.user_id,
    enabled: !showFlowOnly,
  });
  const {
    patientDetails,
    latestAllocation,
    latestWigRequest,
    latestWigSpecification,
    requestWig,
    safetyAssessment: savedSafetyAssessment,
    hasSubmittedRequest,
    referenceImage,
    preview,
    error,
    successMessage,
    isLoadingContext,
    hasLoadedContext,
    isGeneratingPreview,
    isSavingRequest,
    isCancellingRequest,
    availableWigs,
    wigPreferenceOptions,
    isLoadingWigPreferenceOptions,
    saveCapturedReferenceImage,
    clearReferenceImage,
    clearPreview,
    generatePreview,
    saveRequest,
    cancelRequest,
    refreshContext,
  } = usePatientWigRequest({ userId: user?.id });

  useFocusEffect(
    React.useCallback(() => {
      if (showFlowOnly || !user?.id) return undefined;

      if (!hasFocusedRequestTabRef.current) {
        hasFocusedRequestTabRef.current = true;
        return undefined;
      }

      void refreshContext();
      void refreshTracking();
      return undefined;
    }, [refreshContext, refreshTracking, showFlowOnly, user?.id]),
  );

  const {
    control,
    handleSubmit,
    setError: setFormError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(wigRequestSchema),
    mode: "onBlur",
    defaultValues: wigRequestDefaultValues,
  });

  const draftValues = useWatch({ control });
  const patientFullName = [
    profile?.first_name,
    profile?.middle_name,
    profile?.last_name,
    profile?.suffix,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const requestPatientDetails = patientDetails || patientProfile || {};
  const requestStatus = formatRequestStatus(
    latestWigRequest?.status || "Pending",
  );
  const requestedWig = latestAllocation?.wigs || requestWig || null;
  const requestedWigSpec = requestedWig?.physical_specification || null;
  const requestedWigCode =
    requestedWig?.wig_code || latestWigRequest?.request_code || "Pending";
  const requestedWigStatus = requestedWig?.wig_status || requestStatus;
  const requestedWigSummary = [
    requestedWigSpec?.style,
    requestedWigSpec?.color ? `${requestedWigSpec.color}` : "",
    requestedWigSpec?.length != null ? `${requestedWigSpec.length} in` : "",
  ]
    .filter(Boolean)
    .join(" • ");
  const medicalCondition = requestPatientDetails?.medical_condition || "";
  const requestCode = latestWigRequest?.request_code || "";
  const cancellationEligibility = getWigRequestCancellationEligibility(latestWigRequest);
  const canCancelLatestRequest = cancellationEligibility.canCancel;
  const hasCameraPermission = Boolean(cameraPermission?.granted);
  const requestedWigCodeValue =
    requestedWig?.wig_code || requestCode || "Pending";
  const requestedWigColorValue = formatPatientFieldValue(
    requestedWigSpec?.color || latestWigSpecification?.preferred_color,
  );
  const requestedWigLengthValue = formatPatientFieldValue(
    requestedWigSpec?.length ?? latestWigSpecification?.preferred_length,
  );
  const requestedWigTextureValue = formatPatientFieldValue(
    requestedWigSpec?.hair_texture || latestWigSpecification?.hair_texture,
  );
  const requestedWigDensityValue = formatPatientFieldValue(
    requestedWigSpec?.hair_density || latestWigSpecification?.hair_density,
  );
  const requestedWigCapSizeValue = formatPatientFieldValue(
    requestedWigSpec?.cap_size || latestWigSpecification?.cap_size,
  );
  const requestedWigStyleValue = formatPatientFieldValue(
    requestedWigSpec?.style || latestWigSpecification?.style_preference,
  );
  const requestedWigId =
    requestedWig?.wig_id
    || latestWigRequest?.requested_wig_id
    || latestAllocation?.wig_id
    || null;
  const requestedCatalogWig = requestedWigId
    ? availableWigs.find((wig) => String(wig?.wig_id || wig?.id || "") === String(requestedWigId)) || null
    : null;
  const requestedWigImageUrl =
    getWigPreviewImageUrl(requestedCatalogWig)
    || getPrimaryTryOnImageUrl(requestedCatalogWig)
    || "";
  const requestedWigDisplayName =
    requestedCatalogWig?.wig_name
    || requestedWig?.wig_name
    || (requestedWigStyleValue !== "Not provided" ? requestedWigStyleValue : "");
  const requestedWigRows = [
    { label: "Style", value: requestedWigStyleValue },
    { label: "Color", value: requestedWigColorValue },
    { label: "Length", value: requestedWigLengthValue },
    { label: "Texture", value: requestedWigTextureValue },
    { label: "Density", value: requestedWigDensityValue },
    { label: "Cap size", value: requestedWigCapSizeValue },
  ];
  void requestedWigCode;
  void requestedWigStatus;
  void requestedWigSummary;
  const availablePreviewWigs = useMemo(
    () =>
      availableWigs.filter((wig) =>
        wig?.is_active !== false &&
        Boolean(getPrimaryTryOnImageUrl(wig) || getWigPreviewImageUrl(wig)),
      ),
    [availableWigs],
  );
  const recommendationOptions = useMemo(
    () =>
      buildRecommendationOptions({
        preview,
        specification: latestWigSpecification,
        draftValues,
      }),
    [draftValues, latestWigSpecification, preview],
  );
  const selectedOption = useMemo(
    () =>
      recommendationOptions.find((option) => option.id === selectedOptionId) ||
      recommendationOptions[0] ||
      null,
    [recommendationOptions, selectedOptionId],
  );
  const generatedImageUri =
    selectedOption?.generatedImageUri ||
    preview?.generated_image_data_url ||
    latestWigSpecification?.ai_wig_preview_url ||
    "";
  const hasGeneratedPreview = Boolean(preview);
  const aiRecommendedWig = useMemo(() => {
    if (!availablePreviewWigs.length) return null;

    return (
      availablePreviewWigs.reduce((best, wig) => {
        const score = scoreWigRecommendation(wig, draftValues);
        if (!best) return { wig, score };
        if (score > best.score) return { wig, score };

        const bestStock = Number(best.wig?.stock_count || 0);
        const wigStock = Number(wig?.stock_count || 0);
        if (score === best.score && wigStock > bestStock) return { wig, score };

        return best;
      }, null)?.wig ||
      availablePreviewWigs[0] ||
      null
    );
  }, [availablePreviewWigs, draftValues]);
  const recommendedPreferenceOptions = useMemo(
    () => ({
      preferredLength: [
        getWigPreferenceValue(aiRecommendedWig, "preferredLength"),
      ].filter(Boolean),
      preferredColor: [
        getWigPreferenceValue(aiRecommendedWig, "preferredColor"),
      ].filter(Boolean),
      hairTexture: [
        getWigPreferenceValue(aiRecommendedWig, "hairTexture"),
      ].filter(Boolean),
      hairDensity: [
        getWigPreferenceValue(aiRecommendedWig, "hairDensity"),
      ].filter(Boolean),
      capSize: [getWigPreferenceValue(aiRecommendedWig, "capSize")].filter(
        Boolean,
      ),
      stylePreference: [
        getWigPreferenceValue(aiRecommendedWig, "stylePreference"),
      ].filter(Boolean),
    }),
    [aiRecommendedWig],
  );
  const selectedWig = useMemo(
    () =>
      availablePreviewWigs.find((wig) => wig.id === selectedWigFilterId) || null,
    [availablePreviewWigs, selectedWigFilterId],
  );
  const selectedRecommendationWig = selectedOption?.selectedWig || null;
  const effectiveSelectedWig = selectedRecommendationWig || selectedWig;
  useEffect(() => {
    setSelectedOptionId(recommendationOptions[0]?.id || "");
  }, [
    latestWigSpecification?.ai_wig_preview_url,
    preview?.generated_image_data_url,
    recommendationOptions,
  ]);

  useEffect(() => {
    if (!availablePreviewWigs.length) {
      setSelectedWigFilterId("");
      return;
    }

    setSelectedWigFilterId((current) => {
      if (current && availablePreviewWigs.some((wig) => wig.id === current))
        return current;
      return "";
    });
  }, [availablePreviewWigs]);

  const handleNavPress = (item) => {
    if (!item.route || item.route === "/patient/requests") return;
    router.navigate(item.route);
  };

  const handleVerifyCertificateAsset = async (asset) => {
    if (!asset?.uri || isVerifyingCertificate) return { success: false };

    setIsVerifyingCertificate(true);
    const result = await verifyMedicalCertificateAsset({
      authUserId: user?.id,
      patientId: requestPatientDetails?.patient_id || null,
      asset,
    });
    setIsVerifyingCertificate(false);

    if (result?.verification) {
      setCertificateVerification(result.verification);
    }

    if (!result?.success) {
      Alert.alert(
        "Certificate needs review",
        result?.error || "Upload a clear medical certificate that shows the doctor's name and PRC/license number.",
      );
      return result;
    }

    await refreshContext();
    Alert.alert(
      "Certificate checked",
      "OCR detected the doctor license details. Staff will still verify the license against PRC records.",
    );
    return result;
  };

  const handleUploadCertificate = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) return { success: false, canceled: true };
    const asset = result.assets?.[0] || null;
    return await handleVerifyCertificateAsset({
      uri: asset?.uri,
      mimeType: asset?.mimeType || "application/pdf",
      fileName: asset?.name || asset?.fileName || "medical-certificate",
    });
  };

  const handleScanCertificate = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera needed", "Allow camera access to scan the medical certificate.");
      return { success: false };
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.86,
      base64: true,
    });

    if (result.canceled) return { success: false, canceled: true };
    const asset = result.assets?.[0] || null;
    return await handleVerifyCertificateAsset({
      uri: asset?.uri,
      mimeType: asset?.mimeType || "image/jpeg",
      fileName: asset?.fileName || "medical-certificate-scan.jpg",
      base64: asset?.base64 || "",
    });
  };

  const generateRecommendationsForPhoto = async (image) => {
    const validation = validateAiTryOnPhoto(image);
    setPhotoValidation(validation);
    if (!validation.valid) return { success: false, error: validation.message };
    if (availablePreviewWigs.length < 3) {
      Alert.alert(
        "Wig Previews Unavailable",
        "There are not enough preview-ready wig styles available right now. Please try again later.",
        [{ text: "Got it" }],
      );
      return {
        success: false,
        title: "Wig Previews Unavailable",
        error: "There are not enough preview-ready wig styles available right now.",
      };
    }

    setFlowStep("generating");
    const generationResult = await generatePreview(draftValues, null, image);
    if (generationResult?.success) {
      setSelectedWigFilterId("");
      setFlowStep("summary");
      return generationResult;
    }

    setFlowStep("photo");
    Alert.alert(
      generationResult?.title || "Preview Could Not Be Created",
      generationResult?.error || "Something interrupted the preview. Your photo is still saved—please try again.",
      [{ text: "Back to Photo" }],
    );
    return generationResult;
  };

  const handleCapturePhoto = async () => {
    if (!cameraPermission?.granted) {
      await requestCameraPermission();
      return;
    }

    if (!cameraRef.current || isCapturingPhoto) return;

    setIsCapturingPhoto(true);

    try {
      const photo =
        typeof cameraRef.current.takePictureAsync === "function"
          ? await cameraRef.current.takePictureAsync({
              quality: 0.86,
              base64: true,
              skipProcessing: false,
            })
          : null;

      const result = await saveCapturedReferenceImage(photo);
      if (result?.image) {
        const validation = validateAiTryOnPhoto(result.image);
        setPhotoValidation(validation);
        return result;
      }
    } catch {
      await saveCapturedReferenceImage(null);
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  const handleContinueToWigs = async () => {
    return await generateRecommendationsForPhoto(referenceImage);
  };

  const handleStartGeneration = handleSubmit(async (values) => {
    const validation = validateAiTryOnPhoto(referenceImage);
    setPhotoValidation(validation);
    if (!validation.valid) return { success: false, error: validation.message };

    if (!selectedWig?.id) {
      Alert.alert("Select a wig", "Choose one wig before creating a preview.");
      return { success: false, error: "Choose one wig before creating a preview." };
    }

    setFlowStep("generating");
    const result = await generatePreview(values, selectedWig);

    if (result?.success) {
      setFlowStep("summary");
      return result;
    }

    setFlowStep("styles");
    Alert.alert(
      "Preview unavailable",
      "We couldn't prepare your wig preview. Please try again or choose another photo.",
    );
    return result;
  });

  const handleTryAnotherWig = () => {
    clearPreview();
    setSelectedOptionId("");
    setFlowStep("styles");
  };

  const handleUploadAnotherPhoto = () => {
    clearPreview();
    clearReferenceImage();
    setSelectedWigFilterId("");
    setSelectedOptionId("");
    setPhotoValidation(null);
    setFlowStep("photo");
  };

  const captureAdjustedWigPreview = async () => {
    if (preview?.render_mode !== "wig_overlay") {
      return generatedImageUri
        ? {
            uri: generatedImageUri,
            mimeType: generatedImageUri.startsWith("data:image/webp")
              ? "image/webp"
              : generatedImageUri.startsWith("data:image/png")
                ? "image/png"
                : "image/jpeg",
          }
        : null;
    }

    if (!wigPreviewCaptureRef.current) {
      throw new Error("The wig preview is not ready to save yet.");
    }

    const captureRef = getViewShotCaptureRef();
    if (typeof captureRef !== "function") {
      throw new Error(
        "Preview capture is not available in this app build. Rebuild the app to enable saving wig previews.",
      );
    }

    const uri = await captureRef(wigPreviewCaptureRef.current, {
      format: "jpg",
      quality: 0.95,
      result: "tmpfile",
    });

    return uri ? { uri, mimeType: "image/jpeg" } : null;
  };

  const handleDownloadImage = async () => {
    if (!generatedImageUri && preview?.render_mode !== "wig_overlay") return;

    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Photo access needed",
          "Allow photo library access to download the wig preview.",
        );
        return;
      }

      const capturedPreview = await captureAdjustedWigPreview();
      const imageToSave = capturedPreview?.uri || generatedImageUri;

      await MediaLibrary.saveToLibraryAsync(imageToSave);
      Alert.alert("Downloaded", "The wig preview was saved.");
    } catch {
      Alert.alert(
        "Download unavailable",
        "The wig preview is visible here, but it could not be saved on this device yet.",
      );
    }
  };

  const handleSaveRequest = handleSubmit(async (values) => {
    if (!values.acceptedTerms) {
      setFormError("acceptedTerms", {
        type: "manual",
        message: "Please accept the request agreement first.",
      });
      return {
        success: false,
        error: "Please accept the request agreement first.",
      };
    }

    const requestedWigId =
      requestMode === "custom" ? null : effectiveSelectedWig?.wig_id || null;
    let capturedPreviewImage = null;
    try {
      capturedPreviewImage = await captureAdjustedWigPreview();
    } catch {
      Alert.alert(
        "Preview not ready",
        "The adjusted wig preview could not be saved yet. Please wait a moment and try again.",
      );
      return { success: false, error: "The adjusted wig preview could not be saved yet." };
    }

    const result = await saveRequest(
      values,
      selectedOptionId,
      requestedWigId,
      capturedPreviewImage,
    );

    if (result?.success) {
      void refreshTracking().catch(() => {});
      const requestId = result?.wigRequest?.req_id || latestWigRequest?.req_id || null;
      setSafetyAssessmentRequestId(requestId);
      setSafetyAssessment(SAFETY_ASSESSMENT_DEFAULTS);
      setFlowStep("safety");
    }

    return result;
  });

  const handleChangeSafety = (field, value) => {
    setSafetyAssessment((current) => ({ ...current, [field]: value }));
  };

  const handleSubmitSafety = async () => {
    const requiredChoices = [
      safetyAssessment.hasKnownAllergies,
      safetyAssessment.hasSensitiveScalp,
      safetyAssessment.hasScalpIrritation,
      safetyAssessment.hasOpenScalpWounds,
      safetyAssessment.hasMedicalRestriction,
    ];
    if (requiredChoices.some((value) => typeof value !== "boolean")) {
      Alert.alert("Complete the assessment", "Please answer every Yes or No safety question.");
      return;
    }
    if (safetyAssessment.hasKnownAllergies && !safetyAssessment.allergyDetails.trim()) {
      Alert.alert("Allergy details required", "Please describe the known allergies.");
      return;
    }
    if (safetyAssessment.hasMedicalRestriction && !safetyAssessment.medicalRestrictionDetails.trim()) {
      Alert.alert("Restriction details required", "Please describe the medical restriction.");
      return;
    }
    if (!safetyAssessment.informationConfirmed) {
      Alert.alert("Confirmation required", "Confirm that the safety information is complete and accurate.");
      return;
    }
    if (!safetyAssessmentRequestId) {
      Alert.alert("Request unavailable", "The submitted wig request could not be linked to this assessment.");
      return;
    }

    setIsSavingSafety(true);
    const result = await upsertPatientWigSafetyAssessment({
      reqId: safetyAssessmentRequestId,
      ...safetyAssessment,
    });
    setIsSavingSafety(false);

    if (result.error) {
      Alert.alert("Unable to save assessment", result.error.message || "Please try again.");
      return;
    }

    await refreshTracking();
    router.replace("/patient/requests");
  };

  const handleCancelLatestRequest = () => {
    const latestEligibility = getWigRequestCancellationEligibility(latestWigRequest);
    if (!latestEligibility.canCancel) {
      Alert.alert(
        "Cancellation unavailable",
        latestEligibility.reason || "This request can no longer be cancelled.",
      );
      return;
    }
    setIsCancelRequestModalOpen(true);
  };

  const handleConfirmCancelLatestRequest = async () => {
    const latestEligibility = getWigRequestCancellationEligibility(latestWigRequest);
    if (!latestEligibility.canCancel) {
      setIsCancelRequestModalOpen(false);
      Alert.alert(
        "Cancellation unavailable",
        latestEligibility.reason || "This request can no longer be cancelled.",
      );
      return;
    }

    const result = await cancelRequest();
    if (!result?.success) {
      Alert.alert(
        "Request not cancelled",
        result?.error || "We could not cancel the request right now. Please try again.",
      );
      return;
    }

    setIsCancelRequestModalOpen(false);
    await refreshTracking();
  };

  const openRequestFlow = () => {
    router.navigate("/patient/request-wig");
  };

  const handleContinueToDetails = handleSubmit(async (values) => {
    if (!values.acceptedTerms) {
      setFormError("acceptedTerms", {
        type: "manual",
        message: "Please accept the patient record consent first.",
      });
      return {
        success: false,
        error: "Please accept the patient record consent first.",
      };
    }

    const verificationStatus = String(
      certificateVerification?.status
      || requestPatientDetails?.medical_document_verification_status
      || "",
    ).toLowerCase();
    const certificateReady = ["ocr_passed_prc_pending", "verified", "prc_verified"].includes(verificationStatus);
    if (!certificateReady) {
      Alert.alert(
        "Certificate validation required",
        "Upload or scan the doctor's medical certificate first. OCR must detect the doctor name, PRC/license number, and diagnosis details before you can request a wig.",
      );
      return {
        success: false,
        error: "Certificate validation is required.",
      };
    }

    setRequestMode(availablePreviewWigs.length ? "selected" : "custom");
    setFlowStep(availablePreviewWigs.length ? "photo" : "customSpec");
    return { success: true };
  });

  const handleRequestOwnWig = () => {
    setRequestMode("custom");
    setFlowStep("customSpec");
  };

  return (
    <DashboardLayout
      navItems={dashboardNavItems}
      activeNavKey="requests"
      navVariant="patient"
      onNavPress={handleNavPress}
      floatingOverlay={!showFlowOnly && canCancelLatestRequest ? (
        <View pointerEvents="box-none" style={styles.cancelRequestFloatingHost}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel wig request"
            disabled={isCancellingRequest}
            onPress={handleCancelLatestRequest}
            style={({ pressed }) => [
              styles.cancelRequestFloatingButton,
              pressed && !isCancellingRequest ? styles.cancelRequestFloatingButtonPressed : null,
            ]}
          >
            <LinearGradient
              colors={[theme.colors.actionDanger, theme.colors.actionDangerPressed]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cancelRequestFloatingContent}
            >
              <View style={styles.cancelRequestFloatingInner}>
                <View style={styles.cancelRequestFloatingIcon}>
                  {isCancellingRequest ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <MaterialCommunityIcons name="close" size={18} color="#FFFFFF" />
                  )}
                </View>
                <View style={styles.cancelRequestFloatingCopy}>
                  <Text style={styles.cancelRequestFloatingTitle}>{isCancellingRequest ? "Cancelling..." : "Cancel request"}</Text>
                  <Text style={styles.cancelRequestFloatingHint}>Available for {cancellationEligibility.daysRemaining} {cancellationEligibility.daysRemaining === 1 ? "day" : "days"}</Text>
                </View>
              </View>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}
      header={
        showFlowOnly ? null : (
          <DashboardHeaderSurface>
            <DonorTopBar
              title={greeting}
              subtitle={`${firstName || "Patient"} | Wig Recipient`}
              avatarInitials={avatarInitials}
              avatarUri={profile?.avatar_url || profile?.photo_path || ""}
              unreadCount={unreadCount}
              onNotificationsPress={() =>
                router.navigate("/patient/notifications")
              }
              onProfilePress={() => router.navigate("/profile")}
            />
          </DashboardHeaderSurface>
        )
      }
    >
      {!showFlowOnly ? (
        <>
          {isLoadingContext ? (
            <StatusBanner
              title="Checking request"
              message="Loading details."
              variant="info"
              presentation="floating"
              visible={isLoadingContext}
              autoDismissMs={1800}
            />
          ) : null}

          {error ? (
            <StatusBanner
              message={error.message}
              variant="error"
              title={error.title}
              presentation="floating"
              visible={Boolean(error)}
              autoDismissMs={4000}
            />
          ) : null}

          {successMessage ? (
            <StatusBanner
              message={successMessage}
              variant="success"
              title="Request updated"
              presentation="floating"
              visible={Boolean(successMessage)}
              autoDismissMs={3000}
            />
          ) : null}
        </>
      ) : null}

      {!showFlowOnly ? (
        <>
          <View style={[
            styles.simpleWigSection,
            canCancelLatestRequest ? styles.simpleWigSectionWithFloatingCancel : null,
            !hasSubmittedRequest && hasLoadedContext && !isLoadingContext ? styles.simpleWigSectionEmpty : null,
          ]}>
            <View style={[
              styles.requestedWigSummaryCard,
              hasSubmittedRequest ? styles.requestedWigSummaryActive : null,
              !hasSubmittedRequest && hasLoadedContext && !isLoadingContext ? styles.requestedWigSummaryPlain : null,
            ]}>
              {hasSubmittedRequest ? (
                <>
                  <WigJourneyTimeline tracker={tracker} roles={roles} />

                  <View style={styles.requestQuickActions}>
                    <InlineWigDetails
                      rows={requestedWigRows}
                      code={requestedWigCodeValue}
                      imageUrl={requestedWigImageUrl}
                      selectedStyle={requestedWigDisplayName}
                      roles={roles}
                    />

                    {savedSafetyAssessment ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="View safety information"
                        onPress={() => setIsSafetyAnswersOpen(true)}
                        style={({ pressed }) => [
                          styles.requestQuickAction,
                          {
                            backgroundColor: roles.defaultCardBackground,
                            borderColor: roles.defaultCardBorder,
                          },
                          pressed ? styles.preferencePressed : null,
                        ]}
                      >
                        <LinearGradient
                          colors={[roles.defaultCardBackground, roles.supportCardBackground]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.requestQuickActionRow}
                        >
                          <LinearGradient
                            colors={[theme.colors.palette.wine600, theme.colors.palette.wine900]}
                            style={styles.requestQuickActionIcon}
                          >
                            <MaterialCommunityIcons name="shield-check-outline" size={21} color="#FFFFFF" />
                          </LinearGradient>
                          <View style={styles.requestQuickActionCopy}>
                            <Text style={[styles.requestQuickActionTitle, { color: roles.headingText }]}>Safety information</Text>
                            <Text numberOfLines={1} style={[styles.requestQuickActionHint, { color: roles.metaText }]}>Health and comfort answers</Text>
                          </View>
                          <View style={[styles.requestQuickActionArrow, { backgroundColor: roles.iconPrimarySurface }]}>
                            <MaterialCommunityIcons name="chevron-right" size={20} color={roles.iconPrimaryColor} />
                          </View>
                        </LinearGradient>
                      </Pressable>
                    ) : null}
                  </View>
                </>
              ) : isLoadingContext || !hasLoadedContext ? (
                <View
                  style={[
                    styles.wigRequestCheckingCard,
                    {
                      backgroundColor: roles.defaultCardBackground,
                      borderColor: roles.defaultCardBorder,
                    },
                  ]}
                >
                  <View style={[styles.wigRequestCheckingIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                    <ActivityIndicator color={roles.primaryActionBackground} />
                  </View>
                  <View style={styles.wigRequestCheckingCopy}>
                    <Text style={[styles.wigRequestCheckingTitle, { color: requestFlowPrimaryTextColor }]}>Checking your wig request</Text>
                    <Text style={[styles.wigRequestCheckingText, { color: roles.bodyText }]}>Loading your latest request and progress.</Text>
                  </View>
                </View>
              ) : (
                <LinearGradient
                  colors={[
                    roles.defaultCardBackground,
                    roles.supportCardBackground,
                  ]}
                  start={{ x: 0.05, y: 0 }}
                  end={{ x: 0.95, y: 1 }}
                  style={[
                    styles.wigRequestEmptyCard,
                    { borderColor: roles.defaultCardBorder },
                  ]}
                >
                  <View style={styles.wigRequestArtwork}>
                    <View
                      style={[
                        styles.wigRequestArtworkRing,
                        { borderColor: roles.defaultCardBorder },
                      ]}
                    />
                    <View
                      style={[
                        styles.wigRequestArtworkIcon,
                        { backgroundColor: roles.iconPrimarySurface },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="account-heart-outline"
                        size={38}
                        color={roles.primaryActionBackground}
                      />
                    </View>
                    <View
                      style={[
                        styles.wigRequestArtworkAccent,
                        { backgroundColor: roles.primaryActionBackground },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="creation"
                        size={13}
                        color={roles.primaryActionText}
                      />
                    </View>
                  </View>

                  <View style={styles.wigRequestEmptyCopy}>
                    <Text
                      style={[
                        styles.wigRequestEyebrow,
                        { color: roles.primaryActionBackground },
                      ]}
                    >
                      YOUR WIG REQUEST
                    </Text>
                    <Text
                      style={[
                        styles.wigRequestEmptyTitle,
                        { color: requestFlowPrimaryTextColor },
                      ]}
                    >
                      Find a wig made for you
                    </Text>
                    <Text
                      style={[
                        styles.wigRequestEmptyMessage,
                        { color: roles.bodyText },
                      ]}
                    >
                      Tell us your preferences and we will guide you through
                      matching, review, and release updates.
                    </Text>
                  </View>

                  <View style={styles.wigRequestGuideRow}>
                    {wigRequestGuideSteps.map((step, index) => (
                      <React.Fragment key={step.key}>
                        <View style={styles.wigRequestGuideStep}>
                          <View
                            style={[
                              styles.wigRequestGuideIcon,
                              { backgroundColor: roles.iconPrimarySurface },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name={step.icon}
                              size={18}
                              color={roles.primaryActionBackground}
                            />
                          </View>
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.wigRequestGuideLabel,
                              { color: roles.bodyText },
                            ]}
                          >
                            {step.label}
                          </Text>
                        </View>
                        {index < wigRequestGuideSteps.length - 1 ? (
                          <MaterialCommunityIcons
                            name="chevron-right"
                            size={16}
                            color={roles.metaText}
                          />
                        ) : null}
                      </React.Fragment>
                    ))}
                  </View>

                  <AppButton
                    title="Start wig request"
                    onPress={openRequestFlow}
                    leading={<AppIcon name="requests" state="inverse" />}
                    trailing={
                      <MaterialCommunityIcons
                        name="arrow-right"
                        size={20}
                        color={roles.primaryActionText}
                      />
                    }
                    style={styles.wigRequestPrimaryAction}
                  />

                  <View style={styles.wigRequestPrivacyNote}>
                    <MaterialCommunityIcons
                      name="shield-check-outline"
                      size={17}
                      color={roles.primaryActionBackground}
                    />
                    <Text
                      style={[
                        styles.wigRequestPrivacyText,
                        { color: roles.metaText },
                      ]}
                    >
                      Your medical information is handled securely.
                    </Text>
                  </View>
                </LinearGradient>
              )}
            </View>
          </View>

        </>
      ) : null}

      <RequestFlowModal
        visible={showFlowOnly}
        step={flowStep}
        control={control}
        errors={errors}
        patientName={patientFullName}
        patientDetails={requestPatientDetails}
        medicalCondition={medicalCondition}
        availableWigs={availablePreviewWigs}
        referenceImage={referenceImage}
        selectedWig={effectiveSelectedWig}
        recommendedPreferenceOptions={recommendedPreferenceOptions}
        recommendationOptions={recommendationOptions}
        selectedOptionId={selectedOptionId}
        onSelectOption={setSelectedOptionId}
        wigPreferenceOptions={wigPreferenceOptions}
        isLoadingWigPreferenceOptions={isLoadingWigPreferenceOptions}
        generatedImageUri={generatedImageUri}
        preview={preview}
        hasGeneratedPreview={hasGeneratedPreview}
        isGeneratingPreview={isGeneratingPreview}
        isSavingRequest={isSavingRequest}
        isCapturingPhoto={isCapturingPhoto}
        certificateVerification={certificateVerification}
        isVerifyingCertificate={isVerifyingCertificate}
        termsDocument={termsDocument}
        isLoadingTermsDocument={isLoadingTermsDocument}
        termsDocumentError={termsDocumentError}
        onRetryTermsDocument={loadTermsDocument}
        photoValidation={photoValidation}
        hasCameraPermission={hasCameraPermission}
        cameraRef={cameraRef}
        onClose={() => router.back()}
        onContinueToDetails={handleContinueToDetails}
        onCapturePhoto={handleCapturePhoto}
        onUploadCertificate={handleUploadCertificate}
        onScanCertificate={handleScanCertificate}
        onRequestCameraPermission={requestCameraPermission}
        onContinueToWigs={handleContinueToWigs}
        onStartGeneration={handleStartGeneration}
        onTryAnotherWig={handleTryAnotherWig}
        onUploadAnotherPhoto={handleUploadAnotherPhoto}
        onDownloadImage={handleDownloadImage}
        previewCaptureRef={wigPreviewCaptureRef}
        onSubmitRequest={handleSaveRequest}
        onSelectWig={setSelectedWigFilterId}
        onRequestOwnWig={handleRequestOwnWig}
        safetyAssessment={safetyAssessment}
        isSavingSafety={isSavingSafety}
        onChangeSafety={handleChangeSafety}
        onSubmitSafety={handleSubmitSafety}
        roles={requestFlowRoles}
      />
      <SafetyAssessmentAnswersModal
        visible={isSafetyAnswersOpen}
        assessment={savedSafetyAssessment}
        onClose={() => setIsSafetyAnswersOpen(false)}
        roles={roles}
        resolvedTheme={resolvedTheme}
      />
      <CancelWigRequestModal
        visible={isCancelRequestModalOpen}
        requestCode={requestedWigCodeValue}
        daysRemaining={cancellationEligibility.daysRemaining}
        isCancelling={isCancellingRequest}
        onClose={() => setIsCancelRequestModalOpen(false)}
        onConfirm={handleConfirmCancelLatestRequest}
        roles={roles}
      />
    </DashboardLayout>
  );
}

const styles = StyleSheet.create({
  wigIntroSection: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  wigIntroTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleMd,
    lineHeight:
      theme.typography.semantic.titleMd * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  wigIntroBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight:
      theme.typography.semantic.body * theme.typography.lineHeights.relaxed,
  },
  simpleWigSection: {
    width: "100%",
    gap: theme.spacing.sm,
    paddingHorizontal: 0,
    paddingTop: theme.spacing.md,
    paddingBottom: 0,
  },
  simpleWigSectionEmpty: {
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  simpleWigSectionWithFloatingCancel: {
    paddingBottom: 78,
  },
  requestedWigSummaryCard: {
    width: "100%",
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  requestedWigSummaryPlain: {
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: theme.spacing.xs,
    alignItems: "center",
  },
  wigRequestCheckingCard: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  requestedWigSummaryActive: {
    borderWidth: 0,
    borderRadius: 0,
    padding: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  wigJourneyAnimatedHost: {
    width: "100%",
  },
  wigJourneyCard: {
    position: "relative",
    overflow: "hidden",
    minHeight: 236,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 24,
    padding: theme.spacing.md,
    ...theme.shadows.card,
  },
  wigJourneyShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(23,17,20,0.08)",
  },
  wigJourneyGlow: {
    position: "absolute",
    width: 156,
    height: 156,
    top: -98,
    right: -44,
    borderRadius: 78,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  wigJourneyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  wigJourneyHeaderIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  wigJourneyHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  wigJourneyHeaderEyebrow: {
    color: "rgba(255,255,255,0.76)",
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
  },
  wigJourneyHeaderTitle: {
    color: "#FFFFFF",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    lineHeight: 21,
    fontWeight: theme.typography.weights.bold,
  },
  wigJourneyTopIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  wigJourneyHeadingCopy: {
    gap: 3,
  },
  wigJourneyEyebrow: {
    color: "rgba(255,255,255,0.74)",
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
    opacity: 0.78,
  },
  wigJourneyTitle: {
    color: "#FFFFFF",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight: 27,
    fontWeight: theme.typography.weights.bold,
  },
  wigJourneyReference: {
    color: "rgba(255,255,255,0.78)",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 15,
    opacity: 0.76,
  },
  wigJourneyTimelineContent: {
    minWidth: "100%",
    paddingTop: theme.spacing.xs,
    paddingBottom: 2,
    paddingHorizontal: 2,
  },
  wigJourneyStage: {
    position: "relative",
    width: 84,
    alignItems: "center",
    gap: 7,
  },
  wigJourneyStageMarker: {
    zIndex: 2,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 17,
  },
  wigJourneyConnector: {
    position: "absolute",
    zIndex: 1,
    top: 16,
    left: -25,
    width: 50,
    height: 3,
    borderRadius: theme.radius.full,
  },
  wigJourneyStageLabel: {
    width: 78,
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: theme.typography.weights.semibold,
    textAlign: "center",
  },
  inlineWigDetailsSection: {
    width: "100%",
    gap: theme.spacing.md,
    paddingHorizontal: 2,
    paddingVertical: theme.spacing.xs,
  },
  inlineWigDetailsHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  inlineWigDetailsIcon: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
  },
  inlineWigDetailsHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  inlineWigDetailsTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  inlineWigDetailsHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 15,
  },
  inlineWigCodePill: {
    maxWidth: 104,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
  },
  inlineWigCodeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  inlineWigSelection: {
    minHeight: 100,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  inlineWigSelectionImage: {
    width: 82,
    height: 82,
    flexShrink: 0,
    borderRadius: 14,
    backgroundColor: theme.colors.backgroundMuted,
  },
  inlineWigSelectionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  inlineWigSelectionLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.8,
  },
  inlineWigSelectionName: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 20,
  },
  inlineWigSelectionHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 15,
  },
  inlineWigDetailsDivider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
  },
  inlineWigDetailsList: {
    width: "100%",
  },
  inlineWigDetailRow: {
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  inlineWigDetailLabel: {
    width: "38%",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  inlineWigDetailValue: {
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 18,
    fontWeight: theme.typography.weights.semibold,
  },
  inlineWigDetailDivider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
  },
  requestQuickActions: {
    width: "100%",
    gap: theme.spacing.sm,
  },
  requestQuickAction: {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 22,
    padding: 0,
    ...theme.shadows.soft,
  },
  requestQuickActionRow: {
    width: "100%",
    minHeight: 74,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: 21,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  requestQuickActionIcon: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
  },
  requestQuickActionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  requestQuickActionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  requestQuickActionHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 15,
  },
  requestQuickActionArrow: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  cancelRequestFloatingHost: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 112,
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    zIndex: 40,
  },
  cancelRequestFloatingButton: {
    width: "100%",
    maxWidth: 230,
    borderRadius: 31,
    overflow: "hidden",
    shadowColor: theme.colors.palette.wine900,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 12,
  },
  cancelRequestFloatingContent: {
    width: "100%",
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    borderRadius: 31,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 9,
  },
  cancelRequestFloatingInner: {
    width: "100%",
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  cancelRequestFloatingButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.97 }],
  },
  cancelRequestFloatingIcon: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  cancelRequestFloatingCopy: {
    width: "100%",
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingHorizontal: 38,
  },
  cancelRequestFloatingTitle: {
    color: "#FFFFFF",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    textAlign: "center",
  },
  cancelRequestFloatingHint: {
    color: "rgba(255,255,255,0.82)",
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 13,
    textAlign: "center",
  },
  cancelRequestModalRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
  },
  cancelRequestModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.overlay,
  },
  cancelRequestModalCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: 26,
    padding: theme.spacing.lg,
    ...theme.shadows.lg,
  },
  cancelRequestModalIcon: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "rgba(186,31,51,0.1)",
  },
  cancelRequestModalCopy: {
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  cancelRequestModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: "center",
  },
  cancelRequestModalText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 19,
    textAlign: "center",
  },
  cancelRequestPolicyCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 16,
    padding: theme.spacing.sm,
  },
  cancelRequestPolicyCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cancelRequestPolicyTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  cancelRequestPolicyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  cancelRequestCode: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    textAlign: "center",
  },
  cancelRequestModalActions: {
    width: "100%",
    gap: theme.spacing.sm,
  },
  cancelRequestKeepButton: {
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    ...theme.shadows.sm,
  },
  cancelRequestKeepText: {
    color: "#FFFFFF",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  cancelRequestConfirmButton: {
    width: "100%",
    borderRadius: 18,
    overflow: "hidden",
    ...theme.shadows.sm,
  },
  cancelRequestActionGradient: {
    minHeight: 50,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 18,
    paddingHorizontal: theme.spacing.sm,
  },
  cancelRequestActionPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },
  cancelRequestConfirmText: {
    color: "#FFFFFF",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  wigRequestCheckingIcon: {
    width: 48,
    height: 48,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  wigRequestCheckingCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  wigRequestCheckingTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  wigRequestCheckingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  wigRequestEmptyCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 24,
    padding: theme.spacing.lg,
    alignItems: "center",
    gap: theme.spacing.md,
    overflow: "hidden",
    ...theme.shadows.soft,
  },
  wigRequestArtwork: {
    width: 92,
    height: 92,
    alignItems: "center",
    justifyContent: "center",
  },
  wigRequestArtworkRing: {
    position: "absolute",
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1,
    borderStyle: "dashed",
    opacity: 0.85,
  },
  wigRequestArtworkIcon: {
    width: 66,
    height: 66,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  wigRequestArtworkAccent: {
    position: "absolute",
    right: 1,
    top: 5,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  wigRequestEmptyCopy: {
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  wigRequestEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1.1,
  },
  wigRequestEmptyTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight:
      theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
    textAlign: "center",
  },
  wigRequestEmptyMessage: {
    maxWidth: 300,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: 19,
    textAlign: "center",
  },
  wigRequestGuideRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  wigRequestGuideStep: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 6,
  },
  wigRequestGuideIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  wigRequestGuideLabel: {
    minHeight: 27,
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: theme.typography.weights.semibold,
    textAlign: "center",
  },
  wigRequestPrimaryAction: {
    borderRadius: 17,
  },
  wigRequestPrivacyNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: theme.spacing.sm,
  },
  wigRequestPrivacyText: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight:
      theme.typography.semantic.caption * theme.typography.lineHeights.normal,
    textAlign: "center",
  },
  simpleRecordHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  simpleRecordHeaderEmpty: {
    flexDirection: "column",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  aiTabIcon: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  aiTabTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  aiTabBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight:
      theme.typography.semantic.body * theme.typography.lineHeights.relaxed,
  },
  currentRequestCard: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 20,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  currentRequestHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  currentRequestHeaderText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  currentRequestBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  currentRequestIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  currentRequestCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  timelineIconButton: {
    alignSelf: "flex-start",
    width: 40,
    height: 40,
    borderRadius: theme.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  currentRequestLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  currentRequestTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  currentRequestActions: {
    marginTop: theme.spacing.xs,
  },
  requestChoiceGrid: {
    gap: theme.spacing.lg,
  },
  referralCard: {
    overflow: "hidden",
  },
  referralCardHeader: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  referralCardHeaderText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  referralCardBody: {
    gap: theme.spacing.lg,
    padding: theme.spacing.lg,
  },
  referralIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  requestedWigIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  referralIdentityCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  referralIdentityCopyEmpty: {
    flex: 0,
    alignItems: "center",
  },
  referralHospitalName: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyMd,
    fontWeight: theme.typography.weights.bold,
  },
  referralHospitalNameEmpty: {
    textAlign: "center",
  },
  recordDetailSection: {
    paddingTop: 0,
  },
  requestFlowCopy: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight:
      theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  requestFlowCopyEmpty: {
    maxWidth: 260,
    textAlign: "center",
  },
  requestedWigStatusRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing.sm,
  },
  requestedWigStatusPill: {
    flex: 1,
    minWidth: 0,
    minHeight: 68,
    justifyContent: "center",
    gap: 3,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  requestedWigStatusLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0.25,
  },
  requestedWigStatusValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
    lineHeight: 18,
  },
  requestedWigSectionHeading: {
    gap: 2,
    paddingTop: theme.spacing.xs,
  },
  requestedWigSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  currentRequestHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  requestedWigSectionHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  viewSafetyAssessmentAction: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 16,
    padding: theme.spacing.sm,
  },
  viewSafetyAssessmentIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  viewSafetyAssessmentCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  viewSafetyAssessmentText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  viewSafetyAssessmentHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 15,
  },
  requestedWigPendingNote: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surfaceSoft,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  requestedWigPendingText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight:
      theme.typography.compact.bodySm * theme.typography.lineHeights.normal,
  },
  requestedWigEmptyLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  requestedWigEmptyText: {
    flexShrink: 1,
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight:
      theme.typography.compact.bodySm * theme.typography.lineHeights.normal,
  },
  manualRequestCard: {
    gap: theme.spacing.md,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
  },
  manualRequestIcon: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  manualRequestTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  manualRequestBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  manualActionColumn: {
    gap: theme.spacing.sm,
  },
  intakeCard: {
    gap: theme.spacing.sm,
  },
  intakeEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  intakeTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
  },
  intakeBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  previewGrid: {
    gap: theme.spacing.xs,
  },
  previewRow: {
    paddingVertical: theme.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderMuted,
  },
  previewLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  previewValue: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.normal,
    color: theme.colors.textPrimary,
  },
  actionRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  singleActionRow: {
    width: "100%",
    marginTop: theme.spacing.xs,
  },
  actionButton: {
    flex: 1,
  },
  preferencesFlow: {
    gap: theme.spacing.xl,
  },
  preferencesHeaderBlock: {
    alignItems: "flex-start",
    gap: theme.spacing.xs,
  },
  preferencesTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight:
      theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  preferencesBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    lineHeight:
      theme.typography.semantic.body * theme.typography.lineHeights.relaxed,
  },
  fitPanel: {
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderMuted,
  },
  fitNoticeIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  fitNoticeCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  fitNoticeTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  fitNoticeBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
  },
  fitInlineNotice: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  fitInlineNoticeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  preferenceSection: {
    gap: theme.spacing.sm,
  },
  preferenceSectionHeader: {
    gap: 2,
  },
  preferenceSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  preferenceSectionHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  preferenceLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  preferenceChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  preferenceChip: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    justifyContent: "center",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  preferenceChipRecommended: {
    backgroundColor: "transparent",
  },
  aiChipBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    borderWidth: 1,
  },
  aiChipBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  preferencePressed: {
    opacity: 0.84,
    transform: [{ scale: 0.98 }],
  },
  preferenceChipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  preferenceChipTextSelected: {
    fontWeight: theme.typography.weights.bold,
  },
  preferenceSelectedText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  styleSelectionGrid: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  styleOption: {
    flex: 1,
    minHeight: 104,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
  },
  styleOptionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  colorPaletteCard: {
    gap: theme.spacing.sm,
    borderRadius: 6,
    borderWidth: 1,
    padding: theme.spacing.sm,
  },
  colorSwatchGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  colorSwatchButton: {
    position: "relative",
    width: 76,
    minHeight: 76,
    gap: theme.spacing.xs,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xs,
  },
  colorAiBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  colorSwatch: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  colorSelectedText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  colorSwatchLabel: {
    maxWidth: "100%",
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  preferenceHelperText: {
    marginTop: -theme.spacing.sm,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontStyle: "italic",
  },
  preferenceChoiceGrid: {
    gap: theme.spacing.sm,
  },
  preferenceChoiceCard: {
    gap: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  preferenceChoiceHeader: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  preferenceChoiceTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  preferenceChoiceBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  matcherFlow: {
    gap: theme.spacing.lg,
  },
  matcherHeroHeader: {
    position: "relative",
    overflow: "hidden",
    gap: theme.spacing.xs,
    minHeight: 156,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    ...theme.shadows.card,
  },
  matcherHeroGlow: {
    position: "absolute",
    width: 150,
    height: 150,
    right: -42,
    top: -82,
    borderRadius: 75,
    backgroundColor: "rgba(255,255,255,0.11)",
  },
  matcherHeroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  matcherHeroIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
  },
  matcherCountPill: {
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  matcherCountText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.45,
    color: theme.colors.palette.wine800,
  },
  matcherHeroTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight:
      theme.typography.semantic.titleSm * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
  },
  matcherHeroBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textHeroSoft,
  },
  matcherSkeletonCard: {
    gap: theme.spacing.xl,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: theme.spacing.lg,
  },
  matcherLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  matcherLoadingDot: {
    width: 14,
    height: 14,
    borderRadius: theme.radius.full,
  },
  matcherLoadingText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  matcherSkeletonGrid: {
    gap: theme.spacing.md,
  },
  matcherSkeletonMain: {
    gap: theme.spacing.md,
  },
  matcherSkeletonSide: {
    gap: theme.spacing.sm,
  },
  matcherSkeletonBlock: {
    backgroundColor: theme.colors.borderSubtle,
    opacity: 0.72,
  },
  matcherSkeletonHero: {
    height: 180,
    borderRadius: theme.radius.md,
  },
  matcherSkeletonPills: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  matcherSkeletonPillWide: {
    width: "40%",
    height: 22,
    borderRadius: theme.radius.full,
  },
  matcherSkeletonPill: {
    width: "28%",
    height: 22,
    borderRadius: theme.radius.full,
  },
  matcherSkeletonLine: {
    height: 44,
    borderRadius: theme.radius.md,
  },
  matcherRecommendationsSection: {
    gap: theme.spacing.lg,
  },
  matcherSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  matcherSectionTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
  },
  matcherCardsGrid: {
    gap: theme.spacing.lg,
  },
  matcherCard: {
    position: "relative",
    overflow: "hidden",
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    ...theme.shadows.card,
  },
  matcherBadge: {
    position: "absolute",
    top: theme.spacing.md,
    right: theme.spacing.md,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    backgroundColor: theme.colors.brandPrimary,
  },
  matcherBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  matcherImageWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: 0.95,
  },
  matcherImage: {
    width: "100%",
    height: "100%",
  },
  matcherWigOverlay: {
    position: "absolute",
  },
  matcherImagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  matcherImageShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "35%",
  },
  matcherRankBadge: {
    position: "absolute",
    top: theme.spacing.md,
    left: theme.spacing.md,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "rgba(255,255,255,0.94)",
    ...theme.shadows.soft,
  },
  matcherRankText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.55,
    color: theme.colors.palette.wine800,
  },
  matcherSelectedBadge: {
    position: "absolute",
    top: theme.spacing.md,
    right: theme.spacing.md,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "rgba(104,26,46,0.94)",
    ...theme.shadows.soft,
  },
  matcherSelectedBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
  },
  matcherCardBody: {
    gap: theme.spacing.xs,
    padding: theme.spacing.lg,
  },
  matcherCardTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  matcherCardMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  matcherCardFooter: {
    marginTop: theme.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  matcherCardPrice: {
    flex: 1,
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  matcherFavoriteButton: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  matcherSelectedCard: {
    gap: theme.spacing.sm,
  },
  matcherSelectedTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  matcherSelectedMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  matcherSelectedSummary: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  agreementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  checkBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.backgroundPrimary,
  },
  checkBoxActive: {
    backgroundColor: theme.colors.brandPrimary,
    borderColor: theme.colors.brandPrimary,
  },
  agreementText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textPrimary,
  },
  fieldError: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textError,
  },
  optionsSectionCard: {
    backgroundColor: theme.colors.backgroundPrimary,
    borderColor: theme.colors.borderMuted,
  },
  optionsSectionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.md,
  },
  optionsSectionFooter: {
    marginTop: theme.spacing.md,
  },
  sliderOptionsRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.xs,
  },
  resultCard: {
    backgroundColor: theme.colors.backgroundPrimary,
    borderColor: theme.colors.borderMuted,
  },
  resultHeader: {
    marginBottom: theme.spacing.md,
    alignItems: "center",
  },
  resultHeaderTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
  },
  resultHero: {
    alignItems: "center",
    marginBottom: theme.spacing.md,
  },
  resultBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceSoft,
    marginBottom: theme.spacing.md,
  },
  resultBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  resultCircleWrap: {
    marginBottom: theme.spacing.md,
  },
  resultCircleOuter: {
    width: 224,
    height: 224,
    borderRadius: 112,
    padding: 8,
    backgroundColor: "#e4efff",
    borderWidth: 2,
    borderColor: "#87b7ff",
    ...theme.shadows.soft,
  },
  resultCircleInner: {
    width: "100%",
    height: "100%",
    borderRadius: 104,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceSoft,
  },
  resultHeroImage: {
    width: "100%",
    height: "100%",
  },
  resultHeroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  resultStyleTitle: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  resultStyleFamily: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    marginBottom: theme.spacing.xs,
  },
  resultSummary: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  resultMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  metaPill: {
    minWidth: "30%",
    flexGrow: 1,
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSoft,
  },
  metaLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: theme.colors.textMuted,
  },
  metaValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  availableWrap: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  availableTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  optionsRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  optionCard: {
    width: 136,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  optionCardPressed: {
    transform: [{ scale: 0.98 }],
  },
  optionCardActive: {
    borderColor: "#87b7ff",
    backgroundColor: "#f4f8ff",
  },
  optionImageWrap: {
    height: 92,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceSoft,
    marginBottom: theme.spacing.sm,
  },
  optionImage: {
    width: "100%",
    height: "100%",
  },
  optionImagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  optionName: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  optionMatch: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    marginBottom: 4,
  },
  optionNote: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: 11,
    lineHeight: 15,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  tryOnButton: {
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  tryOnButtonActive: {
    backgroundColor: "#4f8fe8",
    borderColor: "#4f8fe8",
  },
  tryOnButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  tryOnButtonTextActive: {
    color: theme.colors.textInverse,
  },
  resultActionColumn: {
    gap: theme.spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.overlay,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    width: "100%",
    alignSelf: "center",
    maxWidth: theme.layout.contentMaxWidth,
  },
  calibrationCard: {
    width: "100%",
    alignSelf: "center",
    maxWidth: 420,
    gap: theme.spacing.md,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.backgroundPrimary,
    ...theme.shadows.lg,
  },
  calibrationHeader: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  calibrationTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  calibrationControl: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  calibrationControlHeader: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  calibrationControlLabel: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  calibrationValue: {
    minWidth: 58,
    textAlign: "right",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  calibrationSliderTouchArea: {
    minHeight: 34,
    justifyContent: "center",
  },
  calibrationSliderTrack: {
    position: "relative",
    height: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceDisabled,
  },
  calibrationSliderFill: {
    height: "100%",
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brandPrimary,
  },
  calibrationSliderThumb: {
    position: "absolute",
    top: -8,
    width: 24,
    height: 24,
    marginLeft: -12,
    borderRadius: theme.radius.full,
    borderWidth: 3,
    borderColor: theme.colors.backgroundPrimary,
    backgroundColor: theme.colors.brandPrimary,
    ...theme.shadows.soft,
  },
  calibrationActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  captureFullScreen: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    maxWidth: theme.layout.contentMaxWidth,
    backgroundColor: theme.colors.backgroundCanvas,
  },
  captureHeaderBar: {
    width: "100%",
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.14)",
  },
  captureHeaderRow: {
    position: "relative",
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  captureHeaderButton: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  captureHeaderTitle: {
    position: "absolute",
    left: 84,
    right: 84,
    textAlign: "center",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight:
      theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  captureHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginLeft: "auto",
  },
  captureScroll: {
    flex: 1,
  },
  captureScrollContent: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  flowKeyboardWrap: {
    flex: 1,
  },
  flowFullScreen: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    maxWidth: theme.layout.contentMaxWidth,
  },
  flowTopBar: {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    paddingHorizontal: theme.spacing.md,
    minHeight: 68,
    paddingVertical: 0,
    marginBottom: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  flowTopBarGlow: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    right: -38,
    top: -76,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  requestFlowHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  requestFlowBackButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  requestFlowHeaderTitle: {
    flex: 1,
    textAlign: "center",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    lineHeight:
      theme.typography.semantic.body * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
  },
  requestFlowHeaderSpacer: {
    width: 40,
    height: 40,
  },
  flowScroll: {
    flex: 1,
  },
  flowScrollContent: {
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xxl,
    paddingTop: theme.spacing.md,
  },
  flowSection: {
    gap: theme.spacing.md,
  },
  patientIdentityStickyHost: {
    zIndex: 12,
    width: "100%",
    paddingHorizontal: theme.spacing.xxl,
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.sm,
  },
  confirmDetailsHero: {
    position: "relative",
    overflow: "hidden",
    minHeight: 132,
    gap: theme.spacing.sm,
    borderRadius: 24,
    padding: theme.spacing.lg,
    ...theme.shadows.card,
  },
  confirmDetailsGlow: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    right: -46,
    top: -70,
    backgroundColor: "rgba(255,255,255,0.11)",
  },
  patientRecordPill: {
    alignSelf: "flex-start",
    minHeight: 27,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.26)",
  },
  confirmDetailsEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.8,
    color: "#FFFFFF",
  },
  flowTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight:
      theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  requestFlowSectionHeader: {
    gap: theme.spacing.xs,
  },
  selectionSummaryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight:
      theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    fontStyle: "italic",
    color: theme.colors.textSecondary,
  },
  wigPreviewPanel: {
    flexDirection: "row",
    gap: theme.spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
  },
  wigPreviewImageFrame: {
    width: 108,
    height: 108,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    flexShrink: 0,
  },
  wigPreviewImage: {
    width: "100%",
    height: "100%",
  },
  wigPreviewPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  wigPreviewCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.xs,
  },
  wigPreviewTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    lineHeight:
      theme.typography.semantic.titleSm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
  },
  wigPreviewMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  wigPreviewBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  wigStockPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  wigStockLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  wigStockValue: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  wigSelectedPill: {
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
  },
  wigSelectedPillText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  patientHeroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingTop: 2,
  },
  patientAvatarCircle: {
    width: 74,
    height: 74,
    borderRadius: theme.radius.full,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    ...theme.shadows.card,
  },
  patientAvatarImage: {
    width: "100%",
    height: "100%",
  },
  patientHeroCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  patientHeroName: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    flexShrink: 1,
  },
  patientHeroMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  patientIdentityVerifiedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.72)",
    ...theme.shadows.soft,
  },
  documentPreviewCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    overflow: "hidden",
    ...theme.shadows.soft,
  },
  documentPreviewHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  documentModuleHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  documentFileRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: 14,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  documentFileName: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 18,
    fontWeight: theme.typography.weights.semibold,
  },
  documentPreviewFrame: {
    height: 190,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  documentPreviewPressable: {
    width: "100%",
    height: 188,
    position: "relative",
  },
  documentPreviewImage: {
    width: "100%",
    height: "100%",
  },
  documentPreviewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    opacity: 0.96,
  },
  documentPreviewLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  documentPreviewZoomAnchor: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: theme.spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  documentPreviewZoomBadge: {
    minWidth: 86,
    minHeight: 32,
    borderRadius: theme.radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.36)",
    ...theme.shadows.soft,
  },
  documentPreviewZoomText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  documentFullPreviewRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12, 5, 8, 0.94)",
  },
  documentFullPreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  documentFullPreviewHeader: {
    position: "absolute",
    top: theme.spacing.xl,
    left: theme.spacing.md,
    right: theme.spacing.md,
    zIndex: 2,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  documentFullPreviewTitle: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: "#ffffff",
  },
  documentFullPreviewClose: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
  },
  documentFullPreviewImage: {
    width: "100%",
    height: "100%",
  },
  documentFullPreviewPdf: {
    position: "absolute",
    top: 72,
    right: 0,
    bottom: 0,
    left: 0,
  },
  documentPreviewPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  documentPreviewPlaceholderText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    textAlign: "center",
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  documentRowCard: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  documentRowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceSoft,
  },
  documentRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  documentRowLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  documentRowValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  documentRowStatus: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  documentStatusPill: {
    minHeight: 28,
    maxWidth: 104,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
  },
  certificateActionRow: {
    width: "100%",
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing.sm,
  },
  certificateActionCell: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  certificateActionButton: {
    width: "100%",
    minHeight: 50,
    borderRadius: 16,
    overflow: "hidden",
  },
  certificateActionGradient: {
    minHeight: 50,
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: theme.spacing.xs,
  },
  certificateActionText: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
    textAlign: "center",
  },
  safetyAssessmentCard: {
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  safetyChoiceRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: theme.spacing.sm,
  },
  safetyChoiceLabel: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  safetyChoiceActions: {
    flexDirection: "row",
    gap: theme.spacing.xs,
  },
  safetyChoiceButton: {
    minWidth: 52,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
  },
  safetyChoiceButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
  },
  safetyDetailInput: {
    borderRadius: 6,
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  safetyAnswersModalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  safetyAnswersBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20, 20, 24, 0.48)",
  },
  safetyAnswersSheet: {
    width: "100%",
    maxHeight: "84%",
    overflow: "hidden",
    borderWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...theme.shadows.lg,
  },
  safetyAnswersHandle: {
    position: "absolute",
    zIndex: 3,
    top: 8,
    left: "44%",
    width: "12%",
    height: 4,
    borderRadius: theme.radius.full,
    backgroundColor: "rgba(255,255,255,0.54)",
  },
  safetyAnswersHeader: {
    minHeight: 126,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  safetyAnswersHeaderIcon: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  safetyAnswersHeaderCopy: {
    flex: 1,
    gap: 3,
  },
  safetyAnswersTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  safetyAnswersStatus: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    opacity: 0.78,
  },
  safetyAnswersClose: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  safetyAnswersList: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  safetyAnswerRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: 16,
    padding: theme.spacing.sm,
  },
  safetyAnswerIcon: {
    width: 32,
    height: 32,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  safetyAnswerLabel: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  safetyAnswerValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  safetyAnswerPill: {
    minWidth: 48,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
  },
  safetyAnswerDetails: {
    gap: 4,
    borderWidth: 1,
    borderRadius: 16,
    padding: theme.spacing.md,
  },
  safetyAnswerDetailsText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  certificateIconButton: {
    width: 54,
    height: 54,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  certificateIconButtonPrimary: {
    backgroundColor: theme.colors.brandPrimary,
    borderColor: theme.colors.brandPrimary,
    ...theme.shadows.soft,
  },
  certificateIconButtonDisabled: {
    opacity: 0.45,
  },
  agreementRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  termsAgreementCheckRow: {
    width: "100%",
    alignSelf: "stretch",
    borderWidth: 1,
    borderRadius: 18,
    padding: theme.spacing.md,
    ...theme.shadows.soft,
  },
  termsAgreementCheckRowDisabled: {
    opacity: 0.55,
  },
  termsAgreementContentRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    gap: theme.spacing.sm,
  },
  termsAgreementLabel: {
    flex: 1,
    minWidth: 0,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 18,
    fontWeight: theme.typography.weights.semibold,
  },
  termsRequiredPill: {
    minHeight: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    flexShrink: 0,
  },
  termsRequiredText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  termsAgreementCheckBox: {
    flexShrink: 0,
  },
  termsAgreementCard: {
    gap: theme.spacing.md,
  },
  termsAgreementHeader: {
    position: "relative",
    overflow: "hidden",
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: 22,
    padding: theme.spacing.md,
    ...theme.shadows.card,
  },
  termsAgreementHeaderGlow: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    right: -30,
    top: -60,
    backgroundColor: "rgba(255,255,255,0.11)",
  },
  termsAgreementIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
  },
  termsAgreementHeaderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  termsAgreementTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: "#FFFFFF",
  },
  termsAgreementHint: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
    color: "#F7DDE4",
  },
  termsVersionPill: {
    minHeight: 28,
    borderRadius: 14,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  termsVersionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.palette.wine800,
  },
  termsLoadingRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  termsLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  termsErrorRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: 16,
    padding: theme.spacing.sm,
  },
  termsErrorText: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    lineHeight: 16,
  },
  termsRetryButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
  },
  termsRetryText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  stylesActionRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    alignItems: "center",
  },
  stylesActionFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: theme.spacing.xxl,
    paddingTop: theme.spacing.sm,
    ...theme.shadows.soft,
  },
  patientApproveFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    paddingHorizontal: theme.spacing.xxl,
    paddingTop: theme.spacing.sm,
    backgroundColor: "transparent",
  },
  summarySubmitFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 32,
    paddingHorizontal: theme.spacing.xxl,
    paddingTop: theme.spacing.sm,
    backgroundColor: "transparent",
  },
  summarySubmitButton: {
    borderRadius: theme.radius.lg,
    ...theme.shadows.hero,
  },
  patientInlineApproveSlot: {
    width: "100%",
    minHeight: 64,
    justifyContent: "flex-start",
  },
  stylesActionButton: {
    flex: 1,
    minWidth: 0,
  },
  wigStyleList: {
    gap: theme.spacing.sm,
  },
  wigStyleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    padding: theme.spacing.md,
    minHeight: 92,
  },
  wigStyleCardSelected: {
    borderWidth: 2,
    padding: theme.spacing.md - 1,
  },
  wigStyleCardPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.99 }],
  },
  wigStyleThumbWrap: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: "hidden",
    flexShrink: 0,
  },
  wigStyleThumb: {
    width: "100%",
    height: "100%",
  },
  wigStyleThumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  wigStyleCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  wigStyleTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.tight,
    fontWeight: theme.typography.weights.bold,
  },
  wigStyleSpec: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight:
      theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
  },
  patientReviewHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  patientEditButton: {
    minWidth: 76,
  },
  patientMediaGrid: {
    gap: theme.spacing.sm,
  },
  patientMediaCard: {
    gap: theme.spacing.xs,
  },
  patientMediaHeader: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  patientMediaTitle: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  patientPhotoPreview: {
    width: "100%",
    height: 160,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSoft,
  },
  patientMediaEmpty: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderMuted,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  patientMediaEmptyText: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
  },
  patientDocumentName: {
    minHeight: 28,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.normal,
  },
  requestFlowCompactAction: {
    width: "100%",
    minHeight: 38,
    alignSelf: "stretch",
    marginTop: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
  },
  requestFlowCompactActionText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  flowBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  photoPreviewBox: {
    minHeight: 180,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderMuted,
  },
  photoPreviewImage: {
    width: "100%",
    height: 210,
  },
  photoFlowSection: {
    paddingBottom: theme.spacing.sm,
  },
  photoGuideCard: {
    position: "relative",
    overflow: "hidden",
    minHeight: 118,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    ...theme.shadows.card,
  },
  photoGuideGlow: {
    position: "absolute",
    width: 128,
    height: 128,
    borderRadius: 64,
    right: -34,
    top: -72,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  photoGuideIcon: {
    width: 52,
    height: 52,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
  },
  photoGuideCopy: {
    flex: 1,
    gap: 3,
  },
  photoGuideEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.75,
    color: theme.colors.textHeroMuted,
  },
  photoGuideTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight:
      theme.typography.semantic.bodyLg * theme.typography.lineHeights.snug,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
  },
  photoGuideBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight:
      theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textHeroSoft,
  },
  aiPhotoStage: {
    position: "relative",
    minHeight: 300,
    overflow: "hidden",
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.borderMuted,
    ...theme.shadows.soft,
  },
  aiPhotoPreview: {
    width: "100%",
    height: 300,
  },
  aiPhotoPlaceholder: {
    minHeight: 300,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  aiPhotoPlaceholderIcon: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.full,
  },
  aiPhotoPlaceholderCopy: {
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  aiPhotoPlaceholderTitle: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  aiPhotoPlaceholderText: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  photoTipsRow: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.xs,
  },
  photoTipPill: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  photoTipText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.medium,
  },
  photoCameraGuideOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  photoFaceGuide: {
    width: 174,
    height: 222,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.82)",
    borderRadius: 88,
  },
  photoCameraGuidePill: {
    position: "absolute",
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.xs,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: "rgba(75,16,32,0.86)",
  },
  photoCameraGuideText: {
    flexShrink: 1,
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  photoReadyPill: {
    position: "absolute",
    top: theme.spacing.md,
    right: theme.spacing.md,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: "rgba(25,122,77,0.92)",
    ...theme.shadows.soft,
  },
  photoReadyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
  },
  photoCameraAction: {
    borderRadius: theme.radius.md,
  },
  photoReviewActions: {
    width: "100%",
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing.sm,
  },
  photoReviewActionCell: {
    flex: 1,
    minWidth: 0,
  },
  aiGeneratingState: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.lg,
    paddingHorizontal: theme.spacing.xl,
  },
  aiResultGrid: {
    gap: theme.spacing.md,
  },
  matcherCarouselViewport: {
    width: "100%",
    overflow: "hidden",
    borderRadius: theme.radius.lg,
  },
  aiRecommendationRow: {
    gap: theme.spacing.md,
    paddingRight: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  aiRecommendationCard: {
    flexShrink: 0,
  },
  matcherCarouselNavigation: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  matcherPagination: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  matcherPaginationDot: {
    width: 8,
    height: 8,
    borderRadius: theme.radius.full,
  },
  matcherPaginationDotActive: {
    width: 24,
  },
  matcherSwipeHint: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
  },
  matcherSwipeHintText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  aiRecommendationReason: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    ...theme.shadows.soft,
  },
  aiRecommendationReasonHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  aiRecommendationReasonIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
  },
  aiRecommendationReasonHeading: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  aiRecommendationReasonTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
  },
  aiRecommendationReasonMatch: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  aiResultPanel: {
    gap: theme.spacing.xs,
  },
  aiPreviewCard: {
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  aiPreviewCardHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  aiPreviewHint: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
  },
  aiPreviewBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
  },
  aiPreviewBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
  },
  aiResultLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  aiResultImage: {
    width: "100%",
    height: 340,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSoft,
  },
  aiCompositeShell: {
    gap: theme.spacing.sm,
  },
  aiCompositeFrame: {
    overflow: "hidden",
    position: "relative",
  },
  aiCompositeBaseImage: {
    width: "100%",
    height: "100%",
  },
  wigFitControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing.xs,
  },
  wigFitSectionLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  wigFitButton: {
    flex: 1,
    minHeight: 38,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.xs,
  },
  photoPlaceholder: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  summaryNoteCard: {
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
  },
  summaryNoteTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  previewReferenceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.sm,
  },
  previewReferenceImage: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.md,
  },
  previewReferenceCopy: {
    flex: 1,
    gap: 3,
  },
  previewReferenceText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight: theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
  },
  wigSpecificationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  },
  wigSpecificationItem: {
    width: "48%",
    gap: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: theme.spacing.xs,
  },
  wigSpecificationLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  wigSpecificationValue: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
  },
  previewActionSection: {
    gap: theme.spacing.sm,
  },
  previewActionTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  previewAlternativeActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  previewAlternativeAction: {
    flex: 1,
  },
  generationModalCard: {
    width: "100%",
    alignSelf: "center",
    maxWidth: theme.layout.contentMaxWidth,
  },
  sheetKeyboardWrap: {
    flex: 1,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: theme.colors.overlay,
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetCard: {
    width: "100%",
    alignSelf: "center",
    maxWidth: theme.layout.contentMaxWidth,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: "74%",
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.borderStrong,
    alignSelf: "center",
    marginBottom: theme.spacing.md,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  sheetTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  sheetBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingBottom: theme.spacing.md,
  },
  sheetFooter: {
    paddingTop: theme.spacing.sm,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.md,
  },
  modalHeaderActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceSoft,
  },
  modalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: 32,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  modalBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    lineHeight: 40,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  generationModalTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  generationModalBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.md,
  },
  generationStage: {
    minHeight: 320,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceSoft,
    marginBottom: theme.spacing.md,
  },
  generationStageImage: {
    width: "100%",
    height: 320,
  },
  generationStagePlaceholder: {
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
  },
  generationStagePlaceholderText: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  generationResultTitle: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  generationResultFamily: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.brandPrimary,
    marginBottom: theme.spacing.xs,
  },
  generationResultSummary: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  detailsPanel: {
    gap: theme.spacing.sm,
  },
  captureStage: {
    position: "relative",
    minHeight: 320,
    borderRadius: theme.radius.sm,
    overflow: "hidden",
    backgroundColor: "#090909",
    marginBottom: theme.spacing.sm,
  },
  captureStageImage: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    height: 320,
  },
  captureStagePhotoPreview: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    height: 320,
    backgroundColor: "#090909",
  },
  tryOnLayerWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 6,
    elevation: 6,
  },
  tryOnLayerHidden: {
    position: "absolute",
    width: 0,
    height: 0,
    opacity: 0,
  },
  tryOnLayerMissingBanner: {
    position: "absolute",
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    zIndex: 12,
    elevation: 12,
    alignItems: "center",
    borderRadius: theme.radius.full,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    backgroundColor: "rgba(17, 14, 17, 0.72)",
  },
  tryOnLayerMissingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  availableWigsSection: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  availableWigsHeader: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  availableWigsTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  availableWigsMeta: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
  },
  availableWigsRow: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.md,
  },
  tryOnWigCard: {
    width: 116,
    gap: theme.spacing.xs,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderMuted,
    backgroundColor: theme.colors.backgroundPrimary,
    padding: theme.spacing.xs,
  },
  tryOnWigCardActive: {
    borderWidth: 2,
    borderColor: theme.colors.brandPrimary,
  },
  tryOnWigImageWrap: {
    position: "relative",
    height: 86,
    overflow: "hidden",
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSoft,
  },
  tryOnWigAiBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    zIndex: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: theme.radius.full,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: theme.colors.brandPrimary,
  },
  tryOnWigAiBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textInverse,
  },
  tryOnWigImage: {
    width: "100%",
    height: "100%",
  },
  tryOnWigImagePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tryOnWigName: {
    minHeight: 18,
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  availableWigsEmpty: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderMuted,
    backgroundColor: theme.colors.backgroundPrimary,
  },
  availableWigsEmptyText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    color: theme.colors.textSecondary,
  },
  captureStagePlaceholder: {
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    backgroundColor: theme.colors.surfaceSoft,
  },
  captureStagePlaceholderTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.bodyLg,
    color: theme.colors.textPrimary,
  },
  captureStagePlaceholderBody: {
    textAlign: "center",
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  captureFrame: {
    position: "absolute",
    top: CAPTURE_FRAME_INSET,
    right: CAPTURE_FRAME_INSET,
    bottom: CAPTURE_FRAME_INSET,
    left: CAPTURE_FRAME_INSET,
    borderRadius: theme.radius.md,
    zIndex: 10,
    elevation: 10,
  },
  captureCorner: {
    position: "absolute",
    width: 34,
    height: 34,
    borderColor: "#ffffff",
  },
  captureCornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  captureCornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  captureCornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  captureCornerBottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 3,
    borderBottomWidth: 3,
  },
  captureFaceGuide: {
    position: "absolute",
    top: CAPTURE_FACE_GUIDE_TOP,
    alignSelf: "center",
    width: CAPTURE_FACE_GUIDE_WIDTH,
    height: CAPTURE_FACE_GUIDE_HEIGHT,
    borderRadius: CAPTURE_FACE_GUIDE_RADIUS,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.68)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  captureHintPill: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(17, 14, 17, 0.7)",
  },
  captureHintText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textInverse,
  },
  faceScanPanel: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderMuted,
    backgroundColor: theme.colors.backgroundPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  faceScanStatusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.textWarning,
  },
  faceScanStatusDotComplete: {
    backgroundColor: theme.colors.textSuccess,
  },
  faceScanCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  faceScanTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.textPrimary,
  },
  faceScanBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    lineHeight:
      theme.typography.semantic.caption * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  captureControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.sm,
  },
  captureControlsSpacer: {
    width: 64,
  },
  iconCircleButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  iconCircleButtonPrimary: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.brandPrimary,
    borderColor: theme.colors.brandPrimary,
  },
  iconCircleButtonSecondary: {
    backgroundColor: theme.colors.backgroundPrimary,
    borderColor: theme.colors.borderStrong,
  },
  captureButtonPrimary: {
    marginTop: -8,
  },
  iconCircleButtonPressed: {
    transform: [{ scale: 0.97 }],
  },
  iconCircleButtonDisabled: {
    opacity: 0.64,
  },
  modalFooter: {
    gap: theme.spacing.sm,
  },
  modalFooterText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight:
      theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textSecondary,
  },
  multilineInput: {
    minHeight: 92,
    textAlignVertical: "top",
  },
  multilineInputShell: {
    borderRadius: 12,
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
});
