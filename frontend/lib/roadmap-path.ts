/**
 * Work laid out as a path: what has to happen before what.
 *
 * The board answers "where does everything stand". This answers a different
 * question — "what is the order" — and the graph already holds the answer in
 * its `depends_on` edges. Steps are levels of that dependency
 * graph: everything in a level can be done at once, and nothing in it can
 * start until the level above is finished.
 *
 * Layering is the longest path to each item rather than the shortest. A step
 * has to sit below *every* prerequisite, not just the first one found, or the
 * picture claims work can start before something it is waiting on is done.
 */

import type { GraphEdge, GraphNode } from "./types";
import { buildRoadmap, type RoadmapItem } from "./roadmap";

export interface PathStep {
  /** 0-based depth. Everything in a level is unblocked by the levels above. */
  level: number;
  items: RoadmapItem[];
}

export interface RoadmapPath {
  steps: PathStep[];
  /** Item id to the level it sits in, for drawing the connections. */
  levelOf: Map<string, number>;
  /**
   * Items whose dependencies form a loop.
   *
   * A cycle has no valid order — each of them waits on the others — so they
   * cannot be placed by the layering. They are surfaced rather than dropped:
   * a plan waiting on itself is a mistake in the graph worth seeing, and
   * silently hiding it would leave someone wondering where their work went.
   */
  cyclic: RoadmapItem[];
  total: number;
}

/**
 * Order the work into levels.
 *
 * Kahn's algorithm: repeatedly take everything with nothing left to wait on.
 * Whatever is still standing when it stalls is in a cycle, by definition.
 */
export function buildPath(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  today?: string,
): RoadmapPath {
  const roadmap = buildRoadmap(nodes, edges, today);

  // Dropped work is not part of the path. It is not a step anyone will take,
  // and threading it through the levels pushes everything downstream of it
  // into an order that no longer reflects any plan.
  const items = [...roadmap.byId.values()].filter(
    (item) => item.node.status !== "dropped",
  );
  const present = new Set(items.map((item) => item.node.id));

  const waitingOn = new Map(
    items.map((item) => [
      item.node.id,
      item.blockedBy.filter((id) => present.has(id)),
    ]),
  );

  const level = new Map<string, number>();
  const placed = new Set<string>();

  let current = items.filter(
    (item) => waitingOn.get(item.node.id)?.length === 0,
  );
  let depth = 0;

  while (current.length > 0) {
    for (const item of current) {
      level.set(item.node.id, depth);
      placed.add(item.node.id);
    }

    depth += 1;
    current = items.filter(
      (item) =>
        !placed.has(item.node.id) &&
        // Every prerequisite already placed, which is what makes this the
        // longest path: an item waits for its slowest dependency.
        waitingOn.get(item.node.id)!.every((id) => placed.has(id)),
    );
  }

  const steps: PathStep[] = [];
  for (const item of items) {
    const at = level.get(item.node.id);
    if (at === undefined) continue;
    (steps[at] ??= { level: at, items: [] }).items.push(item);
  }

  for (const step of steps) {
    // Within a level nothing constrains the order, so the same rule as the
    // board applies: dated work first, soonest first.
    step.items.sort(compareForPath);
  }

  return {
    steps: steps.filter(Boolean),
    levelOf: level,
    cyclic: items.filter((item) => !placed.has(item.node.id)),
    total: items.length,
  };
}

function compareForPath(left: RoadmapItem, right: RoadmapItem): number {
  const a = left.node.target_date;
  const b = right.node.target_date;
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return left.node.title.localeCompare(right.node.title);
}

/**
 * How far along the path the work has got.
 *
 * A level counts as finished only when every step in it is, because that is
 * what the level means — the next one cannot start until it is true.
 */
export function progressOf(step: PathStep): "done" | "doing" | "todo" {
  if (step.items.every((item) => item.node.status === "done")) return "done";
  if (step.items.some((item) => item.node.status !== "todo")) return "doing";
  return "todo";
}
