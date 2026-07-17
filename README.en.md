<p align="right">
  <strong>English</strong> | <a href="README.zh-CN.md">中文</a>
</p>

---

# Calendar Sidebar — Obsidian Plugin

DayOne-style monthly calendar panel in the Obsidian left sidebar, above the file explorer. Scans your daily notes folder and automatically extracts embedded images as date cell thumbnail backgrounds.

## Features

- **Monthly calendar** in the left sidebar, above the file manager
- **Image thumbnails** — embedded images from daily notes as date cell backgrounds
- **Today highlight** — full accent color fill for today's date
- **Browsing-date highlight** — accent border for the date currently being viewed
- **One-click open** — click any date to open its daily note
- **Auto-create** — click a date with no note → confirmation dialog → create from Daily Notes template (Templater supported)
- **Configurable folder** — search-suggest for daily notes folder path
- **Thumbnail filter** — all embedded images or only date-prefixed filenames

## Installation

- **BRAT**: Add `QVQSmile/obsidian-calendar-sidebar` to BRAT
- **Manual**: Download `calendar-sidebar.zip` from [Releases](https://github.com/QVQSmile/obsidian-calendar-sidebar/releases), extract to `.obsidian/plugins/calendar-sidebar/` in your vault, enable in Obsidian settings, then run command `Open Calendar Sidebar`

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Plugin metadata |
| `main.js` | Core code (~610 lines, zero external dependencies) |
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
