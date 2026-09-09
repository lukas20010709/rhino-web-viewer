import { ProjectLoader } from './data/ProjectLoader';
import { Scene } from './viewer/Scene';
import { Camera, type StandardView } from './viewer/Camera';
import { ModelLoader } from './viewer/ModelLoader';
import { Selection } from './viewer/Selection';
import { Layers } from './viewer/Layers';
import { Clipping } from './viewer/Clipping';
import { ModelTree } from './ui/ModelTree';
import { PropertyPanel } from './ui/PropertyPanel';

/**
 * 起動エントリ。各モジュールを結線し、URLパラメータを解釈する。
 * 参照: docs/viewer-design.md §2/§3/§4/§7
 *
 * Phase 1 MVP UI を組み上げる:
 *   - Model Tree（左）  : part の表示ON/OFF
 *   - Property Panel（右）: 選択オブジェクトの Object ID / metadata 属性
 *   - Toolbar（下）      : 標準ビュー / Perspective↔Orthographic / Fit / Reset
 *   - キーボード         : Esc（選択解除）/ F（Fit）/ H（Hide）/ I（Isolate）/ R（Reset）
 *
 * URL例:
 *   ?project=project-a          対象プロジェクト（既定 project-a）
 *   ?mode=3dm                   Debug/Internalの3DM直読（章37, 未実装フック）
 *   将来: ?camera=&layer=&object=（Phase 5 Camera URL Sharing）
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('viewer') as HTMLCanvasElement;
  const treeEl = document.getElementById('tree') as HTMLElement;
  const propsEl = document.getElementById('props') as HTMLElement;
  const toolbarEl = document.getElementById('toolbar') as HTMLElement;

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

  const layers = new Layers(modelLoader.partRoots);
  // アクティブカメラをプロバイダで渡し、投影切替後もレイキャストが描画中の
  // カメラと一致するようにする（固定参照だとOrtho切替後に選択が誤ヒットする）。
  const selection = new Selection(() => camera.active, scene.scene, data.metadata);
  const clipping = new Clipping();
  void clipping; // Section基盤（Phase 4のUIで結線）。

  // --- UI 結線 --------------------------------------------------------------
  const tree = new ModelTree(treeEl, layers);
  tree.render();

  const props = new PropertyPanel(propsEl);
  props.show(null);

  // 現在の標準ビュー。投影切替時に同じ構図で再フィットするため保持する。
  let currentView: StandardView = 'perspective';
  let projection: 'perspective' | 'orthographic' = 'perspective';

  const setView = (view: StandardView): void => {
    currentView = view;
    camera.applyStandardView(view, bounds);
  };

  const resetAll = (): void => {
    selection.reset();
    layers.showAll();
    tree.render();
    props.show(null);
  };

  camera.applyStandardView(currentView, bounds);

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
  addButton('アイソメ', () => setView('perspective'));

  const projBtn = addButton('平行投影', () => {
    projection = projection === 'perspective' ? 'orthographic' : 'perspective';
    camera.setProjection(projection);
    camera.applyStandardView(currentView, bounds); // 新カメラで同じ構図に再フィット
    projBtn.textContent = projection === 'perspective' ? '平行投影' : '透視投影';
    projBtn.setAttribute('aria-pressed', String(projection === 'orthographic'));
  });
  projBtn.setAttribute('aria-pressed', 'false');

  addButton('リセット', resetAll);

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
        selection.current = null;
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
  });

  // アクティブカメラをプロバイダで渡し、投影切替を毎フレーム反映させる。
  scene.start(() => camera.active, () => camera.update());
  console.log(`[viewer] loaded ${project} rev=${data.manifest.revision}`);
}

main().catch((err) => {
  console.error('[viewer] fatal:', err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:red">${String(err)}</pre>`);
});
