"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type CanvasMode, GraphCanvas } from "@/components/GraphCanvas";
import { useGraphStore } from "@/components/GraphProvider";
import { HoverCard } from "@/components/HoverCard";
import { NodeDrawer } from "@/components/NodeDrawer";
import { SearchPanel } from "@/components/SearchPanel";
import { StatusOverlay } from "@/components/StatusOverlay";
import { useElementSize } from "@/hooks/useElementSize";
import { useSettings } from "@/hooks/useSettings";
import { suspendOrbit } from "@/lib/ambient-orbit";
import type { ForceGraphHandle } from "@/lib/force-graph";
import type { GraphNode } from "@/lib/types";
import { endpointId } from "@/lib/types";

/** Shared empty set, so "nothing hovered" is referentially stable. */
const NO_IDS: ReadonlySet<string> = new Set();

/**
 * The graph itself, drawn flat or in space.
 *
 * The mode is a route rather than local state: it is one of the two ways of
 * looking at the canvas, and both belong in the URL for the same reason the
 * roadmap's do.
 */
export function CanvasView({ mode }: { mode: CanvasMode }) {
  const container = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(container);

  const graphRef = useRef<ForceGraphHandle | null>(null);
  const { data, nodesById, loading, error, motion, markMoved, canvasFit, theme } =
    useGraphStore();
  const { settings } = useSettings();

  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [activeClasses, setActiveClasses] = useState<Set<string>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  const nodeCount = data.nodes.length;

  const focusNode = useCallback((node: GraphNode) => {
    const graph = graphRef.current;
    const positioned = node as GraphNode & { x?: number; y?: number; z?: number };

    if (graph?.cameraPosition && positioned.z !== undefined) {
      // The transition tweens the camera itself; the ambient rotation stands
      // down until it lands, then picks up orbiting the newly focused memory.
      suspendOrbit(1000);
      const distance = 120;
      const ratio =
        1 +
        distance /
          Math.hypot(positioned.x ?? 0, positioned.y ?? 0, positioned.z ?? 0);
      graph.cameraPosition(
        {
          x: (positioned.x ?? 0) * ratio,
          y: (positioned.y ?? 0) * ratio,
          z: (positioned.z ?? 0) * ratio,
        },
        { x: positioned.x ?? 0, y: positioned.y ?? 0, z: positioned.z ?? 0 },
        800,
      );
    } else if (graph?.centerAt) {
      graph.centerAt(positioned.x, positioned.y, 800);
      graph.zoom?.(3, 800);
    }
  }, []);

  /*
   * Frame whatever the graph has just been arranged into.
   *
   * Registered upward rather than called from the bar directly: the renderer
   * handle only exists here, and an untangled graph that lands half outside
   * the viewport has thrown away most of what the arrangement was for.
   *
   * Measured from the nodes rather than through getGraphBbox, which
   * over-reports badly enough to pull a 3D camera roughly three times too far
   * out - the same reason the initial framing measures them too.
   */
  useEffect(() => {
    canvasFit.current = () => {
      const graph = graphRef.current;
      if (!graph) return;

      if (mode === "2d") {
        graph.zoomToFit?.(800, 90);
        return;
      }

      const nodes = data.nodes as (GraphNode & { x?: number; y?: number })[];
      let radius = 0;
      for (const node of nodes) {
        radius = Math.max(radius, Math.hypot(node.x ?? 0, node.y ?? 0));
      }
      if (radius <= 0) return;

      // Half of the renderer's default 50 degree vertical field of view.
      const distance = (radius / Math.tan((25 * Math.PI) / 180)) * 1.15;
      suspendOrbit(1200);
      graph.cameraPosition?.({ x: 0, y: 0, z: distance }, { x: 0, y: 0, z: 0 }, 800);
    };

    return () => {
      canvasFit.current = null;
    };
  }, [canvasFit, mode, data.nodes]);

  const handleSelect = useCallback(
    (node: GraphNode) => {
      setSelected(node);
      setHovered(null);
      focusNode(node);
    },
    [focusNode],
  );

  const handleNavigate = useCallback(
    (nodeId: string) => {
      const target = data.nodes.find((node) => node.id === nodeId);
      if (target) handleSelect(target);
    },
    [handleSelect, data.nodes],
  );

  // Chip vocabularies come from the loaded graph rather than another request:
  // only classes actually in use are worth offering as filters.
  // Tags are ordered by how many memories carry them, so the ones that
  // actually partition the graph sit at the top of a long list. Ties fall back
  // to alphabetical, which keeps the order stable between loads.
  const { classes, tags } = useMemo(() => {
    const classSet = new Set<string>();
    const tagCounts = new Map<string, number>();
    for (const node of data.nodes) {
      classSet.add(node.type);
      node.tags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      });
    }
    return {
      classes: [...classSet].sort(),
      tags: [...tagCounts.entries()]
        .sort(([aName, aCount], [bName, bCount]) =>
          bCount - aCount || aName.localeCompare(bName),
        )
        .map(([name, count]) => ({ name, count })),
    };
  }, [data.nodes]);

  // Direct connections of the open memory, so focus can keep its immediate
  // neighbourhood legible instead of dimming everything but one node.
  const neighbourIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>();
    for (const link of data.links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === selected.id) ids.add(target);
      else if (target === selected.id) ids.add(source);
    }
    return ids;
  }, [selected, data.links]);

  const filtering = activeClasses.size > 0 || activeTags.size > 0;

  const visibleIds = useMemo(() => {
    if (!filtering) return null;
    return new Set(
      data.nodes
        .filter(
          (node) =>
            (activeClasses.size === 0 || activeClasses.has(node.type)) &&
            (activeTags.size === 0 ||
              node.tags.some((tag) => activeTags.has(tag))),
        )
        .map((node) => node.id),
    );
  }, [filtering, data.nodes, activeClasses, activeTags]);

  const toggleIn = useCallback(
    (setter: typeof setActiveClasses) => (name: string) =>
      setter((current) => {
        const next = new Set(current);
        if (!next.delete(name)) next.add(name);
        return next;
      }),
    [],
  );

  // Thumbnail URLs come from agent-authored memories and point at other
  // hosts, so they sit behind the same consent as media inside the content.
  const showThumbnails = settings.media.remote_content;

  /*
   * What the memory under the pointer connects to.
   *
   * The set lights the canvas and the count goes on the hover card; both come
   * from one pass because they are the same walk over the edges, and they must
   * agree — a card claiming four connections beside three lit nodes reads as a
   * bug even though multiple edges between the same pair explain it.
   */
  const { hoverNeighbourIds, connectionCount } = useMemo(() => {
    if (!hovered) return { hoverNeighbourIds: NO_IDS, connectionCount: 0 };

    const ids = new Set<string>();
    let count = 0;
    for (const link of data.links) {
      const source = endpointId(link.source);
      const target = endpointId(link.target);
      if (source === hovered.id) ids.add(target);
      else if (target === hovered.id) ids.add(source);
      else continue;
      count += 1;
    }
    return { hoverNeighbourIds: ids, connectionCount: count };
  }, [hovered, data.links]);

  return (
    <main
      ref={container}
      className="relative h-screen w-screen overflow-hidden bg-canvas"
      onPointerMove={(event) =>
        setPointer({ x: event.clientX, y: event.clientY })
      }
    >
      {width > 0 && height > 0 && (
        <GraphCanvas
          graphRef={graphRef}
          data={data}
          mode={mode}
          width={width}
          height={height}
          canvasTheme={theme}
          focusId={selected?.id ?? null}
          neighbourIds={neighbourIds}
          hoverId={hovered?.id ?? null}
          hoverNeighbourIds={hoverNeighbourIds}
          showThumbnails={showThumbnails}
          visibleIds={visibleIds}
          motion={motion}
          onHover={setHovered}
          onSelect={handleSelect}
          onNodeMoved={markMoved}
        />
      )}

      <SearchPanel
        query={query}
        onQueryChange={setQuery}
        classes={classes}
        tags={tags}
        activeClasses={activeClasses}
        activeTags={activeTags}
        onToggleClass={toggleIn(setActiveClasses)}
        onToggleTag={toggleIn(setActiveTags)}
        onSelectResult={handleNavigate}
        matchCount={visibleIds ? visibleIds.size : null}
      />

      <HoverCard
        /*
         * Previewing neighbours is most useful precisely when a memory is
         * open — that is when you are deciding where to go next. Only the
         * open memory itself is skipped, since the drawer already shows it.
         */
        node={hovered && hovered.id !== selected?.id ? hovered : null}
        connections={connectionCount}
        x={pointer.x}
        y={pointer.y}
      />

      <NodeDrawer
        node={selected}
        edges={data.links}
        nodesById={nodesById}
        media={settings.media}
        onClose={() => setSelected(null)}
        onNavigate={handleNavigate}
      />

      <StatusOverlay
        loading={loading}
        error={error}
        empty={nodeCount === 0}
        onRetry={() => window.location.reload()}
      />

    </main>
  );
}
