import { analyzePrompt, applySuggestion } from '../src/utils/prompt-analyzer';

describe('analyzePrompt', () => {
  test('returns empty for blank input', () => {
    expect(analyzePrompt('')).toEqual([]);
    expect(analyzePrompt('   ')).toEqual([]);
  });

  test('detects classic filler-heavy prompt', () => {
    const text =
      'Can you please help me understand basically how this works? I was wondering if you could explain it in order to learn better.';
    const suggestions = analyzePrompt(text);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.type === 'filler')).toBe(true);
  });

  test('detects suggestions in natural casual writing', () => {
    const text =
      'Hey, I am working on a React app and I really need help with state management. Could you tell me the best approach?';
    const suggestions = analyzePrompt(text);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  test('detects weak words in simple prompts', () => {
    const text = 'I just need a very simple explanation of how APIs work.';
    const suggestions = analyzePrompt(text);
    expect(suggestions.some((s) => s.message.toLowerCase().includes('weak word'))).toBe(true);
  });

  test('detects multiple questions', () => {
    const text = 'What is React? How does state work? Why use hooks?';
    const suggestions = analyzePrompt(text);
    expect(suggestions.some((s) => s.message.includes('questions'))).toBe(true);
  });

  test('detects long sentence verbosity', () => {
    const text =
      'I have been building a full stack application for the last three months using React on the frontend and Node on the backend and I keep running into issues with authentication sessions expiring too quickly when users leave the tab open for a long time during the day.';
    const suggestions = analyzePrompt(text);
    expect(suggestions.some((s) => s.message.includes('Long sentence'))).toBe(true);
  });

  test('detects length hint for very long prompts', () => {
    const text = 'word '.repeat(200);
    const suggestions = analyzePrompt(text);
    expect(suggestions.some((s) => s.message.includes('tokens'))).toBe(true);
  });

  test('applySuggestion removes filler phrase', () => {
    const text = 'Can you please explain this?';
    const suggestions = analyzePrompt(text);
    const filler = suggestions.find((s) => s.originalText);
    expect(filler).toBeDefined();
    const updated = applySuggestion(text, filler!);
    expect(updated.toLowerCase()).not.toContain('can you please');
  });

  test('detects Gen Z casual filler words', () => {
    const text = 'like can you like help me with this idk how to do it ngl';
    const suggestions = analyzePrompt(text);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.message.toLowerCase().includes('like'))).toBe(true);
    expect(suggestions.some((s) => s.message.toLowerCase().includes('idk'))).toBe(true);
    expect(suggestions.some((s) => s.message.toLowerCase().includes('ngl'))).toBe(true);
  });

  test('detects casual hedges', () => {
    const text = 'tbh i kinda know how to do this lowkey';
    const suggestions = analyzePrompt(text);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.message.toLowerCase().includes('kinda'))).toBe(true);
    expect(suggestions.some((s) => s.message.toLowerCase().includes('lowkey'))).toBe(true);
  });
});
