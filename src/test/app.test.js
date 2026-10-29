import { describe, it, expect } from 'vitest';
import { renderApp } from '../app.js';


describe('renderApp', () => {
  it('should render the app without errors', () => {
    const app = renderApp();
    expect(app).not.toBeNull();
  });
});