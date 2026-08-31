import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppIcon } from '../ui/AppIcon';
import { theme } from '../../design-system/theme';

const resolvePdfViewer = () => {
  if (Constants?.appOwnership === 'expo') return null;
  try {
    const pdfModule = require('react-native-pdf');
    return pdfModule?.default || pdfModule;
  } catch (_error) {
    return null;
  }
};

const Pdf = resolvePdfViewer();

const getDocumentFileName = (document = null) => {
  const contentMatch = String(document?.content || '').match(/[A-Za-z0-9._-]+\.pdf/i);
  if (contentMatch?.[0]) return contentMatch[0];

  const pathName = String(document?.file_path || '').split('/').pop() || '';
  if (/\.pdf$/i.test(pathName)) return pathName;

  return 'document.pdf';
};

export function LegalDocumentPreview({
  document,
  roles,
  showFooter = true,
  viewportHeight = null,
  actionLabel = '',
  actionPlacement = 'topRight',
}) {
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [previewState, setPreviewState] = useState('loading');
  const [viewerError, setViewerError] = useState('');
  const pdfUrl = String(document?.pdf_url || '').trim();
  const documentContent = String(document?.content || '').trim();
  const hasDocumentContent = Boolean(documentContent);
  const canPreviewPdf = Boolean(pdfUrl && Pdf);
  const canOpenDocument = Boolean(pdfUrl || hasDocumentContent);
  const fileName = pdfUrl ? getDocumentFileName(document) : '';
  const documentMeta = [
    document?.version ? `Version ${document.version}` : '',
    fileName || document?.document_type || '',
  ].filter(Boolean).join(' · ') || 'Active document';

  useEffect(() => {
    setPreviewState(canPreviewPdf ? 'loading' : 'unavailable');
    setViewerError('');
  }, [canPreviewPdf, pdfUrl]);

  const openExternally = async () => {
    if (!pdfUrl) return;
    if (await Linking.canOpenURL(pdfUrl)) {
      await Linking.openURL(pdfUrl);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Preview ${document?.title || 'document'}`}
        accessibilityHint="Opens the complete document"
        disabled={!canOpenDocument}
        onPress={() => setIsViewerOpen(true)}
        android_ripple={{ color: theme.colors.surfacePressed, borderless: false }}
        style={[
          styles.previewCard,
          {
            backgroundColor: roles.defaultCardBackground,
            borderColor: roles.defaultCardBorder,
          },
          !canOpenDocument ? styles.previewCardDisabled : null,
        ]}
      >
        <View style={[
          styles.previewViewport,
          { backgroundColor: roles.supportCardBackground },
          viewportHeight ? { height: viewportHeight } : null,
        ]}>
          {canPreviewPdf && previewState !== 'error' ? (
            <View pointerEvents="none" style={styles.previewPdfWrap}>
              <Pdf
                source={{ uri: pdfUrl, cache: true }}
                page={1}
                singlePage
                trustAllCerts={false}
                style={styles.previewPdf}
                onLoadComplete={() => setPreviewState('ready')}
                onError={() => setPreviewState('error')}
              />
            </View>
          ) : (
            <View style={styles.previewFallback}>
              <View style={[styles.previewFallbackIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                <AppIcon name={pdfUrl ? 'file-pdf-box' : 'file-document-outline'} size="xl" color={roles.primaryActionBackground} />
              </View>
              <Text style={[styles.previewFallbackTitle, { color: roles.headingText }]}>
                {pdfUrl ? 'PDF document' : 'Legal document'}
              </Text>
              <Text style={[styles.previewFallbackText, { color: roles.metaText }]}>
                {canOpenDocument ? 'Tap to read the complete document' : 'Document preview unavailable'}
              </Text>
            </View>
          )}

          {previewState === 'loading' && canPreviewPdf ? (
            <View pointerEvents="none" style={styles.previewLoadingOverlay}>
              <Text style={[styles.previewLoadingText, { color: roles.metaText }]}>Preparing preview...</Text>
            </View>
          ) : null}

          {canOpenDocument ? (
            <View
              pointerEvents="none"
              style={[
                styles.expandBadgeAnchor,
                actionPlacement === 'bottomCenter'
                  ? styles.expandBadgeAnchorBottomCenter
                  : styles.expandBadgeAnchorTopRight,
              ]}
            >
              <View style={[styles.expandBadge, { backgroundColor: roles.primaryActionBackground }]}>
                <AppIcon name={pdfUrl ? 'fullscreen' : 'book-open-page-variant-outline'} size="sm" color={roles.primaryActionText} />
                <Text style={[styles.expandBadgeText, { color: roles.primaryActionText }]}>
                  {actionLabel || (pdfUrl ? 'Enlarge' : 'Read')}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {showFooter ? (
          <View style={styles.previewFooter}>
            <View style={[styles.previewFileIcon, { backgroundColor: roles.iconPrimarySurface }]}>
              <AppIcon name="file-document-outline" size="sm" color={roles.primaryActionBackground} />
            </View>
            <View style={styles.previewFooterCopy}>
              <Text numberOfLines={2} style={[styles.previewTitle, { color: roles.headingText }]}>
                {document?.title || 'Document'}
              </Text>
              <Text numberOfLines={2} style={[styles.previewMeta, { color: roles.metaText }]}>
                {documentMeta}
              </Text>
            </View>
            <View style={[styles.previewAction, { backgroundColor: roles.iconPrimarySurface }]}>
              <AppIcon name="chevronRight" size="sm" color={roles.primaryActionBackground} />
            </View>
          </View>
        ) : null}
      </Pressable>

      <Modal
        visible={isViewerOpen}
        animationType="slide"
        onRequestClose={() => setIsViewerOpen(false)}
      >
        <SafeAreaView style={[styles.viewerScreen, { backgroundColor: roles.pageBackground }]} edges={['top', 'bottom']}>
          <View style={[styles.viewerHeader, { backgroundColor: roles.primaryActionBackground }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Back to ${document?.title || 'document'}`}
              onPress={() => setIsViewerOpen(false)}
              style={styles.viewerBackButton}
            >
              <AppIcon name="arrowLeft" size="md" color={roles.primaryActionText} />
            </Pressable>
            <View style={styles.viewerHeaderCopy}>
              <Text numberOfLines={1} style={[styles.viewerTitle, { color: roles.primaryActionText }]}>
                {document?.title || 'Document'}
              </Text>
              <Text numberOfLines={1} style={[styles.viewerMeta, { color: roles.primaryActionText }]}>
                {documentMeta}
              </Text>
            </View>
            <View style={styles.viewerHeaderSpacer} />
          </View>

          <View style={styles.viewerBody}>
            {canPreviewPdf && !viewerError ? (
              <Pdf
                source={{ uri: pdfUrl, cache: true }}
                trustAllCerts={false}
                style={styles.viewerPdf}
                onError={(error) => setViewerError(String(error?.message || error || 'Unable to display this PDF.'))}
              />
            ) : hasDocumentContent ? (
              <ScrollView
                style={styles.viewerTextScroll}
                contentContainerStyle={styles.viewerTextContent}
                showsVerticalScrollIndicator
              >
                <Text selectable style={[styles.viewerDocumentText, { color: roles.bodyText }]}>{documentContent}</Text>
              </ScrollView>
            ) : (
              <View style={styles.viewerFallback}>
                <View style={[styles.viewerFallbackIcon, { backgroundColor: roles.iconPrimarySurface }]}>
                  <AppIcon name="file-pdf-box" size="xl" color={roles.primaryActionBackground} />
                </View>
                <Text style={[styles.viewerFallbackTitle, { color: roles.headingText }]}>Open the complete document</Text>
                <Text style={[styles.viewerFallbackText, { color: roles.bodyText }]}>
                  {viewerError || 'An in-app PDF preview is unavailable in this build.'}
                </Text>
                {pdfUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={openExternally}
                    style={[styles.externalButton, { backgroundColor: roles.primaryActionBackground }]}
                  >
                    <AppIcon name="open-in-new" size="sm" color={roles.primaryActionText} />
                    <Text style={[styles.externalButtonText, { color: roles.primaryActionText }]}>Open document</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  previewCard: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    ...theme.shadows.soft,
  },
  previewCardDisabled: {
    opacity: 0.55,
  },
  previewViewport: {
    height: 156,
    overflow: 'hidden',
  },
  previewPdfWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  previewPdf: {
    width: '100%',
    height: '100%',
  },
  previewFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
  previewFallbackIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewFallbackTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  previewFallbackText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  previewLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 250, 247, 0.88)',
  },
  previewLoadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.semibold,
  },
  expandBadgeAnchor: {
    position: 'absolute',
  },
  expandBadgeAnchorTopRight: {
    right: theme.spacing.sm,
    top: theme.spacing.sm,
  },
  expandBadgeAnchorBottomCenter: {
    left: 0,
    right: 0,
    bottom: theme.spacing.sm,
    alignItems: 'center',
  },
  expandBadge: {
    minHeight: 30,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  expandBadgeText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    fontWeight: theme.typography.weights.bold,
  },
  previewFooter: {
    minHeight: 66,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  previewFileIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewFooterCopy: {
    flex: 1,
    minWidth: 0,
  },
  previewTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
  previewMeta: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
  },
  previewAction: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerScreen: {
    flex: 1,
  },
  viewerHeader: {
    minHeight: 68,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewerBackButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerHeaderCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  viewerHeaderSpacer: {
    width: 48,
  },
  viewerTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodyLg,
    fontWeight: theme.typography.weights.bold,
  },
  viewerMeta: {
    marginTop: 2,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.caption,
    opacity: 0.78,
  },
  viewerBody: {
    flex: 1,
  },
  viewerTextScroll: {
    flex: 1,
  },
  viewerTextContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  viewerDocumentText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.semantic.bodySm,
    lineHeight: theme.typography.semantic.bodySm * theme.typography.lineHeights.relaxed,
  },
  viewerPdf: {
    flex: 1,
    width: '100%',
  },
  viewerFallback: {
    flex: 1,
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  viewerFallbackIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerFallbackTitle: {
    fontFamily: theme.typography.fontFamilyDisplay,
    fontSize: theme.typography.semantic.titleSm,
    fontWeight: theme.typography.weights.bold,
    textAlign: 'center',
  },
  viewerFallbackText: {
    maxWidth: 320,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    lineHeight: theme.typography.compact.bodySm * theme.typography.lineHeights.relaxed,
    textAlign: 'center',
  },
  externalButton: {
    minHeight: 48,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  externalButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.compact.bodySm,
    fontWeight: theme.typography.weights.bold,
  },
});
