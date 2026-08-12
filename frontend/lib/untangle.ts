/**
 * Untangling: one press, and the graph settles into something readable.
 *
 * The live simulation is tuned to keep breathing, which is what makes it feel
 * alive and also what stops it ever fully resolving - it is nudged by drift,
 * reheated by every drag, and never allowed to cool. So memories end up
 * sitting on each other and connections end up longer than they need to be.
 * This runs the same kind of layout properly instead: offscreen, cooled all
 * the way down, and then moved into.
 *
 * No imposed geometry. An earlier version laid the graph out as a radial tree
 * and it was worse in exactly the way a drawn shape always is - a hub with
 * thirty spokes became one enormous ring, and every connection that was not
 * part of the tree got drawn straight across the middle of it. What is left is
 * only three rules, all local:
 *
 * - connections pull, and they are short
 * - everything pushes everything nearby away
 * - nothing is allowed to overlap anything
 *
 * Clusters gather because their members pull on each other harder than on
 * anything else, and the picture is compact because the springs are short.
 * Whatever shape comes out is the graph's own.
 *
 * It starts from where the memories already are, so the arrangement you get is
 * recognisably the one you were looking at, tidied - not a new picture you
 * have to re-learn.
 */

import type { PositionedNode } from "./force-graph";
import { endpointId, type GraphEdge } from "./types";

/** Resting length of a connection between two average memories. */
export const LINK_DISTANCE = 68;

/** How hard a spring pulls per iteration. Above ~0.5 the solver oscillates. */
const LINK_STRENGTH = 0.35;

/**
 * Push between memories, and how far it reaches.
 *
 * Tuned against the springs rather than picked: too strong and connected
 * memories sit far apart with the links stretched between them, which is the
 * sprawl this is meant to fix. Kept just high enough to open up a crowd.
 */
const REPULSION = 90;
const REPULSION_RANGE = 165;

/**
 * The same range, shortened once the graph is dense enough for it to matter.
 *
 * The grid makes repulsion cost neighbours-in-range rather than nodes, which
 * only helps while a range holds a handful of memories. Packed tight, a
 * 150-unit circle holds dozens, and each is consulted every iteration for no
 * benefit - the force at that distance is a rounding error next to the near
 * neighbours. Shortening it is what keeps a big graph from costing seconds.
 */
function rangeFor(nodeCount: number): number {
  return nodeCount > 600 ? 90 : REPULSION_RANGE;
}

/**
 * Clear space around a memory, before its own size is added.
 *
 * This is the floor nothing may cross, so it is what guarantees a label has
 * somewhere to sit even where the graph is at its most crowded.
 */
const COLLIDE_PADDING = 24;

/** Pull toward the centroid, which is the only thing keeping it compact. */
const CENTERING = 0.012;

/**
 * How far one memory may be pushed in a single iteration.
 *
 * Repulsion falls off with the square of distance, so a pair that starts
 * almost coincident sees an effectively unbounded force and leaves at speed.
 * Without this a large graph does not settle, it detonates - measured at a
 * radius of 51,000 units for three thousand memories, against the 2,000 it
 * started from.
 */
const MAX_PUSH = 24;

/** Enough for a graph to stop moving. Scaled down for larger ones by `budget`. */
const ITERATIONS = 420;

/**
 * Iterations to spend, given how much there is to lay out.
 *
 * This runs synchronously and nothing can be drawn while it does, so the cost
 * is a frozen window the user is staring at. Held to roughly a third of a
 * second: below that a press feels instant, above it feels broken. Small
 * graphs converge long before the budget runs out anyway.
 */
function budget(nodeCount: number): number {
  if (nodeCount <= 400) return ITERATIONS;
  return Math.max(50, Math.round((ITERATIONS * 400) / nodeCount));
}

export interface UntangledLayout {
  positions: Map<string, { x: number; y: number; z: number }>;
  /** Distance from the origin to the furthest memory, for framing. */
  radius: number;
}

interface Body {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Half the space this memory needs, derived from how connected it is. */
  size: number;
  /** Heavier hubs move less, so a spoke swings around the hub, not the other
   *  way round - the same reason the renderer draws them bigger. */
  weight: number;
}

/**
 * Whether the graph being laid out is the one drawn in space.
 *
 * Asked of the nodes rather than passed down from the route: the 3D renderer
 * is what puts a `z` on them, so the nodes already know, and threading a flag
 * from the router through the bar and two hooks would only be a second source
 * of the same truth waiting to disagree.
 *
 * Everything below is written in three dimensions regardless. In a flat graph
 * every body starts at `z = 0`, and since every force acts along the vector
 * between two bodies, no z difference is ever created - the third dimension
 * stays exactly zero on its own rather than by special-casing. The 2D
 * arrangement is unchanged, to the last decimal.
 */
export function isSpatial(nodes: PositionedNode[]): boolean {
  return nodes.some((node) => node.z !== undefined);
}

export function degreesOf(links: GraphEdge[]): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const link of links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (source === target) continue;
    degrees.set(source, (degrees.get(source) ?? 0) + 1);
    degrees.set(target, (degrees.get(target) ?? 0) + 1);
  }
  return degrees;
}

/** Matches the renderer's own sizing, so spacing tracks what is on screen. */
export function sizeFor(degree: number): number {
  return 5 + Math.sqrt(degree) * 3.4;
}

/**
 * Repulsion, over a uniform grid rather than every pair.
 *
 * The force dies off with distance anyway, so pairs beyond its range
 * contribute nothing and only cost time. Bucketing by the cutoff means each
 * memory consults its own neighbourhood, which keeps a press instant on a
 * graph far larger than this one - all-pairs would be a visible freeze
 * somewhere past a thousand memories.
 */
function repel(bodies: Body[], alpha: number, range: number): void {
  const cell = range;
  const buckets = new Map<string, Body[]>();

  for (const body of bodies) {
    const key = `${Math.floor(body.x / cell)},${Math.floor(body.y / cell)},${Math.floor(body.z / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(body);
    else buckets.set(key, [body]);
  }

  for (const body of bodies) {
    const gx = Math.floor(body.x / cell);
    const gy = Math.floor(body.y / cell);
    const gz = Math.floor(body.z / cell);

    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const others = buckets.get(`${gx + ox},${gy + oy},${gz + oz}`);
          if (!others) continue;

          for (const other of others) {
            // Each unordered pair is handled once, by the lower id.
            if (other.id <= body.id) continue;

            let dx = other.x - body.x;
            let dy = other.y - body.y;
            let dz = other.z - body.z;
            let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // Exactly coincident memories have no direction to separate along,
            // so one is nudged deterministically rather than left stacked.
            if (distance === 0) {
              dx = 0.01;
              dy = 0;
              dz = 0;
              distance = 0.01;
            }
            if (distance > range) continue;

            const push = Math.min(
              ((REPULSION * alpha) / (distance * distance)) * cell,
              MAX_PUSH * alpha,
            );
            const ux = (dx / distance) * push;
            const uy = (dy / distance) * push;
            const uz = (dz / distance) * push;
            const total = body.weight + other.weight;

            // Split by weight, so the lighter of the two does more of the
            // moving.
            body.x -= (ux * other.weight) / total;
            body.y -= (uy * other.weight) / total;
            body.z -= (uz * other.weight) / total;
            other.x += (ux * body.weight) / total;
            other.y += (uy * body.weight) / total;
            other.z += (uz * body.weight) / total;
          }
        }
      }
    }
  }
}

/** Hard separation, run after the soft forces so nothing ends up overlapping. */
function separate(bodies: Body[]): void {
  const cell = 90;
  const buckets = new Map<string, Body[]>();

  for (const body of bodies) {
    const key = `${Math.floor(body.x / cell)},${Math.floor(body.y / cell)},${Math.floor(body.z / cell)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(body);
    else buckets.set(key, [body]);
  }

  for (const body of bodies) {
    const gx = Math.floor(body.x / cell);
    const gy = Math.floor(body.y / cell);
    const gz = Math.floor(body.z / cell);

    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let oz = -1; oz <= 1; oz += 1) {
          const others = buckets.get(`${gx + ox},${gy + oy},${gz + oz}`);
          if (!others) continue;

          for (const other of others) {
            if (other.id <= body.id) continue;

            const minimum = body.size + other.size + COLLIDE_PADDING;
            let dx = other.x - body.x;
            let dy = other.y - body.y;
            let dz = other.z - body.z;
            let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance === 0) {
              dx = 0.01;
              dy = 0;
              dz = 0;
              distance = 0.01;
            }
            if (distance >= minimum) continue;

            const overlap = (minimum - distance) / 2;
            const ux = (dx / distance) * overlap;
            const uy = (dy / distance) * overlap;
            const uz = (dz / distance) * overlap;
            body.x -= ux;
            body.y -= uy;
            body.z -= uz;
            other.x += ux;
            other.y += uy;
            other.z += uz;
          }
        }
      }
    }
  }
}

/**
 * Lay the graph out, offscreen and to convergence.
 *
 * Synchronous on purpose: at this size it is a few milliseconds, and the
 * result is needed whole before anything can be animated toward it.
 */
export function computeUntangledLayout(
  nodes: PositionedNode[],
  links: GraphEdge[],
): UntangledLayout {
  const positions = new Map<string, { x: number; y: number; z: number }>();
  if (nodes.length === 0) return { positions, radius: 0 };

  const degrees = degreesOf(links);
  const spatial = isSpatial(nodes);
  /*
   * Whether the graph in space has any depth to preserve yet.
   *
   * Starting from where things already are is the right instinct, but a 3D
   * graph whose nodes all sit at one depth - a scene that has not been
   * simulated yet, or one flattened by an earlier untangling - gives every
   * body the same z, and no force here can invent a difference that is not
   * there. It would settle into a perfect sheet and the press would look
   * broken. Seeding depth in that case is the only way out of the plane.
   */
  const flattened =
    spatial && nodes.every((node) => Math.abs(node.z ?? 0) < 1e-6);

  /*
   * Start from where things already are.
   *
   * The forces below are all local, so the arrangement they reach is the one
   * nearest to what is on screen - which is the point. Anything that has never
   * been drawn gets a spot on a phyllotaxis spiral instead of the origin:
   * seeding a batch of memories at one point leaves repulsion with no
   * direction to separate them along, and they come apart in a visible burst.
   */
  const bodies: Body[] = nodes.map((node, index) => {
    const angle = Math.PI * (3 - Math.sqrt(5)) * index;
    const spiral = Math.sqrt(index) * LINK_DISTANCE * 0.9;
    const degree = degrees.get(node.id) ?? 0;

    return {
      id: node.id,
      x: node.x ?? Math.cos(angle) * spiral,
      y: node.y ?? Math.sin(angle) * spiral,
      /*
       * Depth is kept in space and dropped on the flat canvas.
       *
       * A flat graph seeds every body at zero, and since no force below ever
       * introduces a z difference where there is none, it stays a plane
       * without being told to. In space, a memory that has never been drawn
       * needs a depth that is not zero for the same reason it needs an x and a
       * y: a sheet of new memories at one depth is a sheet repulsion can only
       * spread sideways, which is precisely the flat fan this fixes.
       */
      z:
        spatial && (flattened || node.z === undefined)
          ? Math.sin(angle * 1.7) * spiral * 0.6
          : (node.z ?? 0),
      size: sizeFor(degree),
      // Square-rooted, so a hub with thirty connections is heavier than a leaf
      // without being immovable.
      weight: 1 + Math.sqrt(degree),
    };
  });

  const byId = new Map(bodies.map((body) => [body.id, body]));

  // Resolved once: the endpoints are ids or node objects depending on whether
  // the simulation has swapped them, and neither is worth re-checking inside
  // the loop.
  const springs = links
    .map((link) => {
      const source = byId.get(endpointId(link.source));
      const target = byId.get(endpointId(link.target));
      if (!source || !target || source === target) return null;
      // Measured centre to centre, so a link has to clear both ends - without
      // this a hub's neighbours sit inside its own disc.
      const rest = LINK_DISTANCE + source.size + target.size;
      return { source, target, rest };
    })
    .filter((spring): spring is NonNullable<typeof spring> => spring !== null);

  const iterations = budget(bodies.length);
  const range = rangeFor(bodies.length);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    // Linear cooling. Early iterations move things far, later ones only tidy,
    // which is what stops the solver oscillating around a solution.
    const alpha = 1 - iteration / iterations;

    for (const { source, target, rest } of springs) {
      let dx = target.x - source.x;
      let dy = target.y - source.y;
      let dz = target.z - source.z;
      let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance === 0) {
        dx = 0.01;
        dy = 0;
        dz = 0;
        distance = 0.01;
      }

      const shift = ((distance - rest) / distance) * LINK_STRENGTH * alpha;
      const total = source.weight + target.weight;
      source.x += dx * shift * (target.weight / total);
      source.y += dy * shift * (target.weight / total);
      source.z += dz * shift * (target.weight / total);
      target.x -= dx * shift * (source.weight / total);
      target.y -= dy * shift * (source.weight / total);
      target.z -= dz * shift * (source.weight / total);
    }

    repel(bodies, alpha, range);

    /*
     * Gather toward the centroid, not toward the origin.
     *
     * Toward a fixed point it would fight the component placement and drag
     * everything into one pile; relative to the graph's own centre it only
     * takes up the slack repulsion leaves behind, which is what keeps the
     * picture compact instead of sprawling.
     */
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const body of bodies) {
      cx += body.x;
      cy += body.y;
      cz += body.z;
    }
    cx /= bodies.length;
    cy /= bodies.length;
    cz /= bodies.length;

    for (const body of bodies) {
      body.x += (cx - body.x) * CENTERING * alpha;
      body.y += (cy - body.y) * CENTERING * alpha;
      body.z += (cz - body.z) * CENTERING * alpha;
    }

    separate(bodies);
  }

  // Centre the finished layout, so it arrives where the camera already is.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const body of bodies) {
    cx += body.x;
    cy += body.y;
    cz += body.z;
  }
  cx /= bodies.length;
  cy /= bodies.length;
  cz /= bodies.length;

  let radius = 0;
  for (const body of bodies) {
    const x = body.x - cx;
    const y = body.y - cy;
    const z = body.z - cz;
    positions.set(body.id, { x, y, z });
    radius = Math.max(radius, Math.sqrt(x * x + y * y + z * z));
  }

  return { positions, radius };
}

/** Cubic ease, so the graph leaves and arrives without a jolt. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export const UNTANGLE_MS = 1100;

/**
 * Move the graph into an arrangement, then hand it back to the simulation.
 *
 * Nodes are eased from wherever they are rather than snapped: the whole value
 * of the gesture is watching which memory belongs to which cluster, and that
 * is only legible if you can follow each one travelling.
 *
 * Pinned for the journey and released on arrival. The pin is only there to
 * stop the live forces dragging at nodes while they travel - keeping it
 * afterwards would freeze the graph solid, and a canvas that no longer
 * breathes or yields when you push it reads as broken rather than as tidy.
 * Released, the layout stays where it was put: the simulation has long since
 * cooled, so what is left is drift and whatever you do to it by hand.
 *
 * Returns a cancel function; calling it leaves the nodes wherever they got to
 * and releases them there, which is the right outcome for an interrupted
 * press - anything else would strand them pinned mid-flight.
 */
export function animateToLayout(
  nodes: PositionedNode[],
  positions: Map<string, { x: number; y: number; z: number }>,
  { onFrame, onDone }: { onFrame?: () => void; onDone?: () => void } = {},
): () => void {
  const moving = nodes
    .map((node) => {
      const target = positions.get(node.id);
      if (!target) return null;
      return {
        node,
        fromX: node.x ?? target.x,
        fromY: node.y ?? target.y,
        fromZ: node.z ?? target.z,
        target,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (moving.length === 0) {
    onDone?.();
    return () => undefined;
  }

  const start = performance.now();
  let frame = 0;
  let cancelled = false;

  /** Give every node back to the simulation, wherever it currently sits. */
  const release = () => {
    for (const { node } of moving) {
      node.fx = undefined;
      node.fy = undefined;
      node.fz = undefined;
    }
  };

  const step = (now: number) => {
    if (cancelled) return;
    const t = Math.min((now - start) / UNTANGLE_MS, 1);
    const k = ease(t);

    for (const { node, fromX, fromY, fromZ, target } of moving) {
      const x = fromX + (target.x - fromX) * k;
      const y = fromY + (target.y - fromY) * k;
      node.x = x;
      node.y = y;
      node.fx = x;
      node.fy = y;
      /*
       * Depth travels like everything else.
       *
       * This used to ease `z` to zero unconditionally, because both
       * arrangements were planes and a node keeping its old depth would have
       * floated off the surface. Now the arrangement carries its own depth -
       * zero for the flat canvas, a real one in space - so the node is moved
       * to it rather than flattened onto a sheet, which is what made an
       * untangled 3D graph a cardboard cut-out seen edge-on.
       */
      if (node.z !== undefined) {
        const z = fromZ + (target.z - fromZ) * k;
        node.z = z;
        node.fz = z;
      }
    }

    onFrame?.();

    if (t < 1) {
      frame = requestAnimationFrame(step);
      return;
    }

    release();
    onDone?.();
  };

  frame = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    release();
  };
}
