// src/utils/storage.ts
var MAX_SESSION_ENTRIES = 90;
var DEFAULT_SETTINGS = {
  showWidget: true,
  showSuggestions: true,
  defaultModel: "gpt-4o",
  warningThreshold: 8e3,
  criticalThreshold: 3e4,
  contextExportMaxTokens: 5e3
};
var DEFAULT_WIDGET_POSITION = { x: -1, y: -1 };
var DEFAULT_STORAGE = {
  sessions: [],
  settings: DEFAULT_SETTINGS,
  widgetPosition: DEFAULT_WIDGET_POSITION,
  widgetVisible: true,
  activeSessions: {},
  estimatedSavings: 0,
  onboardingCompleted: false
};
async function getStorageValue(key) {
  try {
    const result = await chrome.storage.local.get(key);
    if (result[key] !== void 0) {
      return result[key];
    }
    return DEFAULT_STORAGE[key];
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Unknown storage read error";
    console.warn("[TokenWise] Storage get error:", safeMessage);
    return DEFAULT_STORAGE[key];
  }
}
async function setStorageValue(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Unknown storage write error";
    console.warn("[TokenWise] Storage set error:", safeMessage);
  }
}
async function addSessionRecord(record) {
  try {
    const sessions = await getStorageValue("sessions");
    sessions.push(record);
    while (sessions.length > MAX_SESSION_ENTRIES) {
      sessions.shift();
    }
    await setStorageValue("sessions", sessions);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Unknown error";
    console.warn("[TokenWise] Session record error:", safeMessage);
  }
}
async function addEstimatedSavings(tokens) {
  try {
    const current = await getStorageValue("estimatedSavings");
    await setStorageValue("estimatedSavings", current + tokens);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Unknown error";
    console.warn("[TokenWise] Savings tracking error:", safeMessage);
  }
}
async function initializeStorage() {
  try {
    const result = await chrome.storage.local.get(null);
    const updates = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_STORAGE)) {
      if (result[key] === void 0) {
        updates[key] = defaultValue;
      }
    }
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Unknown error";
    console.warn("[TokenWise] Storage init error:", safeMessage);
  }
}

// src/background/service-worker.ts
var activeTabs = /* @__PURE__ */ new Map();
var VALID_MESSAGE_TYPES = /* @__PURE__ */ new Set([
  "TOKEN_UPDATE",
  "SESSION_END",
  "SAVINGS_TRACKED",
  "GET_STATS",
  "GET_CURRENT_SESSION",
  "SETTINGS_CHANGED"
]);
function isValidMessage(message) {
  if (!message || typeof message !== "object") return false;
  const msg = message;
  if (typeof msg.type !== "string") return false;
  if (!VALID_MESSAGE_TYPES.has(msg.type)) return false;
  return true;
}
function isValidSite(site) {
  return site === "chatgpt" || site === "claude" || site === "gemini";
}
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }
    if (!isValidMessage(message)) {
      sendResponse({ error: "Invalid message format" });
      return false;
    }
    handleMessage(message, sender, sendResponse);
    return true;
  }
);
chrome.runtime.onMessageExternal.addListener(
  (_message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ error: "Unauthorized" });
      return false;
    }
    return false;
  }
);
async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case "TOKEN_UPDATE":
        await handleTokenUpdate(message, sender);
        sendResponse({ ok: true });
        break;
      case "SESSION_END":
        await handleSessionEnd(message, sender);
        sendResponse({ ok: true });
        break;
      case "SAVINGS_TRACKED":
        await handleSavingsTracked(message);
        sendResponse({ ok: true });
        break;
      case "GET_STATS":
        const stats = await getStats();
        sendResponse(stats);
        break;
      case "GET_CURRENT_SESSION":
        const session = getCurrentSession(sender);
        sendResponse(session);
        break;
      case "SETTINGS_CHANGED":
        await broadcastSettingsChange(message);
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ error: "Unknown message type" });
    }
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Internal error";
    sendResponse({ error: safeMessage });
  }
}
async function handleTokenUpdate(message, sender) {
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
    lastUpdate: Date.now()
  });
  const session = activeTabs.get(tabId);
  const totalTokens = session.conversationTokens + session.inputTokens;
  const perMessageHistory = session.messageCount > 0 ? [Math.round(session.conversationTokens / session.messageCount)] : [];
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
        timestamp: Date.now()
      }
    });
  } catch {
  }
  try {
    const sessions = {};
    activeTabs.forEach((session2, id) => {
      sessions[`tab_${id}`] = {
        site: session2.site,
        conversationTokens: session2.conversationTokens,
        messageCount: session2.messageCount,
        startedAt: new Date(session2.startedAt).toISOString()
      };
    });
    await chrome.storage.local.set({ activeSessions: sessions });
  } catch {
  }
}
async function handleSessionEnd(message, sender) {
  const tabId = sender.tab?.id;
  if (!isValidSite(message.data.site)) return;
  const record = {
    date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
    site: message.data.site,
    totalTokens: Math.max(0, message.data.totalTokens || 0),
    messageCount: Math.max(0, message.data.messageCount || 0),
    attachmentCount: Math.max(0, message.data.attachmentCount || 0),
    durationMs: Math.max(0, message.data.durationMs || 0)
  };
  await addSessionRecord(record);
  if (tabId) {
    activeTabs.delete(tabId);
  }
}
async function handleSavingsTracked(message) {
  const tokens = Math.max(0, message.data.tokens || 0);
  if (tokens > 0) {
    await addEstimatedSavings(tokens);
  }
}
async function getStats() {
  try {
    const result = await chrome.storage.local.get([
      "sessions",
      "estimatedSavings",
      "settings",
      "liveStats"
    ]);
    const sessions = result.sessions || [];
    const estimatedSavings = result.estimatedSavings || 0;
    const liveStats = result.liveStats;
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const todaySessions = sessions.filter((s) => s.date === today);
    const todayTokens = todaySessions.reduce((sum, s) => sum + s.totalTokens, 0);
    const todayMessages = todaySessions.reduce((sum, s) => sum + s.messageCount, 0);
    let activeTokens = 0;
    let activeMessages = 0;
    let activeSite = "";
    const perMessageHistory = [];
    activeTabs.forEach((session) => {
      activeTokens += session.conversationTokens + session.inputTokens;
      activeMessages += session.messageCount;
      if (!activeSite) activeSite = session.site;
      if (session.messageCount > 0) {
        perMessageHistory.push(Math.round(session.conversationTokens / session.messageCount));
      }
    });
    if (activeTokens === 0 && liveStats) {
      const isRecent = liveStats.timestamp && Date.now() - liveStats.timestamp < 30 * 60 * 1e3;
      if (isRecent) {
        activeTokens = liveStats.totalTokens ?? (liveStats.conversationTokens || 0) + (liveStats.inputTokens || 0);
        activeMessages = liveStats.messageCount || 0;
        activeSite = liveStats.site || "";
        if (liveStats.perMessageHistory?.length) {
          perMessageHistory.push(...liveStats.perMessageHistory);
        }
      }
    }
    let health = "fresh";
    if (activeTokens > 3e4) health = "very_expensive";
    else if (activeTokens > 8e3) health = "getting_long";
    const displayTokens = activeTokens || todayTokens;
    const displayMessages = activeMessages || todayMessages;
    return {
      todayTokens,
      todayMessages,
      avgTokensPerMessage: displayMessages > 0 ? Math.round(displayTokens / displayMessages) : 0,
      activeConversationTokens: displayTokens,
      activeMessages: displayMessages,
      activeSite,
      health,
      estimatedSavings,
      perMessageHistory,
      sessionCount: todaySessions.length
    };
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "Stats error";
    return { error: safeMessage };
  }
}
function getCurrentSession(sender) {
  const tabId = sender.tab?.id;
  if (tabId && activeTabs.has(tabId)) {
    const session = activeTabs.get(tabId);
    return {
      site: session.site,
      inputTokens: session.inputTokens,
      conversationTokens: session.conversationTokens,
      messageCount: session.messageCount,
      attachmentCount: session.attachmentCount
    };
  }
  return { site: null, conversationTokens: 0, messageCount: 0 };
}
async function broadcastSettingsChange(message) {
  try {
    const currentSettings = (await chrome.storage.local.get("settings")).settings || {};
    const updatedSettings = { ...currentSettings, ...message.data };
    const updates = { settings: updatedSettings };
    if ("showWidget" in message.data) {
      updates.widgetVisible = message.data.showWidget;
    }
    await chrome.storage.local.set(updates);
  } catch {
  }
}
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await initializeStorage();
    if (details.reason === "install") {
      await chrome.windows.create({
        url: chrome.runtime.getURL("src/onboarding/welcome.html"),
        type: "normal",
        width: 640,
        height: 720
      });
    }
  } catch {
  }
});
setInterval(() => {
  try {
    const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1e3;
    activeTabs.forEach((session, tabId) => {
      if (session.lastUpdate < fourHoursAgo) {
        activeTabs.delete(tabId);
      }
    });
  } catch {
  }
}, 60 * 60 * 1e3);
