/**
 * TokenWise Content Script — Gemini
 *
 * Injected into gemini.google.com.
 * Handles Shadow DOM traversal since Gemini uses Shadow DOM heavily.
 * All logic wrapped in IIFE to avoid polluting page's global scope.
 * Never exposes functions to window object.
 */

import { countTokens, estimateConversationTokens, type ModelType, type Message } from '../utils/tokenizer';
import { createSuggestionPanelController, type SuggestionPanelController } from '../utils/suggestion-panel';
import { renderWidgetBody } from '../utils/widget-ui';
import { estimateFileTokens, detectURLs, generateFileTooltip, type FileEstimate } from '../utils/media-estimator';
import { reportError } from '../utils/error-reporter';
import { detectAttachments, type AttachmentConfig } from '../utils/attachment-detector';
import { createGhostTextController, type GhostTextController } from '../utils/ghost-text-ui';
import { createEducationPanelController, type EducationPanelController } from '../utils/token-education';
import {
  SITE_CONFIGS,
  createDebouncedObserver,
  safeQuerySelector,
  safeQuerySelectorAll,
  getInputText,
  setInputText,
  positionPanelAboveElement,
  type DebouncedObserver,
} from '../utils/dom-monitor';

(function tokenWiseGemini(): void {
  // ── State ─────────────────────────────────────────────────────

  const SITE = 'gemini' as const;
  const CONFIG = SITE_CONFIGS[SITE];
  const MODEL: ModelType = 'gemini-pro';

  let inputObserver: DebouncedObserver | null = null;
  let chatObserver: DebouncedObserver | null = null;
  let widgetElement: HTMLElement | null = null;
  let suggestionPanel: SuggestionPanelController | null = null;
  let currentAttachments: FileEstimate[] = [];
  let currentInputTokens = 0;
  let conversationTokens = 0;
  let messageCount = 0;
  let attachmentCount = 0;
  let sessionStartTime = Date.now();
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let widgetVisible = true;
  let showSuggestions = true;
  let ghostText: GhostTextController | null = null;
  let educationPanel: EducationPanelController | null = null;

  // ── Initialization ────────────────────────────────────────────

  async function init(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['widgetVisible', 'settings']);
      widgetVisible = result.widgetVisible !== false;
      showSuggestions = !result.settings || result.settings.showSuggestions !== false;

      if (!widgetVisible) return;

      createWidget();
      if (showSuggestions) {
        initSuggestionPanel();
      }
      initEducationPanel();
      initGhostText();

      await waitForGeminiInput(15000);

      setupInputObserver();
      setupChatObserver();
      setupFileDetection();
      setupPasteDetection();
      scanConversation();

      sendUpdate();
      setupStorageListener();
    } catch {
      // Fail silently — Gemini's DOM might not be ready or structure changed
    }
  }

  // ── Gemini Shadow DOM Helpers ─────────────────────────────────

  /**
   * Wait for Gemini's input element, handling Shadow DOM.
   * Gemini loads its UI inside Shadow DOM components,
   * so we need a more patient approach.
   */
  async function waitForGeminiInput(timeout: number): Promise<Element> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      function tryFind(): void {
        // Try standard query first
        let el = safeQuerySelector(CONFIG.inputSelector, document, CONFIG);

        // Also try searching known Gemini shadow hosts
        if (!el) {
          el = findInShadowRoots(CONFIG.inputSelector);
        }

        if (el) {
          resolve(el);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error('Gemini input not found'));
          return;
        }

        setTimeout(tryFind, 500);
      }

      tryFind();
    });
  }

  /**
   * Search for an element by traversing known Shadow DOM patterns in Gemini.
   * Limited recursion depth to prevent performance issues.
   */
  function findInShadowRoots(selector: string, root: Element = document.body, depth: number = 0): Element | null {
    if (depth > 8) return null;

    try {
      // Check shadow root of this element
      if (root.shadowRoot) {
        const selectors = selector.split(',').map(s => s.trim());
        for (const sel of selectors) {
          const found = root.shadowRoot.querySelector(sel);
          if (found) return found;
        }

        // Recurse into shadow root children
        const children = root.shadowRoot.querySelectorAll('*');
        for (const child of children) {
          const result = findInShadowRoots(selector, child, depth + 1);
          if (result) return result;
        }
      }

      // Check children with shadow roots
      const children = root.querySelectorAll('*');
      for (const child of children) {
        if (child.shadowRoot) {
          const result = findInShadowRoots(selector, child, depth + 1);
          if (result) return result;
        }
      }
    } catch {
      // Permission denied on some shadow roots
    }

    return null;
  }

  /**
   * Find all matching elements across Shadow DOM boundaries.
   */
  function findAllInShadowRoots(selector: string, root: Element = document.body, depth: number = 0): Element[] {
    const results: Element[] = [];
    if (depth > 8) return results;

    try {
      if (root.shadowRoot) {
        const selectors = selector.split(',').map(s => s.trim());
        for (const sel of selectors) {
          const found = root.shadowRoot.querySelectorAll(sel);
          found.forEach(el => results.push(el));
        }

        const children = root.shadowRoot.querySelectorAll('*');
        for (const child of children) {
          results.push(...findAllInShadowRoots(selector, child, depth + 1));
        }
      }

      const children = root.querySelectorAll('*');
      for (const child of children) {
        if (child.shadowRoot) {
          results.push(...findAllInShadowRoots(selector, child, depth + 1));
        }
      }
    } catch {
      // Permission denied on some shadow roots
    }

    return results;
  }

  /**
   * Extract messages from Gemini's DOM, handling Shadow DOM structure.
   */
  function extractGeminiMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    try {
      // Gemini uses Shadow DOM extensively. We must search across all shadow boundaries.
      // We explicitly query for both assistant messages (`message-content`, `model-response`)
      // and user messages (`user-query`).
      const selector = `${CONFIG.messageSelector}, user-query, model-response`;
      let elements = Array.from(document.querySelectorAll(selector));
      elements.push(...findAllInShadowRoots(selector));

      // Fallback: alternating turn containers (no .response-container — too broad)
      if (elements.length === 0) {
        elements = Array.from(document.querySelectorAll('.turn-content, .query-content'));
        elements.push(...findAllInShadowRoots('.turn-content, .query-content'));
      }

      // ── Ancestor deduplication ──────────────────────────────────
      // Remove any element that is a descendant of another matched element.
      // This prevents double/triple counting when both an outer wrapper and
      // an inner element are matched by the same selector list.
      const deduped = elements.filter(
        (el) => !elements.some((other) => other !== el && other.contains(el))
      );

      // ── Text-content deduplication ──────────────────────────────
      // Gemini sometimes renders the same message-content element in both the
      // light DOM and inside a user-query shadow/wrapper, causing cross-tree
      // duplicates that `contains()` cannot detect. Deduplicate by text fingerprint.
      const seenTexts = new Set<string>();

      for (const el of deduped) {
        const rawContent = el.textContent?.trim() || '';
        if (!rawContent) continue;

        // Role detection: <message-content> is always a model (assistant) response.
        // User turns live in <user-query> or a sibling with data-role="user".
        const tag = el.tagName.toLowerCase();
        const isModel = tag === 'message-content'
          || el.classList.contains('model-response-text')
          || el.closest('[data-role="model"]') !== null
          || el.closest('model-response') !== null;

        const isUser = tag === 'user-query'
          || el.closest('[data-role="user"]') !== null
          || el.closest('user-query') !== null;

        // Skip elements where we can't determine role to avoid mis-attribution
        if (!isModel && !isUser) continue;

        let content = rawContent;

        if (isUser) {
          // Gemini's user-query elements sometimes contain a "Gemini said\n\n<assistant text>"
          // reflection prefix showing the previous assistant response in the turn context.
          // Strip that prefix so only the actual human message text is counted.
          const GEMINI_SAID_RE = /^Gemini said\s*\n+/i;
          content = content.replace(GEMINI_SAID_RE, '').trim();

          // After stripping, if the content is empty or identical to the previous
          // assistant message, this element is purely a reflection — skip it.
          if (!content) continue;

          // If the remaining text exactly matches the last assistant message we already
          // recorded (i.e., the whole user-query is just "Gemini said <response>"),
          // skip it to avoid double-counting the response as a "user" message.
          const lastMsg = messages[messages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant' && lastMsg.content === content) continue;
        }

        // Text-fingerprint dedup: skip if we've already recorded this exact content.
        // Use a 120-char prefix as fingerprint to handle minor whitespace differences.
        const fingerprint = content.slice(0, 120);
        if (seenTexts.has(fingerprint)) continue;
        seenTexts.add(fingerprint);

        messages.push({
          role: isModel ? 'assistant' : 'user',
          content,
        });
      }
    } catch {
      // Fail silently
    }

    return messages;
  }

  // ── Widget Creation ───────────────────────────────────────────

  function createWidget(): void {
    if (widgetElement) return;

    widgetElement = document.createElement('div');
    widgetElement.id = 'tokenwise-widget';
    widgetElement.setAttribute('data-tokenwise', 'true');

    Object.assign(widgetElement.style, {
      position: 'fixed',
      bottom: '80px',
      right: '20px',
      zIndex: '999999',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #2a2a42 100%)',
      borderRadius: '12px',
      padding: '12px 16px',
      color: '#e0e0e0',
      fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize: '13px',
      lineHeight: '1.4',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
      cursor: 'grab',
      userSelect: 'none',
      transition: 'box-shadow 0.2s ease, transform 0.2s ease',
      minWidth: '200px',
      backdropFilter: 'blur(20px)',
    });

    updateWidgetContent(0, 0);

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '×';
    Object.assign(dismissBtn.style, {
      position: 'absolute', top: '4px', right: '8px', background: 'none',
      border: 'none', color: '#888', fontSize: '16px', cursor: 'pointer',
      padding: '2px 4px', lineHeight: '1',
    });
    dismissBtn.addEventListener('click', (e: Event) => { e.stopPropagation(); hideWidget(); });
    widgetElement.appendChild(dismissBtn);

    widgetElement.addEventListener('mousedown', startDrag);
    restoreWidgetPosition();
    document.body.appendChild(widgetElement);
  }

  function hideWidget(): void {
    if (widgetElement) widgetElement.style.display = 'none';
    widgetVisible = false;
    try { chrome.storage.local.set({ widgetVisible: false }); } catch { /* ignore */ }
  }

  function updateWidgetContent(inputTokens: number, totalTokens: number): void {
    if (!widgetElement) return;

    const dismissBtn = widgetElement.querySelector('button');
    
    renderWidgetBody(widgetElement, dismissBtn, {
      siteLabel: 'Gemini',
      inputTokens,
      totalTokens,
      warningThreshold: 8000,
      criticalThreshold: 30000,
      getMessages: () => extractGeminiMessages(),
      contextExportMaxTokens: 5000,
    });

    // 💡 Tips toggle — re-opens the suggestion panel after dismissal
    // Remove any existing tips bulb before re-adding so we don't duplicate.
    const existingTipsBtn = widgetElement.querySelector('#tokenwise-opentips-btn');
    if (existingTipsBtn) existingTipsBtn.remove();

    if (suggestionPanel) {
      const tipsBtn = document.createElement('button');
      tipsBtn.id = 'tokenwise-opentips-btn';
      tipsBtn.textContent = '💡';
      tipsBtn.title = 'Show optimization tips';
      Object.assign(tipsBtn.style, {
        position: 'absolute',
        top: '4px',
        right: '28px',
        background: 'none',
        border: 'none',
        color: '#888',
        fontSize: '13px',
        cursor: 'pointer',
        padding: '2px 4px',
        lineHeight: '1',
      });
      tipsBtn.addEventListener('mousedown', (e: Event) => e.stopPropagation());
      tipsBtn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const inputEl = findGeminiInput();
        const text = inputEl ? getInputText(inputEl) : '';
        suggestionPanel?.forceShow(text, currentAttachments);
      });
      widgetElement.appendChild(tipsBtn);
    }

    // 📚 Education toggle — opens the token facts panel
    // Remove any existing education btn before re-adding so we don't duplicate.
    const existingEduBtn = widgetElement.querySelector('#tokenwise-education-btn');
    if (existingEduBtn) existingEduBtn.remove();

    const eduBtn = document.createElement('button');
    eduBtn.id = 'tokenwise-education-btn';
    eduBtn.textContent = '📚';
    eduBtn.title = 'Token facts & education';
    Object.assign(eduBtn.style, {
      position: 'absolute',
      top: '4px',
      right: '48px',
      background: 'none',
      border: 'none',
      color: '#888',
      fontSize: '13px',
      cursor: 'pointer',
      padding: '2px 4px',
      lineHeight: '1',
    });
    eduBtn.addEventListener('mousedown', (e: Event) => e.stopPropagation());
    eduBtn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      if (educationPanel) {
        if (educationPanel.isVisible()) {
          educationPanel.hide();
        } else {
          educationPanel.show('gemini');
        }
      }
    });
    widgetElement.appendChild(eduBtn);
  }

  // ── Widget Drag ───────────────────────────────────────────────

  function startDrag(e: MouseEvent): void {
    if (!widgetElement || (e.target as Element)?.tagName === 'BUTTON') return;
    isDragging = true;
    dragOffsetX = e.clientX - widgetElement.getBoundingClientRect().left;
    dragOffsetY = e.clientY - widgetElement.getBoundingClientRect().top;
    widgetElement.style.cursor = 'grabbing';
    widgetElement.style.transition = 'none';
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
  }

  function onDrag(e: MouseEvent): void {
    if (!isDragging || !widgetElement) return;
    widgetElement.style.left = `${Math.max(0, Math.min(e.clientX - dragOffsetX, window.innerWidth - 220))}px`;
    widgetElement.style.top = `${Math.max(0, Math.min(e.clientY - dragOffsetY, window.innerHeight - 100))}px`;
    widgetElement.style.right = 'auto';
    widgetElement.style.bottom = 'auto';
  }

  function stopDrag(): void {
    if (!isDragging || !widgetElement) return;
    isDragging = false;
    widgetElement.style.cursor = 'grab';
    widgetElement.style.transition = 'box-shadow 0.2s ease, transform 0.2s ease';
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    saveWidgetPosition();
  }

  async function saveWidgetPosition(): Promise<void> {
    if (!widgetElement) return;
    try {
      const rect = widgetElement.getBoundingClientRect();
      await chrome.storage.local.set({ widgetPosition: { x: rect.left, y: rect.top } });
    } catch { /* ignore */ }
  }

  async function restoreWidgetPosition(): Promise<void> {
    if (!widgetElement) return;
    try {
      const result = await chrome.storage.local.get('widgetPosition');
      const pos = result.widgetPosition;
      if (pos && pos.x >= 0 && pos.y >= 0) {
        widgetElement.style.left = `${pos.x}px`;
        widgetElement.style.top = `${pos.y}px`;
        widgetElement.style.right = 'auto';
        widgetElement.style.bottom = 'auto';
      }
    } catch { /* use default */ }
  }

  // ── Suggestion Panel ──────────────────────────────────────────

  function initSuggestionPanel(): void {
    if (suggestionPanel) return;

    suggestionPanel = createSuggestionPanelController({
      getInputElement: () => findGeminiInput(),
      getInputText: () => {
        const el = findGeminiInput();
        return el ? getInputText(el) : '';
      },
      setInputText: (element: Element, text: string) => {
        setInputText(element, text);
        handleInputChange();
      },
      onAfterApply: () => {
        // Any post-apply logic
      },
      trackSavings: (tokens: number) => {
        try {
          chrome.runtime.sendMessage({
            type: 'SAVINGS_TRACKED',
            data: { tokens },
          });
        } catch {
          // Ignore
        }
      }
    }, () => showSuggestions);

    if (showSuggestions) {
      suggestionPanel.create();
    }
  }

  // ── Education Panel ────────────────────────────────────────────

  function initEducationPanel(): void {
    if (educationPanel) return;
    educationPanel = createEducationPanelController();
    educationPanel.create();
  }

  // ── Gemini Input Finder ───────────────────────────────────────

  function findGeminiInput(): Element | null {
    let el = safeQuerySelector(CONFIG.inputSelector, document, CONFIG);
    if (!el) el = findInShadowRoots(CONFIG.inputSelector);
    return el;
  }

  // ── Input Observer ────────────────────────────────────────────

  function setupInputObserver(): void {
    const inputEl = findGeminiInput();
    if (!inputEl) return;

    inputObserver = createDebouncedObserver(() => { handleInputChange(); }, 300);
    inputObserver.observe(inputEl, { childList: true, subtree: true, characterData: true });
    inputEl.addEventListener('input', debounce(handleInputChange, 300));
  }

  function handleInputChange(): void {
    try {
      const inputEl = findGeminiInput();
      if (!inputEl) return;
      const text = getInputText(inputEl);
      const result = countTokens(text, MODEL);
      currentInputTokens = result.tokens;
      updateWidgetContent(currentInputTokens, conversationTokens + currentInputTokens);
      if (showSuggestions && text.trim().length >= 8) {
        suggestionPanel?.update(text, currentAttachments);
      } else if (suggestionPanel) {
        suggestionPanel.hide();
      }
      // Ghost text rewriter
      ghostText?.onInput(text);
      sendUpdate();
    } catch { /* fail silently */ }
  }

  function initGhostText(): void {
    if (ghostText) return;
    ghostText = createGhostTextController({
      getText: () => {
        const el = findGeminiInput();
        return el ? getInputText(el) : '';
      },
      getInputElement: () => findGeminiInput(),
      setText: (element: Element, text: string) => {
        setInputText(element, text);
        handleInputChange();
      },
      onApply: () => {
        try {
          chrome.runtime.sendMessage({ type: 'SAVINGS_TRACKED', data: { tokens: currentInputTokens } });
        } catch { /* ignore */ }
      },
    });
    ghostText.mount();
  }

  // ── Chat Observer ─────────────────────────────────────────────

  function setupChatObserver(): void {
    chatObserver = createDebouncedObserver(() => { scanConversation(); }, 500);
    // For Gemini, observe the entire body since messages might be in shadow DOM
    chatObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ── Token Estimation Add-ons ──────────────────────────────────

  /**
   * Detect Gemini Canvas/App iframes and produce a conservative token-cost estimate.
   */
  function estimateIframeTokens(): number {
    const REF_AREA = 720 * 488;
    const REF_TOKENS = 800;
    const MIN_TOKENS = 200;
    const MIN_DIMENSION = 50;
    
    let total = 0;
    try {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      iframes.push(...findAllInShadowRoots('iframe'));
      
      for (const iframe of iframes) {
        const htmlIframe = iframe as HTMLIFrameElement;
        const w = htmlIframe.offsetWidth || 0;
        const h = htmlIframe.offsetHeight || 0;
        
        if (w >= MIN_DIMENSION && h >= MIN_DIMENSION) {
          const area = w * h;
          total += Math.max(MIN_TOKENS, Math.round((area / REF_AREA) * REF_TOKENS));
        }
      }
    } catch {
      // Fail silently
    }
    return total;
  }

  /**
   * Detect Gemini thinking/reasoning blocks that are outside message-content.
   */
  function estimateThinkingTokens(): number {
    const selectors = [
      'thought-chunk', 'thinking-block', '[class*="thinking"]', '[class*="thought-"]',
      '[class*="-thought"]', '[data-thought]', '[class*="chain-of-thought"]',
      '[class*="reasoning"]', '[class*="think-"]', '[class*="model-thoughts"]',
      '[class*="thoughts-section"]', '[aria-label*="thought"]', '[aria-label*="thinking"]'
    ].join(', ');
    
    let total = 0;
    try {
      const elements = Array.from(document.querySelectorAll(selectors));
      elements.push(...findAllInShadowRoots(selectors));
      
      const deduped = elements.filter(
        (el) => !elements.some((other) => other !== el && other.contains(el))
      );
      
      for (const el of deduped) {
        if (!el.closest('message-content')) {
          const content = el.textContent?.trim() || '';
          if (content) {
            total += countTokens(content, MODEL).tokens;
          }
        }
      }
    } catch {
      // Fail silently
    }
    return total;
  }

  function scanConversation(): void {
    try {
      const messages = extractGeminiMessages();
      messageCount = messages.length;
      const messagesForCount: Message[] = messages.map(m => ({ role: m.role, content: m.content }));
      
      const baseTokens = estimateConversationTokens(messagesForCount, MODEL);
      const iframeTokens = estimateIframeTokens();
      const thinkingTokens = estimateThinkingTokens();
      // Also run attachment detection inline so the count is current
      detectAttachments();
      // Guard: estimatedTokens can be -1 (unknown) — treat those as 0 to avoid NaN
      const attachmentTokens = currentAttachments.reduce(
        (sum, a) => sum + Math.max(0, a.estimatedTokens),
        0
      );
      
      conversationTokens = baseTokens + iframeTokens + thinkingTokens + attachmentTokens;
      
      updateWidgetContent(currentInputTokens, conversationTokens + currentInputTokens);
      sendUpdate();
    } catch { /* fail silently */ }
  }

  // ── File Detection ────────────────────────────────────────────

  /**
   * Walk up from the Gemini input element to find its enclosing composer
   * container — the element that wraps the text box AND pending file chips,
   * but is NOT part of the scrollable chat history.
   *
   * Gemini uses Shadow DOM, so we climb the regular DOM from wherever the
   * input is found. We stop at the first ancestor whose tag or class looks
   * like a composer wrapper (rich-textarea, input-area, form, fieldset, or
   * a known Gemini wrapper class). Falls back to 6 ancestor levels if no
   * semantic boundary is found.
   */
  function findGeminiComposerContainer(): Element {
    const inputEl = findGeminiInput();
    if (!inputEl) return document.body;

    const composerTags = new Set(['form', 'fieldset', 'rich-textarea', 'input-area']);
    const composerClassHints = [
      'input-area', 'composer', 'chat-input', 'prompt-input',
      'input-container', 'message-input', 'query-box',
    ];

    let ancestor: Element | null = inputEl.parentElement;
    while (ancestor && ancestor !== document.body) {
      const tag = ancestor.tagName.toLowerCase();
      if (composerTags.has(tag)) return ancestor;
      const cls = (ancestor.className || '').toString().toLowerCase();
      if (composerClassHints.some(hint => cls.includes(hint))) return ancestor;
      ancestor = ancestor.parentElement;
    }

    // Fallback: walk up a fixed number of levels from the input
    let fallback: Element = inputEl;
    for (let i = 0; i < 8 && fallback.parentElement && fallback.parentElement !== document.body; i++) {
      fallback = fallback.parentElement;
    }
    return fallback;
  }

  function setupFileDetection(): void {
    const fileObserver = createDebouncedObserver(() => { detectAttachments(); }, 500);
    fileObserver.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Infer a MIME type string from visual cues on a Gemini attachment chip.
   * Checks class names, icon elements, badge/label text, and thumbnail type
   * in priority order. Returns empty string if nothing conclusive is found.
   */
  function inferGeminiMimeFromChip(el: Element): string {
    const fullClass = (el.className || '').toString().toLowerCase();
    const innerHTML = el.innerHTML?.toLowerCase() ?? '';

    // ── 1. Embedded thumbnail <img> with a real src → image
    const img = el.querySelector('img');
    if (img) {
      const src = img.getAttribute('src') || '';
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      if (src.startsWith('blob:') || src.startsWith('data:image/')) return 'image/jpeg';
      // A real src that isn't a generic placeholder → treat as image
      if (src && alt !== 'attachment') return 'image/jpeg';
    }

    // ── 2. Class names on the chip itself
    if (fullClass.includes('pdf')) return 'application/pdf';
    if (fullClass.includes('video')) return 'video/mp4';
    if (fullClass.includes('audio')) return 'audio/mpeg';
    if (fullClass.includes('spreadsheet') || fullClass.includes('excel') || fullClass.includes('sheet'))
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (fullClass.includes('presentation') || fullClass.includes('slide'))
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (fullClass.includes('document') || fullClass.includes('word') || fullClass.includes('doc'))
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (fullClass.includes('text') || fullClass.includes('code')) return 'text/plain';
    if (fullClass.includes('image') || fullClass.includes('photo') || fullClass.includes('picture'))
      return 'image/jpeg';

    // ── 3. Icon element class names (Gemini uses mat-icon / material-icons)
    const iconEl = el.querySelector('mat-icon, .material-icons, [class*="icon"], [class*="file-icon"]');
    if (iconEl) {
      const iconText = (iconEl.textContent || '').trim().toLowerCase();
      const iconClass = (iconEl.className || '').toString().toLowerCase();
      const combined = iconText + ' ' + iconClass;
      if (combined.includes('picture') || combined.includes('image') || combined.includes('photo'))
        return 'image/jpeg';
      if (combined.includes('pdf')) return 'application/pdf';
      if (combined.includes('video')) return 'video/mp4';
      if (combined.includes('audio') || combined.includes('music')) return 'audio/mpeg';
      if (combined.includes('spreadsheet') || combined.includes('table_chart') || combined.includes('grid'))
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (combined.includes('slides') || combined.includes('present'))
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      if (combined.includes('description') || combined.includes('article') || combined.includes('doc'))
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if (combined.includes('code') || combined.includes('text_snippet') || combined.includes('terminal'))
        return 'text/plain';
    }

    // ── 4. Visible badge / label text
    const badgeEl = el.querySelector('[class*="badge"], [class*="type-label"], [class*="format"]');
    if (badgeEl) {
      const badgeText = (badgeEl.textContent || '').trim().toLowerCase();
      if (badgeText === 'pdf') return 'application/pdf';
      if (badgeText === 'mp4' || badgeText === 'video') return 'video/mp4';
      if (badgeText === 'mp3' || badgeText === 'audio') return 'audio/mpeg';
      if (badgeText === 'xlsx' || badgeText === 'csv')
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (badgeText === 'pptx')
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      if (badgeText === 'docx' || badgeText === 'doc')
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }

    // ── 5. innerHTML keyword scan as last resort
    if (innerHTML.includes('"pdf"') || innerHTML.includes("'pdf'")) return 'application/pdf';

    return '';
  }

  function detectAttachments(): void {
    try {
      // ── Scope to the composer draft area only ─────────────────────────
      // Using document.body or findAllInShadowRoots(document.body) would also
      // match file chips inside sent chat-history messages, producing phantom
      // attachments when nothing is currently attached in the composer.
      const composerRoot = findGeminiComposerContainer();

      let rawAttachments: Element[];
      if (composerRoot) {
        rawAttachments = Array.from(composerRoot.querySelectorAll(CONFIG.fileAttachmentSelector));
        // Also search shadow roots WITHIN the composer container only
        rawAttachments.push(...findAllInShadowRoots(CONFIG.fileAttachmentSelector, composerRoot as HTMLElement));
      } else {
        // Fallback: full-document search (original behaviour)
        rawAttachments = Array.from(document.querySelectorAll(CONFIG.fileAttachmentSelector));
        rawAttachments.push(...findAllInShadowRoots(CONFIG.fileAttachmentSelector));
      }

      // ── Ancestor dedup ──────────────────────────────────────────────────────
      // The selector matches BOTH the outer <uploader-file-preview> chip AND nested
      // children inside it (<gem-media-attachment>, .file-preview-container, etc.).
      // Without dedup, a single attached file is counted as 4–5 separate attachments.
      // Keep only the outermost element in any parent→child chain.
      const attachments = rawAttachments.filter(
        (el) => !rawAttachments.some((other) => other !== el && other.contains(el))
      );

      attachmentCount = attachments.length;
      const estimates: FileEstimate[] = [];

      for (const el of attachments) {
        const img = el.querySelector('img') as HTMLImageElement | null;

        // ── Filename extraction: multi-step fallback ────────────────────────
        let fileName = '';

        // Step 1 — explicit data attribute (most reliable when present)
        fileName = el.getAttribute('data-filename') || '';

        // Step 2 — title / aria-label, but skip Gemini's generic placeholder values
        if (!fileName) {
          const t = el.getAttribute('title') || '';
          if (t && t.toLowerCase() !== 'attachment') fileName = t;
        }
        if (!fileName) {
          const a = el.getAttribute('aria-label') || '';
          if (a && a.toLowerCase() !== 'attachment') fileName = a;
        }

        // Step 3 — img[alt]: Gemini sets alt="attachment" as a generic placeholder
        // for ALL non-image (and even image) files. Only accept it if it looks like
        // a real filename (contains a "." or is longer than a single word).
        if (!fileName) {
          const imgAlt = img?.getAttribute('alt') || '';
          if (imgAlt && imgAlt.toLowerCase() !== 'attachment' &&
              (imgAlt.includes('.') || imgAlt.length > 12)) {
            fileName = imgAlt;
          }
        }

        // Step 4 — inner label span: for non-image files Gemini renders the filename
        // as visible text inside span.gem-attachment-content (or similar label spans).
        if (!fileName) {
          const labelEl = el.querySelector(
            'span.gem-attachment-content, [class*="attachment-content"], ' +
            '[class*="attachment-label"], [class*="attachment-name"]'
          );
          if (labelEl) {
            const labelText = (labelEl as HTMLElement).innerText?.trim() ||
                              labelEl.textContent?.trim() || '';
            // Reject lines that contain "tokens" — that is our own injected tooltip text
            if (labelText && !labelText.includes('tokens') && labelText.length < 200) {
              fileName = labelText;
            }
          }
        }

        // Step 5 — attachment-container <type> class: Gemini sometimes adds a semantic
        // type suffix, e.g. "attachment-container pdf", "attachment-container video".
        if (!fileName) {
          const containerEl = el.querySelector('[class*="attachment-container"]');
          const containerClass = (containerEl?.className || '').toString();
          const typeMatch = containerClass.match(/attachment-container[- _](\w+)/);
          const hint = (typeMatch?.[1] || '').toLowerCase();
          const hintExtMap: Record<string, string> = {
            pdf: 'document.pdf', video: 'video.mp4', audio: 'audio.mp3',
            spreadsheet: 'spreadsheet.xlsx', presentation: 'presentation.pptx',
            document: 'document.docx', text: 'file.txt',
          };
          if (hint && hint !== 'unknown' && hintExtMap[hint]) {
            fileName = hintExtMap[hint];
          }
        }

        // Step 6 — img src: blob URL confirms a file was uploaded; use as last
        // resort to at least identify images.
        if (!fileName && img?.src) {
          const src = img.src.toLowerCase();
          if (src.startsWith('blob:') || src.includes('image')) {
            fileName = 'image.jpg';
          } else if (src.includes('pdf')) {
            fileName = 'document.pdf';
          }
        }

        // Step 7 — textContent fallback: strip our own injected tooltip nodes first
        // (they have data-tokenwise="true") so we don't read back the text we wrote.
        if (!fileName) {
          const ownText = Array.from(el.querySelectorAll('[data-tokenwise]'))
            .map((n) => n.textContent || '').join('');
          let raw = (el.textContent || '').trim();
          if (ownText) raw = raw.replace(ownText, '').trim();
          // Strip any remaining "… tokens" fragments from our formatting
          raw = raw.replace(/[^\n]*\d+\s*tokens[^\n]*/gi, '').trim();
          fileName = raw.slice(0, 100);
        }

        const fileSize = parseInt(el.getAttribute('data-filesize') || '0', 10);

        // ── MIME type inference ─────────────────────────────────────────────
        // Prefer an explicit data-filetype attribute. If that's absent AND the
        // filename has no recognisable extension, derive the type from visual
        // cues on the chip (class names, badge text, img presence) so
        // estimateFileTokens() can return a meaningful estimate instead of the
        // generic 300-token fallback.
        let fileType = el.getAttribute('data-filetype') || '';
        if (!fileType) {
          const hasKnownExtension = /\.[a-zA-Z0-9]{2,5}$/.test(fileName);
          if (!hasKnownExtension) {
            fileType = inferGeminiMimeFromChip(el);
          }
        }

        // Use naturalWidth/Height first (accurate), fall back to offsetWidth/Height
        const imgW = img ? (img.naturalWidth || img.offsetWidth || 0) : 0;
        const imgH = img ? (img.naturalHeight || img.offsetHeight || 0) : 0;

        const estimate = estimateFileTokens(fileName || 'attachment', fileSize, fileType, imgW, imgH);
        estimates.push(estimate);

        if (el.getAttribute('data-tokenwise-processed')) continue;
        el.setAttribute('data-tokenwise-processed', 'true');
        addFileTooltip(el, estimate);

        // If img hasn't loaded yet, re-run once it does to get real dimensions
        if (img && !img.complete) {
          img.addEventListener('load', () => {
            el.removeAttribute('data-tokenwise-processed');
            detectAttachments();
          }, { once: true });
        }
      }

      currentAttachments = estimates;

      if (showSuggestions && suggestionPanel) {
        const inputEl = findGeminiInput();
        const text = inputEl ? getInputText(inputEl) : '';
        suggestionPanel.update(text, currentAttachments);
      }
    } catch { /* fail silently */ }
  }

  function addFileTooltip(element: Element, estimate: FileEstimate): void {
    const tooltip = document.createElement('div');
    tooltip.setAttribute('data-tokenwise', 'true');
    Object.assign(tooltip.style, {
      position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
      background: '#1e1e2e', color: '#e0e0e0', padding: '8px 12px', borderRadius: '8px',
      fontSize: '11px', whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      display: 'none', zIndex: '999999', pointerEvents: 'none',
    });
    tooltip.textContent = generateFileTooltip(estimate);
    const parentStyle = window.getComputedStyle(element);
    if (parentStyle.position === 'static') (element as HTMLElement).style.position = 'relative';
    element.appendChild(tooltip);
    element.addEventListener('mouseenter', () => { tooltip.style.display = 'block'; });
    element.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
  }

  // ── Paste Detection ───────────────────────────────────────────

  function setupPasteDetection(): void {
    const inputEl = findGeminiInput();
    if (!inputEl) return;
    inputEl.addEventListener('paste', (e: Event) => {
      try {
        const pastedText = (e as ClipboardEvent).clipboardData?.getData('text/plain') || '';
        if (pastedText.length > 0) {
          const urls = detectURLs(pastedText);
          if (urls.length > 0) showURLTips(urls);
        }
      } catch { /* fail silently */ }
    });
  }

  function showURLTips(urls: Array<{ url: string; type: string; tip: string }>): void {
    if (!widgetElement) return;
    for (const urlInfo of urls.slice(0, 2)) {
      const tipEl = document.createElement('div');
      Object.assign(tipEl.style, {
        marginTop: '8px', padding: '6px 8px', borderRadius: '6px',
        background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
        fontSize: '11px', color: '#c7d2fe',
      });
      tipEl.textContent = `${urlInfo.type === 'youtube' ? '🎥' : '🔗'} ${urlInfo.tip}`;
      const dismissBtn = widgetElement.querySelector('button');
      widgetElement.insertBefore(tipEl, dismissBtn);
      setTimeout(() => { try { tipEl.remove(); } catch { /* already removed */ } }, 10000);
    }
  }

  function setupStorageListener(): void {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes.widgetVisible?.newValue === false) hideWidget();
        else if (changes.widgetVisible?.newValue === true) {
          widgetVisible = true;
          if (widgetElement) {
            widgetElement.style.display = 'block';
          } else {
            createWidget();
          }
        }

        if (changes.settings?.newValue) {
          const settings = changes.settings.newValue as Record<string, unknown>;
          if (settings.showWidget === false) hideWidget();
          else if (settings.showWidget === true) {
            widgetVisible = true;
            if (widgetElement) {
              widgetElement.style.display = 'block';
            } else {
              createWidget();
            }
          }
          if (settings.showSuggestions === false) {
            showSuggestions = false;
            if (suggestionPanel) suggestionPanel.hide();
          } else if (settings.showSuggestions === true) {
            showSuggestions = true;
            if (!suggestionPanel) {
              initSuggestionPanel();
            } else {
              suggestionPanel.create();
            }
          }
        }
      });
    } catch {
      // Fail silently
    }
  }

  // ── Service Worker Communication ──────────────────────────────

  function sendUpdate(): void {
    try {
      chrome.runtime.sendMessage({
        type: 'TOKEN_UPDATE',
        data: { site: SITE, inputTokens: currentInputTokens, conversationTokens, messageCount, attachmentCount, timestamp: Date.now() },
      });
    } catch { /* extension context may be invalidated */ }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (sender.id !== chrome.runtime.id) return;
      if (message.type === 'SETTINGS_CHANGED') {
        if (message.data.showWidget === false) hideWidget();
        else if (message.data.showWidget === true) {
          widgetVisible = true;
          if (widgetElement) {
            widgetElement.style.display = 'block';
          } else {
            createWidget();
          }
        }
        if (message.data.showSuggestions === false && suggestionPanel) suggestionPanel.hide();
        else if (message.data.showSuggestions === true && suggestionPanel) suggestionPanel.create();
        sendResponse({ ok: true });
      } else if (message.type === 'GET_CURRENT_STATE') {
        sendResponse({ site: SITE, inputTokens: currentInputTokens, conversationTokens, messageCount, attachmentCount });
      }
    } catch { /* fail silently */ }
    return true;
  });

  // ── Utilities ─────────────────────────────────────────────────

  function debounce(fn: () => void, delay: number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => { if (timer) clearTimeout(timer); timer = setTimeout(fn, delay); };
  }

  // ── Cleanup ───────────────────────────────────────────────────

  window.addEventListener('beforeunload', () => {
    try {
      inputObserver?.disconnect();
      chatObserver?.disconnect();
      ghostText?.destroy();
      chrome.runtime.sendMessage({
        type: 'SESSION_END',
        data: { site: SITE, totalTokens: conversationTokens, messageCount, attachmentCount, durationMs: Date.now() - sessionStartTime },
      });
    } catch { /* expected during unload */ }
  });

  // ── Start ─────────────────────────────────────────────────────

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
