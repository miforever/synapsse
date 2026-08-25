/**
 * Where the user left the camera, per canvas.
 *
 * Kept in localStorage rather than with the daemon's saved layout. The
 * arrangement of the graph is shared — anyone opening this memory graph should
 * see the memories where they were put — but a viewpoint is not: it is where
 * *this* browser was looking, and pushing it to the daemon would have one
 * window's zoom yanking another's.
 *
 * The two canvases are stored separately, since a 3D camera and a 2D pan/zoom
 * have nothing in common, and switching between them should return you to
 * where each one was.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraState {
  /** 3D: the camera itself, and the point it orbits. */
  position?: Vec3;
  target?: Vec3;
  /** 2D: the centre of the viewport in graph coordinates, and the scale. */
  center?: { x: number; y: number };
  zoom?: number;
}

/** Versioned, so a change to the shape cannot resurrect a camera it cannot read. */
const KEY = "synapsse.camera.v1";

type Stored = Record<string, CameraState>;

function readAll(): Stored {
  // Absent during SSR, and throws outright in a browser with storage denied.
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

/*
 * `JSON.stringify` writes NaN as `null`, so an unchecked camera persists as a
 * viewpoint of nulls and is handed back on every load. Losing one costs a
 * reframing; keeping a broken one costs the canvas.
 */
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function usableVec(vec: Vec3 | undefined): boolean {
  return !!vec && finite(vec.x) && finite(vec.y) && finite(vec.z);
}

function usable(state: CameraState | undefined): state is CameraState {
  if (!state) return false;
  if (state.position || state.target) {
    return usableVec(state.position) && (!state.target || usableVec(state.target));
  }
  return !!state.center && finite(state.center.x) && finite(state.center.y) && finite(state.zoom);
}

export function loadCamera(mode: string): CameraState | null {
  const state = readAll()[mode];
  return usable(state) ? state : null;
}

/*
 * The last value written, so an idle canvas is not rewriting the same string
 * every couple of seconds — the save path polls rather than hooking every
 * camera event, because the renderers expose no single event that covers
 * dragging, the wheel, and their own tweens alike.
 */
let lastWritten = "";

export function saveCamera(mode: string, state: CameraState): void {
  if (typeof localStorage === "undefined") return;
  if (!usable(state)) return;

  const all = readAll();
  all[mode] = state;
  const serialized = JSON.stringify(all);
  if (serialized === lastWritten) return;

  try {
    localStorage.setItem(KEY, serialized);
    lastWritten = serialized;
  } catch {
    // Storage full or denied. The camera is still where it is; only the
    // memory of it across reloads is lost, which is not worth an error.
  }
}
