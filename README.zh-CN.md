<p align="right">
  <a href="README.md">English</a> | <strong>中文</strong>
</p>

---

# Calendar Sidebar — Obsidian 插件

DayOne 风格的月历面板，显示在 Obsidian 左侧侧边栏文件管理器上方。扫描日记文件夹下的笔记，自动提取图片作为日期格子缩略图背景。

![Calendar Sidebar 预览](screenshots/calendar-sidebar-preview.png)

## 功能

- **月历视图** — 显示在左侧侧边栏文件管理器上方
- **图片缩略图** — 自动提取日记中嵌入的图片作为日期格子背景
- **今日高亮** — 今天的日期用全色块填充标识
- **浏览中日期** — 当前在查看的日记用彩色边框标识
- **单击打开** — 点击日期一键打开对应日记
- **自动创建** — 点击没有日记的日期 → 弹出确认框 → 从 Daily Notes 模板自动创建（支持 Templater）
- **可配置日记文件夹** — 支持搜索+浏览选择路径
- **缩略图过滤** — 可选择仅显示文件名以 `YYYY-MM-DD_` 开头的图片

## 天气功能（可选）

在设置中启用来自 [Open-Meteo](https://open-meteo.com/) 的天气数据（无需 API Key）：

| 设置项 | 说明 |
|---------|------|
| **启用天气** | 切换侧边栏天气卡片显示 |
| **纬度 / 经度** | 用于获取本地天气的坐标 |
| **位置名称** | 显示标签（可选） |
| **温度单位** | 摄氏度或华氏度 |
| **自动获取** | 打开日记时自动获取天气 |
| **缓存时间** | 重新获取前的缓存小时数 |

天气快照以隐藏的 YAML frontmatter（`_calendar_weather`）保存在日记中 — 渲染后不可见。月历标题下方会显示紧凑的天气卡片，包含图标、温度、体感温度、湿度和位置。已缓存日期的日历格子上会显示小型天气 emoji 徽章。使用 **"刷新当前日期天气"** 命令可强制更新。

**限制**：超出预报窗口的历史日期可能无法返回数据（归档 API 支持为尽力而为）。

## 安装

- **BRAT**：在 BRAT 中添加 `Haoo-7/Obsidian-Calendar-Sidebar`
- **手动**：从 [Releases](https://github.com/Haoo-7/Obsidian-Calendar-Sidebar/releases) 下载 `calendar-sidebar.zip`，解压到 vault 的 `.obsidian/plugins/calendar-sidebar/`，在 Obsidian 设置中启用插件，运行命令「Open Calendar Sidebar」

## 文件说明

| 文件 | 说明 |
|------|------|
| `manifest.json` | 插件元信息 |
| `main.js` | 核心代码（~870 行，零外部依赖） |
| `Calendar Sidebar 插件设计方案.md` | 原始设计文档 |

## 配置

在 Obsidian 设置 → 第三方插件 → Calendar Sidebar：

| 设置项 | 说明 |
|--------|------|
| **Daily notes folder** | 日记文件夹路径，支持搜索+浏览选择 |
| **Thumbnail filter** | `All embedded images` = 显示日记中所有嵌入图片（默认）；`Only date-prefixed` = 只显示文件名以 `YYYY-MM-DD_` 开头的图片（适合配合 Photo Journal 使用） |
| **Enable weather** | 启用天气功能 |
| **Latitude / Longitude** | 天气坐标（必填） |
| **Location name** | 位置名称（可选） |
| **Temperature units** | 温度单位：摄氏度/华氏度 |
| **Auto-fetch weather** | 打开日记时自动获取天气 |
| **Cache TTL (hours)** | 缓存有效期（小时） |

## 与 Templater 配合

如果在 Obsidian 的 Daily Notes 插件中配置了模板路径，且安装了 Templater 插件，点击无日记日期创建新文件时会自动通过 Templater 解析模板变量（如 `tp.file.title`、日期、周数等），生成完整内容的日记文件。

## 要求

- Obsidian v1.5.0+
- 日记按 `YYYY-MM-DD.md` 命名
- 图片通过 `![[image.jpg]]` 嵌入到日记中
