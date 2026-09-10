import * as THREE from 'three';

const CLIP_CAP_COLOR = 0xaaaaaa;
const CLIP_CAP_POOL_SIZE = 3;

/**
 * Three.jsのシーン・レンダラ・ライト・レンダループを管理する。
 * 責務: 描画基盤の生成と毎フレーム更新。モデルの中身やUIは知らない。
 * 参照: docs/viewer-design.md §2
 *
 * 断面カット面のフィル表示（Clipping Cap）:
 * Clipping.ts はマテリアルの clippingPlanes を書き換えるだけで Scene を参照しない設計。
 * main.ts側の呼び出し方を変えずに連携するため、Scene側は
 * 「登録済みマテリアルは（0枚でも）常に clippingPlanes 配列を持つ」という
 * Clipping.apply() の契約を手がかりに、シーングラフから代表マテリアルを1つ見つけ、
 * その配列参照の変化を検知して断面を塗りつぶす平面メッシュを同期する。
 * 制約: 実ジオメトリのステンシル断面ではなく近似（モデル境界サイズの単色平面、
 * 他の有効平面でクリップ）のため、実際の断面形状より広い範囲が塗りつぶされ得る。
 */
export class Scene {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private onUpdate: ((dt: number) => void) | null = null;
  private running = false;

  private readonly clipCapGroup = new THREE.Group();
  private readonly clipCapGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly clipCapPool: THREE.Mesh[] = [];
  private clipCapMaterialProbe: THREE.Material | null = null;
  private clipPlanesRef: THREE.Plane[] | null = null;
  private readonly clipCenter = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Clipping（Section基盤 / Phase 4）を有効化しておく。
    this.renderer.localClippingEnabled = true;

    this.scene.background = new THREE.Color(0xf2f3f5);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(1, 2, 1);
    this.scene.add(dir);

    this.clipCapGroup.name = '__clipCapGroup';
    for (let i = 0; i < CLIP_CAP_POOL_SIZE; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: CLIP_CAP_COLOR,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const mesh = new THREE.Mesh(this.clipCapGeometry, material);
      mesh.name = `__clipCap${i}`;
      mesh.visible = false;
      this.clipCapPool.push(mesh);
      this.clipCapGroup.add(mesh);
    }
    this.scene.add(this.clipCapGroup);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /**
   * カメラは呼び出し側(Camera)が保持し、レンダ時に渡す。
   * Perspective/Orthographic を実行中に切り替えられるよう、固定参照ではなく
   * 「アクティブカメラを返すプロバイダ関数」も受け付ける（毎フレーム解決）。
   */
  start(camera: THREE.Camera | (() => THREE.Camera), onUpdate?: (dt: number) => void): void {
    this.onUpdate = onUpdate ?? null;
    this.running = true;
    const getCamera = typeof camera === 'function' ? camera : () => camera;
    const loop = () => {
      if (!this.running) return;
      const dt = this.clock.getDelta();
      this.onUpdate?.(dt);
      this.syncClipCaps();
      this.renderer.render(this.scene, getCamera());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.renderer.domElement;
    // canvasはCSSでフルスクリーン。描画バッファをCSSサイズに合わせる。
    const w = clientWidth || window.innerWidth;
    const h = clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  /** 現在有効なclippingPlanes配列（参照）の変化を検知し、断面キャップを再同期する */
  private syncClipCaps(): void {
    if (!this.clipCapMaterialProbe) {
      this.clipCapMaterialProbe = this.findRegisteredMaterial();
      if (!this.clipCapMaterialProbe) return;
    }

    const planes = (this.clipCapMaterialProbe.clippingPlanes as THREE.Plane[] | null) ?? [];
    if (planes === this.clipPlanesRef) return;
    this.clipPlanesRef = planes;
    this.rebuildClipCaps(planes);
  }

  /** Clipping.registerMaterials()経由でclippingPlanesが設定済みの代表マテリアルを1つ探す */
  private findRegisteredMaterial(): THREE.Material | null {
    let found: THREE.Material | null = null;
    this.scene.traverse((obj) => {
      if (found || obj === this.clipCapGroup || this.clipCapGroup.children.includes(obj)) return;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material | THREE.Material[];
      const m = Array.isArray(material) ? material[0] : material;
      if (m && Array.isArray(m.clippingPlanes)) found = m;
    });
    return found;
  }

  /**
   * 現在「実際に描画されている」ジオメトリの境界を計算する。
   * THREE.Box3.setFromObject/expandByObject は visible フラグを見ないため、
   * 非表示のpart（家具・設備など defaultVisible:false や、ユーザーが隠したpart）を
   * 含めたまま境界を計算してしまい、断面キャップが不必要に巨大化する原因になっていた。
   * scene.traverseVisible は visible===false のサブツリーへ descend しないため、
   * 実際に見えている範囲だけを対象にできる。
   */
  private computeVisibleBounds(): THREE.Box3 {
    const bounds = new THREE.Box3();
    this.clipCapGroup.visible = false;
    this.scene.traverseVisible((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      bounds.expandByObject(mesh, false);
    });
    this.clipCapGroup.visible = true;
    return bounds;
  }

  private rebuildClipCaps(planes: THREE.Plane[]): void {
    if (planes.length === 0) {
      this.clipCapPool.forEach((mesh) => (mesh.visible = false));
      return;
    }

    // 現在表示中のジオメトリのみを対象に境界を再計算する（非表示パーツ・オブジェクトは除外）。
    // 呼び出しごとに再計算するのは、有効な断面平面の集合が変わるたびであり（毎フレームではない）、
    // 表示状態の変化にも追従できるようキャッシュしない。
    const bounds = this.computeVisibleBounds();
    if (bounds.isEmpty()) {
      this.clipCapPool.forEach((mesh) => (mesh.visible = false));
      return;
    }
    const size = bounds.getSize(new THREE.Vector3()).length();
    const planeSize = Math.max(size * 1.5, 1);
    this.clipCapPool.forEach((mesh) => mesh.scale.set(planeSize, planeSize, 1));
    this.clipCenter.copy(bounds.getCenter(new THREE.Vector3()));

    const up = new THREE.Vector3(0, 0, 1);
    const epsilon = this.clipCapPool[0].scale.x * 0.001;
    planes.forEach((plane, i) => {
      if (i >= this.clipCapPool.length) return;
      const mesh = this.clipCapPool[i];
      const normal = plane.normal.clone().normalize();
      mesh.quaternion.setFromUnitVectors(up, normal);

      const distance = plane.distanceToPoint(this.clipCenter);
      const point = this.clipCenter
        .clone()
        .sub(normal.clone().multiplyScalar(distance))
        .add(normal.clone().multiplyScalar(epsilon));
      mesh.position.copy(point);

      const others = planes.filter((_, j) => j !== i);
      (mesh.material as THREE.Material).clippingPlanes = others;
      mesh.visible = true;
    });

    for (let i = planes.length; i < this.clipCapPool.length; i++) {
      this.clipCapPool[i].visible = false;
    }
  }
}
