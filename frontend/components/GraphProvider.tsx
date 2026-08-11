"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useGraph } from "@/hooks/useGraph";
import { useGraphStream } from "@/hooks/useGraphStream";
import { useLayout } from "@/hooks/useLayout";
import { useUntangle } from "@/hooks/useUntangle";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useTheme, type Theme, type ThemePreference } from "@/hooks/useTheme";
import type { GraphData, PositionedNode } from "@/lib/force-graph";
import type { GraphEdge, GraphNode } from "@/lib/types";
import { endpointId } from "@/lib/types";

interface GraphStore {
  /**
   * The renderer owns this object and mutates it as the simulation runs. It is
   * built once from the snapshot and never replaced, so moving between views
   * reuses the same node objects and their settled positions carry across.
   */
  data: GraphData;
  setData: React.Dispatch<React.SetStateAction<GraphData>>;
  nodesById: Map<string, GraphNode>;
  loading: boolean;
  error: string | null;
  connected: boolean;

  /*
   * Canvas concerns that outlive a single view.
   *
   * Ambient motion is a preference, and the hand-arranged layout is the user's
   * work — neither should reset because they looked at the roadmap. They live
   * here so the bar can offer them from any page and nothing is lost in
   * between.
   */
  motion: boolean;
  setMotion: (motion: boolean) => void;
  reducedMotion: boolean;
  markMoved: () => void;
  resetLayout: () => void;
  /** Open the graph into a radial arrangement and pin it there. */
  untangle: () => void;
  /** True while that arrangement is travelling, so the control can say so. */
  untangling: boolean;
  /**
   * Filled in by whichever canvas is mounted, so an arrangement can be framed
   * once it lands. A ref rather than a callback in the store: the canvas owns
   * the renderer handle, and passing it upward would re-render the graph.
   */
  canvasFit: React.MutableRefObject<(() => void) | null>;

  /** Light, dark, or whatever the system says — see useTheme. */
  themePreference: ThemePreference;
  /** What that resolves to right now, which is what the canvas paints with. */
  theme: Theme;
  chooseTheme: (theme: ThemePreference) => void;
}

const Context = createContext<GraphStore | null>(null);

/**
 * The graph, loaded once for every view that reads it.
 *
 * Above the routes rather than inside them: the canvas and the roadmap are two
 * ways of looking at one thing. Loading per page would refetch the store on
 * every navigation and hand the simulation new node objects each time, so a
 * settled layout would scatter on the way back. The socket is here for the
 * same reason — one connection, and every view sees a memory arrive at once.
 */
export function GraphProvider({ children }: { children: ReactNode }) {
  const { snapshot, loading, error } = useGraph();
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });

  useEffect(() => {
    if (!snapshot) return;
    setData({ nodes: snapshot.nodes, links: snapshot.edges });
  }, [snapshot]);

  /**
   * Live mutations replace the wrapper object but reuse the existing node
   * objects, which is what react-force-graph diffs on: untouched nodes keep
   * their positions and velocities, and only genuinely new ones are seeded,
   * so a write never restarts the layout.
   */
  const connected = useGraphStream(
    useMemo(
      () => ({
        onNewNode: (node: GraphNode, edges: GraphEdge[]) =>
          setData((current) =>
            current.nodes.some((existing) => existing.id === node.id)
              ? current
              : {
                  nodes: [...current.nodes, node],
                  links: [...current.links, ...edges],
                },
          ),

        onNodeUpdated: (node: GraphNode) =>
          setData((current) => {
            const existing = current.nodes.find((item) => item.id === node.id);
            if (!existing) return current;
            // Mutate in place so the simulation keeps the node where it is.
            Object.assign(existing, node);
            return { nodes: [...current.nodes], links: current.links };
          }),

        onNodeDeleted: (nodeId: string) =>
          setData((current) => {
            const nodes = current.nodes.filter((item) => item.id !== nodeId);
            if (nodes.length === current.nodes.length) return current;
            return {
              nodes,
              // Edges cascade server-side; drop them here by endpoint.
              links: current.links.filter(
                (link) =>
                  endpointId(link.source) !== nodeId &&
                  endpointId(link.target) !== nodeId,
              ),
            };
          }),
      }),
      [],
    ),
  );

  const nodesById = useMemo(
    () => new Map(data.nodes.map((node) => [node.id, node])),
    [data.nodes],
  );

  const { preference: themePreference, theme, choose: chooseTheme } = useTheme();
  const [motionOn, setMotion] = useState(true);
  const reducedMotion = useReducedMotion();

  /*
   * Arrangements are saved per canvas mode, so this needs to know which one is
   * open — and to keep the last one while the roadmap is showing, since that
   * is the arrangement still on screen behind it.
   */
  const pathname = usePathname();
  const canvasMode = pathname.startsWith("/canvas/2d") ? "2d" : "3d";

  const { markMoved, reset: resetLayout } = useLayout({
    mode: canvasMode,
    nodes: data.nodes as PositionedNode[],
    ready: data.nodes.length > 0,
  });

  const canvasFit = useRef<(() => void) | null>(null);

  const { untangle, untangling } = useUntangle({
    nodes: data.nodes as PositionedNode[],
    links: data.links,
    // Untangling releases every pin, so what has to happen afterwards is the
    // stored arrangement being cleared, not a new one written.
    onArranged: resetLayout,
    fit: canvasFit,
  });

  const store = useMemo(
    () => ({
      data,
      setData,
      nodesById,
      loading,
      error,
      connected,
      motion: motionOn && !reducedMotion,
      setMotion,
      reducedMotion,
      markMoved,
      resetLayout,
      untangle,
      untangling,
      canvasFit,
      themePreference,
      theme,
      chooseTheme,
    }),
    [
      data,
      nodesById,
      loading,
      error,
      connected,
      motionOn,
      reducedMotion,
      markMoved,
      resetLayout,
      untangle,
      untangling,
      themePreference,
      theme,
      chooseTheme,
    ],
  );

  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useGraphStore(): GraphStore {
  const store = useContext(Context);
  if (!store) {
    throw new Error("useGraphStore must be used inside a GraphProvider");
  }
  return store;
}
