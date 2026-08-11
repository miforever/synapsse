"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ThemePreference } from "@/hooks/useTheme";
import type { UntangleMode } from "@/hooks/useUntangle";
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
  onUntangle?: (mode: UntangleMode) => void;
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
 * One thing you can do to the canvas, as a mark that names itself.
 *
 * The label sits above rather than below: this panel opens upward from the
 * foot of the window, so anything hung underneath a control is off-screen or
 * over the bar itself. Pointer-events are off on the label so it can never
 * come between the pointer and the button that raised it.
 */
function Action({
  mark,
  name,
  hint,
  busy,
  disabled,
  onClick,
}: {
  mark: string;
  name: string;
  hint: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <span className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={`${name}. ${hint}`}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-faint transition hover:bg-elevated/[.08] hover:text-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className={busy ? "inline-block animate-spin" : undefined}>
          {mark}
        </span>
      </button>

      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line/[.12] bg-canvas/95 px-2 py-1 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        <span className="block text-[11px] leading-none text-strong">
          {name}
        </span>
        <span className="mt-0.5 block text-[10px] leading-none text-faint">
          {hint}
        </span>
      </span>
    </span>
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
            {/*
              A row of marks rather than three more labelled rows.

              These are things you do, not settings you read, and the switches
              above already carry a paragraph each - a third and fourth made
              the panel a wall of prose you had to scan to find one button.
              What each does is one short line, and it only has to be there
              while you are pointing at it.
            */}
            <div className="flex items-center gap-1 px-1 py-1">
              {onUntangle && (
                <Action
                  mark="✳"
                  name={untangling ? "Untangling" : "Untangle"}
                  hint="Let the graph find its own shape"
                  busy={untangling}
                  disabled={untangling}
                  onClick={() => onUntangle("free")}
                />
              )}
              {onUntangle && (
                <Action
                  mark="◎"
                  name="By connection"
                  hint="Rings out from the busiest memory"
                  busy={untangling}
                  disabled={untangling}
                  onClick={() => onUntangle("levels")}
                />
              )}
              {/*
                Dragging a memory pins it, and pins outlive the session, so
                there has to be a way back. Without this the only route to an
                automatic layout again would be editing the database.
              */}
              <Action
                mark="↺"
                name="Reset"
                hint="Release everything placed by hand"
                onClick={() => {
                  onResetLayout();
                  onClose();
                }}
              />
            </div>

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
