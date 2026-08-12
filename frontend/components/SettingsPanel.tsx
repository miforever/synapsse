"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ThemePreference } from "@/hooks/useTheme";
import type { MediaSettings } from "@/lib/types";

/*
 * One icon grammar for the whole panel.
 *
 * Every mark is drawn in the same 24-unit box with the same stroke weight and
 * the same round caps, so a row of them reads as one set rather than as
 * whatever glyphs the platform font happened to have. Text symbols were the
 * previous approach and they arrived at different weights, different optical
 * sizes and different baselines on every machine.
 */
const PATHS = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="17" r="2.4" />
      <circle cx="17" cy="18" r="2.4" />
      <circle cx="13" cy="6" r="2.4" />
      <path d="M7.6 15.2 11.6 8M14.8 7.8l1.7 7.9" />
    </>
  ),
  reset: (
    <>
      <path d="M4 10a8 8 0 1 1 .9 5.6" />
      <path d="M3.5 4.5V10H9" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.6v.1" />
    </>
  ),
} as const;

type IconName = keyof typeof PATHS;

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? "h-3.5 w-3.5"}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Weighted toward settling rather than overshooting, matching the navigation
 *  pill at the top of the window: the plate is a background object, and a
 *  springy one competes with the label sitting on it. */
const SLIDE = { type: "spring", stiffness: 420, damping: 38, mass: 0.7 } as const;

/** The panel's own width, which the bar takes on while it is open. Stated as a
 *  number because the collapse animates it back to nothing. */
const WIDTH = 256;

const THEMES = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
] as const satisfies readonly { icon: IconName; [key: string]: unknown }[];

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

interface Tip {
  text: string;
  x: number;
  y: number;
}

/** Half the tip's widest allowed width, which is all the clamp needs to keep
 *  the box on screen without measuring it first. */
const TIP_HALF = 116;

/**
 * The hint, drawn on the body rather than inside the panel.
 *
 * This is why the old tooltips were invisible: the panel clips its own
 * contents while it animates, and it sits inside a stack of positioned,
 * blurred layers. Anything drawn as a child of a control was cut off at the
 * panel's edge the moment it needed more width than the button it hung from. A
 * portal to `document.body` has no such parent, so the box can be any size it
 * likes and is never behind anything.
 *
 * It rides the cursor and clamps to the viewport, so a control near an edge
 * still gets a readable box.
 */
function Tooltip({ tip }: { tip: Tip | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !tip) return null;

  const x = Math.min(
    Math.max(tip.x, TIP_HALF + 8),
    window.innerWidth - TIP_HALF - 8,
  );
  // Above the cursor by default, and below it only when there is no room -
  // near the top of the window the box would otherwise hang off screen.
  const below = tip.y < 96;

  return createPortal(
    <div
      role="tooltip"
      style={{
        left: x,
        top: tip.y + (below ? 20 : -14),
        transform: `translate(-50%, ${below ? "0" : "-100%"})`,
      }}
      className="pointer-events-none fixed z-[100] max-w-[232px] rounded-[14px] border border-line/[.14] bg-raised/95 px-2.5 py-1.5 text-[10.5px] leading-snug text-muted shadow-[0_8px_24px_rgb(0_0_0/45%)] backdrop-blur-md"
    >
      {tip.text}
    </div>,
    document.body,
  );
}

/** What anything explainable reports while the pointer or focus is on it. */
type Explain = (tip: Tip | null) => void;

/**
 * The handlers that make one thing explain itself.
 *
 * `pointermove` as well as enter, so the box tracks the cursor across a wide
 * control instead of sticking where it first landed. Focus reports from the
 * middle of the element, so the keyboard gets the same sentence the pointer
 * does.
 */
function explains(text: string, explain: Explain) {
  const track = (event: React.PointerEvent) =>
    explain({ text, x: event.clientX, y: event.clientY });

  return {
    onPointerEnter: track,
    onPointerMove: track,
    onPointerLeave: () => explain(null),
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      explain({ text, x: box.left + box.width / 2, y: box.top });
    },
    onBlur: () => explain(null),
  };
}

/**
 * The mark you point at to be told more.
 *
 * A row that explains itself the moment the pointer crosses it puts a box on
 * screen every time you travel to the switch you already knew you wanted. The
 * question mark makes asking deliberate: nothing appears until you go to it.
 *
 * A span rather than a button, and deliberately not focusable - the switch it
 * belongs to already carries the same sentence in its accessible name, so a
 * second tab stop would only make the keyboard read it twice.
 */
function Info({ hint, explain }: { hint: string; explain: Explain }) {
  return (
    <span
      {...explains(hint, explain)}
      className="ml-1 inline-flex shrink-0 text-faint/50 transition-colors hover:text-strong"
    >
      <Icon name="info" className="h-3 w-3" />
    </span>
  );
}

/**
 * A setting that is either on or off: its name, the mark that explains it, and
 * the switch.
 *
 * No sentence under the label. Three of those turned the panel into a wall of
 * prose you had to read through to find one control.
 */
function Row({
  label,
  hint,
  checked,
  disabled,
  onChange,
  explain,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  explain: Explain;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}. ${hint}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-1 rounded-[14px] px-2.5 py-[7px] text-left transition hover:bg-elevated/[.07] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="min-w-0 truncate text-[12px] text-strong">{label}</span>
      <Info hint={hint} explain={explain} />
      <span className="flex-1" />
      <span
        className={`flex h-[15px] w-[26px] shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked
            ? "bg-cyan/80 shadow-[0_0_10px_-2px_rgb(var(--accent)/60%)]"
            : "bg-elevated/15 shadow-[inset_0_0_0_1px_rgb(var(--line)/8%)]"
        }`}
      >
        <span
          className={`h-[11px] w-[11px] rounded-full bg-strong shadow-sm transition-transform duration-200 ease-out ${
            checked ? "translate-x-[13px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

/**
 * One thing you can do to the canvas: a mark and its name, on one line.
 *
 * The two are not equals and are no longer drawn as though they were. Two
 * matched slabs said press either, they are the same kind of thing, when one
 * is the reason the menu gets opened and the other is a way back you reach for
 * once a month. Weight follows that: Untangle is the only object in the panel
 * wearing the accent, and Reset gives up its box entirely and sits under it as
 * a line of text that brightens when you go to it.
 *
 * Spending the accent exactly once is the point. A cyan rim on both would make
 * neither of them the answer to what do I press, and the colour already means
 * something everywhere else on the canvas.
 *
 * The hint hangs off the wrapper, not off the button. A disabled control
 * dispatches no pointer events at all, so a button that explained itself
 * stopped explaining itself the moment you pressed it and it went busy -
 * exactly when you most want to be told what it is doing. The wrapper is never
 * disabled, so the sentence survives.
 */
function Action({
  icon,
  name,
  hint,
  tone = "quiet",
  busy,
  disabled,
  onClick,
  explain,
}: {
  icon: IconName;
  name: string;
  hint: string;
  tone?: "primary" | "quiet";
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  explain: Explain;
}) {
  const primary = tone === "primary";

  return (
    <span className="flex" {...explains(hint, explain)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={`${name}. ${hint}`}
        className={`flex w-full items-center gap-2.5 rounded-[14px] px-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
          primary
            ? // Glass with a lit top edge and a glow that sits just outside
              // it, so the button reads as raised out of the panel rather than
              // painted onto it.
              "border border-cyan/25 bg-cyan/[.07] py-2 text-strong shadow-[inset_0_1px_0_rgb(255_255_255/8%),0_0_20px_-8px_rgb(var(--accent)/70%)] hover:border-cyan/40 hover:bg-cyan/[.12] hover:shadow-[inset_0_1px_0_rgb(255_255_255/10%),0_0_24px_-6px_rgb(var(--accent)/90%)] active:bg-cyan/[.05] disabled:hover:border-cyan/25 disabled:hover:bg-cyan/[.07]"
            : "py-[7px] text-faint hover:bg-elevated/[.07] hover:text-strong"
        }`}
      >
        <Icon
          name={icon}
          className={`h-3.5 w-3.5 shrink-0 ${primary ? "text-cyan" : ""} ${
            busy ? "animate-spin" : ""
          }`}
        />
        <span className="text-[12px] leading-none">{name}</span>
      </button>
    </span>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <p className="px-2.5 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-faint/70">
      {children}
    </p>
  );
}

/**
 * Secondary controls, unfolding from the bar they belong to.
 *
 * Not a popover: as a floating card it read as a separate window that happened
 * to appear near the bar, and it covered the canvas underneath. Growing the
 * bar's own body keeps one object on screen - the panel you were already
 * looking at, with more of itself showing.
 *
 * Ordered by kind rather than by subject: the theme, then the things you do,
 * then the things that stay on or off. The two switches sit together at the
 * foot because they are the same sort of control.
 *
 * Always mounted, and closed by animating to nothing rather than by
 * unmounting. Under `AnimatePresence` the exit is a one-shot animation, and
 * anything that interrupts it - pressing Reset re-runs the layout, which is
 * enough - strands the element on screen at whatever size it had reached, so
 * the bar stayed stretched to the panel's width with nothing in it. Driving
 * width and height from `open` on every render means an interrupted close is
 * simply resumed toward the same target instead of abandoned.
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
  const [tip, setTip] = useState<Tip | null>(null);

  /*
   * Taken out of the page once it has finished closing.
   *
   * A panel at zero height still holds focusable controls, so tabbing into a
   * closed menu is a trap with no way out - `visibility: hidden` is what takes
   * them out of the tab order. It has to be lifted the instant the panel is
   * asked to open, though, and put back only once the collapse has actually
   * finished: framer's `transitionEnd` does the second of those and cannot do
   * the first, so driving it from `transitionEnd` alone opened the panel as an
   * empty box that only filled in on the second try.
   */
  const [hidden, setHidden] = useState(!open);
  useEffect(() => {
    if (open) setHidden(false);
  }, [open]);

  // A panel that closes under the cursor would otherwise leave its hint
  // hanging on screen with nothing to explain.
  useEffect(() => {
    if (!open) setTip(null);
  }, [open]);

  return (
    <>
      <Tooltip tip={tip} />

      <motion.div
        // Height and opacity together: height alone slides the content into
        // view like a drawer of text, and the fade is what makes it read as the
        // panel deepening instead. Width comes along so the collapsed bar is
        // its own size again rather than a wide empty pill.
        initial={false}
        animate={{
          height: open ? "auto" : 0,
          width: open ? WIDTH : 0,
          opacity: open ? 1 : 0,
        }}
        onAnimationComplete={() => {
          if (!open) setHidden(true);
        }}
        style={{ visibility: hidden ? "hidden" : "visible" }}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className="overflow-hidden"
        aria-hidden={!open}
        onPointerLeave={() => setTip(null)}
      >
        <div
          style={{ width: WIDTH }}
          className={
            above
              ? "mb-2.5 border-b border-line/[.12] pb-2"
              : "mt-2.5 border-t border-line/[.12] pt-1"
          }
        >
          <Heading>Appearance</Heading>
          {/*
            A segmented control rather than three buttons in a row: the
            enclosing track is what says only one of these can be true, and the
            selection is one plate that travels rather than a highlight blinking
            off here and on again there. Same object as the navigation pill at
            the top of the window, and a shared layout animation rather than a
            measured offset because these cells are equal thirds of a fixed
            track.

            Nothing here explains itself on hover. Light, Dark and System are
            the whole of what they do, and a box appearing over three words you
            have already read is noise.
          */}
          <div className="mx-2.5 flex rounded-full bg-elevated/[.06] p-0.5 shadow-[inset_0_1px_2px_rgb(0_0_0/18%)]">
            {THEMES.map((option) => {
              const active = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onThemeChange(option.value)}
                  aria-pressed={active}
                  className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[11px] transition-colors ${
                    active ? "text-strong" : "text-faint hover:text-muted"
                  }`}
                >
                  {active && (
                    <motion.span
                      aria-hidden
                      layoutId="theme-plate"
                      transition={SLIDE}
                      // Glass rather than a flat fill: a lit top edge, a shadow
                      // beneath, and the track showing through.
                      className="absolute inset-0 rounded-full bg-raised/80 shadow-[0_1px_3px_rgb(0_0_0/28%),inset_0_1px_0_rgb(255_255_255/10%)] backdrop-blur-sm"
                    />
                  )}
                  <Icon name={option.icon} className="relative h-3 w-3" />
                  <span className="relative">{option.label}</span>
                </button>
              );
            })}
          </div>

          <Heading>Canvas</Heading>
          {/*
            Two things you do: let the graph find its own shape, and the way
            back from having placed it by hand. Reset belongs beside it because
            dragging a memory pins it and pins outlive the session, so there
            has to be a route back to an automatic layout that is not editing
            the database.

            The panel stays open while untangling - it is something you watch
            land, and closing over it would hide what the press was for. Reset
            closes, because there is nothing to watch.
          */}
          <div className="flex flex-col gap-1 px-2.5">
            {onUntangle && (
              <Action
                icon="graph"
                name={untangling ? "Working" : "Untangle"}
                hint="Let the graph settle into its own shape"
                tone="primary"
                busy={untangling}
                disabled={untangling}
                onClick={onUntangle}
                explain={setTip}
              />
            )}
            <Action
              icon="reset"
              name="Reset"
              hint="Release every memory you have placed by hand"
              onClick={() => {
                onResetLayout();
                onClose();
              }}
              explain={setTip}
            />
          </div>

          <div className="mx-2.5 mt-3 border-t border-line/[.08] pt-1.5">
            <Row
              label="Ambient drift"
              hint={
                reducedMotion
                  ? "Off - this machine asks for reduced motion"
                  : "Nodes breathe in place, and the 3D scene turns slowly"
              }
              checked={motionOn}
              disabled={reducedMotion}
              onChange={onMotionChange}
              explain={setTip}
            />
            <Row
              label="Remote content"
              hint="Load pictures, audio and video that memories point at on other sites. Agents write the memories, so this stays off until you allow it. Files you attach are always shown."
              checked={media.remote_content}
              onChange={(remote_content) => onMediaChange({ remote_content })}
              explain={setTip}
            />
          </div>
        </div>
      </motion.div>
    </>
  );
}
