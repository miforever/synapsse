"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSearch } from "@/hooks/useSearch";
import { useGraphStore } from "./GraphProvider";
import { colorForClass, labelForClass } from "@/lib/node-classes";
import type { NodeSearchResult } from "@/lib/types";

export interface TagOption {
  name: string;
  count: number;
}

const TAG_FILTER_THRESHOLD = 12;
const TAG_ROWS = 5;
const TAG_ROW_GAP = 4;

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

function SearchIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-faint/70">
      {children}
    </span>
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

  const visibleTags = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase();
    if (!needle) return tags;
    return tags.filter(
      (tag) => tag.name.toLowerCase().includes(needle) || activeTags.has(tag.name),
    );
  }, [tags, tagQuery, activeTags]);

  const listRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>();
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;

    const measure = () => {
      const chip = element.querySelector("button");
      if (chip) {
        const rowHeight = chip.getBoundingClientRect().height;
        setMaxHeight(TAG_ROWS * rowHeight + (TAG_ROWS - 1) * TAG_ROW_GAP);
      }
      setScrollable(element.scrollHeight > element.clientHeight + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [visibleTags]);

  return (
    <div className="glass-panel absolute right-5 top-5 z-20 w-80 rounded-[28px] p-5">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search memories…"
          aria-label="Search memories"
          className="w-full rounded-full border border-line/[.12] bg-elevated/[.08] py-2 pl-10 pr-4 text-sm text-strong placeholder:text-faint/70 focus:border-cyan/40 focus:outline-none"
        />
      </div>

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
          <SectionLabel>Class</SectionLabel>
          <div className="mt-2 flex flex-wrap gap-1">
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
        <div className="mt-3 border-t border-line/[.12] pt-3">
          <div className="flex items-center gap-2">
            <SectionLabel>Tags</SectionLabel>
            <span className="font-mono text-[9px] text-faint/60">
              {tagQuery.trim()
                ? `${visibleTags.length}/${tags.length}`
                : tags.length}
            </span>
            {tags.length > TAG_FILTER_THRESHOLD && (
              <div className="relative ml-auto">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-faint" />
                <input
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  placeholder="filter"
                  aria-label="Filter tags"
                  className="w-32 rounded-full border border-line/[.12] bg-elevated/[.08] py-1 pl-6 pr-3 font-mono text-[10px] text-strong placeholder:text-faint/60 focus:border-cyan/40 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="relative mt-2 rounded-[20px] bg-elevated/[.04] p-3">
            <div
              ref={listRef}
              style={{ maxHeight }}
              className={`scroll-slim overflow-y-auto overscroll-contain pr-1 ${
                scrollable
                  ? "[mask-image:linear-gradient(to_bottom,#000_calc(100%-0.5rem),transparent)]"
                  : ""
              }`}
            >
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
