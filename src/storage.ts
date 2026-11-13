import type { Note, Notebook, NotebookGroup, Settings, Template, Workspace } from './types';
import { DEFAULT_SIDEBAR_SECTIONS, WORKSPACE_VERSION } from './types';
import { builtinTemplates, defaultSettings } from './data';
import { htmlToMd, resolveAttachmentRefs } from './convert';
import { downloadBlob } from './utils';

/* ---------------- 存档迁移：格式是公共契约，见 docs/data-format.md ---------------- */

/** 补齐单个笔记的历史缺省字段；未知字段原样保留，绝不静默丢弃。 */
function normalizeNote(raw: Record<string, any>): Note {
  const now = Date.now();
  return {
    ...raw,
    id: String(raw.id || `legacy_${Math.random().toString(36).slice(2, 10)}`),
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    mode: raw.mode === 'rich' ? 'rich' : 'markdown',
    notebookId: raw.notebookId ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    createdAt: Number(raw.createdAt) || now,
    updatedAt: Number(raw.updatedAt) || now,
    pinned: Boolean(raw.pinned),
    favorite: Boolean(raw.favorite),
    trashed: Boolean(raw.trashed),
    trashedAt: raw.trashedAt ?? null,
    reminderAt: raw.reminderAt ?? null,
    reminderDone: Boolean(raw.reminderDone),
    sourceUrl: String(raw.sourceUrl ?? ''),
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
  };
}

/**
 * 模板列表迁移。
 * 内置模板的文案、图标、说明属于产品内容，随版本更新（v2 → v3 就整体换了一版），
 * 所以按 id 刷成当前定义；用户自己存的模板一个字段都不动，包括旧版遗留的 emoji 图标
 * （渲染层会把认不出的图标降级成线性图标）。
 */
function migrateTemplates(raw: unknown): Template[] {
  if (!Array.isArray(raw) || raw.length === 0) return builtinTemplates.map((t) => ({ ...t }));
  const fresh = new Map(builtinTemplates.map((t) => [t.id, t]));
  const out: Template[] = (raw as Template[]).map((t) => {
    const cur = t && t.builtin ? fresh.get(t.id) : undefined;
    if (!cur) return t;
    // 只换产品内容，其它（createdAt、未来新增字段）保留。
    return { ...t, name: cur.name, icon: cur.icon, desc: cur.desc, content: cur.content, builtin: true };
  });
  for (const t of builtinTemplates) {
    if (!out.some((x) => x && x.id === t.id)) out.push({ ...t });
  }
  return out;
}

/**
 * 把任意历史版本的存档升级成当前结构。
 * 原则：① 未知字段原样保留（第三方扩展 / 更新版本写的字段不能丢）
 *      ② 只补默认值，不改写已有值  ③ 解析失败必须抛错，由调用方阻止写盘。
 * version < 1 的档只可能是 v0 原型（只有 notes 数组），下面的补默认值已经覆盖。
 */
export function migrate(raw: unknown): Workspace {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('存档格式无法识别：顶层不是对象');
  }
  const obj = raw as Record<string, any>;
  const version = typeof obj.version === 'number' ? obj.version : 0;
  const ws: Workspace = {
    ...obj,
    version: WORKSPACE_VERSION,
    notes: Array.isArray(obj.notes) ? obj.notes.map(normalizeNote) : [],
    notebooks: Array.isArray(obj.notebooks) ? (obj.notebooks as Notebook[]) : [],
    groups: Array.isArray(obj.groups) ? (obj.groups as NotebookGroup[]) : [],
    templates: migrateTemplates(obj.templates),
    settings: {
      ...defaultSettings,
      ...(obj.settings && typeof obj.settings === 'object' ? obj.settings : {}),
    } as Settings,
    // v2 新增：快捷方式 / 保存的搜索 / 笔记历史 / 侧栏自定义 / 首页即时贴。
    // 全部是「只补默认值」，v1 存档的既有字段一个都不改写。
    shortcuts: Array.isArray(obj.shortcuts) ? obj.shortcuts : [],
    savedSearches: Array.isArray(obj.savedSearches) ? obj.savedSearches : [],
    recentSearches: Array.isArray(obj.recentSearches) ? obj.recentSearches.slice(0, 12) : [],
    noteHistory:
      obj.noteHistory && typeof obj.noteHistory === 'object' && !Array.isArray(obj.noteHistory)
        ? obj.noteHistory
        : {},
    sidebarSections: {
      ...DEFAULT_SIDEBAR_SECTIONS,
      ...(obj.sidebarSections && typeof obj.sidebarSections === 'object' ? obj.sidebarSections : {}),
    },
    sticky: String(obj.sticky ?? ''),
    updatedAt: Number(obj.updatedAt) || Date.now(),
  } as Workspace;

  // v1 -> v2 只增加顶层可选字段，笔记结构不变，所以不需要改写 notes。
  // v2 -> v3 只把内置模板换成新的文案/图标（见 migrateTemplates），笔记同样不动。
  // 以后若有破坏性变更，在这里按 version 逐级升级。
  void version;
  return ws;
}

/** Tauri 2 在 WebView 里注入的是 __TAURI_INTERNALS__；浏览器预览模式没有。 */
export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

/** 直接走 Tauri 注入的 IPC 入口，不 import @tauri-apps/api：
 *  这样整包可以打成单个 IIFE，离线 HTML 双击也能跑（没有 ES module 的 CORS 限制）。 */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke: <R>(cmd: string, args?: Record<string, unknown>) => Promise<R> };
  }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return Promise.reject(new Error('当前不在纸间笔记桌面版中'));
  return internals.invoke<T>(cmd, args ?? {});
}

export function windowAction(action: 'min' | 'max' | 'close'): Promise<void> {
  return invoke<void>('window_action', { action });
}

/* ---------------- 浏览器模式：IndexedDB 单键存档 ---------------- */

/** 内部存储键**刻意保留旧名**：改名只换品牌，不能让浏览器模式里已有的笔记消失。
 *  这两个字符串属于数据契约，不是品牌文案，见 docs/data-format.md。 */
const LOCAL_KEY = 'inknote.workspace';
const useLocalOnly = () =>
  typeof location !== 'undefined' && location.protocol === 'file:';

/** file:// 下部分 Chromium 版本的 indexedDB.open 既不 success 也不 error，
 *  Promise 会永远挂着（离线单文件版就卡在启动页）。所以加超时 + 协议判断双保险。 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('IndexedDB 打开超时')), 1500);
    const done = <T,>(fn: (v: T) => void) => (v: T) => { window.clearTimeout(timer); fn(v); };
    try {
      const req = indexedDB.open('inknote', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
      };
      req.onsuccess = done(() => resolve(req.result));
      req.onerror = done(() => reject(req.error));
      req.onblocked = done(() => reject(new Error('IndexedDB 被阻塞')));
    } catch (e) { window.clearTimeout(timer); reject(e); }
  });
}

function localLoad(): unknown | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 本次 load 是否是从旧版本档升级上来的。
 *  migrate() 会把 version 改成当前版本，调用方拿不到原始值，所以在这里单独记账。 */
let lastLoadUpgraded = false;
export function wasLastLoadUpgraded(): boolean { return lastLoadUpgraded; }

function parseWorkspace(raw: unknown): Workspace {
  const o = raw as Record<string, unknown> | null;
  const old = !(o && typeof o === 'object' && !Array.isArray(o) &&
    typeof o.version === 'number' && o.version >= WORKSPACE_VERSION);
  lastLoadUpgraded = old;
  return migrate(raw);
}

export const storage = {
  isDesktop,

  /** 解析失败会抛错：调用方必须停止写盘，避免用示例数据覆盖损坏的存档。 */
  async load(): Promise<Workspace | null> {
    if (isDesktop()) {
      const raw = await invoke<string | null>('load_workspace');
      if (!raw) return null;
      return parseWorkspace(JSON.parse(raw));
    }
    if (useLocalOnly()) {
      const raw = localLoad();
      return raw ? parseWorkspace(raw) : null;
    }
    try {
      const raw = await idbGet<unknown>('workspace');
      return raw ? parseWorkspace(raw) : null;
    } catch {
      const raw = localLoad();
      return raw ? parseWorkspace(raw) : null;
    }
  },

  /** 桌面版顺带让 Rust 侧把每篇笔记镜像成 .md / .html 纯文本文件。 */
  async save(ws: Workspace): Promise<void> {
    const next = { ...ws, updatedAt: Date.now() };
    if (isDesktop()) {
      // 路线 A：富文本是默认视图，但仍要有纯文本 .md 镜像。
      // HTML→Markdown 在前端用 turndown 生成，随存档一起传；Rust 会剔除这个临时字段再写盘。
      const mirrors: Record<string, string> = {};
      for (const n of next.notes) {
        if (n.trashed) continue;
        const atts = n.attachments || [];
        try {
          mirrors[n.id] = n.mode === 'rich'
            ? resolveAttachmentRefs(htmlToMd(n.content, atts), atts)
            : resolveAttachmentRefs(n.content, atts);
        } catch {
          mirrors[n.id] = n.content;
        }
      }
      await invoke<void>('save_workspace', {
        json: JSON.stringify({ ...next, __markdownMirrors: mirrors }),
      });
    } else if (useLocalOnly()) {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { /* 隐私模式 */ }
    } else {
      try { await idbSet('workspace', next); }
      catch { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(next)); } catch { /* 忽略 */ } }
    }
  },

  async dataDir(): Promise<string> {
    if (!isDesktop()) {
      return useLocalOnly() ? '浏览器本地存储（单文件版 / localStorage）' : '浏览器本地存储（IndexedDB）';
    }
    try { return await invoke<string>('data_dir'); } catch { return ''; }
  },

  async openDataDir(): Promise<void> {
    if (isDesktop()) await invoke<void>('open_data_dir');
  },

  /** 数据目录自定义：配置固定存默认 app_data_dir 的 zhijian.conf，切换时复制现有存档。 */
  async defaultDataDir(): Promise<string> {
    if (!isDesktop()) return '';
    try { return await invoke<string>('default_data_dir'); } catch { return ''; }
  },
  async pickDataDir(): Promise<string | null> {
    if (!isDesktop()) return null;
    try { return await invoke<string | null>('pick_data_dir'); } catch { return null; }
  },
  async setDataDir(path: string): Promise<string> {
    return await invoke<string>('set_data_dir', { path });
  },
  async resetDataDir(): Promise<string> {
    return await invoke<string>('reset_data_dir');
  },

  /** 单篇导出 / 备份导出：桌面版弹原生保存对话框，浏览器版直接下载。 */
  async saveText(name: string, content: string, mime = 'text/plain;charset=utf-8'): Promise<string> {
    if (isDesktop()) {
      return await invoke<string>('save_export', { name, content });
    }
    downloadBlob(name, content, mime);
    return name;
  },

  async saveBinary(name: string, base64: string, mime: string): Promise<string> {
    if (isDesktop()) {
      return await invoke<string>('save_export_binary', { name, base64 });
    }
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    downloadBlob(name, bytes, mime);
    return name;
  },

  /** 2.5.9：把附件原样交给本机默认程序（Word / Excel / WPS），格式 100% 还原。
   *  离线单文件版没有系统命令通道，返回 false，由调用方提示下载后用本机程序打开。 */
  async openWithSystem(name: string, base64: string): Promise<boolean> {
    if (!isDesktop()) return false;
    await invoke('open_attachment_temp', { name, base64Data: base64 });
    return true;
  },

  /** 剪藏公开网页：桌面版由 Rust 侧发请求（不受浏览器 CORS 限制）。 */
  async fetchClip(url: string): Promise<string> {
    if (isDesktop()) return await invoke<string>('fetch_clip', { url });
    const res = await fetch(url, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  },
};
