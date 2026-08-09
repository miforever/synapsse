"use client";

import { useCallback, useMemo, useState } from "react";

import { useGraphStore } from "@/components/GraphProvider";
import { NodeDrawer } from "@/components/NodeDrawer";
import { RoadmapBoard } from "@/components/RoadmapBoard";
import { RoadmapPath } from "@/components/RoadmapPath";
import { StatusOverlay } from "@/components/StatusOverlay";
import { useSettings } from "@/hooks/useSettings";
import { setNodeStatus } from "@/lib/api";
import { buildRoadmap } from "@/lib/roadmap";
import { buildPath } from "@/lib/roadmap-path";
import type { GraphNode, Status } from "@/lib/types";

/**
 * The graph, seen as work.
 *
 * Its own section rather than a third canvas mode: 2D and 3D are two ways of
 * drawing the same thing, where this is a different question asked of it —
 * what is in flight, what is waiting on what, what is late. Path and Board are
 * this section's two ways of drawing, which is why they sit at the same depth
 * in the URL as the canvas's.
 */
export function RoadmapView({ view }: { view: "path" | "board" }) {
  const { data, setData, nodesById, loading, error } = useGraphStore();
  const { settings } = useSettings();

  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  /**
   * Move a piece of work to another lane.
   *
   * Applied locally first: the daemon is on this machine, and a card that
   * waits for a round trip before it moves feels broken however fast the round
   * trip is. The write is the same PATCH an agent makes, so the daemon's
   * broadcast arrives moments later and confirms what is already on screen.
   *
   * On failure the card goes back where it was. A board that silently keeps a
   * status the store never accepted is worse than one that stutters.
   */
  const move = useCallback(
    async (node: GraphNode, status: Status) => {
      if (node.status === status) return;

      const previous = node.status ?? null;
      setMoveError(null);
      setData((current) => ({
        ...current,
        nodes: current.nodes.map((existing) =>
          existing.id === node.id ? { ...existing, status } : existing,
        ),
      }));

      try {
        await setNodeStatus(node.id, status);
      } catch {
        setMoveError(`Could not move "${node.title}" — it is unchanged.`);
        setData((current) => ({
          ...current,
          nodes: current.nodes.map((existing) =>
            existing.id === node.id
              ? { ...existing, status: previous }
              : existing,
          ),
        }));
      }
    },
    [setData],
  );

  const roadmap = useMemo(
    () => buildRoadmap(data.nodes, data.links),
    [data.nodes, data.links],
  );

  const path = useMemo(
    () => buildPath(data.nodes, data.links),
    [data.nodes, data.links],
  );

  return (
    <main className="min-h-screen bg-canvas pt-24">

      {view === "board" ? (
        <RoadmapBoard
          roadmap={roadmap}
          onOpen={setSelected}
          onMove={move}
          error={moveError}
        />
      ) : (
        <RoadmapPath path={path} onOpen={setSelected} />
      )}

      <NodeDrawer
        node={selected}
        edges={data.links}
        nodesById={nodesById}
        media={settings.media}
        onClose={() => setSelected(null)}
        onNavigate={(nodeId) => setSelected(nodesById.get(nodeId) ?? null)}
      />

      <StatusOverlay
        loading={loading}
        error={error}
        // An empty store is the same problem on every view, so it gets the
        // same answer: connect an agent. A graph full of notes with nothing
        // carrying a status is a different fact entirely — perfectly ordinary,
        // and the board and path say so themselves rather than sending anyone
        // back to installation instructions they have already followed.
        empty={data.nodes.length === 0}
        onRetry={() => window.location.reload()}
      />
    </main>
  );
}
