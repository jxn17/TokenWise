/**
 * TokenWise — Token Detection Diagnostics for Gemini
 *
 * Paste this into the DevTools console on gemini.google.com.
 * It checks every piece of the DOM that TokenWise reads to count tokens:
 *   1. Composer input (what you're typing) — including Shadow DOM
 *   2. Conversation messages (user + model turns) — including Shadow DOM
 *   3. File attachments
 *   4. Special response types (simulations, miniapps, canvas, code, images)
 *   5. Key element selectors (green = found, red = missing)
 *
 * HOW TO USE:
 *   • Load a Gemini conversation with at least one model reply.
 *   • Optionally attach a file so attachment detection is tested.
 *   • Paste this entire block into the DevTools Console and press Enter.
 *   • Copy the full output and share it.
 *
 * NOTE: Gemini uses Shadow DOM heavily. This script traverses it automatically.
 */
(function tokenWiseTokenDiagGemini() {
  // ── Logging helpers ─────────────────────────────────────────────
  const log = (...a) => console.log('%c[TW-GEMINI]', 'color:#a78bfa;font-weight:bold', ...a);
  const ok = (...a) => console.log('%c[TW-GEMINI ✓]', 'color:#4ade80;font-weight:bold', ...a);
  const warn = (...a) => console.warn('%c[TW-GEMINI ⚠]', 'color:#fb923c;font-weight:bold', ...a);
  const err = (...a) => console.error('%c[TW-GEMINI ✗]', 'color:#f87171;font-weight:bold', ...a);
  const sep = (title) => console.log(`%c─── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`, 'color:#818cf8');

  // ── Tiny tokeniser approximation ────────────────────────────────
  // Gemini uses SentencePiece; this heuristic (~4 chars/token) is the same
  // approximation used in TokenWise's tokenizer.ts for Gemini models.
  function approxTokens(text) {
    if (!text) return 0;
    const words = text.match(/\S+/g) || [];
    let tokens = 0;
    for (const w of words) {
      tokens += Math.ceil(w.length / 4);
    }
    const spaces = (text.match(/\s/g) || []).length;
    return tokens + Math.ceil(spaces * 0.25);
  }

  // ── Selectors (mirror SITE_CONFIGS.gemini in dom-monitor.ts) ────
  const SELECTORS = {
    input: '.ql-editor, [contenteditable="true"].textarea, rich-textarea .ql-editor',
    // NOTE: ONLY 'message-content' — do NOT add .response-container or .model-response-text
    // (they match nested children AND parent wrappers, causing 3x double-count)
    messages: 'message-content',
    sendButton: 'button.send-button, button[aria-label="Send message"], .send-button-container button',
    chatContainer: '.conversation-container, [class*="conversation"]',
    fileAttachment: '.file-chip, .upload-chip, [data-file-chip], [class*="file-chip"]',
    // Additional fallbacks for messages
    // NOTE: turnsFallback uses user-query/model-response — NOT .conversation-turn which
    // Gemini does not render (confirmed MISSING in diagnostics).
    turnsFallback: 'user-query, model-response',
    turnContent: '.turn-content, .query-content',
  };

  // ── Shadow DOM helpers ──────────────────────────────────────────
  function findAllInShadow(selector, root = document.body, depth = 0, maxDepth = 8) {
    const results = [];
    if (depth > maxDepth) return results;
    try {
      if (root.shadowRoot) {
        const sels = selector.split(',').map(s => s.trim());
        for (const s of sels) {
          root.shadowRoot.querySelectorAll(s).forEach(el => results.push(el));
        }
        root.shadowRoot.querySelectorAll('*').forEach(child => {
          results.push(...findAllInShadow(selector, child, depth + 1, maxDepth));
        });
      }
      root.querySelectorAll('*').forEach(child => {
        if (child.shadowRoot) {
          results.push(...findAllInShadow(selector, child, depth + 1, maxDepth));
        }
      });
    } catch (e) { /* permission denied on closed shadow roots */ }
    return results;
  }

  function findOneInShadow(selector, root = document.body) {
    const all = findAllInShadow(selector, root);
    return all[0] || null;
  }

  // ── Query helpers (document first, then shadow DOM) ─────────────
  function q(selector) {
    for (const s of selector.split(',').map(x => x.trim())) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return findOneInShadow(selector);
  }

  function qAll(selector) {
    const results = new Set();
    for (const s of selector.split(',').map(x => x.trim())) {
      document.querySelectorAll(s).forEach(el => results.add(el));
    }
    findAllInShadow(selector).forEach(el => results.add(el));
    return [...results];
  }

  function getInputText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value || '';
    return (el.innerText || el.textContent || '').replace(/\u200b/g, '').trim();
  }

  // ── Shadow root inventory ───────────────────────────────────────
  function inventoryShadowRoots(root = document.body, depth = 0, maxDepth = 6) {
    const roots = [];
    if (depth > maxDepth) return roots;
    try {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          roots.push({ host: el.tagName.toLowerCase(), class: (el.className || '').toString().slice(0, 60), depth });
          roots.push(...inventoryShadowRoots(el, depth + 1, maxDepth));
        }
      });
    } catch (e) { /* permission denied */ }
    return roots;
  }

  log('═══════════════════════════════════════════════════════════');
  log('  TokenWise Token Detection Diagnostics — Gemini');
  log('═══════════════════════════════════════════════════════════');
  log('URL:', location.href);
  log('Time:', new Date().toISOString());

  // ══════════════════════════════════════════════════════════════════
  // SECTION 0 — Shadow DOM Inventory
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 0: Shadow DOM Inventory');

  const shadowRoots = inventoryShadowRoots();
  if (shadowRoots.length === 0) {
    warn('No shadow roots detected — Gemini may not have loaded its UI yet.');
  } else {
    ok('Found ' + shadowRoots.length + ' shadow root(s).');
    const byTag = {};
    for (const r of shadowRoots) { byTag[r.host] = (byTag[r.host] || 0) + 1; }
    log('Shadow hosts summary:', byTag);
    console.group('All shadow roots (first 30)');
    console.table(shadowRoots.slice(0, 30));
    console.groupEnd();
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 1 — Key Selector Health Check
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 1: Selector Health Check (document + shadow DOM)');

  for (const [name, sel] of Object.entries(SELECTORS)) {
    const found = qAll(sel);
    const count = found.length;
    if (count > 0) {
      ok('[' + name + '] Found ' + count + ' element(s) — selector: ' + sel);
    } else {
      err('[' + name + '] MISSING — selector: ' + sel);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 2 — Composer Input
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 2: Composer Input');

  const inputEl = q(SELECTORS.input);
  if (!inputEl) {
    err('Composer input not found. Make sure you are on gemini.google.com with the chat open.');
    warn('Attempting broad contenteditable fallback...');
    const ceEls = qAll('[contenteditable="true"]');
    log('Found ' + ceEls.length + ' contenteditable element(s) via broad search.');
    ceEls.slice(0, 5).forEach(function (el, i) {
      console.group('Contenteditable [' + i + '] <' + el.tagName.toLowerCase() + '>');
      log('class:', (el.className || '').toString().slice(0, 100));
      log('aria-label:', el.getAttribute('aria-label') || '(none)');
      log('placeholder:', el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '(none)');
      log('outerHTML (400c):', el.outerHTML.slice(0, 400));
      console.groupEnd();
    });
  } else {
    const text = getInputText(inputEl);
    const toks = approxTokens(text);
    ok('Input element found: <' + inputEl.tagName.toLowerCase() + '>');
    log('  tagName:', inputEl.tagName);
    log('  contenteditable:', inputEl.getAttribute('contenteditable'));
    log('  id:', inputEl.id || '(none)');
    log('  class:', (inputEl.className || '').toString().slice(0, 120));
    log('  aria-label:', inputEl.getAttribute('aria-label') || '(none)');
    log('  data-placeholder:', inputEl.getAttribute('data-placeholder') || '(none)');
    log('  Text length (chars):', text.length);
    log('  Text preview:', text.slice(0, 200) || '(empty)');
    log('  approx tokens:', toks);
    log('  Inside shadow DOM:', !document.contains(inputEl));
    console.group('Raw DOM — composer outerHTML (first 800 chars)');
    log(inputEl.outerHTML.slice(0, 800));
    console.groupEnd();
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 3 — Conversation Messages
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 3: Conversation Messages');

  let messageEls = qAll(SELECTORS.messages);
  log('Primary selector (message-content) found ' + messageEls.length + ' element(s).');

  if (messageEls.length === 0) {
    warn('Primary selector missed. Trying fallback: user-query / model-response...');
    messageEls = qAll(SELECTORS.turnsFallback);
    log('Fallback (user-query, model-response) found: ' + messageEls.length);
  }

  if (messageEls.length === 0) {
    warn('Trying second fallback: turn-content / query-content...');
    messageEls = qAll(SELECTORS.turnContent);
    log('Second fallback found: ' + messageEls.length);
  }

  if (messageEls.length === 0) {
    err('No messages found at all. Is there an active conversation?');
    warn('Dumping all custom elements (likely Gemini web components):');
    const allCustom = new Set(
      Array.from(document.querySelectorAll('*'))
        .filter(function (el) { return el.tagName.includes('-'); })
        .map(function (el) { return el.tagName.toLowerCase(); })
    );
    log('Custom tags on page:', [...allCustom].join(', '));
  } else {
    // ── Step 1: Ancestor deduplication ────────────────────────────────
    // Removes elements that are descendants of another matched element,
    // preventing double/triple counting from nested DOM matches.
    const ancestorDeduped = messageEls.filter(function (el) {
      return !messageEls.some(function (other) { return other !== el && other.contains(el); });
    });
    if (ancestorDeduped.length !== messageEls.length) {
      warn('Ancestor dedup removed ' + (messageEls.length - ancestorDeduped.length) + ' nested duplicate(s). Raw=' + messageEls.length + ' → Deduped=' + ancestorDeduped.length);
    }

    // ── Step 2: Text-fingerprint dedup + "Gemini said" stripping ──────
    // Mirrors the fix in extractGeminiMessages() in gemini.ts.
    // Gemini renders message-content in multiple DOM positions (cross-shadow-DOM
    // duplicates that .contains() cannot detect), and user-query elements contain
    // a "Gemini said\n\n<assistant text>" reflection that inflates user token counts.
    const seenTexts = new Set();
    const filteredEls = [];
    const filteredRoles = [];
    const filteredTexts = [];

    ancestorDeduped.forEach(function (el) {
      const tag = el.tagName.toLowerCase();
      const isModel = tag === 'message-content'
        || el.classList.contains('model-response-text')
        || el.closest('[data-role="model"]') !== null
        || el.closest('model-response') !== null;

      const isUser = tag === 'user-query'
        || el.closest('[data-role="user"]') !== null
        || el.closest('user-query') !== null;

      if (!isModel && !isUser) {
        warn('  Skipping element with UNKNOWN role: <' + tag + '>');
        return;
      }

      let text = (el.innerText || el.textContent || '').trim();

      if (isUser) {
        // Strip the "Gemini said\n\n<response>" prefix that Gemini injects into
        // user-query elements to show the previous turn's assistant text.
        text = text.replace(/^Gemini said\s*\n+/i, '').trim();
        if (!text) {
          warn('  Skipping user element — empty after stripping "Gemini said" prefix.');
          return;
        }
        // If remaining text matches last recorded assistant message → pure reflection, skip.
        const lastFiltered = filteredTexts[filteredTexts.length - 1];
        if (lastFiltered && filteredRoles[filteredRoles.length - 1] === 'model' && lastFiltered === text) {
          warn('  Skipping user element — text matches last assistant response (pure reflection).');
          return;
        }
      }

      const fingerprint = text.slice(0, 120);
      if (seenTexts.has(fingerprint)) {
        warn('  Skipping duplicate (text fingerprint already seen): ' + fingerprint.slice(0, 60));
        return;
      }
      seenTexts.add(fingerprint);

      filteredEls.push(el);
      filteredRoles.push(isModel ? 'model' : 'user');
      filteredTexts.push(text);
    });

    messageEls = filteredEls;

    if (filteredEls.length !== ancestorDeduped.length) {
      warn('Text-fingerprint dedup removed ' + (ancestorDeduped.length - filteredEls.length) + ' cross-tree duplicate(s). Ancestor-deduped=' + ancestorDeduped.length + ' → Final=' + filteredEls.length);
    }

    let totalTokens = 0;
    const messageReport = [];

    filteredEls.forEach(function (el, i) {
      const text = filteredTexts[i];
      const role = filteredRoles[i];
      const toks = approxTokens(text);
      totalTokens += toks;

      messageReport.push({
        '#': i,
        role: role === 'model' ? 'model/assistant' : 'user',
        tag: el.tagName.toLowerCase(),
        chars: text.length,
        approxTokens: toks,
        preview: text.slice(0, 60) + (text.length > 60 ? '...' : ''),
        inShadow: !document.contains(el),
        hasImage: !!el.querySelector('img'),
        hasCode: !!el.querySelector('code, pre'),
      });
    });

    log('──── Message Summary ────');
    console.table(messageReport);
    log('Total conversation approx tokens: ' + totalTokens);
    log('(This is what TokenWise uses for the "Conversation" counter.)');

    if (filteredEls.length > 0) {
      console.group('First message outerHTML (800 chars)');
      log(filteredEls[0].outerHTML.slice(0, 800));
      console.groupEnd();
    }
    if (filteredEls.length > 1) {
      console.group('Last message outerHTML (800 chars)');
      log(filteredEls[filteredEls.length - 1].outerHTML.slice(0, 800));
      console.groupEnd();
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 3b — iframes: full inventory (Gemini Canvas, sandboxed apps)
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 3b: iframe Inventory (Canvas / Simulation / Sandboxed Apps)');

  // Collect ALL iframes — both in the light DOM and across shadow roots.
  const allIframes = qAll('iframe');
  log('Total <iframe> elements found (light + shadow DOM): ' + allIframes.length);

  if (allIframes.length === 0) {
    log('  No iframes present — Gemini has not rendered a Canvas / simulation app in this conversation.');
  } else {
    const iframeReport = [];
    allIframes.forEach(function (iframe, i) {
      const src       = iframe.getAttribute('src')    || '(none)';
      const srcdoc    = iframe.getAttribute('srcdoc') || '';
      const sandbox   = iframe.getAttribute('sandbox');
      const w         = iframe.offsetWidth;
      const h         = iframe.offsetHeight;
      const area      = w * h;
      const visible   = w >= 50 && h >= 50;
      // Conservative token estimate: same formula as Claude artifact estimator.
      // Reference: 720×488 px ≈ 800 tokens of generated code.
      const REF_AREA  = 720 * 488;
      const REF_TOKS  = 800;
      const estTokens = visible ? Math.max(200, Math.round((area / REF_AREA) * REF_TOKS)) : 0;

      const row = {
        '#': i,
        src:      src.slice(0, 60),
        sandbox:  sandbox !== null ? (sandbox || '(empty attr)') : '(no sandbox attr)',
        hasSrcdoc: srcdoc.length > 0,
        srcdocLen: srcdoc.length,
        w_px:     w,
        h_px:     h,
        visible:  visible,
        estTokens: estTokens,
      };
      iframeReport.push(row);

      if (visible) {
        warn('  [iframe ' + i + '] VISIBLE ' + w + 'x' + h + ' px — est. ' + estTokens + ' tokens');
        log('    src:', src.slice(0, 120));
        log('    sandbox attr:', sandbox !== null ? ('"' + (sandbox || '(empty)') + '"') : '(no sandbox attr — not sandboxed)');
        if (srcdoc.length > 0) {
          log('    srcdoc length:', srcdoc.length + ' chars (' + approxTokens(srcdoc) + ' approx tokens) — srcdoc is READABLE!');
          log('    srcdoc preview (600c):', srcdoc.slice(0, 600));
        }
        // Try to read same-origin iframe document
        try {
          const idoc = iframe.contentDocument || iframe.contentWindow.document;
          if (idoc) {
            const bodyText = (idoc.body && idoc.body.innerText) || idoc.body.textContent || '';
            ok('    contentDocument accessible! body text length: ' + bodyText.length + ' | approx tokens: ' + approxTokens(bodyText));
            log('    body text preview (300c):', bodyText.slice(0, 300));
          }
        } catch (e) {
          log('    contentDocument: cross-origin / sandboxed — cannot read (' + (e.message || String(e)).slice(0, 80) + ')');
        }
        // Inspect parent element for context clues
        const parent = iframe.closest('gemini-app, [class*="artifact"], [class*="canvas"], [class*="app-container"], [data-source-type]');
        if (parent) {
          log('    closest named ancestor: <' + parent.tagName.toLowerCase() + '> | class: ' + (parent.className || '').toString().slice(0, 80));
          log('    ancestor data-source-type:', parent.getAttribute('data-source-type') || '(none)');
        }
      } else {
        log('  [iframe ' + i + '] tiny/invisible ' + w + 'x' + h + ' px (likely infrastructure) — src: ' + src.slice(0, 80));
      }
    });

    log('');
    log('── iframe Summary Table ──');
    console.table(iframeReport);
    const visibleIframes = iframeReport.filter(function (r) { return r.visible; });
    const totalIframeTokens = visibleIframes.reduce(function (s, r) { return s + r.estTokens; }, 0);
    if (visibleIframes.length > 0) {
      warn('VISIBLE IFRAMES: ' + visibleIframes.length + ' | Est. total iframe tokens: ' + totalIframeTokens);
      warn('TokenWise does NOT currently count these — this is the gap to fix!');
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 3c — Gemini Canvas / App custom elements
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 3c: Gemini Canvas / App Elements');

  // These are the custom element wrappers Gemini uses around Canvas/simulation outputs.
  const canvasTags = [
    'gemini-app',
    'code-execution-result',
    'tool-use',
    'rendered-artifact',
    'canvas-container',
    'app-renderer',
    'mini-app',
  ];

  let foundCanvasComponents = 0;
  canvasTags.forEach(function (tag) {
    const els = qAll(tag);
    if (els.length > 0) {
      foundCanvasComponents++;
      warn('<' + tag + '> found: ' + els.length + ' element(s)');
      els.slice(0, 3).forEach(function (el, i) {
        console.group('  <' + tag + '>[' + i + ']');
        log('  class:', (el.className || '').toString().slice(0, 100));
        log('  data-source-type:', el.getAttribute('data-source-type') || '(none)');
        log('  has iframe child:', !!el.querySelector('iframe'));
        log('  has canvas child:', !!el.querySelector('canvas'));
        log('  offsetWidth x offsetHeight:', el.offsetWidth + 'x' + el.offsetHeight);
        log('  outerHTML (600c):', el.outerHTML.slice(0, 600));
        console.groupEnd();
      });
    }
  });

  // Broad attribute-based search for simulation-type wrappers
  const simAttrCandidates = qAll(
    '[data-source-type="TOOL_CODE"], [data-source-type="canvas"], [data-source-type="app"],' +
    '[class*="simulation"], [class*="canvas-output"], [class*="tool-code"], [class*="code-execution"],' +
    '[class*="rendered-output"], [class*="interactive-output"], [class*="gemini-app"]'
  );
  if (simAttrCandidates.length > 0) {
    warn('Broad sim/canvas attribute search found ' + simAttrCandidates.length + ' candidate(s):');
    simAttrCandidates.slice(0, 5).forEach(function (el, i) {
      log('  [' + i + '] <' + el.tagName.toLowerCase() + '> | class: ' + (el.className || '').toString().slice(0, 80));
      log('       data-source-type:', el.getAttribute('data-source-type') || '(none)');
      log('       outerHTML (300c):', el.outerHTML.slice(0, 300));
    });
  } else if (foundCanvasComponents === 0) {
    log('No Gemini Canvas / App elements found — conversation may not contain simulations.');
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 3d — Code execution result panels
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 3d: Code Execution Result Panels');

  // Gemini shows code execution output in distinct result containers.
  // These are separate from <message-content> and need independent counting.
  const codeExecSelectors = [
    'code-execution-result',
    '[class*="execution-result"]',
    '[class*="code-result"]',
    '[class*="run-result"]',
    '[class*="output-block"]',
    '[data-source-type="TOOL_CODE"]',
    '[class*="tool-response"]',
    '[class*="tool_response"]',
  ];
  const codeExecEls = qAll(codeExecSelectors.join(', '));

  if (codeExecEls.length > 0) {
    warn('Found ' + codeExecEls.length + ' code-execution result panel(s):');
    let totalExecTokens = 0;
    codeExecEls.forEach(function (el, i) {
      const text = (el.innerText || el.textContent || '').trim();
      const toks = approxTokens(text);
      totalExecTokens += toks;
      console.group('Code exec result [' + i + '] <' + el.tagName.toLowerCase() + '>');
      log('  class:', (el.className || '').toString().slice(0, 100));
      log('  text length:', text.length + ' chars | approx tokens: ' + toks);
      log('  preview:', text.slice(0, 200));
      log('  outerHTML (400c):', el.outerHTML.slice(0, 400));
      console.groupEnd();
    });
    warn('Total approx tokens in code exec results: ' + totalExecTokens);
    warn('TokenWise currently does NOT count these — gap to fix!');
  } else {
    log('No code execution result panels found.');
  }

  // Also report plain code blocks (these ARE inside message-content, so they ARE counted)
  const codeBlockEls = qAll('pre, code');
  const codeBlocksInsideMsgContent = codeBlockEls.filter(function (el) {
    return !!el.closest('message-content');
  });
  log('');
  log('Code blocks (<pre>/<code>) total: ' + codeBlockEls.length
    + ' | inside message-content (counted ✓): ' + codeBlocksInsideMsgContent.length
    + ' | outside message-content (NOT counted): ' + (codeBlockEls.length - codeBlocksInsideMsgContent.length));

  // ══════════════════════════════════════════════════════════════════
  // SECTION 3e — Thinking / Reasoning Blocks
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 3e: Thinking / Reasoning Blocks');

  const thinkingSelectors = [
    'thought-chunk',
    'thinking-block',
    '[class*="thinking"]',
    '[class*="thought-"]',
    '[class*="-thought"]',
    '[data-thought]',
    '[class*="chain-of-thought"]',
    '[class*="reasoning"]',
    '[class*="think-"]',
    // Gemini 2.5 Pro specific
    '[class*="model-thoughts"]',
    '[class*="thoughts-section"]',
    '[aria-label*="thought"]',
    '[aria-label*="thinking"]',
  ];
  const thinkingEls = qAll(thinkingSelectors.join(', '));

  // Deduplicate by ancestor
  const thinkingDeduped = thinkingEls.filter(function (el) {
    return !thinkingEls.some(function (other) { return other !== el && other.contains(el); });
  });

  if (thinkingDeduped.length > 0) {
    warn('Found ' + thinkingDeduped.length + ' thinking/reasoning block(s) — these consume real tokens!');
    let totalThinkTokens = 0;
    thinkingDeduped.forEach(function (el, i) {
      const text = (el.innerText || el.textContent || '').trim();
      const toks = approxTokens(text);
      totalThinkTokens += toks;
      console.group('Thinking block [' + i + '] <' + el.tagName.toLowerCase() + '>');
      log('  class:', (el.className || '').toString().slice(0, 100));
      log('  aria-label:', el.getAttribute('aria-label') || '(none)');
      log('  text length:', text.length + ' chars | approx tokens: ' + toks);
      log('  insideMsgContent:', !!el.closest('message-content') + ' (if true → already counted by Section 3)');
      log('  preview:', text.slice(0, 200));
      log('  outerHTML (400c):', el.outerHTML.slice(0, 400));
      console.groupEnd();
    });
    warn('Total approx tokens in thinking blocks: ' + totalThinkTokens);
    const thinkInsideMsgContent = thinkingDeduped.filter(function (el) { return !!el.closest('message-content'); });
    log('Thinking blocks inside message-content (counted ✓): ' + thinkInsideMsgContent.length);
    log('Thinking blocks OUTSIDE message-content (NOT counted): ' + (thinkingDeduped.length - thinkInsideMsgContent.length));
  } else {
    log('No thinking/reasoning blocks found (expected if not using Gemini 2.5 Pro Thinking).');
  }

  // ══════════════════════════════════════════════════════════════════
  // SECTION 3f — Images in model responses (generated / inline)
  // ══════════════════════════════════════════════════════════════════
  sep('SECTION 3f: Images in Model Responses');

  const allResponseImages = qAll('message-content img, model-response img, [class*="model-response"] img');
  const generatedImages   = allResponseImages.filter(function (img) {
    // Generated images typically have a data: URI, blob: URI, or a Gemini CDN src
    const src = img.src || '';
    return src.startsWith('data:') || src.startsWith('blob:') || src.includes('googleapis') || src.includes('gstatic');
  });

  log('Total <img> tags inside model responses: ' + allResponseImages.length);
  if (allResponseImages.length > 0) {
    warn(generatedImages.length + ' of these appear to be generated/CDN images (not UI icons).');
    allResponseImages.slice(0, 5).forEach(function (img, i) {
      const w = img.naturalWidth || img.offsetWidth || 0;
      const h = img.naturalHeight || img.offsetHeight || 0;
      // Vision token estimate: images are tiled into 512×512 tiles; each tile costs ~258 tokens.
      // Gemini vision formula: ceil(w/512) * ceil(h/512) * 258  (rough approximation)
      const tilesW = Math.max(1, Math.ceil(w / 512));
      const tilesH = Math.max(1, Math.ceil(h / 512));
      const imgTokenEst = tilesW * tilesH * 258;
      console.group('Response image [' + i + ']');
      log('  src (80c):', (img.src || '(none)').slice(0, 80));
      log('  naturalWidth x naturalHeight:', w + 'x' + h);
      log('  alt:', img.getAttribute('alt') || '(none)');
      log('  est. vision tokens:', w > 0 && h > 0 ? imgTokenEst : '(unknown size — cannot estimate)');
      log('  outerHTML (300c):', img.outerHTML.slice(0, 300));
      console.groupEnd();
    });
  } else {
    log('No images found inside model response elements.');
  }

  // ── Streaming indicators ──────────────────────────────────────────
  sep('SECTION 3g: Streaming / Generating Indicators');
  const streamingSelectors = [
    '.loading-indicator', '[class*="streaming"]', '[class*="generating"]',
    '[class*="in-progress"]', '[class*="pending"]', '.dots-animation',
    '[aria-label*="loading"]', '[aria-label*="Generating"]', '[aria-busy="true"]',
    // Gemini-specific
    '[class*="response-loading"]', '[class*="thinking-indicator"]',
  ];
  let streamingFound = 0;
  streamingSelectors.forEach(function (sel) {
    const found = qAll(sel);
    if (found.length) {
      warn('Streaming indicator "' + sel + '" found (' + found.length + 'x) — response may be mid-stream!');
      streamingFound += found.length;
    }
  });
  if (streamingFound === 0) log('No streaming/generating indicators found — response appears complete.');

  // ── Gemini web component inventory ───────────────────────────────
  sep('SECTION 3h: Gemini Web Components Inventory');

  const geminiComponentTags = [
    'chat-window', 'message-content', 'response-container',
    'model-response', 'user-query', 'conversation-container',
    'file-chip', 'rich-textarea', 'bard-mode-selector',
    'gemini-app', 'tool-use', 'code-execution-result',
    'multimodal-input', 'thought-chunk', 'thinking-block',
    'rendered-artifact', 'canvas-container',
  ];

  const componentCounts = {};
  let foundComponents = 0;
  geminiComponentTags.forEach(function (tag) {
    const els = qAll(tag);
    if (els.length > 0) {
      foundComponents++;
      componentCounts[tag] = els.length;
      ok('<' + tag + '> found: ' + els.length + ' element(s)');
    }
  });

  if (foundComponents === 0) {
    warn('None of the known Gemini web components were found by tag name.');
  }

  // Always dump all hyphenated custom tags — catches new/renamed components
  const allCustomTags = new Set(
    Array.from(document.querySelectorAll('*'))
      .filter(function (el) { return el.tagName.includes('-'); })
      .map(function (el) { return el.tagName.toLowerCase(); })
  );
  log('');
  log('All hyphenated custom element tags on page (' + allCustomTags.size + ' unique):');
  log([...allCustomTags].sort().join(', '));

// ══════════════════════════════════════════════════════════════════
// SECTION 4 — File Attachments
// ══════════════════════════════════════════════════════════════════
sep('SECTION 4: File Attachments');

const attachmentEls = qAll(SELECTORS.fileAttachment);
log('Found ' + attachmentEls.length + ' attachment element(s) via current selector.');

if (attachmentEls.length === 0) {
  warn('No attachments detected. Running broad fallback scan (document + shadow DOM)...');

  const broadCandidates = qAll('div, button, span, file-chip').filter(function (el) {
    const text = (el.textContent || '').trim();
    const aria = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const hasExt = /[\w\s\-]+\.[a-zA-Z0-9]{2,5}\b/.test(text)
      || /[\w\s\-]+\.[a-zA-Z0-9]{2,5}\b/.test(aria)
      || /[\w\s\-]+\.[a-zA-Z0-9]{2,5}\b/.test(title);
    const cls = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    const hasClass = cls.includes('file') || cls.includes('attachment')
      || cls.includes('upload') || cls.includes('chip')
      || cls.includes('thumbnail');
    return (hasExt || hasClass) && el.children.length < 8 && text.length < 200;
  });

  const pruned = broadCandidates.filter(function (el) {
    return !broadCandidates.some(function (o) { return o !== el && el.contains(o); });
  });
  log('Broad fallback found ' + pruned.length + ' candidate(s).');

  pruned.slice(0, 5).forEach(function (el, i) {
    console.group('Fallback attachment [' + i + '] <' + el.tagName.toLowerCase() + '>');
    log('class:', (el.className || '').toString());
    log('aria-label:', el.getAttribute('aria-label') || '(none)');
    log('title:', el.getAttribute('title') || '(none)');
    log('role:', el.getAttribute('role') || '(none)');
    log('textContent:', (el.textContent || '').trim().slice(0, 100));
    log('outerHTML (400c):', el.outerHTML.slice(0, 400));
    console.groupEnd();
  });
} else {
  attachmentEls.forEach(function (el, i) {
    console.group('Attachment [' + i + ']');
    const aria = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const text = (el.textContent || '').trim();
    const img = el.querySelector('img');
    const nameMatch = (aria || title || text).match(/[\w\s\-]+\.[a-zA-Z0-9]{2,5}\b/);
    ok('  aria-label:', aria || '(none)');
    log('  title:', title || '(none)');
    log('  textContent:', text.slice(0, 100) || '(none)');
    log('  has <img>:', !!img, img ? 'src=' + (img.src || '').slice(0, 60) : '');
    log('  detected filename:', nameMatch ? nameMatch[0] : '(none)');
    log('  data-filename:', el.getAttribute('data-filename') || '(none)');
    log('  data-filetype:', el.getAttribute('data-filetype') || '(none)');
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
  err('Selector tried: ' + SELECTORS.chatContainer);
  warn('Dumping document.body children for manual inspection:');
  Array.from(document.body.children).slice(0, 8).forEach(function (el, i) {
    log('body > child[' + i + ']: ' + el.tagName.toLowerCase() + ' | id: ' + (el.id || '(none)') + ' | class: ' + (el.className || '').toString().slice(0, 80));
  });
} else {
  ok('Chat container found: <' + chatContainer.tagName.toLowerCase() + '>');
  log('  class:', (chatContainer.className || '').toString().slice(0, 80));
  log('  children count:', chatContainer.children.length);
  log('  scrollHeight:', chatContainer.scrollHeight);
  log('  inShadow:', !document.contains(chatContainer));
}

// ══════════════════════════════════════════════════════════════════
// SECTION 6 — Send Button
// ══════════════════════════════════════════════════════════════════
sep('SECTION 6: Send Button');

const sendBtn = q(SELECTORS.sendButton);
if (!sendBtn) {
  warn('Send button not found. Trying fallback: any button with "send" in class/aria...');
  const btnFallback = qAll('button').filter(function (b) {
    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
    const cls = (b.className || '').toString().toLowerCase();
    return aria.includes('send') || cls.includes('send');
  });
  log('Fallback send button candidates: ' + btnFallback.length);
  btnFallback.slice(0, 3).forEach(function (b, i) {
    log('  Button [' + i + '] aria-label: "' + b.getAttribute('aria-label') + '" | class: ' + (b.className || '').toString().slice(0, 60));
  });
} else {
  ok('Send button found: <' + sendBtn.tagName.toLowerCase() + '> | aria-label:', sendBtn.getAttribute('aria-label'));
  log('  disabled:', sendBtn.disabled);
  log('  outerHTML (200c):', sendBtn.outerHTML.slice(0, 200));
}

// ══════════════════════════════════════════════════════════════════
// SECTION 7 — TokenWise Extension Presence
// ══════════════════════════════════════════════════════════════════
sep('SECTION 7: TokenWise Extension Presence');

const twWidget = document.getElementById('tokenwise-widget');
const twGhost = document.getElementById('tokenwise-ghost-text');
const twNodes = document.querySelectorAll('[data-tokenwise]');

if (twWidget) {
  ok('TokenWise widget is present in the DOM (#tokenwise-widget).');
  log('  display:', twWidget.style.display);
  log('  innerHTML preview:', twWidget.innerHTML.slice(0, 300));
} else {
  warn('TokenWise widget NOT found. Extension may not be running on Gemini.');
}

if (twGhost) { ok('Ghost text overlay present (#tokenwise-ghost-text).'); }
log('Total [data-tokenwise] nodes in DOM: ' + twNodes.length);

// ══════════════════════════════════════════════════════════════════
// SECTION 8 — Shadow Root Deep Dive (first 3 roots)
// ══════════════════════════════════════════════════════════════════
sep('SECTION 8: Shadow Root Deep Dive (first 3 roots)');

let shadowDumpCount = 0;
function dumpFirstShadowRoots(el, depth) {
  depth = depth || 0;
  if (shadowDumpCount >= 3 || depth > 5) return;
  try {
    if (el.shadowRoot) {
      shadowDumpCount++;
      console.group('Shadow Root #' + shadowDumpCount + ' — host: <' + el.tagName.toLowerCase() + '> depth=' + depth);
      log('host class:', (el.className || '').toString().slice(0, 80));
      log('children inside shadow root:', el.shadowRoot.children.length);
      log('innerHTML (600c):', el.shadowRoot.innerHTML.slice(0, 600));
      console.groupEnd();
    }
    (el.shadowRoot || el).querySelectorAll('*').forEach(function (child) {
      dumpFirstShadowRoots(child, depth + 1);
    });
  } catch (e) { /* ignore closed roots */ }
}
dumpFirstShadowRoots(document.body, 0);

if (shadowDumpCount === 0) {
  warn('No shadow roots to dump — Gemini may not have loaded yet.');
}

// ══════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════
sep('SUMMARY');

const inputOk   = !!q(SELECTORS.input);
const msgsOk    = qAll(SELECTORS.messages).length > 0
  || qAll(SELECTORS.turnsFallback).length > 0
  || qAll(SELECTORS.turnContent).length > 0;
const chatOk    = !!q(SELECTORS.chatContainer);
const filesOk   = qAll(SELECTORS.fileAttachment).length > 0;
const widgetOk  = !!twWidget;
const shadowOk  = shadowRoots.length > 0;

const visibleIframeCount  = allIframes.filter(function (f) { return f.offsetWidth >= 50 && f.offsetHeight >= 50; }).length;
const iframeTokenEst      = allIframes
  .filter(function (f) { return f.offsetWidth >= 50 && f.offsetHeight >= 50; })
  .reduce(function (s, f) {
    const a = f.offsetWidth * f.offsetHeight;
    return s + Math.max(200, Math.round((a / (720 * 488)) * 800));
  }, 0);

const execPanelCount  = codeExecEls.length;
const thinkCount      = thinkingDeduped.length;
const thinkOutsideMsg = thinkingDeduped.filter(function (el) { return !el.closest('message-content'); }).length;
const imageCount      = allResponseImages.length;

console.table({
  'Shadow DOM detected':            { status: shadowOk   ? 'OK'                  : 'NONE FOUND',                counted: 'n/a' },
  'Composer input':                 { status: inputOk    ? 'OK'                  : 'MISSING',                   counted: 'n/a' },
  'Messages detected':              { status: msgsOk     ? 'OK'                  : 'MISSING',                   counted: 'yes — Section 3' },
  'Chat container':                 { status: chatOk     ? 'OK'                  : 'MISSING',                   counted: 'n/a' },
  'File attachments':               { status: filesOk    ? 'yes — selector OK'   : 'none attached / selector?', counted: 'yes — Section 4' },
  'Visible iframes (Canvas/apps)':  { status: visibleIframeCount > 0 ? visibleIframeCount + ' found, est ' + iframeTokenEst + ' tok' : 'none', counted: 'NO — GAP' },
  'Code execution result panels':   { status: execPanelCount > 0 ? execPanelCount + ' found' : 'none found',    counted: execPanelCount > 0 ? 'NO — GAP' : 'n/a' },
  'Thinking blocks (total)':        { status: thinkCount > 0 ? thinkCount + ' found' : 'none found',            counted: thinkOutsideMsg > 0 ? 'PARTIAL — ' + thinkOutsideMsg + ' outside msg-content' : 'yes (inside msg-content)' },
  'Images in model responses':      { status: imageCount > 0 ? imageCount + ' found' : 'none found',            counted: 'NO — GAP' },
  'Extension running':              { status: widgetOk   ? 'OK'                  : 'NOT DETECTED',              counted: 'n/a' },
});

log('');
log('Legend: "counted" = whether TokenWise currently includes this in the token count.');
log('"NO — GAP" rows are things Gemini renders that we are not yet measuring.');
log('');
log('Diagnostics complete. Please copy ALL output above and share it.');
log('(Right-click console > "Save as..." or select all & copy)');

}) ();
