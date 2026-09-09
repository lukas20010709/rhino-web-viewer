#!/usr/bin/env node
/**
 * モデルデータ検証スクリプト（開発時 & CI）。
 * - JSON Schema (schemas/*.schema.json) で manifest/metadata/origin を検証
 * - 相互参照チェック: project/revision一致 / parts.file 実在 / Object ID重複 / レイヤー標準
 * - 容量ゲート集計（docs/quality-gates.md §3）
 *
 * 使い方: node scripts/validate-model.mjs public/projects/project-a
 * 参照: docs/data-schema.md §5 / docs/quality-gates.md
 */
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv from 'ajv';

const projectDir = resolve(process.argv[2] ?? 'public/projects/project-a');
const schemaDir = resolve('schemas');

const ALLOWED_LAYERS = new Set([
  '00_SITE','01_STRUCTURE','02_FLOOR','03_WALL','04_CEILING','05_OPENING',
  '06_FURNITURE','07_LIGHTING','08_EQUIPMENT','09_LANDSCAPE','90_REFERENCE','99_NON_EXPORT',
]);
const OBJECT_ID_RE = /^[A-Z][A-Z0-9_]*[0-9]{3}$/;

const errors = [];
const warnings = [];

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function validateSchema(ajv, schemaFile, dataFile, data) {
  const schema = await readJson(join(schemaDir, schemaFile));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    for (const e of validate.errors) errors.push(`[schema:${dataFile}] ${e.instancePath} ${e.message}`);
  }
}

async function main() {
  const ajv = new Ajv({ allErrors: true, strict: false });

  const manifest = await readJson(join(projectDir, 'manifest.json'));
  const metadata = await readJson(join(projectDir, manifest.metadata ?? 'metadata.json'));
  const origin = existsSync(join(projectDir, manifest.origin ?? 'origin.json'))
    ? await readJson(join(projectDir, manifest.origin ?? 'origin.json'))
    : null;

  await validateSchema(ajv, 'manifest.schema.json', 'manifest.json', manifest);
  await validateSchema(ajv, 'metadata.schema.json', 'metadata.json', metadata);
  if (origin) await validateSchema(ajv, 'origin.schema.json', 'origin.json', origin);

  // project / revision 一致
  if (manifest.project !== metadata.project) errors.push('project mismatch: manifest vs metadata');
  if (manifest.revision !== metadata.revision) errors.push('revision mismatch: manifest vs metadata');

  // parts.file 実在 & 容量集計
  let totalBytes = 0;
  for (const part of manifest.parts ?? []) {
    const f = join(projectDir, part.file);
    if (!existsSync(f)) {
      warnings.push(`[broken-path] part '${part.id}' file missing: ${part.file} (最適化GLB未生成の可能性)`);
    } else {
      totalBytes += (await stat(f)).size;
    }
  }

  // Object ID規約 & レイヤー標準 & 重複
  const seen = new Set();
  for (const [id, attr] of Object.entries(metadata.objects ?? {})) {
    if (!OBJECT_ID_RE.test(id)) errors.push(`[invalid-object-id] ${id}`);
    if (seen.has(id)) errors.push(`[duplicate-object-id] ${id}`);
    seen.add(id);
    if (attr.layer && !ALLOWED_LAYERS.has(attr.layer)) errors.push(`[invalid-layer] ${id}: ${attr.layer}`);
  }

  // 容量ゲート（>100MB は Split/Optimize required）
  const mb = totalBytes / (1024 * 1024);
  const gate = mb < 20 ? 'Excellent' : mb < 50 ? 'Good' : mb <= 100 ? 'Review' : 'Split/Optimize required';
  console.log(`GLB total: ${mb.toFixed(1)} MB → ${gate}`);
  if (mb > 100) errors.push(`[size-gate] total ${mb.toFixed(1)}MB > 100MB: split/optimize required`);

  for (const w of warnings) console.warn('WARN', w);
  if (errors.length) {
    for (const e of errors) console.error('ERROR', e);
    console.error(`\nvalidation FAILED: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log('validation OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
