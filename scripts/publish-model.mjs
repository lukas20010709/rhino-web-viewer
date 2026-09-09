#!/usr/bin/env node
/**
 * 生GLB → 最適化 → public/projects/<project>/ 配置 の骨子（Node / glTF Transform）。
 * publish-model.ps1（Rhino側統括）から呼ばれる想定。ここでは最適化パイプラインの中核を定義する。
 * 参照: docs/export-pipeline.md §4
 *
 * 使い方(例): node scripts/publish-model.mjs --project project-a --in ./_raw --out public/projects/project-a
 *
 * 注: 実行には @gltf-transform/* と各エンコーダ(meshopt/ktx2)が必要。
 *     本ファイルは処理順とオプションを明示した実装骨子。実運用時に環境へ合わせて有効化する。
 */
import { readdir, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';

// import { NodeIO } from '@gltf-transform/core';
// import { dedup, prune, weld, join as joinMeshes, meshopt, textureCompress } from '@gltf-transform/functions';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  return a;
}

async function optimize(/* io, */ inFile, outFile) {
  // const doc = await io.read(inFile);
  // await doc.transform(
  //   dedup(),                                   // ① 重複統合
  //   prune(),                                   // ② 未使用除去
  //   weld(),                                    // ③ 頂点マージ
  //   joinMeshes(),                              // ④ メッシュ結合(Draw Call削減)
  //   meshopt({ encoder: MeshoptEncoder }),      // ⑤ Meshopt圧縮(第一候補)
  //   textureCompress({ targetFormat: 'webp' }), // ⑥ WebP(大型/モバイル/XRはktx2へ切替)
  // );
  // await io.write(outFile, doc);
  console.log(`[optimize] ${inFile} -> ${outFile} (glTF Transform pipeline: dedup→prune→weld→join→meshopt→webp)`);
}

async function main() {
  const args = parseArgs(process.argv);
  const inDir = args.in ?? './_raw';
  const outDir = args.out ?? `public/projects/${args.project ?? 'project-a'}`;
  await mkdir(outDir, { recursive: true });

  // const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const files = (await readdir(inDir)).filter((f) => f.endsWith('.glb'));
  for (const f of files) {
    const out = join(outDir, basename(f).replace(/\.raw\.glb$/, '.glb'));
    await optimize(/* io, */ join(inDir, f), out);
  }
  console.log('publish(optimize) done. 次に validate-model.mjs で検証してください。');
}

main().catch((e) => { console.error(e); process.exit(1); });
