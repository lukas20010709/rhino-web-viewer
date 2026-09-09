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
    for (const root of this.partRoots.values()) root.visible = true;
  }
}
