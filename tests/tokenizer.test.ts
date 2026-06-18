import {
  countTokens,
  estimateImageTokens,
  estimateConversationTokens,
  quickEstimate,
  type Message,
} from '../src/utils/tokenizer';

describe('countTokens', () => {
  test('returns zero for empty string', () => {
    expect(countTokens('', 'gpt-4o')).toEqual({ tokens: 0, characters: 0 });
  });

  test('returns zero for null-like empty input', () => {
    expect(countTokens('', 'claude-sonnet')).toEqual({ tokens: 0, characters: 0 });
  });

  test('counts simple English text with GPT model', () => {
    const result = countTokens('Hello, world!', 'gpt-4o');
    expect(result.characters).toBe(13);
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.tokens).toBeLessThan(10);
  });

  test('uses heuristic for Claude models (chars / 3.8)', () => {
    const text = 'a'.repeat(38);
    const result = countTokens(text, 'claude-sonnet');
    expect(result.characters).toBe(38);
    expect(result.tokens).toBe(10);
  });

  test('uses heuristic for Gemini models', () => {
    const text = 'Hello Gemini';
    const result = countTokens(text, 'gemini-pro');
    expect(result.tokens).toBe(Math.ceil(text.length / 3.8));
  });

  test('handles emojis without throwing', () => {
    const text = 'Hello 👋🌍🎉';
    const gpt = countTokens(text, 'gpt-4o');
    const claude = countTokens(text, 'claude-haiku');
    expect(gpt.tokens).toBeGreaterThan(0);
    expect(claude.tokens).toBeGreaterThan(0);
    expect(gpt.characters).toBe(text.length);
  });

  test('handles code snippets', () => {
    const code = 'function add(a, b) {\n  return a + b;\n}';
    const result = countTokens(code, 'gpt-4');
    expect(result.characters).toBe(code.length);
    expect(result.tokens).toBeGreaterThan(5);
  });

  test('handles Unicode and CJK characters', () => {
    const text = 'こんにちは世界 مرحبا 你好';
    const result = countTokens(text, 'gpt-4o');
    expect(result.characters).toBe(text.length);
    expect(result.tokens).toBeGreaterThan(0);
  });

  test('caps input at 100,000 characters', () => {
    const longText = 'x'.repeat(150_000);
    const result = countTokens(longText, 'claude-opus');
    expect(result.characters).toBe(100_000);
    expect(result.tokens).toBe(Math.ceil(100_000 / 3.8));
  });

  test('very long string produces reasonable token count', () => {
    const longText = 'word '.repeat(10_000);
    const result = countTokens(longText, 'gpt-3.5-turbo');
    expect(result.tokens).toBeGreaterThan(1000);
    expect(result.characters).toBe(longText.length);
  });
});

describe('estimateImageTokens', () => {
  test('returns 85 for low detail regardless of size', () => {
    expect(estimateImageTokens(1024, 768, 'low')).toBe(85);
    expect(estimateImageTokens(4096, 4096, 'low')).toBe(85);
  });

  test('returns 0 for invalid dimensions', () => {
    expect(estimateImageTokens(0, 100, 'high')).toBe(0);
    expect(estimateImageTokens(100, -1, 'high')).toBe(0);
  });

  test('calculates high detail tiles correctly', () => {
    // 512x512 = 1 tile → 170 * 1 + 85 = 255
    expect(estimateImageTokens(512, 512, 'high')).toBe(255);
    // 1024x1024 = 2x2 tiles → 170 * 4 + 85 = 765
    expect(estimateImageTokens(1024, 1024, 'high')).toBe(765);
  });

  test('defaults to high detail', () => {
    expect(estimateImageTokens(512, 512)).toBe(255);
  });
});

describe('estimateConversationTokens', () => {
  test('returns 0 for empty messages array', () => {
    expect(estimateConversationTokens([], 'gpt-4o')).toBe(0);
  });

  test('returns 0 for null/undefined messages', () => {
    expect(estimateConversationTokens(null as unknown as Message[], 'gpt-4o')).toBe(0);
  });

  test('sums tokens across multiple messages with overhead', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const total = estimateConversationTokens(messages, 'gpt-4o');
    const msg1 = countTokens('Hello', 'gpt-4o').tokens;
    const msg2 = countTokens('Hi there!', 'gpt-4o').tokens;
    // 4 overhead per message + 3 base framing
    expect(total).toBe(msg1 + 4 + msg2 + 4 + 3);
  });

  test('skips messages with empty content', () => {
    const messages: Message[] = [
      { role: 'user', content: '' },
      { role: 'assistant', content: 'Response' },
    ];
    const total = estimateConversationTokens(messages, 'claude-sonnet');
    const responseTokens = countTokens('Response', 'claude-sonnet').tokens;
    expect(total).toBe(responseTokens + 4 + 3);
  });
});

describe('quickEstimate', () => {
  test('returns 0 for empty string', () => {
    expect(quickEstimate('')).toBe(0);
  });

  test('uses chars/3.8 heuristic', () => {
    expect(quickEstimate('abcdefgh')).toBe(Math.ceil(8 / 3.8));
  });
});
