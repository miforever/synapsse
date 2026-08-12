/**
 * The graph, read as work.
 *
 * The same memories, seen through the two things that make something a plan
 * rather than a note: where it stands, and what it is waiting on. Derived from
 * the snapshot the canvas already has, so the roadmap costs nothing extra.
 */

import type { GraphEdge, GraphNode, Status } from "./types";
import { endpointId } from "./types";

/** Left to right, in the order work moves through them. */
export const LANES: Status[] = ["todo", "doing", "done", "dropped"];

export const LANE_LABELS: Record<Status, string> = {
  todo: "Planned",
  doing: "In progress",
  done: "Done",
  dropped: "Dropped",
};

/**
 * What a lane means, said once.
 *
 * `dropped` earns its place on the board rather than being hidden: a roadmap
 * that quietly forgets abandoned work invites the same idea to be proposed
 * again next quarter.
 */
export const LANE_HINTS: Record<Status, string> = {
  todo: "Committed, not started",
  doing: "Being worked on now",
  done: "Finished",
  dropped: "Decided against — kept for the reason why",
};

export interface RoadmapItem {
  node: GraphNode;
  /** Work this one is waiting on, by id. */
  blockedBy: string[];
  /** Work waiting on this one. */
  blocking: string[];
  /** Past its target date and not finished. */
  overdue: boolean;
}

export interface Roadmap {
  lanes: Record<Status, RoadmapItem[]>;
  /** Every item by id, for resolving the dependency names. */
  byId: Map<string, RoadmapItem>;
  total: number;
}

function isOverdue(node: GraphNode, today: string): boolean {
  if (!node.target_date || node.status === "done" || node.status === "dropped") {
    return false;
  }
  // String comparison is exact for ISO dates and needs no parsing, no time
  // zone, and no library.
  return node.target_date < today;
}

/**
 * Group the graph's work into lanes, with its dependencies resolved.
 *
 * Only `depends_on` is read. `relates_to` is the graph's way of saying two
 * memories belong together, which is true of most of them and tells a roadmap
 * nothing about order.
 */
export function buildRoadmap(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  today: string = new Date().toISOString().slice(0, 10),
): Roadmap {
  const work = nodes.filter((node) => node.status);
  const ids = new Set(work.map((node) => node.id));

  const items = new Map<string, RoadmapItem>(
    work.map((node) => [
      node.id,
      { node, blockedBy: [], blocking: [], overdue: isOverdue(node, today) },
    ]),
  );

  for (const edge of edges) {
    const source = endpointId(edge.source);
    const target = endpointId(edge.target);
    // A dependency between a plan and something that is not work — a decision,
    // a person — is real, but it is not a sequencing constraint.
    if (!ids.has(source) || !ids.has(target)) continue;

    if (edge.relation_type === "depends_on") {
      items.get(source)?.blockedBy.push(target);
      items.get(target)?.blocking.push(source);
    }
  }

  const lanes = Object.fromEntries(
    LANES.map((lane) => [lane, [] as RoadmapItem[]]),
  ) as Record<Status, RoadmapItem[]>;

  for (const item of items.values()) {
    lanes[item.node.status as Status].push(item);
  }

  for (const lane of LANES) {
    lanes[lane].sort(compareByTarget);
  }

  return { lanes, byId: items, total: items.size };
}

/**
 * Soonest first, undated last.
 *
 * A plan with a date is a commitment and one without is an intention; sorting
 * them together by anything else puts the two in the same sentence.
 */
function compareByTarget(left: RoadmapItem, right: RoadmapItem): number {
  const a = left.node.target_date;
  const b = right.node.target_date;
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return left.node.title.localeCompare(right.node.title);
}

/** How a target date reads next to today: "in 3 days", "2 weeks ago". */
export function relativeDate(target: string, today = new Date()): string {
  const due = new Date(`${target}T00:00:00Z`);
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const days = Math.round((due.getTime() - start.getTime()) / 86_400_000);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  const magnitude = Math.abs(days);
  const [value, unit] =
    magnitude < 14
      ? [magnitude, "day"]
      : magnitude < 60
        ? [Math.round(magnitude / 7), "week"]
        : [Math.round(magnitude / 30), "month"];

  const plural = value === 1 ? unit : `${unit}s`;
  return days > 0 ? `in ${value} ${plural}` : `${value} ${plural} ago`;
}
