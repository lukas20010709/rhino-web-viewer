import * as THREE from 'three';

/**
 * 断面キャップをステンシルバッファで実装する。
 *
 * 過去にモデル境界サイズの単色平面（Scene.tsの旧clipCap）で近似していたが、
 * 実ジオメトリの断面形状（中空/非中空の区別）を反映できず、壁の内側など
 * 空洞部分まで塗りつぶして中が見えなくなる問題があった（TASK-010の既知の制約）。
 * 逆にキャップを完全に撤去すると、今度は実体のある部分（壁・床・屋根等）を
 * 切っても向こう側が透過して見えてしまい、断面らしく見えない。
 *
 * 標準的な解決策は「裏面通過でステンシル+1、表面通過でステンシル-1」を
 * 断面平面ごとに描画し、ステンシル値が0でない箇所だけ埋め面（キャップ）を
 * 描く手法（three.js公式サンプル webgl_clipping_stencil と同じ原理）。
 * ここではメッシュごと・軸ごとに独立したグループを持たせ、キャップの色は
 * そのメッシュ自身のマテリアル色を流用する（カテゴリ別の色分けがそのまま
 * 断面にも引き継がれる）。ステンシル値は「書き込み→キャップで消費して0に
 * 戻す」設計のため、メッシュ間で明示的なクリアをせずに共存できる。
 * 凸形状（本ビューアーの壁/床/屋根等の単純な箱形状）を前提とした実装。
 */

interface AxisSlot {
  maskBack: THREE.Mesh;
  maskFront: THREE.Mesh;
  maskBackMaterial: THREE.MeshBasicMaterial;
  maskFrontMaterial: THREE.MeshBasicMaterial;
  cap: THREE.Mesh;
  capMaterial: THREE.MeshStandardMaterial;
}

interface Entry {
  mesh: THREE.Mesh;
  slots: AxisSlot[];
}

const MAX_SIMULTANEOUS_PLANES = 3;

export class ClipStencil {
  private readonly container = new THREE.Group();
  private readonly entries: Entry[] = [];
  private readonly capGeometry = new THREE.PlaneGeometry(1, 1);
  private nextRenderOrder = 1000;
  private nextStencilRef = 1;

  constructor(scene: THREE.Scene) {
    this.container.name = '__clipStencil';
    scene.add(this.container);
  }

  /** モデルロード後、断面キャップの対象にしたい実メッシュをすべて登録する。 */
  registerMesh(mesh: THREE.Mesh): void {
    const material = mesh.material;
    if (Array.isArray(material) || !material || !mesh.geometry) return;

    const capColor = (material as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xcccccc);
    mesh.updateWorldMatrix(true, false);

    const slots: AxisSlot[] = [];
    for (let i = 0; i < MAX_SIMULTANEOUS_PLANES; i++) {
      const stencilRef = this.nextStencilRef++;
      const renderOrder = this.nextRenderOrder++;

      const maskBackMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        side: THREE.BackSide,
        stencilWrite: true,
        stencilRef,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: THREE.IncrementWrapStencilOp,
        stencilZFail: THREE.IncrementWrapStencilOp,
        stencilZPass: THREE.IncrementWrapStencilOp,
      });
      const maskFrontMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        side: THREE.FrontSide,
        stencilWrite: true,
        stencilRef,
        stencilFunc: THREE.AlwaysStencilFunc,
        stencilFail: THREE.DecrementWrapStencilOp,
        stencilZFail: THREE.DecrementWrapStencilOp,
        stencilZPass: THREE.DecrementWrapStencilOp,
      });

      const maskBack = new THREE.Mesh(mesh.geometry, maskBackMaterial);
      const maskFront = new THREE.Mesh(mesh.geometry, maskFrontMaterial);
      maskBack.renderOrder = renderOrder;
      maskFront.renderOrder = renderOrder;
      maskBack.visible = false;
      maskFront.visible = false;
      maskBack.matrixAutoUpdate = false;
      maskFront.matrixAutoUpdate = false;
      maskBack.matrix.copy(mesh.matrixWorld);
      maskFront.matrix.copy(mesh.matrixWorld);

      // キャップはメッシュ自身のマテリアル色を引き継ぐ。ステンシルが「一致した
      // ピクセルだけ描画し、直後にその値を0へ戻す」ため、他メッシュのグループと
      // 明示的なバッファクリアなしで共存できる（描画順はrenderOrderで保証）。
      const capMaterial = new THREE.MeshStandardMaterial({
        color: capColor,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        stencilWrite: true,
        stencilRef,
        stencilFunc: THREE.EqualStencilFunc,
        stencilFail: THREE.ZeroStencilOp,
        stencilZFail: THREE.ZeroStencilOp,
        stencilZPass: THREE.ZeroStencilOp,
      });
      const cap = new THREE.Mesh(this.capGeometry, capMaterial);
      cap.renderOrder = renderOrder + 0.1;
      cap.visible = false;

      this.container.add(maskBack, maskFront, cap);
      slots.push({ maskBack, maskFront, maskBackMaterial, maskFrontMaterial, cap, capMaterial });
    }

    this.entries.push({ mesh, slots });
  }

  /** 有効な断面平面（Clipping.activePlanes()と同じ配列、最大3=X/Y/Z）に応じて再同期する。 */
  update(planes: THREE.Plane[]): void {
    for (const entry of this.entries) {
      const geometry = entry.mesh.geometry;
      geometry.computeBoundingSphere();
      const sphere = geometry.boundingSphere;

      entry.slots.forEach((slot, i) => {
        const plane = planes[i];
        if (!plane || !sphere) {
          slot.maskBack.visible = false;
          slot.maskFront.visible = false;
          slot.cap.visible = false;
          return;
        }

        const others = planes.filter((_, j) => j !== i);
        slot.maskBackMaterial.clippingPlanes = [plane, ...others];
        slot.maskFrontMaterial.clippingPlanes = [plane, ...others];
        slot.capMaterial.clippingPlanes = others;

        const worldCenter = sphere.center.clone().applyMatrix4(entry.mesh.matrixWorld);
        const size = Math.max(sphere.radius * 2.5, 0.05);

        const up = new THREE.Vector3(0, 0, 1);
        const normal = plane.normal.clone().normalize();
        slot.cap.quaternion.setFromUnitVectors(up, normal);
        slot.cap.scale.set(size, size, 1);

        const distance = plane.distanceToPoint(worldCenter);
        const epsilon = size * 0.0015;
        slot.cap.position.copy(
          worldCenter
            .clone()
            .sub(normal.clone().multiplyScalar(distance))
            .add(normal.clone().multiplyScalar(epsilon)),
        );

        slot.maskBack.visible = true;
        slot.maskFront.visible = true;
        slot.cap.visible = true;
      });
    }
  }
}
