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
 * 断面にも引き継がれる）。キャップは NotEqualStencilFunc(ref=0) で「0でない
 * 箇所」を描画し、直後に ZeroStencilOp で0へ戻す設計のため、メッシュ間で
 * 明示的なバッファクリアをせずに共存できる（描画順はrenderOrderで保証）。
 * 閉じたソリッド（水密メッシュ）であれば、増減の累積値は形状の凹凸に関わらず
 * カメラ視点ごとに「内側なら非0・外側なら0」になる（前面/背面の通過回数差は
 * 視点によって変わり得るが、0か非0かという符号は不変）。かつて各メッシュ×軸に
 * ユニークな大きな値を割り当ててEqualStencilFuncで一致判定していたが、実際に
 * 蓄積される値（多くの場合1）とは一致しないことがあり、一部メッシュでキャップが
 * 全く描画されない不具合があった（stencilRefは現在キャップの比較には使わない）。
 */

/**
 * 断面キャップのハッチングテクスチャ生成。
 * 建築断面図の慣習（45度斜線ハッチング）に倣い、部材色から地色と線色を導出する。
 * 同じ色のメッシュ間でCanvas生成を使い回すため色ごとにキャッシュし、
 * キャップごとに異なる繰り返し数（実寸スケールに揃えるため）だけを
 * clone()したTextureに個別設定する。
 */
const HATCH_CANVAS_SIZE = 64;
const HATCH_LINE_SPACING_PX = 8;
const HATCH_LINE_WIDTH_PX = 2;
/** ハッチ線1本あたりの実寸間隔(m)。キャップの大小に関わらず密度を揃える。 */
const HATCH_WORLD_SPACING = 0.25;
/** 1タイルに含まれるハッチ線の本数。repeat計算で実寸換算する際に必要。 */
const HATCH_LINES_PER_TILE = HATCH_CANVAS_SIZE / HATCH_LINE_SPACING_PX;

const hatchTextureCache = new Map<string, THREE.CanvasTexture>();

function getBaseHatchTexture(color: THREE.Color): THREE.CanvasTexture {
  const key = color.getHexString();
  const cached = hatchTextureCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = HATCH_CANVAS_SIZE;
  canvas.height = HATCH_CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;

  const background = color.clone().lerp(new THREE.Color(0xffffff), 0.55);
  ctx.fillStyle = `#${background.getHexString()}`;
  ctx.fillRect(0, 0, HATCH_CANVAS_SIZE, HATCH_CANVAS_SIZE);

  const line = color.clone().lerp(new THREE.Color(0x000000), 0.55);
  ctx.strokeStyle = `#${line.getHexString()}`;
  ctx.lineWidth = HATCH_LINE_WIDTH_PX;
  for (let offset = -HATCH_CANVAS_SIZE; offset <= HATCH_CANVAS_SIZE * 2; offset += HATCH_LINE_SPACING_PX) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset - HATCH_CANVAS_SIZE, HATCH_CANVAS_SIZE);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  hatchTextureCache.set(key, texture);
  return texture;
}

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

/** object自身と祖先すべてのvisibleを辿った実効的な表示状態（three.jsのレンダラ判定と同じ意味）。 */
function isEffectivelyVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

const MAX_SIMULTANEOUS_PLANES = 3;

export class ClipStencil {
  private readonly container = new THREE.Group();
  private readonly entries: Entry[] = [];
  private readonly capGeometry = new THREE.PlaneGeometry(1, 1);
  private nextRenderOrder = 1000;

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

    // ハッチングの繰り返し数はメッシュごとに一定（キャップの実寸サイズはupdate()内の
    // 計算と同じ式で、境界球はジオメトリ由来なので毎フレーム変わらない）。
    mesh.geometry.computeBoundingSphere();
    const capSize = Math.max((mesh.geometry.boundingSphere?.radius ?? 1) * 2.5, 0.05);
    // タイル1枚にはHATCH_LINES_PER_TILE本の線が入っているため、線1本あたりの実寸間隔を
    // HATCH_WORLD_SPACINGに揃えるにはタイル自体の実寸をその本数倍にする必要がある
    // （でないと線間隔がHATCH_LINES_PER_TILE分の1に詰まってしまう）。
    const hatchRepeat = Math.max(capSize / (HATCH_WORLD_SPACING * HATCH_LINES_PER_TILE), 1);

    const slots: AxisSlot[] = [];
    for (let i = 0; i < MAX_SIMULTANEOUS_PLANES; i++) {
      const renderOrder = this.nextRenderOrder++;

      // マスクはAlwaysStencilFuncのためstencilRefの値自体は比較に使われない
      // （常に通過し、Incr/Decrで既存値を増減するだけ）。
      const maskBackMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        side: THREE.BackSide,
        stencilWrite: true,
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

      // キャップはメッシュ自身のマテリアル色から生成したハッチングテクスチャを貼る
      // （建築断面図の慣習に倣い、単色塗りつぶしではなく断面であることを示す）。
      // NotEqualStencilFunc(ref=0)で「ステンシルが0でない箇所」だけ描画し、
      // 直後にZeroStencilOpで0へ戻す。閉じたソリッドなら増減の累積値は視点に
      // よらず「内側なら非0」になるため、EqualStencilFuncでメッシュごとの
      // 固有値に一致させる必要はない（かつてその方式で一部メッシュのキャップが
      // 全く描画されない不具合があった）。他メッシュのグループと明示的な
      // バッファクリアなしで共存できる（描画順はrenderOrderで保証）。
      const capTexture = getBaseHatchTexture(capColor).clone();
      capTexture.needsUpdate = true;
      capTexture.repeat.set(hatchRepeat, hatchRepeat);
      const capMaterial = new THREE.MeshStandardMaterial({
        // capTextureの地色・線色は既にcapColorを焼き込み済みなので、ここでcolorも
        // 指定するとサンプル値に対して二重に乗算されて暗くなる（既定の白のままにする）。
        map: capTexture,
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
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
      // マスク/キャップは専用コンテナ（__clipStencil）配下にあり、元メッシュの
      // partルート（Layers.tsがvisibleを切り替える）から独立している。そのため
      // レイヤー非表示時もここで明示的に隠さないと、非表示パートの断面だけが
      // 透けて見えてしまう。祖先を辿って実効的な表示状態を判定する。
      if (!isEffectivelyVisible(entry.mesh)) {
        entry.slots.forEach((slot) => {
          slot.maskBack.visible = false;
          slot.maskFront.visible = false;
          slot.cap.visible = false;
        });
        continue;
      }

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
