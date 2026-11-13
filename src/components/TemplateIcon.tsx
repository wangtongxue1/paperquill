/** 模板图标：统一一套线性图标，不用 emoji。
 *  emoji 在不同系统里字形、色彩都不一样，六张卡片凑在一起像一排贴纸，
 *  和编辑器那种克制的风格不搭。这里按语义键取 lucide 图标，认不出的键（旧存档里的
 *  '📝' 之类）降级成同一个通用图标。
 */
import {
  BookOpen, CalendarDays, ClipboardList, FileText, ListChecks, StickyNote, Sun,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  blank: FileText,
  meeting: CalendarDays,
  diary: Sun,
  reading: BookOpen,
  todo: ListChecks,
  weekly: ClipboardList,
  custom: StickyNote,
};

export default function TemplateIcon({ icon, size = 15 }: { icon: string; size?: number }) {
  const Icon = ICONS[icon] ?? StickyNote;
  return (
    <span className="tpl-ico" aria-hidden="true">
      <Icon size={size} strokeWidth={1.7} />
    </span>
  );
}
