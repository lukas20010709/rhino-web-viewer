import type { SelectionResult } from '../viewer/Selection';

/**
 * 右ペイン: 選択オブジェクトの Object ID / Material / Layer / Metadata を表示。
 * MVPの Information 機能（docs/viewer-design.md §3/§5）。
 * ここでは最小の描画APIのみ定義（スタイルはPhase 1で拡充）。
 */
export class PropertyPanel {
  constructor(private el: HTMLElement) {}

  show(sel: SelectionResult | null): void {
    if (!sel) {
      this.el.innerHTML = '<p>未選択</p>';
      return;
    }
    const a = sel.attributes ?? {};
    const rows = Object.entries(a)
      .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`)
      .join('');
    this.el.innerHTML = `
      <h3>${escapeHtml(sel.objectId)}</h3>
      <table>${rows || '<tr><td>属性なし</td></tr>'}</table>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
