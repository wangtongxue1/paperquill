/** 表格往返探针：md 导入 → 富文本 → 源码 → 富文本，验证表格不丢格式。
 *  跑法：node tools/run-table-probe.mjs
 */
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor-schema';
import { fromEditorHtml, toEditorHtml } from '../src/tiptap-html';
import { htmlToMd, mdToHtml } from '../src/convert';
import { noteToDocxBlob } from '../src/docx-export';
import { cellFullyMarked, cellSelInfo, selectTableLadder } from '../src/table-select';
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
  /* ---------- G. 表内框选 + 统一格式（2.5.14：选择动作从「表格菜单」搬进表里） ---------- */
  mark('G1');
  const edG = mount(`<table><thead><tr><th>名</th><th>值</th><th>备注</th></tr></thead>`
    + `<tbody><tr><td>甲</td><td>1</td><td>x</td></tr><tr><td>乙</td><td>2</td><td>y</td></tr></tbody></table>`);
  const applyCells = (ed: Editor, fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    const info = cellSelInfo(ed.state);
    if (!info) { fn(ed.chain().focus()).run(); return; }
    let c = ed.chain().focus();
    for (const r of info.ranges) c = fn(c.setTextSelection({ from: r.from, to: r.to }));
    c.setCellSelection({ anchorCell: info.anchor, headCell: info.head }).run();
  };
  const tdG = edG.view.dom.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1] as HTMLElement;
  edG.commands.focus();
  edG.commands.setTextSelection(edG.view.posAtDOM(tdG, 0) + 1);
  const step1 = selectTableLadder(edG.state, (tr) => edG.view.dispatch(tr));
  check('G1 一次 Ctrl+A 选中当前单元格', step1 && (cellSelInfo(edG.state)?.ranges.length ?? 0) === 1,
    `handled=${step1} cells=${cellSelInfo(edG.state)?.ranges.length}`);
  mark('G2');
  const step2 = selectTableLadder(edG.state, (tr) => edG.view.dispatch(tr));
  check('G2 二次 Ctrl+A 选中整张表（9 格）', step2 && (cellSelInfo(edG.state)?.ranges.length ?? 0) === 9,
    `cells=${cellSelInfo(edG.state)?.ranges.length}`);
  mark('G3');
  check('G3 三次 Ctrl+A 让回默认（整篇）', selectTableLadder(edG.state, (tr) => edG.view.dispatch(tr)) === false, '');
  // 回到整表框选，统一加粗
  selectTableLadder(edG.state, (tr) => edG.view.dispatch(tr));
  applyCells(edG, (c) => c.setMark('bold'));
  const htmlG = edG.getHTML();
  check('G4 统一加粗覆盖每一格', (htmlG.match(/<strong>/g) || []).length === 9, (htmlG.match(/<strong>/g) || []).length + ' | ' + htmlG.slice(0, 300));
  check('G5 改完格式后框选还在', (cellSelInfo(edG.state)?.ranges.length ?? 0) === 9, `cells=${cellSelInfo(edG.state)?.ranges.length}`);
  const allBold = (cellSelInfo(edG.state)?.ranges ?? []).every((r) => cellFullyMarked(r.node, 'bold'));
  check('G6 全部已加粗时判定为「该取消」', allBold, '');
  edG.commands.undo();
  check('G7 一次撤销就能整体回退（一条事务）', (edG.getHTML().match(/<strong>/g) || []).length === 0,
    (edG.getHTML().match(/<strong>/g) || []).length + '');
  // 统一字号：textStyle 落到每一格
  if (!cellSelInfo(edG.state)) selectTableLadder(edG.state, (tr) => edG.view.dispatch(tr));
  applyCells(edG, (c) => c.setFontSize('20px'));
  const htmlG2 = edG.getHTML();
  check('G8 统一字号落到每格', (htmlG2.split('20px').length - 1) >= 9,
    (htmlG2.split('20px').length - 1) + ' | ' + htmlG2.slice(0, 300));
  check('G9 改字号后表格结构没变形', (htmlG2.match(/<tr/g) || []).length === 3 && (htmlG2.match(/<td/g) || []).length === 6,
    htmlG2.slice(0, 200));

  /* ---------- H. 真·鼠标拖动框选（prosemirror-tables 的 mousedown+mousemove） ---------- */
  mark('H1');
  const edH = mount(`<table><tbody><tr><td>a1</td><td>b1</td><td>c1</td></tr>`
    + `<tr><td>a2</td><td>b2</td><td>c2</td></tr></tbody></table>`);
  edH.commands.focus();
  // 探针页里前面已经挂了七八个编辑器，这张表可能落在视口外——先滚进视野，
  // 否则 posAtCoords 取不到坐标，拖动事件会被当成「点空白」直接忽略。
  edH.view.dom.scrollIntoView({ block: 'center' });
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const tdH = Array.from(edH.view.dom.querySelectorAll('td')) as HTMLElement[];
  out.push('H rects = ' + tdH.slice(0, 2).map((el) => JSON.stringify(el.getBoundingClientRect())).join(' '));
  const mid = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
  };
  const fire = (target: EventTarget, type: string, at: { clientX: number; clientY: number }) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...at }));
  const a1 = mid(tdH[0]);
  const b2 = mid(tdH[4]);
  fire(tdH[0], 'mousedown', a1);
  fire(document, 'mousemove', b2);
  fire(tdH[4], 'mousemove', b2);
  fire(document, 'mouseup', b2);
  const selectedCells = edH.view.dom.querySelectorAll('.selectedCell').length;
  const info = cellSelInfo(edH.state);
  check('H1 鼠标从 a1 拖到 b2 选中 4 格', selectedCells === 4 && (info?.ranges.length ?? 0) === 4,
    `dots=${selectedCells} ranges=${info?.ranges.length ?? 0}`);

  /* ---------- I. 样式类格式往返（2.5.14 补：切源码不再丢下划线/颜色/对齐等） ---------- */
  mark('I1');
  const RICH_STYLE = `<h2 style="text-align:center">居中标题</h2>`
    + `<p style="text-align:center">前<u>下划</u><s>删除</s><sub>下标</sub><sup>上标</sup>`
    + `<mark style="background-color: #fff3b8">高亮</mark>`
    + `<span style="color: #e03e3e">红字</span>`
    + `<span style="font-size: 20px">大字</span>`
    + `<span style="font-family: KaiTi">楷体</span></p>`;
  const mdStyle = htmlToMd(RICH_STYLE);
  out.push('I mdStyle = ' + mdStyle);
  check('I1 删除线写成 ~~', mdStyle.includes('~~删除~~'), mdStyle);
  check('I2 下划线保留 <u>', mdStyle.includes('<u>下划</u>'), mdStyle);
  check('I3 高亮带底色', /<mark style="background-color: (#[0-9a-fA-F]+|rgb\([^)]+\))">高亮<\/mark>/.test(mdStyle), mdStyle);
  check('I4 文字颜色/字号/字体进 span', mdStyle.includes('color: #e03e3e') && mdStyle.includes('font-size: 20px') && mdStyle.includes('font-family: KaiTi'), mdStyle);
  check('I5 对齐包了 data-block-align', mdStyle.includes('data-block-align="center"') && (mdStyle.match(/data-block-align/g) || []).length === 2, mdStyle);

  mark('I6');
  const htmlStyle = mdToHtml(mdStyle);
  check('I6 回到 HTML 后对齐还原到 h2/p', /<h2 style="[^"]*text-align: center/.test(htmlStyle) && /<p style="[^"]*text-align: center/.test(htmlStyle), htmlStyle.slice(0, 400));
  check('I7 行内样式标签都在', htmlStyle.includes('<u>') && htmlStyle.includes('<del>') && htmlStyle.includes('<mark') && htmlStyle.includes('color: #e03e3e') && htmlStyle.includes('font-size: 20px') && htmlStyle.includes('KaiTi'), htmlStyle.slice(0, 400));

  mark('I8');
  const edI = mount(htmlStyle);
  const htmlI = edI.getHTML();
  check('I8 编辑器认回下划线/删除线/高亮', htmlI.includes('<u>') && htmlI.includes('<s>') && htmlI.includes('<mark'), htmlI.slice(0, 400));
  check('I9 编辑器认回颜色/字号', (htmlI.includes('#e03e3e') || htmlI.includes('224, 62, 62')) && htmlI.includes('20px'), htmlI.slice(0, 400));
  check('I10 标题/段落对齐被 TextAlign 认回', htmlI.includes('text-align: center') && (htmlI.match(/text-align: center/g) || []).length >= 2, htmlI.slice(0, 400));

  mark('I11');
  const mdStyle2 = htmlToMd(htmlI);
  check('I11 再转一次源码仍齐全（不越切越丢）', mdStyle2.includes('~~删除~~') && mdStyle2.includes('<u>') && mdStyle2.includes('data-block-align="center"') && (mdStyle2.includes('#e03e3e') || mdStyle2.includes('224, 62, 62')), mdStyle2);

  /* ---------- J. 表格往返专项（用户反馈：切源码再回来表格还是不对） ---------- */
  const rt = (name: string, html: string, checks: [string, (md: string, back: string) => boolean][]) => {
    const md = htmlToMd(html);
    const back = mdToHtml(md);
    out.push(`J ${name} md = ${md.replace(/\n/g, '⏎').slice(0, 300)}`);
    out.push(`J ${name} back = ${back.replace(/\n/g, ' ').slice(0, 300)}`);
    for (const [msg, fn] of checks) check(`J ${name}: ${msg}`, fn(md, back), '');
    return { md, back };
  };
  // 带表头 + 单行文本格：管道表
  rt('tipTap', `<table><colgroup><col style="min-width: 48px;"><col style="min-width: 48px;"></colgroup><tbody><tr><th><p>名称</p></th><th><p>数量</p></th></tr>`
    + `<tr><td><p>苹果</p></td><td><p>5</p></td></tr></tbody></table>`, [
    ['简单表走管道', (md) => md.startsWith('| 名称 | 数量 |') && md.includes('| 苹果 | 5 |')],
    ['回来仍是表头+数据行', (_md, back) => (back.match(/<th>/g) || []).length === 2 && (back.match(/<td>/g) || []).length === 2],
  ]);
  // 无表头（整表 td）：之前会被 GFM 顶成表头行，现在保留 HTML
  const jHl = rt('headerless', `<table><tbody><tr><td><p>苹果</p></td><td><p>5</p></td></tr><tr><td><p>香蕉</p></td><td><p>3</p></td></tr></tbody></table>`, [
    ['源码保留 HTML 表', (md) => md.includes('<table') && md.includes('<td>')],
    ['回来不加表头', (_md, back) => (back.match(/<th/g) || []).length === 0 && (back.match(/<td/g) || []).length === 4],
  ]);
  mark('J-mount-headerless');
  const edJh = mount(jHl.back);
  check('J 编辑器里无表头表原样还原', edJh.view.dom.querySelectorAll('td').length === 4 && edJh.view.dom.querySelectorAll('th').length === 0,
    `td=${edJh.view.dom.querySelectorAll('td').length} th=${edJh.view.dom.querySelectorAll('th').length}`);
  // 拖过列宽（col 有 width 样式）：保留 HTML 并换成 TipTap 认的 width 属性
  rt('colwidth', `<table><colgroup><col style="width: 120.4px;"><col style="min-width: 48px;"></colgroup><thead><tr><th><p>甲</p></th><th><p>乙</p></th></tr></thead>`
    + `<tbody><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>`, [
    ['拖过列宽保留 HTML', (md) => md.includes('<table')],
    ['列宽换算成 width 属性', (_md, back) => back.includes('width="120"')],
  ]);
  // 单元格多段落：管道压行会毁结构，保留 HTML
  rt('multiPara', `<table><thead><tr><th><p>甲</p></th><th><p>乙</p></th></tr></thead><tbody><tr><td><p>第一段</p><p>第二段</p></td><td><p>普通</p></td></tr></tbody></table>`, [
    ['富内容格保留 HTML', (md) => md.includes('<table') && md.includes('第二段')],
    ['回来两段都在且列数对', (_md, back) => back.includes('第一段') && back.includes('第二段') && (back.match(/<td/g) || []).length === 2],
  ]);
  // 单元格内列表 / 加粗 / 链接
  rt('richCell', `<table><thead><tr><th><p>甲</p></th><th><p>乙</p></th></tr></thead><tbody><tr><td><p><strong>加粗</strong>和<a href="https://a.b">链接</a></p><ul><li><p>列表项</p></li></ul></td><td><p>x</p></td></tr></tbody></table>`, [
    ['格内列表保留', (md) => md.includes('<li>')],
    ['回来列表与列数都在', (_md, back) => back.includes('列表项') && (back.match(/<td/g) || []).length === 2],
  ]);
  // 格内对齐 + 颜色
  rt('styledCell', `<table><thead><tr><th><p>甲</p></th><th><p>乙</p></th></tr></thead><tbody><tr><td><p style="text-align: center"><span style="color: #e03e3e">红</span></p></td><td><p>右列</p></td></tr></tbody></table>`, [
    ['格内对齐保留 HTML', (md) => md.includes('<table')],
    ['回来颜色与对齐都在', (_md, back) => (back.includes('e03e3e') || back.includes('224, 62, 62')) && back.includes('text-align: center')],
  ]);
  // 带表头的简单表再切一次源码仍是管道（不退化成 HTML）
  const jPipe = rt('pipeStable', `<table><thead><tr><th><p>甲</p></th><th><p>乙</p></th></tr></thead><tbody><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>`, [
    ['首转是管道', (md) => md.startsWith('| 甲 | 乙 |')],
  ]);
  // 带表头的简单表：两次往返后仍是同一条管道表（不漂移、不退化成 HTML）
  const mdP1 = htmlToMd(jPipe.back);
  const mdP2 = htmlToMd(mdToHtml(mdP1));
  check('J pipeStable: 二次往返仍是管道且不漂移', mdP1 === mdP2 && mdP1.startsWith('| 甲 | 乙 |'),
    `p1=${mdP1.replace(/\n/g, '⏎')} p2=${mdP2.replace(/\n/g, '⏎')}`);

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
