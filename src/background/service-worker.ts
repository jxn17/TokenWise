/**
 * TokenWise Background Service Worker
 *
 * Central hub for message handling, storage management, and session tracking.
 * Validates sender.id on every message. Uses strict message schema.
 * Never passes raw HTML in messages.
 */

import { initializeStorage, addSessionRecord, addEstimatedSavings, type SessionRecord } from '../utils/storage';

// ── Message Schema ────────────────────────────────────────────────

interface TokenUpdateMessage {
  type: 'TOKEN_UPDATE';
  data: {
    site: 'chatgpt' | 'claude' | 'gemini';
    inputTokens: number;
    conversationTokens: number;
    messageCount: number;
    attachmentCount: number;
    timestamp: number;
  };
}

interface SessionEndMessage {
  type: 'SESSION_END';
  data: {
    site: 'chatgpt' | 'claude' | 'gemini';
    totalTokens: number;
    messageCount: number;
    attachmentCount: number;
    durationMs: number;
  };
}

interface SavingsTrackedMessage {
  type: 'SAVINGS_TRACKED';
  data: {
    tokens: number;
  };
}

interface GetStatsMessage {
  type: 'GET_STATS';
}

interface GetCurrentSessionMessage {
  type: 'GET_CURRENT_SESSION';
  data?: {
    tabId?: number;
  };
}

interface SettingsChangedMessage {
  type: 'SETTINGS_CHANGED';
  data: Record<string, unknown>;
}

type ValidMessage =
  | TokenUpdateMessage
  | SessionEndMessage
  | SavingsTrackedMessage
  | GetStatsMessage
  | GetCurrentSessionMessage
  | SettingsChangedMessage;

// ── Active Session Tracking ───────────────────────────────────────

interface ActiveTabSession {
  site: 'chatgpt' | 'claude' | 'gemini';
  inputTokens: number;
  conversationTokens: number;
  messageCount: number;
  attachmentCount: number;
  startedAt: number;
  lastUpdate: number;
}

const activeTabs = new Map<number, ActiveTabSession>();

// ── Message Validation ────────────────────────────────────────────

const VALID_MESSAGE_TYPES = new Set([
  'TOKEN_UPDATE',
  'SESSION_END',
  'SAVINGS_TRACKED',
  'GET_STATS',
  'GET_CURRENT_SESSION',
  'SETTINGS_CHANGED',
]);

function isValidMessage(message: unknown): message is ValidMessage {
  if (!message || typeof message !== 'object') return false;
  const msg = message as Record<string, unknown>;
  if (typeof msg.type !== 'string') return false;
  if (!VALID_MESSAGE_TYPES.has(msg.type)) return false;
  return true;
}

function isValidSite(site: unknown): site is 'chatgpt' | 'claude' | 'gemini' {
  return site === 'chatgpt' || site === 'claude' || site === 'gemini';
}

// ── Message Handler ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    // SECURITY: Validate sender
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    // SECURITY: Validate message schema
    if (!isValidMessage(message)) {
      sendResponse({ error: 'Invalid message format' });
      return false;
    }

    // Handle asynchronously
    handleMessage(message, sender, sendResponse);
    return true; // Keep channel open for async response
  }
);

// Reject all external messages — extension does not accept cross-extension communication
chrome.runtime.onMessageExternal.addListener(
  (_message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ error: 'Unauthorized' });
      return false;
    }
    return false;
  }
);

async function handleMessage(
  message: ValidMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    switch (message.type) {
      case 'TOKEN_UPDATE':
        await handleTokenUpdate(message, sender);
        sendResponse({ ok: true });
        break;

      case 'SESSION_END':
        await handleSessionEnd(message, sender);
        sendResponse({ ok: true });
        break;

      case 'SAVINGS_TRACKED':
        await handleSavingsTracked(message);
        sendResponse({ ok: true });
        break;

      case 'GET_STATS':
        const stats = await getStats();
        sendResponse(stats);
        break;

      case 'GET_CURRENT_SESSION':
        const session = getCurrentSession(sender);
        sendResponse(session);
        break;

      case 'SETTINGS_CHANGED':
        await broadcastSettingsChange(message);
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ error: 'Unknown message type' });
    }
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Internal error';
    sendResponse({ error: safeMessage });
  }
}

// ── Message Handlers ──────────────────────────────────────────────

async function handleTokenUpdate(
  message: TokenUpdateMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;
  if (!tabId || !isValidSite(message.data.site)) return;

  const existing = activeTabs.get(tabId);

  activeTabs.set(tabId, {
    site: message.data.site,
    inputTokens: Math.max(0, message.data.inputTokens || 0),
    conversationTokens: Math.max(0, message.data.conversationTokens || 0),
    messageCount: Math.max(0, message.data.messageCount || 0),
    attachmentCount: Math.max(0, message.data.attachmentCount || 0),
    startedAt: existing?.startedAt || Date.now(),
    lastUpdate: Date.now(),
  });

  const session = activeTabs.get(tabId)!;
  const totalTokens = session.conversationTokens + session.inputTokens;
  const perMessageHistory =
    session.messageCount > 0
      ? [Math.round(session.conversationTokens / session.messageCount)]
      : [];

  // Persist live stats so popup works after service worker restarts
  try {
    await chrome.storage.local.set({
      liveStats: {
        site: session.site,
        inputTokens: session.inputTokens,
        conversationTokens: session.conversationTokens,
        totalTokens,
        messageCount: session.messageCount,
        attachmentCount: session.attachmentCount,
        perMessageHistory,
        timestamp: Date.now(),
      },
    });
  } catch {
    // Storage errors shouldn't block message handling
  }

  // Persist active session data
  try {
    const sessions: Record<string, unknown> = {};
    activeTabs.forEach((session, id) => {
      sessions[`tab_${id}`] = {
        site: session.site,
        conversationTokens: session.conversationTokens,
        messageCount: session.messageCount,
        startedAt: new Date(session.startedAt).toISOString(),
      };
    });
    await chrome.storage.local.set({ activeSessions: sessions });
  } catch {
    // Storage errors shouldn't block message handling
  }
}

async function handleSessionEnd(
  message: SessionEndMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;
  if (!isValidSite(message.data.site)) return;

  // Create session record
  const record: SessionRecord = {
    date: new Date().toISOString().split('T')[0],
    site: message.data.site,
    totalTokens: Math.max(0, message.data.totalTokens || 0),
    messageCount: Math.max(0, message.data.messageCount || 0),
    attachmentCount: Math.max(0, message.data.attachmentCount || 0),
    durationMs: Math.max(0, message.data.durationMs || 0),
  };

  await addSessionRecord(record);

  // Clean up active tab
  if (tabId) {
    activeTabs.delete(tabId);
  }
}

async function handleSavingsTracked(message: SavingsTrackedMessage): Promise<void> {
  const tokens = Math.max(0, message.data.tokens || 0);
  if (tokens > 0) {
    await addEstimatedSavings(tokens);
  }
}

async function getStats(): Promise<Record<string, unknown>> {
  try {
    const result = await chrome.storage.local.get([
      'sessions',
      'estimatedSavings',
      'settings',
      'liveStats',
    ]);
    const sessions: SessionRecord[] = result.sessions || [];
    const estimatedSavings: number = result.estimatedSavings || 0;
    const liveStats = result.liveStats as {
      conversationTokens?: number;
      inputTokens?: number;
      totalTokens?: number;
      messageCount?: number;
      perMessageHistory?: number[];
      site?: string;
      timestamp?: number;
    } | undefined;

    // Calculate today's stats
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = sessions.filter(s => s.date === today);
    const todayTokens = todaySessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const todayMessages = todaySessions.reduce((sum, s) => sum + s.messageCount, 0);

    // Calculate active session stats from in-memory tabs
    let activeTokens = 0;
    let activeMessages = 0;
    let activeSite = '';
    const perMessageHistory: number[] = [];

    activeTabs.forEach((session) => {
      activeTokens += session.conversationTokens + session.inputTokens;
      activeMessages += session.messageCount;
      if (!activeSite) activeSite = session.site;
      if (session.messageCount > 0) {
        perMessageHistory.push(Math.round(session.conversationTokens / session.messageCount));
      }
    });

    // Fall back to persisted live stats (survives service worker restarts)
    if (activeTokens === 0 && liveStats) {
      const isRecent = liveStats.timestamp && Date.now() - liveStats.timestamp < 30 * 60 * 1000;
      if (isRecent) {
        activeTokens = liveStats.totalTokens
          ?? (liveStats.conversationTokens || 0) + (liveStats.inputTokens || 0);
        activeMessages = liveStats.messageCount || 0;
        activeSite = liveStats.site || '';
        if (liveStats.perMessageHistory?.length) {
          perMessageHistory.push(...liveStats.perMessageHistory);
        }
      }
    }

    // Determine health indicator
    let health: 'fresh' | 'getting_long' | 'very_expensive' = 'fresh';
    if (activeTokens > 30000) health = 'very_expensive';
    else if (activeTokens > 8000) health = 'getting_long';

    const displayTokens = activeTokens || todayTokens;
    const displayMessages = activeMessages || todayMessages;

    return {
      todayTokens,
      todayMessages,
      avgTokensPerMessage: displayMessages > 0
        ? Math.round(displayTokens / displayMessages)
        : 0,
      activeConversationTokens: displayTokens,
      activeMessages: displayMessages,
      activeSite,
      health,
      estimatedSavings,
      perMessageHistory,
      sessionCount: todaySessions.length,
    };
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Stats error';
    return { error: safeMessage };
  }
}

function getCurrentSession(sender: chrome.runtime.MessageSender): Record<string, unknown> {
  const tabId = sender.tab?.id;
  if (tabId && activeTabs.has(tabId)) {
    const session = activeTabs.get(tabId)!;
    return {
      site: session.site,
      inputTokens: session.inputTokens,
      conversationTokens: session.conversationTokens,
      messageCount: session.messageCount,
      attachmentCount: session.attachmentCount,
    };
  }
  return { site: null, conversationTokens: 0, messageCount: 0 };
}

async function broadcastSettingsChange(message: SettingsChangedMessage): Promise<void> {
  try {
    // Update storage — content scripts listen via chrome.storage.onChanged
    // (avoids chrome.tabs API which requires the "tabs" permission)
    const currentSettings = (await chrome.storage.local.get('settings')).settings || {};
    const updatedSettings = { ...currentSettings, ...message.data };
    const updates: Record<string, unknown> = { settings: updatedSettings };

    if ('showWidget' in message.data) {
      updates.widgetVisible = message.data.showWidget;
    }

    await chrome.storage.local.set(updates);
  } catch {
    // Settings update failure is non-critical
  }
}

// ── Extension Lifecycle ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    // Initialize storage with defaults
    await initializeStorage();

    // Open onboarding on first install (windows.create needs no "tabs" permission)
    if (details.reason === 'install') {
      await chrome.windows.create({
        url: chrome.runtime.getURL('src/onboarding/welcome.html'),
        type: 'normal',
        width: 640,
        height: 720,
      });
    }
  } catch {
    // Installation handler errors are non-critical
  }
});

// Session cleanup relies on SESSION_END messages from content scripts
// (chrome.tabs.onRemoved requires the "tabs" permission)

// Periodic cleanup of stale sessions (older than 4 hours)
setInterval(() => {
  try {
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
    activeTabs.forEach((session, tabId) => {
      if (session.lastUpdate < fourHoursAgo) {
        activeTabs.delete(tabId);
      }
    });
  } catch {
    // Cleanup errors are non-critical
  }
}, 60 * 60 * 1000); // Run every hour
