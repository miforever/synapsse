"use client";

import { AnimatePresence, motion } from "framer-motion";

import { useGraphStore } from "./GraphProvider";
import { colorForClass, labelForClass } from "@/lib/node-classes";
import type { GraphNode } from "@/lib/types";

interface Props {
  node: GraphNode | null;
  connections: number;
  x: number;
  y: number;
}

export function HoverCard({ node, connections, x, y }: Props) {
  const { theme } = useGraphStore();
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          // Follows the cursor, so it must never eat the pointer itself.
          style={{ left: x + 16, top: y + 16 }}
          className="glass-panel pointer-events-none absolute z-20 w-72 rounded-[28px] p-4"
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: colorForClass(node.type, theme) }}
            />
            <span
              className="font-mono text-[10px] uppercase tracking-[0.2em]"
              style={{ color: colorForClass(node.type, theme) }}
            >
              {labelForClass(node.type)}
            </span>
          </div>

          <h3 className="mt-2 text-sm font-semibold leading-snug text-strong">
            {node.title}
          </h3>

          <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted">
            {node.summary}
          </p>

          <div className="mt-3 flex items-center justify-between border-t border-line/[.12] pt-2">
            <span className="font-mono text-[10px] text-muted">
              {connections} connection{connections === 1 ? "" : "s"}
            </span>
            {node.tags.length > 0 && (
              <span className="truncate font-mono text-[10px] text-faint">
                {node.tags.slice(0, 3).join(" · ")}
              </span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
