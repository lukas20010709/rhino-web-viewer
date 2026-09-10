import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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

  /** 輪郭線（EdgesGeometry）のクリース角しきい値（度）。 */
  private static readonly EDGE_THRESHOLD_ANGLE = 20;
  /**
   * 頂点溶接（mergeVertices）の許容誤差。GLBの作業単位はglTF仕様上メートル固定
   * （origin.jsonのunit="mm"はworldOrigin復元専用で、メッシュ座標とは無関係）。
   * 1e-4 = 0.1mm相当。近接する別頂点を誤って溶接しない範囲で十分小さい値。
   */
  private static readonly WELD_TOLERANCE = 1e-4;
  private edgeMaterial: THREE.LineBasicMaterial;

  constructor(renderer: THREE.WebGLRenderer) {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    // part同士（例: 壁と床）が近い色でも境界が読み取れるよう、輪郭線を薄く重ねる。
    // 全メッシュで共有し、Selection等のRaycasterには反応させない（後述 raycast no-op）。
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.35,
      depthTest: true,
    });

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
      this.addSilhouetteEdges(root);

      overall.expandByObject(root);
      onPart?.(part, root);
    }
    return overall;
  }

  /**
   * 各メッシュへ輪郭/クリース線（EdgesGeometry）を子として追加する。
   * Selection.resolveObjectId は hitしたmeshからnode.parentを辿ってObject IDを
   * 解決するため、輪郭線自体がヒットしてしまうと親IDの解決を阻害しうる。
   * そのためLineSegments.raycastをno-opにして、Raycasterから常に除外する。
   *
   * 合わせて各メッシュのマテリアルを非金属寄りに補正する。RhinoのGLBエクスポートは
   * metallicFactor/roughnessFactorを明示しないためglTF既定値(metalness=1,
   * roughness=1)になり、環境マップ（未使用）がない本ビューアーでは面が
   * ほぼ黒く沈んで見える（正反射しか出ないため）。建築/什器/設備等はいずれも
   * 非金属の塗装面が実態に近いため、ここで一律補正する。
   *
   * また、EdgesGeometry算出前に頂点溶接（mergeVertices）を行う。glTFは法線/UVが
   * 隣接三角形間で異なる頂点をATTRIBUTE単位で分割するため（仕様上正しい挙動）、
   * 幾何的には閉じたBrep由来でも、隣接面が共有するはずの辺がPOSITION以外の属性差で
   * 別頂点として複製され、隣接関係（トポロジー）が失われる。ClipStencil.tsの
   * 断面キャップ技法はこの隣接関係（各辺がちょうど2枚の三角形に共有される状態＝
   * 多様体）を前提とするため、ここで位置一致の頂点を溶接し直して隣接関係を復元する。
   */
  private addSilhouetteEdges(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = node.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.metalness = 0;
        material.roughness = 0.9;
      }
      // mergeVerticesは新しいBufferGeometryを返す。EdgesGeometryや後続の
      // ClipStencil.registerMesh（main.tsでloadAll完了後に呼ばれる）が溶接後の
      // 形状を見るよう、EdgesGeometry算出前にnode.geometryを差し替える。
      // 本プロジェクトのメッシュはmaterialが常に単一（配列ではない）ため、
      // mergeVerticesがgroups（マルチマテリアル用）を扱う必要はない。
      node.geometry = mergeVertices(node.geometry, ModelLoader.WELD_TOLERANCE);
      const edgesGeometry = new THREE.EdgesGeometry(node.geometry, ModelLoader.EDGE_THRESHOLD_ANGLE);
      const edges = new THREE.LineSegments(edgesGeometry, this.edgeMaterial);
      edges.name = `${node.name}__edges`;
      edges.raycast = () => {}; // Selectionのraycastから除外（ピック不可）
      edges.matrixAutoUpdate = false;
      node.add(edges);
    });
  }
}
