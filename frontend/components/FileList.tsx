"use client";

import { fileUrl } from "@/lib/api";
import { formatSize, isImage, kindOf } from "@/lib/files";
import type { FileRef } from "@/lib/types";
import { DrawerSection } from "./DrawerSection";

interface Props {
  files: readonly FileRef[];
  /** An upload in flight, so the section can say so rather than sit still. */
  busy: boolean;
  error: string | null;
  onRemove: (file: FileRef) => void;
}

/**
 * Everything attached to the open memory.
 *
 * Shown even when empty, because it is also the instruction: a memory with no
 * attachments is where you most need to be told that dropping one here is
 * possible at all.
 */
export function FileList({ files, busy, error, onRemove }: Props) {
  return (
    <DrawerSection
      title="Files"
      count={files.length}
      // Nothing attached yet? Open, because this section is also where you
      // find out that dropping a file here is possible at all.
      defaultOpen={files.length === 0}
    >
      {files.length === 0 && !busy && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Drop a file anywhere on this panel to attach it, or have an agent
          call <code className="font-mono text-muted">attach_file</code>.
        </p>
      )}

      {error && (
        <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{error}</p>
      )}

      {busy && (
        <p className="mt-2 font-mono text-[11px] text-faint">attaching…</p>
      )}

      <ul className="mt-2 space-y-1">
        {files.map((file) => (
          <li
            key={file.id}
            className="group flex items-center gap-2.5 rounded-[16px] border border-line/[.07] bg-raised p-2"
          >
            {isImage(file) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={fileUrl(file)}
                alt=""
                loading="lazy"
                className="h-9 w-9 shrink-0 rounded object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-elevated/[.08] font-mono text-[9px] uppercase text-muted">
                {kindOf(file).slice(0, 4)}
              </span>
            )}

            <a
              href={fileUrl(file)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1"
            >
              <span className="block truncate text-xs text-strong hover:text-strong">
                {file.name}
              </span>
              <span className="block font-mono text-[10px] text-faint">
                {kindOf(file)} · {formatSize(file.size)}
              </span>
            </a>

            {/*
              Only on hover: a delete control sitting permanently beside every
              attachment invites the accident it is easiest to regret, since
              the bytes go with the row.
            */}
            <button
              type="button"
              onClick={() => onRemove(file)}
              aria-label={`Remove ${file.name}`}
              title="Remove attachment"
              className="shrink-0 rounded px-1.5 py-1 font-mono text-[11px] text-faint/70 opacity-0 transition hover:bg-elevated/10 hover:text-rose-300 focus:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </DrawerSection>
  );
}
