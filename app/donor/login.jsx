import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthScreenLayout, authLayoutStyles } from '../../src/components/auth/AuthScreenLayout';
import { AuthHeader } from '../../src/components/auth/AuthHeader';
import { AuthFormFooter } from '../../src/components/auth/AuthFormFooter';
import { LoginForm } from '../../src/components/auth/LoginForm';
import { useRoleAuthFlow } from '../../src/hooks/useRoleAuthFlow';

export default function DonorLoginScreen() {
  const router = useRouter();
  const { config, handleLogin, handleGoogleAuth, isLoading, activeAuthAction, loginError, loginErrorCode, isLoginLocked, clearLoginError, resolvedTheme } = useRoleAuthFlow('donor');

  return (
    <AuthScreenLayout role="donor" resolvedTheme={resolvedTheme}>
      <AuthHeader
        title={config.login.title}
        subtitle={config.login.subtitle}
        eyebrow={config.login.eyebrow}
        role="donor"
        backLabel="Back to access"
        onBackPress={() => router.back()}
        resolvedTheme={resolvedTheme}
      />

      <View style={authLayoutStyles.formSection}>
        <LoginForm
          onSubmit={handleLogin}
          isLoading={isLoading}
          activeAuthAction={activeAuthAction}
          onForgotPassword={() => router.push('/auth/forgot-password')}
          buttonText={config.login.buttonText}
          submitError={loginError}
          submitErrorCode={loginErrorCode}
          isLoginLocked={isLoginLocked}
          onFieldEdit={clearLoginError}
          resolvedTheme={resolvedTheme}
          onGooglePress={handleGoogleAuth}
        />
      </View>

      <AuthFormFooter
        questionText={config.login.footerQuestion}
        linkText={config.login.footerLink}
        onLinkPress={() => router.replace('/auth/signup')}
      />
    </AuthScreenLayout>
  );
}
