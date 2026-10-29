import { describe, it, expect } from 'vitest';
import { formatPrompt, sanitizeInput } from '../utils.js';


describe('formatPrompt', () => {
  it('should format prompt correctly', () => {
    const result = formatPrompt('Hello {{name}}', { name: 'World' });
    expect(result).toBe('Hello World');
  });
});

describe('sanitizeInput', () => {
  it('should sanitize input correctly', () => {
    const result = sanitizeInput('<script>alert("xss")</script>');
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });
});