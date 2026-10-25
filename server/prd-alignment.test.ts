import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coresLine, engineerTutorial, gatesLine, pilotTutorial, RESULTS_NOTE, SWAP_HINT } from '../src/shared/copy.js';
import { COLOR_TOKENS } from '../src/shared/tokens.js';

// The PRD is the source of truth (AGENTS.md). These checks read it, so a rule,
// copy, or palette change that skips the PRD, or the code, fails here. Kept
// under server/ because that build has Node's file APIs.
const prd = readFileSync(new URL('../rival-rockets-prd.md', import.meta.url), 'utf8');

describe('PRD 4 tutorial and results copy', () => {
  it('matches the PRD tutorials word for word', () => {
    expect(prd).toContain(`**Pilot tutorial:** “${pilotTutorial()}”`);
    expect(prd).toContain(`**Engineer tutorial:** “${engineerTutorial()}”`);
  });

  it('matches the PRD results explanation and swap hint', () => {
    expect(prd).toContain(`Explain “${RESULTS_NOTE}”`);
    expect(prd).toContain(`**Rematch/role-swap hint:** “${SWAP_HINT}”`);
    const score = { crossings: 3, checkpointPoints: 75, carried: 2, corePoints: 20, total: 95 };
    expect(gatesLine(score)).toBe('Gates: 3 × 25 = 75');
    expect(coresLine(score)).toBe('Cores held: 2 × 10 = 20');
  });
});

describe('PRD 7.3 palette', () => {
  it('lists every color token with its exact hex value', () => {
    for (const [token, hex] of Object.entries(COLOR_TOKENS)) {
      expect(prd).toMatch(new RegExp(`\\| \`${token}\` \\| \`${hex}\` \\|`));
    }
  });
});
