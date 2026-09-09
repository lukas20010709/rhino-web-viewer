import * as THREE from 'three';
import type { Metadata, ObjectAttributes } from '../data/types';

/**
 * Raycastによるオブジェクト選択と、Object ID→metadata属性の引き当て。
 * Hide / Isolate / Focus / Deselect（docs/viewer-design.md §4/§5）。
 */
export interface SelectionResult {
  objectId: string;
  object: THREE.Object3D;
  attributes: ObjectAttributes | undefined;
}

/** ハイライト用の色（既存パーツ色（赤/紫/グレー）に対して明確に識別できる明るいシアン） */
const HIGHLIGHT_COLOR = 0x44ddff;

/** emissive/emissiveIntensity を持つマテリアルかどうかの判定 */
function hasEmissive(
  mat: THREE.Material,
): mat is THREE.Material & { emissive: THREE.Color; emissiveIntensity: number } {
  return 'emissive' in mat;
}

export class Selection {
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hidden = new Set<THREE.Object3D>();
  private readonly getCamera: () => THREE.Camera;
  current: SelectionResult | null = null;

  /**
   * camera は固定参照でも「アクティブカメラを返すプロバイダ関数」でも受け付ける。
   * Perspective↔Orthographic を実行中に切り替えても、レイキャストが常に
   * 画面に描画中のカメラと一致するようにするため（Scene.start と同じ方式）。
   */
  constructor(
    camera: THREE.Camera | (() => THREE.Camera),
    private root: THREE.Object3D,
    private metadata: Metadata,
  ) {
    this.getCamera = typeof camera === 'function' ? camera : () => camera;
  }

  /** 画面座標(正規化前のclientX/Y)から選択を試みる */
  pick(clientX: number, clientY: number, rect: DOMRect): SelectionResult | null {
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.getCamera());

    const hits = this.raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      const id = this.resolveObjectId(hit.object);
      if (id) {
        this.clearHighlight();
        this.current = { objectId: id, object: hit.object, attributes: this.metadata.objects[id] };
        this.applyHighlight(hit.object);
        return this.current;
      }
    }
    this.clearHighlight();
    this.current = null;
    return null;
  }

  /** 選択を解除する（Esc等）。ハイライト用に差し替えたマテリアルを元に戻す。 */
  deselect(): void {
    this.clearHighlight();
    this.current = null;
  }

  /** 選択メッシュのマテリアルを clone し、emissive をハイライト色に設定する（他メッシュとの共有マテリアルを汚さないため） */
  private applyHighlight(obj: THREE.Object3D): void {
    if (!(obj instanceof THREE.Mesh)) return;
    const original = obj.material as THREE.Material | THREE.Material[];
    if (obj.userData.__originalMaterial === undefined) {
      obj.userData.__originalMaterial = original;
    }
    const clone = Array.isArray(original) ? original.map((m) => m.clone()) : original.clone();
    for (const m of Array.isArray(clone) ? clone : [clone]) {
      if (hasEmissive(m)) {
        m.emissive = new THREE.Color(HIGHLIGHT_COLOR);
        m.emissiveIntensity = Math.max(m.emissiveIntensity, 1);
      }
    }
    obj.material = clone;
  }

  /** 現在選択中のメッシュのハイライト用クローンを破棄し、元のマテリアル参照に戻す */
  private clearHighlight(): void {
    const obj = this.current?.object;
    if (!(obj instanceof THREE.Mesh)) return;
    const original = obj.userData.__originalMaterial as THREE.Material | THREE.Material[] | undefined;
    if (original === undefined) return;
    const highlighted = obj.material;
    obj.material = original;
    delete obj.userData.__originalMaterial;
    for (const m of Array.isArray(highlighted) ? highlighted : [highlighted]) {
      m.dispose();
    }
  }

  /** GLBノード名からObject IDを辿る（メッシュ→親ノードへ遡上） */
  private resolveObjectId(obj: THREE.Object3D): string | null {
    let node: THREE.Object3D | null = obj;
    while (node) {
      if (node.name && node.name in this.metadata.objects) return node.name;
      node = node.parent;
    }
    return null;
  }

  hide(obj: THREE.Object3D): void {
    obj.visible = false;
    this.hidden.add(obj);
  }

  /** 選択オブジェクトのみ表示（I キー） */
  isolate(target: THREE.Object3D): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.visible = false;
    });
    target.traverse((o) => (o.visible = true));
    let p: THREE.Object3D | null = target;
    while (p) { p.visible = true; p = p.parent; }
  }

  reset(): void {
    this.clearHighlight();
    this.root.traverse((o) => (o.visible = true));
    this.hidden.clear();
    this.current = null;
  }
}
