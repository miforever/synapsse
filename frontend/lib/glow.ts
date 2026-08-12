/**
 * The soft radial disc used for nodes, shared by both renderers.
 *
 * 3D wraps it in a texture; 2D blits it straight onto the canvas. Keeping one
 * source means a node looks like the same object in either view, and 2D stops
 * reading as flat vector circles next to the lit 3D sprites.
 *
 * Cached per colour — building a gradient per node per frame would be the
 * single most expensive thing in the 2D paint path.
 */

const cache = new Map<string, HTMLCanvasElement>();

/** Discs are drawn differently per theme, so the theme is part of the key. */
let theme: "dark" | "light" = "dark";

export function setGlowTheme(next: "dark" | "light"): void {
  theme = next;
}

export const GLOW_SIZE = 128;

/** Tilt toward the viewer. Straight on, every parallel is a flat line and the
 *  node is a striped disc rather than a sphere. */
const TILT = 0.34;

/**
 * A globe's wireframe, drawn inside a node: meridians sharing the poles,
 * parallels crowding as they climb. Few lines on purpose - this is 128px and
 * seen at a fraction of it, and a full graticule shrinks into haze.
 *
 * Built once per colour, like the disc it sits in, so it costs nothing per
 * frame.
 */
function graticule(
  ctx: CanvasRenderingContext2D,
  centre: number,
  radius: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.clip();

  // White, not the memory's hue: the body is already near full colour, so a
  // grid in that same hue has nothing to be brighter than.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = GLOW_SIZE * 0.0095;

  // Meridians: as tall as the sphere, as wide as their own longitude.
  for (const longitude of [Math.PI / 4, Math.PI / 2.4]) {
    ctx.beginPath();
    ctx.ellipse(
      centre,
      centre,
      radius * Math.sin(longitude),
      radius,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  // The one facing you has no width left to be an ellipse.
  ctx.beginPath();
  ctx.moveTo(centre, centre - radius);
  ctx.lineTo(centre, centre + radius);
  ctx.stroke();

  // Parallels: each at the height of its latitude, as wide as the sphere is
  // there - which is what crowds them toward the poles instead of stacking
  // them like rungs.
  for (const latitude of [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]) {
    const width = radius * Math.cos(latitude);
    ctx.beginPath();
    ctx.ellipse(
      centre,
      centre - radius * Math.sin(latitude) * Math.cos(TILT),
      width,
      width * Math.sin(TILT),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  ctx.restore();
}

export function glowCanvas(color: string): HTMLCanvasElement | null {
  const key = `${theme}:${color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = GLOW_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const half = GLOW_SIZE / 2;

  if (theme === "light") {
    /*
     * A solid token, not a light source.
     *
     * The dark node is a glow, and a glow needs darkness to glow into — on
     * white every falloff is just the node going out of focus. So the light
     * disc has no falloff at all: flat colour to a clean edge, with a slightly
     * darker rim so it still reads as an object where two nodes overlap.
     */
    const radius = half * 0.82;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(half, half, radius, 0, Math.PI * 2);
    ctx.fill();

    // Its own colour at low alpha over the fill, which darkens the edge
    // without introducing a second hue.
    ctx.strokeStyle = "rgba(15, 23, 42, 0.22)";
    ctx.lineWidth = GLOW_SIZE * 0.02;
    ctx.beginPath();
    ctx.arc(half, half, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    /*
     * A hologram, not a bead.
     *
     * Brightest at the centre is the profile of a lit ball, and reads as a
     * shiny object. A projected sphere is brightest at the limb, where the line
     * of sight runs along the shell instead of crossing it. No specular
     * anywhere: a shine is an off-centre white blob, and every stop here is the
     * memory's own hue, symmetrical.
     */
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    // Lit all the way through - hollowing the middle turns the node into a ring
    // with a hole in it.
    gradient.addColorStop(0, `${color}9E`);
    gradient.addColorStop(0.18, `${color}8F`);
    // The limb, lifted only a little: push it and the sphere becomes a neon
    // ring, which is the loudest thing on a dark canvas.
    gradient.addColorStop(0.4, `${color}E0`);
    gradient.addColorStop(0.5, `${color}5C`);
    // Bloom, so it sits in the scene rather than being cut out of it.
    gradient.addColorStop(0.72, `${color}1A`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fill();

    // A gradient has no edge, it just runs out, and a node without one is a
    // smudge. Faint enough to be a boundary rather than an outline.
    ctx.strokeStyle = `${color}59`;
    ctx.lineWidth = GLOW_SIZE * 0.014;
    ctx.beginPath();
    ctx.arc(half, half, half * 0.44, 0, Math.PI * 2);
    ctx.stroke();

    graticule(ctx, half, half * 0.44);
  }

  cache.set(key, canvas);
  return canvas;
}

const rings = new Map<string, HTMLCanvasElement>();

/**
 * A thin ring, for marking the node under the pointer.
 *
 * Deliberately not another gradient. The node discs are already soft-edged, so
 * a second soft shape around one just doubles the bloom and the node washes
 * out into a cloud — which is exactly what a hovered node must not do. A
 * stroked circle stays a defined edge at any camera distance, and the small
 * falloff either side of the stroke is only there to stop it aliasing.
 */
export function ringCanvas(color: string): HTMLCanvasElement | null {
  const cached = rings.get(`${theme}:${color}`);
  if (cached) return cached;

  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = GLOW_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const half = GLOW_SIZE / 2;
  /*
   * Well inside the texture's edge.
   *
   * The disc it marks is a soft gradient whose visible body ends around a
   * third of the way out, so a ring drawn near the texture edge reads as a
   * circle floating around a node rather than as that node's own outline.
   */
  const radius = half * 0.62;

  ctx.strokeStyle = color;
  ctx.lineWidth = GLOW_SIZE * 0.03;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(half, half, radius, 0, Math.PI * 2);
  ctx.stroke();

  rings.set(`${theme}:${color}`, canvas);
  return canvas;
}

export function clearGlowCache(): void {
  cache.clear();
  rings.clear();
}
