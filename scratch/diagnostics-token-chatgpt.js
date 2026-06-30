/**
 * TokenWise — Token Detection Diagnostics for ChatGPT
 *
 * Paste this into the DevTools console on chatgpt.com / chat.openai.com.
 * It checks every piece of the DOM that TokenWise reads to count tokens:
 *   1. Composer input (what you're typing)
 *   2. Conversation messages (user + assistant turns)
 *   3. File attachments
 *   4. Key element selectors (green = found, red = missing)
 *
 * HOW TO USE:
 *   • Load a ChatGPT conversation with at least one assistant reply.
 *   • Optionally attach a file so attachment detection is tested.
 *   • Paste this entire block into the DevTools Console and press Enter.
 *   • Copy the full output and share it.
 */
(function tokenWiseTokenDiagChatGPT() {
  // ── Logging helpers ────────────────────────────────────────────────
  const log  = (...a) => console.log('%c[TW-TOKEN]', 'color:#a78bfa;font-weight:bold', ...a);
  const ok   = (...a) => console.log('%c[TW-TOKEN ✓]', 'color:#4ade80;font-weight:bold', ...a);
  const warn = (...a) => console.warn('%c[TW-TOKEN ⚠]', 'color:#fb923c;font-weight:bold', ...a);
  const err  = (...a) => console.error('%c[TW-TOKEN ✗]', 'color:#f87171;font-weight:bold', ...a);
  const sep  = (title) => console.log(`%c─── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`, 'color:#818cf8');

  // ── Tiny GPT-4 tokeniser approximation ────────────────────────────
  // Uses the same heuristic as TokenWise's tokenizer.ts:
  // ~4 chars per token for English prose, slightly adjusted for code/whitespace.
  function approxTokens(text) {
    if (!text) return 0;
    // Split on whitespace/punctuation similar to BPE behaviour
    const words = text.match(/\S+/g) || [];
    let tokens = 0;
    for (const w of words) {
      tokens += Math.ceil(w.length / 4);
    }
    // Add ~0.25 tokens per whitespace character
    const spaces = (text.match(/\s/g) || []).length;
    return tokens + Math.ceil(spaces * 0.25);
  }

  // ── Selectors (mirror SITE_CONFIGS.chatgpt in dom-monitor.ts) ─────
  const SELECTORS = {
    input:          '#prompt-textarea, [id="prompt-textarea"], div[contenteditable="true"][id="prompt-textarea"]',
    messages:       '[data-message-author-role]',
    sendButton:     'button[data-testid="send-button"], button[aria-label="Send prompt"]',
    chatContainer:  '[role="presentation"] .flex.flex-col, main .flex.flex-col',
    fileAttachment: 'div[role="group"][aria-label][class*="file-tile"], div[role="group"][class*="file-tile"], [class*="file-tile"][class*="text-token-text-primary"]',
  };

  // ── Helper: try multiple comma-separated selectors ─────────────────
  function q(selector) {
    for (const s of selector.split(',').map(x => x.trim())) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }
  function qAll(selector) {
    const results = new Set();
    for (const s of selector.split(',').map(x => x.trim())) {
      document.querySelectorAll(s).forEach(el => results.add(el));
    }
    return [...results];
  }

  // ── Get text from a contenteditable or textarea ────────────────────
  function getInputText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value || '';
    // ContentEditable: get innerText, collapse zero-width chars
    return (el.innerText || el.textContent || '').replace(/\u200b/g, '').trim();
  }

  log('═══════════════════════════════════════════════════════════');
  log('  TokenWise Token Detection Diagnostics — ChatGPT');
  log('═══════════════════════════════════════════════════════════');
  log('URL:', location.href);
  log('Time:', new Date().toISOString());

  // ══════════════════════════════════════════════════════════════════
  // SECTION 1 — Key Selector Health Check
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 1: Selector Health Check');

  const selectorReport = {};
  for (const [name, sel] of Object.entries(SELECTORS)) {
    const found = name === 'messages' || name === 'fileAttachment'
      ? qAll(sel)
      : q(sel);

    const count = Array.isArray(found) ? found.length : (found ? 1 : 0);
    selectorReport[name] = { count, sel };

    if (count > 0) {
      ok(`[${name}] Found ${count} element(s) — selector: ${sel}`);
    } else {
      err(`[${name}] MISSING — selector: ${sel}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 2 — Composer Input
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 2: Composer Input');

  const inputEl = q(SELECTORS.input);
  if (!inputEl) {
    err('Composer input not found. Make sure you are on chatgpt.com with the chat open.');
  } else {
    const text  = getInputText(inputEl);
    const toks  = approxTokens(text);
    ok('Input element found:', `<${inputEl.tagName.toLowerCase()}> id="${inputEl.id}"`);
    log('  tagName:', inputEl.tagName);
    log('  contenteditable:', inputEl.getAttribute('contenteditable'));
    log('  id:', inputEl.id);
    log('  class:', inputEl.className?.slice(0, 120));
    log('  Text length (chars):', text.length);
    log('  Text preview:', text.slice(0, 200) || '(empty)');
    log('  ≈ Tokens (approx):', toks);

    console.group('Raw DOM — composer outerHTML (first 800 chars)');
    log(inputEl.outerHTML.slice(0, 800));
    console.groupEnd();
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 3 — Conversation Messages
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 3: Conversation Messages');

  const messageEls = qAll(SELECTORS.messages);
  log(`Found ${messageEls.length} message element(s) via [data-message-author-role].`);

  if (messageEls.length === 0) {
    err('No messages found. Is there an active conversation?');

    // Fallback: try broader role-based discovery
    warn('Attempting fallback: scanning all elements with data-message-author-role attribute...');
    const all = Array.from(document.querySelectorAll('[data-message-author-role]'));
    warn(`Fallback found ${all.length} element(s).`);

    // Dump the first 3 as HTML for inspection
    all.slice(0, 3).forEach((el, i) => {
      console.group(`Fallback Message [${i}] role="${el.dataset.messageAuthorRole}"`);
      log('outerHTML (800c):', el.outerHTML.slice(0, 800));
      console.groupEnd();
    });
  } else {
    let totalTokens = 0;
    const messageReport = [];

    messageEls.forEach((el, i) => {
      const role = el.getAttribute('data-message-author-role') || 'unknown';
      // Try to get the actual text content from descendant prose/markdown nodes
      const proseEl = el.querySelector('.prose, [class*="prose"], .markdown, [class*="markdown"], .whitespace-pre-wrap, [class*="whitespace-pre"]')
                   || el;
      const text  = (proseEl.innerText || proseEl.textContent || '').trim();
      const toks  = approxTokens(text);
      totalTokens += toks;

      const info = {
        index: i,
        role,
        charLen: text.length,
        approxTokens: toks,
        textPreview: text.slice(0, 150),
        classes: el.className?.slice(0, 100),
        dataAttrs: Object.keys(el.dataset).join(', '),
        hasImage: !!el.querySelector('img'),
        hasCode: !!el.querySelector('code, pre'),
        hasTool: !!el.querySelector('[data-message-author-role="tool"]'),
      };
      messageReport.push(info);
    });

    log('──── Message Summary ────');
    console.table(messageReport.map(m => ({
      '#': m.index,
      role: m.role,
      chars: m.charLen,
      'approxTokens': m.approxTokens,
      preview: m.textPreview.slice(0, 60) + (m.textPreview.length > 60 ? '...' : ''),
      hasImage: m.hasImage,
      hasCode: m.hasCode,
    })));
    log(`Total conversation approx tokens: ${totalTokens}`);
    log('(This is what TokenWise uses for the "Conversation" counter.)');

    // Dump first & last message HTML for selector debugging
    console.group('First message outerHTML (800 chars)');
    log(messageEls[0].outerHTML.slice(0, 800));
    console.groupEnd();

    if (messageEls.length > 1) {
      console.group('Last message outerHTML (800 chars)');
      log(messageEls[messageEls.length - 1].outerHTML.slice(0, 800));
      console.groupEnd();
    }

    // Check for response types that might be missed
    sep('SECTION 3b: Special Response Types');

    const toolMessages = Array.from(document.querySelectorAll('[data-message-author-role="tool"]'));
    log(`Tool/function call messages: ${toolMessages.length}`);
    if (toolMessages.length) {
      toolMessages.slice(0, 2).forEach((el, i) => {
        console.group(`Tool message [${i}]`);
        log('outerHTML (400c):', el.outerHTML.slice(0, 400));
        console.groupEnd();
      });
    }

    // Look for streaming/in-progress response indicators
    const streamingIndicators = [
      '.result-streaming',
      '[data-is-streaming]',
      '.animate-pulse',
      '[class*="streaming"]',
      '[class*="cursor-blink"]',
    ];
    streamingIndicators.forEach(sel => {
      const found = document.querySelectorAll(sel);
      if (found.length) warn(`Streaming indicator "${sel}" found (${found.length}x) — response may be mid-stream!`);
    });

    // Look for code interpreter / canvas responses
    const codeInterpreterEls = document.querySelectorAll('[data-message-model-slug], [data-testid*="code"], [class*="code-interpreter"]');
    if (codeInterpreterEls.length) {
      warn(`Found ${codeInterpreterEls.length} possible code-interpreter element(s).`);
      codeInterpreterEls.forEach((el, i) => {
        console.group(`Code interpreter element [${i}]`);
        log('tagName:', el.tagName, '| data-testid:', el.dataset.testid, '| class:', el.className?.slice(0,80));
        console.groupEnd();
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 4 — File Attachments
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 4: File Attachments');

  const attachmentEls = qAll(SELECTORS.fileAttachment);
  log(`Found ${attachmentEls.length} attachment element(s) via current selector.`);

  if (attachmentEls.length === 0) {
    warn('No attachments detected by current selector. Running broad fallback scan...');

    // Broad fallback: any element that looks like a file
    const broadCandidates = Array.from(document.querySelectorAll('div, button, span')).filter(el => {
      const text = el.textContent?.trim() || '';
      const aria = el.getAttribute('aria-label') || '';
      const hasExt = /[\w\s\-]+\.[a-zA-Z0-9]{2,5}\b/.test(text) || /[\w\s\-]+\.[a-zA-Z0-9]{2,5}\b/.test(aria);
      const hasClass = typeof el.className === 'string' &&
        (el.className.includes('file') || el.className.includes('attachment') ||
         el.className.includes('upload') || el.className.includes('thumbnail'));
      return (hasExt || hasClass) && el.children.length < 8 && text.length < 200;
    });

    const pruned = broadCandidates.filter(el => !broadCandidates.some(o => o !== el && el.contains(o)));
    log(`Broad fallback found ${pruned.length} candidate(s).`);

    pruned.slice(0, 5).forEach((el, i) => {
      console.group(`Fallback attachment [${i}] <${el.tagName.toLowerCase()}>`);
      log('class:', el.className);
      log('aria-label:', el.getAttribute('aria-label') || '(none)');
      log('title:', el.getAttribute('title') || '(none)');
      log('role:', el.getAttribute('role') || '(none)');
      log('textContent:', el.textContent?.trim().slice(0, 100));
      log('outerHTML (400c):', el.outerHTML.slice(0, 400));
      console.groupEnd();
    });
  } else {
    attachmentEls.forEach((el, i) => {
      console.group(`Attachment [${i}]`);
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const text = el.textContent?.trim() || '';
      const img = el.querySelector('img');
      const nameMatch = (aria || title || text).match(/[\w\s\-]+\.[a-zA-Z0-9]{2,5}\b/);
      ok('  aria-label:', aria || '(none)');
      log('  title:', title || '(none)');
      log('  textContent:', text.slice(0, 100) || '(none)');
      log('  has <img>:', !!img, img ? `src=${img.src?.slice(0,60)}` : '');
      log('  detected filename:', nameMatch ? nameMatch[0] : '(none)');
      log('  outerHTML (400c):', el.outerHTML.slice(0, 400));
      console.groupEnd();
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 5 — Chat Container
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 5: Chat Container');

  const chatContainer = q(SELECTORS.chatContainer);
  if (!chatContainer) {
    err('Chat container NOT found — DOM scanning may fail.');
    err('Selector tried:', SELECTORS.chatContainer);

    // Fallback: dump the top-level structure
    warn('Dumping <main> children for manual inspection:');
    const main = document.querySelector('main');
    if (main) {
      Array.from(main.children).slice(0, 5).forEach((el, i) => {
        log(`main > child[${i}]:`, el.tagName, '| class:', el.className?.slice(0, 80));
      });
    }
  } else {
    ok('Chat container found:', chatContainer.tagName, '| class:', chatContainer.className?.slice(0, 80));
    log('  children count:', chatContainer.children.length);
    log('  scrollHeight:', chatContainer.scrollHeight);
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 6 — Send Button
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 6: Send Button');

  const sendBtn = q(SELECTORS.sendButton);
  if (!sendBtn) {
    warn('Send button not found (OK if input is empty — ChatGPT hides it).');
  } else {
    ok('Send button found:', sendBtn.tagName, '| aria-label:', sendBtn.getAttribute('aria-label'), '| data-testid:', sendBtn.dataset.testid);
    log('  disabled:', sendBtn.disabled);
    log('  outerHTML (200c):', sendBtn.outerHTML.slice(0, 200));
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 7 — TokenWise Extension Presence
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 7: TokenWise Extension Presence');

  const twWidget = document.getElementById('tokenwise-widget');
  const twGhost  = document.getElementById('tokenwise-ghost-text');
  const twNodes  = document.querySelectorAll('[data-tokenwise]');

  if (twWidget) {
    ok('TokenWise widget is present in the DOM (#tokenwise-widget).');
    log('  display:', twWidget.style.display);
    log('  innerHTML preview:', twWidget.innerHTML.slice(0, 300));
  } else {
    warn('TokenWise widget NOT found. Extension may not be running.');
  }

  if (twGhost) {
    ok('Ghost text overlay present (#tokenwise-ghost-text).');
  }

  log(`Total [data-tokenwise] nodes in DOM: ${twNodes.length}`);

  // ══════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════
  sep('SUMMARY');

  const inputOk  = !!q(SELECTORS.input);
  const msgsOk   = qAll(SELECTORS.messages).length > 0;
  const chatOk   = !!q(SELECTORS.chatContainer);
  const filesOk  = qAll(SELECTORS.fileAttachment).length > 0;
  const widgetOk = !!twWidget;

  console.table({
    'Composer input':     { status: inputOk  ? 'OK' : 'MISSING' },
    'Messages detected':  { status: msgsOk   ? 'OK' : 'MISSING' },
    'Chat container':     { status: chatOk   ? 'OK' : 'MISSING' },
    'File attachments':   { status: filesOk  ? 'OK' : 'none attached or selector broken' },
    'Extension running':  { status: widgetOk ? 'OK' : 'NOT DETECTED' },
  });

  log('');
  log('Diagnostics complete. Please copy ALL output above and share it.');
  log('(Right-click this console > "Save as..." or select all & copy)');

})();
