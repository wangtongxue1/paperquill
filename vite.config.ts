import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 是关键：同一份 dist 既能被 Tauri 内嵌，也能直接双击 index.html
// 在浏览器里离线运行（浏览器模式下数据走 IndexedDB）。
export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    // IIFE + 单 chunk：tools/make_singlefile.py 可以把 JS/CSS 内联进一个 HTML，
    // 双击打开时不受 file:// 对 ES module 的 CORS 限制影响。
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/zhijian.js',
        assetFileNames: 'assets/zhijian.[ext]',
      },
    },
  },
});
