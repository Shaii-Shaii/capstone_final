import { colors } from './colors';
import { spacing } from './spacing';
import { typography } from './typography';
import { radius } from './radius';
import { shadows } from './shadows';
import donivraLogo from '../assets/images/donivra_logo_no_text.png';

export const theme = {
  colors,
  spacing,
  typography,
  radius,
  shadows,

  layout: {
    screenPaddingX: spacing.screenX,
    screenPaddingY: spacing.screenY,
    screenPaddingXCompact: spacing.screenXCompact,
    screenPaddingYCompact: spacing.screenYCompact,
    shortScreenHeight: 760,
    compactScreenHeight: 700,
    authHeroMinHeight: 250,
    authHeroMinHeightCompact: 220,
    dashboardHeroMinHeight: 152,
    dashboardHeroMinHeightCompact: 140,
    contentMaxWidth: 560,
    cardGap: spacing.section,
    cardGapCompact: spacing.sectionCompact,
    dashboardHeaderCompactHeight: 188,
    dashboardHeaderExpandedHeight: 212,
    dashboardFloatingNavOffset: spacing.lg,
    dashboardFloatingNavOffsetCompact: spacing.md,
    dashboardFloatingNavLift: spacing.xs,
    dashboardFloatingNavGap: spacing.lg,
    dashboardShellTopGap: spacing.sm,
    dashboardShellTopGapCompact: spacing.xs,
    dashboardShellBottomGap: spacing.xxl,
    dashboardShellBottomGapCompact: spacing.xl,
    dashboardNavMaxWidth: 520,
    dashboardRailCardWidth: 312,
    dashboardRailCardWidthCompact: 284,
    dashboardRailCompactWidth: 198,
    dashboardRailCompactWidthCompact: 180,
    authCardMaxWidth: 520,
  },

  buttons: {
    heightMd: 52,
    heightLg: 58,
    heightMdCompact: 48,
    heightLgCompact: 54,
  },

  inputs: {
    minHeight: 56,
    minHeightCompact: 52,
    otpSize: 52,
  },

  motion: {
    fast: 140,
    normal: 220,
    slow: 340,
    stagger: 70,
    screenEnter: 420,
    cardEnter: 320,
    pressIn: 90,
    pressOut: 180,
    focus: 180,
    nav: 240,
    contentSwap: 260,
    shake: 45,
    spring: {
      damping: 16,
      stiffness: 220,
      mass: 0.7,
    },
  },
};

export const emptyResolvedTheme = {
  brandName: '',
  brandTagline: '',
  logoIcon: '',
  loginBackgroundPhoto: '',
  primaryColor: '',
  secondaryColor: '',
  tertiaryColor: '',
  backgroundColor: '',
  primaryTextColor: '',
  secondaryTextColor: '',
  tertiaryTextColor: '',
  fontFamily: theme.typography.fontFamily,
  secondaryFontFamily: theme.typography.fontFamilyDisplay,
};

export const bundledBrandLogoSource = donivraLogo;

export function resolveBrandLogoUri(resolvedTheme = emptyResolvedTheme) {
  if (typeof resolvedTheme?.logoIcon !== 'string') return '';

  const normalized = resolvedTheme.logoIcon.trim();
  if (!normalized) return '';

  // Keep valid absolute/data URIs as-is.
  if (/^(https?:\/\/|file:\/\/|content:\/\/|data:image\/)/i.test(normalized)) {
    return encodeURI(normalized);
  }

  // Support protocol-relative urls from DB values like //domain/path.png
  if (/^\/\//.test(normalized)) {
    return encodeURI(`https:${normalized}`);
  }

  // Support host/path values without explicit protocol from UI settings.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(normalized)) {
    return encodeURI(`https://${normalized}`);
  }

  // Support root-relative storage paths by using Supabase base URL when available.
  if (normalized.startsWith('/')) {
    const supabaseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
    if (supabaseUrl) {
      return encodeURI(`${supabaseUrl}${normalized}`);
    }
  }

  return '';
}

export function resolveBrandLogoSource(resolvedTheme = emptyResolvedTheme, imageFailed = false) {
  const logoUri = resolveBrandLogoUri(resolvedTheme);
  if (!imageFailed && logoUri) {
    return { uri: logoUri };
  }

  return bundledBrandLogoSource;
}

const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));
const clampAlpha = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));

function parseColorValue(color) {
  if (!color || typeof color !== 'string') return null;

  const normalized = color.trim();

  if (/^#([0-9a-f]{3}|[0-9a-f]{4})$/i.test(normalized)) {
    const value = normalized.slice(1);
    const [r, g, b, a] = value.length === 3 || value.length === 4
      ? value.split('').map((channel) => channel + channel)
      : [];
    return {
      r: parseInt(r, 16),
      g: parseInt(g, 16),
      b: parseInt(b, 16),
      a: a ? parseInt(a, 16) / 255 : 1,
    };
  }

  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(normalized)) {
    const value = normalized.slice(1);
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
      a: value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgbMatch) return null;

  const parts = rgbMatch[1].split(',').map((part) => part.trim());
  if (parts.length < 3) return null;

  return {
    r: clampChannel(Number(parts[0])),
    g: clampChannel(Number(parts[1])),
    b: clampChannel(Number(parts[2])),
    a: parts.length > 3 ? clampAlpha(Number(parts[3])) : 1,
  };
}

function toColorString(value) {
  if (!value) return '';
  const r = clampChannel(value.r);
  const g = clampChannel(value.g);
  const b = clampChannel(value.b);
  const a = clampAlpha(value.a);
  return a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

function mixColors(baseColor, overlayColor, amount = 0.5) {
  const base = parseColorValue(baseColor);
  const overlay = parseColorValue(overlayColor);

  if (!base && !overlay) return '';
  if (!base) return toColorString(overlay);
  if (!overlay) return toColorString(base);

  const weight = clampAlpha(amount);
  return toColorString({
    r: base.r + (overlay.r - base.r) * weight,
    g: base.g + (overlay.g - base.g) * weight,
    b: base.b + (overlay.b - base.b) * weight,
    a: base.a + (overlay.a - base.a) * weight,
  });
}

function relativeLuminance(color) {
  const parsed = parseColorValue(color);
  if (!parsed) return 0;

  const channels = [parsed.r, parsed.g, parsed.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(backgroundColor, foregroundColor) {
  const background = relativeLuminance(backgroundColor);
  const foreground = relativeLuminance(foregroundColor);
  const lighter = Math.max(background, foreground);
  const darker = Math.min(background, foreground);
  return (lighter + 0.05) / (darker + 0.05);
}

function pickReadableColor(backgroundColor, candidates = [], fallback = theme.colors.textPrimary) {
  const background = parseColorValue(backgroundColor);
  if (!background) {
    return candidates.find((candidate) => parseColorValue(candidate)) || fallback;
  }

  return candidates
    .filter((candidate) => parseColorValue(candidate))
    .sort((left, right) => contrastRatio(backgroundColor, right) - contrastRatio(backgroundColor, left))[0]
    || fallback;
}

function ensureReadableColor(backgroundColor, color, fallbackCandidates = [], fallback = theme.colors.textPrimary) {
  if (!parseColorValue(color)) {
    return pickReadableColor(backgroundColor, fallbackCandidates, fallback);
  }

  if (contrastRatio(backgroundColor, color) < 4.5) {
    return pickReadableColor(backgroundColor, fallbackCandidates, fallback);
  }

  return color;
}

export function normalizeResolvedTheme(resolvedTheme = emptyResolvedTheme) {
  const backgroundColor = parseColorValue(resolvedTheme?.backgroundColor)
    ? resolvedTheme.backgroundColor
    : theme.colors.backgroundCanvas;

  const primaryTextColor = ensureReadableColor(
    backgroundColor,
    resolvedTheme?.primaryTextColor,
    [theme.colors.textPrimary, theme.colors.textInverse, theme.colors.palette.white, theme.colors.palette.black],
    theme.colors.textPrimary
  );

  const secondaryTextColor = ensureReadableColor(
    backgroundColor,
    resolvedTheme?.secondaryTextColor,
    [theme.colors.textSecondary, primaryTextColor, theme.colors.textInverse, theme.colors.textPrimary],
    primaryTextColor
  );

  const tertiaryTextColor = ensureReadableColor(
    backgroundColor,
    resolvedTheme?.tertiaryTextColor,
    [theme.colors.textMuted, secondaryTextColor, primaryTextColor, theme.colors.textInverse],
    secondaryTextColor
  );

  const primaryColor = parseColorValue(resolvedTheme?.primaryColor)
    ? resolvedTheme.primaryColor
    : primaryTextColor;

  return {
    ...emptyResolvedTheme,
    ...resolvedTheme,
    backgroundColor,
    primaryColor,
    primaryTextColor,
    secondaryTextColor,
    tertiaryTextColor,
  };
}

export function resolveThemeRoles(resolvedTheme = emptyResolvedTheme, options = {}) {
  const normalizedTheme = normalizeResolvedTheme(resolvedTheme);
  const isMobileViewport = Boolean(options?.isMobile);
  const background = normalizedTheme.backgroundColor || theme.colors.backgroundCanvas;
  const primary = normalizedTheme.primaryColor || '';
  const secondary = resolvedTheme?.secondaryColor || '';
  const tertiary = resolvedTheme?.tertiaryColor || '';
  const heading = normalizedTheme.primaryTextColor || theme.colors.textPrimary;
  const body = normalizedTheme.secondaryTextColor || theme.colors.textSecondary;
  const meta = normalizedTheme.tertiaryTextColor || theme.colors.textMuted;
  const supportSeed = secondary || tertiary || body || heading;
  const accentSeed = tertiary || secondary || meta || body || heading;
  const cardSeed = supportSeed || heading;

  const pageBackground = background;
  const defaultCardBackground = isMobileViewport
    ? pageBackground
    : mixColors(pageBackground, cardSeed, secondary ? 0.06 : 0.04) || pageBackground;
  const defaultCardBorder = mixColors(pageBackground, cardSeed, secondary ? 0.18 : 0.1) || theme.colors.borderSubtle;
  const supportCardBackground = isMobileViewport
    ? pageBackground
    : mixColors(pageBackground, supportSeed, secondary ? 0.12 : 0.08) || defaultCardBackground;
  const supportCardBorder = mixColors(pageBackground, supportSeed, secondary ? 0.28 : 0.16) || defaultCardBorder;
  const accentCardBackground = isMobileViewport
    ? pageBackground
    : mixColors(pageBackground, accentSeed, tertiary ? 0.14 : 0.1) || supportCardBackground;
  const accentCardBorder = mixColors(pageBackground, accentSeed, tertiary ? 0.3 : 0.2) || supportCardBorder;
  const heroBackground = primary
    ? (isMobileViewport ? pageBackground : mixColors(pageBackground, primary, 0.18) || primary)
    : supportCardBackground;
  const heroBorder = primary
    ? mixColors(pageBackground, primary, 0.3) || supportCardBorder
    : supportCardBorder;
  const primaryActionBackground = primary || heading;
  const primaryActionText = pickReadableColor(
    primaryActionBackground,
    [pageBackground, heading, body, theme.colors.textInverse],
    theme.colors.textInverse
  );
  const secondaryActionBackground = supportCardBackground;
  const secondaryActionBorder = supportCardBorder;
  const secondaryActionText = pickReadableColor(
    secondaryActionBackground,
    [heading, body, meta, pageBackground],
    heading
  );
  const tertiaryAccentBackground = accentCardBackground;
  const tertiaryAccentText = pickReadableColor(
    tertiaryAccentBackground,
    [meta, body, heading, pageBackground],
    meta
  );
  const iconPrimarySurface = primary
    ? mixColors(pageBackground, primary, 0.16) || supportCardBackground
    : supportCardBackground;
  const iconSupportSurface = supportCardBackground;
  const iconAccentSurface = accentCardBackground;
  const navSurface = mixColors(pageBackground, supportSeed, secondary ? 0.1 : 0.06) || defaultCardBackground;
  const navBorder = mixColors(pageBackground, supportSeed, secondary ? 0.22 : 0.12) || defaultCardBorder;
  const headerUtilityBackground = mixColors(heroBackground, pageBackground, 0.34) || supportCardBackground;
  const headerUtilityText = pickReadableColor(
    headerUtilityBackground,
    [heading, body, meta, pageBackground, theme.colors.textInverse],
    heading
  );
  const heroHeadingText = pickReadableColor(
    heroBackground,
    [heading, pageBackground, body, theme.colors.textInverse],
    heading
  );
  const heroBodyText = pickReadableColor(
    heroBackground,
    [body, meta, pageBackground, theme.colors.textInverse],
    body
  );
  const heroMetaText = pickReadableColor(
    heroBackground,
    [meta, body, pageBackground, theme.colors.textInverse],
    meta
  );

  return {
    pageBackground,
    defaultCardBackground,
    defaultCardBorder,
    supportCardBackground,
    supportCardBorder,
    accentCardBackground,
    accentCardBorder,
    heroBackground,
    heroBorder,
    primaryActionBackground,
    primaryActionText,
    secondaryActionBackground,
    secondaryActionBorder,
    secondaryActionText,
    tertiaryAccentBackground,
    tertiaryAccentText,
    headingText: heading,
    bodyText: body,
    metaText: meta,
    heroHeadingText,
    heroBodyText,
    heroMetaText,
    navSurface,
    navBorder,
    navActiveBackground: primaryActionBackground,
    navActiveText: primaryActionText,
    navInactiveText: meta || body,
    badgeBackground: tertiaryAccentBackground,
    badgeText: tertiaryAccentText,
    badgeStrongBackground: supportCardBackground,
    badgeStrongText: secondaryActionText,
    iconPrimarySurface,
    iconSupportSurface,
    iconAccentSurface,
    iconPrimaryColor: pickReadableColor(iconPrimarySurface, [primary, heading, body, meta], heading),
    iconSupportColor: pickReadableColor(iconSupportSurface, [heading, body, meta, secondary], heading),
    iconAccentColor: pickReadableColor(iconAccentSurface, [meta, body, heading, tertiary], meta),
    headerUtilityBackground,
    headerUtilityText,
    headerSearchBackground: defaultCardBackground,
    headerSearchText: body,
    headerSearchAccentBackground: primaryActionBackground,
    headerSearchAccentText: primaryActionText,
  };
}

export function resolvePatientThemeRoles(resolvedTheme = emptyResolvedTheme, options = {}) {
  const roles = resolveThemeRoles(resolvedTheme, options);
  const primaryActionBackground = theme.colors.palette.wine700;
  const primaryActionText = theme.colors.textInverse;

  return {
    ...roles,
    primaryActionBackground,
    primaryActionText,
    secondaryActionBackground: theme.colors.surfaceCardMuted,
    secondaryActionBorder: theme.colors.borderMuted,
    secondaryActionText: theme.colors.palette.wine800,
    tertiaryAccentBackground: theme.colors.surfaceSoft,
    tertiaryAccentText: theme.colors.palette.wine700,
    supportCardBackground: theme.colors.surfaceCardMuted,
    supportCardBorder: theme.colors.borderMuted,
    accentCardBackground: theme.colors.surfaceSoft,
    accentCardBorder: theme.colors.borderStrong,
    headingText: theme.colors.textPrimary,
    bodyText: theme.colors.textSecondary,
    metaText: theme.colors.textMuted,
    navActiveBackground: primaryActionBackground,
    navActiveText: primaryActionText,
    navInactiveText: theme.colors.textMuted,
    badgeBackground: theme.colors.surfaceCardMuted,
    badgeText: theme.colors.palette.wine700,
    badgeStrongBackground: theme.colors.palette.blush100,
    badgeStrongText: theme.colors.palette.wine800,
    iconPrimarySurface: theme.colors.surfaceCardMuted,
    iconSupportSurface: theme.colors.surfaceSoft,
    iconAccentSurface: theme.colors.accentSoft,
    iconPrimaryColor: theme.colors.palette.wine700,
    iconSupportColor: theme.colors.palette.wine800,
    iconAccentColor: theme.colors.palette.wine600,
    headerSearchAccentBackground: primaryActionBackground,
    headerSearchAccentText: primaryActionText,
  };
}
