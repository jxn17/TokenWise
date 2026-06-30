/**
 * Shared suggestion panel UI for all content scripts.
 * Uses safe DOM APIs only — no innerHTML with untrusted content.
 */

import {
  analyzePrompt,
  applySuggestion,
  applyAllSuggestions,
  getTotalSavings,
  type Suggestion,
} from './prompt-analyzer';
import { positionPanelAboveElement } from './dom-monitor';
import type { FileEstimate } from './media-estimator';
import {
  getCompressionResources,
  openCompressionResource,
  type CompressionResource,
} from './compression-resources';

export interface SuggestionPanelCallbacks {
  getInputElement: () => Element | null;
  getInputText: () => string;
  setInputText: (element: Element, text: string) => void;
  onAfterApply: () => void;
  trackSavings: (tokens: number) => void;
}

export interface SuggestionPanelController {
  element: HTMLElement | null;
  create: () => void;
  hide: () => void;
  update: (text: string, attachments: FileEstimate[]) => void;
  /** Reset dismissed state and force the panel to show immediately. */
  forceShow: (text: string, attachments: FileEstimate[]) => void;
  isVisible: () => boolean;
}

export function createSuggestionPanelController(
  callbacks: SuggestionPanelCallbacks,
  enabled: () => boolean
): SuggestionPanelController {
  let panel: HTMLElement | null = null;
  let userDismissed = false;
  let dismissedAtAttachmentCount = -1;
  let dismissedAtTextLength = -1;

  function create(): void {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'tokenwise-suggestions';
    panel.setAttribute('data-tokenwise', 'true');
    Object.assign(panel.style, {
      position: 'fixed',
      right: '20px',
      bottom: '280px',    // above the token widget (which sits at bottom: 80px)
      left: 'auto',
      transform: 'none',
      zIndex: '2147483646',
      background: 'linear-gradient(135deg, #13131f 0%, #1e1e35 100%)',
      borderRadius: '14px',
      border: '1px solid rgba(255,255,255,0.07)',
      padding: '0',
      color: '#e0e0e0',
      fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize: '12px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
      width: '310px',
      maxHeight: '420px',
      overflowY: 'auto',
      display: 'none',
      backdropFilter: 'blur(24px)',
    });
    document.body.appendChild(panel);
  }

  function hide(): void {
    if (panel) panel.style.display = 'none';
    userDismissed = true;
  }

  function isVisible(): boolean {
    return panel?.style.display === 'block';
  }

  function update(text: string, attachments: FileEstimate[]): void {
    if (!panel || !enabled()) {
      hide();
      return;
    }

    const promptSuggestions = analyzePrompt(text);
    const hasAttachments = attachments.length > 0;

    // If user explicitly dismissed, only re-show when content meaningfully changes:
    // either a new attachment was added, or text length changed by >10 chars.
    if (userDismissed) {
      const attachmentsChanged = attachments.length !== dismissedAtAttachmentCount;
      const textChangedSignificantly = Math.abs(text.length - dismissedAtTextLength) > 10;
      if (!attachmentsChanged && !textChangedSignificantly) {
        return;
      }
      userDismissed = false;
    }

    // Track current state for next dismissed check
    dismissedAtAttachmentCount = attachments.length;
    dismissedAtTextLength = text.length;

    if (promptSuggestions.length === 0 && !hasAttachments) {
      hide();
      return;
    }

    while (panel.firstChild) {
      panel.removeChild(panel.firstChild);
    }

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
      gap: '8px',
    });

    const headerLeft = document.createElement('span');
    const totalSavings = getTotalSavings(promptSuggestions);
    headerLeft.textContent = totalSavings > 0
      ? `Save ~${totalSavings} tokens`
      : 'Optimization tips';
    header.appendChild(headerLeft);

    const headerActions = document.createElement('div');
    Object.assign(headerActions.style, { display: 'flex', gap: '6px', alignItems: 'center' });

    const applicable = promptSuggestions.filter((s) => s.originalText);
    if (applicable.length > 1) {
      const applyAllBtn = document.createElement('button');
      applyAllBtn.textContent = 'Apply all';
      styleSmallButton(applyAllBtn, true);
      applyAllBtn.addEventListener('click', () => {
        try {
          const inputEl = callbacks.getInputElement();
          if (!inputEl) return;
          const current = callbacks.getInputText();
          const newText = applyAllSuggestions(current, promptSuggestions);
          callbacks.setInputText(inputEl, newText);
          callbacks.trackSavings(getTotalSavings(applicable));
          callbacks.onAfterApply();
        } catch {
          // Fail silently
        }
      });
      headerActions.appendChild(applyAllBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Dismiss';
    styleSmallButton(closeBtn, false);
    closeBtn.addEventListener('click', () => {
      dismissedAtAttachmentCount = attachments.length;
      dismissedAtTextLength = text.length;
      hide();
    });
    headerActions.appendChild(closeBtn);

    header.appendChild(headerActions);
    panel.appendChild(header);

    if (hasAttachments) {
      renderAttachmentSection(panel, attachments);
    }

    for (const suggestion of promptSuggestions.slice(0, 4)) {
      panel.appendChild(createSuggestionRow(suggestion, callbacks));
    }

    panel.style.display = 'block';
    // Panel is fixed to right:20px bottom:280px — no dynamic repositioning needed.
  }

  function forceShow(text: string, attachments: FileEstimate[]): void {
    userDismissed = false;
    dismissedAtAttachmentCount = -1;
    dismissedAtTextLength = -1;
    update(text, attachments);
  }

  return {
    get element() {
      return panel;
    },
    create,
    hide,
    update,
    forceShow,
    isVisible,
  };
}

function renderAttachmentSection(panel: HTMLElement, attachments: FileEstimate[]): void {
  const section = document.createElement('div');
  Object.assign(section.style, {
    padding: '10px 14px 4px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  });

  const title = document.createElement('div');
  title.textContent = '📎 Attachments';
  Object.assign(title.style, {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#6060a0',
    marginBottom: '8px',
    fontWeight: '700',
  });
  section.appendChild(title);

  for (const file of attachments.slice(0, 6)) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      marginBottom: '10px',
      padding: '8px 10px',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.06)',
    });

    // File name + token count
    const nameRow = document.createElement('div');
    Object.assign(nameRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' });

    const nameEl = document.createElement('span');
    const icon = getCategoryIcon(file.category);
    nameEl.textContent = `${icon} ${file.fileName}`;
    Object.assign(nameEl.style, { color: '#d0d0e8', fontSize: '11px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' });

    const tokenEl = document.createElement('span');
    if (file.estimatedTokens === -1) {
      if (file.category === 'audio') {
        tokenEl.textContent = '⚠️ Not supported';
      } else if (file.category === 'video') {
        tokenEl.textContent = '⚠️ Varies';
      } else {
        tokenEl.textContent = '⚠️ Caution';
      }
      tokenEl.style.color = '#fb923c'; // orange — warning, not error
    } else {
      tokenEl.textContent = `~${file.estimatedTokens.toLocaleString()} tokens`;
      tokenEl.style.color = file.estimatedTokens > 1000 ? '#f87171' : file.estimatedTokens > 300 ? '#facc15' : '#4ade80';
    }
    Object.assign(tokenEl.style, { fontSize: '10px', fontWeight: '700', whiteSpace: 'nowrap' });

    nameRow.appendChild(nameEl);
    nameRow.appendChild(tokenEl);
    row.appendChild(nameRow);

    // Optimization tips
    for (const tip of file.optimizationTips.slice(0, 2)) {
      const tipEl = document.createElement('div');
      tipEl.textContent = `• ${tip}`;
      Object.assign(tipEl.style, { color: '#8080b0', fontSize: '10px', lineHeight: '1.5', marginBottom: '2px' });
      row.appendChild(tipEl);
    }

    // Compression / handling tools
    {
      const resources = getCompressionResources(file.category)
        .filter(r => !r.name.includes('7-Zip') || file.category === 'archive')
        .slice(0, 2);
      if (resources.length > 0) {
        const compressRow = document.createElement('div');
        Object.assign(compressRow.style, { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px', alignItems: 'center' });
        const label = document.createElement('span');
        label.textContent = file.category === 'image' ? 'Compress:' : 'Tools:';
        Object.assign(label.style, { color: '#5050a0', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.4px' });
        compressRow.appendChild(label);
        for (const resource of resources) {
          compressRow.appendChild(createResourceLink(resource));
        }
        row.appendChild(compressRow);
      }
    }

    section.appendChild(row);
  }

  panel.appendChild(section);
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    image: '🖼️', pdf: '📑', text: '📄', spreadsheet: '📊',
    document: '📝', presentation: '📽️', archive: '🗜️', video: '🎥', audio: '🎵',
  };
  return icons[category] ?? '📎';
}

function createResourceLink(resource: CompressionResource): HTMLElement {
  const isAdviceOnly = !resource.url;

  const el = document.createElement(isAdviceOnly ? 'span' : 'button');
  el.textContent = resource.name;
  el.title = resource.description;

  if (isAdviceOnly) {
    Object.assign(el.style, {
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.08)',
      color: '#8888b0',
      borderRadius: '4px',
      padding: '2px 6px',
      fontSize: '10px',
      cursor: 'default',
      fontStyle: 'italic',
    });
  } else {
    Object.assign(el.style, {
      background: 'rgba(99,102,241,0.15)',
      border: '1px solid rgba(99,102,241,0.3)',
      color: '#a5b4fc',
      borderRadius: '4px',
      padding: '2px 6px',
      fontSize: '10px',
      cursor: 'pointer',
    });
    el.addEventListener('click', () => openCompressionResource(resource.url));
  }

  return el;
}

function createSuggestionRow(
  suggestion: Suggestion,
  callbacks: SuggestionPanelCallbacks
): HTMLElement {
  const item = document.createElement('div');
  Object.assign(item.style, {
    padding: '8px 14px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
  });

  const textDiv = document.createElement('div');
  textDiv.style.flex = '1';

  const msg = document.createElement('div');
  msg.textContent = suggestion.message;
  msg.style.color = '#c0c0d8';
  msg.style.marginBottom = '2px';
  textDiv.appendChild(msg);

  if (suggestion.originalText && suggestion.suggestedText !== undefined) {
    const preview = document.createElement('div');
    const from = suggestion.originalText.trim().slice(0, 40);
    const to = suggestion.suggestedText.trim() || '(remove)';
    preview.textContent = `"${from}" → "${to}"`;
    preview.style.color = '#818cf8';
    preview.style.fontSize = '10px';
    preview.style.marginBottom = '2px';
    textDiv.appendChild(preview);
  }

  const savings = document.createElement('div');
  savings.textContent = `Save ~${suggestion.tokenSavings} tokens`;
  savings.style.color = '#4ade80';
  savings.style.fontSize = '11px';
  textDiv.appendChild(savings);
  item.appendChild(textDiv);

  if (suggestion.originalText) {
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    styleSmallButton(applyBtn, true);
    applyBtn.addEventListener('click', () => {
      try {
        const inputEl = callbacks.getInputElement();
        if (!inputEl) return;
        const currentText = callbacks.getInputText();
        const newText = applySuggestion(currentText, suggestion);
        callbacks.setInputText(inputEl, newText);
        callbacks.trackSavings(suggestion.tokenSavings);
        callbacks.onAfterApply();
      } catch {
        // Fail silently
      }
    });
    item.appendChild(applyBtn);
  }

  return item;
}

function styleSmallButton(btn: HTMLButtonElement, primary: boolean): void {
  Object.assign(btn.style, {
    background: primary ? 'rgba(99,102,241,0.2)' : 'none',
    border: primary ? '1px solid rgba(99,102,241,0.4)' : 'none',
    color: primary ? '#a5b4fc' : '#888',
    borderRadius: '6px',
    padding: primary ? '4px 8px' : '2px 4px',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: primary ? '500' : '400',
    whiteSpace: 'nowrap',
  });
}
