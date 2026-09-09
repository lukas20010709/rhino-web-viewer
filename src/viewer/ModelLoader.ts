import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { ProjectData, ManifestPart } from '../data/types';

/**
 * manifestに従いGLBを段階ロードし、シーンへ配置する。
 * - Meshopt / KTX2 / Draco デコーダを構成（docs/export-pipeline.md の圧縮方針に対応）
 * - origin.json は「巨大座標を渡さない」方針のため、GLBは(0,0,0)基準。worldOriginは世界座標復元にのみ使用。
 * 参照: docs/viewer-design.md §2 / docs/data-schema.md §3
 */
export class ModelLoader {
  private loader: GLTFLoader;
  /** part.id → 読み込んだルートオブジェクト（Layers/Selectionが参照） */
  readonly partRoots = new Map<string, THREE.Object3D>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    // デコーダは public/decoders/ に配置し、BASE_URL 起点で解決する。
    // 絶対パス '/decoders/...' はダメ: GitHub Pages の project page（/<repo>/ 配下配信）で
    // ドメイン直下を指してしまい KTX2/Draco が 404 になる。
    // scripts/copy-decoders.mjs が three 同梱デコーダを public/decoders/ へ複製する。
    const base = import.meta.env.BASE_URL; // 末尾スラッシュ保証（vite仕様）

    const ktx2 = new KTX2Loader().setTranscoderPath(`${base}decoders/basis/`).detectSupport(renderer);
    this.loader.setKTX2Loader(ktx2);

    const draco = new DRACOLoader().setDecoderPath(`${base}decoders/draco/`);
    this.loader.setDRACOLoader(draco);
  }

  /**
   * loadPriority昇順で段階ロードし、各partをsceneへ追加する。
   * onPart で1part完了ごとに通知（先読みpartを即描画するため）。
   */
  async loadAll(
    data: ProjectData,
    scene: THREE.Scene,
    onPart?: (part: ManifestPart, root: THREE.Object3D) => void,
  ): Promise<THREE.Box3> {
    const parts = [...data.manifest.parts].sort((a, b) => a.loadPriority - b.loadPriority);
    const overall = new THREE.Box3();

    for (const part of parts) {
      const url = data.baseUrl + part.file;
      const gltf = await this.loader.loadAsync(url);
      const root = gltf.scene;
      root.name = part.id;
      root.visible = part.defaultVisible ?? true;
      // ノード名 = Object ID。Selection/metadata引き当てに使う（rhino-conventions.md）。
      scene.add(root);
      this.partRoots.set(part.id, root);

      overall.expandByObject(root);
      onPart?.(part, root);
    }
    return overall;
  }
}
