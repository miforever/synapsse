/**
 * Presentation for node classes.
 *
 * The daemon stores class names only — how each is painted is purely a canvas
 * concern, so it lives here.
 *
 * Hues are evenly spaced in OKLCH rather than picked by eye, and rather than
 * spaced along the logo's violet→cyan axis as they were before. That axis was
 * about 90° of hue for the whole taxonomy, so `person` and `organization` sat
 * four degrees apart and were indistinguishable at the size a node draws.
 * Lightness alternates between neighbours too, so adjacent classes differ on
 * two channels rather than one.
 *
 * Twenty classes is past what hue alone can carry, and was already past it at
 * sixteen. Measured across every pair in OKLab, the closest sits at 0.073 for
 * normal vision, against 0.088 at eighteen and 0.092 at sixteen. The cost is
 * front-loaded: the first class past eighteen took 0.011 and each one after it
 * takes about a thousandth, so the count is worth settling in one go rather
 * than one at a time. Simulated deuteranopia (Viénot 1999) collapses
 * neighbouring hues to nearly nothing at any of these counts, which no
 * re-spacing fixes.
 *
 * Colour is therefore the fast channel, not the only one: FAMILY groups the
 * classes into eight shapes for anyone the hues fail.
 */

export const CLASS_COLORS: Readonly<Record<string, string>> = {
  person: "#FF958E",
  creature: "#EC6E35",
  organization: "#FF9C3C",
  place: "#C78C00",
  object: "#D5B600",
  document: "#97A200",
  event: "#8CCE50",
  project: "#29B45D",
  plan: "#00D7A5",
  issue: "#00AFA4",
  solution: "#00CFDF",
  decision: "#00A8D0",
  preference: "#66C1FF",
  constraint: "#5197FF",
  interest: "#A4B1FF",
  finding: "#A17FF6",
  idea: "#DA98FF",
  trait: "#D26CC9",
  method: "#FF8BC8",
  skill: "#EC6387",
};

/**
 * The same hues, darkened for a pale background.
 *
 * These are signal colours chosen to glow against near-black, and a colour
 * that glows on black is a pastel on white — legible as decoration, useless as
 * a label. Each is the same hue taken down in lightness until it reads as ink.
 */
export const CLASS_COLORS_LIGHT: Readonly<Record<string, string>> = {
  person: "#B03B3A",
  creature: "#8B3200",
  organization: "#9A5500",
  place: "#6E4B00",
  object: "#7B6800",
  document: "#525800",
  event: "#467900",
  project: "#00642C",
  plan: "#007C5E",
  issue: "#006059",
  solution: "#007781",
  decision: "#005C73",
  preference: "#0070A7",
  constraint: "#104EA4",
  interest: "#545CBE",
  finding: "#5A3A9C",
  idea: "#8649A6",
  trait: "#7E2979",
  method: "#A43C77",
  skill: "#921E45",
};

/**
 * The second channel, for when colour is not enough.
 *
 * Eight families, each drawn as its own shape. Shape carries the family and
 * hue carries the class within it, so the pair identifies a node even when the
 * hues collapse — which they do for roughly one man in twelve.
 *
 * `position` was one family of five and would now be seven, which defeats the
 * point: the more classes share a shape, the more of the work falls back on
 * the hues that were failing in the first place. It splits on what the memory
 * is doing — `stance` is something held (chosen, wanted, imposed), `knowledge`
 * is something carried (learned, proposed, true of someone, done repeatedly).
 */
export type ClassFamily =
  | "being"
  | "group"
  | "place"
  | "thing"
  | "happening"
  | "work"
  | "stance"
  | "knowledge";

export const CLASS_FAMILY: Readonly<Record<string, ClassFamily>> = {
  person: "being",
  creature: "being",
  organization: "group",
  place: "place",
  object: "thing",
  document: "thing",
  event: "happening",
  project: "work",
  plan: "work",
  issue: "work",
  solution: "work",
  decision: "stance",
  preference: "stance",
  constraint: "stance",
  interest: "stance",
  finding: "knowledge",
  idea: "knowledge",
  trait: "knowledge",
  method: "knowledge",
  skill: "knowledge",
};

/**
 * How many sides the family's mark has; 0 is a circle.
 *
 * Eight is the ceiling this channel has: past six sides a polygon reads as a
 * circle at the size a node draws, so `knowledge` taking nine is the last seat
 * available and a ninth family would have to find a second axis — a hollow
 * mark, say — rather than another side.
 */
export const FAMILY_SIDES: Readonly<Record<ClassFamily, number>> = {
  being: 0,
  group: 6,
  place: 3,
  thing: 4,
  happening: 5,
  work: 8,
  stance: 7,
  knowledge: 9,
};

export const FALLBACK_COLOR = "#64748B";
export const FALLBACK_COLOR_LIGHT = "#475569";

export type ColorTheme = "dark" | "light";

export function colorForClass(name: string, theme: ColorTheme = "dark"): string {
  return theme === "light"
    ? (CLASS_COLORS_LIGHT[name] ?? FALLBACK_COLOR_LIGHT)
    : (CLASS_COLORS[name] ?? FALLBACK_COLOR);
}

/**
 * The family a class belongs to.
 *
 * Falls back to `thing`, which is where an unrecognised class would sit if one
 * ever reached the canvas — the daemon coerces them now, but a store written
 * before that still holds a few.
 */
export function familyForClass(name: string): ClassFamily {
  return CLASS_FAMILY[name] ?? "thing";
}

/** `follow_up` -> `Follow Up`, for badges and filter chips. */
export function labelForClass(name: string): string {
  return name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
