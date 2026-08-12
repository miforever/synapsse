"use client";

import { useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  citedSource,
  FILE_SCHEME,
  mentionedFile,
  resolveReferences,
  SOURCE_SCHEME,
} from "@/lib/file-mentions";
import { isExternal, mediaKind } from "@/lib/media";
import type { FileRef, MediaSettings, SourceRef } from "@/lib/types";
import { FileChip } from "./FileChip";
import { SourceChip } from "./SourceChip";

interface Props {
  content: string;
  media: MediaSettings;
  /** The memory's attachments, so `[[file:NAME]]` can be resolved inline. */
  files?: readonly FileRef[];
  /** Its citations, so `[[src:N]]` can be too. */
  sources?: readonly SourceRef[];
}

/** Shown in place of media the user has not enabled. */
function Placeholder({
  label,
  href,
  onLoad,
}: {
  label: string;
  href: string;
  onLoad?: () => void;
}) {
  return (
    <span className="my-2 flex items-center gap-3 rounded-[16px] border border-line/[.12] bg-raised px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
        {label}
      </span>
      {onLoad ? (
        <button
          type="button"
          onClick={onLoad}
          className="font-mono text-[10px] text-cyan-300 underline-offset-2 hover:underline"
        >
          load
        </button>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-mono text-[10px] text-cyan-300 underline-offset-2 hover:underline"
        >
          {href}
        </a>
      )}
    </span>
  );
}

/** Click-to-load wrapper, so opening a memory never auto-fetches media. */
function Deferred({
  label,
  src,
  render,
}: {
  label: string;
  src: string;
  render: () => React.ReactNode;
}) {
  const [loaded, setLoaded] = useState(false);
  if (loaded) return <>{render()}</>;
  return <Placeholder label={label} href={src} onLoad={() => setLoaded(true)} />;
}

/**
 * Renders agent-authored Markdown.
 *
 * remark-gfm turns bare URLs into links, so a pasted address is clickable
 * without link syntax. Raw HTML is never enabled — this content is written by
 * agents, and react-markdown escaping it is what keeps that safe.
 */
export function MemoryContent({
  content,
  media,
  files = [],
  sources = [],
}: Props) {
  // Anything the daemon serves is ours; anything else waits for consent.
  const allowSource = (src: string) => media.remote_content || !isExternal(src);

  return (
    <div className="prose-synapsse text-sm leading-relaxed text-muted">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        /*
         * Let our own scheme through.
         *
         * react-markdown blanks any href outside http/https/mailto/tel, which
         * is what keeps `javascript:` out of agent-authored content — and it
         * took the resolved file links with it, so every mention arrived at
         * the renderer below with nothing to identify it. Everything else
         * still goes through the default check.
         */
        urlTransform={(url) =>
          url.startsWith(FILE_SCHEME) || url.startsWith(SOURCE_SCHEME)
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => {
            // A mention of one of this memory's own attachments renders as
            // something to open rather than as a link to a scheme no browser
            // knows what to do with.
            const attached = mentionedFile(href, files);
            if (attached) return <FileChip file={attached} />;

            const cited = citedSource(href, sources);
            if (cited) return <SourceChip source={cited} />;

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-300 underline decoration-cyan-300/30 underline-offset-2 hover:decoration-cyan-300"
              >
                {children}
              </a>
            );
          },

          // Markdown has no audio/video syntax, so ![](clip.mp3) arrives here
          // too. Route each URL to the right player instead of a broken image.
          img: ({ src, alt }) => {
            const url = typeof src === "string" ? src : "";
            if (!url) return null;

            const kind = mediaKind(url);
            const label = alt || kind;

            if (!allowSource(url)) {
              return <Placeholder label={`${kind} · remote`} href={url} />;
            }

            if (kind === "audio") {
              return (
                <Deferred
                  label="audio"
                  src={url}
                  render={() => (
                    <audio controls preload="none" src={url} className="my-2 w-full">
                      {label}
                    </audio>
                  )}
                />
              );
            }

            if (kind === "video") {
              return (
                <Deferred
                  label="video"
                  src={url}
                  render={() => (
                    <video
                      controls
                      preload="none"
                      src={url}
                      className="my-2 w-full rounded-[16px]"
                    />
                  )}
                />
              );
            }

            // next/image is not usable here: memory content can reference any
            // host, and remote patterns cannot be whitelisted ahead of time.
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={label}
                loading="lazy"
                className="my-2 max-w-full rounded-[16px] border border-line/[.12]"
              />
            );
          },
        }}
      >
        {resolveReferences(content, files, sources)}
      </ReactMarkdown>
    </div>
  );
}
