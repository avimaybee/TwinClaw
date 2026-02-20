import { describe, expect, it } from 'vitest';
import {
  normalizeBrowserReferenceCandidates,
  type BrowserReferenceCandidate,
} from '../../src/services/browser-service.js';

describe('normalizeBrowserReferenceCandidates', () => {
  it('assigns deterministic refs and stable ordering by viewport position', () => {
    const candidates: BrowserReferenceCandidate[] = [
      {
        selector: 'body > main > button:nth-of-type(2)',
        role: 'button',
        name: 'Save',
        bounds: { x: 100, y: 220, width: 80, height: 30 },
      },
      {
        selector: 'body > header > a:nth-of-type(1)',
        role: 'link',
        name: 'Home',
        bounds: { x: 12, y: 24, width: 70, height: 24 },
      },
      {
        selector: 'body > main > button:nth-of-type(1)',
        role: 'button',
        name: 'Cancel',
        bounds: { x: 10, y: 220, width: 88, height: 30 },
      },
    ];

    const firstPass = normalizeBrowserReferenceCandidates(candidates);
    const secondPass = normalizeBrowserReferenceCandidates(candidates);

    expect(firstPass).toEqual(secondPass);
    expect(firstPass.map((entry) => entry.ref)).toEqual(['ref-001', 'ref-002', 'ref-003']);
    expect(firstPass.map((entry) => entry.selector)).toEqual([
      'body > header > a:nth-of-type(1)',
      'body > main > button:nth-of-type(1)',
      'body > main > button:nth-of-type(2)',
    ]);
  });

  it('normalizes invalid values and removes exact duplicate candidates', () => {
    const candidates: BrowserReferenceCandidate[] = [
      {
        selector: ' #submit ',
        role: null,
        name: null,
        bounds: { x: Number.NaN, y: 12.445, width: -20, height: 44.444 },
      },
      {
        selector: '#submit',
        role: null,
        name: null,
        bounds: { x: Number.NaN, y: 12.445, width: -20, height: 44.444 },
      },
    ];

    const entries = normalizeBrowserReferenceCandidates(candidates);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      ref: 'ref-001',
      selector: '#submit',
      role: 'generic',
      name: '',
      bounds: { x: 0, y: 12.45, width: 0, height: 44.44 },
    });
  });
});
