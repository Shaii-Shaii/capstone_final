import React from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { AppIcon } from './AppIcon';
import { theme, resolveThemeRoles } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';
import { donorDashboardNavItems } from '../../constants/dashboard';

export const DASHBOARD_TAB_BAR_HEIGHT = 72;

const BUBBLE_SIZE = 54;
const BUBBLE_CORE_SIZE = 46;
const INACTIVE_ICON_WRAP_SIZE = 32;
const BAR_TOP = 17;
const NOTCH_RADIUS = 32;
const NOTCH_DEPTH = 29;
const PILL_RADIUS = 24;
const PILL_MARGIN = 12;
const ICON_WRAP_TOP = BAR_TOP + 1;
const CURVE_KAPPA = 0.5522847498;

const SPRING_BUBBLE = { damping: 14, stiffness: 210, mass: 0.75 };
const SPRING_SLIDE = { damping: 22, stiffness: 260, mass: 0.8 };
const SPRING_PRESS = { damping: 18, stiffness: 300 };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedPath = Animated.createAnimatedComponent(Path);

function buildLiquidPillPath(width, height, notchCenterX = null) {
  'worklet';
  const safeWidth = Math.max(width, height);
  const bottomRadius = Math.min(PILL_RADIUS, (height - BAR_TOP) / 2);
  const hasNotch = Number.isFinite(notchCenterX) && notchCenterX >= 0;
  const notchRadius = Math.min(NOTCH_RADIUS, Math.max(0, safeWidth / 2 - 6));
  const minCenterX = notchRadius + bottomRadius;
  const maxCenterX = safeWidth - notchRadius - bottomRadius;
  const centerX = hasNotch
    ? Math.min(Math.max(notchCenterX, minCenterX), maxCenterX)
    : null;
  const notchStartX = hasNotch ? centerX - notchRadius : null;
  const notchEndX = hasNotch ? centerX + notchRadius : null;
  const notchControl = notchRadius * CURVE_KAPPA;
  const path = [`M ${bottomRadius} ${BAR_TOP}`];

  if (hasNotch) {
    path.push(`L ${notchStartX} ${BAR_TOP}`);
    path.push(
      `C ${notchStartX + notchControl * 0.18} ${BAR_TOP} ${centerX - notchControl} ${BAR_TOP + NOTCH_DEPTH} ${centerX} ${BAR_TOP + NOTCH_DEPTH}`
    );
    path.push(
      `C ${centerX + notchControl} ${BAR_TOP + NOTCH_DEPTH} ${notchEndX - notchControl * 0.18} ${BAR_TOP} ${notchEndX} ${BAR_TOP}`
    );
  }

  path.push(
    `L ${safeWidth - bottomRadius} ${BAR_TOP}`,
    `Q ${safeWidth} ${BAR_TOP} ${safeWidth} ${BAR_TOP + bottomRadius}`,
    `L ${safeWidth} ${height - bottomRadius}`,
    `Q ${safeWidth} ${height} ${safeWidth - bottomRadius} ${height}`,
    `L ${bottomRadius} ${height}`,
    `Q 0 ${height} 0 ${height - bottomRadius}`,
    `L 0 ${BAR_TOP + bottomRadius}`,
    `Q 0 ${BAR_TOP} ${bottomRadius} ${BAR_TOP}`,
    'Z'
  );

  return path.join(' ');
}

function DashboardTabItem({ item, isActive, onPress }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);

  const progress = useSharedValue(isActive ? 1 : 0);
  const pressScale = useSharedValue(1);

  React.useEffect(() => {
    progress.value = withSpring(isActive ? 1 : 0, SPRING_BUBBLE);
  }, [isActive, progress]);

  const iconWrapStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [1, 0]),
    transform: [
      { scale: pressScale.value },
    ],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: roles.primaryActionText,
    opacity: interpolate(progress.value, [0, 1], [0.82, 1]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -1]) },
    ],
  }));

  const handlePress = async () => {
    if (isActive) return;
    await Haptics.selectionAsync();
    onPress?.(item);
  };

  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={item.accessibilityLabel || item.label}
      onPress={handlePress}
      onPressIn={() => {
        pressScale.value = withSpring(0.88, SPRING_PRESS);
      }}
      onPressOut={() => {
        pressScale.value = withSpring(1, SPRING_PRESS);
      }}
      style={styles.tabItem}
    >
      <Animated.View style={[styles.iconWrap, { top: ICON_WRAP_TOP }, iconWrapStyle]}>
        <AppIcon
          name={item.icon}
          state="default"
          color={roles.primaryActionText}
          size="md"
        />
        {item.badge ? (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: roles.primaryActionText,
                borderColor: roles.primaryActionBackground,
              },
            ]}
          >
            <Text style={[styles.badgeText, { color: roles.primaryActionBackground }]}>
              {item.badge}
            </Text>
          </View>
        ) : null}
      </Animated.View>

      <Animated.Text
        numberOfLines={1}
        style={[styles.label, isActive && styles.activeLabel, labelStyle]}
      >
        {item.label}
      </Animated.Text>
    </AnimatedPressable>
  );
}

function FloatingActiveBubble({ item, activeCenterX }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const liquidPulse = useSharedValue(1);

  React.useEffect(() => {
    liquidPulse.value = withSequence(
      withTiming(0.9, { duration: 90 }),
      withSpring(1.08, { damping: 10, stiffness: 240 }),
      withSpring(1, SPRING_BUBBLE)
    );
  }, [item?.key, liquidPulse]);

  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: activeCenterX.value >= 0 ? 1 : 0,
    transform: [
      { translateX: activeCenterX.value - BUBBLE_SIZE / 2 },
      { translateY: interpolate(liquidPulse.value, [0.9, 1.08], [3, -2]) },
      { scale: liquidPulse.value },
    ],
  }));

  if (!item) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.floatingBubble, bubbleStyle]}
    >
      <View
        style={[
          styles.bubbleBg,
          {
            backgroundColor: roles.pageBackground,
            borderColor: roles.pageBackground,
          },
        ]}
      />
      <View
        style={[
          styles.activeIconSlot,
          { backgroundColor: roles.primaryActionBackground },
        ]}
      >
        <AppIcon
          name={item.activeIcon || item.icon}
          state="default"
          color={roles.primaryActionText}
          size="md"
        />
      </View>
      {item.badge ? (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: roles.primaryActionText,
              borderColor: roles.primaryActionBackground,
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: roles.primaryActionBackground }]}>
            {item.badge}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

function DashboardTabBarComponent({ items, activeKey, onPress, variant = 'donor' }) {
  const { resolvedTheme } = useAuth();
  const roles = resolveThemeRoles(resolvedTheme);
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const pressLockRef = React.useRef(false);
  const [measuredWidth, setMeasuredWidth] = React.useState(0);

  const displayItems = React.useMemo(() => {
    if (variant !== 'donor') return items;
    return donorDashboardNavItems.map((navItem) => ({
      ...navItem,
      badge: items.find((i) => i.key === navItem.key)?.badge,
    }));
  }, [items, variant]);

  const numTabs = displayItems.length;
  const pillWidth = measuredWidth || Math.max(0, screenWidth - PILL_MARGIN * 2);
  const tabWidth = numTabs > 0 ? pillWidth / numTabs : 0;
  const activeIndex = displayItems.findIndex((item) => item.key === activeKey);
  const activeCenterX = activeIndex >= 0
    ? activeIndex * tabWidth + tabWidth / 2
    : null;
  const activeItem = activeIndex >= 0 ? displayItems[activeIndex] : null;
  const activeCenterXProgress = useSharedValue(activeCenterX ?? -1);
  const pillPathProps = useAnimatedProps(() => ({
    d: buildLiquidPillPath(pillWidth, DASHBOARD_TAB_BAR_HEIGHT, activeCenterXProgress.value),
  }), [pillWidth]);
  const safeBottom = Math.max(insets.bottom, 0);
  const isPatientNav = variant === 'patient';
  const bottomOffset = isPatientNav ? -safeBottom + theme.spacing.xs : safeBottom + theme.spacing.sm;

  React.useEffect(() => {
    activeCenterXProgress.value = withSpring(activeCenterX ?? -1, SPRING_SLIDE);
  }, [activeCenterX, activeCenterXProgress]);

  if (!numTabs) return null;

  return (
    <View
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (nextWidth > 0 && Math.abs(nextWidth - measuredWidth) > 0.5) {
          setMeasuredWidth(nextWidth);
        }
      }}
      style={[
        styles.wrapper,
        {
          bottom: bottomOffset,
          height: DASHBOARD_TAB_BAR_HEIGHT + (isPatientNav ? safeBottom : 0),
          backgroundColor: 'transparent',
        },
      ]}
      pointerEvents="box-none"
    >
      <Svg
        width={pillWidth}
        height={DASHBOARD_TAB_BAR_HEIGHT}
        pointerEvents="none"
        style={styles.pillShape}
      >
        <AnimatedPath
          animatedProps={pillPathProps}
          d={buildLiquidPillPath(pillWidth, DASHBOARD_TAB_BAR_HEIGHT, activeCenterX ?? -1)}
          fill={roles.primaryActionBackground}
          stroke={roles.primaryActionBackground}
          strokeWidth={0.5}
        />
      </Svg>

      <View style={styles.pillOverlay}>
        <FloatingActiveBubble item={activeItem} activeCenterX={activeCenterXProgress} />
        {displayItems.map((item) => (
          <DashboardTabItem
            key={item.key}
            item={item}
            isActive={item.key === activeKey}
            onPress={(pressedItem) => {
              if (pressLockRef.current) return;
              pressLockRef.current = true;
              onPress?.(pressedItem);
              setTimeout(() => {
                pressLockRef.current = false;
              }, 400);
            }}
          />
        ))}
      </View>
    </View>
  );
}

export const DashboardTabBar = React.memo(DashboardTabBarComponent);

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: PILL_MARGIN,
    right: PILL_MARGIN,
    zIndex: 30,
    height: DASHBOARD_TAB_BAR_HEIGHT,
    overflow: 'visible',
  },
  pillShape: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'visible',
    shadowColor: '#18000a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 12,
  },
  pillOverlay: {
    flexDirection: 'row',
    height: DASHBOARD_TAB_BAR_HEIGHT,
    overflow: 'visible',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    height: DASHBOARD_TAB_BAR_HEIGHT,
    overflow: 'visible',
    zIndex: 1,
  },
  iconWrap: {
    position: 'absolute',
    width: INACTIVE_ICON_WRAP_SIZE,
    height: INACTIVE_ICON_WRAP_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingBubble: {
    position: 'absolute',
    top: BAR_TOP - BUBBLE_SIZE / 2,
    left: 0,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    zIndex: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BUBBLE_SIZE / 2,
    borderWidth: 3,
    shadowColor: '#25040a',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 9,
  },
  activeIconSlot: {
    width: BUBBLE_CORE_SIZE,
    height: BUBBLE_CORE_SIZE,
    borderRadius: BUBBLE_CORE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    bottom: 6,
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.semibold,
    letterSpacing: 0,
  },
  activeLabel: {
    fontWeight: theme.typography.weights.bold,
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: theme.radius.full,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  badgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 9,
    fontWeight: theme.typography.weights.bold,
  },
});
