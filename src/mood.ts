export type MoodScore = -2 | -1 | 0 | 1 | 2;

export const MOOD_LEVELS = [
  { score: -2 as MoodScore, icon: 'frown', label: 'Very low', color: '#c2415d' },
  { score: -1 as MoodScore, icon: 'cloud-drizzle', label: 'Low', color: '#d97745' },
  { score: 0 as MoodScore, icon: 'meh', label: 'Neutral', color: '#a18442' },
  { score: 1 as MoodScore, icon: 'smile', label: 'Good', color: '#4d9b70' },
  { score: 2 as MoodScore, icon: 'laugh', label: 'Very good', color: '#3689a4' },
];

export const MOOD_LABELS = [
  { id: 'calm', label: 'Calm' },
  { id: 'grateful', label: 'Grateful' },
  { id: 'anxious', label: 'Anxious' },
  { id: 'tired', label: 'Tired' },
  { id: 'energized', label: 'Energized' },
  { id: 'hopeful', label: 'Hopeful' },
  { id: 'sad', label: 'Sad' },
  { id: 'focused', label: 'Focused' },
];

export function moveMoodScore(score: MoodScore | null, direction: -1 | 1): MoodScore {
  const current = score === null ? 2 : score;
  const index = MOOD_LEVELS.findIndex((level) => level.score === current);
  return MOOD_LEVELS[Math.max(0, Math.min(MOOD_LEVELS.length - 1, index + direction))].score;
}
