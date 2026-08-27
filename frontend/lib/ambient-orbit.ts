/**
 * Ambient rotation of the 3D scene, so the graph turns on its own like a
 * specimen on a slowly moving stage.
 *
 * Deliberately not a constant spin. A fixed rate around a fixed axis reads as
 * a turntable — mechanical, and predictable enough that the eye stops watching
 * it. Both the azimuth rate and the elevation are driven by slow sines with
 * unrelated periods, so the path never repeats on any timescale you would sit
 * through, sometimes almost stalls, and occasionally drifts back a little.
 *
 * The camera is moved around the controls' own target rather than the graph's
 * centre. That target is the centroid after the initial fit, the focused
 * memory after one is opened, and whatever the user last orbited to otherwise
 * — so the rotation always circles whatever is currently being looked at,
 * without needing to know which of those happened.
 *
 * Only the angles change; the radius is read back each frame and preserved, so
 * this never fights the user's zoom or the framing animations.
 */

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface OrbitScene {
  camera?: () => { position?: Vec } | undefined;
  controls?: () => { target?: Vec } | undefined;
}

/**
 * Baseline angular speed, before modulation. A full turn takes around four
 * minutes at the average rate — slow enough to read as ambient rather than as
 * an animation demanding attention.
 */
const AZIMUTH_RATE = 0.045;

/** Vertical wander. Much slower, so the tilt reads as a drift, not a bob. */
const POLAR_RATE = 0.013;

/*
 * Elevation is clamped either side of the equator. Straight over a pole the
 * azimuth becomes meaningless and the scene visibly rolls, which looks like a
 * glitch rather than a viewpoint.
 */
const MIN_POLAR = 1.02;
const MAX_POLAR = 2.12;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Two sines with an irrational-ish period ratio, so their sum never settles
 * into an obvious cycle. The troughs can go slightly negative, which is what
 * gives the occasional drift backwards.
 */
export function azimuthRate(seconds: number): number {
  return (
    AZIMUTH_RATE *
    (0.5 +
      0.4 * Math.sin(seconds * 0.047) +
      0.3 * Math.sin(seconds * 0.0163 + 2.1))
  );
}

export function polarRate(seconds: number): number {
  return POLAR_RATE * Math.sin(seconds * 0.031 + 0.7);
}

/**
 * Where one frame of elevation change may land. Outside the band the camera is
 * where the user orbited it, so only motion toward the band is allowed: their
 * viewpoint eases back into range rather than being pulled there in a frame.
 */
function settle(current: number, next: number): number {
  if (current < MIN_POLAR) return clamp(next, current, MIN_POLAR);
  if (current > MAX_POLAR) return clamp(next, MAX_POLAR, current);
  return clamp(next, MIN_POLAR, MAX_POLAR);
}

/**
 * Rotate `position` about `target` by one frame's worth of motion.
 *
 * Exported separately from the scene plumbing so the motion itself can be
 * reasoned about and tested without a renderer.
 */
export function applyOrbit(
  position: Vec,
  target: Vec,
  seconds: number,
  delta: number,
): void {
  const ox = position.x - target.x;
  const oy = position.y - target.y;
  const oz = position.z - target.z;

  const radius = Math.hypot(ox, oy, oz);
  // Camera sitting exactly on the target has no orbit to speak of, and the
  // angles below would be undefined.
  if (radius < 1e-6) return;

  const azimuth = Math.atan2(ox, oz) + azimuthRate(seconds) * delta;
  const current = Math.acos(clamp(oy / radius, -1, 1));
  const polar = settle(current, current + polarRate(seconds) * delta);

  const sinPolar = Math.sin(polar);
  position.x = target.x + radius * sinPolar * Math.sin(azimuth);
  position.y = target.y + radius * Math.cos(polar);
  position.z = target.z + radius * sinPolar * Math.cos(azimuth);
}

/*
 * Two ways the rotation stands down, kept apart because they overlap: the
 * pointer can leave a node while a drag is still in progress.
 */
const holds = new Set<string>();
let suspendedUntil = 0;

/** Stop while the user is doing something that the rotation would fight. */
export function holdOrbit(
  reason: "pointer" | "hover" | "drag",
  held: boolean,
): void {
  if (held) holds.add(reason);
  else holds.delete(reason);
}

/**
 * Stand down for a moment — used around the camera transitions, which tween
 * the position themselves and would otherwise be nudged off course mid-flight.
 */
export function suspendOrbit(ms = 1000): void {
  suspendedUntil = Math.max(suspendedUntil, performance.now() + ms);
}

export function orbitActive(): boolean {
  return holds.size === 0 && performance.now() >= suspendedUntil;
}

/** One frame of ambient rotation. Safe to call before the scene exists. */
export function advanceOrbit(
  scene: OrbitScene | null,
  seconds: number,
  delta: number,
): void {
  if (!orbitActive()) return;

  const position = scene?.camera?.()?.position;
  const target = scene?.controls?.()?.target;
  if (!position || !target) return;

  applyOrbit(position, target, seconds, delta);
  // No lookAt here: the renderer's controls re-aim the camera at their target
  // on every update, and doing it twice only risks disagreeing with them.
}
