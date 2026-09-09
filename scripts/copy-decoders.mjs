// three 同梱の Draco / Basis(KTX2) デコーダを public/decoders/ へ複製する。
//
// なぜ必要か:
//   ModelLoader は KTX2/Draco デコーダを `${BASE_URL}decoders/{basis,draco}/` から読む。
//   これらは three の配布物（node_modules 内）にしか無いため、build/dev 前に public へ複製する。
//   vite は public/ を dist/ 直下へコピーするので、そのまま GitHub Pages 配信に載る。
//
// 方針: 生成物（＝派生・第三者バイナリ）はコミットしない（.gitignore 済み）。
//   実ジオメトリ非コミットと同じ「原本/依存から生成する」原則に揃える。
//   CI(deploy.yml) は `npm ci` 後に `npm run build`（本スクリプトを内包）を走らせるため、
//   クリーン環境でも常に最新デコーダが供給される。
//
// 参照: docs/export-pipeline.md（Meshopt/KTX2/Draco 圧縮方針）, docs/viewer-design.md §2

import { createRequire } from 'node:module';
import { cp, mkdir, readdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// three のパッケージルートを解決（node_modules の配置に依存しない）。
// three の package.json は "exports" で ./package.json を非公開にしているため、
// メインエントリ（three/build/*.js）から上位ディレクトリを辿って
// examples/jsm/libs を含むルートを探す。
async function findThreeLibs() {
  let dir = dirname(require.resolve('three'));
  for (let i = 0; i < 6; i++) {
    const libs = join(dir, 'examples', 'jsm', 'libs');
    try {
      await access(libs);
      return libs;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('three の examples/jsm/libs が見つかりません（three が未インストール？）');
}

const libs = await findThreeLibs();

// GLB(glTF) 用の Draco デコーダは gltf/ サブフォルダ側を使う。
const jobs = [
  { from: join(libs, 'draco', 'gltf'), to: join('public', 'decoders', 'draco') },
  { from: join(libs, 'basis'), to: join('public', 'decoders', 'basis') },
];

for (const { from, to } of jobs) {
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
  const files = await readdir(to);
  console.log(`copied decoders → ${to} (${files.length} files)`);
}

console.log('copy-decoders: OK');
