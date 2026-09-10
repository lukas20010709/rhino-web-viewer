import * as THREE from 'three';
import { ProjectLoader } from './data/ProjectLoader';
import { Scene } from './viewer/Scene';
import { Camera, type StandardView } from './viewer/Camera';
import { ModelLoader } from './viewer/ModelLoader';
import { Selection } from './viewer/Selection';
import { Layers } from './viewer/Layers';
import { Clipping } from './viewer/Clipping';
import { ModelTree } from './ui/ModelTree';
import { PropertyPanel } from './ui/PropertyPanel';
import { ClippingPanel } from './ui/ClippingPanel';
import { ScaleBar } from './ui/ScaleBar';
import { applyViewState, serializeViewState } from './viewer/ViewState';

/**
 * シーン内の全メッシュ・輪郭線からマテリアルを重複なく収集する（Clipping適用対象）。
 * ModelLoader が付与する輪郭線（THREE.LineSegments、EdgesGeometry）は THREE.Mesh
 * ではないため、Mesh only の走査では登録漏れし、断面(Clipping)を有効にしても
 * 輪郭線だけモデル全体の形状のまま透けて残ってしまう。LineSegments も対象に含める。
 */
function collectMaterials(roots: Iterable<THREE.Object3D>): THREE.Material[] {
  const set = new Set<THREE.Material>();
  for (const root of roots) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        const mat = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => set.add(m));
        else set.add(mat);
      }
    });
  }
  return [...set];
}

// main() の各 await 完了前は画面がキャンバス背景のみになるため、読み込み中である
// ことを示すインジケーターを表示する。main().catch() からも消去できるよう
// モジュールスコープで参照を保持する。
let loadingEl: HTMLElement | null = null;

function showLoading(): void {
  const panel = document.createElement('aside');
  panel.className = 'panel';
  panel.setAttribute('aria-label', '読み込み中');
  panel.style.cssText =
    'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); max-width:360px; text-align:center;';

  const text = document.createElement('p');
  text.textContent = '読み込み中…';

  panel.appendChild(text);
  document.body.appendChild(panel);
  loadingEl = panel;
}

function hideLoading(): void {
  loadingEl?.remove();
  loadingEl = null;
}

/**
 * 起動エントリ。各モジュールを結線し、URLパラメータを解釈する。
 * 参照: docs/viewer-design.md §2/§3/§4/§7
 *
 * Phase 1 MVP UI を組み上げる:
 *   - Model Tree（左上）  : part の表示ON/OFF
 *   - Property Panel（右上）: 選択オブジェクトの Object ID / metadata 属性
 *   - Clipping Panel（左下）: XYZ軸ごとの断面(Clipping Plane) ON/OFF・位置・反転
 *   - Toolbar（下）      : 標準ビュー / Perspective↔Orthographic / Fit / Reset
 *   - キーボード         : Esc（選択解除）/ F（Fit）/ H（Hide）/ I（Isolate）/ R（Reset）
 *
 * URL例:
 *   ?project=project-a          対象プロジェクト（既定 project-a）
 *   ?mode=3dm                   Debug/Internalの3DM直読（章37, 未実装フック）
 *   将来: ?camera=&layer=&object=（Phase 5 Camera URL Sharing）
 */
async function main(): Promise<void> {
  showLoading();

  const canvas = document.getElementById('viewer') as HTMLCanvasElement;
  const treeEl = document.getElementById('tree') as HTMLElement;
  const propsEl = document.getElementById('props') as HTMLElement;
  const clipEl = document.getElementById('clip') as HTMLElement;
  const toolbarEl = document.getElementById('toolbar') as HTMLElement;
  const scalebarEl = document.getElementById('scalebar') as HTMLElement;

  const params = new URLSearchParams(location.search);
  const project = params.get('project') ?? 'project-a';
  const mode = params.get('mode'); // 'gltf'(既定) | '3dm'(debug)

  if (mode === '3dm') {
    // Debug/Internal: rhino3dm による3DM直読はここにフックする（通常配信はGLB）。
    console.warn('[viewer] 3dm direct mode is Debug/Internal only. Not implemented in MVP.');
  }

  const scene = new Scene(canvas);
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new Camera(canvas, aspect);
  camera.setAspect(aspect);

  const loader = new ProjectLoader();
  const data = await loader.load(`${import.meta.env.BASE_URL}projects/${project}/`);

  const modelLoader = new ModelLoader(scene.renderer);
  const bounds = await modelLoader.loadAll(data, scene.scene);
  hideLoading();

  const layers = new Layers(modelLoader.partRoots);
  // アクティブカメラをプロバイダで渡し、投影切替後もレイキャストが描画中の
  // カメラと一致するようにする（固定参照だとOrtho切替後に選択が誤ヒットする）。
  const selection = new Selection(() => camera.active, scene.scene, data.metadata);
  const clipping = new Clipping();
  // 断面位置の初期値は「建築(architecture)」パートの中心を優先する。
  // モデル全体(bounds)には敷地(site)・外構(landscape)等、建物より大きく広がりがちな
  // パートが含まれるため、全体の中心で初期化すると、敷地・外構を含む広い範囲の中心が
  // 実際の建物の外形とずれる場合がある（実クリッピング自体は常に正しく機能する。
  // 見た目上「何も切れていないように見える」原因は、対称な形状をちょうど中心で
  // 切ると既定のアイソメ視点からは差が分かりにくいこと、または敷地が建物より広い
  // ケースで既定位置が建物の端付近に来てしまうことの複合。断面位置を建築パートの
  // 中心に寄せておくことで、後者のケースを避け、建物側を基準にした初期表示にする）。
  // スライダーの可動範囲自体は引き続きモデル全体(bounds)を使う（敷地側もドラッグで切断可能）。
  const architectureRoot = modelLoader.partRoots.get('architecture');
  const initBounds = architectureRoot ? new THREE.Box3().setFromObject(architectureRoot) : bounds;
  clipping.init(initBounds.isEmpty() ? bounds : initBounds);
  clipping.registerMaterials(collectMaterials(modelLoader.partRoots.values()));

  // --- UI 結線 --------------------------------------------------------------
  const tree = new ModelTree(treeEl, layers, data.metadata);
  tree.render();

  const props = new PropertyPanel(propsEl);
  props.show(null);

  const clipPanel = new ClippingPanel(clipEl, clipping, bounds);
  clipPanel.render();

  const scaleBar = new ScaleBar(scalebarEl);

  // 現在の標準ビュー。投影切替時に同じ構図で再フィットするため保持する。
  let currentView: StandardView = 'perspective';
  let projection: 'perspective' | 'orthographic' = 'perspective';

  // 平行投影のときだけスケールバーを表示・更新する（透視投影では非表示）。
  const updateScaleBar = (): void => {
    if (projection !== 'orthographic') {
      scaleBar.hide();
      return;
    }
    scaleBar.show();
    scaleBar.render(camera, canvas.clientWidth);
  };

  const setView = (view: StandardView): void => {
    currentView = view;
    camera.applyStandardView(view, bounds);
  };

  const resetAll = (): void => {
    selection.reset();
    layers.showAll();
    tree.render();
    props.show(null);
    clipping.disableAll();
    clipPanel.render();
  };

  // URLに ?view=... があれば復元し、既定のフィット(camera.applyStandardView)は
  // 復元が無い場合のみ実行する（復元後に既定構図で上書きされないようにする）。
  const restored = applyViewState(params, camera, clipping, layers, bounds);
  if (restored) {
    currentView = restored.view;
    projection = restored.projection;
  } else {
    camera.applyStandardView(currentView, bounds);
  }
  tree.render();
  clipPanel.render();
  updateScaleBar();

  // --- Toolbar --------------------------------------------------------------
  const addButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    toolbarEl.appendChild(btn);
    return btn;
  };

  addButton('全体表示', () => setView('perspective'));
  addButton('上面', () => setView('top'));
  addButton('正面', () => setView('front'));
  addButton('側面', () => setView('side'));

  const projBtn = addButton('平行投影', () => {
    projection = projection === 'perspective' ? 'orthographic' : 'perspective';
    camera.setProjection(projection);
    camera.applyStandardView(currentView, bounds); // 新カメラで同じ構図に再フィット
    projBtn.textContent = projection === 'perspective' ? '平行投影' : '透視投影';
    projBtn.setAttribute('aria-pressed', String(projection === 'orthographic'));
    updateScaleBar();
  });
  projBtn.textContent = projection === 'perspective' ? '平行投影' : '透視投影';
  projBtn.setAttribute('aria-pressed', String(projection === 'orthographic'));

  addButton('リセット', resetAll);

  const copyUrlBtn = addButton('URLをコピー', () => {
    if (!navigator.clipboard) {
      console.error('[viewer] clipboard API unavailable (requires HTTPS or localhost)');
      copyUrlBtn.textContent = 'コピー不可';
      setTimeout(() => {
        copyUrlBtn.textContent = 'URLをコピー';
      }, 1500);
      return;
    }

    const stateParams = serializeViewState(camera, clipping, layers, currentView, projection);
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('project', project);
    for (const [key, value] of stateParams) url.searchParams.set(key, value);

    navigator.clipboard.writeText(url.toString())
      .then(() => {
        const original = copyUrlBtn.textContent;
        copyUrlBtn.textContent = 'コピーしました';
        setTimeout(() => {
          copyUrlBtn.textContent = original;
        }, 1500);
      })
      .catch((err) => {
        console.error('[viewer] clipboard write failed:', err);
      });
  });

  // --- 選択（Click）→ Property Panel ---------------------------------------
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = selection.pick(e.clientX, e.clientY, rect);
    props.show(hit);
  });

  // --- キーボード（Esc/F/H/I/R）: MVP操作系（docs/viewer-design.md §4） ------
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'Escape':
        selection.deselect();
        props.show(null);
        break;
      case 'f': case 'F':
        setView('perspective');
        break;
      case 'h': case 'H':
        if (selection.current) selection.hide(selection.current.object);
        break;
      case 'i': case 'I':
        if (selection.current) selection.isolate(selection.current.object);
        break;
      case 'r': case 'R':
        resetAll();
        break;
    }
  });

  // ウィンドウリサイズでカメラのアスペクト比を追従（描画バッファはScene側で更新）。
  window.addEventListener('resize', () => {
    camera.setAspect(window.innerWidth / window.innerHeight);
    updateScaleBar();
  });

  // アクティブカメラをプロバイダで渡し、投影切替を毎フレーム反映させる。
  // スケールバーはOrbitControlsのズーム(orthographic.zoom)に追従させるため、
  // 平行投影時は毎フレーム再計算する。
  scene.start(() => camera.active, () => {
    camera.update();
    updateScaleBar();
  });
  console.log(`[viewer] loaded ${project} rev=${data.manifest.revision}`);
}

main().catch((err) => {
  console.error('[viewer] fatal:', err);

  hideLoading();

  const message = err instanceof Error ? err.message : String(err);

  // 既存の .panel クラス（index.html のスタイルシート）を流用し、
  // アプリの見た目と統一したエラー表示にする。id/DOM構造には依存しない。
  const panel = document.createElement('aside');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'エラー');
  panel.style.cssText =
    'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); max-width:360px; text-align:center;';

  const heading = document.createElement('h2');
  heading.textContent = 'モデルの読み込みに失敗しました';

  const detail = document.createElement('p');
  detail.textContent = message;

  panel.appendChild(heading);
  panel.appendChild(detail);
  document.body.appendChild(panel);
});
