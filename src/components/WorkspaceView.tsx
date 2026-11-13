import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight, BarChart3, Bell, CalendarDays, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleCheck, Clock, Download, FileText, Folder, Hash, LayoutTemplate,
  ListTodo, Music, NotebookPen, Paperclip, Pin, Plus, Search, Sparkles, Star, StickyNote, Tag,
  Trash2, Video, Wand2, X,
} from 'lucide-react';
import { useApp } from '../context';
import type { HomeCardId, NavSelection, Note } from '../types';
import { DEFAULT_HOME_LAYOUT, HOME_CARDS, normalizeHomeLayout } from '../types';
import { mdToHtml, htmlToMd } from '../convert';
import { collectTasks, toggleTaskContent } from '../tasks';
import { normalizeMediaUrl } from '../media';
import { excerpt, formatDate, formatDateTime, plainOf, relativeTime, templatePreview, wordCount } from '../utils';
import { Btn, Empty, IconBtn } from './Common';
import TemplateIcon from './TemplateIcon';

function openNote(setActiveId: (id: string | null) => void, setNav: (n: NavSelection) => void, id: string) {
  setActiveId(id);
  setNav({ kind: 'all' });
}

/* ============================ 首页 ============================ */

function HomeView() {
  const { ws, actions, setActiveId, setNav, openDialog, toast } = useApp();
  const [layoutEdit, setLayoutEdit] = useState(false);
  // 首页布局：order 恒为完整的 7 项顺序表，hidden 是隐藏集合；老档缺字段由 normalize 兜底。
  // 显隐与排序分开存，编辑条里能「所见即所得」地勾选 / 上下移。
  const order = useMemo(() => normalizeHomeLayout(ws.settings.homeLayout), [ws.settings.homeLayout]);
  const hidden = useMemo(() => {
    const raw = ws.settings.homeHidden;
    const arr = Array.isArray(raw) ? raw : [];
    return new Set(arr.filter((c): c is HomeCardId => (HOME_CARDS as readonly string[]).includes(c)));
  }, [ws.settings.homeHidden]);
  /** 网格按这个数排；隐藏的模块用 display:none 收起，不占位。 */
  const idx = (c: HomeCardId) => order.indexOf(c);
  const cardMeta: Record<HomeCardId, { label: string; icon: ReactNode }> = {
    stats: { label: '顶部指标', icon: <BarChart3 size={14} /> },
    sticky: { label: '即时贴', icon: <StickyNote size={14} /> },
    shortcuts: { label: '快捷方式', icon: <Star size={14} /> },
    recent: { label: '最近笔记', icon: <Clock size={14} /> },
    tasks: { label: '待办', icon: <ListTodo size={14} /> },
    notebooks: { label: '笔记本', icon: <Folder size={14} /> },
    tips: { label: '快速上手', icon: <Sparkles size={14} /> },
  };
  const toggleCard = (id: HomeCardId) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id); else next.add(id);
    actions.setSettings({ homeHidden: [...next] });
  };
  const moveCard = (id: HomeCardId, dir: -1 | 1) => {
    const next = [...order];
    const i = next.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    actions.setSettings({ homeLayout: next });
  };
  const live = ws.notes.filter((n) => !n.trashed);
  const recent = [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const tasks = collectTasks(live);
  const undone = tasks.filter((t) => !t.done);
  const totalWords = live.reduce((s, n) => s + wordCount(plainOf(n)), 0);
  const attachmentCount = live.reduce((s, n) => s + (n.attachments?.length || 0), 0);
  const tagCount = new Set(live.flatMap((n) => n.tags)).size;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  const today = new Date();
  const dateLabel = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]}`;

  const shortcutGo = (kind: string, refId: string) => {
    switch (kind) {
      case 'note': openNote(setActiveId, setNav, refId); break;
      case 'notebook': setNav({ kind: 'notebook', id: refId }); break;
      case 'tag': setNav({ kind: 'tag', name: refId }); break;
      case 'search': {
        const s = ws.savedSearches.find((x) => x.id === refId);
        if (s) setNav({ kind: 'savedSearch', id: s.id });
        else toast('这条保存的搜索已经删掉了', 'err');
        break;
      }
    }
  };

  return (
    <div className="fullview home">
      <header className="fullview__head">
        <div>
          <p className="home__date">{dateLabel}</p>
          <h1>{greeting}，这里是你的<span>纸间笔记</span></h1>
          <p className="fullview__sub">所有笔记都在这台机器上，不联网、不要账号。</p>
        </div>
        <div className="fullview__acts">
          <Btn onClick={() => setLayoutEdit((v) => !v)}><LayoutTemplate size={15} /> {layoutEdit ? '完成编辑' : '自定义布局'}</Btn>
          <Btn onClick={() => openDialog('templates')}><Wand2 size={15} /> 从模板</Btn>
          <Btn variant="primary" onClick={() => actions.createNote()}><Plus size={16} /> 新建笔记</Btn>
        </div>
      </header>

      <div className="home__stats" style={{ display: hidden.has('stats') ? 'none' : undefined }}>
        <div className="stat-card"><FileText size={18} /><b>{live.length}</b><span>篇笔记</span></div>
        <div className="stat-card"><BarChart3 size={18} /><b>{totalWords.toLocaleString('zh-CN')}</b><span>字</span></div>
        <div className="stat-card"><Tag size={18} /><b>{tagCount}</b><span>个标签</span></div>
        <div className="stat-card"><Paperclip size={18} /><b>{attachmentCount}</b><span>个附件</span></div>
        <div className="stat-card"><CheckSquare size={18} /><b>{tasks.length - undone.length}/{tasks.length}</b><span>待办完成</span></div>
      </div>

      {layoutEdit && (
        <div className="home-layout">
          <div className="home-layout__head">
            <div><strong>自定义首页</strong><span className="muted">勾选决定是否显示，↑↓ 调整顺序，改动即时生效</span></div>
            <div className="home-layout__acts">
              <button type="button" onClick={() => {
                actions.setSettings({ homeLayout: [...DEFAULT_HOME_LAYOUT], homeHidden: [] });
                toast('已恢复默认布局');
              }}>恢复默认</button>
              <button type="button" className="is-primary" onClick={() => setLayoutEdit(false)}>完成</button>
            </div>
          </div>
          <div className="home-layout__list">
            {order.map((id, i) => (
              <div key={id} className={`home-layout__item${hidden.has(id) ? ' is-off' : ''}`}>
                <label>
                  <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggleCard(id)} />
                  {cardMeta[id].icon}<span>{cardMeta[id].label}</span>
                </label>
                <span className="home-layout__move">
                  <button type="button" title="上移" disabled={i === 0} onClick={() => moveCard(id, -1)}><ChevronUp size={14} /></button>
                  <button type="button" title="下移" disabled={i === order.length - 1} onClick={() => moveCard(id, 1)}><ChevronDown size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="home__grid">
        <section style={{ order: idx('sticky'), display: hidden.has('sticky') ? 'none' : undefined }} className="home-card home-card--sticky">
          <div className="home-card__head"><StickyNote size={16} /><h3>即时贴</h3><span className="muted">随手记，自动保存</span></div>
          <textarea className="sticky-area" value={ws.sticky} placeholder="临时待办、闪念、一句话…"
            onChange={(e) => actions.setSticky(e.target.value)} />
        </section>

        <section style={{ order: idx('shortcuts'), display: hidden.has('shortcuts') ? 'none' : undefined }} className="home-card home-card--shortcuts">
          <div className="home-card__head"><Star size={16} /><h3>快捷方式</h3>
            <button className="home-card__link" onClick={() => openDialog('sidebar')}>管理 <ArrowRight size={13} /></button>
          </div>
          {ws.shortcuts.length === 0 && <p className="home-card__empty">右键笔记或笔记本，可以固定到这里。</p>}
          <div className="shortcut-list">
            {ws.shortcuts.slice(0, 8).map((s) => (
              <div key={s.id} className="shortcut-item" onClick={() => shortcutGo(s.kind, s.refId)}>
                {s.kind === 'note' ? <FileText size={14} /> : s.kind === 'notebook' ? <Folder size={14} />
                  : s.kind === 'tag' ? <Hash size={14} /> : <Search size={14} />}
                <span>{s.label}</span>
                <IconBtn title="取消固定" onClick={(e) => { e.stopPropagation(); actions.removeShortcut(s.id); }}><X size={13} /></IconBtn>
              </div>
            ))}
          </div>
        </section>

        <section style={{ order: idx('recent'), display: hidden.has('recent') ? 'none' : undefined }} className="home-card home-card--recent">
          <div className="home-card__head"><Clock size={16} /><h3>最近笔记</h3>
            <button className="home-card__link" onClick={() => setNav({ kind: 'all' })}>全部 <ArrowRight size={13} /></button>
          </div>
          {recent.length === 0 && <p className="home-card__empty">还没有笔记，先新建一篇吧。</p>}
          <div className="recent-list">
            {recent.map((n) => (
              <button key={n.id} className="recent-item" onClick={() => openNote(setActiveId, setNav, n.id)}>
                <span className="recent-item__icon"><FileText size={15} /></span>
                <span className="recent-item__main">
                  <strong>{n.title || '未命名笔记'}</strong>
                  <em>{excerpt(plainOf(n), 46) || '空白笔记'}</em>
                </span>
                <span className="recent-item__meta">{relativeTime(n.updatedAt)}</span>
              </button>
            ))}
          </div>
        </section>

        <section style={{ order: idx('tasks'), display: hidden.has('tasks') ? 'none' : undefined }} className="home-card home-card--tasks">
          <div className="home-card__head"><ListTodo size={16} /><h3>待办</h3><span className="muted">{undone.length} 项未完成</span>
            <button className="home-card__link" onClick={() => setNav({ kind: 'tasks' })}>全部 <ArrowRight size={13} /></button>
          </div>
          {tasks.length === 0 && <p className="home-card__empty">笔记里写 <code>- [ ] 要做的事</code> 就会出现在这里。</p>}
          <div className="home-tasks">
            {tasks.slice(0, 8).map((t) => (
              <label key={`${t.noteId}-${t.index}`} className={`home-task ${t.done ? 'is-done' : ''}`}>
                <input type="checkbox" checked={t.done} onChange={() => {
                  const n = ws.notes.find((x) => x.id === t.noteId);
                  if (n) actions.updateNote(t.noteId, { content: toggleTaskContent(n, t.index) });
                }} />
                <span>{t.text || '（空待办）'}</span>
                <em onClick={() => openNote(setActiveId, setNav, t.noteId)}>{t.noteTitle}</em>
              </label>
            ))}
          </div>
        </section>

        <section style={{ order: idx('notebooks'), display: hidden.has('notebooks') ? 'none' : undefined }} className="home-card home-card--notebooks">
          <div className="home-card__head"><Folder size={16} /><h3>笔记本</h3>
            <button className="home-card__link" onClick={() => setNav({ kind: 'all' })}>查看 <ArrowRight size={13} /></button>
          </div>
          <div className="nb-overview">
            {ws.notebooks.map((nb) => {
              const c = live.filter((n) => n.notebookId === nb.id).length;
              return (
                <button key={nb.id} className="nb-overview__row" onClick={() => setNav({ kind: 'notebook', id: nb.id })}>
                  <i style={{ background: nb.color }} />
                  <span>{nb.name}</span>
                  <div className="nb-overview__bar"><b style={{ width: `${live.length ? Math.max(6, (c / live.length) * 100) : 0}%`, background: nb.color }} /></div>
                  <em>{c}</em>
                </button>
              );
            })}
            {ws.notebooks.length === 0 && <p className="home-card__empty">还没有笔记本。</p>}
          </div>
        </section>

        <section style={{ order: idx('tips'), display: hidden.has('tips') ? 'none' : undefined }} className="home-card home-card--tips">
          <div className="home-card__head"><Sparkles size={16} /><h3>快速上手</h3></div>
          <div className="home-tips">
            <button onClick={() => setNav({ kind: 'tasks' })}><CheckSquare size={15} /> 汇总所有笔记里的待办</button>
            <button onClick={() => setNav({ kind: 'files' })}><Paperclip size={15} /> 按附件找笔记</button>
            <button onClick={() => setNav({ kind: 'calendar' })}><CalendarDays size={15} /> 按日期翻笔记</button>
            <button onClick={() => openDialog('search')}><Search size={15} /> 高级搜索语法</button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============================ 任务 ============================ */

function TasksView() {
  const { ws, actions, setActiveId, setNav } = useApp();
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all');
  const tasks = useMemo(() => collectTasks(ws.notes), [ws.notes]);
  const shown = tasks.filter((t) => filter === 'all' || (filter === 'open' ? !t.done : t.done));
  const doneCount = tasks.filter((t) => t.done).length;
  const groups = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const t of shown) {
      const arr = m.get(t.noteId) || [];
      arr.push(t);
      m.set(t.noteId, arr);
    }
    return Array.from(m.entries());
  }, [shown]);

  return (
    <div className="fullview">
      <header className="fullview__head">
        <div>
          <h1><ListTodo size={22} /> 任务</h1>
          <p className="fullview__sub">自动汇总所有笔记里的待办，勾选会直接写回笔记正文。</p>
        </div>
        <div className="segmented">
          {([['all', '全部'], ['open', '未完成'], ['done', '已完成']] as const).map(([k, label]) => (
            <button key={k} className={filter === k ? 'is-active' : ''} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </header>
      <div className="task-progress">
        <div className="task-progress__bar"><b style={{ width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }} /></div>
        <span>{doneCount} / {tasks.length} 已完成</span>
      </div>
      {groups.length === 0 ? (
        <Empty icon={<CircleCheck size={34} />} title={tasks.length ? '这个筛选下没有待办' : '还没有待办'}
          desc="在笔记里写 - [ ] 要做的事，或用工具栏的「待办」按钮插入，就会自动出现在这里。" />
      ) : (
        <div className="task-groups">
          {groups.map(([noteId, items]) => {
            const note = ws.notes.find((n) => n.id === noteId);
            return (
              <section key={noteId} className="task-group">
                <header onClick={() => openNote(setActiveId, setNav, noteId)}>
                  <FileText size={15} /><strong>{note?.title || '未命名笔记'}</strong>
                  <span>{items.length} 项</span><ArrowRight size={14} />
                </header>
                {items.map((t) => (
                  <label key={t.index} className={`task-row ${t.done ? 'is-done' : ''}`}>
                    <input type="checkbox" checked={t.done} onChange={() => {
                      const n = ws.notes.find((x) => x.id === t.noteId);
                      if (n) actions.updateNote(t.noteId, { content: toggleTaskContent(n, t.index) });
                    }} />
                    <span>{t.text || '（空待办）'}</span>
                    <em>{relativeTime(t.updatedAt)}</em>
                  </label>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================ 文件 ============================ */

function FilesView() {
  const { ws, setActiveId, setNav, toast } = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | 'image' | 'media' | 'board' | 'file'>('all');
  const files = useMemo(() => {
    const out: { note: Note; id: string; name: string; kind: string; mime: string; size: number; dataUrl: string; createdAt: number }[] = [];
    for (const n of ws.notes.filter((x) => !x.trashed)) {
      for (const a of n.attachments || []) {
        out.push({ note: n, id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: a.size, dataUrl: a.dataUrl, createdAt: a.createdAt });
      }
    }
    return out.filter((f) => {
      const hit = kind === 'all'
        || (kind === 'media' ? (f.kind === 'audio' || f.kind === 'video') : f.kind === kind);
      return hit && f.name.toLowerCase().includes(q.trim().toLowerCase());
    }).sort((a, b) => b.createdAt - a.createdAt);
  }, [ws.notes, q, kind]);
  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="fullview">
      <header className="fullview__head">
        <div>
          <h1><Paperclip size={22} /> 文件</h1>
          <p className="fullview__sub">所有笔记里的图片与附件，共 {files.length} 个 · {(totalSize / 1024).toFixed(1)} KB（data URL 内嵌在存档里）。</p>
        </div>
        <div className="fullview__acts">
          <div className="mini-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="按文件名筛选" /></div>
          <div className="segmented">
            {([['all', '全部'], ['image', '图片'], ['media', '音视频'], ['board', '画板'], ['file', '文件']] as const).map(([k, label]) => (
              <button key={k} className={kind === k ? 'is-active' : ''} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
        </div>
      </header>
      {files.length === 0 ? (
        <Empty icon={<Paperclip size={34} />} title="没有匹配的附件" desc="把图片或文件拖进编辑器，就会作为附件出现在这里。" />
      ) : (
        <div className="file-grid">
          {files.map((f) => (
            <article key={`${f.note.id}-${f.id}`} className="file-card">
              <div className="file-card__preview">
                {f.kind === 'image' || f.kind === 'board'
                  ? <img src={normalizeMediaUrl(f.dataUrl, f.name, f.mime)} alt={f.name} />
                  : <div className="file-card__icon">
                      {f.kind === 'audio' ? <Music size={28} />
                        : f.kind === 'video' ? <Video size={28} /> : <FileText size={28} />}
                    </div>}
              </div>
              <div className="file-card__body">
                <strong title={f.name}>{f.name}</strong>
                <span>{(f.size / 1024).toFixed(1)} KB · {
                  f.kind === 'image' ? '图片' : f.kind === 'audio' ? '音频'
                    : f.kind === 'video' ? '视频' : f.kind === 'board' ? '画板' : '文件'
                }</span>
                <button className="file-card__note" onClick={() => openNote(setActiveId, setNav, f.note.id)}>
                  <FileText size={12} /> {f.note.title || '未命名笔记'}
                </button>
              </div>
              <a className="file-card__dl" href={normalizeMediaUrl(f.dataUrl, f.name, f.mime)} download={f.name} title="下载"
                onClick={() => toast(`开始下载「${f.name}」`)}><Download size={15} /></a>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ 日历 ============================ */

function CalendarView() {
  const { ws, setActiveId, setNav, actions } = useApp();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState(() => formatDate(Date.now()));
  const live = ws.notes.filter((n) => !n.trashed);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startCell = new Date(year, month, 1 - ((first.getDay() + 6) % 7)); // 周一开头
  const cells = Array.from({ length: 42 }, (_, i) => new Date(startCell.getFullYear(), startCell.getMonth(), startCell.getDate() + i));

  const byCreated = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of live) {
      const k = formatDate(n.createdAt);
      m.set(k, [...(m.get(k) || []), n]);
    }
    return m;
  }, [live]);
  const reminders = useMemo(() => {
    const m = new Map<string, Note[]>();
    for (const n of live) {
      if (!n.reminderAt) continue;
      const k = formatDate(n.reminderAt);
      m.set(k, [...(m.get(k) || []), n]);
    }
    return m;
  }, [live]);

  const dayNotes = [...(byCreated.get(picked) || []), ...(reminders.get(picked) || [])]
    .filter((n, i, arr) => arr.findIndex((x) => x.id === n.id) === i)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const shift = (delta: number) => setCursor(new Date(year, month + delta, 1));
  const goToday = () => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setPicked(formatDate(Date.now())); };

  return (
    <div className="fullview">
      <header className="fullview__head">
        <div>
          <h1><CalendarDays size={22} /> 日历</h1>
          <p className="fullview__sub">按创建日期与提醒日期回看笔记；点一天查看，也可以直接在那天新建一篇带提醒的笔记。</p>
        </div>
        <div className="calendar__nav">
          <IconBtn title="上个月" onClick={() => shift(-1)}><ChevronLeft size={17} /></IconBtn>
          <strong>{year} 年 {month + 1} 月</strong>
          <IconBtn title="下个月" onClick={() => shift(1)}><ChevronRight size={17} /></IconBtn>
          <Btn onClick={goToday}>今天</Btn>
        </div>
      </header>
      <div className="calendar">
        <div className="calendar__week">
          {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}
        </div>
        <div className="calendar__grid">
          {cells.map((d) => {
            const key = formatDate(d.getTime());
            const inMonth = d.getMonth() === month;
            const created = byCreated.get(key) || [];
            const rem = reminders.get(key) || [];
            const isToday = key === formatDate(Date.now());
            return (
              <button key={key}
                className={`cal-cell ${inMonth ? '' : 'is-out'} ${isToday ? 'is-today' : ''} ${key === picked ? 'is-picked' : ''}`}
                onClick={() => setPicked(key)}>
                <span className="cal-cell__num">{d.getDate()}</span>
                <div className="cal-cell__dots">
                  {created.slice(0, 3).map((n) => <i key={n.id} className="cal-dot cal-dot--note" title={n.title} />)}
                  {rem.slice(0, 2).map((n) => <i key={n.id} className="cal-dot cal-dot--rem" title={`提醒：${n.title}`} />)}
                </div>
                {(created.length + rem.length) > 0 && <em>{created.length + rem.length}</em>}
              </button>
            );
          })}
        </div>
      </div>
      <section className="calendar__day">
        <header>
          <div><strong>{picked}</strong><span>{dayNotes.length} 篇笔记</span></div>
          <Btn variant="subtle" onClick={() => {
            const ts = new Date(`${picked}T09:00:00`).getTime();
            actions.createNote({ title: `${picked} 备忘`, reminderAt: ts });
          }}><Plus size={14} /> 在这天新建带提醒的笔记</Btn>
        </header>
        {dayNotes.length === 0 && <p className="home-card__empty">这一天没有笔记或提醒。</p>}
        <div className="day-list">
          {dayNotes.map((n) => (
            <button key={n.id} className="day-item" onClick={() => openNote(setActiveId, setNav, n.id)}>
              <FileText size={15} />
              <span>{n.title || '未命名笔记'}</span>
              {n.reminderAt && formatDate(n.reminderAt) === picked && <em><Bell size={12} /> 提醒 {formatDateTime(n.reminderAt).slice(11)}</em>}
              <em><Pin size={12} /> 创建 {formatDateTime(n.createdAt).slice(11)}</em>
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================ 模板 ============================ */

function TemplatesView() {
  const { ws, actions, activeId, toast, openDialog, closeDialog } = useApp();
  const note = ws.notes.find((n) => n.id === activeId);
  const useTemplate = (tpl: { name: string; content: string; icon: string }) => {
    const mode = ws.settings.defaultMode;
    const content = mode === 'rich' ? mdToHtml(tpl.content) : tpl.content;
    actions.createNote({ title: `${tpl.name} · ${formatDateTime(Date.now()).slice(0, 10)}`, content, mode });
    toast(`已用「${tpl.name}」新建笔记`);
  };
  const saveCurrent = () => {
    if (!note) { toast('先打开一篇笔记，才能把它存成模板', 'err'); return; }
    openDialog('prompt', {
      title: '保存为模板', label: '模板名称', placeholder: '例如：周复盘',
      onConfirm: (name: string) => {
        // 模板的正文一律是 Markdown：富文本笔记先转回 Markdown，
        // 否则存下来的是 HTML，用它新建 Markdown 笔记就会把标签当正文。
        actions.addTemplate(name, note.mode === 'rich' ? htmlToMd(note.content) : note.content);
        toast('已把当前笔记存成模板');
        closeDialog();
      },
    });
  };

  return (
    <div className="fullview">
      <header className="fullview__head">
        <div>
          <h1><LayoutTemplate size={22} /> 模板</h1>
          <p className="fullview__sub">内置 {ws.templates.filter((t) => t.builtin).length} 套，自定义 {ws.templates.filter((t) => !t.builtin).length} 套。和印象笔记一样，也可以把任意一篇笔记存成模板。</p>
        </div>
        <div className="fullview__acts">
          <Btn onClick={saveCurrent}><NotebookPen size={15} /> 把当前笔记存成模板</Btn>
          <Btn variant="primary" onClick={() => openDialog('prompt', {
            title: '新建空白模板', label: '模板名称', placeholder: '例如：访谈提纲',
            onConfirm: (v: string) => actions.addTemplate(v, ''),
          })}><Plus size={15} /> 新建模板</Btn>
        </div>
      </header>
      <div className="template-view-grid">
        {ws.templates.map((t) => (
          <article key={t.id} className="template-view-card" onClick={() => useTemplate(t)}>
            <header>
              <TemplateIcon icon={t.icon} size={17} />
              <strong>{t.name}</strong>
            </header>
            <p>{t.desc || templatePreview(t.content, 68) || '空白模板，从零开始写'}</p>
            <footer>
              {t.builtin ? <em>内置</em> : <em>自定义</em>}
              {!t.builtin && (
                <IconBtn title="删除模板" danger onClick={(e) => { e.stopPropagation(); actions.deleteTemplate(t.id); }}>
                  <Trash2 size={14} />
                </IconBtn>
              )}
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ============================ 分发 ============================ */

export default function WorkspaceView() {
  const { nav } = useApp();
  switch (nav.kind) {
    case 'home': return <HomeView />;
    case 'tasks': return <TasksView />;
    case 'files': return <FilesView />;
    case 'calendar': return <CalendarView />;
    case 'templates': return <TemplatesView />;
    default: return null;
  }
}
