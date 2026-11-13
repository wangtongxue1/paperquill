import type {
  EditorMode, NavSelection, Note, NotebookGroup, SavedSearch, Settings,
  Shortcut, SidebarSections, Workspace,
} from './types';
import { MAX_VERSIONS } from './types';
import { convertContent } from './convert';
import { uid } from './utils';

export type Mutate = (fn: (draft: Workspace) => void) => void;

export interface CreateOpts {
  title?: string;
  content?: string;
  mode?: EditorMode;
  notebookId?: string | null;
  tags?: string[];
  sourceUrl?: string;
  reminderAt?: number | null;
  silent?: boolean;
}

export interface Actions {
  createNote: (opts?: CreateOpts) => string;
  updateNote: (id: string, patch: Partial<Note>) => void;
  patchNotes: (ids: string[], patch: Partial<Note>) => void;
  toggleFlag: (id: string, key: 'pinned' | 'favorite' | 'reminderDone') => void;
  moveNotes: (ids: string[], notebookId: string | null) => void;
  addTagTo: (ids: string[], tag: string) => void;
  removeTagFromAll: (tag: string) => void;
  renameTagEverywhere: (oldTag: string, newTag: string) => void;
  trash: (ids: string[]) => void;
  restore: (ids: string[]) => void;
  purge: (ids: string[]) => void;
  emptyTrash: () => void;
  switchMode: (id: string, mode: EditorMode) => void;
  addNotebook: (name: string, groupId?: string | null) => string;
  updateNotebook: (id: string, patch: { name?: string; color?: string; groupId?: string | null }) => void;
  deleteNotebook: (id: string, moveNotesToTrash?: boolean) => void;
  addGroup: (name: string) => string;
  updateGroup: (id: string, patch: Partial<NotebookGroup>) => void;
  deleteGroup: (id: string) => void;
  addTemplate: (name: string, content: string, icon?: string) => void;
  deleteTemplate: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  /** 印象笔记式快捷方式：同一个目标再次调用就取消固定。 */
  toggleShortcut: (kind: Shortcut['kind'], refId: string, label: string) => void;
  removeShortcut: (id: string) => void;
  addSavedSearch: (name: string, query: string) => string;
  removeSavedSearch: (id: string) => void;
  rememberSearch: (q: string) => void;
  setSticky: (text: string) => void;
  setSidebarSection: (key: keyof SidebarSections, visible: boolean) => void;
  /** 手动存一份快照（更多菜单「保存版本」）。 */
  snapshot: (noteId: string) => void;
  restoreVersion: (noteId: string, versionId: string) => void;
  clearHistory: (noteId: string) => void;
  /** 正文里不再引用的附件回收（编辑器延迟确认后调用）。 */
  pruneAttachments: (noteId: string, attIds: string[]) => void;
  importNotes: (notes: Note[]) => void;
  replaceWorkspace: (ws: Workspace) => void;
  saveNow: () => Promise<void>;
}

interface Deps {
  mutate: Mutate;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  setActiveId: (id: string | null) => void;
  setNav: (n: NavSelection) => void;
  setSelectedIds: (ids: string[]) => void;
  saveNow: () => Promise<void>;
}

const PALETTE = ['#2F8F68', '#3B7DD8', '#C97A2B', '#8A63C9', '#C0506B', '#3E9CA8', '#8B8F45'];

export function createActions(deps: Deps): Actions {
  const { mutate, toast, setActiveId, setNav, setSelectedIds, saveNow } = deps;
  const now = () => Date.now();

  const touch = (draft: Workspace, ids: string[], patch: Partial<Note>) => {
    const set = new Set(ids);
    draft.notes = draft.notes.map((n) =>
      set.has(n.id) ? { ...n, ...patch, updatedAt: patch.updatedAt ?? now() } : n
    );
  };

  return {
    createNote(opts = {}) {
      const id = uid('note');
      const t = now();
      mutate((d) => {
        const mode = opts.mode ?? d.settings.defaultMode;
        const notebookId =
          opts.notebookId !== undefined ? opts.notebookId : d.settings.defaultNotebookId;
        d.notes.unshift({
          id,
          title: opts.title ?? '',
          content: opts.content ?? '',
          mode,
          notebookId,
          tags: opts.tags ?? [],
          createdAt: t,
          updatedAt: t,
          pinned: false,
          favorite: false,
          trashed: false,
          trashedAt: null,
          reminderAt: opts.reminderAt ?? null,
          reminderDone: false,
          sourceUrl: opts.sourceUrl ?? '',
          attachments: [],
        });
      });
      if (!opts.silent) {
        setActiveId(id);
        setNav({ kind: 'all' });
        setSelectedIds([]);
      }
      return id;
    },

    updateNote(id, patch) {
      mutate((d) => {
        let shouldSnapshot = false;
        let old: Note | null = null;
        d.notes = d.notes.map((n) => {
          if (n.id !== id) return n;
          old = n;
          // 自动快照：内容真的变了，且距上一份超过 60 秒（编辑器每次输入都会调这里）。
          if (patch.content !== undefined && patch.content !== n.content) {
            const hist = d.noteHistory[id] || [];
            shouldSnapshot = hist.length === 0 || now() - hist[hist.length - 1].at > 60_000;
          }
          return { ...n, ...patch, updatedAt: patch.updatedAt ?? now() };
        });
        if (shouldSnapshot && old) {
          const n = old as Note;
          const hist = [...(d.noteHistory[id] || [])];
          hist.push({
            id: uid('ver'), at: now(), title: n.title, content: n.content, mode: n.mode,
          });
          d.noteHistory = { ...d.noteHistory, [id]: hist.slice(-MAX_VERSIONS) };
        }
      });
    },

    patchNotes(ids, patch) {
      if (!ids.length) return;
      mutate((d) => touch(d, ids, patch));
    },

    toggleFlag(id, key) {
      mutate((d) => {
        d.notes = d.notes.map((n) =>
          n.id === id ? { ...n, [key]: !n[key], updatedAt: now() } : n
        );
      });
    },

    moveNotes(ids, notebookId) {
      if (!ids.length) return;
      mutate((d) => touch(d, ids, { notebookId }));
      toast(`已移动 ${ids.length} 篇笔记`);
    },

    addTagTo(ids, tag) {
      const clean = tag.trim().replace(/^#/, '');
      if (!clean || !ids.length) return;
      const set = new Set(ids);
      mutate((d) => {
        d.notes = d.notes.map((n) =>
          set.has(n.id) && !n.tags.includes(clean)
            ? { ...n, tags: [...n.tags, clean], updatedAt: now() }
            : n
        );
      });
      toast(`已给 ${ids.length} 篇笔记加标签「${clean}」`);
    },

    removeTagFromAll(tag) {
      mutate((d) => {
        d.notes = d.notes.map((n) =>
          n.tags.includes(tag) ? { ...n, tags: n.tags.filter((t) => t !== tag), updatedAt: now() } : n
        );
      });
      toast(`已移除标签「${tag}」`);
    },

    renameTagEverywhere(oldTag, newTag) {
      const clean = newTag.trim().replace(/^#/, '');
      if (!clean) return;
      mutate((d) => {
        d.notes = d.notes.map((n) =>
          n.tags.includes(oldTag)
            ? { ...n, tags: Array.from(new Set(n.tags.map((t) => (t === oldTag ? clean : t)))), updatedAt: now() }
            : n
        );
      });
      toast(`标签已改为「${clean}」`);
    },

    trash(ids) {
      if (!ids.length) return;
      mutate((d) => touch(d, ids, { trashed: true, trashedAt: now(), pinned: false }));
      setSelectedIds([]);
      toast(`已把 ${ids.length} 篇笔记移进回收站`);
    },

    restore(ids) {
      if (!ids.length) return;
      mutate((d) => touch(d, ids, { trashed: false, trashedAt: null }));
      setSelectedIds([]);
      toast(`已恢复 ${ids.length} 篇笔记`);
    },

    purge(ids) {
      if (!ids.length) return;
      const set = new Set(ids);
      mutate((d) => { d.notes = d.notes.filter((n) => !set.has(n.id)); });
      setSelectedIds([]);
      toast(`已彻底删除 ${ids.length} 篇笔记`);
    },

    emptyTrash() {
      mutate((d) => { d.notes = d.notes.filter((n) => !n.trashed); });
      toast('回收站已清空');
    },

    switchMode(id, mode) {
      let changed = false;
      mutate((d) => {
        d.notes = d.notes.map((n) => {
          if (n.id !== id || n.mode === mode) return n;
          changed = true;
          return { ...n, content: convertContent(n.content, n.mode, mode, n.attachments || []), mode, updatedAt: now() };
        });
      });
      if (changed) toast(mode === 'markdown' ? '已切换到 Markdown' : '已切换到富文本');
    },

    addNotebook(name, groupId = null) {
      const id = uid('nb');
      mutate((d) => {
        d.notebooks.push({
          id,
          name: name.trim() || '新笔记本',
          groupId,
          color: PALETTE[d.notebooks.length % PALETTE.length],
          createdAt: now(),
        });
      });
      return id;
    },

    updateNotebook(id, patch) {
      mutate((d) => {
        d.notebooks = d.notebooks.map((nb) => (nb.id === id ? { ...nb, ...patch } : nb));
      });
    },

    deleteNotebook(id, moveNotesToTrash = false) {
      mutate((d) => {
        d.notebooks = d.notebooks.filter((nb) => nb.id !== id);
        d.notes = d.notes.map((n) =>
          n.notebookId === id
            ? moveNotesToTrash
              ? { ...n, trashed: true, trashedAt: now(), notebookId: null }
              : { ...n, notebookId: null }
            : n
        );
        if (d.settings.defaultNotebookId === id) d.settings.defaultNotebookId = null;
      });
      toast(moveNotesToTrash ? '笔记本已删除，里面的笔记进了回收站' : '笔记本已删除，笔记保留为「未分类」');
    },

    addGroup(name) {
      const id = uid('grp');
      mutate((d) => {
        d.groups.push({ id, name: name.trim() || '新笔记本组', collapsed: false, createdAt: now() });
      });
      return id;
    },

    updateGroup(id, patch) {
      mutate((d) => {
        d.groups = d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g));
      });
    },

    deleteGroup(id) {
      mutate((d) => {
        d.groups = d.groups.filter((g) => g.id !== id);
        d.notebooks = d.notebooks.map((nb) => (nb.groupId === id ? { ...nb, groupId: null } : nb));
      });
      toast('笔记本组已删除，组内笔记本保留');
    },

    addTemplate(name, content, icon = 'custom') {
      mutate((d) => {
        d.templates.push({ id: uid('tpl'), name: name.trim() || '新模板', icon, content, builtin: false, createdAt: now() });
      });
      toast('模板已保存');
    },

    deleteTemplate(id) {
      mutate((d) => { d.templates = d.templates.filter((t) => t.id !== id); });
    },

    setSettings(patch) {
      mutate((d) => { d.settings = { ...d.settings, ...patch }; });
    },

    toggleShortcut(kind, refId, label) {
      let added = false;
      mutate((d) => {
        const hit = d.shortcuts.find((s) => s.kind === kind && s.refId === refId);
        if (hit) d.shortcuts = d.shortcuts.filter((s) => s.id !== hit.id);
        else {
          added = true;
          d.shortcuts = [...d.shortcuts, { id: uid('sc'), kind, refId, label, createdAt: now() }];
        }
      });
      toast(added ? `已把「${label}」加进快捷方式` : '已取消固定');
    },

    removeShortcut(id) {
      mutate((d) => { d.shortcuts = d.shortcuts.filter((s) => s.id !== id); });
    },

    addSavedSearch(name, query) {
      const id = uid('ss');
      mutate((d) => {
        d.savedSearches = [
          ...d.savedSearches,
          { id, name: name.trim() || query, query, createdAt: now() },
        ];
      });
      toast('搜索已保存，可在侧栏快捷方式区找到');
      return id;
    },

    removeSavedSearch(id) {
      mutate((d) => {
        d.savedSearches = d.savedSearches.filter((s) => s.id !== id);
        d.shortcuts = d.shortcuts.filter((s) => !(s.kind === 'search' && s.refId === id));
      });
    },

    rememberSearch(q) {
      const clean = q.trim();
      if (!clean) return;
      mutate((d) => {
        d.recentSearches = [clean, ...d.recentSearches.filter((s) => s !== clean)].slice(0, 12);
      });
    },

    setSticky(text) {
      mutate((d) => { d.sticky = text; });
    },

    setSidebarSection(key, visible) {
      mutate((d) => { d.sidebarSections = { ...d.sidebarSections, [key]: visible }; });
    },

    snapshot(noteId) {
      mutate((d) => {
        const n = d.notes.find((x) => x.id === noteId);
        if (!n) return;
        const hist = [...(d.noteHistory[noteId] || [])];
        hist.push({ id: uid('ver'), at: now(), title: n.title, content: n.content, mode: n.mode });
        d.noteHistory = { ...d.noteHistory, [noteId]: hist.slice(-MAX_VERSIONS) };
      });
      toast('已保存一个版本');
    },

    restoreVersion(noteId, versionId) {
      mutate((d) => {
        const ver = (d.noteHistory[noteId] || []).find((v) => v.id === versionId);
        const cur = d.notes.find((n) => n.id === noteId);
        if (!ver || !cur) return;
        const hist = [...(d.noteHistory[noteId] || [])];
        hist.push({ id: uid('ver'), at: now(), title: cur.title, content: cur.content, mode: cur.mode });
        d.noteHistory = { ...d.noteHistory, [noteId]: hist.slice(-MAX_VERSIONS) };
        d.notes = d.notes.map((n) =>
          n.id === noteId
            ? { ...n, title: ver.title, content: ver.content, mode: ver.mode, updatedAt: now() }
            : n
        );
      });
      toast('已恢复到该版本（当前内容也留了快照）');
    },

    clearHistory(noteId) {
      mutate((d) => {
        const next = { ...d.noteHistory };
        delete next[noteId];
        d.noteHistory = next;
      });
      toast('已清空这篇笔记的历史');
    },

    pruneAttachments(noteId, attIds) {
      if (!attIds.length) return;
      const set = new Set(attIds);
      mutate((d) => {
        d.notes = d.notes.map((n) =>
          n.id === noteId
            ? { ...n, attachments: (n.attachments || []).filter((a) => !set.has(a.id)) }
            : n
        );
      });
    },

    importNotes(notes) {
      mutate((d) => {
        const incoming = notes.map((n) => ({ ...n, id: uid('note') }));
        d.notes = [...incoming, ...d.notes];
      });
      toast(`已导入 ${notes.length} 篇笔记`);
    },

    replaceWorkspace(ws) {
      mutate((d) => {
        d.notes = ws.notes ?? [];
        d.notebooks = ws.notebooks ?? [];
        d.groups = ws.groups ?? [];
        d.templates = ws.templates?.length ? ws.templates : d.templates;
        d.settings = { ...d.settings, ...(ws.settings ?? {}) };
        d.shortcuts = ws.shortcuts ?? [];
        d.savedSearches = ws.savedSearches ?? [];
        d.recentSearches = ws.recentSearches ?? [];
        d.noteHistory = ws.noteHistory ?? {};
        d.sidebarSections = ws.sidebarSections ?? d.sidebarSections;
        d.sticky = ws.sticky ?? '';
        d.version = ws.version ?? d.version;
      });
      setActiveId(null);
      setSelectedIds([]);
      toast('备份已恢复');
    },

    saveNow,
  };
}
