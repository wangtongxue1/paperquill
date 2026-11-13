/** 存档格式 ⇄ 编辑器格式 的双向转换。
 *
 *  存档格式（storage）是纸间笔记自己的公共契约，保持简单、稳定、可读：
 *    <ul><li class="task-item"><input type="checkbox" checked> 文案</li></ul>
 *    <pre data-lang="js"><code>…</code></pre>
 *    <a href="#" data-wiki="标题">标题</a>
 *
 *  编辑器格式（editor）是 ProseMirror / Tiptap 的规范结构：
 *    <ul data-type="taskList"><li data-type="taskItem" data-checked="true">
 *      <label><input type="checkbox" checked><span></span></label>
 *      <div><p>文案</p></div>
 *    </li></ul>
 *
 *  为什么要有这一层：Tiptap 只当「编辑面板」用，落盘永远是上面那套简单格式，
 *  于是导出、镜像、Markdown 互转、老存档迁移全都不用改——也方便随时换编辑器。
 */

const TASK_LIST = 'taskList';
const TASK_ITEM = 'taskItem';

const isCheckbox = (n: Node | null): n is HTMLInputElement =>
  !!n && n.nodeType === Node.ELEMENT_NODE &&
  (n as Element).tagName === 'INPUT' &&
  (n as HTMLInputElement).type === 'checkbox';

/** li 里第一个有意义的子节点（跳过空白与 <br>），用来判断是不是待办项。 */
function firstMeaningful(li: HTMLElement): Node | null {
  for (const n of Array.from(li.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE && !(n.textContent || '').trim()) continue;
    if (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'BR') continue;
    return n;
  }
  return null;
}

function parseBody(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html').body;
}

/** 把一个旧格式待办 li 换成 Tiptap 的 taskItem 结构。 */
function convertTaskItem(doc: Document, li: HTMLElement): HTMLElement {
  const nodes = Array.from(li.childNodes);
  const at = nodes.findIndex((n) => isCheckbox(n));
  const cb = nodes[at] as HTMLInputElement;
  const checked = cb.hasAttribute('checked') || cb.checked;

  const holder = doc.createElement('div');
  nodes.slice(at + 1).forEach((n) => holder.appendChild(n.cloneNode(true)));
  // 去掉 input 后面那个 &nbsp; 占位空白，Tiptap 里由 span 负责间距
  holder.innerHTML = holder.innerHTML.replace(/^(?:\s|&nbsp;|<br\s*\/?>)+/i, '');

  const out = doc.createElement('li');
  out.setAttribute('data-type', TASK_ITEM);
  out.setAttribute('data-checked', checked ? 'true' : 'false');

  const label = doc.createElement('label');
  const box = doc.createElement('input');
  box.setAttribute('type', 'checkbox');
  if (checked) box.setAttribute('checked', 'checked');
  label.append(box, doc.createElement('span'));

  const content = doc.createElement('div');
  const para = doc.createElement('p');
  const blocks: Element[] = [];
  Array.from(holder.childNodes).forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((n as Element).tagName)) {
      blocks.push(n as Element);
    } else {
      para.appendChild(n);
    }
  });
  if (!para.textContent?.trim() && !para.querySelector('img')) para.appendChild(doc.createElement('br'));
  content.appendChild(para);
  blocks.forEach((b) => content.appendChild(b));

  out.append(label, content);
  return out;
}

/** 存档格式 → 编辑器格式。 */
export function toEditorHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const body = doc.body;

  // 代码块：Tiptap 靠 <code class="language-x"> 认语言，这里把 data-lang 翻译过去。
  body.querySelectorAll('pre').forEach((pre) => {
    const lang = pre.getAttribute('data-lang');
    if (!lang) return;
    const code = pre.querySelector('code');
    if (code) code.classList.add(`language-${lang}`);
    pre.removeAttribute('data-lang');
  });

  // 任务列表：从里往外处理，嵌套的也能一起转。
  const lists = Array.from(body.querySelectorAll('ul, ol')).reverse();
  for (const list of lists) {
    if (list.getAttribute('data-type') === TASK_LIST) continue;
    const items = Array.from(list.children).filter((el) => el.tagName === 'LI') as HTMLLIElement[];
    if (!items.length) continue;
    // 只有「每一项开头都是复选框」才认定为待办列表，混排的普通列表保持原样。
    if (!items.every((li) => isCheckbox(firstMeaningful(li)))) continue;
    const taskList = doc.createElement('ul');
    taskList.setAttribute('data-type', TASK_LIST);
    items.forEach((li) => taskList.appendChild(convertTaskItem(doc, li)));
    list.replaceWith(taskList);
  }

  // 内链交给 WikiLink 标记解析，去掉 href 免得同时被普通链接标记接走。
  body.querySelectorAll('a[data-wiki]').forEach((a) => a.removeAttribute('href'));

  return body.innerHTML;
}

/** 编辑器格式 → 存档格式。 */
export function fromEditorHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const body = doc.body;

  body.querySelectorAll(`ul[data-type="${TASK_LIST}"]`).forEach((ul) => {
    const list = doc.createElement('ul');
    Array.from(ul.children).forEach((child) => {
      if (child.tagName !== 'LI') return;
      const li = child as HTMLElement;
      const checked = li.getAttribute('data-checked') === 'true';
      const out = doc.createElement('li');
      out.className = 'task-item';

      const content = li.querySelector(':scope > div');
      const para = content?.querySelector(':scope > p');
      const inline = (para ? para.innerHTML : '').trim();
      const box = checked ? '<input type="checkbox" checked="checked">' : '<input type="checkbox">';
      out.innerHTML = `${box} ${inline}`.trimEnd();
      // 嵌套的待办（粘贴进来的内容可能有）搬进同一个 li，保持层级
      content?.querySelectorAll(':scope > ul, :scope > ol').forEach((l) => out.appendChild(l));
      list.appendChild(out);
    });
    ul.replaceWith(list);
  });

  // 代码块：data-lang 由 CodeBlock 扩展自己写出来了，这里只清掉语言类名。
  body.querySelectorAll('pre code[class]').forEach((code) => {
    code.className = (code.className || '').replace(/language-\S+/g, '').trim();
    if (!code.className) code.removeAttribute('class');
  });

  // 内链补回 href，导出 / 预览里点得动
  body.querySelectorAll('a[data-wiki]').forEach((a) => {
    if (!a.getAttribute('href')) a.setAttribute('href', '#');
    if (!a.className) a.className = 'wikilink';
  });

  return body.innerHTML;
}

/** 待办项数量、里面勾了几项——探针与统计都用得到。 */
export function countTasks(html: string): { total: number; done: number } {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html || ''}</body>`, 'text/html');
  const boxes = Array.from(doc.querySelectorAll('li.task-item > input[type="checkbox"], li[data-type="taskItem"]'))
    .map((n) => (n.tagName === 'INPUT'
      ? (n as HTMLInputElement).hasAttribute('checked')
      : n.getAttribute('data-checked') === 'true'));
  return { total: boxes.length, done: boxes.filter(Boolean).length };
}
