# ADR 0007：富文本编辑改用 ProseMirror / Tiptap 内核

- 状态：**已接受**（2026-11-12 用户提出「参考 Obsidian、Joplin 这些现成软件的做法」）
- 日期：2026-11-12
- 相关：0001（不采用块编辑器模型）、0002（纯文本落盘）、0005（Markdown 定位）

## 背景

前三版富文本是直接用 `contenteditable` + `document.execCommand` 手写的。功能能堆出来，但
文档结构没有模型，全靠浏览器 DOM 自己长：

- 回车会把 `<li>` 拆成两个，勾选框跟着复制，文字和方框抢位置（截图里出现过 6 个方框挤一行的场面）；
- `execCommand` 在新版浏览器里正在退场，撤销粒度、粘贴清洗、表格编辑都得逐个打补丁；
- 「点待办勾不上」这类 bug 的根因都在 DOM 与数据不同步，只能在每次读 DOM 前跑一遍「规整函数」。

Obsidian、Joplin、Notion、飞书的做法是一致的：**正文交给一个带 schema 的编辑内核**。Obsidian 用
CodeMirror 6（Markdown 为源），Joplin 富文本用 TinyMCE、后来转向 ProseMirror 方案，Notion 与飞书
文档都是自研的块/ProseMirror 系内核。它们的共同点是：结构由内核维护，按键、粘贴、撤销都由内核
按文档模型处理，应用层只负责命令与 UI。

## 决定

**富文本编辑面板改用 Tiptap（ProseMirror）内核，存档格式保持不变。**

- 编辑内核：`@tiptap/react` + StarterKit + TaskList / Table / Image / TextAlign / Highlight /
  TextStyle / Subscript / Superscript，配置集中在 `src/editor-schema.ts`。
- 边界转换：`src/tiptap-html.ts` 负责「存档格式 ⇄ 编辑格式」，两边都是 HTML，规则明确、可断言。
- 存档仍是 `<ul><li class="task-item"><input type="checkbox"> 文案</li></ul>` 这类简单结构，
  没有私有 JSON、没有块 id、没有 schema 版本号。
- Markdown 仍是「源码视图」，与富文本双向原地切换（沿用 ADR 0005 的路线 A）。

## 理由

1. 待办的结构性问题从根上消失：复选框是 `li` 里的 `label > input`，文字在 `div > p`，行内不会再
   出现「方框和文字抢位置」；回车由 `splitListItem` 处理，空项回车自动跳出清单。
2. 勾选写的是文档模型的属性（`data-checked`），不是浏览器控件的临时状态，落盘即生效。
3. 撤销重做、粘贴清洗、表格增删行列、Tab 跳格都是内核自带的，不再逐个打补丁。
4. 存档格式不变，导出、镜像、搜索结果、剪藏、老存档迁移全部零改动；`docs/data-format.md`
   的兼容承诺继续有效。
5. 内核可替换：只要 `tiptap-html.ts` 的两条转换规则还在，换 CodeMirror 或其它内核不需要动数据。

## 后果

- 前端包体从约 570 KB 涨到约 1.06 MB（gzip 326 KB）。离线单文件版变大，但仍在可接受范围。
- 富文本的 `缩进 / 反缩进` 按钮去掉了：ProseMirror 里缩进属于列表语义（Tab / Shift+Tab），
  没有「段落左移几像素」这种东西。日常写作里列表缩进已经覆盖。
- 编辑器内部是块文档模型，但**落盘不是**。ADR 0001 的结论（不把块模型当存储格式）依然成立，
  只有「编辑层用什么」变了。
- 新增依赖全部 MIT（Tiptap、ProseMirror），见 `THIRD_PARTY_NOTICES.md`。

## 验证

- `npm run verify:editor`：在真浏览器里跑真编辑器，38 条断言覆盖存档往返、待办回车续行 / 空项
  回车跳出、勾选落盘、表格增行、代码块语言、内链往返、行首语法（`[]`、`[x]`、`#`）、撤销。
- `npm run verify:ui`：单文件版里真点一遍，20 个观测点覆盖工具栏、取色板可点、复选框可见与
  删除线、切笔记后勾选仍在、图片上传与缩放、附件预览、源码视图回写。
