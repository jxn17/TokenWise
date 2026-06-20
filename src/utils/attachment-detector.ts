/**
 * Attachment Detector: Testable, debuggable attachment detection
 * Separates DOM querying from business logic for testing
 */

import { estimateFileTokens, type FileEstimate } from './media-estimator';
import { reportError } from './error-reporter';

export interface AttachmentConfig {
  selector: string;
  metadataAttributes?: {
    filename?: string;
    filesize?: string;
    filetype?: string;
  };
  fallbackParser?: (el: Element) => { name: string; size: number } | null;
  site: 'chatgpt' | 'claude' | 'gemini';
}

export interface DetectionResult {
  elements: Element[];
  attachments: FileEstimate[];
  detectionAttempts: number;
  parseFailures: number;
  lastDetectionTime: number;
}

/**
 * Safe querySelector that handles errors
 */
export function safeQuerySelectorAll(
  selector: string,
  root: Document | Element = document
): Element[] {
  try {
    if (!selector || selector.trim().length === 0) {
      return [];
    }
    const result = root.querySelectorAll(selector);
    return Array.from(result);
  } catch (e) {
    console.warn('[TokenWise] Failed to query selector:', selector, e);
    return [];
  }
}

/**
 * Detect attachments using provided configuration
 * Returns both raw elements and parsed attachment data
 */
export async function detectAttachments(
  config: AttachmentConfig
): Promise<DetectionResult> {
  const startTime = Date.now();
  const result: DetectionResult = {
    elements: [],
    attachments: [],
    detectionAttempts: 1,
    parseFailures: 0,
    lastDetectionTime: startTime,
  };

  try {
    // Query for attachment elements
    const elements = safeQuerySelectorAll(config.selector);
    result.elements = elements;

    if (elements.length === 0) {
      // Log in development mode
      if (process.env.NODE_ENV !== 'production') {
        console.debug(
          `[TokenWise] No attachments found with selector: ${config.selector}`
        );
      }
      return result;
    }

    // Parse each element into FileEstimate
    for (const el of elements) {
      try {
        let filename = el.getAttribute(
          config.metadataAttributes?.filename || 'data-filename'
        );
        let filesize = el.getAttribute(
          config.metadataAttributes?.filesize || 'data-filesize'
        );

        // Try fallback parser if attributes not found
        if ((!filename || !filesize) && config.fallbackParser) {
          const parsed = config.fallbackParser(el);
          if (parsed) {
            filename = parsed.name;
            filesize = String(parsed.size);
          }
        }

        if (!filename || !filesize) {
          result.parseFailures++;
          continue;
        }

        const estimate = estimateFileTokens(
          filename,
          parseInt(filesize, 10),
          el.getAttribute(
            config.metadataAttributes?.filetype || 'data-filetype'
          ) || '',
          0,
          0
        );

        result.attachments.push(estimate);
      } catch (e) {
        result.parseFailures++;
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[TokenWise] Failed to parse attachment element:', e);
        }
      }
    }

    result.lastDetectionTime = Date.now();
    return result;
  } catch (e) {
    await reportError(
      config.site,
      'ATTACHMENT_DETECTION_FAILED',
      'Failed to detect attachments',
      `Selector: ${config.selector}`,
      e instanceof Error ? e : undefined
    );
    return result;
  }
}

/**
 * Extract text content with fallback parsing
 * Useful when DOM attributes don't exist
 */
export function extractMetadataFromText(text: string): {
  filename?: string;
  filesize?: string;
} | null {
  // Common patterns: "file.pdf (1.2 MB)" or "image.png 512KB"
  const filenameMatch = text.match(/[\w\s\-]+\.[a-zA-Z0-9]{2,4}/);
  const filesizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)/i);

  if (!filenameMatch) {
    return null;
  }

  const result: { filename?: string; filesize?: string } = {
    filename: filenameMatch[0],
  };

  if (filesizeMatch) {
    const size = parseFloat(filesizeMatch[1]);
    const unit = filesizeMatch[2].toUpperCase();
    const unitMap: Record<string, number> = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    result.filesize = String(Math.floor(size * (unitMap[unit] || 1)));
  }

  return result;
}

/**
 * Check if a given selector is valid (doesn't throw on query)
 */
export function validateSelector(selector: string): boolean {
  try {
    document.querySelectorAll(selector);
    return true;
  } catch {
    return false;
  }
}
