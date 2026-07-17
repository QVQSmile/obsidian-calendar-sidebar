<p align="center">
  <a href="#en">English</a> | <a href="#zh">中文</a>
</p>

---

<a id="en"></a>

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

---

<a id="zh"></a>

# Calendar Sidebar — Obsidian 插件

DayOne 风格的月历面板，显示在 Obsidian 左侧侧边栏文件管理器上方。扫描日记文件夹下的笔记，自动提取图片作为日期格子缩略图背景。

## 功能

- **月历视图** — 显示在左侧侧边栏文件管理器上方
- **图片缩略图** — 自动提取日记中嵌入的图片作为日期格子背景
- **今日高亮** — 今天的日期用全色块填充标识
- **浏览中日期** — 当前在查看的日记用彩色边框标识
- **单击打开** — 点击日期一键打开对应日记
- **自动创建** — 点击没有日记的日期 → 弹出确认框 → 从 Daily Notes 模板自动创建（支持 Templater）
- **可配置日记文件夹** — 支持搜索+浏览选择路径
- **缩略图过滤** — 可选择仅显示文件名以 `YYYY-MM-DD_` 开头的图片

## 安装

- **BRAT**：在 BRAT 中添加 `QVQSmile/obsidian-calendar-sidebar`
- **手动**：从 [Releases](https://github.com/QVQSmile/obsidian-calendar-sidebar/releases) 下载 `calendar-sidebar.zip`，解压到 vault 的 `.obsidian/plugins/calendar-sidebar/`，在 Obsidian 设置中启用插件，运行命令「Open Calendar Sidebar」

## 文件说明

| 文件 | 说明 |
|------|------|
| `manifest.json` | 插件元信息 |
| `main.js` | 核心代码（~610 行，零外部依赖） |
| `Calendar Sidebar 插件设计方案.md` | 原始设计文档 |

## 配置

在 Obsidian 设置 → 第三方插件 → Calendar Sidebar：

| 设置项 | 说明 |
|--------|------|
| **Daily notes folder** | 日记文件夹路径，支持搜索+浏览选择 |
| **Thumbnail filter** | `All embedded images` = 显示日记中所有嵌入图片（默认）；`Only date-prefixed` = 只显示文件名以 `YYYY-MM-DD_` 开头的图片（适合配合 Photo Journal 使用） |

## 与 Templater 配合

如果在 Obsidian 的 Daily Notes 插件中配置了模板路径，且安装了 Templater 插件，点击无日记日期创建新文件时会自动通过 Templater 解析模板变量（如 `tp.file.title`、日期、周数等），生成完整内容的日记文件。

## 要求

- Obsidian v1.5.0+
- 日记按 `YYYY-MM-DD.md` 命名
- 图片通过 `![[image.jpg]]` 嵌入到日记中
