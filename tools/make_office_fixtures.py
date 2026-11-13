#!/usr/bin/env python3
"""生成带真实排版信息的 Office 附件，供 v258 / v259 浏览器探针注入。

故意把「格式」做得很明显（Word 红色粗体标题 + 表格、Excel 合并单元格 / 底色 /
边框 / 列宽 / 多工作表、PPT 两页带配色与位置），这样探针能验证预览是不是
真的还原了版式，而不只是把文字抠出来。产物只在 .temp/ 里，不进交付物。
"""

import base64
import io
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / '.temp' / 'office-fixtures.json'

DOCX_MARK = '费控系统 PRD 全量蓝图'
XLSX_MARK = '会员项目'
PPTX_MARK = '迁移与自研方案'
HTML_MARK = '纸间笔记 HTML 预览'
MD_MARK = '读书行动清单'


def gen_docx() -> bytes:
    from docx import Document
    from docx.shared import Pt, RGBColor

    d = Document()
    d.add_heading('中和集团信息中心', 0)
    p = d.add_paragraph()
    r = p.add_run(DOCX_MARK)
    r.bold = True
    r.font.size = Pt(16)
    r.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)
    d.add_paragraph('会员项目三方案评估：微盟智慧零售 / 达摩 GIC 迁移 / 群脉源码采购。')
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text = '阶段'
    t.cell(0, 1).text = '内容'
    t.cell(1, 0).text = '一期'
    t.cell(1, 1).text = '会员与 SCRM'
    b = io.BytesIO()
    d.save(b)
    return b.getvalue()


def gen_xlsx() -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    ws = wb.active
    ws.title = '项目清单'
    thin = Side(style='thin', color='FF9BB59B')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.merge_cells('A1:C1')
    c = ws['A1']
    c.value = '中和集团 2026 项目清单'
    c.font = Font(name='Microsoft YaHei', size=14, bold=True, color='FFFFFFFF')
    c.fill = PatternFill('solid', fgColor='FF137A5E')
    c.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 28

    for j, head in enumerate(['项目', '负责人', '预算'], start=1):
        cell = ws.cell(row=2, column=j, value=head)
        cell.font = Font(bold=True)
        cell.fill = PatternFill('solid', fgColor='FFE0F4E9')
        cell.border = border

    ws.append([XLSX_MARK, '王明勇', 1280000])
    ws.append(['费控系统', '信息中心', 860000])
    for row in ws.iter_rows(min_row=3, max_row=4, min_col=1, max_col=3):
        for cell in row:
            cell.border = border
    ws['C3'].number_format = '#,##0'
    ws['C4'].number_format = '#,##0'
    ws.column_dimensions['A'].width = 26
    ws.column_dimensions['B'].width = 16
    ws.column_dimensions['C'].width = 16

    s2 = wb.create_sheet('环比趋势')
    s2.append(['月份', '学习人数'])
    s2.append(['9 月', 120])
    s2.append(['10 月', 168])
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()


def gen_pptx() -> bytes:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.util import Inches, Pt

    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    s1 = prs.slides.add_slide(blank)
    box = s1.shapes.add_textbox(Inches(0.8), Inches(0.7), Inches(8.4), Inches(1.4))
    run = box.text_frame.paragraphs[0].add_run()
    run.text = '第一页：会员项目现状'
    run.font.size = Pt(32)
    run.font.bold = True
    run.font.color.rgb = RGBColor(0x13, 0xC2, 0xC2)

    s2 = prs.slides.add_slide(blank)
    box2 = s2.shapes.add_textbox(Inches(1.2), Inches(2.2), Inches(7.6), Inches(1.2))
    run2 = box2.text_frame.paragraphs[0].add_run()
    run2.text = f'第二页：{PPTX_MARK}'
    run2.font.size = Pt(26)
    run2.font.color.rgb = RGBColor(0xC0, 0x39, 0x2B)

    b = io.BytesIO()
    prs.save(b)
    return b.getvalue()


def main() -> None:
    html = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<style>body{font-family:"Microsoft YaHei",sans-serif;padding:24px;}'
        'h1{color:#137a5e;border-bottom:2px solid #13c2c2;padding-bottom:8px;}'
        'table{border-collapse:collapse;margin-top:14px;}'
        'td,th{border:1px solid #cfd8d1;padding:6px 12px;}th{background:#e0f4e9;}'
        '</style></head><body>'
        f'<h1>{HTML_MARK}</h1><p>这一段来自附件里的 HTML 文件，样式写在 style 标签里。</p>'
        '<table><tr><th>项目</th><th>状态</th></tr><tr><td>会员项目</td><td>评估中</td></tr></table>'
        '</body></html>'
    )
    md = (
        f'# {MD_MARK}\n\n'
        '> 从低价促销转向品牌化、知识型内容\n\n'
        '| 平台 | 定位 |\n| --- | --- |\n| 公众号 | 深度长文 |\n| 抖音 | 短视频 |\n\n'
        '- [x] 确定内容调性\n- [ ] 排期与选题\n\n`代码片段` 与 **加粗** 也要能渲染。\n'
    )
    csv = '姓名,部门,分数\n王明勇,信息中心,98\n张三,运营部,86\n'
    pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

    blobs = {
        'docx': gen_docx(),
        'xlsx': gen_xlsx(),
        'pptx': gen_pptx(),
        'html': html.encode('utf-8'),
        'md': md.encode('utf-8'),
        'csv': csv.encode('utf-8'),
        'pdf': pdf.encode('utf-8'),
    }
    data = {k: base64.b64encode(v).decode('ascii') for k, v in blobs.items()}
    data['marks'] = {
        'docx': DOCX_MARK, 'xlsx': XLSX_MARK, 'pptx': PPTX_MARK,
        'html': HTML_MARK, 'md': MD_MARK,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    print(f'已生成 {OUT}（{OUT.stat().st_size} 字节）：' + ', '.join(f'{k}={len(v)}B' for k, v in blobs.items()))


if __name__ == '__main__':
    main()
