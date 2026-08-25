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
 * Eighteen classes is past what hue alone can carry, and was already past it
 * at sixteen. Measured across every pair in OKLab, the closest sits at 0.088
 * for normal vision — it was 0.092 with two classes fewer, so the taxonomy
 * grew and the palette paid about four thousandths for it. Simulated
 * deuteranopia (Viénot 1999) collapses neighbouring hues to nearly nothing at
 * either count, which no re-spacing fixes.
 *
 * Colour is therefore the fast channel, not the only one: FAMILY groups the
 * classes into eight shapes for anyone the hues fail.
 */

export const CLASS_COLORS: Readonly<Record<string, string>> = {
  person: "#FF958E",
  creature: "#EB6F30",
  organization: "#FF9D23",
  place: "#C09000",
  object: "#C9BC00",
  document: "#82A900",
  event: "#6AD36E",
  project: "#00B381",
  plan: "#00D3C2",
  issue: "#00ACBA",
  solution: "#00CAFD",
  decision: "#00A0F8",
  preference: "#94B6FF",
  constraint: "#8F85FC",
  finding: "#CBA0FF",
  idea: "#CB6FD2",
  trait: "#FF89D0",
  method: "#EA648B",
};

/**
 * The same hues, darkened for a pale background.
 *
 * These are signal colours chosen to glow against near-black, and a colour
 * that glows on black is a pastel on white — legible as decoration, useless as
 * a label. Each is the same hue taken down in lightness until it reads as ink.
 */
export const CLASS_COLORS_LIGHT: Readonly<Record<string, string>> = {
  person: "#AF3C3B",
  creature: "#893400",
  organization: "#975800",
  place: "#6A4D00",
  object: "#736B00",
  document: "#455C00",
  event: "#1C7E28",
  project: "#006245",
  plan: "#007A6F",
  issue: "#005E66",
  solution: "#007493",
  decision: "#00578B",
  preference: "#3C63BF",
  constraint: "#4D40A1",
  finding: "#7D4DAE",
  idea: "#792C80",
  trait: "#A23D7D",
  method: "#911F48",
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
  finding: "knowledge",
  idea: "knowledge",
  trait: "knowledge",
  method: "knowledge",
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
