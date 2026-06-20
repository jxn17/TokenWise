/**
 * TokenWise Content Script — ChatGPT
 *
 * Injected into chat.openai.com / chatgpt.com.
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
      // Check settings
      const result = await chrome.storage.local.get(['widgetVisible', 'settings']);
      widgetVisible = result.widgetVisible !== false;
      showSuggestions = !result.settings || result.settings.showSuggestions !== false;
      const settings = result.settings;

      if (!widgetVisible) return;

      createWidget();
      if (showSuggestions) {
        initSuggestionPanel();
      }

      // Wait for input element with error handling
      try {
        await waitForElement(CONFIG.inputSelector, 10000);
      } catch (e) {
        await reportError(
          SITE,
          'INPUT_ELEMENT_NOT_FOUND',
          'Could not find input element after 10 seconds',
          `Selector: ${CONFIG.inputSelector}`,
          e instanceof Error ? e : undefined
        );
        showErrorInWidget('Input element not found. Extension may not work correctly.');
        return;
      }

      // Setup observers with error handling
      try {
        setupInputObserver();
        setupChatObserver();
        setupFileDetection();
        setupPasteDetection();
        scanConversation();
      } catch (e) {
        await reportError(
          SITE,
          'OBSERVER_SETUP_FAILED',
          'Failed to set up DOM observers',
          undefined,
          e instanceof Error ? e : undefined
        );
      }

      sendUpdate();
      setupStorageListener();
      setupHeartbeat();
    } catch (e) {
      await reportError(
        SITE,
        'INIT_FAILED',
        'Failed to initialize content script',
        undefined,
        e instanceof Error ? e : undefined
      );
      showErrorInWidget('Extension initialization failed.');
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
    
    renderWidgetBody(widgetElement, dismissBtn, {
      siteLabel: 'ChatGPT',
      inputTokens,
      totalTokens,
      warningThreshold: 8000,
      criticalThreshold: 30000,
      getMessages: () => extractMessages(CONFIG),
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
    widgetVisible = false;
    try {
      chrome.storage.local.set({ widgetVisible: false });
    } catch {
      // Silently ignore
    }
  }

  // ── Suggestion Panel ──────────────────────────────────────────

  function initSuggestionPanel(): void {
    if (suggestionPanel) return;

    suggestionPanel = createSuggestionPanelController({
      getInputElement: () => safeQuerySelector(CONFIG.inputSelector),
      getInputText: () => {
        const el = safeQuerySelector(CONFIG.inputSelector);
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
        suggestionPanel?.update(text, currentAttachments);
      } else if (suggestionPanel) {
        suggestionPanel.hide();
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
      
      const estimates: FileEstimate[] = [];

      for (const el of attachments) {
        // Extract metadata from DOM attributes
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

        // Get image dimensions if available
        const img = el.querySelector('img');
        const imageWidth = img?.naturalWidth || 0;
        const imageHeight = img?.naturalHeight || 0;

        const estimate = estimateFileTokens(fileName, fileSize, fileType, imageWidth, imageHeight);
        estimates.push(estimate);

        // Skip already-processed attachments for tooltip creation
        if (el.getAttribute('data-tokenwise-processed')) continue;
        el.setAttribute('data-tokenwise-processed', 'true');

        // Create tooltip
        addFileTooltip(el, estimate);
      }
      
      currentAttachments = estimates;
      
      if (showSuggestions && suggestionPanel) {
        const inputEl = safeQuerySelector(CONFIG.inputSelector);
        const text = inputEl ? getInputText(inputEl) : '';
        suggestionPanel.update(text, currentAttachments);
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
      } else if (settings.showWidget === true) {
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
    } catch {
      // Fail silently
    }
  }

  // ── Utilities ─────────────────────────────────────────────────

  /**
   * Display error message in the widget
   */
  function showErrorInWidget(message: string): void {
    if (!widgetElement) return;
    
    const errorEl = document.createElement('div');
    errorEl.style.cssText = 'color: #ff6b6b; padding: 8px; font-size: 12px; border-top: 1px solid #3a3a52;';
    errorEl.textContent = '⚠️ ' + message;
    widgetElement.appendChild(errorEl);
  }

  /**
   * Setup heartbeat to report health status
   */
  function setupHeartbeat(): void {
    setInterval(async () => {
      try {
        await chrome.runtime.sendMessage({
          type: 'HEARTBEAT',
          data: { site: SITE },
        });
      } catch {
        // Messaging failed, don't retry
      }
    }, 5000);
  }

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
