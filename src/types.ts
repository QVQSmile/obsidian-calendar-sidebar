export type WeatherUnits = 'metric' | 'imperial';

export interface WeatherSettings {
  weatherLatitude: string | number;
  weatherLongitude: string | number;
  weatherUnits: WeatherUnits | string;
  weatherTimezone?: string;
}

export interface WeatherSnapshot {
  date?: string;
  fetchedAt?: string;
  cachedAt?: string;
  latitude?: number | string;
  longitude?: number | string;
  units?: WeatherUnits | string;
  configKey?: string;
  location?: string;
  [key: string]: unknown;
}

export interface ExifField {
  key: string;
  value: string;
}

export type JournalSourceType = 'daily' | 'journal' | 'external';

export interface JournalSource {
  id: string;
  path: string;
  type: JournalSourceType;
  enabled?: boolean;
  dateField?: string;
  label?: string;
}

export interface MoodRecord {
  score: -2 | -1 | 0 | 1 | 2;
  labels: string[];
  recordedAt: string;
  updatedAt: string;
}

export interface MoodMetadata {
  schemaVersion: 1;
  entries: Record<string, MoodRecord>;
  orphans?: Record<string, { record: MoodRecord; orphanedAt: string }>;
}

export interface JournalEntry {
  path: string;
  date: string;
  title: string;
  excerpt: string;
  sourceId: string;
  sourcePath: string;
  sourceType: JournalSourceType;
  favorite: boolean;
  uuid?: string;
  createdAt?: string;
  modifiedAt?: string;
  location?: { name?: string; latitude?: number; longitude?: number };
  attachments: string[];
  weather?: WeatherSnapshot;
  mood?: MoodRecord;
  activity?: unknown;
  frontmatter: Record<string, unknown>;
}

export interface JournalDiagnostic {
  path: string;
  reason: 'outside-source' | 'missing-date' | 'invalid-date' | 'read-failed';
  detail?: string;
}

export interface JournalFilter {
  query?: string;
  from?: string;
  to?: string;
  sourceId?: string;
  moodScore?: number;
  favoriteOnly?: boolean;
}
