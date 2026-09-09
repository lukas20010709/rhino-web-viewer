import * as THREE from 'three';
import type { Clipping, ClipAxis } from '../viewer/Clipping';

const AXIS_LABEL: Record<ClipAxis, string> = { x: 'X', y: 'Y (上下)', z: 'Z' };

/**
 * 左下ペイン: XYZ軸ごとの断面(Clipping Plane)操作。
 * 軸ごとに ON/OFF・位置スライダー・反転(切断する側)を持つ（docs/roadmap.md Phase 4）。
 */
export class ClippingPanel {
  constructor(
    private el: HTMLElement,
    private clipping: Clipping,
    private bounds: THREE.Box3,
  ) {}

  render(): void {
    this.el.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = '断面 (Clipping Plane)';
    this.el.appendChild(heading);

    (['x', 'y', 'z'] as ClipAxis[]).forEach((axis) => {
      this.el.appendChild(this.buildRow(axis));
    });
  }

  private buildRow(axis: ClipAxis): HTMLElement {
    const min = this.bounds.min[axis];
    const max = this.bounds.max[axis];
    const state = this.clipping.getState(axis);

    const row = document.createElement('div');
    row.className = 'clip-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.enabled;
    cb.setAttribute('aria-label', `${AXIS_LABEL[axis]}軸の断面を有効化`);
    cb.addEventListener('change', () => this.clipping.setAxisEnabled(axis, cb.checked));

    const label = document.createElement('span');
    label.textContent = AXIS_LABEL[axis];

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(Math.max((max - min) / 200, 0.01));
    slider.value = String(state.value);
    slider.setAttribute('aria-label', `${AXIS_LABEL[axis]}軸の断面位置`);
    slider.addEventListener('input', () => this.clipping.setAxisValue(axis, Number(slider.value)));

    const flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.textContent = '反転';
    flipBtn.title = '切断する側を反転';
    flipBtn.addEventListener('click', () => this.clipping.toggleFlip(axis));

    row.append(cb, label, slider, flipBtn);
    return row;
  }
}
