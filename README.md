<p align="center">
  <a href="README.en.md"><strong>English</strong></a>
  ·
  <a href="README.zh-CN.md"><strong>中文</strong></a>
</p>

---

# Calendar Sidebar — Obsidian Plugin / Obsidian 插件

DayOne-style monthly calendar panel in the Obsidian left sidebar. / DayOne 风格的月历面板，显示在 Obsidian 左侧侧边栏。

![Calendar Sidebar preview / 预览](screenshots/calendar-sidebar-preview.png)

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
- Journal timeline with multiple source directories and filters
- Five-level mood picker with optional labels and local trend statistics

Weather snapshots are stored in the plugin's `data.json`, not written into daily-note frontmatter. Historical `_calendar_weather` frontmatter is read for backward compatibility and migrated when compatible. EXIF GPS reverse geocoding is disabled by default and can be enabled explicitly in settings.

Journal bodies remain Markdown. Configure `daily`, `journal`, or `external` source directories in Journal sources. Dates are resolved from the configured date field, `date`, `creationDate`, and then valid date-prefixed filenames; modification time is never used as a fallback. Use [Day One Importer](https://github.com/MarcDonald/obsidian-day-one-importer) or [Obsidian Importer](https://github.com/obsidianmd/obsidian-importer) for external imports, then add the output directory. This plugin does not parse JSON/ZIP exports or rewrite imported files.

Mood metadata is authoritative in `Calendar/journal-metadata.json` by default. Markdown frontmatter is unchanged unless mirroring is enabled, and deleted-note records remain recoverable as orphans.

**Installation**: Add `Haoo-7/Obsidian-Calendar-Sidebar` to BRAT, or download `calendar-sidebar.zip` from [Releases](https://github.com/Haoo-7/Obsidian-Calendar-Sidebar/releases) and extract to `.obsidian/plugins/calendar-sidebar/`.

---

# Calendar Sidebar — Obsidian 插件

DayOne 风格的月历面板，显示在 Obsidian 左侧侧边栏。

- 月历视图显示在左侧侧边栏
- 自动提取日记图片作为日期格子缩略图
- 今日高亮（全色块）+ 浏览中日期高亮（彩色边框）
- 单击一键打开日记
- 点击无日记日期 → 确认框 → 从模板自动创建（支持 Templater）
- 可配置日记文件夹路径（支持搜索）
- 缩略图过滤：全部图片或仅日期前缀图片
- 天气卡片（Open-Meteo 集成，可选，隐藏 YAML 快照）

**安装**：在 BRAT 中添加 `Haoo-7/Obsidian-Calendar-Sidebar`，或从 [Releases](https://github.com/Haoo-7/Obsidian-Calendar-Sidebar/releases) 下载 `calendar-sidebar.zip` 解压到 `.obsidian/plugins/calendar-sidebar/`。

---

<p align="center">
  <a href="README.en.md">View full English version →</a> &nbsp;·&nbsp; <a href="README.zh-CN.md">查看完整中文版 →</a>
</p>
