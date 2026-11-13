import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark, Check, Clock, Copy, Download, ExternalLink, FileText, History, ListFilter, RotateCcw, Save,
  Search, Settings2, Trash2, X,
} from 'lucide-react';
import { useApp } from '../context';
import { storage } from '../storage';
import { freeTextOf, matchFilters, parseQuery, searchNotes, SYNTAX_HINTS, highlight } from '../search';
import { countInContent, replaceInContent } from '../tasks';
import { excerpt, formatDateTime, formatSize, plainOf, wordCount } from '../utils';
import { Btn, Field, Modal } from './Common';
import { FileBadge } from './FileBadge';
import { SECTION_LABELS } from './Sidebar';
import { guessMime, mediaTagOf, normalizeMediaUrl, dataUrlToBytes } from '../media';
import { buildDocPreview } from '../office-preview';

/* ==================== 高级搜索弹窗 ==================== */

export function SearchDialog() {
  const { ws, dialog, closeDialog, query, setQuery, setNav, setActiveId, actions, toast } = useApp();
  const [q, setQ] = useState<string>(String(query || dialog.payload?.query || ''));
  const nbName = (id: string | null) => ws.notebooks.find((n) => n.id === id)?.name || '未分类';

  const results = useMemo(() => {
    const parsed = parseQuery(q);
    const base = ws.notes.filter((n) => !n.trashed && matchFilters(n, parsed, nbName));
    return searchNotes(base, parsed.text).slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ws.notes, ws.notebooks]);

  const open = (id: string) => {
    actions.rememberSearch(q);
    setNav({ kind: 'all' });
    setActiveId(id);
    closeDialog();
  };
  const apply = () => {
    actions.rememberSearch(q);
    setQuery(q);
    setNav({ kind: 'all' });
    closeDialog();
  };

  return (
    <Modal title="搜索笔记" subtitle="支持印象笔记式高级语法：tag: notebook: intitle: created: has: is:，前缀 - 表示排除"
      width={720} icon={<Search size={19} />} onClose={closeDialog}
      footer={<>
        <Btn onClick={() => { setQ(''); }}>清空</Btn>
        <Btn onClick={() => {
          if (!q.trim()) { toast('先输入搜索内容', 'err'); return; }
          actions.rememberSearch(q);
          actions.addSavedSearch(q.trim().slice(0, 24), q.trim());
        }}><Save size={14} /> 保存这条搜索</Btn>
        <Btn variant="primary" onClick={apply}>在笔记列表中查看</Btn>
      </>}>
      <div className="searchdlg__input">
        <Search size={18} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题、正文、标签，或用 tag:读书 has:attachment"
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }} />
        {q && <button onClick={() => setQ('')} title="清空"><X size={15} /></button>}
      </div>

      <div className="syntax-chips">
        {SYNTAX_HINTS.map((h) => (
          <button key={h.token} title={h.desc} onClick={() => setQ((v: string) => `${v.trim()} ${h.token}`.trim())}>{h.token}</button>
        ))}
      </div>

      <div className="searchdlg__cols">
        <div className="searchdlg__side">
          <h4><Clock size={14} /> 最近搜索</h4>
          {ws.recentSearches.length === 0 && <p className="muted">暂无</p>}
          {ws.recentSearches.slice(0, 6).map((s) => (
            <button key={s} className="side-link" onClick={() => setQ(s)}><Search size={13} /> {s}</button>
          ))}
          <h4><Bookmark size={14} /> 保存的搜索</h4>
          {ws.savedSearches.length === 0 && <p className="muted">暂无</p>}
          {ws.savedSearches.map((s) => (
            <button key={s.id} className="side-link" onClick={() => { setQ(s.query); setNav({ kind: 'savedSearch', id: s.id }); closeDialog(); }}>
              <ListFilter size={13} /> {s.name}
            </button>
          ))}
        </div>
        <div className="searchdlg__results">
          <h4>{q.trim() ? `${results.length} 条结果` : '最近更新的笔记'}</h4>
          {results.length === 0 && <p className="muted">没有匹配的笔记，换个关键词或检查语法。</p>}
          {results.map((h) => (
            <button key={h.note.id} className="search-result" onClick={() => open(h.note.id)}>
              <strong dangerouslySetInnerHTML={{ __html: highlight(h.note.title || '未命名笔记', q) }} />
              <span dangerouslySetInnerHTML={{ __html: highlight(excerpt(plainOf(h.note), 90), q) }} />
              <em>{nbName(h.note.notebookId)} · {formatDateTime(h.note.updatedAt).slice(5, 16)}</em>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ==================== 自定义侧栏 ==================== */

export function SidebarDialog() {
  const { ws, actions, closeDialog } = useApp();
  return (
    <Modal title="自定义侧栏" subtitle="和印象笔记一样，用不到的区块可以隐藏；随时能再打开" width={480}
      icon={<Settings2 size={19} />} onClose={closeDialog}
      footer={<Btn variant="primary" onClick={closeDialog}>完成</Btn>}>
      <div className="sidebar-toggles">
        {SECTION_LABELS.map((s) => (
          <label key={s.key} className="sidebar-toggle">
            <input type="checkbox" checked={ws.sidebarSections[s.key]}
              onChange={(e) => actions.setSidebarSection(s.key, e.target.checked)} />
            <span>{s.label}</span>
            {ws.sidebarSections[s.key] && <Check size={14} />}
          </label>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 12 }}>「全部笔记」是主入口，隐藏后仍可用顶部搜索或首页进入笔记。</p>
    </Modal>
  );
}

/* ==================== 笔记信息 ==================== */

export function NoteInfoDialog() {
  const { ws, dialog, activeId, closeDialog, openDialog, toast, actions } = useApp();
  const id = dialog.payload?.id || activeId;
  const note = ws.notes.find((n) => n.id === id);
  if (!note) return null;
  const nb = ws.notebooks.find((n) => n.id === note.notebookId);
  const text = plainOf(note);
  const versions = ws.noteHistory[note.id] || [];
  const rows: [string, string][] = [
    ['创建时间', formatDateTime(note.createdAt)],
    ['最后修改', formatDateTime(note.updatedAt)],
    ['当前视图', note.mode === 'rich' ? '富文本（所见即所得）' : 'Markdown 源码'],
    ['所属笔记本', nb?.name || '未分类'],
    ['标签', note.tags.length ? note.tags.map((t) => `#${t}`).join('  ') : '无'],
    ['字数 / 字符', `${wordCount(text).toLocaleString('zh-CN')} 字 / ${text.length.toLocaleString('zh-CN')} 字符`],
    ['附件', `${note.attachments?.length || 0} 个（${((note.attachments || []).reduce((s, a) => s + a.size, 0) / 1024).toFixed(1)} KB）`],
    ['来源网址', note.sourceUrl || '无'],
    ['提醒', note.reminderAt ? formatDateTime(note.reminderAt) : '无'],
    ['历史版本', `${versions.length} 个（最多保留 15 个）`],
  ];
  return (
    <Modal title="笔记信息" subtitle={note.title || '未命名笔记'} width={540} icon={<FileText size={19} />}
      onClose={closeDialog}
      footer={<>
        <Btn onClick={() => { actions.snapshot(note.id); toast('已保存一个版本'); }}><Save size={14} /> 保存版本</Btn>
        <Btn onClick={() => openDialog('history', { id: note.id })}><History size={14} /> 查看历史</Btn>
        <Btn onClick={() => {
          void navigator.clipboard.writeText(`[[${note.title || '未命名笔记'}]]`);
          toast('笔记内链已复制');
        }}><Copy size={14} /> 复制内链</Btn>
        <Btn variant="primary" onClick={closeDialog}>关闭</Btn>
      </>}>
      <div className="info-rows">
        {rows.map(([k, v]) => <div key={k}><span>{k}</span><strong>{v}</strong></div>)}
      </div>
    </Modal>
  );
}

/* ==================== 笔记历史 ==================== */

export function HistoryDialog() {
  const { ws, dialog, activeId, closeDialog, actions, toast } = useApp();
  const id = dialog.payload?.id || activeId;
  const note = ws.notes.find((n) => n.id === id);
  const versions = [...(ws.noteHistory[id || ''] || [])].reverse();
  const preview = (v: { content: string; mode: 'rich' | 'markdown' }) => {
    if (!note) return { text: '', words: 0 };
    const text = plainOf({ ...note, content: v.content, mode: v.mode });
    return { text: excerpt(text, 92) || '（空白）', words: wordCount(text) };
  };
  return (
    <Modal title="笔记历史" subtitle={`本地快照，最多保留 15 个 · ${note?.title || ''}`} width={620}
      icon={<History size={19} />} onClose={closeDialog}
      footer={<>
        <Btn variant="danger" onClick={() => { if (id) actions.clearHistory(id); }}><Trash2 size={14} /> 清空历史</Btn>
        <Btn variant="primary" onClick={closeDialog}>关闭</Btn>
      </>}>
      {versions.length === 0 && <div className="empty-inline">
        <History size={28} /><p>还没有历史快照。</p>
        <span>正文改动会自动每隔约 1 分钟存一版，也可以在「更多」里手动保存版本。</span>
      </div>}
      <div className="history-list">
        {versions.map((v) => (
          <div key={v.id} className="history-row">
            <div><strong>{formatDateTime(v.at)}</strong><em>{v.mode === 'rich' ? '富文本' : 'Markdown'} · {preview(v).words} 字</em></div>
            <p>{preview(v).text}</p>
            <Btn variant="subtle" onClick={() => {
              if (!id) return;
              actions.restoreVersion(id, v.id);
              closeDialog();
              toast('已恢复到该版本');
            }}><RotateCcw size={14} /> 恢复此版本</Btn>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ==================== 查找替换 ==================== */

export function FindReplaceDialog() {
  const { ws, dialog, activeId, closeDialog, actions, toast } = useApp();
  const id = dialog.payload?.id || activeId;
  const note = ws.notes.find((n) => n.id === id);
  const [find, setFind] = useState(dialog.payload?.find || '');
  const [repl, setRepl] = useState('');
  if (!note) return null;
  const hits = countInContent(note.content, note.mode, find);

  const doReplace = (all: boolean) => {
    if (!find) { toast('先填要查找的内容', 'err'); return; }
    const r = replaceInContent(note.content, note.mode, find, repl, all);
    if (!r.count) { toast('没有找到匹配内容', 'err'); return; }
    actions.updateNote(note.id, { content: r.content });
    toast(`已替换 ${r.count} 处`);
  };

  return (
    <Modal title="在笔记中查找 / 替换" subtitle={note.title || '未命名笔记'} width={500}
      icon={<Search size={19} />} onClose={closeDialog}
      footer={<>
        <span className="muted" style={{ marginRight: 'auto' }}>{find ? `命中 ${hits} 处` : '输入后显示命中数'}</span>
        <Btn disabled={!find} onClick={() => doReplace(false)}>替换一处</Btn>
        <Btn variant="primary" disabled={!find} onClick={() => doReplace(true)}>全部替换</Btn>
      </>}>
      <Field label="查找"><input className="input" autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="要找的文字" /></Field>
      <Field label="替换为"><input className="input" value={repl} onChange={(e) => setRepl(e.target.value)} placeholder="留空表示删除" /></Field>
      <p className="muted" style={{ marginTop: 10 }}>富文本只替换正文文字，不会破坏标签、链接与图片；替换后自动保存并写入历史快照。</p>
    </Modal>
  );
}

export function SaveSearchDialog() {
  const { query, closeDialog, actions } = useApp();
  const [name, setName] = useState(query.trim().slice(0, 24));
  return (
    <Modal title="保存搜索" subtitle="保存后会出现在侧栏「快捷方式」区，点一下就能重跑" width={440}
      icon={<Bookmark size={19} />} onClose={closeDialog}
      footer={<>
        <Btn onClick={closeDialog}>取消</Btn>
        <Btn variant="primary" disabled={!name.trim() || !query.trim()} onClick={() => {
          actions.addSavedSearch(name, query);
          closeDialog();
        }}>保存</Btn>
      </>}>
      <Field label="名称"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="查询"><code className="code-line">{query || '（当前没有搜索词）'}</code></Field>
    </Modal>
  );
}

/** 给标题栏与列表共用的语法提示文案。 */
export const SEARCH_SYNTAX_SUMMARY = SYNTAX_HINTS.map((h) => h.token).join('  ');
export { freeTextOf };

/* ==================== 附件 / 图片 / 文档预览 ==================== */

/** data URL → 文本：HTML / Markdown / CSV / 纯文本类附件直接读，不用先下载。 */
function dataUrlToText(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return '';
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  try {
    if (!/;base64/i.test(head)) return decodeURIComponent(body);
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

/** 任意 data URL → 原始字节的 base64，供「用本机程序打开」写临时文件。 */
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

type DocState =
  | { kind: 'idle' } | { kind: 'loading' }
  | { kind: 'ready'; html: string }
  | { kind: 'error'; message: string };

export function AttachmentPreviewDialog() {
  const { ws, dialog, activeId, closeDialog, toast } = useApp();
  const p = dialog.payload || {};
  const note = ws.notes.find((n) => n.id === (p.noteId || activeId));
  const att = note?.attachments?.find((a) => a.id === p.attId);
  const rawSrc: string = att?.dataUrl || p.src || '';
  const name: string = att?.name || p.name || '附件';
  const mime: string = guessMime(name, att?.mime || (rawSrc.startsWith('data:image') ? 'image/*' : ''), att?.kind);
  // 旧附件可能存成了 application/octet-stream；按扩展名补回来才播得动。
  const src: string = normalizeMediaUrl(rawSrc, name, mime, att?.kind);
  const size = att?.size || 0;
  const [mediaError, setMediaError] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [doc, setDoc] = useState<DocState>({ kind: 'idle' });

  // 2.5.9：从「插入图片 / 文件」通道进来的附件带 noMedia 标记，
  // 预览时不再嗅探它是不是音视频，一律按图片 / 普通文件展示。
  const tag = att?.noMedia ? null : mediaTagOf(name, mime, rawSrc, att?.kind);
  const isImage = att?.kind === 'image' || att?.kind === 'board' || /^image\//i.test(mime) || /^data:image\//i.test(src);
  const isPdf = /pdf/i.test(mime) || /\.pdf$/i.test(name);
  const isAudio = tag === 'audio';
  const isVideo = tag === 'video';
  const isHtml = /\.(html?|mhtml)$/i.test(name) || /^text\/html/i.test(mime);
  /** 需要走「文档还原渲染」的格式：OOXML、网页、Markdown、表格、纯文本。 */
  const isDoc = !isImage && !isPdf && !isAudio && !isVideo
    && (/\.(docx?|docm|dotx|xlsx?|xlsm|xlsb|pptx?|pptm|ppsx|csv|tsv|html?|mhtml|md|markdown|txt|log|json|xml|yaml|yml|js|ts|jsx|tsx|css|scss|py|java|go|rs|sql|sh|bat|ini|conf|enex)$/i.test(name)
      || /^text\//i.test(mime));
  /** 只有文本类才需要把 data URL 解成字符串，避免对二进制 Office 做无谓解码。 */
  const isTextual = /\.(html?|mhtml|md|markdown|txt|log|json|xml|yaml|yml|csv|tsv|js|ts|jsx|tsx|css|scss|py|java|go|rs|sql|sh|bat|ini|conf|enex)$/i.test(name)
    || /^text\//i.test(mime);
  const text = useMemo(() => (isTextual ? dataUrlToText(rawSrc).slice(0, 300000) : ''), [rawSrc, isTextual]);

  useEffect(() => {
    if (!isDoc || !src) { setDoc({ kind: 'idle' }); return; }
    let alive = true;
    setDoc({ kind: 'loading' });
    void buildDocPreview(name, dataUrlToBytes(src), text).then((r) => {
      if (!alive) return;
      setDoc(r.html ? { kind: 'ready', html: r.html } : { kind: 'error', message: r.error || '无法预览' });
    });
    return () => { alive = false; };
  }, [src, name, text, isDoc]);

  const download = () => {
    if (!src) { toast('这个附件没有可下载的内容', 'err'); return; }
    const comma = src.indexOf(',');
    if (/;base64/i.test(src.slice(0, comma))) {
      void storage.saveBinary(name, src.slice(comma + 1), mime || 'application/octet-stream')
        .then(() => toast(`已导出「${name}」`))
        .catch((e) => toast(`导出失败：${String(e)}`, 'err'));
      return;
    }
    const a = document.createElement('a');
    a.href = src; a.download = name; a.click();
  };

  /** 内嵌渲染再保真也不如 Word / Excel / WPS 自己打开：桌面版给一个完整还原的出口。 */
  const openExternal = async () => {
    if (!src) return;
    try {
      const ok = await storage.openWithSystem(name, bytesToBase64(dataUrlToBytes(src)));
      if (!ok) { toast('离线版不能直接调用本机程序，请先「下载原文件」再打开', 'err'); return; }
      toast(`已交给本机默认程序打开「${name}」`);
    } catch (e) {
      toast(`打开失败：${String(e)}`, 'err');
    }
  };

  // 2.5.9：卡片与信息卡只展示名称 + 大小，不再跟一串英文 MIME / 格式说明。
  const fallback = (
    <div className="preview-filecard">
      <FileBadge name={name} mime={mime} kind={att?.kind} size="lg" />
      <div className="preview-filecard__info">
        <strong>{name}</strong>
        <span>{formatSize(size)}</span>
      </div>
      <p>这个文件不能内嵌还原格式，可以点「用本机程序打开」或「下载原文件」，由本机软件完整打开。</p>
    </div>
  );

  // HTML 附件是用户原始文档，严格隔离（不给 same-origin）；
  // 其余页面是本应用生成的，允许同源以便检查渲染结果与多工作表切换。
  const docSandbox = isHtml ? 'allow-scripts allow-popups allow-forms'
    : 'allow-scripts allow-same-origin allow-popups';

  const docView = doc.kind === 'loading'
    ? <div className="empty-inline"><FileText size={28} /><p>正在还原文档格式…</p></div>
    : doc.kind === 'error'
      ? <><p className="settings-note">{doc.message}</p>{fallback}</>
      : doc.kind === 'ready'
        ? <iframe className="preview-frame preview-frame--doc" title={name}
            sandbox={docSandbox} srcDoc={doc.html} />
        : null;

  return (
    <Modal title={name} subtitle={
      att ? `${formatSize(size)} · 来自「${note?.title || '未命名笔记'}」`
        : '正文里引用的外部图片'
    } width={980} icon={<FileBadge name={name} mime={mime} kind={att?.kind} size="md" />} onClose={closeDialog}
      footer={<>
        {isHtml && <Btn onClick={() => setShowSource((v) => !v)}>
          {showSource ? '渲染视图' : '查看网页源码'}
        </Btn>}
        {att && <Btn onClick={() => { void openExternal(); }}><ExternalLink size={14} /> 用本机程序打开</Btn>}
        <Btn onClick={download}><Download size={14} /> 下载原文件</Btn>
        <Btn variant="primary" onClick={closeDialog}>关闭</Btn>
      </>}>
      {!src && <div className="empty-inline"><FileText size={28} /><p>找不到这个附件。</p>
        <span>可能已经从笔记里移除，或者换了一份存档。</span></div>}
      {src && isImage && <img className="preview-img" src={src} alt={name} />}
      {src && isPdf && <iframe className="preview-frame" src={src} title={name} />}
      {src && isVideo && (
        <>
          <video className="preview-video" src={src} controls autoPlay playsInline
            onError={() => setMediaError(true)} />
          {mediaError && <p className="settings-note">浏览器没能解码这个视频（容器或编码不受支持，例如 HEVC / MKV）。
            可以点「用本机程序打开」或「下载原文件」用本机播放器打开。</p>}
        </>
      )}
      {src && isAudio && (
        <>
          <audio className="preview-audio" src={src} controls autoPlay
            onError={() => setMediaError(true)} />
          {mediaError && <p className="settings-note">浏览器没能解码这个音频（格式不受支持）。
            可以点「用本机程序打开」或「下载原文件」用本机播放器打开。</p>}
        </>
      )}
      {src && isDoc && isHtml && showSource && <pre className="preview-text">{text || '（空文件）'}</pre>}
      {src && isDoc && !(isHtml && showSource) && docView}
      {src && !isImage && !isPdf && !isAudio && !isVideo && !isDoc && fallback}
    </Modal>
  );
}
