import type { Note, Notebook, NotebookGroup, Settings, Template, Workspace } from './types';
import { DEFAULT_HOME_LAYOUT, DEFAULT_SIDEBAR_SECTIONS, WORKSPACE_VERSION } from './types';
import { uid } from './utils';

export const defaultSettings: Settings = {
  theme: 'light',
  view: 'list',
  sort: 'updated',
  defaultMode: 'rich',
  defaultNotebookId: null,
  autoSaveMs: 600,
  showWordCount: true,
  sidebarWidth: 248,
  listWidth: 330,
  sidebarCollapsed: false,
  showThumbnails: true,
  contentThumbnails: false,
  homeLayout: [...DEFAULT_HOME_LAYOUT],
  homeHidden: [],
  fontFamily: 'inherit',
  fontSize: '3',
  fontColor: '#2b302c',
};

/** 内置模板：图标走线性 icon 键（不再是 emoji），卡片上另给一句人话说明。
 *  正文只留真正会填的字段，别把模板写成一份要交的表格。 */
export const builtinTemplates: Template[] = [
  {
    id: 'tpl_blank', name: '空白笔记', icon: 'blank', builtin: true, createdAt: 0,
    desc: '从一张白纸开始，什么都不带',
    content: '',
  },
  {
    id: 'tpl_meeting', name: '会议纪要', icon: 'meeting', builtin: true, createdAt: 0,
    desc: '时间、参会人、逐条议题的结论与待办',
    content: `## 会议信息

- 时间：
- 地点：
- 主持：
- 参会：

## 议题

### 1. 

- 讨论：
- 结论：

### 2. 

- 讨论：
- 结论：

## 待办

- [ ] 事项 · 负责人 · 截止日
- [ ] 事项 · 负责人 · 截止日

## 备注

> 
`,
  },
  {
    id: 'tpl_diary', name: '每日日记', icon: 'diary', builtin: true, createdAt: 0,
    desc: '今天做了什么、值得记的一件事、明天第一件事',
    content: `## 今天

- 做了：
- 见了：

## 值得记下的一件事


## 卡住的地方

- 

## 明天的第一件事

- [ ] 
`,
  },
  {
    id: 'tpl_reading', name: '读书笔记', icon: 'reading', builtin: true, createdAt: 0,
    desc: '书目、摘抄、我的想法与能用在哪',
    content: `## 书目

- 书名：
- 作者：
- 读至：第 __ 章

## 一句话概括

> 

## 摘抄

> 

## 我的想法


## 能用在哪

- [ ] 
`,
  },
  {
    id: 'tpl_todo', name: '待办清单', icon: 'todo', builtin: true, createdAt: 0,
    desc: '今天必须做的三件、有空再做、等回复',
    content: `## 今天必须完成

- [ ] 
- [ ] 
- [ ] 

## 有空再做

- [ ] 

## 等别人回复

- [ ] 
`,
  },
  {
    id: 'tpl_weekly', name: '周报', icon: 'weekly', builtin: true, createdAt: 0,
    desc: '本周产出、关键数据、风险阻塞、下周计划',
    content: `## 本周产出

- 

## 数据与进展

| 事项 | 结果 | 备注 |
| --- | --- | --- |
|  |  |  |

## 风险与阻塞

- 

## 下周计划

- [ ] 
`,
  },
];

export function emptyWorkspace(): Workspace {
  return {
    version: WORKSPACE_VERSION,
    notes: [],
    notebooks: [],
    groups: [],
    templates: builtinTemplates.map((t) => ({ ...t })),
    settings: { ...defaultSettings },
    shortcuts: [],
    savedSearches: [],
    recentSearches: [],
    noteHistory: {},
    sidebarSections: { ...DEFAULT_SIDEBAR_SECTIONS },
    sticky: '',
    updatedAt: Date.now(),
  };
}

function note(partial: Partial<Note> & Pick<Note, 'title' | 'content' | 'mode'>): Note {
  const now = Date.now();
  return {
    id: uid('note'), title: partial.title, content: partial.content, mode: partial.mode,
    notebookId: partial.notebookId ?? null,
    tags: partial.tags ?? [],
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    pinned: partial.pinned ?? false,
    favorite: partial.favorite ?? false,
    trashed: false, trashedAt: null,
    reminderAt: partial.reminderAt ?? null,
    reminderDone: false,
    sourceUrl: partial.sourceUrl ?? '',
    attachments: [],
  };
}

/** 首次启动的示例内容：既让人立刻看懂三栏怎么用，也把双模式/内链/剪藏都演示到。 */
export function seedWorkspace(): Workspace {
  const ws = emptyWorkspace();
  const now = Date.now();

  const gWork: NotebookGroup = { id: uid('grp'), name: '工作', collapsed: false, createdAt: now };
  const gLife: NotebookGroup = { id: uid('grp'), name: '生活', collapsed: false, createdAt: now };
  const nbInbox: Notebook = { id: uid('nb'), name: '收集箱', groupId: null, color: '#2F8F68', createdAt: now };
  const nbMeet: Notebook = { id: uid('nb'), name: '会议纪要', groupId: gWork.id, color: '#3B7DD8', createdAt: now };
  const nbProj: Notebook = { id: uid('nb'), name: '项目资料', groupId: gWork.id, color: '#C97A2B', createdAt: now };
  const nbDiary: Notebook = { id: uid('nb'), name: '日记', groupId: gLife.id, color: '#8A63C9', createdAt: now };
  const nbRead: Notebook = { id: uid('nb'), name: '读书', groupId: gLife.id, color: '#C0506B', createdAt: now };

  ws.groups = [gWork, gLife];
  ws.notebooks = [nbInbox, nbMeet, nbProj, nbDiary, nbRead];
  ws.settings.defaultNotebookId = nbInbox.id;

  const welcome = note({
    title: '欢迎来到纸间笔记',
    mode: 'rich',
    notebookId: nbInbox.id,
    tags: ['开始使用'],
    pinned: true,
    favorite: true,
    updatedAt: now - 1000,
    content: `<h2>一处只属于你的笔记</h2>
<p>纸间笔记是<strong>本地优先</strong>的个人笔记：不需要账号、不上传数据，所有笔记都以纯文本 <code>.md</code> / <code>.html</code> 文件落在你自己的磁盘上，能被 git 管理、能被 grep、换任何编辑器都打得开。</p>
<h3>怎么用</h3>
<ul><li><strong>首页</strong>：最近笔记、快捷方式、待办、即时贴一眼看全</li><li><strong>侧栏</strong>：全部笔记、任务、文件、日历、模板、笔记本组、嵌套标签、回收站</li><li><strong>编辑器</strong>：所见即所得；需要写 Markdown 源码时从右上角「更多」切到源码视图</li></ul>
<h3>已经给你准备好的</h3>
<p>高级搜索语法与保存的搜索、<a href="#" class="wikilink" data-wiki="双模式怎么切换">双模式怎么切换</a> 这类笔记内链、图片粘贴、笔记历史快照、提醒、模板、网页剪藏、回收站、多格式导入导出、快捷键、明暗主题，都在。</p>
<blockquote><p>先随便改几个字试试，右上角会显示保存状态。</p></blockquote>`,
  });

  const switchMode = note({
    title: '双模式怎么切换',
    mode: 'markdown',
    notebookId: nbInbox.id,
    tags: ['技巧', '编辑器'],
    updatedAt: now - 3600_000,
    content: `# 源码视图怎么切换

默认就是所见即所得的富文本。想写 Markdown 源码时，从编辑器**右上角「更多」**或底栏的模式标签切到「源码视图」：

- 切过去时，正文会**原地转换**，不是新开一篇，也不是丢格式
- 富文本支持加粗、字体字号、颜色高亮、对齐缩进、列表、待办、引用、代码块、表格、图片、内链
- 源码视图是左边写、右边实时预览，也可以只看预览；再切回来就回到富文本

## 内链

用 \`[[笔记标题]]\` 就能链到另一篇，比如 → [[欢迎来到纸间笔记]]。
点一下会直接跳过去，标题改了也不会断（按标题匹配）。

## 待办

- [x] 试一下双模式
- [ ] 粘一张图片进来
- [ ] 给一篇笔记设个提醒

## 代码

\`\`\`ts
const note = { title: '一篇笔记', mode: 'markdown' };
\`\`\`
`,
  });

  const clip = note({
    title: '网页剪藏能怎么用',
    mode: 'markdown',
    notebookId: nbRead.id,
    tags: ['技巧', '剪藏'],
    updatedAt: now - 2 * 3600_000,
    content: `# 网页剪藏能怎么用

工具栏的 **剪藏** 面板有三条真实可用的路径：

1. **粘贴 HTML**：在浏览器里选中一段内容复制，回到这里粘贴，脚本和事件属性会被清掉，图片、链接、表格会留下来
2. **公开 URL**：桌面版由 Rust 侧直接抓取网页正文，不需要浏览器扩展
3. **导入文件**：\`.html\` / \`.enex\` / \`.md\` 直接拖进导入窗口

## 书签小工具

面板里给了一段可复制的书签代码。拖到浏览器书签栏后，在任意网页点一下，
它会把「标题 + 网址 + 选中内容」放进剪贴板，回来一键粘贴即可。

> 边界说清楚：浏览器右键菜单里的一键剪藏依赖扩展商店上架，桌面版不做那个假按钮。
`,
  });

  const reading = note({
    title: '读书笔记 · 卡片笔记写作法',
    mode: 'markdown',
    notebookId: nbRead.id,
    tags: ['读书', '方法'],
    updatedAt: now - 26 * 3600_000,
    content: `## 书目

- **书名**：卡片笔记写作法
- **作者**：申克·阿伦斯
- **读到**：第 3 章

## 大意（我的转述，非书中原文）

> 写作不是把想法倒出来，而是在一堆已经写好的卡片之间找出联系。

## 我的想法

一条笔记只放一个想法，并且用自己的话写一遍。真正值钱的不是收藏，
是**链接**：新卡片进来时先问它和哪张旧卡片有关。

相关：[[双模式怎么切换]]

## 可以用在哪

- [x] 给每篇笔记补标签
- [ ] 把内链真正用起来
`,
  });

  const meeting = note({
    title: '10 月产品例会',
    mode: 'markdown',
    notebookId: nbMeet.id,
    tags: ['会议'],
    reminderAt: now + 2 * 24 * 3600_000,
    updatedAt: now - 5 * 24 * 3600_000,
    content: `## 会议信息

- **时间**：10 月 28 日 14:00
- **参会**：产品 / 设计 / 研发

## 结论

- 搜索先做内存索引，几千篇的量级不需要上 FTS
- 编辑器双模式，内容以当前模式为唯一真相，切换时原地转换

## 待办

- [x] 定数据落盘格式
- [ ] 补回收站的彻底删除二次确认
`,
  });

  // 文件视图有内容可看：给读书笔记挂一个纯文本附件（data URL 自包含）。
  reading.attachments = [{
    id: uid('att'), name: '卡片索引.txt', mime: 'text/plain', size: 42,
    kind: 'file', createdAt: now - 26 * 24 * 3600_000,
    dataUrl: 'data:text/plain;charset=utf-8,' + encodeURIComponent('卡片 01：一条笔记只放一个想法\n卡片 02：用自己的话写一遍\n'),
  }];

  ws.notes = [welcome, switchMode, clip, reading, meeting];
  ws.shortcuts = [
    { id: uid('sc'), kind: 'note', refId: welcome.id, label: '欢迎来到纸间笔记', createdAt: now },
    { id: uid('sc'), kind: 'notebook', refId: nbInbox.id, label: '收集箱', createdAt: now },
    { id: uid('sc'), kind: 'tag', refId: '读书', label: '# 读书', createdAt: now },
  ];
  ws.savedSearches = [
    { id: uid('ss'), name: '有附件的笔记', query: 'has:attachment', createdAt: now },
    { id: uid('ss'), name: '带待办', query: 'has:todo', createdAt: now },
  ];
  ws.recentSearches = ['待办', '纸间笔记'];
  ws.sticky = '点这里随手记一句…';
  return ws;
}
