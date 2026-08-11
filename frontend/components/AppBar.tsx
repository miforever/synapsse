"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useSettings } from "@/hooks/useSettings";
import { useGraphStore } from "./GraphProvider";
import { SettingsPanel } from "./SettingsPanel";

/**
 * The two things you can be looking at, and the ways each can be drawn.
 *
 * Both sections have sub-modes, and both are routes, so the same kind of
 * choice always appears at the same depth and always in the URL.
 */
const SECTIONS = [
  {
    slug: "canvas",
    label: "Canvas",
    // The graph drawn flat or in space — two ways of showing one thing, so
    // they belong under it rather than beside it.
    modes: [
      { slug: "2d", label: "2D" },
      { slug: "3d", label: "3D" },
    ],
  },
  // The roadmap and the board are not two drawings of the same view: one is
  // the order work happens in, the other is where it stands. Different
  // questions, so they sit at the top level with the canvas.
  { slug: "roadmap", label: "Roadmap", modes: [] },
  { slug: "board", label: "Board", modes: [] },
] as const;

export type Section = (typeof SECTIONS)[number]["slug"];

/** Sections with modes remember which one you were on; the rest have none. */
const DEFAULT_MODE: Partial<Record<Section, string>> = { canvas: "3d" };

function hrefFor(slug: Section, mode?: string): string {
  return mode ? `/${slug}/${mode}` : `/${slug}`;
}

export function AppBar() {
  const pathname = usePathname();
  const { settings, updateMedia } = useSettings();
  const {
    data,
    connected,
    // Renamed on the way in: `motion` is framer's namespace in this file.
    motion: driftOn,
    setMotion,
    reducedMotion,
    resetLayout,
    untangle,
    untangling,
    themePreference,
    chooseTheme,
  } = useGraphStore();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const [, section = "canvas", mode = ""] = pathname.split("/");
  const current = SECTIONS.find((item) => item.slug === section) ?? SECTIONS[0];

  // Each section counts what it is about: the canvas counts memories, the
  // roadmap counts the ones that are work.
  const onRoadmap = current.slug === "roadmap";
  // Arranging the canvas means nothing on the roadmap or the board, which draw
  // their own layouts from the same graph.
  const onCanvas = current.slug === "canvas";
  const count = onRoadmap
    ? data.nodes.filter((node) => node.status).length
    : data.nodes.length;
  const countLabel = onRoadmap
    ? count === 1
      ? "item"
      : "items"
    : count === 1
      ? "memory"
      : "memories";

  /*
   * The mode you were last on, per section.
   *
   * Switching to the roadmap and back should return the canvas to 3D if that
   * is where you left it, rather than to whichever mode happens to be first
   * in the list.
   */
  const lastMode = useRef<Record<string, string>>({ ...DEFAULT_MODE });
  useEffect(() => {
    if (mode) lastMode.current[section] = mode;
  }, [section, mode]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/*
        Three anchors that never move or resize: the brand top-left, the
        navigation top-centre, the state of the graph bottom-left. Search owns
        the top-right and the drawer owns the right edge, so nothing here can
        ever grow into something else.
      */}
      <div className="pointer-events-none absolute left-5 top-5 z-30 flex items-center gap-2.5">
        {/*
          The mark keeps its dark plate in both themes. Its rays are violet and
          cyan drawn to glow against near-black; on white they thin out into a
          pale scribble, so the plate travels with it rather than the mark
          being redrawn twice.
        */}
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0A0814]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/branding/synapsse-mark.svg"
            alt=""
            width={20}
            height={20}
          />
        </span>
        <span className="text-sm font-semibold tracking-tight text-strong">
          Synapsse
        </span>
      </div>

      {/*
        One row that lengthens and shrinks.

        Picking Canvas grows it to make room for 2D and 3D; picking anything
        else shrinks it back, because nothing else has a second way of being
        drawn. The width is the only thing that animates — a highlight sliding
        between sections drew the eye to the chrome rather than to what it had
        just switched to.

        Centred by a flex wrapper rather than a translate: a layout animation
        writes the element's transform, so a translate of our own would be
        overwritten mid-flight and the pill would slide off centre as it
        resized.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-5 z-30 flex justify-center">
        <div className="glass-panel pointer-events-auto flex items-center rounded-full px-1.5 py-1">
          <nav className="flex items-center">
            {SECTIONS.map((item) => {
              const active = item.slug === current.slug;
              return (
                <Link
                  key={item.slug}
                  href={hrefFor(
                    item.slug,
                    item.modes.length
                      ? (lastMode.current[item.slug] ?? DEFAULT_MODE[item.slug])
                      : undefined,
                  )}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? "bg-elevated/10 text-strong"
                      : "text-faint hover:text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/*
            The modes are revealed by the pill growing, not dropped into it.
            Animating this group's width from nothing to its content, with the
            overflow clipped, is what makes them slide out from behind the
            sections rather than appearing on top of them — and the pill is
            only as wide as its contents, so its width follows for free.
          */}
          <AnimatePresence initial={false}>
            {current.modes.length > 0 && (
              <motion.div
                key={current.slug}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
                className="flex items-center overflow-hidden"
              >
                <span className="mx-1.5 h-4 w-px shrink-0 bg-elevated/10" />
                {current.modes.map((item) => {
                  const active = item.slug === mode;
                  return (
                    <Link
                      key={item.slug}
                      href={`/${current.slug}/${item.slug}`}
                      aria-current={active ? "true" : undefined}
                      className={`block shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition ${
                        active
                          ? "bg-cyan/15 text-cyan"
                          : "text-faint hover:text-muted"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div
        ref={container}
        className="glass-panel absolute bottom-5 left-5 z-30 rounded-xl px-3 py-2"
      >
        {/* Opens upward, since this sits at the foot of the window. */}
        <SettingsPanel
          open={open}
          above
          onClose={() => setOpen(false)}
          media={settings.media}
          onMediaChange={updateMedia}
          motion={driftOn}
          onMotionChange={setMotion}
          reducedMotion={reducedMotion}
          onResetLayout={resetLayout}
          onUntangle={onCanvas ? untangle : undefined}
          untangling={untangling}
          theme={themePreference}
          onThemeChange={chooseTheme}
        />

        <div className="flex items-center gap-2.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              connected ? "bg-emerald-400" : "bg-slate-600"
            }`}
            title={connected ? "Live" : "Reconnecting…"}
          />
          <span
            data-testid="memory-count"
            className="font-mono text-xs tabular-nums text-muted"
          >
            {count}
          </span>
          {/* The label changes with the section: the two counts are not the
              same thing, and a bare number would read as the graph shrinking
              on the way to the roadmap. */}
          <span className="text-[11px] text-faint">{countLabel}</span>

          <span className="mx-0.5 h-4 w-px bg-elevated/10" />

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label="Settings"
            title="Settings"
            className={`rounded-lg px-2 py-1.5 text-base leading-none transition ${
              open
                ? "bg-elevated/10 text-strong"
                : "text-faint hover:text-muted"
            }`}
          >
            <span
              className={`inline-block transition-transform duration-200 ${
                open ? "rotate-90" : ""
              }`}
            >
              ⚙
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
