import { useRef, useState } from 'react';
import {
  ArrowUpDown, Bell, CheckSquare, FileDown, FileText, LayoutGrid, LayoutList,
  MoreHorizontal, Paperclip, Pin, Plus, SearchX, Star, Tag, Trash2, RotateCcw,
  Copy, FolderInput, X, Archive, Info, History, Bookmark, Link2, FileSearch,
} from 'lucide-react';
import { useApp } from '../context';
import type { Note, NavSelection, SortKey } from '../types';
import { excerpt, plainOf, relativeTime } from '../utils';
import { highlight } from '../search';
import { thumbnailOf } from '../tasks';
import { Btn, Empty, IconBtn, Menu, type MenuItem } from './Common';

function navTitle(nav: NavSelection, ctx: { notebookName?: string; savedName?: string }): string {
  switch (nav.kind) {
    case 'home': return '首页';
    case 'tasks': return '任务';
    case 'files': return '文件';
    case 'calendar': return '日历';
    case 'templates': return '模板';
    case 'savedSearch': return ctx.savedName || '保存的搜索';
    case 'all': return '全部笔记';
    case 'favorites': return '收藏';
    case 'pinned': return '置顶';
    case 'reminders': return '提醒';
    case 'trash': return '回收站';
    case 'untagged': return '无标签';
    case 'tag': return `# ${nav.name}`;
    case 'notebook': return ctx.notebookName || '笔记本';
  }
}

const SORT_LABEL: Record<SortKey, string> = {
  updated: '最近修改', created: '最近创建', title: '标题 A–Z', reminder: '提醒时间',
};

export default function NoteList() {
  const {
    ws, nav, setNav, query, setQuery, activeId, setActiveId, selectedIds, setSelectedIds,
    visibleNotes, actions, openDialog, toast,
  } = useApp();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const anchor = useRef<number | null>(null);

  const notebookName = nav.kind === 'notebook' ? ws.notebooks.find((n) => n.id === nav.id)?.name : undefined;
  const savedName = nav.kind === 'savedSearch' ? ws.savedSearches.find((s) => s.id === nav.id)?.name : undefined;
  const title = navTitle(nav, { notebookName, savedName });
  const nbById = new Map(ws.notebooks.map((n) => [n.id, n]));

  const onRowClick = (e: React.MouseEvent, note: Note, index: number) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds(selectedIds.includes(note.id) ? selectedIds.filter((i) => i !== note.id) : [...selectedIds, note.id]);
      anchor.current = index;
      return;
    }
    if (e.shiftKey && anchor.current !== null) {
      const a = Math.min(anchor.current, index);
      const b = Math.max(anchor.current, index);
      setSelectedIds(visibleNotes.slice(a, b + 1).map((n) => n.id));
      return;
    }
    anchor.current = index;
    setSelectedIds([]);
    setActiveId(note.id);
  };

  const rowMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault(); e.stopPropagation();
    const ids = selectedIds.includes(note.id) ? selectedIds : [note.id];
    const many = ids.length > 1;
    const items: MenuItem[] = [
      { label: many ? `打开 ${ids.length} 篇中的这篇` : '打开', icon: <FileText size={14} />, onClick: () => { setActiveId(note.id); setSelectedIds([]); } },
      {
        label: note.pinned ? '取消置顶' : '置顶', icon: <Pin size={14} />,
        onClick: () => (many ? actions.patchNotes(ids, { pinned: !note.pinned }) : actions.toggleFlag(note.id, 'pinned')),
      },
      {
        label: note.favorite ? '取消收藏' : '收藏', icon: <Star size={14} />,
        onClick: () => (many ? actions.patchNotes(ids, { favorite: !note.favorite }) : actions.toggleFlag(note.id, 'favorite')),
      },
      {
        label: ws.shortcuts.some((s) => s.kind === 'note' && s.refId === note.id) ? '从快捷方式移除' : '添加到快捷方式',
        icon: <Bookmark size={14} />, onClick: () => actions.toggleShortcut('note', note.id, note.title || '未命名笔记'),
      },
      { label: '笔记信息…', icon: <Info size={14} />, onClick: () => openDialog('noteInfo', { id: note.id }) },
      { label: '保存一个版本', icon: <History size={14} />, onClick: () => actions.snapshot(note.id) },
      { label: '查找替换…', icon: <FileSearch size={14} />, onClick: () => openDialog('findReplace', { id: note.id }) },
      { label: '', divider: true },
      { label: '移动到笔记本…', icon: <FolderInput size={14} />, onClick: () => openDialog('move', { kind: 'notes', ids }) },
      { label: '加标签…', icon: <Tag size={14} />, onClick: () => openDialog('tag', { ids }) },
      {
        label: '复制笔记内链', icon: <Link2 size={14} />, onClick: async () => {
          try { await navigator.clipboard.writeText(`[[${note.title}]]`); toast('内链已复制'); }
          catch { toast('复制失败', 'err'); }
        },
      },
      {
        label: '复制标题', icon: <Copy size={14} />, onClick: async () => {
          try { await navigator.clipboard.writeText(note.title); toast('标题已复制'); } catch { toast('复制失败', 'err'); }
        },
      },
      { label: '', divider: true },
      {
        label: many ? `导出这 ${ids.length} 篇…` : '导出…', icon: <FileDown size={14} />,
        onClick: () => openDialog('export', { ids }),
      },
      { label: '', divider: true },
      note.trashed
        ? { label: many ? `恢复 ${ids.length} 篇` : '恢复', icon: <RotateCcw size={14} />, onClick: () => actions.restore(ids) }
        : { label: many ? `移到回收站（${ids.length} 篇）` : '移到回收站', icon: <Trash2 size={14} />, danger: true, onClick: () => actions.trash(ids) },
      ...(note.trashed
        ? [{ label: '彻底删除', icon: <X size={14} />, danger: true, onClick: () => openDialog('confirm', {
            title: '彻底删除？', message: '这一步不可撤销。', confirmLabel: '彻底删除', danger: true,
            onConfirm: () => actions.purge(ids),
          }) } as MenuItem]
        : []),
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const bulk = selectedIds.length > 0;
  const trashView = nav.kind === 'trash';

  return (
    <section className="notelist" style={{ width: ws.settings.listWidth }}>
      <header className="list__head">
        <div className="list__title">
          <h2>{title}</h2>
          <span className="list__count">{visibleNotes.length} 篇</span>
        </div>
        <div className="list__tools">
          <IconBtn title="新建笔记 (Ctrl+N)" onClick={() => actions.createNote({
            notebookId: nav.kind === 'notebook' ? nav.id : undefined,
          })}><Plus size={17} /></IconBtn>
          <IconBtn title={ws.settings.view === 'list' ? '切到卡片视图' : '切到列表视图'} onClick={() =>
            actions.setSettings({ view: ws.settings.view === 'list' ? 'card' : 'list' })}>
            {ws.settings.view === 'list' ? <LayoutGrid size={16} /> : <LayoutList size={16} />}
          </IconBtn>
          <div className="sort-wrap" title="排序方式">
            <ArrowUpDown size={14} />
            <select value={ws.settings.sort} onChange={(e) => actions.setSettings({ sort: e.target.value as SortKey })}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </div>
        </div>
      </header>

      {query.trim() && (
        <div className="list__querybar">
          <span>搜索「<b>{query}</b>」命中 {visibleNotes.length} 篇</span>
          <button onClick={() => setQuery('')}><X size={13} /> 清空</button>
        </div>
      )}

      {trashView && visibleNotes.length > 0 && (
        <div className="list__notice">
          <Archive size={14} /> 回收站里的笔记可恢复，也可以彻底删除
          <button onClick={() => openDialog('confirm', {
            title: '清空回收站？', message: '所有回收站里的笔记会被永久删除，不可撤销。',
            confirmLabel: '清空回收站', danger: true, onConfirm: () => actions.emptyTrash(),
          })}>清空</button>
        </div>
      )}

      {bulk && (
        <div className="bulkbar">
          <span><CheckSquare size={15} /> 已选 {selectedIds.length} 篇</span>
          <div className="bulkbar__acts">
            <IconBtn title="加标签" onClick={() => openDialog('tag', { ids: selectedIds })}><Tag size={15} /></IconBtn>
            <IconBtn title="移动笔记本" onClick={() => openDialog('move', { kind: 'notes', ids: selectedIds })}><FolderInput size={15} /></IconBtn>
            {trashView ? (
              <>
                <IconBtn title="恢复" onClick={() => actions.restore(selectedIds)}><RotateCcw size={15} /></IconBtn>
                <IconBtn title="彻底删除" danger onClick={() => openDialog('confirm', {
                  title: `彻底删除 ${selectedIds.length} 篇？`, message: '不可撤销。', confirmLabel: '彻底删除', danger: true,
                  onConfirm: () => actions.purge(selectedIds),
                })}><Trash2 size={15} /></IconBtn>
              </>
            ) : (
              <>
                <IconBtn title="置顶" onClick={() => actions.patchNotes(selectedIds, { pinned: true })}><Pin size={15} /></IconBtn>
                <IconBtn title="收藏" onClick={() => actions.patchNotes(selectedIds, { favorite: true })}><Star size={15} /></IconBtn>
                <IconBtn title="移到回收站" danger onClick={() => actions.trash(selectedIds)}><Trash2 size={15} /></IconBtn>
              </>
            )}
            <IconBtn title="取消选择 (Esc)" onClick={() => setSelectedIds([])}><X size={15} /></IconBtn>
          </div>
        </div>
      )}

      <div className={`list__scroll ${ws.settings.view === 'card' ? 'is-card' : ''}`}>
        {visibleNotes.length === 0 ? (
          <Empty
            icon={query.trim() ? <SearchX size={34} /> : <FileText size={34} />}
            title={query.trim() ? '没有匹配的笔记' : trashView ? '回收站是空的' : '这里还没有笔记'}
            desc={query.trim() ? '换个关键词，或清空搜索看看全部笔记。' : '新建一篇，或导入已有的 Markdown / ENEX 文件。'}
            action={query.trim()
              ? <Btn variant="subtle" onClick={() => setQuery('')}>清空搜索</Btn>
              : <Btn variant="primary" onClick={() => actions.createNote()}><Plus size={15} /> 新建笔记</Btn>}
          />
        ) : ws.settings.view === 'card' ? (
          <div className="card-grid">
            {visibleNotes.map((note, i) => (
              <article key={note.id}
                className={`note-card ${activeId === note.id ? 'is-active' : ''} ${selectedIds.includes(note.id) ? 'is-selected' : ''}`}
                onClick={(e) => onRowClick(e, note, i)} onContextMenu={(e) => rowMenu(e, note)}
                style={{ '--card-accent': nbById.get(note.notebookId || '')?.color || '#2F8F68' } as React.CSSProperties}>
                <div className="note-card__bar" />
                <div className="note-card__top">
                  <h3 dangerouslySetInnerHTML={{ __html: highlight(note.title || '未命名笔记', query) }} />
                  <IconBtn title="更多" onClick={(e) => { e.stopPropagation(); rowMenu(e, note); }}><MoreHorizontal size={15} /></IconBtn>
                </div>
                <p>{excerpt(plainOf(note), 92) || '（空白笔记）'}</p>
                <div className="note-card__foot">
                  <span>{relativeTime(note.updatedAt)}</span>
                  <span>{note.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          visibleNotes.map((note, i) => (
            <article key={note.id}
              className={`note-row ${activeId === note.id ? 'is-active' : ''} ${selectedIds.includes(note.id) ? 'is-selected' : ''}`}
              onClick={(e) => onRowClick(e, note, i)} onContextMenu={(e) => rowMenu(e, note)}>
              <div className="note-row__check">
                {selectedIds.includes(note.id) && <CheckSquare size={15} />}
              </div>
              {/* 正文插图不是笔记封面/LOGO：默认不把它提升成列表缩略图，需在设置里显式打开。 */}
              {ws.settings.showThumbnails && ws.settings.contentThumbnails && thumbnailOf(note) && (
                <div className="note-row__thumb"><img src={thumbnailOf(note)} alt="" loading="lazy" /></div>
              )}
              <div className="note-row__main">
                <div className="note-row__line1">
                  <h3 dangerouslySetInnerHTML={{ __html: highlight(note.title || '未命名笔记', query) }} />
                  {note.pinned && <Pin size={13} className="flag" />}
                  {note.reminderAt && !note.reminderDone && <Bell size={13} className="flag flag--bell" />}
                  {note.attachments.length > 0 && <span className="flag-inline"><Paperclip size={12} />{note.attachments.length}</span>}
                </div>
                <p className="note-row__excerpt"
                  dangerouslySetInnerHTML={{ __html: highlight(excerpt(plainOf(note), 100) || '（空白笔记）', query) }} />
                <div className="note-row__meta">
                  <span className="note-row__time">{relativeTime(note.updatedAt)}</span>
                  {note.notebookId && nbById.get(note.notebookId) && (
                    <span className="note-row__nb">
                      <i style={{ background: nbById.get(note.notebookId)!.color }} />
                      {nbById.get(note.notebookId)!.name}
                    </span>
                  )}
                  <span className="note-row__tags">
                    {note.tags.slice(0, 3).map((t) => <em key={t}>#{t}</em>)}
                  </span>
                </div>
              </div>
              <div className="note-row__acts">
                <IconBtn title={note.favorite ? '取消收藏' : '收藏'} active={note.favorite}
                  onClick={(e) => { e.stopPropagation(); actions.toggleFlag(note.id, 'favorite'); }}>
                  <Star size={15} fill={note.favorite ? 'currentColor' : 'none'} />
                </IconBtn>
                <IconBtn title="更多" onClick={(e) => { e.stopPropagation(); rowMenu(e, note); }}>
                  <MoreHorizontal size={15} />
                </IconBtn>
              </div>
            </article>
          ))
        )}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}
