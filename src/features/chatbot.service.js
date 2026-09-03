import { invokeEdgeFunction } from '../api/supabase/client';
import * as ChatbotAPI from './chatbot.api';
import { chatbotAiFunctionName } from './chatbot.constants';
import { getProcessTracking } from './processTracking.service';
import {
  fetchHairSubmissionsByUserId,
} from './hairSubmission.api';
import {
  fetchLatestWigAllocationByPatientDetailsId,
  fetchLatestWigRequestByPatientDetailsId,
} from './wigRequest.api';
import { getProfileBundle } from './profile/services/profile.service';
import { logAppError, logAppEvent, writeAuditLog } from '../utils/appErrors';

const getNormalizedErrorMessage = (error) => (
  error?.message
  || error?.error_description
  || error?.details
  || ''
);

const isMissingChatTableError = (error) => (
  (() => {
    const normalized = getNormalizedErrorMessage(error).toLowerCase();
    return normalized.includes("could not find the table 'public.chatbot_")
      || normalized.includes("could not find the table 'public.\"chatbot_")
      || normalized.includes('relation "public.chatbot_')
      || normalized.includes('relation "chatbot_');
  })()
);

const extractFunctionErrorMessage = async (error) => {
  const response = error?.context;

  if (!response || typeof response.clone !== 'function') {
    return getNormalizedErrorMessage(error);
  }

  try {
    const payload = await response.clone().json();
    if (typeof payload?.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
    if (typeof payload?.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload?.code === 'string' && payload.code.trim()) {
      return payload.code.trim();
    }
  } catch (_jsonError) {
    // Fall through to text.
  }

  try {
    const text = await response.clone().text();
    if (text?.trim()) {
      return text.trim();
    }
  } catch (_textError) {
    // Fall back to the original error object message.
  }

  return getNormalizedErrorMessage(error);
};

const buildBootstrapConversation = (settings) => (
  settings?.welcomeMessage
    ? [
        {
          id: `welcome-${Date.now()}`,
          sender: 'assistant',
          text: settings.welcomeMessage,
          createdAt: new Date().toISOString(),
          source: 'welcome',
        },
      ]
    : []
);

const normalizeSettings = (row) => {
  return {
    welcomeMessage: row?.welcome_message || '',
    fallbackMessage: row?.fallback_message || '',
    quickSuggestions: [],
  };
};

const normalizeFaq = (row) => ({
  id: row?.faq_id || row?.question || Math.random().toString(36).slice(2),
  question: row?.question || '',
  answer: row?.answer || '',
  keywords: [],
  priorityOrder: Number(row?.priority_order) || 0,
});

const normalizeMessage = (row) => ({
  id: row?.message_id || `${row?.created_at || Date.now()}-${row?.sender_type || 'assistant'}`,
  sender: row?.sender_type || 'assistant',
  text: row?.message_text || '',
  createdAt: row?.created_at || new Date().toISOString(),
  source: 'chat',
});

const matchesTopic = (text, topics) => {
  const normalized = text.toLowerCase();
  return topics.some((topic) => normalized.includes(topic));
};

const advertisedNamePatterns = [
  /\bHuman Nature\b/gi,
  /\bDove\b/gi,
  /\bCream Silk\b/gi,
  /\bVitress\b/gi,
  /\bHead\s*&\s*Shoulders\b/gi,
  /\bSelsun Blue\b/gi,
  /\bPantene(?:\s+Pro-V)?\b/gi,
  /\bWatsons\b/gi,
  /\bSM\b/g,
  /\bRobinsons\b/gi,
  /\bLazada(?:\.ph)?\b/gi,
  /\bShopee(?:\.ph)?\b/gi,
];

const removeAdvertisedNames = (value = '') => {
  let cleaned = String(value || '').trim();
  advertisedNamePatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, 'generic');
  });
  return cleaned.replace(/\bgeneric\s+generic\b/gi, 'generic').replace(/\s{2,}/g, ' ').trim();
};

const normalizeAiReply = (data) => {
  const replyText = data?.reply?.text || data?.text || '';
  const rawMapLinks = Array.isArray(data?.reply?.map_links) ? data.reply.map_links : [];

  return {
    text: removeAdvertisedNames(replyText),
    source: data?.reply?.source || data?.source || 'ai',
    products: [],
    mapLinks: rawMapLinks.filter((l) => l?.url && l?.label),
    attachments: Array.isArray(data?.reply?.attachments) ? data.reply.attachments : [],
    actions: Array.isArray(data?.reply?.actions) ? data.reply.actions : [],
  };
};

const formatAddress = (profile, roleProfile) => (
  [
    roleProfile?.street,
    profile?.street,
    roleProfile?.barangay,
    profile?.barangay,
    roleProfile?.city,
    profile?.city,
    roleProfile?.province,
    profile?.province,
    roleProfile?.region,
    profile?.region,
    roleProfile?.country,
    profile?.country || 'Philippines',
  ]
    .filter(Boolean)
    .filter((value, index, source) => source.indexOf(value) === index)
    .join(', ')
);

const buildMapsSearchLink = (query) => (
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
);

const buildMapActions = (links = []) => (
  links.map((item, index) => ({
    id: `map-${index}-${item.label.toLowerCase().replace(/\s+/g, '-')}`,
    label: item.label,
    url: item.url,
  }))
);

const matchesLocationIntent = (text = '') => (
  matchesTopic(text, ['near me', 'nearby', 'near', 'location', 'map', 'maps', 'salon', 'drop-off', 'drop off', 'pickup point', 'collection point'])
);

const extractLocationHint = (text = '') => {
  const match = text.match(/\b(?:near|around|in|at)\s+([a-z0-9\s,.-]{3,})/i);
  return match?.[1]?.trim() || '';
};

const buildMapLinks = ({ text, savedAddress, role }) => {
  const locationHint = extractLocationHint(text) || savedAddress;
  if (!locationHint) return [];

  const linkSets = [
    {
      label: 'Open suggested location',
      url: buildMapsSearchLink(locationHint),
    },
    {
      label: role === 'donor' ? 'Open nearby salons' : 'Open nearby support salons',
      url: buildMapsSearchLink(`${role === 'donor' ? 'salon' : 'wig salon'} near ${locationHint}`),
    },
    {
      label: role === 'donor' ? 'Open drop-off search' : 'Open support centers',
      url: buildMapsSearchLink(`${role === 'donor' ? 'hair donation drop-off' : 'cancer support salon'} near ${locationHint}`),
    },
  ];

  return linkSets;
};

const buildSupportContextBundle = async ({ role, userId, text }) => {
  const supportContext = {
    savedAddress: '',
    mapLinks: [],
    latestScreeningSummary: '',
    latestDonorRecommendations: [],
    latestWigSummary: '',
    latestTrackingSummary: '',
  };

  const { profile, roleProfile } = await getProfileBundle(userId, role).catch(() => ({
    profile: null,
    roleProfile: null,
  }));

  supportContext.savedAddress = formatAddress(profile, roleProfile);

  if (role === 'donor') {
    const { data: submissionRows } = await fetchHairSubmissionsByUserId(userId, 1)
      .catch(() => ({ data: [] }));

    const latestScreening = submissionRows?.[0]?.ai_screenings?.[0] || null;
    supportContext.latestScreeningSummary = latestScreening
      ? [
        latestScreening.decision ? `Decision: ${latestScreening.decision}.` : '',
        latestScreening.summary || '',
        latestScreening.confidence_score != null
          ? `Confidence: ${Math.round(Number(latestScreening.confidence_score) * 100)}%.`
          : '',
      ].filter(Boolean).join(' ')
      : '';

    const screeningCareTips = latestScreening?.recommendations || latestScreening?.care_tips || [];
    if (screeningCareTips.length) {
      supportContext.latestDonorRecommendations = screeningCareTips
        .map((item) => removeAdvertisedNames(item?.recommendation_text))
        .filter(Boolean);
    }

    if (matchesLocationIntent(text)) {
      const trackerResult = await getProcessTracking({ role: 'donor', userId }).catch(() => ({ tracker: null }));
      if (trackerResult?.tracker) {
        supportContext.latestTrackingSummary = trackerResult.tracker.summary?.helperText || trackerResult.tracker.summary?.label || '';
      }
    }
  }

  if (role === 'patient' && roleProfile?.id) {
    const [{ data: wigRequest }, { data: latestAllocation }] = await Promise.all([
      fetchLatestWigRequestByPatientDetailsId(roleProfile.id).catch(() => ({ data: null })),
      fetchLatestWigAllocationByPatientDetailsId(roleProfile.id).catch(() => ({ data: null })),
    ]);

    const wig = latestAllocation?.wigs;
    supportContext.latestWigSummary = [
      wig?.wig_name ? `Latest wig: ${wig.wig_name}.` : '',
      latestAllocation?.release_status ? `Release status: ${latestAllocation.release_status}.` : '',
      wigRequest?.notes || latestAllocation?.notes || '',
    ].filter(Boolean).join(' ');
  }

  if (matchesLocationIntent(text)) {
    supportContext.mapLinks = buildMapLinks({
      text,
      savedAddress: supportContext.savedAddress,
      role,
    });
  }

  return supportContext;
};

const buildSupportContextText = (supportContext = {}) => ([
  supportContext.savedAddress ? `Saved user location: ${supportContext.savedAddress}` : '',
  supportContext.latestScreeningSummary ? `Latest donor screening: ${supportContext.latestScreeningSummary}` : '',
  supportContext.latestDonorRecommendations?.length
    ? `Latest donor recommendations: ${supportContext.latestDonorRecommendations.join(' | ')}`
    : '',
  supportContext.latestWigSummary ? `Latest wig support summary: ${supportContext.latestWigSummary}` : '',
  supportContext.latestTrackingSummary ? `Latest tracking summary: ${supportContext.latestTrackingSummary}` : '',
].filter(Boolean).join('\n\n'));

const buildSupportContextMessages = (supportContext = {}) => {
  const supportText = buildSupportContextText(supportContext);
  if (!supportText) {
    return [];
  }

  return [
    {
      sender: 'assistant',
      text: `Saved support context:\n${supportText}`,
      source: 'context',
    },
  ];
};

const invokeChatbotAiReply = async ({
  role,
  text,
  faqs,
  settings,
  recentMessages,
  supportContext,
}) => {
  const contextualRecentMessages = [
    ...buildSupportContextMessages(supportContext),
    ...(recentMessages || []).slice(-6).map((message) => ({
      sender: message.sender,
      text: message.text,
      source: message.source,
    })),
  ].slice(-8);

  logAppEvent('chatbot.ai.invoke', 'Invoking chatbot edge function.', {
    functionName: chatbotAiFunctionName,
    role,
    faqCount: faqs?.length || 0,
    recentMessageCount: contextualRecentMessages.length,
    hasFallbackMessage: Boolean(settings?.fallbackMessage),
    hasSupportContext: Boolean(buildSupportContextText(supportContext)),
  });

  const { data, error } = await invokeEdgeFunction(chatbotAiFunctionName, {
    body: {
      role,
      message: text,
      faqs: (faqs || []).map((faq) => ({
        question: faq.question,
        answer: faq.answer,
        keywords: faq.keywords || [],
      })),
      settings: {
        welcomeMessage: settings?.welcomeMessage || '',
        fallbackMessage: settings?.fallbackMessage || '',
        quickSuggestions: settings?.quickSuggestions || [],
      },
      recent_messages: contextualRecentMessages,
    },
  });

  if (error) {
    throw error;
  }

  logAppEvent('chatbot.ai.invoke', 'Chatbot edge function returned.', {
    functionName: chatbotAiFunctionName,
    responseKeys: data ? Object.keys(data) : [],
    hasReply: Boolean(data?.reply),
  });

  const reply = normalizeAiReply(data);
  if (!reply.text) {
    throw new Error('The chatbot AI response was incomplete.');
  }

  return reply;
};

const persistConversationToBackend = async ({
  role,
  userId,
  conversationId,
  messages,
}) => {
  try {
    logAppEvent('chatbot.persist', 'Persisting chatbot messages.', {
      role,
      userId,
      hasConversationId: Boolean(conversationId),
      newMessageCount: messages?.length || 0,
    });

    let resolvedConversationId = conversationId;

    if (!resolvedConversationId) {
      const conversationPayload = {
        user_id: userId,
        title: role === 'donor' ? 'Donor quick inquiries' : 'Patient quick inquiries',
        updated_at: new Date().toISOString(),
      };

      const conversationResult = await ChatbotAPI.createChatbotConversation(conversationPayload);
      if (conversationResult.error) {
        throw new Error(conversationResult.error.message);
      }

      resolvedConversationId = conversationResult.data?.conversation_id || conversationResult.data?.id || null;
    } else {
      await ChatbotAPI.updateChatbotConversation(resolvedConversationId, {
        updated_at: new Date().toISOString(),
      });
    }

    if (!resolvedConversationId || !messages.length) {
      return {
        conversationId: resolvedConversationId,
        error: null,
      };
    }

    const rows = messages.map((message) => ({
      conversation_id: resolvedConversationId,
      sender_type: message.sender,
      message_text: message.text,
    }));

    const insertResult = await ChatbotAPI.createChatbotMessages(rows);
    if (insertResult.error) {
      throw new Error(insertResult.error.message);
    }

    await writeAuditLog({
      authUserId: userId,
      action: resolvedConversationId === conversationId ? 'chatbot.message.append' : 'chatbot.conversation.create',
      description: `Persisted ${messages.length} chat message(s) for ${role} support.`,
      resource: 'chatbot_conversations,chatbot_messages',
      status: 'success',
    });

    return {
      conversationId: resolvedConversationId,
      error: null,
    };
  } catch (error) {
    logAppError('chatbot.persistConversationToBackend', error, {
      role,
      userId,
      conversationId,
      messageCount: messages?.length || 0,
    });

    await writeAuditLog({
      authUserId: userId,
      action: 'chatbot.message.append',
      description: error.message || 'Unable to persist chatbot conversation.',
      resource: 'chatbot_conversations,chatbot_messages',
      status: 'failed',
    });

    return {
      conversationId,
      error: 'Your messages may not be saved right now.',
    };
  }
};

export const loadChatbotBootstrap = async ({ userId, role }) => {
  const defaultSettings = normalizeSettings(null);

  try {
    logAppEvent('chatbot.bootstrap', 'Loading chatbot bootstrap.', {
      role,
      userId,
    });

    const [settingsResult, faqResult, conversationResult] = await Promise.all([
      ChatbotAPI.fetchChatbotSettings(),
      ChatbotAPI.fetchChatbotFaqs(),
      ChatbotAPI.fetchLatestChatbotConversation({ userId }),
    ]);

    if (settingsResult.error && !isMissingChatTableError(settingsResult.error)) {
      throw settingsResult.error;
    }

    if (faqResult.error && !isMissingChatTableError(faqResult.error)) {
      throw faqResult.error;
    }

    if (conversationResult.error && !isMissingChatTableError(conversationResult.error)) {
      throw conversationResult.error;
    }

    const settings = normalizeSettings(settingsResult.data);
    const faqs = (faqResult.data || []).map(normalizeFaq).filter((faq) => faq.question && faq.answer);
    let messages = [];
    let conversationId = conversationResult.data?.conversation_id || conversationResult.data?.id || null;

    if (conversationId) {
      const messageResult = await ChatbotAPI.fetchChatbotMessages(conversationId);
      if (messageResult.error && !isMissingChatTableError(messageResult.error)) {
        throw messageResult.error;
      }
      const serverMessages = (messageResult.data || []).map(normalizeMessage).filter((message) => message.text);

      if (serverMessages.length) {
        messages = serverMessages;
      }
    }

    if (!messages.length) {
      messages = buildBootstrapConversation(settings);
    }

    const faqQuickSuggestions = faqs
      .slice(0, 6)
      .map((faq) => faq.question)
      .filter(Boolean);

    return {
      settings,
      faqs,
      quickSuggestions: faqQuickSuggestions.length ? faqQuickSuggestions : (settings.quickSuggestions || []),
      conversationId,
      messages,
      error: null,
    };
  } catch (error) {
    logAppError('chatbot.loadChatbotBootstrap', error, {
      role,
      userId,
    });

    return {
      settings: defaultSettings,
      faqs: [],
      quickSuggestions: [],
      conversationId: null,
      messages: [],
      error: 'We could not open the chat right now. Please try again.',
    };
  }
};

export const resolveChatbotReply = async ({
  role,
  userId,
  text,
  faqs,
  settings,
  recentMessages = [],
}) => {
  const trimmedText = text.trim();

  const supportContext = await buildSupportContextBundle({
    role,
    userId,
    text: trimmedText,
  }).catch(() => ({
    savedAddress: '',
    mapLinks: [],
    latestScreeningSummary: '',
    latestDonorRecommendations: [],
    latestWigSummary: '',
    latestTrackingSummary: '',
  }));

  try {
    const reply = await invokeChatbotAiReply({
      role,
      text: trimmedText,
      faqs,
      settings,
      recentMessages,
      supportContext,
    });

    // Merge profile-based map links from support context into reply actions
    if (supportContext.mapLinks?.length) {
      const profileMapActions = buildMapActions(supportContext.mapLinks);
      reply.actions = [...(reply.actions || []), ...profileMapActions];
    }
    // Merge AI-generated map links
    if (reply.mapLinks?.length) {
      const aiMapActions = buildMapActions(reply.mapLinks);
      reply.actions = [...(reply.actions || []), ...aiMapActions];
    }

    return reply;
  } catch (error) {
    const errorMessage = (await extractFunctionErrorMessage(error)).toLowerCase();

    if (
      !errorMessage.includes('requested function was not found')
      && !errorMessage.includes('not_found')
    ) {
      logAppError('chatbot.resolveChatbotReply', error, {
        role,
        userId,
        functionName: chatbotAiFunctionName,
      });
    }

    const userMessage = errorMessage.includes('requested function was not found') || errorMessage.includes('not_found')
      ? 'We could not generate a reply right now.'
      : errorMessage.includes('openai api key is not configured')
        ? 'We could not generate a reply right now.'
        : 'We could not generate a reply right now.';

    const surfacedError = new Error(userMessage);
    surfacedError.actions = buildMapActions(supportContext.mapLinks || []);
    throw surfacedError;
  }
};

export const appendChatbotMessages = async ({
  role,
  userId,
  conversationId,
  existingMessages,
  newMessages,
}) => {
  const mergedMessages = [...existingMessages, ...newMessages];

  const persistenceResult = await persistConversationToBackend({
    role,
    userId,
    conversationId,
    messages: newMessages,
  });

  return {
    messages: mergedMessages,
    conversationId: persistenceResult.conversationId,
    persistenceError: persistenceResult.error,
  };
};
