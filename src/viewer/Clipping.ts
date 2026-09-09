import * as THREE from 'three';

/**
 * ClippingPlaneによる断面表示の基盤。
 * MVP(Phase 1)ではスケルトンのみ。Phase 4のSection機能で本格実装する。
 * renderer.localClippingEnabled = true（Scene側で有効化済み）が前提。
 * 参照: docs/viewer-design.md §5 Phase 2以降 / docs/roadmap.md Phase 4
 */
export class Clipping {
  readonly plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private enabled = false;

  /** 対象マテリアルにclippingPlanesを適用/解除する */
  setEnabled(enabled: boolean, materials: THREE.Material[]): void {
    this.enabled = enabled;
    for (const m of materials) {
      m.clippingPlanes = enabled ? [this.plane] : [];
      m.clipShadows = enabled;
      m.needsUpdate = true;
    }
  }

  /** 平面の法線と原点からの距離を設定（Phase 4でUIから制御） */
  setPlane(normal: THREE.Vector3, constant: number): void {
    this.plane.normal.copy(normal).normalize();
    this.plane.constant = constant;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
