import React, { useState } from 'react';
import { View, TextInput, StyleSheet, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { AppIcon } from './AppIcon';
import { useAuth } from '../../providers/AuthProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const AnimatedView = Animated.createAnimatedComponent(View);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const PasswordInput = ({
  label = 'Password',
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
  toggleIconColor,
  ...props
}) => {
  const { resolvedTheme } = useAuth();
  const [isFocused, setIsFocused] = useState(false);
  const [isSecure, setIsSecure] = useState(true);
  const isFilled = variant === 'filled';
  const roles = resolveThemeRoles(resolvedTheme);
  const focusProgress = useSharedValue(0);
  const statusProgress = useSharedValue(error ? 1 : 0);
  const toggleScale = useSharedValue(1);
  const shakeX = useSharedValue(0);
  const focusColor = resolvedTheme?.primaryColor || theme.colors.borderFocus;
  const errorColor = resolvedTheme?.primaryColor || theme.colors.borderError;
  const primaryTextColor = resolvedTheme?.primaryTextColor || theme.colors.textPrimary;
  const secondaryTextColor = resolvedTheme?.secondaryTextColor || theme.colors.textSecondary;
  const mutedTextColor = theme.colors.textMuted;
  const filledBackgroundColor = roles.supportCardBackground;
  const defaultBackgroundColor = roles.defaultCardBackground;
  const restingBorderColor = isFilled ? roles.supportCardBorder : roles.defaultCardBorder;

  const shellStyle = useAnimatedStyle(() => ({
    borderColor: error
      ? interpolateColor(statusProgress.value, [0, 1], [focusColor, errorColor])
      : interpolateColor(
          focusProgress.value,
          [0, 1],
          [restingBorderColor, focusColor]
        ),
    shadowOpacity: focusProgress.value * 0.18,
    transform: [{ translateX: shakeX.value }],
  }));

  const toggleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: toggleScale.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: error
      ? errorColor
      : interpolateColor(focusProgress.value, [0, 1], [primaryTextColor, resolvedTheme?.primaryColor || theme.colors.borderFocus]),
  }));

  React.useEffect(() => {
    focusProgress.value = withTiming(isFocused ? 1 : 0, { duration: theme.motion.focus });
    statusProgress.value = withTiming(error ? 1 : 0, { duration: theme.motion.focus });
  }, [error, focusProgress, isFocused, statusProgress]);

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

  const handleToggle = () => {
    if (disabled) return;
    toggleScale.value = withSpring(0.92, theme.motion.spring, () => {
      toggleScale.value = withSpring(1, theme.motion.spring);
    });
    setIsSecure((prev) => !prev);
    Haptics.selectionAsync().catch(() => {});
  };

  return (
    <AnimatedView style={[styles.container, style]}>
      {label ? (
        <Animated.Text style={[styles.label, labelStyle, labelStyleOverride]}>
          {label}
        </Animated.Text>
      ) : null}
      <AnimatedView
        style={[
          styles.inputContainer,
          shellStyle,
          {
            backgroundColor: disabled
              ? theme.colors.surfaceDisabled
              : isFilled
                ? filledBackgroundColor
                : defaultBackgroundColor,
          },
          shellStyleOverride,
          isFocused ? styles.inputFocused : null,
        ]}
      >
        {leftIcon ? (
          <MaterialCommunityIcons
            name={leftIcon}
            size={18}
            color={leftIconColor || secondaryTextColor}
            style={styles.leftIcon}
          />
        ) : null}
        <TextInput
          style={[
            styles.input,
            leftIcon ? styles.inputWithIcon : null,
            { color: disabled ? theme.colors.textDisabled : primaryTextColor },
            inputStyle,
          ]}
          placeholderTextColor={mutedTextColor}
          secureTextEntry={isSecure}
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
        <AnimatedPressable onPress={handleToggle} style={toggleStyle}>
          <View style={styles.toggleIconWrap}>
            <AppIcon
              name={isSecure ? 'eye' : 'eyeOff'}
              size="sm"
              state="muted"
              color={toggleIconColor || undefined}
            />
          </View>
        </AnimatedPressable>
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
  inputContainer: {
    minHeight: theme.inputs.minHeightCompact,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: theme.radius.xl,
    shadowColor: theme.colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  inputFocused: {
    ...theme.shadows.soft,
  },
  leftIcon: {
    marginLeft: theme.spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.body,
    paddingHorizontal: theme.spacing.inputPaddingXCompact,
    paddingVertical: theme.spacing.inputPaddingYCompact,
  },
  inputWithIcon: {
    paddingLeft: theme.spacing.sm,
  },
  toggleIconWrap: {
    width: 40,
    height: 40,
    marginRight: theme.spacing.xs,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.transparent,
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
