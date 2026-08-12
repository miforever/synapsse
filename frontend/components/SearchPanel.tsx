"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";

import { useSearch } from "@/hooks/useSearch";
import { useGraphStore } from "./GraphProvider";
import { colorForClass, labelForClass } from "@/lib/node-classes";
import type { NodeSearchResult } from "@/lib/types";

/** A tag and how many memories carry it, so the list can lead with the ones
 * that actually divide the graph. */
export interface TagOption {
  name: string;
  count: number;
}

/** Past this many tags the list stops being scannable and earns a filter of
 * its own; below it, the input would be furniture. */
const TAG_FILTER_THRESHOLD = 12;

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  classes: string[];
  tags: TagOption[];
  activeClasses: Set<string>;
  activeTags: Set<string>;
  onToggleClass: (name: string) => void;
  onToggleTag: (name: string) => void;
  onSelectResult: (nodeId: string) => void;
  matchCount: number | null;
}

/**
 * A filter, wearing the colour it filters by.
 *
 * Active chips take their class colour outright rather than a neutral
 * highlight: the colour already means that class everywhere else on the
 * canvas, so using it here says which filters are on at a glance instead of
 * making you read the labels. Tags have no colour of their own and stay
 * neutral, which keeps the two rows telling different stories.
 *
 * The dot is never faded. Dimming it was doing two jobs at once — identity and
 * on/off — and the first one suffered: a half-opacity dot on a pale panel is
 * not a colour anyone can name.
 */
function Chip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  const painted = active && color;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={
        painted
          ? {
              // Mixed against the panel rather than set flat, so the chip sits
              // on the surface instead of punching a hole in it.
              backgroundColor: `${color}22`,
              borderColor: `${color}88`,
              color,
            }
          : undefined
      }
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] transition ${
        painted
          ? "font-medium"
          : active
            ? "border-line/25 bg-elevated/10 text-strong"
            : "border-line/[.12] text-faint hover:text-muted"
      }`}
    >
      {color && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
    </button>
  );
}

export function SearchPanel({
  query,
  onQueryChange,
  classes,
  tags,
  activeClasses,
  activeTags,
  onToggleClass,
  onToggleTag,
  onSelectResult,
  matchCount,
}: Props) {
  const { results, searching } = useSearch(query);
  const { theme } = useGraphStore();
  const [tagQuery, setTagQuery] = useState("");

  // Active tags survive the filter regardless of what is typed: a filter you
  // turned on should never vanish from the panel that turns it off again.
  const visibleTags = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase();
    if (!needle) return tags;
    return tags.filter(
      (tag) => tag.name.toLowerCase().includes(needle) || activeTags.has(tag.name),
    );
  }, [tags, tagQuery, activeTags]);

  return (
    <div className="glass-panel absolute right-5 top-5 z-20 w-80 rounded-xl p-4">
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search memories…"
        aria-label="Search memories"
        className="w-full rounded-lg border border-line/[.12] bg-elevated/[.08] px-3 py-2 text-sm text-strong placeholder:text-faint/70 focus:border-cyan/40 focus:outline-none"
      />

      <AnimatePresence>
        {query.trim() && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
              {results.map((result: NodeSearchResult) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => onSelectResult(result.id)}
                    className="w-full rounded-md px-2 py-1.5 text-left transition hover:bg-elevated/10"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForClass(result.type, theme) }}
                      />
                      <span className="truncate text-xs text-strong">
                        {result.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate pl-3 text-[10px] text-faint">
                      {result.summary}
                    </span>
                  </button>
                </li>
              ))}

              {!searching && results.length === 0 && (
                <li className="px-2 py-1.5 font-mono text-[10px] text-faint/70">
                  no matches
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {classes.length > 0 && (
        <div className="mt-3 border-t border-line/[.12] pt-3">
          <div className="flex flex-wrap gap-1">
            {classes.map((name) => (
              <Chip
                key={name}
                label={labelForClass(name)}
                color={colorForClass(name, theme)}
                active={activeClasses.has(name)}
                onClick={() => onToggleClass(name)}
              />
            ))}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-2">
          {tags.length > TAG_FILTER_THRESHOLD && (
            <input
              value={tagQuery}
              onChange={(event) => setTagQuery(event.target.value)}
              placeholder="Filter tags…"
              aria-label="Filter tags"
              className="mb-2 w-full rounded-lg border border-line/[.12] bg-elevated/[.08] px-2.5 py-1.5 font-mono text-[10px] text-strong placeholder:text-faint/70 focus:border-cyan/40 focus:outline-none"
            />
          )}

          <div className="max-h-40 overflow-y-auto overscroll-contain pr-0.5">
            <div className="flex flex-wrap gap-1">
              {visibleTags.map((tag) => (
                <Chip
                  key={tag.name}
                  label={`#${tag.name}`}
                  active={activeTags.has(tag.name)}
                  onClick={() => onToggleTag(tag.name)}
                />
              ))}

              {visibleTags.length === 0 && (
                <span className="px-1 py-1 font-mono text-[10px] text-faint/70">
                  no tags match
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {matchCount !== null && (
        <p className="mt-3 font-mono text-[10px] text-faint">
          {matchCount} shown · filters active
        </p>
      )}
    </div>
  );
}
