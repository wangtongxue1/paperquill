/** 纸间笔记的数据模型。所有时间都是毫秒时间戳，所有 id 都是本地生成的字符串。
 *  字段是公共契约，任何结构变更都要升 WORKSPACE_VERSION 并在 storage.migrate 里兼容，
 *  见 docs/data-format.md。 */

export type EditorMode = 'rich' | 'markdown';
export type ThemeMode = 'light' | 'dark' | 'system';
export type ViewMode = 'list' | 'card';
export type SortKey = 'updated' | 'created' | 'title' | 'reminder';

export type AttachmentKind = 'image' | 'file' | 'audio' | 'video' | 'board';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** 图片与文件都以 data URL 内嵌，导出的单篇笔记可以独立打开、不丢附件。 */
  dataUrl: string;
  createdAt: number;
  /** 正文里已经不再引用它、等待回收的时刻。撤销能在宽限期内把它救回来。 */
  orphanSince?: number;
  /** kind=board 时指向 BoardDoc.id，双击图片可以继续编辑。 */
  boardId?: string;
  /** 2.5.9：从「插入图片 / 文件」通道进来的附件，预览时不再嗅探音视频。
   *  老存档没有这个标记，仍按扩展名兜底，兼容历史上存坏 MIME 的音视频。 */
  noMedia?: boolean;
}

/* ---------- 画板 / 流程图 ----------
 *  飞书那种「一块无限画布」：形状 + 连线 + 自由笔 + 文本。
 *  画板文档存在笔记里（Note.boards），正文里插的是它的 PNG 快照，
 *  所以导出 / 打印 / 切 Markdown 都不会丢；想改就双击快照回到画板。 */

export type BoardElType = 'rect' | 'round' | 'ellipse' | 'diamond' | 'text' | 'arrow' | 'draw' | 'sticky';

export interface BoardEl {
  id: string;
  type: BoardElType;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  /** 连线：起点 / 终点元素 id；为空表示自由端点（用 x1y1x2y2 记坐标）。 */
  from?: string | null;
  to?: string | null;
  x2?: number;
  y2?: number;
  /** 自由笔的点序列，相对画布坐标，成对出现。 */
  points?: number[];
  /** 连线走法：折线（默认）/ 直线 / 曲线。旧存档没有这个字段时按折线画。 */
  route?: 'elbow' | 'straight' | 'curve';
  /** 连线中点上的一行文字，例如「是 / 否」。 */
  label?: string;
  /** 文本水平对齐；形状默认居中，文本框默认左对齐。 */
  align?: 'left' | 'center' | 'right';
  /** 虚线描边（用于「弱化」的框或分组边框）。 */
  dashed?: boolean;
}

export interface BoardDoc {
  id: string;
  title: string;
  width: number;
  height: number;
  els: BoardEl[];
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  /** 规范内容：mode=markdown 时是 Markdown 源，mode=rich 时是 HTML。切换模式时原地转换。 */
  content: string;
  mode: EditorMode;
  notebookId: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  favorite: boolean;
  trashed: boolean;
  trashedAt: number | null;
  reminderAt: number | null;
  reminderDone: boolean;
  sourceUrl: string;
  attachments: Attachment[];
  /** 这篇笔记里的画板（可选字段，老存档没有也照常读）。 */
  boards?: BoardDoc[];
}

export interface Notebook {
  id: string;
  name: string;
  groupId: string | null;
  color: string;
  createdAt: number;
}

export interface NotebookGroup {
  id: string;
  name: string;
  collapsed: boolean;
  createdAt: number;
}

export interface Template {
  id: string;
  name: string;
  /** 图标键（blank / meeting / diary / reading / todo / weekly / custom），
   *  旧档里可能是 emoji，渲染时统一降级成线性图标。 */
  icon: string;
  /** 卡片上的一句话说明；不填就截正文。 */
  desc?: string;
  /** Markdown 源；新建笔记时会按默认编辑器模式决定要不要转成 HTML。 */
  content: string;
  builtin: boolean;
  createdAt: number;
}

/** 印象笔记式快捷方式：可固定笔记、笔记本、标签或一条保存的搜索。 */
export interface Shortcut {
  id: string;
  kind: 'note' | 'notebook' | 'tag' | 'search';
  refId: string;
  label: string;
  createdAt: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  createdAt: number;
}

/** 本地笔记历史快照，最多保留 MAX_VERSIONS 条；云端版本历史不做。 */
export interface NoteVersion {
  id: string;
  at: number;
  title: string;
  content: string;
  mode: EditorMode;
}

/** 侧栏区块可见性，对应印象笔记「自定义侧栏」。 */
export interface SidebarSections {
  home: boolean;
  notes: boolean;
  shortcuts: boolean;
  tasks: boolean;
  files: boolean;
  calendar: boolean;
  templates: boolean;
  notebooks: boolean;
  tags: boolean;
  trash: boolean;
}

export const DEFAULT_SIDEBAR_SECTIONS: SidebarSections = {
  home: true,
  notes: true,
  shortcuts: true,
  tasks: true,
  files: true,
  calendar: true,
  templates: true,
  notebooks: true,
  tags: true,
  trash: true,
};

/* --------------------------- 首页布局自定义 --------------------------- */

/** 首页可摆放的模块。stats 是顶部那排指标卡，其余 6 个是下方网格里的卡片。 */
export const HOME_CARDS = ['stats', 'sticky', 'shortcuts', 'recent', 'tasks', 'notebooks', 'tips'] as const;
export type HomeCardId = typeof HOME_CARDS[number];

/** 默认顺序：统计 → 即时贴/快捷方式/最近笔记 → 待办/笔记本/快速上手。 */
export const DEFAULT_HOME_LAYOUT: HomeCardId[] = [...HOME_CARDS];

/** 校验用：规整成一份「完整 7 项」的顺序表（显隐另由 homeHidden 控制）。
 *  老档缺字段、含非法值、或漏了模块时，都按默认顺序补齐，避免卡片凭空消失。 */
export function normalizeHomeLayout(raw: unknown): HomeCardId[] {
  const seen = new Set<string>();
  const out: HomeCardId[] = [];
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (typeof c === 'string' && (HOME_CARDS as readonly string[]).includes(c) && !seen.has(c)) {
        seen.add(c);
        out.push(c as HomeCardId);
      }
    }
  }
  for (const c of DEFAULT_HOME_LAYOUT) {
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

export interface Settings {
  theme: ThemeMode;
  view: ViewMode;
  sort: SortKey;
  defaultMode: EditorMode;
  defaultNotebookId: string | null;
  autoSaveMs: number;
  showWordCount: boolean;
  sidebarWidth: number;
  listWidth: number;
  sidebarCollapsed: boolean;
  /** 列表里显示笔记缩略图（总开关）。 */
  showThumbnails: boolean;
  /** 是否允许把正文/附件里的第一张图提升为列表缩略图。默认关：正文插图不是笔记封面/LOGO。 */
  contentThumbnails: boolean;
  /** 首页模块的完整顺序表（始终 7 项）；显隐另由 homeHidden 控制。 */
  homeLayout: HomeCardId[];
  /** 首页隐藏的模块；留空表示全部显示。 */
  homeHidden: HomeCardId[];
  /** 富文本默认字体 / 字号 / 颜色。 */
  fontFamily: string;
  fontSize: string;
  fontColor: string;
}

export interface Workspace {
  version: number;
  notes: Note[];
  notebooks: Notebook[];
  groups: NotebookGroup[];
  templates: Template[];
  settings: Settings;
  shortcuts: Shortcut[];
  savedSearches: SavedSearch[];
  recentSearches: string[];
  /** noteId -> 由旧到新的快照列表。 */
  noteHistory: Record<string, NoteVersion[]>;
  sidebarSections: SidebarSections;
  /** 首页即时贴，随手记的临时内容。 */
  sticky: string;
  updatedAt: number;
}

export type NavSelection =
  | { kind: 'home' }
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'pinned' }
  | { kind: 'trash' }
  | { kind: 'reminders' }
  | { kind: 'untagged' }
  | { kind: 'tasks' }
  | { kind: 'files' }
  | { kind: 'calendar' }
  | { kind: 'templates' }
  | { kind: 'savedSearch'; id: string }
  | { kind: 'notebook'; id: string }
  | { kind: 'tag'; name: string };

/** 需要占满整个工作区的主视图（替换「列表 + 编辑器」两栏）。 */
export const FULL_VIEW_KINDS = ['home', 'tasks', 'files', 'calendar', 'templates'] as const;

export const MAX_VERSIONS = 15;
/** v3：内置模板换文案/图标（迁移时按 id 刷新，自定义模板原样保留）。 */
export const WORKSPACE_VERSION = 3;
