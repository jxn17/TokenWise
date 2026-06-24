/**
 * TokenWise DOM Monitor
 *
 * Centralized site configuration and DOM observation utilities.
 * All selectors are defined here — never hardcoded inline.
 * MutationObserver callbacks are debounced at ≥300ms.
 */

// ── Type Definitions ──────────────────────────────────────────────

export interface SiteConfig {
  inputSelector: string;
  messageSelector: string;
  sendButtonSelector: string;
  assistantRole: string;
  userRole: string;
  shadowDom: boolean;
  chatContainerSelector: string;
  fileAttachmentSelector: string;
  hostname: string;
}

export type SiteName = 'chatgpt' | 'claude' | 'gemini';

// ── Site Configurations ───────────────────────────────────────────

export const SITE_CONFIGS: Record<SiteName, SiteConfig> = {
  chatgpt: {
    inputSelector: '#prompt-textarea, [id="prompt-textarea"], div[contenteditable="true"][id="prompt-textarea"]',
    messageSelector: '[data-message-author-role]',
    sendButtonSelector: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
    assistantRole: 'assistant',
    userRole: 'user',
    shadowDom: false,
    chatContainerSelector: '[role="presentation"] .flex.flex-col, main .flex.flex-col',
    fileAttachmentSelector: 'div[role="group"][aria-label][class*="file-tile"], div[role="group"][class*="file-tile"], [class*="file-tile"][class*="text-token-text-primary"]',
    hostname: 'chat.openai.com',
  },

  claude: {
    inputSelector: '.tiptap.ProseMirror, div.ProseMirror[contenteditable="true"], div[role="textbox"][contenteditable="true"], div.ProseMirror, [aria-label="Message Claude"][contenteditable="true"], [aria-label*="Message Claude"], [data-placeholder][contenteditable="true"], [data-testid="composer-input"] div.ProseMirror, [data-testid="composer-input"]',
    messageSelector: '[data-testid="user-message"], .font-user-message, .font-claude-response, [data-testid="assistant-message"]',
    sendButtonSelector: 'button[aria-label="Send Message"], button[aria-label="Send message"], button[data-testid="send-button"], button[type="submit"]',
    assistantRole: 'assistant',
    userRole: 'human',
    shadowDom: false,
    chatContainerSelector: '[data-testid="chat-stale-nav-inert"], [data-testid="conversation"], main, [class*="ConversationContent"]',
    fileAttachmentSelector: '[class*="group/thumbnail"], [data-testid="file-thumbnail"], [data-testid="image-thumbnail"], [data-testid="file-attachment"], [data-testid="attachment"], [class*="file-pill"], [class*="uploaded-file"]',
    hostname: 'claude.ai',
  },

  gemini: {
    inputSelector: '.ql-editor, [contenteditable="true"].textarea, rich-textarea .ql-editor',
    // Only target the <message-content> custom element — the authoritative Gemini turn element.
    // DO NOT add .response-container or .model-response-text: those match nested children AND
    // ancestor wrapper divs of <message-content>, causing each response to be counted 3×.
    messageSelector: 'message-content',
    sendButtonSelector: 'button.send-button, button[aria-label="Send message"], .send-button-container button',
    assistantRole: 'model',
    userRole: 'user',
    shadowDom: true,
    chatContainerSelector: '.conversation-container, [class*="conversation"]',
    // Use only specific chip selectors to avoid matching the entire message or UI elements.
    fileAttachmentSelector: 'uploader-file-preview, gem-media-attachment, .file-preview-chip, .file-preview-container, .gem-attachment-tile',
    hostname: 'gemini.google.com',
  },
};

// ── Site Detection ────────────────────────────────────────────────

/**
 * Detect which supported site the user is currently on.
 * Returns null if not on a supported site.
 */
export function detectCurrentSite(): SiteName | null {
  const hostname = window.location.hostname;

  if (hostname === 'chat.openai.com' || hostname === 'chatgpt.com') {
    return 'chatgpt';
  }
  if (hostname === 'claude.ai' || hostname === 'www.claude.ai') {
    return 'claude';
  }
  if (hostname === 'gemini.google.com') {
    return 'gemini';
  }

  return null;
}

/**
 * Get the config for the current site.
 */
export function getCurrentSiteConfig(): SiteConfig | null {
  const site = detectCurrentSite();
  if (!site) return null;
  return SITE_CONFIGS[site];
}

// ── Safe DOM Queries ──────────────────────────────────────────────

/**
 * Safely query a DOM element, returning null if not found.
 * For Gemini, attempts to traverse shadow DOM roots.
 */
export function safeQuerySelector(
  selector: string,
  root: Document | Element | ShadowRoot = document,
  config?: SiteConfig
): Element | null {
  try {
    // Try each selector in a comma-separated list
    const selectors = selector.split(',').map(s => s.trim());

    for (const sel of selectors) {
      const element = root.querySelector(sel);
      if (element) return element;
    }

    // For Shadow DOM sites, attempt to traverse shadow roots
    if (config?.shadowDom) {
      return queryShadowDom(selector, document.body);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Query all matching elements safely.
 */
export function safeQuerySelectorAll(
  selector: string,
  root: Document | Element | ShadowRoot = document,
  config?: SiteConfig
): Element[] {
  try {
    const selectors = selector.split(',').map(s => s.trim());
    const seen = new Set<Element>();
    const results: Element[] = [];

    for (const sel of selectors) {
      const elements = root.querySelectorAll(sel);
      elements.forEach(el => {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      });
    }

    // For Shadow DOM sites, also search shadow roots
    if (config?.shadowDom && results.length === 0) {
      return queryShadowDomAll(selector, document.body);
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Traverse shadow DOM to find an element by selector.
 * Limited depth to prevent infinite recursion.
 */
function queryShadowDom(
  selector: string,
  root: Element,
  depth: number = 0
): Element | null {
  if (depth > 10) return null;

  try {
    if (root.shadowRoot) {
      const selectors = selector.split(',').map(s => s.trim());
      for (const sel of selectors) {
        const found = root.shadowRoot.querySelector(sel);
        if (found) return found;
      }

      // Recurse into shadow root children
      const children = root.shadowRoot.querySelectorAll('*');
      for (const child of children) {
        const result = queryShadowDom(selector, child, depth + 1);
        if (result) return result;
      }
    }

    // Check regular children for nested shadow roots
    const children = root.querySelectorAll('*');
    for (const child of children) {
      if (child.shadowRoot) {
        const result = queryShadowDom(selector, child, depth + 1);
        if (result) return result;
      }
    }
  } catch {
    // Silently handle DOM access errors
  }

  return null;
}

/**
 * Traverse shadow DOM to find all matching elements.
 */
function queryShadowDomAll(
  selector: string,
  root: Element,
  depth: number = 0
): Element[] {
  const results: Element[] = [];
  if (depth > 10) return results;

  try {
    if (root.shadowRoot) {
      const selectors = selector.split(',').map(s => s.trim());
      for (const sel of selectors) {
        const found = root.shadowRoot.querySelectorAll(sel);
        found.forEach(el => results.push(el));
      }

      const children = root.shadowRoot.querySelectorAll('*');
      for (const child of children) {
        results.push(...queryShadowDomAll(selector, child, depth + 1));
      }
    }

    const children = root.querySelectorAll('*');
    for (const child of children) {
      if (child.shadowRoot) {
        results.push(...queryShadowDomAll(selector, child, depth + 1));
      }
    }
  } catch {
    // Silently handle DOM access errors
  }

  return results;
}

// ── Debounced MutationObserver ─────────────────────────────────────

export interface DebouncedObserver {
  observe: (target: Node, options?: MutationObserverInit) => void;
  disconnect: () => void;
}

/**
 * Create a MutationObserver with a debounced callback (≥300ms).
 * Automatically disconnects on page unload.
 */
export function createDebouncedObserver(
  callback: (mutations: MutationRecord[]) => void,
  debounceMs: number = 300
): DebouncedObserver {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingMutations: MutationRecord[] = [];

  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    pendingMutations.push(...mutations);

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      const batch = [...pendingMutations];
      pendingMutations = [];
      timeoutId = null;

      try {
        callback(batch);
      } catch {
        // Fail silently — never throw from observer callback
      }
    }, debounceMs);
  });

  // Auto-disconnect on page unload
  const cleanup = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    observer.disconnect();
    pendingMutations = [];
  };

  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('pagehide', cleanup);

  return {
    observe: (target: Node, options?: MutationObserverInit) => {
      observer.observe(target, options || {
        childList: true,
        subtree: true,
        characterData: true,
      });
    },
    disconnect: () => {
      cleanup();
      window.removeEventListener('beforeunload', cleanup);
      window.removeEventListener('pagehide', cleanup);
    },
  };
}

/**
 * Extract text content from an element, handling contenteditable and textareas.
 */
export function getInputText(element: Element | null): string {
  if (!element) return '';

  try {
    if (element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    if (element instanceof HTMLInputElement) {
      return element.value;
    }

    const proseTarget =
      element.classList.contains('ProseMirror')
        ? element
        : element.querySelector('.ProseMirror');

    const target = proseTarget || element;
    const htmlEl = target as HTMLElement;
    const text = (htmlEl.innerText || target.textContent || '')
      .replace(/\u200b/g, '')  // strip zero-width spaces
      .replace(/\n$/, '');     // strip Tiptap/ProseMirror trailing newline on empty editor
    return text;
  } catch {
    return '';
  }
}

/**
 * Write text into a composer element (textarea, contenteditable, or ProseMirror).
 */
export function setInputText(element: Element | null, text: string): void {
  if (!element) return;

  try {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      element.value = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return;
    }

    const target =
      element.classList.contains('ProseMirror')
        ? element
        : element.querySelector('.ProseMirror') || element;

    while (target.firstChild) {
      target.removeChild(target.firstChild);
    }

    const lines = text.split('\n');
    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      const p = document.createElement('p');
      p.appendChild(document.createElement('br'));
      target.appendChild(p);
    } else {
      for (const line of lines) {
        const p = document.createElement('p');
        if (line.length > 0) {
          p.textContent = line;
        } else {
          p.appendChild(document.createElement('br'));
        }
        target.appendChild(p);
      }
    }

    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {
    try {
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      // Fail silently
    }
  }
}

/**
 * Position a floating panel directly above the chat composer.
 */
export function positionPanelAboveElement(panel: HTMLElement, anchor: Element | null): void {
  if (!anchor) {
    panel.style.top = 'auto';
    panel.style.bottom = '120px';
    panel.style.left = '50%';
    panel.style.transform = 'translateX(-50%)';
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const panelHeight = panel.offsetHeight || 140;
  const top = Math.max(12, rect.top - panelHeight - 10);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - 520));

  panel.style.position = 'fixed';
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
  panel.style.width = `${Math.min(500, Math.max(280, rect.width))}px`;
  panel.style.maxWidth = '92vw';
}

/**
 * Pick the bottom-most visible element (composer is usually at page bottom).
 */
export function pickBottomMostVisible(elements: Element[]): Element | null {
  let best: Element | null = null;
  let bestBottom = -1;

  for (const el of elements) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.height > 8 && rect.width > 8 && rect.bottom >= bestBottom) {
        bestBottom = rect.bottom;
        best = el;
      }
    } catch {
      // Skip elements that can't be measured
    }
  }

  return best;
}

/**
 * Find the chat composer input using ordered selector strategies.
 * When multiple elements match, returns the bottom-most visible one.
 */
export function findComposerInput(config: SiteConfig): Element | null {
  const selectors = config.inputSelector.split(',').map((s) => s.trim());

  for (const sel of selectors) {
    try {
      const matches = document.querySelectorAll(sel);
      if (matches.length === 0) continue;
      if (matches.length === 1) return matches[0];
      const best = pickBottomMostVisible(Array.from(matches));
      if (best) return best;
    } catch {
      // Try next selector
    }
  }

  return null;
}

/**
 * Sort elements by document order.
 */
function sortByDocumentOrder(elements: Element[]): Element[] {
  return elements.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
}

/**
 * Remove elements that are ancestors of other matches in the list.
 */
function dedupeNestedElements(elements: Element[]): Element[] {
  return elements.filter(
    (el) => !elements.some((other) => other !== el && other.contains(el))
  );
}

function isClaudeUserMessage(el: Element): boolean {
  if (el.matches('[data-testid="user-message"], .font-user-message, .human-turn')) {
    return true;
  }
  return el.closest('[data-testid="user-message"], .font-user-message, .human-turn') !== null;
}

/**
 * Extract Claude messages using current Anthropic DOM patterns.
 */
export function extractClaudeMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  try {
    // Strategy 1: Try paired [data-testid="user-message"] + .font-claude-response
    // (Claude's current DOM as of 2026 — data-testid turn wrappers no longer exist)
    const userMsgs = Array.from(document.querySelectorAll('[data-testid="user-message"]'));
    const assistantMsgs = Array.from(document.querySelectorAll('.font-claude-response, [data-testid="assistant-message"]'));

    if (userMsgs.length > 0 || assistantMsgs.length > 0) {
      const all = [
        ...userMsgs.map(el => ({ el, role: 'user' as const })),
        ...assistantMsgs.map(el => ({ el, role: 'assistant' as const })),
      ].sort((a, b) => {
        const pos = a.el.compareDocumentPosition(b.el);
        return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      for (const { el, role } of all) {
        const content = el.textContent?.trim() || '';
        if (!content) continue;
        messages.push({ role, content });
      }
      if (messages.length > 0) return messages;
    }

    // Strategy 2: Fall back to existing selector-based approach
    const selector =
      '[data-testid="user-message"], .font-user-message, .font-claude-response, [data-testid="assistant-message"]';
    const candidates = dedupeNestedElements(Array.from(document.querySelectorAll(selector)));
    const ordered = sortByDocumentOrder(candidates);

    for (const el of ordered) {
      const content = el.textContent?.trim() || '';
      if (!content) continue;

      messages.push({
        role: isClaudeUserMessage(el) ? 'user' : 'assistant',
        content,
      });
    }

    // Strategy 3: recover .standard-markdown blocks that are siblings (not children)
    // of the captured elements.  Claude wraps some rich-formatted content
    // (tables, annotated code sections, step-by-step explanations) in
    // .standard-markdown divs that live *outside* .font-claude-response in the DOM.
    // Without this pass, those blocks are silently skipped and their tokens are lost.
    try {
      const capturedEls = Array.from(document.querySelectorAll(selector));
      const markdownEls = Array.from(document.querySelectorAll('.standard-markdown'));

      for (const mdEl of markdownEls) {
        // Skip if already contained inside a captured element (already counted)
        const alreadyCaptured = capturedEls.some(captured => captured.contains(mdEl));
        if (alreadyCaptured) continue;

        const content = mdEl.textContent?.trim() || '';
        if (!content) continue;

        // Append to the last assistant message if one exists, otherwise push new
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content += '\n' + content;
        } else {
          messages.push({ role: 'assistant', content });
        }
      }
    } catch {
      // Fail silently
    }
  } catch {
    // Fail silently if DOM structure has changed
  }

  return messages;
}

/**
 * Extract all message texts from the chat container.
 */
export function extractMessages(
  config: SiteConfig,
  site?: SiteName
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (site === 'claude') {
    const claudeMessages = extractClaudeMessages();
    if (claudeMessages.length > 0) return claudeMessages;
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  try {
    const elements = safeQuerySelectorAll(config.messageSelector, document, config);

    for (const el of elements) {
      const role = el.getAttribute('data-message-author-role')
        || el.getAttribute('data-role')
        || '';
      const content = el.textContent?.trim() || '';

      if (!content) continue;

      if (role === config.userRole || el.classList.contains('user-message') || el.classList.contains('font-user-message')) {
        messages.push({ role: 'user', content });
      } else if (
        role === config.assistantRole ||
        el.classList.contains('assistant-message') ||
        el.classList.contains('model-response-text') ||
        el.classList.contains('font-claude-response')
      ) {
        messages.push({ role: 'assistant', content });
      } else {
        // Default: if we can't determine role, classify by position
        // Even-indexed = user, odd-indexed = assistant (common pattern)
        messages.push({
          role: messages.length % 2 === 0 ? 'user' : 'assistant',
          content,
        });
      }
    }
  } catch {
    // Fail silently if DOM structure has changed
  }

  return messages;
}
