import { createContext, useContext } from 'react';
import type { Note, NavSelection, Workspace } from './types';
import type { Actions } from './actions';

export type DialogKind =
  | null
  | 'settings'
  | 'clip'
  | 'templates'
  | 'io'
  | 'export'
  | 'reminder'
  | 'about'
  | 'shortcuts'
  | 'prompt'
  | 'confirm'
  | 'move'
  | 'tag'
  | 'tagManager'
  | 'search'
  | 'sidebar'
  | 'noteInfo'
  | 'history'
  | 'findReplace'
  | 'saveSearch'
  | 'preview'
  | 'board'
  | 'import';

export interface DialogState {
  kind: DialogKind;
  // 各对话框自备的小载荷（目标 id、标题、默认值等），刻意用宽类型避免十几个联合分支。
  payload?: any;
}

export interface AppContextValue {
  ws: Workspace;
  nav: NavSelection;
  setNav: (n: NavSelection) => void;
  query: string;
  setQuery: (q: string) => void;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  actions: Actions;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  dialog: DialogState;
  openDialog: (kind: DialogKind, payload?: any) => void;
  closeDialog: () => void;
  dataDir: string;
  saveState: 'saved' | 'saving' | 'error';
  /** 当前导航 + 搜索 + 排序后的结果，列表与批量操作都以此为准。 */
  visibleNotes: Note[];
  dueReminders: Note[];
  desktop: boolean;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 AppContext.Provider 内使用');
  return ctx;
}
