/**
 * Error Reporter: Captures and logs errors for debugging
 * Stores errors in chrome.storage for monitoring
 */

export interface ErrorReport {
  id: string;
  site: 'chatgpt' | 'claude' | 'gemini' | 'background';
  code: string; // e.g., "INPUT_ELEMENT_NOT_FOUND", "ATTACHMENT_DETECTION_FAILED"
  message: string;
  details?: string;
  stack?: string;
  timestamp: number;
  userAgent: string;
}

const MAX_STORED_ERRORS = 100;
const ERROR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Report an error to storage for debugging
 */
export async function reportError(
  site: ErrorReport['site'],
  code: string,
  message: string,
  details?: string,
  error?: Error
): Promise<void> {
  try {
    const report: ErrorReport = {
      id: `${code}-${Date.now()}`,
      site,
      code,
      message,
      details,
      stack: error?.stack,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
    };

    // Only in extension context
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get('errorReports');
      const reports: ErrorReport[] = result.errorReports || [];

      // Add new error
      reports.push(report);

      // Remove old errors
      const cutoff = Date.now() - ERROR_RETENTION_MS;
      const filtered = reports.filter((r) => r.timestamp > cutoff);

      // Keep only recent errors
      const trimmed = filtered.slice(-MAX_STORED_ERRORS);

      await chrome.storage.local.set({ errorReports: trimmed });

      // Also log to console in development
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[TokenWise Error] ${site}:${code}`,
          message,
          details,
          error
        );
      }
    }
  } catch (e) {
    // Silently fail if error reporting itself breaks
    if (process.env.NODE_ENV !== 'production') {
      console.error('[TokenWise] Error reporting failed:', e);
    }
  }
}

/**
 * Get all stored error reports
 */
export async function getErrorReports(): Promise<ErrorReport[]> {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return [];
    }
    const result = await chrome.storage.local.get('errorReports');
    return result.errorReports || [];
  } catch {
    return [];
  }
}

/**
 * Clear all error reports
 */
export async function clearErrorReports(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ errorReports: [] });
    }
  } catch {
    // Silently fail
  }
}

/**
 * Get error summary for popup
 */
export async function getErrorSummary(): Promise<{
  total: number;
  byCode: Record<string, number>;
  bySite: Record<string, number>;
  recent: ErrorReport[];
}> {
  const reports = await getErrorReports();

  const byCode: Record<string, number> = {};
  const bySite: Record<string, number> = {};

  for (const report of reports) {
    byCode[report.code] = (byCode[report.code] || 0) + 1;
    bySite[report.site] = (bySite[report.site] || 0) + 1;
  }

  return {
    total: reports.length,
    byCode,
    bySite,
    recent: reports.slice(-10),
  };
}
