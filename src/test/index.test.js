import { describe, it, expect } from 'vitest';
import { init } from '../index.js';


describe('init', () => {
  it('should initialize the app without errors', () => {
    expect(() => init()).not.toThrow();
  });
});