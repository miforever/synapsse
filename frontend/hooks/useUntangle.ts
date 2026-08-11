"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PositionedNode } from "@/lib/force-graph";
import type { GraphEdge } from "@/lib/types";
import { animateToLayout, computeUntangledLayout } from "@/lib/untangle";

/**
 * The untangle gesture.
 *
 * Kept beside the layout hook rather than inside the canvas: the arrangement
 * belongs to the graph, not to whichever view happens to be open, and the bar
 * that offers the button lives outside the canvas entirely.
 *
 * The nodes are read through a ref because the simulation mutates the same
 * objects every tick. Depending on the array itself would rebuild this on
 * every frame of the layout, and the callback identity is what the bar holds.
 */
interface Options {
  nodes: PositionedNode[];
  links: GraphEdge[];
  /**
   * Told once the arrangement lands. The nodes are released rather than
   * pinned, so there is no hand-placement left to persist - this exists to
   * clear the stored one, which would otherwise snap the graph back on the
   * next load.
   */
  onArranged: () => void;
  /** Frames the camera on the new shape, when a canvas is on screen. */
  fit?: React.RefObject<(() => void) | null>;
}

export function useUntangle({ nodes, links, onArranged, fit }: Options) {
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const linksRef = useRef(links);
  linksRef.current = links;

  const cancel = useRef<(() => void) | null>(null);
  const [running, setRunning] = useState(false);

  // An animation still writing positions into node objects after the canvas
  // has gone would keep a dead frame loop alive for the rest of the session.
  useEffect(() => () => cancel.current?.(), []);

  const untangle = useCallback(() => {
    const graphNodes = nodesRef.current;
    if (graphNodes.length === 0) return;

    // A second press mid-flight restarts from where things are, rather than
    // running two loops that fight over the same nodes.
    cancel.current?.();

    const { positions } = computeUntangledLayout(graphNodes, linksRef.current);
    setRunning(true);

    cancel.current = animateToLayout(graphNodes, positions, {
      onDone: () => {
        cancel.current = null;
        setRunning(false);
        // Nothing is pinned any more, including whatever was dragged into
        // place before. Saying so is what stops a stored arrangement from
        // reasserting itself over this one.
        onArranged();
        fit?.current?.();
      },
    });
  }, [onArranged, fit]);

  return { untangle, untangling: running };
}
