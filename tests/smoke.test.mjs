/**
 * 最小スモークテスト（雛形）。
 * 実運用ではVitest等に置換。ここではサンプルデータがSchemaに適合することを確認する。
 * 実行: node tests/smoke.test.mjs
 */
import { execFileSync } from 'node:child_process';

try {
  execFileSync('node', ['scripts/validate-model.mjs', 'public/projects/project-a'], { stdio: 'inherit' });
  console.log('smoke: PASS');
} catch {
  console.error('smoke: FAIL');
  process.exit(1);
}
