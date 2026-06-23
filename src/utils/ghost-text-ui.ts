/**
 * TokenWise Ghost Text UI
 *
 * Grammarly-style overlay that shows a full prompt rewrite
 * below the composer input field as the user types.
 *
 * Behaviour:
 *  - Appears after a 600ms debounce once the input has ≥ 12 chars
 *  - Shows the rewritten prompt as "ghost text" with a token-savings badge
 *  - One-click "Apply" replaces the input text
 *  - One-click "✕" dismisses for the current typing session
 *  - Auto-hides when the input is cleared or focus leaves
 *  - Never uses innerHTML — all safe DOM construction
 */

import { rewritePrompt, type RewriteResult } from './prompt-rewriter';

// ── Types ─────────────────────────────────────────────────────────

export interface GhostTextCallbacks {
  /** Returns the current raw text in the input */
  getText: () => string;
  /** Returns the input element (for positioning) */
  getInputElement: () => Element | null;
  /** Replaces the input content with new text */
  setText: (element: Element, text: string) => void;
  /** Called after apply so the content script can re-count tokens */
  onApply: () => void;
}

export interface GhostTextController {
  /** Mount the ghost text container to the DOM */
  mount: () => void;
  /** Trigger a rewrite cycle (debounced internally) */
  onInput: (text: string) => void;
  /** Explicitly hide the overlay */
  hide: () => void;
  /** Fully remove from DOM */
  destroy: () => void;
}

// ── Constants ─────────────────────────────────────────────────────

const DEBOUNCE_MS = 600;
const MIN_TEXT_LENGTH = 12;
const CONTAINER_ID = 'tokenwise-ghost-text';

// ── Factory ───────────────────────────────────────────────────────

export function createGhostTextController(
  callbacks: GhostTextCallbacks
): GhostTextController {
  let container: HTMLElement | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let dismissedForSession = false;
  let lastRewrite: RewriteResult | null = null;

  // ── DOM construction ─────────────────────────────────────────────

  function mount(): void {
    if (container) return;
    if (document.getElementById(CONTAINER_ID)) return;

    container = document.createElement('div');
    container.id = CONTAINER_ID;
    container.setAttribute('data-tokenwise', 'true');

    applyContainerStyles(container);
    document.body.appendChild(container);
  }

  function applyContainerStyles(el: HTMLElement): void {
    Object.assign(el.style, {
      position: 'fixed',
      zIndex: '2147483645',
      maxWidth: '640px',
      width: '92%',
      display: 'none',
      fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize: '13px',
      lineHeight: '1.5',
      // Animated entrance
      transition: 'opacity 0.18s ease, transform 0.18s ease',
      opacity: '0',
      transform: 'translateY(4px)',
    });
  }

  // ── Positioning ──────────────────────────────────────────────────

  function repositionNearInput(): void {
    if (!container) return;
    const inputEl = callbacks.getInputElement();
    if (!inputEl) return;

    const rect = inputEl.getBoundingClientRect();
    const containerHeight = container.offsetHeight || 80;
    const gap = 10;
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;

    // Prefer above the input; fall back to below if not enough room
    if (spaceAbove > containerHeight + gap + 20) {
      container.style.bottom = `${window.innerHeight - rect.top + gap}px`;
      container.style.top = 'auto';
    } else {
      container.style.top = `${rect.bottom + gap}px`;
      container.style.bottom = 'auto';
    }

    // Horizontal: align with left edge of input, but clamp to viewport
    const desiredLeft = rect.left;
    const maxLeft = window.innerWidth - (container.offsetWidth || 400) - 12;
    container.style.left = `${Math.max(12, Math.min(desiredLeft, maxLeft))}px`;
  }

  // ── Render ───────────────────────────────────────────────────────

  function render(result: RewriteResult): void {
    if (!container) return;
    lastRewrite = result;

    // Clear existing content
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Outer card
    Object.assign(container.style, {
      background: 'linear-gradient(135deg, #12121f 0%, #1e1e35 100%)',
      borderRadius: '12px',
      border: '1px solid rgba(99,102,241,0.25)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
      padding: '0',
      backdropFilter: 'blur(24px)',
      overflow: 'hidden',
    });

    // ── Header bar ───────────────────────────────────────────────
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 14px',
      background: 'rgba(99,102,241,0.12)',
      borderBottom: '1px solid rgba(99,102,241,0.15)',
    });

    const headerLeft = document.createElement('div');
    Object.assign(headerLeft.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });

    const icon = document.createElement('span');
    icon.textContent = '✦';
    icon.style.color = '#818cf8';
    icon.style.fontSize = '12px';
    headerLeft.appendChild(icon);

    const label = document.createElement('span');
    label.textContent = 'Suggested rewrite';
    Object.assign(label.style, {
      fontSize: '11px',
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: '#a0a0c0',
    });
    headerLeft.appendChild(label);

    const badge = document.createElement('span');
    badge.textContent = result.changeLabel;
    Object.assign(badge.style, {
      fontSize: '10px',
      fontWeight: '600',
      padding: '2px 7px',
      borderRadius: '20px',
      background: 'rgba(74,222,128,0.15)',
      border: '1px solid rgba(74,222,128,0.3)',
      color: '#4ade80',
    });
    headerLeft.appendChild(badge);
    header.appendChild(headerLeft);

    // Dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '✕';
    Object.assign(dismissBtn.style, {
      background: 'none',
      border: 'none',
      color: '#555',
      fontSize: '14px',
      cursor: 'pointer',
      padding: '2px 4px',
      lineHeight: '1',
      borderRadius: '4px',
      transition: 'color 0.15s',
    });
    dismissBtn.addEventListener('mouseenter', () => { dismissBtn.style.color = '#aaa'; });
    dismissBtn.addEventListener('mouseleave', () => { dismissBtn.style.color = '#555'; });
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissedForSession = true;
      hide();
    });
    header.appendChild(dismissBtn);
    container.appendChild(header);

    // ── Rewrite text ─────────────────────────────────────────────
    const textBox = document.createElement('div');
    Object.assign(textBox.style, {
      padding: '12px 14px',
      color: '#d0d0e8',
      fontSize: '13px',
      lineHeight: '1.6',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '160px',
      overflowY: 'auto',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    });

    // Render rewritten text as plain text (safe)
    textBox.textContent = result.rewritten;
    container.appendChild(textBox);

    // ── Action row ───────────────────────────────────────────────
    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 14px',
    });

    const hint = document.createElement('span');
    hint.textContent = `${result.rewrittenTokens} tokens vs ${result.originalTokens} original`;
    Object.assign(hint.style, {
      fontSize: '11px',
      color: '#666',
    });
    actions.appendChild(hint);

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply rewrite ↵';
    Object.assign(applyBtn.style, {
      background: 'linear-gradient(135deg, rgba(99,102,241,0.3) 0%, rgba(139,92,246,0.3) 100%)',
      border: '1px solid rgba(99,102,241,0.5)',
      color: '#c7d2fe',
      borderRadius: '8px',
      padding: '6px 14px',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
      letterSpacing: '0.2px',
    });
    applyBtn.addEventListener('mouseenter', () => {
      applyBtn.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.5) 0%, rgba(139,92,246,0.5) 100%)';
      applyBtn.style.borderColor = 'rgba(99,102,241,0.8)';
    });
    applyBtn.addEventListener('mouseleave', () => {
      applyBtn.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.3) 0%, rgba(139,92,246,0.3) 100%)';
      applyBtn.style.borderColor = 'rgba(99,102,241,0.5)';
    });
    applyBtn.addEventListener('mousedown', () => {
      applyBtn.style.transform = 'scale(0.97)';
    });
    applyBtn.addEventListener('mouseup', () => {
      applyBtn.style.transform = 'scale(1)';
    });

    applyBtn.addEventListener('click', () => {
      applyRewrite();
    });
    actions.appendChild(applyBtn);
    container.appendChild(actions);
  }

  // ── Show / Hide ──────────────────────────────────────────────────

  function show(): void {
    if (!container) return;
    container.style.display = 'block';
    repositionNearInput();
    // Trigger entrance animation
    requestAnimationFrame(() => {
      if (container) {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      }
    });
  }

  function hide(): void {
    if (!container) return;
    container.style.opacity = '0';
    container.style.transform = 'translateY(4px)';
    // Wait for animation then hide
    setTimeout(() => {
      if (container) container.style.display = 'none';
    }, 180);
  }

  // ── Apply ────────────────────────────────────────────────────────

  function applyRewrite(): void {
    if (!lastRewrite?.rewritten) return;
    const inputEl = callbacks.getInputElement();
    if (!inputEl) return;

    callbacks.setText(inputEl, lastRewrite.rewritten);
    hide();
    dismissedForSession = false; // Reset after apply so future rewrites can appear
    lastRewrite = null;
    callbacks.onApply();
  }

  // ── Input handler (debounced) ────────────────────────────────────

  function onInput(text: string): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }

    // Hide immediately if text is too short
    if (!text || text.trim().length < MIN_TEXT_LENGTH) {
      hide();
      dismissedForSession = false;
      return;
    }

    if (dismissedForSession) return;

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const result = rewritePrompt(text);

      if (!result.hasRewrite) {
        hide();
        return;
      }

      render(result);
      show();
    }, DEBOUNCE_MS);
  }

  // ── Destroy ──────────────────────────────────────────────────────

  function destroy(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    lastRewrite = null;
  }

  return { mount, onInput, hide, destroy };
}
