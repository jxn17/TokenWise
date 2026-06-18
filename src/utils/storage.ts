/**
 * TokenWise Storage Module
 *
 * Typed wrappers around chrome.storage.local with FIFO eviction,
 * error handling, and data purge capabilities.
 * All data stays local — never uses chrome.storage.sync.
 */

// ── Type Definitions ──────────────────────────────────────────────

export interface SessionRecord {
  date: string;          // ISO date string (YYYY-MM-DD)
  site: 'chatgpt' | 'claude' | 'gemini';
  totalTokens: number;
  messageCount: number;
  attachmentCount: number;
  durationMs: number;
}

export interface UserSettings {
  showWidget: boolean;
  showSuggestions: boolean;
  defaultModel: string;
  warningThreshold: number;
  criticalThreshold: number;
  contextExportMaxTokens: number;
}

export interface WidgetPosition {
  x: number;
  y: number;
}

export interface ActiveSession {
  site: 'chatgpt' | 'claude' | 'gemini';
  conversationTokens: number;
  currentInputTokens: number;
  messageCount: number;
  attachmentCount: number;
  startedAt: string;
}

export interface StorageSchema {
  sessions: SessionRecord[];
  settings: UserSettings;
  widgetPosition: WidgetPosition;
  widgetVisible: boolean;
  activeSessions: Record<string, ActiveSession>;
  estimatedSavings: number;
  onboardingCompleted: boolean;
}

// ── Constants ─────────────────────────────────────────────────────

const MAX_SESSION_ENTRIES = 90;

const DEFAULT_SETTINGS: UserSettings = {
  showWidget: true,
  showSuggestions: true,
  defaultModel: 'gpt-4o',
  warningThreshold: 8000,
  criticalThreshold: 30000,
  contextExportMaxTokens: 5000,
};

const DEFAULT_WIDGET_POSITION: WidgetPosition = { x: -1, y: -1 };

const DEFAULT_STORAGE: StorageSchema = {
  sessions: [],
  settings: DEFAULT_SETTINGS,
  widgetPosition: DEFAULT_WIDGET_POSITION,
  widgetVisible: true,
  activeSessions: {},
  estimatedSavings: 0,
  onboardingCompleted: false,
};

// ── Storage Getters ───────────────────────────────────────────────

/**
 * Get a specific key from chrome.storage.local with type safety.
 */
export async function getStorageValue<K extends keyof StorageSchema>(
  key: K
): Promise<StorageSchema[K]> {
  try {
    const result = await chrome.storage.local.get(key);
    if (result[key] !== undefined) {
      return result[key] as StorageSchema[K];
    }
    return DEFAULT_STORAGE[key];
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown storage read error';
    console.warn('[TokenWise] Storage get error:', safeMessage);
    return DEFAULT_STORAGE[key];
  }
}

/**
 * Get multiple keys from storage at once.
 */
export async function getMultipleStorageValues<K extends keyof StorageSchema>(
  keys: K[]
): Promise<Pick<StorageSchema, K>> {
  try {
    const result = await chrome.storage.local.get(keys);
    const output: Partial<StorageSchema> = {};
    for (const key of keys) {
      output[key] = result[key] !== undefined ? result[key] : DEFAULT_STORAGE[key];
    }
    return output as Pick<StorageSchema, K>;
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown storage read error';
    console.warn('[TokenWise] Storage multi-get error:', safeMessage);
    const output: Partial<StorageSchema> = {};
    for (const key of keys) {
      output[key] = DEFAULT_STORAGE[key];
    }
    return output as Pick<StorageSchema, K>;
  }
}

// ── Storage Setters ───────────────────────────────────────────────

/**
 * Set a specific key in chrome.storage.local.
 */
export async function setStorageValue<K extends keyof StorageSchema>(
  key: K,
  value: StorageSchema[K]
): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown storage write error';
    console.warn('[TokenWise] Storage set error:', safeMessage);
  }
}

/**
 * Update the user settings, merging with existing values.
 */
export async function updateSettings(
  partial: Partial<UserSettings>
): Promise<void> {
  try {
    const current = await getStorageValue('settings');
    const updated: UserSettings = { ...current, ...partial };
    await setStorageValue('settings', updated);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Settings update error:', safeMessage);
  }
}

// ── Session Management ────────────────────────────────────────────

/**
 * Add a new session record with FIFO eviction at MAX_SESSION_ENTRIES.
 */
export async function addSessionRecord(record: SessionRecord): Promise<void> {
  try {
    const sessions = await getStorageValue('sessions');
    sessions.push(record);

    // FIFO eviction: keep only the most recent entries
    while (sessions.length > MAX_SESSION_ENTRIES) {
      sessions.shift();
    }

    await setStorageValue('sessions', sessions);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Session record error:', safeMessage);
  }
}

/**
 * Get sessions for a specific date range (last N days).
 */
export async function getRecentSessions(days: number = 7): Promise<SessionRecord[]> {
  try {
    const sessions = await getStorageValue('sessions');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    return sessions.filter(s => s.date >= cutoffStr);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Recent sessions error:', safeMessage);
    return [];
  }
}

// ── Active Session Management ─────────────────────────────────────

/**
 * Update or create an active session for a specific tab.
 */
export async function updateActiveSession(
  tabId: string,
  data: Partial<ActiveSession>
): Promise<void> {
  try {
    const activeSessions = await getStorageValue('activeSessions');
    const existing = activeSessions[tabId] || {
      site: 'chatgpt',
      conversationTokens: 0,
      currentInputTokens: 0,
      messageCount: 0,
      attachmentCount: 0,
      startedAt: new Date().toISOString(),
    };

    activeSessions[tabId] = { ...existing, ...data };
    await setStorageValue('activeSessions', activeSessions);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Active session update error:', safeMessage);
  }
}

/**
 * Remove an active session when a tab is closed.
 */
export async function removeActiveSession(tabId: string): Promise<void> {
  try {
    const activeSessions = await getStorageValue('activeSessions');
    delete activeSessions[tabId];
    await setStorageValue('activeSessions', activeSessions);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Active session remove error:', safeMessage);
  }
}

// ── Widget Position ───────────────────────────────────────────────

/**
 * Save widget position for persistence across page loads.
 */
export async function saveWidgetPosition(pos: WidgetPosition): Promise<void> {
  await setStorageValue('widgetPosition', pos);
}

/**
 * Get saved widget position.
 */
export async function getWidgetPosition(): Promise<WidgetPosition> {
  return getStorageValue('widgetPosition');
}

// ── Savings Tracking ──────────────────────────────────────────────

/**
 * Add to the estimated savings counter.
 */
export async function addEstimatedSavings(tokens: number): Promise<void> {
  try {
    const current = await getStorageValue('estimatedSavings');
    await setStorageValue('estimatedSavings', current + tokens);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Savings tracking error:', safeMessage);
  }
}

// ── Data Management ───────────────────────────────────────────────

/**
 * Clear all stored data (for "Clear all data" button in analytics).
 */
export async function clearAllData(): Promise<void> {
  try {
    await chrome.storage.local.clear();
    // Re-initialize with defaults
    await chrome.storage.local.set(DEFAULT_STORAGE);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Data clear error:', safeMessage);
  }
}

/**
 * Purge sessions older than the specified number of days.
 */
export async function purgeOldSessions(olderThanDays: number = 90): Promise<void> {
  try {
    const sessions = await getStorageValue('sessions');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const filtered = sessions.filter(s => s.date >= cutoffStr);
    await setStorageValue('sessions', filtered);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Purge error:', safeMessage);
  }
}

/**
 * Initialize storage with defaults if not already set.
 */
export async function initializeStorage(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(null);
    const updates: Partial<StorageSchema> = {};

    for (const [key, defaultValue] of Object.entries(DEFAULT_STORAGE)) {
      if (result[key] === undefined) {
        (updates as Record<string, unknown>)[key] = defaultValue;
      }
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : 'Unknown error';
    console.warn('[TokenWise] Storage init error:', safeMessage);
  }
}
