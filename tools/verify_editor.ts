/** 编辑器内核断言：在真浏览器里把 Tiptap 编辑器跑起来，验证「参考 Obsidian 那套做法」的
 *  关键行为——待办回车续行、空项回车跳出、勾选写进文档模型、表格增行、代码块语言、
 *  内链往返、以及存档格式 ⇄ 编辑格式的双向转换。
 *
 *  跑法：node tools/run-editor-probe.mjs
 */
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor-schema';
import { countTasks, fromEditorHtml, toEditorHtml } from '../src/tiptap-html';
import { htmlToMd, mdToHtml } from '../src/convert';

let ok = 0;
const fails: string[] = [];
const log: string[] = [];

function check(name: string, cond: boolean, extra = '') {
  if (cond) { ok += 1; return; }
  fails.push(name);
  log.push(`FAIL ${name}${extra ? ` :: ${extra}` : ''}`);
}

function mount(html: string, tag: string) {
  const host = document.createElement('div');
  host.setAttribute('data-tag', tag);
  document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: buildExtensions(), content: toEditorHtml(html) });
  return { host, editor, root: host.querySelector('.ProseMirror') as HTMLElement };
}

/** 把光标放到某个元素末尾（或开头）。走编辑器的选区 API，
 *  只改 DOM 选区的话 ProseMirror 的 state.selection 还是旧的，按键处理会落空。 */
function caretIn(editor: Editor, dom: HTMLElement | null, atEnd = true) {
  if (!dom) return;
  const pos = editor.view.posAtDOM(dom, 0);
  editor.commands.setTextSelection(atEnd ? pos + (dom.textContent || '').length : pos);
  editor.commands.focus();
}

function key(el: HTMLElement, keyName: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));
}

const TASK_SEED = `<h2>待办</h2>
<ul>
  <li class="task-item"><input type="checkbox" checked> 已经做完的</li>
  <li class="task-item"><input type="checkbox"> 还没做的</li>
</ul>`;

/* ---------- 1. 存档格式 → 编辑格式 ---------- */
const edited = toEditorHtml(TASK_SEED);
check('待办列表转成 taskList', /data-type="taskList"/.test(edited), edited.slice(0, 120));
check('勾选状态带到 data-checked=true', /data-checked="true"/.test(edited));
check('未勾选状态带到 data-checked=false', /data-checked="false"/.test(edited));
check('checkbox 自己带 checked 属性', /<input type="checkbox" checked="checked">/.test(edited));
check('正文文字没丢', edited.includes('已经做完的') && edited.includes('还没做的'));

/* ---------- 2. 编辑器里的结构 ---------- */
const a = mount(TASK_SEED, 'a');
// Tiptap 的 nodeView 只渲染 data-checked，不写 data-type，所以按 data-checked 找
const tasksOf = (host: HTMLElement) => Array.from(host.querySelectorAll('li[data-checked]')) as HTMLElement[];
check('编辑器里是 2 个 taskItem', tasksOf(a.host).length === 2, String(tasksOf(a.host).length));
check('第一项文字在 div>p 里（结构不会被文本节点撑破）',
  !!tasksOf(a.host)[0]?.querySelector('div > p')?.textContent?.includes('已经做完的'));
check('复选框是 li 的第一个 label 里的 input',
  tasksOf(a.host)[0]?.firstElementChild?.tagName === 'LABEL' &&
  !!tasksOf(a.host)[0]?.querySelector('label > input[type="checkbox"]'));

/* ---------- 3. 待办里回车 = 续一行待办（不再把结构拆坏） ---------- */
const firstP = tasksOf(a.host)[0]?.querySelector('p');
caretIn(a.editor, firstP as HTMLElement | null, true);
key(a.root, 'Enter');
check('回车后多出一个待办项', tasksOf(a.host).length === 3, String(tasksOf(a.host).length));
// 注意：label 里有一段给读屏用的隐藏文案，比较文字要看 div 而不是 li.textContent
check('新待办是空的', (tasksOf(a.host)[1]?.querySelector('div')?.textContent || '').trim() === '');
check('原来的文字没被切走', (tasksOf(a.host)[0]?.querySelector('div')?.textContent || '').includes('已经做完的'));
check('新待办没有被勾上', tasksOf(a.host)[1]?.getAttribute('data-checked') === 'false');

/* ---------- 4. 空待办回车 = 跳出清单 ---------- */
const emptyP = tasksOf(a.host)[1]?.querySelector('p');
caretIn(a.editor, emptyP as HTMLElement | null, false);
key(a.root, 'Enter');
check('空待办回车后跳出清单', tasksOf(a.host).length === 2, String(tasksOf(a.host).length));

/* ---------- 5. 点复选框 → 写进文档模型 → 落盘带 checked ---------- */
const b = mount(TASK_SEED, 'b');
let updates = 0;
b.editor.on('update', () => { updates += 1; });
const box = b.host.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement;
box.checked = true;
box.dispatchEvent(new Event('change', { bubbles: true }));
check('勾选触发一次文档更新', updates > 0, String(updates));
check('勾选后节点属性变了',
  b.host.querySelectorAll('li[data-checked]')[1]?.getAttribute('data-checked') === 'true');
const storedAfter = fromEditorHtml(b.editor.getHTML());
check('落盘 HTML 带 checked', /<input type="checkbox" checked="checked">/.test(storedAfter), storedAfter.slice(0, 160));
check('落盘仍是纸间笔记的简单格式', /<li class="task-item">/.test(storedAfter) && !/taskItem/.test(storedAfter));
check('存档里的待办计数对得上', countTasks(storedAfter).total === 2 && countTasks(storedAfter).done === 2);

/* ---------- 6. 存档格式 ⇄ 编辑格式 往返一致 ---------- */
const once = fromEditorHtml(toEditorHtml(TASK_SEED));
const twice = fromEditorHtml(toEditorHtml(once));
check('往返两次结果稳定', once === twice, `${once.slice(0, 80)} != ${twice.slice(0, 80)}`);
check('往返后文字与勾选都在', once.includes('还没做的') && /checked="checked"/.test(once));

/* ---------- 6b. 和 Markdown 互通 ---------- */
const md = htmlToMd(once);
check('转回 Markdown 是 - [x] / - [ ]',
  /- \[x\]/.test(md) && /- \[ \]/.test(md), md.slice(0, 160));
const backHtml = mdToHtml(md);
check('Markdown 再转回来还是待办', countTasks(backHtml).total === 2, backHtml.slice(0, 160));

/* ---------- 7. 表格 ---------- */
const c = mount('<p>前</p>', 'c');
c.editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
const rowCount = () => c.host.querySelectorAll('table tr').length;
check('插入表格', c.host.querySelectorAll('table').length === 1);
const rows0 = rowCount();
c.editor.commands.addRowAfter();
check('下方加一行生效', rowCount() === rows0 + 1, `${rows0} → ${rowCount()}`);
c.editor.commands.addColumnAfter();
check('右侧加一列生效', c.host.querySelectorAll('table tr')[0].children.length === 3);
c.editor.commands.deleteTable();
check('删除表格生效', c.host.querySelectorAll('table').length === 0);

/* ---------- 8. 代码块语言 ---------- */
const code = mount('<pre data-lang="js"><code>let a = 1</code></pre>', 'd');
const codeJson = JSON.stringify(code.editor.getJSON());
check('代码块语言读进模型', codeJson.includes('"lang":"js"'), codeJson.slice(0, 160));
check('代码块落盘保留 data-lang', /data-lang="js"/.test(fromEditorHtml(code.editor.getHTML())),
  fromEditorHtml(code.editor.getHTML()).slice(0, 120));

/* ---------- 9. 待办开关（把普通段落变成清单） ---------- */
const e = mount('<p>买牛奶</p>', 'e');
e.editor.commands.selectAll();
e.editor.commands.toggleTaskList();
check('段落能变成待办', e.host.querySelectorAll('li[data-checked]').length === 1);
check('变成待办后文字还在', (e.host.textContent || '').includes('买牛奶'));

/* ---------- 10. 内链往返 ---------- */
const wikiStored = '<p>先看 <a href="#" class="wikilink" data-wiki="欢迎来到纸间笔记">欢迎来到纸间笔记</a></p>';
const f = mount(wikiStored, 'f');
check('内链在编辑器里保留 data-wiki', f.editor.getHTML().includes('data-wiki="欢迎来到纸间笔记"'),
  f.editor.getHTML().slice(0, 200));
const wikiBack = fromEditorHtml(f.editor.getHTML());
check('内链落盘仍能转回 [[标题]]', /data-wiki="欢迎来到纸间笔记"/.test(wikiBack) && /href="#"/.test(wikiBack), wikiBack);

/* ---------- 11. 行首语法：[] + 空格 → 检查清单 ---------- */
const h = mount('<p>[]</p>', 'h');
const para = h.host.querySelector('p');
const at = h.editor.view.posAtDOM(para, 0) + 2;   // 光标在 "[]" 之后
const handled = h.editor.view.someProp('handleTextInput', (f) =>
  f(h.editor.view, at, at, ' '));
check('输入 [] + 空格被输入规则接管', handled === true, String(handled));
check('[] + 空格 变成一条待办', h.host.querySelectorAll('li[data-checked]').length === 1,
  h.editor.getHTML().slice(0, 160));
check('新待办默认未勾选', h.host.querySelector('li[data-checked]')?.getAttribute('data-checked') === 'false');

const hx = mount('<p>[x]</p>', 'hx');
const px = hx.host.querySelector('p');
const atx = hx.editor.view.posAtDOM(px, 0) + 3;
hx.editor.view.someProp('handleTextInput', (f) => f(hx.editor.view, atx, atx, ' '));
check('[x] + 空格 变成已勾选的待办',
  hx.host.querySelector('li[data-checked]')?.getAttribute('data-checked') === 'true',
  hx.editor.getHTML().slice(0, 160));

const hh = mount('<p>#</p>', 'hh');
const ph = hh.host.querySelector('p');
const ath = hh.editor.view.posAtDOM(ph, 0) + 1;
hh.editor.view.someProp('handleTextInput', (f) => f(hh.editor.view, ath, ath, ' '));
check('# + 空格 变成一级标题', !!hh.host.querySelector('h1'), hh.editor.getHTML().slice(0, 120));

/* ---------- 12. 标题 1–6 级：Markdown ⇄ 编辑器往返不掉级 ---------- */
const md6 = ['# 一', '## 二', '### 三', '#### 四', '##### 五', '###### 六'].join('\n');
const j6 = mount(mdToHtml(md6), 'h6levels');
check('六级标题都能进编辑器',
  [1, 2, 3, 4, 5, 6].every((lv) => !!j6.host.querySelector(`h${lv}`)),
  j6.editor.getHTML().slice(0, 240));
const back6 = htmlToMd(toEditorHtml(j6.editor.getHTML()));
check('六级标题往返不掉级',
  ['# 一', '## 二', '### 三', '#### 四', '##### 五', '###### 六'].every((line) => back6.includes(line)),
  back6.slice(0, 240));

/* ---------- 13. 撤销 ---------- */
const g = mount('<p>原文</p>', 'g');
g.editor.chain().focus().insertContent('追加').run();
g.editor.commands.undo();
check('撤销能回退插入', !(g.editor.getHTML().includes('追加')), g.editor.getHTML());

/* ---------- 输出 ---------- */
const summary = `ok=${ok} fail=${fails.length}${fails.length ? ' · ' + fails.join(' / ') : ''}`;
log.unshift(summary);
const pre = document.getElementById('out') || document.body.appendChild(document.createElement('pre'));
pre.id = 'out';
pre.textContent = log.join('\n');
