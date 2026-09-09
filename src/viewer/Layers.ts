import type * as THREE from 'three';

/**
 * part/レイヤーの表示ON/OFF管理。Model Tree(UI)と連携する。
 * partは manifest.parts の id（site/structure/architecture/...）に対応。
 * 参照: docs/viewer-design.md §3 Model Tree / §5 Model
 */
export class Layers {
  constructor(private partRoots: Map<string, THREE.Object3D>) {}

  list(): string[] {
    return [...this.partRoots.keys()];
  }

  setVisible(partId: string, visible: boolean): void {
    const root = this.partRoots.get(partId);
    if (root) root.visible = visible;
  }

  toggle(partId: string): boolean {
    const root = this.partRoots.get(partId);
    if (!root) return false;
    root.visible = !root.visible;
    return root.visible;
  }

  isVisible(partId: string): boolean {
    return this.partRoots.get(partId)?.visible ?? false;
  }

  showAll(): void {
    for (const root of this.partRoots.values()) {
      root.traverse((o) => { o.visible = true; });
    }
  }

  /**
   * partルート配下に存在するObject ID（各ノードの.name）を重複なく列挙する。
   * ルート自身の名前は除く。part内訳の妥当性（metadata.objectsとの突合）は呼び出し側で行う。
   */
  listObjects(partId: string): string[] {
    const root = this.partRoots.get(partId);
    if (!root) return [];
    const names = new Set<string>();
    root.traverse((o) => {
      if (o !== root && o.name) names.add(o.name);
    });
    return [...names];
  }

  /**
   * partルート配下でnameが一致する全ノードの表示を個別に切り替える。
   * ModelLoaderが付与する輪郭線 `${objectId}__edges` はメッシュ本体の子ノードのため、
   * メッシュを非表示にした時点でThree.jsのレンダラーが子孫ごと描画をスキップする
   * （実際には輪郭線側を明示的にvisible=falseにする必要はないが、状態の一貫性のため
   * こちらも合わせて設定する）。
   */
  setObjectVisible(partId: string, objectId: string, visible: boolean): void {
    const root = this.partRoots.get(partId);
    if (!root) return;
    const edgesName = `${objectId}__edges`;
    root.traverse((o) => {
      if (o.name === objectId || o.name === edgesName) o.visible = visible;
    });
  }

  /** 個別オブジェクトの現在の表示状態（該当ノードが複数ある場合は先頭のもの）。 */
  isObjectVisible(partId: string, objectId: string): boolean {
    const root = this.partRoots.get(partId);
    if (!root) return false;
    let found: THREE.Object3D | undefined;
    root.traverse((o) => {
      if (!found && o.name === objectId) found = o;
    });
    return found?.visible ?? false;
  }
}
