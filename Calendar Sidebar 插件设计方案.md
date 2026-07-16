# Calendar Sidebar — Obsidian 日历侧边栏插件设计方案

## 概述

在 Obsidian 左侧侧边栏顶部，添加一个 DayOne 风格的月历面板。有图的日期格子展示缩略图背景，点击日期打开对应日记。

---

## 最终效果

```
┌─────────────────────────────┐
│ [侧边栏]                     │
│ ┌─────────────────────────┐ │
│ │ ◀  2026年7月  ▶         │ │ ← 月份切换
│ │ 日 一 二 三 四 五 六     │ │
│ │      1  2  3  4  5  6   │ │
│ │  7  8  9 10 11 12 13    │ │ ← 有图格子 = 缩略图背景
│ │ 14 15 16 17 18 19 20    │ │    无图格子 = 浅色背景+数字
│ │ 21 22 23 24 25 26 27    │ │    今天 = 外圈高亮
│ │ 28 29 30 31             │ │
│ ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤ │ ← 可拖拽分割条 (Obsidian 原生)
│ │ 文件管理器（自动缩小）     │ │
│ │   Calendar/              │ │
│ │   Assets/                │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

### 交互规则

| 操作 | 行为 |
|------|------|
| 点击日期数字 | 打开 `Calendar/Daily/YYYY-MM-DD.md` |
| 点击 ◀  | 切到上个月 |
| 点击 ▶  | 切到下个月 |
| 今天日期 | 红色/主题色外圈高亮 |
| 有图日期 | 图片 CSS `cover` 背景 + 暗色蒙层 + 白色日期数字 |
| 无图日期 | 浅色背景 + 深色日期数字 |
| 拖拽分割条 | Obsidian 原生行为，日历/文件管理器同步缩放 |

---

## 技术架构

### 项目结构

```
Main_Topic/.obsidian/plugins/calendar-sidebar/
├── manifest.json           # 插件元信息
├── main.ts                 # 插件入口：注册视图、生命周期
├── calendar-view.ts        # CalendarView (ItemView) 渲染
├── data-provider.ts        # 扫描日记、提取图片映射
├── thumbnail.ts            # 缩略图获取（先用简单方案）
└── styles.css              # DayOne 风格日历样式
```

### 模块职责

#### 1. `main.ts` — 插件入口

- 注册名为 `calendar-sidebar-view` 的 `ItemView`
- `onload`：
  - 注册视图类型
  - `onLayoutReady`：自动激活侧边栏视图
  - 监听 `vault.on('modify')` 刷新日历
- `activateView()`：
  - 用 `workspace.getLeftLeaf(false)` 在左侧创建新叶子
  - 设置视图状态，`revealLeaf`

#### 2. `calendar-view.ts` — 侧边栏视图

继承 `ItemView`，核心方法：

```
onOpen()
  ├── renderHeader()    // 月份标题 + ◀ ▶
  ├── renderWeekdays()  // 日 一 二 三 四 五 六
  └── renderGrid()      // 6行×7列 网格
      └── onDateClick() // 打开日记

switchMonth(delta)      // +/-1 月，重新 renderGrid
refresh()               // 重新扫描数据后重绘
getDisplayText()        // "Calendar"
getIcon()               // "calendar"
```

#### 3. `data-provider.ts` — 数据层

```
getImageMap(year, month): Map<string, string[]>
  // 传回 { '2026-07-15': ['Assets/photo1.jpg', ...] }

实现:
  1. 只扫描 Calendar/Daily/ 目录
  2. 用 metadataCache.getCache(file) 获取文件缓存
  3. 解析 frontmatter 取日期，正则提取 ![[...]] 图片引用
  4. 过滤出图片扩展名 (jpg, png, heic, webp, gif)
  5. 按月缓存结果，切换月份时增量更新
  6. 监听 vault modify/create/delete 事件，仅刷新受影响月份

性能优化:
  - 首次加载扫当前月 + 前后各 1 个月（共 3 个月）
  - 按月缓存，切换时不重复扫描
  - 使用 Obsidian metadataCache（已在内存中），避免读文件
```

#### 4. `thumbnail.ts` — 缩略图渲染

**先用简单方案（后续可升级）：**

```
getImageUrl(imagePath: string): string
  // 用 app.vault.getResourcePath(file) 获取可访问 URL
  // CSS background-image: url(...)  + background-size: cover
```

格子内 HTML 结构：

```html
<div class="cal-day" data-date="2026-07-15">
  <div class="cal-day-bg" style="background-image: url(...)"></div>
  <div class="cal-day-overlay"></div>
  <span class="cal-day-num">15</span>
</div>
```

**后续升级方案（复用 ObJournal IndexedDB）：**

ObJournal 的 storage API：
- `getStorage()` → 返回 IndexedDB 实例
- `getThumbnail(key)` → 返回 WebP Blob
- `putThumbnail(key, blob)` → 存入缓存

我们可以在同一个 IndexedDB 数据库（`journal-view-db`）中读写，使用不同的 key 前缀避免冲突。

#### 5. `styles.css` — 样式

关键样式规则：

```css
/* 日历容器 */
.cal-container {
  padding: 8px;
  user-select: none;
}

/* 月份头部 */
.cal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  padding: 4px 0;
}

/* 星期行 */
.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  text-align: center;
  font-size: 10px;
  color: var(--text-muted);
  padding: 4px 0;
}

/* 日期网格 */
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

/* 日期格子 */
.cal-day {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
}
.cal-day:hover {
  box-shadow: 0 0 0 2px var(--interactive-accent);
}

/* 缩略图背景 */
.cal-day-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
}

/* 暗色蒙层 */
.cal-day-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.3);
}

/* 日期数字 */
.cal-day-num {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

/* 无图日子 */
.cal-day.no-image .cal-day-num {
  color: var(--text-normal);
  text-shadow: none;
}
.cal-day.no-image {
  background: var(--background-secondary);
}

/* 今天 */
.cal-day.today {
  box-shadow: 0 0 0 2px var(--color-accent);
}

/* 空白天数（上月/下月填补） */
.cal-day.empty {
  visibility: hidden;
}
```

---

## 数据流

```
[用户拍照/截图]
  ↓
[Photo Journal]
  读取 EXIF → 写入 Calendar/Daily/2026-07-15.md 的 ## Pics 下
  格式：![[2026-07-15_xxx.jpg]]
  ↓
[Calendar Sidebar]
  vault.on('create') / vault.on('modify')
  ↓
  metadataCache.getCache(file)
  ↓
  正则提取 ![[...]] → 过滤图片扩展名
  ↓
  Map<日期字符串, 图片路径数组>
  ↓
  renderGrid() → 每个格子背景图
  ↓
[用户点击日期]
  → workspace.openLinkText('YYYY-MM-DD', 'Calendar/Daily/')
```

---

## 与 ObJournal 的关系

| 功能 | ObJournal 负责 | Calendar Sidebar 负责 |
|------|---------------|----------------------|
| 月历视图 | ✅ 已有（在主面板） | ✅ 侧边栏精简版 |
| 列表视图 | ✅ | ❌ |
| 去年今日 | ✅ | ❌ |
| 编辑器图片布局 | ✅ | ❌ |
| 缩略图 IndexedDB | ✅ | 可选复用（后续） |
| 侧边栏日历 | ❌ | ✅ 核心功能 |
| 点击日期开日记 | ❌ | ✅ 核心功能 |

两者互补：ObJournal 管"打开后的浏览体验"，Calendar Sidebar 管"快速导航到某天"。

---

## 实施步骤

### Step 1：创建插件骨架
- 创建 `manifest.json`、`main.ts`
- 实现 `onload`、`activateView()`、`onunload`
- 验证侧边栏视图可以打开

### Step 2：实现日历渲染
- `calendar-view.ts`：`renderHeader()`、`renderWeekdays()`、`renderGrid()`
- 月份切换逻辑
- 今天高亮

### Step 3：接入数据
- `data-provider.ts`：扫描日记、提取图片、按月缓存
- 缩略图渲染（简单方案）

### Step 4：日期点击交互
- `workspace.openLinkText()` 打开日记
- 点击今天回到当前月

### Step 5：事件监听
- 监听 vault modify/create/delete 自动刷新
- 文件删除时清除对应缓存

### Step 6：美化样式
- DayOne 风格细节调整
- 暗色/亮色主题适配
- 无图日子的可选标记

---

## 备注

- 许可证：MIT
- 目标 Obsidian 版本：v1.4.0+
- 零外部依赖（仅 Obsidian API）
- 文件管理器高度会自动缩小，用户可拖拽分割条调整比例
