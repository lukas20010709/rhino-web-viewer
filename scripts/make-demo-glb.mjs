#!/usr/bin/env node
/**
 * デモ用プレースホルダGLB生成スクリプト（ローカル開発専用）。
 *
 * 目的:
 *   原本Rhinoが手元に無くても、Viewerのパイプライン（manifest→分割GLBロード→
 *   Selection→Model Tree→Property Panel）を end-to-end で実際に動かして確認できるよう、
 *   manifest.parts に対応する簡易GLB（色付きの箱）を生成する。
 *
 * 重要:
 *   - これは「派生Web幾何（実ジオメトリ）はリポジトリに置かない」設計方針を壊さないため、
 *     生成物 public/projects/project-a/*.glb は .gitignore 済み（コミットしない）。
 *   - 実プロジェクトでは rhino-source-tools/ の export_web.py / publish-model.ps1 が
 *     最適化済みGLBを生成・配置する。本スクリプトはあくまで開発時の代替。
 *   - metadata.json の Object ID を GLBノード名に付与するので、Selection/Property が実際に機能する。
 *
 * 使い方: node scripts/make-demo-glb.mjs [projectDir]
 *   既定 projectDir = public/projects/project-a
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const projectDir = resolve(process.argv[2] ?? 'public/projects/project-a');

/** category → manifest part.id の対応（サンプルmanifestに専用partが無いものは近い部位へ寄せる） */
const CATEGORY_TO_PART = {
  wall: 'architecture',
  ceiling: 'architecture',
  opening: 'architecture',
  floor: 'architecture',
  furniture: 'furniture',
  lighting: 'architecture', // サンプルmanifestに lighting/equipment part が無いため
  equipment: 'furniture',
};

/** part.id → 見た目の色 [r,g,b] (0..1) */
const PART_COLOR = {
  site: [0.62, 0.66, 0.60],
  structure: [0.45, 0.55, 0.68],
  architecture: [0.82, 0.74, 0.60],
  furniture: [0.40, 0.62, 0.45],
  equipment: [0.70, 0.55, 0.45],
  landscape: [0.50, 0.68, 0.50],
};

/** 中心原点・一辺sの立方体（24頂点・法線付き・36インデックス）を返す */
function boxGeometry(s) {
  const h = s / 2;
  // 各面: 4頂点 × 6面。法線は面ごとに一定。
  const faces = [
    { n: [1, 0, 0], v: [[h, -h, -h], [h, h, -h], [h, h, h], [h, -h, h]] },
    { n: [-1, 0, 0], v: [[-h, -h, h], [-h, h, h], [-h, h, -h], [-h, -h, -h]] },
    { n: [0, 1, 0], v: [[-h, h, -h], [-h, h, h], [h, h, h], [h, h, -h]] },
    { n: [0, -1, 0], v: [[-h, -h, h], [-h, -h, -h], [h, -h, -h], [h, -h, h]] },
    { n: [0, 0, 1], v: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], v: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((f, fi) => {
    for (const vert of f.v) {
      positions.push(...vert);
      normals.push(...f.n);
    }
    const b = fi * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

/** doc内に「色付きの箱」メッシュを1つ作る（accessor/material/mesh を都度生成） */
function makeBoxMesh(doc, buffer, size, color, name) {
  const g = boxGeometry(size);

  // POSITION の min/max は glTF 仕様で必須だが、NodeIO 書き出し時に自動計算・付与される。
  const pos = doc.createAccessor().setType('VEC3').setArray(g.positions).setBuffer(buffer);
  const nor = doc.createAccessor().setType('VEC3').setArray(g.normals).setBuffer(buffer);
  const idx = doc.createAccessor().setType('SCALAR').setArray(g.indices).setBuffer(buffer);

  const mat = doc
    .createMaterial(`${name}_mat`)
    .setBaseColorFactor([color[0], color[1], color[2], 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.85);

  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', pos)
    .setAttribute('NORMAL', nor)
    .setIndices(idx)
    .setMaterial(mat);

  return doc.createMesh(name).addPrimitive(prim);
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function main() {
  const manifest = await readJson(join(projectDir, 'manifest.json'));
  const metadata = await readJson(join(projectDir, manifest.metadata ?? 'metadata.json'));

  // Object ID を part ごとにグルーピング（category から part を導出）。
  const idsByPart = new Map();
  for (const [id, attr] of Object.entries(metadata.objects ?? {})) {
    const part = CATEGORY_TO_PART[attr.category] ?? 'architecture';
    if (!idsByPart.has(part)) idsByPart.set(part, []);
    idsByPart.get(part).push(id);
  }

  const io = new NodeIO();
  const written = [];

  for (const part of manifest.parts ?? []) {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene(part.id);
    const color = PART_COLOR[part.id] ?? [0.7, 0.7, 0.7];

    // partを表す「シェル」箱（未選択でも部位が見えるように）。
    const baseSize = part.id === 'site' ? 4000 : 1500;
    const baseMesh = makeBoxMesh(doc, buffer, baseSize, color, `${part.id}_shell`);
    const baseNode = doc
      .createNode(`${part.id}_shell`)
      .setMesh(baseMesh)
      .setTranslation([0, part.id === 'site' ? -baseSize / 2 : baseSize / 2, 0]);
    scene.addChild(baseNode);

    // このpartに属する Object ID を、名前付きノードとして配置（Selection/Property用）。
    const ids = idsByPart.get(part.id) ?? [];
    ids.forEach((id, j) => {
      const objSize = 700;
      const mesh = makeBoxMesh(doc, buffer, objSize, color.map((c) => Math.min(1, c + 0.12)), id);
      const node = doc
        .createNode(id) // ← ノード名 = Object ID（rhino-conventions / Selection.resolveObjectId が参照）
        .setMesh(mesh)
        .setTranslation([1200 + (j % 2) * 1000, objSize / 2 + 200, (j - (ids.length - 1) / 2) * 1200]);
      scene.addChild(node);
    });

    const outPath = join(projectDir, part.file);
    await io.write(outPath, doc);
    written.push(`${part.file} (shell + ${ids.length} named object(s): ${ids.join(', ') || '—'})`);
  }

  console.log(`demo GLB generated in ${projectDir}:`);
  for (const w of written) console.log('  -', w);
  console.log('\n注意: これらは開発専用のプレースホルダで .gitignore 済み（コミットしない）。');
  console.log('確認: npm run validate → Broken Path 警告が消える / npm run dev → Viewerで箱が表示・選択可能。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
