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
 * Sixteen classes is past what hue alone can carry — measured, the closest
 * pair sits at 0.09 in OKLab for normal vision and 0.03 under deuteranopia.
 * Colour is therefore the fast channel, not the only one: FAMILY groups the
 * classes into seven shapes for anyone the hues fail.
 */

export const CLASS_COLORS: Readonly<Record<string, string>> = {
  person: "#FD968F",
  creature: "#E97126",
  organization: "#F9A216",
  place: "#B69513",
  object: "#B5C31E",
  device: "#60AF3C",
  document: "#23D891",
  event: "#0CB09E",
  project: "#1ACFDF",
  plan: "#0DA7D6",
  issue: "#7DBDFE",
  decision: "#778EFD",
  preference: "#BDA7FF",
  constraint: "#C272DC",
  finding: "#FD88D9",
  idea: "#EA648F",
};

/**
 * The same hues, darkened for a pale background.
 *
 * These are signal colours chosen to glow against near-black, and a colour
 * that glows on black is a pastel on white — legible as decoration, useless as
 * a label. Each is the same hue taken down in lightness until it reads as ink.
 */
export const CLASS_COLORS_LIGHT: Readonly<Record<string, string>> = {
  person: "#AF3C3A",
  creature: "#853801",
  organization: "#915C08",
  place: "#645000",
  object: "#677008",
  device: "#276200",
  document: "#0A7D51",
  event: "#0C6056",
  project: "#117780",
  plan: "#015B77",
  issue: "#066BB8",
  decision: "#3946A4",
  preference: "#7152B5",
  constraint: "#733087",
  finding: "#9E3F84",
  idea: "#90204B",
};

/**
 * The second channel, for when colour is not enough.
 *
 * Seven families, each drawn as its own shape. Shape carries the family and
 * hue carries the class within it, so the pair identifies a node even when the
 * hues collapse — which they do for roughly one man in twelve.
 */
export type ClassFamily =
  | "being"
  | "group"
  | "place"
  | "thing"
  | "happening"
  | "work"
  | "position";

export const CLASS_FAMILY: Readonly<Record<string, ClassFamily>> = {
  person: "being",
  creature: "being",
  organization: "group",
  place: "place",
  object: "thing",
  device: "thing",
  document: "thing",
  event: "happening",
  project: "work",
  plan: "work",
  issue: "work",
  decision: "position",
  preference: "position",
  constraint: "position",
  finding: "position",
  idea: "position",
};

/** How many sides the family's mark has; 0 is a circle. */
export const FAMILY_SIDES: Readonly<Record<ClassFamily, number>> = {
  being: 0,
  group: 6,
  place: 3,
  thing: 4,
  happening: 5,
  work: 8,
  position: 7,
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
