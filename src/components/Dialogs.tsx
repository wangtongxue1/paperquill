import { useMemo, useRef, useState } from 'react';
import {
  Archive, Bell, Braces, CalendarDays, Check, Clipboard, Clock, Copy, Database, Download,
  FileDown, FileText, FolderInput, Globe, Info, Keyboard, Moon, Monitor, Palette,
  Plus, Printer, RefreshCw, Scissors, Settings2, Sun, Tag, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { useApp } from '../context';
import type { EditorMode, Note, Settings, SortKey, ThemeMode } from '../types';
import { mdToHtml, htmlToMd } from '../convert';
import { clipToNote, exportBackup, exportEnex, exportMarkdownZip, parseImport, printNote } from '../io';
import { isDesktop, storage } from '../storage';
import { formatDateTime, templatePreview } from '../utils';
import { Btn, Field, IconBtn, Modal, Segmented } from './Common';
import DateTimePop, { dateTimeToTimestamp, timestampToDateTime } from './DateTimePop';
import TemplateIcon from './TemplateIcon';
import BoardDialog from './BoardDialog';
import ExportDialog from './ExportDialog';
import { emptyWorkspace, seedWorkspace } from '../data';
import {
  AttachmentPreviewDialog, FindReplaceDialog, HistoryDialog, NoteInfoDialog, SaveSearchDialog,
  SearchDialog, SidebarDialog,
} from './ExtraDialogs';

const CLIP_BOOKMARKLET = `javascript:(function(){var s=window.getSelection().toString();var t=document.title;var u=location.href;var esc=function(x){return x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};var h='<h2>'+esc(t)+'</h2><p>来源：<a href="'+esc(u)+'">'+esc(u)+'</a></p>'+(s?'<blockquote>'+esc(s)+'</blockquote>':'');navigator.clipboard.writeText(h).then(function(){alert('已复制，回到纸间笔记粘贴到剪藏面板')});})();`;

/* --------------------------- 通用输入 / 确认 --------------------------- */

function PromptDialog() {
  const { dialog, closeDialog } = useApp();
  const p = dialog.payload || {};
  const [value, setValue] = useState<string>(p.value || '');
  const confirm = () => { const v = value.trim(); if (!v) return; p.onConfirm?.(v); closeDialog(); };
  return (
    <Modal title={p.title || '输入'} subtitle={p.subtitle} width={430}
      onClose={closeDialog}
      footer={<><Btn onClick={closeDialog}>取消</Btn><Btn variant="primary" onClick={confirm} disabled={!value.trim()}>确定</Btn></>}>
      <Field label={p.label || '名称'}>
        <input className="input" autoFocus value={value} placeholder={p.placeholder || ''}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
      </Field>
    </Modal>
  );
}

function ConfirmDialog() {
  const { dialog, closeDialog } = useApp();
  const p = dialog.payload || {};
  const choices: { label: string; danger?: boolean; onConfirm: () => void }[] = p.choices || [
    { label: p.confirmLabel || '确定', danger: p.danger, onConfirm: p.onConfirm || (() => {}) },
  ];
  return (
    <Modal title={p.title || '确认'} width={440} onClose={closeDialog}
      icon={<Info size={19} />}
      footer={<><Btn onClick={closeDialog}>取消</Btn>
        {choices.map((c, i) => (
          <Btn key={i} variant={c.danger ? 'danger' : i === choices.length - 1 ? 'primary' : 'subtle'}
            onClick={() => { c.onConfirm(); closeDialog(); }}>{c.label}</Btn>
        ))}</>}>
      <p className="confirm-text">{p.message}</p>
    </Modal>
  );
}

/* --------------------------- 移动 / 标签 --------------------------- */

function MoveDialog() {
  const { dialog, closeDialog, ws, actions, toast } = useApp();
  const p = dialog.payload || {};
  const isNotebook = p.kind === 'notebook';
  const [target, setTarget] = useState<string>('');
  const options = isNotebook
    ? [{ value: '', label: '不分组' }, ...ws.groups.map((g) => ({ value: g.id, label: g.name }))]
    : [{ value: '', label: '未分类' }, ...ws.notebooks.map((nb) => ({ value: nb.id, label: nb.name }))];
  const submit = () => {
    if (isNotebook) actions.updateNotebook(p.id, { groupId: target || null });
    else actions.moveNotes(p.ids || [], target || null);
    toast(isNotebook ? '已移到目标组' : '已移动笔记');
    closeDialog();
  };
  return (
    <Modal title={isNotebook ? '把笔记本移到…' : `移动 ${(p.ids || []).length} 篇笔记到…`} width={430}
      onClose={closeDialog} icon={<FolderInput size={19} />}
      footer={<><Btn onClick={closeDialog}>取消</Btn><Btn variant="primary" onClick={submit}>移动</Btn></>}>
      <Field label={isNotebook ? '目标笔记本组' : '目标笔记本'}>
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

function TagDialog() {
  const { dialog, closeDialog, ws, actions } = useApp();
  const ids: string[] = dialog.payload?.ids || [];
  const [value, setValue] = useState('');
  const existing = Array.from(new Set(ws.notes.filter((n) => !n.trashed).flatMap((n) => n.tags))).sort((a, b) => a.localeCompare(b, 'zh'));
  const submit = (tag: string) => { if (!tag.trim()) return; actions.addTagTo(ids, tag); closeDialog(); };
  return (
    <Modal title={`给 ${ids.length} 篇笔记加标签`} width={430} onClose={closeDialog} icon={<Tag size={19} />}
      footer={<><Btn onClick={closeDialog}>取消</Btn><Btn variant="primary" onClick={() => submit(value)} disabled={!value.trim()}>添加</Btn></>}>
      <Field label="标签名">
        <input className="input" autoFocus value={value} placeholder="例如：灵感" onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(value); }} />
      </Field>
      {existing.length > 0 && <div className="chip-picker">
        {existing.map((t) => <button key={t} onClick={() => submit(t)}>#{t}</button>)}
      </div>}
    </Modal>
  );
}

function TagManagerDialog() {
  const { closeDialog, ws, actions, openDialog } = useApp();
  const live = ws.notes.filter((n) => !n.trashed);
  const tags = useMemo(
    () => Array.from(new Set(live.flatMap((n) => n.tags))).sort((a, b) => a.localeCompare(b, 'zh')),
    [ws.notes] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  return (
    <Modal title="标签管理" subtitle="重命名会同步改掉所有笔记上的这个标签" width={480}
      onClose={closeDialog} icon={<Tag size={19} />}
      footer={<Btn variant="primary" onClick={closeDialog}>完成</Btn>}>
      {tags.length === 0 && <p className="muted">还没有标签。在编辑器标题下方输入标签名并回车即可添加。</p>}
      <div className="tag-manager">
        {tags.map((t) => (
          <div key={t} className="tag-manager__row">
            {editing === t ? (
              <input className="input" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
                onBlur={() => { if (value.trim() && value.trim() !== t) actions.renameTagEverywhere(t, value); setEditing(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { if (value.trim() && value.trim() !== t) actions.renameTagEverywhere(t, value); setEditing(null); }
                  if (e.key === 'Escape') setEditing(null);
                }} />
            ) : (
              <span className="tag-manager__name" onClick={() => { setEditing(t); setValue(t); }}>#{t}</span>
            )}
            <span className="tag-manager__count">{live.filter((n) => n.tags.includes(t)).length} 篇</span>
            <IconBtn title="重命名" onClick={() => { setEditing(t); setValue(t); }}><FileText size={14} /></IconBtn>
            <IconBtn title="删除标签" danger onClick={() => openDialog('confirm', {
              title: `移除标签「${t}」？`, message: '会从所有笔记上摘掉，笔记本身不受影响。',
              confirmLabel: '移除', danger: true, onConfirm: () => actions.removeTagFromAll(t),
            })}><Trash2 size={14} /></IconBtn>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* --------------------------- 提醒 --------------------------- */

function ReminderDialog() {
  const { dialog, closeDialog, ws, actions, toast } = useApp();
  const id: string = dialog.payload?.id;
  const note = ws.notes.find((n) => n.id === id);
  // 和笔记正文插入日期时间用同一个选择器、同一个值格式（YYYY-MM-DD HH:mm），
  // 不再用系统原生 datetime-local 弹层（又大又割裂，还会溢出弹窗盖住按钮）。
  const [value, setValue] = useState(() => timestampToDateTime(note?.reminderAt || Date.now() + 3600_000));
  const [pickerOpen, setPickerOpen] = useState(true);
  const preset = (hours: number) => setValue(timestampToDateTime(Date.now() + hours * 3600_000));
  const tomorrow9 = () => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    setValue(timestampToDateTime(d.getTime()));
  };
  return (
    <Modal title="设置提醒" subtitle="到点后纸间笔记会在应用内提示；程序没打开时不会补发系统通知" width={420}
      onClose={closeDialog} icon={<Bell size={19} />}
      footer={<>
        {note?.reminderAt && <Btn variant="danger" onClick={() => { actions.updateNote(id, { reminderAt: null, reminderDone: false }); closeDialog(); }}>清除提醒</Btn>}
        <Btn onClick={closeDialog}>取消</Btn>
        <Btn variant="primary" onClick={() => {
          const ts = dateTimeToTimestamp(value);
          if (Number.isNaN(ts)) { toast('时间格式不对', 'err'); return; }
          actions.updateNote(id, { reminderAt: ts, reminderDone: false });
          toast(`提醒设在 ${formatDateTime(ts)}`);
          closeDialog();
        }}>保存提醒</Btn>
      </>}>
      <div className="field">
        <span className="field__label">提醒时间</span>
        <button type="button" className="input dtp-field" title="展开 / 收起日历"
          onClick={() => setPickerOpen((v) => !v)}>
          <CalendarDays size={14} />
          <span className="dtp-field__value">{value}</span>
          <span className="dtp-field__hint">{pickerOpen ? '收起' : '选择'}</span>
        </button>
      </div>
      {pickerOpen && (
        <DateTimePop docked label="提醒时间" value={value}
          onConfirm={setValue} onCancel={() => setPickerOpen(false)} />
      )}
      <div className="preset-row">
        <button onClick={() => preset(1)}>1 小时后</button>
        <button onClick={() => preset(3)}>3 小时后</button>
        <button onClick={tomorrow9}>明天 9:00</button>
        <button onClick={() => preset(24 * 7)}>下周</button>
      </div>
      {note?.reminderAt && !note.reminderDone && (
        <button className="link-btn" onClick={() => { actions.updateNote(id, { reminderDone: true }); closeDialog(); }}>
          <Check size={14} /> 标记这条提醒为已完成
        </button>
      )}
    </Modal>
  );
}

/* --------------------------- 模板 --------------------------- */

function TemplatesDialog() {
  const { dialog, closeDialog, ws, actions, openDialog, toast } = useApp();
  const insertInto: string | undefined = dialog.payload?.insertInto;
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const useTemplate = (tpl: { name: string; content: string; icon: string }) => {
    const target = insertInto ? ws.notes.find((n) => n.id === insertInto) : null;
    // 插到已有笔记里就跟着那篇的模式走，别把 Markdown 语法灌进富文本。
    const mode = target ? target.mode : ws.settings.defaultMode;
    const content = mode === 'rich' ? mdToHtml(tpl.content) : tpl.content;
    if (target) {
      const sep = mode === 'rich' ? '<hr>' : '\n\n---\n\n';
      actions.updateNote(target.id, {
        content: target.content.trim() ? `${target.content}${sep}${content}` : content,
      });
      toast(`已把「${tpl.name}」插到当前笔记末尾`);
      closeDialog();
      return;
    }
    actions.createNote({ title: `${tpl.name} · ${formatDateTime(Date.now()).slice(0, 10)}`, content, mode });
    closeDialog();
    toast(`已用「${tpl.name}」新建笔记`);
  };

  const saveCurrentAsTemplate = () => {
    const note = insertInto ? ws.notes.find((n) => n.id === insertInto) : null;
    if (!note) { toast('先打开一篇笔记，才能把它存成模板', 'err'); return; }
    openDialog('prompt', {
      title: '保存为模板', label: '模板名称', placeholder: '例如：复盘模板',
      onConfirm: (name: string) => {
        // 模板正文统一存 Markdown，富文本笔记先转回来，否则模板用出来是一坨标签。
        actions.addTemplate(name, note.mode === 'rich' ? htmlToMd(note.content) : note.content);
        toast('模板已保存（取当前笔记的正文）');
      },
    });
  };

  return (
    <Modal title={insertInto ? '插入模板' : '从模板新建'} subtitle={insertInto ? '内容会追加到当前笔记末尾' : '内置 6 套，也可以把当前笔记存成自己的模板'}
      width={620} onClose={closeDialog} icon={<Wand2 size={19} />}
      footer={<>
        <Btn onClick={() => setCreating(!creating)}><Plus size={14} /> 自定义模板</Btn>
        {insertInto && <Btn variant="subtle" onClick={saveCurrentAsTemplate}>把当前笔记存成模板</Btn>}
        <Btn onClick={closeDialog}>关闭</Btn>
      </>}>
      {creating && <div className="inline-create">
        <input className="input" autoFocus placeholder="模板名称" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Btn variant="primary" disabled={!newName.trim()} onClick={() => { actions.addTemplate(newName, ''); setNewName(''); setCreating(false); }}>添加</Btn>
        <span className="muted">这只是个空模板；想带内容，就把写好的一篇笔记「存成模板」。</span>
      </div>}
      <div className="template-grid">
        {ws.templates.map((t) => (
          <div key={t.id} className="template-card" onClick={() => useTemplate(t)}>
            <TemplateIcon icon={t.icon} />
            <strong>{t.name}</strong>
            <p>{t.desc || templatePreview(t.content, 42) || '空白笔记，从零开始写'}</p>
            {!t.builtin && (
              <button className="template-card__del" title="删除模板" onClick={(e) => { e.stopPropagation(); actions.deleteTemplate(t.id); }}>
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* --------------------------- 剪藏 --------------------------- */

function ClipDialog() {
  const { closeDialog, actions, toast, ws } = useApp();
  const [tab, setTab] = useState<'paste' | 'url' | 'bookmark'>('paste');
  const [html, setHtml] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [asMarkdown, setAsMarkdown] = useState(true);
  const [loading, setLoading] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  const create = (rawHtml: string, sourceUrl?: string) => {
    if (!rawHtml.trim()) { toast('还没有内容可剪藏', 'err'); return; }
    const note = clipToNote(rawHtml, { title, url: sourceUrl, asMarkdown });
    actions.createNote({
      title: note.title, content: note.content, mode: note.mode,
      sourceUrl: note.sourceUrl, tags: note.tags,
    });
    closeDialog();
    toast(`已剪藏「${note.title}」`);
  };

  const fetchUrl = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const raw = await storage.fetchClip(url.trim());
      create(raw, url.trim());
    } catch (e) {
      toast(`抓取失败：${String(e)}`, 'err');
    } finally { setLoading(false); }
  };

  return (
    <Modal title="网页剪藏" subtitle="粘贴 HTML、抓公开网址、或用书签小工具把选中内容带回来" width={680}
      onClose={closeDialog} icon={<Scissors size={19} />}
      footer={<Btn onClick={closeDialog}>关闭</Btn>}>
      <div className="tabs">
        <button className={tab === 'paste' ? 'is-active' : ''} onClick={() => setTab('paste')}><Clipboard size={14} /> 粘贴 HTML</button>
        <button className={tab === 'url' ? 'is-active' : ''} onClick={() => setTab('url')}><Globe size={14} /> 公开网址</button>
        <button className={tab === 'bookmark' ? 'is-active' : ''} onClick={() => setTab('bookmark')}><Braces size={14} /> 书签小工具</button>
      </div>

      {tab === 'paste' && <>
        <p className="muted">在浏览器里复制一段网页内容，回到这里粘贴到下面的框里。脚本、事件属性会被清掉，图片、链接、表格会保留。</p>
        <textarea ref={pasteRef} className="input textarea" rows={7} value={html}
          placeholder="在这里粘贴网页 HTML（也可以粘贴书签小工具复制出来的片段）…"
          onChange={(e) => setHtml(e.target.value)} />
        <div className="form-row">
          <Field label="标题（留空自动取网页标题）"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="自动识别" /></Field>
          <Field label="来源网址（可选）"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
        </div>
        <label className="checkline"><input type="checkbox" checked={asMarkdown} onChange={(e) => setAsMarkdown(e.target.checked)} /> 转成 Markdown 存放（否则存富文本 HTML）</label>
        <div className="dialog-actions"><Btn variant="primary" onClick={() => create(html, url.trim() || undefined)} disabled={!html.trim()}><Scissors size={14} /> 生成剪藏笔记</Btn></div>
      </>}

      {tab === 'url' && <>
        <p className="muted">桌面版由 Rust 侧直接抓取网页，不受浏览器跨域限制。默认会挡掉本机 / 内网 / 云元数据地址。</p>
        <Field label="公开网址"><input className="input" value={url} placeholder="https://example.com/article"
          onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void fetchUrl(); }} /></Field>
        <Field label="标题（留空自动取）"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="自动识别" /></Field>
        <label className="checkline"><input type="checkbox" checked={asMarkdown} onChange={(e) => setAsMarkdown(e.target.checked)} /> 转成 Markdown 存放</label>
        <div className="dialog-actions">
          <Btn variant="primary" disabled={!url.trim() || loading} onClick={() => void fetchUrl()}>
            {loading ? '抓取中…' : <><Download size={14} /> 抓取并剪藏</>}
          </Btn>
          {!isDesktop() && <span className="muted">浏览器预览模式可能被 CORS 拦住，桌面版没有这个限制。</span>}
        </div>
      </>}

      {tab === 'bookmark' && <>
        <p className="muted">把下面这段代码拖到浏览器书签栏。在任意网页选中一段文字后点它，会把「标题 + 网址 + 选中内容」复制到剪贴板，回来切到「粘贴 HTML」一键粘贴即可。</p>
        <textarea className="input textarea mono" rows={5} readOnly value={CLIP_BOOKMARKLET} onFocus={(e) => e.target.select()} />
        <div className="dialog-actions">
          <Btn variant="primary" onClick={async () => {
            try { await navigator.clipboard.writeText(CLIP_BOOKMARKLET); toast('书签代码已复制'); }
            catch { toast('复制失败，请手动全选复制', 'err'); }
          }}><Copy size={14} /> 复制书签代码</Btn>
          <Btn onClick={() => { setTab('paste'); setTimeout(() => pasteRef.current?.focus(), 50); }}>去粘贴</Btn>
        </div>
        <div className="notice-box">
          边界说清楚：浏览器右键菜单里的「一键剪藏到纸间笔记」依赖扩展商店上架，桌面版不做那个假按钮。
          书签小工具是浏览器自带能力，不安装任何扩展、不联网上报。
        </div>
      </>}
    </Modal>
  );
}

/* --------------------------- 导入导出 --------------------------- */

/** 编辑器内导入：选完文件后问一句「怎么放」。 */
function ImportModeDialog() {
  const { dialog, closeDialog } = useApp();
  const p = dialog.payload || {};
  const pick = (how: 'replace' | 'append' | 'new') => { closeDialog(); p.onPick?.(how); };
  return (
    <Modal title="导入到这篇笔记" subtitle={`${p.label || '文件'} · 已解析完成`} width={560}
      onClose={closeDialog} icon={<FolderInput size={19} />}
      footer={<Btn onClick={closeDialog}>取消</Btn>}>
      <div className="import-modes">
        <button className="import-mode" onClick={() => pick('replace')}>
          <RefreshCw size={18} />
          <strong>覆盖当前正文</strong>
          <span>这篇笔记原来的内容被替换，标题、标签、提醒都保留。</span>
        </button>
        <button className="import-mode" onClick={() => pick('append')}>
          <Plus size={18} />
          <strong>追加到末尾</strong>
          <span>原来写的内容保留，中间加一条分割线再接进来。</span>
        </button>
        <button className="import-mode" onClick={() => pick('new')}>
          <FileText size={18} />
          <strong>存成一篇新笔记</strong>
          <span>当前这篇不动，导入结果放进列表最前面。</span>
        </button>
      </div>
      <p className="muted">导入的内容会统一转成富文本，表格、待办、样式都能直接用；附件也会一起并进来。</p>
    </Modal>
  );
}

function IoDialog() {
  const { closeDialog, ws, actions, openDialog, toast, dataDir, activeId } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const current = ws.notes.find((n) => n.id === activeId);

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      let imported = 0;
      for (const file of files) {
        const result = await parseImport(file);
        if (result.workspace) {
          const backup = result.workspace;
          openDialog('confirm', {
            title: '恢复完整备份？', danger: true, confirmLabel: '覆盖并恢复',
            message: `备份里有 ${backup.notes?.length ?? 0} 篇笔记。恢复会替换当前的全部笔记、笔记本与标签，建议先导出一份现在的备份。`,
            onConfirm: () => actions.replaceWorkspace(backup),
          });
        } else if (result.notes?.length) {
          actions.importNotes(result.notes);
          imported += result.notes.length;
        }
      }
      if (imported) toast(`已导入 ${imported} 篇笔记`);
    } catch (e) {
      toast(`导入失败：${String(e)}`, 'err');
    } finally { setBusy(false); }
  };

  const saveText = async (name: string, content: string, mime = 'text/plain;charset=utf-8') => {
    try { await storage.saveText(name, content, mime); toast(`已导出 ${name}`); }
    catch (e) { toast(`导出失败：${String(e)}`, 'err'); }
  };

  const exportZip = async () => {
    try {
      const b64 = await exportMarkdownZip(ws);
      await storage.saveBinary(`纸间笔记-全库-${formatDateTime(Date.now()).slice(0, 10)}.zip`, b64, 'application/zip');
      toast('全库 Markdown 已打包');
    } catch (e) { toast(`导出失败：${String(e)}`, 'err'); }
  };

  return (
    <Modal title="导入与导出" subtitle="所有格式都在本机处理，不经过任何服务器" width={660}
      onClose={closeDialog} icon={<FileDown size={19} />}
      footer={<Btn onClick={closeDialog}>关闭</Btn>}>
      <div className={`dropzone dropzone--hero ${drag ? 'is-drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void handleFiles(Array.from(e.dataTransfer.files)); }}
        onClick={() => fileRef.current?.click()}>
        <Upload size={26} />
        <div className="dropzone__text">
          <strong>{busy ? '正在导入…' : '导入文件，变成笔记'}</strong>
          <span>Markdown / 纯文本 / HTML / ENEX（印象笔记导出）/ JSON（纸间笔记备份）</span>
        </div>
        <button type="button" className="btn btn--primary dropzone__cta"
          onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
          <Upload size={15} /> 选择文件
        </button>
        <input ref={fileRef} type="file" multiple hidden
          accept=".md,.markdown,.txt,.html,.htm,.enex,.xml,.json"
          onChange={(e) => { void handleFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
      </div>
      <p className="muted dropzone__tip">想覆盖或追加到某一篇已经在写的笔记？打开那篇笔记，用工具栏上的「导入」按钮。</p>

      <h4 className="section-title">整库导出</h4>
      <div className="export-grid">
        <button onClick={() => void saveText(`纸间笔记-备份-${formatDateTime(Date.now()).slice(0, 10)}.json`, exportBackup(ws), 'application/json')}>
          <Database size={17} /><strong>完整备份 JSON</strong><span>含标签、提醒、回收站，可原样恢复</span>
        </button>
        <button onClick={() => void exportZip()}>
          <Archive size={17} /><strong>全库 Markdown ZIP</strong><span>按笔记本分目录，一篇一个 .md</span>
        </button>
        <button onClick={() => void saveText(`纸间笔记-${formatDateTime(Date.now()).slice(0, 10)}.enex`, exportEnex(ws.notes.filter((n) => !n.trashed)), 'application/xml')}>
          <FileText size={17} /><strong>全库 ENEX</strong><span>可导入印象笔记等支持 ENEX 的软件</span>
        </button>
      </div>

      <h4 className="section-title">当前笔记</h4>
      {current ? <>
        <div className="export-inline">
          <Btn variant="primary" onClick={() => openDialog('export', { ids: [current.id] })}>
            <FileDown size={13} /> 导出这篇…
          </Btn>
          <Btn onClick={() => printNote(current)}><Printer size={13} /> 打印</Btn>
        </div>
        <p className="muted">Markdown / HTML / PDF / 纯文本 / ENEX 都在同一个导出面板里选；笔记列表里多选后右键，可以一次打包导出多篇。</p>
      </> : <p className="muted">先在中间列表里选一篇笔记。</p>}

      <h4 className="section-title">数据在哪</h4>
      <div className="datadir-box">
        <Database size={15} /><code>{dataDir || '浏览器本地存储（IndexedDB）'}</code>
        {isDesktop() && <Btn onClick={() => void storage.openDataDir()}>打开目录</Btn>}
      </div>
      <p className="muted">桌面版每篇笔记还会镜像成 <code>notes/*.md</code> 或 <code>notes/*.html</code>，能用记事本 / git / grep 直接打开。</p>
    </Modal>
  );
}

/* --------------------------- 设置 / 关于 --------------------------- */

function SettingsDialog() {
  const { closeDialog, ws, actions, openDialog, toast, dataDir } = useApp();
  const s: Settings = ws.settings;
  const patch = (p: Partial<Settings>) => actions.setSettings(p);
  const [dirInput, setDirInput] = useState(dataDir || '');
  const [busyDir, setBusyDir] = useState(false);

  const applyDir = async () => {
    const v = dirInput.trim();
    if (!v) { toast('请填写目录', 'err'); return; }
    if (v === dataDir) { toast('路径没有变化'); return; }
    setBusyDir(true);
    try {
      await storage.setDataDir(v);
      toast('数据目录已切换，正在重新载入…');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) { toast(`切换失败：${String(e)}`, 'err'); setBusyDir(false); }
  };
  const resetDir = async () => {
    setBusyDir(true);
    try {
      await storage.resetDataDir();
      toast('已恢复默认目录，正在重新载入…');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (e) { toast(`恢复失败：${String(e)}`, 'err'); setBusyDir(false); }
  };
  const chooseDir = async () => {
    const p = await storage.pickDataDir();
    if (p) setDirInput(p);
  };
  return (
    <Modal title="设置" subtitle="全部只存在本机" width={620} onClose={closeDialog}
      icon={<Settings2 size={19} />} footer={<Btn variant="primary" onClick={closeDialog}>完成</Btn>}>
      <div className="settings-grid">
        <Field label="外观主题">
          <Segmented<ThemeMode> value={s.theme} onChange={(v) => patch({ theme: v })} options={[
            { value: 'light', label: '浅色', icon: <Sun size={13} /> },
            { value: 'dark', label: '深色', icon: <Moon size={13} /> },
            { value: 'system', label: '跟随系统', icon: <Monitor size={13} /> },
          ]} />
        </Field>
        <Field label="新笔记默认视图" hint="源码视图可在编辑器右上角「更多」里随时切换">
          <Segmented<EditorMode> value={s.defaultMode} onChange={(v) => patch({ defaultMode: v })} options={[
            { value: 'rich', label: '富文本', icon: <Palette size={13} /> },
            { value: 'markdown', label: '源码视图', icon: <Braces size={13} /> },
          ]} />
        </Field>
        <Field label="新笔记默认放进">
          <select className="input" value={s.defaultNotebookId || ''} onChange={(e) => patch({ defaultNotebookId: e.target.value || null })}>
            <option value="">未分类</option>
            {ws.notebooks.map((nb) => <option key={nb.id} value={nb.id}>{nb.name}</option>)}
          </select>
        </Field>
        <Field label="自动保存延迟" hint="编辑器停止输入后多久写一次盘">
          <select className="input" value={s.autoSaveMs} onChange={(e) => patch({ autoSaveMs: Number(e.target.value) })}>
            <option value={300}>0.3 秒</option><option value={600}>0.6 秒（默认）</option>
            <option value={1200}>1.2 秒</option><option value={2500}>2.5 秒</option>
          </select>
        </Field>
        <Field label={`侧栏宽度 · ${s.sidebarWidth}px（也可拖动分隔条）`}>
          <input type="range" min={180} max={380} step={2} value={s.sidebarWidth}
            onChange={(e) => patch({ sidebarWidth: Number(e.target.value) })} />
        </Field>
        <Field label={`列表宽度 · ${s.listWidth}px（也可拖动分隔条）`}>
          <input type="range" min={260} max={560} step={2} value={s.listWidth}
            onChange={(e) => patch({ listWidth: Number(e.target.value) })} />
        </Field>
      </div>
      <label className="checkline"><input type="checkbox" checked={s.showWordCount} onChange={(e) => patch({ showWordCount: e.target.checked })} /> 编辑器底栏显示字数</label>
      <label className="checkline"><input type="checkbox" checked={s.contentThumbnails} onChange={(e) => patch({ contentThumbnails: e.target.checked, showThumbnails: e.target.checked })} /> 把笔记里的第一张图用作列表缩略图</label>
      <p className="settings-note">默认关闭：正文里插入的图片只是内容，不是笔记的封面 / LOGO；打开后才会把首图显示在列表项左侧。</p>

      <h4 className="section-title">导航与检索</h4>
      <div className="settings-nav-row">
        <Btn onClick={() => openDialog('sidebar')}><Settings2 size={14} /> 自定义侧栏区块</Btn>
        <Btn onClick={() => openDialog('search')}><Globe size={14} /> 高级搜索语法</Btn>
        <span className="muted">侧栏支持首页 / 任务 / 文件 / 日历 / 模板；搜索支持 tag: has: created: 等语法。</span>
      </div>

      <h4 className="section-title">数据目录</h4>
      <div className="datadir-box"><Database size={15} /><code>{dataDir || '浏览器本地存储（IndexedDB）'}</code>
        {isDesktop() && <Btn onClick={() => void storage.openDataDir()}>打开目录</Btn>}
      </div>
      {isDesktop() && (
        <div className="datadir-edit">
          <div className="datadir-row">
            <input className="input" value={dirInput} onChange={(e) => setDirInput(e.target.value)}
              placeholder="输入新目录，例如 D:\我的笔记" />
            <Btn onClick={() => void chooseDir()} disabled={busyDir}>选择…</Btn>
          </div>
          <div className="datadir-actions">
            <Btn variant="primary" onClick={() => void applyDir()} disabled={busyDir}>应用并重新载入</Btn>
            <Btn onClick={() => void resetDir()} disabled={busyDir}>恢复默认</Btn>
            <span className="muted">切换时会把现有存档与 notes/ 复制到新目录，旧目录保留可回退。</span>
          </div>
        </div>
      )}

      <h4 className="section-title">危险操作</h4>
      <div className="danger-row">
        <Btn variant="danger" onClick={() => openDialog('confirm', {
          title: '清空并恢复示例数据？', danger: true, confirmLabel: '清空并重置',
          message: '当前所有笔记、笔记本、标签都会被删掉，无法撤销。建议先在「导入导出」里做一份完整备份。',
          onConfirm: () => { actions.replaceWorkspace(seedWorkspace()); toast('已恢复示例数据'); },
        })}><Trash2 size={14} /> 清空全部数据</Btn>
        <Btn onClick={() => openDialog('confirm', {
          title: '清空成空白工作区？', danger: true, confirmLabel: '清空',
          message: '删除全部笔记、笔记本与自定义模板，只保留内置模板。',
          onConfirm: () => { actions.replaceWorkspace(emptyWorkspace()); toast('工作区已清空'); },
        })}>清空成空白工作区</Btn>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl / ⌘ + N', '新建笔记'],
  ['Ctrl / ⌘ + S', '立即保存'],
  ['Ctrl / ⌘ + F', '聚焦全局搜索'],
  ['Ctrl / ⌘ + K', '插入笔记内链'],
  ['Ctrl / ⌘ + Shift + T', '从模板新建'],
  ['Ctrl / ⌘ + Shift + C', '网页剪藏'],
  ['Ctrl / ⌘ + Shift + E', '导入导出'],
  ['Ctrl / ⌘ + B / I / U', '加粗 / 斜体 / 下划线'],
  ['Ctrl + 点击 / Shift + 点击', '多选 / 连选笔记'],
  ['Ctrl / ⌘ + A', '全选当前列表'],
  ['Esc', '关闭弹窗 / 取消多选'],
];

function AboutDialog() {
  const { closeDialog, ws } = useApp();
  const live = ws.notes.filter((n) => !n.trashed);
  return (
    <Modal title="关于纸间笔记" subtitle="本地优先的个人笔记 · v2.5.10" width={620}
      onClose={closeDialog} icon={<Info size={19} />}
      footer={<Btn variant="primary" onClick={closeDialog}>知道了</Btn>}>
      <div className="about-stat">
        <div><strong>{live.length}</strong><span>篇笔记</span></div>
        <div><strong>{ws.notebooks.length}</strong><span>个笔记本</span></div>
        <div><strong>{new Set(live.flatMap((n) => n.tags)).size}</strong><span>个标签</span></div>
        <div><strong>{ws.templates.length}</strong><span>套模板</span></div>
      </div>
      <p className="about-text">纸间笔记不是云服务的客户端：没有账号、没有同步、没有遥测。笔记以 <code>workspace.json</code> 为单一事实源，
        同时把每篇镜像成普通 <code>.md</code> / <code>.html</code> 文件；关掉这个程序，数据仍然躺在你自己的磁盘上，
        换任何编辑器都打得开。</p>
      <h4 className="section-title"><Keyboard size={15} /> 快捷键</h4>
      <div className="shortcut-table">
        {SHORTCUTS.map(([k, v]) => <div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}
      </div>
      <h4 className="section-title">如实说明的边界</h4>
      <ul className="about-limits">
        <li>网页剪藏靠「粘贴 HTML / 公开网址 / 书签小工具」，浏览器右键一键剪藏需要扩展商店上架，本版没有做，界面里也没有假按钮。</li>
        <li>提醒是应用内提醒：程序没打开时不会补发系统通知。</li>
        <li>富文本用 WebView 自带的编辑能力，复杂 Word 排版（分栏、批注、修订）不在范围内。</li>
        <li>浏览器预览模式的数据在 IndexedDB 里；桌面版才写磁盘文件。两种模式可以用备份 JSON 互搬。</li>
      </ul>
    </Modal>
  );
}

export default function DialogHost() {
  const { dialog } = useApp();
  switch (dialog.kind) {
    case 'prompt': return <PromptDialog />;
    case 'confirm': return <ConfirmDialog />;
    case 'move': return <MoveDialog />;
    case 'tag': return <TagDialog />;
    case 'tagManager': return <TagManagerDialog />;
    case 'reminder': return <ReminderDialog />;
    case 'templates': return <TemplatesDialog />;
    case 'clip': return <ClipDialog />;
    case 'io': return <IoDialog />;
    case 'export': return <ExportDialog />;
    case 'settings': return <SettingsDialog />;
    case 'search': return <SearchDialog />;
    case 'sidebar': return <SidebarDialog />;
    case 'noteInfo': return <NoteInfoDialog />;
    case 'history': return <HistoryDialog />;
    case 'findReplace': return <FindReplaceDialog />;
    case 'saveSearch': return <SaveSearchDialog />;
    case 'preview': return <AttachmentPreviewDialog />;
    case 'board': return <BoardDialog key={dialog.payload?.boardId || 'new-board'} />;
    case 'import': return <ImportModeDialog />;
    case 'about':
    case 'shortcuts': return <AboutDialog />;
    default: return null;
  }
}
