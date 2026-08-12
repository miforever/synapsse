"use client";

import type { ReactNode } from "react";

/**
 * A card that appears above something written into a sentence.
 *
 * Shared by attachments and citations: it has to sit above the line without
 * displacing it, ignore the pointer so it never comes between the cursor and
 * the thing that raised it, and be absent rather than transparent when closed.
 */
export function HoverPreview({
  children,
  width = "w-72",
}: {
  children: ReactNode;
  /** Tailwind width class. Files preview an image; citations, a passage. */
  width?: string;
}) {
  return (
    <span
      className={`pointer-events-none absolute bottom-full left-0 z-40 mb-1.5 hidden group-hover:block ${width}`}
    >
      <span className="glass-panel block rounded-[20px] p-3">{children}</span>
    </span>
  );
}

/** The anchor a preview hangs from. Establishes the hover group. */
export function HoverAnchor({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-block align-baseline">{children}</span>
  );
}
