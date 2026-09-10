import * as THREE from 'three';

/** 表示スタイル: 通常 / ワイヤーフレーム / Xレイ(透過) / モノクロ。 */
export type DisplayStyleMode = 'normal' | 'wireframe' | 'xray' | 'monochrome';

const MONOCHROME_COLOR = 0xaaaaaa;
const XRAY_OPACITY = 0.35;

/**
 * mesh.userData に元マテリアルをキャッシュするキー。Selection.ts の
 * `__originalMaterial`（選択ハイライト用のキャッシュ）とは別のキーにし、
 * 選択中のメッシュに対して表示スタイルを切り替えても双方が独立して
 * 元マテリアルを保持・復元できるようにする（衝突なし）。
 */
const ORIGINAL_MATERIAL_KEY = '__originalMaterialForStyle';

function hasWireframe(mat: THREE.Material): mat is THREE.Material & { wireframe: boolean } {
  return 'wireframe' in mat;
}

function hasColor(mat: THREE.Material): mat is THREE.Material & { color: THREE.Color } {
  return 'color' in mat;
}

/**
 * ロード済み全パーツのマテリアルへ表示スタイルを適用する。
 * Selection.applyHighlight/clearHighlight と同じ方針で、メッシュごとに
 * マテリアルをclone()してから丸ごと差し替える（共有マテリアルを直接
 * mutateすると、そのマテリアルを参照する他の箇所（ClipStencil等）にも
 * 影響しうるため）。通常(normal)へ戻すと元のマテリアル参照を復元し、
 * clone分はdisposeする＝切り替えは常に可逆。
 */
export class DisplayStyle {
  apply(roots: Iterable<THREE.Object3D>, mode: DisplayStyleMode): void {
    for (const root of roots) {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) this.applyToMesh(obj, mode);
      });
    }
  }

  private applyToMesh(mesh: THREE.Mesh, mode: DisplayStyleMode): void {
    const original = mesh.userData[ORIGINAL_MATERIAL_KEY] as THREE.Material | undefined;
    const current = mesh.material as THREE.Material;

    if (mode === 'normal') {
      if (original === undefined) return; // 既に通常表示（未着手）
      mesh.material = original;
      delete mesh.userData[ORIGINAL_MATERIAL_KEY];
      current.dispose();
      return;
    }

    const base = original ?? current;
    if (original === undefined) {
      mesh.userData[ORIGINAL_MATERIAL_KEY] = base;
    } else {
      current.dispose(); // 前回のスタイル用cloneを破棄してから新しいcloneを作る
    }

    const styled = base.clone();
    this.applyModeProps(styled, mode);
    mesh.material = styled;
  }

  private applyModeProps(mat: THREE.Material, mode: DisplayStyleMode): void {
    switch (mode) {
      case 'wireframe':
        if (hasWireframe(mat)) mat.wireframe = true;
        break;
      case 'xray':
        mat.transparent = true;
        mat.opacity = XRAY_OPACITY;
        mat.depthWrite = false;
        break;
      case 'monochrome':
        if (hasColor(mat)) mat.color.set(MONOCHROME_COLOR);
        break;
    }
  }
}
