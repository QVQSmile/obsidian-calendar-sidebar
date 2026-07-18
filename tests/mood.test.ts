import { describe, expect, it } from 'vitest';
import { MOOD_LABELS, MOOD_LEVELS, moveMoodScore } from '../src/mood';

describe('mood picker choices', () => {
  it('provides five ordered levels and optional labels', () => {
    expect(MOOD_LEVELS.map((level) => level.score)).toEqual([-2, -1, 0, 1, 2]);
    expect(MOOD_LABELS.map((label) => label.id)).toContain('calm');
    expect(MOOD_LABELS.map((label) => label.id)).toContain('grateful');
  });

  it('moves by keyboard direction and clamps at both ends', () => {
    expect(moveMoodScore(null, 1)).toBe(2);
    expect(moveMoodScore(2, 1)).toBe(2);
    expect(moveMoodScore(-2, -1)).toBe(-2);
    expect(moveMoodScore(0, 1)).toBe(1);
  });
});
