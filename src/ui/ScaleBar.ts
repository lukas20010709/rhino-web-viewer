import type { Camera } from '../viewer/Camera';

/**
 * 平行投影時のスケールバー。フラスタム幅(mm)をキャンバス幅(px)で割った
 * mm/px から「きりのいい」実寸長を選び、対応するpx幅で表示する。
 * OrbitControlsは正投影カメラのズームを left/right ではなく zoom に
 * 反映するため（THREE OrthographicCamera.updateProjectionMatrix参照）、
 * 可視フラスタム幅は (right - left) / zoom で求める必要がある。
 */
const NICE_STEPS = [1, 2, 5];
const TARGET_PX = 120;

function niceLengthMm(rawMm: number): number {
  if (!(rawMm > 0)) return 1;
  const exponent = Math.floor(Math.log10(rawMm));
  let best = Math.pow(10, exponent);
  let bestRatio = Infinity;
  for (let e = exponent - 1; e <= exponent + 1; e++) {
    for (const step of NICE_STEPS) {
      const candidate = step * Math.pow(10, e);
      const ratio = Math.max(candidate / rawMm, rawMm / candidate);
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = candidate;
      }
    }
  }
  return best;
}

function formatLabel(mm: number): string {
  if (mm >= 1000) {
    const m = mm / 1000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)} m`;
  }
  return `${mm} mm`;
}

export class ScaleBar {
  private readonly barEl: HTMLElement;
  private readonly labelEl: HTMLElement;

  constructor(private readonly rootEl: HTMLElement) {
    this.barEl = rootEl.querySelector('.scalebar-bar') as HTMLElement;
    this.labelEl = rootEl.querySelector('.scalebar-label') as HTMLElement;
  }

  show(): void {
    this.rootEl.hidden = false;
  }

  hide(): void {
    this.rootEl.hidden = true;
  }

  /** カメラの現在のフラスタムとキャンバス幅(px)からバー長を再計算する。 */
  render(camera: Camera, canvasWidthPx: number): void {
    if (canvasWidthPx <= 0) return;
    const ortho = camera.orthographic;
    const worldWidthMm = (ortho.right - ortho.left) / ortho.zoom;
    // ortho.zoom が極端なズームアウトで0近くまで落ちるとworldWidthMmがInfinityになり得る。
    // niceLengthMm内のexponent計算・ループはInfinityで終了しない（無限ループ化）ため、
    // 有限値であることも明示的に確認する（!(x>0)だけではInfinityを弾けない）。
    if (!Number.isFinite(worldWidthMm) || worldWidthMm <= 0) return;

    const mmPerPixel = worldWidthMm / canvasWidthPx;
    const rawMm = TARGET_PX * mmPerPixel;
    const niceMm = niceLengthMm(rawMm);
    const barPx = niceMm / mmPerPixel;

    this.barEl.style.width = `${barPx}px`;
    this.labelEl.textContent = formatLabel(niceMm);
  }
}
