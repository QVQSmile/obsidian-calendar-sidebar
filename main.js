/**
 * Calendar Sidebar — DayOne-style calendar in Obsidian left sidebar.
 * Scans Calendar/Daily/ for notes with images, shows thumbnails in date cells.
 * Click a date to open that day's daily note.
 */
const { Plugin, ItemView, TFolder, TFile, Notice, Modal, PluginSettingTab, Setting, SuggestModal, requestUrl, setIcon } = require('obsidian');

const VIEW_TYPE = 'calendar-sidebar-view';
const OVERLAY_ATTR = 'data-cal-weather-overlay';

/* ============================================================
   Plugin Entry
   ============================================================ */
const DEFAULT_SETTINGS = {
  dailyFolder: 'Calendar/Daily',
  thumbnailFilter: 'all', // 'all' | 'date-prefixed'
  // --- Weather settings ---
  weatherEnabled: false,
  weatherLatitude: '',
  weatherLongitude: '',
  weatherLocationName: '',
  weatherUnits: 'metric', // 'metric' | 'imperial'
  weatherAutoFetch: true, // auto-fetch weather when opening a daily note
  weatherTtlHours: 2,     // cache TTL in hours before re-fetch
  weatherLanguage: 'zh',  // 'en' | 'zh' — display language for weather labels
  // --- EXIF metadata ---
  showExif: true,         // show EXIF metadata tooltip on image hover
};

class CalendarSidebarPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // Load styles (manually installed plugins don't auto-load styles.css)
    this._loadStyles();

    // Initialize shared WeatherService (singleton across all calendar views)
    this.weatherService = new WeatherService(this);
    // Shared EXIF metadata cache (used by calendar tooltip + note-image tooltip)
    this.exifCache = new ImageMetadataCache(this.app);
    // HEIC thumbnail conversion cache
    this.heicCache = new HeicCache(this.app);

    // Preload libheif WASM module eagerly
    try {
      const path = require('path');
      const pluginDir = path.join(this.app.vault.adapter.basePath, '.obsidian', 'plugins', 'calendar-sidebar');
      const libheifFactory = require(path.join(pluginDir, 'libheif-bundle.js'));
      this._libheifFactory = libheifFactory;
    } catch (e) {
      console.warn('[CalendarSidebar] Failed to load libheif:', e.message);
      this._libheifFactory = null;
    }
    // Track containers where we set position:relative so we can revert on unload
    this._hostPositionMarkers = new Set();

    // Register the sidebar view
    this.registerView(VIEW_TYPE, (leaf) => new CalendarView(leaf, this));

    // Command to open the calendar (in case it gets closed)
    this.addCommand({
      id: 'open-calendar-sidebar',
      name: 'Open Calendar Sidebar',
      callback: () => this.activateView(),
    });

    // Command to refresh weather for the active date
    this.addCommand({
      id: 'refresh-weather',
      name: 'Refresh Weather for Active Date',
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (leaf?.view) {
          leaf.view.refreshWeather().catch((err) => {
            console.warn('[CalendarSidebar] Refresh weather failed:', err.message);
          });
        }
      },
    });

    // Settings tab
    this.addSettingTab(new CalendarSidebarSettingsTab(this.app, this));

    // Initialize EXIF tooltip element (shared across calendar & note-image hover)
    this._exifTooltipEl = null;
    this._exifHoverTimer = null;
    this._ensureExifTooltip();

    // Auto-open on layout ready (after Obsidian starts)
    this.app.workspace.onLayoutReady(() => {
      this.activateView();
      // Trigger initial overlay sync once the layout is stable
      this._syncAllOverlays();
    });

    // Plugin-level overlay sync: react to file-open, active-leaf-change, layout-change
    this.registerEvent(
      this.app.workspace.on('file-open', () => this._syncAllOverlays())
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this._syncAllOverlays())
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this._syncAllOverlays())
    );
  }

  /** Remove all note overlays and clear state on unload. */
  onunload() {
    this._removeAllOverlays();
  }

  /** Remove all overlay elements from markdown view containers. */
  _removeAllOverlays() {
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
    this._overlayRefreshHandlers = null;
    // Revert any position:relative we added to containerEl
    for (const container of this._hostPositionMarkers || []) {
      if (container.style.position === 'relative') {
        container.style.removeProperty('position');
      }
    }
    this._hostPositionMarkers?.clear();
  }

  /** Plugin-level overlay sync — delegates to each CalendarView instance, then cleans stale ones. */
  _syncAllOverlays() {
    // Delegate to every CalendarView instance
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && typeof view._syncNoteOverlays === 'function') {
        view._syncNoteOverlays();
      }
    }
  }

  /* ----- Shared EXIF Tooltip (used by calendar view + note-image hover) ----- */

  _ensureExifTooltip() {
    if (this._exifTooltipEl) return;
    const tip = document.createElement('div');
    tip.className = 'cal-exif-tooltip';
    document.body.appendChild(tip);
    this._exifTooltipEl = tip;
  }

  _showExifTooltip(anchorEl, fields, loading) {
    const tip = this._exifTooltipEl;
    if (!tip) return;
    const lang = this.settings.weatherLanguage;

    if (loading) {
      tip.innerHTML = `<div class="cal-exif-tooltip-loading">${_l(lang, 'exif_loading')}</div>`;
    } else if (!fields || fields.length === 0) {
      tip.innerHTML = `<div class="cal-exif-tooltip-empty"><div>${_l(lang, 'exif_noData')}</div><div style="font-size:10px;margin-top:2px">${_l(lang, 'exif_noDataDesc')}</div></div>`;
    } else {
      let html = '';
      for (const f of fields) {
        html += `<div class="cal-exif-tooltip-row"><span class="cal-exif-tooltip-label">${_l(lang, f.key)}</span><span class="cal-exif-tooltip-value">${f.value}</span></div>`;
      }
      tip.innerHTML = html;
    }

    const rect = anchorEl.getBoundingClientRect();
    const tipW = tip.offsetWidth || 180;
    let left = rect.right + 6;
    if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 6;
    if (left < 4) left = 4;
    let top = rect.top;
    const tipH = tip.offsetHeight || 100;
    if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
    if (top < 4) top = 4;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.add('is-visible');
  }

  _hideExifTooltip() {
    if (this._exifTooltipEl) this._exifTooltipEl.classList.remove('is-visible');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  _loadStyles() {
    const styleId = 'calendar-sidebar-styles';
    let style = document.getElementById(styleId);
    if (!style) {
        style = document.createElement('style');
        style.id = styleId;
    }
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
  /* Full accent fill */
  background: var(--color-accent) !important;
}
.cal-today.cal-has-image .cal-day-overlay {
  background: rgba(0, 0, 0, 0.55);
}
.cal-today .cal-day-num {
  color: #fff;
}
.cal-today:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent-hover);
}
/* Active (currently viewed date) — accent border only, transparent bg */
.cal-active:not(.cal-today) {
  box-shadow: 0 0 0 2px var(--color-accent);
}
.cal-active:not(.cal-today):hover {
  box-shadow: 0 0 0 2px var(--color-accent), 0 0 0 4px var(--interactive-accent-hover);
}
/* When today is also the active date, today styling takes precedence */

/* --- EXIF tooltip --- */
.cal-exif-tooltip {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  max-width: 240px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
  /* Frosted glass */
  background: rgba(30, 30, 30, 0.88);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.9);
}
.cal-exif-tooltip.is-visible {
  opacity: 1;
}
.cal-exif-tooltip-row {
  display: flex;
  gap: 6px;
  white-space: nowrap;
}
.cal-exif-tooltip-label {
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
  min-width: 36px;
}
.cal-exif-tooltip-value {
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-exif-tooltip-loading {
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
}
.cal-exif-tooltip-empty {
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  font-size: 11px;
}

/* --- Weather card --- */
.cal-weather-card {
  margin: 4px 2px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  min-height: 0;
}
.cal-weather-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
}
.cal-weather-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cal-weather-temp {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-normal);
  line-height: 1.2;
}
.cal-weather-detail {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
button.cal-weather-refresh {
  cursor: pointer;
  padding: 0;
  border: none;
  background: none !important;
  box-shadow: none !important;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s ease;
  opacity: 0.65;
}
button.cal-weather-refresh:hover {
  color: var(--text-normal);
  opacity: 1;
  background: none !important;
}
.cal-weather-setup {
  margin: 4px 2px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--background-secondary);
  border: 1px dashed var(--background-modifier-border);
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}
.cal-weather-loading {
  opacity: 0.6;
}
.cal-weather-error {
  opacity: 0.7;
}
/* --- Weather badge on day cells --- */
.cal-weather-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 10px;
  z-index: 3;
  pointer-events: none;
  line-height: 1;
}

/* --- Daily note weather overlay (Day One style frosted-glass chip) --- */
.cal-note-overlay {
  position: absolute;
  top: 48px;
  right: 8px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 10px;
  /* Frosted glass — progressive enhancement with rgba fallback */
  background: rgba(40, 40, 45, 0.72);
  background: color-mix(in srgb, var(--background-secondary) 60%, transparent);
  backdrop-filter: blur(8px) saturate(130%);
  -webkit-backdrop-filter: blur(8px) saturate(130%);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border: 1px solid color-mix(in srgb, var(--background-modifier-border) 50%, transparent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: var(--text-normal);
  pointer-events: auto;
  max-width: 320px;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.cal-note-overlay.is-visible {
  opacity: 1;
  transform: translateY(0);
}
.cal-note-overlay .cal-overlay-icon {
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}
.cal-note-overlay .cal-overlay-info {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  overflow: hidden;
}
.cal-note-overlay .cal-overlay-temp {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-normal);
  line-height: 1.3;
}
.cal-note-overlay .cal-overlay-detail {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-note-overlay button.cal-overlay-refresh {
  cursor: pointer;
  padding: 0;
  border: none;
  background: none !important;
  box-shadow: none !important;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  opacity: 0.65;
}
.cal-note-overlay button.cal-overlay-refresh:hover {
  color: var(--text-normal);
  opacity: 1;
  background: none !important;
}
.cal-note-overlay .is-loading {
  opacity: 0.5;
}
.cal-note-overlay .spin {
  animation: cal-spin 1s linear infinite;
}
@keyframes cal-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .cal-note-overlay,
  .cal-note-overlay.is-visible {
    transition: none;
  }
  .cal-note-overlay .spin {
    animation-duration: 2s;
  }
}
`;
    if (!style.parentElement) {
    document.head.appendChild(style);
}
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
   Weather Service — Open-Meteo integration
   ============================================================ */

// WMO Weather interpretation codes (https://open-meteo.com/en/docs)
const WMO_CODES = [
  { code: 0,   condition: 'Clear sky',         icon: '\u2600\uFE0F' }, // ☀️
  { code: 1,   condition: 'Mainly clear',       icon: '\uD83C\uDF1E' }, // 🌞
  { code: 2,   condition: 'Partly cloudy',      icon: '\u26C5' },      // ⛅
  { code: 3,   condition: 'Overcast',           icon: '\u2601\uFE0F' }, // ☁️
  { code: 45,  condition: 'Foggy',              icon: '\uD83C\uDF2B\uFE0F' }, // 🌫️
  { code: 48,  condition: 'Depositing rime fog',icon: '\uD83C\uDF2B\uFE0F' }, // 🌫️
  { code: 51,  condition: 'Light drizzle',      icon: '\uD83D\uDCA7' }, // 💧
  { code: 53,  condition: 'Moderate drizzle',   icon: '\uD83D\uDCA7' }, // 💧
  { code: 55,  condition: 'Dense drizzle',      icon: '\uD83D\uDCA7' }, // 💧
  { code: 61,  condition: 'Slight rain',        icon: '\uD83C\uDF27\uFE0F' }, // 🌧️
  { code: 63,  condition: 'Moderate rain',      icon: '\uD83C\uDF27\uFE0F' }, // 🌧️
  { code: 65,  condition: 'Heavy rain',         icon: '\uD83C\uDF27\uFE0F' }, // 🌧️
  { code: 71,  condition: 'Slight snow fall',   icon: '\uD83D\uDE81' }, // ❄️
  { code: 73,  condition: 'Moderate snow fall', icon: '\uD83D\uDE81' }, // ❄️
  { code: 75,  condition: 'Heavy snow fall',    icon: '\uD83D\uDE81' }, // ❄️
  { code: 77,  condition: 'Snow grains',        icon: '\uD83D\uDE81' }, // ❄️
  { code: 80,  condition: 'Slight rain showers',icon: '\uD83C\uDF27\uFE0F' }, // 🌧️
  { code: 81,  condition: 'Moderate rain showers',icon: '\uD83C\uDF27\uFE0F' }, // 🌧️
  { code: 82,  condition: 'Violent rain showers', icon: '\uD83C\uDF27\uFE0F' }, // 🌧️
  { code: 85,  condition: 'Slight snow showers',icon: '\uD83D\uDE81' }, // ❄️
  { code: 86,  condition: 'Heavy snow showers', icon: '\uD83D\uDE81' }, // ❄️
  { code: 95,  condition: 'Thunderstorm',       icon: '\u26C8\uFE0F' }, // ⛈️
  { code: 96,  condition: 'Thunderstorm w/ hail',icon: '\u26C8\uFE0F' }, // ⛈️
  { code: 99,  condition: 'Thunderstorm w/ heavy hail',icon: '\u26C8\uFE0F' }, // ⛈️
];

/** Look up WMO code metadata; falls back to generic description. */
function _lookupWmo(code) {
  const entry = WMO_CODES.find((w) => w.code === code);
  return entry || { condition: `Weather code ${code}`, icon: '\uD83C\uDF26\uFE0F' }; // 🌦️
}

/** Validate that lat/lng are within acceptable ranges. */
function _validateCoords(lat, lng) {
  const n = parseFloat(lat);
  const g = parseFloat(lng);
  return (
    typeof n === 'number' && !isNaN(n) && n >= -90 && n <= 90 &&
    typeof g === 'number' && !isNaN(g) && g >= -180 && g <= 180
  );
}

/**
 * WeatherService — handles Open-Meteo API calls and frontmatter snapshot persistence.
 * Singleton shared across CalendarView instances.
 */
class WeatherService {
  constructor(plugin) {
    this.plugin = plugin;
    // Per-date in-flight promise map to avoid duplicate requests
    this._inFlight = new Map();
    // Per-date memory cache to avoid repeated network calls for missing files
    this._memoryCache = new Map();
  }

  /**
   * Get weather snapshot for a given date string (YYYY-MM-DD).
   * Reads existing frontmatter snapshot first; fetches only when missing/stale.
   * Returns cached snapshot or fetched data, never blocks caller.
   */
  async getSnapshot(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return null;

    // Return existing in-flight promise to deduplicate concurrent calls
    if (this._inFlight.has(dateStr)) {
      return this._inFlight.get(dateStr);
    }

    const promise = this._fetchOrUseCached(dateStr).finally(() => {
      this._inFlight.delete(dateStr);
    });
    this._inFlight.set(dateStr, promise);
    return promise;
  }

  /** Check if we should fetch or use cached data.
   * Accepts either a frontmatter snapshot ({fetchedAt}) or a memory cache record ({snapshot, cachedAt}). */
  _shouldFetch(record, ttlHours) {
    // Memory cache record shape: { snapshot, cachedAt }
    if (record && typeof record === 'object' && 'cachedAt' in record) {
      if (!record.cachedAt) return true;
      const ageMs = Date.now() - new Date(record.cachedAt).getTime();
      return ageMs > ttlHours * 60 * 60 * 1000;
    }
    // Frontmatter snapshot shape: { fetchedAt, ...weather fields }
    if (!record) return true;
    if (!record.fetchedAt) return true;
    const ageMs = Date.now() - new Date(record.fetchedAt).getTime();
    return ageMs > ttlHours * 60 * 60 * 1000;
  }

  /** Fetch from Open-Meteo or return cached snapshot from frontmatter. */
  async _fetchOrUseCached(dateStr) {
    const s = this.plugin.settings;
    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const ttlHours = s.weatherTtlHours || 2;
    const locationName = s.weatherLocationName || '';

    // Try reading existing snapshot from frontmatter first
    const path = `${s.dailyFolder}/${dateStr}.md`;
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);

    if (existingFile instanceof TFile) {
      const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
      if (cache?.frontmatter) {
        const snap = cache.frontmatter._calendar_weather;
        if (snap && typeof snap === 'object' && !this._shouldFetch(snap, ttlHours)) {
          return snap;
        }
      }
    } else {
      // File doesn't exist — check memory cache to avoid repeated fetches
      const cachedRecord = this._memoryCache.get(dateStr);
      if (cachedRecord && !this._shouldFetch(cachedRecord, ttlHours)) {
        return cachedRecord.snapshot;
      }
    }

    // Fetch from Open-Meteo
    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      // Cache a null-result record so we don't hammer the API for missing notes
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: new Date().toISOString() });
      return null;
    }

    // Persist snapshot to frontmatter if the file now exists
    await this._persistSnapshot(dateStr, weather);

    // Also cache in memory for subsequent calls on non-existent files
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: new Date().toISOString() });

    return weather;
  }

  /** Call Open-Meteo API for current + forecast data. */
  async _fetchFromOpenMeteo(lat, lng, dateStr, units, locationName) {
    const targetDate = new Date(dateStr + 'T00:00:00Z');
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const isToday = targetDate.getTime() === now.getTime();

    // Build daily params
    const dailyParams = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      daily: 'temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max',
      timezone: 'UTC',
      start_date: dateStr,
      end_date: dateStr,
    });
    if (units === 'imperial') {
      dailyParams.set('temperature_unit', 'fahrenheit');
      dailyParams.set('wind_speed_unit', 'mph');
    } else {
      dailyParams.set('temperature_unit', 'celsius');
      dailyParams.set('wind_speed_unit', 'kmh');
    }

    // Single combined request for today (current + daily), daily-only for other dates
    let baseUrl, url;
    if (isToday) {
      const combinedParams = new URLSearchParams({
        latitude: String(lat),
        longitude: String(lng),
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
        daily: 'temperature_2m_max,temperature_2m_min,weathercode,relative_humidity_2m_max,apparent_temperature_max',
        timezone: 'UTC',
        start_date: dateStr,
        end_date: dateStr,
      });
      if (units === 'imperial') {
        combinedParams.set('temperature_unit', 'fahrenheit');
        combinedParams.set('wind_speed_unit', 'mph');
      } else {
        combinedParams.set('temperature_unit', 'celsius');
        combinedParams.set('wind_speed_unit', 'kmh');
      }
      baseUrl = 'https://api.open-meteo.com/v1/forecast';
      url = `${baseUrl}?${combinedParams.toString()}`;
    } else {
      baseUrl = targetDate < now ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
      url = `${baseUrl}?${dailyParams.toString()}`;
    }

    let response;
    try {
      response = await requestUrl({ url, timeout: 10000 });
    } catch (err) {
      console.warn('[CalendarSidebar] Weather fetch failed:', err.message);
      return null;
    }

    if (response.status !== 200 || !response.json) {
      console.warn('[CalendarSidebar] Weather API returned status', response.status);
      return null;
    }

    const json = response.json;

    // --- Today: combined current + daily ---
    if (isToday && json.current) {
      const cur = json.current;
      const code = typeof cur.weather_code === 'number' ? cur.weather_code : null;
      if (code !== null) {
        const wmo = _lookupWmo(code);
        const tempCur = typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null;
        const feelsCur = typeof cur.apparent_temperature === 'number' ? Math.round(cur.apparent_temperature) : null;
        const humCur = typeof cur.relative_humidity_2m === 'number' ? cur.relative_humidity_2m : null;

        // Merge daily high/low into current snapshot
        let high = null, low = null, feelsLike = null, humidity = null;
        if (json.daily) {
          const dates = json.daily.time || [];
          const idx = dates.indexOf(dateStr);
          if (idx >= 0) {
            high = typeof json.daily.temperature_2m_max?.[idx] === 'number' ? json.daily.temperature_2m_max[idx] : null;
            low = typeof json.daily.temperature_2m_min?.[idx] === 'number' ? json.daily.temperature_2m_min[idx] : null;
            feelsLike = typeof json.daily.apparent_temperature_max?.[idx] === 'number' ? json.daily.apparent_temperature_max[idx] : null;
            humidity = typeof json.daily.relative_humidity_2m_max?.[idx] === 'number' ? json.daily.relative_humidity_2m_max[idx] : null;
          }
        }

        return {
          fetchedAt: new Date().toISOString(),
          date: dateStr,
          location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
          latitude: lat,
          longitude: lng,
          temperature: tempCur,
          feelsLike: feelsCur,
          humidity: humCur,
          weatherCode: code,
          condition: wmo.condition,
          icon: wmo.icon,
          high: high,
          low: low,
          temperatureLabel: 'Now',
          units: units,
        };
      }
    }

    // Fallback: daily-only path (non-today or combined request lacked useful data)
    const dailyData = await this._dailyOnlyFetch(lat, lng, dateStr, dailyParams, units);
    if (!dailyData) return null;
    // Validate response status and JSON structure before accessing daily data
    if (dailyData.status !== 200 || !dailyData.json) {
      console.warn('[CalendarSidebar] Daily weather fetch returned unexpected response');
      return null;
    }
    const dailyJson = dailyData.json;
    if (!dailyJson?.daily) {
      console.warn('[CalendarSidebar] Daily weather data missing "daily" field');
      return null;
    }
    const daily = dailyJson.daily;
    const dates = daily.time || [];
    const idx = dates.indexOf(dateStr);

    if (idx === -1) {
      console.warn(`[CalendarSidebar] Weather data unavailable for ${dateStr}`);
      return null;
    }

    const code = daily.weathercode?.[idx];
    const tempMax = daily.temperature_2m_max?.[idx];
    const tempMin = daily.temperature_2m_min?.[idx];
    const feelsLike = daily.apparent_temperature_max?.[idx];
    const humidity = daily.relative_humidity_2m_max?.[idx];

    if (typeof code !== 'number') return null;

    const wmo = _lookupWmo(code);

    return {
      fetchedAt: new Date().toISOString(),
      date: dateStr,
      location: locationName || `${lat.toFixed(2)}, ${lng.toFixed(2)}`,
      latitude: lat,
      longitude: lng,
      temperature: typeof tempMax === 'number' ? Math.round(tempMax) : null,
      feelsLike: typeof feelsLike === 'number' ? Math.round(feelsLike) : null,
      humidity: typeof humidity === 'number' ? humidity : null,
      weatherCode: code,
      condition: wmo.condition,
      icon: wmo.icon,
      high: typeof tempMax === 'number' ? tempMax : null,
      low: typeof tempMin === 'number' ? tempMin : null,
      temperatureLabel: 'High',
      units: units,
    };
  }

  /** Fetch only daily data (for non-today dates or fallback). */
  async _dailyOnlyFetch(lat, lng, dateStr, params, units) {
    const baseUrl = (() => {
      const targetDate = new Date(dateStr + 'T00:00:00Z');
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      return targetDate < now ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    })();

    const url = `${baseUrl}?${params.toString()}`;

    try {
      return await requestUrl({ url, timeout: 8000 });
    } catch (err) {
      console.warn('[CalendarSidebar] Daily weather fetch failed:', err.message);
      return null;
    }
  }

  /** Persist weather snapshot to daily note frontmatter. */
  async _persistSnapshot(dateStr, weather) {
    const path = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
    const file = this.plugin.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      // File doesn't exist yet — store in memory, will persist when created
      return;
    }

    try {
      await this.plugin.app.fileManager.processFrontMatter(file, (fm) => {
        fm._calendar_weather = { ...weather };
      });
    } catch (err) {
      console.warn('[CalendarSidebar] Failed to persist weather snapshot:', err.message);
    }
  }

  /** Force refresh weather for a specific date (bypasses TTL check). */
  async forceRefresh(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return null;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return null;

    // Clear any in-flight promise for this date
    this._inFlight.delete(dateStr);

    const lat = parseFloat(s.weatherLatitude);
    const lng = parseFloat(s.weatherLongitude);
    const units = s.weatherUnits;
    const locationName = s.weatherLocationName || '';

    const weather = await this._fetchFromOpenMeteo(lat, lng, dateStr, units, locationName);
    if (!weather) {
      this._memoryCache.set(dateStr, { snapshot: null, cachedAt: new Date().toISOString() });
      return null;
    }

    // Update memory cache immediately so UI can read it without waiting on persistence
    this._memoryCache.set(dateStr, { snapshot: weather, cachedAt: new Date().toISOString() });

    // Persist to frontmatter asynchronously — fire-and-forget with error handling
    this._persistSnapshot(dateStr, weather).catch((err) => {
      console.warn('[CalendarSidebar] Async weather persistence failed:', err.message);
    });

    return weather;
  }

  /** Check if a date has a valid cached snapshot (for badge display). */
  hasCachedSnapshot(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return false;

    const path = `${s.dailyFolder}/${dateStr}.md`;
    const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(existingFile instanceof TFile)) return false;

    const cache = this.plugin.app.metadataCache.getFileCache(existingFile);
    if (cache?.frontmatter?._calendar_weather) {
      return true;
    }
    return false;
  }
}

/* ============================================================
   Locale / i18n
   ============================================================ */
const LOCALE = {
  en: {
    now:      'Now',
    high:     'High',
    feels:    'Feels',
    humidity: 'Humidity',
    low:      'Low',
    loading:  'Loading...',
    unavailable:    'Unavailable',
    checkSettings:  'Check settings or try again',
    noData:         'No weather data available',
    refresh:        'Refresh weather',
    setupHint:      '\u26A0\uFE0F  Set latitude & longitude in settings to enable weather',
    setupAria:      'Weather requires configured coordinates.',
    weatherUpdated: (d) => `Weather updated for ${d}`,
    noDataFor:      (d) => `No weather data available for ${d}`,
    refreshFailed:  (e) => `Failed to refresh weather: ${e}`,
    // Settings tab
    s_dailyFolder:       'Daily notes folder',
    s_dailyFolderDesc:   'Path to your daily notes folder (relative to vault root). Notes should be named YYYY-MM-DD.md',
    s_thumbnailFilter:   'Thumbnail filter',
    s_thumbnailFilterDesc: 'Which embedded images to show as date thumbnails',
    s_thumbnailAll:      'All embedded images',
    s_thumbnailDate:     'Only date-prefixed (YYYY-MM-DD_*)',
    s_weather:           'Weather',
    s_weatherEnable:     'Enable weather',
    s_weatherEnableDesc: 'Show weather info for dates in the calendar sidebar',
    s_latitude:          'Latitude',
    s_latitudeDesc:      'Your latitude (e.g. 39.9042 for Beijing)',
    s_longitude:         'Longitude',
    s_longitudeDesc:     'Your longitude (e.g. 116.4074 for Beijing)',
    s_locationName:      'Location name',
    s_locationNameDesc:  'Display name (optional, shown in tooltip)',
    s_tempUnits:         'Temperature units',
    s_tempUnitsDesc:     'Display temperature in Celsius or Fahrenheit',
    s_autoFetch:         'Auto-fetch weather',
    s_autoFetchDesc:     'Automatically fetch weather when opening a daily note',
    s_cacheTtl:          'Cache TTL (hours)',
    s_cacheTtlDesc:      'How long to keep cached weather before re-fetching',
    s_language:          'Language / 语言',
    s_languageDesc:      'Display language for weather labels',
    s_browseFolders:     'Browse folders',
    s_celsius:           'Celsius (\u00B0C)',
    s_fahrenheit:        'Fahrenheit (\u00B0F)',
    s_english:           'English',
    s_chinese:           '中文',
    // EXIF tooltip
    s_exif:              'EXIF Metadata',
    s_exifEnable:        'Show image EXIF metadata',
    s_exifEnableDesc:    'Display camera settings and capture info when hovering over images',
    exif_loading:        'Reading...',
    exif_noData:         'No EXIF data',
    exif_noDataDesc:     'This image does not contain camera metadata',
    exif_camera:         'Camera',
    exif_lens:           'Lens',
    exif_date:           'Date',
    exif_aperture:       'Aperture',
    exif_shutter:        'Shutter',
    exif_iso:            'ISO',
    exif_focal:          'Focal Length',
    exif_gps:            'GPS',
    exif_software:       'Software',
  },
  zh: {
    now:      '现在',
    high:     '最高',
    feels:    '体感',
    humidity: '湿度',
    low:      '最低',
    loading:  '加载中...',
    unavailable:    '不可用',
    checkSettings:  '检查设置或重试',
    noData:         '暂无天气数据',
    refresh:        '刷新天气',
    setupHint:      '\u26A0\uFE0F  在设置中配置经纬度以启用天气',
    setupAria:      '天气需要配置坐标。',
    weatherUpdated: (d) => `已更新 ${d} 的天气`,
    noDataFor:      (d) => `${d} 暂无天气数据`,
    refreshFailed:  (e) => `刷新天气失败：${e}`,
    // Settings tab
    s_dailyFolder:       '日记文件夹',
    s_dailyFolderDesc:   '日记文件所在的文件夹路径（相对于 vault 根目录），文件命名格式 YYYY-MM-DD.md',
    s_thumbnailFilter:   '缩略图筛选',
    s_thumbnailFilterDesc: '选择哪些嵌入图片作为日期缩略图',
    s_thumbnailAll:      '所有嵌入图片',
    s_thumbnailDate:     '仅日期前缀 (YYYY-MM-DD_*)',
    s_weather:           '天气',
    s_weatherEnable:     '启用天气',
    s_weatherEnableDesc: '在日历侧边栏中显示日期天气信息',
    s_latitude:          '纬度',
    s_latitudeDesc:      '所在地纬度（如 北京 39.9042）',
    s_longitude:         '经度',
    s_longitudeDesc:     '所在地经度（如 北京 116.4074）',
    s_locationName:      '位置名称',
    s_locationNameDesc:  '显示名称（可选，鼠标悬停时显示）',
    s_tempUnits:         '温度单位',
    s_tempUnitsDesc:     '选择摄氏度或华氏度',
    s_autoFetch:         '自动获取天气',
    s_autoFetchDesc:     '打开日记时自动获取天气数据',
    s_cacheTtl:          '缓存时长（小时）',
    s_cacheTtlDesc:      '天气数据缓存的有效时长，过期后重新获取',
    s_language:          '语言 / Language',
    s_languageDesc:      '天气标签的显示语言',
    s_browseFolders:     '浏览文件夹',
    s_celsius:           '摄氏 (\u00B0C)',
    s_fahrenheit:        '华氏 (\u00B0F)',
    s_english:           'English',
    s_chinese:           '中文',
    // EXIF tooltip
    s_exif:              'EXIF 信息',
    s_exifEnable:        '显示图片 EXIF 信息',
    s_exifEnableDesc:    '鼠标悬停在日历图片上时，显示相机参数和拍摄数据',
    exif_loading:        '读取中...',
    exif_noData:         '无 EXIF 信息',
    exif_noDataDesc:     '这张图片没有包含拍摄元数据',
    exif_camera:         '相机',
    exif_lens:           '镜头',
    exif_date:           '拍摄时间',
    exif_aperture:       '光圈',
    exif_shutter:        '快门',
    exif_iso:            'ISO',
    exif_focal:          '焦距',
    exif_gps:            'GPS',
    exif_software:       '软件',
  },
};

/** Look up a localized string by key. */
function _l(lang, key, ...args) {
  const entry = LOCALE[lang]?.[key];
  return typeof entry === 'function' ? entry(...args) : (entry ?? key);
}

/* ============================================================
   Lightweight JPEG EXIF Parser (zero-dependency)
   ============================================================ */

/**
 * Parse EXIF data from a JPEG ArrayBuffer.
 * Returns an object with human-readable values, or null if no EXIF found.
 */
/* ============================================================
   Shared TIFF/EXIF Parser (format-agnostic)
   Takes a DataView positioned at the TIFF header.
   ============================================================ */

function _parseExifData(exifBytes) {
  const dv = new DataView(exifBytes);
  let le = true; // little-endian default
  const r16 = (o) => dv.getUint16(o, le);
  const r32 = (o) => dv.getUint32(o, le);

  function _parseTiff(offset, depth) {
    if (depth > 2) return null;
    const bo = dv.getUint16(offset);
    if (bo === 0x4949) le = true;
    else if (bo === 0x4D4D) le = false;
    else return null;
    if (r16(offset + 2) !== 42) return null;
    const ifdOff = r32(offset + 4);
    if (ifdOff === 0) return null;
    return _readIfd(offset + ifdOff, offset, depth);
  }

  function _readIfd(ifdStart, tiffBase, depth) {
    const n = r16(ifdStart);
    if (n === 0 || n > 256) return null;
    const result = {};
    let gpsOff = null;
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const type = r16(eo + 2);
      const count = r32(eo + 4);
      const vo = eo + 8;
      if (tag === 0x8769) { // EXIF IFD
        const exifIfd = r32(vo);
        if (exifIfd > 0) {
          const d = _readIfd(tiffBase + exifIfd, tiffBase, depth + 1);
          if (d) Object.assign(result, d);
        }
        continue;
      }
      if (tag === 0x8825) { gpsOff = r32(vo); continue; } // GPS IFD
      const val = _readTag(eo, type, count, tiffBase);
      switch (tag) {
        case 0x010F: result.make = val; break;
        case 0x0110: result.model = val; break;
        case 0x0131: result.software = val; break;
        case 0x9003: result.dateTimeOriginal = val; break;
        case 0x829A: result.exposureTime = val; break;
        case 0x829D: result.fNumber = val; break;
        case 0x8827: result.iso = val; break;
        case 0x920A: result.focalLength = val; break;
        case 0xA434: result.lensModel = val; break;
      }
    }
    if (gpsOff !== null && gpsOff > 0) {
      const g = _readGps(tiffBase + gpsOff, tiffBase);
      if (g) Object.assign(result, g);
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function _readGps(ifdStart, tiffBase) {
    const n = r16(ifdStart);
    if (n === 0 || n > 64) return null;
    const r = {};
    for (let i = 0; i < n; i++) {
      const eo = ifdStart + 2 + i * 12;
      const tag = r16(eo);
      const val = _readTag(eo, r16(eo + 2), r32(eo + 4), tiffBase);
      if (tag === 1) r.gpsLatRef = val;
      if (tag === 2) r.gpsLat = val;
      if (tag === 3) r.gpsLonRef = val;
      if (tag === 4) r.gpsLon = val;
    }
    if (r.gpsLat && Array.isArray(r.gpsLat) && r.gpsLat.length >= 3) {
      const lat = r.gpsLat[0] + r.gpsLat[1] / 60 + r.gpsLat[2] / 3600;
      r.gpsLatDecimal = r.gpsLatRef === 'S' ? -lat : lat;
    }
    if (r.gpsLon && Array.isArray(r.gpsLon) && r.gpsLon.length >= 3) {
      const lon = r.gpsLon[0] + r.gpsLon[1] / 60 + r.gpsLon[2] / 3600;
      r.gpsLonDecimal = r.gpsLonRef === 'W' ? -lon : lon;
    }
    return r;
  }

  function _readTag(entryOffset, type, count, tiffBase) {
    const dataOff = entryOffset + 8;
    const sizes = { 1:1, 2:1, 3:2, 4:4, 5:8, 6:1, 7:1, 8:2, 9:4, 10:8, 11:4, 12:8 };
    const sz = sizes[type] || 1;
    const total = count * sz;
    const vo = total <= 4 ? dataOff : (tiffBase + r32(dataOff));

    switch (type) {
      case 1: case 6: case 7:
        if (count === 1) return dv.getUint8(vo);
        const bytes = []; for (let i = 0; i < count; i++) bytes.push(dv.getUint8(vo + i));
        return bytes;
      case 2:
        let s = ''; for (let i = 0; i < count - 1; i++) s += String.fromCharCode(dv.getUint8(vo + i));
        return s.trim();
      case 3:
        if (count === 1) return r16(vo);
        const sa = []; for (let i = 0; i < count; i++) sa.push(r16(vo + i * 2));
        return sa;
      case 4:
        if (count === 1) return r32(vo);
        const la = []; for (let i = 0; i < count; i++) la.push(r32(vo + i * 4));
        return la;
      case 5: case 10:
        if (count === 1) { const n = r32(vo), d = r32(vo + 4); return d === 0 ? n : n / d; }
        const ra = [];
        for (let i = 0; i < count; i++) { const n = r32(vo + i * 8), d = r32(vo + i * 8 + 4); ra.push(d === 0 ? n : n / d); }
        return ra;
      case 9:
        if (count === 1) return dv.getInt32(vo, le);
        const sla = []; for (let i = 0; i < count; i++) sla.push(dv.getInt32(vo + i * 4, le));
        return sla;
      default: return dv.getUint8(vo);
    }
  }

  const result = _parseTiff(0, 0);
  return result;
}

/* ============================================================
   Format-specific EXIF extractors
   ============================================================ */

/** Extract EXIF from JPEG (APP1 marker). */
function parseJpegExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return null;
  let offset = 2;
  while (offset < dv.byteLength - 1) {
    const marker = dv.getUint16(offset);
    if (marker === 0xFFE1) {
      if (dv.getUint32(offset + 4) === 0x45786966) { // "Exif"
        return _parseExifData(arrayBuffer.slice(offset + 10));
      }
    }
    if (marker < 0xFF00 || marker === 0xFFD8 || marker === 0xFFD9) break;
    const segLen = dv.getUint16(offset + 2);
    if (segLen < 2) break;
    offset += 2 + segLen;
  }
  return null;
}

/** Extract EXIF from PNG (eXIf chunk). */
function parsePngExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 8) return null;
  // PNG signature: 137 80 78 71 13 10 26 10
  if (dv.getUint32(0) !== 0x89504E47 || dv.getUint32(4) !== 0x0D0A1A0A) return null;
  let offset = 8;
  while (offset < dv.byteLength - 8) {
    const len = dv.getUint32(offset); // chunk length (big-endian)
    const type = dv.getUint32(offset + 4); // chunk type (4 ASCII chars)
    if (type === 0x65495866) { // "eXIf"
      // Chunk data starts at offset + 8, length is `len`
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + len));
    }
    if (type === 0x49454E44) break; // "IEND" — end of PNG
    offset += 12 + len; // length(4) + type(4) + data(len) + crc(4)
  }
  return null;
}

/** Extract EXIF from WebP (RIFF container, EXIF chunk). */
function parseWebpExif(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 16) return null;
  // RIFF header: "RIFF" + fileSize + "WEBP"
  if (dv.getUint32(0) !== 0x52494646) return null; // "RIFF"
  if (dv.getUint32(8) !== 0x57454250) return null; // "WEBP"
  let offset = 12;
  while (offset < dv.byteLength - 8) {
    const fourCC = dv.getUint32(offset);
    const chunkSize = dv.getUint32(offset + 4, true); // little-endian!
    if (fourCC === 0x45584946) { // "EXIF"
      return _parseExifData(arrayBuffer.slice(offset + 8, offset + 8 + chunkSize));
    }
    if (fourCC === 0x56503820) { // "VP8 " — image data, no more metadata after this
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are padded to even
  }
  return null;
}

/** Extract EXIF from HEIC/HEIF (ISOBMFF container — scan for TIFF header). */
function parseHeicExif(arrayBuffer) {
  // HEIC files store EXIF as raw TIFF data inside the meta/mdat boxes.
  // We scan for the TIFF byte-order marker (II=0x4949 or MM=0x4D4D)
  // followed by magic 42 (0x002A).
  const dv = new DataView(arrayBuffer);
  const max = dv.byteLength - 8;
  for (let i = 0; i < max; i++) {
    const bo = dv.getUint16(i);
    if ((bo === 0x4949 || bo === 0x4D4D) && dv.getUint16(i + 2, bo === 0x4949) === 42) {
      // Found TIFF header — extract from here
      const exifSlice = arrayBuffer.slice(i);
      return _parseExifData(exifSlice);
    }
  }
  return null;
}

/** Unified entry point — auto-detects format and extracts EXIF. */
function parseImageExif(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return null;
  const dv = new DataView(arrayBuffer);
  const magic = dv.getUint16(0);
  const magic4 = dv.getUint32(0);
  // Check for HEIC ftyp box at offset 4: size(4) + "ftyp" + brand
  const brand4 = dv.getUint32(8);
  const isHeic = (arrayBuffer.byteLength > 12 && dv.getUint32(4) === 0x66747970 && // "ftyp"
    (brand4 === 0x68656963 || brand4 === 0x68656978 || brand4 === 0x68657663 || // heic/heix/hevc
     brand4 === 0x6865696D || brand4 === 0x68656973 || brand4 === 0x6865766D || // heim/heis/hevm
     brand4 === 0x68657673 || brand4 === 0x6D696631 || brand4 === 0x6D736631));  // hevs/mif1/msf1

  // JPEG: 0xFFD8
  if (magic === 0xFFD8) return parseJpegExif(arrayBuffer);
  // PNG: 0x89504E47
  if (magic4 === 0x89504E47) return parsePngExif(arrayBuffer);
  // WebP: 0x52494646 ("RIFF")
  if (magic4 === 0x52494646) return parseWebpExif(arrayBuffer);
  // HEIC/HEIF: ISOBMFF container
  if (isHeic) return parseHeicExif(arrayBuffer);

  return null;
}

/**
 * Format raw EXIF data into human-readable display fields.
 * Returns null if no meaningful data was found.
 */
function formatExifForDisplay(raw) {
  if (!raw) return null;

  const fields = [];

  // Camera: Make + Model
  if (raw.make || raw.model) {
    const make = raw.make || '';
    const model = raw.model || '';
    fields.push({ key: 'exif_camera', value: (make + ' ' + model).trim() });
  }

  // Lens
  if (raw.lensModel) {
    fields.push({ key: 'exif_lens', value: raw.lensModel });
  }

  // Date
  if (raw.dateTimeOriginal) {
    let dt = raw.dateTimeOriginal;
    if (typeof dt === 'string' && dt.includes(' ')) {
      dt = dt.replace(' ', '  '); // add spacing
    }
    fields.push({ key: 'exif_date', value: dt });
  }

  // Aperture
  if (raw.fNumber !== undefined && raw.fNumber !== null) {
    const f = typeof raw.fNumber === 'number' ? raw.fNumber.toFixed(1) : String(raw.fNumber);
    fields.push({ key: 'exif_aperture', value: 'f/' + f });
  }

  // Shutter speed
  if (raw.exposureTime !== undefined && raw.exposureTime !== null) {
    let shutter;
    if (typeof raw.exposureTime === 'number') {
      if (raw.exposureTime >= 1) {
        shutter = raw.exposureTime + 's';
      } else {
        const denom = Math.round(1 / raw.exposureTime);
        shutter = '1/' + denom + 's';
      }
    } else {
      shutter = String(raw.exposureTime);
    }
    fields.push({ key: 'exif_shutter', value: shutter });
  }

  // ISO
  if (raw.iso !== undefined && raw.iso !== null) {
    fields.push({ key: 'exif_iso', value: String(raw.iso) });
  }

  // Focal length
  if (raw.focalLength !== undefined && raw.focalLength !== null) {
    const fl = typeof raw.focalLength === 'number'
      ? Math.round(raw.focalLength) + 'mm'
      : String(raw.focalLength);
    fields.push({ key: 'exif_focal', value: fl });
  }

  // GPS
  if (raw.gpsLatDecimal !== undefined && raw.gpsLonDecimal !== undefined) {
    const lat = raw.gpsLatDecimal.toFixed(4);
    const lon = raw.gpsLonDecimal.toFixed(4);
    fields.push({ key: 'exif_gps', value: lat + ', ' + lon });
  }

  // Software
  if (raw.software) {
    fields.push({ key: 'exif_software', value: raw.software });
  }

  return fields.length > 0 ? fields : null;
}

/* ============================================================
   Image Metadata Cache
   ============================================================ */

class ImageMetadataCache {
  /**
   * @param {import('obsidian').App} app
   */
  constructor(app) {
    this.app = app;
    /** @type {Map<string, { fields: Array<{key:string,value:string}> } | null>} */
    this._cache = new Map();
    /** @type {Map<string, Promise>} */
    this._pending = new Map();
  }

  /**
   * Get formatted EXIF fields for an image file.
   * @param {import('obsidian').TFile} file
   * @returns {Promise<Array<{key:string,value:string}> | null>}
   */
  async get(file) {
    const filePath = file.path;
    const cached = this._cache.get(filePath);
    if (cached !== undefined) return cached;

    const pending = this._pending.get(filePath);
    if (pending) return pending;

    const promise = this._load(file);
    this._pending.set(filePath, promise);
    try {
      const result = await promise;
      this._cache.set(filePath, result);
      return result;
    } finally {
      this._pending.delete(filePath);
    }
  }

  async _load(file) {
    try {
      const buf = await this.app.vault.readBinary(file);
      const raw = parseImageExif(buf);
      if (!raw) return null;
      return formatExifForDisplay(raw);
    } catch (_) {
      return null;
    }
  }

  /** Invalidate cache for a specific file, or all files if no path given. */
  invalidate(filePath) {
    if (filePath) {
      this._cache.delete(filePath);
      this._pending.delete(filePath);
    } else {
      this._cache.clear();
      this._pending.clear();
    }
  }
}

/* ============================================================
   HEIC Thumbnail Cache (libheif-js powered)
   ============================================================ */

const HEIC_EXTS = ['heic', 'heif'];

class HeicCache {
  constructor(app) {
    this.app = app;
    /** @type {Map<string, {dataUrl:string, width:number, height:number}>} */
    this._cache = new Map();
    /** @type {Map<string, Promise>} */
    this._pending = new Map();
    this._libheifReady = null;
  }

  _getLibheif() {
    if (!this._libheifReady) {
      const plugin = this.app.plugins?.plugins?.['calendar-sidebar'];
      const factory = plugin?._libheifFactory;
      if (!factory) {
        return Promise.reject(new Error('libheif not loaded'));
      }
      // factory() may return a Promise or the libheif object directly
      this._libheifReady = Promise.resolve(factory());
    }
    return this._libheifReady;
  }

  /**
   * Get a JPEG data URL thumbnail for a HEIC file.
   * @param {import('obsidian').TFile} file
   * @returns {Promise<{dataUrl:string, width:number, height:number}|null>}
   */
  async getThumbnail(file) {
    const key = file.path;
    if (this._cache.has(key)) return this._cache.get(key);
    if (this._pending.has(key)) return this._pending.get(key);

    const promise = this._convert(file);
    this._pending.set(key, promise);
    try {
      const result = await promise;
      if (result) this._cache.set(key, result);
      return result;
    } finally {
      this._pending.delete(key);
    }
  }

  async _convert(file) {
    try {
      const buf = await this.app.vault.readBinary(file);
      const libheif = await this._getLibheif();

      const decoder = new libheif.HeifDecoder();
      const images = decoder.decode(new Uint8Array(buf));
      if (!images || !images.length) return null;
      const img = images[0];

      const origW = img.get_width();
      const origH = img.get_height();

      // Decode to canvas
      const canvas = document.createElement('canvas');
      canvas.width = origW;
      canvas.height = origH;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(origW, origH);

      await new Promise((resolve, reject) => {
        img.display(imageData, (displayData) => {
          if (!displayData) return reject(new Error('libheif display failed'));
          resolve(displayData);
        });
      });

      ctx.putImageData(imageData, 0, 0);

      // Scale down to max 900px for thumbnails
      const maxDim = 900;
      let tw = origW, th = origH;
      if (origW > maxDim || origH > maxDim) {
        const scale = maxDim / Math.max(origW, origH);
        tw = Math.round(origW * scale);
        th = Math.round(origH * scale);
      }

      const thumb = document.createElement('canvas');
      thumb.width = tw;
      thumb.height = th;
      const thumbCtx = thumb.getContext('2d');
      thumbCtx.drawImage(canvas, 0, 0, tw, th);

      const dataUrl = thumb.toDataURL('image/jpeg', 0.75);

      return { dataUrl, width: tw, height: th };
    } catch (e) {
      console.warn('[CalendarSidebar] HEIC conversion failed:', e.message || e);
      return null;
    }
  }

  invalidate(filePath) {
    if (filePath) {
      this._cache.delete(filePath);
      this._pending.delete(filePath);
    } else {
      this._cache.clear();
      this._pending.clear();
      this._libheifReady = null;
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
    // Currently viewed date (YYYY-MM-DD), used for highlight
    this.activeDate = null;
    // Shared WeatherService from plugin (singleton)
    this.weather = plugin.weatherService;
    // Weather card element reference for live updates
    this._weatherCardEl = null;
    // Which date the current card is showing (prevents stale updates)
    this._weatherCardDate = null;
    // Weather state for today/active date
    this._weatherSnapshot = null;
    this._weatherLoading = false;
    this._weatherError = false;
    // Staleness guard: incremented on each render to discard stale async results
    this._fetchToken = 0;
    // Overlay sync: track which overlays exist per leaf to avoid duplicates
    this._overlayLeaves = new WeakSet();
    // In-flight dedup: leaf → promise, prevents concurrent duplicate fetch+mount
    this._overlayInFlight = new WeakMap();
    // Per-leaf version counter to discard stale async mounts
    this._overlayVersions = new WeakMap();
    // Track containers where we set position:relative so we can revert on unload
    this._hostPositionMarkers = new Set();
    // EXIF metadata cache (shared with plugin)
    this.exifCache = plugin.exifCache;
    // Track processed note-image elements (cleared when view is destroyed)
    this._exifNoteImages = new WeakSet();
  }

  getViewType()   { return VIEW_TYPE; }
  getDisplayText(){ return 'Calendar'; }
  getIcon()       { return 'calendar'; }

  /* ----- Lifecycle ----- */
  async onOpen() {
    this.containerEl.addClass('cal-sidebar');

    // Build data for current month
    await this.buildMonthCache(this.displayMonth);

    // Detect which date the user is currently viewing
    this._syncActiveDate();
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
    // Re-highlight when the user switches tabs/leaves
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this._syncActiveDate();
        // Defer to avoid race with click handler calling openFile
        setTimeout(() => this.render(), 0);
      })
    );
    // Sync note overlays on file-open and layout changes
    this.registerEvent(
      this.app.workspace.on('file-open', () => this._syncNoteOverlays())
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this._syncNoteOverlays())
    );
  }

  /* ----- File change refresh (debounced) ----- */
  _onFileChanged(file) {
    // Only care about Calendar/Daily/ .md files
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    const folderPrefix = this.plugin.settings.dailyFolder + '/';
    if (!file.path.startsWith(folderPrefix)) return;

    // Invalidate EXIF cache — cheap to rebuild on next hover
    if (this.exifCache) this.exifCache.invalidate();

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
    if (this.exifCache) this.exifCache.invalidate();
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

    const folderPath = this.plugin.settings.dailyFolder;
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
      let images = embeds
        .map((e) => e.link)
        .filter((link) => link && IMAGE_EXTS.includes(link.split('.').pop()?.toLowerCase()));

      // Apply thumbnail filter
      if (this.plugin.settings.thumbnailFilter === 'date-prefixed') {
        images = images.filter((link) => link.startsWith(dateStr));
      }

      if (images.length > 0) {
        map.set(dateStr, images);
      }
    }

    this.monthCache.set(key, map);
  }

  /* ----- Render the calendar ----- */
  render() {
    // Bump fetch token so stale async results are discarded
    this._fetchToken = (this._fetchToken || 0) + 1;

    const el = this.contentEl;
    el.empty();

    // Ensure EXIF tooltip element exists (reused across renders)
    this._ensureExifTooltip();

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

    // --- Weather card (below header, above weekdays) ---
    this._renderWeatherCard(el);

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
      if (dateStr === this.activeDate && !isToday) cell.addClass('cal-active');

      // Background image (first image as thumbnail)
      if (images.length > 0) {
        const bg = cell.createDiv({ cls: 'cal-day-bg' });
        const overlay = cell.createDiv({ cls: 'cal-day-overlay' });
        this._setBackground(bg, images[0], dateStr);

        // EXIF tooltip on hover
        const firstImage = images[0];
        cell.addEventListener('mouseenter', () => this._onExifEnter(cell, firstImage, dateStr));
        cell.addEventListener('mouseleave', () => this._onExifLeave());
      }

      // Weather badge for dates with cached weather
      if (this.plugin.settings.weatherEnabled && this.weather.hasCachedSnapshot(dateStr)) {
        const snap = this._readCachedWeather(dateStr);
        if (snap) {
          const badge = cell.createDiv({ cls: 'cal-weather-badge' });
          badge.setText(snap.icon);
          badge.setAttribute('aria-label', `${snap.condition}, ${snap.temperature}${this._unitSymbol(snap.units)}`);
          badge.title = `${snap.condition} · ${snap.temperature}${this._unitSymbol(snap.units)}`;
        }
      }

      // Date number
      const num = cell.createEl('span', { cls: 'cal-day-num', text: String(d) });

      // Click to open daily note — use pointerdown (fires before leaf activation)
      // so the first click after sidebar focus loss is not absorbed by Obsidian.
      cell.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this._openNote(dateStr);
      });
    }
  }

  /* ----- EXIF Tooltip (delegates to plugin) ----- */

  _ensureExifTooltip() { this.plugin._ensureExifTooltip(); }
  _showExifTooltip(el, fields, loading) { this.plugin._showExifTooltip(el, fields, loading); }
  _hideExifTooltip() { this.plugin._hideExifTooltip(); }

  /** Mouse entered a day cell with an image — start the hover timer. */
  _onExifEnter(cell, imageLink, dateStr) {
    if (!this.plugin.settings.showExif) return;
    clearTimeout(this.plugin._exifHoverTimer);
    this.plugin._hideExifTooltip();

    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
        const file = this.app.metadataCache.getFirstLinkpathDest(imageLink, sourcePath);
        if (!(file instanceof TFile)) return;
        this.plugin._showExifTooltip(cell, null, true);
        const fields = await this.exifCache.get(file);
        this.plugin._showExifTooltip(cell, fields, false);
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, 500);
  }

  _onExifLeave() {
    clearTimeout(this.plugin._exifHoverTimer);
    this.plugin._hideExifTooltip();
  }

  /* ----- Read cached weather from metadata cache (non-blocking) ----- */
  _readCachedWeather(dateStr) {
    const s = this.plugin.settings;
    const path = `${s.dailyFolder}/${dateStr}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?._calendar_weather || null;
  }

  /* ----- Render weather card below month header (idempotent) ----- */
  _renderWeatherCard(containerEl) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) {
      // Don't show anything when weather is disabled — avoid intrusive UI
      return;
    }

    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) {
      const hint = containerEl.createDiv({ cls: 'cal-weather-setup' });
      hint.setText(_l(s.weatherLanguage, 'setupHint'));
      hint.setAttribute('aria-label', _l(s.weatherLanguage, 'setupAria'));
      return;
    }

    // Use activeDate or today for the card
    const cardDate = this.activeDate || _formatDate(new Date());

    // Idempotency guard: if a card already exists for this date and has valid data, reuse it
    if (this._weatherCardDate === cardDate && this._weatherCardEl && this._weatherCardEl.isConnected) {
      // Card already exists for this date — just update badge rendering via full render
      return;
    }

    // Capture existing snapshot BEFORE resetting state
    const sameCardDate = this._weatherCardDate === cardDate;
    const existingSnap = sameCardDate ? this._weatherSnapshot : null;

    // Different date or stale card — reset state and create fresh card
    this._weatherCardDate = cardDate;
    this._weatherSnapshot = existingSnap;
    this._weatherLoading = !existingSnap;
    this._weatherError = false;

    const card = containerEl.createDiv({
      cls: this._weatherLoading ? 'cal-weather-card cal-weather-loading' : 'cal-weather-card',
    });
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    this._weatherCardEl = card;

    const iconEl = card.createDiv({ cls: 'cal-weather-icon' });
    iconEl.setText(this._weatherLoading ? '\u231B\uFE0F' : '\uD83C\uDF26\uFE0F'); // ⏳ or 🌦️

    const infoEl = card.createDiv({ cls: 'cal-weather-info' });
    const tempEl = infoEl.createDiv({ cls: 'cal-weather-temp' });
    const detailEl = infoEl.createDiv({ cls: 'cal-weather-detail' });
    tempEl.setText(_l(s.weatherLanguage, 'loading'));
    detailEl.setText(cardDate);

    // Native Obsidian refresh icon button
    const refreshBtn = card.createEl('button', {
      cls: 'cal-weather-refresh',
      attr: { 'aria-label': 'Refresh weather', title: 'Refresh weather' },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._performRefresh(cardDate, refreshBtn).catch((err) => {
        console.warn('[CalendarSidebar] Refresh weather from card failed:', err.message);
      });
    });

    // Start background fetch only if we don't have an existing snapshot
    if (this._weatherLoading) {
      this._fetchWeatherForDate(cardDate);
    } else {
      this._updateWeatherCardUI();
    }
  }

  /* ----- Update weather card UI after async data arrives ----- */
  _updateWeatherCardUI() {
    const card = this._weatherCardEl;
    if (!card || !card.isConnected) return;
    const lang = this.plugin.settings.weatherLanguage;

    card.removeClass('cal-weather-loading');

    if (this._weatherError) {
      card.addClass('cal-weather-error');
      card.querySelector('.cal-weather-icon').setText('\u26A0\uFE0F'); // ⚠️
      card.querySelector('.cal-weather-temp').setText(_l(lang, 'unavailable'));
      card.querySelector('.cal-weather-detail').setText(_l(lang, 'checkSettings'));
      return;
    }

    const snap = this._weatherSnapshot;
    if (!snap) {
      card.querySelector('.cal-weather-icon').setText('\uD83C\uDF26\uFE0F');
      card.querySelector('.cal-weather-temp').setText('—');
      card.querySelector('.cal-weather-detail').setText(_l(lang, 'noData'));
      return;
    }

    const iconEl = card.querySelector('.cal-weather-icon');
    iconEl.setText(snap.icon);
    iconEl.setAttribute('aria-label', snap.condition);
    iconEl.title = snap.condition;

    const tempEl = card.querySelector('.cal-weather-temp');
    const unitSym = this._unitSymbol(snap.units);
    const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
    const label = _l(lang, labelKey);
    tempEl.setText(`${label} ${snap.temperature ?? '?'}${unitSym}`);

    const detailEl = card.querySelector('.cal-weather-detail');
    const parts = [];
    if (snap.feelsLike != null) parts.push(`${_l(lang, 'feels')} ${snap.feelsLike}${unitSym}`);
    if (snap.humidity != null) parts.push(`${_l(lang, 'humidity')} ${snap.humidity}%`);
    if (snap.low != null) parts.push(`${_l(lang, 'low')} ${snap.low}${unitSym}`);
    detailEl.setText(parts.join(' · ') || snap.location);
    detailEl.title = snap.location;

    card.removeAttribute('aria-live');
  }

  /* ----- Fetch weather for a date in the background ----- */
  async _fetchWeatherForDate(dateStr) {
    const token = this._fetchToken;
    try {
      const snap = await this.weather.getSnapshot(dateStr);
      // Discard stale results if render() was called again since we started fetching
      if (token !== this._fetchToken) return;
      this._weatherSnapshot = snap;
      this._weatherError = !snap;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      // Do NOT call full render here — it would recreate the card and trigger another fetch.
      // Weather badges on day cells will appear on the next normal render cycle.
    } catch (err) {
      if (token !== this._fetchToken) return;
      this._weatherError = true;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
    }
  }

  /* ----- Explicit weather refresh (command / button) ----- */
  async refreshWeather(dateStr) {
    dateStr = dateStr || this.activeDate || _formatDate(new Date());
    await this._performRefresh(dateStr, null);
  }

  /* ----- Perform a refresh with loading/disabled state on the button ----- */
  async _performRefresh(dateStr, btnEl) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled) return;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return;

    // Set button to loading state immediately
    let wasLoading = false;
    if (btnEl) {
      btnEl.setAttribute('disabled', '');
      btnEl.addClass('is-loading');
      wasLoading = true;
    } else {
      this._weatherLoading = true;
    }

    try {
      const snap = await this.weather.forceRefresh(dateStr);
      this._weatherSnapshot = snap;
      this._weatherError = !snap;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      this.render();
      const lang = this.plugin.settings.weatherLanguage;
      if (snap) {
        new Notice(_l(lang, 'weatherUpdated', dateStr));
      } else {
        new Notice(_l(lang, 'noDataFor', dateStr));
      }
    } catch (err) {
      this._weatherError = true;
      this._weatherLoading = false;
      this._updateWeatherCardUI();
      const lang = this.plugin.settings.weatherLanguage;
      new Notice(_l(lang, 'refreshFailed', err.message || 'unknown error'));
    } finally {
      // Always restore button state
      if (wasLoading && btnEl) {
        btnEl.removeAttribute('disabled');
        btnEl.removeClass('is-loading');
      }
    }
  }

  /* ----- Unit symbol helper ----- */
  _unitSymbol(units) {
    return units === 'imperial' ? '\u00B0F' : '\u00B0C'; // °F / °C
  }

  /* ----- Resolve and set background image ----- */
  async _setBackground(bgEl, link, dateStr) {
    try {
      const sourcePath = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
      const file = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath);
      if (file instanceof TFile) {
        const ext = file.extension?.toLowerCase();
        if (HEIC_EXTS.includes(ext)) {
          // Convert HEIC to JPEG thumbnail
          const thumb = await this.plugin.heicCache.getThumbnail(file);
          if (thumb) {
            bgEl.style.backgroundImage = `url("${thumb.dataUrl}")`;
          }
        } else {
          const url = this.app.vault.getResourcePath(file);
          bgEl.style.backgroundImage = `url("${url}")`;
        }
      }
    } catch (_) {
      // silent
    }
  }

  /* ----- Navigate months ----- */
  _goToMonth(delta) {
    const newMonth = new Date(this.displayMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    this.displayMonth = newMonth;

    this.buildMonthCache(this.displayMonth).then(() => this.render());
  }

  /* ----- Open (or create + open) daily note ----- */
  _openNote(dateStr) {
    const path = `${this.plugin.settings.dailyFolder}/${dateStr}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);

    const openFileInLeaf = (f) => {
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      const leaf = mdLeaves.length > 0
        ? mdLeaves[0]                     // reuse existing tab
        : this.app.workspace.getLeaf(true); // create new tab
      leaf.openFile(f).then(() => {
        this._syncActiveDate(leaf);
        this.render();
        // Trigger background weather load after note opens (non-blocking)
        this._triggerWeatherAfterOpen(dateStr);
      });
    };

    if (file instanceof TFile) {
      openFileInLeaf(file);
    } else {
      // File doesn't exist — ask user to confirm creation
      new CreateNoteModal(this.app, dateStr, () => {
        this._createDailyNote(path, dateStr).then((created) => {
          openFileInLeaf(created);
          // Trigger weather after note is created and opened
          setTimeout(() => this._triggerWeatherAfterOpen(dateStr), 500);
        });
      }).open();
    }
  }

  /* ----- Trigger weather fetch after note open/create (non-blocking) ----- */
  _triggerWeatherAfterOpen(dateStr) {
    const s = this.plugin.settings;
    if (!s.weatherEnabled || !s.weatherAutoFetch) return;
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return;
    // Fire-and-forget: won't delay navigation
    this.weather.getSnapshot(dateStr).then((snap) => {
      if (snap) {
        this._weatherSnapshot = snap;
        this._weatherLoading = false;
        this._weatherError = false;
        this._updateWeatherCardUI();
      }
    }).catch((err) => {
      console.warn('[CalendarSidebar] Weather fetch after note open failed:', err.message);
    });
  }

  /* ----- Sync weather overlays on all markdown leaves ----- */
  _syncNoteOverlays() {
    const s = this.plugin.settings;

    // EXIF hover on note images (runs regardless of weather)
    this._scheduleExifNoteAttach();

    if (!s.weatherEnabled) {
      this._removeAllOverlaysFromViews();
      return;
    }
    if (!_validateCoords(s.weatherLatitude, s.weatherLongitude)) return;

    const dailyFolder = s.dailyFolder;
    const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
    const validDailyFiles = new Set();

    // Collect valid daily note leaves
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      if (!(file instanceof TFile)) continue;
      if (!file.path.startsWith(dailyFolder + '/')) continue;
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue;

      validDailyFiles.add(file.path);

      // Check if there's already an in-flight request for this leaf — skip if so
      if (this._overlayInFlight.has(leaf)) {
        continue;
      }

      this._createOrUpdateOverlay(leaf, file);
    }

    // Remove stale overlays from EVERY non-daily markdown leaf
    // Must handle leaves without TFile (e.g., blank editor, Homepage.md, etc.)
    for (const leaf of mdLeaves) {
      const file = leaf.view?.file;
      const path = file ? file.path : null;

      // Skip valid daily notes
      if (path && validDailyFiles.has(path)) continue;

      // For leaves with no file (blank editor, etc.), still clean up
      // For leaves with a non-daily file (Homepage.md), clean up too
      const overlay = leaf.containerEl?.querySelector(`[${OVERLAY_ATTR}]`);
      if (overlay) {
        overlay.remove();
      }
    }
  }

  /* ----- EXIF hover on daily note embedded images ----- */

  _scheduleExifNoteAttach() {
    // Debounce: clear previous timer so we don't attach observers multiple times
    clearTimeout(this._exifNoteTimer);
    this._exifNoteTimer = setTimeout(() => {
      if (!this.plugin.settings.showExif) return;
      const dailyFolder = this.plugin.settings.dailyFolder;

      // Disconnect old observers for leaves no longer showing daily notes
      const activeDailyLeaves = new Set();
      const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
      for (const leaf of mdLeaves) {
        const file = leaf.view?.file;
        if (!(file instanceof TFile)) continue;
        if (!file.path.startsWith(dailyFolder + '/')) continue;
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue;
        activeDailyLeaves.add(leaf);
        this._observeNoteImages(leaf);
      }

      // Disconnect observers for non-daily-note leaves
      if (this._exifObservers) {
        for (const [leaf, obs] of this._exifObservers) {
          if (!activeDailyLeaves.has(leaf)) {
            obs.disconnect();
            this._exifObservers.delete(leaf);
          }
        }
      }
    }, 300);
  }

  _observeNoteImages(leaf) {
    // Already observing this leaf
    if (!this._exifObservers) this._exifObservers = new Map();
    if (this._exifObservers.has(leaf)) return;

    const container = leaf.view?.containerEl || leaf.containerEl;
    if (!container) return;

    // Scan existing images AND internal-embed spans (for HEIC etc.)
    this._processImageEls(container.querySelectorAll('img'));
    this._processEmbedEls(container.querySelectorAll('.internal-embed'));

    // Then watch for new ones
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) {
            if (node.tagName === 'IMG') this._processImageEls([node]);
            if (node.classList?.contains('internal-embed')) this._processEmbedEls([node]);
            // Check descendants
            if (node.querySelectorAll) {
              this._processImageEls(node.querySelectorAll('img'));
              this._processEmbedEls(node.querySelectorAll('.internal-embed'));
            }
          }
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    this._exifObservers.set(leaf, observer);
  }

  _processImageEls(images) {
    for (const img of images) {
      if (this._exifNoteImages.has(img)) continue;
      this._exifNoteImages.add(img);
      img.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, img));
      img.addEventListener('mouseleave', () => this._onExifLeave());
    }
  }

  _processEmbedEls(embeds) {
    for (const el of embeds) {
      if (this._exifNoteImages.has(el)) continue;
      // Only attach if it references an image-like file
      const src = el.getAttribute('src') || '';
      const ext = src.split('.').pop()?.toLowerCase();
      if (!ext || !IMAGE_EXTS.includes(ext)) continue;
      this._exifNoteImages.add(el);
      el.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, el));
      el.addEventListener('mouseleave', () => this._onExifLeave());

      // For HEIC, also try to convert and display the image
      if (HEIC_EXTS.includes(ext) && !el.querySelector('.cal-heic-preview')) {
        this._convertHeicEmbed(el, src);
      }
    }
  }

  async _convertHeicEmbed(el, src) {
    // Show loading indicator
    const loader = document.createElement('div');
    loader.className = 'cal-heic-preview';
    loader.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:60px;color:var(--text-muted);font-size:12px;';
    loader.textContent = 'Converting HEIC...';
    el.appendChild(loader);

    try {
      const notePath = this.app.workspace.activeLeaf?.view?.file?.path || '';
      const file = this.app.metadataCache.getFirstLinkpathDest(src, notePath);
      if (!(file instanceof TFile)) return;

      const thumb = await this.plugin.heicCache.getThumbnail(file);
      if (!thumb) {
        loader.textContent = 'HEIC conversion failed';
        return;
      }

      // Replace loader with image
      const img = document.createElement('img');
      img.src = thumb.dataUrl;
      img.style.cssText = 'max-width:100%;height:auto;display:block;';
      img.setAttribute('data-cal-exif', '1');
      this._exifNoteImages.add(img);
      img.addEventListener('mouseenter', (e) => this._onNoteImageEnter(e, img));
      img.addEventListener('mouseleave', () => this._onExifLeave());
      loader.replaceWith(img);
    } catch (_) {
      loader.textContent = 'HEIC error';
    }
  }

  async _onNoteImageEnter(e, img) {
    if (!this.plugin.settings.showExif) return;
    clearTimeout(this.plugin._exifHoverTimer);
    this.plugin._hideExifTooltip();

    this.plugin._exifHoverTimer = setTimeout(async () => {
      try {
        const file = this._resolveImageFile(img);
        if (!(file instanceof TFile)) return;

        this.plugin._showExifTooltip(img, null, true);
        const fields = await this.exifCache.get(file);
        this.plugin._showExifTooltip(img, fields, false);
      } catch (_) {
        this.plugin._hideExifTooltip();
      }
    }, 500);
  }

  _resolveImageFile(el) {
    const leaf = this.app.workspace.activeLeaf;
    const notePath = leaf?.view?.file?.path || '';

    // If the element itself is an .internal-embed (HEIC etc.), resolve from its src
    if (el.classList && el.classList.contains('internal-embed')) {
      const embedSrc = el.getAttribute('src');
      if (embedSrc && notePath) {
        const f = this.app.metadataCache.getFirstLinkpathDest(embedSrc, notePath);
        if (f instanceof TFile) return f;
      }
    }

    // Method 1: walk up to parent .internal-embed span (for <img> children)
    let parent = el.parentElement;
    while (parent) {
      if (parent.classList.contains('internal-embed')) {
        const embedSrc = parent.getAttribute('src');
        if (embedSrc && notePath) {
          const f = this.app.metadataCache.getFirstLinkpathDest(embedSrc, notePath);
          if (f instanceof TFile) return f;
        }
        break;
      }
      parent = parent.parentElement;
    }

    // Method 2: parse the img src URL
    const src = el.getAttribute('src');
    if (!src) return null;

    let path = decodeURIComponent(src);
    const qIdx = path.indexOf('?');
    if (qIdx > 0) path = path.substring(0, qIdx);

    // Handle both app://local/ and app://<hash>/ URL formats
    const appIdx = path.indexOf('://');
    if (appIdx > 0) {
      const afterHost = path.indexOf('/', appIdx + 3);
      if (afterHost > 0) {
        path = path.substring(afterHost + 1);
      }
    }

    // Normalize and match against vault path
    const vaultPath = (this.app.vault.adapter.basePath || '').replace(/\\/g, '/');
    const normalized = path.replace(/\\/g, '/');

    if (vaultPath && normalized.startsWith(vaultPath)) {
      const relative = normalized.substring(vaultPath.length + 1);
      const f = this.app.vault.getAbstractFileByPath(relative);
      if (f instanceof TFile) return f;
    }

    // Fallback: try filename
    const fileName = normalized.split('/').pop();
    if (fileName) {
      const f = this.app.vault.getAbstractFileByPath(fileName);
      if (f instanceof TFile) return f;
    }

    return null;
  }

  /* ----- Mount or update weather overlay on a single markdown leaf ----- */
  async _createOrUpdateOverlay(leaf, file) {
    const dateStr = file.name.replace(/\.md$/, '');
    const container = leaf.containerEl;
    if (!container) return;

    // Record in-flight promise for this leaf to prevent concurrent duplicates
    const inFlightPromise = (async () => {
      try {
        await this._buildOverlayForLeaf(leaf, file, dateStr);
      } catch (err) {
        console.warn('[CalendarSidebar] Overlay build failed:', err.message);
      } finally {
        // Clean up in-flight marker
        this._overlayInFlight.delete(leaf);
      }
    })();
    this._overlayInFlight.set(leaf, inFlightPromise);
  }

  /* ----- Build overlay content and mount it into the given leaf ----- */
  async _buildOverlayForLeaf(leaf, file, dateStr) {
    const container = leaf.containerEl;
    if (!container) return;

    // Bump this leaf's version counter — stale results must not mount
    const myVersion = (this._overlayVersions.get(leaf) || 0) + 1;
    this._overlayVersions.set(leaf, myVersion);

    // Re-validate file after await (leaf may have switched)
    const currentFile = leaf.view?.file;
    if (currentFile !== file || !(currentFile instanceof TFile)) return;

    // Read snapshot from metadata cache first
    const cache = this.app.metadataCache.getFileCache(currentFile);
    let snap = cache?.frontmatter?._calendar_weather || null;
    const isStale = snap && typeof snap === 'object' ? this.weather._shouldFetch(snap, this.plugin.settings.weatherTtlHours || 2) : true;

    // If no valid snapshot, trigger a background fetch
    if (!snap || isStale) {
      const fetched = await this.weather.getSnapshot(dateStr);
      if (fetched) snap = fetched;
    }

    // Final re-check: file may have changed during fetch
    const latestFile = leaf.view?.file;
    if (latestFile !== file || !(latestFile instanceof TFile)) return;

    // Discard if a newer request has already mounted for this leaf
    if (myVersion < (this._overlayVersions.get(leaf) || 0)) return;

    // If no data at all, do NOT erase an existing valid overlay — just skip
    if (!snap) return;

    // Remove any existing overlay element first (idempotent)
    const oldEl = container.querySelector(`[${OVERLAY_ATTR}]`);
    if (oldEl) oldEl.remove();

    // Ensure the container has relative positioning for absolute overlay placement
    this._ensureHostPosition(container);

    // Create overlay chip
    const overlay = container.createDiv({
      cls: 'cal-note-overlay',
      attr: { [OVERLAY_ATTR]: 'true' },
    });

    // Icon
    const iconEl = overlay.createDiv({ cls: 'cal-overlay-icon' });
    iconEl.setText(snap.icon);
    iconEl.title = snap.condition;

    // Info column
    const infoEl = overlay.createDiv({ cls: 'cal-overlay-info' });
    const tempEl = infoEl.createDiv({ cls: 'cal-overlay-temp' });
    const detailEl = infoEl.createDiv({ cls: 'cal-overlay-detail' });

    const lang = this.plugin.settings.weatherLanguage;
    const unitSym = this._unitSymbol(snap.units);
    const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
    tempEl.setText(`${_l(lang, labelKey)} ${snap.temperature ?? '?'}${unitSym}`);

    const parts = [];
    if (snap.feelsLike != null) parts.push(`${_l(lang, 'feels')} ${snap.feelsLike}${unitSym}`);
    if (snap.humidity != null) parts.push(`${_l(lang, 'humidity')} ${snap.humidity}%`);
    detailEl.setText(parts.join(' · ') || '');
    detailEl.title = snap.condition;

    // Refresh button inside overlay
    const refreshLabel = _l(lang, 'refresh');
    const refreshBtn = overlay.createEl('button', {
      cls: 'cal-overlay-refresh',
      attr: { 'aria-label': refreshLabel, title: refreshLabel },
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._performOverlayRefresh(dateStr, refreshBtn, overlay).catch((err) => {
        console.warn('[CalendarSidebar] Overlay refresh failed:', err.message);
      });
    });

    // Animate in
    requestAnimationFrame(() => {
      overlay.addClass('is-visible');
    });
  }

  /* ----- Ensure containerEl has position:relative for absolute overlay placement ----- */
  _ensureHostPosition(container) {
    if (this._hostPositionMarkers.has(container)) return;
    const computedStyle = getComputedStyle(container);
    if (computedStyle.position !== 'static') return;
    container.style.position = 'relative';
    this._hostPositionMarkers.add(container);
    // Also register with plugin for cleanup on unload
    this.plugin._hostPositionMarkers?.add(container);
  }

  /* ----- Refresh weather for an overlay ----- */
  async _performOverlayRefresh(dateStr, btnEl, overlayEl) {
    if (!overlayEl?.isConnected) return;
    btnEl.setAttribute('disabled', '');
    btnEl.addClass('is-loading');

    try {
      const snap = await this.weather.forceRefresh(dateStr);
      if (!snap || !overlayEl.isConnected) return;

      const tempEl = overlayEl.querySelector('.cal-overlay-temp');
      const detailEl = overlayEl.querySelector('.cal-overlay-detail');
      const iconEl = overlayEl.querySelector('.cal-overlay-icon');
      const unitSym = this._unitSymbol(snap.units);
      const lang = this.plugin.settings.weatherLanguage;
      const labelKey = snap.temperatureLabel === 'Now' ? 'now' : 'high';
      if (tempEl) tempEl.textContent = `${_l(lang, labelKey)} ${snap.temperature ?? '?'}${unitSym}`;
      if (iconEl) { iconEl.textContent = snap.icon; iconEl.title = snap.condition; }

      const parts = [];
      if (snap.feelsLike != null) parts.push(`${_l(lang, 'feels')} ${snap.feelsLike}${unitSym}`);
      if (snap.humidity != null) parts.push(`${_l(lang, 'humidity')} ${snap.humidity}%`);
      if (detailEl) detailEl.textContent = parts.join(' · ') || '';
    } catch (err) {
      console.warn('[CalendarSidebar] Overlay refresh failed:', err.message);
    } finally {
      if (btnEl?.isConnected) {
        btnEl.removeAttribute('disabled');
        btnEl.removeClass('is-loading');
      }
    }
  }

  /* ----- Remove all overlays from markdown view containers ----- */
  _removeAllOverlaysFromViews() {
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((el) => el.remove());
  }

  /* ----- Create daily note from template ----- */
  async _createDailyNote(path, dateStr) {
    // Check if daily notes plugin has a template configured
    const dnPlugin = this.app.internalPlugins.getPluginById('daily-notes');
    const templatePath = dnPlugin?.instance?.options?.template;

    if (templatePath) {
      const templateFile = this.app.vault.getAbstractFileByPath(templatePath + '.md');
      if (templateFile instanceof TFile) {
        // Try Templater first for proper template processing (e.g. tp.file.title)
        const tp = this.app.plugins.getPlugin('templater-obsidian')?.templater;
        if (tp && tp.create_new_note_from_template) {
          await tp.create_new_note_from_template(templateFile, this.plugin.settings.dailyFolder, dateStr, false);
          const created = this.app.vault.getAbstractFileByPath(path);
          if (created instanceof TFile) return created;
        }
        // Fallback: read raw template and create with unresolved content
        const content = await this.app.vault.read(templateFile);
        return this.app.vault.create(path, content);
      }
    }

    // No template — create empty file
    return this.app.vault.create(path, '');
  }

  /* ----- Sync active date from the currently viewed leaf ----- */
  _syncActiveDate(leaf) {
    leaf = leaf || this.app.workspace.activeLeaf;
    if (!leaf) return;
    const file = leaf.view?.file;
    if (!(file instanceof TFile)) return;
    const folderPrefix = this.plugin.settings.dailyFolder + '/';
    if (!file.path.startsWith(folderPrefix)) return;
    const match = file.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (match) {
      const newDate = match[1];
      // Reset weather card state when the active date actually changes
      if (newDate !== this.activeDate) {
        this._weatherCardDate = null;
        this._weatherSnapshot = null;
        this._weatherLoading = false;
        this._weatherError = false;
      }
      this.activeDate = newDate;
    }
  }
}

/* ============================================================
   Settings Tab
   ============================================================ */
class CalendarSidebarSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const _s = (key, ...args) => _l(this.plugin.settings.weatherLanguage, key, ...args);

    containerEl.createEl('h2', { text: 'Calendar Sidebar Settings' });

    // --- Daily folder with search ---
    new Setting(containerEl)
      .setName(_s('s_dailyFolder'))
      .setDesc(_s('s_dailyFolderDesc'))
      .addSearch((cb) => {
        this.folderInput = cb;
        cb.setValue(this.plugin.settings.dailyFolder)
          .setPlaceholder('Calendar/Daily')
          .onChange(async (value) => {
            this.plugin.settings.dailyFolder = value.replace(/\/+$/, '');
            await this.plugin.saveSettings();
          });
      })
      .addExtraButton((btn) => {
        btn.setIcon('folder-search')
          .setTooltip(_s('s_browseFolders'))
          .onClick(() => {
            new FolderSuggestModal(this.app, (path) => {
              this.plugin.settings.dailyFolder = path;
              this.plugin.saveSettings();
              this.folderInput.setValue(path);
            }).open();
          });
      });

    // --- Thumbnail filter ---
    new Setting(containerEl)
      .setName(_s('s_thumbnailFilter'))
      .setDesc(_s('s_thumbnailFilterDesc'))
      .addDropdown((dd) =>
        dd
          .addOption('all', _s('s_thumbnailAll'))
          .addOption('date-prefixed', _s('s_thumbnailDate'))
          .setValue(this.plugin.settings.thumbnailFilter)
          .onChange(async (value) => {
            this.plugin.settings.thumbnailFilter = value;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view?.refresh) leaf.view.refresh();
          })
      );

    // --- Weather section ---
    containerEl.createEl('h3', { text: _s('s_weather') });

    new Setting(containerEl)
      .setName(_s('s_weatherEnable'))
      .setDesc(_s('s_weatherEnableDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.weatherEnabled)
          .onChange(async (value) => {
            this.plugin.settings.weatherEnabled = value;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.refresh();
          })
      );

    // Latitude
    new Setting(containerEl)
      .setName(_s('s_latitude'))
      .setDesc(_s('s_latitudeDesc'))
      .addText((text) =>
        text
          .setPlaceholder('39.9042')
          .setValue(String(this.plugin.settings.weatherLatitude))
          .onChange(async (value) => {
            this.plugin.settings.weatherLatitude = value.trim();
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.refresh();
          })
      );

    // Longitude
    new Setting(containerEl)
      .setName(_s('s_longitude'))
      .setDesc(_s('s_longitudeDesc'))
      .addText((text) =>
        text
          .setPlaceholder('116.4074')
          .setValue(String(this.plugin.settings.weatherLongitude))
          .onChange(async (value) => {
            this.plugin.settings.weatherLongitude = value.trim();
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.refresh();
          })
      );

    // Location name
    new Setting(containerEl)
      .setName(_s('s_locationName'))
      .setDesc(_s('s_locationNameDesc'))
      .addText((text) =>
        text
          .setPlaceholder(_s('s_locationName'))
          .setValue(String(this.plugin.settings.weatherLocationName))
          .onChange(async (value) => {
            this.plugin.settings.weatherLocationName = value.trim();
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.refresh();
          })
      );

    // Units
    new Setting(containerEl)
      .setName(_s('s_tempUnits'))
      .setDesc(_s('s_tempUnitsDesc'))
      .addDropdown((dd) =>
        dd
          .addOption('metric', _s('s_celsius'))
          .addOption('imperial', _s('s_fahrenheit'))
          .setValue(this.plugin.settings.weatherUnits)
          .onChange(async (value) => {
            this.plugin.settings.weatherUnits = value;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.refresh();
          })
      );

    // Auto-fetch
    new Setting(containerEl)
      .setName(_s('s_autoFetch'))
      .setDesc(_s('s_autoFetchDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.weatherAutoFetch)
          .onChange(async (value) => {
            this.plugin.settings.weatherAutoFetch = value;
            await this.plugin.saveSettings();
          })
      );

    // TTL
    new Setting(containerEl)
      .setName(_s('s_cacheTtl'))
      .setDesc(_s('s_cacheTtlDesc'))
      .addText((text) =>
        text
          .setPlaceholder('2')
          .setValue(String(this.plugin.settings.weatherTtlHours))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            this.plugin.settings.weatherTtlHours = isNaN(n) || n < 1 ? 2 : n;
            await this.plugin.saveSettings();
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) leaf.view.refresh();
          })
      );

    // Language
    new Setting(containerEl)
      .setName(_s('s_language'))
      .setDesc(_s('s_languageDesc'))
      .addDropdown((dd) =>
        dd
          .addOption('en', _s('s_english'))
          .addOption('zh', _s('s_chinese'))
          .setValue(this.plugin.settings.weatherLanguage)
          .onChange(async (value) => {
            this.plugin.settings.weatherLanguage = value;
            await this.plugin.saveSettings();
            // Re-render settings in the new language
            this.display();
            // Refresh views to apply new locale
            const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
            if (leaf?.view) {
              leaf.view._syncNoteOverlays();
              leaf.view.refresh();
            }
          })
      );

    // --- EXIF Metadata section ---
    containerEl.createEl('h3', { text: _s('s_exif') });

    new Setting(containerEl)
      .setName(_s('s_exifEnable'))
      .setDesc(_s('s_exifEnableDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showExif)
          .onChange(async (value) => {
            this.plugin.settings.showExif = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

/* ============================================================
   Folder Suggest Modal
   ============================================================ */
class FolderSuggestModal extends SuggestModal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }

  getSuggestions(query) {
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((f) => f instanceof TFolder);
    if (!query) return folders;
    return folders.filter((f) =>
      f.path.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(folder, el) {
    el.createEl('span', { text: folder.path });
  }

  onChooseSuggestion(folder) {
    this.onSubmit(folder.path);
  }
}

/* ============================================================
   Create Note Confirm Modal
   ============================================================ */
class CreateNoteModal extends Modal {
  constructor(app, dateStr, onConfirm) {
    super(app);
    this.dateStr = dateStr;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Create Daily Note' });
    contentEl.createEl('p', { text: `No daily note found for ${this.dateStr}. Create one?` });

    const btnDiv = contentEl.createDiv({ cls: 'modal-button-container' });
    btnDiv.createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());
    const confirmBtn = btnDiv.createEl('button', { text: 'Create', cls: 'mod-cta' });
    confirmBtn.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose() {
    // Disconnect EXIF MutationObservers
    if (this._exifObservers) {
      for (const obs of this._exifObservers.values()) obs.disconnect();
      this._exifObservers.clear();
    }
    const { contentEl } = this;
    contentEl.empty();
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
