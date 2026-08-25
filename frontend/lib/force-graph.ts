/**
 * Minimal typings for the force-graph handle.
 *
 * The renderer is loaded dynamically (it touches `window`), which erases its
 * generated types. Declaring just the imperative surface we use keeps the
 * call sites type-checked without resorting to `any`.
 */

import { PALETTE } from "./palette";
import type { GraphEdge, GraphNode } from "./types";

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

export interface Coords {
  x: number;
  y: number;
  z?: number;
}

/**
 * Note there is no `graphData` here: react-force-graph exposes that as a prop,
 * not a ref method. Reading or writing the graph through the handle throws at
 * runtime, so live updates must flow through the `graphData` prop instead.
 */
export interface ForceGraphHandle {
  d3ReheatSimulation?: () => void;
  /** Doubles as a getter when called with a name only. */
  d3Force?: (name: string, force?: unknown) => unknown;
  zoomToFit?: (durationMs?: number, padding?: number) => void;
  getGraphBbox?: () => { x: [number, number]; y: [number, number]; z?: [number, number] } | null;
  /** 3D only. Called with no position it reports the camera instead of moving it. */
  cameraPosition?: (
    position?: Coords,
    lookAt?: Coords,
    transitionMs?: number,
  ) => Coords | undefined;
  /** 3D only. The live three.js camera, mutated in place by the ambient orbit. */
  camera?: () => { position?: { x: number; y: number; z: number } } | undefined;
  /**
   * 3D only. OrbitControls: `target` is what the camera is aimed at, and the
   * `start`/`end` events are how the ambient orbit knows to stand down while
   * the user is dragging.
   */
  controls?: () =>
    | {
        target?: { x: number; y: number; z: number };
        addEventListener?: (event: string, handler: () => void) => void;
        removeEventListener?: (event: string, handler: () => void) => void;
      }
    | undefined;
  /** 2D only. Both double as getters when called with no arguments. */
  centerAt?: (
    x?: number,
    y?: number,
    durationMs?: number,
  ) => { x: number; y: number } | undefined;
  zoom?: (scale?: number, durationMs?: number) => number | undefined;
}

/**
 * Positions the simulation writes onto each node as it settles, plus the
 * `f*` pins that hold a node in place once it has been dragged.
 */
export type PositionedNode = GraphNode &
  Partial<Coords> & {
    fx?: number;
    fy?: number;
    fz?: number;
  };

/**
 * Centroid and reach, measured from the nodes rather than getGraphBbox, which
 * over-reports enough to pull a 3D camera roughly three times too far out. The
 * radius is the 95th percentile, so strays cannot drag the framing open.
 */
export function graphFraming(
  nodes: PositionedNode[],
): { cx: number; cy: number; cz: number; radius: number } | null {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let counted = 0;

  // Finite rather than merely present: a camera is aimed at the result.
  const placed = nodes.filter(
    (node) =>
      Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      (node.z === undefined || Number.isFinite(node.z)),
  );

  for (const node of placed) {
    cx += node.x ?? 0;
    cy += node.y ?? 0;
    cz += node.z ?? 0;
    counted += 1;
  }
  if (counted === 0) return null;
  cx /= counted;
  cy /= counted;
  cz /= counted;

  const radii = placed
    .map((node) =>
      Math.hypot((node.x ?? 0) - cx, (node.y ?? 0) - cy, (node.z ?? 0) - cz),
    )
    .sort((a, b) => a - b);

  const radius = radii[Math.floor(radii.length * 0.95)] ?? 0;
  if (!(radius > 0)) return null;

  return { cx, cy, cz, radius };
}

export const CANVAS_BACKGROUND = PALETTE.canvas;
