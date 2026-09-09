import { defineConfig } from 'vite';

// GitHub Pages配信を想定。
// project pages (https://<user>.github.io/<repo>/) の場合は base を '/<repo>/' にする。
// 環境変数 VITE_BASE で上書き可能（CIから注入）。
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: 'dist',
    // three.js 単体で ~520kB（3Dビューアの初期表示に必須のため遅延ロード不可）。
    // vendor分離後に残る警告はこの既知サイズのみ。閾値を実態に合わせる。
    chunkSizeWarningLimit: 600,
    // three.js は容量の大半を占める安定依存。vendorチャンクへ分離し、
    // アプリコード更新時もブラウザキャッシュを再利用できるようにする（章の code-split 方針）。
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
