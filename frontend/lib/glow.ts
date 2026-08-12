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
     * The disc used to be brightest at its centre and fade outward, which is
     * the profile of a glowing ball - lit from within, solid, and read by the
     * eye as a shiny object. A projected sphere does the opposite. You are
     * looking through it, so you see the least of it dead centre where the
     * shell is face-on and thin, and the most at the edge where your line of
     * sight runs along the shell for its whole length. That limb brightening is
     * the whole cue, and it costs one extra gradient stop.
     *
     * Nothing here is a specular highlight. A shine is an off-centre white
     * blob, and it says hard surface under a light; every stop below is the
     * memory's own hue, symmetrical, with the centre only lifted rather than
     * blown out. Light passes through this, it does not bounce off it.
     */
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    // Lit all the way through. Hollowing the middle out turns the node into a
    // ring with a hole in it, which is a portal, not a projection.
    gradient.addColorStop(0, `${color}B8`);
    gradient.addColorStop(0.18, `${color}A3`);
    /*
     * The limb, lifted only a little above the body.
     *
     * A projected sphere is brightest at its edge, where your line of sight
     * runs along the shell for its whole length rather than crossing it once.
     * The lift has to stay small: push it and the node stops being a sphere
     * and becomes a neon ring, which is the loudest thing on a dark canvas and
     * exactly the shine this is meant to lose.
     */
    gradient.addColorStop(0.4, `${color}E0`);
    gradient.addColorStop(0.5, `${color}5C`);
    // Bloom, so it sits in the scene rather than being cut out of it.
    gradient.addColorStop(0.72, `${color}1A`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fill();

    /*
     * The silhouette, drawn as a line.
     *
     * A gradient alone has no edge, it just runs out, and a node without an
     * edge is a smudge. Faint enough to be a boundary rather than an outline.
     */
    ctx.strokeStyle = `${color}59`;
    ctx.lineWidth = GLOW_SIZE * 0.014;
    ctx.beginPath();
    ctx.arc(half, half, half * 0.44, 0, Math.PI * 2);
    ctx.stroke();

    /*
     * Scan lines, clipped inside the shell.
     *
     * What separates a projection from a marble: a hologram is built out of
     * light in rows and shows it. Drawn in the background's own colour rather
     * than the memory's, so they read as the gaps between rows instead of
     * extra light, and kept at the very bottom of visible - any stronger and a
     * canvas of them is a moire field rather than a graph.
     */
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half * 0.44, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(10, 8, 20, 0.22)";
    const step = GLOW_SIZE * 0.042;
    for (let y = half * 0.56; y < half * 1.44; y += step) {
      ctx.fillRect(0, y, GLOW_SIZE, GLOW_SIZE * 0.009);
    }
    ctx.restore();
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
