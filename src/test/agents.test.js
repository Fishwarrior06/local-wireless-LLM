import { describe, it, expect } from 'vitest';
import { loadAgents } from '../agents/agents.js';

describe('loadAgents', () => {
  it('should load agents from AGENTS.md', async () => {
    const agents = await loadAgents();
    expect(agents).toBeInstanceOf(Array);
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty('name');
    expect(agents[0]).toHaveProperty('description');
    expect(agents[0]).toHaveProperty('prompt');
  });
});