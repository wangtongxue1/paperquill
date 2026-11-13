import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './views.css';
import { GLYPH_BOX, GLYPH_CENTER, GLYPH_D, GLYPH_OCCUPY } from './brandGlyph';

// 浏览器标签页也用同一个居中字形。离线单文件版没有 public 目录，
// 所以直接把 SVG 编成 data URI 挂上去，不引入额外文件依赖。
(function setFavicon() {
  const [x0, y0, x1, y1] = GLYPH_BOX;
  const [cx, cy] = GLYPH_CENTER;
  const s = (100 * GLYPH_OCCUPY) / Math.max(x1 - x0, y1 - y0);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" rx="30" fill="#2F8F68"/>` +
    `<g transform="translate(50 50) scale(${s} ${-s}) translate(${-cx} ${-cy})">` +
    `<path d="${GLYPH_D}" fill="#fff"/></g></svg>`;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  document.head.appendChild(link);
})();

// 刻意不套 StrictMode：双缓冲渲染会让自动保存的 effect 跑两遍，
// 对「即写即存」的编辑器反而制造重复写入。
createRoot(document.getElementById('root')!).render(<App />);
