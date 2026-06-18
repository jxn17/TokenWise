/**
 * Structured chat continuation export — 100% local, extractive (no LLM).
 */

import { quickEstimate } from './tokenizer';

export interface ExportMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ContextExportOptions {
  maxTokens?: number;
  recentTurnPairs?: number;
  maxCodeChars?: number;
  maxMessageChars?: number;
}

const DEFAULT_MAX_TOKENS = 5000;
const DEFAULT_RECENT_TURNS = 5;
const DEFAULT_MAX_CODE_CHARS = 2000;
const DEFAULT_MAX_MESSAGE_CHARS = 800;

/**
 * Build a markdown continuation block from conversation messages.
 */
export function buildContinuationContext(
  messages: ExportMessage[],
  options: ContextExportOptions = {}
): string {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const recentPairs = options.recentTurnPairs ?? DEFAULT_RECENT_TURNS;
  const maxCodeChars = options.maxCodeChars ?? DEFAULT_MAX_CODE_CHARS;
  const maxMessageChars = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;

  if (!messages || messages.length === 0) {
    return '# Chat continuation context\n\nNo messages to export.';
  }

  const userMessages = messages.filter((m) => m.role === 'user' && m.content.trim());
  const firstUser = userMessages[0]?.content.trim() || 'N/A';

  const constraints = extractConstraints(messages);
  const codeBlocks = extractCodeBlocks(messages, maxCodeChars);
  const middleQuestions = extractMiddleQuestions(messages, recentPairs);
  const recent = extractRecentTurns(messages, recentPairs, maxMessageChars);

  const sections: string[] = [
    '# Chat continuation context',
    '',
    '## Original goal',
    truncateText(firstUser, maxMessageChars),
    '',
  ];

  if (constraints.length > 0) {
    sections.push('## Key constraints and decisions');
    for (const c of constraints) {
      sections.push(`- ${c}`);
    }
    sections.push('');
  }

  if (middleQuestions.length > 0) {
    sections.push('## Earlier topics covered');
    for (const q of middleQuestions) {
      sections.push(`- ${q}`);
    }
    sections.push('');
  }

  if (codeBlocks) {
    sections.push('## Code / config referenced');
    sections.push(codeBlocks);
    sections.push('');
  }

  if (recent) {
    sections.push(`## Recent conversation (last ~${recentPairs} turns)`);
    sections.push(recent);
    sections.push('');
  }

  sections.push('## Instruction for new chat');
  sections.push(
    'Continue from the above context. Do not re-ask questions that were already answered. ' +
      'Preserve constraints, decisions, and technical details.'
  );

  let output = sections.join('\n');
  output = trimToTokenBudget(output, maxTokens);
  return output;
}

export function estimateExportTokens(text: string): number {
  return quickEstimate(text);
}

/**
 * Copy continuation context to clipboard. Returns success status.
 */
export async function copyContinuationContext(
  messages: ExportMessage[],
  options?: ContextExportOptions
): Promise<{ success: boolean; tokenEstimate: number }> {
  const text = buildContinuationContext(messages, options);
  const tokenEstimate = estimateExportTokens(text);

  try {
    await navigator.clipboard.writeText(text);
    return { success: true, tokenEstimate };
  } catch {
    return { success: false, tokenEstimate };
  }
}

function extractConstraints(messages: ExportMessage[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  const patterns = [
    /^(?:-|\*|\d+\.)\s+(.{10,200})$/gm,
    /\b(?:must|should|don't|do not|never|always|required|important)\b[^.!?\n]{5,180}[.!?]?/gi,
  ];

  const fullText = messages.map((m) => m.content).join('\n');

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fullText)) !== null) {
      const line = (match[1] || match[0]).trim().replace(/\s+/g, ' ');
      const key = line.toLowerCase();
      if (line.length < 10 || seen.has(key)) continue;
      seen.add(key);
      results.push(truncateText(line, 200));
      if (results.length >= 12) return results;
    }
  }

  return results;
}

function extractCodeBlocks(messages: ExportMessage[], maxChars: number): string {
  const blocks: string[] = [];
  let total = 0;

  for (const msg of messages) {
    const regex = /```[\s\S]*?```/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(msg.content)) !== null) {
      const block = match[0];
      if (total + block.length > maxChars) break;
      blocks.push(block);
      total += block.length;
      if (blocks.length >= 5) return blocks.join('\n\n');
    }
  }

  return blocks.join('\n\n');
}

function extractMiddleQuestions(messages: ExportMessage[], recentPairs: number): string[] {
  const keepRecent = recentPairs * 2;
  if (messages.length <= keepRecent + 2) return [];

  const middle = messages.slice(1, Math.max(1, messages.length - keepRecent));
  const questions: string[] = [];
  const seen = new Set<string>();

  for (const msg of middle) {
    if (msg.role !== 'user') continue;
    const text = msg.content.trim().replace(/\s+/g, ' ');
    if (text.length < 15) continue;
    const key = text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(truncateText(text, 120));
    if (questions.length >= 8) break;
  }

  return questions;
}

function extractRecentTurns(
  messages: ExportMessage[],
  pairs: number,
  maxChars: number
): string {
  const keep = pairs * 2;
  const recent = messages.slice(-keep);
  const lines: string[] = [];

  for (const msg of recent) {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    lines.push(`**${role}:** ${truncateText(msg.content.trim(), maxChars)}`);
  }

  return lines.join('\n\n');
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  if (quickEstimate(text) <= maxTokens) return text;

  const lines = text.split('\n');
  while (lines.length > 10 && quickEstimate(lines.join('\n')) > maxTokens) {
    const idx = lines.findIndex((l, i) => i > 4 && l.startsWith('- '));
    if (idx === -1) break;
    lines.splice(idx, 1);
  }

  let result = lines.join('\n');
  while (quickEstimate(result) > maxTokens && result.length > 500) {
    result = result.slice(0, Math.floor(result.length * 0.9));
  }

  if (!result.endsWith('\n')) {
    result += '\n\n...(trimmed to fit token budget)';
  }

  return result;
}

/**
 * Show a brief toast near the widget after copy.
 */
export function showCopyToast(widget: HTMLElement, message: string): void {
  const toast = document.createElement('div');
  toast.setAttribute('data-tokenwise', 'true');
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '2147483647',
    background: '#1e1e2e',
    color: '#4ade80',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    border: '1px solid rgba(74,222,128,0.3)',
  });
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    try {
      toast.remove();
    } catch {
      // Already removed
    }
  }, 3500);
}
