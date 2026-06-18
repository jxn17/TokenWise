/**
 * TokenWise Content Script — ChatGPT
 *
 * Injected into chat.openai.com / chatgpt.com.
 * All logic wrapped in IIFE to avoid polluting page's global scope.
 * Never exposes functions to window object.
 */

import { countTokens, estimateConversationTokens, type ModelType, type Message } from '../utils/tokenizer';
import { analyzePrompt, applySuggestion, getTotalSavings, type Suggestion } from '../utils/prompt-analyzer';
import { estimateFileTokens, detectURLs, generateFileTooltip, type FileEstimate } from '../utils/media-estimator';
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

(function tokenWiseChatGPT(): void {
  // ── State ─────────────────────────────────────────────────────

  const SITE = 'chatgpt' as const;
  const CONFIG = SITE_CONFIGS[SITE];
  const MODEL: ModelType = 'gpt-4o';

  let inputObserver: DebouncedObserver | null = null;
  let chatObserver: DebouncedObserver | null = null;
  let widgetElement: HTMLElement | null = null;
  let suggestionPanel: HTMLElement | null = null;
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
      // Check settings
      const result = await chrome.storage.local.get(['widgetVisible', 'settings']);
      widgetVisible = result.widgetVisible !== false;
      showSuggestions = !result.settings || result.settings.showSuggestions !== false;
      const settings = result.settings;

      if (!widgetVisible) return;

      createWidget();
      if (showSuggestions) {
        createSuggestionPanel();
      }

      await waitForElement(CONFIG.inputSelector, 10000);

      setupInputObserver();
      setupChatObserver();
      setupFileDetection();
      setupPasteDetection();
      scanConversation();

      sendUpdate();
      setupStorageListener();
    } catch {
      // Fail silently if initialization fails (DOM might have changed)
    }
  }

  // ── Widget Creation ───────────────────────────────────────────

  function createWidget(): void {
    if (widgetElement) return;

    widgetElement = document.createElement('div');
    widgetElement.id = 'tokenwise-widget';
    widgetElement.setAttribute('data-tokenwise', 'true');

    // Apply styles inline to avoid CSS conflicts with the host page
    Object.assign(widgetElement.style, {
      position: 'fixed',
      bottom: '80px',
      right: '20px',
      zIndex: '999999',
      background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%)',
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

    // Build content using safe DOM methods
    updateWidgetContent(0, 0);

    // Create dismiss button
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

    // Drag functionality
    widgetElement.addEventListener('mousedown', startDrag);

    // Restore saved position
    restoreWidgetPosition();

    document.body.appendChild(widgetElement);
  }

  function updateWidgetContent(inputTokens: number, totalTokens: number): void {
    if (!widgetElement) return;

    // Remove existing content nodes but keep dismiss button
    const dismissBtn = widgetElement.querySelector('button');
    while (widgetElement.firstChild) {
      if (widgetElement.firstChild === dismissBtn) break;
      widgetElement.removeChild(widgetElement.firstChild);
    }

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginBottom: '8px',
      fontWeight: '600',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: '#a0a0b8',
    });
    header.textContent = '📊 TokenWise';
    widgetElement.insertBefore(header, widgetElement.firstChild);

    // Current message tokens
    const inputLine = document.createElement('div');
    Object.assign(inputLine.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' });
    const inputLabel = document.createElement('span');
    inputLabel.textContent = 'Current message:';
    inputLabel.style.color = '#8888a8';
    const inputValue = document.createElement('span');
    inputValue.textContent = `~${inputTokens.toLocaleString()} tokens`;
    inputValue.style.fontWeight = '600';
    inputValue.style.color = getTokenColor(inputTokens);
    inputLine.appendChild(inputLabel);
    inputLine.appendChild(inputValue);
    widgetElement.insertBefore(inputLine, dismissBtn);

    // Conversation total
    const totalLine = document.createElement('div');
    Object.assign(totalLine.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' });
    const totalLabel = document.createElement('span');
    totalLabel.textContent = 'Full request cost:';
    totalLabel.style.color = '#8888a8';
    const totalValue = document.createElement('span');
    totalValue.textContent = `~${totalTokens.toLocaleString()} tokens`;
    totalValue.style.fontWeight = '600';
    totalValue.style.color = getTokenColor(totalTokens);
    totalLine.appendChild(totalLabel);
    totalLine.appendChild(totalValue);
    widgetElement.insertBefore(totalLine, dismissBtn);

    // Warning/nudge if conversation is long
    const warningThreshold = 8000;
    const criticalThreshold = 30000;

    if (totalTokens > criticalThreshold) {
      const warning = document.createElement('div');
      Object.assign(warning.style, {
        marginTop: '8px',
        padding: '6px 8px',
        borderRadius: '6px',
        background: 'rgba(239,68,68,0.15)',
        border: '1px solid rgba(239,68,68,0.3)',
        fontSize: '11px',
        color: '#fca5a5',
      });
      warning.textContent = `🔴 Very expensive conversation. A new chat would save ~${(totalTokens - 100).toLocaleString()} tokens.`;
      widgetElement.insertBefore(warning, dismissBtn);
    } else if (totalTokens > warningThreshold) {
      const warning = document.createElement('div');
      Object.assign(warning.style, {
        marginTop: '8px',
        padding: '6px 8px',
        borderRadius: '6px',
        background: 'rgba(234,179,8,0.15)',
        border: '1px solid rgba(234,179,8,0.3)',
        fontSize: '11px',
        color: '#fde68a',
      });
      warning.textContent = '🟡 Conversation is getting long. Consider starting a new chat soon.';
      widgetElement.insertBefore(warning, dismissBtn);
    }
  }

  function getTokenColor(tokens: number): string {
    if (tokens < 500) return '#4ade80';  // green
    if (tokens <= 2000) return '#facc15'; // yellow
    return '#f87171'; // red
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
    const x = e.clientX - dragOffsetX;
    const y = e.clientY - dragOffsetY;

    widgetElement.style.left = `${Math.max(0, Math.min(x, window.innerWidth - 220))}px`;
    widgetElement.style.top = `${Math.max(0, Math.min(y, window.innerHeight - 100))}px`;
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

    // Save position
    saveWidgetPosition();
  }

  async function saveWidgetPosition(): Promise<void> {
    if (!widgetElement) return;
    try {
      const rect = widgetElement.getBoundingClientRect();
      await chrome.storage.local.set({
        widgetPosition: { x: rect.left, y: rect.top },
      });
    } catch {
      // Silently ignore save errors
    }
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
    } catch {
      // Use default position
    }
  }

  function hideWidget(): void {
    if (widgetElement) {
      widgetElement.style.display = 'none';
    }
    try {
      chrome.storage.local.set({ widgetVisible: false });
    } catch {
      // Silently ignore
    }
  }

  // ── Suggestion Panel ──────────────────────────────────────────

  function createSuggestionPanel(): void {
    if (suggestionPanel) return;

    suggestionPanel = document.createElement('div');
    suggestionPanel.id = 'tokenwise-suggestions';
    suggestionPanel.setAttribute('data-tokenwise', 'true');

    Object.assign(suggestionPanel.style, {
      position: 'fixed',
      bottom: '120px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483646',
      background: 'linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%)',
      borderRadius: '12px',
      padding: '0',
      color: '#e0e0e0',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontSize: '12px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
      maxWidth: '500px',
      width: '90%',
      maxHeight: '200px',
      overflowY: 'auto',
      display: 'none',
      backdropFilter: 'blur(20px)',
    });

    document.body.appendChild(suggestionPanel);
  }

  function updateSuggestions(text: string, inputEl?: Element | null): void {
    if (!suggestionPanel || !showSuggestions) return;

    const suggestions = analyzePrompt(text);

    if (suggestions.length === 0) {
      suggestionPanel.style.display = 'none';
      return;
    }

    // Clear previous suggestions
    while (suggestionPanel.firstChild) {
      suggestionPanel.removeChild(suggestionPanel.firstChild);
    }

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '10px 14px 6px',
      fontWeight: '600',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: '#a0a0b8',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    });
    const headerText = document.createElement('span');
    headerText.textContent = `💡 Save ~${getTotalSavings(suggestions)} tokens`;
    header.appendChild(headerText);

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '▼';
    Object.assign(collapseBtn.style, {
      background: 'none',
      border: 'none',
      color: '#888',
      cursor: 'pointer',
      fontSize: '10px',
    });
    collapseBtn.addEventListener('click', () => {
      suggestionPanel!.style.display = 'none';
    });
    header.appendChild(collapseBtn);
    suggestionPanel.appendChild(header);

    // Show top 3 suggestions
    const topSuggestions = suggestions.slice(0, 3);
    for (const suggestion of topSuggestions) {
      const item = createSuggestionItem(suggestion);
      suggestionPanel.appendChild(item);
    }

    suggestionPanel.style.display = 'block';
    positionPanelAboveElement(
      suggestionPanel,
      inputEl || safeQuerySelector(CONFIG.inputSelector)
    );
  }

  function createSuggestionItem(suggestion: Suggestion): HTMLElement {
    const item = document.createElement('div');
    Object.assign(item.style, {
      padding: '8px 14px',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '10px',
    });

    const textDiv = document.createElement('div');
    textDiv.style.flex = '1';

    const msg = document.createElement('div');
    msg.textContent = suggestion.message;
    msg.style.color = '#c0c0d8';
    msg.style.marginBottom = '2px';
    textDiv.appendChild(msg);

    const savings = document.createElement('div');
    savings.textContent = `Save ~${suggestion.tokenSavings} tokens`;
    savings.style.color = '#4ade80';
    savings.style.fontSize = '11px';
    textDiv.appendChild(savings);
    item.appendChild(textDiv);

    if (suggestion.originalText) {
      const applyBtn = document.createElement('button');
      applyBtn.textContent = 'Apply';
      Object.assign(applyBtn.style, {
        background: 'rgba(99,102,241,0.2)',
        border: '1px solid rgba(99,102,241,0.4)',
        color: '#a5b4fc',
        borderRadius: '6px',
        padding: '4px 10px',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: '500',
        whiteSpace: 'nowrap',
      });
      applyBtn.addEventListener('click', () => {
        applyPromptSuggestion(suggestion);
      });
      item.appendChild(applyBtn);
    }

    return item;
  }

  function applyPromptSuggestion(suggestion: Suggestion): void {
    try {
      const inputEl = safeQuerySelector(CONFIG.inputSelector);
      if (!inputEl) return;

      const currentText = getInputText(inputEl);
      const newText = applySuggestion(currentText, suggestion);

      setInputText(inputEl, newText);
      handleInputChange();

      // Track savings
      try {
        chrome.runtime.sendMessage({
          type: 'SAVINGS_TRACKED',
          data: { tokens: suggestion.tokenSavings },
        });
      } catch {
        // Ignore message errors
      }
    } catch {
      // Fail silently
    }
  }

  // ── Input Observer ────────────────────────────────────────────

  function setupInputObserver(): void {
    const inputEl = safeQuerySelector(CONFIG.inputSelector);
    if (!inputEl) return;

    inputObserver = createDebouncedObserver((mutations) => {
      handleInputChange();
    }, 300);

    inputObserver.observe(inputEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Also listen for direct input events (for textarea)
    inputEl.addEventListener('input', debounce(handleInputChange, 300));
  }

  function handleInputChange(): void {
    try {
      const inputEl = safeQuerySelector(CONFIG.inputSelector);
      if (!inputEl) return;

      const text = getInputText(inputEl);
      const result = countTokens(text, MODEL);
      currentInputTokens = result.tokens;

      const totalCost = conversationTokens + currentInputTokens;
      updateWidgetContent(currentInputTokens, totalCost);

      // Update suggestions
      if (showSuggestions && text.trim().length >= 8) {
        updateSuggestions(text, inputEl);
      } else if (suggestionPanel) {
        suggestionPanel.style.display = 'none';
      }

      // Send update to service worker
      sendUpdate();
    } catch {
      // Fail silently
    }
  }

  // ── Chat Observer ─────────────────────────────────────────────

  function setupChatObserver(): void {
    // Observe the main content area for new messages
    const chatContainer = safeQuerySelector(CONFIG.chatContainerSelector) || document.body;

    chatObserver = createDebouncedObserver(() => {
      scanConversation();
    }, 500);

    chatObserver.observe(chatContainer, {
      childList: true,
      subtree: true,
    });
  }

  function scanConversation(): void {
    try {
      const messages = extractMessages(CONFIG);
      messageCount = messages.length;

      const messagesForCount: Message[] = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      conversationTokens = estimateConversationTokens(messagesForCount, MODEL);
      const totalCost = conversationTokens + currentInputTokens;
      updateWidgetContent(currentInputTokens, totalCost);

      sendUpdate();
    } catch {
      // Fail silently
    }
  }

  // ── File Detection ────────────────────────────────────────────

  function setupFileDetection(): void {
    // Watch for file attachment DOM changes
    const fileObserver = createDebouncedObserver(() => {
      detectAttachments();
    }, 500);

    fileObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function detectAttachments(): void {
    try {
      const attachments = safeQuerySelectorAll(CONFIG.fileAttachmentSelector);
      attachmentCount = attachments.length;

      for (const el of attachments) {
        // Skip already-processed attachments
        if (el.getAttribute('data-tokenwise-processed')) continue;
        el.setAttribute('data-tokenwise-processed', 'true');

        // Extract metadata from DOM attributes
        const fileName = el.getAttribute('data-filename')
          || el.getAttribute('title')
          || el.textContent?.trim().slice(0, 100)
          || 'unknown';

        const fileSize = parseInt(el.getAttribute('data-filesize') || '0', 10);
        const fileType = el.getAttribute('data-filetype') || '';

        // Get image dimensions if available
        const img = el.querySelector('img');
        const imageWidth = img?.naturalWidth || 0;
        const imageHeight = img?.naturalHeight || 0;

        const estimate = estimateFileTokens(fileName, fileSize, fileType, imageWidth, imageHeight);

        // Create tooltip
        addFileTooltip(el, estimate);
      }
    } catch {
      // Fail silently
    }
  }

  function addFileTooltip(element: Element, estimate: FileEstimate): void {
    const tooltip = document.createElement('div');
    tooltip.setAttribute('data-tokenwise', 'true');
    Object.assign(tooltip.style, {
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1e1e2e',
      color: '#e0e0e0',
      padding: '8px 12px',
      borderRadius: '8px',
      fontSize: '11px',
      whiteSpace: 'nowrap',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      display: 'none',
      zIndex: '999999',
      pointerEvents: 'none',
    });
    tooltip.textContent = generateFileTooltip(estimate);

    // Position the parent relatively if needed
    const parentStyle = window.getComputedStyle(element);
    if (parentStyle.position === 'static') {
      (element as HTMLElement).style.position = 'relative';
    }
    element.appendChild(tooltip);

    element.addEventListener('mouseenter', () => {
      tooltip.style.display = 'block';
    });
    element.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  }

  // ── Paste Detection ───────────────────────────────────────────

  function setupPasteDetection(): void {
    const inputEl = safeQuerySelector(CONFIG.inputSelector);
    if (!inputEl) return;

    inputEl.addEventListener('paste', (e: Event) => {
      try {
        const clipboardEvent = e as ClipboardEvent;
        const pastedText = clipboardEvent.clipboardData?.getData('text/plain') || '';

        if (pastedText.length > 0) {
          const urls = detectURLs(pastedText);
          if (urls.length > 0) {
            showURLTips(urls);
          }
        }
      } catch {
        // Fail silently
      }
    });
  }

  function showURLTips(urls: Array<{ url: string; type: string; tip: string }>): void {
    if (!widgetElement) return;

    for (const urlInfo of urls.slice(0, 2)) {
      const tipEl = document.createElement('div');
      Object.assign(tipEl.style, {
        marginTop: '8px',
        padding: '6px 8px',
        borderRadius: '6px',
        background: 'rgba(99,102,241,0.15)',
        border: '1px solid rgba(99,102,241,0.3)',
        fontSize: '11px',
        color: '#c7d2fe',
      });
      const icon = urlInfo.type === 'youtube' ? '🎥' : '🔗';
      tipEl.textContent = `${icon} ${urlInfo.tip}`;

      const dismissBtn = widgetElement.querySelector('button');
      widgetElement.insertBefore(tipEl, dismissBtn);

      // Auto-remove after 10 seconds
      setTimeout(() => {
        try {
          tipEl.remove();
        } catch {
          // Already removed
        }
      }, 10000);
    }
  }

  // ── Service Worker Communication ──────────────────────────────

  function sendUpdate(): void {
    try {
      chrome.runtime.sendMessage({
        type: 'TOKEN_UPDATE',
        data: {
          site: SITE,
          inputTokens: currentInputTokens,
          conversationTokens,
          messageCount,
          attachmentCount,
          timestamp: Date.now(),
        },
      });
    } catch {
      // Extension context might be invalidated
    }
  }

  // Listen for messages from service worker / popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      // Validate sender
      if (sender.id !== chrome.runtime.id) return;

      if (message.type === 'SETTINGS_CHANGED') {
        handleSettingsChange(message.data);
        sendResponse({ ok: true });
      } else if (message.type === 'GET_CURRENT_STATE') {
        sendResponse({
          site: SITE,
          inputTokens: currentInputTokens,
          conversationTokens,
          messageCount,
          attachmentCount,
        });
      }
    } catch {
      // Fail silently
    }
    return true; // Keep message channel open for async response
  });

  function setupStorageListener(): void {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        const settingsChange: Record<string, unknown> = {};
        if (changes.settings?.newValue) {
          Object.assign(settingsChange, changes.settings.newValue as Record<string, unknown>);
        }
        if (changes.widgetVisible?.newValue !== undefined) {
          settingsChange.showWidget = changes.widgetVisible.newValue;
        }
        if (Object.keys(settingsChange).length > 0) {
          handleSettingsChange(settingsChange);
        }
      });
    } catch {
      // Fail silently
    }
  }

  function handleSettingsChange(settings: Record<string, unknown>): void {
    try {
      if (settings.showWidget === false) {
        hideWidget();
      } else if (settings.showWidget === true && widgetElement) {
        widgetElement.style.display = 'block';
      }

      if (settings.showSuggestions === false) {
        showSuggestions = false;
        if (suggestionPanel) suggestionPanel.style.display = 'none';
      } else if (settings.showSuggestions === true) {
        showSuggestions = true;
        if (!suggestionPanel) createSuggestionPanel();
      }
    } catch {
      // Fail silently
    }
  }

  // ── Utilities ─────────────────────────────────────────────────

  function debounce(fn: () => void, delay: number): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  function waitForElement(selector: string, timeout: number = 5000): Promise<Element> {
    return new Promise((resolve, reject) => {
      const el = safeQuerySelector(selector);
      if (el) {
        resolve(el);
        return;
      }

      const startTime = Date.now();
      const observer = new MutationObserver(() => {
        const found = safeQuerySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        } else if (Date.now() - startTime > timeout) {
          observer.disconnect();
          reject(new Error('Element not found within timeout'));
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Timeout safety
      setTimeout(() => {
        observer.disconnect();
        const lastTry = safeQuerySelector(selector);
        if (lastTry) {
          resolve(lastTry);
        } else {
          reject(new Error('Element not found within timeout'));
        }
      }, timeout);
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────

  window.addEventListener('beforeunload', () => {
    try {
      inputObserver?.disconnect();
      chatObserver?.disconnect();

      // Save final session data
      const duration = Date.now() - sessionStartTime;
      chrome.runtime.sendMessage({
        type: 'SESSION_END',
        data: {
          site: SITE,
          totalTokens: conversationTokens,
          messageCount,
          attachmentCount,
          durationMs: duration,
        },
      });
    } catch {
      // Cleanup errors are expected during page unload
    }
  });

  // ── Start ─────────────────────────────────────────────────────

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
