"use client";

import { fileUrl } from "@/lib/api";
import { formatSize, isImage, kindOf } from "@/lib/files";
import type { FileRef } from "@/lib/types";
import { HoverAnchor, HoverPreview } from "./HoverPreview";

/**
 * A file mentioned in the middle of a memory's text.
 *
 * Sits inline like a word rather than breaking the paragraph, because that is
 * where the agent put it — "the numbers in [[file:q3.xlsx]] disagree" reads as
 * a sentence, and a full-width attachment card in the middle of it would not.
 *
 * Hovering shows what it is before you commit to opening it: images preview
 * themselves, everything else states its kind and size.
 */
export function FileChip({ file }: { file: FileRef }) {
  const href = fileUrl(file);

  return (
    <HoverAnchor>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-baseline gap-1 rounded-full border border-cyan/20 bg-cyan/10 px-1.5 py-0.5 align-baseline text-[0.9em] text-cyan-200 no-underline transition hover:border-cyan/50 hover:bg-cyan/20 hover:text-strong"
      >
        <span aria-hidden className="font-mono text-[0.85em] opacity-70">
          ↗
        </span>
        {file.name}
      </a>

      <HoverPreview width="w-max max-w-[16rem]">
        {isImage(file) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={href}
            alt=""
            loading="lazy"
            className="mb-1.5 max-h-40 max-w-full rounded"
          />
        )}
        <span className="block truncate font-mono text-[10px] text-muted">
          {file.name}
        </span>
        <span className="block font-mono text-[10px] uppercase tracking-widest text-faint">
          {kindOf(file)} · {formatSize(file.size)}
        </span>
      </HoverPreview>
    </HoverAnchor>
  );
}
