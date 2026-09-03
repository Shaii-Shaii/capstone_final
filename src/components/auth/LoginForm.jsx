import React from 'react';
import { Pressable, View, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppInput } from '../ui/AppInput';
import { PasswordInput } from '../ui/PasswordInput';
import { AppButton } from '../ui/AppButton';
import { StatusBanner } from '../ui/StatusBanner';
import { loginSchema } from '../../features/auth/validators/auth.schema';
import { resolveThemeRoles, theme } from '../../design-system/theme';

export const LoginForm = ({
  onSubmit,
  isLoading,
  activeAuthAction = '',
  onForgotPassword,
  buttonText = 'Log in',
  submitError = '',
  submitErrorCode = '',
  isLoginLocked = false,
  onFieldEdit,
  onFieldFocus,
  autofillEmail = '',
  resolvedTheme,
  emailLabel = 'Email Address',
  passwordLabel = 'Password',
  containerStyle,
  fieldLabelStyle,
  fieldShellStyle,
  fieldInputStyle,
  forgotPasswordStyle,
  submitButtonStyle,
  submitButtonTextStyle,
  disableAutofill = false,
  submitGradientBorderColors,
  submitGradientFillColors,
}) => {
  const { control, handleSubmit, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
    defaultValues: {
      email: '',
      password: '',
    },
  });
  const roles = resolveThemeRoles(resolvedTheme);
  const isConnectionError = [
    'REQUEST_TIMEOUT',
    'NETWORK_ERROR',
    'ACCOUNT_LOAD_FAILED',
    'LOGIN_SECURITY_UNAVAILABLE',
  ].includes(submitErrorCode);
  const isSubmitLoading = isLoading && activeAuthAction === 'login';

  React.useEffect(() => {
    if (!autofillEmail) return;
    setValue('email', autofillEmail, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    onFieldEdit?.('email', autofillEmail);
  }, [autofillEmail, onFieldEdit, setValue]);

  const submitButtonNode = (
    <AppButton
      title={buttonText}
      onPress={handleSubmit((values) => {
        onFieldEdit?.();
        return onSubmit(values);
      })}
      loading={isSubmitLoading}
      disabled={isLoading || isLoginLocked}
      variant="outline"
      size="lg"
      enableHaptics={true}
      style={[
        styles.submitBtn,
        submitGradientBorderColors?.length ? styles.submitBtnInset : null,
        submitButtonStyle,
      ]}
      textStyle={[styles.submitBtnText, submitButtonTextStyle]}
      textColorOverride={roles.primaryActionText}
      backgroundColorOverride={submitGradientFillColors?.length ? 'transparent' : roles.primaryActionBackground}
      borderColorOverride={submitGradientFillColors?.length ? 'transparent' : roles.primaryActionBackground}
    />
  );

  const submitButtonWithFill = submitGradientFillColors?.length ? (
    <LinearGradient
      colors={submitGradientFillColors}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={styles.submitGradientFill}
    >
      <LinearGradient
        colors={[
          'rgba(255, 246, 222, 0)',
          'rgba(255, 246, 222, 0.18)',
          'rgba(255, 246, 222, 0)',
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.submitDiagonalShine}
      />
      {submitButtonNode}
    </LinearGradient>
  ) : submitButtonNode;

  return (
    <View style={[styles.container, containerStyle]}>
      {submitError && submitErrorCode === 'ACCOUNT_LOCKED' ? (
        <StatusBanner
          title="Account temporarily locked"
          message={submitError.replace(/^Account temporarily locked\.\s*/i, '')}
          variant="error"
          icon="lock-alert-outline"
          style={styles.lockoutBanner}
        />
      ) : submitError && isConnectionError ? (
        <StatusBanner
          title="System maintenance"
          message={submitError}
          variant="error"
          icon="tools"
          style={styles.lockoutBanner}
        />
      ) : submitError ? (
        <Text style={styles.submitErrorText}>
          {submitError}
        </Text>
      ) : null}

      <View style={styles.fieldGroup}>
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <AppInput
              label={emailLabel}
              placeholder="donor@example.com"
              placeholderTextColor={roles.headingText}
              leftIcon="email-outline"
              leftIconColor={roles.primaryActionBackground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="emailAddress"
              autoComplete="email"
              importantForAutofill={disableAutofill ? 'no' : 'auto'}
              onBlur={onBlur}
              onFocus={() => onFieldFocus?.('email')}
              onChangeText={(nextValue) => {
                onFieldEdit?.('email', nextValue);
                onChange(nextValue);
              }}
              value={value}
              error={errors.email?.message}
              disabled={isLoading}
              style={styles.field}
              labelStyle={[styles.fieldLabel, { color: roles.headingText }, fieldLabelStyle]}
              shellStyle={[styles.fieldShell, { borderColor: roles.defaultCardBorder, backgroundColor: roles.defaultCardBackground }, fieldShellStyle]}
              inputStyle={[styles.fieldInput, { color: roles.headingText }, fieldInputStyle]}
            />
          )}
        />

        <View style={styles.passwordHeaderRow}>
          <Text style={[styles.fieldLabel, { color: roles.headingText }, fieldLabelStyle]}>{passwordLabel}</Text>
        </View>

        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <PasswordInput
              label=""
              placeholder="Password"
              placeholderTextColor={roles.headingText}
              leftIcon="lock-outline"
              leftIconColor={roles.primaryActionBackground}
              toggleIconColor={roles.primaryActionBackground}
              textContentType={disableAutofill ? 'none' : 'password'}
              autoComplete={disableAutofill ? 'off' : 'password'}
              importantForAutofill={disableAutofill ? 'no' : 'auto'}
              onBlur={onBlur}
              onFocus={() => onFieldFocus?.('password')}
              onChangeText={(nextValue) => {
                onFieldEdit?.('password', nextValue);
                onChange(nextValue);
              }}
              value={value}
              error={errors.password?.message}
              disabled={isLoading}
              style={[styles.field, styles.passwordFieldCompact]}
              labelStyle={[styles.fieldLabel, { color: roles.headingText }, fieldLabelStyle]}
              shellStyle={[styles.fieldShell, { borderColor: roles.defaultCardBorder, backgroundColor: roles.defaultCardBackground }, fieldShellStyle]}
              inputStyle={[styles.fieldInput, { color: roles.headingText }, fieldInputStyle]}
            />
          )}
        />

        <View style={styles.forgotPasswordRow}>
          <Pressable
            onPress={onForgotPassword}
            style={({ pressed }) => [styles.forgotPasswordPressable, pressed ? styles.pressed : null]}
            accessibilityRole="button"
          >
            <Text style={[styles.forgotPasswordText, { color: roles.primaryActionBackground }, forgotPasswordStyle]}>Forgot password</Text>
          </Pressable>
        </View>
      </View>

      {submitGradientBorderColors?.length ? (
        <LinearGradient
          colors={submitGradientBorderColors}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.submitGradientBorder}
        >
          {submitButtonWithFill}
        </LinearGradient>
      ) : submitButtonWithFill}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  fieldGroup: {
    gap: theme.spacing.sm,
  },
  field: {
    marginBottom: 0,
  },
  fieldLabel: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.weights.semibold,
  },
  fieldShell: {
    minHeight: 48,
    borderRadius: theme.radius.lg,
    shadowOpacity: 0,
    elevation: 0,
  },
  fieldInput: {
    fontSize: theme.typography.semantic.body,
  },
  submitErrorText: {
    marginBottom: theme.spacing.md,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textError,
  },
  lockoutBanner: {
    marginBottom: theme.spacing.md,
  },
  passwordHeaderRow: {
    marginTop: theme.spacing.xs,
    marginBottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: theme.spacing.md,
  },
  forgotPasswordRow: {
    marginTop: -4,
    marginBottom: 4,
    alignItems: 'flex-end',
  },
  passwordFieldCompact: {
    minHeight: 56,
    marginBottom: 0,
  },
  forgotPasswordPressable: {
    minHeight: 28,
    justifyContent: 'center',
  },
  forgotPasswordText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.regular,
  },
  submitBtn: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 0,
    marginTop: theme.spacing.sm,
  },
  submitBtnInset: {
    marginTop: 0,
  },
  submitGradientBorder: {
    marginTop: theme.spacing.sm,
    borderRadius: 16,
    padding: 3,
    overflow: 'hidden',
    shadowColor: '#c8864f',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 5,
  },
  submitGradientFill: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  submitDiagonalShine: {
    position: 'absolute',
    top: -54,
    left: 20,
    width: 40,
    height: 190,
    transform: [{ rotate: '22deg' }],
  },
  submitBtnText: {
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.4,
  },
  pressed: {
    opacity: 0.72,
  },
});
