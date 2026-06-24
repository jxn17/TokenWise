/**
 * Widget helpers — copy context button and token color utilities.
 */

import {
  buildContinuationContext,
  copyContinuationContext,
  estimateExportTokens,
  showCopyToast,
  type ExportMessage,
} from './context-exporter';

export function getTokenColor(tokens: number): string {
  if (tokens < 500) return '#4ade80';
  if (tokens <= 2000) return '#facc15';
  return '#f87171';
}

export interface WidgetWarningOptions {
  siteLabel: string;
  inputTokens: number;
  totalTokens: number;
  /** Estimated tokens from sandboxed artifact iframes (e.g. claudemcpcontent.com). */
  artifactTokens?: number;
  warningThreshold: number;
  criticalThreshold: number;
  getMessages: () => ExportMessage[];
  contextExportMaxTokens?: number;
}

/**
 * Rebuild widget body content (preserves dismiss button passed as insertBefore anchor).
 */
export function renderWidgetBody(
  widget: HTMLElement,
  insertBefore: Node | null,
  options: WidgetWarningOptions
): void {
  while (widget.firstChild) {
    if (widget.firstChild === insertBefore) break;
    widget.removeChild(widget.firstChild);
  }

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '8px',
    fontWeight: '600',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#a0a0b8',
  });
  header.textContent = `📊 TokenWise · ${options.siteLabel}`;
  widget.insertBefore(header, insertBefore);

  appendStatLine(widget, insertBefore, 'Current message:', options.inputTokens);
  appendStatLine(widget, insertBefore, 'Full request cost:', options.totalTokens);

  // Show artifact overhead as a separate amber line when detected
  if (options.artifactTokens && options.artifactTokens > 0) {
    appendArtifactLine(widget, insertBefore, options.artifactTokens);
  }

  if (options.totalTokens > options.criticalThreshold) {
    appendWarning(
      widget,
      insertBefore,
      `Very expensive conversation. A new chat would save ~${(options.totalTokens - 100).toLocaleString()} tokens.`,
      'critical'
    );
    appendCopyContextButton(widget, insertBefore, options);
  } else if (options.totalTokens > options.warningThreshold) {
    appendWarning(
      widget,
      insertBefore,
      'Conversation is getting long. Consider starting a new chat soon.',
      'warning'
    );
    appendCopyContextButton(widget, insertBefore, options);
  }
}

function appendStatLine(
  widget: HTMLElement,
  insertBefore: Node | null,
  label: string,
  tokens: number
): void {
  const line = document.createElement('div');
  Object.assign(line.style, {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
  });
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  labelEl.style.color = '#8888a8';
  const valueEl = document.createElement('span');
  valueEl.textContent = `~${tokens.toLocaleString()} tokens`;
  valueEl.style.fontWeight = '600';
  valueEl.style.color = getTokenColor(tokens);
  line.appendChild(labelEl);
  line.appendChild(valueEl);
  widget.insertBefore(line, insertBefore);
}

function appendArtifactLine(
  widget: HTMLElement,
  insertBefore: Node | null,
  tokens: number
): void {
  const line = document.createElement('div');
  Object.assign(line.style, {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    marginTop: '2px',
  });
  const labelEl = document.createElement('span');
  labelEl.textContent = '⚡ Artifact (est.)';
  labelEl.style.color = '#c4a818';
  const valueEl = document.createElement('span');
  valueEl.textContent = `~${tokens.toLocaleString()} tokens`;
  valueEl.style.fontWeight = '600';
  valueEl.style.color = '#facc15';
  line.appendChild(labelEl);
  line.appendChild(valueEl);
  widget.insertBefore(line, insertBefore);
}

function appendWarning(
  widget: HTMLElement,
  insertBefore: Node | null,
  text: string,
  level: 'warning' | 'critical'
): void {
  const warning = document.createElement('div');
  const isCritical = level === 'critical';
  Object.assign(warning.style, {
    marginTop: '8px',
    padding: '6px 8px',
    borderRadius: '6px',
    background: isCritical ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
    border: isCritical ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(234,179,8,0.3)',
    fontSize: '11px',
    color: isCritical ? '#fca5a5' : '#fde68a',
  });
  warning.textContent = isCritical ? `🔴 ${text}` : `🟡 ${text}`;
  widget.insertBefore(warning, insertBefore);
}

function appendCopyContextButton(
  widget: HTMLElement,
  insertBefore: Node | null,
  options: WidgetWarningOptions
): void {
  const messages = options.getMessages();
  if (messages.length === 0) return;

  const preview = buildContinuationContext(messages, {
    maxTokens: options.contextExportMaxTokens,
  });
  const exportTokens = estimateExportTokens(preview);

  const btn = document.createElement('button');
  btn.textContent = `Copy context for new chat (~${exportTokens.toLocaleString()} tokens)`;
  Object.assign(btn.style, {
    marginTop: '8px',
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(99,102,241,0.2)',
    border: '1px solid rgba(99,102,241,0.4)',
    color: '#c7d2fe',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: '600',
    cursor: 'pointer',
  });

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const result = await copyContinuationContext(messages, {
      maxTokens: options.contextExportMaxTokens,
    });
    if (result.success) {
      showCopyToast(widget, 'Copied — paste into a new chat');
    }
  });

  widget.insertBefore(btn, insertBefore);
}
