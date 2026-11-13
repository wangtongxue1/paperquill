import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell, Braces, CircleHelp, FileDown, Home, ListFilter, Maximize2, Minimize2, Minus, Moon,
  PanelLeftOpen, Plus, Scissors, Search, Settings2, Sun, Wand2, X,
} from 'lucide-react';
import { AppContext } from './context';
import type { DialogKind, DialogState } from './context';
import { createActions } from './actions';
import { seedWorkspace } from './data';
import { matchFilters, parseQuery, searchNotes } from './search';
import { isDesktop, storage, wasLastLoadUpgraded, windowAction } from './storage';
import { FULL_VIEW_KINDS } from './types';
import type { NavSelection, Note, Workspace } from './types';
import { wordCount, plainOf } from './utils';
import Sidebar from './components/Sidebar';
import NoteList from './components/NoteList';
import Editor from './components/Editor';
import DialogHost from './components/Dialogs';
import WorkspaceView from './components/WorkspaceView';
import { IconBtn, ToastHost } from './components/Common';
import type { ToastItem } from './components/Common';
import BrandMark from './components/BrandMark';

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export default function App() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const wsRef = useRef<Workspace | null>(null);
  // 和印象笔记一样，冷启动落在首页（仪表盘），而不是空荡荡的列表。
  const [nav, setNav] = useState<NavSelection>({ kind: 'home' });
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogState>({ kind: null });
  // 2.5.10：通知统一走「顶部中间」的队列，多条同时存在、各自计时，
  // 新通知不再把上一条直接顶掉，也不会被弹窗 / 菜单盖住。
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [dataDir, setDataDir] = useState('');
  const [tick, setTick] = useState(0);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderPos, setReminderPos] = useState({ top: 56, left: 0 });
  const searchRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const toastTimers = useRef<Map<number, number>>(new Map());
  const bellRef = useRef<HTMLDivElement>(null);

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, msg, kind }]);   // 最多同时 3 条
    const timer = window.setTimeout(() => {
      toastTimers.current.delete(id);
      setToasts((list) => list.filter((x) => x.id !== id));
    }, 2800);
    toastTimers.current.set(id, timer);
  }, []);

  useEffect(() => () => {
    toastTimers.current.forEach((t) => window.clearTimeout(t));
    toastTimers.current.clear();
  }, []);

  /** 铃铛弹窗锚到按钮下方；用 portal 挂 body，绕开 .titlebar 的 overflow:hidden 裁切。 */
  const toggleReminder = () => {
    if (!reminderOpen && bellRef.current) {
      const r = bellRef.current.getBoundingClientRect();
      const barBottom = document.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? 52;
      const width = 280;
      setReminderPos({
        // 一定落在标题栏下方，避免弹窗顶部和工具栏贴边 / 被视觉遮挡
        top: Math.max(r.bottom + 8, barBottom + 8),
        left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 12)),
      });
    }
    setReminderOpen(!reminderOpen);
  };

  const scheduleSave = useCallback((next: Workspace) => {
    setSaveState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      saveTimer.current = null;
      try { await storage.save(next); setSaveState('saved'); }
      catch (e) { setSaveState('error'); showToast(`保存失败：${String(e)}`, 'err'); }
    }, 350);
  }, [showToast]);

  /** 同步改 wsRef，再发布给 React：连续两次 mutate 不会丢前一次的改动。 */
  const mutate = useCallback((fn: (draft: Workspace) => void) => {
    const prev = wsRef.current;
    if (!prev) return;
    const next: Workspace = {
      ...prev,
      notes: [...prev.notes],
      notebooks: [...prev.notebooks],
      groups: [...prev.groups],
      templates: [...prev.templates],
      settings: { ...prev.settings },
      shortcuts: [...(prev.shortcuts || [])],
      savedSearches: [...(prev.savedSearches || [])],
      recentSearches: [...(prev.recentSearches || [])],
      noteHistory: { ...(prev.noteHistory || {}) },
      sidebarSections: { ...prev.sidebarSections },
      sticky: prev.sticky ?? '',
      updatedAt: Date.now(),
    };
    fn(next);
    wsRef.current = next;
    setWs(next);
    scheduleSave(next);
  }, [scheduleSave]);

  const saveNow = useCallback(async () => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (wsRef.current) {
      await storage.save(wsRef.current);
      setSaveState('saved');
    }
  }, []);

  const openDialog = useCallback((kind: DialogKind, payload?: any) => setDialog({ kind, payload }), []);
  const closeDialog = useCallback(() => setDialog({ kind: null }), []);

  const actions = useMemo(() => createActions({
    mutate, toast: showToast, setActiveId, setNav, setSelectedIds, saveNow,
  }), [mutate, showToast, setActiveId, setNav, setSelectedIds, saveNow]);

  /* ---------- 拖动分隔条调整侧栏 / 列表宽度 ---------- */
  const dragRef = useRef<{ kind: 'sidebar' | 'list'; startX: number; startW: number } | null>(null);
  const startDrag = (kind: 'sidebar' | 'list', e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      kind,
      startX: e.clientX,
      startW: kind === 'sidebar'
        ? (wsRef.current?.settings.sidebarWidth ?? 248)
        : (wsRef.current?.settings.listWidth ?? 330),
    };
    document.body.classList.add('is-resizing');
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = d.startW + (e.clientX - d.startX);
      if (d.kind === 'sidebar') actions.setSettings({ sidebarWidth: Math.max(180, Math.min(380, next)) });
      else actions.setSettings({ listWidth: Math.max(260, Math.min(560, next)) });
    };
    const up = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.classList.remove('is-resizing');
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [actions]);

  /* ---------- 启动：载入存档，首次运行给示例内容 ---------- */
  useEffect(() => {
    void (async () => {
      let loaded: Workspace | null = null;
      try {
        loaded = await storage.load();
      } catch (e) {
        // 存档损坏时绝不 seed、绝不写盘，否则会用示例数据覆盖用户的笔记。
        setFatalError(String(e));
        return;
      }
      const initial = loaded ?? seedWorkspace();
      wsRef.current = initial;
      setWs(initial);
      if (!loaded) { try { await storage.save(initial); } catch { /* 浏览器隐私模式 */ } }
      else if (wasLastLoadUpgraded()) {
        // 存档格式升级：把 migrate 补齐的新字段写回磁盘一次，保证磁盘契约与内存一致。
        // 只在版本变化时写，且 load 成功才走到这里；损坏档在上面已经 return，绝不写盘。
        try { await storage.save(initial); } catch { /* 下次启动会再试 */ }
      }
      try { setDataDir(await storage.dataDir()); } catch { /* 忽略 */ }
    })();
  }, [showToast]);

  /* ---------- 无头截图验收钩子：只有 URL 带参数时生效，不影响正常使用 ---------- */
  useEffect(() => {
    if (!ws) return;
    const p = new URLSearchParams(window.location.search);
    if (p.has('q')) setQuery(p.get('q') || '');
    const t = p.get('theme');
    if (t === 'dark' || t === 'light' || t === 'system') actions.setSettings({ theme: t });
    const view = p.get('view');
    if (view === 'card') actions.setSettings({ view: 'card' });
    if (view && (FULL_VIEW_KINDS as readonly string[]).includes(view)) setNav({ kind: view } as NavSelection);
    if (p.has('nav') && p.get('nav') === 'all') setNav({ kind: 'all' });
    const d = p.get('dialog');
    if (d) openDialog(d as DialogKind);
    const idx = p.get('note');
    if (idx !== null) {
      const n = wsRef.current?.notes[Number(idx) || 0];
      if (n) setActiveId(n.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws !== null]);

  /* ---------- 关窗前尽力再写一次盘 ---------- */
  useEffect(() => {
    const onUnload = () => { if (wsRef.current) void storage.save(wsRef.current); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  /* ---------- 主题 ---------- */
  useEffect(() => {
    if (!ws) return;
    const apply = () => {
      const t = ws.settings.theme;
      const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [ws?.settings.theme]);

  /* ---------- 保存的搜索：切过去时把查询同步到顶部输入框 ---------- */
  useEffect(() => {
    if (!ws || nav.kind !== 'savedSearch') return;
    const s = ws.savedSearches.find((x) => x.id === nav.id);
    if (s) setQuery(s.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, ws?.savedSearches]);

  /* ---------- 当前导航 + 高级搜索 + 排序 ---------- */
  const visibleNotes = useMemo(() => {
    if (!ws) return [];
    const nbName = (id: string | null) => ws.notebooks.find((n) => n.id === id)?.name || '未分类';
    const saved = nav.kind === 'savedSearch'
      ? ws.savedSearches.find((s) => s.id === nav.id)?.query
      : undefined;
    const rawQuery = saved ?? query;
    const parsed = parseQuery(rawQuery);
    const q = parsed.text;
    const fullView = (FULL_VIEW_KINDS as readonly string[]).includes(nav.kind);
    const base = ws.notes.filter((n) => {
      if (fullView || nav.kind === 'savedSearch') return !n.trashed;
      if (nav.kind === 'trash') return n.trashed;
      if (n.trashed) return false;
      switch (nav.kind) {
        case 'all': return true;
        case 'favorites': return n.favorite;
        case 'pinned': return n.pinned;
        case 'reminders': return !!n.reminderAt && !n.reminderDone;
        case 'untagged': return n.tags.length === 0;
        case 'notebook': return n.notebookId === nav.id;
        case 'tag': return n.tags.includes(nav.name);
        default: return true;
      }
    }).filter((n) => matchFilters(n, parsed, nbName));
    const hits = searchNotes(base, q);
    const arr = hits.map((h) => h.note);
    if (!q && !parsed.filters.length) {
      const sort = ws.settings.sort;
      arr.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        switch (sort) {
          case 'created': return b.createdAt - a.createdAt;
          case 'title': return (a.title || '未命名笔记').localeCompare(b.title || '未命名笔记', 'zh');
          case 'reminder': return (a.reminderAt ?? Infinity) - (b.reminderAt ?? Infinity) || b.updatedAt - a.updatedAt;
          default: return b.updatedAt - a.updatedAt;
        }
      });
    }
    return arr;
  }, [ws, nav, query]);

  const fullView = (FULL_VIEW_KINDS as readonly string[]).includes(nav.kind);
  const taskCount = ws ? ws.notes.filter((n) => !n.trashed).reduce((s, n) =>
    s + (n.content.match(n.mode === 'rich'
      ? /<input\b[^>]*type=["']?checkbox/gi : /^\s*[-*+]\s+\[[ xX]\]/gm) || []).length, 0) : 0;
  const fileCount = ws ? ws.notes.filter((n) => !n.trashed).reduce((s, n) => s + (n.attachments?.length || 0), 0) : 0;

  /* ---------- 提醒轮询（每 30 秒） ---------- */
  const dueReminders = useMemo(() => {
    if (!ws) return [];
    return ws.notes
      .filter((n) => !n.trashed && n.reminderAt && !n.reminderDone && n.reminderAt <= Date.now())
      .sort((a, b) => (a.reminderAt || 0) - (b.reminderAt || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, tick]);
  const notified = useRef<Set<string>>(new Set());
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const fresh = dueReminders.filter((n) => !notified.current.has(n.id));
    if (fresh.length) {
      fresh.forEach((n) => notified.current.add(n.id));
      showToast(`有 ${fresh.length} 条提醒到期：${fresh[0].title || '未命名笔记'}`, 'ok');
    }
  }, [dueReminders, showToast]);

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (reminderOpen) setReminderOpen(false);
        else if (dialog.kind) closeDialog();
        else if (selectedIds.length) setSelectedIds([]);
        return;
      }
      if (!mod) return;
      if (k === 'n') { e.preventDefault(); actions.createNote(); }
      else if (k === 's') { e.preventDefault(); void saveNow().then(() => showToast('已保存到本机')); }
      else if (k === 'f') {
        e.preventDefault();
        // Ctrl+Shift+F 始终是「搜所有笔记」；单独 Ctrl+F 在编辑笔记时交给
        // 编辑器内的查找 / 替换条（Editor 会 preventDefault 表示已接管）。
        if (e.shiftKey) { openDialog('search'); return; }
        const ev = new CustomEvent('zhijian:editor-find', { detail: { replace: false }, cancelable: true });
        if (window.dispatchEvent(ev)) openDialog('search');
      }
      else if (k === 'h') {
        e.preventDefault();
        const ev = new CustomEvent('zhijian:editor-find', { detail: { replace: true }, cancelable: true });
        if (window.dispatchEvent(ev)) openDialog('findReplace');
      }
      else if (k === 'g') { e.preventDefault(); setNav({ kind: 'home' }); }
      else if (e.shiftKey && k === 's') { e.preventDefault(); openDialog('saveSearch'); }
      else if (k >= '1' && k <= '5' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setNav({ kind: FULL_VIEW_KINDS[Number(k) - 1] } as NavSelection);
      }
      else if (e.shiftKey && k === 't') { e.preventDefault(); openDialog('templates'); }
      else if (e.shiftKey && k === 'c') { e.preventDefault(); openDialog('clip'); }
      else if (e.shiftKey && k === 'e') { e.preventDefault(); openDialog('io'); }
      else if (k === 'a' && !isTypingTarget(e.target)) { e.preventDefault(); setSelectedIds(visibleNotes.map((n) => n.id)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, closeDialog, dialog.kind, openDialog, reminderOpen, saveNow, selectedIds.length, setNav, showToast, visibleNotes]);

  /* ---------- 窗口按钮 ---------- */
  const winAction = async (action: 'min' | 'max' | 'close') => {
    if (!isDesktop()) return;
    try { await windowAction(action); } catch { /* 浏览器预览模式 */ }
  };

  const totalWords = useMemo(
    () => (ws ? ws.notes.filter((n) => !n.trashed).reduce((s, n) => s + wordCount(plainOf(n)), 0) : 0),
    [ws]
  );
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';

  if (fatalError) {
    return (
      <div className="boot">
        <BrandMark className="boot__logo" size={52} radius={27} title="纸间笔记" />
        <h2 style={{ margin: '8px 0 0', fontSize: 17, fontWeight: 600 }}>存档读取失败，已停止写入</h2>
        <p style={{ maxWidth: 460, textAlign: 'center', lineHeight: 1.8 }}>
          为避免覆盖你的笔记，纸间笔记没有创建新存档，也没有向磁盘写入任何内容。请先备份数据目录里的 workspace.json。
        </p>
        <code style={{ fontSize: 12, opacity: .7 }}>{fatalError}</code>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>重试</button>
          <button className="btn btn--ghost" onClick={() => void storage.openDataDir()}>打开数据目录</button>
        </div>
      </div>
    );
  }

  if (!ws) {
    return <div className="boot"><BrandMark className="boot__logo" size={52} radius={27} title="纸间笔记" /><p>正在打开你的笔记…</p></div>;
  }

  const ctx = {
    ws, nav, setNav, query, setQuery, activeId, setActiveId, selectedIds, setSelectedIds,
    actions, toast: showToast, dialog, openDialog, closeDialog, dataDir, saveState,
    visibleNotes, dueReminders, desktop: isDesktop(),
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="titlebar" data-tauri-drag-region>
          <div className="titlebar__brand" data-tauri-drag-region>
            {ws.settings.sidebarCollapsed && (
              <IconBtn title="展开侧栏" onClick={() => actions.setSettings({ sidebarCollapsed: false })}>
                <PanelLeftOpen size={17} />
              </IconBtn>
            )}
            <BrandMark className="logo" size={30} title="纸间笔记" />
            <div className="titlebar__brandtext"><strong>纸间笔记</strong><span>本地笔记</span></div>
          </div>

          <div className="titlebar__search">
            <Search size={16} />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、正文、标签…  支持 tag: has: 语法 · Ctrl+F" />
            {query && <button onClick={() => setQuery('')} title="清空搜索"><X size={14} /></button>}
          </div>
          <IconBtn title="高级搜索 / 搜索语法 (Ctrl+F)" onClick={() => openDialog('search')}><ListFilter size={16} /></IconBtn>

          <div className="titlebar__acts">
            <IconBtn title="首页 (Ctrl+G)" active={nav.kind === 'home'} onClick={() => setNav({ kind: 'home' })}><Home size={17} /></IconBtn>
            <IconBtn title="新建笔记 (Ctrl+N)" onClick={() => actions.createNote()}><Plus size={18} /></IconBtn>
            <IconBtn title="从模板新建 (Ctrl+Shift+T)" onClick={() => openDialog('templates')}><Wand2 size={16} /></IconBtn>
            <IconBtn title="网页剪藏 (Ctrl+Shift+C)" onClick={() => openDialog('clip')}><Scissors size={16} /></IconBtn>
            <IconBtn title="导入导出 (Ctrl+Shift+E)" onClick={() => openDialog('io')}><FileDown size={16} /></IconBtn>
            <div className="titlebar__sep" />
            <div className="reminder-wrap" ref={bellRef}>
              <IconBtn title="到期提醒" active={dueReminders.length > 0} onClick={toggleReminder}>
                <Bell size={16} />
                {dueReminders.length > 0 && <i className="badge">{dueReminders.length}</i>}
              </IconBtn>
              {reminderOpen && createPortal(
                <>
                  <div className="menu-dismiss" onMouseDown={(e) => {
                    // 点铃铛本身交给 onClick 切换，避免「先关后开」导致关不掉
                    if ((e.target as HTMLElement).closest('.reminder-wrap')) return;
                    setReminderOpen(false);
                  }} />
                  <div className="reminder-pop reminder-pop--fixed"
                    style={{ top: reminderPos.top, left: reminderPos.left }}>
                    <strong>到期提醒</strong>
                    {dueReminders.length === 0 && <p>没有到期的提醒。</p>}
                    {dueReminders.map((n) => (
                      <button key={n.id} onClick={() => { setActiveId(n.id); setNav({ kind: 'all' }); setReminderOpen(false); }}>
                        <Bell size={14} /><span>{n.title || '未命名笔记'}</span>
                        <IconBtn title="标记完成" onClick={(e) => { e.stopPropagation(); actions.updateNote(n.id, { reminderDone: true }); }}>
                          <X size={13} />
                        </IconBtn>
                      </button>
                    ))}
                  </div>
                </>, document.body)}
            </div>
            <IconBtn title={dark ? '切到浅色' : '切到深色'} onClick={() => actions.setSettings({ theme: dark ? 'light' : 'dark' })}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </IconBtn>
            <IconBtn title="设置" onClick={() => openDialog('settings')}><Settings2 size={16} /></IconBtn>
            <IconBtn title="关于与快捷键" onClick={() => openDialog('about')}><CircleHelp size={16} /></IconBtn>
            {isDesktop() && <>
              <div className="titlebar__sep" />
              <div className="titlebar__win">
                <button title="最小化" onClick={() => void winAction('min')}><Minus size={15} /></button>
                <button title="最大化" onClick={() => void winAction('max')}><Maximize2 size={14} /></button>
                <button className="is-close" title="关闭" onClick={() => void winAction('close')}><X size={15} /></button>
              </div>
            </>}
          </div>
        </header>

        <div className="app__body">
          {ws.settings.sidebarCollapsed ? (
            <div className="sidebar-rail" />
          ) : (
            <>
              <Sidebar />
              <div className="splitter" title="拖动调整侧栏宽度" onMouseDown={(e) => startDrag('sidebar', e)} />
            </>
          )}
          {fullView ? (
            <WorkspaceView />
          ) : (
            <>
              <NoteList />
              <div className="splitter" title="拖动调整列表宽度" onMouseDown={(e) => startDrag('list', e)} />
              <Editor />
            </>
          )}
        </div>

        <footer className="statusbar">
          <span><strong>{ws.notes.filter((n) => !n.trashed).length}</strong> 篇笔记</span>
          <span><strong>{totalWords.toLocaleString('zh-CN')}</strong> 字</span>
          <span>{ws.notebooks.length} 个笔记本</span>
          <span><strong>{taskCount}</strong> 项待办</span>
          <span><strong>{fileCount}</strong> 个附件</span>
          <span className="statusbar__spacer" />
          <span className={`statusbar__save statusbar__save--${saveState}`}>
            {saveState === 'saved' ? '已存到本机' : saveState === 'saving' ? '正在保存…' : '保存失败'}
          </span>
          <span className="statusbar__dir" title={dataDir}><Braces size={12} /> {dataDir || '浏览器本地存储'}</span>
        </footer>

        <DialogHost />
        <ToastHost items={toasts} onClose={dismissToast} />
      </div>
    </AppContext.Provider>
  );
}
