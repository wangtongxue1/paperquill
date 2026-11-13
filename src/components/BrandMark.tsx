/** 纸间笔记的品牌标记：绿色圆角底 + 白色「纸」字。
 *
 *  为什么不再是 `<div>纸</div>` + CSS place-items:center：
 *  CSS 居中的是「字框 / line box」，而汉字墨迹在字框里并不对称（上密下疏、
 *  letter-spacing:-1px 又往左推了半像素），肉眼看上去永远是歪的；系统回退字体
 *  一变，偏移方向还会跟着变。这里改成烘焙好的矢量字形，按「墨迹包围盒 + 35%
 *  质心补偿」精确摆到 viewBox 正中，任何系统、任何 DPI 缩放都一致。
 *
 *  同一份字形数据也用于桌面应用图标（tools/make_icons.py）。
 */
import { GLYPH_BOX, GLYPH_CENTER, GLYPH_D, GLYPH_OCCUPY } from '../brandGlyph';

interface Props {
  size?: number;
  className?: string;
  /** 绿底离 viewBox 边缘的内缩；界面 LOGO 用 0，应用图标留安全边距。 */
  inset?: number;
  /** 圆角半径（viewBox 单位，100 见方）。缺省按绿块边长的 30%。 */
  radius?: number;
  title?: string;
}

const [bx0, by0, bx1, by1] = GLYPH_BOX;
const [cx, cy] = GLYPH_CENTER;
const scale = (100 * GLYPH_OCCUPY) / Math.max(bx1 - bx0, by1 - by0);
// 字体坐标 y 向上，SVG y 向下：先平移到原点、翻转并缩放，再落到 viewBox 中心。
const GLYPH_TRANSFORM = `translate(50 50) scale(${scale} ${-scale}) translate(${-cx} ${-cy})`;

export default function BrandMark({ size = 30, className, inset = 0, radius, title }: Props) {
  const side = 100 - inset * 2;
  return (
    <svg
      className={`brand-mark${className ? ` ${className}` : ''}`}
      width={size} height={size} viewBox="0 0 100 100"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect className="brand-mark__bg" x={inset} y={inset} width={side} height={side}
        rx={radius ?? side * 0.3} />
      <path className="brand-mark__glyph" d={GLYPH_D} transform={GLYPH_TRANSFORM}
        fillRule="nonzero" />
    </svg>
  );
}
