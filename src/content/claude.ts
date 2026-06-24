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
import { type ExportMessage } from '../utils/context-exporter';
import { estimateFileTokens, detectURLs, generateFileTooltip, type FileEstimate } from '../utils/media-estimator';
import { reportError } from '../utils/error-reporter';
import { detectAttachments, type AttachmentConfig } from '../utils/attachment-detector';
import { createGhostTextController, type GhostTextController } from '../utils/ghost-text-ui';
import {
  SITE_CONFIGS,
  createDebouncedObserver,
  safeQuerySelector,
  safeQuerySelectorAll,
  getInputText,
  setInputText,
  positionPanelAboveElement,
  findComposerInput,
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
  let artifactTokens = 0;   // tokens estimated from sandboxed artifact iframes
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
  let ghostText: GhostTextController | null = null;

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
      initGhostText();
      setupComposerWatcher();

      await waitForClaudeInput(30000);

      bindToComposer();
      setupFileDetection();

      sendUpdate();
      setupStorageListener();
    } catch (e) {
      await reportError(SITE, 'INIT_FAILED', 'Failed to initialize content script', undefined, e instanceof Error ? e : undefined);
    }
  }

  function findClaudeInput(): Element | null {
    return findComposerInput(CONFIG);
  }

  function extractClaudeMessages(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return extractMessages(CONFIG);
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

    // 💡 Tips toggle — re-opens the suggestion panel after dismissal
    const tipsBtn = document.createElement('button');
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
      const inputEl = findClaudeInput();
      const text = inputEl ? getInputText(inputEl) : '';
      suggestionPanel.forceShow(text, currentAttachments);
    });
    widgetElement.appendChild(tipsBtn);

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
      artifactTokens,
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

  async function handleInputChange(): Promise<void> {
    try {
      const inputEl = findClaudeInput();
      if (!inputEl) return;
      const text = getInputText(inputEl);
      const result = countTokens(text, MODEL);
      currentInputTokens = result.tokens;
      updateWidgetContent(currentInputTokens, conversationTokens + currentInputTokens);
      if (showSuggestions && (text.trim().length >= 8 || currentAttachments.length > 0)) {
        suggestionPanel.update(text, currentAttachments);
      } else {
        suggestionPanel.hide();
      }
      // Ghost text rewriter
      ghostText?.onInput(text);
      sendUpdate();
    } catch (e) { await reportError(SITE, 'INPUT_CHANGE_FAILED', 'Failed to handle input change', undefined, e instanceof Error ? e : undefined); }
  }

  function initGhostText(): void {
    if (ghostText) return;
    ghostText = createGhostTextController({
      getText: () => {
        const el = findClaudeInput();
        return el ? getInputText(el) : '';
      },
      getInputElement: () => findClaudeInput(),
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
    if (chatObserver) return;

    const chatContainer = safeQuerySelector(CONFIG.chatContainerSelector) || document.body;
    chatObserver = createDebouncedObserver(() => { scanConversation(); }, 500);
    chatObserver.observe(chatContainer, { childList: true, subtree: true });
  }

  async function scanConversation(): Promise<void> {
    try {
      const messages = extractClaudeMessages();
      messageCount = messages.length;
      const messagesForCount: Message[] = messages.map(m => ({ role: m.role, content: m.content }));
      conversationTokens = estimateConversationTokens(messagesForCount, MODEL);
      // Add iframe artifact estimate — Claude Artifacts are sandboxed cross-origin
      // iframes that we can never read, but we can estimate their cost from size.
      artifactTokens = estimateArtifactTokens();
      updateWidgetContent(currentInputTokens, conversationTokens + artifactTokens + currentInputTokens);
      sendUpdate();
    } catch (e) { await reportError(SITE, 'SCAN_CONVERSATION_FAILED', 'Failed to scan conversation', undefined, e instanceof Error ? e : undefined); }
  }

  /**
   * Detect Claude Artifact iframes (hosted on claudemcpcontent.com) and
   * produce a conservative token-cost estimate from the iframe's rendered size.
   *
   * Why iframes can't be read: they are sandboxed cross-origin — no content
   * script can access their document.  We use visible area as a proxy:
   *   • Full-size artifact  (720 × 488 px) ≈ 800 tokens of generated code
   *   • Scale proportionally for other sizes, floor at 200 tokens
   *   • Invisible / tiny iframes (< 50 px) are infrastructure (ignored)
   */
  function estimateArtifactTokens(): number {
    const ARTIFACT_DOMAIN = 'claudemcpcontent.com';
    const FULL_AREA_PX2  = 720 * 488;   // reference full-size artifact
    const FULL_TOKENS    = 800;          // conservative token estimate for reference size
    const MIN_TOKENS     = 200;          // floor — even a tiny widget costs something
    const MIN_DIMENSION  = 50;           // px — smaller than this → not a real artifact

    let total = 0;
    try {
      document.querySelectorAll('iframe').forEach((iframe) => {
        // Only count iframes from Claude's artifact CDN
        if (!iframe.src.includes(ARTIFACT_DOMAIN)) return;

        // Skip invisible / infrastructure iframes (0×0, isolated-segment, etc.)
        const w = iframe.offsetWidth;
        const h = iframe.offsetHeight;
        if (w < MIN_DIMENSION || h < MIN_DIMENSION) return;

        const area = w * h;
        const estimate = Math.max(MIN_TOKENS, Math.round((area / FULL_AREA_PX2) * FULL_TOKENS));
        total += estimate;
      });
    } catch {
      // DOM access errors — return whatever we collected so far
    }
    return total;
  }

  // ── File Detection ────────────────────────────────────────────

  /**
   * Walk up from the composer input to find its enclosing container.
   * This is the element that holds both the text box AND pending file
   * thumbnails, but is NOT part of the scrollable chat history.
   * We stop at the first ancestor that is a <form>, <fieldset>, or
   * an element with a well-known composer data-testid.
   */
  function findComposerContainer(): Element {
    const inputEl = findClaudeInput();
    if (!inputEl) return document.body;

    // Walk up looking for the composer wrapper
    const composerTestIds = ['composer-input', 'composer', 'chat-input', 'prompt-input'];
    let ancestor: Element | null = inputEl.parentElement;
    while (ancestor && ancestor !== document.body) {
      const testid = ancestor.getAttribute('data-testid') || '';
      if (composerTestIds.some(id => testid.includes(id))) return ancestor;
      const tag = ancestor.tagName.toLowerCase();
      if (tag === 'form' || tag === 'fieldset') return ancestor;
      ancestor = ancestor.parentElement;
    }

    // Fallback: go up a fixed number of levels from the input
    // (covers cases where no semantic container exists)
    let fallback: Element = inputEl;
    for (let i = 0; i < 6 && fallback.parentElement && fallback.parentElement !== document.body; i++) {
      fallback = fallback.parentElement;
    }
    return fallback;
  }

  function setupFileDetection(): void {
    const fileObserver = createDebouncedObserver(() => { detectAttachments(); }, 500);
    fileObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function detectAttachments(): Promise<void> {
    try {
      // Scope query to the composer container only — NOT the whole document.
      // Without this, attachments from previously sent messages in the
      // conversation history would be incorrectly detected.
      const composerRoot = findComposerContainer();
      const allEls = safeQuerySelectorAll(CONFIG.fileAttachmentSelector, composerRoot);

      // Prune ancestor/descendant duplicates caused by overlapping CSS selectors.
      // e.g. [class*="group/thumbnail"] matches a wrapper AND [data-testid="file-thumbnail"]
      // matches a child of the same wrapper — both refer to the same physical file.
      // Keep only the INNERMOST (most specific/deepest) element for each file.
      // A parent element is dropped when any other matched element lives inside it.
      const prunedEls = allEls.filter(
        el => !allEls.some(other => other !== el && el.contains(other))
      );

      const estimates: FileEstimate[] = [];

      for (const el of prunedEls) {
        const img = el.querySelector('img') as HTMLImageElement | null;

        let fileName = '';
        let fileType = '';

        // ── Strategy 1: data-testid="file-thumbnail" ───────────────────────
        // Claude uses this for all non-image files: XLSX, DOCX, MP4, MP3, etc.
        // The .flex-col element has TWO children:
        //   [0] filename span  (e.g. "report.xlsx")
        //   [1] extension badge (e.g. "xlsx")
        // Reading full textContent produces "report.xlsxxlsx" — we only want [0].
        if (el.getAttribute('data-testid') === 'file-thumbnail') {
          const nameEl = el.querySelector('.flex-col');
          if (nameEl) {
            // Prefer the first child element (the filename span, not the extension badge).
            // Claude's .flex-col has two children: [0] filename, [1] extension badge.
            // We only want [0] to avoid "README.mdmd" / "report.xlsxxlsx" artifacts.
            const firstChild = nameEl.firstElementChild;
            if (firstChild) {
              fileName = firstChild.textContent?.trim() || '';
            }
            // If first child is empty, try direct text nodes only (no descendants)
            if (!fileName) {
              fileName = Array.from(nameEl.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent?.trim() || '')
                .filter(t => t.length > 0)
                .join('').trim();
            }
            // Last resort: full textContent minus the badge duplicate suffix.
            // e.g. "README.mdmd" → strip trailing badge text ("md") to get "README.md"
            if (!fileName) {
              const fullText = nameEl.textContent?.trim() || '';
              const badgeText = nameEl.lastElementChild?.textContent?.trim() || '';
              if (badgeText && fullText.endsWith(badgeText) && fullText !== badgeText) {
                fileName = fullText.slice(0, fullText.length - badgeText.length).trim();
              } else {
                fileName = fullText;
              }
            }
          }
          // Extra safety: strip any trailing badge suffix that may have slipped through.
          // Handles edge cases like "README.mdmd" where the badge text repeats the extension.
          if (fileName) {
            fileName = stripBadgeSuffix(fileName);
          }
          fileType = inferMimeFromExtension(fileName);

        // ── Strategy 2: element has an <img> (images and PDFs) ─────────────
        // PDFs: Claude renders page 1 as a preview <img> AND shows a "pdf" text badge.
        // Images: just an <img>, no extra text badge.
        } else if (img) {
          // Search the entire element subtree (not just direct children) for "pdf" badge.
          const allText = el.textContent?.toLowerCase() || '';
          const ownText = Array.from(el.childNodes)
            .filter(n => !(n instanceof Element && (n.hasAttribute('data-tokenwise') || n.tagName === 'IMG')))
            .map(n => n.textContent ?? '')
            .join('').trim().toLowerCase();

          if (/\bpdf\b/.test(ownText) || /\bpdf\b/.test(allText)) {
            // PDF preview image — treat as PDF.
            fileType = 'application/pdf';

            /**
             * Try to extract the PDF filename from a given element using multiple
             * strategies. Claude's PDF cards don't always use .flex-col — the
             * filename may be in a span, p, aria-label, img.alt, or title attr.
             */
            const extractPdfName = (root: Element): string => {
              // 1. .flex-col — used by non-image file cards, sometimes also PDFs
              const flexCol = root.querySelector('.flex-col');
              if (flexCol) {
                const candidate = flexCol.firstElementChild?.textContent?.trim()
                  || flexCol.textContent?.trim() || '';
                if (candidate && candidate.toLowerCase() !== 'pdf') return candidate;
              }

              // 2. Any element with a title attribute that looks like a filename
              const titled = Array.from(root.querySelectorAll('[title]'))
                .filter(e => !e.hasAttribute('data-tokenwise'))
                .map(e => e.getAttribute('title')?.trim() || '')
                .find(t => t.length > 1 && t.toLowerCase() !== 'pdf');
              if (titled) return titled;

              // 3. aria-label attributes
              const ariaLabelled = Array.from(root.querySelectorAll('[aria-label]'))
                .filter(e => !e.hasAttribute('data-tokenwise'))
                .map(e => e.getAttribute('aria-label')?.trim() || '')
                .find(t => t.length > 1 && t.toLowerCase() !== 'pdf');
              if (ariaLabelled) return ariaLabelled;

              // 4. img.alt or img.title (Claude may set these for accessibility)
              const imgEl = root.querySelector('img');
              if (imgEl?.alt && imgEl.alt.length > 1 && imgEl.alt.toLowerCase() !== 'pdf') {
                return imgEl.alt.trim();
              }
              if (imgEl?.title && imgEl.title.length > 1 && imgEl.title.toLowerCase() !== 'pdf') {
                return imgEl.title.trim();
              }

              // 5. Walk all text nodes — look for any that contain a dot (filename pattern)
              //    Skip our own injected elements and pure "pdf" badge nodes
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              let node: Node | null;
              while ((node = walker.nextNode())) {
                const parent = node.parentElement;
                if (parent?.hasAttribute('data-tokenwise')) continue;
                if (parent?.tagName === 'IMG') continue;
                const text = node.textContent?.trim() || '';
                if (text.length > 1 && text.toLowerCase() !== 'pdf' && text.includes('.')) {
                  return text;
                }
              }

              return '';
            };

            // Try the element itself first
            let rawPdfName = extractPdfName(el);

            // Walk up ancestors if not found, stopping at the multi-thumbnail boundary
            if (!rawPdfName || rawPdfName.toLowerCase() === 'pdf') {
              const thumbnailSelector = '[data-testid="file-thumbnail"], [data-testid="image-thumbnail"]';
              let ancestor: Element | null = el.parentElement;
              while (ancestor && ancestor !== document.body) {
                // Stop if this ancestor spans multiple file cards
                if (ancestor.querySelectorAll(thumbnailSelector).length > 1) break;
                rawPdfName = extractPdfName(ancestor);
                if (rawPdfName && rawPdfName.toLowerCase() !== 'pdf') break;
                ancestor = ancestor.parentElement;
              }
            }

            // Normalise: accept if looks like a real filename
            rawPdfName = rawPdfName.trim();
            if (rawPdfName && rawPdfName.toLowerCase() !== 'pdf' && rawPdfName.includes('.')) {
              fileName = rawPdfName;
            } else if (rawPdfName && rawPdfName.toLowerCase() !== 'pdf' && rawPdfName.length > 1) {
              fileName = rawPdfName + '.pdf';
            } else {
              fileName = 'document.pdf';
            }
            if (!fileName.toLowerCase().endsWith('.pdf')) fileName += '.pdf';
          } else {
            // Genuine image upload
            fileType = 'image/jpeg';
            const srcPart = (img.src || '').split('/').pop()?.split('?')[0] ?? '';
            fileName = /\.[a-z]{2,4}$/i.test(srcPart) ? srcPart : 'image.jpg';
          }

        // ── Strategy 3: fallback text scan ─────────────────────────────────
        } else {
          const cleanText = Array.from(el.childNodes)
            .filter(n => !(n instanceof Element && n.hasAttribute('data-tokenwise')))
            .map(n => n.textContent ?? '').join('').trim();
          const nameMatch = cleanText.match(/[\w\s.()\-]+\.[a-zA-Z0-9]{2,5}(?=\s|$)/);
          fileName = nameMatch ? nameMatch[0].trim() : (cleanText.slice(0, 60) || 'unknown');
          fileType = inferMimeFromExtension(fileName);
        }

        const estimate = estimateFileTokens(
          fileName || 'unknown',
          0,          // file size not exposed in Claude's DOM
          fileType,
          img?.naturalWidth ?? 0,
          img?.naturalHeight ?? 0
        );
        estimates.push(estimate);

        // Check processed marker before adding tooltip (estimate is already in array above)
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

      attachmentCount = estimates.length;
      currentAttachments = estimates;

      if (showSuggestions) {
        const inputEl = findClaudeInput();
        const text = inputEl ? getInputText(inputEl) : '';
        suggestionPanel.update(text, currentAttachments);
      }
    } catch (e) { await reportError(SITE, 'DETECT_ATTACHMENTS_FAILED', 'Failed to detect attachments', undefined, e instanceof Error ? e : undefined); }
  }

  /**
   * Strip a duplicated extension badge suffix from a filename.
   * Claude's .flex-col DOM concatenates the badge text (just the ext, no dot) directly
   * onto the filename, producing doubled extensions like:
   *   "README.mdmd"      (md  + md  = 4 chars after dot)
   *   "report.xlsxxlsx" (xlsx + xlsx = 8 chars after dot)
   *   "file.pdfpdf"     (pdf  + pdf  = 6 chars after dot)
   *
   * Detection: the text after the last dot is exactly 2× a valid extension string.
   */
  function stripBadgeSuffix(name: string): string {
    const lastDot = name.lastIndexOf('.');
    if (lastDot === -1) return name;

    const afterDot = name.slice(lastDot + 1);
    const totalLen = afterDot.length;

    // Only consider lengths that could be a doubled extension (4–10 chars total)
    // A single extension is 2–5 chars, so doubled is 4–10 chars
    if (totalLen >= 4 && totalLen <= 10 && totalLen % 2 === 0) {
      const half = totalLen / 2;
      const first = afterDot.slice(0, half);
      const second = afterDot.slice(half);
      if (first === second) {
        // Confirmed doubled suffix: return base + dot + single extension
        return name.slice(0, lastDot + 1 + half);
      }
    }

    return name;
  }

  /**
   * Map a filename's extension to a MIME type so detectFileCategory() works correctly.
   * Claude's DOM never exposes MIME types, so we infer from the file extension.
   */
  function inferMimeFromExtension(fileName: string): string {

    const ext = (fileName.match(/\.([a-z0-9]{2,5})(?:[\s\u200b]|$)/i)?.[1] ||
                 fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
    const MAP: Record<string, string> = {
      // Documents
      pdf:  'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc:  'application/msword',
      // Spreadsheets
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls:  'application/vnd.ms-excel',
      csv:  'text/csv',
      // Presentations
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt:  'application/vnd.ms-powerpoint',
      // Images
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      // Video
      mp4: 'video/mp4', mov: 'video/mp4', m4v: 'video/mp4',
      avi: 'video/avi', webm: 'video/webm', mkv: 'video/mkv',
      // Audio
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
      flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
      // Archives
      zip: 'application/zip', rar: 'application/zip', '7z': 'application/zip',
      // Text / code
      txt: 'text/plain', md: 'text/markdown',
      js: 'text/javascript', ts: 'text/plain',
      py: 'text/plain', json: 'application/json',
    };
    return MAP[ext] || '';
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
    inputEl.addEventListener('paste', async (e: Event) => {
      try {
        const pastedText = (e as ClipboardEvent).clipboardData?.getData('text/plain') || '';
        if (pastedText.length > 0) {
          const urls = detectURLs(pastedText);
          if (urls.length > 0) showURLTips(urls);
        }
      } catch (e) { await reportError(SITE, 'PASTE_DETECTION_FAILED', 'Failed to handle paste event', undefined, e instanceof Error ? e : undefined); }
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

  async function setupStorageListener(): Promise<void> {
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
    } catch (e) { await reportError(SITE, 'STORAGE_LISTENER_FAILED', 'Failed to set up storage listener', undefined, e instanceof Error ? e : undefined); }
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
