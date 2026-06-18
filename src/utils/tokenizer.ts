/**
 * TokenWise Tokenizer Engine
 *
 * Provides token counting for GPT-family models via js-tiktoken,
 * and heuristic-based counting for Claude/Gemini models.
 * All processing is 100% local — no external API calls.
 */

import { getEncoding, Tiktoken } from 'js-tiktoken';

// ── Type Definitions ──────────────────────────────────────────────

export type ModelType =
  | 'gpt-4'
  | 'gpt-4o'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  | 'claude-sonnet'
  | 'claude-opus'
  | 'claude-haiku'
  | 'gemini-pro'
  | 'gemini-ultra'
  | 'gemini-flash';

export type ImageDetail = 'low' | 'high';

export interface TokenCount {
  tokens: number;
  characters: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ── Constants ─────────────────────────────────────────────────────

const MAX_INPUT_LENGTH = 100_000;
const HEURISTIC_CHARS_PER_TOKEN = 3.8;
const MESSAGE_OVERHEAD_TOKENS = 4; // per-message framing overhead

const GPT_MODELS: ReadonlySet<string> = new Set([
  'gpt-4',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
]);

// ── Encoder Cache ─────────────────────────────────────────────────

let cl100kEncoder: Tiktoken | null = null;
let o200kEncoder: Tiktoken | null = null;

function getGptEncoder(model: ModelType): Tiktoken {
  try {
    if (model === 'gpt-4o') {
      if (!o200kEncoder) {
        o200kEncoder = getEncoding('o200k_base');
      }
      return o200kEncoder;
    }
    if (!cl100kEncoder) {
      cl100kEncoder = getEncoding('cl100k_base');
    }
    return cl100kEncoder;
  } catch {
    // Fallback: if encoding data fails to load, return a mock that uses heuristic
    return {
      encode: (text: string) => new Array(Math.ceil(text.length / HEURISTIC_CHARS_PER_TOKEN)),
      free: () => {},
    } as unknown as Tiktoken;
  }
}

// ── Core Functions ────────────────────────────────────────────────

/**
 * Count tokens for a given text string and model.
 * GPT-family models use js-tiktoken for accurate BPE counting.
 * Claude and Gemini models use a character-based heuristic.
 *
 * Input is capped at MAX_INPUT_LENGTH characters to prevent DoS.
 */
export function countTokens(text: string, model: ModelType): TokenCount {
  if (!text || text.length === 0) {
    return { tokens: 0, characters: 0 };
  }

  // Cap input length to prevent DoS via extremely large inputs
  const safeText = text.length > MAX_INPUT_LENGTH
    ? text.slice(0, MAX_INPUT_LENGTH)
    : text;

  const characters = safeText.length;

  if (GPT_MODELS.has(model)) {
    try {
      const encoder = getGptEncoder(model);
      const encoded = encoder.encode(safeText);
      return { tokens: encoded.length, characters };
    } catch {
      // Fallback to heuristic if encoding fails
      return {
        tokens: Math.ceil(characters / HEURISTIC_CHARS_PER_TOKEN),
        characters,
      };
    }
  }

  // Claude / Gemini heuristic
  return {
    tokens: Math.ceil(characters / HEURISTIC_CHARS_PER_TOKEN),
    characters,
  };
}

/**
 * Estimate token cost of an image based on dimensions and detail level.
 *
 * Low detail:  Fixed 85 tokens
 * High detail: 170 * ceil(width/512) * ceil(height/512) + 85
 */
export function estimateImageTokens(
  width: number,
  height: number,
  detail: ImageDetail = 'high'
): number {
  if (width <= 0 || height <= 0) {
    return 0;
  }

  if (detail === 'low') {
    return 85;
  }

  const tilesX = Math.ceil(width / 512);
  const tilesY = Math.ceil(height / 512);
  return 170 * tilesX * tilesY + 85;
}

/**
 * Estimate total token cost of a conversation (all messages combined).
 * Adds a per-message overhead for framing tokens.
 */
export function estimateConversationTokens(
  messages: Message[],
  model: ModelType = 'gpt-4o'
): number {
  if (!messages || messages.length === 0) {
    return 0;
  }

  let total = 0;
  for (const message of messages) {
    if (message.content) {
      const { tokens } = countTokens(message.content, model);
      total += tokens + MESSAGE_OVERHEAD_TOKENS;
    }
  }

  // Add base overhead for conversation framing
  total += 3;

  return total;
}

/**
 * Quick heuristic token count (no model needed).
 * Used for fast estimates in non-critical paths.
 */
export function quickEstimate(text: string): number {
  if (!text || text.length === 0) return 0;
  const safeText = text.length > MAX_INPUT_LENGTH
    ? text.slice(0, MAX_INPUT_LENGTH)
    : text;
  return Math.ceil(safeText.length / HEURISTIC_CHARS_PER_TOKEN);
}

/**
 * Cleanup function to free encoder resources.
 */
export function freeEncoders(): void {
  try {
    if (cl100kEncoder) {
      const enc = cl100kEncoder as Tiktoken & { free?: () => void };
      enc.free?.();
      cl100kEncoder = null;
    }
    if (o200kEncoder) {
      const enc = o200kEncoder as Tiktoken & { free?: () => void };
      enc.free?.();
      o200kEncoder = null;
    }
  } catch {
    // Silently ignore cleanup errors
  }
}
