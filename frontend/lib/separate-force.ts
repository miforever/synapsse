/**
 * Keeps memories from sitting on top of each other.
 *
 * Repulsion alone cannot do this job. It falls off with distance, so the only
 * way to guarantee clearance with charge is to push hard everywhere — which is
 * exactly what spreads the graph into a thin, sparse ring. A separation pass
 * is the opposite trade: it does nothing at all until two memories actually
 * overlap, which lets the link lengths come right down without anything
 * colliding. Compactness comes from short links; legibility comes from here.
 *
 * This is d3.forceCollide in spirit, hand-rolled because d3-force is not a
 * direct dependency — the renderer bundles its own copy, and reaching into it
 * is not part of the supported surface.
 */

interface SimNode {
  id: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
}

interface SeparateForce {
  (alpha: number): void;
  initialize?: (nodes: SimNode[]) => void;
}

interface Options {
  /** Clearance each memory wants around itself, in graph units. */
  radius: (node: SimNode) => number;
  /** 3 separates in depth as well; 2 leaves it alone. */
  dimensions?: 2 | 3;
  /**
   * How much of an overlap to resolve per tick. Below 1 so a pair eases apart
   * over a few frames instead of snapping, which reads as a jolt.
   */
  strength?: number;
}

export function createSeparateForce({
  radius,
  dimensions = 2,
  strength = 0.55,
}: Options): SeparateForce {
  let nodes: SimNode[] = [];
  let radii: number[] = [];

  const force: SeparateForce = (alpha: number) => {
    if (nodes.length === 0) return;

    const spatial = dimensions === 3;
    /*
     * Deliberately unscaled by alpha, unlike the gather force.
     *
     * Overlap is a hard visual failure, not a preference the layout can cool
     * out of — two memories drawn on top of each other stay unreadable however
     * settled the graph is. This is safe where an alpha-free *centering* pull
     * was not, because separation only ever acts on a pair that is already too
     * close and stops the instant they clear. It cannot accumulate.
     */
    void alpha;

    /*
     * Every pair, which is O(n²).
     *
     * Affordable because it only runs on what the renderer already draws, and
     * the inner test is two subtractions and a compare. If stores grow past a
     * few thousand memories this wants a grid, but a quadtree here would cost
     * more to build each tick than it saves at the sizes we see.
     */
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ax = a.x ?? 0;
      const ay = a.y ?? 0;
      const az = a.z ?? 0;

      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = (b.x ?? 0) - ax;
        const dy = (b.y ?? 0) - ay;
        const dz = spatial ? (b.z ?? 0) - az : 0;

        const wanted = radii[i] + radii[j];
        const squared = dx * dx + dy * dy + dz * dz;
        if (squared >= wanted * wanted) continue;

        /*
         * Two memories exactly on top of each other have no direction to
         * separate along, and normalising a zero vector yields NaN — which
         * propagates into the position and removes the node from the canvas
         * permanently. Nudge along a fixed axis instead; the next tick has a
         * real direction to work with.
         */
        const distance = Math.sqrt(squared) || 0.0001;
        const push = ((wanted - distance) / distance) * strength * 0.5;

        const sx = dx * push;
        const sy = dy * push;
        const sz = dz * push;

        // A memory placed by hand stays where it was put.
        if (a.fx === undefined) {
          a.vx = (a.vx ?? 0) - sx;
          a.vy = (a.vy ?? 0) - sy;
          if (spatial) a.vz = (a.vz ?? 0) - sz;
        }
        if (b.fx === undefined) {
          b.vx = (b.vx ?? 0) + sx;
          b.vy = (b.vy ?? 0) + sy;
          if (spatial) b.vz = (b.vz ?? 0) + sz;
        }
      }
    }
  };

  force.initialize = (next: SimNode[]) => {
    nodes = next;
    // Cached per node rather than recomputed in the inner loop: the radius
    // comes from a degree lookup, and at O(n²) pairs that is the difference
    // between one map read per node and a million.
    radii = nodes.map((node) => radius(node));
  };

  return force;
}
