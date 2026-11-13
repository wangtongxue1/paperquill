/** 笔记内容内的查找 / 替换条。
 *
 *  和「全局搜索」分开：Ctrl+F 落在编辑区时打开这条，命中的是**当前笔记正文**，
 *  可以逐条跳、逐条替换或全部替换；想搜所有笔记用条上的「全部笔记」按钮。
 *  查找/替换的具体执行交给外层（富文本走 Tiptap 文档，源码视图走 textarea）。 */
import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

interface Props {
  query: string;
  setQuery: (v: string) => void;
  replacement: string;
  setReplacement: (v: string) => void;
  showReplace: boolean;
  setShowReplace: (v: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  /** 命中总数与当前序号（0 起，无命中为 -1）。 */
  total: number;
  current: number;
  /** 再次按 Ctrl+F 时递增，用来重新聚焦输入框。 */
  focusToken: number;
  onPrev: () => void;
  onNext: () => void;
  onReplaceOne: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
  onGlobalSearch: () => void;
}

export default function FindBar(p: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [p.focusToken]);

  const count = !p.query ? '' : p.total ? `${p.current + 1} / ${p.total}` : '无结果';

  return (
    <div className="findbar" role="search">
      <div className="findbar__row">
        <Search size={14} className="findbar__ico" />
        <input ref={inputRef} className="findbar__input" value={p.query}
          placeholder="在这篇笔记里查找…" title="查找（Enter 下一个，Shift+Enter 上一个，Esc 关闭）"
          onChange={(e) => p.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose(); }
            else if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) p.onPrev(); else p.onNext(); }
          }} />
        <span className={`findbar__count${p.query && !p.total ? ' is-empty' : ''}`}>{count}</span>
        <button type="button" title="上一个 (Shift+Enter)" disabled={!p.total} onClick={p.onPrev}><ChevronUp size={14} /></button>
        <button type="button" title="下一个 (Enter)" disabled={!p.total} onClick={p.onNext}><ChevronDown size={14} /></button>
        <button type="button" className={`findbar__aa${p.caseSensitive ? ' is-active' : ''}`}
          title="区分大小写" onClick={() => p.setCaseSensitive(!p.caseSensitive)}>Aa</button>
        <button type="button" className={`findbar__toggle${p.showReplace ? ' is-active' : ''}`}
          title="展开 / 收起替换" onClick={() => p.setShowReplace(!p.showReplace)}>替换</button>
        <button type="button" className="findbar__global" title="搜索所有笔记" onClick={p.onGlobalSearch}>全部笔记</button>
        <button type="button" title="关闭 (Esc)" onClick={p.onClose}><X size={14} /></button>
      </div>
      {p.showReplace && (
        <div className="findbar__row findbar__row--replace">
          <input className="findbar__input" value={p.replacement}
            placeholder="替换为（留空表示删除）" title="替换（Enter 替换当前一处）"
            onChange={(e) => p.setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose(); }
              else if (e.key === 'Enter') { e.preventDefault(); p.onReplaceOne(); }
            }} />
          <button type="button" disabled={!p.total} onClick={p.onReplaceOne}>替换</button>
          <button type="button" disabled={!p.total} onClick={p.onReplaceAll}>全部替换</button>
        </div>
      )}
    </div>
  );
}
