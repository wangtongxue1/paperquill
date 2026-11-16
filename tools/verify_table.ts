/** 表格往返探针：md 导入 → 富文本 → 源码 → 富文本，验证表格不丢格式。
 *  跑法：node tools/run-table-probe.mjs
 */
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor-schema';
import { fromEditorHtml, toEditorHtml } from '../src/tiptap-html';
import { htmlToMd, mdToHtml } from '../src/convert';
import { noteToDocxBlob } from '../src/docx-export';
import JSZip from 'jszip';

let ok = 0;
let total = 0;
const fails: string[] = [];
const out: string[] = [];
const progressEl = document.getElementById('result') as HTMLPreElement | null;

function mark(step: string) {
  if (progressEl) progressEl.textContent = 'STEP ' + step;
}

function check(name: string, cond: boolean, extra = '') {
  total += 1;
  if (cond) { ok += 1; out.push(`ok  ${name}`); return; }
  fails.push(name);
  out.push(`FAIL ${name}${extra ? ` :: ${extra}` : ''}`);
}

function mount(html: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: buildExtensions(), content: toEditorHtml(html) });
  return editor;
}

const GFM_MD = `| 列一 | 列二 | 列三 |
| --- | :---: | ---: |
| a | b | c |
| 管道 \\| 转义 | x | y |`;

async function main() {
try {
  /* ---------- A. md 导入 → 富文本 ---------- */
  mark('A1');
  const htmlFromMd = mdToHtml(GFM_MD);
  out.push('A mdToHtml = ' + htmlFromMd.slice(0, 400));
  mark('A2');
  const edA = mount(htmlFromMd);
  const storedA = fromEditorHtml(edA.getHTML());
  const rowsA = edA.view.dom.querySelectorAll('table tr').length;
  out.push('A editor = ' + edA.getHTML().slice(0, 400));
  check('A1 md 表格进编辑器后是 table 节点', !!edA.view.dom.querySelector('table'));
  check('A2 行数=3（表头+2行）', rowsA === 3, `rows=${rowsA}`);
  check('A3 表头在 thead/th', !!edA.view.dom.querySelector('th'), edA.getHTML().slice(0, 300));
  check('A4 单元格文本完整', storedA.includes('列一') && storedA.includes('转义'), storedA.slice(0, 300));

  /* ---------- B. 富文本 → 源码（关键：turndown 默认不认识 table） ---------- */
  mark('B1');
  const RICH_SEED = `<h2>表</h2>
<table><thead><tr><th>名称</th><th>数量</th></tr></thead>
<tbody><tr><td>苹果</td><td>3</td></tr><tr><td>香 | 蕉</td><td>5</td></tr></tbody></table>`;
  const mdFromRich = htmlToMd(RICH_SEED);
  out.push('B htmlToMd = ' + mdFromRich);
  check('B1 富文本表格转 md 保留 | 分隔', mdFromRich.includes('|'), mdFromRich);
  check('B2 表头保留', mdFromRich.includes('名称') && mdFromRich.includes('数量'), mdFromRich);
  check('B3 行数不丢', mdFromRich.includes('苹果') && mdFromRich.includes('香 \\| 蕉'), mdFromRich);
  check('B4 单元格里的 | 转义', !mdFromRich.includes('|香 '), mdFromRich);

  /* ---------- C. md → rich → md → rich 全程往返 ---------- */
  mark('C1');
  const md2 = htmlToMd(storedA);
  out.push('C 往返 md = ' + md2.slice(0, 300));
  const back = mdToHtml(md2);
  check('C1 往返后表格仍在', /<table/.test(back), back.slice(0, 200));
  mark('C2');
  const edC = mount(back);
  check('C2 往返后行数仍是 3', edC.view.dom.querySelectorAll('table tr').length === 3,
    edC.view.dom.querySelectorAll('table tr').length + ' | ' + edC.getHTML().slice(0, 200));
  check('C3 转义管道往返后不串列', md2.includes('\\|'), md2);

  /* ---------- D. 无表头的纯 td 表格 ---------- */
  mark('D1');
  const TD_TABLE = `<table><tbody><tr><td>一</td><td>二</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>`;
  const mdTd = htmlToMd(TD_TABLE);
  out.push('D td 表 md = ' + mdTd);
  check('D1 纯 td 表格转 md 不丢行', mdTd.includes('一') && mdTd.includes('2'), mdTd);
  const backTd = mdToHtml(mdTd);
  check('D2 纯 td 表格 md 回来仍是表', /<table/.test(backTd), backTd.slice(0, 160));

  /* ---------- E. 表格编辑 → 存档 → 重载（模拟「保存」全链路） ---------- */
  mark('E1');
  const edE = mount(`<table><thead><tr><th>名</th><th>值</th></tr></thead><tbody><tr><td>宽</td><td>高</td></tr></tbody></table>`);
  // 1) 在单元格里打字
  const th = edE.view.dom.querySelector('tbody td') as HTMLElement;
  const posE = edE.view.posAtDOM(th, 0);
  edE.commands.focus();
  edE.commands.setTextSelection(posE + 1);
  edE.commands.insertContent('追加内容');
  // 2) 加一行
  edE.commands.addRowAfter();
  // 3) 调列宽（模拟列宽拖动落盘：给单元格设 colwidth）
  const cellPosE = posE - 1;
  edE.view.dispatch(edE.state.tr.setNodeMarkup(cellPosE, undefined,
    { ...edE.state.doc.nodeAt(cellPosE)?.attrs, colwidth: [120] }));
  const storedE = fromEditorHtml(edE.getHTML());
  out.push('E stored = ' + storedE.slice(0, 500));
  check('E1 打字内容进了存档', storedE.includes('追加内容'), storedE.slice(0, 400));
  check('E2 新行进了存档', (storedE.match(/<tr/g) || []).length >= 3, storedE.slice(0, 400));
  check('E3 列宽进了存档', /width:\s*120|colwidth/.test(storedE), storedE.slice(0, 400));
  // 重载
  mark('E4');
  const edE2 = mount(storedE);
  const rowsE2 = edE2.view.dom.querySelectorAll('table tr').length;
  check('E4 重载后内容仍在', edE2.getHTML().includes('追加内容'), edE2.getHTML().slice(0, 300));
  check('E5 重载后行数保留', rowsE2 >= 3, `rows=${rowsE2}`);
  check('E6 重载后列宽保留', edE2.getHTML().includes('120'), edE2.getHTML().slice(0, 400));
  // 4) 单元格内打字会不会触发 onUpdate（保存链路入口）
  mark('E7');
  let updates = 0;
  edE2.on('update', () => { updates += 1; });
  const td2 = edE2.view.dom.querySelectorAll('tbody td')[1] as HTMLElement;
  const pos2 = edE2.view.posAtDOM(td2, 0);
  edE2.commands.setTextSelection(pos2 + 1);
  edE2.commands.insertContent('再改');
  check('E7 单元格编辑触发 onUpdate', updates >= 1, `updates=${updates}`);

  /* ---------- F. Word 导出：真实生成 docx 并解包验证 ---------- */
  mark('F1');
  const PNG1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const F_HTML = `<h1>标题一</h1><p>普通段落 <strong>加粗</strong> <em>斜体</em> <span style="color:#ff0000">红字</span></p>` +
    `<table><thead><tr><th>名称</th><th>数量</th></tr></thead><tbody><tr><td>苹果</td><td>3</td></tr></tbody></table>` +
    `<ul><li class="task-item"><input type="checkbox" checked> 已办</li><li class="task-item"><input type="checkbox"> 待办</li></ul>` +
    `<p><img src="${PNG1PX}" alt="小图"></p>`;
  const blob = await noteToDocxBlob({
    id: 't1', title: '测试', content: F_HTML, mode: 'rich',
    createdAt: 0, updatedAt: 0, tags: [], attachments: [],
  } as never);
  check('F1 docx 生成非空', blob.size > 1000, `size=${blob.size}`);
  const zipF = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zipF.file('word/document.xml')?.async('string') || '';
  check('F2 文档里有表格', xml.includes('<w:tbl>'), xml.length.toString());
  check('F3 标题/正文/单元格文本在', xml.includes('标题一') && xml.includes('加粗') && xml.includes('苹果'), xml.length.toString());
  check('F4 待办复选框在', xml.includes('☑') && xml.includes('☐'), '');
  check('F5 图片进了 media', !!zipF.file('word/media/image1.png') || JSON.stringify(Object.keys(zipF.files)).includes('media'), '');
  check('F6 红字颜色写入', /fill|val="FF0000"/i.test(xml) || xml.includes('FF0000'), '');
  // base64 落盘给外部做真实打开校验（ runner 会写到 .temp/sample-export.docx ）
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  out.push('DOCX_B64=' + btoa(bin));
} catch (err) {
  out.push(`CRASH: ${err}`);
}
mark('final');
const el = document.createElement('pre');
el.id = 'result-final';
el.textContent = `ok=${ok}/${total}\n` + out.join('\n') + '\nRESULT ok=' + ok + '/' + total + (fails.length ? ' fails=' + fails.join(',') : ' all-pass') + '\ndone=1';
document.body.appendChild(el);
}
void main();
