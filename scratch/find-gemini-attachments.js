(function () {
  console.log("=========================================");
  console.log(" TokenWise: Gemini Attachment Deep Diagnostic");
  console.log("=========================================");

  // ── Shadow DOM Traversal ───────────────────────────────────────
  function findAllInShadowRoots(selector, root = document.body, depth = 0) {
    const results = [];
    if (depth > 10) return results;
    try {
      if (root.shadowRoot) {
        selector.split(',').forEach(sel => {
          try { root.shadowRoot.querySelectorAll(sel.trim()).forEach(el => results.push(el)); } catch(e) {}
        });
        root.shadowRoot.querySelectorAll('*').forEach(child => results.push(...findAllInShadowRoots(selector, child, depth + 1)));
      }
      root.querySelectorAll('*').forEach(child => {
        if (child.shadowRoot) results.push(...findAllInShadowRoots(selector, child, depth + 1));
      });
    } catch (e) {}
    return results;
  }

  function findAllEverywhere(selector) {
    let light = [];
    try { light = Array.from(document.querySelectorAll(selector)); } catch(e) {}
    const shadow = findAllInShadowRoots(selector);
    return Array.from(new Set([...light, ...shadow]));
  }

  function elInfo(el) {
    const cls = (el.className || '').toString().replace(/\s+/g, '.');
    const tag = el.tagName.toLowerCase();
    const aria = el.getAttribute('aria-label') || '';
    const img = el.querySelector('img');
    const src = img ? (img.src || img.getAttribute('src') || '').slice(0, 60) : 'none';
    const sz = `${el.offsetWidth}x${el.offsetHeight}`;
    const text = el.textContent?.trim().slice(0, 40).replace(/\n/g, ' ') || '';
    const inShadow = !document.contains(el);
    return { tag, cls, aria, src, sz, text, inShadow };
  }

  // ── SECTION A: Current TokenWise Selectors ─────────────────────
  console.log("\n═══ A: CURRENT TOKENWISE SELECTORS ═══");
  const twSelectors = 'uploader-file-preview, gem-media-attachment, .file-preview-chip, .file-preview-container, .gem-attachment-tile';
  const twMatches = findAllEverywhere(twSelectors);
  console.log(`Found ${twMatches.length} elements with: "${twSelectors}"`);
  twMatches.forEach((el, i) => {
    const info = elInfo(el);
    console.log(`[${i}] <${info.tag} class="${info.cls}"> size:${info.sz} shadow:${info.inShadow} aria:"${info.aria}" src:"${info.src}" text:"${info.text}"`);
  });

  // ── SECTION B: Scan ALL elements with a visible size ──────────
  console.log("\n═══ B: ALL VISIBLE ATTACHMENT-LIKE ELEMENTS ═══");
  // Collect all elements that look like they might be an attachment
  const candidateSelectors = [
    'uploader-file-preview',
    'gem-media-attachment',
    '[class*="file-preview"]',
    '[class*="attachment"]',
    '[class*="upload"]',
    '[class*="file-chip"]',
    '[class*="media-chip"]',
    '[class*="image-chip"]',
    '[class*="gem-attach"]',
    '[aria-label*="attachment"]',
    '[aria-label*="close attachment"]',
    '[aria-label*="Remove"]',
    'rich-textarea img',
    '.input-area img',
    '[class*="input"] img',
  ].join(', ');

  const allCandidates = findAllEverywhere(candidateSelectors);
  const visible = allCandidates.filter(el => el.offsetWidth > 10 && el.offsetHeight > 10);
  console.log(`Found ${visible.length} visible candidates.`);
  visible.slice(0, 20).forEach((el, i) => {
    const info = elInfo(el);
    console.log(`[${i}] <${info.tag} class="${info.cls}"> size:${info.sz} shadow:${info.inShadow} aria:"${info.aria}" text:"${info.text}"`);
  });

  // ── SECTION C: Inspect All Imgs in Input Area ─────────────────
  console.log("\n═══ C: ALL <img> NEAR INPUT AREA ═══");
  const inputArea = findAllEverywhere('rich-textarea, .input-area, [class*="composer"], [class*="input-container"], .query-box, .input-container');
  console.log(`Found ${inputArea.length} input container(s).`);
  inputArea.forEach((container, ci) => {
    const imgs = Array.from(container.querySelectorAll('img'));
    if (imgs.length > 0) {
      console.log(`[Container ${ci}] <${container.tagName.toLowerCase()} class="${(container.className||'').toString().slice(0, 50)}"> has ${imgs.length} img(s):`);
      imgs.forEach((img, ii) => {
        console.log(`  [img ${ii}] ${img.offsetWidth}x${img.offsetHeight} src: "${(img.src||'').slice(0, 80)}"`);
      });
    }
  });

  // ── SECTION D: Shadow root inventory near input ───────────────
  console.log("\n═══ D: SHADOW ROOT INVENTORY ═══");
  let shadowCount = 0;
  function collectShadowHosts(root = document.body, depth = 0, hosts = []) {
    if (depth > 6) return hosts;
    try {
      if (root.shadowRoot) {
        shadowCount++;
        hosts.push({ host: root.tagName.toLowerCase(), cls: (root.className||'').toString().slice(0, 50), depth });
        root.shadowRoot.querySelectorAll('*').forEach(child => collectShadowHosts(child, depth + 1, hosts));
      }
      root.querySelectorAll('*').forEach(child => {
        if (child.shadowRoot) collectShadowHosts(child, depth + 1, hosts);
      });
    } catch(e) {}
    return hosts;
  }
  const shadowHosts = collectShadowHosts();
  console.log(`Total shadow roots: ${shadowHosts.length}`);
  shadowHosts.forEach(h => {
    console.log(`  [depth ${h.depth}] <${h.host} class="${h.cls}">`);
  });

  // ── SECTION E: Snapshot of attachment-like classnames ─────────
  console.log("\n═══ E: ALL CLASS NAMES CONTAINING 'attach' OR 'upload' OR 'preview' ═══");
  const everything = findAllEverywhere('*');
  const classHits = new Set();
  everything.forEach(el => {
    const cls = (el.className || '').toString();
    if (/attach|upload|preview|file-chip|media-chip|img-chip|gem-attach/i.test(cls)) {
      classHits.add(`<${el.tagName.toLowerCase()} class="${cls.trim().replace(/\s+/g, ' ')}">`);
    }
    if (/attach|upload|preview|file-chip|media-chip|img-chip/i.test(el.tagName)) {
      classHits.add(`TAG: <${el.tagName.toLowerCase()}>`);
    }
  });
  console.log(`Found ${classHits.size} unique element patterns:`);
  [...classHits].slice(0, 25).forEach(s => console.log(' ', s));

  console.log("\n=========================================");
  console.log(" DONE — paste the output above here!");
  console.log("=========================================");
})();
