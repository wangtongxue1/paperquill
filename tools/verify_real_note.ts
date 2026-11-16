/** 用用户真实笔记（AI赋能零售标杆分享交流会）里的表格验证：管道表+列宽注释往返。 */
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor-schema';
import { toEditorHtml } from '../src/tiptap-html';
import { htmlToMd, mdToHtml } from '../src/convert';

const out: string[] = [];
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  out.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' :: ' + detail}`);
  cond ? pass++ : fail++;
}
function mount(html: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new Editor({ element: host, extensions: buildExtensions(), content: toEditorHtml(html) });
}

// 用户笔记里的真实表格（TipTap 渲染态，列宽 181/366 拖过）
const REAL = `<table style="min-width: 595px;"><colgroup><col style="width: 181.0px;"><col style="width: 366.0px;"><col style="min-width: 48px;"></colgroup>`
  + `<tbody><tr><th><p>场景</p></th><th><p>做法与成效</p></th><th><p>我司可借鉴点</p></th></tr>`
  + `<tr><td><p>会员小助手"旺财"</p></td><td><p>7×24响应门店POS、券、积分、权限等咨询</p></td><td><p>门店高频咨询先做智能答疑</p></td></tr>`
  + `<tr><td><p>导购服务AI总结</p></td><td><p>自动分析企微聊天，提炼关键信息与服务机会点</p></td><td><p>企微聊天有效内容识别</p></td></tr>`
  + `<tr><td><p>RPA报表</p></td><td><p>自动取数出表，4小时→30分钟</p></td><td><p>BI报表AI化、自动取数</p></td></tr>`
  + `<tr><td><p>AI增长引擎（潜客雷达）</p></td><td><p>星级识别高潜会员自动触达，建联率85%、转化2907万、邀约文案11万余条，50%加盟门店已接入</p></td><td><p>潜客识别＋智能邀约，加盟门店同样适用</p></td></tr>`
  + `<tr><td><p>AI衣橱／千人千面搭配</p></td><td><p>按消费偏好实时生成穿搭方案，点击率26%以上</p></td><td><p>小程序个性化推荐</p></td></tr>`
  + `<tr><td><p>AI试穿／AI生图</p></td><td><p>覆盖5个离店场景，试穿转化8.2%；生图支持远程成交</p></td><td><p>会员端互动、导购远程销售素材</p></td></tr>`
  + `<tr><td><p>AI练货工具</p></td><td><p>任务下发→练货→多维评分→案例沉淀→自动加练→效果关联销售</p></td><td><p>练货标准化闭环，与玛丝菲尔互为印证</p></td></tr></tbody></table>`;

const md = htmlToMd(REAL);
out.push('REAL md =\n' + md);
check('R1 源码是可读管道表（不是 HTML 堆）', md.startsWith('| 场景 | 做法与成效 | 我司可借鉴点 |') && !md.includes('<table'), md.slice(0, 200));
check('R2 列宽注释 181,366', md.includes('<!-- table-colwidth: 181,366,- -->'), md.slice(-120));

const back = mdToHtml(md);
const ed = mount(back);
const rich = ed.getHTML();
check('R3 回到富文本 8 行都在', (rich.match(/<tr/g) || []).length === 8, String((rich.match(/<tr/g) || []).length));
check('R4 列宽 181/366 还原', rich.includes('width: 181px') && rich.includes('width: 366px'), rich.slice(0, 260));
check('R5 内容完整（85% / 8.2% / 玛丝菲尔）', rich.includes('85%') && rich.includes('8.2%') && rich.includes('玛丝菲尔'), '');

const md2 = htmlToMd(rich);
check('R6 二次往返不漂移', md2 === md, `p2=${md2.slice(0, 200)}`);

out.push(`RESULT real-note ok=${pass}/${pass + fail}`);
const el = document.getElementById('result');
if (el) el.textContent = out.join('\n');
