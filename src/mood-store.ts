import { normalizeVaultPath } from './date-utils';
import type { MoodMetadata, MoodRecord } from './types';

export interface MoodStoreSettings {
  moodMetadataPath?: string;
  mirrorMoodToFrontmatter?: boolean;
}

type MoodListener = (path: string, record: MoodRecord | undefined) => void;

const DEFAULT_PATH = 'Calendar/journal-metadata.json';

function safeVaultPath(path: string): string {
  const normalized = normalizeVaultPath(path);
  return normalized.split('/').filter((part) => part && part !== '.' && part !== '..').join('/') || DEFAULT_PATH;
}

function emptyMetadata(): MoodMetadata {
  return { schemaVersion: 1, entries: {}, orphans: {} };
}

function isScore(value: unknown): value is MoodRecord['score'] {
  return value === -2 || value === -1 || value === 0 || value === 1 || value === 2;
}

function validRecord(value: unknown): value is MoodRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return isScore(record.score)
    && Array.isArray(record.labels)
    && typeof record.recordedAt === 'string'
    && typeof record.updatedAt === 'string';
}

function normalizeMetadata(value: unknown): MoodMetadata {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const entries: Record<string, MoodRecord> = {};
  const rawEntries = raw.entries && typeof raw.entries === 'object' ? raw.entries as Record<string, unknown> : {};
  for (const [path, record] of Object.entries(rawEntries)) {
    if (validRecord(record)) entries[normalizeVaultPath(path)] = {
      score: record.score,
      labels: record.labels.map(String).filter(Boolean),
      recordedAt: record.recordedAt,
      updatedAt: record.updatedAt,
    };
  }
  const orphans: MoodMetadata['orphans'] = {};
  const rawOrphans = raw.orphans && typeof raw.orphans === 'object' ? raw.orphans as Record<string, unknown> : {};
  for (const [path, value] of Object.entries(rawOrphans)) {
    const orphan = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (validRecord(orphan.record)) {
      orphans[path] = { record: orphan.record, orphanedAt: String(orphan.orphanedAt ?? new Date().toISOString()) };
    }
  }
  return { schemaVersion: 1, entries, orphans };
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index > 0 ? path.slice(0, index) : '';
}

export class MoodStore {
  private readonly app: any;
  private readonly listeners = new Set<MoodListener>();
  private data: MoodMetadata = emptyMetadata();
  private path = DEFAULT_PATH;
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(app: any, settings: MoodStoreSettings = {}) {
    this.app = app;
    this.configure(settings);
  }

  configure(settings: MoodStoreSettings): void {
    this.path = safeVaultPath(settings.moodMetadataPath || DEFAULT_PATH);
  }

  get metadataPath(): string {
    return this.path;
  }

  async load(): Promise<void> {
    const adapter = this.adapter();
    try {
      if (!(await adapter.exists(this.path))) {
        this.data = emptyMetadata();
        this.loaded = true;
        return;
      }
      this.data = normalizeMetadata(JSON.parse(await adapter.read(this.path)));
      this.loaded = true;
    } catch (error) {
      const restored = await this.readBackup();
      if (restored) {
        this.data = restored;
        this.loaded = true;
        return;
      }
      console.warn('[CalendarSidebar] Mood metadata could not be read:', error);
      this.data = emptyMetadata();
      this.loaded = true;
    }
  }

  get(path: string): MoodRecord | undefined {
    return this.data.entries[normalizeVaultPath(path)];
  }

  getAll(): Record<string, MoodRecord> {
    return { ...this.data.entries };
  }

  getOrphans(): MoodMetadata['orphans'] {
    return { ...(this.data.orphans ?? {}) };
  }

  subscribe(listener: MoodListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async set(path: string, score: MoodRecord['score'], labels: string[], settings: MoodStoreSettings = {}): Promise<MoodRecord> {
    const normalizedPath = normalizeVaultPath(path);
    const now = new Date().toISOString();
    const previous = this.data.entries[normalizedPath];
    const record: MoodRecord = {
      score,
      labels: Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean))),
      recordedAt: previous?.recordedAt ?? now,
      updatedAt: now,
    };
    await this.mutate((data) => {
      data.entries[normalizedPath] = record;
      if (data.orphans) delete data.orphans[normalizedPath];
    });
    if (settings.mirrorMoodToFrontmatter) await this.mirrorToFrontmatter(normalizedPath, record);
    this.emit(normalizedPath, record);
    return record;
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = normalizeVaultPath(oldPath);
    const newKey = normalizeVaultPath(newPath);
    if (oldKey === newKey) return;
    const record = this.data.entries[oldKey];
    const orphan = this.data.orphans?.[oldKey];
    if (!record && !orphan) return;
    await this.mutate((data) => {
      if (data.entries[oldKey]) {
        data.entries[newKey] = data.entries[oldKey];
        delete data.entries[oldKey];
      }
      if (data.orphans?.[oldKey]) {
        data.orphans[newKey] = data.orphans[oldKey];
        delete data.orphans[oldKey];
      }
    });
    this.emit(newKey, this.get(newKey));
  }

  async removeToOrphan(path: string): Promise<void> {
    const key = normalizeVaultPath(path);
    const record = this.data.entries[key];
    if (!record) return;
    await this.mutate((data) => {
      data.orphans ??= {};
      data.orphans[key] = { record, orphanedAt: new Date().toISOString() };
      delete data.entries[key];
    });
    this.emit(key, undefined);
  }

  async restoreOrphan(orphanKey: string, destinationPath = orphanKey): Promise<MoodRecord | undefined> {
    const source = this.data.orphans?.[orphanKey];
    if (!source) return undefined;
    const destination = safeVaultPath(destinationPath);
    await this.mutate((data) => {
      data.entries[destination] = source.record;
      delete data.orphans?.[orphanKey];
    });
    this.emit(destination, source.record);
    return source.record;
  }

  async importFrontmatter(filePaths: string[], metadataCache: any): Promise<number> {
    let imported = 0;
    await this.mutate((data) => {
      for (const rawPath of filePaths) {
        const path = normalizeVaultPath(rawPath);
        if (data.entries[path]) continue;
        const file = this.app.vault.getAbstractFileByPath(path);
        const frontmatter = metadataCache.getFileCache(file)?.frontmatter ?? {};
        const score = Number(frontmatter.mood);
        if (!isScore(score)) continue;
        const labels = Array.isArray(frontmatter.mood_labels)
          ? frontmatter.mood_labels.map(String)
          : typeof frontmatter.mood_labels === 'string'
            ? frontmatter.mood_labels.split(',')
            : [];
        const now = new Date().toISOString();
        data.entries[path] = { score, labels, recordedAt: now, updatedAt: now };
        imported++;
      }
    });
    for (const path of filePaths) if (this.data.entries[normalizeVaultPath(path)]) this.emit(normalizeVaultPath(path), this.get(path));
    return imported;
  }

  async exportTo(destinationPath = `${this.path}.export.json`): Promise<string> {
    const destination = normalizeVaultPath(destinationPath);
    await this.writeJson(destination, JSON.stringify(this.data, null, 2));
    return destination;
  }

  async restoreFrom(raw: string | MoodMetadata): Promise<void> {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const next = normalizeMetadata(parsed);
    await this.mutate(() => next);
    for (const path of Object.keys(next.entries)) this.emit(path, next.entries[path]);
  }

  async checkIntegrity(): Promise<{ valid: boolean; invalidRecords: string[]; missingFiles: string[] }> {
    const invalidRecords: string[] = [];
    const missingFiles: string[] = [];
    try {
      if (await this.adapter().exists(this.path)) {
        const raw = JSON.parse(await this.adapter().read(this.path));
        const rawEntries = raw?.entries && typeof raw.entries === 'object' ? raw.entries : {};
        for (const [path, record] of Object.entries(rawEntries)) {
          if (!validRecord(record)) invalidRecords.push(path);
        }
      }
    } catch (_) {
      invalidRecords.push(this.path);
    }
    for (const [path, record] of Object.entries(this.data.entries)) {
      if (!this.app.vault.getAbstractFileByPath(path)) missingFiles.push(path);
    }
    return { valid: invalidRecords.length === 0, invalidRecords, missingFiles };
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async mutate(mutator: (data: MoodMetadata) => void | MoodMetadata): Promise<void> {
    if (!this.loaded) await this.load();
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const cloned = normalizeMetadata(JSON.parse(JSON.stringify(this.data)));
      const result = mutator(cloned);
      this.data = result && typeof result === 'object' && 'entries' in result ? result : cloned;
      await this.writeJsonAtomically(this.path, JSON.stringify(this.data, null, 2));
    });
    await this.writeQueue;
  }

  private async mirrorToFrontmatter(path: string, record: MoodRecord): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !this.app.fileManager?.processFrontMatter) return;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.mood = record.score;
      frontmatter.mood_labels = record.labels;
    });
  }

  private async readBackup(): Promise<MoodMetadata | undefined> {
    try {
      const backup = `${this.path}.bak`;
      if (await this.adapter().exists(backup)) return normalizeMetadata(JSON.parse(await this.adapter().read(backup)));
    } catch (_) {
      return undefined;
    }
    return undefined;
  }

  private adapter(): any {
    return this.app.vault.adapter;
  }

  private async writeJson(path: string, content: string): Promise<void> {
    await this.ensureParent(path);
    await this.adapter().write(path, content);
  }

  private async writeJsonAtomically(path: string, content: string): Promise<void> {
    await this.ensureParent(path);
    const temp = `${path}.tmp`;
    const backup = `${path}.bak`;
    const adapter = this.adapter();
    await adapter.write(temp, content);
    try {
      if (await adapter.exists(path)) {
        if (await adapter.exists(backup)) await adapter.remove(backup);
        await adapter.rename(path, backup);
      }
      await adapter.rename(temp, path);
    } catch (error) {
      try {
        if (!(await adapter.exists(path)) && await adapter.exists(backup)) await adapter.rename(backup, path);
      } catch (_) {
        // Preserve the original error while leaving the backup for recovery.
      }
      throw error;
    }
  }

  private async ensureParent(path: string): Promise<void> {
    const parent = parentPath(path);
    if (!parent) return;
    const adapter = this.adapter();
    if (!(await adapter.exists(parent))) await adapter.mkdir(parent);
  }

  private emit(path: string, record: MoodRecord | undefined): void {
    for (const listener of this.listeners) listener(path, record);
  }
}
