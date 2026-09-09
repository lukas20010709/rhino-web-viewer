import * as THREE from 'three';

export type ClipAxis = 'x' | 'y' | 'z';

export interface AxisState {
  enabled: boolean;
  flipped: boolean;
  value: number;
}

const AXIS_UNIT: Record<ClipAxis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * Rhino の Clipping Plane に相当する、XYZ軸ごとに独立ON/OFFできる断面表示。
 * 各軸は「位置(スライダー)」と「反転(切断する側)」を持ち、有効な軸は同時に
 * 掛け合わされる（RhinoでSectionを複数重ねる場合と同じAND的挙動）。
 * renderer.localClippingEnabled = true（Scene側で有効化済み）が前提。
 * 参照: docs/viewer-design.md §5 Phase 2以降 / docs/roadmap.md Phase 4
 */
export class Clipping {
  private state: Record<ClipAxis, AxisState> = {
    x: { enabled: false, flipped: false, value: 0 },
    y: { enabled: false, flipped: false, value: 0 },
    z: { enabled: false, flipped: false, value: 0 },
  };
  private materials = new Set<THREE.Material>();

  /** モデル境界の中心をスライダー初期値にする */
  init(bounds: THREE.Box3): void {
    const center = bounds.getCenter(new THREE.Vector3());
    (Object.keys(this.state) as ClipAxis[]).forEach((axis) => {
      this.state[axis].value = center[axis];
    });
  }

  /** クリッピング対象のマテリアルを登録する（part読み込み時に一度呼ぶ） */
  registerMaterials(materials: THREE.Material[]): void {
    for (const m of materials) this.materials.add(m);
    this.apply();
  }

  setAxisEnabled(axis: ClipAxis, enabled: boolean): void {
    this.state[axis].enabled = enabled;
    this.apply();
  }

  setAxisValue(axis: ClipAxis, value: number): void {
    this.state[axis].value = value;
    this.apply();
  }

  toggleFlip(axis: ClipAxis): void {
    this.state[axis].flipped = !this.state[axis].flipped;
    this.apply();
  }

  getState(axis: ClipAxis): Readonly<AxisState> {
    return this.state[axis];
  }

  disableAll(): void {
    (Object.keys(this.state) as ClipAxis[]).forEach((axis) => {
      this.state[axis].enabled = false;
    });
    this.apply();
  }

  private activePlanes(): THREE.Plane[] {
    const planes: THREE.Plane[] = [];
    (Object.keys(this.state) as ClipAxis[]).forEach((axis) => {
      const s = this.state[axis];
      if (!s.enabled) return;
      const dir = s.flipped ? -1 : 1;
      const normal = AXIS_UNIT[axis].clone().multiplyScalar(dir);
      // 平面: normal・point + constant = 0。normal側(dir*value以上)が残る側。
      planes.push(new THREE.Plane(normal, -dir * s.value));
    });
    return planes;
  }

  private apply(): void {
    const planes = this.activePlanes();
    // 契約: 登録済みマテリアルには常に（0枚でも）同一参照のclippingPlanes配列を設定する。
    // Scene.ts の断面キャップ同期（Clipping Cap）はこの参照の変化を手がかりに再構築するため、
    // 各マテリアルへ個別配列を割り当てたり未設定のままにしたりしないこと。
    for (const m of this.materials) {
      m.clippingPlanes = planes;
      m.clipShadows = planes.length > 0;
      m.needsUpdate = true;
    }
  }
}
