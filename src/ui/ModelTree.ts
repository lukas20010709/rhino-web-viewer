import type { Layers } from '../viewer/Layers';
import type { Metadata } from '../data/types';

const PART_LABEL_JA: Record<string, string> = {
  site: 'サイト',
  structure: '構造',
  architecture: '建築',
  furniture: '家具',
  equipment: '設備',
  landscape: '外構',
};

/**
 * 左ペイン: part（Site/Structure/Wall/Furniture...）のON/OFFツリー。
 * docs/viewer-design.md §3 MODEL TREE。
 * part行は展開可能で、展開するとそのpartに属する個別Object ID（metadata.objectsと突合済み）が
 * 折りたたみリストとして表示され、個別に表示ON/OFFできる（既定は折りたたみ）。
 */
export class ModelTree {
  private expandedParts = new Set<string>();

  constructor(private el: HTMLElement, private layers: Layers, private metadata: Metadata) {}

  render(): void {
    this.el.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = 'モデルツリー';
    this.el.appendChild(heading);

    for (const partId of this.layers.list()) {
      const partLabel = PART_LABEL_JA[partId] ?? partId;
      const isExpanded = this.expandedParts.has(partId);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center;';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.textContent = isExpanded ? '▾' : '▸';
      toggleBtn.setAttribute('aria-expanded', String(isExpanded));
      toggleBtn.setAttribute('aria-label', `${partLabel}の個別オブジェクトを${isExpanded ? '折りたたむ' : '展開する'}`);
      toggleBtn.style.cssText = 'border:none; background:none; cursor:pointer; padding:0 0.4em; font-size:0.9em;';
      toggleBtn.addEventListener('click', () => {
        if (isExpanded) this.expandedParts.delete(partId);
        else this.expandedParts.add(partId);
        this.render();
      });
      row.appendChild(toggleBtn);

      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.layers.isVisible(partId);
      cb.addEventListener('change', () => this.layers.setVisible(partId, cb.checked));
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + partLabel));
      row.appendChild(label);

      this.el.appendChild(row);

      if (isExpanded) {
        const objectIds = this.layers
          .listObjects(partId)
          .filter((id) => Object.prototype.hasOwnProperty.call(this.metadata.objects, id))
          .sort();

        const list = document.createElement('div');
        list.style.cssText = 'margin-left:1.6em; max-height:16em; overflow-y:auto;';

        for (const objectId of objectIds) {
          const objLabel = document.createElement('label');
          objLabel.style.cssText = 'display:block;';
          const objCb = document.createElement('input');
          objCb.type = 'checkbox';
          objCb.checked = this.layers.isObjectVisible(partId, objectId);
          objCb.addEventListener('change', () =>
            this.layers.setObjectVisible(partId, objectId, objCb.checked)
          );
          objLabel.appendChild(objCb);
          objLabel.appendChild(document.createTextNode(' ' + objectId));
          list.appendChild(objLabel);
        }

        this.el.appendChild(list);
      }
    }
  }
}
