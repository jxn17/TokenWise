/**
 * TokenWise Content Script — Claude.ai
 *
 * Injected into claude.ai.
 * All logic wrapped in IIFE to avoid polluting page's global scope.
 * Never exposes functions to window object.
 */

import { countTokens, estimateConversationTokens, type ModelType, type Message } from '../utils/tokenizer';
import { createSuggestionPanelController, type SuggestionPanelController } from '../utils/suggestion-panel';
import { renderWidgetBody } from '../utils/widget-ui';
import { estimateFileTokens, detectURLs, type FileEstimate } from '../utils/media-estimator';
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
  extractMessages,
  type DebouncedObserver,
} from '../utils/dom-monitor';

(function tokenWiseClaude(): void {
  // ── State ─────────────────────────────────────────────────────

  const SITE = 'claude' as const;
  const CONFIG = SITE_CONFIGS[SITE];
  const MODEL: ModelType = 'claude-sonnet';

  let inputObserver: DebouncedObserver | null = null;
  let chatObserver: DebouncedObserver | null = null;
  let widgetElement: HTMLElement | null = null;
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
  let warningThreshold = 8000;
  let criticalThreshold = 30000;
  let contextExportMaxTokens = 5000;
  let boundInputElement: Element | null = null;
  let composerWatcher: DebouncedObserver | null = null;
  let currentAttachments: FileEstimate[] = [];

  const suggestionPanel = createSuggestionPanelController(
    {
      getInputElement: findClaudeInput,
      getInputText: () => {
        const el = findClaudeInput();
        return getInputText(el);
      },
      setInputText,
      onAfterApply: () => handleInputChange(),
      trackSavings: (tokens) => {
        try {
          chrome.runtime.sendMessage({ type: 'SAVINGS_TRACKED', data: { tokens } });
        } catch { /* ignore */ }
      },
    },
    () => showSuggestions
  );

  // ── Initialization ────────────────────────────────────────────

  async function init(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['widgetVisible', 'settings']);
      widgetVisible = result.widgetVisible !== false;
      showSuggestions = !result.settings || result.settings.showSuggestions !== false;
      if (result.settings) {
        warningThreshold = result.settings.warningThreshold ?? 8000;
        criticalThreshold = result.settings.criticalThreshold ?? 30000;
        contextExportMaxTokens = result.settings.contextExportMaxTokens ?? 5000;
      }

      if (!widgetVisible) return;

      createWidget();
      if (showSuggestions) {
        suggestionPanel.create();
      }
      setupComposerWatcher();

      await waitForClaudeInput(30000);

      bindToComposer();
      setupFileDetection();

      sendUpdate();
      setupStorageListener();
    } catch {
      // Fail silently if initialization fails
    }
  }

  function findClaudeInput(): Element | null {
    return findComposerInput(CONFIG);
  }

  function bindToComposer(): void {
    const inputEl = findClaudeInput();
    if (!inputEl) return;

    if (boundInputElement === inputEl && inputObserver) return;

    inputObserver?.disconnect();
    boundInputElement = inputEl;

    setupInputObserver(inputEl);
    setupPasteDetection(inputEl);
    scanConversation();
  }

  function setupComposerWatcher(): void {
    if (composerWatcher) return;

    composerWatcher = createDebouncedObserver(() => {
      const inputEl = findClaudeInput();
      if (!inputEl) return;

      if (!widgetElement && widgetVisible) {
        createWidget();
      }

      if (inputEl !== boundInputElement) {
        bindToComposer();
      }
    }, 500);

    composerWatcher.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async function waitForClaudeInput(timeout: number): Promise<Element> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      function tryFind(): void {
        const el = findClaudeInput();
        if (el) {
          resolve(el);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error('Claude input not found'));
          return;
        }

        setTimeout(tryFind, 500);
      }

      tryFind();
    });
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
      position: 'absolute',
      top: '4px',
      right: '8px',
      background: 'none',
      border: 'none',
      color: '#888',
      fontSize: '16px',
      cursor: 'pointer',
      padding: '2px 4px',
      lineHeight: '1',
    });
    dismissBtn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      hideWidget();
    });
    widgetElement.appendChild(dismissBtn);

    widgetElement.addEventListener('mousedown', startDrag);
    restoreWidgetPosition();
    document.body.appendChild(widgetElement);
  }

  function updateWidgetContent(inputTokens: number, totalTokens: number): void {
    if (!widgetElement) return;

    const dismissBtn = widgetElement.querySelector('button');
    renderWidgetBody(widgetElement, dismissBtn, {
      siteLabel: 'Claude',
      inputTokens,
      totalTokens,
      warningThreshold,
      criticalThreshold,
      contextExportMaxTokens,
      getMessages: (): ExportMessage[] =>
        extractClaudeMessages().map((m) => ({
          role: m.role,
          content: m.content,
        })),
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

  function hideWidget(): void {
    if (widgetElement) widgetElement.style.display = 'none';
    widgetVisible = false;
    try { chrome.storage.local.set({ widgetVisible: false }); } catch { /* ignore */ }
  }

  // ── Input Observer ────────────────────────────────────────────

  function setupInputObserver(inputEl: Element): void {
    inputObserver = createDebouncedObserver(() => {
      handleInputChange();
    }, 300);

    inputObserver.observe(inputEl, { childList: true, subtree: true, characterData: true });
    inputEl.addEventListener('input', debounce(handleInputChange, 300));
    inputEl.addEventListener('keyup', debounce(handleInputChange, 300));

    setupChatObserver();
    handleInputChange();
  }

  function handleInputChange(): void {
    try {
      const inputEl = findClaudeInput();
      if (!inputEl) return;
      const text = getInputText(inputEl);
      const result = countTokens(text, MODEL);
      currentInputTokens = result.tokens;
      updateWidgetContent(currentInputTokens, conversationTokens + currentInputTokens);
      if (showSuggestions && text.trim().length >= 8) {
        suggestionPanel.update(text, currentAttachments);
      } else {
        suggestionPanel.hide();
      }
      sendUpdate();
    } catch { /* fail silently */ }
  }

  // ── Chat Observer ─────────────────────────────────────────────

  function setupChatObserver(): void {
    if (chatObserver) return;

    const chatContainer = safeQuerySelector(CONFIG.chatContainerSelector) || document.body;
    chatObserver = createDebouncedObserver(() => { scanConversation(); }, 500);
    chatObserver.observe(chatContainer, { childList: true, subtree: true });
  }

  function scanConversation(): void {
    try {
      const messages = extractClaudeMessages();
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
      const attachments = safeQuerySelectorAll(CONFIG.fileAttachmentSelector);
      attachmentCount = attachments.length;
      const estimates: FileEstimate[] = [];

      for (const el of attachments) {
        let fileName = el.getAttribute('data-filename') || el.getAttribute('title');
        let fileSizeStr = el.getAttribute('data-filesize') || '';
        const fileType = el.getAttribute('data-filetype') || '';

        // Fallback to textContent parsing if attributes are missing
        if (!fileName || !fileSizeStr) {
          const text = el.textContent?.trim() || '';
          
          // Try to extract filename (e.g. anything with an extension)
          const nameMatch = text.match(/[\w\s-]+\.[a-zA-Z0-9]{2,4}\b/);
          if (!fileName && nameMatch) {
            fileName = nameMatch[0];
          }

          // Try to extract file size (e.g. 12.4 KB, 1.2 MB)
          const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|B)/i);
          if (!fileSizeStr && sizeMatch) {
            const val = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            if (unit === 'KB') fileSizeStr = String(val * 1024);
            else if (unit === 'MB') fileSizeStr = String(val * 1024 * 1024);
            else if (unit === 'GB') fileSizeStr = String(val * 1024 * 1024 * 1024);
            else fileSizeStr = String(val);
          }

          if (!fileName) {
            fileName = text.slice(0, 50) || 'unknown';
          }
        }

        const fileSize = parseInt(fileSizeStr || '0', 10);
        const img = el.querySelector('img');
        const estimate = estimateFileTokens(fileName, fileSize, fileType, img?.naturalWidth || 0, img?.naturalHeight || 0);
        estimates.push(estimate);

        if (el.getAttribute('data-tokenwise-processed')) continue;
        el.setAttribute('data-tokenwise-processed', 'true');
        addFileTooltip(el, estimate);
      }

      currentAttachments = estimates;
      if (showSuggestions) {
        const inputEl = findClaudeInput();
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

  function setupPasteDetection(inputEl: Element): void {
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
            bindToComposer();
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
              bindToComposer();
            }
          }
          if (settings.showSuggestions === false) {
            showSuggestions = false;
            suggestionPanel.hide();
          } else if (settings.showSuggestions === true) {
            showSuggestions = true;
            suggestionPanel.create();
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
            bindToComposer();
          }
        }
        
        if (message.data.showSuggestions === false) suggestionPanel.hide();
        else if (message.data.showSuggestions === true) suggestionPanel.create();
        
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

  function waitForElement(selector: string, timeout: number = 5000): Promise<Element> {
    return new Promise((resolve, reject) => {
      const el = findClaudeInput() || safeQuerySelector(selector);
      if (el) { resolve(el); return; }
      const startTime = Date.now();
      const observer = new MutationObserver(() => {
        const found = findClaudeInput() || safeQuerySelector(selector);
        if (found) { observer.disconnect(); resolve(found); }
        else if (Date.now() - startTime > timeout) { observer.disconnect(); reject(new Error('Timeout')); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        const lastTry = findClaudeInput() || safeQuerySelector(selector);
        if (lastTry) resolve(lastTry); else reject(new Error('Timeout'));
      }, timeout);
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────

  window.addEventListener('beforeunload', () => {
    try {
      inputObserver?.disconnect();
      chatObserver?.disconnect();
      composerWatcher?.disconnect();
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
