#!/usr/bin/env node
/** 存档迁移回归断言。
 *  用已安装的 Vite 把 src/storage.ts 打成 ESM，再在 Node 里跑断言，
 *  不需要额外测试框架或新依赖。CI 与本地都跑同一份。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const outDir = path.resolve('.temp/migrate-test');
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: path.resolve('src/storage.ts'),
      formats: ['es'],
      fileName: 'storage',
    },
    rollupOptions: { output: { entryFileNames: 'storage.mjs' } },
  },
});

const mod = await import(pathToFileURL(path.join(outDir, 'storage.mjs')).href);
const { migrate } = mod;
assert.equal(typeof migrate, 'function', 'migrate 应被导出');

// 1. 空档补齐默认值
const a = migrate({ notes: [] });
assert.equal(a.version, 5, 'version 应升级到当前版本');
assert.ok(Array.isArray(a.templates) && a.templates.length > 0, 'templates 应补内置模板');
assert.equal(a.templates.length, 6, '内置模板应补齐 6 套');
assert.ok(a.templates.every((t) => t.desc && t.desc.length > 4), '内置模板都应有一句说明');
assert.ok(a.templates.every((t) => !/[\u{1F300}-\u{1FAFF}]/u.test(t.icon)), '内置模板图标不再是 emoji');
assert.equal(a.settings.theme, 'light', 'settings 应有默认值');
assert.deepEqual(a.notebooks, []);
// v1 -> v2 新增字段：老档必须补齐，且不能丢任何已有内容。
assert.deepEqual(a.shortcuts, []);
assert.deepEqual(a.savedSearches, []);
assert.deepEqual(a.recentSearches, []);
assert.deepEqual(a.noteHistory, {});
assert.equal(a.sticky, '');
assert.equal(a.sidebarSections.home, true);
assert.equal(a.sidebarSections.trash, true);
assert.equal(a.settings.showThumbnails, true);

// 2. 未知字段原样保留（未来版本 / 第三方扩展写的字段不能丢）
const b = migrate({ notes: [], futureField: { x: 1 }, extra: 'keep' });
assert.deepEqual(b.futureField, { x: 1 });
assert.equal(b.extra, 'keep');

// 3. 老笔记缺字段补齐，且不改写已有值
const c = migrate({
  notes: [{ id: 'n1', title: '旧笔记', content: '# 标题', mode: 'markdown' }],
});
assert.equal(c.notes[0].tags.length, 0);
assert.equal(c.notes[0].reminderDone, false);
assert.deepEqual(c.notes[0].attachments, []);
assert.equal(c.notes[0].sourceUrl, '');
assert.equal(c.notes[0].title, '旧笔记');
assert.equal(c.notes[0].content, '# 标题');

// 4. 已有值与局部 settings 不被默认值覆盖
const d = migrate({
  notes: [{ id: 'n2', title: '保留', content: '<p>x</p>', mode: 'rich', tags: ['A'], favorite: true }],
  settings: { theme: 'dark' },
});
assert.equal(d.notes[0].favorite, true);
assert.deepEqual(d.notes[0].tags, ['A']);
assert.equal(d.notes[0].mode, 'rich');
assert.equal(d.settings.theme, 'dark');
assert.equal(d.settings.sort, 'updated', '未提供的 settings 字段仍补默认值');

// 4b. 带 v2 字段的档：已有值不被默认值覆盖，且自定义侧栏配置保留。
const e = migrate({
  version: 2,
  notes: [],
  shortcuts: [{ id: 's1', kind: 'note', refId: 'n9', label: '常用', createdAt: 1 }],
  savedSearches: [{ id: 'ss1', name: '有附件', query: 'has:attachment', createdAt: 1 }],
  noteHistory: { n9: [{ id: 'v1', at: 1, title: '旧', content: 'x', mode: 'markdown' }] },
  sidebarSections: { home: false },
  sticky: '别忘了买牛奶',
});
assert.equal(e.shortcuts.length, 1);
assert.equal(e.savedSearches[0].query, 'has:attachment');
assert.equal(e.noteHistory.n9.length, 1);
assert.equal(e.sidebarSections.home, false, '用户关掉的区块不能被默认值重新打开');
assert.equal(e.sidebarSections.tags, true, '未提供的区块仍补默认');
assert.equal(e.sticky, '别忘了买牛奶');

// 5. 损坏输入必须抛错（调用方据此停止写盘）
assert.throws(() => migrate(null), /存档格式无法识别/);
assert.throws(() => migrate([]), /存档格式无法识别/);
assert.throws(() => migrate('bad'), /存档格式无法识别/);

// 6. v2 -> v3：内置模板换成新文案/图标，自定义模板一个字段都不动
const f = migrate({
  version: 2,
  notes: [],
  templates: [
    { id: 'tpl_meeting', name: '会议纪要', icon: '🗓️', content: '## 老版会议纪要\n\n- **时间**：\n', builtin: true, createdAt: 0 },
    { id: 'tpl_gone', name: '已经下线的内置模板', icon: '📄', content: 'x', builtin: true, createdAt: 0 },
    { id: 'tpl_mine', name: '我的复盘', icon: '📝', content: '## 复盘\n', builtin: false, createdAt: 7 },
  ],
});
const meeting = f.templates.find((t) => t.id === 'tpl_meeting');
assert.equal(meeting.icon, 'meeting', '内置模板图标换成语义键');
assert.ok(!meeting.content.includes('老版会议纪要'), '内置模板正文应换成新内容');
assert.ok(meeting.desc.length > 4, '内置模板补上新说明');
assert.equal(meeting.builtin, true);
assert.ok(f.templates.some((t) => t.id === 'tpl_gone'), '存档里已有的旧模板不能被静默删掉');
assert.equal(f.templates.filter((t) => t.id === 'tpl_mine').length, 1, '自定义模板不能重复');
const mine = f.templates.find((t) => t.id === 'tpl_mine');
assert.equal(mine.icon, '📝', '自定义模板的图标原样保留');
assert.equal(mine.content, '## 复盘\n', '自定义模板的正文原样保留');
assert.equal(f.notes.length, 0);
assert.equal(f.templates.filter((t) => t.id.startsWith('tpl_') && !['tpl_meeting', 'tpl_gone', 'tpl_mine'].includes(t.id)).length, 5,
  '缺的内置模板要补齐（6 套里已有 1 套，再补 5 套）');

// 7. v3 -> v4：笔记补 hidden=false，已有内容（含真的被隐藏的笔记）一个都不动
const g = migrate({
  version: 3,
  notes: [
    { id: 'n1', title: '日记', content: '正文', mode: 'markdown' },
    { id: 'n2', title: '已经隐藏的', content: 'x', mode: 'rich', hidden: true },
  ],
});
assert.equal(g.version, 5, 'v3 档要升到 v5');
assert.equal(g.notes[0].hidden, false, '老笔记补 hidden=false');
assert.equal(g.notes[1].hidden, true, '已经隐藏的笔记不能被迁移改回显示');
assert.equal(g.notes[0].content, '正文', '迁移不能动正文');
assert.equal(g.notes[1].mode, 'rich', '迁移不能动编辑器模式');

// 8. v4 -> v5：旧品牌（墨记）时代的内置种子刷新成新文案，用户自己的笔记不动
const h5 = migrate({
  version: 4,
  notes: [
    { id: 's1', title: '欢迎来到墨记', content: '<p>墨记是本地优先的个人笔记</p>', mode: 'rich', tags: ['开始使用'], notebookId: 'nb1' },
    { id: 's2', title: '双模式怎么切换', content: '从右上角切到 Markdown，墨记支持…', mode: 'markdown', tags: ['技巧'], notebookId: 'nb1' },
    { id: 'u1', title: '我的日记', content: '今天用了墨记，不错', mode: 'markdown', notebookId: 'nb2' },
    { id: 's3', title: '读书笔记 · 卡片笔记写作法', content: '## 书目\n- 书名：卡片笔记写作法', mode: 'markdown', notebookId: 'nb3' },
  ],
});
const s1 = h5.notes.find((n) => n.id === 's1');
const s2 = h5.notes.find((n) => n.id === 's2');
const u1 = h5.notes.find((n) => n.id === 'u1');
const s3 = h5.notes.find((n) => n.id === 's3');
assert.equal(s1.title, '欢迎来到纸间笔记', '旧欢迎页标题刷新');
assert.ok(s1.content.includes('纸间笔记') && !s1.content.includes('墨记'), '欢迎页正文换成新文案');
assert.equal(s1.notebookId, 'nb1', '刷新不动笔记本归属');
assert.equal(s1.tags.join(','), '开始使用', '刷新不动标签');
assert.ok(!s2.content.includes('墨记') && s2.content.includes('源码视图'), '双模式种子刷新成新文案');
assert.ok(!u1.content.includes('纸间笔记') && u1.content.includes('墨记'), '用户自己写的笔记即使提到墨记也不动');
assert.equal(s3.content.includes('书目'), true, '不含墨记的种子原样保留');

console.log('migrate: 10 组断言全部通过（含 v1→v2 字段补齐、v2→v3 内置模板刷新、v3→v4 隐藏字段、v4→v5 种子刷新）');
