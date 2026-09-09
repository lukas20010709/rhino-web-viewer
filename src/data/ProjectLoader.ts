import type { Manifest, Metadata, Origin, ProjectData } from './types';

/**
 * プロジェクトの入口(manifest)を起点に metadata / origin を取得する。
 * ジオメトリ(GLB)の読み込みは ModelLoader が担当し、ここではJSON契約のみ扱う。
 * 参照: docs/data-schema.md / docs/architecture.md
 */
export class ProjectLoader {
  /**
   * @param projectBase 例: `${import.meta.env.BASE_URL}projects/project-a/`
   */
  async load(projectBase: string): Promise<ProjectData> {
    const baseUrl = projectBase.endsWith('/') ? projectBase : projectBase + '/';

    const manifest = await this.fetchJson<Manifest>(baseUrl + 'manifest.json');

    const metadataPath = manifest.metadata ?? 'metadata.json';
    const originPath = manifest.origin ?? 'origin.json';

    const metadata = await this.fetchJson<Metadata>(baseUrl + metadataPath);
    const origin = await this.fetchJson<Origin>(baseUrl + originPath).catch(() => null);

    this.assertConsistency(manifest, metadata);

    return { manifest, metadata, origin, baseUrl };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${url} (${res.status})`);
    return (await res.json()) as T;
  }

  /** project / revision の一致など最低限の実行時整合チェック（詳細検証はCIのvalidate-model.mjs） */
  private assertConsistency(manifest: Manifest, metadata: Metadata): void {
    if (manifest.project !== metadata.project) {
      throw new Error(`project mismatch: manifest=${manifest.project} metadata=${metadata.project}`);
    }
    if (manifest.revision !== metadata.revision) {
      console.warn(`revision mismatch: manifest=${manifest.revision} metadata=${metadata.revision}`);
    }
  }
}
