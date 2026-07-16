/**
 * Calendar Sidebar — DayOne-style calendar in Obsidian left sidebar.
 * Scans Calendar/Daily/ for notes with images, shows thumbnails in date cells.
 * Click a date to open that day's daily note.
 */
const { Plugin, ItemView, TFolder, TFile, Notice } = require('obsidian');

const VIEW_TYPE = 'calendar-sidebar-view';

/* ============================================================
   Plugin Entry
   ============================================================ */
class CalendarSidebarPlugin extends Plugin {
  async onload() {
    // Load styles (manually installed plugins don't auto-load styles.css)
    this._loadStyles();

    // Register the sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));

    // Command to open the calendar (in case it gets closed)
    this.addCommand({
      id: 'open-calendar-sidebar',
      name: 'Open Calendar Sidebar',
      callback: () => this.activateView(),
    });

    // Auto-open on layout ready (after Obsidian starts)
    this.app.workspace.onLayoutReady(() => this.activateView());
  }

  _loadStyles() {
    const styleId = 'calendar-sidebar-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.cal-sidebar {
  padding: 8px 6px;
  user-select: none;
  overflow: hidden;
}
.cal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 2px 8px;
}
.cal-nav {
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--text-muted);
  line-height: 1;
}
.cal-nav:hover {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
.cal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-normal);
}
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 2px 0 4px;
  gap: 2px;
}
.cal-weekday {
  padding: 2px 0;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-day {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  transition: box-shadow 0.15s ease;
}
.cal-day:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
.cal-day:active {
  transform: scale(0.95);
}
.cal-day-empty {
  pointer-events: none;
  visibility: hidden;
}
.cal-no-image {
  background: var(--background-secondary-alt);
}
.cal-no-image .cal-day-num {
  color: var(--text-muted);
}
.cal-day-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 0;
}
.cal-day-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1;
  pointer-events: none;
}
.cal-day-num {
  position: relative;
  z-index: 2;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  line-height: 1;
  pointer-events: none;
}
.cal-today {
  box-shadow: 0 0 0 2px var(--color-accent);
}
.cal-today:hover {
  box-shadow: 0 0 0 2px var(--color-accent), 0 0 0 4px var(--interactive-accent-hover);
}
`;
    document.head.appendChild(style);
  }

  async activateView() {
    const { workspace } = this.app;

    // 1. De-duplicate: reveal existing leaf if already open
    const existing = workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    // 2. Create a vertical-split leaf in the left sidebar
    let leaf = workspace.getLeftLeaf(true);
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
    }
    if (!leaf) {
      new Notice('Calendar Sidebar: could not create left sidebar leaf');
      return;
    }

    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);

    // 3. Move calendar container above file explorer
    try {
      const ls = workspace.leftSplit;
      if (ls && ls.children && ls.containerEl) {
        let calContainer, feContainer;
        for (const child of ls.children) {
          if (!child.children) continue;
          for (const lf of child.children) {
            const vt = lf.view?.getViewType?.();
            if (vt === VIEW_TYPE) calContainer = child;
            if (vt === 'file-explorer') feContainer = child;
          }
        }
        if (calContainer && feContainer) {
          // Children array: move to index 0
          const idx = ls.children.indexOf(calContainer);
          if (idx > 0) {
            ls.children.splice(idx, 1);
            ls.children.splice(0, 0, calContainer);
          }
          // DOM: insert before file explorer's container
          ls.containerEl.insertBefore(
            calContainer.containerEl,
            feContainer.containerEl
          );
        }
      }
    } catch (_) {
      // Non-critical — calendar still works, just at the bottom
    }
  }
}

/* ============================================================
   Calendar View (ItemView)
   ============================================================ */
class CalendarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.app = plugin.app;
    // Track the displayed month — always the 1st of a month
    this.displayMonth = new Date();
    this.displayMonth.setDate(1);
    this.displayMonth.setHours(0, 0, 0, 0);
    // Cache: "2026-7" → Map<"2026-07-15", embedLink[]>
    this.monthCache = new Map();
    this._refreshTimer = null;
  }

  getViewType()   { return VIEW_TYPE; }
  getDisplayText(){ return 'Calendar'; }
  getIcon()       { return 'calendar'; }

  /* ----- Lifecycle ----- */
  async onOpen() {
    this.containerEl.addClass('cal-sidebar');

    // Build data for current month
    await this.buildMonthCache(this.displayMonth);
    this.render();

    // Auto-refresh when vault changes
    this.registerEvent(
      this.app.vault.on('modify', (file) => this._onFileChanged(file))
    );
    this.registerEvent(
      this.app.vault.on('create', (file) => this._onFileChanged(file))
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => this._onFileChanged(file))
    );
  }

  /* ----- File change refresh (debounced) ----- */
  _onFileChanged(file) {
    // Only care about Calendar/Daily/ .md files
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    if (!file.path.startsWith('Calendar/Daily/')) return;

    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      // Invalidate cache for the affected month
      const match = file.name.match(/^(\d{4})-(\d{2})-\d{2}\.md$/);
      if (match) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        const key = `${year}-${month}`;
        this.monthCache.delete(key);
        await this.buildMonthCache(this.displayMonth);
      } else {
        this.monthCache.delete(this._monthKey(this.displayMonth));
        await this.buildMonthCache(this.displayMonth);
      }
      this.render();
    }, 300);
  }

  /* ----- Public refresh (called from plugin) ----- */
  async refresh() {
    this.monthCache.delete(this._monthKey(this.displayMonth));
    await this.buildMonthCache(this.displayMonth);
    this.render();
  }

  /* ----- Month cache key ----- */
  _monthKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }

  /* ----- Build cache for a given month ----- */
  async buildMonthCache(monthDate) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const key = this._monthKey(monthDate);

    if (this.monthCache.has(key)) return;
    this.monthCache.set(key, new Map()); // placeholder

    const folderPath = 'Calendar/Daily';
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return;

    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const map = new Map();

    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== 'md') continue;
      if (!child.name.startsWith(prefix)) continue;

      const dateStr = child.name.replace(/\.md$/, '');
      const cache = this.app.metadataCache.getFileCache(child);
      if (!cache) continue;

      const embeds = cache.embeds || [];
      const images = embeds
        .map((e) => e.link)
        .filter((link) => link && IMAGE_EXTS.includes(link.split('.').pop()?.toLowerCase()));

      if (images.length > 0) {
        map.set(dateStr, images);
      }
    }

    this.monthCache.set(key, map);
  }

  /* ----- Render the calendar ----- */
  render() {
    const el = this.contentEl;
    el.empty();

    const year = this.displayMonth.getFullYear();
    const month = this.displayMonth.getMonth();
    const key = this._monthKey(this.displayMonth);
    const imageMap = this.monthCache.get(key) || new Map();

    // --- Header: month navigation ---
    const header = el.createDiv({ cls: 'cal-header' });
    const prevBtn = header.createEl('span', { cls: 'cal-nav' });
    prevBtn.setText('◀');
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goToMonth(-1);
    });

    const title = header.createEl('span', { cls: 'cal-title' });
    title.setText(`${year}年${month + 1}月`);

    const nextBtn = header.createEl('span', { cls: 'cal-nav' });
    nextBtn.setText('▶');
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._goToMonth(1);
    });

    // --- Weekday row ---
    const wd = el.createDiv({ cls: 'cal-weekdays' });
    for (const day of ['日', '一', '二', '三', '四', '五', '六']) {
      wd.createEl('span', { cls: 'cal-weekday', text: day });
    }

    // --- Grid ---
    const grid = el.createDiv({ cls: 'cal-grid' });

    const firstDay = new Date(year, month, 1).getDay(); // 0=Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const todayStr = _formatDate(today);

    // Empty cells before the 1st
    for (let i = 0; i < firstDay; i++) {
      grid.createDiv({ cls: 'cal-day cal-day-empty' });
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = _formatDate(dateObj);
      const images = imageMap.get(dateStr) || [];
      const isToday = dateStr === todayStr;

      const cell = grid.createDiv({ cls: 'cal-day' });
      if (images.length > 0) cell.addClass('cal-has-image');
      else cell.addClass('cal-no-image');
      if (isToday) cell.addClass('cal-today');

      // Background image (first image as thumbnail)
      if (images.length > 0) {
        const bg = cell.createDiv({ cls: 'cal-day-bg' });
        const overlay = cell.createDiv({ cls: 'cal-day-overlay' });
        this._setBackground(bg, images[0], dateStr);
      }

      // Date number
      const num = cell.createEl('span', { cls: 'cal-day-num', text: String(d) });

      // Click to open daily note
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openNote(dateStr);
      });
    }
  }

  /* ----- Resolve and set background image ----- */
  async _setBackground(bgEl, link, dateStr) {
    try {
      const sourcePath = `Calendar/Daily/${dateStr}.md`;
      const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
      if (file instanceof TFile) {
        const url = this.app.vault.getResourcePath(file);
        bgEl.style.backgroundImage = `url("${url}")`;
      }
    } catch (_) {
      // silent — image might not exist yet
    }
  }

  /* ----- Navigate months ----- */
  _goToMonth(delta) {
    const newMonth = new Date(this.displayMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    this.displayMonth = newMonth;

    this.buildMonthCache(this.displayMonth).then(() => this.render());
  }

  /* ----- Open daily note ----- */
  _openNote(dateStr) {
    const path = `Calendar/Daily/${dateStr}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      this.app.workspace.getLeaf(false).openFile(file);
    }
  }
}

/* ============================================================
   Helpers
   ============================================================ */
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'avif', 'tiff', 'tif', 'bmp'];

function _formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = CalendarSidebarPlugin;
