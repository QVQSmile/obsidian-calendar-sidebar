<p align="center">
  <a href="README.en.md"><strong>English</strong></a>
  ·
  <a href="README.zh-CN.md"><strong>中文</strong></a>
</p>

---

# Dayline — Obsidian Plugin / Obsidian 插件

Dayline is a visual journal for calendars, timelines, moods, memories, weather, and photos. / Dayline 是一个集日历、时间线、心情、回顾、天气和照片于一体的可视化日记工具。

- Monthly calendar in the left sidebar
- Image thumbnails from daily notes as date cell backgrounds
- Today highlight (full accent fill) + browsing-date highlight (accent border)
- One-click open daily notes
- Auto-create missing notes with confirmation dialog, from Daily Notes template (Templater supported)
- Configurable daily folder with search suggest
- Thumbnail filter: all images or date-prefixed only
- Weather card with Open-Meteo integration (optional, cached in plugin data)
- EXIF metadata tooltips for calendar and daily-note images
- HEIC/HEIF thumbnail conversion on desktop
- On This Day review with excerpts and photo wall
- Journal timeline with compact search and filters for dates, moods, and favorites
- Five-level mood picker with optional labels and local trend statistics

Weather snapshots are stored in the plugin's `data.json`, not written into daily-note frontmatter. Historical `_calendar_weather` frontmatter is read for backward compatibility and migrated when compatible. EXIF GPS reverse geocoding is disabled by default and can be enabled explicitly in settings.

Journal bodies remain Markdown. The timeline indexes the configured daily-notes folder by default (`Calendar/Daily`). Optional external-import folders can be added as ordinary journal sources; they do not create a separate entry type or source filter in the timeline. Dates are resolved from the configured date field, `date`, `creationDate`, and then valid date-prefixed filenames; modification time is never used as a fallback. Use [Day One Importer](https://github.com/MarcDonald/obsidian-day-one-importer) or [Obsidian Importer](https://github.com/obsidianmd/obsidian-importer) for external imports, then add the output directory. This plugin does not parse JSON/ZIP exports or rewrite imported files.

Mood metadata is authoritative in `Calendar/journal-metadata.json` by default. Markdown frontmatter is unchanged unless mirroring is enabled, and deleted-note records remain recoverable as orphans.

Calendar display can be simplified in Dayline settings by hiding mood markers or the weather card/date icons. These switches affect only the calendar view; mood records, weather cache, and the journal timeline remain available.

**Installation**: Add `Haoo-7/Obsidian-Dayline` to BRAT, or download `dayline.zip` from [Releases](https://github.com/Haoo-7/Obsidian-Dayline/releases) and extract to `.obsidian/plugins/dayline/`. On first launch, Dayline migrates the old plugin `data.json` when the new directory has no data file.

---

# Dayline — Obsidian 插件

Dayline 是一个集日历、时间线、心情、回顾、天气和照片于一体的可视化日记工具。

- 月历视图显示在左侧侧边栏
- 自动提取日记图片作为日期格子缩略图
- 今日高亮（全色块）+ 浏览中日期高亮（彩色边框）
- 单击一键打开日记
- 点击无日记日期 → 确认框 → 从模板自动创建（支持 Templater）
- 可配置日记文件夹路径（支持搜索）
- 缩略图过滤：全部图片或仅日期前缀图片
- 天气卡片（Open-Meteo 集成，可选，隐藏 YAML 快照）

**安装**：在 BRAT 中添加 `Haoo-7/Obsidian-Dayline`，或从 [Releases](https://github.com/Haoo-7/Obsidian-Dayline/releases) 下载 `dayline.zip` 解压到 `.obsidian/plugins/dayline/`。首次启动时，如果新目录没有 `data.json`，Dayline 会迁移旧插件的数据。

---

<p align="center">
  <a href="README.en.md">View full English version →</a> &nbsp;·&nbsp; <a href="README.zh-CN.md">查看完整中文版 →</a>
</p>
