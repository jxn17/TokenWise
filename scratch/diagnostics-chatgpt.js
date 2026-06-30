/**
 * TokenWise Attachment Diagnostics for ChatGPT (Discovery Mode)
 * Paste this into the chatgpt.com browser console while files are attached.
 * Run: tokenWiseDiagChatGPT()
 */
(function tokenWiseDiagChatGPT() {
  const log = (...a) => console.log('%c[TW-DIAG]', 'color:#a78bfa;font-weight:bold', ...a);
  const warn = (...a) => console.warn('%c[TW-DIAG]', 'color:#fb923c;font-weight:bold', ...a);
  const err = (...a) => console.error('%c[TW-DIAG]', 'color:#f87171;font-weight:bold', ...a);

  log('=== TokenWise Attachment Diagnostics for ChatGPT (Discovery Mode) ===');

  // Find the composer input first
  const inputEl = document.querySelector('#prompt-textarea, [id="prompt-textarea"], div[contenteditable="true"][id="prompt-textarea"]');
  if (!inputEl) {
    err('Could not find the composer input (#prompt-textarea).');
    return;
  }
  
  log('Found composer input. Searching for attachment containers nearby...');

  // Walk up a few levels to find the composer container
  let container = inputEl.parentElement;
  for (let i = 0; i < 5; i++) {
    if (container && container.tagName !== 'BODY') {
      container = container.parentElement;
    }
  }

  if (!container) {
    err('Could not find composer container.');
    return;
  }

  // Broad search for anything that might be an attachment
  // Look for elements with typical attachment classes, or buttons containing images, or divs with aria-labels containing extensions
  const candidates = Array.from(container.querySelectorAll('div, button, a, span, p')).filter(el => {
    const text = el.textContent?.trim() || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    const className = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    
    // Check if it has a file extension pattern in text, aria-label, or title
    const hasExt = /[\w\s-]+\.[a-zA-Z0-9]{2,4}\b/.test(text) || 
                   /[\w\s-]+\.[a-zA-Z0-9]{2,4}\b/.test(ariaLabel) || 
                   /[\w\s-]+\.[a-zA-Z0-9]{2,4}\b/.test(title);
    
    // Check for typical attachment class names
    const hasAttachmentClass = className.includes('file') || className.includes('attachment') || className.includes('upload') || className.includes('thumbnail');
    
    // Check for images that aren't user avatars
    const img = el.querySelector('img');
    const isLikelyAvatar = img && img.src.includes('profile');

    // Only consider leaf-ish nodes or specific containers to avoid spamming the console
    const isReasonableSize = el.children.length < 10;

    return (hasExt || hasAttachmentClass || (img && !isLikelyAvatar)) && isReasonableSize && text.length < 200;
  });

  // Deduplicate ancestors (keep only the most specific/innermost candidates)
  const prunedCandidates = candidates.filter(
    el => !candidates.some(other => other !== el && el.contains(other))
  );

  log(`Found ${prunedCandidates.length} potential attachment elements.`);

  prunedCandidates.forEach((el, i) => {
    console.group(`Candidate [${i}] - <${el.tagName.toLowerCase()}>`);
    log('Classes:', el.className);
    log('aria-label:', el.getAttribute('aria-label') || '(none)');
    log('title:', el.getAttribute('title') || '(none)');
    log('textContent:', el.textContent?.trim() || '(none)');
    log('has <img>:', !!el.querySelector('img'));
    
    // If there's an SVG, it might be a file icon (like PDF/Excel)
    const svg = el.querySelector('svg');
    if (svg) log('has <svg>:', true);
    
    // Print the raw HTML so we can see the new DOM structure
    log('Outer HTML:', el.outerHTML);
    console.groupEnd();
  });

  if (prunedCandidates.length > 0) {
    warn('Please share the output above so we can figure out the new ChatGPT selectors!');
  } else {
    err('Could not find any potential attachments. Are you sure a file is attached?');
  }

  log('=== Diagnostics complete ===');
})();
