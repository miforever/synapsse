/**
 * Plasma pulses travelling along the links.
 *
 * Replaces the renderer's particle spheres, which are measured in world units
 * and therefore swell into beads as the camera closes in. A line primitive is
 * always one pixel wide whatever the zoom, and the pulse is computed per
 * fragment *inside* that line — so the effect keeps its shape at any scale.
 *
 * One shared material draws every link. Per-link variation comes from a vertex
 * attribute rather than separate materials, which matters at a few thousand
 * edges: distinct materials would mean a draw call each.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  ShaderMaterial,
  type Object3D,
} from "three";

import { type FocusLink, isLinkHovered, isLinkLit } from "./link-focus";

interface Endpoint {
  x?: number;
  y?: number;
  z?: number;
}

const VERTEX = /* glsl */ `
  attribute float aProgress;
  attribute float aPhase;
  attribute float aFocus;
  varying float vProgress;
  varying float vPhase;
  varying float vFocus;

  void main() {
    vProgress = aProgress;
    vPhase = aPhase;
    vFocus = aFocus;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uWidth;
  uniform float uBase;
  uniform vec3 uColor;
  uniform vec3 uPulseColor;
  varying float vProgress;
  varying float vPhase;
  varying float vFocus;

  void main() {
    /*
     * One attribute carries both directions of emphasis. Below 1 is focus
     * receding a link into the background; above 1 is hover lifting it out.
     * Splitting them here rather than in two attributes keeps the per-frame
     * update on the CPU side to a single float per link.
     */
    float dim = min(vFocus, 1.0);
    float glow = clamp(vFocus - 1.0, 0.0, 1.0);

    // Position within the travelling cycle, offset per link so the graph does
    // not pulse in unison.
    float cycle = fract(vProgress - uTime * uSpeed + vPhase);

    // Distance to the nearest pulse centre, wrapping at both ends so the band
    // fades in and out symmetrically instead of snapping.
    float distance = min(cycle, 1.0 - cycle);

    // smoothstep gives the fade-in, plateau and fade-out in one expression.
    // Scaled by focus so a receded link loses its pulse as well as its line —
    // a dimmed edge with a bright spark still travelling it draws the eye
    // straight back to what is meant to be in the background.
    float intensity = smoothstep(uWidth, 0.0, distance) * dim;

    // A hovered link takes on the pulse's own colour along its whole length,
    // so the connection reads as live rather than merely brighter.
    vec3 resting = mix(uColor, uPulseColor, glow * 0.7);
    vec3 color = mix(resting, uPulseColor, intensity);

    float alpha = (uBase + intensity * (1.0 - uBase)) * dim;
    gl_FragColor = vec4(color, min(1.0, alpha + glow * 0.45));
  }
`;

let material: ShaderMaterial | null = null;

function sharedMaterial(): ShaderMaterial {
  if (material) return material;

  material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 0.14 },
      // Fraction of the link the pulse spans. Kept short so it reads as a
      // travelling spark rather than a streak lighting the whole edge.
      uWidth: { value: 0.035 },
      // Resting visibility of the line, matched to the 2D view so structure
      // is legible between pulses rather than nearly invisible.
      uBase: { value: 0.55 },
      uColor: { value: new Color("#BAC8DC") },
      uPulseColor: { value: new Color("#7FF6FF") },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    /*
     * Normal blending, not additive.
     *
     * Additive lets the line's resting colour wash out against the dark
     * canvas — a base bright enough to read would then blow out wherever
     * links cross. Blending normally keeps the line as legible as the 2D
     * view, and the pulse carries the brightness on its own.
     */
  });
  return material;
}

/** Advance every pulse. Called once per frame, not once per link. */
export function advancePlasma(seconds: number): void {
  if (material) material.uniforms.uTime.value = seconds;
}

/*
 * Which memory is open, and what it connects to.
 *
 * Held at module level rather than passed per link: the value is the same for
 * every edge, and the update path below runs once per link per frame.
 */
let focused: string | null = null;
let neighbours: ReadonlySet<string> = new Set();
let hovered: string | null = null;

/** How much of itself a receded link keeps. Enough to read as structure. */
const DIMMED = 0.14;

/** Above 1, which the shader reads as glow rather than as brightness. */
const HOVERED = 1.5;

// Approach rate per frame. Matches the eased node focus, so lines and nodes
// recede together instead of the graph changing in two visible stages.
const EASE = 0.12;

export function setLinkFocus(
  focusId: string | null,
  neighbourIds: ReadonlySet<string>,
): void {
  focused = focusId;
  neighbours = neighbourIds;
}

/** Which memory the pointer is on, lifting the edges that leave it. */
export function setLinkHover(hoverId: string | null): void {
  hovered = hoverId;
}

/** Full brightness unless something else is open and this edge is not part of it. */
function targetFocus(link: FocusLink | undefined): number {
  if (!link) return 1;
  // Hover wins over focus dimming: pointing at a receded memory is how you ask
  // to see what it connects to, so its edges have to come back for the moment.
  if (isLinkHovered(link, hovered)) return HOVERED;
  return isLinkLit(link, focused, neighbours) ? 1 : DIMMED;
}

export function buildLinkObject(): Object3D {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
  // 0 at the source end, 1 at the target, so pulses travel with the edge's
  // direction and the fragment stage can interpolate between them.
  geometry.setAttribute(
    "aProgress",
    new BufferAttribute(new Float32Array([0, 1]), 1),
  );
  const phase = Math.random();
  geometry.setAttribute(
    "aPhase",
    new BufferAttribute(new Float32Array([phase, phase]), 1),
  );
  geometry.setAttribute(
    "aFocus",
    new BufferAttribute(new Float32Array([1, 1]), 1),
  );

  const line = new Line(geometry, sharedMaterial());
  line.userData.focus = 1;
  return line;
}

/**
 * Keep a link's geometry on its endpoints as the simulation moves them, and
 * ease its brightness toward whatever the current focus calls for.
 *
 * Focus is applied here rather than from a focus-change effect because it
 * avoids holding a registry of live link objects: this already runs per link
 * per frame with the link in hand, so it cannot fall out of step with what is
 * actually on screen.
 */
export function updateLinkObject(
  object: Object3D,
  coords: { start: Endpoint; end: Endpoint },
  link?: FocusLink,
  /** How far to hold each end off its memory's centre, in world units. */
  trim?: { start: number; end: number },
): boolean {
  const { start, end } = coords;
  const geometry = (object as Line).geometry as BufferGeometry;
  const position = geometry.getAttribute("position") as BufferAttribute;

  /*
   * Stop at the surface, not the centre.
   *
   * Drawn centre to centre, every connection runs under its own memory and out
   * the far side, and a hub becomes a starburst with a visible point of
   * convergence sitting inside it - the one place on the canvas where the
   * drawing gives away that a node is a flat sprite with lines passing behind
   * it. Pulled back to each end's drawn radius, a connection arrives at the
   * shell and stops, and the memory reads as a solid thing the lines are
   * attached to.
   *
   * Nothing is drawn at all when the two are closer than their own radii: the
   * remaining line would be inside both of them, and a stub poking out of one
   * node into another is worse than no line for the moment they overlap.
   */
  const ax = start.x ?? 0;
  const ay = start.y ?? 0;
  const az = start.z ?? 0;
  const bx = end.x ?? 0;
  const by = end.y ?? 0;
  const bz = end.z ?? 0;

  let sx = ax;
  let sy = ay;
  let sz = az;
  let ex = bx;
  let ey = by;
  let ez = bz;

  if (trim) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gap = trim.start + trim.end;

    if (length > gap) {
      const ux = dx / length;
      const uy = dy / length;
      const uz = dz / length;
      sx = ax + ux * trim.start;
      sy = ay + uy * trim.start;
      sz = az + uz * trim.start;
      ex = bx - ux * trim.end;
      ey = by - uy * trim.end;
      ez = bz - uz * trim.end;
    } else {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const mz = (az + bz) / 2;
      sx = ex = mx;
      sy = ey = my;
      sz = ez = mz;
    }
  }

  position.setXYZ(0, sx, sy, sz);
  position.setXYZ(1, ex, ey, ez);
  position.needsUpdate = true;
  geometry.computeBoundingSphere();

  const focus = geometry.getAttribute("aFocus") as BufferAttribute;
  const current = (object.userData.focus as number) ?? 1;
  const wanted = targetFocus(link);
  const next = current + (wanted - current) * EASE;

  // Only touch the buffer while it is actually moving; once settled this is a
  // comparison per link per frame and nothing more.
  if (Math.abs(next - current) > 0.001) {
    object.userData.focus = next;
    focus.setX(0, next);
    focus.setX(1, next);
    focus.needsUpdate = true;
  }

  // Tells the renderer this object is positioned already and should be left
  // alone.
  return true;
}

/**
 * Repaint the links for a theme.
 *
 * The resting colour has to change with the background — a pale line that
 * reads as structure against near-black is invisible on white — while the
 * pulse keeps its own colour, since it is a signal rather than a surface.
 */
export function setPlasmaTheme(theme: "dark" | "light"): void {
  if (!material) return;
  material.uniforms.uColor.value = new Color(
    theme === "light" ? "#94A3B8" : "#BAC8DC",
  );
  // The pulse is a highlight on dark and has to become a darkening on light,
  // or it disappears into the page exactly where it is meant to draw the eye.
  material.uniforms.uPulseColor.value = new Color(
    theme === "light" ? "#0E7490" : "#7FF6FF",
  );
  material.uniforms.uBase.value = theme === "light" ? 0.7 : 0.55;
}

export function disposePlasma(): void {
  material?.dispose();
  material = null;
}
