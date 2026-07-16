# Calendar Sidebar — Obsidian Plugin

DayOne 风格的月历面板，显示在 Obsidian 左侧侧边栏文件管理器上方。  
扫描 `Calendar/Daily/` 下的日记笔记，自动提取图片作为日期格子缩略图背景。点击日期打开对应日记。

## 安装

1. 将 `calendar-sidebar/` 整个文件夹复制到你的 vault 的 `.obsidian/plugins/` 目录下
2. 打开 Obsidian → 设置 → 第三方插件 → 开启「Calendar Sidebar」
3. 重启 Obsidian 或手动运行命令「Open Calendar Sidebar」

## 文件说明

| 文件 | 说明 |
|------|------|
| `manifest.json` | 插件元信息 |
| `main.js` | 核心代码（~450 行，零外部依赖） |
| `Calendar Sidebar 插件设计方案.md` | 原始设计文档 |

## 配置

在 Obsidian 设置 → 第三方插件 → Calendar Sidebar：

| 设置项 | 说明 |
|--------|------|
| **Daily notes folder** | 日记文件夹路径，支持搜索+浏览选择 |
| **Thumbnail filter** | `All embedded images` = 显示日记中所有嵌入图片（默认）；`Only date-prefixed` = 只显示文件名以 `YYYY-MM-DD_` 开头的图片（适合配合 Photo Journal 使用） |

## 要求

- Obsidian v1.5.0+
- 日记按 `YYYY-MM-DD.md` 命名
- 图片通过 `![[image.jpg]]` 嵌入到日记中

## 构建

纯 JS，无需构建步骤。直接修改 `main.js` 即可。
