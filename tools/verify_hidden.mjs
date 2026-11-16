#!/usr/bin/env node
/** 隐藏笔记的过滤规则断言。
 *
 *  隐藏是一条横切规则：全部笔记 / 收藏 / 置顶 / 提醒 / 标签 / 笔记本 / 保存的搜索 /
 *  首页统计都不该带出它，只有「隐藏笔记」这一个视图带。规则集中在 src/notes-filter.ts，
 *  这里直接用 vite 把它打成 ESM 在 Node 里验，跑法：node tools/verify_hidden.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const outDir = path.resolve('.temp/hidden-test');
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    lib: { entry: path.resolve('src/notes-filter.ts'), formats: ['es'], fileName: 'f' },
    rollupOptions: { output: { entryFileNames: 'notes-filter.mjs' } },
  },
});

const { isHidden, isLive, noteInNav } = await import(pathToFileURL(path.join(outDir, 'notes-filter.mjs')).href);

const note = (patch = {}) => ({
  id: 'n', title: 't', content: '', mode: 'markdown', notebookId: 'nb1', tags: ['日记'],
  createdAt: 0, updatedAt: 0, pinned: true, favorite: true, trashed: false, trashedAt: null,
  reminderAt: Date.now(), reminderDone: false, sourceUrl: '', attachments: [], ...patch,
});

const plain = note({ id: 'plain', tags: [] , notebookId: null });
const full = note({ id: 'full' });                     // 有标签、有笔记本、置顶收藏、有提醒
const tagged = note({ id: 'tagged' });
const hid = note({ id: 'hidden', hidden: true, tags: [], notebookId: null });
const hidFull = note({ id: 'hiddenFull', hidden: true });
const trashed = note({ id: 'trashed', trashed: true, trashedAt: 1 });
const hidTrashed = note({ id: 'hidtrash', hidden: true, trashed: true, trashedAt: 1 });

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n += 1; };

// 1. 基本判定
ok(isHidden(hid) && !isHidden(plain), '只有 hidden=true 才算隐藏（老档没有字段按未隐藏）');
ok(isLive(plain) && !isLive(hid) && !isLive(trashed), 'isLive = 不在回收站且未隐藏');

// 2. 常规视图一律不带隐藏笔记（每个视图配一个「本该出现在这里」的样本）
const sample = (nav) => nav.kind === 'untagged' ? plain
  : (nav.kind === 'tag' || nav.kind === 'notebook') ? tagged
  : full;
const hiddenSample = (nav) => nav.kind === 'tag' || nav.kind === 'notebook'
  ? { ...tagged, hidden: true } : hidFull;
for (const nav of [
  { kind: 'all' }, { kind: 'favorites' }, { kind: 'pinned' }, { kind: 'reminders' },
  { kind: 'untagged' }, { kind: 'notebook', id: 'nb1' }, { kind: 'tag', name: '日记' },
  { kind: 'savedSearch', id: 's1' }, { kind: 'home' }, { kind: 'tasks' }, { kind: 'files' }, { kind: 'calendar' },
]) {
  ok(noteInNav(sample(nav), nav), `${nav.kind} 应包含普通笔记`);
  ok(!noteInNav(hiddenSample(nav), nav), `${nav.kind} 不应包含隐藏笔记`);
}

// 3. 隐藏视图只带隐藏笔记
ok(noteInNav(hid, { kind: 'hidden' }), '隐藏视图包含隐藏笔记');
ok(!noteInNav(plain, { kind: 'hidden' }), '隐藏视图不包含普通笔记');

// 4. 回收站不看隐藏标记：回收站里的笔记照旧展示
ok(noteInNav(trashed, { kind: 'trash' }), '回收站包含已删除笔记');
ok(noteInNav(hidTrashed, { kind: 'trash' }), '回收站里已删除的隐藏笔记也照旧展示');
ok(!noteInNav(trashed, { kind: 'all' }) && !noteInNav(trashed, { kind: 'hidden' }), '回收站里的笔记不进其它视图');

console.log(`hidden: ${n} 条断言全部通过（常规视图不带隐藏笔记、隐藏视图单独可见、回收站不受影响）`);
