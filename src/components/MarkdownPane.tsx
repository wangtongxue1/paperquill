/** Markdown 源码编辑面板。
 *
 *  做法参考 CodeMirror 的「双层」思路，但不引内核：
 *    下层一个 <pre> 负责语法高亮，上层一个透明文字的 <textarea> 负责输入与光标。
 *  两层字体、行高、内边距完全一致，滚动同步，所以看起来就是一个带高亮的编辑器。
 *
 *  好处：输入法、选区、撤销、复制粘贴全用浏览器原生的，行为不会「像自研编辑器」那样别扭。
 */
import { forwardRef, useEffect, useMemo, useRef } from 'react';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 行内标记。只做「着色」，不改变文本内容，所以拼错也不会影响源码。 */
function inline(line: string): string {
  let s = line;
  s = s.replace(/`([^`\n]+)`/g, '<i class="md-inline-code">`$1`</i>');
  s = s.replace(/\[\[([^\]\n]+)\]\]/g, '<i class="md-wiki">[[$1]]</i>');
  s = s.replace(/!?\[([^\]\n]*)\]\(([^)\n]+)\)/g, (m) => `<i class="md-link">${m}</i>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<i class="md-strong">**$1**</i>');
  s = s.replace(/~~([^~\n]+)~~/g, '<i class="md-del">~~$1~~</i>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i class="md-em">*$2*</i>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<i class="md-url">$2</i>');
  return s;
}

/** 整段高亮：代码块整块按代码着色，其余逐行分析。 */
export function highlightMarkdown(src: string): string {
  const out: string[] = [];
  let fence = false;
  for (const raw of src.split('\n')) {
    const line = esc(raw);
    if (/^\s*```/.test(raw)) {
      out.push(`<i class="md-fence">${line}</i>`);
      fence = !fence;
      continue;
    }
    if (fence) { out.push(`<i class="md-code">${line}</i>`); continue; }

    if (/^\s{0,3}#{1,6}\s/.test(raw)) {
      out.push(line.replace(/^(\s{0,3})(#{1,6})(\s+)(.*)$/,
        (_, sp, h, gap, t) => `${sp}<i class="md-hash">${h}</i>${gap}<i class="md-heading">${t}</i>`));
      continue;
    }
    if (/^\s{0,3}&gt;\s?/.test(line)) {
      out.push(line.replace(/^(\s{0,3})(&gt;\s?)(.*)$/, '$1<i class="md-quote-mark">$2</i><i class="md-quote">$3</i>'));
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s-]*$/.test(raw)) {
      out.push(`<i class="md-hr">${line}</i>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(raw)) {
      out.push(`<i class="md-table">${inline(line)}</i>`);
      continue;
    }
    // 待办单独成支：方括号标记与正文分成两个 span，勾选后正文才能整段淡下去。
    // 标记不再是一串高饱和的加粗字符，而是「浅灰的框 + 勾选时点亮」，看着像一个控件。
    // 注意 ] 后面的空格属于「标记与正文的分隔」，要原样输出，否则字会粘在一起。
    const task = /^(\s*)([-*+]|\d+[.)])(\s+)\[([ xX])\](\s+|$)/.exec(raw);
    if (task) {
      const [, ind, mark, gap, flag, after] = task;
      const done = flag.toLowerCase() === 'x';
      const body = esc(raw.slice(task[0].length));
      out.push(
        `${ind}<i class="md-mark md-mark--quiet">${mark}</i>${gap}`
        + `<i class="md-task${done ? ' is-done' : ''}">[${flag}]</i>`
        + after
        + `<i class="md-tasktext${done ? ' is-done' : ''}">${body}</i>`,
      );
      continue;
    }
    out.push(line.replace(/^(\s*)([-*+]|\d+[.)])(\s+)/,
      (_, ind, mark, gap) => `${ind}<i class="md-mark">${mark}</i>${gap}`));
  }
  // 上一步只处理了行首，行内标记要再过一遍（跳过已经插入的标签文本不会误伤）
  return out.map((l) => (l.includes('md-code') || l.includes('md-fence') ? l : inline(l))).join('\n');
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (e: React.DragEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
  placeholder?: string;
}

/** 对外暴露的还是那个 textarea，方便外面读写光标位置。 */
const MarkdownPane = forwardRef<HTMLTextAreaElement, Props>(function MarkdownPane(props, ref) {
  const { value, onChange, onPaste, onDrop, onKeyDown, onBlur, placeholder } = props;
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const html = useMemo(() => highlightMarkdown(value) + '\n', [value]);

  const attach = (el: HTMLTextAreaElement | null) => {
    taRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
  };

  // 内容变化后把高亮层滚到和输入区一样的位置（例如用工具栏插入时）。
  useEffect(() => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (ta && pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
  }, [value]);

  return (
    <div className="md-editor">
      <pre ref={preRef} className="md-editor__hl" aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: html }} />
      <textarea
        ref={attach}
        className="md-editor__input"
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          const pre = preRef.current;
          if (!pre) return;
          pre.scrollTop = e.currentTarget.scrollTop;
          pre.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onPaste={onPaste}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    </div>
  );
});

export default MarkdownPane;
