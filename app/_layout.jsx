import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../globals.css';
import { Animated, Easing, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Slot } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as NavigationBar from 'expo-navigation-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthProvider, useAuth } from '../src/providers/AuthProvider';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { useRoleRedirect } from '../src/hooks/useRoleRedirect';
import { bundledBrandLogoSource, normalizeResolvedTheme, resolveBrandLogoSource } from '../src/design-system/theme';
import { GluestackUIProvider } from '../src/components/gluestack-ui/gluestack-ui-provider';

// ─── Duration ──────────────────────────────────────────────────────────────
const SPLASH_DURATION_MS = 4800;

// ─── Palette ───────────────────────────────────────────────────────────────
// Very dark background like EECM — almost black with a wine warmth
const BG_GRADIENT = ['#0d0205', '#1e0508', '#360b12', '#4b1020', '#63182e'];

// Ripple rings: warm rose-gold tint
const RIPPLE_COLORS = [
  'rgba(200, 100,  80, 0.65)',
  'rgba(180,  80,  70, 0.42)',
  'rgba(160,  70,  60, 0.22)',
];

// Rose-gold / copper gradient border (5 stops — diagonal like a cut gem)
const BORDER_GRAD = [
  '#6e2e0e',   // dark copper
  '#d4874e',   // warm gold
  '#f5dfa8',   // bright champagne centre
  '#d4874e',   // warm gold
  '#6e2e0e',   // dark copper
];

// ─── Geometry ──────────────────────────────────────────────────────────────
// Badge container: rounded-square that reads as a hexagonal seal
const HEX_OUTER   = 158;              // gradient border layer (px)
const HEX_BORDER  = 4;                // even border thickness on all sides
const HEX_INNER   = HEX_OUTER - (HEX_BORDER * 2); // dark interior card
const HEX_OUTER_R = HEX_OUTER / 2;   // 79 — used to place tip-dots
const STAGE_SIZE  = 228;
const STAGE_HALF  = STAGE_SIZE / 2;   // 114

// 4 sparkle points at the cardinal tips of the badge container
const TIP_DOTS = [
  { top: STAGE_HALF - HEX_OUTER_R - 9, left: STAGE_HALF - 9 }, // top
  { top: STAGE_HALF - 9, left: STAGE_HALF + HEX_OUTER_R - 9 }, // right
  { top: STAGE_HALF + HEX_OUTER_R - 9, left: STAGE_HALF - 9 }, // bottom
  { top: STAGE_HALF - 9, left: STAGE_HALF - HEX_OUTER_R - 9 }, // left
];

// ─── RippleRing ────────────────────────────────────────────────────────────
function RippleRing({ scale, opacity, size, color }) {
  return (
    <Animated.View
      style={[
        ss.rippleRing,
        {
          width: size, height: size,
          borderRadius: size / 2,
          borderColor: color,
          transform: [{ scale }],
          opacity,
        },
      ]}
      pointerEvents="none"
    />
  );
}

// ─── LaunchSplash ──────────────────────────────────────────────────────────
function LaunchSplash({ resolvedTheme }) {
  const [imageFailed, setImageFailed] = useState(false);
  const vt        = normalizeResolvedTheme(resolvedTheme);
  const logoSrc   = resolveBrandLogoSource(vt, imageFailed);
  const brandName = vt.brandName    || 'Donivra';
  const tagline   = vt.brandTagline || 'Where Hair Becomes Hope';
  const badgeText = useMemo(() => {
    const compact = String(brandName || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .replace(/[AEIOU]/g, '');
    if (compact.length >= 4) return compact.slice(0, 4);
    const fallback = String(brandName || '').toUpperCase().replace(/[^A-Z]/g, '');
    return (fallback.slice(0, 4) || 'DNVR');
  }, [brandName]);

  // ── Animated values ────────────────────────────────────────────
  // Start visible by default; avoids Android native-driver cases where
  // the entrance animation can leave the badge at near-zero opacity/scale.
  const logoScale  = useRef(new Animated.Value(1)).current;
  const logoOp     = useRef(new Animated.Value(1)).current;
  const logoPulse  = useRef(new Animated.Value(1)).current;
  const glowScale  = useRef(new Animated.Value(0.35)).current;
  const glowOp     = useRef(new Animated.Value(0)).current;
  const haloScale  = useRef(new Animated.Value(0.80)).current;
  const haloOp     = useRef(new Animated.Value(0)).current;

  // 3 ripple rings
  const ripples = useRef(
    Array.from({ length: 3 }, () => ({
      s: new Animated.Value(0.20),
      o: new Animated.Value(0),
    }))
  ).current;

  // Dual shine sweeps
  const shine1X = useRef(new Animated.Value(-160)).current;
  const shine2X = useRef(new Animated.Value(-160)).current;

  // Orbit ring
  const orbitRot = useRef(new Animated.Value(0)).current;
  const orbitOp  = useRef(new Animated.Value(0)).current;

  // Tip sparkle points
  const tipOp = useRef(new Animated.Value(0)).current;
  const tipScale = useRef(new Animated.Value(0.7)).current;

  // Text
  const brandY   = useRef(new Animated.Value(26)).current;
  const brandOp  = useRef(new Animated.Value(0)).current;
  const tagOp    = useRef(new Animated.Value(0)).current;

  // NOTE: do NOT use Animated.multiply — it can silently freeze on the
  // native driver, leaving the badge at its initial scale (0.20 = invisible).
  // Chained transforms compose identically: scale = logoScale × logoPulse.

  useEffect(() => {
    setImageFailed(false);
  }, [vt.logoIcon]);

  useEffect(() => {
    // ── Ripple factory ─────────────────────────────────────────────
    const mkRipple = (s, o, delay) =>
      Animated.loop(Animated.sequence([
        Animated.parallel([
          Animated.timing(s, { toValue: 0.20, duration: 0, useNativeDriver: true }),
          Animated.timing(o, { toValue: 0,    duration: 0, useNativeDriver: true }),
        ]),
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(s, {
            toValue: 2.8, duration: 2200,
            easing: Easing.out(Easing.quad), useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(o, { toValue: 0.80, duration: 120,  useNativeDriver: true }),
            Animated.timing(o, { toValue: 0,    duration: 2080,
              easing: Easing.out(Easing.quad), useNativeDriver: true }),
          ]),
        ]),
      ]));

    // ── Shine factory ──────────────────────────────────────────────
    const mkShine = (ref, pre, dur, post) =>
      Animated.loop(Animated.sequence([
        Animated.timing(ref, { toValue: -160, duration: 0, useNativeDriver: true }),
        Animated.delay(pre),
        Animated.timing(ref, {
          toValue: 160, duration: dur,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.delay(post),
      ]));

    // ── Logo entrance ─────────────────────────────────────────────
    const logoIn = Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1, damping: 11, stiffness: 165, mass: 0.72,
        useNativeDriver: true,
      }),
      Animated.timing(logoOp, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.timing(glowOp, { toValue: 1, duration: 540, useNativeDriver: true }),
      Animated.spring(glowScale, { toValue: 1, damping: 9, stiffness: 100, useNativeDriver: true }),
      Animated.timing(haloOp, { toValue: 1, duration: 660, useNativeDriver: true }),
      Animated.spring(haloScale, { toValue: 1, damping: 8, stiffness: 88, useNativeDriver: true }),
      Animated.timing(orbitOp, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]);

    // ── Breathing pulse ───────────────────────────────────────────
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(logoPulse, {
        toValue: 1.054, duration: 1600,
        easing: Easing.inOut(Easing.ease), useNativeDriver: true,
      }),
      Animated.timing(logoPulse, {
        toValue: 1, duration: 1600,
        easing: Easing.inOut(Easing.ease), useNativeDriver: true,
      }),
    ]));

    // ── Halo breathing ────────────────────────────────────────────
    const haloBreath = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(haloScale, { toValue: 1.11, duration: 2900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(haloOp,    { toValue: 0.45, duration: 2900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(haloScale, { toValue: 1, duration: 2900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(haloOp,    { toValue: 0.85, duration: 2900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ]));

    // ── Orbit ─────────────────────────────────────────────────────
    const orbit = Animated.loop(
      Animated.timing(orbitRot, {
        toValue: 1, duration: 11000,
        easing: Easing.linear, useNativeDriver: true,
      }),
    );

    // Tip sparkle twinkle
    const tipTwinkle = Animated.loop(Animated.sequence([
      Animated.parallel([
        Animated.timing(tipOp, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.timing(tipScale, { toValue: 0.7, duration: 0, useNativeDriver: true }),
      ]),
      Animated.delay(500),
      Animated.parallel([
        Animated.timing(tipOp, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(tipScale, { toValue: 1.24, duration: 220, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(tipOp, { toValue: 0.42, duration: 180, useNativeDriver: true }),
        Animated.timing(tipScale, { toValue: 0.9, duration: 180, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(tipOp, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(tipScale, { toValue: 1.18, duration: 220, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(tipOp, { toValue: 0.26, duration: 220, useNativeDriver: true }),
        Animated.timing(tipScale, { toValue: 0.82, duration: 220, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(tipOp, { toValue: 0.95, duration: 220, useNativeDriver: true }),
        Animated.timing(tipScale, { toValue: 1.08, duration: 220, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(tipOp, { toValue: 0, duration: 430, useNativeDriver: true }),
        Animated.timing(tipScale, { toValue: 0.7, duration: 430, useNativeDriver: true }),
      ]),
      Animated.delay(2800),
    ]));

    const rippleAnims = ripples.map((r, i) => mkRipple(r.s, r.o, i * 510));
    const shine1 = mkShine(shine1X, 1900, 640, 2400);   // primary: narrow bright
    const shine2 = mkShine(shine2X, 2600, 1100, 1700);  // secondary: wide soft

    // Start logo entrance immediately
    logoIn.start(({ finished }) => { if (finished) pulse.start(); });
    orbit.start();
    haloBreath.start();

    // Text: guaranteed start times (not chained to spring so they always appear)
    const tBrand = setTimeout(() => {
      Animated.parallel([
        Animated.timing(brandOp, { toValue: 1, duration: 340, useNativeDriver: true }),
        Animated.timing(brandY,  {
          toValue: 0, duration: 340,
          easing: Easing.out(Easing.cubic), useNativeDriver: true,
        }),
      ]).start();
    }, 680);

    const tTag = setTimeout(() => {
      Animated.timing(tagOp, { toValue: 1, duration: 340, useNativeDriver: true }).start();
    }, 1040);

    const t1 = setTimeout(() => rippleAnims.forEach(a => a.start()),   360);
    const t2 = setTimeout(() => { shine1.start(); shine2.start(); },    840);
    const t3 = setTimeout(() => tipTwinkle.start(), 780);

    return () => {
      clearTimeout(tBrand); clearTimeout(tTag);
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      logoIn.stop(); pulse.stop(); orbit.stop();
      haloBreath.stop(); shine1.stop(); shine2.stop(); tipTwinkle.stop();
      rippleAnims.forEach(a => a.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orbitDeg = orbitRot.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  return (
    <View style={ss.shell}>

      {/* ── Deep wine gradient ─────────────────────────────── */}
      <LinearGradient
        colors={BG_GRADIENT}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.35, y: 0 }}
        end={{ x: 0.65, y: 1 }}
      />

      {/* ── Static concentric background rings (like EECM) ─── */}
      <View style={ss.bgRing1} pointerEvents="none" />
      <View style={ss.bgRing2} pointerEvents="none" />
      <View style={ss.bgRing3} pointerEvents="none" />

      {/* ── Corner arcs ──────────────────────────────────────── */}
      <View style={ss.arcTR} pointerEvents="none" />
      <View style={ss.arcBL} pointerEvents="none" />

      {/* ── Centre stage ─────────────────────────────────────── */}
      <View style={ss.stage}>

        {/* Gold halo ring — breathing */}
        <Animated.View
          style={[ss.haloRing, { transform: [{ scale: haloScale }], opacity: haloOp }]}
          pointerEvents="none"
        />

        {/* Orbit ring with two satellite dots */}
        <Animated.View
          style={[ss.orbitRing, { transform: [{ rotate: orbitDeg }], opacity: orbitOp }]}
          pointerEvents="none"
        >
          <View style={ss.orbitDotPrimary} />
          <View style={ss.orbitDotSecondary} />
        </Animated.View>

        {/* 3 ripple rings */}
        {ripples.map((r, i) => (
          <RippleRing key={i} scale={r.s} opacity={r.o} size={124} color={RIPPLE_COLORS[i]} />
        ))}

        {/* Warm glow disc behind badge */}
        <Animated.View
          style={[ss.glowDisc, { transform: [{ scale: glowScale }], opacity: glowOp }]}
          pointerEvents="none"
        />

        {/* ── Badge logo container ───────────────────────────
            Rounded-square badge with rose-gold gradient border
            and a dark wine interior — matching the EECM style.
            No rotation: logo displays correctly, shine sweeps
            diagonally across the badge face.
        ─────────────────────────────────────────────────── */}
        <Animated.View
          style={[
            ss.hexWrapper,
            {
              opacity: logoOp,
              // Chained scales compose as multiplication — avoids Animated.multiply native-driver bug
              transform: [{ scale: logoScale }, { scale: logoPulse }],
            },
          ]}
        >
          {/* Rose-gold gradient fills the full wrapper → visible border */}
          <LinearGradient
            colors={BORDER_GRAD}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={ss.hexBorderGrad}
          />

          {/* Dark interior card — logo sits on this dark surface */}
          <View style={ss.hexCard}>

            {/* Subtle inner ring for faceted depth */}
            <View style={ss.hexInnerRing} />

            {/* ── Logo image — clearly visible, no rotation ── */}
            <View style={ss.logoPlate}>
              <Image source={bundledBrandLogoSource} style={ss.logoImg} resizeMode="contain" />
              {!imageFailed ? (
                <Image
                  source={logoSrc}
                  style={[ss.logoImg, ss.logoImgOverlay]}
                  resizeMode="contain"
                  onError={() => setImageFailed(true)}
                />
              ) : null}
              {imageFailed ? <Text style={ss.badgeMark}>{badgeText}</Text> : null}
            </View>

            {/* Primary shine: narrow bright streak */}
            <Animated.View
              style={[ss.shine1Wrap, { transform: [{ translateX: shine1X }] }]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={[
                  'rgba(255,255,255,0)',
                  'rgba(255,255,255,0.55)',
                  'rgba(255,255,255,0)',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>

            {/* Secondary shine: wide warm glow pass */}
            <Animated.View
              style={[ss.shine2Wrap, { transform: [{ translateX: shine2X }] }]}
              pointerEvents="none"
            >
              <LinearGradient
                colors={[
                  'rgba(255,240,210,0)',
                  'rgba(255,240,210,0.28)',
                  'rgba(255,240,210,0)',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFillObject}
              />
            </Animated.View>

          </View>
        </Animated.View>

        {/* 4 cardinal sparkle points */}
        {TIP_DOTS.map((pos, i) => (
          <Animated.View
            key={i}
            style={[
              ss.tipSparkleWrap,
              pos,
              {
                opacity: tipOp,
                transform: [{ scale: tipScale }, { rotate: `${(i * 17)}deg` }],
              },
            ]}
            pointerEvents="none"
          >
            <MaterialCommunityIcons name="star-four-points" size={16} color="rgba(248, 222, 165, 0.96)" />
            <MaterialCommunityIcons
              name="star-four-points"
              size={8}
              color="rgba(255, 245, 215, 0.98)"
              style={ss.tipSparkleCore}
            />
          </Animated.View>
        ))}

      </View>{/* end stage */}

      {/* ── Text block ───────────────────────────────────────── */}
      <View style={ss.textWrap}>

        {/* Small rose-gold eyebrow label */}
        <Animated.Text style={[ss.eyebrow, { opacity: brandOp }]}>
          ✦{'   '}HAIR DONATION{'   '}✦
        </Animated.Text>

        {/* Brand name */}
        <Animated.Text
          style={[
            ss.brand,
            { opacity: brandOp, transform: [{ translateY: brandY }] },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {brandName}
        </Animated.Text>

        {/* Thin gold divider */}
        <Animated.View style={[ss.divider, { opacity: tagOp }]} />

        {/* Tagline — large, bright, clearly visible */}
        <Animated.Text style={[ss.tagline, { opacity: tagOp }]}>
          {tagline}
        </Animated.Text>

      </View>

      {/* Home-indicator pill */}
      <View style={ss.bottomPill} pointerEvents="none" />

    </View>
  );
}

// ─── Root navigation ───────────────────────────────────────────────────────
function RootLayoutNav() {
  const [showSplash, setShowSplash] = useState(true);
  const { databaseUserId, profile, resolvedTheme } = useAuth();

  useRoleRedirect();
  usePushNotifications({
    databaseUserId,
    role: profile?.role,
  });

  useEffect(() => {
    const hideNav = async () => {
      if (Platform.OS !== 'android') return;
      try { await NavigationBar.setVisibilityAsync('hidden'); } catch (_) { /* ok */ }
    };
    hideNav();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => clearTimeout(id);
  }, []);

  if (showSplash) return <LaunchSplash resolvedTheme={resolvedTheme} />;
  return <Slot />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <GluestackUIProvider mode="light">
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </GluestackUIProvider>
    </GestureHandlerRootView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({

  // ── Shell ─────────────────────────────────────────────────────
  shell: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
    backgroundColor: '#0d0205',   // matches gradient start — no flash
  },

  // ── Background concentric rings (like EECM's subtle radar rings) ──
  bgRing1: {
    position: 'absolute', width: 300, height: 300, borderRadius: 150,
    borderWidth: 1, borderColor: 'rgba(160, 55, 55, 0.18)',
    top: '50%', left: '50%', marginTop: -150, marginLeft: -150,
  },
  bgRing2: {
    position: 'absolute', width: 440, height: 440, borderRadius: 220,
    borderWidth: 1, borderColor: 'rgba(140, 45, 45, 0.11)',
    top: '50%', left: '50%', marginTop: -220, marginLeft: -220,
  },
  bgRing3: {
    position: 'absolute', width: 580, height: 580, borderRadius: 290,
    borderWidth: 1, borderColor: 'rgba(120, 38, 38, 0.06)',
    top: '50%', left: '50%', marginTop: -290, marginLeft: -290,
  },

  // ── Corner accent arcs ────────────────────────────────────────
  arcTR: {
    position: 'absolute', width: 320, height: 320, borderRadius: 160,
    borderWidth: 1, borderColor: 'rgba(200, 140, 90, 0.08)',
    top: -120, right: -110,
  },
  arcBL: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    borderWidth: 1, borderColor: 'rgba(200, 140, 90, 0.06)',
    bottom: -75, left: -75,
  },

  // ── Stage ─────────────────────────────────────────────────────
  stage: {
    width: STAGE_SIZE, height: STAGE_SIZE,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 50,
  },

  // Gold halo ring (outside the badge, breathes)
  haloRing: {
    position: 'absolute',
    width: 198, height: 198, borderRadius: 99,
    borderWidth: 1.5,
    borderColor: 'rgba(200, 155, 90, 0.40)',
  },

  // Orbit ring with 2 satellite dots rotating around the badge
  orbitRing: {
    position: 'absolute',
    width: 180, height: 180, borderRadius: 90,
    borderWidth: 1,
    borderColor: 'rgba(200, 155, 80, 0.20)',
  },
  orbitDotPrimary: {
    position: 'absolute',
    width: 9, height: 9, borderRadius: 4.5,
    backgroundColor: 'rgba(245, 220, 170, 0.95)',
    top: -4.5, left: 85.5,   // 12-o'clock: (180/2 - 4.5 = 85.5)
    shadowColor: '#f0d090', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95, shadowRadius: 6, elevation: 4,
  },
  orbitDotSecondary: {
    position: 'absolute',
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: 'rgba(240, 205, 145, 0.55)',
    bottom: -2.5, left: 87.5,  // 6-o'clock: (180/2 - 2.5 = 87.5)
  },

  rippleRing: { position: 'absolute', borderWidth: 1.5 },

  // Warm glow disc centered behind badge — brightened so badge area contrasts bg
  glowDisc: {
    position: 'absolute',
    width: 190, height: 190, borderRadius: 95,
    backgroundColor: 'rgba(155, 65, 35, 0.38)',
  },

  // ── Badge container ───────────────────────────────────────────
  // Two-layer approach:
  //   hexWrapper  — carries the shadow/elevation; overflow:hidden clips the
  //                 gradient to borderRadius on BOTH iOS and Android.
  //   hexBorderGrad — rose-gold LinearGradient fills the full wrapper.
  //   hexCard     — dark interior centered on top (10 px narrower each side).
  //
  // zIndex: 20 guarantees it renders above every absolute ring/glow in stage.
  hexWrapper: {
    width:           HEX_OUTER,
    height:          HEX_OUTER,
    borderRadius:    36,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',          // ← clips gradient to rounded corners on Android
    zIndex:          20,                // ← above halo/orbit/glow rings
    // Golden glow shadow (iOS; elevation handles Android)
    shadowColor:     '#c87030',
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.95,
    shadowRadius:    28,
    elevation:       32,
  },

  hexBorderGrad: {
    ...StyleSheet.absoluteFillObject,
    // borderRadius not needed here — parent overflow:hidden clips it
  },

  // Dark interior card — logo plate sits on this surface
  hexCard: {
    width:           HEX_INNER,
    height:          HEX_INNER,
    borderRadius:    32,
    backgroundColor: '#1e0508',        // dark wine — logo plate provides contrast
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',          // clips shine strips
    zIndex:          21,
  },

  // Subtle inner ring for jewel-facet depth
  hexInnerRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius:  30,
    borderWidth:   1,
    borderColor:   'rgba(200, 130, 70, 0.08)',
    margin:        2,
  },

  // Cream plate — white background ensures logo is visible regardless of
  // PNG transparency or logo colour on the dark card interior.
  logoPlate: {
    width:           138,
    height:          138,
    borderRadius:    34,
    backgroundColor: '#fffaf7',         // warm white — opaque, full contrast
    borderWidth:     1,
    borderColor:     'rgba(185, 130, 75, 0.40)',
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          22,                // top of the stack inside hexCard
  },
  logoImg: {
    width:  118,
    height: 118,
  },
  logoImgOverlay: {
    position: 'absolute',
  },

  // Fallback mark if image fails to load
  badgeMark: {
    fontSize:      58,
    lineHeight:    62,
    letterSpacing: 1.8,
    color:         '#f2efe8',
    fontWeight:    Platform.OS === 'android' ? '600' : '500',
    fontFamily: Platform.select({
      ios: 'Times New Roman',
      android: 'serif',
      default: 'serif',
    }),
    textAlign: 'center',
  },

  // ── Shines (clipped by hexCard overflow:hidden) ───────────────
  // Moving left→right on the dark card = diagonal-ish sweep on badge face
  shine1Wrap: {
    position: 'absolute', top: -70, width: 40, height: 280,
    opacity: 0.65,
  },
  shine2Wrap: {
    position: 'absolute', top: -70, width: 80, height: 280,
    opacity: 0.5,
  },

  // Tip sparkle points
  tipSparkleWrap: {
    position: 'absolute',
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#f3cb7f',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.95,
    shadowRadius: 10,
    elevation: 7,
  },
  tipSparkleCore: {
    position: 'absolute',
    opacity: 0.9,
  },

  // ── Text ─────────────────────────────────────────────────────
  textWrap: {
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 36,
  },

  // Small rose-gold eyebrow label above brand name
  eyebrow: {
    fontSize:      11,
    fontWeight:    '700',
    color:         'rgba(210, 160, 95, 0.90)',
    letterSpacing: 3.8,
    textAlign:     'center',
    textTransform: 'uppercase',
    marginBottom:  2,
  },

  // Brand name — large, warm white, letter-spaced like EECM
  brand: {
    fontSize:      56,
    lineHeight:    64,
    fontWeight:    '800',
    color:         '#ffffff',
    letterSpacing: 1.2,
    fontFamily: Platform.select({
      ios: 'AvenirNext-Bold',
      android: 'sans-serif-medium',
      default: 'System',
    }),
    textAlign:     'center',
  },

  // Thin gold divider between name and tagline
  divider: {
    width: 72, height: 1, borderRadius: 1,
    backgroundColor: 'rgba(210, 165, 100, 0.55)',
    marginVertical: 2,
  },

  // Tagline — CLEARLY VISIBLE, large, spaced like EECM "God Most High"
  tagline: {
    fontSize:      15,
    lineHeight:    22,
    fontWeight:    '400',
    color:         '#efe7df',
    letterSpacing: 2.1,
    fontFamily: Platform.select({
      ios: 'AvenirNext-Regular',
      android: 'sans-serif',
      default: 'System',
    }),
    textAlign:     'center',
  },

  // Home-indicator pill
  bottomPill: {
    position:        'absolute',
    bottom:          38,
    width: 46, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
});






