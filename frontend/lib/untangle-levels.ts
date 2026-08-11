/**
 * The other untangling: rings by how far a memory sits from the busiest one.
 *
 * Where the loose arrangement lets the graph find its own shape, this one
 * makes a claim and draws it: the most connected memory in the middle, its
 * direct connections around it, theirs outside those. Distance from the centre
 * is distance through the graph, and nothing else. It answers a question the
 * organic layout cannot - what is close to the heart of this, and what is out
 * at the edges - at the cost of imposing a structure that is not really there.
 *
 * Two things stop it becoming the enormous ring a naive radial layout draws:
 *
 * - **Banding.** A level with more memories than its ring can seat is split
 *   across two or three closer rings rather than pushed out to whatever radius
 *   would fit them all in one. Thirty spokes become a thick band, not a
 *   racetrack with the middle empty.
 *
 * - **Angular relaxation.** Every memory may slide around its own ring, but
 *   never off it. Sliding is enough to bring connected memories into line with
 *   each other, so a cluster ends up in one sector instead of scattered around
 *   the circle with its edges cutting across the middle - which is the whole
 *   reason radial layouts usually look like string art.
 *
 * The rings survive because the radius is never relaxed. Only the angle is.
 */

import { degreesOf, LINK_DISTANCE, sizeFor, type UntangledLayout } from "./untangle";
import type { PositionedNode } from "./force-graph";
import { endpointId, type GraphEdge } from "./types";

/** Gap between one ring and the next. */
const RING_GAP = 92;

/** Space to leave along a ring for one memory, before its own size. */
const ARC_PADDING = 30;

/** A level wider than this many memories is split into bands. */
const MAX_BAND = 14;

/**
 * The least a ring may sit outside the one before it.
 *
 * Separation is enforced along a ring, never across two, so rings that end up
 * at nearly the same radius can put two memories in the same place and nothing
 * will notice - measured at 0.2 units apart before this existed, from two
 * bands that landed one unit apart. Wide enough here for the largest hub and
 * its neighbour to clear each other whatever their bearings.
 */
const MIN_RING_GAP = 58;

/** Passes of angular tidying. Cheap: each is a walk over the edges. */
const RELAX_PASSES = 260;

/** How far toward its neighbours' average bearing a memory moves per pass. */
const PULL = 0.14;

/** Spacing-only sweeps once the bearings have stopped moving. */
const SETTLE_PASSES = 60;

interface Seat {
  id: string;
  /** Fixed by the level. This is what makes the rings rings. */
  radius: number;
  /** The only degree of freedom. */
  angle: number;
  size: number;
  /** Hubs hold their bearing, so their satellites gather around them. */
  weight: number;
}

function adjacencyOf(links: GraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const connect = (from: string, to: string) => {
    let neighbours = adjacency.get(from);
    if (!neighbours) {
      neighbours = new Set();
      adjacency.set(from, neighbours);
    }
    neighbours.add(to);
  };

  for (const link of links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (source === target) continue;
    connect(source, target);
    connect(target, source);
  }
  return adjacency;
}

/**
 * Fold an angle back into [0, 2pi).
 *
 * Bearings accumulate as memories are pulled around, so they drift outside a
 * turn - and two that are neighbours on screen can end up as 0.1 and 6.38,
 * which sort to opposite ends of the ring. Separation then compares pairs that
 * are nowhere near each other and leaves the ones that are stacked untouched.
 */
function wrap(angle: number): number {
  const turn = 2 * Math.PI;
  return ((angle % turn) + turn) % turn;
}

/** Shortest angular distance from a to b, signed, in radians. */
function bearingDelta(from: number, to: number): number {
  let delta = (to - from) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * Rank every memory by how many steps it is from the centre.
 *
 * Breadth-first from the most connected memory, so the level a memory lands on
 * is its true distance rather than an artefact of which branch was walked
 * first. Anything the search cannot reach - a separate island, a memory with
 * no connections at all - is parked on a level of its own beyond the last, so
 * it is visibly outside the structure rather than pretending to a place in it.
 */
function levelsFrom(
  nodes: PositionedNode[],
  adjacency: Map<string, Set<string>>,
  degrees: Map<string, number>,
): { levels: string[][]; parents: Map<string, string> } {
  const known = new Set(nodes.map((node) => node.id));
  const degree = (id: string) => degrees.get(id) ?? 0;

  const root = nodes.reduce((best, node) =>
    degree(node.id) > degree(best.id) ||
    (degree(node.id) === degree(best.id) && node.id < best.id)
      ? node
      : best,
  ).id;

  const levels: string[][] = [[root]];
  const parents = new Map<string, string>();
  const seen = new Set([root]);
  let frontier = [root];

  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      // Sorted, so the same graph always produces the same picture.
      for (const neighbour of [...(adjacency.get(id) ?? [])].sort()) {
        if (!known.has(neighbour) || seen.has(neighbour)) continue;
        seen.add(neighbour);
        parents.set(neighbour, id);
        next.push(neighbour);
      }
    }
    if (next.length > 0) levels.push(next);
    frontier = next;
  }

  const stranded = nodes.filter((node) => !seen.has(node.id)).map((n) => n.id);
  if (stranded.length > 0) levels.push(stranded.sort());

  return { levels, parents };
}

export function computeLevelLayout(
  nodes: PositionedNode[],
  links: GraphEdge[],
): UntangledLayout {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return { positions, radius: 0 };

  const adjacency = adjacencyOf(links);
  const degrees = degreesOf(links);
  const { levels, parents } = levelsFrom(nodes, adjacency, degrees);

  const seats = new Map<string, Seat>();
  let outermost = 0;
  // Rings are laid outward one at a time, each clearing the last, so a band
  // that needs a wide circumference pushes everything after it out rather than
  // landing on top of a ring that was placed by depth alone.
  let previous = 0;

  levels.forEach((level, depth) => {
    if (depth === 0) {
      const id = level[0];
      seats.set(id, {
        id,
        radius: 0,
        angle: 0,
        size: sizeFor(degrees.get(id) ?? 0),
        weight: 1 + Math.sqrt(degrees.get(id) ?? 0),
      });
      return;
    }

    /*
     * Order each level by where its parent sits.
     *
     * A memory placed next to its parent's bearing has a short link; placed
     * anywhere else it has one crossing the disc. Since the level above is
     * already seated when this runs, sorting by parent angle is enough to make
     * every branch leave the centre in one direction and stay there.
     */
    const ordered = [...level].sort((a, b) => {
      const pa = seats.get(parents.get(a) ?? "")?.angle ?? 0;
      const pb = seats.get(parents.get(b) ?? "")?.angle ?? 0;
      return pa - pb || (a < b ? -1 : 1);
    });

    // Split into bands so a crowded level thickens instead of ballooning.
    const bands = Math.max(1, Math.ceil(ordered.length / MAX_BAND));
    const perBand = Math.ceil(ordered.length / bands);

    for (let band = 0; band < bands; band += 1) {
      const members = ordered.slice(band * perBand, (band + 1) * perBand);
      if (members.length === 0) continue;

      // Wide enough that the members seat without touching, and never inside
      // the ring before it.
      const needed = (members.length * ARC_PADDING * 2) / (2 * Math.PI);
      const base = (depth - 1) * RING_GAP + LINK_DISTANCE;
      const radius = Math.max(base, needed, previous + MIN_RING_GAP);
      previous = radius;
      outermost = Math.max(outermost, radius);

      members.forEach((id, index) => {
        const parent = seats.get(parents.get(id) ?? "");
        const spread = (index / members.length) * 2 * Math.PI;
        seats.set(id, {
          id,
          radius,
          // Seeded near the parent where there is one, so relaxation starts
          // from something already roughly right.
          angle: parent && parent.radius > 0 ? parent.angle + spread * 0.15 : spread,
          size: sizeFor(degrees.get(id) ?? 0),
          weight: 1 + Math.sqrt(degrees.get(id) ?? 0),
        });
      });
    }
  });

  const movable = [...seats.values()].filter((seat) => seat.radius > 0);

  // Resolved once rather than per pass.
  const pairs = links
    .map((link) => {
      const a = seats.get(endpointId(link.source));
      const b = seats.get(endpointId(link.target));
      if (!a || !b || a === b) return null;
      return { a, b };
    })
    .filter((pair): pair is NonNullable<typeof pair> => pair !== null);

  const byRing = new Map<number, Seat[]>();
  for (const seat of movable) {
    const ring = byRing.get(seat.radius);
    if (ring) ring.push(seat);
    else byRing.set(seat.radius, [seat]);
  }

  /**
   * Push apart anything bunched on the same ring.
   *
   * Measured as an arc rather than a straight line, because that is the only
   * direction anything can move here - and without it the pull below happily
   * stacks a whole branch on one bearing.
   */
  const separate = () => {
    for (const ring of byRing.values()) {
      if (ring.length < 2) continue;
      // Canonical before sorting, or the order is not the order round the ring.
      for (const seat of ring) seat.angle = wrap(seat.angle);
      ring.sort((first, second) => first.angle - second.angle);

      for (let i = 0; i < ring.length; i += 1) {
        const seat = ring[i];
        const next = ring[(i + 1) % ring.length];
        const gap = bearingDelta(seat.angle, next.angle);
        // The wrap-around pair reads as a negative or zero gap; a full turn is
        // what it actually has between it and itself.
        const arc =
          ring.length === 2 && i === 1
            ? Math.PI
            : gap <= 0
              ? gap + 2 * Math.PI
              : gap;
        const needed = (seat.size + next.size + ARC_PADDING) / seat.radius;
        if (arc >= needed) continue;

        const push = (needed - arc) / 2;
        seat.angle -= push;
        next.angle += push;
      }
    }
  };

  for (let pass = 0; pass < RELAX_PASSES; pass += 1) {
    const alpha = 1 - pass / RELAX_PASSES;

    /*
     * Draw connected memories into the same sector.
     *
     * Only the angle moves, and only by the shortest way round - taking the
     * long way would send a memory sliding the whole circumference to reach a
     * neighbour it was already beside.
     */
    for (const { a, b } of pairs) {
      const delta = bearingDelta(a.angle, b.angle);
      const total = a.weight + b.weight;
      if (a.radius > 0) a.angle += delta * PULL * alpha * (b.weight / total);
      if (b.radius > 0) b.angle -= delta * PULL * alpha * (a.weight / total);
    }

    separate();
  }

  /*
   * Settle, with the pull switched off.
   *
   * One sweep per pass only relieves the worst overlap on a ring, and the pull
   * spends the next pass compressing it again - so the two arrive at a truce
   * with memories a hair apart rather than properly spaced. Once the bearings
   * are where they belong, spacing is the only thing left to get right.
   */
  for (let pass = 0; pass < SETTLE_PASSES; pass += 1) separate();

  let radius = 0;
  for (const seat of seats.values()) {
    const x = Math.cos(seat.angle) * seat.radius;
    const y = Math.sin(seat.angle) * seat.radius;
    positions.set(seat.id, { x, y });
    radius = Math.max(radius, Math.hypot(x, y));
  }

  return { positions, radius: Math.max(radius, outermost) };
}
