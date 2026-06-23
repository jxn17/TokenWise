/**
 * TokenWise Prompt Analyzer
 *
 * Rule-based prompt analysis engine that runs 100% locally.
 * Detects filler phrases, redundancy, formatting waste, and verbosity.
 * Provides actionable suggestions with token savings estimates.
 */

import { quickEstimate } from './tokenizer';

// ── Type Definitions ──────────────────────────────────────────────

export interface Suggestion {
  id: string;
  type: 'filler' | 'redundancy' | 'verbosity' | 'formatting';
  message: string;
  originalText: string;
  suggestedText: string;
  tokenSavings: number;
  priority: 'low' | 'medium' | 'high';
}

// ── Filler Phrase Patterns ────────────────────────────────────────

interface FillerPattern {
  pattern: RegExp;
  replacement: string;
  label: string;
}

const FILLER_PATTERNS: FillerPattern[] = [
  { pattern: /\bcould you (?:please )?(?:kindly )?/gi, replacement: '', label: 'Polite filler' },
  { pattern: /\bwould you (?:please )?(?:kindly )?/gi, replacement: '', label: 'Polite filler' },
  { pattern: /\bcan you (?:please )?/gi, replacement: '', label: 'Question-as-request' },
  { pattern: /\bI was wondering if you could (?:possibly )?/gi, replacement: '', label: 'Indirect request' },
  { pattern: /\bI was wondering if (?:you )?/gi, replacement: '', label: 'Indirect request' },
  { pattern: /\bI(?:'m| am) wondering if (?:you )?/gi, replacement: '', label: 'Indirect request' },
  { pattern: /\bif it(?:'s| is) not too much trouble[,.]?\s*/gi, replacement: '', label: 'Unnecessary qualifier' },
  { pattern: /\bwould you be (?:so )?kind (?:enough )?(?:as )?to /gi, replacement: '', label: 'Excessive politeness' },
  { pattern: /\bwould you mind /gi, replacement: '', label: 'Excessive politeness' },
  { pattern: /\bI would (?:really )?(?:greatly )?appreciate (?:it )?if you could /gi, replacement: '', label: 'Verbose request' },
  { pattern: /\bI would appreciate (?:it )?if /gi, replacement: '', label: 'Verbose request' },
  { pattern: /\bplease (?:make sure to |ensure that you |be sure to )/gi, replacement: 'Please ', label: 'Redundant instruction prefix' },
  { pattern: /\bI need you to /gi, replacement: '', label: 'Directive filler' },
  { pattern: /\bI want you to /gi, replacement: '', label: 'Directive filler' },
  { pattern: /\bI want to ask (?:you )?(?:if )?/gi, replacement: '', label: 'Indirect request' },
  { pattern: /\bI(?:'m| am) trying to (?:understand|figure out|learn) /gi, replacement: '', label: 'Preamble' },
  { pattern: /\bI(?:'m| am) looking for /gi, replacement: '', label: 'Preamble' },
  { pattern: /\bI(?:'m| am) working on /gi, replacement: '', label: 'Preamble' },
  { pattern: /\bhelp me (?:to )?understand /gi, replacement: 'Explain ', label: 'Wordy phrase' },
  { pattern: /\bhelp me with /gi, replacement: '', label: 'Wordy phrase' },
  { pattern: /\bI need help with /gi, replacement: '', label: 'Wordy phrase' },
  { pattern: /\bcould you (?:help me )?(?:to )?explain /gi, replacement: 'Explain ', label: 'Wordy phrase' },
  { pattern: /\bcould you tell me /gi, replacement: '', label: 'Wordy phrase' },
  { pattern: /\bit would be (?:great|nice|helpful|wonderful) if (?:you could )?/gi, replacement: '', label: 'Indirect request' },
  { pattern: /\bI(?:'d| would) like (?:you )?to /gi, replacement: '', label: 'Indirect request' },
  { pattern: /\bif (?:possible|you can)[,.]?\s*/gi, replacement: '', label: 'Hedge phrase' },
  { pattern: /\bin my (?:honest |humble )?opinion[,.]?\s*/gi, replacement: '', label: 'Opinion filler' },
  { pattern: /\bI think that /gi, replacement: '', label: 'Hedge phrase' },
  { pattern: /\bI believe that /gi, replacement: '', label: 'Hedge phrase' },
  { pattern: /\bI feel like /gi, replacement: '', label: 'Hedge phrase' },
  { pattern: /\bbasically[,.]?\s*/gi, replacement: '', label: 'Filler word' },
  { pattern: /\bactually[,.]?\s*/gi, replacement: '', label: 'Filler word' },
  { pattern: /\bjust to be clear[,.]?\s*/gi, replacement: '', label: 'Clarification filler' },
  { pattern: /\bfor what it(?:'s| is) worth[,.]?\s*/gi, replacement: '', label: 'Hedge phrase' },
  { pattern: /\bat the end of the day[,.]?\s*/gi, replacement: '', label: 'Cliché filler' },
  { pattern: /\bin terms of /gi, replacement: 'regarding ', label: 'Wordy phrase' },
  { pattern: /\bdue to the fact that /gi, replacement: 'because ', label: 'Wordy connector' },
  { pattern: /\bin order to /gi, replacement: 'to ', label: 'Wordy connector' },
  { pattern: /\bfor the purpose of /gi, replacement: 'to ', label: 'Wordy connector' },
  { pattern: /\bwith regard to /gi, replacement: 'about ', label: 'Wordy phrase' },
  { pattern: /\bwith respect to /gi, replacement: 'about ', label: 'Wordy phrase' },
  { pattern: /\bas a matter of fact[,.]?\s*/gi, replacement: '', label: 'Filler phrase' },
  { pattern: /\bit is important to note that /gi, replacement: '', label: 'Filler phrase' },
  { pattern: /\bplease note that /gi, replacement: '', label: 'Filler phrase' },
  { pattern: /\bthe fact that /gi, replacement: 'that ', label: 'Wordy phrase' },
  { pattern: /\bat this point in time /gi, replacement: 'now ', label: 'Wordy phrase' },
  { pattern: /\bin the event that /gi, replacement: 'if ', label: 'Wordy phrase' },
  { pattern: /\bprior to /gi, replacement: 'before ', label: 'Wordy phrase' },
  { pattern: /\ba lot of /gi, replacement: 'many ', label: 'Wordy phrase' },
  { pattern: /\bkind of /gi, replacement: '', label: 'Hedge phrase' },
  { pattern: /\bsort of /gi, replacement: '', label: 'Hedge phrase' },
  { pattern: /^(?:hi|hello|hey)[,!]?\s+/gim, replacement: '', label: 'Greeting filler' },
  { pattern: /\bthanks in advance[.!]?\s*/gi, replacement: '', label: 'Polite filler' },
  { pattern: /\bthank you in advance[.!]?\s*/gi, replacement: '', label: 'Polite filler' },
];

const GENZ_FILLER_PATTERNS: FillerPattern[] = [
  // Discourse marker "like" — detect "like" when used as filler, not as "would like to" or "like this"
  { pattern: /\b(?:,\s*)?like(?:,\s*)?\b(?!\s+(?:this|that|a|an|the|to|it|so)\b)/gi, replacement: '', label: 'Filler "like"' },
  { pattern: /\bngl\b[,.]?\s*/gi, replacement: '', label: 'Abbreviation filler' },
  { pattern: /\btbh\b[,.]?\s*/gi, replacement: '', label: 'Abbreviation filler' },
  { pattern: /\bidk\b[,.]?\s*/gi, replacement: '', label: 'Abbreviation filler' },
  { pattern: /\bimo\b[,.]?\s*/gi, replacement: '', label: 'Abbreviation filler' },
  { pattern: /\bimho\b[,.]?\s*/gi, replacement: '', label: 'Abbreviation filler' },
  { pattern: /\blowkey\b[,.]?\s*/gi, replacement: '', label: 'Hedge filler' },
  { pattern: /\bhighkey\b[,.]?\s*/gi, replacement: '', label: 'Hedge filler' },
  { pattern: /\blmk\b[,.]?\s*/gi, replacement: '', label: 'Abbreviation filler' },
  { pattern: /\bfr\b[,.]?\s*/gi, replacement: '', label: 'Emphasis filler' },
  { pattern: /\bno cap\b[,.]?\s*/gi, replacement: '', label: 'Emphasis filler' },
  { pattern: /\bkinda\b/gi, replacement: '', label: 'Casual hedge' },
  { pattern: /\bsorta\b/gi, replacement: '', label: 'Casual hedge' },
  { pattern: /\bi mean\b[,.]?\s*/gi, replacement: '', label: 'Discourse marker' },
  { pattern: /\byou know\b[,.]?\s*/gi, replacement: '', label: 'Discourse marker' },
  { pattern: /\bso like\b[,.]?\s*/gi, replacement: '', label: 'Combined filler' },
  { pattern: /\blike literally\b[,.]?\s*/gi, replacement: '', label: 'Combined filler' },
  { pattern: /\blol\b[,.]?\s*/gi, replacement: '', label: 'Reaction filler' },
  { pattern: /\blmao\b[,.]?\s*/gi, replacement: '', label: 'Reaction filler' },
];

const WEAK_WORDS = [
  'very', 'really', 'just', 'quite', 'rather', 'somewhat', 'literally',
  'simply', 'perhaps', 'maybe', 'possibly', 'certainly', 'definitely',
  'absolutely', 'completely', 'totally', 'entirely', 'honestly', 'frankly',
  'obviously', 'clearly', 'needless to say', 'lowkey', 'highkey', 'kinda',
  'sorta', 'deadass'
];

// ── Analysis Functions ────────────────────────────────────────────

/**
 * Analyze a prompt and return actionable optimization suggestions.
 * Runs entirely locally — no API calls.
 */
export function analyzePrompt(text: string): Suggestion[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const safeText = text.length > 100_000 ? text.slice(0, 100_000) : text;
  const trimmed = safeText.trim();

  const suggestions: Suggestion[] = [
    ...detectFillerPhrases(trimmed),
    ...detectWeakWords(trimmed),
    ...detectLetterStretching(trimmed),
    ...detectRedundancy(trimmed),
    ...detectLongSentences(trimmed),
    ...detectMultipleQuestions(trimmed),
    ...detectVerbosity(trimmed),
    ...detectFormattingWaste(trimmed),
    ...detectLengthHint(trimmed),
  ];

  const deduped = dedupeSuggestions(suggestions);
  deduped.sort((a, b) => b.tokenSavings - a.tokenSavings);
  return deduped;
}

function detectFillerPhrases(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  const allPatterns = [...FILLER_PATTERNS, ...GENZ_FILLER_PATTERNS];

  for (const { pattern, replacement, label } of allPatterns) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);

    if (matches && matches.length > 0) {
      for (const match of matches) {
        const savings = quickEstimate(match) - quickEstimate(replacement);
        if (savings > 0) {
          suggestions.push({
            id: `filler-${suggestions.length}-${Date.now()}`,
            type: 'filler',
            message: `Remove ${label.toLowerCase()}: "${match.trim()}"`,
            originalText: match,
            suggestedText: replacement,
            tokenSavings: savings,
            priority: savings > 5 ? 'high' : savings > 2 ? 'medium' : 'low',
          });
        }
      }
    }
  }

  return suggestions;
}

/**
 * Detect letter stretching: "soooo" → "so", "baddd" → "bad", "heyyyy" → "hey".
 * Any letter repeated 3+ times consecutively costs extra tokens for no benefit.
 */
function detectLetterStretching(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Matches any word containing a letter repeated 3+ times in a row
  const pattern = /\b\w*(\w)\1{2,}\w*\b/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const word = match[0];
    const wordLower = word.toLowerCase();

    // Skip URL prefix "www" and already-processed words
    if (wordLower === 'www') continue;
    if (seen.has(wordLower)) continue;
    seen.add(wordLower);

    // Collapse ALL consecutive repeated characters to one instance
    // e.g. "soooo" → "so", "baddd" → "bad", "heyyyy" → "hey"
    const collapsed = word.replace(/(.)\1{2,}/g, '$1');
    if (collapsed === word) continue;

    const savings = Math.max(1, quickEstimate(word) - quickEstimate(collapsed));

    suggestions.push({
      id: `letter-stretch-${wordLower}-${Date.now()}`,
      type: 'filler',
      message: `Letter stretching: "${word}" → "${collapsed}"`,
      originalText: word,
      suggestedText: collapsed,
      tokenSavings: savings,
      priority: 'medium',
    });
  }

  return suggestions;
}

/**
 * Detect standalone weak intensifiers that can be removed one-by-one.
 */
function detectWeakWords(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const word of WEAK_WORDS) {
    const pattern = new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b[,.]?\\s*`, 'gi');
    pattern.lastIndex = 0;
    const matches = text.match(pattern);

    if (matches) {
      for (const match of matches) {
        const savings = quickEstimate(match);
        if (savings > 0) {
          suggestions.push({
            id: `weak-${word}-${suggestions.length}-${Date.now()}`,
            type: 'filler',
            message: `Remove weak word: "${match.trim()}"`,
            originalText: match,
            suggestedText: '',
            tokenSavings: savings,
            priority: 'low',
          });
        }
      }
    }
  }

  return suggestions;
}

function detectRedundancy(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 10);
  const seen = new Map<string, number>();

  for (const sentence of sentences) {
    const normalized = sentence.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalized.length < 10) continue;

    const count = seen.get(normalized) || 0;
    seen.set(normalized, count + 1);

    if (count === 1) {
      const savings = quickEstimate(sentence.trim());
      suggestions.push({
        id: `redundancy-${suggestions.length}-${Date.now()}`,
        type: 'redundancy',
        message: `Repeated sentence: "${sentence.trim().slice(0, 60)}${sentence.trim().length > 60 ? '...' : ''}"`,
        originalText: sentence.trim(),
        suggestedText: '',
        tokenSavings: savings,
        priority: 'high',
      });
    }
  }

  const instructionPatterns = [
    /(?:make sure|ensure|don't forget|remember) (?:to |that )(.{10,80})/gi,
  ];

  for (const pattern of instructionPatterns) {
    pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern)];

    if (matches.length > 1) {
      const instructions = matches.map((m) => m[1].toLowerCase().trim());
      for (let i = 1; i < instructions.length; i++) {
        for (let j = 0; j < i; j++) {
          if (similarityScore(instructions[i], instructions[j]) > 0.6) {
            const savings = quickEstimate(matches[i][0]);
            suggestions.push({
              id: `redundancy-similar-${suggestions.length}-${Date.now()}`,
              type: 'redundancy',
              message: `Similar instruction repeated: "${matches[i][0].slice(0, 60)}..."`,
              originalText: matches[i][0],
              suggestedText: '',
              tokenSavings: savings,
              priority: 'medium',
            });
          }
        }
      }
    }
  }

  return suggestions;
}

function detectLongSentences(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount >= 30) {
      const savings = Math.max(3, Math.round(quickEstimate(trimmed) * 0.12));
      suggestions.push({
        id: `long-sentence-${suggestions.length}-${Date.now()}`,
        type: 'verbosity',
        message: `Long sentence (${wordCount} words). Try bullets or shorter sentences.`,
        originalText: '',
        suggestedText: '',
        tokenSavings: savings,
        priority: wordCount >= 45 ? 'high' : 'medium',
      });
    }
  }

  return suggestions;
}

function detectMultipleQuestions(text: string): Suggestion[] {
  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount < 2) return [];

  const savings = Math.max(5, (questionCount - 1) * 8);
  return [{
    id: `multi-question-${Date.now()}`,
    type: 'verbosity',
    message: `${questionCount} questions detected. Ask one at a time to reduce tokens and improve answers.`,
    originalText: '',
    suggestedText: '',
    tokenSavings: savings,
    priority: questionCount >= 3 ? 'high' : 'medium',
  }];
}

function detectVerbosity(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const tokens = quickEstimate(text);

  if (tokens < 35) return suggestions;

  const words = text.split(/\s+/);
  const fillerSet = new Set(WEAK_WORDS);
  let fillerCount = 0;

  for (const word of words) {
    const normalized = word.toLowerCase().replace(/[^a-z\s]/g, '');
    if (fillerSet.has(normalized)) fillerCount++;
  }

  const fillerRatio = fillerCount / Math.max(words.length, 1);

  if (fillerCount >= 2 || (fillerRatio > 0.05 && tokens >= 35)) {
    const estimatedSavings = Math.max(2, Math.round(tokens * fillerRatio * 0.6));
    suggestions.push({
      id: `verbosity-filler-${Date.now()}`,
      type: 'verbosity',
      message: `~${fillerCount} weak/filler words found. Tighten phrasing to save tokens.`,
      originalText: '',
      suggestedText: '',
      tokenSavings: estimatedSavings,
      priority: estimatedSavings > 15 ? 'high' : 'medium',
    });
  }

  return suggestions;
}

function detectLengthHint(text: string): Suggestion[] {
  const tokens = quickEstimate(text);
  if (tokens < 120) return [];

  return [{
    id: `length-hint-${Date.now()}`,
    type: 'verbosity',
    message: `Prompt is ~${tokens} tokens. Move background context to a file or shorten to essentials.`,
    originalText: '',
    suggestedText: '',
    tokenSavings: Math.round(tokens * 0.2),
    priority: tokens > 250 ? 'high' : 'medium',
  }];
}

function detectFormattingWaste(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  const blankLineMatches = text.match(/\n{3,}/g);
  if (blankLineMatches) {
    const totalExtraLines = blankLineMatches.reduce((sum, m) => sum + m.length - 2, 0);
    if (totalExtraLines > 2) {
      suggestions.push({
        id: `formatting-blanks-${Date.now()}`,
        type: 'formatting',
        message: `${totalExtraLines} extra blank lines can be removed`,
        originalText: '',
        suggestedText: '',
        tokenSavings: Math.ceil(totalExtraLines * 0.5),
        priority: 'low',
      });
    }
  }

  const excessiveSpaces = text.match(/ {4,}/g);
  if (excessiveSpaces && excessiveSpaces.length > 3) {
    const totalExtraSpaces = excessiveSpaces.reduce((sum, m) => sum + m.length - 2, 0);
    suggestions.push({
      id: `formatting-spaces-${Date.now()}`,
      type: 'formatting',
      message: 'Excessive indentation/spacing detected. Consider normalizing whitespace.',
      originalText: '',
      suggestedText: '',
      tokenSavings: Math.ceil(totalExtraSpaces / 4),
      priority: 'low',
    });
  }

  const decorativeMatches = text.match(/[=\-*~_]{5,}/g);
  if (decorativeMatches && decorativeMatches.length > 1) {
    suggestions.push({
      id: `formatting-decorative-${Date.now()}`,
      type: 'formatting',
      message: `${decorativeMatches.length} decorative separators found. Use minimal formatting.`,
      originalText: '',
      suggestedText: '',
      tokenSavings: quickEstimate(decorativeMatches.join('')),
      priority: 'low',
    });
  }

  return suggestions;
}

function dedupeSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const result: Suggestion[] = [];

  for (const s of suggestions) {
    const key = `${s.type}:${s.originalText.toLowerCase()}:${s.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(s);
  }

  return result;
}

function similarityScore(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  return overlap / Math.max(wordsA.size, wordsB.size);
}

/**
 * Apply a suggestion to the prompt text.
 */
export function applySuggestion(text: string, suggestion: Suggestion): string {
  if (!suggestion.originalText) return text;

  let result = replaceFirst(text, suggestion.originalText, suggestion.suggestedText);
  if (result !== text) {
    return normalizeSpacing(result);
  }

  const lowerText = text.toLowerCase();
  const lowerOriginal = suggestion.originalText.toLowerCase();
  const lowerIndex = lowerText.indexOf(lowerOriginal);
  if (lowerIndex === -1) return text;

  result =
    text.slice(0, lowerIndex) +
    suggestion.suggestedText +
    text.slice(lowerIndex + suggestion.originalText.length);

  return normalizeSpacing(result);
}

function replaceFirst(text: string, search: string, replacement: string): string {
  const index = text.indexOf(search);
  if (index === -1) return text;
  return text.slice(0, index) + replacement + text.slice(index + search.length);
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^ +/gm, '')
    .trim();
}

/**
 * Get total potential savings from all suggestions.
 */
export function getTotalSavings(suggestions: Suggestion[]): number {
  return suggestions.reduce((total, s) => total + s.tokenSavings, 0);
}

/**
 * Apply all non-overlapping suggestions that have originalText, highest savings first.
 */
export function applyAllSuggestions(text: string, suggestions: Suggestion[]): string {
  const applicable = suggestions
    .filter((s) => s.originalText && s.originalText.length > 0)
    .sort((a, b) => b.tokenSavings - a.tokenSavings);

  let result = text;
  const appliedRanges: Array<{ start: number; end: number }> = [];

  for (const suggestion of applicable) {
    const lowerResult = result.toLowerCase();
    const lowerOriginal = suggestion.originalText.toLowerCase();
    const index = lowerResult.indexOf(lowerOriginal);
    if (index === -1) continue;

    const end = index + suggestion.originalText.length;
    const overlaps = appliedRanges.some(
      (r) => !(end <= r.start || index >= r.end)
    );
    if (overlaps) continue;

    result = applySuggestion(result, suggestion);
    appliedRanges.push({ start: index, end: index + suggestion.suggestedText.length });
  }

  return normalizeSpacing(result);
}
