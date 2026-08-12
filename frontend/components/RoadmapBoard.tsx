"use client";

import { useState } from "react";

import { useGraphStore } from "./GraphProvider";
import { colorForClass, labelForClass } from "@/lib/node-classes";
import {
  LANE_HINTS,
  LANE_LABELS,
  LANES,
  relativeDate,
  type Roadmap,
  type RoadmapItem,
} from "@/lib/roadmap";
import type { GraphNode, Status } from "@/lib/types";

interface Props {
  roadmap: Roadmap;
  onOpen: (node: GraphNode) => void;
  /** Moving a card is the canvas's one write. */
  onMove: (node: GraphNode, status: Status) => void;
  error: string | null;
}

/** What the drag carries. A card is only ever dropped as an id. */
const DRAG_TYPE = "application/x-synapsse-memory";

/**
 * Work in lanes, with what each piece is waiting on.
 *
 * The dependency is shown as the *name* of the thing blocking it rather than
 * as a line drawn between columns. Lines across a board that scrolls in two
 * directions are decoration — you cannot follow one to a card you cannot see —
 * where a name tells you what to go and look at.
 */
export function RoadmapBoard({ roadmap, onOpen, onMove, error }: Props) {
  const { theme } = useGraphStore();
  /**
   * Where the card being dragged would land: which lane, and how far down it.
   *
   * Tracking the slot rather than only the lane lets the board open a gap
   * where the card would go, which is what makes it feel like placing
   * something rather than throwing it over a wall.
   */
  const [over, setOver] = useState<{ lane: Status; index: number } | null>(null);

  if (roadmap.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-32 text-center">
        <p className="text-sm text-muted">Nothing on the roadmap yet.</p>
        <p className="max-w-md text-xs leading-relaxed text-faint/70">
          A memory joins the board when it is given a status — ask an agent to{" "}
          <code className="font-mono text-faint">set_status</code> on a plan
          it is working through, or pass one when the memory is written.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p
          role="alert"
          className="mx-6 mt-4 rounded-[16px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200"
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => (
          <section
            key={lane}
            onDragOver={(event) => {
              // Without this the browser refuses the drop outright.
              event.preventDefault();
              setOver((current) =>
                current?.lane === lane
                  ? current
                  : { lane, index: roadmap.lanes[lane].length },
              );
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setOver((current) => (current?.lane === lane ? null : current));
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);

              const id = event.dataTransfer.getData(DRAG_TYPE);
              const item = roadmap.byId.get(id);
              // Dropping a card back into its own lane is not a change, and
              // writing it would broadcast an edit that edited nothing.
              if (item && item.node.status !== lane) onMove(item.node, lane);
            }}
            className={`min-w-0 rounded-[20px] border p-2 transition ${
              over?.lane === lane ? "border-cyan/40 bg-cyan/5" : "border-transparent"
            }`}
          >
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                {LANE_LABELS[lane]}
              </h2>
              <span className="rounded-full bg-elevated/10 px-1.5 py-0.5 font-mono text-[9px] text-muted">
                {roadmap.lanes[lane].length}
              </span>
            </div>
            <p className="mb-3 text-[10px] leading-snug text-faint/70">
              {LANE_HINTS[lane]}
            </p>

            <ul className="space-y-2">
              {roadmap.lanes[lane].map((item, index) => (
                <li key={item.node.id}>
                  {/*
                    The gap a card would drop into, opened above the card it
                    would land before. Each card owns the slot above it, so
                    the whole column stays a valid target without a separate
                    strip between every pair.
                  */}
                  <Gap open={over?.lane === lane && over.index === index} />
                  <div
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      // Above or below the midpoint decides which side of this
                      // card the gap opens on — the same rule a text cursor
                      // follows between two characters.
                      const box = event.currentTarget.getBoundingClientRect();
                      const after = event.clientY > box.top + box.height / 2;
                      setOver({ lane, index: after ? index + 1 : index });
                    }}
                  >
                    <Card
                      item={item}
                      roadmap={roadmap}
                      onOpen={onOpen}
                      onMove={onMove}
                      theme={theme}
                    />
                  </div>
                  {index === roadmap.lanes[lane].length - 1 && (
                    <Gap open={over?.lane === lane && over.index === index + 1} />
                  )}
                </li>
              ))}

              {roadmap.lanes[lane].length === 0 && (
                <li
                  className={`rounded-[16px] border border-dashed px-3 py-4 text-center font-mono text-[10px] transition ${
                    over?.lane === lane
                      ? "border-cyan/40 text-cyan"
                      : "border-line/[.07] text-faint/50"
                  }`}
                >
                  {over?.lane === lane ? "drop to move here" : "empty"}
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/** The space a dragged card would occupy, opening where it would land. */
function Gap({ open }: { open: boolean }) {
  return (
    <div
      aria-hidden
      className={`overflow-hidden transition-all duration-150 ${
        open ? "h-12 opacity-100" : "h-0 opacity-0"
      }`}
    >
      <div className="mb-2 h-full rounded-[20px] border border-dashed border-cyan/40 bg-cyan/5" />
    </div>
  );
}

function Card({
  item,
  roadmap,
  onOpen,
  onMove,
  theme,
}: {
  item: RoadmapItem;
  roadmap: Roadmap;
  onOpen: (node: GraphNode) => void;
  onMove: (node: GraphNode, status: Status) => void;
  theme: "dark" | "light";
}) {
  const [dragging, setDragging] = useState(false);
  const { node, blockedBy, blocking, overdue } = item;
  const colour = colorForClass(node.type, theme);
  // Finished and abandoned work recedes: the board is read for what is next,
  // and the two lanes that are behind you should not compete for that.
  const settled = node.status === "done" || node.status === "dropped";

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, node.id);
        event.dataTransfer.effectAllowed = "move";
        setDragging(true);

        /*
         * The drag image is a snapshot taken now, so tilting the original
         * would come too late. It is rasterised from the element's own box,
         * which clips a rotation's corners — hence the padded frame.
         */
        const box = event.currentTarget.getBoundingClientRect();
        const pad = 24;

        const frame = document.createElement("div");
        frame.style.position = "absolute";
        frame.style.top = "-9999px";
        frame.style.left = "-9999px";
        frame.style.padding = `${pad}px`;
        frame.style.pointerEvents = "none";

        const ghost = event.currentTarget.cloneNode(true) as HTMLElement;
        ghost.style.width = `${box.width}px`;
        ghost.style.transform = "rotate(3deg)";
        ghost.style.opacity = "1";
        frame.appendChild(ghost);
        document.body.appendChild(frame);

        event.dataTransfer.setDragImage(
          frame,
          event.clientX - box.left + pad,
          event.clientY - box.top + pad,
        );
        // The snapshot is taken synchronously, so the frame has done its job
        // by the next frame.
        requestAnimationFrame(() => frame.remove());
      }}
      onDragEnd={() => setDragging(false)}
      className={`group rounded-[20px] border border-line/[.12] bg-raised transition hover:border-line/25 hover:bg-elevated/10 ${
        settled ? "opacity-60 hover:opacity-100" : ""
      } ${dragging ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        onClick={() => onOpen(node)}
        className="w-full cursor-grab p-3 text-left active:cursor-grabbing"
      >
        <span className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: colour }}
          />
          <span
            className="font-mono text-[9px] uppercase tracking-[0.2em]"
            style={{ color: colour }}
          >
            {labelForClass(node.type)}
          </span>
        </span>

        <span className="mt-1.5 block text-sm font-medium leading-snug text-strong">
          {node.title}
        </span>

        <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-faint">
          {node.summary}
        </span>

        {node.target_date && (
          <span
            className={`mt-2 flex items-center gap-1.5 font-mono text-[10px] ${
              overdue ? "text-rose-300" : "text-faint"
            }`}
          >
            <span aria-hidden>{overdue ? "⚠" : "◷"}</span>
            {node.target_date}
            <span className={overdue ? "text-rose-400/70" : "text-faint/70"}>
              {relativeDate(node.target_date)}
            </span>
          </span>
        )}

        {blockedBy.length > 0 && (
          <span className="mt-2 block border-t border-line/[.07] pt-2">
            <span className="block font-mono text-[9px] uppercase tracking-widest text-amber-300/70">
              Waiting on
            </span>
            {blockedBy.map((id) => (
              <span
                key={id}
                className="mt-0.5 block truncate text-[10px] text-muted"
              >
                {roadmap.byId.get(id)?.node.title ?? "unknown"}
              </span>
            ))}
          </span>
        )}

        {blocking.length > 0 && (
          <span className="mt-1.5 block font-mono text-[9px] text-faint/70">
            blocks {blocking.length}{" "}
            {blocking.length === 1 ? "other" : "others"}
          </span>
        )}
      </button>

      {/*
        The same move, without a mouse.

        Dragging is the obvious gesture and the one most people will reach for,
        but it is unreachable by keyboard and invisible to a screen reader —
        and this is the only control on the board that changes anything, so
        leaving it mouse-only would put the whole write path out of reach.
      */}
      <label className="flex items-center gap-2 border-t border-line/[.07] px-3 py-2">
        <span className="sr-only">Status for {node.title}</span>
        <select
          value={node.status ?? "todo"}
          onChange={(event) => onMove(node, event.target.value as Status)}
          className="w-full cursor-pointer rounded bg-transparent font-mono text-[10px] uppercase tracking-widest text-faint outline-none transition hover:text-muted focus:text-strong"
        >
          {LANES.map((lane) => (
            <option key={lane} value={lane} className="bg-canvas text-strong">
              {LANE_LABELS[lane]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
