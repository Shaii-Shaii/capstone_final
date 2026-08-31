import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { useAuth } from '../../providers/AuthProvider';

const AnimatedView = Animated.createAnimatedComponent(View);

const INPUT_VARIANTS = {
  default: {
    backgroundColor: theme.colors.surfaceCard,
    borderColor: theme.colors.borderSubtle,
  },
  filled: {
    backgroundColor: theme.colors.surfaceSoft,
    borderColor: theme.colors.transparent,
  },
};

export const AppInput = ({
  label,
  required = false,
  error,
  helperText,
  variant = 'default',
  disabled = false,
  style,
  inputStyle,
  labelStyle: labelStyleOverride,
  shellStyle: shellStyleOverride,
  helperTextStyle: helperTextStyleOverride,
  errorTextStyle: errorTextStyleOverride,
  leftIcon,
  leftIconColor,
  leftIconContainerStyle,
  ...props
}) => {
  const { resolvedTheme } = useAuth();
  const [isFocused, setIsFocused] = useState(false);
  const config = INPUT_VARIANTS[variant] || INPUT_VARIANTS.default;
  const roles = resolveThemeRoles(resolvedTheme);
  const focusProgress = useSharedValue(0);
  const statusProgress = useSharedValue(error ? 1 : 0);
  const shakeX = useSharedValue(0);
  const focusColor = resolvedTheme?.primaryColor || theme.colors.borderFocus;
  const errorColor = resolvedTheme?.primaryColor || theme.colors.borderError;
  const primaryTextColor = resolvedTheme?.primaryTextColor || theme.colors.textPrimary;
  const secondaryTextColor = resolvedTheme?.secondaryTextColor || theme.colors.textSecondary;
  const mutedTextColor = resolvedTheme?.secondaryTextColor || theme.colors.textMuted;
  const backgroundColor = variant === 'filled'
    ? roles.supportCardBackground
    : roles.defaultCardBackground || config.backgroundColor;
  const restingBorderColor = variant === 'filled'
    ? roles.supportCardBorder
    : roles.defaultCardBorder || config.borderColor;

  const shellStyle = useAnimatedStyle(() => ({
    borderColor: error
      ? interpolateColor(statusProgress.value, [0, 1], [focusColor, errorColor])
      : interpolateColor(focusProgress.value, [0, 1], [restingBorderColor, focusColor]),
    shadowOpacity: focusProgress.value * 0.18,
    transform: [{ translateX: shakeX.value }, { scale: 1 - focusProgress.value * 0.002 }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: error
      ? errorColor
      : interpolateColor(focusProgress.value, [0, 1], [primaryTextColor, resolvedTheme?.primaryColor || theme.colors.borderFocus]),
    transform: [{ translateY: focusProgress.value * -1 }],
  }));

  React.useEffect(() => {
    focusProgress.value = withTiming(isFocused ? 1 : 0, { duration: theme.motion.focus });
    statusProgress.value = withTiming(error ? 1 : 0, { duration: theme.motion.focus });
  }, [error, focusProgress, isFocused, restingBorderColor, statusProgress]);

  React.useEffect(() => {
    if (!error) return;
    shakeX.value = withSequence(
      withTiming(-6, { duration: theme.motion.shake }),
      withTiming(6, { duration: theme.motion.shake }),
      withTiming(-4, { duration: theme.motion.shake }),
      withTiming(4, { duration: theme.motion.shake }),
      withTiming(0, { duration: theme.motion.shake })
    );
  }, [error, shakeX]);

  return (
    <AnimatedView style={[styles.container, style]}>
      {label ? (
        <Animated.Text style={[styles.label, labelStyle, labelStyleOverride]}>
          {label}
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Animated.Text>
      ) : null}
      <AnimatedView
        style={[
          styles.inputShell,
          shellStyle,
          {
            backgroundColor: disabled ? theme.colors.surfaceDisabled : backgroundColor,
          },
          shellStyleOverride,
          disabled && styles.disabledShell,
          isFocused && styles.focusedShell,
        ]}
      >
        {leftIcon ? (
          <View style={[styles.leftIconWrap, leftIconContainerStyle]} pointerEvents="none">
            <MaterialCommunityIcons
              name={leftIcon}
              size={18}
              color={leftIconColor || secondaryTextColor}
            />
          </View>
        ) : null}
        <TextInput
          style={[
            styles.input,
            leftIcon ? styles.inputWithIcon : null,
            {
              color: disabled ? theme.colors.textDisabled : primaryTextColor,
            },
            inputStyle,
          ]}
          placeholderTextColor={mutedTextColor}
          editable={!disabled}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />
      </AnimatedView>
      {error ? (
        <Animated.Text style={[styles.errorText, errorTextStyleOverride]}>
          {error}
        </Animated.Text>
      ) : helperText ? (
        <Animated.Text style={[styles.helperText, { color: secondaryTextColor }, helperTextStyleOverride]}>
          {helperText}
        </Animated.Text>
      ) : null}
    </AnimatedView>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: theme.spacing.sm,
    minHeight: 82,
  },
  label: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.label,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  requiredMark: {
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.bold,
  },
  inputShell: {
    minHeight: theme.inputs.minHeightCompact,
    borderWidth: 1,
    borderRadius: theme.radius.xl,
    justifyContent: 'center',
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  leftIconWrap: {
    position: 'absolute',
    left: theme.spacing.md,
    top: 0,
    width: 20,
    height: theme.inputs.minHeightCompact,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  focusedShell: {
    ...theme.shadows.soft,
  },
  disabledShell: {
    borderColor: theme.colors.borderDisabled,
  },
  input: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    paddingHorizontal: theme.spacing.inputPaddingXCompact,
    paddingVertical: theme.spacing.inputPaddingYCompact,
  },
  inputWithIcon: {
    paddingLeft: 56,
  },
  helperText: {
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textSecondary,
  },
  errorText: {
    marginTop: 3,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    color: theme.colors.textError,
    fontWeight: theme.typography.weights.medium,
  },
});
