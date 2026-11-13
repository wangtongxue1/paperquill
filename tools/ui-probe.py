#!/usr/bin/env python3
"""编辑器功能的浏览器端探针。

把画好的断言 JS 注入到单文件版 HTML 末尾，用 Edge headless 跑一遍，
再把 <pre id="probe"> 里的结果打回终端。这样验的是「真的点得动」，
而不是只看类型检查过没过。

用法：python tools/ui-probe.py
前置：pnpm build && python tools/make_singlefile.py .temp/zhijian-probe.html
"""

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-ui-probe.html'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

PROBE = r"""
<script>
(async () => {
  const log = [];
  const push = (k, v) => log.push(`${k}=${v}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60); }
    return null;
  };
  const byText = (sel, text) =>
    Array.from(document.querySelectorAll(sel)).find((e) => (e.textContent || '').includes(text));
  const rows = () => Array.from(document.querySelectorAll('.note-row, .note-card'));
  const open = async (title) => {
    const r = rows().find((x) => (x.textContent || '').includes(title)) || rows()[0];
    r?.click();
    await wait(600);
  };
  const toRich = async () => {
    const pill = document.querySelector('.mode-pill');
    if (pill && pill.textContent.includes('源码')) { pill.click(); await wait(900); }
  };
  const toMd = async () => {
    const pill = document.querySelector('.mode-pill');
    if (pill && pill.textContent.includes('富文本')) { pill.click(); await wait(900); }
  };

  try {
    await until(() => document.querySelector('.nav-row'));
    byText('.nav-row', '全部笔记')?.click();
    await until(() => document.querySelector('.note-row, .note-card'));

    // ---------- 打开带待办的那篇，进富文本视图 ----------
    await open('双模式');
    push('editor', !!document.querySelector('.editor__title'));
    await toRich();
    push('mode', document.querySelector('.mode-pill')?.textContent || 'none');
    push('rich', !!document.querySelector('.ProseMirror'));
    push('toolbarSelects', document.querySelectorAll('.toolbar select').length);
    push('blockSelect', !!document.querySelector('.toolbar__select--block'));
    push('tableMenuBtn', !!document.querySelector('.toolbar__caret'));

    // ---------- 标题级别：1–6 级都能落地（旧版只到 3 级） ----------
    const blockSel = document.querySelector('.toolbar__select--block');
    push('blockOptions', blockSel ? blockSel.options.length : 0);
    if (blockSel) {
      blockSel.value = 'h4';
      blockSel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(280);
      push('h4Applied', !!document.querySelector('.ProseMirror h4'));
      blockSel.value = 'p';
      blockSel.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(220);
    } else push('h4Applied', 'no-select');

    const rich = document.querySelector('.ProseMirror');
    const items = () => Array.from(rich.querySelectorAll('li[data-checked]'));
    push('taskCount', items().length);

    // ---------- 点复选框：勾上 / 删除线 / 落盘 / 切回来还在 ----------
    const firstBox = () => items()[0]?.querySelector('input[type=checkbox]');
    const was = items()[0]?.getAttribute('data-checked');
    // 统一先切成「已勾选」，这样删除线、持久化都有确定的期望值
    if (was !== 'true') { firstBox()?.click(); await wait(300); }
    push('taskToggled', items()[0]?.getAttribute('data-checked') === 'true');
    push('taskStrike', getComputedStyle(items()[0].querySelector('div')).textDecorationLine === 'line-through');
    push('taskCheckboxVisible', (() => {
      const r = firstBox()?.getBoundingClientRect();
      return !!r && r.width >= 12 && r.height >= 12;
    })());

    await wait(900);            // 等自动保存
    await open('读书笔记');
    await open('双模式');
    await toRich();
    const afterLi = Array.from(document.querySelector('.ProseMirror').querySelectorAll('li[data-checked]'))[0];
    push('taskPersist', afterLi?.getAttribute('data-checked') === 'true');
    // 复原成种子数据原来的状态
    if (was !== 'true' && afterLi?.getAttribute('data-checked') === 'true') {
      afterLi.querySelector('input[type=checkbox]')?.click();
      await wait(800);
    }

    // ---------- 表格菜单 ----------
    document.querySelector('.toolbar__caret')?.click();
    await wait(180);
    push('tableMenuItems', document.querySelectorAll('.menu .menu__item').length);
    document.querySelector('.menu-dismiss')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(100);

    // ---------- 六色高亮取色板 ----------
    document.querySelector('.hilite-wrap .icon-btn')?.click();
    await wait(150);
    push('hiliteSwatches', document.querySelectorAll('.hilite-pop button').length);
    const sw = document.querySelector('.hilite-pop button');
    if (sw) {
      const r = sw.getBoundingClientRect();
      push('hiliteClickable', document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === sw);
    }
    document.querySelector('.menu-dismiss')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(100);

    // ---------- 图片：点附件名插进正文 → 点图片出工具条 → 调宽度 ----------
    await open('读书笔记');
    await toRich();
    // 走真实的上传路径插一张 1×1 PNG（相当于用户在文件对话框里选了张图）
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'probe.png', { type: 'image/png' }));
    // 页面里不止一个 file input（侧栏导入、附件区各有一个），挑接受图片的那个；
    // 插入是异步的（读文件 → 转 dataURL → 交给内核），所以等它出现，别死等固定毫秒。
    const picker = document.querySelector('input[data-role="file"]')
      || document.querySelector('input[type=file]');
    picker.files = dt.files;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    const img0 = await until(() => document.querySelector('.ProseMirror img'), 6000);
    push('imageInserted', !!img0);
    img0?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(250);
    push('imgtools', !!document.querySelector('.imgtools'));
    push('imgtoolsBtns', document.querySelectorAll('.imgtools button').length);
    document.querySelectorAll('.imgtools button')[2]?.click();   // 75%
    await wait(250);
    push('imgWidth', document.querySelector('.ProseMirror img')?.style.width || 'none');

    // ---------- 视图切换：顶部不再有，只在底栏右下角 ----------
    push('noTopModeSwitch', document.querySelectorAll('.mode-switch').length === 0);
    push('modePillRight', (() => {
      const pill = document.querySelector('.mode-pill');
      const foot = document.querySelector('.editor__foot');
      if (!pill || !foot) return 'none';
      const a = pill.getBoundingClientRect(); const b = foot.getBoundingClientRect();
      return b.right - a.right < 30 && a.left > b.left + b.width * 0.55;
    })());

    // ---------- 导入到当前笔记：追加 ----------
    const importInput = document.querySelector('input[data-role="import"]')
      || Array.from(document.querySelectorAll('input[type=file]'))
        .find((i) => (i.accept || '').includes('.enex'));
    if (importInput) {
      const mdFile = new File(['# 导入测试\n\n- [ ] 导入的待办'], 'probe.md', { type: 'text/markdown' });
      const dt2 = new DataTransfer();
      dt2.items.add(mdFile);
      importInput.files = dt2.files;
      importInput.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(1600);
      push('importModes', document.querySelectorAll('.import-mode').length);
      document.querySelectorAll('.import-mode')[1]?.click();   // 追加到末尾
      await wait(900);
      push('importAppended', (document.querySelector('.ProseMirror')?.textContent || '').includes('导入测试'));
    } else {
      push('importModes', 'no-import-input');
    }

    // ---------- 音视频上传 ----------
    const mediaInput = document.querySelector('input[data-role="media"]')
      || Array.from(document.querySelectorAll('input[type=file]'))
        .find((i) => (i.accept || '').includes('audio/'));
    if (mediaInput) {
      // 44 字节的合法 WAV 头 + 一小段静音
      const wav = new Uint8Array(48);
      const head = 'RIFF';
      for (let i = 0; i < 4; i++) wav[i] = head.charCodeAt(i);
      wav[8] = 87; wav[9] = 65; wav[10] = 86; wav[11] = 69; // WAVE
      const dt3 = new DataTransfer();
      dt3.items.add(new File([wav], 'probe.wav', { type: 'audio/wav' }));
      mediaInput.files = dt3.files;
      mediaInput.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(1400);
      push('audioInserted', !!document.querySelector('.ProseMirror audio'));
    } else {
      push('audioInserted', 'no-media-input');
    }

    // ---------- 画板：画一个矩形 → 保存 → 正文里出现画板快照 ----------
    Array.from(document.querySelectorAll('.toolbar .icon-btn'))
      .find((b) => (b.title || '').includes('画板'))?.click();
    await wait(700);
    push('boardOpen', !!document.querySelector('.board'));
    if (document.querySelector('.board')) {
      const toolBtn = (prefix) => Array.from(document.querySelectorAll('.board__tools button'))
        .find((b) => (b.title || '').startsWith(prefix));
      const svg = document.querySelector('.board__svg');
      const rect = svg.getBoundingClientRect();
      const pe = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, {
        bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1,
      }));
      // 按下必须打在真实元素上，否则 e.target 是 svg，命不中形状（真实点击本来就这样）
      const peOn = (cx, cy, type = 'pointerdown') => {
        const el = document.elementFromPoint(rect.left + cx, rect.top + cy) || svg;
        el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, clientX: rect.left + cx, clientY: rect.top + cy,
          pointerId: 1, button: 0, buttons: 1,
        }));
      };
      const drawBox = async (x1, y1, x2, y2) => {
        toolBtn('矩形')?.click();
        await wait(200);
        pe('pointerdown', rect.left + x1, rect.top + y1);
        pe('pointermove', rect.left + x2, rect.top + y2);
        pe('pointerup', rect.left + x2, rect.top + y2);
        await wait(250);
      };
      await drawBox(200, 160, 340, 240);
      await drawBox(460, 320, 600, 400);
      push('boardShapes', document.querySelectorAll('.board__svg g[data-el]').length);
      push('boardInspector', !!document.querySelector('.board__insp'));
      push('boardSwatches', document.querySelectorAll('.bi-swatch').length);
      // 单选时八个方向的缩放手柄都要在（旧版只有右下角一个）
      push('boardHandles', document.querySelectorAll('[data-handle]').length);

      // 框选：先切回选择工具（画完形状后工具会保持矩形，不再自动弹回指针），再拖选框。
      // 注意：选中状态下空白处拖动会变成「接龙画形状」，所以这里先点一下空白取消选择，才能框选。
      toolBtn('选择')?.click();
      await wait(150);
      pe('pointerdown', rect.left + 80, rect.top + 80);
      pe('pointerup', rect.left + 80, rect.top + 80);
      await wait(150);
      pe('pointerdown', rect.left + 80, rect.top + 80);
      pe('pointermove', rect.left + 700, rect.top + 520);
      pe('pointerup', rect.left + 700, rect.top + 520);
      await wait(220);
      push('boardMarquee', document.querySelector('.board__palettetip')?.textContent || '');

      // 连线：从第一个形状拖到第二个
      toolBtn('连线')?.click();
      await wait(200);
      peOn(260, 200);
      await wait(60);
      pe('pointerup', rect.left + 520, rect.top + 360);
      await wait(300);
      push('boardArrow', document.querySelectorAll('.board__svg path[marker-end]').length);

      // 拖动一次 → Ctrl+Z 必须回到原位（旧版把「拖完后的状态」压进历史，撤销是空操作）
      toolBtn('选择')?.click();
      await wait(150);
      const shapeGs = () => Array.from(document.querySelectorAll('.board__svg g[data-el]'))
        .filter((g) => g.querySelector('rect'));
      const xOf = () => Number(shapeGs()[0]?.querySelector('rect')?.getAttribute('x') || -1);
      const x0 = xOf();
      peOn(260, 200);
      pe('pointermove', rect.left + 320, rect.top + 200);
      pe('pointerup', rect.left + 320, rect.top + 200);
      await wait(260);
      const x1 = xOf();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
      await wait(280);
      const x2 = xOf();
      push('boardDragUndo', x0 >= 0 && x1 !== x0 && x2 === x0);

      document.querySelector('.board__acts .btn--primary')?.click();
      await wait(2200);
      push('boardSaved', !document.querySelector('.board')
        && !!document.querySelector('.ProseMirror img[data-board-id]'));

      // ---------- 统一导出面板：编辑器菜单 / 列表右键 / 导入导出页共用同一套格式 ----------
      document.querySelector('.editor__headacts .icon-btn:last-child')?.click();
      await wait(250);
      Array.from(document.querySelectorAll('.menu__item'))
        .find((b) => (b.textContent || '').trim() === '导出…')?.click();
      await wait(350);
      push('exportDialog', !!document.querySelector('.export-cards'));
      push('exportFormats', document.querySelectorAll('.export-card').length);
      push('exportPdfUsable', !!document.querySelector('.export-cards') && !document.querySelector('.export-card.is-off'));
      const pdfCard = Array.from(document.querySelectorAll('.export-card'))
        .find((b) => (b.textContent || '').includes('PDF'));
      pdfCard?.click();
      await wait(200);
      push('exportPick', (document.querySelector('.export-card.is-on')?.textContent || '').includes('PDF'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(300);
      push('exportClosed', !document.querySelector('.export-cards'));
    }

    // ---------- 附件回收：正文里删掉的图，附件区也不留 ----------
    // 前面几步换过笔记，这里回到插过图的那一篇，别依赖「当前正好是哪篇」。
    await open('读书笔记');
    await toRich();
    await wait(400);
    const countAtt = () => document.querySelectorAll('.attachment').length;
    const beforeAtt = countAtt();
    push('recycleImgs', document.querySelectorAll('.ProseMirror img').length);
    push('recycleTagged', document.querySelectorAll('.ProseMirror img[data-att-id]').length);
    const victim = document.querySelector('.ProseMirror img[data-att-id]:not([data-board-id])');
    if (victim) {
      victim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(200);
      document.querySelector('.ProseMirror')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await wait(2600);   // 宽限期 1.6s + 一次保存周期
      push('attachRecycled', countAtt() < beforeAtt);
    } else {
      push('attachRecycled', 'no-image-to-delete');
    }

    // ---------- 附件预览弹窗 ----------
    const att = document.querySelector('.attachment img, .attachment__file');
    if (att) {
      att.click();
      await wait(350);
      push('previewDialog', !!document.querySelector('.preview-img, .preview-text, .preview-frame'));
      document.querySelector('.modal__foot .btn--primary')?.click();
    } else {
      push('previewDialog', 'no-attachment');
    }

    // ---------- 源码视图：内容还在，预览里点复选框能回写 Markdown ----------
    await open('双模式');
    await toMd();
    const md = document.querySelector('.md-editor__input');
    push('mdMode', !!md);
    push('mdLen', md ? md.value.length : 0);
    push('mdHighlight', !!document.querySelector('.md-editor__hl i'));
    const pv = document.querySelector('.editor__preview');
    const tbox = pv?.querySelector('input[type=checkbox][data-task-line]');
    if (tbox && md) {
      const before = md.value;
      tbox.click();
      await wait(450);
      push('mdTaskRewrite', md.value !== before);
    } else {
      push('mdTaskRewrite', 'no-task-in-preview');
    }

    // ---------- 源码视图的待办标记：高亮层必须「隐形」 ----------
    // 高亮层和输入层是叠着的两层，只要多一个或少一个字符，字就会和光标错位。
    // 曾经就因为把 ] 后面的空格吃进标记里，待办的标记和正文粘在一起。
    const hlText = () => (document.querySelector('.md-editor__hl')?.textContent || '');
    const mdSamples = [
      '- [ ] 未勾选\n- [x] 已勾选\n  - [x] 缩进子项\n- [ ]\n1. [x] 有序\n- 普通条目\n',
      '- [ ] **加粗** 与 `代码` 混排\n- [x] [[内链]] 与 https://a.example/x\n',
    ];
    let hlOk = 0;
    for (const sample of mdSamples) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(md, sample);
      md.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(260);
      if (hlText() === sample + '\n') hlOk += 1;
    }
    push('mdHlCharsMatch', hlOk + '/' + mdSamples.length);
    push('mdTaskSpans', document.querySelectorAll('.md-editor__hl .md-task').length);
    push('mdTaskDoneText', (document.querySelector('.md-editor__hl .md-task.is-done')?.textContent || 'none'));
    push('mdTaskMarkQuiet', !!document.querySelector('.md-editor__hl .md-mark--quiet'));
    push('mdTaskDoneFaded', (() => {
      const el = document.querySelector('.md-editor__hl .md-tasktext.is-done');
      return el ? getComputedStyle(el).color : 'none';
    })());
    push('mdTaskColor', (() => {
      const el = document.querySelector('.md-editor__hl .md-task');
      return el ? getComputedStyle(el).color : 'none';
    })());

    // ---------- 时间戳：弹层跟着光标（不是钉在右上角）→ 能改值 ----------
    await open('双模式');
    await toRich();
    const pmEl = document.querySelector('.ProseMirror');
    // 合成 mousedown 不会移动浏览器的原生光标，所以直接改原生 selection，
    // ProseMirror 会通过 selectionchange 同步成自己的 selection —— 这就是「光标在第三段开头」。
    const targetP = (pmEl?.querySelectorAll('p') || [])[2] || pmEl?.querySelector('p');
    const targetText = (targetP?.textContent || '').slice(0, 10);
    if (pmEl && targetP) {
      pmEl.focus();
      const r = targetP.getBoundingClientRect();
      const cr = document.caretRangeFromPoint(r.left + 3, r.top + r.height / 2);
      const sel = window.getSelection();
      if (cr && sel) { sel.removeAllRanges(); sel.addRange(cr); }
      await wait(260);
    }
    const caret = (() => {
      const s = window.getSelection();
      if (!s || !s.rangeCount) return null;
      const range = s.getRangeAt(0);
      const b = range.getClientRects()[0] || range.getBoundingClientRect();
      return b && (b.height || b.width) ? { left: b.left, top: b.top } : null;
    })();
    const dtpBtn = Array.from(document.querySelectorAll('.toolbar .icon-btn'))
      .find((b) => (b.title || '').includes('插入日期时间'));
    const btnRect = dtpBtn?.getBoundingClientRect();
    dtpBtn?.click();
    await wait(300);
    push('timePopInsert', !!document.querySelector('.dtp'));
    const dtp = document.querySelector('.dtp');
    if (dtp) {
      push('dtpWeekHeads', document.querySelectorAll('.dtp__week span').length);
      // 日格按「这个月有几天」渲染（空位是占位格），行数 4~6 都合法
      push('dtpDayCells', document.querySelectorAll('.dtp__grid .dtp__day:not(.is-blank)').length);
      push('dtpGridRows', document.querySelectorAll('.dtp__grid .dtp__day').length / 7);
      push('dtpTimeInputs', document.querySelectorAll('.dtp__num').length);
      // 2.5.4：首次插入的弹层锚定到工具栏按钮下方，不再跟着光标飘到正文中央。
      if (btnRect) {
        const dr = dtp.getBoundingClientRect();
        push('dtpAnchorBelowBtn', Math.round(dr.top) >= Math.round(btnRect.bottom));
        push('dtpNearBtn', Math.abs(dr.top - (btnRect.bottom + 6)) < 40);
      }
      // 选本月 5 号 + 改成 03:04，确认后正文里的时间戳应带上这两个值。
      const day5 = Array.from(document.querySelectorAll('.dtp__grid .dtp__day'))
        .find((b) => b.textContent === '5');
      day5?.click();
      await wait(160);
      const nums = document.querySelectorAll('.dtp__num');
      const setVal = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      if (nums[0] && nums[1]) { setVal(nums[0], '03'); setVal(nums[1], '04'); await wait(160); }
    }
    document.querySelector('.dtp__ok')?.click();
    await wait(450);
    const timeEl = document.querySelector('.ProseMirror time[data-time]');
    push('timeNode', !!timeEl);
    if (timeEl) {
      push('timeInserted', /-05 03:04$/.test(timeEl.textContent || ''));
      // 插进来的时间必须落在「我们点过的那一段」里，不能跑到文首去。
      const holder = timeEl.closest('p, h1, h2, h3, li');
      push('timeInTarget', !!holder && holder.textContent.includes(targetText));
      timeEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(350);
      push('timePopEdit', !!document.querySelector('.dtp'));
      const nums2 = document.querySelectorAll('.dtp__num');
      if (nums2[0] && nums2[1]) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(nums2[0], '07');
        nums2[0].dispatchEvent(new Event('input', { bubbles: true }));
        setter.call(nums2[1], '08');
        nums2[1].dispatchEvent(new Event('input', { bubbles: true }));
        await wait(160);
        document.querySelector('.dtp__ok')?.click();
        await wait(500);
        push('timeEdited', /-05 07:08$/.test(document.querySelector('.ProseMirror time[data-time]')?.textContent || ''));
      } else push('timeEdited', false);
    }

    // ---------- 侧栏「新建」下拉：三个入口都点得动 ----------
    document.querySelector('.create-more > .icon-btn')?.click();
    await wait(300);
    const cbtns = Array.from(document.querySelectorAll('.create-pop button'));
    push('newMenuItems', cbtns.length);
    if (cbtns.length) {
      const r = cbtns[0].getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      push('newMenuClickable', hit === cbtns[0] || cbtns[0].contains(hit));
      cbtns[0].click();
      await wait(600);
      push('templateDialog', !!document.querySelector('.modal'));
      // 模板卡片：图标必须是线性 icon（svg），不能再是 emoji；说明文字要像人话。
      const tplIcons = Array.from(document.querySelectorAll('.template-card .tpl-ico'));
      push('tplCards', document.querySelectorAll('.template-card').length);
      push('tplIconSvg', tplIcons.filter((el) => el.querySelector('svg')).length);
      push('tplIconEmoji', tplIcons.filter((el) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(el.textContent)).length);
      push('tplDescLen', (document.querySelector('.template-card p')?.textContent || '').trim().length);
      const closeBtn = document.querySelector('.modal__close, .modal__head button');
      if (closeBtn) closeBtn.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(400);
    }

    // ---------- 搜索框：变宽且更靠中 ----------
    const search = document.querySelector('.titlebar__search');
    const tb = document.querySelector('.titlebar');
    if (search && tb) {
      const sb = search.getBoundingClientRect(); const tbr = tb.getBoundingClientRect();
      push('searchWidth', Math.round(sb.width));
      push('searchOffset', Math.round((sb.left + sb.right) / 2 - (tbr.left + tbr.right) / 2));
    } else push('searchWidth', 'none');

    // ---------- 深色模式：正文不再接近纯白 ----------
    const rootEl = document.documentElement;
    const prevTheme = rootEl.getAttribute('data-theme');
    rootEl.setAttribute('data-theme', 'dark');
    const relLum = (hex) => {
      const n = parseInt(hex.replace('#', ''), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const darkText = getComputedStyle(rootEl).getPropertyValue('--text').trim();
    push('darkText', darkText);
    push('darkTextLum', relLum(darkText).toFixed(3));
    if (prevTheme) rootEl.setAttribute('data-theme', prevTheme); else rootEl.removeAttribute('data-theme');

    // PDF 导出要真跑 html2canvas，耗时不受虚拟时间控制，单独用 tools/pdf-ui-probe.py 验。

    // ---------- 列表多选 → 右键导出：范围、PDF 不可用、说明文案 ----------
    byText('.nav-row', '全部笔记')?.click();
    await wait(500);
    const rows = Array.from(document.querySelectorAll('.note-row'));
    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await wait(120);
    rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await wait(280);
    rows[1]?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 260, clientY: 320,
    }));
    await wait(300);
    Array.from(document.querySelectorAll('.menu__item'))
      .find((b) => (b.textContent || '').includes('导出'))?.click();
    await wait(400);
    push('exportManyRange', document.querySelector('.export-range strong')?.textContent || 'none');
    push('exportManyPdfOff', document.querySelectorAll('.export-card.is-off').length);
    push('exportManyHint',
      (document.querySelector('.export-hint')?.textContent || '').includes('zip') ? 'zip' : 'no-zip');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(200);

    push('done', 1);
  } catch (e) {
    push('error', String((e && e.message) || e));
  }

  const pre = document.createElement('pre');
  pre.id = 'probe';
  pre.textContent = log.join(' · ');
  document.body.appendChild(pre);
})();
</script>
"""


def main() -> int:
    if not SRC.exists():
        print(f'缺少 {SRC}，先运行 make_singlefile.py', file=sys.stderr)
        return 1
    html = SRC.read_text(encoding='utf-8')
    i = html.rfind('</body>')
    if i < 0:
        print('找不到 </body>', file=sys.stderr)
        return 1
    html = html[:i] + PROBE + html[i:]
    OUT.write_text(html, encoding='utf-8')

    # 每次跑都用全新的浏览器配置：localStorage 里存着工作区，
    # 复用同一个目录会让上一次探针改过的内容带到下一次（taskCount 会莫名其妙变）。
    profile = pathlib.Path(tempfile.mkdtemp(prefix='zhijian-edge-'))
    args = [
        EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1360,900',
        '--allow-file-access-from-files', f'--user-data-dir={profile}',
        '--virtual-time-budget=60000', '--dump-dom', OUT.as_uri(),
    ]
    # Edge 在 headless + blob 下载后不一定自己退出；DOM 已经 dump 完了就杀掉，
    # 不然脚本会一直挂着等它。
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', errors='replace')
    try:
        dom, errout = proc.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        proc.kill()
        dom, errout = proc.communicate()
    dom = dom or ''
    m = re.search(r'<pre id="probe">(.*?)</pre>', dom, re.S)
    if not m:
        print('探针没有输出，DOM 前 600 字符：\n' + dom[:600], file=sys.stderr)
        return 2
    text = m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    print(text)
    # 只查「不是 false」还不够：有些观测点是数字或颜色，错了也看不出来。
    kv = dict(kv.split('=', 1) for kv in text.split(' · ') if '=' in kv)
    fails: list[str] = []
    EXPECT = {
        'taskCount': '3',
        'tableMenuItems': '10',
        'importModes': '3',
        'boardShapes': '2',
        'boardArrow': '1',
        # 画板：属性面板在、9 个填充色 + 8 个描边色、八向手柄、框选能选中两个
        'boardInspector': 'true',
        'boardSwatches': '17',
        'boardHandles': '8',
        'boardMarquee': '已选 2 个',
        # 拖完一次再撤销必须回到原位（旧版这一步是空操作）
        'boardDragUndo': 'true',
        # 标题 1–6 级 + 正文 / 引用 / 代码块 = 9 个选项
        'blockOptions': '9',
        'h4Applied': 'true',
        # 统一导出面板：5 种格式，单篇时 PDF 可选
        'exportDialog': 'true',
        'exportFormats': '5',
        'exportPdfUsable': 'true',
        'exportPick': 'true',
        'exportClosed': 'true',
        # 多选导出：范围数字、PDF 变灰、说明里提到 zip
        'exportManyRange': '2 篇笔记',
        'exportManyPdfOff': '1',
        'exportManyHint': 'zip',
        'newMenuItems': '3',
        'mdHlCharsMatch': '2/2',
        'mdTaskSpans': '2',
        'mdTaskDoneText': '[x]',
        'mdTaskMarkQuiet': 'true',
        # 待办标记是品牌色（#2F8F68），不能又变回那串橙色 #B87333
        'mdTaskColor': 'rgb(47, 143, 104)',
        # 勾选后的正文要淡到 --text-3
        'mdTaskDoneFaded': 'rgb(140, 150, 141)',
        # 时间弹层：7 个星期表头、时/分两个输入，插进去的值要落盘
        'dtpWeekHeads': '7',
        'dtpTimeInputs': '2',
        'timeInserted': 'true',
        # 2.5.4：首次插入的弹层贴在日期时间按钮下方（不再跟光标）
        'dtpAnchorBelowBtn': 'true',
        'dtpNearBtn': 'true',
        # 模板卡片：6 套都有线性图标，且不再有 emoji
        'tplCards': '6',
        'tplIconSvg': '6',
        'tplIconEmoji': '0',
    }
    fails += [f'{k}={kv.get(k)}（期望 {v}）' for k, v in EXPECT.items() if kv.get(k) != v]
    # 通用兜底：没在 EXPECT 里点名期望值的观测点，出现 0 / false / error 也算问题。
    for piece in text.split(' · '):
        k = piece.split('=', 1)[0]
        if k in EXPECT:
            continue
        if k == 'error' or piece.endswith('=0') or piece.endswith('=false') or '=false' in piece:
            fails.append(piece)
    if int(kv.get('tplDescLen') or 0) < 8:
        fails.append(f"tplDescLen={kv.get('tplDescLen')}（模板说明太短，可能又回了正文摘要）")
    # 日历行数随月份变化（4~6 行），日格数就是这个月的天数
    rows = int(kv.get('dtpGridRows') or 0)
    cells = int(kv.get('dtpDayCells') or 0)
    if not (4 <= rows <= 6 and rows * 7 >= cells >= 28):
        fails.append(f'dtpGridRows={rows} / dtpDayCells={cells}（日历网格不对）')
    yes = [k for k in ('timePopInsert', 'timePopEdit', 'timeEdited', 'timeInTarget', 'newMenuClickable',
                      'attachRecycled', 'imageInserted') if kv.get(k) != 'true']
    fails += [f'{k}=不成立' for k in yes]
    if fails:
        print('\n有问题的项：' + ', '.join(fails), file=sys.stderr)
        return 3
    shutil.rmtree(profile, ignore_errors=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
