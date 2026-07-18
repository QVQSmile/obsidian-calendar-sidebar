import { describe, expect, it } from 'vitest';
import { calculateJournalStats } from '../src/journal-stats';
import type { JournalEntry } from '../src/types';

function entry(date: string, score?: -2 | -1 | 0 | 1 | 2): JournalEntry {
  return {
    path: `${date}.md`, date, title: date, excerpt: '', sourceId: 'daily', sourcePath: 'Calendar/Daily',
    sourceType: 'daily', favorite: false, attachments: [],
    mood: score === undefined ? undefined : { score, labels: ['calm'], recordedAt: date, updatedAt: date },
    frontmatter: {},
  };
}

describe('journal stats', () => {
  it('calculates current and longest streaks and mood distribution', () => {
    const stats = calculateJournalStats([
      entry('2026-07-15', 1), entry('2026-07-16', 2), entry('2026-07-18', -1),
    ], new Date(2026, 6, 18, 12));
    expect(stats.currentStreak).toBe(1);
    expect(stats.longestStreak).toBe(2);
    expect(stats.moodDistribution).toEqual({ '1': 1, '2': 1, '-1': 1 });
    expect(stats.labelCounts.calm).toBe(3);
  });
});
