# rhino-web-viewer

Rhino由来のGLB+JSONを表示するThree.js製 Web 3D Viewer（Public Repo / GitHub Pages配信）。

> 本フォルダは設計成果物です。Phase 1 MVP の UI（Model Tree / Property Panel / Toolbar）は `main.ts` に結線済みで、`npm run demo:glb` で生成したプレースホルダGLBを使えば `npm run dev` でそのまま操作を確認できます。

## Phase 1 MVP 機能（結線済み）

- **Model Tree（左）**: part（site/structure/architecture/furniture…）の表示ON/OFF
- **Property Panel（右）**: 選択オブジェクトの Object ID と metadata 属性（layer/material/status…）
- **Toolbar（下）**: 標準ビュー（Fit/Top/Front/Side/Iso）、Perspective↔Orthographic 切替、Reset
- **選択**: クリックで Raycast 選択 → Property Panel に反映
- **キーボード**: `Esc`(選択解除) / `F`(Fit) / `H`(Hide) / `I`(Isolate) / `R`(Reset)

## 構成

```
rhino-web-viewer/
├─ index.html
├─ package.json / vite.config.ts / tsconfig.json
├─ schemas/                     データ契約 (manifest/metadata/origin)
├─ public/
│   ├─ projects/project-a/      サンプルデータ (manifest/metadata/origin.json)
│   │   └─ *.glb                ← 実機でRhinoからExport & 最適化して配置
│   └─ decoders/                ← meshopt/ktx2/draco デコーダ配置先(下記)
├─ src/
│   ├─ main.ts                  起動・結線・URLパラメータ
│   ├─ data/                    型(types.ts) + ProjectLoader
│   ├─ viewer/                  Scene/Camera/ModelLoader/Selection/Layers/Clipping
│   └─ ui/                      ModelTree / PropertyPanel
├─ scripts/                     validate-model.mjs / publish-model.mjs / bootstrap-github.mjs
├─ tests/
└─ .github/workflows/deploy.yml
```

## セットアップ（実機）

```bash
npm install
npm run demo:glb     # デモ用プレースホルダGLB生成（原本Rhino不要・ローカル開発専用/gitignore済）
npm run dev          # 開発サーバ (http://localhost:5173) → 箱モデルで UI/選択を確認可能
npm run typecheck    # 型チェック
npm run validate     # モデルデータ検証(JSON Schema + 相互参照 + 容量ゲート)
npm run build        # 本番ビルド (dist/)
```

### デモGLBについて（`npm run demo:glb`）
原本Rhinoが手元に無くても Viewer のパイプライン（manifest→分割GLBロード→Selection→Model Tree→Property Panel）を
end-to-end で動かせるよう、`scripts/make-demo-glb.mjs` が manifest.parts に対応する簡易GLB（色付きの箱）を生成します。
metadata の Object ID をノード名に付与するため、生成後は選択・プロパティ表示まで実際に機能します。
**生成物 `public/projects/project-a/*.glb` は `.gitignore` 済み**（「実ジオメトリはリポジトリに置かない」設計方針を維持）。
実プロジェクトでは `../rhino-source-tools/` が最適化済みGLBを生成・配置します。

### デコーダ配置（自動）
`ModelLoader` は圧縮GLB向けに以下を参照します。**手動配置は不要**——`scripts/copy-decoders.mjs` が
`three` 同梱の配布物を複製します（`npm run dev` / `npm run build` の `predev`/`prebuild` で自動実行、
単体では `npm run copy:decoders`）。
- `public/decoders/basis/`（KTX2 / basis transcoder）
- `public/decoders/draco/`（Draco decoder, glTF版）

参照パスは **`import.meta.env.BASE_URL` 起点**（例 `/<repo>/decoders/draco/`）。
GitHub Pages の project page 配信（`VITE_BASE=/<repo>/`）でも 404 にならないよう、絶対パス `/decoders/…` は使わない。
複製物 `public/decoders/` は **`.gitignore` 済み**（第三者バイナリは依存から生成し非コミット）。
Meshoptデコーダは `three/addons` から取得（バンドル同梱）のため追加配置は不要です。

## GitHub Pages への公開（1コマンド・章24/25）

実 GitHub リポジトリの作成→push→Pages 有効化を `scripts/bootstrap-github.mjs` に自動化。
`gh`(認証済) と `git` があれば 1 コマンドで公開できる。**既定は DRY-RUN（表示のみ・副作用なし）**、
実行は末尾に `--yes` を付けたときだけ。

```bash
# まず計画を確認（何も作成しない）
npm run bootstrap:github -- rhino-web-viewer
# 問題なければ実行（repo 作成・push・Pages を GitHub Actions ソースで有効化）
npm run bootstrap:github -- rhino-web-viewer --yes
#   --private を付けると非公開 repo、--owner <org> で作成先を上書き
```

実行後は `deploy.yml`（章24/25）が発火し、型/manifest/リンク/スモークを経て
`https://<owner>.github.io/rhino-web-viewer/` に配信される（`VITE_BASE=/<repo>/` はリポジトリ名から自動導出）。

> ⚠ public 公開時は **派生 Web ジオメトリ(glb/json/webp)のみ**を対象とし、原本(.3dm/.gh)・NDA/未発表・
> 個人情報を含めないこと（`docs/security.md` / `docs/repository-strategy.md` のセキュリティ境界）。

## サンプルデータについて

`public/projects/project-a/` には `manifest.json` / `metadata.json` / `origin.json` を同梱しています。
GLB本体（`site.glb` 等）は原本Rhinoから生成する成果物のため未同梱です。
`../rhino-source-tools/` の手順でExport→最適化して配置すると、Viewerが表示可能になります。

## URLパラメータ

- `?project=project-a` … 対象プロジェクト
- `?mode=3dm` … Debug/Internal専用の3DM直読フック（通常はGLB配信）
- 将来: `?camera=&layer=&object=`（Phase 5 Camera URL Sharing）

## 設計ドキュメント

全体設計は リポジトリ上位の `docs/` を参照（`viewer-design.md` / `data-schema.md` / `export-pipeline.md` / `quality-gates.md`）。
