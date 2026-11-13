import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, Bold, Bookmark, Braces, CalendarClock, Check, ChevronDown, Code2, Columns2, Copy, Eye,
  FileDown, FileInput, FileSearch, FileText, Frame, History, ImagePlus, Info,
  Italic, Link2, List, ListChecks, ListOrdered, Minus, MoreHorizontal, MoveRight, Music, Palette,
  Paperclip, PenLine, Pin, Printer, Quote, Save, Star, Strikethrough, Table2, Tags, Trash2, Video, Wand2, X,
} from 'lucide-react';
import { useApp } from '../context';
import type { Attachment, BoardDoc, EditorMode, Note } from '../types';
import { attachmentRef, convertContent, mdToHtml, referencedAttachmentIds } from '../convert';
import { mergeIntoNote, parseImport, printNote } from '../io';
import { invoke, isDesktop } from '../storage';
import { escapeHtml, formatDateTime, formatSize, plainOf, readFileAsDataUrl, uid, wordCount } from '../utils';
import { guessMime, kindOf, normalizeMediaUrl, fileChannelKind } from '../media';
import { findStringRanges, replaceRanges as replaceStringRanges, type FindRange } from '../find';
import { Btn, Empty, IconBtn, Menu, Segmented, type MenuItem } from './Common';
import RichEditor, { type RichEditorHandle } from './RichEditor';
import MarkdownPane from './MarkdownPane';
import FindBar from './FindBar';
import { FileBadge } from './FileBadge';

type PreviewMode = 'edit' | 'split' | 'preview';

export default function Editor() {
  const {
    ws, activeId, setActiveId, setNav, actions, openDialog, toast, saveState,
  } = useApp();
  const note: Note | null = ws.notes.find((n) => n.id === activeId) ?? null;

  const [draft, setDraft] = useState({ title: '', content: '' });
  const [mode, setMode] = useState<EditorMode>('markdown');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('split');
  const [tagInput, setTagInput] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /* 编辑器内查找 / 替换条（Ctrl+F / Ctrl+H） */
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findRepl, setFindRepl] = useState('');
  const [findReplaceShown, setFindReplaceShown] = useState(false);
  const [findCase, setFindCase] = useState(false);
  const [findHits, setFindHits] = useState<FindRange[]>([]);
  const [findAt, setFindAt] = useState(-1);
  const [findToken, setFindToken] = useState(0);
  /** Ctrl+Shift+V 期间置位：下一次 paste 只取纯文本（源码视图用）。 */
  const plainPaste = useRef(false);

  const richHandle = useRef<RichEditorHandle>(null);
  const mdRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const draftRef = useRef(draft);
  const noteIdRef = useRef<string | null>(null);
  const lastPushed = useRef<{ id: string; title: string; content: string } | null>(null);
  const flushRef = useRef<() => void>(() => {});
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const modeRef = useRef<EditorMode>(mode);
  modeRef.current = mode;
  const wsRef = useRef(ws);
  wsRef.current = ws;
  /** 上一次正文里引用到的附件集合：用来判断「正文删掉了图，附件也该回收」。 */
  const refSet = useRef<Set<string>>(new Set());
  /** 待回收的孤儿附件，绑定所属笔记 id：切笔记后也能删对那一篇，不会串到别的笔记。 */
  const pendingDrop = useRef<{ noteId: string; ids: string[] } | null>(null);
  const sweepTimer = useRef<number | null>(null);
  /** 当前高亮命中的文档/字符串位置，用来在重算后停回原处。 */
  const findFromRef = useRef(-1);
  const locateOnSync = useRef(false);
  /** 键盘监听里要拿最新的查找动作，避免闭包捕获旧状态。 */
  const findApiRef = useRef<{ go: (d: number) => void; close: () => void }>({ go: () => {}, close: () => {} });

  /* ---------- 草稿同步与自动保存 ---------- */

  useEffect(() => {
    if (!note) return;
    if (noteIdRef.current !== note.id) {
      // 切走之前先把上一篇的孤儿附件立刻落定。旧版在这里直接 clearTimeout +
      // 清空队列，导致「删了图就快速切笔记」时待删附件被丢弃、永远留在附件区。
      flushOrphans();
      noteIdRef.current = note.id;
      const d = { title: note.title, content: note.content };
      draftRef.current = d;
      setDraft(d);
      setMode(note.mode);
      lastPushed.current = { id: note.id, title: note.title, content: note.content };
      setTagInput('');
      setFindOpen(false);
      setFindHits([]);
      setFindAt(-1);
      findFromRef.current = -1;
      refSet.current = referencedAttachmentIds(note.content, note.mode);
      pendingDrop.current = null;
      if (sweepTimer.current) { window.clearTimeout(sweepTimer.current); sweepTimer.current = null; }
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 附件回收：正文里删掉的图 / 视频，附件区里也别留着 ---------- */

  /** 立即把待回收队列落定：先按「当前草稿」复核一遍（宽限期内 Ctrl+Z 找回的图不能删），
   *  再按队列里绑定的 noteId 删除。定时器到点 / 切笔记 / 关窗口都走这里。 */
  const flushOrphans = () => {
    if (sweepTimer.current) { window.clearTimeout(sweepTimer.current); sweepTimer.current = null; }
    const p = pendingDrop.current;
    pendingDrop.current = null;
    if (!p || !p.ids.length) return;
    const stillUsed = referencedAttachmentIds(draftRef.current.content, modeRef.current);
    const dead = p.ids.filter((x) => !stillUsed.has(x));
    if (!dead.length) return;
    actionsRef.current.pruneAttachments(p.noteId, dead);
    toast(`已清理 ${dead.length} 个正文里不再引用的附件`);
  };

  const armSweep = () => {
    if (sweepTimer.current) window.clearTimeout(sweepTimer.current);
    // 宽限期只留给 Ctrl+Z。旧版 1600ms 且要等自动保存才排队（合计 2.2s），
    // 现在正文一删就排队、800ms 落定；切笔记时由 flushOrphans 立即提前结算。
    sweepTimer.current = window.setTimeout(() => { sweepTimer.current = null; flushOrphans(); }, 800);
  };

  const checkOrphans = (content: string, noteId: string) => {
    const now = referencedAttachmentIds(content, modeRef.current);
    const gone = [...refSet.current].filter((x) => !now.has(x));
    if (gone.length) {
      const prev = pendingDrop.current?.noteId === noteId ? pendingDrop.current.ids : [];
      pendingDrop.current = { noteId, ids: Array.from(new Set([...prev, ...gone])) };
      armSweep();
    }
    refSet.current = now;
  };

  const pushNow = () => {
    const d = draftRef.current;
    const id = noteIdRef.current;
    if (!id) return;
    const prev = lastPushed.current;
    if (prev && prev.id === id && prev.title === d.title && prev.content === d.content) return;
    lastPushed.current = { id, title: d.title, content: d.content };
    actionsRef.current.updateNote(id, { title: d.title || '未命名笔记', content: d.content });
    checkOrphans(d.content, id);
  };

  const schedule = (d: { title: string; content: string }) => {
    draftRef.current = d;
    setDraft(d);
    // 内容一变就立刻比对引用，别等自动保存（删图后附件不该再等 600ms 才有反应）。
    if (noteIdRef.current) checkOrphans(d.content, noteIdRef.current);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; pushNow(); }, ws.settings.autoSaveMs || 600);
  };

  const clearTimer = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
  };

  // 切笔记 / 关窗口前把草稿落下去，并顺手把待回收的孤儿附件立即结算，
  // 不依赖最后一个 debounce 周期，也不依赖 800ms 的回收宽限期。
  flushRef.current = () => { clearTimer(); pushNow(); flushOrphans(); };
  useEffect(() => () => flushRef.current(), [activeId]);

  // 外部改动（模板插入、批量操作、恢复备份）时，只要没有尚未落盘的草稿就同步回来，
  // 否则用户在编辑器里写的东西会被旧快照覆盖。
  useEffect(() => {
    if (!note || note.id !== noteIdRef.current) return;
    const pushed = lastPushed.current;
    if (pushed && pushed.id === note.id && note.content !== pushed.content && !timer.current) {
      const d = { title: note.title, content: note.content };
      draftRef.current = d;
      setDraft(d);
      lastPushed.current = { id: note.id, title: d.title, content: d.content };
    }
  }, [note?.content, note?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 编辑器内查找 / 替换（Ctrl+F / Ctrl+H） ----------
   *  与「全局搜索」分开：这里命中的是当前笔记正文，能逐条跳、逐条替换。
   *  富文本走 ProseMirror 文档区间 + 视图层高亮；源码视图走 textarea 字符串。 */

  /** 重新取一次命中表。 */
  const computeFind = (q = findQuery, cs = findCase): FindRange[] =>
    mode === 'rich'
      ? (richHandle.current?.findAll(q, cs) ?? [])
      : findStringRanges(draftRef.current.content, q, cs);

  /** 把命中表写进视图层：富文本挂高亮 decoration + 选中当前项，源码视图只记位置。 */
  const syncFind = (ranges: FindRange[], at: number) => {
    const idx = ranges.length ? Math.max(0, Math.min(at, ranges.length - 1)) : -1;
    setFindHits(ranges);
    setFindAt(idx);
    findFromRef.current = idx >= 0 ? ranges[idx].from : -1;
    if (mode === 'rich') {
      richHandle.current?.setFind(ranges, idx);
      richHandle.current?.selectRange(idx >= 0 ? ranges[idx] : null);
    }
    return idx;
  };

  // 查询 / 大小写 / 打开状态 / 模式变化都重算一次，保证计数与高亮同步。
  useEffect(() => {
    if (!findOpen) {
      if (mode === 'rich') richHandle.current?.setFind([], -1);
      return;
    }
    const ranges = computeFind();
    let at = 0;
    if (findFromRef.current >= 0) {
      const j = ranges.findIndex((r) => r.from >= findFromRef.current);
      at = j >= 0 ? j : 0;
    }
    const idx = syncFind(ranges, at);
    if (locateOnSync.current && mode === 'markdown' && idx >= 0) {
      locateOnSync.current = false;
      const ta = mdRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(ranges[idx].from, ranges[idx].to); }
      setFindToken((t) => t + 1); // 焦点交还查找框
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen, findQuery, findCase, mode, findToken]);

  /** 上一条 / 下一条；源码视图顺手把 textarea 选区挪过去，再把焦点还给查找框。 */
  const goFind = (delta: number) => {
    const ranges = computeFind();
    if (!ranges.length) { syncFind([], -1); return; }
    const next = delta === 0
      ? Math.max(0, ranges.findIndex((r) => r.from >= findFromRef.current))
      : ((findAt < 0 ? -1 : findAt) + delta + ranges.length) % ranges.length;
    const idx = syncFind(ranges, next);
    if (mode === 'markdown') {
      const ta = mdRef.current;
      if (ta && idx >= 0) { ta.focus(); ta.setSelectionRange(ranges[idx].from, ranges[idx].to); }
      setFindToken((t) => t + 1);
    }
  };

  /** 替换一处 / 全部替换。富文本一个事务完成，可一次 Ctrl+Z 撤销。 */
  const replaceFind = (all: boolean) => {
    if (!findQuery) return;
    const ranges = computeFind();
    if (!ranges.length) { toast('没有找到匹配内容', 'err'); return; }
    const idx = findAt < 0 ? 0 : findAt;
    const indices = all ? ranges.map((_, i) => i) : [idx];
    if (mode === 'rich') richHandle.current?.replaceRanges(ranges, indices, findRepl);
    else schedule({ ...draftRef.current, content: replaceStringRanges(draftRef.current.content, ranges, indices, findRepl) });
    flushRef.current(); // 替换立即落盘，不等自动保存
    const again = computeFind();
    syncFind(again, all ? 0 : Math.min(idx, Math.max(0, again.length - 1)));
    toast(`已替换 ${indices.length} 处`);
  };

  const closeFind = () => {
    setFindOpen(false);
    setFindHits([]);
    setFindAt(-1);
    findFromRef.current = -1;
    if (mode === 'rich') richHandle.current?.setFind([], -1);
  };
  findApiRef.current = { go: goFind, close: closeFind };

  useEffect(() => {
    if (!note) return;
    const onFindEvt = (e: Event) => {
      const d = (e as CustomEvent<{ replace?: boolean }>).detail || {};
      // 告诉 App「编辑器已接管」，别再开全局搜索弹窗。
      e.preventDefault();
      let sel = '';
      if (mode === 'rich') sel = richHandle.current?.getSelectedText() || '';
      else {
        const ta = mdRef.current;
        if (ta && ta.selectionEnd > ta.selectionStart) sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      }
      if (sel && sel.length <= 120 && !/\n/.test(sel)) setFindQuery(sel);
      if (d.replace) setFindReplaceShown(true);
      findFromRef.current = -1;
      locateOnSync.current = true;
      setFindOpen(true);
      setFindToken((t) => t + 1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!findOpen) return;
      if (e.key === 'Escape') { findApiRef.current.close(); return; }
      if (e.key === 'F3') { e.preventDefault(); findApiRef.current.go(e.shiftKey ? -1 : 1); }
    };
    window.addEventListener('zhijian:editor-find', onFindEvt);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('zhijian:editor-find', onFindEvt);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, mode, findOpen]);

  /* ---------- 模式切换：原地转换，不开新笔记 ---------- */

  const doSwitchMode = (target: EditorMode) => {
    if (!note || target === mode) return;
    clearTimer();
    pushNow();
    const converted = convertContent(draftRef.current.content, mode, target, note.attachments || []);
    actions.switchMode(note.id, target);
    const d = { title: draftRef.current.title, content: converted };
    draftRef.current = d;
    setDraft(d);
    setMode(target);
    lastPushed.current = { id: note.id, title: d.title, content: converted };
  };

  /* ---------- Markdown 命令 ---------- */

  const insertMd = (before: string, after = '', placeholder = '') => {
    const ta = mdRef.current;
    const content = draftRef.current.content;
    const s = ta?.selectionStart ?? content.length;
    const e = ta?.selectionEnd ?? s;
    const sel = content.slice(s, e) || placeholder;
    const next = content.slice(0, s) + before + sel + after + content.slice(e);
    schedule({ ...draftRef.current, content: next });
    requestAnimationFrame(() => {
      const el = mdRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };

  const prefixLines = (prefix: string) => {
    const ta = mdRef.current;
    const content = draftRef.current.content;
    const s = ta?.selectionStart ?? 0;
    const e = ta?.selectionEnd ?? s;
    const lineStart = content.lastIndexOf('\n', s - 1) + 1;
    const lineEnd = content.indexOf('\n', e) === -1 ? content.length : content.indexOf('\n', e);
    const block = content.slice(lineStart, lineEnd);
    // 先剥掉已有的标题 / 列表 / 待办 / 引用前缀再统一加，避免点两次变成「- [ ] - [ ]」。
    const lines = block.split('\n').map((l) => {
      const m = l.match(/^(\s*)(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)?(.*)$/);
      const indent = m ? m[1] : '';
      const body = m ? m[2] : l;
      return indent + prefix + body;
    });
    const next = content.slice(0, lineStart) + lines.join('\n') + content.slice(lineEnd);
    schedule({ ...draftRef.current, content: next });
  };

  /* ---------- 图片与附件 ---------- */

  /** 正文里只写短引用，不把整段 base64 灌进源码框；预览与导出时再还原。 */
  const insertAttachment = (att: Attachment) => {
    if (mode === 'rich') {
      richHandle.current?.insertAttachment(att);
      return;
    }
    const name = escapeHtml(att.name.replace(/[\]\n\r]/g, '')).replace(/["']/g, '');
    const ref = attachmentRef(att.id);
    const ta = mdRef.current;
    const c = draftRef.current.content;
    const pos = ta?.selectionStart ?? c.length;
    // 音视频在源码视图里也写成播放器标签（短引用），预览与切回富文本都能直接播；
    // 旧版只写 [名称](链接)，点开才是弹窗，看起来像「上传后不能播放」。
    const ins = att.kind === 'image' ? `\n![${name}](${ref})\n`
      : att.kind === 'audio' || att.kind === 'video'
        ? `\n\n<${att.kind} controls src="${ref}" data-att-id="${att.id}" data-name="${name}"></${att.kind}>\n\n`
        : `\n[${name}](${ref})\n`;
    schedule({ ...draftRef.current, content: c.slice(0, pos) + ins + c.slice(pos) });
  };

  /** 老存档里 octet-stream 的附件在展示 / 预览时也补一次 MIME。 */
  const attSrc = (att: Attachment) => normalizeMediaUrl(att.dataUrl, att.name, att.mime, att.kind);

  /** 单文件上限：图片给得多一点，音视频再高一些，其它文件保持克制。
   *  正文里的附件是 base64 内嵌的，体积直接进存档，所以不能无限放宽。 */
  const LIMIT_MB: Record<string, number> = { image: 8, audio: 24, video: 32, file: 5 };

  /** 2.5.9：两个上传通道彻底分开。
   *  - file（插入图片 / 文件、拖放、粘贴）：只按「是不是图片」分两类，
   *    不去检测视频 / 语音内容，也不会把文档当成播放器渲染。
   *  - media（插入语音 / 视频）：才做扩展名 + MIME 的音视频识别。 */
  const handleFiles = async (files: File[], channel: 'file' | 'media' = 'file') => {
    if (!note) return;
    const added: Attachment[] = [];
    for (const f of files) {
      // 扩展名优先：Windows 上 .m4a/.mkv/.mov 等常常没有系统 MIME，
      // 只看 f.type 会把它们当普通文件、data URL 也会变成 octet-stream 而播不了。
      const kind = channel === 'media' ? kindOf(f.name, f.type) : fileChannelKind(f.name, f.type);
      const limit = (LIMIT_MB[kind] || 5) * 1024 * 1024;
      if (f.size > limit) {
        toast(`「${f.name}」超过 ${LIMIT_MB[kind]} MB，已跳过`, 'err');
        continue;
      }
      try {
        const raw = await readFileAsDataUrl(f);
        const mime = guessMime(f.name, f.type, kind);
        // 把 FileReader 写错的 MIME 段改对，<audio>/<video> 才肯解码。
        const dataUrl = channel === 'media' ? normalizeMediaUrl(raw, f.name, mime, kind) : raw;
        const att: Attachment = {
          id: uid('att'), name: f.name,
          mime,
          size: f.size, kind, dataUrl, createdAt: Date.now(),
          ...(channel === 'file' ? { noMedia: true } : {}),
        };
        added.push(att);
        insertAttachment(att);
        toast(`已插入「${f.name}」`);
      } catch {
        toast(`读取「${f.name}」失败`, 'err');
      }
    }
    if (added.length) {
      actions.updateNote(note.id, { attachments: [...(note.attachments || []), ...added] });
      added.forEach((a) => refSet.current.add(a.id));
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (mode === 'rich') return; // 富文本的粘贴交给 Tiptap 内核处理
    const plain = plainPaste.current;
    plainPaste.current = false;
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) {
      e.preventDefault();
      void handleFiles(files);
      return;
    }
    if (plain) {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      if (text) insertMd(text, '', '');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) { e.preventDefault(); void handleFiles(files); }
  };

  /* ---------- 导入到当前这篇笔记 ---------- */

  const importIntoNote = async (file: File | undefined) => {
    if (!file || !note) return;
    try {
      const res = await parseImport(file);
      if (res.workspace) {
        openDialog('confirm', {
          title: '恢复完整备份？', danger: true, confirmLabel: '覆盖并恢复',
          message: `备份里有 ${res.workspace.notes?.length ?? 0} 篇笔记。恢复会替换整个工作区，建议先导出一份现在的备份。`,
          onConfirm: () => actions.replaceWorkspace(res.workspace!),
        });
        return;
      }
      const incoming = res.notes?.[0];
      if (!incoming) { toast('这个文件里没有可导入的内容', 'err'); return; }
      openDialog('import', {
        label: res.label,
        onPick: (how: 'replace' | 'append' | 'new') => {
          if (how === 'new') { actions.importNotes(res.notes!); return; }
          const target = wsRef.current.notes.find((n) => n.id === note.id) || note;
          const patch = mergeIntoNote(target, incoming, how);
          actions.updateNote(note.id, patch);
          const d = { title: draftRef.current.title, content: patch.content };
          draftRef.current = d;
          setDraft(d);
          lastPushed.current = { id: note.id, title: d.title, content: d.content };
          refSet.current = referencedAttachmentIds(patch.content, patch.mode);
          toast(how === 'replace' ? `已用「${file.name}」覆盖正文` : `已把「${file.name}」追加到末尾`);
        },
      });
    } catch (e) {
      toast(`导入失败：${String(e)}`, 'err');
    }
  };

  /* ---------- 画板 ---------- */

  const openBoard = (boardId?: string) => {
    if (!note) return;
    const targetId = note.id;
    openDialog('board', {
      noteId: targetId,
      boardId,
      onSaved: (att: Attachment, isNew: boolean) => {
        const latest = wsRef.current.notes.find((n) => n.id === targetId);
        const atts = [...((latest?.attachments) || []).filter((a) => a.boardId !== att.boardId), att];
        actions.updateNote(targetId, { attachments: atts });
        if (isNew) {
          insertAttachment(att);
          refSet.current.add(att.id);
        } else {
          // 画板改了：正文里那张快照的图要换成新的，不然看到还是旧的
          richHandle.current?.updateBoardImage(att.boardId!, att.dataUrl);
        }
      },
    });
  };

  const boardCount = (note?.boards || []).length;

  /* ---------- 导出 PDF / 打印 ---------- */

  /** 当前编辑中的内容（还没落盘的那份也算）。 */
  const liveNote = (): Note | null => note && ({
    ...note,
    title: draftRef.current.title || '未命名笔记',
    content: draftRef.current.content,
    mode,
  });

  const doPrint = () => {    const current = liveNote();
    if (!current) return;
    flushRef.current();
    printNote(current);
  };



  /* ---------- 内链 / 外链 ---------- */

  const openWiki = (title: string) => {
    const hit = ws.notes.find((n) => !n.trashed && n.title.toLowerCase() === title.toLowerCase());
    if (hit) { flushRef.current(); setActiveId(hit.id); setNav({ kind: 'all' }); }
    else toast(`还没有「${title}」这篇笔记，可以先新建它`, 'err');
  };

  const openUrl = async (href: string) => {
    try {
      if (isDesktop()) await invoke('open_url', { url: href });
      else window.open(href, '_blank', 'noopener');
    } catch { toast('打开链接失败', 'err'); }
  };

  const openPreview = (attId: string, src?: string, name?: string) => {
    if (!note) return;
    openDialog('preview', { attId, src, name, noteId: note.id });
  };

  const askLink = (kind: 'url' | 'wiki') => {
    openDialog('prompt', {
      title: kind === 'url' ? '插入链接' : '插入笔记内链',
      label: kind === 'url' ? '网址' : '目标笔记标题',
      placeholder: kind === 'url' ? 'https://example.com' : '例如：欢迎来到纸间笔记',
      onConfirm: (v: string) => {
        if (!v.trim()) return;
        if (kind === 'wiki') {
          const safe = v.trim().replace(/[<>&"]/g, '');
          insertMd(`[[${safe}]]`, '', safe);
        } else {
          insertMd('[', `](${v.trim()})`, '链接文字');
        }
      },
    });
  };

  /* ---------- 源码视图里点复选框：回写 Markdown ---------- */

  const toggleMarkdownTask = (box: HTMLInputElement) => {
    const idx = Number(box.getAttribute('data-task-line'));
    if (!Number.isFinite(idx) || idx < 0) return;
    let seen = -1;
    let changed = false;
    const next = draftRef.current.content.split('\n').map((line) => {
      if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) {
        seen += 1;
        if (seen === idx) {
          changed = true;
          return line.replace(/\[([ xX])\]/, (_m, c: string) =>
            c.toLowerCase() === 'x' ? '[ ]' : '[x]');
        }
      }
      return line;
    });
    if (changed) schedule({ ...draftRef.current, content: next.join('\n') });
  };

  const onPreviewClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const box = target.closest('input[type="checkbox"]') as HTMLInputElement | null;
    if (box) {
      e.preventDefault();
      toggleMarkdownTask(box);
      return;
    }
    const img = target.closest('img') as HTMLImageElement | null;
    if (img) {
      e.preventDefault();
      openPreview(img.getAttribute('data-att-id') || '', img.getAttribute('src') || '', img.getAttribute('alt') || '');
      return;
    }
    const a = target.closest('a');
    if (!a) return;
    const attId = a.getAttribute('data-att-id');
    if (attId) {
      e.preventDefault();
      openPreview(attId, a.getAttribute('href') || '', a.textContent || '');
      return;
    }
    const wiki = a.getAttribute('data-wiki');
    if (wiki) { e.preventDefault(); openWiki(wiki); return; }
    const href = a.getAttribute('href');
    if (href && /^https?:\/\//i.test(href)) { e.preventDefault(); await openUrl(href); }
  };

  /* ---------- 菜单 ---------- */

  /** 统一走导出面板：先把草稿落盘，面板读的是工作区里的最新内容。 */
  const openExport = () => {
    if (!note) return;
    flushRef.current();
    openDialog('export', { ids: [note.id] });
  };

  const moreMenu = (e: React.MouseEvent) => {
    if (!note) return;
    e.preventDefault(); e.stopPropagation();
    const items: MenuItem[] = [
      {
        label: mode === 'rich' ? '源码视图（Markdown）' : '返回富文本视图',
        icon: <Braces size={14} />,
        onClick: () => doSwitchMode(mode === 'rich' ? 'markdown' : 'rich'),
      },
      { label: '', divider: true },
      { label: '笔记信息…', icon: <Info size={14} />, onClick: () => openDialog('noteInfo', { id: note.id }) },
      { label: '查找 / 替换…', icon: <FileSearch size={14} />, onClick: () => openDialog('findReplace', { id: note.id }) },
      { label: '笔记历史…', icon: <History size={14} />, onClick: () => openDialog('history', { id: note.id }) },
      { label: '保存一个版本', icon: <Save size={14} />, onClick: () => actions.snapshot(note.id) },
      { label: '把当前笔记存成模板', icon: <Wand2 size={14} />, onClick: () =>
        openDialog('prompt', { title: '保存为模板', label: '模板名称', value: note.title,
          onConfirm: (v: string) => actions.addTemplate(v, draftRef.current.content) }) },
      { label: '', divider: true },
      { label: ws.shortcuts.some((s) => s.kind === 'note' && s.refId === note.id) ? '从快捷方式移除' : '添加到快捷方式',
        icon: <Bookmark size={14} />, onClick: () => actions.toggleShortcut('note', note.id, note.title || '未命名笔记') },
      { label: '设置提醒…', icon: <Bell size={14} />, onClick: () => openDialog('reminder', { id: note.id }) },
      { label: '从模板插入…', icon: <Wand2 size={14} />, onClick: () => openDialog('templates', { insertInto: note.id }) },
      { label: '导入文件到这篇笔记…', icon: <FileInput size={14} />, onClick: () => importRef.current?.click() },
      { label: boardCount ? `插入新画板（这篇已有 ${boardCount} 块）` : '插入画板 / 流程图…', icon: <Frame size={14} />, onClick: () => openBoard() },
      { label: '移动到笔记本…', icon: <MoveRight size={14} />, onClick: () => openDialog('move', { kind: 'notes', ids: [note.id] }) },
      { label: '', divider: true },
      { label: '导出…', icon: <FileDown size={14} />, onClick: openExport },
      { label: '打印…', icon: <Printer size={14} />, onClick: () => doPrint() },
      { label: '', divider: true },
      {
        label: '复制为 Markdown', icon: <Copy size={14} />, onClick: async () => {
          const md = mode === 'markdown'
            ? draftRef.current.content
            : convertContent(draftRef.current.content, 'rich', 'markdown', note?.attachments || []);
          try { await navigator.clipboard.writeText(`# ${draftRef.current.title}\n\n${md}`); toast('已复制为 Markdown'); }
          catch { toast('复制失败', 'err'); }
        },
      },
      { label: '', divider: true },
      {
        label: note.pinned ? '取消置顶' : '置顶', icon: <Pin size={14} />,
        onClick: () => actions.toggleFlag(note.id, 'pinned'),
      },
      {
        label: note.favorite ? '取消收藏' : '收藏', icon: <Star size={14} />,
        onClick: () => actions.toggleFlag(note.id, 'favorite'),
      },
      {
        label: '移到回收站', icon: <Trash2 size={14} />, danger: true,
        onClick: () => { flushRef.current(); actions.trash([note.id]); setActiveId(null); },
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  /** 回车续列表：空项再回车就跳出（和富文本内核的行为对齐）。 */
  const continueList = (ta: HTMLTextAreaElement) => {
    const content = draftRef.current.content;
    const s = ta.selectionStart;
    const ls = content.lastIndexOf('\n', s - 1) + 1;
    const line = content.slice(ls, s);
    const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/);
    if (!m) return false;
    const [, indent, mark, task, text] = m;
    if (!text.trim()) {
      const next = content.slice(0, ls) + indent + content.slice(s);
      schedule({ ...draftRef.current, content: next });
      requestAnimationFrame(() => {
        mdRef.current?.focus();
        mdRef.current?.setSelectionRange(ls + indent.length, ls + indent.length);
      });
      return true;
    }
    const nextMark = /^\d/.test(mark) ? `${parseInt(mark, 10) + 1}${mark.slice(-1)}` : mark;
    const ins = `\n${indent}${nextMark} ${task ? '[ ] ' : ''}`;
    const next = content.slice(0, s) + ins + content.slice(s);
    schedule({ ...draftRef.current, content: next });
    requestAnimationFrame(() => {
      mdRef.current?.focus();
      mdRef.current?.setSelectionRange(s + ins.length, s + ins.length);
    });
    return true;
  };

  /** Tab / Shift+Tab：整段缩进两格或反缩进。 */
  const indentSelection = (out: boolean) => {
    const ta = mdRef.current;
    if (!ta) return;
    const content = draftRef.current.content;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const ls = content.lastIndexOf('\n', s - 1) + 1;
    const le = e === s ? e : (content.indexOf('\n', e) === -1 ? content.length : content.indexOf('\n', e));
    const lines = content.slice(ls, le).split('\n').map((l) => {
      if (out) return l.replace(/^( {1,2}|\t)/, '');
      return l ? `  ${l}` : l;
    });
    const next = content.slice(0, ls) + lines.join('\n') + content.slice(le);
    schedule({ ...draftRef.current, content: next });
    requestAnimationFrame(() => {
      const el = mdRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(Math.max(ls, s + (next.length - content.length)), Math.max(ls, e + (next.length - content.length)));
    });
  };

  /** 源码视图的键盘行为；富文本的快捷键由 Tiptap 内核自带。 */
  const onMdKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Tab') { e.preventDefault(); indentSelection(e.shiftKey); return; }
    if (e.key === 'Enter' && !mod && !e.shiftKey) {
      if (continueList(e.currentTarget)) { e.preventDefault(); return; }
    }

    if (mod && e.shiftKey && e.key.toLowerCase() === 'v') { plainPaste.current = true; return; }
    if (mod && !e.shiftKey && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      prefixLines(`${'#'.repeat(Number(e.key))} `);
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'k') { e.preventDefault(); askLink('wiki'); return; }
    if (k === 'x' && e.shiftKey) { e.preventDefault(); prefixLines('- [ ] '); return; }
    if (!['b', 'i', 'u', 'd'].includes(k)) return;
    e.preventDefault();
    if (k === 'b') insertMd('**', '**', '加粗文字');
    else if (k === 'i') insertMd('*', '*', '斜体文字');
    else if (k === 'u') insertMd('<u>', '</u>', '下划线');
    else insertMd('~~', '~~', '删除线');
  };

  const previewHtml = useMemo(
    () => (mode === 'markdown' ? mdToHtml(draft.content, note?.attachments || []) : ''),
    [mode, draft.content, note?.attachments]
  );
  const count = wordCount(plainOf({ ...note, ...draft } as Note));

  if (!note) {
    return (
      <main className="editor editor--empty">
        <Empty
          icon={<PenLine size={38} />}
          title="选一篇笔记开始写"
          desc="左边是笔记本与标签，中间是笔记列表。也可以直接新建、套模板、剪藏网页或导入已有文件。"
          action={
            <div className="empty__buttons">
              <Btn variant="primary" onClick={() => actions.createNote()}><PenLine size={15} /> 新建笔记</Btn>
              <Btn variant="subtle" onClick={() => openDialog('templates')}><Wand2 size={15} /> 从模板</Btn>
              <Btn variant="subtle" onClick={() => openDialog('clip')}><Braces size={15} /> 网页剪藏</Btn>
              <Btn variant="subtle" onClick={() => openDialog('io')}><FileDown size={15} /> 导入导出</Btn>
            </div>
          }
        />
      </main>
    );
  }

  const nbOptions = [
    { value: '', label: '未分类' },
    ...ws.notebooks.map((nb) => ({ value: nb.id, label: nb.name })),
  ];

  const insertTime = () => {
    const now = formatDateTime(Date.now());
    insertMd(`<time data-time="${now}">${now}</time>`, '', now);
  };

  const mdTools: { icon: React.ReactNode; title: string; run: () => void }[] = [
    { icon: <Bold size={15} />, title: '加粗 (Ctrl+B)', run: () => insertMd('**', '**', '加粗文字') },
    { icon: <Italic size={15} />, title: '斜体 (Ctrl+I)', run: () => insertMd('*', '*', '斜体文字') },
    { icon: <Strikethrough size={15} />, title: '删除线 (Ctrl+D)', run: () => insertMd('~~', '~~', '删除线') },
    { icon: <Code2 size={15} />, title: '行内代码', run: () => insertMd('`', '`', 'code') },
    { icon: <List size={15} />, title: '无序列表', run: () => prefixLines('- ') },
    { icon: <ListOrdered size={15} />, title: '有序列表', run: () => prefixLines('1. ') },
    { icon: <ListChecks size={15} />, title: '待办 (Ctrl+Shift+X)', run: () => prefixLines('- [ ] ') },
    { icon: <Quote size={15} />, title: '引用', run: () => prefixLines('> ') },
    { icon: <Code2 size={15} />, title: '代码块', run: () => insertMd('\n```\n', '\n```\n', '代码') },
    { icon: <Table2 size={15} />, title: '表格', run: () => insertMd('\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n', '', '') },
    { icon: <Link2 size={15} />, title: '链接', run: () => askLink('url') },
    { icon: <Braces size={15} />, title: '笔记内链 [[标题]] (Ctrl+K)', run: () => askLink('wiki') },
    { icon: <ImagePlus size={15} />, title: '插入图片 / 文件', run: () => fileRef.current?.click() },
    { icon: <Video size={15} />, title: '插入语音 / 视频', run: () => mediaRef.current?.click() },
    { icon: <Frame size={15} />, title: '插入画板 / 流程图', run: () => openBoard() },
    { icon: <FileInput size={15} />, title: '从文件导入到这篇笔记', run: () => importRef.current?.click() },
    { icon: <CalendarClock size={15} />, title: '插入当前时间', run: insertTime },
    { icon: <Minus size={15} />, title: '分割线', run: () => insertMd('\n---\n', '', '') },
  ];

  return (
    <main className="editor" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* 2.5.9：图片 / 文件通道用白名单，系统文件对话框里不再混进音视频；
          其它格式仍可拖放进来，一律按普通文件收下、不做音视频内容检测。 */}
      <input ref={fileRef} type="file" multiple hidden data-role="file"
        accept="image/*,.pdf,.doc,.docx,.docm,.dot,.dotx,.rtf,.odt,.wps,.xls,.xlsx,.xlsm,.xlsb,.csv,.tsv,.ods,.et,.ppt,.pptx,.pptm,.pps,.ppsx,.odp,.dps,.txt,.md,.markdown,.log,.json,.xml,.yaml,.yml,.html,.htm,.mhtml,.zip,.rar,.7z,.tar,.gz,.bz2,.epub"
        onChange={(e) => { void handleFiles(Array.from(e.target.files || []), 'file'); e.target.value = ''; }} />
      <input ref={mediaRef} type="file" multiple accept="audio/*,video/*" hidden data-role="media"
        onChange={(e) => { void handleFiles(Array.from(e.target.files || []), 'media'); e.target.value = ''; }} />
      <input ref={importRef} type="file" hidden data-role="import"
        accept=".md,.markdown,.txt,.html,.htm,.enex,.xml,.json"
        onChange={(e) => { void importIntoNote(e.target.files?.[0]); e.target.value = ''; }} />

      <header className="editor__head">
        <div className="editor__titleline">
          <input className="editor__title" value={draft.title} placeholder="无标题"
            onChange={(e) => schedule({ ...draftRef.current, title: e.target.value })}
            onBlur={() => { clearTimer(); pushNow(); }} />
          <div className="editor__headacts">
            <IconBtn title={note.pinned ? '取消置顶' : '置顶'} active={note.pinned}
              onClick={() => actions.toggleFlag(note.id, 'pinned')}><Pin size={16} /></IconBtn>
            <IconBtn title={note.favorite ? '取消收藏' : '收藏'} active={note.favorite}
              onClick={() => actions.toggleFlag(note.id, 'favorite')}>
              <Star size={16} fill={note.favorite ? 'currentColor' : 'none'} /></IconBtn>
            <IconBtn title="提醒" active={!!note.reminderAt && !note.reminderDone}
              onClick={() => openDialog('reminder', { id: note.id })}><Bell size={16} /></IconBtn>
            <IconBtn title="笔记信息" onClick={() => openDialog('noteInfo', { id: note.id })}><Info size={16} /></IconBtn>
            <IconBtn title="更多操作" onClick={moreMenu}><MoreHorizontal size={18} /></IconBtn>
          </div>
        </div>

        <div className="editor__metaline">
          <div className="select-wrap" title="所属笔记本">
            <Tags size={14} />
            <select value={note.notebookId || ''} onChange={(e) => actions.updateNote(note.id, { notebookId: e.target.value || null })}>
              {nbOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={13} />
          </div>
          <div className="tag-editor">
            {note.tags.map((t) => (
              <span key={t} className="tag-chip">#{t}
                <button title="移除标签" onClick={() => actions.updateNote(note.id, { tags: note.tags.filter((x) => x !== t) })}><X size={11} /></button>
              </span>
            ))}
            <input value={tagInput} placeholder="+ 标签" title="输入后回车添加"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  const v = tagInput.trim().replace(/^#/, '');
                  if (v && !note.tags.includes(v)) actions.updateNote(note.id, { tags: [...note.tags, v] });
                  setTagInput('');
                }
              }} />
          </div>
          {/* 源码视图专属：编辑 / 分栏 / 预览三态。整体切换在底栏右下角。 */}
          {mode === 'markdown' && (
            <div className="editor__mode">
              <Segmented<PreviewMode> value={previewMode} onChange={setPreviewMode}
                options={[
                  { value: 'edit', label: '编辑', icon: <PenLine size={13} /> },
                  { value: 'split', label: '分栏', icon: <Columns2 size={13} /> },
                  { value: 'preview', label: '预览', icon: <Eye size={13} /> },
                ]} />
            </div>
          )}
        </div>

        {mode === 'markdown' && (
          <div className="toolbar">
            {/* 标题级别 1–6：源码视图里也一次点到位，不用记几个 # */}
            <select className="toolbar__select toolbar__select--block" value="" title="标题级别"
              onChange={(e) => {
                const lv = Number(e.currentTarget.value);
                e.currentTarget.value = '';
                if (lv >= 1 && lv <= 6) prefixLines(`${'#'.repeat(lv)} `);
              }}>
              <option value="">标题 ▾</option>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>标题 {n}</option>)}
            </select>
            {mdTools.map((t, i) => <IconBtn key={i} title={t.title} onClick={t.run}>{t.icon}</IconBtn>)}
          </div>
        )}
      </header>

      {findOpen && (
        <FindBar
          query={findQuery} setQuery={setFindQuery}
          replacement={findRepl} setReplacement={setFindRepl}
          showReplace={findReplaceShown} setShowReplace={setFindReplaceShown}
          caseSensitive={findCase} setCaseSensitive={setFindCase}
          total={findHits.length} current={findAt} focusToken={findToken}
          onPrev={() => goFind(-1)} onNext={() => goFind(1)}
          onReplaceOne={() => replaceFind(false)} onReplaceAll={() => replaceFind(true)}
          onClose={closeFind}
          onGlobalSearch={() => { closeFind(); openDialog('search'); }}
        />
      )}

      <div className={`editor__body mode-${mode} preview-${previewMode}`}>
        {mode === 'rich' ? (
          <RichEditor
            ref={richHandle}
            docKey={note.id}
            html={draft.content}
            fontFamily={ws.settings.fontFamily}
            fontSize={ws.settings.fontSize}
            onContent={(stored) => schedule({ ...draftRef.current, content: stored })}
            onFiles={(files) => void handleFiles(files)}
            onRequestFile={() => fileRef.current?.click()}
            onRequestMedia={() => mediaRef.current?.click()}
            onImport={() => importRef.current?.click()}
            onInsertBoard={() => openBoard()}
            onOpenBoard={(id) => openBoard(id)}
            onOpenPreview={openPreview}
            onOpenWiki={openWiki}
            onOpenUrl={(href) => void openUrl(href)}
            onPreference={(patch) => actions.setSettings(patch)}
          />
        ) : (
          <>
            {previewMode !== 'preview' && (
              <MarkdownPane
                ref={mdRef}
                value={draft.content}
                placeholder="用 Markdown 写点什么… 支持 [[笔记内链]]、- [ ] 待办、表格、代码块"
                onChange={(v) => schedule({ ...draftRef.current, content: v })}
                onPaste={onPaste} onDrop={onDrop} onKeyDown={onMdKeyDown}
                onBlur={() => { clearTimer(); pushNow(); }}
              />
            )}
            {previewMode !== 'edit' && (
              <div className="editor__preview prose" onClick={onPreviewClick}
                dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="prose-empty">预览会显示在这里</p>' }} />
            )}
          </>
        )}
      </div>

      {(note.attachments?.length || 0) > 0 && (
        <div className="attachments">
          <div className="attachments__head"><Paperclip size={14} /> 附件 · {note.attachments.length}</div>
          <div className="attachments__list">
            {note.attachments.map((att) => (
              <div key={att.id} className="attachment" title={att.name}>
                {att.kind === 'image' || att.kind === 'board'
                  ? <img src={attSrc(att)} alt={att.name}
                      title={att.boardId ? '双击回到画板继续编辑' : '点击预览大图'}
                      onDoubleClick={() => { if (att.boardId) openBoard(att.boardId); }}
                      onClick={() => openPreview(att.id, attSrc(att), att.name)} />
                  : <button className="attachment__file" title="点击预览文件内容 / 下载"
                      onClick={() => openPreview(att.id, attSrc(att), att.name)}>
                      <FileBadge name={att.name} mime={att.mime} kind={att.kind} size="sm" />
                    </button>}
                <span title="点击文件名把附件插回正文" onClick={() => insertAttachment(att)}>{att.name}</span>
                <em>{formatSize(att.size)}</em>
                {att.boardId && <em className="attachment__tag">画板</em>}
                <button title="移除附件" onClick={() => actions.updateNote(note.id, { attachments: note.attachments.filter((a) => a.id !== att.id) })}><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="editor__foot">
        {/* 保存状态固定占位：只让文字变化，后面的字号/时间不跟着横跳。 */}
        <span className={`save-state save-state--${saveState}`}>
          {saveState === 'saved' ? <><Check size={13} /> 已保存</> : saveState === 'saving' ? '保存中…' : '保存失败'}
        </span>
        {ws.settings.showWordCount && <span>{count} 字</span>}
        <span>创建 {formatDateTime(note.createdAt)}</span>
        <span>修改 {formatDateTime(note.updatedAt)}</span>
        {note.sourceUrl && <span className="editor__source">来源：{note.sourceUrl.slice(0, 42)}…</span>}
        {note.reminderAt && !note.reminderDone && (
          <span className="editor__reminder"><Bell size={12} /> 提醒 {formatDateTime(note.reminderAt)}</span>
        )}
        {/* 切换按钮挪到右下角，跟印象笔记底栏一致。 */}
        <button className={`mode-pill ${mode === 'rich' ? 'is-rich' : 'is-md'}`}
          title="切换编辑视图（富文本 ⇄ 源码，Ctrl+Shift+M）"
          onClick={() => doSwitchMode(mode === 'rich' ? 'markdown' : 'rich')}>
          {mode === 'rich' ? <Palette size={12} /> : <Braces size={12} />}
          {mode === 'rich' ? '富文本' : '源码'}
          <span className="mode-pill__swap">切换</span>
        </button>
      </footer>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </main>
  );
}
