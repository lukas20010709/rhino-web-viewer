import type { Layers } from '../viewer/Layers';

/**
 * 左ペイン: part（Site/Structure/Wall/Furniture...）のON/OFFツリー。
 * docs/viewer-design.md §3 MODEL TREE。ここでは最小のチェックボックス生成のみ。
 */
export class ModelTree {
  constructor(private el: HTMLElement, private layers: Layers) {}

  render(): void {
    this.el.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = 'モデルツリー';
    this.el.appendChild(heading);
    for (const partId of this.layers.list()) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.layers.isVisible(partId);
      cb.addEventListener('change', () => this.layers.setVisible(partId, cb.checked));
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + partId));
      this.el.appendChild(label);
    }
  }
}
