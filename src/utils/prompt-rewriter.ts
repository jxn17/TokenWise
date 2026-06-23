/**
 * TokenWise Prompt Rewriter
 *
 * Transforms verbose / hedged / indirect prompts into tight,
 * imperative rewrites — 100% locally, zero API calls.
 *
 * Pipeline:
 *  1. Apply substitution rules (verbose phrase → concise equivalent)
 *  2. Convert indirect requests to direct imperatives
 *  3. Restructure: move buried question to front
 *  4. Convert run-on prose lists to bullet points
 *  5. Normalise whitespace and capitalisation
 */

import { quickEstimate } from './tokenizer';

// ── Types ─────────────────────────────────────────────────────────

export interface RewriteResult {
  /** The rewritten prompt. Empty string if no meaningful change found. */
  rewritten: string;
  /** Original token count */
  originalTokens: number;
  /** Rewritten token count */
  rewrittenTokens: number;
  /** Tokens saved (may be 0 or negative if rewrite adds clarifying structure) */
  tokensSaved: number;
  /** Whether a meaningful rewrite was produced */
  hasRewrite: boolean;
  /** Human-readable label for what changed */
  changeLabel: string;
}

// ── Substitution Rules ────────────────────────────────────────────
// Each rule: [pattern, replacement]
// Applied in order — ORDER MATTERS (more specific first).

interface SubRule {
  pattern: RegExp;
  replacement: string;
}

const SUBSTITUTION_RULES: SubRule[] = [
  // ── Indirect requests → direct imperatives ─────────────────────
  { pattern: /\bI was wondering if you could (?:possibly |please )?/gi, replacement: '' },
  { pattern: /\bI was wondering if you could /gi, replacement: '' },
  { pattern: /\bI was wondering if /gi, replacement: '' },
  { pattern: /\bI(?:'m| am) wondering if you could /gi, replacement: '' },
  { pattern: /\bI(?:'m| am) wondering if /gi, replacement: '' },
  { pattern: /\bwould you be (?:so )?kind (?:enough )?(?:as )?to /gi, replacement: '' },
  { pattern: /\bwould you be able to /gi, replacement: '' },
  { pattern: /\bwould you mind (?:helping me )?/gi, replacement: '' },
  { pattern: /\bcould you (?:please )?(?:kindly )?help me /gi, replacement: '' },
  { pattern: /\bcould you (?:please )?(?:kindly )?/gi, replacement: '' },
  { pattern: /\bwould you (?:please )?(?:kindly )?/gi, replacement: '' },
  { pattern: /\bcan you (?:please )?help me /gi, replacement: '' },
  { pattern: /\bcan you (?:please )?/gi, replacement: '' },
  { pattern: /\bI would (?:really )?(?:greatly )?appreciate (?:it )?if you could /gi, replacement: '' },
  { pattern: /\bI would appreciate (?:it )?if (?:you could )?/gi, replacement: '' },
  { pattern: /\bit would be (?:great|nice|helpful|wonderful|awesome) if you could /gi, replacement: '' },
  { pattern: /\bit would be (?:great|nice|helpful|wonderful|awesome) if /gi, replacement: '' },
  { pattern: /\bI(?:'d| would) like (?:you )?to /gi, replacement: '' },
  { pattern: /\bI(?:'d| would) love (?:it )?if you could /gi, replacement: '' },
  { pattern: /\bI need you to /gi, replacement: '' },
  { pattern: /\bI want you to /gi, replacement: '' },
  { pattern: /\bI want to ask (?:you )?(?:about )?/gi, replacement: '' },

  // ── Verbose connectors → concise ─────────────────────────────────
  { pattern: /\bdue to the fact that /gi, replacement: 'because ' },
  { pattern: /\bin order to /gi, replacement: 'to ' },
  { pattern: /\bfor the purpose of /gi, replacement: 'to ' },
  { pattern: /\bwith (?:regard|respect) to /gi, replacement: 'about ' },
  { pattern: /\bin terms of /gi, replacement: 'for ' },
  { pattern: /\bat this point in time /gi, replacement: 'now ' },
  { pattern: /\bin the event that /gi, replacement: 'if ' },
  { pattern: /\bprior to /gi, replacement: 'before ' },
  { pattern: /\bsubsequent to /gi, replacement: 'after ' },
  { pattern: /\bin spite of the fact that /gi, replacement: 'although ' },
  { pattern: /\bdespite the fact that /gi, replacement: 'although ' },
  { pattern: /\bregardless of the fact that /gi, replacement: 'although ' },
  { pattern: /\bthe fact that /gi, replacement: 'that ' },
  { pattern: /\bon a daily basis/gi, replacement: 'daily' },
  { pattern: /\bon a weekly basis/gi, replacement: 'weekly' },
  { pattern: /\bon a monthly basis/gi, replacement: 'monthly' },
  { pattern: /\bon a yearly basis/gi, replacement: 'yearly' },
  { pattern: /\bin the process of /gi, replacement: '' },
  { pattern: /\bhas the ability to /gi, replacement: 'can ' },
  { pattern: /\bis able to /gi, replacement: 'can ' },
  { pattern: /\bwith the exception of /gi, replacement: 'except ' },
  { pattern: /\bwith the intention of /gi, replacement: 'to ' },

  // ── Preamble / setup phrases ──────────────────────────────────────
  { pattern: /^(?:Hi|Hello|Hey)[,!.]*\s+(?:there[,!]?\s+)?/gim, replacement: '' },
  { pattern: /^(?:Hi|Hello|Hey)[,!.]?\s*/gim, replacement: '' },
  { pattern: /\bthanks(?: in advance)?[.!]?\s*/gi, replacement: '' },
  { pattern: /\bthank you(?: in advance)?[.!]?\s*/gi, replacement: '' },
  { pattern: /\bplease (?:make sure to |ensure that you |be sure to )/gi, replacement: '' },
  { pattern: /\bplease note that /gi, replacement: '' },
  { pattern: /\bit is (?:worth noting|important to note|worth mentioning) that /gi, replacement: '' },
  { pattern: /\bas a matter of fact[,.]?\s*/gi, replacement: '' },
  { pattern: /\bfor what it(?:'s| is) worth[,.]?\s*/gi, replacement: '' },
  { pattern: /\bat the end of the day[,.]?\s*/gi, replacement: '' },
  { pattern: /\bjust to be clear[,.]?\s*/gi, replacement: '' },
  { pattern: /\bjust to clarify[,.]?\s*/gi, replacement: '' },
  { pattern: /\bfirst and foremost[,.]?\s*/gi, replacement: '' },
  { pattern: /\blast but not least[,.]?\s*/gi, replacement: '' },

  // ── Hedge words / opinion markers ─────────────────────────────────
  { pattern: /\bI think that /gi, replacement: '' },
  { pattern: /\bI believe that /gi, replacement: '' },
  { pattern: /\bI feel (?:like |that )/gi, replacement: '' },
  { pattern: /\bin my (?:honest |humble )?opinion[,.]?\s*/gi, replacement: '' },
  { pattern: /\bif (?:possible|you can)[,.]?\s*/gi, replacement: '' },
  { pattern: /\bif (?:that(?:'s| is) okay|that(?:'s| is) fine|that works)[,.]?\s*/gi, replacement: '' },
  { pattern: /\bif (?:you don't mind)[,.]?\s*/gi, replacement: '' },
  { pattern: /\bbasically[,.]?\s*/gi, replacement: '' },
  { pattern: /\bactually[,.]?\s*/gi, replacement: '' },
  { pattern: /\bto be honest[,.]?\s*/gi, replacement: '' },
  { pattern: /\bto be fair[,.]?\s*/gi, replacement: '' },
  { pattern: /\bhonestly[,.]?\s*/gi, replacement: '' },
  { pattern: /\bfrankly[,.]?\s*/gi, replacement: '' },
  { pattern: /\bquite frankly[,.]?\s*/gi, replacement: '' },
  { pattern: /\bngl[,.]?\s*/gi, replacement: '' },
  { pattern: /\btbh[,.]?\s*/gi, replacement: '' },
  { pattern: /\bidk[,.]?\s*/gi, replacement: '' },
  { pattern: /\bimo[,.]?\s*/gi, replacement: '' },
  { pattern: /\blowkey\s*/gi, replacement: '' },
  { pattern: /\bhighkey\s*/gi, replacement: '' },
  { pattern: /\bno cap[,.]?\s*/gi, replacement: '' },
  { pattern: /\bfr[,.]?\s*/gi, replacement: '' },
  { pattern: /\byou know[,.]?\s*/gi, replacement: '' },
  { pattern: /\bi mean[,.]?\s*/gi, replacement: '' },
  { pattern: /\bso like[,.]?\s*/gi, replacement: '' },
  { pattern: /\blike literally[,.]?\s*/gi, replacement: '' },
  { pattern: /\blol[,.]?\s*/gi, replacement: '' },

  // ── Wordy phrases → single words ─────────────────────────────────
  { pattern: /\ba large number of /gi, replacement: 'many ' },
  { pattern: /\ba great deal of /gi, replacement: 'much ' },
  { pattern: /\ba lot of /gi, replacement: 'many ' },
  { pattern: /\bkind of /gi, replacement: '' },
  { pattern: /\bsort of /gi, replacement: '' },
  { pattern: /\btype of /gi, replacement: '' },
  { pattern: /\bsomething like /gi, replacement: '' },
  { pattern: /\balong the lines of /gi, replacement: 'like ' },
  { pattern: /\bsimilar to /gi, replacement: 'like ' },
  { pattern: /\bmore or less /gi, replacement: '~' },
  { pattern: /\bat the same time /gi, replacement: 'simultaneously ' },
  { pattern: /\bin the same way /gi, replacement: 'similarly ' },
  { pattern: /\bon the other hand[,.]?\s*/gi, replacement: 'alternatively, ' },
  { pattern: /\bwith that (?:said|being said)[,.]?\s*/gi, replacement: '' },
  { pattern: /\bhaving said that[,.]?\s*/gi, replacement: '' },
  { pattern: /\bthat being said[,.]?\s*/gi, replacement: '' },
  { pattern: /\bin other words[,.]?\s*/gi, replacement: '' },
  { pattern: /\bwhat I mean is /gi, replacement: '' },
  { pattern: /\bwhat I(?:'m| am) saying is /gi, replacement: '' },
  { pattern: /\bthe thing is[,.]?\s*/gi, replacement: '' },
  { pattern: /\bthe point is[,.]?\s*/gi, replacement: '' },
  { pattern: /\bthe bottom line is[,.]?\s*/gi, replacement: '' },
  { pattern: /\bneedless to say[,.]?\s*/gi, replacement: '' },
  { pattern: /\bobviously[,.]?\s*/gi, replacement: '' },
  { pattern: /\bclearly[,.]?\s*/gi, replacement: '' },
  { pattern: /\bof course[,.]?\s*/gi, replacement: '' },
  { pattern: /\bmost importantly[,.]?\s*/gi, replacement: '' },
  { pattern: /\bmost notably[,.]?\s*/gi, replacement: '' },
  { pattern: /\binterestingly enough[,.]?\s*/gi, replacement: '' },
  { pattern: /\bsurprisingly enough[,.]?\s*/gi, replacement: '' },
  { pattern: /\bwithout a doubt[,.]?\s*/gi, replacement: '' },

  // ── Verbose question stems ────────────────────────────────────────
  { pattern: /\bcould you (?:please )?tell me /gi, replacement: '' },
  { pattern: /\bcould you (?:please )?explain /gi, replacement: 'Explain ' },
  { pattern: /\bcould you (?:please )?describe /gi, replacement: 'Describe ' },
  { pattern: /\bcould you (?:please )?provide /gi, replacement: 'Provide ' },
  { pattern: /\bcould you (?:please )?give me /gi, replacement: 'Give me ' },
  { pattern: /\bcould you (?:please )?write /gi, replacement: 'Write ' },
  { pattern: /\bcould you (?:please )?create /gi, replacement: 'Create ' },
  { pattern: /\bcould you (?:please )?make /gi, replacement: 'Make ' },
  { pattern: /\bcould you (?:please )?show me /gi, replacement: 'Show me ' },
  { pattern: /\bcould you (?:please )?help me (?:understand |figure out )?/gi, replacement: 'Explain ' },
  { pattern: /\bwhat is the best way to /gi, replacement: 'How do I ' },
  { pattern: /\bwhat would be the best approach to /gi, replacement: 'How do I ' },
  { pattern: /\bhow (?:would|do) I go about /gi, replacement: 'How do I ' },
  { pattern: /\bI need help (?:with |understanding |figuring out )?/gi, replacement: '' },
  { pattern: /\bI(?:'m| am) trying to (?:understand|figure out|learn about|learn how to) /gi, replacement: '' },
  { pattern: /\bI(?:'m| am) looking for (?:help with |assistance with |information on |info on )?/gi, replacement: '' },
  { pattern: /\bI(?:'m| am) struggling (?:with |to understand )?/gi, replacement: '' },
  { pattern: /\bI(?:'m| am) having trouble (?:with |understanding )?/gi, replacement: '' },
  { pattern: /\bhelp me (?:to )?understand /gi, replacement: 'Explain ' },
  { pattern: /\bhelp me (?:to )?figure out /gi, replacement: '' },
  { pattern: /\bhelp me (?:to )?/gi, replacement: '' },

  // ── Weak modifiers ────────────────────────────────────────────────
  { pattern: /\bvery unique/gi, replacement: 'unique' },
  { pattern: /\bvery important/gi, replacement: 'important' },
  { pattern: /\breally important/gi, replacement: 'important' },
  { pattern: /\bvery (?:good|great|nice|helpful)/gi, replacement: '$&'.replace('very ', '') },
  { pattern: /\breally (?:good|great|nice)/gi, replacement: '$&'.replace('really ', '') },
  { pattern: /\bvery \b/gi, replacement: '' },
  { pattern: /\breally \b/gi, replacement: '' },
  { pattern: /\bjust \b/gi, replacement: '' },
  { pattern: /\bsimply \b/gi, replacement: '' },
  { pattern: /\bquite \b/gi, replacement: '' },
  { pattern: /\brather \b/gi, replacement: '' },
  { pattern: /\bsomewhat \b/gi, replacement: '' },
  { pattern: /\bperhaps \b/gi, replacement: '' },
  { pattern: /\bmaybe \b/gi, replacement: '' },
  { pattern: /\bpossibly \b/gi, replacement: '' },
];

// ── Structural Rewriting ───────────────────────────────────────────

/**
 * Detect if a sentence is the actual question/ask.
 * Questions and imperative sentences starting with a verb are the "real ask".
 */
const IMPERATIVE_STARTERS = [
  'write', 'create', 'make', 'build', 'generate', 'list', 'give', 'show',
  'find', 'explain', 'describe', 'summarize', 'summarise', 'translate',
  'convert', 'fix', 'debug', 'refactor', 'review', 'compare', 'analyse',
  'analyze', 'calculate', 'compute', 'draw', 'design', 'suggest', 'recommend',
  'outline', 'draft', 'rewrite', 'improve', 'simplify', 'expand', 'shorten',
];

function isAskSentence(sentence: string): boolean {
  const t = sentence.trim().toLowerCase();
  if (t.endsWith('?')) return true;
  const firstWord = t.split(/\s+/)[0]?.replace(/[^a-z]/g, '');
  return IMPERATIVE_STARTERS.includes(firstWord ?? '');
}

/**
 * If the main ask is buried after ≥2 sentences of context, surface it first.
 */
function restructureSentenceOrder(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length < 3) return text;

  // Find the first "ask" sentence that isn't the very first sentence
  const askIndex = sentences.findIndex((s, i) => i > 0 && isAskSentence(s));
  if (askIndex <= 1) return text; // already first or second — no change

  // Move ask to front
  const ask = sentences[askIndex];
  const rest = sentences.filter((_, i) => i !== askIndex);
  return [ask, ...rest].join(' ');
}

/**
 * Detect prose lists like "A, B, C, and D" and convert to bullet format
 * when there are 4+ items and the whole thing is one long sentence.
 */
function proseListToBullets(text: string): string {
  // Only apply to single long sentences with 4+ comma-separated items
  const sentences = text.split(/(?<=[.!?])\s+/);

  return sentences.map(sentence => {
    const wordCount = sentence.trim().split(/\s+/).length;
    if (wordCount < 20) return sentence;

    // Look for patterns like "including X, Y, Z, and W" or "such as X, Y, Z"
    const listMatch = sentence.match(
      /(?:including|such as|like|namely|e\.g\.,?):\s*(.+?)(?:\.|$)/i
    );
    if (!listMatch) return sentence;

    const listPart = listMatch[1];
    const items = listPart
      .split(/,\s*(?:and\s+|or\s+)?/)
      .map(i => i.trim())
      .filter(i => i.length > 0 && i.split(/\s+/).length <= 6);

    if (items.length < 4) return sentence;

    const beforeList = sentence.slice(0, listMatch.index ?? 0).trim();
    return `${beforeList}:\n${items.map(i => `- ${i}`).join('\n')}`;
  }).join(' ');
}

/**
 * Capitalise the first letter of a string.
 */
function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Remove double spaces and normalise punctuation after substitutions.
 */
function cleanUp(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')           // collapse multiple spaces
    .replace(/\n{3,}/g, '\n\n')            // max 2 consecutive newlines
    .replace(/^ +/gm, '')                  // no leading spaces per line
    .replace(/,\s*,/g, ',')               // "word,, word" → "word, word"
    .replace(/\s+([.,!?;:])/g, '$1')      // space before punctuation
    .replace(/([.!?])\s*([a-z])/g, (_, p, c) => `${p} ${c.toUpperCase()}`) // sentence capitalisation
    .trim();
}

// ── Core Rewrite Function ─────────────────────────────────────────

/**
 * Apply all substitution rules to the text.
 */
function applySubstitutions(text: string): string {
  let result = text;
  for (const rule of SUBSTITUTION_RULES) {
    rule.pattern.lastIndex = 0;
    try {
      result = result.replace(rule.pattern, rule.replacement as string);
    } catch {
      // Skip any problematic rules
    }
  }
  return result;
}

/**
 * Main entry point — rewrite a prompt.
 *
 * @param text - The raw prompt text from the user's input
 * @returns RewriteResult with the rewritten text and metadata
 */
export function rewritePrompt(text: string): RewriteResult {
  const originalTokens = quickEstimate(text);
  const blank: RewriteResult = {
    rewritten: '',
    originalTokens,
    rewrittenTokens: originalTokens,
    tokensSaved: 0,
    hasRewrite: false,
    changeLabel: '',
  };

  if (!text || text.trim().length < 10) return blank;
  // Don't rewrite code blocks
  if (text.includes('```') || text.includes('    ') && text.includes('\n')) return blank;

  const safeText = text.length > 100_000 ? text.slice(0, 100_000) : text;

  // 1. Apply substitution rules
  let rewritten = applySubstitutions(safeText);

  // 2. Restructure sentence order (ask → front)
  rewritten = restructureSentenceOrder(rewritten);

  // 3. Convert prose lists to bullets
  rewritten = proseListToBullets(rewritten);

  // 4. Clean up artefacts
  rewritten = cleanUp(rewritten);

  // 5. Capitalise the first character
  rewritten = capitalizeFirst(rewritten);

  const rewrittenTokens = quickEstimate(rewritten);
  const tokensSaved = originalTokens - rewrittenTokens;

  // Only surface the rewrite if it saved ≥2 tokens AND changed at least 10 chars
  const meaningfulChange =
    tokensSaved >= 2 &&
    Math.abs(safeText.trim().length - rewritten.length) >= 8 &&
    rewritten !== safeText.trim();

  if (!meaningfulChange) return blank;

  // Determine change label
  let changeLabel = `~${tokensSaved} tokens saved`;
  if (tokensSaved >= 10) changeLabel = `🔥 ${tokensSaved} tokens saved`;
  else if (tokensSaved >= 5) changeLabel = `✨ ${tokensSaved} tokens saved`;

  return {
    rewritten,
    originalTokens,
    rewrittenTokens,
    tokensSaved,
    hasRewrite: true,
    changeLabel,
  };
}
