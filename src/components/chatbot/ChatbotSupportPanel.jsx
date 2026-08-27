import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppIcon } from '../ui/AppIcon';
import { ChatMessageBubble } from './ChatMessageBubble';
import { ChatQuickSuggestions } from './ChatQuickSuggestions';
import { useChatbot } from '../../hooks/useChatbot';
import { theme } from '../../design-system/theme';
import chatbotIcon from '../../assets/images/chatbot_icon.png';

const MAX_ATTACHMENTS = 3;
const IMAGE_MEDIA_TYPES = ['images'];

const DEFAULT_DONOR_SUGGESTIONS = [
  'Hair eligibility requirements',
  'How to prepare my hair',
  'Donation drop-off locations',
  'Hair products for dry hair',
  'Check my donation status',
];

const DEFAULT_PATIENT_SUGGESTIONS = [
  'Wig request status',
  'How to apply for a wig',
  'Nearest support center',
  'Hair care after treatment',
  'Contact support',
];

const buildAttachmentName = (asset, index) => (
  asset?.fileName || asset?.assetId || `Image ${index + 1}`
);

const normalizeAttachmentAssets = (assets = []) => (
  assets
    .filter((asset) => asset?.uri)
    .map((asset, index) => ({
      id: asset.assetId || `${asset.uri}-${index}`,
      uri: asset.uri,
      name: buildAttachmentName(asset, index),
    }))
);

const NEARBY_SALON_URL = 'https://www.google.com/maps/search/?api=1&query=hair+salon+near+me';
const NEARBY_DROPOFF_URL = 'https://www.google.com/maps/search/?api=1&query=hair+donation+drop+off+near+me+Philippines';

export function ChatbotSupportPanel({
  role,
  userId,
  variant = 'screen',
}) {
  const scrollRef = useRef(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const {
    messages,
    quickSuggestions,
    isLoadingChat,
    isSendingMessage,
    sendMessage,
  } = useChatbot({ role, userId });

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const isModal = variant === 'modal';
  const Container = isModal ? View : KeyboardAvoidingView;
  const containerProps = !isModal
    ? { behavior: Platform.OS === 'ios' ? 'padding' : 'height', keyboardVerticalOffset: 0 }
    : {};

  const fallbackSuggestions = role === 'donor' ? DEFAULT_DONOR_SUGGESTIONS : DEFAULT_PATIENT_SUGGESTIONS;
  const suggestionsToShow = quickSuggestions?.length ? quickSuggestions : fallbackSuggestions;
  const shouldRenderSuggestions = Boolean(suggestionsToShow.length) && !(isModal && isKeyboardVisible);
  const hasComposerValue = Boolean(draftMessage.trim() || attachments.length);

  const handleSend = async (presetMessage) => {
    const typedMessage = presetMessage || draftMessage;
    const trimmedMessage = typedMessage.trim();
    const attachmentNote = attachments.length
      ? `Attached file${attachments.length > 1 ? 's' : ''}: ${attachments.map((a) => a.name).join(', ')}.`
      : '';
    const messageText = [trimmedMessage, attachmentNote].filter(Boolean).join('\n\n');

    const result = await sendMessage({
      text: messageText,
      attachments,
      inputMode: attachments.length ? 'attachment' : 'text',
    });

    if (result?.success && !presetMessage) {
      setDraftMessage('');
      setAttachments([]);
    }
  };

  const handlePickAttachment = async () => {
    try {
      if (Platform.OS !== 'android') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: MAX_ATTACHMENTS,
      });
      if (result.canceled) return;
      const selected = normalizeAttachmentAssets(result.assets).slice(0, MAX_ATTACHMENTS);
      if (selected.length) setAttachments(selected);
    } catch (_e) {
      // silently ignore
    }
  };

  const removeAttachment = (id) => {
    setAttachments((current) => current.filter((a) => a.id !== id));
  };

  const handleNearbyPress = () => {
    const url = role === 'donor' ? NEARBY_DROPOFF_URL : NEARBY_SALON_URL;
    Linking.openURL(url).catch(() => null);
  };

  return (
    <Container
      style={[styles.wrapper, isModal ? styles.wrapperModal : null]}
      {...containerProps}
    >
      {/* Quick suggestions */}
      {shouldRenderSuggestions ? (
        <View style={styles.suggestionBlock}>
          <ChatQuickSuggestions
            suggestions={suggestionsToShow}
            disabled={isSendingMessage || isLoadingChat}
            onSelect={handleSend}
          />
        </View>
      ) : null}

      {/* Chat area */}
      <View style={[styles.chatShell, isModal ? styles.chatShellModal : null]}>
        {isLoadingChat ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={theme.colors.brandPrimary} size="small" />
            <Text style={styles.loadingText}>Loading chat…</Text>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.messageList}
            contentContainerStyle={[
              styles.messageContent,
              !messages.length ? styles.messageContentEmpty : null,
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {messages.length ? (
              messages.map((message) => (
                <ChatMessageBubble key={message.id} message={message} />
              ))
            ) : (
              <View style={styles.emptyState}>
                <View style={styles.welcomeRow}>
                  <View style={styles.welcomeAvatarWrap}>
                    <Image source={chatbotIcon} style={styles.welcomeAvatar} resizeMode="contain" />
                  </View>
                  <View style={styles.welcomeBubble}>
                    <Text style={styles.welcomeTitle}>Hi! How can I help? 👋</Text>
                    <Text style={styles.welcomeBody}>
                      Ask me about your hair, donation status, nearby salons, or hair care tips.
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </ScrollView>
        )}
      </View>

      {/* Attachments preview */}
      {attachments.length ? (
        <View style={styles.attachmentTray}>
          {attachments.map((attachment) => (
            <View key={attachment.id} style={styles.attachmentChip}>
              <Image source={{ uri: attachment.uri }} style={styles.attachmentPreview} resizeMode="cover" />
              <Text numberOfLines={1} style={styles.attachmentName}>{attachment.name}</Text>
              <Pressable onPress={() => removeAttachment(attachment.id)} style={styles.attachmentRemove}>
                <Text style={styles.attachmentRemoveText}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Nearby button */}
      <Pressable
        onPress={handleNearbyPress}
        style={({ pressed }) => [styles.nearbyButton, pressed ? styles.nearbyButtonPressed : null]}
      >
        <Text style={styles.nearbyButtonText}>📍 Find nearby {role === 'donor' ? 'drop-off points' : 'salons'}</Text>
      </Pressable>

      {/* Composer */}
      <View style={[styles.composerRow, isModal ? styles.composerRowModal : null]}>
        <Pressable onPress={handlePickAttachment} style={styles.composerIconBtn}>
          <AppIcon name="paperclip" state="muted" />
        </Pressable>

        <TextInput
          style={styles.composerInput}
          placeholder={role === 'donor' ? 'Ask about your hair or donation…' : 'Ask about your request or wig…'}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          value={draftMessage}
          onChangeText={setDraftMessage}
          editable={!isSendingMessage}
        />

        <Pressable
          disabled={!hasComposerValue || isSendingMessage}
          onPress={() => handleSend()}
          style={({ pressed }) => [
            styles.sendButton,
            (!hasComposerValue || isSendingMessage) ? styles.sendButtonDisabled : null,
            pressed && hasComposerValue && !isSendingMessage ? styles.sendButtonPressed : null,
          ]}
        >
          {isSendingMessage ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <AppIcon name="send-outline" state="inverse" />
          )}
        </Pressable>
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: theme.spacing.sm,
  },
  wrapperModal: {
    flex: 1,
    gap: theme.spacing.xs,
    minHeight: 0,
  },
  suggestionBlock: {
    marginHorizontal: -theme.spacing.xs,
  },
  chatShell: {
    minHeight: 280,
    maxHeight: 360,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    backgroundColor: '#fafafa',
    overflow: 'hidden',
  },
  chatShellModal: {
    flex: 1,
    minHeight: 240,
    maxHeight: undefined,
    borderRadius: theme.radius.xl,
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    minHeight: 120,
  },
  loadingText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  messageContentEmpty: {
    flexGrow: 1,
    justifyContent: 'flex-start',
  },
  emptyState: {
    paddingTop: theme.spacing.xs,
  },
  welcomeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.xs,
  },
  welcomeAvatarWrap: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    marginTop: 2,
  },
  welcomeAvatar: {
    width: 22,
    height: 22,
  },
  welcomeBubble: {
    flex: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 18,
    borderTopLeftRadius: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.brandPrimaryMuted,
    gap: 4,
  },
  welcomeTitle: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 14,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textPrimary,
  },
  welcomeBody: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
  attachmentTray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
  },
  attachmentChip: {
    position: 'relative',
    width: 80,
    gap: 3,
    padding: 5,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.backgroundPrimary,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  attachmentPreview: {
    width: '100%',
    height: 60,
    borderRadius: theme.radius.sm,
  },
  attachmentName: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 10,
    color: theme.colors.textPrimary,
  },
  attachmentRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  attachmentRemoveText: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
  },
  nearbyButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    marginHorizontal: theme.spacing.xs,
  },
  nearbyButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  nearbyButtonText: {
    fontFamily: theme.typography.fontFamily,
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.xl,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
  composerRowModal: {
    borderRadius: theme.radius.xl,
  },
  composerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    fontFamily: theme.typography.fontFamily,
    fontSize: 14,
    color: theme.colors.textPrimary,
    paddingVertical: 8,
    maxHeight: 110,
    minHeight: 38,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.brandPrimary,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.actionDisabled,
  },
  sendButtonPressed: {
    transform: [{ scale: 0.94 }],
  },
});
