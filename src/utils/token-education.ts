/**
 * TokenWise Token Education Panel
 *
 * An educational overlay that surfaces per-platform token facts —
 * context windows, tokenizer details, pricing, and best-practice tips.
 * Uses safe DOM APIs only — no innerHTML with untrusted content.
 */

import type { SiteName } from './dom-monitor';

// ── Type Definitions ──────────────────────────────────────────────

export interface TokenFact {
  /** Emoji icon for the fact category. */
  icon: string;
  /** Short heading. */
  title: string;
  /** Detailed explanation. */
  body: string;
  /** Which platforms this fact applies to. Empty = all. */
  platforms: SiteName[];
  /** Visual category for grouping / color-coding. */
  category: 'context' | 'tokenizer' | 'pricing' | 'tip' | 'media';
}

export interface EducationPanelController {
  element: HTMLElement | null;
  create: () => void;
  show: (platform: SiteName) => void;
  hide: () => void;
  isVisible: () => boolean;
  destroy: () => void;
}

// ── Token Facts Database ──────────────────────────────────────────

const TOKEN_FACTS: TokenFact[] = [
  // ─── Context Window Facts ─────────────────────────────────────
  {
    icon: '📏',
    title: 'GPT-4o context window',
    body: 'GPT-4o supports 128K tokens (~96K words) of context. But remember — your prompt AND the response share that budget.',
    platforms: ['chatgpt'],
    category: 'context',
  },
  {
    icon: '📏',
    title: 'Claude context window',
    body: 'Claude 3.5 Sonnet & Opus support 200K tokens (~150K words) — the largest mainstream context window. Great for long documents.',
    platforms: ['claude'],
    category: 'context',
  },
  {
    icon: '📏',
    title: 'Gemini context window',
    body: 'Gemini 1.5 Pro supports up to 1M tokens — the largest context window available. Ideal for analyzing entire codebases.',
    platforms: ['gemini'],
    category: 'context',
  },
  {
    icon: '🔄',
    title: 'Context resets per message',
    body: 'Every message you send includes the FULL conversation history. A 50-message chat re-sends all 50 messages each time.',
    platforms: [],
    category: 'context',
  },

  // ─── Tokenizer Facts ──────────────────────────────────────────
  {
    icon: '🧮',
    title: 'GPT uses BPE tokenization',
    body: 'GPT-4o uses o200k_base — a 200K-vocabulary BPE tokenizer. Common words are 1 token; rare words may split into 3-5 tokens.',
    platforms: ['chatgpt'],
    category: 'tokenizer',
  },
  {
    icon: '🧮',
    title: 'Claude uses its own tokenizer',
    body: 'Claude uses a proprietary BPE tokenizer. On average, 1 token ≈ 3.5–4 characters for English text — similar to GPT.',
    platforms: ['claude'],
    category: 'tokenizer',
  },
  {
    icon: '🧮',
    title: 'Gemini uses SentencePiece',
    body: 'Gemini uses a SentencePiece tokenizer. It handles multilingual text especially well, often using fewer tokens for non-Latin scripts.',
    platforms: ['gemini'],
    category: 'tokenizer',
  },
  {
    icon: '✂️',
    title: 'Whitespace matters',
    body: 'Leading spaces, blank lines, and trailing whitespace all consume tokens. Trimming unnecessary whitespace can save 5-15% per message.',
    platforms: [],
    category: 'tokenizer',
  },
  {
    icon: '🔢',
    title: 'Numbers are expensive',
    body: 'Each digit is often a separate token. The number "1234567890" costs ~5-7 tokens. Summarize when possible: "~1.2 billion" instead of "1,234,567,890".',
    platforms: [],
    category: 'tokenizer',
  },

  // ─── Pricing Facts ────────────────────────────────────────────
  {
    icon: '💰',
    title: 'Input vs output pricing',
    body: 'Most models charge 2-4× more for output tokens than input. Asking for concise replies saves real money on API usage.',
    platforms: [],
    category: 'pricing',
  },
  {
    icon: '💰',
    title: 'GPT-4o pricing',
    body: 'GPT-4o costs ~$2.50/1M input tokens and ~$10/1M output tokens. A typical long chat can easily reach 50K tokens = ~$0.63.',
    platforms: ['chatgpt'],
    category: 'pricing',
  },
  {
    icon: '💰',
    title: 'Claude pricing',
    body: 'Claude 3.5 Sonnet costs ~$3/1M input tokens and ~$15/1M output tokens. Claude Opus is 5× more expensive — pick your model wisely.',
    platforms: ['claude'],
    category: 'pricing',
  },
  {
    icon: '💰',
    title: 'Gemini pricing',
    body: 'Gemini 1.5 Pro costs ~$1.25/1M input tokens for prompts under 128K. Beyond that, the rate doubles — keep context lean.',
    platforms: ['gemini'],
    category: 'pricing',
  },

  // ─── Best-Practice Tips ───────────────────────────────────────
  {
    icon: '💡',
    title: 'Start fresh regularly',
    body: 'Starting a new chat every 15-20 messages prevents context bloat. Use TokenWise\'s "Copy context" to carry over key info.',
    platforms: [],
    category: 'tip',
  },
  {
    icon: '💡',
    title: 'System prompts are repeated',
    body: 'Custom instructions / system prompts are included with EVERY message. A 500-token system prompt costs 500 tokens × message count.',
    platforms: [],
    category: 'tip',
  },
  {
    icon: '💡',
    title: 'Be direct, not polite',
    body: '"Please help me understand how to…" costs ~12 tokens. "Explain how to…" costs ~4. LLMs don\'t need pleasantries.',
    platforms: [],
    category: 'tip',
  },
  {
    icon: '💡',
    title: 'Use markdown sparingly',
    body: 'Asking for tables, bullet lists, or formatted code can triple the response length (and token cost). Only request formatting when needed.',
    platforms: [],
    category: 'tip',
  },
  {
    icon: '🎯',
    title: 'Claude Projects save tokens',
    body: 'Claude Projects let you attach reference docs once. They\'re included in context but don\'t count against your message tokens.',
    platforms: ['claude'],
    category: 'tip',
  },
  {
    icon: '🎯',
    title: 'Use Gemini\'s grounding',
    body: 'Gemini can ground responses in Google Search results, reducing the need to paste large reference texts into your prompt.',
    platforms: ['gemini'],
    category: 'tip',
  },

  // ─── Media / Attachment Facts ─────────────────────────────────
  {
    icon: '🖼️',
    title: 'Images cost 85–1,500+ tokens',
    body: 'GPT-4o charges 85 tokens for low-detail images, but high-detail images are tiled at 170 tokens per 512×512 tile. Resize before uploading.',
    platforms: ['chatgpt'],
    category: 'media',
  },
  {
    icon: '🖼️',
    title: 'Claude image tokens',
    body: 'Claude charges ~1,600 tokens per megapixel. A 1920×1080 screenshot costs ~3,300 tokens. Crop to the relevant region.',
    platforms: ['claude'],
    category: 'media',
  },
  {
    icon: '🎥',
    title: 'Gemini handles video natively',
    body: 'Gemini can process video directly at ~260 tokens per second of footage. A 1-minute video costs ~15,600 tokens.',
    platforms: ['gemini'],
    category: 'media',
  },
  {
    icon: '📄',
    title: 'PDFs are text-extracted',
    body: 'All platforms extract text from PDFs, which can be surprisingly long. A 20-page PDF can easily cost 10,000–20,000 tokens.',
    platforms: [],
    category: 'media',
  },
];

// ── Category Styling ──────────────────────────────────────────────

const CATEGORY_COLORS: Record<TokenFact['category'], { bg: string; border: string; accent: string }> = {
  context:   { bg: 'rgba(99,102,241,0.10)',  border: 'rgba(99,102,241,0.25)',  accent: '#a5b4fc' },
  tokenizer: { bg: 'rgba(34,211,238,0.10)',  border: 'rgba(34,211,238,0.25)',  accent: '#67e8f9' },
  pricing:   { bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.25)',  accent: '#fde68a' },
  tip:       { bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.25)',  accent: '#86efac' },
  media:     { bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.25)', accent: '#f9a8d4' },
};

const CATEGORY_LABELS: Record<TokenFact['category'], string> = {
  context: 'Context Window',
  tokenizer: 'Tokenization',
  pricing: 'Pricing',
  tip: 'Best Practice',
  media: 'Media & Files',
};

// ── Public API ────────────────────────────────────────────────────

/**
 * Get facts filtered for a specific platform.
 * Returns platform-specific facts + universal facts (empty platforms array).
 */
export function getFactsForPlatform(platform: SiteName): TokenFact[] {
  return TOKEN_FACTS.filter(
    (f) => f.platforms.length === 0 || f.platforms.includes(platform)
  );
}

/**
 * Get a random fact for a specific platform.
 */
export function getRandomFact(platform: SiteName): TokenFact {
  const facts = getFactsForPlatform(platform);
  return facts[Math.floor(Math.random() * facts.length)];
}

/**
 * Create the education panel controller.
 * Follows the same controller pattern as suggestion-panel.ts.
 */
export function createEducationPanelController(): EducationPanelController {
  let panel: HTMLElement | null = null;
  let currentPlatform: SiteName = 'chatgpt';
  let currentFactIndex = 0;
  let filteredFacts: TokenFact[] = [];
  let activeFilter: TokenFact['category'] | 'all' = 'all';
  let autoRotateTimer: ReturnType<typeof setInterval> | null = null;

  function create(): void {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'tokenwise-education';
    panel.setAttribute('data-tokenwise', 'true');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '20px',
      bottom: '180px',
      left: 'auto',
      transform: 'none',
      zIndex: '2147483645',
      background: 'linear-gradient(135deg, #13131f 0%, #1a1a30 100%)',
      borderRadius: '14px',
      border: '1px solid rgba(255,255,255,0.07)',
      padding: '0',
      color: '#e0e0e0',
      fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
      width: '320px',
      maxHeight: '460px',
      overflowY: 'auto',
      display: 'none',
      backdropFilter: 'blur(24px)',
    });
    document.body.appendChild(panel);
  }

  function hide(): void {
    if (panel) panel.style.display = 'none';
    stopAutoRotate();
  }

  function isVisible(): boolean {
    return panel?.style.display === 'block';
  }

  function show(platform: SiteName): void {
    if (!panel) create();
    currentPlatform = platform;
    activeFilter = 'all';
    applyFilter();
    currentFactIndex = 0;
    render();
    panel!.style.display = 'block';
    startAutoRotate();
  }

  function destroy(): void {
    stopAutoRotate();
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  function applyFilter(): void {
    const allFacts = getFactsForPlatform(currentPlatform);
    if (activeFilter === 'all') {
      filteredFacts = allFacts;
    } else {
      filteredFacts = allFacts.filter((f) => f.category === activeFilter);
    }
    // Clamp index
    if (currentFactIndex >= filteredFacts.length) {
      currentFactIndex = 0;
    }
  }

  function startAutoRotate(): void {
    stopAutoRotate();
    autoRotateTimer = setInterval(() => {
      if (filteredFacts.length > 1) {
        currentFactIndex = (currentFactIndex + 1) % filteredFacts.length;
        render();
      }
    }, 8000);
  }

  function stopAutoRotate(): void {
    if (autoRotateTimer !== null) {
      clearInterval(autoRotateTimer);
      autoRotateTimer = null;
    }
  }

  function render(): void {
    if (!panel) return;

    // Clear existing content
    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }

    // ── Header ──────────────────────────────────────────────────
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '12px 14px 8px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    });

    const titleEl = document.createElement('div');
    Object.assign(titleEl.style, {
      fontWeight: '700',
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.6px',
      color: '#a0a0b8',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    });
    titleEl.textContent = '📚 Token Facts';
    header.appendChild(titleEl);

    const platformBadge = document.createElement('span');
    const platformLabels: Record<SiteName, string> = {
      chatgpt: 'ChatGPT',
      claude: 'Claude',
      gemini: 'Gemini',
    };
    platformBadge.textContent = platformLabels[currentPlatform];
    Object.assign(platformBadge.style, {
      fontSize: '9px',
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      padding: '2px 8px',
      borderRadius: '10px',
      background: 'rgba(99,102,241,0.15)',
      border: '1px solid rgba(99,102,241,0.3)',
      color: '#a5b4fc',
    });

    const headerRight = document.createElement('div');
    Object.assign(headerRight.style, { display: 'flex', alignItems: 'center', gap: '8px' });
    headerRight.appendChild(platformBadge);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      color: '#888',
      cursor: 'pointer',
      fontSize: '12px',
      padding: '2px 4px',
      lineHeight: '1',
    });
    closeBtn.addEventListener('click', hide);
    headerRight.appendChild(closeBtn);
    header.appendChild(headerRight);
    panel.appendChild(header);

    // ── Category Filter Chips ───────────────────────────────────
    const filterRow = document.createElement('div');
    Object.assign(filterRow.style, {
      padding: '8px 14px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '5px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    });

    const categories: Array<TokenFact['category'] | 'all'> = ['all', 'context', 'tokenizer', 'pricing', 'tip', 'media'];
    for (const cat of categories) {
      const chip = document.createElement('button');
      const label = cat === 'all' ? 'All' : CATEGORY_LABELS[cat];
      chip.textContent = label;
      const isActive = activeFilter === cat;
      Object.assign(chip.style, {
        background: isActive ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.04)',
        border: isActive ? '1px solid rgba(99,102,241,0.4)' : '1px solid rgba(255,255,255,0.06)',
        color: isActive ? '#c7d2fe' : '#7070a0',
        borderRadius: '10px',
        padding: '3px 8px',
        fontSize: '9px',
        fontWeight: '600',
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
        transition: 'all 0.2s ease',
      });
      chip.addEventListener('click', () => {
        activeFilter = cat;
        applyFilter();
        currentFactIndex = 0;
        render();
        startAutoRotate();
      });
      filterRow.appendChild(chip);
    }
    panel.appendChild(filterRow);

    // ── Fact Card ────────────────────────────────────────────────
    if (filteredFacts.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No facts for this filter.';
      Object.assign(empty.style, {
        padding: '20px 14px',
        color: '#5050a0',
        textAlign: 'center',
        fontStyle: 'italic',
        fontSize: '11px',
      });
      panel.appendChild(empty);
    } else {
      const fact = filteredFacts[currentFactIndex];
      const colors = CATEGORY_COLORS[fact.category];

      const card = document.createElement('div');
      Object.assign(card.style, {
        margin: '10px 14px',
        padding: '12px 14px',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: '10px',
        transition: 'opacity 0.3s ease',
      });

      const cardHeader = document.createElement('div');
      Object.assign(cardHeader.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      });

      const iconEl = document.createElement('span');
      iconEl.textContent = fact.icon;
      iconEl.style.fontSize = '16px';
      cardHeader.appendChild(iconEl);

      const factTitle = document.createElement('span');
      factTitle.textContent = fact.title;
      Object.assign(factTitle.style, {
        fontWeight: '700',
        fontSize: '12px',
        color: colors.accent,
      });
      cardHeader.appendChild(factTitle);
      card.appendChild(cardHeader);

      const bodyEl = document.createElement('div');
      bodyEl.textContent = fact.body;
      Object.assign(bodyEl.style, {
        color: '#c0c0d8',
        fontSize: '11px',
        lineHeight: '1.6',
      });
      card.appendChild(bodyEl);

      // Category badge
      const catBadge = document.createElement('div');
      catBadge.textContent = CATEGORY_LABELS[fact.category];
      Object.assign(catBadge.style, {
        marginTop: '8px',
        display: 'inline-block',
        fontSize: '8px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        padding: '2px 6px',
        borderRadius: '6px',
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.accent,
      });
      card.appendChild(catBadge);

      // Platform tags (if not universal)
      if (fact.platforms.length > 0) {
        const tagRow = document.createElement('span');
        Object.assign(tagRow.style, { marginLeft: '6px' });
        for (const p of fact.platforms) {
          const tag = document.createElement('span');
          tag.textContent = platformLabels[p];
          Object.assign(tag.style, {
            fontSize: '8px',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.3px',
            padding: '2px 5px',
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#8080a0',
            marginLeft: '3px',
          });
          tagRow.appendChild(tag);
        }
        card.appendChild(tagRow);
      }

      panel.appendChild(card);
    }

    // ── Navigation Footer ───────────────────────────────────────
    const footer = document.createElement('div');
    Object.assign(footer.style, {
      padding: '8px 14px 10px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    });

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Prev';
    styleNavButton(prevBtn);
    prevBtn.addEventListener('click', () => {
      if (filteredFacts.length <= 1) return;
      currentFactIndex = (currentFactIndex - 1 + filteredFacts.length) % filteredFacts.length;
      render();
      startAutoRotate();
    });
    footer.appendChild(prevBtn);

    const counter = document.createElement('span');
    counter.textContent = filteredFacts.length > 0
      ? `${currentFactIndex + 1} / ${filteredFacts.length}`
      : '—';
    Object.assign(counter.style, {
      color: '#5050a0',
      fontSize: '10px',
      fontWeight: '600',
      letterSpacing: '0.5px',
    });
    footer.appendChild(counter);

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    styleNavButton(nextBtn);
    nextBtn.addEventListener('click', () => {
      if (filteredFacts.length <= 1) return;
      currentFactIndex = (currentFactIndex + 1) % filteredFacts.length;
      render();
      startAutoRotate();
    });
    footer.appendChild(nextBtn);

    panel.appendChild(footer);
  }

  return {
    get element() {
      return panel;
    },
    create,
    show,
    hide,
    isVisible,
    destroy,
  };
}

// ── Internal Helpers ──────────────────────────────────────────────

function styleNavButton(btn: HTMLButtonElement): void {
  Object.assign(btn.style, {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: '#8080b0',
    borderRadius: '6px',
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: '600',
    transition: 'all 0.2s ease',
  });
}
