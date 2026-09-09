#!/usr/bin/env node
/**
 * bootstrap-github.mjs — Public Repo(rhino-web-viewer) を GitHub Pages で公開するまでを 1 コマンドで自動化。
 *
 * 依頼元 PDF 章24/25（git push → GitHub Actions → Pages）の「実 GitHub 操作」を、
 * 手作業ではなく決定論的スクリプトに落としたもの。DESIGN §0/§12 のスコープ外だった
 * 「実リポジトリ作成・push・Pages 有効化」を、利用可能な環境で 1 コマンドに圧縮する。
 *
 * 実行される副作用（不可逆・アカウントに影響）:
 *   1. カレント(rhino-web-viewer)を git init し main へ初回コミット
 *   2. gh repo create <owner>/<name> --<public|private> を作成し push
 *   3. Pages のビルドソースを「GitHub Actions」に設定（deploy.yml が発火）
 *
 * 前提: gh(認証済) と git が PATH にあること。`gh auth status` で確認。
 *
 * 使い方:
 *   node scripts/bootstrap-github.mjs <repo-name> [--private] [--owner <org>] [--dry-run] [--yes]
 * 例:
 *   node scripts/bootstrap-github.mjs rhino-web-viewer            # 何をするか表示（--dry-run 相当の確認）
 *   node scripts/bootstrap-github.mjs rhino-web-viewer --yes      # 実際に作成・push・Pages有効化
 *
 * 安全既定: --yes を付けない限り「計画の表示のみ」で副作用を起こさない。
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..'); // rhino-web-viewer/

// ---- 引数パース ---------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const getOpt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};

const repoName = positional[0];
const visibility = flags.has('--private') ? 'private' : 'public';
const ownerOverride = getOpt('--owner', null);
const apply = flags.has('--yes') && !flags.has('--dry-run');

function die(msg) {
  console.error(`\n[bootstrap-github] ERROR: ${msg}\n`);
  process.exit(1);
}
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}
function runInherit(cmd, args) {
  execFileSync(cmd, args, { cwd: repoRoot, stdio: 'inherit' });
}

if (!repoName) {
  die('リポジトリ名を指定してください。例: node scripts/bootstrap-github.mjs rhino-web-viewer --yes');
}
if (!/^[A-Za-z0-9._-]+$/.test(repoName)) {
  die(`リポジトリ名に使えない文字が含まれます: ${repoName}`);
}

// ---- 事前チェック -------------------------------------------------------
try {
  run('gh', ['--version']);
} catch {
  die('gh(GitHub CLI) が見つかりません。https://cli.github.com/ を導入してください。');
}
try {
  run('git', ['--version']);
} catch {
  die('git が見つかりません。');
}

let owner = ownerOverride;
let authUser = '(unknown)';
try {
  authUser = run('gh', ['api', 'user', '--jq', '.login']);
  if (!owner) owner = authUser;
} catch {
  die('gh が未認証です。`gh auth login` を実行してから再試行してください。');
}

const slug = `${owner}/${repoName}`;
const pagesUrl = `https://${owner}.github.io/${repoName}/`;

// deploy.yml が VITE_BASE=/<repo>/ を自動導出するので project page でも 404 にならない
console.log(`\n================ bootstrap-github 計画 ================`);
console.log(`  認証ユーザ      : ${authUser}`);
console.log(`  作成先 repo     : ${slug}`);
console.log(`  可視性          : ${visibility}`);
console.log(`  ローカルパス    : ${repoRoot}`);
console.log(`  想定 Pages URL  : ${pagesUrl}`);
console.log(`  実行モード      : ${apply ? '★ APPLY（実際に作成・push・Pages有効化）' : 'DRY-RUN（表示のみ。副作用なし）'}`);
console.log(`=======================================================\n`);

if (visibility === 'public') {
  console.log('⚠ public 指定です。公開対象は派生 Web ジオメトリ(glb/json/webp)のみに限定し、');
  console.log('  原本(.3dm/.gh)・NDA/未発表・個人情報を含めないこと（docs/security.md）。\n');
}

const steps = [
  ['git', ['init', '-b', 'main']],
  ['git', ['add', '-A']],
  ['git', ['commit', '-m', 'chore: initial import of rhino-web-viewer (design deliverable)']],
  ['gh', ['repo', 'create', slug, `--${visibility}`, '--source', '.', '--remote', 'origin', '--push']],
  // Pages のビルドソースを GitHub Actions に設定（deploy.yml を使う）
  ['gh', ['api', '--method', 'POST', `repos/${slug}/pages`, '-f', 'build_type=workflow', '--silent']],
];

console.log('実行される手順:');
steps.forEach(([c, a], i) => console.log(`  ${i + 1}. ${c} ${a.join(' ')}`));
console.log('');

if (!apply) {
  console.log('→ DRY-RUN のため何も実行しませんでした。実行するには末尾に --yes を付けてください:');
  console.log(`    node scripts/bootstrap-github.mjs ${repoName}${visibility === 'private' ? ' --private' : ''}${ownerOverride ? ' --owner ' + ownerOverride : ''} --yes\n`);
  process.exit(0);
}

// ---- 実行（--yes）------------------------------------------------------
if (existsSync(resolve(repoRoot, '.git'))) {
  die('.git が既に存在します。既存リポジトリでの初期化を避けるため中断しました。手動で確認してください。');
}

try {
  console.log('› git init/commit ...');
  runInherit('git', ['init', '-b', 'main']);
  runInherit('git', ['add', '-A']);
  runInherit('git', ['commit', '-m', 'chore: initial import of rhino-web-viewer (design deliverable)']);

  console.log('› gh repo create + push ...');
  runInherit('gh', ['repo', 'create', slug, `--${visibility}`, '--source', '.', '--remote', 'origin', '--push']);

  console.log('› Pages を GitHub Actions ソースで有効化 ...');
  try {
    runInherit('gh', ['api', '--method', 'POST', `repos/${slug}/pages`, '-f', 'build_type=workflow']);
  } catch {
    // 既に有効な場合などは PUT で更新を試みる
    console.log('  (POST が失敗。PUT で更新を試行)');
    runInherit('gh', ['api', '--method', 'PUT', `repos/${slug}/pages`, '-f', 'build_type=workflow']);
  }

  console.log('\n✅ 完了。GitHub Actions(deploy.yml) がビルド→Pages公開を実行します。');
  console.log(`   Actions   : https://github.com/${slug}/actions`);
  console.log(`   Pages URL : ${pagesUrl}`);
  console.log('   ※ 初回デプロイ完了まで数分。Actions が緑になってからアクセスしてください。\n');
} catch (e) {
  die(`実行中にエラー: ${e.message}\n途中まで作成された場合は GitHub 側の状態を確認してください（repo/Actions/Pages）。`);
}
