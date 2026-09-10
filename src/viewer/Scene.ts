import * as THREE from 'three';

/**
 * Three.jsのシーン・レンダラ・ライト・レンダループを管理する。
 * 責務: 描画基盤の生成と毎フレーム更新。モデルの中身やUIは知らない。
 * 参照: docs/viewer-design.md §2
 *
 * 断面（Clipping）は Clipping.ts が登録済みマテリアルの clippingPlanes を
 * 直接書き換えるだけで実現する（renderer.localClippingEnabled=true、以下で設定）。
 * 過去に断面キャップ（切断面を塗りつぶす近似平面）を追加したことがあったが、
 * モデル境界サイズの単色平面をそのままキャップとして描画する実装だったため、
 * 実際の断面形状（中空/非中空の区別）を反映できず、壁の内側等の空洞部分まで
 * 塗りつぶして中が見えなくなる問題があった。正しい断面キャップにはステンシル
 * バッファ等を用いた実ジオメトリ形状のキャップ描画が必要で、単純な単色平面では
 * 実現できないため撤去し、素のクリッピング（中空部分は見えたまま）に戻した。
 */
export class Scene {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private onUpdate: ((dt: number) => void) | null = null;
  private running = false;

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
}
