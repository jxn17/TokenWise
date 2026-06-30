/**
 * TokenWise — Gemini Attachment Diagnostic v2
 *
 * Run this on gemini.google.com WITH files already attached in the composer.
 * It will reveal:
 *   A — Where the input lives
 *   B — What composer boundary is resolved to (current gemini.ts logic)
 *   C — Search WIDER (parent chain) to find where chips actually live
 *   D — What the chips look like once found
 *   E — Root cause verdict
 */
(function () {
  'use strict';

  const FILE_ATTACHMENT_SELECTOR =
    'uploader-file-preview, gem-media-attachment, .file-preview-chip, .file-preview-container, .gem-attachment-tile';
  const INPUT_SELECTOR = '.ql-editor, [contenteditable="true"].textarea, rich-textarea .ql-editor';
  const COMPOSER_TAGS = new Set(['form', 'fieldset', 'rich-textarea', 'input-area']);
  const COMPOSER_HINTS = ['input-area', 'composer', 'chat-input', 'prompt-input',
    'input-container', 'message-input', 'query-box'];

  // ── Shadow DOM helpers ────────────────────────────────────────────
  function findInShadow(selector, root, depth) {
    if (!root) root = document.body;
    if (!depth) depth = 0;
    if (depth > 10) return null;
    try {
      if (root.shadowRoot) {
        for (const sel of selector.split(',').map(s => s.trim())) {
          const f = root.shadowRoot.querySelector(sel);
          if (f) return f;
        }
        for (const child of root.shadowRoot.querySelectorAll('*')) {
          const r = findInShadow(selector, child, depth + 1);
          if (r) return r;
        }
      }
      for (const child of root.querySelectorAll('*')) {
        if (child.shadowRoot) {
          const r = findInShadow(selector, child, depth + 1);
          if (r) return r;
        }
      }
    } catch (_) {}
    return null;
  }

  function findAllInShadow(selector, root, depth) {
    if (!root) root = document.body;
    if (!depth) depth = 0;
    const results = [];
    if (depth > 10) return results;
    try {
      if (root.shadowRoot) {
        for (const sel of selector.split(',').map(s => s.trim())) {
          root.shadowRoot.querySelectorAll(sel).forEach(el => results.push(el));
        }
        root.shadowRoot.querySelectorAll('*').forEach(child =>
          results.push(...findAllInShadow(selector, child, depth + 1))
        );
      }
      root.querySelectorAll('*').forEach(child => {
        if (child.shadowRoot) results.push(...findAllInShadow(selector, child, depth + 1));
      });
    } catch (_) {}
    return results;
  }

  function desc(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (el.className || '').toString().trim().slice(0, 70).replace(/\s+/g, ' ');
    const aria = el.getAttribute('aria-label') || '';
    const shadow = !document.contains(el) ? '[SHADOW]' : '[light]';
    return tag + ' | class="' + cls + '" | aria="' + aria + '" | ' + el.offsetWidth + 'x' + el.offsetHeight + ' ' + shadow;
  }

  const hr = () => console.log('─'.repeat(70));

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  TokenWise: Gemini Attachment Diagnostic v2');
  console.log('════════════════════════════════════════════════════════════════════════');

  // ── A: Input element ─────────────────────────────────────────────
  hr();
  console.log('A: INPUT ELEMENT');
  hr();
  let inputEl = document.querySelector(INPUT_SELECTOR);
  if (!inputEl) inputEl = findInShadow(INPUT_SELECTOR, document.body);
  console.log(inputEl ? ('[OK] ' + desc(inputEl)) : '[FAIL] Input not found!');

  // ── B: Current composer boundary (mirrors gemini.ts) ────────────
  hr();
  console.log('B: COMPOSER BOUNDARY (current gemini.ts logic — stops at first match)');
  hr();
  let composerRoot = null;
  if (inputEl) {
    let anc = inputEl.parentElement;
    while (anc && anc !== document.body) {
      if (COMPOSER_TAGS.has(anc.tagName.toLowerCase())) { composerRoot = anc; break; }
      const cls = (anc.className || '').toString().toLowerCase();
      if (COMPOSER_HINTS.some(h => cls.includes(h))) { composerRoot = anc; break; }
      anc = anc.parentElement;
    }
    if (!composerRoot) {
      let fb = inputEl;
      for (let i = 0; i < 8 && fb.parentElement !== document.body; i++) fb = fb.parentElement;
      composerRoot = fb !== inputEl ? fb : document.body;
    }
  }
  console.log('[B-resolved] ' + (composerRoot ? desc(composerRoot) : 'NULL — uses document.body'));

  // ── C: FULL PARENT CHAIN SCAN ─────────────────────────────────────
  // The key question: which ancestor of the input ACTUALLY contains the chips?
  hr();
  console.log('C: PARENT CHAIN — searching each ancestor for attachment chips');
  console.log('   (This reveals the correct scope for the composer search)');
  hr();
  let ancestor = inputEl ? inputEl.parentElement : null;
  let depth = 0;
  let firstAncestorWithChips = null;
  while (ancestor && ancestor !== document.body && depth < 15) {
    const lightChips = Array.from(ancestor.querySelectorAll(FILE_ATTACHMENT_SELECTOR));
    const shadowChips = findAllInShadow(FILE_ATTACHMENT_SELECTOR, ancestor);
    const total = lightChips.length + shadowChips.length;
    const marker = total > 0 ? ' <--- CHIPS FOUND HERE (' + total + ')' : '';
    console.log('[depth ' + depth + '] ' + desc(ancestor) + marker);
    if (total > 0 && !firstAncestorWithChips) {
      firstAncestorWithChips = { el: ancestor, lightChips, shadowChips, depth };
    }
    ancestor = ancestor.parentElement;
    depth++;
  }

  // ── D: Inspect the chips once found ──────────────────────────────
  hr();
  console.log('D: CHIP DETAILS (from the correct ancestor scope)');
  hr();
  if (firstAncestorWithChips) {
    const { el, lightChips, shadowChips, depth: d } = firstAncestorWithChips;
    console.log('[Found at depth ' + d + '] ' + desc(el));
    console.log('Light chips (' + lightChips.length + '):');
    lightChips.forEach((c, i) => console.log('  L' + i + ': ' + desc(c)));
    console.log('Shadow chips (' + shadowChips.length + '):');
    shadowChips.forEach((c, i) => console.log('  S' + i + ': ' + desc(c)));

    // Check if light and shadow chips are the same elements (nested)
    console.log('');
    console.log('DEDUP CHECK — does contains() catch L<->S relationships?');
    const allChips = lightChips.concat(shadowChips);
    const afterDedup = allChips.filter(c => !allChips.some(o => o !== c && o.contains(c)));
    console.log('Before contains() dedup: ' + allChips.length + ' elements');
    console.log('After  contains() dedup: ' + afterDedup.length + ' elements');
    afterDedup.forEach((c, i) => console.log('  [' + i + '] ' + desc(c)));

    // Fingerprint dedup (by textContent or img.src — cross-tree safe)
    const seenFp = new Set();
    const fingerDedup = [];
    for (const c of allChips) {
      const img = c.querySelector('img');
      const fp = (img && img.src ? img.src.slice(0, 100) : '') + '|' + (c.textContent || '').trim().slice(0, 80);
      if (!seenFp.has(fp)) { seenFp.add(fp); fingerDedup.push(c); }
    }
    console.log('After fingerprint dedup: ' + fingerDedup.length + ' elements');

    if (afterDedup.length !== fingerDedup.length) {
      console.error('[BUG] contains() dedup MISSES ' + (afterDedup.length - fingerDedup.length) +
        ' duplicates that fingerprinting catches!');
      console.error('      This confirms the shadow-boundary dedup failure.');
    } else {
      console.log('[OK] Both dedup methods agree on count: ' + afterDedup.length);
    }
  } else {
    // No chips found in any ancestor — do a full-document scan as fallback
    console.log('[INFO] No chips found in input ancestor chain.');
    console.log('       Running full-document scan...');
    const allDoc = Array.from(document.querySelectorAll(FILE_ATTACHMENT_SELECTOR));
    const allShadow = findAllInShadow(FILE_ATTACHMENT_SELECTOR, document.body);
    console.log('Full-document light: ' + allDoc.length);
    console.log('Full-document shadow: ' + allShadow.length);
    if (allDoc.length + allShadow.length === 0) {
      console.warn('[WARN] No chips found ANYWHERE. Are files actually attached in the composer?');
      console.warn('       Gemini may have changed its chip custom element names.');
      console.log('');
      console.log('Running class-name scan for any "attach/upload/preview" elements...');
      const everything = Array.from(document.querySelectorAll('*'))
        .concat(findAllInShadow('*', document.body));
      const hits = new Set();
      everything.forEach(el => {
        const cls = (el.className || '').toString();
        const tag = el.tagName.toLowerCase();
        if (/attach|upload|preview|file.chip|media.chip|gem.attach|uploader/i.test(cls + tag)) {
          hits.add(tag + ' | ' + cls.trim().slice(0, 100));
        }
      });
      if (hits.size > 0) {
        console.log('Possible chip elements found (' + hits.size + '):');
        [...hits].slice(0, 30).forEach(s => console.log('  ' + s));
        console.warn('[ACTION NEEDED] Share the above list — the selector needs updating!');
      } else {
        console.warn('[WARN] Truly nothing found. Run again WHILE a file is in the composer.');
      }
    }
  }

  // ── E: Root cause verdict ─────────────────────────────────────────
  hr();
  console.log('E: ROOT CAUSE VERDICT');
  hr();
  if (!firstAncestorWithChips) {
    console.error('[ROOT CAUSE] SELECTOR MISMATCH — the chip elements have different');
    console.error('             tag/class names than what TokenWise expects.');
    console.error('             Fix: Update fileAttachmentSelector in dom-monitor.ts');
    console.error('             with the element names from the class scan above.');
  } else if (composerRoot === firstAncestorWithChips.el) {
    console.log('[OK] Composer boundary and chip scope agree — boundary is correctly set.');
    if (firstAncestorWithChips.lightChips.length + firstAncestorWithChips.shadowChips.length > 1) {
      console.error('[ROOT CAUSE] DEDUP FAILURE — boundary is right but chips are still overcounted.');
    }
  } else {
    const composerDepth = (() => {
      let d = 0, a = inputEl ? inputEl.parentElement : null;
      while (a && a !== composerRoot && a !== document.body) { a = a.parentElement; d++; }
      return d;
    })();
    console.error('[ROOT CAUSE] BOUNDARY TOO NARROW');
    console.error('  gemini.ts resolves to: ' + desc(composerRoot));
    console.error('  Chips are actually in: depth ' + firstAncestorWithChips.depth + ' ancestor (shallower)');
    console.error('  The chips live OUTSIDE the current composer boundary,');
    console.error('  so querySelectorAll inside that boundary finds 0 chips.');
    console.error('');
    console.error('  Fix: In findGeminiComposerContainer(), keep climbing past');
    console.error('  <rich-textarea> until you reach a wider ancestor that contains chips,');
    console.error('  OR use the depth-' + firstAncestorWithChips.depth + ' ancestor tag/class as the stop condition.');
    console.error('');
    const chipAncTag = firstAncestorWithChips.el.tagName.toLowerCase();
    const chipAncCls = (firstAncestorWithChips.el.className || '').toString().trim().slice(0, 80);
    console.log('  Correct boundary element: <' + chipAncTag + ' class="' + chipAncCls + '">');
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  DONE — copy ALL output above and share it.');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('');
})();
