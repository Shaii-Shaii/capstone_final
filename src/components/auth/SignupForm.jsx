import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppInput } from '../ui/AppInput';
import { PasswordInput } from '../ui/PasswordInput';
import { AppButton } from '../ui/AppButton';
import { AppIcon } from '../ui/AppIcon';
import { resolveThemeRoles, theme } from '../../design-system/theme';
import { signupDefaultValues } from '../../features/auth/validators/auth.schema';
import { fetchActiveLegalDocument, fetchActiveLegalDocuments } from '../../features/donorCompliance.service';

const termsLabel = 'Terms of Service and Privacy Policy';
const SIGNUP_BORDER_GRAD = [
  '#5f2f12',
  '#8e4f24',
  '#c8864f',
  '#ffe7ac',
  '#c8864f',
  '#8e4f24',
  '#5f2f12',
];
const SIGNUP_FILL_GRAD = [
  '#8a111d',
  '#740c15',
  '#5c0910',
];

const resolvePdfViewer = () => {
  if (Constants?.appOwnership === 'expo') {
    return null;
  }

  try {
    const pdfModule = require('react-native-pdf');
    return pdfModule?.default || pdfModule;
  } catch (_error) {
    return null;
  }
};

const Pdf = resolvePdfViewer();

function LegalDetailsModal({ visible, onClose, onAccept, roles, document, error, isLoading, onOpenPdf }) {
  const title = document?.title || termsLabel;
  const pdfUrl = document?.pdf_url || '';
  const hasPdfFile = Boolean(document?.file_path || pdfUrl);
  const [pdfRenderState, setPdfRenderState] = React.useState('idle');
  const [pdfRenderError, setPdfRenderError] = React.useState('');

  React.useEffect(() => {
    if (!visible) return;
    setPdfRenderState(pdfUrl && Pdf ? 'loading' : 'idle');
    setPdfRenderError('');
  }, [visible, pdfUrl, document?.legal_document_id]);

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: roles.defaultCardBackground,
              borderColor: roles.defaultCardBorder,
            },
          ]}
        >
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleBlock}>
              <Text style={[styles.modalEyebrow, { color: roles.primaryActionBackground }]}>Before you sign up</Text>
              <Text style={[styles.modalTitle, { color: roles.headingText }]}>{title}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close terms and privacy notice"
              onPress={onClose}
              style={({ pressed }) => [styles.modalCloseButton, pressed ? styles.pressed : null]}
            >
              <AppIcon name="closeCircle" size="md" state="muted" />
            </Pressable>
          </View>

          <View
            style={[
              styles.pdfContainer,
              {
                backgroundColor: roles.defaultCardBackground,
                borderColor: roles.defaultCardBorder,
              },
            ]}
          >
            {isLoading ? (
              <View style={styles.pdfState}>
                <ActivityIndicator color={roles.primaryActionBackground} />
                <Text style={[styles.pdfStateText, { color: roles.headingText }]}>Loading document...</Text>
              </View>
            ) : error ? (
              <View style={styles.pdfState}>
                <AppIcon name="error" size="lg" color={theme.colors.textError} />
                <Text style={[styles.pdfStateTitle, { color: roles.headingText }]}>Document unavailable</Text>
                <Text style={[styles.pdfStateText, { color: roles.headingText }]}>{error}</Text>
              </View>
            ) : pdfUrl && Pdf ? (
              <>
                <Pdf
                  source={{ uri: pdfUrl, cache: true }}
                  style={[styles.pdfViewer, { backgroundColor: roles.defaultCardBackground }]}
                  trustAllCerts={false}
                  onLoadComplete={() => {
                    setPdfRenderState('ready');
                    setPdfRenderError('');
                  }}
                  onError={(pdfError) => {
                    setPdfRenderState('error');
                    setPdfRenderError(String(pdfError?.message || pdfError || 'PDF viewer failed to render this file.'));
                  }}
                  onLoadProgress={(percent) => {
                    if (Number(percent) >= 0.05 && pdfRenderState === 'loading') {
                      setPdfRenderState('rendering');
                    }
                  }}
                />
                {pdfRenderState !== 'ready' ? (
                  <View style={[styles.pdfOverlayState, { backgroundColor: roles.defaultCardBackground }]}>
                    {pdfRenderState === 'error' ? (
                      <>
                        <AppIcon name="error" size="lg" color={theme.colors.textError} />
                        <Text style={[styles.pdfStateTitle, { color: roles.headingText }]}>PDF file unavailable</Text>
                        <Text style={[styles.pdfStateText, { color: roles.headingText }]}>
                          {pdfRenderError || 'The PDF could not be rendered inside the app viewer.'}
                        </Text>
                        <AppButton
                          title="Open in browser"
                          onPress={onOpenPdf}
                          backgroundColorOverride={roles.primaryActionBackground}
                          textColorOverride={roles.primaryActionText}
                          borderColorOverride={roles.primaryActionBackground}
                          style={styles.openPdfButton}
                        />
                      </>
                    ) : (
                      <>
                        <ActivityIndicator color={roles.primaryActionBackground} />
                        <Text style={[styles.pdfStateText, { color: roles.headingText }]}>Opening PDF...</Text>
                      </>
                    )}
                  </View>
                ) : null}
              </>
            ) : pdfUrl ? (
              <View style={styles.pdfState}>
                <AppIcon name="error" size="lg" color={theme.colors.textError} />
                <Text style={[styles.pdfStateTitle, { color: roles.headingText }]}>PDF viewer unavailable</Text>
                <Text style={[styles.pdfStateText, { color: roles.headingText }]}>
                  Open this document in your browser to review it.
                </Text>
                <AppButton
                  title="Open in browser"
                  onPress={onOpenPdf}
                  backgroundColorOverride={roles.primaryActionBackground}
                  textColorOverride={roles.primaryActionText}
                  borderColorOverride={roles.primaryActionBackground}
                  style={styles.openPdfButton}
                />
              </View>
            ) : hasPdfFile ? (
              <View style={styles.pdfState}>
                <AppIcon name="error" size="lg" color={theme.colors.textError} />
                <Text style={[styles.pdfStateTitle, { color: roles.headingText }]}>PDF file unavailable</Text>
                <Text style={[styles.pdfStateText, { color: roles.headingText }]}>
                  The document record exists, but the uploaded PDF file could not be opened.
                </Text>
                <AppButton
                  title="Open in browser"
                  onPress={onOpenPdf}
                  backgroundColorOverride={roles.primaryActionBackground}
                  textColorOverride={roles.primaryActionText}
                  borderColorOverride={roles.primaryActionBackground}
                  style={styles.openPdfButton}
                />
              </View>
            ) : (
              <View style={styles.pdfState}>
                <AppIcon name="error" size="lg" color={theme.colors.textError} />
                <Text style={[styles.pdfStateTitle, { color: roles.headingText }]}>No PDF uploaded</Text>
                <Text style={[styles.pdfStateText, { color: roles.headingText }]}>
                  Please upload a PDF file for this legal document.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.modalActions}>
            <AppButton
              title="Accept"
              onPress={onAccept}
              fullWidth
              size="lg"
              backgroundColorOverride={roles.primaryActionBackground}
              borderColorOverride={roles.primaryActionBackground}
              textColorOverride={roles.primaryActionText}
              leading={<MaterialCommunityIcons name="check-circle-outline" size={20} color={roles.primaryActionText} allowFontScaling={false} />}
              style={styles.modalAcceptButton}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export const SignupForm = ({
  schema,
  onSubmit,
  isLoading,
  activeAuthAction = '',
  buttonText = 'Sign up',
  submitError = '',
  onFieldEdit,
  onFieldFocus,
  autofillEmail = '',
  resolvedTheme,
}) => {
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: signupDefaultValues,
  });

  const passwordValue = watch('password');
  const { width } = useWindowDimensions();
  const isMobileViewport = width < 768;
  const roles = resolveThemeRoles(resolvedTheme, { isMobile: isMobileViewport });
  const isSubmitLoading = isLoading && activeAuthAction === 'signup';
  const [isLegalModalOpen, setIsLegalModalOpen] = React.useState(false);
  const [termsDocument, setTermsDocument] = React.useState(null);
  const [termsError, setTermsError] = React.useState('');
  const [isLoadingTerms, setIsLoadingTerms] = React.useState(false);

  const acceptLegalDocuments = React.useCallback(() => {
    setValue('acceptedLegal', true, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    onFieldEdit?.();
    setIsLegalModalOpen(false);
  }, [onFieldEdit, setValue]);

  React.useEffect(() => {
    if (!autofillEmail) return;
    setValue('email', autofillEmail, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
    onFieldEdit?.();
  }, [autofillEmail, onFieldEdit, setValue]);

  const openTermsModal = React.useCallback(async () => {
    setIsLegalModalOpen(true);
    if (termsDocument || isLoadingTerms) return;

    setTermsError('');
    setIsLoadingTerms(true);
    const allDocumentsResult = await fetchActiveLegalDocuments();
    const activeDocuments = (allDocumentsResult.data || []).filter(Boolean);

    if (activeDocuments.length) {
      const preferredDocument = (
        activeDocuments.find((document) => document.pdf_url)
        || activeDocuments.find((document) => document.file_path)
        || activeDocuments[0]
      );
      setIsLoadingTerms(false);
      setTermsDocument({
        ...preferredDocument,
        title: preferredDocument?.title || preferredDocument?.document_type || termsLabel,
        content: activeDocuments
          .map((document) => [
            document.title || document.document_type,
            document.content || document.summary || '',
          ].filter(Boolean).join('\n\n'))
          .join('\n\n'),
      });
      return;
    }

    const fallbackResult = await fetchActiveLegalDocument('Terms and Conditions');
    setIsLoadingTerms(false);
    if (fallbackResult.error) {
      setTermsError(fallbackResult.error.message || 'Legal documents could not be loaded.');
      return;
    }

    setTermsDocument(fallbackResult.data);
  }, [isLoadingTerms, termsDocument]);

  const handleOpenPdf = React.useCallback(async () => {
    let pdfUrl = termsDocument?.pdf_url || '';

    if (!pdfUrl && termsDocument?.document_type) {
      const refreshed = await fetchActiveLegalDocument(termsDocument.document_type);
      if (!refreshed.error && refreshed.data?.pdf_url) {
        pdfUrl = refreshed.data.pdf_url;
        setTermsDocument((previous) => ({ ...(previous || {}), ...refreshed.data }));
      }
    }

    if (!pdfUrl) {
      setTermsError('Unable to open document link. Please check legal document file_path and storage bucket path.');
      return;
    }

    await WebBrowser.openBrowserAsync(pdfUrl);
  }, [termsDocument]);

  return (
    <View style={styles.container}>
      {submitError ? (
        <Text style={styles.submitErrorText}>
          {submitError}
        </Text>
      ) : null}

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <AppInput
            label="Email Address"
            value={value}
            leftIcon="email"
            leftIconColor={roles.primaryActionBackground}
            onBlur={onBlur}
            onFocus={() => onFieldFocus?.('email')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            error={errors.email?.message}
            placeholder="jane@example.com"
            placeholderTextColor={roles.headingText}
            disabled={isLoading}
            onChangeText={(nextValue) => {
              onFieldEdit?.();
              onChange(nextValue);
            }}
            style={styles.field}
            labelStyle={[styles.fieldLabel, { color: roles.headingText }]}
            shellStyle={[styles.fieldShell, { borderColor: roles.defaultCardBorder, backgroundColor: theme.colors.surfaceCard }]}
            inputStyle={[styles.fieldInput, { color: roles.headingText }]}
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <PasswordInput
            label="Password"
            value={value}
            leftIcon="lock"
            leftIconColor={roles.primaryActionBackground}
            toggleIconColor={roles.primaryActionBackground}
            onBlur={onBlur}
            onFocus={() => onFieldFocus?.('password')}
            textContentType="newPassword"
            autoComplete="password-new"
            error={errors.password?.message}
            helperText={passwordValue || errors.password
              ? 'Use uppercase, lowercase, a number, and a special character.'
              : undefined}
            placeholder="Password"
            placeholderTextColor={roles.headingText}
            disabled={isLoading}
            onChangeText={(nextValue) => {
              onFieldEdit?.();
              onChange(nextValue);
            }}
            style={styles.field}
            labelStyle={[styles.fieldLabel, { color: roles.headingText }]}
            shellStyle={[styles.fieldShell, { borderColor: roles.defaultCardBorder, backgroundColor: theme.colors.surfaceCard }]}
            inputStyle={[styles.fieldInput, { color: roles.headingText }]}
            helperTextStyle={[styles.helperText, { color: roles.primaryActionBackground }]}
          />
        )}
      />

      <Controller
        control={control}
        name="confirmPassword"
        render={({ field: { onChange, onBlur, value } }) => (
          <PasswordInput
            label="Confirm Password"
            value={value}
            leftIcon="lock-check"
            leftIconColor={roles.primaryActionBackground}
            toggleIconColor={roles.primaryActionBackground}
            onBlur={onBlur}
            onFocus={() => onFieldFocus?.('confirmPassword')}
            textContentType="newPassword"
            autoComplete="password-new"
            error={errors.confirmPassword?.message}
            placeholder="Confirm Password"
            placeholderTextColor={roles.headingText}
            disabled={isLoading}
            onChangeText={(nextValue) => {
              onFieldEdit?.();
              onChange(nextValue);
            }}
            style={styles.field}
            labelStyle={[styles.fieldLabel, { color: roles.headingText }]}
            shellStyle={[styles.fieldShell, { borderColor: roles.defaultCardBorder, backgroundColor: theme.colors.surfaceCard }]}
            inputStyle={[styles.fieldInput, { color: roles.headingText }]}
          />
        )}
      />

      <Controller
        control={control}
        name="acceptedLegal"
        render={({ field: { onChange, value } }) => (
          <View style={styles.legalBlock}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Agree to the Terms of Service and Privacy Policy"
              accessibilityState={{ checked: Boolean(value), disabled: isLoading }}
              disabled={isLoading}
              onPress={() => {
                onFieldEdit?.();
                onChange(!value);
              }}
              style={({ pressed }) => [
                styles.legalConsentCard,
                {
                  borderColor: value ? roles.primaryActionBackground : roles.defaultCardBorder,
                  backgroundColor: value ? roles.iconPrimarySurface : theme.colors.surfaceCard,
                },
                pressed ? styles.legalConsentCardPressed : null,
                isLoading ? styles.legalConsentCardDisabled : null,
              ]}
            >
              <View pointerEvents="none" style={styles.legalConsentRow}>
                <View style={styles.checkbox}>
                  <MaterialCommunityIcons
                    name={value ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    size={30}
                    color={roles.primaryActionBackground}
                    allowFontScaling={false}
                  />
                </View>
                <Text numberOfLines={2} style={[styles.legalTitle, { color: roles.headingText }]}>I agree to the terms and privacy policy</Text>
              </View>
            </Pressable>

            <View style={styles.legalLinksRow}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Read Terms of Service"
                hitSlop={6}
                onPress={openTermsModal}
                style={({ pressed }) => [styles.legalLinkButton, pressed ? styles.pressed : null]}
              >
                <View style={styles.legalLinkIconWrap}>
                  <MaterialCommunityIcons name="file-document-outline" size={16} color={roles.primaryActionBackground} allowFontScaling={false} />
                </View>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.legalInlineLink, { color: roles.primaryActionBackground }]}>Terms of Service</Text>
              </Pressable>
              <View style={[styles.legalLinkDivider, { backgroundColor: roles.defaultCardBorder }]} />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Read Privacy Policy"
                hitSlop={6}
                onPress={openTermsModal}
                style={({ pressed }) => [styles.legalLinkButton, pressed ? styles.pressed : null]}
              >
                <View style={styles.legalLinkIconWrap}>
                  <MaterialCommunityIcons name="shield-lock-outline" size={16} color={roles.primaryActionBackground} allowFontScaling={false} />
                </View>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[styles.legalInlineLink, { color: roles.primaryActionBackground }]}>Privacy Policy</Text>
              </Pressable>
            </View>
            {errors.acceptedLegal?.message ? (
              <Text style={styles.legalErrorText}>{errors.acceptedLegal.message}</Text>
            ) : null}
          </View>
        )}
      />

      <LegalDetailsModal
        visible={isLegalModalOpen}
        onClose={() => setIsLegalModalOpen(false)}
        onAccept={acceptLegalDocuments}
        roles={roles}
        document={termsDocument}
        error={termsError}
        isLoading={isLoadingTerms}
        onOpenPdf={handleOpenPdf}
      />

      <LinearGradient
        colors={SIGNUP_BORDER_GRAD}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.submitGradientBorder}
      >
        <LinearGradient
          colors={SIGNUP_FILL_GRAD}
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
          <AppButton
            title={buttonText}
            onPress={handleSubmit((values) => {
              onFieldEdit?.();
              return onSubmit(values);
            })}
            loading={isSubmitLoading}
            disabled={isLoading}
            variant="outline"
            size="lg"
            style={styles.submitButton}
            textStyle={styles.submitButtonText}
            textColorOverride={roles.primaryActionText}
            backgroundColorOverride="transparent"
            borderColorOverride="transparent"
          />
        </LinearGradient>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  field: {
    marginBottom: theme.spacing.md,
  },
  fieldLabel: {
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textPrimary,
    fontWeight: theme.typography.weights.semibold,
  },
  fieldShell: {
    minHeight: 52,
    borderRadius: 16,
    shadowOpacity: 0,
    elevation: 0,
  },
  fieldInput: {
    fontSize: theme.typography.semantic.body,
  },
  helperText: {
    fontSize: theme.typography.compact.caption,
  },
  legalBlock: {
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  legalConsentCard: {
    width: '100%',
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  legalConsentRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  legalConsentCardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  legalConsentCardDisabled: {
    opacity: 0.55,
  },
  checkbox: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  legalTitle: {
    flexShrink: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: 19,
    fontWeight: theme.typography.weights.semibold,
    textAlign: 'left',
  },
  legalLinksRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xs,
  },
  legalLinkButton: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    flexShrink: 1,
    paddingHorizontal: theme.spacing.xs,
  },
  legalLinkIconWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  legalLinkDivider: {
    width: 1,
    height: 18,
  },
  legalInlineLink: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    fontWeight: theme.typography.weights.semibold,
    textDecorationLine: 'underline',
    textAlign: 'center',
    flexShrink: 1,
  },
  legalErrorText: {
    marginTop: 0,
    paddingHorizontal: theme.spacing.xs,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.caption,
    color: theme.colors.textError,
  },
  submitErrorText: {
    marginBottom: theme.spacing.md,
    textAlign: 'center',
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    color: theme.colors.textError,
  },
  submitButton: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 0,
    marginTop: 0,
  },
  submitButtonText: {
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 0.4,
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
  pressed: {
    opacity: 0.72,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(18, 12, 14, 0.42)',
  },
  modalSheet: {
    width: '100%',
    maxHeight: '88%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
  },
  modalHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: '#D8CED0',
    marginBottom: theme.spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  modalTitleBlock: {
    flex: 1,
  },
  modalEyebrow: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  modalCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfContainer: {
    height: 430,
    minHeight: 280,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
  },
  pdfViewer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  pdfState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  pdfOverlayState: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  pdfStateTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.body,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  pdfStateText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    textAlign: 'center',
  },
  modalNoticeBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    gap: 4,
  },
  modalNoticeTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  modalNoticeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
  },
  openPdfButton: {
    minHeight: 46,
    borderRadius: 16,
    marginTop: theme.spacing.sm,
    minWidth: 140,
  },
  modalActions: {
    width: '100%',
    paddingTop: theme.spacing.md,
  },
  modalAcceptButton: {
    minHeight: 52,
    borderRadius: 16,
  },
});
