/** 统一的「导出」面板：列表右键、编辑器菜单、导入导出页、命令面板都打开它。
 *  格式清单在 src/export.ts，这里只负责选格式和给一句人话说明。 */
import { useMemo, useState } from 'react';
import { Archive, Check, FileDown, FileText, Globe, Printer, Type } from 'lucide-react';
import { useApp } from '../context';
import { EXPORT_FORMATS, exportNotes, type ExportFormat } from '../export';
import { printNote } from '../io';
import { Btn, Modal } from './Common';

const ICON: Record<ExportFormat, React.ReactNode> = {
  md: <FileText size={18} />,
  html: <Globe size={18} />,
  pdf: <FileDown size={18} />,
  txt: <Type size={18} />,
  enex: <Archive size={18} />,
};

export default function ExportDialog() {
  const { dialog, closeDialog, ws, toast } = useApp();
  const payload = dialog.payload || {};
  const ids: string[] = Array.isArray(payload.ids) ? payload.ids : [];
  const notes = useMemo(
    () => ids.map((id) => ws.notes.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n),
    [ids, ws.notes]
  );
  const [format, setFormat] = useState<ExportFormat>('md');
  const [busy, setBusy] = useState(false);
  const single = notes.length === 1;
  const active = EXPORT_FORMATS.find((f) => f.id === format) || EXPORT_FORMATS[0];
  const blocked = !notes.length || (format === 'pdf' && !single);
  const names = notes.slice(0, 3).map((n) => n.title || '未命名笔记').join('、');

  const run = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      const res = await exportNotes(notes, format, ws.notes.filter((n) => !n.trashed));
      toast(res.count > 1 ? `已导出 ${res.count} 篇（${res.name}）` : `已导出「${res.name}」`);
      closeDialog();
    } catch (e) {
      toast(`导出失败：${String(e)}`, 'err');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="导出笔记"
      subtitle="全部在本机生成，文件里图片与附件都是内嵌的"
      width={640}
      onClose={closeDialog}
      icon={<FileDown size={19} />}
      footer={
        <>
          <Btn onClick={closeDialog}>取消</Btn>
          {single && <Btn onClick={() => { printNote(notes[0]); closeDialog(); }}><Printer size={13} /> 直接打印</Btn>}
          <Btn variant="primary" disabled={blocked || busy} onClick={() => void run()}>
            {busy ? '正在生成…' : `导出 ${active.label}`}
          </Btn>
        </>
      }
    >
      <div className="export-range">
        <span className="export-range__label">导出范围</span>
        <strong>{single ? notes[0].title || '未命名笔记' : `${notes.length} 篇笔记`}</strong>
        {!single && <em>{names}{notes.length > 3 ? ` 等 ${notes.length} 篇` : ''}</em>}
      </div>

      <div className="export-cards">
        {EXPORT_FORMATS.map((f) => {
          const off = !f.many && !single;
          return (
            <button
              key={f.id}
              type="button"
              disabled={off}
              className={`export-card ${format === f.id ? 'is-on' : ''} ${off ? 'is-off' : ''}`}
              onClick={() => setFormat(f.id)}
            >
              <span className="export-card__ico">{ICON[f.id]}</span>
              <strong>{f.label} <em>.{f.ext}</em></strong>
              <span className="export-card__desc">{off ? 'PDF 一次只能导一篇' : f.desc}</span>
              {format === f.id && <span className="export-card__tick"><Check size={12} /></span>}
            </button>
          );
        })}
      </div>

      <p className="muted export-hint">
        {single
          ? '单个文件就能独立打开：图片、画板快照、音视频都随文件走，换台电脑也不会变成裂图。'
          : `多篇会打成一个 zip，每篇一个 .${active.ext} 文件；ENEX 格式本身支持多篇，出的是单个文件。`}
      </p>
    </Modal>
  );
}
