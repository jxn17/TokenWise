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
  isVisible: () => boolean;
}

export function createSuggestionPanelController(
  callbacks: SuggestionPanelCallbacks,
  enabled: () => boolean
): SuggestionPanelController {
  let panel: HTMLElement | null = null;

  function create(): void {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'tokenwise-suggestions';
    panel.setAttribute('data-tokenwise', 'true');
    Object.assign(panel.style, {
      position: 'fixed',
      bottom: '120px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483646',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #2a2a42 100%)',
      borderRadius: '12px',
      padding: '0',
      color: '#e0e0e0',
      fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
      fontSize: '12px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
      maxWidth: '520px',
      width: '92%',
      maxHeight: '320px',
      overflowY: 'auto',
      display: 'none',
      backdropFilter: 'blur(20px)',
    });
    document.body.appendChild(panel);
  }

  function hide(): void {
    if (panel) panel.style.display = 'none';
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

    const collapseBtn = document.createElement('button');
    collapseBtn.textContent = '▼';
    styleSmallButton(collapseBtn, false);
    collapseBtn.addEventListener('click', hide);
    headerActions.appendChild(collapseBtn);

    header.appendChild(headerActions);
    panel.appendChild(header);

    if (hasAttachments) {
      renderAttachmentSection(panel, attachments);
    }

    for (const suggestion of promptSuggestions.slice(0, 4)) {
      panel.appendChild(createSuggestionRow(suggestion, callbacks));
    }

    panel.style.display = 'block';
    positionPanelAboveElement(panel, callbacks.getInputElement());
  }

  return {
    get element() {
      return panel;
    },
    create,
    hide,
    update,
    isVisible,
  };
}

function renderAttachmentSection(panel: HTMLElement, attachments: FileEstimate[]): void {
  const section = document.createElement('div');
  Object.assign(section.style, {
    padding: '8px 14px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  });

  const title = document.createElement('div');
  title.textContent = 'Attachments';
  Object.assign(title.style, {
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#8888a8',
    marginBottom: '6px',
    fontWeight: '600',
  });
  section.appendChild(title);

  for (const file of attachments.slice(0, 3)) {
    const row = document.createElement('div');
    Object.assign(row.style, { marginBottom: '8px' });

    const name = document.createElement('div');
    name.textContent = `${file.fileName} — ${file.estimatedTokens === -1 ? 'very expensive' : `~${file.estimatedTokens.toLocaleString()} tokens`}`;
    name.style.color = '#c0c0d8';
    name.style.fontSize = '11px';
    name.style.marginBottom = '4px';
    row.appendChild(name);

    for (const tip of file.optimizationTips.slice(0, 2)) {
      const tipEl = document.createElement('div');
      tipEl.textContent = `• ${tip}`;
      tipEl.style.color = '#a0a0b8';
      tipEl.style.fontSize = '10px';
      tipEl.style.marginLeft = '4px';
      row.appendChild(tipEl);
    }

    const resources = getCompressionResources(file.category).slice(0, 2);
    if (resources.length > 0) {
      const compressRow = document.createElement('div');
      Object.assign(compressRow.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        marginTop: '4px',
      });

      const label = document.createElement('span');
      label.textContent = 'Compress:';
      label.style.color = '#8888a8';
      label.style.fontSize = '10px';
      compressRow.appendChild(label);

      for (const resource of resources) {
        compressRow.appendChild(createResourceLink(resource));
      }
      row.appendChild(compressRow);
    }

    section.appendChild(row);
  }

  panel.appendChild(section);
}

function createResourceLink(resource: CompressionResource): HTMLElement {
  const link = document.createElement('button');
  link.textContent = resource.name;
  Object.assign(link.style, {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    color: '#a5b4fc',
    borderRadius: '4px',
    padding: '2px 6px',
    fontSize: '10px',
    cursor: 'pointer',
  });
  link.title = resource.description;
  link.addEventListener('click', () => openCompressionResource(resource.url));
  return link;
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
