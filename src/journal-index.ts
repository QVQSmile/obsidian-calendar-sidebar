import {
  isPathInFolder,
  normalizeVaultPath,
  parseDateFromFilename,
  parseDateString,
} from './date-utils';
import { extractExcerpt } from './excerpt';
import type {
  JournalDiagnostic,
  JournalEntry,
  JournalFilter,
  JournalSource,
  MoodRecord,
} from './types';

export const DEFAULT_JOURNAL_SOURCES: JournalSource[] = [
  { id: 'daily', path: 'Calendar/Daily', type: 'daily', label: 'Daily notes' },
  { id: 'entries', path: 'Calendar/Entries', type: 'journal', label: 'Journal entries' },
];

export interface JournalIndexSettings {
  dailyFolder?: string;
  journalSources?: JournalSource[];
}

type Listener = (entries: JournalEntry[]) => void;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readField(frontmatter: Record<string, unknown>, field: string): unknown {
  const wanted = field.toLowerCase();
  const key = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? frontmatter[key] : undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function parseConfiguredDate(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const date = parseConfiguredDate(item);
      if (date) return date;
    }
    return null;
  }
  return parseDateString(value);
}

export function resolveJournalDate(
  fileName: string,
  frontmatter: Record<string, unknown>,
  configuredDateField?: string,
): { date: string | null; reason?: JournalDiagnostic['reason'] } {
  if (configuredDateField) {
    const configuredValue = readField(frontmatter, configuredDateField);
    if (configuredValue !== undefined) {
      const configuredDate = parseConfiguredDate(configuredValue);
      return configuredDate
        ? { date: configuredDate }
        : { date: null, reason: 'invalid-date' };
    }
  }

  for (const field of ['date', 'creationDate']) {
    const value = readField(frontmatter, field);
    const date = parseConfiguredDate(value);
    if (date) return { date };
    if (value !== undefined) return { date: null, reason: 'invalid-date' };
  }

  const filenameDate = parseDateFromFilename(fileName);
  return filenameDate
    ? { date: filenameDate }
    : { date: null, reason: /^(\d{4})-(\d{2})-(\d{2})(?=$|[ _-])/i.test(fileName.replace(/\.md$/i, ''))
      ? 'invalid-date'
      : 'missing-date' };
}

function asBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
  return false;
}

function parseNumber(value: unknown): number | undefined {
  const result = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(result) ? result : undefined;
}

export function normalizeLocation(frontmatter: Record<string, unknown>): JournalEntry['location'] {
  const raw = readField(frontmatter, 'location');
  const location = typeof raw === 'string' ? { name: raw.trim() } : asRecord(raw);
  const coordinates = readField(frontmatter, 'coordinates') ?? location.coordinates;
  let latitude = parseNumber(readField(frontmatter, 'latitude') ?? location.latitude);
  let longitude = parseNumber(readField(frontmatter, 'longitude') ?? location.longitude);

  if ((latitude === undefined || longitude === undefined) && typeof coordinates === 'string') {
    const values = coordinates.split(/[;,\s]+/).map((value) => parseNumber(value));
    if (values.length >= 2 && values[0] !== undefined && values[1] !== undefined) {
      latitude = values[0];
      longitude = values[1];
    }
  }

  const name = firstString(location.name ?? raw);
  if (!name && latitude === undefined && longitude === undefined) return undefined;
  return { name, latitude, longitude };
}

function titleFromContent(fileName: string, content: string, frontmatter: Record<string, unknown>): string {
  const explicit = firstString(readField(frontmatter, 'title'));
  if (explicit) return explicit;
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  return heading || fileName.replace(/\.md$/i, '');
}

function sourceForPath(path: string, sources: JournalSource[]): JournalSource | undefined {
  return sources.find((source) => source.enabled !== false && isPathInFolder(path, source.path));
}

function moodFromFrontmatter(frontmatter: Record<string, unknown>): MoodRecord | undefined {
  const score = parseNumber(readField(frontmatter, 'mood'));
  if (score !== -2 && score !== -1 && score !== 0 && score !== 1 && score !== 2) return undefined;
  const rawLabels = readField(frontmatter, 'mood_labels');
  const labels = Array.isArray(rawLabels)
    ? rawLabels.map(String).map((value) => value.trim()).filter(Boolean)
    : typeof rawLabels === 'string'
      ? rawLabels.split(',').map((value) => value.trim()).filter(Boolean)
      : [];
  const now = new Date().toISOString();
  return { score, labels, recordedAt: now, updatedAt: now };
}

function mediaLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' ? [value] : [];
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    const record = asRecord(item);
    return [record.link, record.url, record.path].filter((candidate): candidate is string => typeof candidate === 'string');
  });
}

export class JournalIndex {
  private readonly app: any;
  private readonly getMood: (path: string) => MoodRecord | undefined;
  private readonly entries = new Map<string, JournalEntry>();
  private readonly diagnostics: JournalDiagnostic[] = [];
  private readonly listeners = new Set<Listener>();
  private refreshToken = 0;
  private refreshPromise: Promise<void> | null = null;
  private currentSources: JournalSource[] = [];

  constructor(app: any, getMood: (path: string) => MoodRecord | undefined = () => undefined) {
    this.app = app;
    this.getMood = getMood;
  }

  get sources(): JournalSource[] {
    return this.currentSources.slice();
  }

  getDiagnostics(): JournalDiagnostic[] {
    return this.diagnostics.slice();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getEntries(): JournalEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));
  }

  filter(filter: JournalFilter = {}): JournalEntry[] {
    const query = filter.query?.trim().toLowerCase();
    return this.getEntries().filter((entry) => {
      if (filter.from && entry.date < filter.from) return false;
      if (filter.to && entry.date > filter.to) return false;
      if (filter.sourceId && entry.sourceId !== filter.sourceId) return false;
      if (filter.moodScore !== undefined && entry.mood?.score !== filter.moodScore) return false;
      if (filter.favoriteOnly && !entry.favorite) return false;
      if (query && !`${entry.title} ${entry.excerpt} ${entry.path}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }

  async refresh(settings: JournalIndexSettings): Promise<void> {
    const token = ++this.refreshToken;
    if (this.refreshPromise) await this.refreshPromise;
    const promise = this.rebuild(settings, token);
    this.refreshPromise = promise;
    try {
      await promise;
    } finally {
      if (this.refreshPromise === promise) this.refreshPromise = null;
    }
  }

  async refreshFile(path: string, settings: JournalIndexSettings): Promise<void> {
    const normalizedPath = normalizeVaultPath(path);
    this.entries.delete(normalizedPath);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file) {
      const entry = await this.readEntry(file, this.resolveSources(settings));
      if (entry) this.entries.set(entry.path, entry);
    }
    this.emit();
  }

  removeFile(path: string): void {
    this.entries.delete(normalizeVaultPath(path));
    this.emit();
  }

  renameFile(oldPath: string, newPath: string): void {
    const oldKey = normalizeVaultPath(oldPath);
    const entry = this.entries.get(oldKey);
    this.entries.delete(oldKey);
    if (entry) this.entries.set(normalizeVaultPath(newPath), { ...entry, path: normalizeVaultPath(newPath) });
    this.emit();
  }

  async detectSources(settings: JournalIndexSettings): Promise<{ files: number; noDate: string[]; fields: Record<string, number> }> {
    const sources = this.resolveSources(settings);
    const files = this.app.vault.getMarkdownFiles?.() ?? [];
    const noDate: string[] = [];
    const fields: Record<string, number> = {};
    for (const file of files) {
      const source = sourceForPath(file.path, sources);
      if (!source) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = asRecord(cache?.frontmatter);
      const resolved = resolveJournalDate(file.name, frontmatter, source.dateField);
      if (!resolved.date) noDate.push(file.path);
      const used = resolved.date
        ? (source.dateField && readField(frontmatter, source.dateField) !== undefined
          ? source.dateField
          : readField(frontmatter, 'date') !== undefined
            ? 'date'
            : readField(frontmatter, 'creationDate') !== undefined
              ? 'creationDate'
              : 'filename')
        : 'unrecognized';
      fields[used] = (fields[used] ?? 0) + 1;
    }
    return { files: files.filter((file: any) => sourceForPath(file.path, sources)).length, noDate, fields };
  }

  resolveSources(settings: JournalIndexSettings): JournalSource[] {
    const configured = Array.isArray(settings.journalSources) ? settings.journalSources : [];
    if (configured.length > 0) {
      return configured
        .map((source, index) => ({
          ...source,
          id: source.id || `source-${index + 1}`,
          path: normalizeVaultPath(source.path),
        }))
        .filter((source) => source.path.length > 0 && source.enabled !== false);
    }
    const dailyFolder = normalizeVaultPath(settings.dailyFolder || 'Calendar/Daily');
    const result = DEFAULT_JOURNAL_SOURCES.map((source) => ({ ...source }));
    result[0].path = dailyFolder;
    return result;
  }

  private async rebuild(settings: JournalIndexSettings, token: number): Promise<void> {
    const sources = this.resolveSources(settings);
    this.currentSources = sources;
    const next = new Map<string, JournalEntry>();
    this.diagnostics.length = 0;
    const files = this.app.vault.getMarkdownFiles?.() ?? [];
    for (const file of files) {
      if (token !== this.refreshToken) return;
      const source = sourceForPath(file.path, sources);
      if (!source) continue;
      const entry = await this.readEntry(file, sources);
      if (entry) next.set(entry.path, entry);
    }
    if (token !== this.refreshToken) return;
    this.entries.clear();
    for (const [path, entry] of next) this.entries.set(path, entry);
    this.emit();
  }

  private async readEntry(file: any, sources: JournalSource[]): Promise<JournalEntry | null> {
    const path = normalizeVaultPath(file.path);
    const source = sourceForPath(path, sources);
    if (!source) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = asRecord(cache?.frontmatter);
    const resolved = resolveJournalDate(file.name, frontmatter, source.dateField);
    if (!resolved.date) {
      this.diagnostics.push({ path, reason: resolved.reason ?? 'missing-date' });
      return null;
    }

    let content = '';
    try {
      content = await this.app.vault.cachedRead(file);
    } catch (error) {
      this.diagnostics.push({ path, reason: 'read-failed', detail: String(error) });
    }
    const attachments = Array.isArray(cache?.embeds)
      ? cache.embeds.map((embed: any) => String(embed.link ?? '')).filter(Boolean)
      : [];
    attachments.push(...mediaLinks(readField(frontmatter, 'media')));
    attachments.push(...mediaLinks(readField(frontmatter, 'photos')));
    const favorite = asBoolean(readField(frontmatter, 'favorite'))
      || asBoolean(readField(frontmatter, 'starred'))
      || asBoolean(readField(frontmatter, 'pinned'));
    const uuid = firstString(readField(frontmatter, 'uuid'));
    const creationDate = firstString(readField(frontmatter, 'creationDate'));
    const modifiedDate = firstString(readField(frontmatter, 'modifiedDate'));
    const weather = asRecord(readField(frontmatter, '_calendar_weather'));
    const mood = this.getMood(path) ?? moodFromFrontmatter(frontmatter);
    return {
      path,
      date: resolved.date,
      title: titleFromContent(file.name, content, frontmatter),
      excerpt: extractExcerpt(content) ?? '',
      sourceId: source.id,
      sourcePath: source.path,
      sourceType: source.type,
      favorite,
      uuid,
      createdAt: creationDate,
      modifiedAt: modifiedDate ?? (file.stat?.mtime ? new Date(file.stat.mtime).toISOString() : undefined),
      location: normalizeLocation(frontmatter),
      attachments,
      activity: readField(frontmatter, 'activity'),
      weather: Object.keys(weather).length > 0 ? weather : undefined,
      mood,
      frontmatter,
    };
  }

  private emit(): void {
    const entries = this.getEntries();
    for (const listener of this.listeners) listener(entries);
  }
}
