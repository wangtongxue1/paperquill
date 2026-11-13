import { useMemo, useState } from 'react';
import {
  Archive, Bell, BookOpen, CalendarDays, ChevronDown, ChevronRight, Database, FileText,
  Folder, FolderPlus, FolderTree, Hash, Home, LayoutTemplate, ListTodo, MoreHorizontal,
  Paperclip, PanelLeftClose, Pin, Plus, Search, Settings2, Star, Tag, Trash2, Wand2, X,
} from 'lucide-react';
import { useApp } from '../context';
import type { NavSelection, SidebarSections } from '../types';
import { storage } from '../storage';
import { IconBtn, Menu, type MenuItem } from './Common';

const PALETTE = ['#2F8F68', '#3B7DD8', '#C97A2B', '#8A63C9', '#C0506B', '#3E9CA8', '#8B8F45'];

const SECTION_LABELS: { key: keyof SidebarSections; label: string }[] = [
  { key: 'home', label: '首页' },
  { key: 'notes', label: '全部笔记 / 收藏 / 置顶 / 提醒' },
  { key: 'shortcuts', label: '快捷方式与保存的搜索' },
  { key: 'tasks', label: '任务' },
  { key: 'files', label: '文件' },
  { key: 'calendar', label: '日历' },
  { key: 'templates', label: '模板' },
  { key: 'notebooks', label: '笔记本' },
  { key: 'tags', label: '标签' },
  { key: 'trash', label: '回收站' },
];

export default function Sidebar() {
  const { ws, nav, setNav, actions, openDialog, toast, dataDir, setActiveId } = useApp();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [collapsedTags, setCollapsedTags] = useState<Set<string>>(new Set());
  const [createMenu, setCreateMenu] = useState(false);

  const live = ws.notes.filter((n) => !n.trashed);
  const sections = ws.sidebarSections;
  const count = {
    all: live.length,
    favorites: live.filter((n) => n.favorite).length,
    pinned: live.filter((n) => n.pinned).length,
    reminders: live.filter((n) => n.reminderAt && !n.reminderDone).length,
    trash: ws.notes.filter((n) => n.trashed).length,
    untagged: live.filter((n) => n.tags.length === 0).length,
    tasks: live.reduce((s, n) => s + (n.content.match(n.mode === 'rich'
      ? /<input\b[^>]*type=["']?checkbox/gi : /^\s*[-*+]\s+\[[ xX]\]/gm) || []).length, 0),
    files: live.reduce((s, n) => s + (n.attachments?.length || 0), 0),
    templates: ws.templates.length,
  };
  const tags = Array.from(new Set(live.flatMap((n) => n.tags))).sort((a, b) => a.localeCompare(b, 'zh'));
  const tagGroups = useMemo(() => {
    const flat: string[] = [];
    const groups = new Map<string, string[]>();
    for (const t of tags) {
      const i = t.indexOf('/');
      if (i > 0) {
        const p = t.slice(0, i);
        groups.set(p, [...(groups.get(p) || []), t]);
      } else flat.push(t);
    }
    return { flat, groups: Array.from(groups.entries()) };
  }, [tags.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (n: NavSelection) => { setNav(n); setActiveId(null); };
  const isActive = (n: NavSelection) =>
    n.kind === nav.kind && ('id' in n ? (nav as any).id === n.id : true) && ('name' in n ? (nav as any).name === n.name : true);

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const shortcutItem = (kind: 'note' | 'notebook' | 'tag' | 'search', refId: string, label: string): MenuItem => {
    const pinned = ws.shortcuts.some((s) => s.kind === kind && s.refId === refId);
    return {
      label: pinned ? '从快捷方式移除' : '添加到快捷方式', icon: <Star size={14} />,
      onClick: () => actions.toggleShortcut(kind, refId, label),
    };
  };

  const notebookMenu = (e: React.MouseEvent, id: string, name: string) =>
    openMenu(e, [
      { label: '重命名', icon: <FileText size={14} />, onClick: () =>
        openDialog('prompt', { title: '重命名笔记本', label: '名称', value: name,
          onConfirm: (v: string) => actions.updateNotebook(id, { name: v }) }) },
      { label: '换个颜色', icon: <Tag size={14} />, onClick: () => {
        const nb = ws.notebooks.find((n) => n.id === id);
        const i = PALETTE.indexOf(nb?.color || '');
        actions.updateNotebook(id, { color: PALETTE[(i + 1) % PALETTE.length] });
      } },
      shortcutItem('notebook', id, name),
      { label: '移到组…', icon: <FolderTree size={14} />, onClick: () => openDialog('move', { kind: 'notebook', id }) },
      { label: '', divider: true },
      { label: '删除笔记本', icon: <Trash2 size={14} />, danger: true, onClick: () =>
        openDialog('confirm', {
          title: `删除「${name}」？`,
          message: '里面的笔记不会被删掉，会变成「未分类」；也可以选择连同笔记一起移进回收站。',
          choices: [
            { label: '只删笔记本，保留笔记', value: 'keep', onConfirm: () => actions.deleteNotebook(id, false) },
            { label: '连同笔记移进回收站', value: 'trash', danger: true, onConfirm: () => actions.deleteNotebook(id, true) },
          ],
        }) },
    ]);

  const groupMenu = (e: React.MouseEvent, id: string, name: string) =>
    openMenu(e, [
      { label: '重命名', icon: <FileText size={14} />, onClick: () =>
        openDialog('prompt', { title: '重命名笔记本组', label: '名称', value: name,
          onConfirm: (v: string) => actions.updateGroup(id, { name: v }) }) },
      { label: '在组内新建笔记本', icon: <FolderPlus size={14} />, onClick: () =>
        openDialog('prompt', { title: '新建笔记本', label: '名称', placeholder: '例如：项目资料',
          onConfirm: (v: string) => actions.addNotebook(v, id) }) },
      { label: '', divider: true },
      { label: '删除组', icon: <Trash2 size={14} />, danger: true, onClick: () =>
        openDialog('confirm', { title: `删除组「${name}」？`, message: '组内的笔记本会保留，只是变成未分组。',
          confirmLabel: '删除组', danger: true, onConfirm: () => actions.deleteGroup(id) }) },
    ]);

  const tagMenu = (e: React.MouseEvent, tag: string) =>
    openMenu(e, [
      shortcutItem('tag', tag, `# ${tag}`),
      { label: '重命名标签', icon: <FileText size={14} />, onClick: () =>
        openDialog('prompt', { title: '重命名标签', label: '新名称', value: tag,
          onConfirm: (v: string) => actions.renameTagEverywhere(tag, v) }) },
      { label: '删除这个标签', icon: <Trash2 size={14} />, danger: true, onClick: () =>
        openDialog('confirm', { title: `移除标签「${tag}」？`, message: '会从所有笔记上摘掉这个标签，笔记本身不受影响。',
          confirmLabel: '移除', danger: true, onConfirm: () => actions.removeTagFromAll(tag) }) },
    ]);

  const renderNotebook = (nb: (typeof ws.notebooks)[number], indented: boolean) => (
    <div key={nb.id}
      className={`nav-row nav-row--nb ${indented ? 'is-indented' : ''} ${isActive({ kind: 'notebook', id: nb.id }) ? 'is-active' : ''}`}
      onClick={() => go({ kind: 'notebook', id: nb.id })}
      onContextMenu={(e) => notebookMenu(e, nb.id, nb.name)}>
      <span className="nav-row__dot" style={{ background: nb.color }} />
      <span className="nav-row__label">{nb.name}</span>
      <span className="nav-row__count">{live.filter((n) => n.notebookId === nb.id).length}</span>
      <IconBtn className="nav-row__more" title="笔记本操作" onClick={(e) => notebookMenu(e, nb.id, nb.name)}>
        <MoreHorizontal size={15} />
      </IconBtn>
    </div>
  );

  const tagRow = (t: string, child = false) => (
    <button key={t} className={`nav-row ${child ? 'is-indented' : ''} ${isActive({ kind: 'tag', name: t }) ? 'is-active' : ''}`}
      onClick={() => go({ kind: 'tag', name: t })} onContextMenu={(e) => tagMenu(e, t)}>
      <Hash size={15} /><span className="nav-row__label">{child ? t.slice(t.indexOf('/') + 1) : t}</span>
      <span className="nav-row__count">{live.filter((n) => n.tags.includes(t)).length}</span>
    </button>
  );

  const ungrouped = ws.notebooks.filter((nb) => !nb.groupId || !ws.groups.some((g) => g.id === nb.groupId));
  const mainRow = (kind: NavSelection['kind'], icon: React.ReactNode, label: string, n?: number) => (
    <button className={`nav-row ${isActive({ kind } as NavSelection) ? 'is-active' : ''}`}
      onClick={() => go({ kind } as NavSelection)}>
      {icon}<span className="nav-row__label">{label}</span>
      {n !== undefined && <span className="nav-row__count">{n}</span>}
    </button>
  );

  return (
    <aside className="sidebar" style={{ width: ws.settings.sidebarWidth }}>
      <div className="sidebar__create">
        <button className="create-btn" onClick={() => actions.createNote()}><Plus size={17} /> 新建笔记</button>
        <div className="create-more">
          <IconBtn title="更多新建方式" onClick={() => setCreateMenu(!createMenu)}><ChevronDown size={15} /></IconBtn>
          {createMenu && <>
            <div className="menu-dismiss" onMouseDown={() => setCreateMenu(false)} />
            <div className="create-pop">
              <button onClick={() => { openDialog('templates'); setCreateMenu(false); }}><Wand2 size={14} /> 从模板新建</button>
              <button onClick={() => { openDialog('clip'); setCreateMenu(false); }}><BookOpen size={14} /> 网页剪藏</button>
              <button onClick={() => { openDialog('prompt', { title: '新建笔记本', label: '名称',
                onConfirm: (v: string) => actions.addNotebook(v) }); setCreateMenu(false); }}><FolderPlus size={14} /> 新建笔记本</button>
            </div>
          </>}
        </div>
      </div>

      <div className="sidebar__scroll">
        {sections.home && (
          <section className="nav-section">
            {mainRow('home', <Home size={16} />, '首页')}
          </section>
        )}

        {sections.notes && (
          <section className="nav-section">
            {mainRow('all', <FileText size={16} />, '全部笔记', count.all)}
            {mainRow('favorites', <Star size={16} />, '收藏', count.favorites)}
            {mainRow('pinned', <Pin size={16} />, '置顶', count.pinned)}
            {mainRow('reminders', <Bell size={16} />, '提醒', count.reminders)}
          </section>
        )}

        {sections.shortcuts && (
          <section className="nav-section">
            <div className="nav-section__head">
              <span>快捷方式</span>
              <IconBtn title="自定义侧栏" onClick={() => openDialog('sidebar')}><MoreHorizontal size={15} /></IconBtn>
            </div>
            {ws.shortcuts.length === 0 && ws.savedSearches.length === 0 &&
              <div className="nav-group__empty">右键笔记或标签可固定到这里</div>}
            {ws.shortcuts.map((s) => (
              <div key={s.id} className="nav-row nav-row--shortcut"
                onClick={() => {
                  if (s.kind === 'note') { setActiveId(s.refId); setNav({ kind: 'all' }); }
                  else if (s.kind === 'notebook') go({ kind: 'notebook', id: s.refId });
                  else if (s.kind === 'tag') go({ kind: 'tag', name: s.refId });
                  else go({ kind: 'savedSearch', id: s.refId });
                }}
                onContextMenu={(e) => openMenu(e, [
                  { label: '从快捷方式移除', icon: <X size={14} />, onClick: () => actions.removeShortcut(s.id) },
                ])}>
                {s.kind === 'note' ? <FileText size={15} /> : s.kind === 'notebook' ? <Folder size={15} />
                  : s.kind === 'tag' ? <Hash size={15} /> : <Search size={15} />}
                <span className="nav-row__label">{s.label}</span>
                <IconBtn className="nav-row__more" title="取消固定" onClick={(e) => { e.stopPropagation(); actions.removeShortcut(s.id); }}>
                  <X size={13} />
                </IconBtn>
              </div>
            ))}
            {ws.savedSearches.map((s) => (
              <div key={`ss-${s.id}`} className={`nav-row nav-row--shortcut ${isActive({ kind: 'savedSearch', id: s.id }) ? 'is-active' : ''}`}
                onClick={() => go({ kind: 'savedSearch', id: s.id })}
                onContextMenu={(e) => openMenu(e, [
                  { label: '删除保存的搜索', icon: <Trash2 size={14} />, danger: true, onClick: () => actions.removeSavedSearch(s.id) },
                  { label: '添加到快捷方式', icon: <Star size={14} />, onClick: () => actions.toggleShortcut('search', s.id, s.name) },
                ])}>
                <Search size={15} /><span className="nav-row__label">{s.name}</span>
              </div>
            ))}
          </section>
        )}

        {(sections.tasks || sections.files || sections.calendar || sections.templates) && (
          <section className="nav-section">
            {sections.tasks && mainRow('tasks', <ListTodo size={16} />, '任务', count.tasks)}
            {sections.files && mainRow('files', <Paperclip size={16} />, '文件', count.files)}
            {sections.calendar && mainRow('calendar', <CalendarDays size={16} />, '日历')}
            {sections.templates && mainRow('templates', <LayoutTemplate size={16} />, '模板', count.templates)}
          </section>
        )}

        {sections.notebooks && (
          <section className="nav-section">
            <div className="nav-section__head">
              <span>笔记本</span>
              <div className="nav-section__acts">
                <IconBtn title="新建笔记本" onClick={() => openDialog('prompt', {
                  title: '新建笔记本', label: '名称', placeholder: '例如：读书笔记',
                  onConfirm: (v: string) => actions.addNotebook(v),
                })}><Plus size={15} /></IconBtn>
                <IconBtn title="新建笔记本组" onClick={() => openDialog('prompt', {
                  title: '新建笔记本组', label: '名称', placeholder: '例如：工作',
                  onConfirm: (v: string) => actions.addGroup(v),
                })}><FolderPlus size={15} /></IconBtn>
              </div>
            </div>
            {ws.groups.map((g) => {
              const children = ws.notebooks.filter((nb) => nb.groupId === g.id);
              return (
                <div key={g.id} className="nav-group">
                  <div className="nav-row nav-row--group" onClick={() => actions.updateGroup(g.id, { collapsed: !g.collapsed })}
                    onContextMenu={(e) => groupMenu(e, g.id, g.name)}>
                    {g.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <FolderTree size={15} />
                    <span className="nav-row__label">{g.name}</span>
                    <IconBtn className="nav-row__more" title="组操作" onClick={(e) => groupMenu(e, g.id, g.name)}>
                      <MoreHorizontal size={15} />
                    </IconBtn>
                  </div>
                  {!g.collapsed && children.map((nb) => renderNotebook(nb, true))}
                  {!g.collapsed && children.length === 0 && <div className="nav-group__empty">还没有笔记本</div>}
                </div>
              );
            })}
            {ungrouped.map((nb) => renderNotebook(nb, false))}
            {ws.notebooks.length === 0 && <div className="nav-group__empty">点 + 建一个笔记本</div>}
          </section>
        )}

        {sections.tags && (
          <section className="nav-section">
            <div className="nav-section__head">
              <span>标签</span>
              <IconBtn title="标签管理" onClick={() => openDialog('tagManager')}><MoreHorizontal size={15} /></IconBtn>
            </div>
            {mainRow('untagged', <Archive size={16} />, '无标签', count.untagged)}
            {tagGroups.flat.map((t) => tagRow(t))}
            {tagGroups.groups.map(([parent, children]) => {
              const closed = collapsedTags.has(parent);
              return (
                <div key={parent} className="nav-taggroup">
                  <div className="nav-row nav-row--group" onClick={() => {
                    const next = new Set(collapsedTags);
                    if (closed) next.delete(parent); else next.add(parent);
                    setCollapsedTags(next);
                  }}>
                    {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <Tag size={14} /><span className="nav-row__label">{parent}</span>
                    <span className="nav-row__count">{children.length}</span>
                  </div>
                  {!closed && children.map((t) => tagRow(t, true))}
                </div>
              );
            })}
            {tags.length === 0 && <div className="nav-group__empty">给笔记加个标签试试</div>}
          </section>
        )}

        {sections.trash && (
          <section className="nav-section">
            {mainRow('trash', <Trash2 size={16} />, '回收站', count.trash)}
          </section>
        )}
      </div>

      <div className="sidebar__foot">
        <div className="datadir" title={dataDir}><Database size={14} /><span>{dataDir || '本地存储'}</span></div>
        <div className="sidebar__foot-acts">
          <button onClick={() => openDialog('sidebar')} title="自定义侧栏"><Settings2 size={14} /> 自定义侧栏</button>
          <button onClick={async () => {
            try { await storage.openDataDir(); }
            catch { toast('浏览器预览模式没有磁盘目录，导出请用「导入导出」', 'err'); }
          }} title="打开数据目录">打开目录</button>
          <button onClick={() => actions.setSettings({ sidebarCollapsed: true })} title="收起侧栏"><PanelLeftClose size={15} /></button>
        </div>
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

export { SECTION_LABELS };
