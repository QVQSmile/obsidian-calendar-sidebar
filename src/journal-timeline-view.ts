// @ts-nocheck
const { ItemView, Notice, TFile, setIcon } = require('obsidian');
const { calculateJournalStats } = require('./journal-stats');

export const JOURNAL_TIMELINE_VIEW = 'journal-timeline-view';

export class JournalTimelineView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.index = plugin.journalIndex;
    this.filter = {};
  }

  getViewType() { return JOURNAL_TIMELINE_VIEW; }
  getDisplayText() { return 'Journal timeline'; }
  getIcon() { return 'list'; }

  async onOpen() {
    this.unsubscribe = this.index.subscribe(() => this.render());
    await this.index.refresh(this.plugin.settings);
    this.render();
  }

  onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('journal-timeline-view');

    const header = root.createDiv({ cls: 'journal-timeline-header' });
    const heading = header.createDiv({ cls: 'journal-timeline-heading' });
    heading.createEl('h2', { text: 'Journal timeline' });
    heading.createDiv({ cls: 'journal-timeline-count', text: `${this.index.filter(this.filter).length}` });

    const actions = header.createDiv({ cls: 'journal-timeline-actions' });
    const moodButton = actions.createEl('button', { attr: { type: 'button', 'aria-label': 'Record current journal mood', title: 'Record current journal mood' } });
    setIcon(moodButton, 'heart-pulse');
    moodButton.addEventListener('click', () => this.plugin.recordCurrentMood());
    const newButton = actions.createEl('button', { attr: { type: 'button', 'aria-label': 'Create journal entry', title: 'Create journal entry' } });
    setIcon(newButton, 'file-plus-2');
    newButton.addEventListener('click', () => this.plugin.createJournalEntry());

    this.renderFilters(root);
    this.renderStats(root);
    const list = root.createDiv({ cls: 'journal-timeline-list' });
    const entries = this.index.filter(this.filter);
    if (entries.length === 0) {
      list.createDiv({ cls: 'journal-timeline-empty', text: 'No journal entries match the current filters.' });
      return;
    }
    for (const entry of entries) this.renderEntry(list, entry);
  }

  renderStats(root) {
    const stats = calculateJournalStats(this.index.getEntries());
    const section = root.createDiv({ cls: 'journal-timeline-stats', attr: { 'aria-label': 'Journal statistics' } });
    const values = [
      ['Current streak', `${stats.currentStreak} days`],
      ['Longest streak', `${stats.longestStreak} days`],
      ['This month', `${stats.monthCompletionRate}%`],
    ];
    for (const [label, value] of values) {
      const item = section.createDiv({ cls: 'journal-stat' });
      item.createDiv({ cls: 'journal-stat-value', text: value });
      item.createDiv({ cls: 'journal-stat-label', text: label });
    }
    const trend = section.createDiv({ cls: 'journal-stat-trend' });
    trend.createDiv({ cls: 'journal-stat-label', text: 'Mood trend' });
    const trendText = stats.trend.map((item) => `${item.date.slice(5)} ${item.score === undefined ? '-' : item.score > 0 ? `+${item.score}` : item.score}`).join(' | ');
    trend.createDiv({ text: trendText || 'No mood records' });
  }

  renderFilters(root) {
    const filters = root.createDiv({ cls: 'journal-timeline-filters' });
    const query = filters.createEl('input', { attr: { type: 'search', placeholder: 'Search journal', 'aria-label': 'Search journal' } });
    query.value = this.filter.query ?? '';
    query.addEventListener('input', () => {
      this.filter.query = query.value;
      this.updateResults();
    });
    const from = filters.createEl('input', { attr: { type: 'date', 'aria-label': 'From date', title: 'From date' } });
    from.value = this.filter.from ?? '';
    from.addEventListener('change', () => {
      this.filter.from = from.value || undefined;
      this.updateResults();
    });
    const to = filters.createEl('input', { attr: { type: 'date', 'aria-label': 'To date', title: 'To date' } });
    to.value = this.filter.to ?? '';
    to.addEventListener('change', () => {
      this.filter.to = to.value || undefined;
      this.updateResults();
    });
    const source = filters.createEl('select', { attr: { 'aria-label': 'Journal source', title: 'Journal source' } });
    source.createEl('option', { text: 'All sources', attr: { value: '' } });
    for (const item of this.index.sources) source.createEl('option', { text: item.label || item.path, attr: { value: item.id } });
    source.value = this.filter.sourceId ?? '';
    source.addEventListener('change', () => {
      this.filter.sourceId = source.value || undefined;
      this.updateResults();
    });
    const mood = filters.createEl('select', { attr: { 'aria-label': 'Mood filter', title: 'Mood filter' } });
    mood.createEl('option', { text: 'All moods', attr: { value: '' } });
    for (const score of [-2, -1, 0, 1, 2]) mood.createEl('option', { text: `Mood ${score > 0 ? '+' : ''}${score}`, attr: { value: String(score) } });
    mood.value = this.filter.moodScore === undefined ? '' : String(this.filter.moodScore);
    mood.addEventListener('change', () => {
      this.filter.moodScore = mood.value === '' ? undefined : Number(mood.value);
      this.updateResults();
    });
    const favorite = filters.createEl('label', { cls: 'journal-timeline-favorite-filter' });
    const checkbox = favorite.createEl('input', { attr: { type: 'checkbox' } });
    checkbox.checked = Boolean(this.filter.favoriteOnly);
    favorite.createSpan({ text: 'Favorites' });
    checkbox.addEventListener('change', () => {
      this.filter.favoriteOnly = checkbox.checked;
      this.updateResults();
    });
    const clear = filters.createEl('button', { attr: { type: 'button', 'aria-label': 'Clear journal filters', title: 'Clear filters' } });
    setIcon(clear, 'x');
    clear.addEventListener('click', () => {
      this.filter = {};
      this.render();
    });
  }

  updateResults() {
    const entries = this.index.filter(this.filter);
    const count = this.contentEl.querySelector('.journal-timeline-count');
    if (count) count.setText(String(entries.length));
    const list = this.contentEl.querySelector('.journal-timeline-list');
    if (!list) return;
    list.empty();
    if (entries.length === 0) {
      list.createDiv({ cls: 'journal-timeline-empty', text: 'No journal entries match the current filters.' });
      return;
    }
    for (const entry of entries) this.renderEntry(list, entry);
  }

  renderEntry(list, entry) {
    const card = list.createEl('article', { cls: 'journal-timeline-entry' });
    card.tabIndex = 0;
    card.dataset.path = entry.path;
    const marker = card.createDiv({ cls: `journal-timeline-marker mood-${entry.mood?.score ?? 'none'}` });
    marker.setAttribute('aria-hidden', 'true');
    const body = card.createDiv({ cls: 'journal-timeline-entry-body' });
    const top = body.createDiv({ cls: 'journal-timeline-entry-top' });
    top.createEl('time', { text: entry.date, attr: { datetime: entry.date } });
    top.createSpan({ cls: 'journal-timeline-source', text: entry.sourceId });
    if (entry.favorite) {
      const star = top.createSpan({ cls: 'journal-timeline-favorite', text: 'Favorite' });
      star.setAttribute('aria-label', 'Favorite');
    }
    body.createEl('h3', { text: entry.title });
    if (entry.excerpt) body.createDiv({ cls: 'journal-timeline-excerpt', text: entry.excerpt });
    const meta = body.createDiv({ cls: 'journal-timeline-meta' });
    if (entry.mood) meta.createSpan({ text: `Mood ${entry.mood.score > 0 ? '+' : ''}${entry.mood.score}` });
    if (entry.location?.name) meta.createSpan({ text: entry.location.name });
    if (entry.attachments.length > 0) meta.createSpan({ text: `${entry.attachments.length} media` });
    const open = () => this.openEntry(entry.path);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
      if (event.key === 'm') this.plugin.openMoodPicker(entry.path);
    });
  }

  async openEntry(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Journal file not found: ${path}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf('split');
    await leaf.openFile(file);
  }
}
