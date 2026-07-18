import { describe, expect, it } from 'vitest';
import { MoodStore } from '../src/mood-store';

function makeApp() {
  const files = new Map<string, string>();
  const adapter = {
    async exists(path: string) { return files.has(path); },
    async read(path: string) { if (!files.has(path)) throw new Error('missing'); return files.get(path)!; },
    async write(path: string, value: string) { files.set(path, value); },
    async rename(from: string, to: string) { files.set(to, files.get(from)!); files.delete(from); },
    async remove(path: string) { files.delete(path); },
    async mkdir() {},
  };
  const markdown = new Map<string, any>();
  return {
    files,
    app: {
      vault: {
        adapter,
        getAbstractFileByPath(path: string) { return markdown.get(path); },
      },
      fileManager: {
        calls: 0,
        async processFrontMatter(_file: any, callback: (frontmatter: Record<string, unknown>) => void) {
          this.calls++;
          const frontmatter: Record<string, unknown> = {};
          callback(frontmatter);
        },
      },
    },
  };
}

describe('mood metadata store', () => {
  it('writes JSON without frontmatter by default and keeps rename/delete recoverable', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    const record = await store.set('Calendar/Daily/2026-07-18.md', 1, ['calm']);
    expect(record.score).toBe(1);
    expect(fixture.app.fileManager.calls).toBe(0);
    expect(JSON.parse(fixture.files.get('Calendar/journal-metadata.json')!).entries['Calendar/Daily/2026-07-18.md'].labels).toEqual(['calm']);
    await store.rename('Calendar/Daily/2026-07-18.md', 'Calendar/Daily/renamed.md');
    await store.removeToOrphan('Calendar/Daily/renamed.md');
    expect(store.get('Calendar/Daily/renamed.md')).toBeUndefined();
    expect(store.getOrphans()?.['Calendar/Daily/renamed.md']).toBeTruthy();
    await store.restoreOrphan('Calendar/Daily/renamed.md', 'Calendar/Daily/restored.md');
    expect(store.get('Calendar/Daily/restored.md')?.score).toBe(1);
    expect(fixture.files.has('Calendar/journal-metadata.json.bak')).toBe(true);
  });

  it('mirrors only on explicit opt-in', async () => {
    const fixture = makeApp();
    fixture.app.vault.getAbstractFileByPath = (path: string) => ({ path });
    const store = new MoodStore(fixture.app);
    await store.set('note.md', -2, ['anxious'], { mirrorMoodToFrontmatter: true });
    expect(fixture.app.fileManager.calls).toBe(1);
  });
});
