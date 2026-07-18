// @ts-nocheck
const { Modal, Notice, setIcon } = require('obsidian');
const { MOOD_LEVELS, MOOD_LABELS, moveMoodScore } = require('./mood');

export class MoodPickerModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.filePath = options.filePath;
    this.initial = options.initial;
    this.onSave = options.onSave;
    this.score = this.initial?.score ?? null;
    this.labels = new Set(this.initial?.labels ?? []);
  }

  onOpen() {
    this.modalEl.addClass('journal-mood-picker-modal');
    this.contentEl.empty();
    this.contentEl.addClass('journal-mood-picker');
    this.renderScale();
    this.keyHandler = (event) => this.handleKeydown(event);
    this.scope?.register([], 'Escape', this.keyHandler);
    this.contentEl.addEventListener('keydown', this.keyHandler);
  }

  onClose() {
    this.contentEl.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
  }

  renderScale() {
    this.step = 1;
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Record mood' });
    this.contentEl.createEl('p', { cls: 'journal-mood-step', text: 'How did today feel?' });
    const scale = this.contentEl.createDiv({ cls: 'journal-mood-scale', attr: { role: 'radiogroup', 'aria-label': 'Mood level' } });
    MOOD_LEVELS.forEach((level, index) => {
      const button = scale.createEl('button', {
        cls: `journal-mood-level journal-mood-level-${level.score}`,
        attr: {
          type: 'button',
          role: 'radio',
          'aria-label': level.label,
          'aria-checked': String(this.score === level.score),
          tabindex: this.score === level.score || (!this.score && index === 2) ? '0' : '-1',
        },
      });
      button.style.setProperty('--journal-mood-color', level.color);
      setIcon(button, level.icon);
      button.addEventListener('click', () => {
        this.score = level.score;
        this.renderLabels();
      });
    });
    const hint = this.contentEl.createDiv({ cls: 'journal-mood-selected' });
    hint.setText(this.score === null ? 'Choose a level' : MOOD_LEVELS.find((level) => level.score === this.score).label);
  }

  renderLabels() {
    this.step = 2;
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Add feelings' });
    this.contentEl.createEl('p', { cls: 'journal-mood-step', text: 'Choose any that fit' });
    const group = this.contentEl.createDiv({ cls: 'journal-mood-labels', attr: { role: 'group', 'aria-label': 'Feeling labels' } });
    for (const item of MOOD_LABELS) {
      const button = group.createEl('button', {
        cls: 'journal-mood-label',
        text: item.label,
        attr: { type: 'button', 'aria-pressed': String(this.labels.has(item.id)) },
      });
      button.addEventListener('click', () => {
        if (this.labels.has(item.id)) this.labels.delete(item.id);
        else this.labels.add(item.id);
        button.setAttribute('aria-pressed', String(this.labels.has(item.id)));
      });
    }
    const actions = this.contentEl.createDiv({ cls: 'journal-mood-actions' });
    const back = actions.createEl('button', { text: 'Back', attr: { type: 'button' } });
    back.addEventListener('click', () => this.renderScale());
    const save = actions.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'button' } });
    save.addEventListener('click', () => this.save());
    save.focus();
  }

  async save() {
    if (this.score === null) return;
    const result = { score: this.score, labels: Array.from(this.labels) };
    try {
      await this.onSave?.(result);
      this.close();
    } catch (error) {
      new Notice(`Could not save mood: ${error.message || error}`);
    }
  }

  handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (this.step !== 1) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.score = moveMoodScore(this.score, 1);
      this.renderScale();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.score = moveMoodScore(this.score, -1);
      this.renderScale();
    } else if (event.key === 'Enter' && this.score !== null) {
      event.preventDefault();
      this.renderLabels();
    }
  }
}
