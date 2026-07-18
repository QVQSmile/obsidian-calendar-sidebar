import type { JournalEntry } from './types';

export interface JournalStats {
  currentStreak: number;
  longestStreak: number;
  monthCompletionRate: number;
  moodDistribution: Record<string, number>;
  labelCounts: Record<string, number>;
  trend: Array<{ date: string; score?: number }>;
}

function dateOnly(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return dateOnly(value);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function uniqueDates(entries: JournalEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.date))).sort();
}

export function calculateJournalStats(entries: JournalEntry[], today = new Date()): JournalStats {
  const dates = uniqueDates(entries);
  const dateSet = new Set(dates);
  let currentStreak = 0;
  let cursor = dateOnly(today);
  if (!dateSet.has(cursor)) cursor = shiftDate(cursor, -1);
  while (dateSet.has(cursor)) {
    currentStreak++;
    cursor = shiftDate(cursor, -1);
  }

  let longestStreak = 0;
  let run = 0;
  let previous: string | undefined;
  for (const date of dates) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = date;
  }

  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const todayString = dateOnly(today);
  const recordedThisMonth = dates.filter((date) => date.startsWith(monthPrefix) && date <= todayString).length;
  const monthCompletionRate = Math.round((recordedThisMonth / daysInMonth(today)) * 100);
  const moodDistribution: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.mood) {
      const key = String(entry.mood.score);
      moodDistribution[key] = (moodDistribution[key] ?? 0) + 1;
      for (const label of entry.mood.labels) labelCounts[label] = (labelCounts[label] ?? 0) + 1;
    }
  }
  return {
    currentStreak,
    longestStreak,
    monthCompletionRate,
    moodDistribution,
    labelCounts,
    trend: entries
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14)
      .map((entry) => ({ date: entry.date, score: entry.mood?.score })),
  };
}
