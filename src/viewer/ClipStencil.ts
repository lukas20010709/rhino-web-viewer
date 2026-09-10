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

/**
 * 断面キャップのステンシル手法（表裏面のIncr/Decr計数）は、対象メッシュが
 * 閉じた水密ソリッドであることが前提（open shellでは表裏の計数が相殺されず、
 * キャップ用の平面（境界球の2.5倍という実断面よりかなり大きいサイズ）の
 * ほぼ全域が非0と判定されて広範囲に誤ってハッチングされてしまう）。
 *
 * 実際に一部のRhinoオブジェクト（面ごとに個別マテリアルを持つ柱・梁・壁など）は
 * glTFエクスポート時に面ごとの単一メッシュ（開いた1枚板、例: 4頂点の矩形面）に
 * 分割される。分割前は1つの水密ソリッドだったはずなので、同じ親（Group）配下の
 * 断片をすべて結合すれば再び閉じた形状に戻る（下のmergeFragmentGeometries参照、
 * main.ts側で親Groupごとまとめてregisterする）。この関数はその結合後の最終的な
 * ジオメトリに対する保険的な検査で、すべての辺がちょうど2枚の三角形に共有されて
 * いるか（2-manifold・境界辺なし）を見る。結合しても水密にならない断片（本当に
 * 開いた形状、または非水密の修復漏れ）はキャップ登録自体をスキップする（見た目は
 * 断面が塗りつぶされず開いたままになるが、画面の大部分が誤ハッチングされるより
 * 実害が小さい）。
 *
 * 判定基準は「すべての辺の共有数が偶数」であることで、厳密な2-manifold（常に2枚）
 * より緩い。表裏面カウント方式は、ある辺を2枚が共有していれば増減が相殺されるため、
 * 実測では一部の辺が4枚・6枚（微小な重複・欠片ポリゴン起因、実データで確認済み）に
 * なっていても内外判定の0/非0自体は崩れない。崩れるのは奇数（典型的には1＝本当に
 * 開いた境界辺）の場合のみなので、そこだけを不合格とする。
 *
 * 辺の共有判定はインデックスの一致ではなく座標（量子化した位置）の一致で行う。
 * ハードエッジ（面ごとに法線を分けるフラットシェーディング）で書き出された
 * メッシュは、位置が同じでも面ごとに別頂点として重複しているのが通常で、単純に
 * インデックス値で辺を比較すると、単体で正しく閉じているソリッド（例:
 * 24頂点=6面×4頂点のハードエッジ直方体）まで「境界辺あり」と誤判定してしまう。
 */
function weldPositionIndices(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Uint32Array {
  const EPS = 1e-4;
  const canonical = new Map<string, number>();
  const remap = new Uint32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const x = Math.round(position.getX(i) / EPS);
    const y = Math.round(position.getY(i) / EPS);
    const z = Math.round(position.getZ(i) / EPS);
    const key = `${x}_${y}_${z}`;
    const existing = canonical.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
    } else {
      canonical.set(key, i);
      remap[i] = i;
    }
  }
  return remap;
}

function isWatertight(geometry: THREE.BufferGeometry): boolean {
  const index = geometry.index;
  const position = geometry.attributes.position;
  if (!index || !position) return false;

  const remap = weldPositionIndices(position);
  const edgeCounts = new Map<string, number>();
  const count = index.count;
  for (let i = 0; i < count; i += 3) {
    const ia = remap[index.getX(i)];
    const ib = remap[index.getX(i + 1)];
    const ic = remap[index.getX(i + 2)];
    const edges: [number, number][] = [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ];
    for (const [x, y] of edges) {
      const key = x < y ? `${x}_${y}` : `${y}_${x}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  // 実データでは、本当に断片化されて開いたオブジェクト（例: 面ごとに分割された
  // 1枚板の集まりで、境界辺の割合がほぼ100%）と、大部分は閉じているが補修漏れの
  // 小さな穴が数枚だけ残るオブジェクト（境界辺の割合は1%未満）の両方が存在する。
  // 後者まで一律にキャップを諦めると、実害の小さい局所的な欠陥のせいで壁全体の
  // ハッチングが消えてしまう（このガードを追加した経緯そのもの）。境界辺の比率が
  // 閾値未満なら、局所的な小さい欠陥として許容してキャップ対象にする。
  let oddCount = 0;
  for (const c of edgeCounts.values()) {
    if (c % 2 !== 0) oddCount++;
  }
  if (edgeCounts.size === 0) return false;
  const OPEN_EDGE_RATIO_TOLERANCE = 0.02;
  return oddCount / edgeCounts.size < OPEN_EDGE_RATIO_TOLERANCE;
}

/**
 * 同一オブジェクトが面ごとの別マテリアルでglTF分割された断片群（isWatertight参照）を
 * 1つのジオメトリに結合する。断片は共通の親Group直下で全てローカル変換が単位行列
 * （position/quaternion/scaleが既定値）であることを前提とし、position/indexだけを
 * 単純連結する（キャップ生成に法線・UV等は使わないため結合しない）。
 */
function mergeFragmentGeometries(meshes: THREE.Mesh[]): THREE.BufferGeometry | null {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    if (!pos) return null;
    totalVerts += pos.count;
    totalIndices += m.geometry.index ? m.geometry.index.count : pos.count;
  }
  if (totalVerts === 0) return null;

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);
  let vertOffset = 0;
  let indexOffset = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      positions[(vertOffset + v) * 3] = pos.getX(v);
      positions[(vertOffset + v) * 3 + 1] = pos.getY(v);
      positions[(vertOffset + v) * 3 + 2] = pos.getZ(v);
    }
    const index = m.geometry.index;
    if (index) {
      for (let i = 0; i < index.count; i++) indices[indexOffset + i] = index.getX(i) + vertOffset;
      indexOffset += index.count;
    } else {
      for (let i = 0; i < pos.count; i++) indices[indexOffset + i] = i + vertOffset;
      indexOffset += pos.count;
    }
    vertOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  return merged;
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
  /** 可視判定（isEffectivelyVisible）とワールド変換の基準。単体Meshまたは断片をまとめたGroup。 */
  target: THREE.Object3D;
  /** キャップのマスク描画・境界球計算に使うジオメトリ（Groupの場合はmergeFragmentGeometriesの結合結果）。 */
  geometry: THREE.BufferGeometry;
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
    // 開いた断片（isWatertight参照）はステンシル手法の前提を満たさないため対象外にする。
    if (!isWatertight(mesh.geometry)) return;

    const capColor = (material as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xcccccc);
    mesh.updateWorldMatrix(true, false);
    this.registerTarget(mesh, mesh.geometry, capColor);
  }

  /**
   * 面ごとの別マテリアルでglTF分割された断片群（同一オブジェクトの子Mesh一式）を
   * 1つのGroupとして登録する。分割前は1つの水密ソリッドだったはずなので、
   * mergeFragmentGeometriesで結合してから断面キャップの対象にする（main.ts側で
   * 「子が全てMeshであるGroup」を検出して呼び出す）。
   */
  registerGroup(group: THREE.Group): void {
    const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    if (meshes.length === 0) return;

    const merged = mergeFragmentGeometries(meshes);
    if (!merged || !isWatertight(merged)) return;

    // キャップの色は分割前の単一マテリアル色を再現できないため、断片の先頭の色で代表する。
    const firstMaterial = meshes[0].material;
    const capColor =
      !Array.isArray(firstMaterial) && (firstMaterial as THREE.MeshStandardMaterial)?.color
        ? (firstMaterial as THREE.MeshStandardMaterial).color.clone()
        : new THREE.Color(0xcccccc);

    group.updateWorldMatrix(true, false);
    this.registerTarget(group, merged, capColor);
  }

  private registerTarget(target: THREE.Object3D, geometry: THREE.BufferGeometry, capColor: THREE.Color): void {
    // ハッチングの繰り返し数はメッシュごとに一定（キャップの実寸サイズはupdate()内の
    // 計算と同じ式で、境界球はジオメトリ由来なので毎フレーム変わらない）。
    geometry.computeBoundingSphere();
    const capSize = Math.max((geometry.boundingSphere?.radius ?? 1) * 2.5, 0.05);
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

      const maskBack = new THREE.Mesh(geometry, maskBackMaterial);
      const maskFront = new THREE.Mesh(geometry, maskFrontMaterial);
      maskBack.renderOrder = renderOrder;
      maskFront.renderOrder = renderOrder;
      maskBack.visible = false;
      maskFront.visible = false;
      maskBack.matrixAutoUpdate = false;
      maskFront.matrixAutoUpdate = false;
      maskBack.matrix.copy(target.matrixWorld);
      maskFront.matrix.copy(target.matrixWorld);

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

    this.entries.push({ target, geometry, slots });
  }

  /** 有効な断面平面（Clipping.activePlanes()と同じ配列、最大3=X/Y/Z）に応じて再同期する。 */
  update(planes: THREE.Plane[]): void {
    for (const entry of this.entries) {
      // マスク/キャップは専用コンテナ（__clipStencil）配下にあり、元メッシュの
      // partルート（Layers.tsがvisibleを切り替える）から独立している。そのため
      // レイヤー非表示時もここで明示的に隠さないと、非表示パートの断面だけが
      // 透けて見えてしまう。祖先を辿って実効的な表示状態を判定する。
      if (!isEffectivelyVisible(entry.target)) {
        entry.slots.forEach((slot) => {
          slot.maskBack.visible = false;
          slot.maskFront.visible = false;
          slot.cap.visible = false;
        });
        continue;
      }

      const geometry = entry.geometry;
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

        const worldCenter = sphere.center.clone().applyMatrix4(entry.target.matrixWorld);
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
