/**
 * Health Check: Monitors content script lifecycle
 * Allows service worker to detect dead content scripts
 */

export interface ContentScriptHealth {
  site: 'chatgpt' | 'claude' | 'gemini';
  tabId: number;
  initialized: boolean;
  lastHeartbeat: number;
  initialized_at: number;
  errors_count: number;
}

/**
 * Get health status of a content script
 */
export function isContentScriptHealthy(
  health: ContentScriptHealth,
  heartbeatTimeoutMs: number = 30000
): boolean {
  if (!health.initialized) {
    return false;
  }

  const timeSinceHeartbeat = Date.now() - health.lastHeartbeat;
  return timeSinceHeartbeat < heartbeatTimeoutMs;
}

/**
 * Format health status for display
 */
export function formatHealthStatus(
  health: ContentScriptHealth
): {
  status: 'healthy' | 'stale' | 'uninitialized';
  message: string;
} {
  if (!health.initialized) {
    return {
      status: 'uninitialized',
      message: `${health.site}: Not initialized`,
    };
  }

  if (!isContentScriptHealthy(health)) {
    return {
      status: 'stale',
      message: `${health.site}: No heartbeat for ${Date.now() - health.lastHeartbeat}ms`,
    };
  }

  return {
    status: 'healthy',
    message: `${health.site}: OK`,
  };
}
