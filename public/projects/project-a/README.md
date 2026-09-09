# project-a サンプルデータ

このフォルダは1プロジェクト1リビジョンのデータ単位です。

| ファイル | 状態 | 説明 |
|---|---|---|
| `manifest.json` | 同梱 | 入口。parts(分割GLB)とmetadata/originを宣言 |
| `metadata.json` | 同梱 | Object ID → 属性 |
| `origin.json` | 同梱 | Local Origin ↔ 世界座標 |
| `site.glb` / `structure.glb` / `architecture.glb` / `furniture.glb` | **未同梱** | 原本RhinoからExport&最適化して配置 |
| `thumbnail.webp` | 未同梱 | サムネイル |

GLBは `../../../rhino-source-tools/` の `export_web.py` / `publish-model.ps1` で生成します。
配置後、`npm run validate` の Broken Path 警告が解消され、Viewerで表示できます。

## ローカル開発でのデモ表示

原本Rhinoが無くても、リポジトリ直下(`rhino-web-viewer/`)で以下を実行すると、
manifest.parts に対応する簡易GLB（色付きの箱・metadataのObject IDをノード名に付与）を生成します。

```bash
npm run demo:glb
```

生成される `*.glb` は **`.gitignore` 済み（コミットしない）** の開発専用プレースホルダです。
`npm run dev` で Model Tree / 選択 / Property Panel の動作確認に使えます。
