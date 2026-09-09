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
        this.current = { objectId: id, object: hit.object, attributes: this.metadata.objects[id] };
        return this.current;
      }
    }
    this.current = null;
    return null;
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
    this.root.traverse((o) => (o.visible = true));
    this.hidden.clear();
    this.current = null;
  }
}
