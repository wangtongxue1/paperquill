/** 表格框选相关的纯逻辑：单元格区间计算、整格 mark 判断、Ctrl+A 三级全选。
 *
 *  为什么单独一层：RichEditor 里的工具栏按钮和探针脚本（tools/verify_table.ts）要跑
 *  同一套判定，逻辑写在组件里就只能靠「点 UI」去测，位置全绑在 DOM 上，很脆。
 *  这里只依赖 EditorState / 事务，不碰 DOM。
 */
import { CellSelection, TableMap, cellAround, selectedRect } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

export interface CellRange {
  /** 单元格内容区间（不含 cell 节点本身）。 */
  from: number;
  to: number;
  node: PMNode;
}

export interface CellSelInfo {
  ranges: CellRange[];
  /** 选区左上 / 右下单元格的节点位置，用于改完格式后把框选还原。 */
  anchor: number;
  head: number;
}

/**
 * 当前是不是「框选了若干单元格」，是的话返回每格的区间。
 * 合并单元格在 TableMap 里会重复占多个格子，这里按位置去重，一格只改一次。
 */
export function cellSelInfo(state: EditorState): CellSelInfo | null {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return null;
  const rect = selectedRect(state);
  const { map, table, tableStart } = rect;
  const seen = new Set<number>();
  const ranges: CellRange[] = [];
  for (let row = rect.top; row < rect.bottom; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      const offset = map.map[row * map.width + col];
      if (seen.has(offset)) continue;
      seen.add(offset);
      const node = table.nodeAt(offset);
      if (!node) continue;
      ranges.push({ from: tableStart + offset + 1, to: tableStart + offset + node.nodeSize - 1, node });
    }
  }
  if (!ranges.length) return null;
  const at = (row: number, col: number) => tableStart + map.map[row * map.width + col];
  return { ranges, anchor: at(rect.top, rect.left), head: at(rect.bottom - 1, rect.right - 1) };
}

/** 这个单元格里的文字是不是全都带了某个 mark（用来决定「统一加粗」还是「统一取消」）。 */
export function cellFullyMarked(cell: PMNode, mark: string): boolean {
  let any = false;
  let all = true;
  cell.descendants((n) => {
    if (n.isText) {
      any = true;
      if (!n.marks.some((m) => m.type.name === mark)) all = false;
    }
    return true;
  });
  return any && all;
}

/** 当前框选是否已经覆盖整张表。 */
export function spansWholeTable(state: EditorState): boolean {
  if (!(state.selection instanceof CellSelection)) return false;
  const rect = selectedRect(state);
  return rect.top === 0 && rect.left === 0 && rect.bottom === rect.map.height && rect.right === rect.map.width;
}

/**
 * Ctrl / ⌘ + A 在表格里的三级选取：当前单元格 → 整张表格 → 返回 false（交给「选中整篇」）。
 * prosemirror-tables 没接管 Mod-a，不补这一层的话一按就是整篇全选。
 */
export function selectTableLadder(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const sel = state.selection;
  if (sel instanceof CellSelection) {
    if (spansWholeTable(state)) return false;
    const $cell = sel.$anchorCell;
    const table = $cell.node(-1);
    const start = $cell.start(-1);
    const map = TableMap.get(table);
    dispatch?.(state.tr.setSelection(new CellSelection(
      state.doc.resolve(start + map.map[0]),
      state.doc.resolve(start + map.map[map.map.length - 1]),
    )));
    return true;
  }
  const $cell = cellAround(sel.$from);
  if (!$cell) return false;
  dispatch?.(state.tr.setSelection(new CellSelection($cell, $cell)));
  return true;
}
