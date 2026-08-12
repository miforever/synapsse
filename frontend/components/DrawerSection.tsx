"use client";

import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useState } from "react";

/**
 * A titled, collapsible block in the memory drawer.
 *
 * The drawer stacks several of these — files, sources — and they have to read
 * as the same kind of thing, which they stop doing the moment one of them
 * grows its own idea of the spacing above its rule or the shape of its count.
 *
 * Collapsed by default, because what a memory *says* is why the drawer is
 * open; its attachments and citations are there when you go looking. The count
 * stays visible while closed, so a memory never hides that it has three files
 * behind a heading that looks empty.
 */
export function DrawerSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Omitted when a bare heading says it better than "0" would. */
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="mt-5 border-t border-line/[.12] pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-[12px] px-1 py-1.5 transition hover:bg-elevated/[.06]"
      >
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 rounded-full bg-elevated/10 px-1.5 py-0.5 text-muted">
              {count}
            </span>
          )}
        </span>
        <span
          className={`font-mono text-[10px] text-faint/70 transition-transform ${
            open ? "" : "-rotate-90"
          }`}
        >
          ▾
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
