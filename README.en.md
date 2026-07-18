<p align="right">
  <strong>English</strong> | <a href="README.zh-CN.md">中文</a>
</p>

---

# Calendar Sidebar — Obsidian Plugin

DayOne-style monthly calendar panel in the Obsidian left sidebar, above the file explorer. Scans your daily notes folder and automatically extracts embedded images as date cell thumbnail backgrounds.

![Calendar Sidebar preview](screenshots/calendar-sidebar-preview.png)

## Features

- **Monthly calendar** in the left sidebar, above the file manager
- **Image thumbnails** — embedded images from daily notes as date cell backgrounds
- **Today highlight** — full accent color fill for today's date
- **Browsing-date highlight** — accent border for the date currently being viewed
- **One-click open** — click any date to open its daily note
- **Auto-create** — click a date with no note → confirmation dialog → create from Daily Notes template (Templater supported)
- **Configurable folder** — search-suggest for daily notes folder path
- **Thumbnail filter** — all embedded images or only date-prefixed filenames

## Weather (Optional)

Enable weather data from [Open-Meteo](https://open-meteo.com/) (no API key needed) in settings:

| Setting | Description |
|---------|-------------|
| **Enable weather** | Toggle weather card in sidebar |
| **Latitude / Longitude** | Your coordinates for local weather |
| **Location name** | Display label (optional) |
| **Temperature units** | Celsius or Fahrenheit |
| **Auto-fetch** | Fetch when opening a daily note |
| **Cache TTL** | Hours before re-fetching |

Weather snapshots are saved as hidden YAML frontmatter (`_calendar_weather`) in daily notes — never visible in the rendered note. A compact weather card appears below the month header showing icon, temperature, feels-like, humidity, and location. Cached dates show a small weather emoji badge on the calendar grid. Use the **"Refresh Weather for Active Date"** command to force-update.

**Limitation**: Historical dates beyond the forecast window may return no data (archive API support is best-effort).

## Installation

- **BRAT**: Add `Haoo-7/Obsidian-Calendar-Sidebar` to BRAT
- **Manual**: Download `calendar-sidebar.zip` from [Releases](https://github.com/Haoo-7/Obsidian-Calendar-Sidebar/releases), extract to `.obsidian/plugins/calendar-sidebar/` in your vault, enable in Obsidian settings, then run command `Open Calendar Sidebar`

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Plugin metadata |
| `main.js` | Core code (~870 lines, zero external dependencies) |
| `Calendar Sidebar 插件设计方案.md` | Original design doc (Chinese) |

## Settings

Configured in Obsidian Settings → Community Plugins → Calendar Sidebar:

| Setting | Description |
|---------|-------------|
| **Daily notes folder** | Path to your daily notes folder (search + browse) |
| **Thumbnail filter** | `All embedded images` (default) or `Only date-prefixed` (filenames starting with `YYYY-MM-DD_`) |

## Templater Integration

If you have a template configured in Obsidian's Daily Notes plugin and Templater is installed, clicking a date without a note will create one using the template with all Templater variables resolved (`tp.file.title`, date, week number, etc.).

## Requirements

- Obsidian v1.5.0+
- Daily notes named `YYYY-MM-DD.md`
- Images embedded via `![[image.jpg]]`
