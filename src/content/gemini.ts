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
      // Try standard selectors first
      let elements = safeQuerySelectorAll(CONFIG.messageSelector, document, CONFIG);

      // If no results, search shadow DOM
      if (elements.length === 0) {
        elements = findAllInShadowRoots(CONFIG.messageSelector);
      }

      // Also try Gemini-specific turn-based structure
      if (elements.length === 0) {
        elements = findAllInShadowRoots('.conversation-turn, [class*="turn"]');
      }

      for (const el of elements) {
        const content = el.textContent?.trim() || '';
        if (!content) continue;

        // Gemini uses "model" for assistant responses
        const isModel = el.classList.contains('model-response-text')
          || el.closest('[data-role="model"]') !== null
          || el.tagName.toLowerCase() === 'message-content';

        messages.push({
          role: isModel ? 'assistant' : 'user',
          content,
        });
      }

      // If still no messages found, try alternating pattern
      if (messages.length === 0) {
        const allTurns = findAllInShadowRoots('.turn-content, .response-container, .query-content');
        for (let i = 0; i < allTurns.length; i++) {
          const content = allTurns[i].textContent?.trim() || '';
          if (content) {
            messages.push({
              role: i % 2 === 0 ? 'user' : 'assistant',
              content,
            });
          }
        }
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
      sendUpdate();
    } catch { /* fail silently */ }
  }

  // ── Chat Observer ─────────────────────────────────────────────

  function setupChatObserver(): void {
    chatObserver = createDebouncedObserver(() => { scanConversation(); }, 500);
    // For Gemini, observe the entire body since messages might be in shadow DOM
    chatObserver.observe(document.body, { childList: true, subtree: true });
  }

  function scanConversation(): void {
    try {
      const messages = extractGeminiMessages();
      messageCount = messages.length;
      const messagesForCount: Message[] = messages.map(m => ({ role: m.role, content: m.content }));
      conversationTokens = estimateConversationTokens(messagesForCount, MODEL);
      updateWidgetContent(currentInputTokens, conversationTokens + currentInputTokens);
      sendUpdate();
    } catch { /* fail silently */ }
  }

  // ── File Detection ────────────────────────────────────────────

  function setupFileDetection(): void {
    const fileObserver = createDebouncedObserver(() => { detectAttachments(); }, 500);
    fileObserver.observe(document.body, { childList: true, subtree: true });
  }

  function detectAttachments(): void {
    try {
      let attachments = safeQuerySelectorAll(CONFIG.fileAttachmentSelector);
      if (attachments.length === 0) {
        attachments = findAllInShadowRoots(CONFIG.fileAttachmentSelector);
      }
      attachmentCount = attachments.length;
      
      const estimates: FileEstimate[] = [];

      for (const el of attachments) {
        const fileName = el.getAttribute('data-filename') || el.getAttribute('title') || el.textContent?.trim().slice(0, 100) || 'unknown';
        const fileSize = parseInt(el.getAttribute('data-filesize') || '0', 10);
        const fileType = el.getAttribute('data-filetype') || '';
        const img = el.querySelector('img');
        const estimate = estimateFileTokens(fileName, fileSize, fileType, img?.naturalWidth || 0, img?.naturalHeight || 0);
        estimates.push(estimate);

        if (el.getAttribute('data-tokenwise-processed')) continue;
        el.setAttribute('data-tokenwise-processed', 'true');
        addFileTooltip(el, estimate);
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
