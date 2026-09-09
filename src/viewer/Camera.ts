import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * カメラ管理: Perspective/Orthographic切替、標準ビュー(Top/Front/Side)、Fit。
 * OrbitControls(Orbit/Pan/Zoom)を内包する。
 * 参照: docs/viewer-design.md §4 操作系 / §5 MVP View
 */
export type StandardView = 'top' | 'front' | 'side' | 'perspective';

export class Camera {
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
  active: THREE.Camera;
  controls: OrbitControls;
  private aspect: number;

  constructor(private domElement: HTMLElement, aspect = 1) {
    this.aspect = aspect;
    this.perspective = new THREE.PerspectiveCamera(50, aspect, 1, 1_000_000);
    this.perspective.position.set(1000, 1000, 1000);

    const d = 1000;
    this.orthographic = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, -1_000_000, 1_000_000);
    this.orthographic.position.copy(this.perspective.position);

    this.active = this.perspective;
    this.controls = new OrbitControls(this.active, this.domElement);
    this.controls.enableDamping = true;
  }

  update(): void {
    this.controls.update();
  }

  /** Perspective / Orthographic 切替（MVP） */
  setProjection(mode: 'perspective' | 'orthographic'): void {
    const next = mode === 'perspective' ? this.perspective : this.orthographic;
    next.position.copy(this.active.position);
    this.active = next;
    this.controls.object = next;
    this.controls.update();
  }

  /** 標準ビュー（Top/Front/Side/Perspective）: 対象境界に合わせて配置 */
  applyStandardView(view: StandardView, target: THREE.Box3): void {
    const center = target.getCenter(new THREE.Vector3());
    const sizeVec = target.getSize(new THREE.Vector3());
    const radius = sizeVec.length() || 1000;
    const dist = radius * 1.5;
    const pos: Record<StandardView, THREE.Vector3> = {
      top: new THREE.Vector3(center.x, center.y + dist, center.z + 0.0001),
      front: new THREE.Vector3(center.x, center.y, center.z + dist),
      side: new THREE.Vector3(center.x + dist, center.y, center.z),
      perspective: new THREE.Vector3(center.x + dist, center.y + dist, center.z + dist),
    };
    // Orthographic のときは境界に合わせてフラスタム（表示範囲）をフィットさせる。
    if (this.active === this.orthographic) {
      const halfH = ((Math.max(sizeVec.x, sizeVec.y, sizeVec.z) || 1000) * 0.75);
      this.orthographic.top = halfH;
      this.orthographic.bottom = -halfH;
      this.orthographic.left = -halfH * this.aspect;
      this.orthographic.right = halfH * this.aspect;
      this.orthographic.updateProjectionMatrix();
    }
    this.active.position.copy(pos[view]);
    this.controls.target.copy(center);
    this.controls.update();
  }

  /** Fit: 選択/モデル境界にカメラを合わせる（F キー / MVP） */
  fit(box: THREE.Box3): void {
    this.applyStandardView('perspective', box);
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const d = this.orthographic.top;
    this.orthographic.left = -d * aspect;
    this.orthographic.right = d * aspect;
    this.orthographic.updateProjectionMatrix();
  }
}
