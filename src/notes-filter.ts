/** 笔记列表的「归属」判断：某篇笔记该不该出现在当前导航视图里。
 *
 *  抽成纯函数的原因：隐藏（hidden）是一条横切规则——全部笔记、收藏、置顶、提醒、
 *  标签、笔记本、保存的搜索都不能带出隐藏笔记，只有「隐藏笔记」这一个视图带。
 *  规则集中在这里，列表、搜索、统计、提醒轮询才不会有地方漏掉。
 */
import { FULL_VIEW_KINDS } from './types';
import type { NavSelection, Note } from './types';

/** 这篇笔记是否被隐藏（历史数据没有该字段时视为未隐藏）。 */
export function isHidden(n: Note): boolean {
  return Boolean(n.hidden);
}

/** 常规视图里「能看见的笔记」：不在回收站、也没被隐藏。 */
export function isLive(n: Note): boolean {
  return !n.trashed && !isHidden(n);
}

/** 当前导航是否只看隐藏笔记。 */
export function isHiddenView(nav: NavSelection): boolean {
  return nav.kind === 'hidden';
}

/**
 * 笔记是否属于当前导航。
 * 回收站单独一支（回收站里的笔记不论隐藏与否都照旧展示），隐藏视图单独一支，
 * 其余所有视图一律排除隐藏笔记。
 */
export function noteInNav(n: Note, nav: NavSelection): boolean {
  if (nav.kind === 'trash') return n.trashed;
  if (nav.kind === 'hidden') return !n.trashed && isHidden(n);
  if (n.trashed || isHidden(n)) return false;
  const fullView = (FULL_VIEW_KINDS as readonly string[]).includes(nav.kind);
  if (fullView || nav.kind === 'savedSearch') return true;
  switch (nav.kind) {
    case 'all': return true;
    case 'favorites': return n.favorite;
    case 'pinned': return n.pinned;
    case 'reminders': return !!n.reminderAt && !n.reminderDone;
    case 'untagged': return n.tags.length === 0;
    case 'notebook': return n.notebookId === nav.id;
    case 'tag': return n.tags.includes(nav.name);
    default: return true;
  }
}
