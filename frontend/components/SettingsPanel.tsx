"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ThemePreference } from "@/hooks/useTheme";
import type { MediaSettings } from "@/lib/types";

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

interface Props {
  open: boolean;
  /** Grows upward, for a control anchored to the bottom of the window. */
  above?: boolean;
  media: MediaSettings;
  onMediaChange: (media: Partial<MediaSettings>) => void;
  motion: boolean;
  onMotionChange: (motion: boolean) => void;
  reducedMotion: boolean;
  onResetLayout: () => void;
  /** Absent where there is no canvas to arrange, and then the control is not
   *  offered at all - a disabled button would only pose a question. */
  onUntangle?: () => void;
  untangling: boolean;
  onClose: () => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-elevated/[.06] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? "bg-cyan/70" : "bg-elevated/15"
        }`}
      >
        <span
          className={`h-3 w-3 rounded-full bg-strong transition-transform ${
            checked ? "translate-x-3" : ""
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-strong">{label}</span>
        <span className="block text-[10px] leading-snug text-faint">
          {hint}
        </span>
      </span>
    </button>
  );
}

/**
 * Secondary controls, unfolding from the bar they belong to.
 *
 * Not a popover any more: as a floating card it read as a separate window that
 * happened to appear near the bar, and it covered the canvas underneath it.
 * Growing the bar's own body downward keeps one object on screen — the panel
 * you were already looking at, with more of itself showing.
 *
 * Open state is owned by the bar rather than by this component, since the bar
 * is what changes shape.
 */
export function SettingsPanel({
  open,
  above = false,
  media,
  onMediaChange,
  motion: motionOn,
  onMotionChange,
  reducedMotion,
  onResetLayout,
  onUntangle,
  untangling,
  onClose,
  theme,
  onThemeChange,
}: Props) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          // Height and opacity together: height alone slides the content into
          // view like a drawer of text, and the fade is what makes it read as
          // the panel deepening instead.
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          className="overflow-hidden"
        >
          <div
            className={`w-72 ${
              above
                ? "mb-3 border-b border-line/[.12] pb-2"
                : "mt-3 border-t border-line/[.12] pt-2"
            }`}
          >
            <p className="px-2 pb-1 pt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-faint/70">
              Appearance
            </p>
            <div className="flex gap-1 px-2 pb-1">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onThemeChange(option.value)}
                  aria-pressed={theme === option.value}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] transition ${
                    theme === option.value
                      ? "bg-elevated/10 text-strong"
                      : "text-faint hover:text-muted"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="mt-2 px-2 pb-1 pt-1 font-mono text-[9px] uppercase tracking-[0.2em] text-faint/70">
              Canvas
            </p>
            <Switch
              label="Ambient drift"
              hint={
                reducedMotion
                  ? "Disabled — your system asks for reduced motion"
                  : "Nodes breathe in place, and the 3D scene turns slowly"
              }
              checked={motionOn}
              disabled={reducedMotion}
              onChange={onMotionChange}
            />

            {/*
              The counterpart to resetting: one puts the simulation back in
              charge, the other takes it off it entirely. They belong together,
              untangling first, since it is the one you reach for while looking
              at a graph you cannot read.

              The panel stays open here, unlike the reset below. Untangling is
              something you watch land, and closing the panel over it would
              hide the thing the press was for.
            */}
            {onUntangle && (
            <button
              type="button"
              onClick={onUntangle}
              disabled={untangling}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-elevated/[.06] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span
                className={`mt-0.5 flex h-4 w-7 shrink-0 items-center justify-center text-faint ${
                  untangling ? "animate-spin" : ""
                }`}
              >
                ✻
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-strong">
                  {untangling ? "Untangling…" : "Untangle"}
                </span>
                <span className="block text-[10px] leading-snug text-faint">
                  Open the graph into rings around its most connected memories,
                  so every branch gets its own space
                </span>
              </span>
            </button>
            )}

            {/*
              Dragging a memory pins it, and pins now outlive the session — so
              there has to be a way back. Without this the only route to an
              automatic layout again would be editing the database.
            */}
            <button
              type="button"
              onClick={() => {
                onResetLayout();
                onClose();
              }}
              className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-elevated/[.06]"
            >
              <span className="mt-0.5 flex h-4 w-7 shrink-0 items-center justify-center text-faint">
                ↺
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-strong">
                  Reset arrangement
                </span>
                <span className="block text-[10px] leading-snug text-faint">
                  Release every memory you placed by hand and lay the graph out
                  afresh
                </span>
              </span>
            </button>

            <p className="mt-2 px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-faint/70">
              Content
            </p>
            <Switch
              label="Remote content"
              hint="Load pictures, audio and video that memories point at on other sites. Memories are written by agents, so this stays off until you allow it. Files you attach are always shown."
              checked={media.remote_content}
              onChange={(remote_content) => onMediaChange({ remote_content })}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
