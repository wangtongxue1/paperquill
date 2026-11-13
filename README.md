# 纸间笔记 Paperquill · 本地优先的个人笔记

对标印象笔记的**个人版**：首页仪表盘、快捷方式与保存的搜索、任务 / 文件 / 日历 / 模板视图、
笔记本与笔记本组、嵌套标签、高级搜索语法、富文本 / Markdown 双模式编辑器、笔记历史快照、
图片附件、提醒、模板、笔记内链、网页剪藏、回收站、多格式导入导出、快捷键、明暗主题。

**信息架构按印象笔记完整对齐**：侧栏包含首页、全部笔记、收藏、置顶、提醒、快捷方式、任务、文件、日历、模板、笔记本组、标签、回收站，每个区块都能在「自定义侧栏」里显示 / 隐藏。云端能力（同步、协作、AI、OCR、浏览器扩展）不做，见 [ADR 0006](docs/adr/0006-完整对标印象笔记的信息架构.md)。

**没有账号、没有同步、没有遥测。** 数据以 `workspace.json` 为单一事实源，同时每篇笔记镜像成
普通 `.md` / `.html` 文件；关掉程序，笔记仍然躺在你自己的磁盘上，能被 git 管、被 grep、被记事本打开。

**编辑以所见即所得的富文本为主**；需要写 Markdown 源码时，在编辑器右上角「更多」或底栏切到「源码视图」。无论哪种视图，磁盘上都有纯文本镜像。详见 [ADR 0005](docs/adr/0005-重新评估-Markdown-编辑定位.md)。

---

## 一、三种运行方式

| 形态 | 交付物 | 数据存哪 | 适用 |
| --- | --- | --- | --- |
| **桌面安装版** | `Paperquill-2.5.11-setup-win64.exe`（NSIS 向导） | `%APPDATA%\com.zhijian.desktop\`（安装目录 `%LOCALAPPDATA%\Paperquill`） | 向导式安装到当前用户，可从「应用与功能」卸载，数据目录与便携版相同 |
| **桌面便携版（推荐）** | `纸间笔记.exe` / `纸间笔记-桌面版.zip` | `%APPDATA%\com.zhijian.desktop\` | 日常使用，真实文件落盘、公开 URL 剪藏、原生保存对话框 |
| **离线单文件版** | `纸间笔记-离线版.html` | 浏览器 localStorage | 双击即用，零安装；换机器时用备份 JSON 搬家 |
| **源码开发** | 本项目 | 同上（按运行环境） | 改功能、二次开发 |

三种形态共用**同一份前端代码**，备份 JSON 可以互相还原。

---

## 二、功能清单

| 模块 | 已实现 |
| --- | --- |
| 首页 | 问候与日期、5 个统计卡、即时贴（自动保存）、快捷方式、最近笔记、待办、笔记本概览、快速上手 |
| 主视图 | **任务**（汇总所有笔记待办、勾选回写正文）、**文件**（所有附件与下载）、**日历**（月历 + 当天笔记 / 提醒）、**模板**（内置 / 自定义、从当前笔记存成模板） |
| 组织 | 笔记本、笔记本组（可折叠）、未分类、收藏、置顶、回收站（恢复 / 彻底删除 / 清空）、无标签视图、自定义侧栏区块 |
| 快捷方式 | 右键笔记 / 笔记本 / 标签固定，或固定一条保存的搜索；首页与侧栏同步展示 |
| 标签 | 一篇多标签、`父/子` 嵌套标签树、按标签筛选、批量加标签、重命名 / 全局删除标签 |
| 检索 | 标题 + 正文 + 标签全文搜索（内存打分，中文 2-gram 容错）、结果高亮、四种排序、置顶优先；**高级语法** `tag: notebook: intitle: created: updated: has: is:`（`-` 前缀排除）、居中搜索弹窗、最近搜索、保存的搜索 |
| 外观 | 明暗两套主题共用一套 CSS 变量；深色模式下正文是 #CFD8D1（不刺眼），标题靠字重而不是亮度拉开层级 |
| 编辑器 | 富文本由 **Tiptap / ProseMirror** 内核驱动（结构与 Obsidian、Joplin、Notion 同一路数，不是拿 `contenteditable` 拼字符串）：字体 / 字号 / 文字色 / 六色高亮 / 上标下标 / 对齐 / 清除格式 / 段落格式 / 标题 1-6 / 加粗斜体下划线 / 有序无序列表 / 检查清单 / 引用 / 带语言的代码块 / 表格增删行列与表头 / 图片缩放对齐 / 链接 / 时间戳（品牌色标签）/ 语音与视频播放器；行首 Markdown 语法（含 `[]` 直接变待办）、待办回车续行、空项回车跳出、网址自动成链；表格里 Tab 跳格；选中图片出工具条。**富文本 / 源码**的切换收在底栏右下角那一个按钮上（顶部不再重复摆一组），`Ctrl+Shift+M` 同样有效。源码视图带语法高亮（标题、强调、链接、内链、列表、待办、代码块、表格各自着色），**待办标记按复选框来画**（括号是半透明的品牌色边框，勾选后点亮、正文淡下去，行首的 `-` 退成浅灰不抢眼），编辑 / 分栏 / 预览三态、可点复选框回写；切换时原地互转。逐项对标见 [docs/editor-parity.md](docs/editor-parity.md) |
| 笔记管理 | 笔记信息面板、本地历史快照（自动 + 手动，最多 15 版，可恢复 / 清空）、正文查找替换、复制内链、保存为模板 |
| 附件 | 粘贴 / 拖拽图片、语音、视频与普通文件（图片 ≤8 MB、音视频 ≤24/32 MB），正文用短引用 `zhijian-attachment:<id>`（源码不塞 base64），预览 / 导出 / 镜像统一还原成自包含 data URL；**正文里删掉内容后附件自动回收**（1.6 秒宽限期，撤销可救回）。文件按扩展名显示**彩色类型徽标**，正文里是「徽标 + 名称 + 大小 + 预览」的块级卡片；预览弹窗本地还原 Word / Excel / PPT / HTML / Markdown / CSV 的版式（docx-preview 等，不联网、不上传），桌面版还能一键「用本机程序打开」；图片 / 文件卡片 / 音视频共用浮动工具条：宽度 25%~100% 多档 + 左 / 中 / 右对齐，随笔记持久化。图片 / 文件与音视频两条上传通道分开，互不误判 |
| 内链 | `[[笔记标题]]`，Markdown 预览与富文本里都能点击跳转，按标题匹配 |
| 提醒 | 任意时间、四个快捷预设、到期应用内提示、标记完成、清除 |
| 模板 | 6 套内置（会议纪要 / 日记 / 读书 / 待办 / 周报 / 空白）、自定义模板、插入到当前笔记 |
| 剪藏 | 粘贴 HTML（自动清洗脚本）、公开 URL 抓取（Rust 侧 ureq，挡内网 / 云元数据）、书签小工具、ENEX / HTML 导入 |
| 画板 | 矩形 / 圆角矩形 / 椭圆 / 菱形 / 便签 / 文本 / 自由画笔 / 橡皮 / 连线；**框选、八向缩放、对齐参考线与网格吸附**（Alt 临时关）、连线三种走法 + 端点重接 + 线上标签、图层顺序、多选对齐与等距分布、精确 X/Y/W/H、方向键微调、Ctrl+C/V/D、空格拖画布、Ctrl+滚轮缩放、撤销重做；保存成按内容裁剪的 PNG 快照插进正文，文档存本地可双击回编 |
| 导入导出 | 导入 Markdown / 文本 / HTML / ENEX / 备份 JSON（统一转富文本）；**编辑器内可导入并选择覆盖 / 追加 / 存成新笔记**；**统一导出面板**（列表右键 / 编辑器菜单 / 导入导出页同一套）：单篇 MD / HTML / **PDF**（真落文件：离屏排版 A4 → 按空白行分页 → 写 PDF，不依赖系统打印对话框）/ TXT / ENEX / **打印**，**多选可一次打包导出**（MD / HTML / TXT 出 zip，ENEX 出单个文件）；整库 JSON 备份、Markdown ZIP（按笔记本分目录）、全库 ENEX |
| 其它 | 列表 / 卡片视图与缩略图、侧栏与列表宽度可拖拽、数据目录可自定义（切换时复制旧数据）、Ctrl / Shift 多选与批量操作、右键菜单、明暗主题（含跟随系统）、自动保存、字数统计、快捷键（Ctrl+F 高级搜索 / Ctrl+H 查找替换 / Ctrl+G 首页 / Ctrl+1~5 主视图）、自绘标题栏；**全局通知中心**：所有提示统一在窗口上部正中，多条堆叠互不遮盖、单条可关，层级高于一切弹层；「到期提醒」列表完整弹出不被标题栏裁切 |

---

## 三、数据落在哪

```
%APPDATA%\com.zhijian.desktop\
├── workspace.json          ← 单一事实源，原子写（tmp → rename）
├── workspace.json.tmp      ← 仅在写入瞬间存在
└── notes\
    ├── 欢迎来到纸间笔记-xxxxxx.html   ← 富文本笔记镜像
    ├── 双模式怎么切换-xxxxxx.md   ← Markdown 笔记镜像
    └── ...
```

- 镜像只在内容真的变化时写盘，标题栏每敲一个字不会反复碰磁盘。
- 回收站里的笔记不镜像，恢复后自动重新出现。
- 图片以 data URL 存在笔记里，所以镜像文件单独打开也能显示插图。
- 浏览器 / 单文件版用 IndexedDB（`file://` 下自动回落 localStorage），不写磁盘。

---

## 四、边界（如实说明，不做假按钮）

| 项 | 说明 |
| --- | --- |
| 网页剪藏 | 浏览器右键菜单的一键剪藏依赖扩展商店上架，本版**没有做**。可用的是粘贴 HTML、公开 URL 抓取、书签小工具三条真实路径。 |
| 提醒 | 应用内提醒。程序没打开时**不会**补发系统通知。 |
| 富文本 | 基于 WebView 自带的 contenteditable，Word 级分栏 / 批注 / 修订不在范围内。 |
| URL 抓取 | 默认禁止本机、局域网、云元数据地址，避免这个入口被当成端口扫描器。 |
| 同步 | 没有，也不打算有。「个人版」的前提就是数据只在本机。 |

---

## 五、快捷键

| 键 | 作用 |
| --- | --- |
| `Ctrl/⌘ + N` | 新建笔记 |
| `Ctrl/⌘ + S` | 立即保存 |
| `Ctrl/⌘ + F` | 聚焦全局搜索 |
| `Ctrl/⌘ + K` | 插入 `[[笔记内链]]` |
| `Ctrl/⌘ + Shift + T` | 从模板新建 |
| `Ctrl/⌘ + Shift + C` | 网页剪藏 |
| `Ctrl/⌘ + Shift + E` | 导入导出 |
| `Ctrl/⌘ + B / I / U / D` | 加粗 / 斜体 / 下划线 / 删除线（源码视图同样可用） |
| `Ctrl/⌘ + 1~6` | 源码视图里把当前行设成对应级别标题 |
| `Ctrl/⌘ + Alt + 1~6` | 富文本里把当前段落设成 1–6 级标题 |
| `Ctrl/⌘ + Shift + X` | 源码视图里把当前行变成待办 |
| `Ctrl/⌘ + Shift + V` | 粘贴为纯文本（不带源网页字体字号） |
| `Tab` / `Shift + Tab` | 表格里跳到下一格 / 上一格，末格再 Tab 补一行；列表里缩进 / 反缩进 |
| `#` `##` `###` `-` `1.` `[]` `>` ` ``` ` + 空格 | 行首语法直接成型（富文本） |
| `[][]x3` + 空格 | 插入 2 列 3 行表格 |
| `Ctrl/⌘ + A` | 全选当前列表（焦点不在输入框时） |
| `Ctrl` 点 / `Shift` 点 | 多选 / 连选 |
| `Esc` | 关弹窗 / 取消多选 |

---

## 六、构建

```bash
pnpm install --registry=https://registry.npmmirror.com
pnpm build                            # tsc + vite，产出 dist/（IIFE 单 chunk）
node tools/verify_migrate.mjs         # 存档迁移回归断言（6 组，含 v1→v2）
python tools/make_singlefile.py       # 产出 output/zhijian/纸间笔记-离线版.html
python tools/make_icons.py            # 生成应用图标（纯标准库）
cd src-tauri && cargo build --release # 产出 zhijian-desktop.exe
python tools/package.py               # 产出便携版 zip + SHA256
```

环境：Node 22 / pnpm 12 / Rust 1.99 / Tauri 2.12 / WebView2（Windows 自带）。

### 避坑清单（这一版真踩过的）

1. **`custom-protocol` 必须默认开启**，否则裸 `cargo build --release` 出来的 exe 会去连 devUrl 显示白页。
2. **单文件版不能把内联 script 留在 `<head>`**：普通 script 同步执行时 `#root` 还没解析，React 抛 #299。必须挪到 `</body>` 前。
3. **`file://` 下 `indexedDB.open` 可能既不 success 也不 error**，启动页会永久卡住 → 协议判断 + 1.5 秒超时 + localStorage 兜底。
4. **富文本用 ref 灌 `innerHTML`，不要用 `dangerouslySetInnerHTML`**（每次渲染会重置光标）；初始化时不能把「已同步」标记预设成笔记内容，否则正文空白。
5. **窗口按钮走自定义 IPC**，前端不 import `@tauri-apps/api/window`，整包才能打成单个 IIFE。
6. **`mutate` 用 `wsRef` 同步推进**，连续两次改动（如切换模式前先 flush 草稿）不会丢前一次。
7. 自动保存有 0.6 秒延迟；关窗前 `beforeunload` 会再尽力写一次盘。
8. **改 identifier 会换数据目录**：Rust 启动时把旧目录存档复制过来，只复制不删除，见 `src-tauri/src/main.rs`。
9. **存档解析失败必须停住**：`storage.load()` 抛错后不 seed、不写盘，见 `App.tsx` 的 `fatalError` 分支。

---

## 七、目录结构

```
zhijian/
├── src/
│   ├── App.tsx            主框架、状态、快捷键、主题、提醒轮询
│   ├── context.ts         全局 Context
│   ├── actions.ts         所有数据操作（唯一写入口）
│   ├── types.ts           数据模型
│   ├── storage.ts         IndexedDB / Tauri IPC 双适配
│   ├── convert.ts         Markdown ↔ HTML、内链、HTML 清洗
│   ├── editor-schema.ts   编辑器内核扩展清单（Tiptap / ProseMirror）
│   ├── tiptap-html.ts     存档 HTML ⇄ 编辑器 HTML
│   ├── pdf.ts             导出 PDF：离屏排版、分页、落盘
│   ├── pdf-writer.ts      最小 PDF 写入器（图像页，可脱离浏览器断言）
│   ├── search.ts          中文友好的内存全文检索
│   ├── io.ts              导入导出、ENEX、ZIP、剪藏
│   ├── data.ts            示例内容与内置模板
│   ├── styles.css         明暗双主题
│   └── components/        Sidebar / NoteList / Editor / RichEditor / MarkdownPane / BoardDialog / Dialogs / Common
├── src-tauri/src/
│   ├── main.rs            Tauri 入口
│   └── commands.rs        存档读写、纯文本镜像、导出、剪藏、窗口控制
└── tools/                 单文件生成、图标、打包脚本
```

## 八、开源与许可

本项目按 **Apache-2.0** 授权，见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

- 改名「纸间笔记」的原因、合规边界与开源清单：[OPEN_SOURCE.md](OPEN_SOURCE.md)
- 存档格式是公共契约，含迁移规则与兼容承诺：[docs/data-format.md](docs/data-format.md)
- 编辑器与印象笔记的逐项对照（含不做的理由）：[docs/editor-parity.md](docs/editor-parity.md)
- 为什么把编辑内核换成 ProseMirror：[docs/adr/0007-编辑内核改用-ProseMirror.md](docs/adr/0007-编辑内核改用-ProseMirror.md)
- 架构取舍：[docs/adr/](docs/adr/)　安全与剪藏边界：[SECURITY.md](SECURITY.md)　参与开发：[CONTRIBUTING.md](CONTRIBUTING.md)

**从旧版升级**：首次启动会把 `%APPDATA%\com.inknote.desktop\` 的存档复制到新目录 `com.zhijian.desktop`，旧目录原样保留、可随时回退；浏览器模式的内部存储键也刻意保留旧名，改名不会丢已有笔记。
