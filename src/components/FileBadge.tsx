/** 文件类型徽标：附件区、文件卡片、预览弹窗共用一个小色块。
 *  纯展示组件，不含编辑器状态；颜色与短标签都从 media.ts 的统一表里取。 */
import { FILE_KIND_COLORS, fileBadgeLabel, fileKindOf } from '../media';
import type { AttachmentKind } from '../types';

interface Props {
  name: string;
  mime?: string;
  kind?: AttachmentKind;
  size?: 'sm' | 'md' | 'lg';
}

export function FileBadge({ name, mime = '', kind, size = 'md' }: Props) {
  const fk = fileKindOf(name, mime, kind);
  const [fg, bg] = FILE_KIND_COLORS[fk];
  return (
    <span className={`file-badge file-badge--${size}`} data-att-kind={fk}
      style={{ color: fg, background: bg }} aria-hidden="true">
      {fileBadgeLabel(name, fk)}
    </span>
  );
}

export default FileBadge;
