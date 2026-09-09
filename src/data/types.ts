/**
 * データ契約のTypeScript型。
 * schemas/*.schema.json と1対1で対応させる（変更時は両方を更新）。
 * 参照: docs/data-schema.md
 */

export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export type PartId = 'site' | 'structure' | 'architecture' | 'furniture' | 'equipment' | 'landscape';
export type ObjectStatus = 'design' | 'proposal' | 'fixed' | 'asbuilt';

/** manifest.json */
export interface Manifest {
  schemaVersion: string;
  project: string;
  revision: string;
  title?: string;
  unit: Unit;
  up?: 'Y' | 'Z';
  origin?: string;
  metadata?: string;
  thumbnail?: string;
  createdAt?: string;
  parts: ManifestPart[];
}

export interface ManifestPart {
  id: PartId;
  file: string;
  loadPriority: number;
  defaultVisible?: boolean;
  sizeBytes?: number;
  drawCallHint?: number;
  triangleCount?: number;
}

/** metadata.json */
export interface Metadata {
  schemaVersion: string;
  project: string;
  revision: string;
  objects: Record<string, ObjectAttributes>;
}

export interface ObjectAttributes {
  layer?: string;
  category?: string;
  material?: string;
  status?: ObjectStatus;
  manufacturer?: string;
  room?: string;
  url?: string;
  [key: string]: unknown; // 未知キーは許容（拡張性）
}

/** origin.json */
export interface Origin {
  schemaVersion: string;
  worldOrigin: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  unit: Unit;
  epsg?: number | null;
}

/** manifest + metadata + origin をまとめた読み込み結果 */
export interface ProjectData {
  manifest: Manifest;
  metadata: Metadata;
  origin: Origin | null;
  baseUrl: string; // public/projects/<project>/ の解決済みURL
}
