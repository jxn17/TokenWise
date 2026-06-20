import { buildContinuationContext, type ExportMessage } from '../src/utils/context-exporter';

describe('context-exporter', () => {
  it('should generate markdown export for messages', () => {
    const messages: ExportMessage[] = [
      { role: 'user', content: 'Hello!' },
      { role: 'assistant', content: 'Hi there, how can I help?' },
      { role: 'user', content: 'Write a long script.' }
    ];

    const result = buildContinuationContext(messages, { maxTokens: 5000, recentTurnPairs: 5 });
    
    expect(result).toContain('# Chat continuation context');
    expect(result).toContain('## Original goal');
    expect(result).toContain('Hello!');
    expect(result).toContain('## Recent conversation (last ~5 turns)');
    expect(result).toContain('Hi there, how can I help?');
    expect(result).toContain('Write a long script.');
  });

  it('should truncate messages if total length exceeds limit', () => {
    const messages: ExportMessage[] = [
      { role: 'user', content: 'Message one is here. '.repeat(100) },
      { role: 'assistant', content: 'Message two is here. '.repeat(100) },
      { role: 'user', content: 'Message three is here. '.repeat(100) }
    ];

    const result = buildContinuationContext(messages, { maxTokens: 50, recentTurnPairs: 1 });
    
    // Should end with the truncation message
    expect(result).toContain('...(trimmed to fit token budget)');
  });
});
