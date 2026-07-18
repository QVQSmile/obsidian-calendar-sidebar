import { describe, expect, it } from 'vitest';
import { JournalIndex, resolveJournalDate } from '../src/journal-index';

function makeApp(files: any[]) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => byPath.get(path),
      cachedRead: async (file: any) => file.content,
    },
    metadataCache: {
      getFileCache: (file: any) => ({ frontmatter: file.frontmatter, embeds: file.embeds ?? [] }),
    },
  };
}

describe('journal index', () => {
  it('uses configured date fields before aliases and filename dates', () => {
    expect(resolveJournalDate('random.md', { importedAt: '2026-07-18T08:00:00+08:00', date: '2020-01-01' }, 'importedAt').date).toBe('2026-07-18');
    expect(resolveJournalDate('2026-07-18 note.md', {}).date).toBe('2026-07-18');
    expect(resolveJournalDate('2026-02-30.md', {}).reason).toBe('invalid-date');
  });

  it('maps external aliases, excludes undated files, and records diagnostics', async () => {
    const files = [
      {
        path: 'Imports/day.md',
        name: 'day.md',
        frontmatter: {
          creationDate: '2025-02-28T12:00:00Z',
          starred: true,
          uuid: 'abc',
          coordinates: '31.23, 121.47',
        },
        content: '# Imported day\nA useful memory.',
        embeds: [{ link: 'media/photo.jpg' }],
      },
      { path: 'Imports/no-date.md', name: 'no-date.md', frontmatter: {}, content: 'No date' },
      { path: 'Calendar/Daily/2024-02-29.md', name: '2024-02-29.md', frontmatter: {}, content: 'Leap day' },
    ];
    const index = new JournalIndex(makeApp(files), () => undefined);
    await index.refresh({
      journalSources: [
        { id: 'imports', path: 'Imports', type: 'external', dateField: 'creationDate' },
        { id: 'daily', path: 'Calendar/Daily', type: 'daily' },
      ],
    });
    const entries = index.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.path === 'Imports/day.md')).toMatchObject({
      date: '2025-02-28', favorite: true, uuid: 'abc',
      location: { latitude: 31.23, longitude: 121.47 },
      sourceType: 'external',
    });
    expect(index.getDiagnostics()).toEqual([{ path: 'Imports/no-date.md', reason: 'missing-date' }]);
  });
});
