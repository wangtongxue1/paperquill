# 数据格式契约

> **这份文档是对外承诺，不是实现说明。** `workspace.json` 一旦被别人写脚本读取、被同步工具依赖，它就是公共 API。任何版本都必须能打开历史存档。

## 一、数据存在哪

| 运行方式 | 位置 | 说明 |
| --- | --- | --- |
| 桌面版 | `%APPDATA%\com.zhijian.desktop\workspace.json` | 主存档，原子写（`.tmp` → rename） |
| 桌面版 | 同目录 `notes\*.md` / `notes\*.html` | 每篇笔记的纯文本镜像 |
| 离线单文件版 | 浏览器 `localStorage` 键 `inknote.workspace` | `file://` 下 IndexedDB 可能挂起，改用 localStorage |
| 浏览器预览版 | IndexedDB 数据库 `inknote`、store `kv`、键 `workspace` | 失败时回落上面的 localStorage 键 |

三种模式可以用「导入导出 → 完整备份 JSON」互搬。

## 二、`workspace.json` 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 存档格式版本，当前 **`3`**（`WORKSPACE_VERSION`） |
| `notes` | Note[] | 全部笔记，**含回收站里的** |
| `notebooks` | Notebook[] | `id / name / groupId / color / createdAt` |
| `groups` | NotebookGroup[] | `id / name / collapsed / createdAt` |
| `templates` | Template[] | 内置与自定义模板，`builtin` 标记来源；`icon` 是语义键（`blank / meeting / diary / reading / todo / weekly / custom`），`desc` 是卡片上的一句话说明 |
| `settings` | Settings | 主题、视图、排序、默认模式、栏宽、字体等 |
| `shortcuts` | Shortcut[] | v2 新增：`id / kind(note\|notebook\|tag\|search) / refId / label / createdAt` |
| `savedSearches` | SavedSearch[] | v2 新增：`id / name / query / createdAt` |
| `recentSearches` | string[] | v2 新增，最多 12 条 |
| `noteHistory` | Record\<noteId, NoteVersion[]\> | v2 新增，每篇最多 15 版；`id / at / title / content / mode` |
| `sidebarSections` | SidebarSections | v2 新增，10 个区块的可见布尔值 |
| `sticky` | string | v2 新增，首页即时贴 |
| `updatedAt` | number | 毫秒时间戳 |

**未知字段必须原样保留。** `migrate()` 用对象展开把顶层所有字段带过去，只补缺失值、不删属性。

### v1 → v2 迁移规则

v2 **只增加顶层可选字段与 `settings` 缺省值，不改 `Note` 结构**，因此：

- v1 存档加载时由 `migrate()` 补上 `shortcuts: []`、`savedSearches: []`、`recentSearches: []`、`noteHistory: {}`、`sticky: ''`、`sidebarSections` 全 `true`，以及 `showThumbnails / fontFamily / fontSize / fontColor`。
- 已有值一律不改写（例如用户关掉的侧栏区块不会被默认值重新打开）。
- `storage.load()` 用 `wasLastLoadUpgraded()` 记录「这次读的是旧版档」（`migrate()` 会把 version 改成当前值，调用方拿不到原始版本）；应用启动时据此把升级后的存档**写回一次**。存档解析失败时绝不写盘。
- v1 程序打开 v2 存档也不会丢字段（未知字段原样保留），但快捷方式 / 历史等新功能在旧版里不可见。
- `notes/*.md|html` 镜像命名与双镜像规则不变；`__markdownMirrors` 仍是前端临时字段，Rust 在原子写之前剔除。

`Settings` 新增字段缺省值：`showThumbnails: true`、`fontFamily: 'inherit'`、`fontSize: '3'`、`fontColor: '#2b302c'`。它们只影响编辑界面，不参与正文存储。

### v2 → v3 迁移规则

v3 **只动内置模板**，笔记结构与 `Settings` 都不变：

- 内置模板（`builtin: true`）的 `name / icon / content / desc` 按 id 刷成当前定义 —— 这几项属于产品内容，随版本更新（v2 用的是整套旧文案和 emoji 图标）。
- 自定义模板（`builtin: false`）一个字段都不动，包括旧版遗留的 emoji `icon`；渲染层把认不出的 `icon` 键降级成通用线性图标。
- 存档里缺失的内置模板按 id 补齐；已有的旧模板不会被删掉。
- `Template` 新增可选字段 `desc`（卡片说明），旧档没有也能正常渲染。

## 三、`Note` 字段

| 字段 | 类型 | 缺省值 |
| --- | --- | --- |
| `id` | string | 缺失时生成 `legacy_…` |
| `title` | string | `''` |
| `content` | string | `''`；含义由 `mode` 决定 |
| `mode` | `'markdown' \| 'rich'` | `'markdown'`；`markdown` = Markdown 源，`rich` = HTML 片段 |
| `notebookId` | string \| null | `null` |
| `tags` | string[] | `[]` |
| `createdAt` / `updatedAt` | number | 当前时间 |
| `pinned` / `favorite` / `trashed` / `reminderDone` | boolean | `false` |
| `trashedAt` / `reminderAt` | number \| null | `null` |
| `sourceUrl` | string | `''` |
| `attachments` | Attachment[] | `[]`，见下 |
| `boards` | BoardDoc[] \| 缺省 | v2.3 新增，可选；这条字段不存在时按「没有画板」处理 |

**Attachment**（v2.3 起 `kind` 扩到五种）：

| 字段 | 说明 |
| --- | --- |
| `id` / `name` / `mime` / `size` / `dataUrl` / `createdAt` | 与 v2 一致，`dataUrl` 仍是自包含 base64 |
| `kind` | `image` \| `file` \| `audio` \| `video` \| `board` |
| `boardId` | 仅 `kind=board`：指向 `boards[].id`，正文里那张 PNG 快照带 `data-board-id`，双击可以回去继续编辑 |
| `orphanSince` | 可选，保留字段；当前实现用内存里的宽限计时，不落盘 |
| `noMedia` | v2.5.9 起可选，布尔；从「插入图片 / 文件」通道上传的附件为 `true`，预览时不再嗅探音视频。老存档没有这个字段，按扩展名兜底，历史音视频附件仍能播放 |

**BoardDoc**：`id / title / width / height / els[] / updatedAt`。`els` 是形状、文本、连线、自由笔的平铺数组（`type / x / y / w / h / text / fill / stroke / strokeWidth / fontSize / from / to / x2 / y2 / points`），纯 JSON、可读、可 diff。

v2.4 起每个元素还可选：`route`（连线走法 `elbow | straight | curve`）、`label`（连线中点文字）、`align`（`left | center | right`）、`dashed`（虚线描边）。旧存档缺这些字段时按默认值渲染（折线、无标签、形状居中），不需要迁移。

**单一真相**：`content` 永远只存当前 `mode` 的那一份。切换模式时 `convertContent()` 原地转换，不保存两份副本。HTML → Markdown 有损（颜色、对齐、复杂表格会丢），这是格式本身决定的。

## 四、纯文本镜像

- 文件名：`<slug>-<id 后 6 位>.<ext>`；`slug` 取标题去掉 `\/:*?"<>|` 等非法字符、空格转 `-`、截断 48 字。
- 扩展名：`mode === 'rich'` → 同时写 `.html`（包一层完整 HTML 文档）**和 `.md`**（由前端 turndown 转换，首行 `# 标题`）；`mode === 'markdown'` → 只写 `.md`。两种扩展名都是普通文本，路线 A 把默认视图改成富文本后，纯文本承诺不变。
- 富文本笔记的 Markdown 内容由前端 `storage.save` 生成，作为 `__markdownMirrors` 随存档传给 Rust；**该字段是传输用的临时数据，Rust 会在原子写之前剔除，不会出现在 `workspace.json` 里**。
- 回收站里的笔记**不镜像**，恢复后自动重新出现。
- 正文里的图片 / 附件用短引用 `zhijian-attachment:<id>`（Markdown 写 `![名称](zhijian-attachment:id)`，富文本写 `<img data-att-id="id">`；音视频写 `<video data-att-id="id">` / `<audio data-att-id="id">`），完整数据在 `workspace.json` 的 `attachments[].dataUrl`。**写镜像时 Rust 会把短引用还原成 data URL**，所以 `notes/*.md|html` 单独打开也能看到图；导出单篇 MD / HTML / ENEX 同样自包含。源码框里不再出现整段 base64。
- 镜像只在内容真的变化时写盘；标题改名 / 删除会清理旧镜像文件。
- 镜像是**派生数据**：删除它不会丢笔记，下次保存会重建；主存档是 `workspace.json`。

## 五、版本与迁移

`migrate()` 在 `src/storage.ts`，桌面版与浏览器版的 `load()` 都经过它。

规则：

1. 未知字段原样保留，只补默认值，**不改写已有值**。
2. 顶层不是对象 → 抛错；调用方必须停止写盘（`App.tsx` 的 `fatalError` 分支），绝不能用示例数据覆盖损坏的存档。
3. 提升 `WORKSPACE_VERSION` 时，在 `migrate()` 里按 `version` 逐级添加分支，并同步 `tools/verify_migrate.mjs` 的断言。
4. 破坏性变更必须提供显式导出 / 导入路径，不允许静默迁移。
5. 每次发布前跑 `node tools/verify_migrate.mjs`（5 组断言），CI 里也跑。

## 六、兼容承诺

- **任何版本都不会静默改写用户磁盘上的笔记文件。**
- 老档永远能打开；新增字段一律有缺省值。
- 镜像文件命名规则属于契约，改动需升版本并在 `CHANGELOG.md` 记录。
- 导入备份 JSON 时走同一套 `migrate()`，不另写一套解析。
- 存档写坏了宁可报错停住，也不「猜」一个结构继续跑。

## 七、刻意保留的旧标识

改名「纸间笔记」时，以下标识**没有跟着改**，改了会让老用户笔记消失：

| 标识 | 原因 |
| --- | --- |
| IndexedDB 库名 `inknote` | 浏览器预览版的已有存档在这里 |
| localStorage 键 `inknote.workspace` | 单文件版与 IndexedDB 回落路径共用 |
| 旧数据目录 `com.inknote.desktop` | Rust 启动时检测并**复制**到新目录 `com.zhijian.desktop`，旧目录保留可回退 |

它们是数据契约，不是品牌文案。

## 八、最小 fixture

任何版本都必须能打开这份最简存档：

```json
{
  "version": 0,
  "notes": [
    { "id": "n1", "title": "旧笔记", "content": "# 旧笔记\n\n正文", "mode": "markdown" }
  ],
  "settings": { "theme": "dark" }
}
```

`migrate()` 会补齐 `notebooks / groups / templates / updatedAt`，给笔记补上标签、附件、提醒等字段，保留 `settings.theme = 'dark'`，并把 `version` 升到 `1`。
