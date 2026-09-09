import type * as THREE from 'three';
import { Camera, type StandardView } from './Camera';
import { Clipping, type ClipAxis } from './Clipping';
import { Layers } from './Layers';

/**
 * カメラ・断面(Clipping)・表示状態(Layers)をURLの1クエリパラメータへ
 * シリアライズ/デシリアライズする（docs/viewer-design.md §7 将来項目の最小実装）。
 * 値はJSONをBase64化した単一の不透明な文字列とし、可読性より自己完結性を優先する。
 */

const PARAM_KEY = 'view';

interface ClipAxisPayload {
  e: boolean;
  f: boolean;
  v: number;
}

interface ViewStatePayload {
  view: StandardView;
  proj: 'perspective' | 'orthographic';
  pos: [number, number, number];
  tgt: [number, number, number];
  clip: Record<ClipAxis, ClipAxisPayload>;
  hidden: string[];
}

const AXES: ClipAxis[] = ['x', 'y', 'z'];
const VALID_VIEWS: StandardView[] = ['top', 'front', 'side', 'perspective'];

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

/** 現在の状態から ?view=... を含む URLSearchParams を組み立てる */
export function serializeViewState(
  camera: Camera,
  clipping: Clipping,
  layers: Layers,
  currentView: StandardView,
  projection: 'perspective' | 'orthographic',
): URLSearchParams {
  const pos = camera.active.position;
  const tgt = camera.controls.target;

  const clip = {} as Record<ClipAxis, ClipAxisPayload>;
  for (const axis of AXES) {
    const s = clipping.getState(axis);
    clip[axis] = { e: s.enabled, f: s.flipped, v: s.value };
  }

  const hidden = layers.list().filter((id) => !layers.isVisible(id));

  const payload: ViewStatePayload = {
    view: currentView,
    proj: projection,
    pos: [pos.x, pos.y, pos.z],
    tgt: [tgt.x, tgt.y, tgt.z],
    clip,
    hidden,
  };

  const encoded = btoa(encodeURIComponent(JSON.stringify(payload)));
  const params = new URLSearchParams();
  params.set(PARAM_KEY, encoded);
  return params;
}

export interface AppliedViewState {
  view: StandardView;
  projection: 'perspective' | 'orthographic';
}

/**
 * ?view=... を解釈し、カメラ/断面/表示状態へ適用する。
 * パラメータ欠損・破損・型不正のいずれでも例外を投げず、何もしない（null を返す）。
 * 部分的に壊れたペイロードでも、解釈できるフィールドだけを適用しアプリを壊さない。
 */
export function applyViewState(
  params: URLSearchParams,
  camera: Camera,
  clipping: Clipping,
  layers: Layers,
  bounds: THREE.Box3,
): AppliedViewState | null {
  const raw = params.get(PARAM_KEY);
  if (!raw) return null;

  let payload: Partial<ViewStatePayload> | null = null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(atob(raw)));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Partial<ViewStatePayload>;
  } catch {
    payload = null;
  }
  if (!payload) return null;

  const view: StandardView = VALID_VIEWS.includes(payload.view as StandardView)
    ? (payload.view as StandardView)
    : 'perspective';
  const projection: 'perspective' | 'orthographic' =
    payload.proj === 'orthographic' ? 'orthographic' : 'perspective';

  // 既存のprojection切替（main.ts）と同じ順序: setProjection→applyStandardView で
  // フラスタム(Orthographic)や構図を境界(bounds)に合わせてから、位置/ターゲットを上書きする。
  camera.setProjection(projection);
  camera.applyStandardView(view, bounds);

  if (isVec3(payload.pos)) camera.active.position.set(...payload.pos);
  if (isVec3(payload.tgt)) camera.controls.target.set(...payload.tgt);
  camera.controls.update();

  if (payload.clip && typeof payload.clip === 'object') {
    const clip = payload.clip as Record<string, Partial<ClipAxisPayload>>;
    for (const axis of AXES) {
      const s = clip[axis];
      if (!s) continue;
      if (isFiniteNumber(s.v)) clipping.setAxisValue(axis, s.v);
      if (typeof s.f === 'boolean' && s.f !== clipping.getState(axis).flipped) clipping.toggleFlip(axis);
      if (typeof s.e === 'boolean') clipping.setAxisEnabled(axis, s.e);
    }
  }

  if (Array.isArray(payload.hidden)) {
    const known = new Set(layers.list());
    for (const id of payload.hidden) {
      if (typeof id === 'string' && known.has(id)) layers.setVisible(id, false);
    }
  }

  return { view, projection };
}
