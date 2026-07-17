# Calendar Sidebar — Obsidian Plugin

DayOne 风格的月历面板，显示在 Obsidian 左侧侧边栏文件管理器上方。  
扫描日记文件夹下的笔记，自动提取图片作为日期格子缩略图背景。

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

### 通过 GitHub Release 安装

1. 前往 [Releases](https://github.com/QVQSmile/obsidian-calendar-sidebar/releases) 下载最新版本的 `main.js` 和 `manifest.json`
2. 在你的 vault 的 `.obsidian/plugins/` 下创建 `calendar-sidebar/` 文件夹
3. 将下载的两个文件放入 `calendar-sidebar/` 文件夹
4. 打开 Obsidian → 设置 → 第三方插件 → 开启「Calendar Sidebar」
5. 运行命令「Open Calendar Sidebar」显示面板

### 通过 BRAT 安装

1. 安装 BRAT 插件
2. 添加仓库 `QVQSmile/obsidian-calendar-sidebar`

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

## 构建

纯 JS，无需构建步骤。直接修改 `main.js` 即可。
