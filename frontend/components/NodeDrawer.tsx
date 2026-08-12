"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { attachFile, detachFile, fetchNode, fileUrl } from "@/lib/api";
import { isImage } from "@/lib/files";
import { useGraphStore } from "./GraphProvider";
import { colorForClass, labelForClass } from "@/lib/node-classes";
import type {
  FileRef,
  GraphEdge,
  GraphNode,
  MediaSettings,
  NodeDetail,
} from "@/lib/types";
import { endpointId } from "@/lib/types";
import { FileList } from "./FileList";
import { SourceList } from "./SourceList";
import { MemoryContent } from "./MemoryContent";

/** Narrower than the drawer and it is an icon, not a cover. */
const MIN_COVER_PX = 240;

interface Props {
  node: GraphNode | null;
  edges: GraphEdge[];
  /** Resolves edge endpoints to real memories — an id alone tells you nothing. */
  nodesById: Map<string, GraphNode>;
  media: MediaSettings;
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
}

export function NodeDrawer({
  node,
  edges,
  nodesById,
  media,
  onClose,
  onNavigate,
}: Props) {
  const { theme } = useGraphStore();
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  // Sticky across nodes on purpose: someone traversing the graph wants the
  // connection list to stay however they left it.
  const [showConnections, setShowConnections] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  /** Set once a cover image turns out to be too small to be worth showing. */
  const [coverTooSmall, setCoverTooSmall] = useState(false);
  /** Which memory is currently on screen, as opposed to being re-read. */
  const shownId = useRef<string | null>(null);

  /**
   * Attach whatever was dropped.
   *
   * Uploaded one at a time rather than in parallel: a drop of a dozen files
   * would otherwise open a dozen sockets to a daemon that is usually a laptop,
   * and the order they arrive in is the order they were dropped.
   *
   * The detail is re-read from the response of each upload rather than
   * waiting for the daemon's broadcast, so the list updates immediately even
   * if the socket is down.
   */
  const attach = useCallback(
    // A plain array, not the DOM's FileList: that name now belongs to the
    // component below, and a parameter typed against the shadowed global is a
    // trap for whoever edits this next.
    async (dropped: readonly File[]) => {
      if (!node || dropped.length === 0) return;

      setUploading(true);
      setUploadError(null);
      try {
        for (const file of dropped) {
          const attached = await attachFile(node.id, file);
          setDetail((current) =>
            current && current.id === attached.node_id
              ? { ...current, files: [...current.files, attached] }
              : current,
          );
        }
      } catch (failure) {
        setUploadError(
          failure instanceof Error ? failure.message : "Could not attach",
        );
      } finally {
        setUploading(false);
      }
    },
    [node],
  );

  const removeFile = useCallback(async (file: FileRef) => {
    // Removed from the list first: the request is against the daemon on this
    // machine, and waiting on it to redraw makes the click feel unanswered.
    setDetail((current) =>
      current
        ? { ...current, files: current.files.filter((f) => f.id !== file.id) }
        : current,
    );

    try {
      await detachFile(file.id);
    } catch {
      // Put it back. Showing an attachment as gone while it is still on the
      // daemon is worse than the delay this avoided.
      setUploadError(`Could not remove ${file.name}`);
      setDetail((current) =>
        current && !current.files.some((f) => f.id === file.id)
          ? { ...current, files: [...current.files, file] }
          : current,
      );
    }
  }, []);

  /**
   * Load the open memory, and reload it when the daemon says it changed.
   *
   * The node object's identity changes on every update — an agent editing it,
   * or an attachment of our own — so this runs again each time. It only clears
   * what is on screen when a *different* memory is being opened: blanking a
   * memory you are reading back to "loading…" because a file was just attached
   * to it makes an addition look like a reset.
   */
  const openId = node?.id;
  useEffect(() => {
    if (!node) return;

    const switching = shownId.current !== node.id;
    if (switching) {
      setDetail(null);
      setCoverTooSmall(false);
      shownId.current = node.id;
    }

    const controller = new AbortController();
    fetchNode(node.id, controller.signal)
      .then(setDetail)
      .catch(() => {
        // Leave whatever is on screen: a failed refresh of a memory that is
        // already open should not empty the panel.
        if (switching) setDetail(null);
      });

    return () => controller.abort();
    // openId participates so that opening a different memory is distinguished
    // from the same one changing under us.
  }, [node, openId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const related = node
    ? edges.filter(
        (edge) =>
          endpointId(edge.source) === node.id ||
          endpointId(edge.target) === node.id,
      )
    : [];

  const files = detail?.files ?? [];
  const sources = detail?.sources ?? [];

  /*
   * The picture at the top of the card.
   *
   * The memory's own thumbnail if it has one, otherwise its first attached
   * image — attaching a screenshot is the common way a memory acquires a
   * picture, and it would be odd for that to show in the file list but not at
   * the top. A thumbnail_url points somewhere on the internet so it waits for
   * consent; an attachment is served by the daemon itself, so it never does.
   */
  const attachedImage = files.find((file) => isImage(file));
  const cover =
    (media.remote_content && node?.thumbnail_url) ||
    (attachedImage ? fileUrl(attachedImage) : null);

  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 260 }}
          /*
           * The whole panel is the drop target, not a designated strip of it.
           * Aiming at a small zone is work, and there is nothing else you
           * could mean by dropping a file onto an open memory.
           */
          onDragOver={(event) => {
            event.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(event) => {
            // Fires for every child crossed on the way through, so the state
            // only clears when the pointer has actually left the panel.
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDropping(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDropping(false);
            void attach(Array.from(event.dataTransfer.files));
          }}
          className="glass-panel absolute right-0 top-0 z-30 flex h-full w-full max-w-md flex-col border-l"
        >
          {dropping && (
            <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-[24px] border-2 border-dashed border-cyan/50 bg-cyan/5">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-200">
                Attach to this memory
              </span>
            </div>
          )}
          <header className="relative shrink-0 border-b border-line/[.12]">
            {/*
              The picture first, then what kind of thing this is, then its
              name. A memory with an image is recognised by the image long
              before its title is read, so making the reader get past a text
              header to reach it has the order backwards.
            */}
            {cover && !coverTooSmall && (
              <div className="relative h-40 w-full overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={cover}
                  alt=""
                  className="h-full w-full object-cover"
                  /*
                   * An icon-sized attachment is not a cover.
                   *
                   * object-cover will happily blow a 16-pixel image up to fill
                   * the band, and the result is a smear of colour that tells
                   * the reader nothing. Dimensions are only knowable once the
                   * image has decoded, so the header drops it at that point
                   * rather than reserving space for something unusable.
                   */
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (image.naturalWidth < MIN_COVER_PX) setCoverTooSmall(true);
                  }}
                  onError={() => setCoverTooSmall(true)}
                />
                {/* The panel's own background, faded up over the foot of the
                    image so the text below it never sits on a hard edge. */}
                <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-canvas to-transparent" />
              </div>
            )}

            <div className="flex items-start gap-3 p-5">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: colorForClass(node.type, theme) }}
              />
              <div className="min-w-0 flex-1">
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.2em]"
                  style={{ color: colorForClass(node.type, theme) }}
                >
                  {labelForClass(node.type)}
                </span>
                <h2 className="mt-1 text-lg font-semibold leading-tight text-strong">
                  {node.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                title="Close (Esc)"
                className={`shrink-0 rounded-full px-2 py-1 font-mono text-xs transition hover:bg-elevated/10 hover:text-strong ${
                  cover
                    ? "absolute right-3 top-3 bg-elevated/20 text-strong backdrop-blur"
                    : "text-muted"
                }`}
              >
                ✕
              </button>
            </div>
          </header>

          {/* Only the reading area scrolls, so connections never drift out of
              reach behind a long memory. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <p className="text-sm italic leading-relaxed text-muted">
              {node.summary}
            </p>

            {node.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {node.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-line/[.12] bg-raised px-2 py-0.5 font-mono text-[10px] text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 border-t border-line/[.12] pt-5">
              {detail ? (
                <MemoryContent
                  content={detail.content}
                  media={media}
                  files={files}
                  sources={sources}
                />
              ) : (
                <p className="font-mono text-xs text-faint">loading…</p>
              )}
            </div>

            {detail && sources.length > 0 && <SourceList sources={sources} />}

            {detail && (
              <FileList
                files={files}
                busy={uploading}
                error={uploadError}
                onRemove={removeFile}
              />
            )}
          </div>

          {/* Pinned below the content: navigation stays one glance away
              whatever the memory's length, and collapses when the reader
              wants the room back. */}
          {related.length > 0 && (
            <section className="shrink-0 border-t border-line/[.12] bg-elevated/[.05]">
              <button
                type="button"
                onClick={() => setShowConnections((open) => !open)}
                aria-expanded={showConnections}
                className="flex w-full items-center justify-between px-5 py-3 transition hover:bg-elevated/[.06]"
              >
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  Connections
                  <span className="ml-2 rounded-full bg-elevated/10 px-1.5 py-0.5 text-muted">
                    {related.length}
                  </span>
                </span>
                <span
                  className={`font-mono text-[10px] text-faint transition-transform ${
                    showConnections ? "" : "-rotate-90"
                  }`}
                >
                  ▾
                </span>
              </button>

              <AnimatePresence initial={false}>
                {showConnections && (
                  <motion.ul
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    // Capped so a heavily linked memory cannot swallow the
                    // whole drawer; it scrolls within its own space instead.
                    className="max-h-52 space-y-0.5 overflow-y-auto px-3 pb-3"
                  >
                    {related.map((edge) => {
                      const outgoing = endpointId(edge.source) === node.id;
                      const otherId = outgoing
                        ? endpointId(edge.target)
                        : endpointId(edge.source);
                      const other = nodesById.get(otherId);

                      return (
                        <li key={edge.id}>
                          <button
                            type="button"
                            onClick={() => onNavigate(otherId)}
                            className="flex w-full items-center gap-2 rounded-[14px] px-2 py-1.5 text-left transition hover:bg-elevated/10"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: colorForClass(
                                  other?.type ?? "fact",
                                ),
                              }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-strong">
                                {other?.title ?? "Unknown memory"}
                              </span>
                              <span className="block font-mono text-[10px] text-faint">
                                {outgoing ? "→" : "←"} {edge.relation_type}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </motion.ul>
                )}
              </AnimatePresence>
            </section>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
