"use client";

import dynamic from "next/dynamic";
import {
  type ComponentType,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Object3D } from "three";

import { setGlowTheme } from "@/lib/glow";
import { CANVAS_THEMES, type CanvasTheme } from "@/lib/palette";
import {
  type Coords,
  type ForceGraphHandle,
  type GraphData,
  type PositionedNode,
} from "@/lib/force-graph";
import {
  advanceOrbit,
  holdOrbit,
  suspendOrbit,
} from "@/lib/ambient-orbit";
import { loadCamera, saveCamera } from "@/lib/camera-store";
import { isLinkHovered, isLinkLit } from "@/lib/link-focus";
import { colorForClass } from "@/lib/node-classes";
import { endpointId, type GraphEdge, type GraphNode } from "@/lib/types";
import { getCircularThumbnail } from "@/lib/image-cache";
import {
  createDriftForce,
  createGrabCalmForce,
  setDriftPaused,
  setGrabbing,
} from "@/lib/drift-force";
import {
  advancePlasma,
  buildLinkObject,
  disposePlasma,
  setLinkFocus,
  setLinkHover,
  setPlasmaTheme,
  updateLinkObject,
} from "@/lib/link-plasma";
import { createGatherForce } from "@/lib/gather-force";
import { hashUnit } from "@/lib/hash";
import { createLivingLinksForce } from "@/lib/living-links";
import { degreesOf, weighBy } from "@/lib/node-scale";
import { createSeparateForce } from "@/lib/separate-force";
import {
  applyFocus,
  applyHover,
  applyWeights,
  buildNodeObject,
  disposeSpriteCache,
  nodeRadius,
  setSpriteTheme,
} from "./node-sprite";

/**
 * The renderer's own generics model nodes as open records, which does not line
 * up with our concrete GraphNode. Narrowing the dynamic import to exactly the
 * props we pass keeps our call sites type-checked without `any`.
 */
interface ForceGraphProps {
  graphData: GraphData;
  width: number;
  height: number;
  backgroundColor: string;
  nodeId?: string;
  nodeLabel?: string;
  cooldownTicks?: number;
  cooldownTime?: number;
  linkColor?: (link: GraphEdge) => string;
  linkWidth?: number | ((link: GraphEdge) => number);
  linkDirectionalParticles?: number | ((link: GraphEdge) => number);
  linkDirectionalParticleWidth?: number;
  linkDirectionalParticleResolution?: number;
  linkDirectionalParticleSpeed?: number;
  onNodeHover?: (node: GraphNode | null) => void;
  onNodeClick?: (node: GraphNode) => void;
  nodeVisibility?: (node: GraphNode) => boolean;
  linkVisibility?: (link: GraphEdge) => boolean;
  enableNodeDrag?: boolean;
  /** No drag-start callback exists; this fires on every move of the drag. */
  onNodeDrag?: (node: PositionedNode) => void;
  onNodeDragEnd?: (node: PositionedNode) => void;
  d3VelocityDecay?: number;
  d3AlphaDecay?: number;
  d3AlphaMin?: number;
  warmupTicks?: number;
  // 3D only
  nodeThreeObject?: (node: GraphNode) => Object3D;
  linkThreeObject?: (link: GraphEdge) => Object3D;
  linkPositionUpdate?: (
    object: Object3D,
    coords: { start: Coords; end: Coords },
    link: GraphEdge,
  ) => boolean;
  nodeOpacity?: number;
  linkOpacity?: number;
  showNavInfo?: boolean;
  // 2D only
  /**
   * What the renderer takes a node's radius to be, as
   * `sqrt(val) * nodeRelSize`. With a custom paint callback it no longer
   * affects anything drawn - only where the pointer finds the node.
   */
  nodeVal?: (node: GraphNode) => number;
  nodeRelSize?: number;
  nodeColor?: (node: GraphNode) => string;
  nodeCanvasObject?: (
    node: PositionedNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  nodeCanvasObjectMode?: () => string;
  linkCanvasObject?: (
    link: GraphEdge,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  linkCanvasObjectMode?: () => string;
}

/**
 * Both renderers touch `window`, so they can only load in the browser.
 *
 * The imperative handle is passed as `innerRef` rather than `ref` on purpose:
 * next/dynamic hands back a ref to its own wrapper, which has none of the
 * graph methods on it. That failure is silent — `graphRef.current` is truthy,
 * so every call through it throws only when used — and it takes live node
 * injection, camera focus and the drift force down with it.
 */
type Loadable = ComponentType<
  ForceGraphProps & { innerRef?: React.Ref<ForceGraphHandle | null> }
>;

function passRef(load: () => Promise<{ default: ComponentType<never> }>) {
  return dynamic(
    async () => {
      const { default: Inner } = await load();
      const Wrapped = ({
        innerRef,
        ...props
      }: ForceGraphProps & { innerRef?: React.Ref<ForceGraphHandle | null> }) => {
        const Component = Inner as unknown as ComponentType<
          ForceGraphProps & { ref?: React.Ref<ForceGraphHandle | null> }
        >;
        return <Component ref={innerRef} {...props} />;
      };
      Wrapped.displayName = "ForceGraphWrapper";
      return Wrapped;
    },
    { ssr: false },
  ) as unknown as Loadable;
}

const ForceGraph2D = passRef(
  () => import("react-force-graph-2d") as never,
);

const ForceGraph3D = passRef(
  () => import("react-force-graph-3d") as never,
);

export type CanvasMode = "2d" | "3d";

interface Props {
  data: GraphData;
  mode: CanvasMode;
  width: number;
  height: number;
  /** The open memory, highlighted while everything else recedes. */
  focusId: string | null;
  /** Its direct connections, kept legible as context. */
  neighbourIds: ReadonlySet<string>;
  /** Dark or light — the renderer paints into WebGL and a 2D context, neither
   *  of which can read a CSS variable. */
  canvasTheme: CanvasTheme;
  /** The memory under the pointer, lit along with what it connects to. */
  hoverId: string | null;
  /** Its direct connections, lit with it. */
  hoverNeighbourIds: ReadonlySet<string>;
  showThumbnails: boolean;
  /** null means no filter is active; otherwise only these ids render. */
  visibleIds: Set<string> | null;
  /** Ambient drift; off honours prefers-reduced-motion. */
  motion: boolean;
  onHover: (node: GraphNode | null) => void;
  onSelect: (node: GraphNode) => void;
  /** A memory was dragged somewhere, so the arrangement is worth saving. */
  onNodeMoved: () => void;
  graphRef: React.RefObject<ForceGraphHandle | null>;
}

/**
 * The radius a node grows to under the pointer, per unit of weight.
 *
 * Shared with the hit area rather than written twice: they have to agree, and
 * a node whose target does not match the circle you can see is the kind of
 * wrongness that is felt long before it is diagnosed.
 */
const HOVER_RADIUS = 5.6;

const LABEL_MAX_CHARS = 24;
const MAX_LABEL_PX = 12;

/**
 * Canvas cannot resolve CSS custom properties, so `var(--font-mono)` makes the
 * whole font declaration invalid and the context silently keeps its previous
 * value — the default 10px sans-serif, interpreted in world units, which
 * renders labels several times their intended size. Family names must be
 * literal here.
 */
const LABEL_FONT = '"JetBrains Mono", ui-monospace, monospace';

function truncateLabel(title: string): string {
  return title.length > LABEL_MAX_CHARS
    ? `${title.slice(0, LABEL_MAX_CHARS - 1)}…`
    : title;
}

// The connections of the memory under the pointer, in the same cyan the
// travelling pulses use, so a lit edge looks like the pulse has filled it.
const LINK_COLOR_HOVER = "rgba(127, 246, 255, 0.8)";
const LINK_GLOW = "rgba(127, 246, 255, 0.2)";

/**
 * The force-graph renderer.
 *
 * Memoized, and every prop it receives is referentially stable, so hovering a
 * node or opening the drawer re-renders the overlays without touching the
 * simulation. Re-rendering here would restart the physics and visibly stutter.
 */
function GraphCanvasImpl({
  data,
  mode,
  width,
  height,
  focusId,
  neighbourIds,
  canvasTheme,
  hoverId,
  hoverNeighbourIds,
  showThumbnails,
  visibleIds,
  motion,
  onHover,
  onSelect,
  onNodeMoved,
  graphRef,
}: Props) {
  /**
   * The renderer loads asynchronously through next/dynamic, so the imperative
   * handle does not exist during the first effects. Tracking its arrival in
   * state is what makes force registration and camera work run at all —
   * reading the ref directly silently no-ops and never retries.
   */
  const [handle, setHandle] = useState<ForceGraphHandle | null>(null);
  const palette = CANVAS_THEMES[canvasTheme];

  /*
   * Size follows connectedness, recomputed only when the edges change — this
   * runs inside the paint callback for every node of every frame.
   */
  const degrees = useMemo(() => degreesOf(data.links), [data.links]);
  const weigh = useMemo(() => weighBy(degrees), [degrees]);
  const attach = useCallback(
    (instance: ForceGraphHandle | null) => {
      graphRef.current = instance;
      setHandle(instance);
    },
    [graphRef],
  );

  const nodeColor = useCallback(
    (node: GraphNode) => colorForClass(node.type, canvasTheme),
    [canvasTheme],
  );

  /*
   * Where the pointer finds a memory.
   *
   * The renderer derives this from `val`, which nothing was setting - so every
   * node had the same 4-unit hit circle while the painted disc grew with how
   * connected it is. On the big hubs, the ones you most want to click, the
   * target was a fraction of the dot and you had to aim at its centre.
   *
   * Sized to the radius a node reaches once lit rather than its resting one,
   * with nodeRelSize pinned to 1 so `val` is a plain radius squared. Matching
   * the lit size means the node grows to meet the pointer exactly as it
   * becomes hoverable, instead of the hit area ending inside the circle you
   * can see.
   */
  const hitArea = useCallback(
    (node: GraphNode) => {
      const radius = HOVER_RADIUS * weigh(degrees.get(node.id) ?? 0);
      return radius * radius;
    },
    [degrees, weigh],
  );

  const linkWidth = useCallback(
    (link: GraphEdge) =>
      (0.5 + link.weight * 1.5) * (isLinkHovered(link, hoverId) ? 1.5 : 1),
    [hoverId],
  );

  /*
   * Recede the edges that are not part of the open memory's neighbourhood.
   *
   * This drives the 2D canvas, where it dims the travelling particles too —
   * they take their colour from the link unless told otherwise. The 3D view
   * cannot use it: its links are drawn by the plasma shader, which ignores
   * the renderer's own link styling entirely.
   */
  const linkColor = useCallback(
    (link: GraphEdge) => {
      // Hover overrides the receding, so pointing at a dimmed memory shows
      // what it connects to instead of leaving it in the background.
      if (isLinkHovered(link, hoverId)) return LINK_COLOR_HOVER;
      return isLinkLit(link, focusId, neighbourIds)
        ? palette.link
        : palette.linkDimmed;
    },
    [focusId, neighbourIds, hoverId, palette],
  );

  /**
   * The faint bed under a hovered connection.
   *
   * Barely wider than the line and dim with it: enough to tell a lit edge from
   * the ones crossing it, and no more. A wide blurred stroke here turns a
   * well-connected memory into a starburst, and the connections stop reading
   * as lines at all.
   */
  const paintLinkGlow2D = useCallback(
    (
      link: GraphEdge,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => {
      if (!isLinkHovered(link, hoverId)) return;

      // Endpoints are ids until the simulation swaps in the node objects.
      const { source, target } = link;
      if (typeof source === "string" || typeof target === "string") return;
      const from = source as PositionedNode;
      const to = target as PositionedNode;
      if (from.x === undefined || to.x === undefined) return;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(from.x, from.y ?? 0);
      ctx.lineTo(to.x, to.y ?? 0);
      ctx.strokeStyle = LINK_GLOW;
      ctx.lineWidth = (1.5 + link.weight * 1.5) / globalScale;
      ctx.stroke();
      ctx.restore();
    },
    [hoverId],
  );

  // "before", so the renderer still draws the line and its particles on top —
  // this pass only adds the bed underneath them.
  const linkCanvasObjectMode = useCallback(() => "before", []);

  // Weight drives flow density, so strong relationships read as busier.
  const linkParticles = useCallback(
    (link: GraphEdge) => Math.round(1 + link.weight * 3),
    [],
  );

  /**
   * Links, held off the memories they join.
   *
   * The radius has to be worked out here rather than inside the link module:
   * it comes from how connected each end is, which is a property of the graph
   * this canvas is drawing and not of any one link.
   */
  const linkPositionUpdate = useCallback(
    (object: Object3D, coords: { start: Coords; end: Coords }, link: GraphEdge) =>
      updateLinkObject(object, coords, link, {
        start: nodeRadius(weigh(degrees.get(endpointId(link.source)) ?? 0)),
        end: nodeRadius(weigh(degrees.get(endpointId(link.target)) ?? 0)),
      }),
    [degrees, weigh],
  );

  const nodeThreeObject = useCallback(
    (node: GraphNode): Object3D =>
      buildNodeObject(node, showThumbnails, weigh(degrees.get(node.id) ?? 0)),
    [showThumbnails, degrees, weigh],
  );

  // 2D nodes are drawn by hand: a filled dot, a ring, and a label that fades
  // in as you zoom, so a dense graph never becomes a wall of text.
  const paintNode2D = useCallback(
    (
      node: PositionedNode,
      ctx: CanvasRenderingContext2D,
      globalScale: number,
    ) => {
      const { x = 0, y = 0 } = node;
      const focusing = focusId !== null;
      const isFocus = node.id === focusId;
      const highlighted = isFocus || neighbourIds.has(node.id);
      const isHover = node.id === hoverId;
      const lit = isHover || hoverNeighbourIds.has(node.id);
      const weight = weigh(degrees.get(node.id) ?? 0);
      const baseRadius = (isFocus ? 7 : highlighted && focusing ? 5.5 : 3.6) * weight;
      /*
       * Hover reads as size, not as brightness.
       *
       * A bloom bright enough to spot at a glance blows out the node's own
       * colour, and on the paler classes it stops being a disc at all. Growing
       * it carries the same signal at any zoom and leaves the colour intact —
       * so the glow below is only a faint edge, enough to lift the node off
       * the background rather than to light it.
       *
       * Only ever additive, so hovering the open memory cannot shrink it.
       */
      const radius = Math.max(
        baseRadius,
        (isHover ? HOVER_RADIUS : lit ? 4.4 : 0) * weight,
      );
      const color = colorForClass(node.type, canvasTheme);

      ctx.globalAlpha = !focusing ? 1 : isFocus ? 1 : highlighted ? 0.85 : 0.12;
      if (lit) ctx.globalAlpha = 1;

      // Not scaled by globalScale: canvas shadows ignore the transform, so
      // this keeps the same softness at any zoom.
      if (lit) {
        ctx.shadowColor = color;
        ctx.shadowBlur = isHover ? 7 : 4;
      }

      const thumbnail =
        showThumbnails && node.thumbnail_url
          ? getCircularThumbnail(node.thumbnail_url, color, 128)
          : null;

      if (thumbnail) {
        // Already circular with its ring baked in — just place it.
        ctx.drawImage(
          thumbnail,
          x - radius,
          y - radius,
          radius * 2,
          radius * 2,
        );
      } else {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();

        ctx.lineWidth = (isFocus ? 2 : 1) / globalScale;
        ctx.strokeStyle = isFocus ? color : palette.ring;
        ctx.stroke();

        // A halo so the focused memory reads as lit rather than merely bigger.
        if (isFocus) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 5, 0, 2 * Math.PI);
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 2 / globalScale;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      /*
       * A crisp ring standing off the node under the pointer.
       *
       * This is what distinguishes the node you are actually on from the
       * neighbours it has lit, and it does the job with a line rather than
       * with light: hairline width, held constant in screen pixels, drawn
       * outside the glow so it stays a clean circle instead of smearing.
       */
      if (isHover) {
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // The context is shared across every node in the frame, so the glow has
      // to be cleared or every later node inherits it.
      ctx.shadowBlur = 0;

      // Labels are sized in world units, proportional to the node, so text
      // and node keep their relationship at every zoom level. Sizing by
      // 1/globalScale instead pins text to a fixed pixel height, which makes
      // it tower over the nodes as soon as the view zooms in.
      // A lit node is always named: hovering a cluster to read what is in it
      // is most of what hovering is for.
      const labelled = lit || (focusing ? highlighted : globalScale > 1.2);
      if (labelled) {
        ctx.globalAlpha = focusing && !highlighted && !lit ? 0 : 1;
        // Proportional to the node, but capped in screen pixels: a small
        // graph zooms in hard, and a purely proportional label then renders
        // several times the size of the node it names.
        const fontWorld = Math.min(radius * 1.25, MAX_LABEL_PX / globalScale);
        ctx.font = `${fontWorld}px ${LABEL_FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = palette.label;
        ctx.fillText(truncateLabel(node.title), x, y + radius + fontWorld * 0.6);
      }

      ctx.globalAlpha = 1;
    },
    [
      focusId,
      neighbourIds,
      hoverId,
      hoverNeighbourIds,
      showThumbnails,
      palette,
      canvasTheme,
      degrees,
      weigh,
    ],
  );

  // Filtering hides rather than removes: the simulation keeps running over
  // the full graph, so positions hold and clearing a filter is instant.
  const nodeVisibility = useCallback(
    (node: GraphNode) => !visibleIds || visibleIds.has(node.id),
    [visibleIds],
  );

  const linkVisibility = useCallback(
    (link: GraphEdge) =>
      !visibleIds ||
      (visibleIds.has(endpointId(link.source)) &&
        visibleIds.has(endpointId(link.target))),
    [visibleIds],
  );

  // Dragging a node pins it. Arranging the graph by hand is only useful if
  // the layout you make survives the next tick — and, once saved, the next
  // visit.
  /**
   * Calm the rest of the graph for as long as a memory is held.
   *
   * There is no drag-start callback, so the grab is latched on the first move
   * of the drag instead. Cheap enough to call on every one: it is a flag
   * assignment, and the alternative — tracking pointer events on the canvas
   * ourselves — cannot tell a node drag from a camera drag.
   */
  const handleDrag = useCallback(() => {
    setGrabbing(true);
    holdOrbit("drag", true);
  }, []);

  const handleDragEnd = useCallback(
    (node: PositionedNode) => {
      node.fx = node.x;
      node.fy = node.y;
      node.fz = node.z;
      setGrabbing(false);
      holdOrbit("drag", false);
      // Let the layout absorb the drop before the scene starts turning again.
      suspendOrbit(1200);
      onNodeMoved();
    },
    [onNodeMoved],
  );

  /**
   * Spread the layout to suit its size.
   *
   * The renderer's defaults are tuned for tens of nodes; at a thousand the
   * repulsion is far too weak and the graph collapses into a dense ball that
   * reads as a single blob. Repulsion and link length both scale with node
   * count so a large graph opens up instead of clumping.
   */
  useEffect(() => {
    const graph = handle;
    if (!graph?.d3Force) return;

    const n = Math.max(data.nodes.length, 1);
    const charge = graph.d3Force("charge") as
      | {
          strength: (value: (node: GraphNode) => number) => void;
          distanceMax: (value: number) => void;
        }
      | undefined;
    /*
     * Repulsion scales with the graph, and with each memory's own size.
     *
     * A well-connected memory is drawn larger, so it needs proportionally more
     * room around it — without this its neighbours sit inside it and the hub
     * that matters most is the hardest thing to read.
     */
    /*
     * Softer than it was, because it is no longer the only thing keeping
     * memories apart.
     *
     * Repulsion previously had to be strong enough to guarantee clearance on
     * its own, and since it falls off with distance the only way to do that
     * was to push hard at close range and consequently everywhere else too —
     * which is what inflated the graph. The separation force below now owns
     * clearance, so this only has to space things out.
     */
    const base = -30 - Math.min(170, 6.5 * Math.sqrt(n));
    charge?.strength((node: GraphNode) => base * weigh(degrees.get(node.id) ?? 0));
    /*
     * Keep repulsion local.
     *
     * At 700 a node pushed on everything within 700 units — most of the graph
     * — so dragging one memory visibly rearranged unrelated clusters. Limiting
     * the range means a drag disturbs its own neighbourhood and nothing else,
     * and it also keeps the many-body pass affordable at scale.
     */
    charge?.distanceMax(190);

    const link = graph.d3Force("link") as
      | { distance: (value: (link: GraphEdge) => number) => void }
      | undefined;
    /*
     * Edge length follows the memories it joins, for the same reason: a link
     * measured centre to centre has to clear both ends, and a fixed length
     * buries a hub's neighbours in its own disc.
     */
    const span = 24 + Math.min(44, 1.5 * Math.sqrt(n));
    link?.distance((edge: GraphEdge) => {
      const a = weigh(degrees.get(endpointId(edge.source)) ?? 0);
      const b = weigh(degrees.get(endpointId(edge.target)) ?? 0);
      /*
       * Clearance from the larger end, not the sum.
       *
       * A link has to clear the discs at both ends, but the big one sets the
       * requirement — adding them made a hub's edges long enough to clear two
       * hubs when only one is present.
       */
      const clearance = Math.max(a, b) + 0.3 * Math.min(a, b);
      /*
       * Vary the length per edge, or the graph comes out as a wheel.
       *
       * This is what made the layout read as a circle with straight spokes.
       * A hub's neighbours are nearly all leaves, so every edge off it scored
       * an identical clearance and therefore an identical length — and a set
       * of equal-length links from one point is the definition of a circle,
       * with each leaf's single edge leaving nothing to bend it off the
       * radius. Scattering the lengths lets the neighbours fall into lobes at
       * varying depth instead of onto one ring.
       *
       * Keyed off the endpoint ids so it is stable: a random draw per call
       * would be re-rolled every tick and the graph would shimmer.
       */
      const spread = 0.78 + 0.44 * hashUnit(`${endpointId(edge.source)} ${endpointId(edge.target)}`);
      return span * (0.45 + clearance * 0.3) * spread;
    });

    /*
     * Drop the default centering force.
     *
     * d3.forceCenter re-centres the graph's centroid every tick by translating
     * every node. Drag one memory to the right and the centroid follows, so
     * all the others get shifted left to compensate — untouched nodes visibly
     * sliding the opposite way. The camera fit already tracks the centroid, so
     * nothing needs the graph pinned to the origin.
     */
    const center = graph.d3Force("center") as
      | { strength?: (value: number) => void }
      | undefined;
    // Removing by passing null is unreliable — the wrapper can read a falsy
    // second argument as a getter — so the force is neutralised instead.
    center?.strength?.(0);

    /*
     * Something for the layout to settle against.
     *
     * Repulsion has no opinion about the graph's overall size — it pushes
     * until the links stop it — so without this a sparse graph drifts into a
     * scatter. Alpha-scaled and centroid-relative, which is what makes it
     * safe: see lib/gather-force.
     */
    graph.d3Force(
      "gather",
      createGatherForce({ dimensions: mode === "3d" ? 3 : 2 }),
    );

    /*
     * Clearance, so the shorter links above cannot pile memories up.
     *
     * Charge used to be doing this job as well as spacing the graph, and it is
     * bad at both at once: enough repulsion to guarantee no overlap is far
     * more than is wanted for density. Splitting them lets the links pull the
     * graph in tight while this holds the discs apart. The radius mirrors the
     * drawn size in node-sprite, plus room for the label to breathe.
     */
    graph.d3Force(
      "separate",
      createSeparateForce({
        dimensions: mode === "3d" ? 3 : 2,
        radius: (node) => 3.6 * weigh(degrees.get(node.id) ?? 0) + 7,
      }),
    );

    /*
     * No origin-referencing force that ignores alpha, deliberately.
     *
     * Charge and link are scaled by d3's alpha and fade as the layout cools,
     * but a custom force does not — so anything pulling toward the origin
     * ends up unopposed and implodes the entire graph to a point. Two
     * attempts at this (a centering force, then a radius-guarded boundary)
     * both collapsed it, measured at a 2-unit span.
     *
     * The cost is that memories with no edges drift to the periphery, since
     * nothing pulls them back. That is rare in practice — add_memory links
     * what it writes — and far preferable to a layout that can implode.
     *
     * Deliberately no reheat: it slams alpha back to full, and the layout
     * forces surging at full strength is exactly the sudden fast movement
     * that reads as a glitch. New nodes arrive warm enough on their own.
     */
  }, [data.nodes.length, handle, mode, degrees, weigh]);

  /**
   * Frame the graph after it has had time to lay out.
   *
   * This cannot hang off onEngineStop: the engine is deliberately never
   * allowed to stop so the drift keeps ticking, so that callback never fires.
   * Without an explicit fit the camera starts inside the cloud and a large
   * graph looks like a handful of stray dots.
   */
  /**
   * Whether the user has driven the camera themselves.
   *
   * Once they have, the framing stops moving the camera — the fits are staged
   * over several seconds and re-run on every new memory, so a zoom would be
   * answered by the camera pulling straight back out. It still re-centres what
   * the camera orbits *around*, which nothing else sets.
   */
  const cameraDriven = useRef(false);

  /** Whether the scene has been framed once, which is what sets the target. */
  const framed = useRef(false);

  useEffect(() => {
    if (data.nodes.length === 0) return;

    /*
     * Frame from the node positions rather than zoomToFit.
     *
     * getGraphBbox reports a far larger extent than the nodes actually
     * occupy — measured at +/-600 while every node sat within 222 units of
     * centre — so zoomToFit pulls the camera roughly 3x too far and the graph
     * shrinks to a dot. Measuring the real distribution avoids trusting it.
     */
    const fit = () => {
      const graph = graphRef.current;
      const nodes = data.nodes as PositionedNode[];
      if (!graph || nodes.length === 0) return;

      let cx = 0;
      let cy = 0;
      let cz = 0;
      let counted = 0;
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue;
        cx += node.x;
        cy += node.y;
        cz += node.z ?? 0;
        counted += 1;
      }
      if (counted === 0) return;
      cx /= counted;
      cy /= counted;
      cz /= counted;

      const radii = nodes
        .filter((node) => node.x !== undefined && node.y !== undefined)
        .map((node) =>
          Math.hypot(
            (node.x ?? 0) - cx,
            (node.y ?? 0) - cy,
            (node.z ?? 0) - cz,
          ),
        )
        .sort((a, b) => a - b);

      // 95th percentile, so a couple of stray unlinked memories cannot drag
      // the whole framing out and shrink everything else.
      const radius = radii[Math.floor(radii.length * 0.95)] ?? 0;
      if (radius <= 0) return;

      if (mode === "3d" && graph.cameraPosition) {
        /*
         * Once the camera is theirs, re-aim it and nothing else.
         *
         * Orbiting and zooming both work about the controls' target, so a
         * target left at the origin has the whole scene swinging around a
         * point off to the side of the graph. Writing the centroid straight
         * onto it keeps rotation centred without touching where they have
         * put the camera.
         */
        if (cameraDriven.current) {
          // Only until the target has been set once. Re-centring it later
          // would swing the view off whatever they had zoomed in on, every
          // time a memory arrived.
          if (framed.current) return;
          const target = graph.controls?.()?.target;
          if (target) {
            target.x = cx;
            target.y = cy;
            target.z = cz;
            framed.current = true;
          }
          return;
        }

        // Half of the default 50 degree vertical field of view.
        const distance = (radius / Math.tan((25 * Math.PI) / 180)) * 1.15;
        // Let the framing land before the ambient rotation resumes nudging it.
        suspendOrbit(900);
        graph.cameraPosition(
          { x: cx, y: cy, z: cz + distance },
          { x: cx, y: cy, z: cz },
          700,
        );
        framed.current = true;
      } else if (!cameraDriven.current) {
        graph.zoomToFit?.(700, 80);
      }
    };

    const timers = [1400, 4000, 8000].map((delay) => setTimeout(fit, delay));
    return () => timers.forEach(clearTimeout);
  }, [data.nodes.length, mode, graphRef]);

  /**
   * Put the camera back where this canvas was left.
   *
   * Runs per mode, so switching 2D/3D returns to that view's own last
   * position rather than reframing from scratch, and a reload opens on the
   * view you left. A restored camera counts as driven: the staged fits above
   * exist to find a first framing, and there is nothing to find here.
   */
  useEffect(() => {
    const graph = handle;
    if (!graph) return;

    /*
     * A fresh renderer brings a fresh camera, so the automatic framing is
     * ours again — until this effect hands it back below.
     *
     * The reset belongs here and not with the controls listener, which runs
     * after this effect and would wipe the state a restore had just set:
     * switching back to 3D would reframe the graph instead of returning to
     * where the view was left.
     */
    cameraDriven.current = false;
    framed.current = false;

    const saved = loadCamera(mode);
    if (!saved) return;

    if (mode === "3d") {
      if (!saved.position) return;
      // No transition: this is where the view starts, not somewhere it flies.
      graph.cameraPosition?.(saved.position, saved.target, 0);
    } else {
      if (!saved.center || saved.zoom === undefined) return;
      graph.centerAt?.(saved.center.x, saved.center.y, 0);
      graph.zoom?.(saved.zoom, 0);
    }

    cameraDriven.current = true;
    framed.current = true;
  }, [handle, mode]);

  /**
   * Keep that memory current.
   *
   * Polled rather than hooked to an event: between pointer drags, the wheel,
   * the framing tweens and the ambient rotation there is no one callback that
   * sees every way the camera moves. The store itself skips writes that would
   * not change anything, so an untouched canvas costs a read every two
   * seconds and nothing more.
   */
  useEffect(() => {
    const graph = handle;
    if (!graph) return;

    const capture = () => {
      /*
       * Never allowed to throw.
       *
       * This also runs from the cleanup, by which point the renderer may
       * already be tearing itself down — and an exception thrown out of an
       * effect cleanup takes the unmount with it, so a mode switch would break
       * the canvas rather than just forgetting one camera position.
       */
      try {
        captureNow();
      } catch {
        // Nothing to do: the position is lost, the canvas is not.
      }
    };

    const captureNow = () => {
      if (mode === "3d") {
        const position = graph.cameraPosition?.();
        if (!position) return;
        const target = graph.controls?.()?.target;
        saveCamera(mode, {
          // Copied field by field: these are live vectors the renderer keeps
          // mutating, so storing the objects themselves would store nothing
          // stable.
          position: { x: position.x, y: position.y, z: position.z ?? 0 },
          target: target && {
            x: target.x,
            y: target.y,
            z: target.z,
          },
        });
        return;
      }

      const center = graph.centerAt?.();
      const zoom = graph.zoom?.();
      if (!center || zoom === undefined) return;
      saveCamera(mode, { center: { x: center.x, y: center.y }, zoom });
    };

    const timer = setInterval(capture, 2000);
    window.addEventListener("pagehide", capture);

    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", capture);
      // Leaving this canvas — a mode switch, or the page going away — is
      // exactly when the last position has to be kept.
      capture();
    };
  }, [handle, mode]);

  // Restyles existing objects in place rather than rebuilding them, so
  // selecting a node never stutters the simulation.
  const nodeCount = data.nodes.length;


  // Read by the coupling force every tick, so new edges take effect without
  // re-registering it.
  const linksRef = useRef(data.links);
  linksRef.current = data.links;

  // Existing sprites are resized in place as the graph gains edges, so a new
  // connection grows the memory it lands on without rebuilding the scene.
  useEffect(() => {
    applyWeights((id) => weigh(degrees.get(id) ?? 0));
  }, [degrees, weigh, nodeCount]);

  useEffect(() => {
    applyFocus(focusId, neighbourIds);
    // The 3D links read this on their next frame and ease across with the
    // nodes, so lines and pulses recede together rather than in two stages.
    setLinkFocus(focusId, neighbourIds);
    // data.nodes is read only for its length here: focus restyles objects
    // that already exist, and depending on the array itself would rerun this
    // on every simulation tick.
  }, [focusId, neighbourIds, mode, nodeCount]);

  // The 2D canvas reads hover from the paint callbacks, which run every frame
  // anyway; the 3D scene keeps built objects, so it has to be told.
  useEffect(() => {
    applyHover(hoverId, hoverNeighbourIds);
    setLinkHover(hoverId);
  }, [hoverId, hoverNeighbourIds, mode, nodeCount]);

  /**
   * One loop advances every pulse and turns the scene, rather than the
   * renderer re-evaluating a per-link accessor each frame.
   */
  useEffect(() => {
    if (mode !== "3d") return;

    let frame = 0;
    const start = performance.now();
    let previous = start;

    const step = () => {
      const now = performance.now();
      // Clamped: coming back to a backgrounded tab reports one enormous frame,
      // and the scene would jump a quarter turn in a single step.
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;

      const seconds = (now - start) / 1000;
      advancePlasma(seconds);
      if (motion) advanceOrbit(handle, seconds, delta);

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [mode, motion, handle]);

  /**
   * Stand the rotation down while the user is driving the camera themselves.
   *
   * The controls fire these for dragging and for the wheel alike, so any
   * deliberate camera move stops the ambient one instead of fighting it. The
   * pause outlives the gesture by a moment, so releasing a drag does not snap
   * straight back into motion.
   */
  useEffect(() => {
    if (mode !== "3d") return;
    const controls = handle?.controls?.();
    if (!controls?.addEventListener) return;

    const hold = () => {
      // Fires for the wheel as well as for dragging, which is what makes a
      // zoom count as taking the camera over.
      cameraDriven.current = true;
      holdOrbit("pointer", true);
    };
    const release = () => {
      holdOrbit("pointer", false);
      suspendOrbit(1200);
    };

    controls.addEventListener("start", hold);
    controls.addEventListener("end", release);
    return () => {
      controls.removeEventListener?.("start", hold);
      controls.removeEventListener?.("end", release);
      holdOrbit("pointer", false);
    };
  }, [handle, mode]);

  /*
   * Repaint what the scene already holds.
   *
   * Labels and link materials are built once and kept, so switching theme has
   * to reach into them — rebuilding would drop every settled position and
   * scatter the layout for the sake of a colour.
   */
  useEffect(() => {
    // The glow cache is keyed by theme, so this only has to say which one is
    // in force before anything asks it for a disc.
    setGlowTheme(canvasTheme);
    setSpriteTheme(canvasTheme);
    setPlasmaTheme(canvasTheme);
  }, [canvasTheme, nodeCount]);

  useEffect(() => disposeSpriteCache, []);
  useEffect(() => disposePlasma, []);

  // Registered imperatively because the force has to attach to the live
  // simulation, and re-registering on every render would reset its phases.
  useEffect(() => {
    const graph = handle;
    if (!graph?.d3Force) return;

    // Deliberately no reheat here. The drift force ignores alpha, and the
    // engine never stops, so it takes effect on the next tick regardless —
    // reheating would slam alpha back to 1 and make the whole layout lurch
    // every time the toggle is clicked.
    graph.d3Force(
      "drift",
      motion ? createDriftForce({ dimensions: mode === "3d" ? 3 : 2 }) : null,
    );

    // Coupling rides with the drift: without motion there is nothing to pass
    // between neighbours, and a permanent spring on a still graph would only
    // fight the settled layout.
    graph.d3Force(
      "living",
      motion
        ? createLivingLinksForce(() => linksRef.current)
        : null,
    );

    // Registered whether or not motion is on: the churn it damps comes from
    // the renderer reheating the layout for the drag, not from the drift.
    graph.d3Force("calm", createGrabCalmForce());
  }, [motion, handle, mode, nodeCount]);


  const shared = useMemo<ForceGraphProps>(
    () => ({
      graphData: data,
      width,
      height,
      backgroundColor: palette.background,
      nodeId: "id",
      nodeLabel: "",
      // Never auto-stop: the drift force has to keep receiving ticks. Layout
      // forces still fade via alpha decay, so this settles then just breathes.
      //
      // Most of the layout is resolved before the first paint. Without it you
      // watch the graph fly apart from a random scatter and reassemble, which
      // is the least legible moment of its life and the first one anyone sees.
      warmupTicks: 120,
      // Heavy damping keeps the drift impulses from accumulating into speed.
      d3VelocityDecay: 0.82,
      // Dragging reheats the layout; a faster decay lets that energy dissipate
      // quickly instead of letting the whole graph churn afterwards.
      d3AlphaDecay: 0.045,
      // Large finite values, NOT Infinity: Infinity here silently breaks the
      // renderer's position sync, leaving every node stuck at the origin.
      cooldownTicks: 1e9,
      cooldownTime: 1e9,
      enableNodeDrag: true,
      linkColor,
      linkWidth,
      linkDirectionalParticles: linkParticles,
      // 3D particles are sphere meshes measured in world units, so they grow
      // as the camera closes in — the library offers no screen-constant size.
      // Kept small enough to read as a travelling dot rather than a bead.
      linkDirectionalParticleWidth: mode === "3d" ? 0.22 : 2.4,
      linkDirectionalParticleSpeed: 0.006,
      // Fewer facets: at this size the silhouette is a dot either way.
      linkDirectionalParticleResolution: 4,
      onNodeHover: (node: GraphNode | null) => {
        // Hold the graph still while a node is under the pointer — both the
        // nodes' own drift and the scene rotation, since either one moving
        // makes the thing you are aiming at a target that walks away.
        setDriftPaused(node !== null);
        holdOrbit("hover", node !== null);
        onHover(node);
      },
      onNodeClick: onSelect,
      nodeVisibility,
      linkVisibility,
      onNodeDrag: handleDrag,
      onNodeDragEnd: handleDragEnd,
    }),
    [
      data,
      mode,
      width,
      height,
      linkWidth,
      linkParticles,
      onHover,
      onSelect,
      nodeVisibility,
      linkVisibility,
      palette,
      handleDrag,
      handleDragEnd,
      linkColor,
    ],
  );

  if (mode === "3d") {
    return (
      <ForceGraph3D
        innerRef={attach}
        {...shared}
        /*
         * Zero width draws links as plain lines. Any positive width makes the
         * renderer extrude a cylinder per link, which reads as bulky tubes
         * with beads rolling through them rather than the thin flowing traces
         * the 2D view has.
         */
        linkThreeObject={buildLinkObject}
        linkPositionUpdate={linkPositionUpdate}
        // The plasma shader draws the line itself, so the renderer's own link
        // and particle rendering are both switched off.
        linkDirectionalParticles={0}
        linkWidth={0}
        nodeThreeObject={nodeThreeObject}
        // No linkOpacity: with a custom link object the renderer's own opacity
        // is never applied. Focus dimming lives in the shader instead.
        showNavInfo={false}
      />
    );
  }

  return (
    <ForceGraph2D
      innerRef={attach}
      {...shared}
      // Only on the flat canvas: the 3D scene raycasts the sprite itself, so
      // its hit area already follows what is drawn.
      nodeRelSize={1}
      nodeVal={hitArea}
      nodeColor={nodeColor}
      nodeCanvasObject={paintNode2D}
      nodeCanvasObjectMode={() => "replace"}
      linkCanvasObject={paintLinkGlow2D}
      linkCanvasObjectMode={linkCanvasObjectMode}
    />
  );
}

export const GraphCanvas = memo(GraphCanvasImpl);
