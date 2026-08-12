"use client";

import type { SourceRef } from "@/lib/types";
import { DrawerSection } from "./DrawerSection";

/**
 * The memory's citations, gathered at the foot of what it says.
 *
 * The inline numbers are for reading; this is for checking. Someone deciding
 * whether to trust a memory wants to see everything it was written from at
 * once, rather than hovering each citation in turn to find out.
 */
export function SourceList({ sources }: { sources: readonly SourceRef[] }) {
  return (
    <DrawerSection title="Sources" count={sources.length}>
      <ol className="mt-2 space-y-1">
        {sources.map((source) => (
          <li key={source.id}>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-2.5 rounded-[14px] p-2 transition hover:bg-elevated/[.06]"
            >
              {/* The same number the text cites, so a reader following a
                  citation lands on the right line without counting. */}
              <span className="mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full border border-violet-400/30 bg-violet-400/15 px-1 font-mono text-[9px] leading-none text-violet-200">
                {source.position}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-strong">
                  {source.title || source.url}
                </span>
                <span className="block truncate font-mono text-[10px] text-faint">
                  {source.site}
                </span>
                {source.snippet && (
                  <span className="mt-1 line-clamp-2 block text-[11px] italic leading-relaxed text-faint">
                    {source.snippet}
                  </span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ol>
    </DrawerSection>
  );
}
