/** 画板 / 流程图。参考飞书画板的交互习惯：
 *  左侧工具栏 + 可平移缩放画布 + 右侧属性面板，形状之间拖一条线就连起来。
 *
 *  数据存进笔记的 boards 字段（纯 JSON），正文里插的是它的 PNG 快照，
 *  所以导出、打印、切 Markdown 都不会丢；双击快照回来继续改。
 *
 *  这一版补齐的是「真的能画图」需要的那些细节：
 *  · 框选、八向缩放手柄、拖动时对齐吸附与参考线（Alt 临时关掉）
 *  · 连线三走法（折线 / 直线 / 曲线）、端点可重新接、线中点可以写字
 *  · 图层顺序、多选对齐与等距分布、精确的 X/Y/W/H
 *  · 复制粘贴、方向键微调、空格拖画布、Ctrl+滚轮缩放
 *  · 撤销按「一次拖拽 = 一步」记录（旧版拖完再撤销是空操作）
 *  · 导出 PNG 按内容裁剪、2 倍分辨率；空画布有上手提示
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalDistributeCenter, ArrowLeftRight, ArrowRight, BringToFront, ChevronDown, ChevronUp,
  Circle, Copy, CornerDownRight, Diamond, Eraser, Frame, Hand, ImageDown, Maximize2, Minus,
  MousePointer2, Pencil, Redo2, Scan, SendToBack, Spline, Square, StickyNote, Trash2, Type,
  Undo2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useApp } from '../context';
import type { Attachment, BoardDoc, BoardEl, BoardElType } from '../types';
import { uid } from '../utils';
import { storage } from '../storage';
import { Btn } from './Common';

const W = 1680;
const H = 1040;
const GRID = 20;
const MIN_W = 24;
const MIN_H = 20;
const FONT_STACK = '"Microsoft YaHei","PingFang SC",system-ui,sans-serif';

const PALETTE = [
  { fill: '#ffffff', stroke: '#8a938c' },
  { fill: '#e8f4ee', stroke: '#2f8f68' },
  { fill: '#e7f0fc', stroke: '#3b7dd8' },
  { fill: '#fdf0e0', stroke: '#c97a2b' },
  { fill: '#fbe7ec', stroke: '#c0506b' },
  { fill: '#f0ebfb', stroke: '#8a63c9' },
  { fill: '#fff8d6', stroke: '#c2a52b' },
  { fill: '#26302b', stroke: '#26302b' },
];
const STROKES = PALETTE.map((c) => c.stroke);
const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 28, 32];

type Tool = 'select' | 'pan' | 'rect' | 'round' | 'ellipse' | 'diamond' | 'sticky' | 'text' | 'arrow' | 'draw' | 'eraser';
type Dir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Route = NonNullable<BoardEl['route']>;

interface Box { x: number; y: number; w: number; h: number }

const TOOLS: { id: Tool; label: string; icon: React.ReactNode; key: string }[] = [
  { id: 'select', label: '选择', icon: <MousePointer2 size={16} />, key: 'V' },
  { id: 'pan', label: '平移画布（也可按住空格拖）', icon: <Hand size={16} />, key: 'H' },
  { id: 'rect', label: '矩形', icon: <Square size={16} />, key: 'R' },
  { id: 'round', label: '圆角矩形', icon: <Square size={16} className="ic-round" />, key: 'U' },
  { id: 'ellipse', label: '椭圆', icon: <Circle size={16} />, key: 'O' },
  { id: 'diamond', label: '菱形', icon: <Diamond size={16} />, key: 'D' },
  { id: 'sticky', label: '便签', icon: <StickyNote size={16} />, key: 'S' },
  { id: 'text', label: '文本', icon: <Type size={16} />, key: 'T' },
  { id: 'arrow', label: '连线（从一个形状拖到另一个）', icon: <CornerDownRight size={16} />, key: 'L' },
  { id: 'draw', label: '自由画笔', icon: <Pencil size={16} />, key: 'P' },
  { id: 'eraser', label: '橡皮（按住拖过去连续擦）', icon: <Eraser size={16} />, key: 'E' },
];

const SHAPE_TOOLS: Tool[] = ['rect', 'round', 'ellipse', 'diamond', 'sticky', 'text'];
const FILLABLE: BoardElType[] = ['rect', 'round', 'ellipse', 'diamond', 'sticky'];
const HANDLE_DIRS: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const DIR_CURSOR: Record<Dir, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* --------------------------- 文字测量 ---------------------------
 * 旧版按「字数 × 字号」估算换行，中英文混排时一行能有 30% 误差，
 * 方框里的字会顶到边上。这里用离屏 canvas 真量，并按文本 + 宽度做缓存。 */

let measureCtx: CanvasRenderingContext2D | null = null;
const wrapCache = new Map<string, string[]>();

function ctxOf(): CanvasRenderingContext2D | null {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

function wrapLines(text: string, maxW: number, fs: number): string[] {
  if (!text) return [];
  const key = `${fs}:${Math.round(maxW)}:${text}`;
  const hit = wrapCache.get(key);
  if (hit) return hit;
  const ctx = ctxOf();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    if (!ctx) {
      const per = Math.max(1, Math.floor(maxW / (fs * 0.95)));
      for (let i = 0; i < raw.length; i += per) out.push(raw.slice(i, i + per));
      continue;
    }
    ctx.font = `${fs}px ${FONT_STACK}`;
    let line = '';
    for (const ch of raw) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxW) { out.push(line); line = ch; }
      else line = next;
    }
    out.push(line);
  }
  if (wrapCache.size > 800) wrapCache.clear();
  wrapCache.set(key, out);
  return out;
}

function measureW(text: string, fs: number): number {
  const ctx = ctxOf();
  if (!ctx) return text.length * fs * 0.95;
  ctx.font = `${fs}px ${FONT_STACK}`;
  return ctx.measureText(text).width;
}

function isDarkFill(fill?: string): boolean {
  if (!fill || fill === 'none') return false;
  const m = /^#([0-9a-f]{6})$/i.exec(fill.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

/* --------------------------- 几何 --------------------------- */

/** 从形状中心朝目标方向的边界点，连线才不会钻进形状里。 */
function edgePoint(el: BoardEl, tx: number, ty: number): [number, number] {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : (el.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (el.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

function elById(els: BoardEl[], id?: string | null): BoardEl | undefined {
  return id ? els.find((e) => e.id === id) : undefined;
}

/** 连线的两个端点：接在形状上就用形状边界，自由端点用 x2/y2。 */
function arrowEnds(el: BoardEl, els: BoardEl[]): { x1: number; y1: number; x2: number; y2: number } {
  const a = elById(els, el.from);
  const b = elById(els, el.to);
  const p1 = a ? { x: a.x + a.w / 2, y: a.y + a.h / 2 } : { x: el.x, y: el.y };
  const p2 = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: el.x2 ?? el.x + 120, y: el.y2 ?? el.y };
  const [x1, y1] = a ? edgePoint(a, p2.x, p2.y) : [p1.x, p1.y];
  const [x2, y2] = b ? edgePoint(b, p1.x, p1.y) : [p2.x, p2.y];
  return { x1, y1, x2, y2 };
}

function routePath(x1: number, y1: number, x2: number, y2: number, route?: Route): string {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (route === 'straight') return `M${x1},${y1} L${x2},${y2}`;
  if (route === 'curve') {
    if (dx >= dy) {
      const mx = (x1 + x2) / 2;
      return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    }
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  }
  // 折线：主方向不同，先走横还是先走竖要换一下，否则会出现「绕一大圈」的走法。
  if (dx >= dy) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}`;
  }
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2}`;
}

function elBox(el: BoardEl, els: BoardEl[]): Box {
  if (el.type === 'arrow') {
    const { x1, y1, x2, y2 } = arrowEnds(el, els);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  if (el.type === 'draw') {
    const pts = el.points || [];
    if (pts.length < 2) return { x: el.x, y: el.y, w: 0, h: 0 };
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
      minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function unionBox(items: BoardEl[], els: BoardEl[]): Box | null {
  if (!items.length) return null;
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  for (const el of items) {
    const b = elBox(el, els);
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function normalizeBox(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** 找最近的吸附目标；返回 null 表示这个方向没有可贴的线。 */
function pickSnap(v: number, targets: number[], tol: number): number | null {
  let best: number | null = null;
  let bd = tol;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d <= bd) { bd = d; best = t; }
  }
  return best;
}

function guideTargets(others: BoardEl[], els: BoardEl[]) {
  const v: number[] = [0, W / 2, W];
  const h: number[] = [0, H / 2, H];
  for (const o of others) {
    if (o.type === 'arrow') continue;
    const b = elBox(o, els);
    v.push(b.x, b.x + b.w / 2, b.x + b.w);
    h.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { v, h };
}

/* --------------------------- 组件 --------------------------- */

type Draft =
  | { mode: 'pan'; px: number; py: number; vx: number; vy: number }
  | { mode: 'marquee'; sx: number; sy: number; add: string[] }
  | { mode: 'create'; id: string; sx: number; sy: number; base: BoardEl[]; from?: string }
  | { mode: 'branch'; id: string; srcId: string; sx: number; sy: number; base: BoardEl[] }
  | { mode: 'move'; sx: number; sy: number; base: BoardEl[]; box: Box; items: { id: string; x: number; y: number }[]; moved: boolean }
  | { mode: 'resize'; id: string; dir: Dir; sx: number; sy: number; base: BoardEl[]; box: Box; moved: boolean }
  | { mode: 'draw'; id: string; base: BoardEl[] }
  | { mode: 'arrow'; from: string | null; x1: number; y1: number; x2: number; y2: number }
  | { mode: 'link'; id: string; end: 'from' | 'to' }
  | { mode: 'erase' };

export default function BoardDialog() {
  const { dialog, closeDialog, ws, actions, toast } = useApp();
  const p = dialog.payload || {};
  const noteId: string = p.noteId;
  const note = ws.notes.find((n) => n.id === noteId);
  const existing: BoardDoc | undefined = p.boardId
    ? (note?.boards || []).find((b) => b.id === p.boardId)
    : undefined;

  const boardId = useRef<string>(existing?.id || uid('board'));
  const [title, setTitle] = useState(existing?.title || '未命名画板');
  const [els, setEls] = useState<BoardEl[]>(
    existing?.els ? (JSON.parse(JSON.stringify(existing.els)) as BoardEl[]) : []
  );
  const elsRef = useRef(els);
  elsRef.current = els;

  const [sel, setSel] = useState<string[]>([]);
  const selRef = useRef(sel);
  selRef.current = sel;

  const [tool, setTool] = useState<Tool>('select');
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  /** 文本框 onBlur 与画布 pointerdown 会先后各提交一次，用 ref 保证只落一次。 */
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [style, setStyle] = useState({
    fill: '#e8f4ee', stroke: '#2f8f68', strokeWidth: 2,
    fontSize: 15, route: 'elbow' as Route, dashed: false,
  });
  const [snap, setSnap] = useState(true);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [preview, setPreview] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [hist, setHist] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  /** 右键菜单：定位在画布（stage）坐标系内，挂在某元素上。 */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const draft = useRef<Draft | null>(null);
  const space = useRef(false);
  const past = useRef<BoardEl[][]>([]);
  const future = useRef<BoardEl[][]>([]);
  const clip = useRef<BoardEl[]>([]);
  const geoBase = useRef<BoardEl[] | null>(null);

  const selected = els.filter((e) => sel.includes(e.id));
  const one = selected.length === 1 ? selected[0] : null;
  const box = unionBox(selected, els);
  const arrowCount = els.filter((e) => e.type === 'arrow').length;

  /* --------------------------- 历史 --------------------------- */

  const clone = (v: BoardEl[]): BoardEl[] => JSON.parse(JSON.stringify(v)) as BoardEl[];

  const setElsNow = useCallback((next: BoardEl[]) => {
    elsRef.current = next;
    setEls(next);
    setDirty(true);
  }, []);

  const pushHistory = useCallback((snapshot: BoardEl[]) => {
    past.current = [...past.current.slice(-79), clone(snapshot)];
    future.current = [];
    setHist(past.current.length);
  }, []);

  const apply = useCallback((next: BoardEl[], record = true) => {
    if (record) pushHistory(elsRef.current);
    setElsNow(next);
  }, [pushHistory, setElsNow]);

  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(clone(elsRef.current));
    setElsNow(prev);
    setSel([]);
    setEditing(null);
    setHist(past.current.length);
  };

  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(clone(elsRef.current));
    setElsNow(next);
    setSel([]);
    setEditing(null);
    setHist(past.current.length);
  };

  /* --------------------------- 坐标 --------------------------- */

  const toCanvas = (clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: (clientX - r.left - view.x) / view.k,
      y: (clientY - r.top - view.y) / view.k,
    };
  };

  /* --------------------------- 编辑 --------------------------- */

  const startEdit = (el: BoardEl) => {
    if (el.type === 'draw') return;
    setEditing({ id: el.id, value: el.text || el.label || '' });
  };

  /** 把文字写回元素；文本框按内容自动定宽，便签/方框按内容长高（只长不缩）。 */
  const flushEdit = useCallback(() => {
    const e = editingRef.current;
    if (!e) return;
    editingRef.current = null;
    const prev = elsRef.current;
    const target = prev.find((x) => x.id === e.id);
    setEditing(null);
    if (!target) return;
    const value = e.value;
    // 空的文本框没有存在的意义，提交时顺手收掉，免得多出一块看不见的空白
    if (target.type === 'text' && !value.trim()) {
      apply(prev.filter((x) => x.id !== e.id));
      setSel((s) => s.filter((id) => id !== e.id));
      return;
    }
    const next = prev.map((x) => {
      if (x.id !== e.id) return x;
      if (x.type === 'arrow') return { ...x, label: value.trim() || undefined };
      const fs = x.fontSize || 15;
      const copy: BoardEl = { ...x, text: value };
      if (x.type === 'text') {
        const lines = value.split('\n');
        const widest = Math.max(40, ...lines.map((l) => measureW(l || ' ', fs)));
        copy.w = Math.min(420, Math.ceil(widest) + 8);
        copy.h = Math.max(24, Math.ceil(lines.length * fs * 1.45) + 4);
      } else if (FILLABLE.includes(x.type)) {
        const pad = 24;
        const lines = wrapLines(value, Math.max(20, x.w - pad), fs);
        const need = Math.ceil(lines.length * fs * 1.45) + pad;
        if (need > x.h) copy.h = need;
      }
      return copy;
    });
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    apply(next);
  }, [apply]);

  // 文本框/便签在画布外被点掉时，onBlur 也会走到这里，所以两支路径都必须是提交。
  const commitEdit = flushEdit;

  /* --------------------------- 拖拽：吸附 --------------------------- */

  const snapBox = (b: Box, others: BoardEl[], opts: { grid: boolean }) => {
    const tol = 7 / view.k;
    const t = guideTargets(others, elsRef.current);
    const vS = [b.x, b.x + b.w / 2, b.x + b.w];
    const hS = [b.y, b.y + b.h / 2, b.y + b.h];
    let dx = 0; let dy = 0;
    let bv = tol; let bh = tol;
    for (const s of vS) {
      for (const tv of t.v) {
        const d = tv - s;
        if (Math.abs(d) < bv) { bv = Math.abs(d); dx = d; }
      }
    }
    for (const s of hS) {
      for (const th of t.h) {
        const d = th - s;
        if (Math.abs(d) < bh) { bh = Math.abs(d); dy = d; }
      }
    }
    const gv: number[] = [];
    const gh: number[] = [];
    if (!dx && !dy) {
      if (opts.grid) {
        dx = Math.round(b.x / GRID) * GRID - b.x;
        dy = Math.round(b.y / GRID) * GRID - b.y;
      }
      return { dx, dy, v: gv, h: gh };
    }
    if (dx) {
      for (const s of vS) {
        for (const tv of t.v) if (Math.abs(tv - (s + dx)) < 0.6) gv.push(tv);
      }
    }
    if (dy) {
      for (const s of hS) {
        for (const th of t.h) if (Math.abs(th - (s + dy)) < 0.6) gh.push(th);
      }
    }
    return { dx, dy, v: [...new Set(gv)], h: [...new Set(gh)] };
  };

  /* --------------------------- 指针 --------------------------- */

  const eraseAt = (id: string) => {
    const set = new Set([id]);
    // 连带删掉挂在这个形状上的连线，否则会留下看不见的残线
    const next = elsRef.current.filter((x) => !set.has(x.id) && !(x.type === 'arrow' && (x.from === id || x.to === id)));
    if (next.length === elsRef.current.length) return;
    apply(next);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return; // 右键交给 contextmenu，不触发任何拖拽
    setCtxMenu(null);
    const target = e.target as Element;
    const hitId = target.closest('[data-el]')?.getAttribute('data-el') || null;
    const handleDir = target.closest('[data-handle]')?.getAttribute('data-handle') as Dir | null;
    const endAttr = target.closest('[data-end]')?.getAttribute('data-end') as 'from' | 'to' | null;
    try { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); } catch { /* 合成事件没有 pointerId */ }
    const pt = toCanvas(e.clientX, e.clientY);

    if (editing) flushEdit();

    if (e.button === 1 || tool === 'pan' || space.current) {
      draft.current = { mode: 'pan', px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (tool === 'eraser') {
      draft.current = { mode: 'erase' };
      if (hitId) eraseAt(hitId);
      return;
    }
    if (tool === 'draw') {
      const id = uid('el');
      const el: BoardEl = {
        id, type: 'draw', x: 0, y: 0, w: 0, h: 0,
        points: [pt.x, pt.y], stroke: style.stroke, strokeWidth: Math.max(2, style.strokeWidth + 1),
      };
      apply([...elsRef.current, el]);
      setSel([id]);
      draft.current = { mode: 'draw', id, base: clone(elsRef.current) };
      return;
    }
    if (tool === 'arrow') {
      draft.current = { mode: 'arrow', from: hitId, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      setPreview({ x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y });
      return;
    }
    if (SHAPE_TOOLS.includes(tool)) {
      const id = uid('el');
      const isText = tool === 'text';
      const el: BoardEl = {
        id, type: tool as BoardElType,
        x: pt.x, y: pt.y, w: 0, h: 0,
        text: '', align: isText ? 'left' : 'center',
        fill: isText ? 'none' : (tool === 'sticky' ? '#fff8d6' : style.fill),
        stroke: isText ? 'none' : style.stroke,
        strokeWidth: style.strokeWidth,
        dashed: style.dashed,
        fontSize: isText ? Math.max(16, style.fontSize) : style.fontSize,
      };
      const base = clone(elsRef.current);
      apply([...elsRef.current, el]);
      setSel([id]);
      draft.current = { mode: 'create', id, sx: pt.x, sy: pt.y, base };
      if (isText) { setEditing({ id, value: '' }); setTool('select'); }
      return;
    }

    /* 选择工具 */
    if (handleDir && one) {
      draft.current = {
        mode: 'resize', id: one.id, dir: handleDir, sx: pt.x, sy: pt.y,
        base: clone(elsRef.current), box: { x: one.x, y: one.y, w: one.w, h: one.h }, moved: false,
      };
      return;
    }
    if (endAttr && one && one.type === 'arrow') {
      draft.current = { mode: 'link', id: one.id, end: endAttr };
      return;
    }
    if (hitId) {
      const hit = els.find((x) => x.id === hitId);
      let nextSel = sel;
      if (e.shiftKey) nextSel = sel.includes(hitId) ? sel.filter((s) => s !== hitId) : [...sel, hitId];
      else if (!sel.includes(hitId)) nextSel = [hitId];
      setSel(nextSel);
      if (hit) {
        const moving = elsRef.current.filter((x) => nextSel.includes(x.id));
        draft.current = {
          mode: 'move', sx: pt.x, sy: pt.y, base: clone(elsRef.current),
          box: unionBox(moving, elsRef.current) || { x: 0, y: 0, w: 0, h: 0 },
          items: moving.filter((x) => x.type !== 'arrow' || x.from || x.to).map((x) => ({ id: x.id, x: x.x, y: x.y })),
          moved: false,
        };
      }
      return;
    }
    // 空白处按下：正好选中一个非连线形状时，从这里「拖」出下一个同样的形状
    // （不是点击放置）。拖动画出大小，松手自动连一条线；只点不拖则什么也不生成。
    if (!e.shiftKey && one && one.type !== 'arrow' && one.type !== 'draw') {
      const src = elsRef.current.find((x) => x.id === one.id);
      if (src) {
        const base = clone(elsRef.current);
        const copy = clone([src])[0];
        const id = uid('el');
        const el: BoardEl = { ...copy, id, x: pt.x, y: pt.y, w: 0, h: 0 };
        apply([...base, el]);
        setSel([id]);
        draft.current = { mode: 'branch', id, srcId: one.id, sx: pt.x, sy: pt.y, base };
        return;
      }
    }
    // 其余空白按下：正常框选（Shift 追加）
    if (!e.shiftKey) setSel([]);
    draft.current = { mode: 'marquee', sx: pt.x, sy: pt.y, add: e.shiftKey ? sel : [] };
    setMarquee({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  /** 右键形状：选中它（多选里点中的保留整组）并弹出菜单；空白处只关掉菜单、屏蔽系统菜单。 */
  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (editing) flushEdit();
    const stage = wrapRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const target = e.target as Element;
    const hitId = target.closest('[data-el]')?.getAttribute('data-el') || null;
    if (!hitId) { setCtxMenu(null); return; }
    let nextSel = selRef.current;
    if (!nextSel.includes(hitId)) {
      nextSel = [hitId];
      setSel(nextSel);
    }
    setCtxMenu({ x: e.clientX - r.left, y: e.clientY - r.top, id: hitId });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = draft.current;
    if (!d) return;
    const pt = toCanvas(e.clientX, e.clientY);

    if (d.mode === 'pan') {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.px), y: d.vy + (e.clientY - d.py) }));
      return;
    }
    if (d.mode === 'marquee') {
      setMarquee(normalizeBox(d.sx, d.sy, pt.x, pt.y));
      return;
    }
    if (d.mode === 'erase') {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const id = under?.closest('[data-el]')?.getAttribute('data-el');
      if (id) eraseAt(id);
      return;
    }
    if (d.mode === 'draw') {
      setElsNow(elsRef.current.map((x) => (x.id === d.id ? { ...x, points: [...(x.points || []), pt.x, pt.y] } : x)));
      return;
    }
    if (d.mode === 'create') {
      let w = pt.x - d.sx;
      let h = pt.y - d.sy;
      if (e.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
      const nx = Math.min(d.sx, d.sx + w);
      const ny = Math.min(d.sy, d.sy + h);
      setElsNow(elsRef.current.map((x) => (
        x.id === d.id ? { ...x, x: nx, y: ny, w: Math.abs(w), h: Math.abs(h) } : x
      )));
      return;
    }
    if (d.mode === 'branch') {
      let w = pt.x - d.sx;
      let h = pt.y - d.sy;
      if (e.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
      const nx = Math.min(d.sx, d.sx + w);
      const ny = Math.min(d.sy, d.sy + h);
      setElsNow(elsRef.current.map((x) => (
        x.id === d.id ? { ...x, x: nx, y: ny, w: Math.abs(w), h: Math.abs(h) } : x
      )));
      return;
    }
    if (d.mode === 'move') {
      let dx = pt.x - d.sx;
      let dy = pt.y - d.sy;
      const moving = new Set(d.items.map((i) => i.id));
      const others = elsRef.current.filter((x) => !moving.has(x.id));
      if (!e.altKey) {
        const s = snapBox({ x: d.box.x + dx, y: d.box.y + dy, w: d.box.w, h: d.box.h }, others, { grid: snap });
        dx += s.dx; dy += s.dy;
        setGuides({ v: s.v, h: s.h });
      } else setGuides({ v: [], h: [] });
      const posOf = new Map(d.items.map((i) => [i.id, { x: i.x + dx, y: i.y + dy }]));
      setElsNow(elsRef.current.map((x) => {
        const pos = posOf.get(x.id);
        if (!pos) return x;
        if (x.type === 'arrow' && !x.from && !x.to) {
          return { ...x, x: pos.x, y: pos.y, x2: (x.x2 ?? x.x) + (pos.x - x.x), y2: (x.y2 ?? x.y) + (pos.y - x.y) };
        }
        return { ...x, x: pos.x, y: pos.y };
      }));
      d.moved = true;
      return;
    }
    if (d.mode === 'resize') {
      const b = d.box;
      const rawX = pt.x - d.sx;
      const rawY = pt.y - d.sy;
      let { x, y, w, h } = b;
      if (d.dir.includes('w')) { x = b.x + rawX; w = b.w - rawX; }
      if (d.dir.includes('e')) { w = b.w + rawX; }
      if (d.dir.includes('n')) { y = b.y + rawY; h = b.h - rawY; }
      if (d.dir.includes('s')) { h = b.h + rawY; }
      if (e.shiftKey && d.dir.length === 2) {
        const ratio = b.w / Math.max(1, b.h);
        if (Math.abs(w - b.w) >= Math.abs(h - b.h)) h = w / ratio; else w = h * ratio;
        if (d.dir.includes('w')) x = b.x + b.w - w;
        if (d.dir.includes('n')) y = b.y + b.h - h;
      }
      if (!e.altKey && snap) {
        const others = elsRef.current.filter((o) => o.id !== d.id);
        const t = guideTargets(others, elsRef.current);
        const tol = 7 / view.k;
        const gv: number[] = [];
        const gh: number[] = [];
        if (d.dir.includes('e')) { const s = pickSnap(x + w, t.v, tol); if (s !== null) { w = s - x; gv.push(s); } }
        if (d.dir.includes('w')) { const s = pickSnap(x, t.v, tol); if (s !== null) { w = x + w - s; x = s; gv.push(s); } }
        if (d.dir.includes('s')) { const s = pickSnap(y + h, t.h, tol); if (s !== null) { h = s - y; gh.push(s); } }
        if (d.dir.includes('n')) { const s = pickSnap(y, t.h, tol); if (s !== null) { h = y + h - s; y = s; gh.push(s); } }
        setGuides({ v: [...new Set(gv)], h: [...new Set(gh)] });
      }
      if (w < MIN_W) { if (d.dir.includes('w')) x = b.x + b.w - MIN_W; w = MIN_W; }
      if (h < MIN_H) { if (d.dir.includes('n')) y = b.y + b.h - MIN_H; h = MIN_H; }
      setElsNow(elsRef.current.map((o) => (
        o.id === d.id ? { ...o, x, y, w, h } : o
      )));
      d.moved = true;
      return;
    }
    if (d.mode === 'arrow') {
      d.x2 = pt.x; d.y2 = pt.y;
      setPreview({ x1: d.x1, y1: d.y1, x2: pt.x, y2: pt.y });
      return;
    }
    if (d.mode === 'link') {
      const el = elsRef.current.find((x) => x.id === d.id);
      if (el) {
        setPreview({ ...arrowEnds(el, elsRef.current), [d.end === 'from' ? 'x1' : 'x2']: pt.x, [d.end === 'from' ? 'y1' : 'y2']: pt.y });
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = draft.current;
    draft.current = null;
    const pt = toCanvas(e.clientX, e.clientY);
    setMarquee(null);
    setPreview(null);
    setGuides({ v: [], h: [] });
    if (!d) return;

    if (d.mode === 'marquee') {
      const b = normalizeBox(d.sx, d.sy, pt.x, pt.y);
      if (b.w < 4 && b.h < 4) {
        // 只是点了一下空白（没拖出框）：取消选择
        setSel(d.add); return;
      }
      const hit = elsRef.current.filter((x) => intersects(elBox(x, elsRef.current), b)).map((x) => x.id);
      setSel([...new Set([...d.add, ...hit])]);
      return;
    }
    if (d.mode === 'branch') {
      const el = elsRef.current.find((x) => x.id === d.id);
      if (!el || el.w < 8 || el.h < 8) {
        // 只是点了一下没拖：不生成形状，回到按下前的状态
        apply(d.base);
        setSel([]);
        return;
      }
      const link: BoardEl = {
        id: uid('el'), type: 'arrow', x: 0, y: 0, w: 0, h: 0,
        from: d.srcId, to: d.id, route: style.route,
        // 连线颜色跟着源形状的描边；文本框没有描边就用工具栏当前颜色
        stroke: el.stroke && el.stroke !== 'none' ? el.stroke : style.stroke,
        strokeWidth: style.strokeWidth,
      };
      apply([...elsRef.current, link]);
      setSel([d.id]);
      pushHistory(d.base);
      return;
    }
    if (d.mode === 'create') {
      const el = elsRef.current.find((x) => x.id === d.id);
      if (el) {
        const isText = el.type === 'text';
        if (isText) {
          // 文本：点一下就落一个默认文本框并进入编辑（标准交互），不需要先拖。
          if (el.w < 8 || el.h < 8) {
            setElsNow(elsRef.current.map((x) => (x.id === d.id ? { ...x, w: 180, h: 40 } : x)));
          }
          setSel([d.id]);
        } else if (el.w < 8 || el.h < 8) {
          // 只是点了一下没拖：几何形状不生成，删掉刚加的元素（与「接龙」一致）。
          apply(elsRef.current.filter((x) => x.id !== d.id));
          setSel([]);
        } else {
          // 拖出来的形状按拖拽尺寸落定，并记入历史以便撤销。
          setSel([d.id]);
          pushHistory(d.base);
        }
      }
      // 画完一个形状后保持当前工具，方便连续画同类型；文本框在 pointerdown 已切回指针以便输入。
      return;
    }
    if ((d.mode === 'move' || d.mode === 'resize') && d.moved) {
      pushHistory(d.base);
      return;
    }
    if (d.mode === 'arrow') {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under?.closest('[data-el]')?.getAttribute('data-el') || null;
      // 用抬起时的坐标，而不是最后一次 move：快速拖一下可能一个 move 都没派发
      const endX = pt.x;
      const endY = pt.y;
      const dist = Math.hypot(endX - d.x1, endY - d.y1);
      const id = uid('el');
      if (d.from && target && target !== d.from) {
        apply([...elsRef.current, {
          id, type: 'arrow', x: 0, y: 0, w: 0, h: 0,
          from: d.from, to: target, route: style.route, stroke: style.stroke, strokeWidth: style.strokeWidth,
        }]);
      } else if (dist > 24) {
        // 拖到空白处也保留：从形状边缘指向一个点，写「否」这类分支很有用
        apply([...elsRef.current, {
          id, type: 'arrow', x: d.from ? 0 : d.x1, y: d.from ? 0 : d.y1,
          x2: endX, y2: endY, w: 0, h: 0,
          from: d.from, to: null, route: style.route, stroke: style.stroke, strokeWidth: style.strokeWidth,
        }]);
      }
      setTool('select');
      return;
    }
    if (d.mode === 'link') {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const target = under?.closest('[data-el]')?.getAttribute('data-el');
      const el = elsRef.current.find((x) => x.id === d.id);
      if (!el || el.type !== 'arrow') return;
      const next = elsRef.current.map((x) => {
        if (x.id !== d.id) return x;
        if (target && target !== x.id) {
          return { ...x, [d.end]: target, ...(d.end === 'to' ? { x2: undefined, y2: undefined } : { x: 0, y: 0 }) };
        }
        // 拖到空白：断开这一端，改记自由坐标
        return d.end === 'from'
          ? { ...x, from: null, x: pt.x, y: pt.y }
          : { ...x, to: null, x2: pt.x, y2: pt.y };
      });
      apply(next);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    setCtxMenu(null);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const k = clamp(view.k * (e.deltaY > 0 ? 0.92 : 1.08), 0.25, 3);
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k });
      return;
    }
    // 触控板两指滚动 = 平移画布，和常见画板工具一致
    if (e.deltaX || e.deltaY) {
      e.preventDefault();
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  /* --------------------------- 快捷键 --------------------------- */

  /** 删除给定 id 的元素，并连带删掉挂在它们上的连线。右键菜单与 Delete 键共用。 */
  const removeEls = (ids: string[]) => {
    const set = new Set(ids);
    if (!set.size) return;
    apply(elsRef.current.filter((x) => !set.has(x.id) && !(x.type === 'arrow' && ((x.from && set.has(x.from)) || (x.to && set.has(x.to))))));
    setSel([]);
    setCtxMenu(null);
  };

  const deleteSel = () => removeEls(sel);

  const duplicate = () => {
    if (!selected.length) return;
    const map = new Map<string, string>();
    selected.forEach((x) => map.set(x.id, uid('el')));
    const copies = selected.map((x) => ({
      ...x, id: map.get(x.id)!,
      x: x.x + 24, y: x.y + 24,
      x2: x.x2 === undefined ? undefined : x.x2 + 24,
      y2: x.y2 === undefined ? undefined : x.y2 + 24,
    }));
    apply([...elsRef.current, ...copies]);
    setSel(copies.map((c) => c.id));
  };

  const copySel = () => {
    if (!selected.length) return;
    clip.current = JSON.parse(JSON.stringify(selected)) as BoardEl[];
    toast(`已复制 ${selected.length} 个元素`);
  };

  const paste = () => {
    if (!clip.current.length) return;
    const map = new Map<string, string>();
    clip.current.forEach((x) => map.set(x.id, uid('el')));
    const items = clip.current
      .filter((x) => x.type !== 'arrow' || ((!x.from || map.has(x.from)) && (!x.to || map.has(x.to))))
      .map((x) => ({
        ...x,
        id: map.get(x.id)!,
        x: x.x + 24, y: x.y + 24,
        x2: x.x2 === undefined ? undefined : x.x2 + 24,
        y2: x.y2 === undefined ? undefined : x.y2 + 24,
        from: x.from ? map.get(x.from)! : null,
        to: x.to ? map.get(x.to)! : null,
      }));
    if (!items.length) return;
    apply([...elsRef.current, ...items]);
    setSel(items.map((x) => x.id));
  };

  const reorder = (how: 'front' | 'back' | 'up' | 'down') => {
    if (!sel.length) return;
    const set = new Set(sel);
    const kept = elsRef.current.filter((x) => !set.has(x.id));
    const picked = elsRef.current.filter((x) => set.has(x.id));
    if (how === 'front') apply([...kept, ...picked]);
    else if (how === 'back') apply([...picked, ...kept]);
    else {
      const next = [...elsRef.current];
      const step = how === 'up' ? 1 : -1;
      const order = step === 1 ? [...next.keys()].reverse() : [...next.keys()];
      for (const i of order) {
        const j = i + step;
        if (j < 0 || j >= next.length) continue;
        if (set.has(next[i].id) && !set.has(next[j].id)) {
          [next[i], next[j]] = [next[j], next[i]];
        }
      }
      apply(next);
    }
  };

  const alignSel = (how: 'left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom') => {
    const items = selected.filter((x) => x.type !== 'arrow' && x.type !== 'draw');
    if (items.length < 2) return;
    const b = unionBox(items, elsRef.current)!;
    const set = new Set(items.map((x) => x.id));
    apply(elsRef.current.map((x) => {
      if (!set.has(x.id)) return x;
      switch (how) {
        case 'left': return { ...x, x: b.x };
        case 'cx': return { ...x, x: b.x + (b.w - x.w) / 2 };
        case 'right': return { ...x, x: b.x + b.w - x.w };
        case 'top': return { ...x, y: b.y };
        case 'cy': return { ...x, y: b.y + (b.h - x.h) / 2 };
        case 'bottom': return { ...x, y: b.y + b.h - x.h };
        default: return x;
      }
    }));
  };

  const distribute = (dir: 'h' | 'v') => {
    const items = selected.filter((x) => x.type !== 'arrow' && x.type !== 'draw');
    if (items.length < 3) return;
    const sorted = [...items].sort((a, b) => (dir === 'h' ? a.x - b.x : a.y - b.y));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = dir === 'h'
      ? (last.x + last.w) - first.x
      : (last.y + last.h) - first.y;
    const total = sorted.reduce((s, x) => s + (dir === 'h' ? x.w : x.h), 0);
    const gap = (span - total) / (sorted.length - 1);
    let cur = dir === 'h' ? first.x : first.y;
    const pos = new Map<string, number>();
    for (const x of sorted) {
      pos.set(x.id, cur);
      cur += (dir === 'h' ? x.w : x.h) + gap;
    }
    apply(elsRef.current.map((x) => {
      const v = pos.get(x.id);
      if (v === undefined) return x;
      return dir === 'h' ? { ...x, x: v } : { ...x, y: v };
    }));
  };

  const nudge = (dx: number, dy: number) => {
    if (!sel.length) return;
    const set = new Set(sel);
    apply(elsRef.current.map((x) => {
      if (!set.has(x.id)) return x;
      if (x.type === 'arrow' && !x.from && !x.to) {
        return { ...x, x: x.x + dx, y: x.y + dy, x2: (x.x2 ?? x.x) + dx, y2: (x.y2 ?? x.y) + dy };
      }
      return { ...x, x: x.x + dx, y: x.y + dy };
    }));
  };

  const reverseArrow = () => {
    const arrows = selected.filter((x) => x.type === 'arrow');
    if (!arrows.length) return;
    const set = new Set(arrows.map((a) => a.id));
    apply(elsRef.current.map((x) => {
      if (!set.has(x.id)) return x;
      const free = { x: x.x, y: x.y, x2: x.x2, y2: x.y2 };
      return {
        ...x,
        from: x.to ?? null,
        to: x.from ?? null,
        // 自由端跟着换边，反向才不会把箭头留在原地
        x: free.x2 ?? free.x, y: free.y2 ?? free.y,
        x2: x.from ? undefined : free.x,
        y2: x.from ? undefined : free.y,
      };
    }));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = true;
      if (editing) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'a') { e.preventDefault(); setSel(elsRef.current.map((x) => x.id)); return; }
      if (mod && k === 'c') { e.preventDefault(); copySel(); return; }
      if (mod && k === 'v') { e.preventDefault(); paste(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && (k === ']' || k === '}')) { e.preventDefault(); reorder('front'); return; }
      if (mod && (k === '[' || k === '{')) { e.preventDefault(); reorder('back'); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
      if (e.key.startsWith('Arrow')) {
        if (!sel.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') nudge(-step, 0);
        if (e.key === 'ArrowRight') nudge(step, 0);
        if (e.key === 'ArrowUp') nudge(0, -step);
        if (e.key === 'ArrowDown') nudge(0, step);
        return;
      }
      if (e.key === 'Escape') { setSel([]); setTool('select'); setCtxMenu(null); return; }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t && !mod) setTool(t.id);
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  });

  // 右键菜单：点到菜单以外的地方就收起（点在菜单项上由各自 onClick 处理）
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.board__ctxmenu')) setCtxMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [ctxMenu]);

  /* --------------------------- 缩放 --------------------------- */

  const zoomBy = (factor: number) => {
    const stage = wrapRef.current;
    if (!stage) return;
    const cx = stage.clientWidth / 2;
    const cy = stage.clientHeight / 2;
    setView((v) => {
      const k = clamp(v.k * factor, 0.25, 3);
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  };

  const fitContent = () => {
    const stage = wrapRef.current;
    if (!stage) return;
    const b = unionBox(els, els) || { x: 0, y: 0, w: 600, h: 400 };
    const pad = 48;
    const k = clamp(Math.min((stage.clientWidth - pad * 2) / Math.max(1, b.w), (stage.clientHeight - pad * 2) / Math.max(1, b.h)), 0.25, 2);
    setView({
      k,
      x: (stage.clientWidth - b.w * k) / 2 - b.x * k,
      y: (stage.clientHeight - b.h * k) / 2 - b.y * k,
    });
  };

  /* --------------------------- 导出 PNG --------------------------- */

  /** 内容外接框 + 32px 留白；空画板给一个默认框。 */
  const cropBox = (): Box => {
    const b = unionBox(els, els);
    if (!b) return { x: 0, y: 0, w: 480, h: 320 };
    const pad = 32;
    return {
      x: Math.floor(b.x - pad), y: Math.floor(b.y - pad),
      w: Math.ceil(b.w + pad * 2), h: Math.ceil(b.h + pad * 2),
    };
  };

  const toPng = (): Promise<string> => new Promise((resolve, reject) => {
    const scene = svgRef.current?.querySelector('g[data-scene]');
    if (!scene) { reject(new Error('画布还没准备好')); return; }
    const box0 = cropBox();
    const scale = Math.min(2, Math.max(1, 2600 / Math.max(box0.w, box0.h)));
    const w = Math.round(box0.w * scale);
    const h = Math.round(box0.h * scale);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `${box0.x} ${box0.y} ${box0.w} ${box0.h}`);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', String(box0.x));
    bg.setAttribute('y', String(box0.y));
    bg.setAttribute('width', String(box0.w));
    bg.setAttribute('height', String(box0.h));
    bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);
    // 箭头 marker 与网格 pattern 在 <defs> 里，必须一起搬过去，否则导出的图没有箭头。
    const defs = svgRef.current?.querySelector('defs');
    if (defs) svg.appendChild(defs.cloneNode(true));
    const stage = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    stage.innerHTML = scene.innerHTML;
    svg.appendChild(stage);

    const data = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('画布初始化失败')); return; }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('画板渲染失败'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  });

  const save = async () => {
    if (!note) { toast('这篇笔记不见了，画板没法保存', 'err'); return; }
    if (editing) flushEdit();
    if (!elsRef.current.length) { toast('画板还是空的', 'err'); return; }
    setSaving(true);
    try {
      const dataUrl = await toPng();
      const doc: BoardDoc = {
        id: boardId.current, title: title.trim() || '未命名画板',
        width: W, height: H, els: elsRef.current, updatedAt: Date.now(),
      };
      const boards = [...(note.boards || [])];
      const at = boards.findIndex((b) => b.id === doc.id);
      if (at >= 0) boards[at] = doc; else boards.push(doc);
      actions.updateNote(note.id, { boards });

      const prevAtt = (note.attachments || []).find((a) => a.boardId === doc.id);
      const att: Attachment = {
        id: prevAtt?.id || uid('att'),
        name: `${doc.title}.png`,
        mime: 'image/png',
        size: Math.round((dataUrl.length * 3) / 4),
        kind: 'board',
        dataUrl,
        createdAt: prevAtt?.createdAt || Date.now(),
        boardId: doc.id,
      };
      p.onSaved?.(att, !prevAtt);
      toast(`画板「${doc.title}」已保存`);
      closeDialog();
    } catch (err) {
      toast(`保存画板失败：${String(err)}`, 'err');
      setSaving(false);
    }
  };

  const exportPng = async () => {
    try {
      if (editing) flushEdit();
      const dataUrl = await toPng();
      await storage.saveBinary(`${(title.trim() || '未命名画板').replace(/[\\/:*?"<>|]/g, '_')}.png`,
        dataUrl.split(',')[1], 'image/png');
      toast('画板已导出为 PNG');
    } catch (err) {
      toast(`导出失败：${String(err)}`, 'err');
    }
  };

  const requestClose = () => {
    if (dirty) { setClosing(true); return; }
    closeDialog();
  };

  /* --------------------------- 渲染 --------------------------- */

  const arrowColors = Array.from(new Set(els.filter((e) => e.type === 'arrow').map((e) => e.stroke || '#8a938c')));
  const markerOf = (color: string) => `url(#ah-${arrowColors.indexOf(color) < 0 ? 0 : arrowColors.indexOf(color)})`;

  const renderEl = (el: BoardEl) => {
    const isSel = sel.includes(el.id);
    const common = {
      'data-el': el.id,
      onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); startEdit(el); },
      style: { cursor: tool === 'select' ? 'move' : 'inherit' },
    } as Record<string, unknown>;

    if (el.type === 'arrow') {
      const { x1, y1, x2, y2 } = arrowEnds(el, els);
      if (el.from && !elById(els, el.from)) return null;
      if (el.to && !elById(els, el.to)) return null;
      const d = routePath(x1, y1, x2, y2, el.route);
      const color = el.stroke || '#8a938c';
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2;
      return (
        <g key={el.id} data-el={el.id} data-from={el.from || ''} data-to={el.to || ''} {...common}>
          <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
          <path d={d} fill="none" stroke={color} strokeWidth={el.strokeWidth || 2}
            strokeDasharray={el.dashed ? '6 5' : undefined}
            markerEnd={markerOf(color)} />
          {el.label && (
            <text x={labelX} y={labelY} textAnchor="middle" fontSize={el.fontSize || 13}
              fill="#26302b" stroke="#ffffff" strokeWidth={4} paintOrder="stroke"
              fontFamily={FONT_STACK}>{el.label}</text>
          )}
        </g>
      );
    }

    if (el.type === 'draw') {
      const pts = el.points || [];
      if (pts.length < 4) return null;
      let d = `M${pts[0]},${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) d += ` L${pts[i]},${pts[i + 1]}`;
      return (
        <g key={el.id} data-el={el.id} {...common}>
          <path d={d} fill="none" stroke={el.stroke || '#26302b'} strokeWidth={el.strokeWidth || 3}
            strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    }

    const fs = el.fontSize || 15;
    const lh = fs * 1.45;
    const isText = el.type === 'text';
    const pad = isText ? 2 : 12;
    const lines = wrapLines(el.text || '', Math.max(12, el.w - pad * 2), fs);
    const totalH = lines.length * lh;
    const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
    const tx = anchor === 'middle' ? el.x + el.w / 2 : anchor === 'end' ? el.x + el.w - pad : el.x + pad;
    const ty = isText
      ? el.y + pad + fs
      : el.y + Math.max(pad, (el.h - totalH) / 2) + fs * 0.98;
    const textFill = isDarkFill(el.fill) ? '#ffffff' : '#26302b';
    const stroke = el.stroke || 'none';
    const sw = el.strokeWidth ?? 2;
    const dash = el.dashed ? '6 5' : undefined;

    return (
      <g key={el.id} {...common}>
        {el.type === 'rect' && (
          <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={4}
            fill={el.fill || '#fff'} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        )}
        {el.type === 'round' && (
          <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={Math.min(18, el.h / 2)}
            fill={el.fill || '#fff'} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        )}
        {el.type === 'sticky' && (
          <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={3}
            fill={el.fill || '#fff8d6'} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        )}
        {el.type === 'ellipse' && (
          <ellipse cx={el.x + el.w / 2} cy={el.y + el.h / 2} rx={el.w / 2} ry={el.h / 2}
            fill={el.fill || '#fff'} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        )}
        {el.type === 'diamond' && (
          <polygon
            points={`${el.x + el.w / 2},${el.y} ${el.x + el.w},${el.y + el.h / 2} ${el.x + el.w / 2},${el.y + el.h} ${el.x},${el.y + el.h / 2}`}
            fill={el.fill || '#fff'} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
        )}
        {(el.text || !isText) && (
          <text x={tx} y={ty} fontSize={fs} fill={textFill} textAnchor={anchor}
            fontFamily={FONT_STACK} style={{ userSelect: 'none' }}>
            {lines.map((ln, i) => (
              <tspan key={i} x={tx} dy={i === 0 ? 0 : lh}>{ln}</tspan>
            ))}
          </text>
        )}
        {isText && !el.text && isSel && (
          <text x={tx} y={ty} fontSize={fs} fill="#8c968d" fontFamily={FONT_STACK}>双击输入文字</text>
        )}
      </g>
    );
  };

  const handleSize = 9;
  const hitSize = 18;

  const editingEl = editing ? els.find((x) => x.id === editing.id) : null;
  const editBox = (() => {
    if (!editingEl) return null;
    const v = editing?.value || '';
    const fs = editingEl.fontSize || 15;
    if (editingEl.type === 'arrow') {
      const { x1, y1, x2, y2 } = arrowEnds(editingEl, els);
      return {
        left: ((x1 + x2) / 2 - 80) * view.k + view.x, top: ((y1 + y2) / 2 - 14) * view.k + view.y,
        width: 160 * view.k, height: 28 * view.k, fontSize: fs * view.k,
        align: 'center' as const, padTop: 3,
      };
    }
    const lines = wrapLines(v, Math.max(12, editingEl.w - (editingEl.type === 'text' ? 4 : 24)), fs);
    const innerH = editingEl.h * view.k;
    const padTop = editingEl.type === 'text'
      ? 2
      : Math.max(4, (innerH - Math.max(1, lines.length) * fs * 1.45 * view.k) / 2);
    return {
      left: editingEl.x * view.k + view.x,
      top: editingEl.y * view.k + view.y,
      width: Math.max(60, editingEl.w * view.k),
      height: Math.max(26, innerH),
      fontSize: fs * view.k,
      align: (editingEl.align || (editingEl.type === 'text' ? 'left' : 'center')) as 'left' | 'center' | 'right',
      padTop,
    };
  })();

  const curFill = one?.fill ?? style.fill;
  const curStroke = one?.stroke ?? style.stroke;
  const curSw = one?.strokeWidth ?? style.strokeWidth;
  const curFont = one?.fontSize ?? style.fontSize;
  const curAlign = one?.align ?? 'center';
  const curRoute = one?.route ?? style.route;
  const curDashed = !!one?.dashed;

  const patchSel = (patch: Partial<BoardEl>) => {
    const set = new Set(sel);
    if (!set.size) {
      setStyle((s) => ({ ...s, ...patch }));
      return;
    }
    apply(elsRef.current.map((e) => {
      if (!set.has(e.id)) return e;
      const q: Partial<BoardEl> = {};
      const shape = FILLABLE.includes(e.type);
      if (patch.fill !== undefined && shape) q.fill = patch.fill;
      if (patch.stroke !== undefined && e.type !== 'text') q.stroke = patch.stroke;
      if (patch.strokeWidth !== undefined && e.type !== 'text') q.strokeWidth = patch.strokeWidth;
      if (patch.dashed !== undefined && e.type !== 'text') q.dashed = patch.dashed;
      if (patch.fontSize !== undefined && (e.type === 'text' || shape || e.type === 'arrow')) q.fontSize = patch.fontSize;
      if (patch.align !== undefined && (e.type === 'text' || shape)) q.align = patch.align;
      if (patch.route !== undefined && e.type === 'arrow') q.route = patch.route;
      return { ...e, ...q };
    }));
  };

  const setGeo = (key: keyof Box, value: number) => {
    if (!one || one.type === 'arrow' || one.type === 'draw') return;
    if (!Number.isFinite(value)) return;
    const v = key === 'w' ? Math.max(MIN_W, value) : key === 'h' ? Math.max(MIN_H, value) : value;
    setElsNow(elsRef.current.map((x) => (x.id === one.id ? { ...x, [key]: v } : x)));
  };

  /** 快捷插入：放在当前视口中心，免得新元素生在看不见的地方。 */
  const quickAdd = (kind: 'text' | 'sticky' | 'line') => {
    const stage = wrapRef.current;
    const cw = stage?.clientWidth ?? 900;
    const ch = stage?.clientHeight ?? 620;
    const cx = (cw / 2 - view.x) / view.k - 90;
    const cy = (ch / 2 - view.y) / view.k - 40;
    const id = uid('el');
    const el: BoardEl = kind === 'text'
      ? { id, type: 'text', x: cx, y: cy, w: 180, h: 40, text: '', fill: 'none', stroke: 'none', fontSize: 18, align: 'left' }
      : kind === 'sticky'
        ? { id, type: 'sticky', x: cx, y: cy, w: 160, h: 120, text: '', fill: '#fff8d6', stroke: '#c2a52b', strokeWidth: 1, fontSize: 14, align: 'left' }
        : { id, type: 'rect', x: cx, y: cy + 60, w: 240, h: 3, fill: '#8a938c', stroke: 'none', strokeWidth: 1 };
    apply([...elsRef.current, el]);
    setSel([id]);
    if (kind !== 'line') setEditing({ id, value: '' });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className="board" role="dialog" aria-modal="true">
        <header className="board__head">
          <div className="board__title">
            <Frame size={17} />
            <input value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} placeholder="画板名称" />
            <span className="board__hint">
              {els.length} 个元素{arrowCount ? `（${arrowCount} 条连线）` : ''}
              {sel.length ? ` · 已选 ${sel.length}` : ''} · 双击形状改文字
            </span>
          </div>
          <div className="board__acts">
            <Btn onClick={requestClose} title="关闭（未保存会先问一句）"><X size={14} /> 关闭</Btn>
            <Btn onClick={() => void exportPng()} title="按内容裁剪导出 PNG"><ImageDown size={14} /> 导出 PNG</Btn>
            <Btn variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? '正在生成…' : existing ? '保存并更新正文' : '保存并插入正文'}
            </Btn>
          </div>
          {closing && (
            <div className="board__closing">
              <span>画板有改动还没保存，关掉就没了。</span>
              <Btn variant="ghost" onClick={() => setClosing(false)}>继续编辑</Btn>
              <Btn variant="danger" onClick={closeDialog}>放弃改动</Btn>
              <Btn variant="primary" onClick={() => { setClosing(false); void save(); }}>保存并关闭</Btn>
            </div>
          )}
        </header>

        <div className="board__body">
          <aside className="board__tools">
            {TOOLS.map((t) => (
              <button key={t.id} title={`${t.label}（${t.key}）`}
                className={tool === t.id ? 'is-active' : ''}
                data-tool={t.id}
                onClick={() => setTool(t.id)}>{t.icon}</button>
            ))}
            <span className="board__toolsep" />
            <button title="撤销 (Ctrl+Z)" disabled={!hist} onClick={undo}><Undo2 size={16} /></button>
            <button title="重做 (Ctrl+Shift+Z)" onClick={redo}><Redo2 size={16} /></button>
            <button title="复制 (Ctrl+D)" onClick={duplicate}><Copy size={16} /></button>
            <button title="删除 (Delete)" onClick={deleteSel}><Trash2 size={16} /></button>
          </aside>

          <div className="board__stage" ref={wrapRef}>
            <svg
              ref={svgRef}
              className={`board__svg board__svg--${tool}`}
              width="100%" height="100%"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={onContextMenu}
              onWheel={onWheel}
              onDoubleClick={(e) => {
                if (tool !== 'select') return;
                if ((e.target as Element).closest('[data-el]')) return;
                const pt = toCanvas(e.clientX, e.clientY);
                const id = uid('el');
                apply([...elsRef.current, {
                  id, type: 'text', x: pt.x, y: pt.y, w: 180, h: 40, text: '',
                  fill: 'none', stroke: 'none', fontSize: 18, align: 'left',
                }]);
                setSel([id]);
                setEditing({ id, value: '' });
              }}
            >
              <defs>
                {arrowColors.map((c, i) => (
                  <marker key={`${c}-${i}`} id={`ah-${i}`} markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                    <polygon points="0 0, 9 3.5, 0 7" fill={c} />
                  </marker>
                ))}
                <marker id="ah-preview" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                  <polygon points="0 0, 9 3.5, 0 7" fill={style.stroke} />
                </marker>
                <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#d8ded9" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              <g data-scene transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                <rect x={0} y={0} width={W} height={H} fill="#ffffff" />
                {[...els].sort((a, b) => (a.type === 'arrow' ? 1 : 0) - (b.type === 'arrow' ? 1 : 0)).map(renderEl)}
              </g>

              {/* 对齐参考线：跟画布一起缩放，但不属于画板内容，导出时不会带上 */}
              <g transform={`translate(${view.x},${view.y}) scale(${view.k})`} pointerEvents="none">
                {guides.v.map((x, i) => (
                  <line key={`gv${i}`} x1={x} y1={-3000} x2={x} y2={H + 3000} className="board__guide" />
                ))}
                {guides.h.map((y, i) => (
                  <line key={`gh${i}`} x1={-3000} y1={y} x2={W + 3000} y2={y} className="board__guide" />
                ))}
                {marquee && (
                  <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="board__marquee" />
                )}
                {preview && (
                  <path d={routePath(preview.x1, preview.y1, preview.x2, preview.y2, style.route)}
                    fill="none" stroke={style.stroke} strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#ah-preview)" />
                )}
              </g>

              {box && (
                <rect
                  x={box.x * view.k + view.x - 3} y={box.y * view.k + view.y - 3}
                  width={box.w * view.k + 6} height={box.h * view.k + 6}
                  className="board__selbox" pointerEvents="none"
                />
              )}

              {one && one.type !== 'arrow' && one.type !== 'draw' && HANDLE_DIRS.map((dir) => {
                const sx = one.x * view.k + view.x;
                const sy = one.y * view.k + view.y;
                const sw = one.w * view.k;
                const sh = one.h * view.k;
                const cx = dir.includes('w') ? sx : dir.includes('e') ? sx + sw : sx + sw / 2;
                const cy = dir.includes('n') ? sy : dir.includes('s') ? sy + sh : sy + sh / 2;
                return (
                  <g key={dir} data-handle={dir} style={{ cursor: DIR_CURSOR[dir] }}>
                    <rect x={cx - hitSize / 2} y={cy - hitSize / 2} width={hitSize} height={hitSize} fill="transparent" />
                    <rect x={cx - handleSize / 2} y={cy - handleSize / 2} width={handleSize} height={handleSize}
                      className="board__handle" pointerEvents="none" />
                  </g>
                );
              })}

              {one && one.type === 'arrow' && (() => {
                const { x1, y1, x2, y2 } = arrowEnds(one, els);
                return (
                  <g>
                    <circle data-end="from" cx={x1 * view.k + view.x} cy={y1 * view.k + view.y} r={6} className="board__endpoint" />
                    <circle data-end="to" cx={x2 * view.k + view.x} cy={y2 * view.k + view.y} r={6} className="board__endpoint" />
                  </g>
                );
              })()}
            </svg>

            {editing && editBox && (
              <textarea
                className="board__editor"
                autoFocus
                value={editing.value}
                style={{
                  left: editBox.left, top: editBox.top, width: editBox.width, height: editBox.height,
                  fontSize: editBox.fontSize, textAlign: editBox.align, paddingTop: editBox.padTop,
                }}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); commitEdit(); }
                  // 换行留给 Enter，完成用 Ctrl+Enter / 点别处；形状里本来就是要写多行
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(); }
                }}
              />
            )}

            {!els.length && (
              <div className="board__empty">
                <strong>从左侧挑一个形状，在画布上拖出大小</strong>
                <span>空格拖动平移 · Ctrl + 滚轮缩放 · 双击空白处直接写字 · 拖形状边缘的连线工具把两块连起来</span>
              </div>
            )}

            <div className="board__zoom">
              <button title="缩小" onClick={() => zoomBy(1 / 1.15)}><ZoomOut size={15} /></button>
              <span>{Math.round(view.k * 100)}%</span>
              <button title="放大" onClick={() => zoomBy(1.15)}><ZoomIn size={15} /></button>
              <button title="适应内容" onClick={fitContent}><Scan size={15} /></button>
              <button title="回到 100%" onClick={() => setView({ x: 0, y: 0, k: 1 })}><Maximize2 size={15} /></button>
            </div>

            <div className="board__palette">
              <button className="board__iconbtn" title="添加文本框" onClick={() => quickAdd('text')}><Type size={15} /></button>
              <button className="board__iconbtn" title="添加便签" onClick={() => quickAdd('sticky')}><StickyNote size={15} /></button>
              <button className="board__iconbtn" title="插入一条分隔线" onClick={() => quickAdd('line')}><Minus size={15} /></button>
              <span className="board__toolsep" />
              <span className="board__palettetip">
                {sel.length === 0
                  ? '拖动空白处框选'
                  : one && one.type !== 'arrow' && one.type !== 'draw'
                    ? `已选 ${sel.length} 个 · 从空白拖出下一个（同形状+连线）`
                    : `已选 ${sel.length} 个`}
              </span>
            </div>

            {ctxMenu && (() => {
              const sw = wrapRef.current?.clientWidth ?? 9999;
              const sh = wrapRef.current?.clientHeight ?? 9999;
              const MENU_W = 172;
              const MENU_H = 150;
              const left = Math.min(ctxMenu.x, Math.max(4, sw - MENU_W));
              const top = Math.min(ctxMenu.y, Math.max(4, sh - MENU_H));
              const ids = selRef.current.includes(ctxMenu.id) ? selRef.current : [ctxMenu.id];
              const delLabel = ids.length > 1 ? `删除 ${ids.length} 个元素` : '删除';
              return (
                <div className="board__ctxmenu" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
                  <button type="button" className="board__ctxitem board__ctxitem--danger"
                    onClick={() => removeEls(ids)}>
                    <Trash2 size={14} /> {delLabel}
                  </button>
                  <button type="button" className="board__ctxitem" onClick={duplicate}>
                    <Copy size={14} /> 复制
                  </button>
                  <span className="board__ctxsep" />
                  <button type="button" className="board__ctxitem" onClick={() => reorder('front')}>置于顶层</button>
                  <button type="button" className="board__ctxitem" onClick={() => reorder('back')}>置于底层</button>
                </div>
              );
            })()}
          </div>

          <aside className="board__insp">
            <section className="bi-sec">
              <h4 className="bi-title">画布</h4>
              <label className="bi-check">
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                <span>拖动时对齐吸附</span>
              </label>
              <p className="bi-hint">按住 Alt 可临时不吸附；两指滚动平移，Ctrl + 滚轮缩放。</p>
            </section>

            <section className="bi-sec">
              <h4 className="bi-title">填充</h4>
              <div className="bi-swatches">
                {PALETTE.map((c) => (
                  <button key={c.fill} type="button" title={c.fill}
                    className={`bi-swatch ${curFill === c.fill ? 'is-on' : ''}`}
                    style={{ background: c.fill, borderColor: c.fill === '#ffffff' ? 'var(--border-strong)' : c.fill }}
                    onClick={() => patchSel({ fill: c.fill, stroke: c.stroke })} />
                ))}
                <button type="button" title="无填充"
                  className={`bi-swatch bi-swatch--none ${curFill === 'none' ? 'is-on' : ''}`}
                  onClick={() => patchSel({ fill: 'none' })} />
              </div>
            </section>

            <section className="bi-sec">
              <h4 className="bi-title">描边</h4>
              <div className="bi-swatches">
                {STROKES.map((c) => (
                  <button key={c} type="button" title={c}
                    className={`bi-swatch ${curStroke === c ? 'is-on' : ''}`}
                    style={{ background: c, borderColor: c }}
                    onClick={() => patchSel({ stroke: c })} />
                ))}
              </div>
              <div className="bi-row">
                <select className="bi-select" value={curSw} onChange={(e) => patchSel({ strokeWidth: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>线宽 {n}</option>)}
                </select>
                <button type="button" className={`bi-toggle ${curDashed ? 'is-on' : ''}`}
                  onClick={() => patchSel({ dashed: !curDashed })}>虚线</button>
              </div>
            </section>

            <section className="bi-sec">
              <h4 className="bi-title">文字</h4>
              <div className="bi-row">
                <select className="bi-select" value={curFont} onChange={(e) => patchSel({ fontSize: Number(e.target.value) })}>
                  {FONT_SIZES.map((n) => <option key={n} value={n}>{n} px</option>)}
                </select>
                <div className="bi-seg">
                  <button type="button" className={curAlign === 'left' ? 'is-on' : ''} title="左对齐"
                    onClick={() => patchSel({ align: 'left' })}><AlignLeft size={14} /></button>
                  <button type="button" className={curAlign === 'center' ? 'is-on' : ''} title="居中"
                    onClick={() => patchSel({ align: 'center' })}><AlignCenter size={14} /></button>
                  <button type="button" className={curAlign === 'right' ? 'is-on' : ''} title="右对齐"
                    onClick={() => patchSel({ align: 'right' })}><AlignRight size={14} /></button>
                </div>
              </div>
            </section>

            <section className="bi-sec">
              <h4 className="bi-title">连线</h4>
              <div className="bi-seg bi-seg--wide">
                <button type="button" className={curRoute === 'elbow' ? 'is-on' : ''} title="折线"
                  onClick={() => patchSel({ route: 'elbow' })}><CornerDownRight size={14} /> 折</button>
                <button type="button" className={curRoute === 'straight' ? 'is-on' : ''} title="直线"
                  onClick={() => patchSel({ route: 'straight' })}><ArrowRight size={14} /> 直</button>
                <button type="button" className={curRoute === 'curve' ? 'is-on' : ''} title="曲线"
                  onClick={() => patchSel({ route: 'curve' })}><Spline size={14} /> 曲</button>
              </div>
              <button type="button" className="bi-btn" onClick={reverseArrow}
                disabled={!selected.some((x) => x.type === 'arrow')}>
                <ArrowLeftRight size={13} /> 反向箭头
              </button>
              <p className="bi-hint">选中连线后，两端的小圆点能拖到别的形状上重接；双击连线写「是 / 否」。</p>
            </section>

            <section className="bi-sec">
              <h4 className="bi-title">排列</h4>
              <div className="bi-seg bi-seg--wide">
                <button type="button" title="置于顶层 (Ctrl+])" onClick={() => reorder('front')}><BringToFront size={14} /></button>
                <button type="button" title="上移一层" onClick={() => reorder('up')}><ChevronUp size={14} /></button>
                <button type="button" title="下移一层" onClick={() => reorder('down')}><ChevronDown size={14} /></button>
                <button type="button" title="置于底层 (Ctrl+[)" onClick={() => reorder('back')}><SendToBack size={14} /></button>
              </div>
              <div className="bi-grid">
                <button type="button" title="左对齐" disabled={selected.length < 2} onClick={() => alignSel('left')}><AlignStartVertical size={14} /></button>
                <button type="button" title="水平居中" disabled={selected.length < 2} onClick={() => alignSel('cx')}><AlignCenterVertical size={14} /></button>
                <button type="button" title="右对齐" disabled={selected.length < 2} onClick={() => alignSel('right')}><AlignEndVertical size={14} /></button>
                <button type="button" title="顶对齐" disabled={selected.length < 2} onClick={() => alignSel('top')}><AlignStartHorizontal size={14} /></button>
                <button type="button" title="垂直居中" disabled={selected.length < 2} onClick={() => alignSel('cy')}><AlignCenterHorizontal size={14} /></button>
                <button type="button" title="底对齐" disabled={selected.length < 2} onClick={() => alignSel('bottom')}><AlignEndHorizontal size={14} /></button>
              </div>
              <div className="bi-row">
                <button type="button" className="bi-btn bi-btn--grow" title="水平等距" disabled={selected.length < 3}
                  onClick={() => distribute('h')}><AlignHorizontalDistributeCenter size={13} /> 水平等距</button>
                <button type="button" className="bi-btn bi-btn--grow" title="垂直等距" disabled={selected.length < 3}
                  onClick={() => distribute('v')}><AlignVerticalDistributeCenter size={13} /> 垂直等距</button>
              </div>
            </section>

            <section className="bi-sec">
              <h4 className="bi-title">位置与尺寸</h4>
              {one && one.type !== 'arrow' && one.type !== 'draw' ? (
                <div className="bi-geo">
                  {(['x', 'y', 'w', 'h'] as const).map((k) => (
                    <label key={k}>
                      <span>{k.toUpperCase()}</span>
                      <input type="number" value={Math.round(one[k])}
                        onFocus={() => { geoBase.current = clone(elsRef.current); }}
                        onChange={(e) => setGeo(k, Number(e.target.value))}
                        onBlur={() => {
                          if (geoBase.current && JSON.stringify(geoBase.current) !== JSON.stringify(elsRef.current)) {
                            pushHistory(geoBase.current);
                          }
                          geoBase.current = null;
                        }} />
                    </label>
                  ))}
                </div>
              ) : (
                <p className="bi-hint">选中一个形状或文本框后，可以在这里精确改位置与宽高。</p>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
