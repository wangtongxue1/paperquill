/** 日期时间选择器。
 *
 *  刻意不用 `<input type="datetime-local">`：Chromium 的原生弹层是一个又宽又高的
 *  系统控件，配色跟纸间笔记的主题完全割裂，位置也不受我们控制（只能挂在输入框下面），
 *  中文界面里还会夹着系统自己的按钮。这里自己画一个小日历 + 时:分，尺寸固定、
 *  跟随明暗主题，弹层由调用方按光标位置摆放。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 视口坐标。 */
interface Rect { left: number; top: number; }
export interface Anchor extends Rect { bottom: number; }
export interface Bounds extends Rect { width: number; height: number; }

export interface DateParts { y: number; m: number; d: number; hh: number; mm: number }

/** 存档里的时间戳统一是「YYYY-MM-DD HH:mm」；解析不出来就退回此刻。 */
export function parseDateTime(v: string): DateParts {
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(v || '');
  if (m) {
    return { y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mm: +m[5] };
  }
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(), hh: n.getHours(), mm: n.getMinutes() };
}

/** 全系统统一的时间值格式：时间戳 ↔ 'YYYY-MM-DD HH:mm'（本地时区）。 */
export function timestampToDateTime(ts: number): string {
  const n = new Date(ts);
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())} ${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
}

export function dateTimeToTimestamp(v: string): number {
  const p = parseDateTime(v);
  return new Date(p.y, p.m - 1, p.d, p.hh, p.mm, 0, 0).getTime();
}

interface Props {
  label: string;
  /** 打开时的值，'YYYY-MM-DD HH:mm'。 */
  value: string;
  /** 锚点（光标或那个时间戳）的视口坐标，弹层优先挂在它下方。停靠模式可省略。 */
  anchor?: Anchor;
  /** 容器（.rich-shell）的视口矩形，弹层不越出这个范围。停靠模式可省略。 */
  bounds?: Bounds;
  /** 停靠模式：不做绝对定位、跟着弹窗内容排版；改动实时回传，确认交给弹窗自己。
   *  编辑器里仍是浮层。两者共用同一套日历 / 时间 / 主题样式。 */
  docked?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export default function DateTimePop({ label, value, anchor, bounds, docked = false, onConfirm, onCancel }: Props) {
  const init = useMemo(() => parseDateTime(value), [value]);
  const [date, setDate] = useState({ y: init.y, m: init.m, d: init.d });
  const [hh, setHh] = useState(pad2(init.hh));
  const [mm, setMm] = useState(pad2(init.mm));
  const [view, setView] = useState({ y: init.y, m: init.m });
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() };
  }, []);

  // 位置只能量完再定：日历是 5 行还是 6 行会改高度，硬编码估算值会在
  // 「下方放不下 → 翻到上方 → 上方也放不下」时被夹到顶上，离光标十万八千里。
  useLayoutEffect(() => {
    if (docked || !anchor || !bounds) return;
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = clamp(anchor.left - bounds.left - 12, 8, Math.max(8, bounds.width - w - 10));
    const below = anchor.bottom - bounds.top + 6;
    const above = anchor.top - bounds.top - h - 6;
    // 优先下方；下方放不下翻上方；两边都放不下就退回下方（宁可贴着光标溢一点，
    // 也不要飞到一个跟光标无关的位置）。
    const top = below + h <= bounds.height - 8 ? below
      : above >= 8 ? above
      : Math.max(8, Math.min(below, bounds.height - h - 8));
    setPos({ left, top });
    // view 进依赖：翻到 6 行的月份时高度会变，得重新量一次再摆。
  }, [docked, anchor, bounds, view]);

  // 打开就接管键盘：Esc 关掉、回车确认，不用先点一下面板。
  // 停靠模式不抢焦点，免得弹窗一打开就滚到日历上。
  useEffect(() => {
    if (!docked) boxRef.current?.focus();
  }, [docked]);

  const compose = (d: { y: number; m: number; d: number }, h: string, mi: string) =>
    `${d.y}-${pad2(d.m)}-${pad2(d.d)} ${pad2(clamp(parseInt(h, 10) || 0, 0, 23))}:${pad2(clamp(parseInt(mi, 10) || 0, 0, 59))}`;

  /** 停靠模式下没有「确定」按钮：日/时/分一改就实时回传给弹窗。 */
  const cbRef = useRef(onConfirm);
  cbRef.current = onConfirm;
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (!docked) return;
    const out = compose(date, hh, mm);
    lastEmitted.current = out;
    cbRef.current(out);
  }, [docked, date, hh, mm]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 外部改了值（例如「1 小时后」快捷按钮）时回灌内部状态；
   *  自己刚发出的值不回灌，避免 setValue → 重渲染 → 覆盖正在编辑的时/分。 */
  useEffect(() => {
    if (!docked || lastEmitted.current === value) return;
    const p = parseDateTime(value);
    setDate({ y: p.y, m: p.m, d: p.d });
    setHh(pad2(p.hh));
    setMm(pad2(p.mm));
    setView({ y: p.y, m: p.m });
  }, [docked, value]);

  /** 周一开头；空位渲染成占位格。行数按需（4~6 行），CSS 给 5 行的高度兜底。 */
  const cells = useMemo(() => {
    const lead = (new Date(view.y, view.m - 1, 1).getDay() + 6) % 7;
    const total = new Date(view.y, view.m, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let d = 1; d <= total; d += 1) out.push(d);
    while (out.length % 7) out.push(null);
    return out;
  }, [view]);

  const shiftMonth = (delta: number) => {
    const m0 = view.m - 1 + delta;
    setView({ y: view.y + Math.floor(m0 / 12), m: (((m0 % 12) + 12) % 12) + 1 });
  };

  const toNow = () => {
    const n = new Date();
    setDate({ y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() });
    setView({ y: n.getFullYear(), m: n.getMonth() + 1 });
    setHh(pad2(n.getHours()));
    setMm(pad2(n.getMinutes()));
  };

  const confirm = () => onConfirm(compose(date, hh, mm));

  const digit = (raw: string) => raw.replace(/\D/g, '').slice(0, 2);
  const normalize = (raw: string, hi: number) => pad2(clamp(parseInt(raw, 10) || 0, 0, hi));

  return (
    <div
      className={`dtp${docked ? ' dtp--docked' : ''}`} ref={boxRef} tabIndex={-1}
      title={label} aria-label={label}
      style={docked ? undefined : {
        left: pos ? pos.left : 0,
        top: pos ? pos.top : 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      }}
    >
      <div className="dtp__monthbar">
        <button type="button" className="dtp__nav" title="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft size={14} /></button>
        <span className="dtp__month">{view.y} 年 {view.m} 月</span>
        <button type="button" className="dtp__nav" title="下个月" onClick={() => shiftMonth(1)}><ChevronRight size={14} /></button>
        <button type="button" className="dtp__x" title={docked ? '收起 (Esc)' : '取消 (Esc)'} onClick={onCancel}><X size={13} /></button>
      </div>

      <div className="dtp__week">
        {WEEK.map((w) => <span key={w}>{w}</span>)}
      </div>

      <div className="dtp__grid">
        {cells.map((d, i) => {
          if (d === null) return <span key={`b${i}`} className="dtp__day is-blank" />;
          const on = d === date.d && view.y === date.y && view.m === date.m;
          const isToday = d === today.d && view.y === today.y && view.m === today.m;
          return (
            <button
              key={d} type="button"
              className={`dtp__day${on ? ' is-on' : ''}${isToday ? ' is-today' : ''}`}
              title={isToday ? '今天' : undefined}
              onClick={() => setDate({ y: view.y, m: view.m, d })}
            >{d}</button>
          );
        })}
      </div>

      <div className="dtp__time">
        <span className="dtp__label">时间</span>
        <input
          className="dtp__num" inputMode="numeric" maxLength={2} value={hh} aria-label="时"
          onChange={(e) => setHh(digit(e.target.value))}
          onBlur={() => setHh(normalize(hh, 23))}
        />
        <span className="dtp__colon">:</span>
        <input
          className="dtp__num" inputMode="numeric" maxLength={2} value={mm} aria-label="分"
          onChange={(e) => setMm(digit(e.target.value))}
          onBlur={() => setMm(normalize(mm, 59))}
        />
        <button type="button" className="dtp__now" title="填成此刻" onClick={toNow}>此刻</button>
      </div>

      {!docked && (
        <div className="dtp__foot">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="dtp__ok" onClick={confirm}><Check size={13} /> 确定</button>
        </div>
      )}
    </div>
  );
}
