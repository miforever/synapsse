/**
 * Builds the Three.js object drawn for each 3D node.
 *
 * Class materials and textures are cached per class rather than per node. A
 * graph with a thousand memories across a dozen classes then allocates a
 * dozen materials instead of a thousand, which is the difference between a
 * smooth canvas and a stuttering one.
 *
 * Thumbnails load asynchronously. A node renders as its class disc
 * immediately and swaps its texture in place once the image decodes — no
 * React state, so a late image never re-renders or re-heats the graph.
 */

import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from "three";
import SpriteText from "three-spritetext";

import { glowCanvas, ringCanvas } from "@/lib/glow";
import { getCircularThumbnail } from "@/lib/image-cache";
import { colorForClass } from "@/lib/node-classes";
import type { GraphNode } from "@/lib/types";

/** Built objects, so focus can restyle them without rebuilding the scene. */
interface Entry {
  /** The node's own container, which the hover halo is parented into. */
  group: Group;
  /** Size multiplier from how connected this memory is — see lib/node-scale. */
  weight: number;
  sprite: Sprite;
  /** The globe's wires - real geometry, so they turn with the scene. */
  wire: LineSegments;
  label: SpriteText;
  type: string;
  bright?: SpriteMaterial;
  /** Animated toward, rather than set outright — see runFocusTween. */
  targetScale: number;
  targetOpacity: number;
  targetLabelOpacity: number;
}

const objects = new Map<string, Entry>();

const classMaterials = new Map<string, SpriteMaterial>();
const classTextures = new Map<string, CanvasTexture>();
const ringTextures = new Map<string, CanvasTexture>();
const thumbnailMaterials = new Map<string, SpriteMaterial>();

const LABEL_HEIGHT = 1.7;
const LABEL_MAX_CHARS = 22;

/**
 * Above this, labelling everything is unreadable noise, so labels are kept for
 * the focused memory and its neighbours until you zoom into a selection.
 */
const LABEL_ALL_BELOW = 60;

/**
 * Where to anchor a label so it clears the node it belongs to.
 *
 * `center` is measured in the sprite's own heights, so the offset has to be
 * derived from the node's radius — a fixed value smaller than that radius
 * leaves the text sitting on top of the node.
 */
function labelAnchor(nodeScale: number): number {
  const gap = 1.4;
  return 0.5 + (nodeScale / 2 + gap) / LABEL_HEIGHT;
}

function truncate(title: string): string {
  return title.length > LABEL_MAX_CHARS
    ? `${title.slice(0, LABEL_MAX_CHARS - 1)}…`
    : title;
}
const THUMB_SIZE = 128;

/** Wraps the shared glow canvas so 2D and 3D nodes look like one object. */
function discTexture(color: string): CanvasTexture | null {
  const cached = classTextures.get(color);
  if (cached) return cached;

  const canvas = glowCanvas(color, false);
  if (!canvas) return null;

  const texture = new CanvasTexture(canvas);
  classTextures.set(color, texture);
  return texture;
}

function classMaterial(type: string): SpriteMaterial {
  const cached = classMaterials.get(type);
  if (cached) return cached;

  const material = new SpriteMaterial({
    map: discTexture(colorForClass(type, spriteTheme)),
    transparent: true,
    depthWrite: false,
  });
  classMaterials.set(type, material);
  return material;
}

/** Shared per URL+class, so repeated thumbnails cost one texture. */
function thumbnailMaterial(url: string, type: string): SpriteMaterial | null {
  const key = `${url}@${type}`;
  const cached = thumbnailMaterials.get(key);
  if (cached) return cached;

  const canvas = getCircularThumbnail(url, colorForClass(type, spriteTheme), THUMB_SIZE);
  if (!canvas) return null;

  const material = new SpriteMaterial({
    map: new CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
  });
  thumbnailMaterials.set(key, material);
  return material;
}

/** Set by the canvas when the theme changes; read as each label is built. */
let labelColour = "#E2E8F0";
let spriteTheme: "dark" | "light" = "dark";

export function setSpriteTheme(theme: "dark" | "light"): void {
  labelColour = theme === "light" ? "#334155" : "#E2E8F0";
  spriteTheme = theme;

  // Materials and textures are cached per class, so they hold the old theme's
  // colours until they are dropped. Rebuilding them in place keeps every node
  // exactly where the simulation has put it.
  classMaterials.forEach((material) => material.dispose());
  classTextures.forEach((texture) => texture.dispose());
  ringTextures.forEach((texture) => texture.dispose());
  classMaterials.clear();
  classTextures.clear();
  ringTextures.clear();
  objects.forEach((entry) => {
    entry.bright?.dispose();
    entry.bright = undefined;
    entry.sprite.material = classMaterial(entry.type);
    // The light disc is deliberately a flat token with a clean edge rather
    // than a body with depth, and a wireframe globe is not part of that idea.
    entry.wire.visible = theme === "dark";
  });
  // Labels already in the scene are restyled in place — rebuilding them would
  // drop every node's settled position.
  objects.forEach((entry) => {
    entry.label.color = labelColour;
  });
}

export function buildNodeObject(
  node: GraphNode,
  showThumbnails: boolean,
  weight = 1,
): Object3D {
  const group = new Group();

  const sprite = new Sprite(classMaterial(node.type));
  sprite.scale.set(BASE_SCALE * weight, BASE_SCALE * weight, 1);
  group.add(sprite);

  if (showThumbnails && node.thumbnail_url) {
    const url = node.thumbnail_url;

    const applyThumbnail = () => {
      const material = thumbnailMaterial(url, node.type);
      if (material) sprite.material = material;
    };

    // Ready already? Swap now. Otherwise swap when the image decodes —
    // mutating the sprite directly keeps this off React's path entirely.
    getCircularThumbnail(url, colorForClass(node.type, spriteTheme), THUMB_SIZE, () =>
      applyThumbnail(),
    );
    applyThumbnail();
  }

  // Titles are measured in world units, so a long one renders several times
  // wider than the node it belongs to. Truncating and shrinking keeps a label
  // attached to its node rather than sprawling across its neighbours.
  const label = new SpriteText(truncate(node.title));
  label.color = labelColour;
  label.textHeight = LABEL_HEIGHT;
  /*
   * Offset in screen space, not world space.
   *
   * A world-space offset is fixed to the scene's axes, so orbiting the camera
   * swings the label around the node and it ends up beside or behind it.
   * `center` shifts the sprite relative to its own anchor, which is evaluated
   * against the camera — so anchoring the label's top edge to the node keeps
   * it hanging directly below from every angle.
   */
  label.position.set(0, 0, 0);
  label.center.set(0.5, labelAnchor(BASE_SCALE));
  label.material.depthWrite = false;
  // Labels read as annotations, so they should not be swallowed by the nodes
  // they belong to.
  label.material.depthTest = false;
  /*
   * Labels must never be click targets.
   *
   * A label is a sprite quad drawn on top of everything, and its box is far
   * wider than the node it names. Left raycastable, they intercept clicks
   * aimed at nodes and swallow clicks on empty space meant to dismiss the
   * open memory — which is why selecting and deselecting took several tries.
   */
  label.raycast = () => undefined;
  group.add(label);

  // Sized to the sprite's visible shell, so the wires sit on the surface the
  // glow draws rather than floating inside it or hanging off it.
  const wire = new LineSegments(wireGeometries[wireTier(weight)], wireMaterial);
  wire.scale.setScalar(nodeRadius(weight));
  wire.visible = spriteTheme === "dark";
  // The invisible hit sphere is the click target; a wire that raycast too
  // would take the hover on its own far side.
  wire.raycast = () => undefined;
  group.add(wire);

  group.add(new Mesh(hitGeometry, hitMaterial));

  objects.set(node.id, {
    group,
    weight,
    sprite,
    wire,
    label,
    type: node.type,
    targetScale: BASE_SCALE * weight,
    targetOpacity: 1,
    targetLabelOpacity: 1,
  });
  return group;
}

/**
 * The ring around whichever node the pointer is on.
 *
 * One sprite for the whole scene, moved into the hovered node's group rather
 * than built per node. A ring per node would mean a material per node — the
 * exact cost this module exists to avoid — and only ever one of them can be
 * lit, so there is nothing to gain from the other 999.
 */
let halo: Sprite | null = null;

function haloSprite(): Sprite {
  if (halo) return halo;

  const sprite = new Sprite(
    new SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }),
  );
  // Drawn over the node rather than behind it: the ring stands off the disc's
  // edge, and a soft-edged disc would otherwise bleed through the stroke.
  sprite.renderOrder = 1;
  // Never a click target: it is wider than the node, so left raycastable it
  // would swallow clicks aimed past it.
  sprite.raycast = () => undefined;
  halo = sprite;
  return sprite;
}

/** Wraps the shared ring canvas, cached per colour like the discs. */
function ringTexture(color: string): CanvasTexture | null {
  const cached = ringTextures.get(color);
  if (cached) return cached;

  const canvas = ringCanvas(color);
  if (!canvas) return null;

  const texture = new CanvasTexture(canvas);
  ringTextures.set(color, texture);
  return texture;
}

/**
 * How far the ring stands off the node, and how present it is.
 *
 * Close in and nearly solid, because the stroke is what carries the signal. A
 * wide faint one is not a ring at all: it spreads the node into a blur several
 * times its own size and loses the node's colour inside it.
 */
const HALO_RATIO = 1.05;
const HALO_OPACITY = 0.9;

/**
 * Invisible, generous click target.
 *
 * The visible sprite is a small quad and the graph drifts continuously, so
 * aiming at a node is fiddly — and a near miss registers as a background click
 * that dismisses whatever was open. A transparent mesh keeps the appearance
 * unchanged while making the node forgiving to hit. Opacity zero rather than
 * `visible = false`, because the raycaster skips invisible objects.
 */
const HIT_RADIUS = 7;
const hitGeometry = new SphereGeometry(HIT_RADIUS, 8, 6);

const hitMaterial = new MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

const BASE_SCALE = 7;

/*
 * The globe's wires, as geometry rather than paint.
 *
 * A sprite always faces the camera, so a grid drawn into its texture is welded
 * to the view: orbiting slides it across the node instead of turning it, and
 * the node reads as a sticker rather than a body. A sphere has no such problem
 * - its meridians go round the back, and the far side shows through the near
 * one, which is what a projection does.
 *
 * One geometry and one material for the entire graph. The mesh per node is a
 * pointer to both, so a thousand memories cost a thousand transforms rather
 * than a thousand spheres.
 */
/*
 * Wires in proportion to the memory wearing them.
 *
 * One grid for every node is wrong at both ends: the count that reads as a
 * globe on a hub collapses into a smudge on a leaf a fifth of its size, and the
 * count that keeps a leaf legible leaves a hub looking faceted up close. Lines
 * are what the surface is made of here, so their spacing should stay roughly
 * constant on screen, which means their number goes with the radius.
 *
 * Tiers rather than a formula per node, because the geometry is shared: four
 * cover the whole range a graph produces, and a thousand memories still
 * allocate four between them.
 */
const WIRE_TIERS = [
  { until: 1.8, meridians: 6, parallels: 5 },
  { until: 2.8, meridians: 8, parallels: 7 },
  { until: 3.8, meridians: 10, parallels: 9 },
  { until: Infinity, meridians: 12, parallels: 11 },
];

/**
 * The lines of a globe, as lines.
 *
 * Not a wireframe sphere. `wireframe: true` draws the edges of the triangles a
 * sphere is built from, which means the diagonal across every quad as well -
 * so the node arrives wearing a fishing net instead of a graticule, and no
 * amount of thinning the lines fixes something that is drawing the wrong ones.
 *
 * These are circles: each meridian a great circle through both poles, each
 * parallel a ring at its own latitude. Emitted as segment pairs for
 * `LineSegments`, which is one draw call for the whole cage.
 */
function graticuleGeometry(
  meridians: number,
  parallels: number,
  resolution = 64,
): BufferGeometry {
  const points: number[] = [];

  const push = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ) => points.push(ax, ay, az, bx, by, bz);

  // A great circle through the poles covers two meridians at once, the near
  // side and the far, so half a turn of longitude draws the whole globe.
  for (let m = 0; m < meridians; m += 1) {
    const longitude = (Math.PI * m) / meridians;
    const cos = Math.cos(longitude);
    const sin = Math.sin(longitude);

    for (let i = 0; i < resolution; i += 1) {
      const a = (Math.PI * 2 * i) / resolution;
      const b = (Math.PI * 2 * (i + 1)) / resolution;
      push(
        cos * Math.sin(a), Math.cos(a), sin * Math.sin(a),
        cos * Math.sin(b), Math.cos(b), sin * Math.sin(b),
      );
    }
  }

  // Parallels are spaced across the hemispheres rather than from the equator
  // up, so the ring at the equator is always one of them.
  for (let p = 1; p <= parallels; p += 1) {
    const latitude = -Math.PI / 2 + (Math.PI * p) / (parallels + 1);
    const y = Math.sin(latitude);
    const radius = Math.cos(latitude);

    for (let i = 0; i < resolution; i += 1) {
      const a = (Math.PI * 2 * i) / resolution;
      const b = (Math.PI * 2 * (i + 1)) / resolution;
      push(
        radius * Math.cos(a), y, radius * Math.sin(a),
        radius * Math.cos(b), y, radius * Math.sin(b),
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return geometry;
}

const wireGeometries = WIRE_TIERS.map(({ meridians, parallels }) =>
  graticuleGeometry(meridians, parallels),
);

function wireTier(weight: number): number {
  const index = WIRE_TIERS.findIndex((tier) => weight < tier.until);
  return index === -1 ? WIRE_TIERS.length - 1 : index;
}

const WIRE_OPACITY = 0.16;
const wireMaterial = new LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: WIRE_OPACITY,
  // Never occludes: the node it wraps is a transparent sprite that writes no
  // depth of its own, and a wire that did would carve holes in whatever is
  // drawn after it.
  depthWrite: false,
});

/*
 * A second copy for the memories that are lit.
 *
 * The first rides the dimming, the way the shared class materials do. Without
 * this the focused node would be the one thing on screen whose disc came up
 * bright while its own wires faded out with the crowd - which is the opposite
 * of what focusing is for. Two materials for any graph, not two per node.
 */
const wireBright = wireMaterial.clone();

/**
 * How much of a node's sprite is actually the node.
 *
 * The texture is mostly empty: the shell's silhouette sits at 0.44 of the
 * texture's half-width, and everything past it is bloom fading to nothing. So
 * the visible edge of a node is a quarter of the way out from its centre, not
 * half - which is what anything measuring against a node on screen has to use,
 * or it will clear a boundary the eye cannot see.
 */
const VISIBLE_RATIO = 0.22;

/** The drawn radius of a memory, in world units, at a given weight. */
export function nodeRadius(weight: number): number {
  return BASE_SCALE * weight * VISIBLE_RATIO;
}
// Neighbours sit between the focus and the background so the local
// neighbourhood reads as a group rather than as slightly-less-dim noise.
const NEIGHBOUR_SCALE = 13;
const FOCUS_SCALE = 17;
/*
 * Hover reads as size here too, matching the 2D canvas.
 *
 * A sprite has no outline to thicken, so the size step has to be doing the
 * work — the halo below is only a faint edge, and lighting the node instead
 * would wash a pale class out to white.
 *
 * Still below the focus scale: hovering must not look like opening.
 */
const HOVER_SCALE = 13.5;
const HOVER_NEIGHBOUR_SCALE = 12;
const NEIGHBOUR_OPACITY = 0.85;
const DIM_OPACITY = 0.12;

/*
 * Focus and hover are separate gestures over the same objects, so both are
 * kept here and the styling is recomputed from the pair. Applying either one
 * on its own would have it undo the other — hovering away from a node would
 * reset the scale of a memory that is still open.
 */
let focusedId: string | null = null;
let focusNeighbours: ReadonlySet<string> = new Set();
let hoveredId: string | null = null;
let hoverNeighbours: ReadonlySet<string> = new Set();

/**
 * Highlight the focused memory and its neighbours, dimming the rest.
 *
 * Class materials are shared, so dimming is applied to them once and the few
 * highlighted nodes get a cloned material instead. That keeps this O(focus)
 * in allocations rather than O(nodes), and avoids rebuilding scene objects —
 * a rebuild at a thousand nodes would stutter on every click.
 */
export function applyFocus(
  focusId: string | null,
  neighbours: ReadonlySet<string>,
): void {
  focusedId = focusId;
  focusNeighbours = neighbours;
  restyle();
}

/**
 * Lift the memory under the pointer and everything it connects to.
 *
 * Unlike focus this dims nothing: hovering is a glance, and pushing the whole
 * graph back every time the pointer crosses a node would make the canvas
 * flicker between two states as you move across it.
 */
export function applyHover(
  hoverId: string | null,
  neighbours: ReadonlySet<string>,
): void {
  hoveredId = hoverId;
  hoverNeighbours = neighbours;
  restyle();
}

function restyle(): void {
  const focusing = focusedId !== null;
  dimTarget = focusing ? DIM_OPACITY : 1;

  // In a large graph only the focused neighbourhood is labelled; in a small
  // one every label fits, so they all stay on.
  const labelAll = objects.size <= LABEL_ALL_BELOW;

  objects.forEach((entry, id) => {
    const isFocus = id === focusedId;
    const highlighted = isFocus || focusNeighbours.has(id);
    const isHover = id === hoveredId;
    const lit = isHover || hoverNeighbours.has(id);

    entry.label.visible = highlighted || lit || (!focusing && labelAll);

    if (lit || (focusing && highlighted)) {
      if (!entry.bright) entry.bright = classMaterial(entry.type).clone();
      entry.sprite.material = entry.bright;
      entry.wire.material = wireBright;
      // A hovered node reads as fully lit even where focus had receded it —
      // that lift is the whole signal that the pointer has found something.
      entry.targetOpacity = lit || isFocus ? 1 : NEIGHBOUR_OPACITY;
    } else {
      entry.sprite.material = classMaterial(entry.type);
      entry.wire.material = wireMaterial;
      entry.targetOpacity = focusing ? DIM_OPACITY : 1;
    }

    /*
     * The lift is damped by connectedness rather than multiplied by it.
     *
     * Resting size goes with weight outright, which is the point of sizing at
     * all. Opening a memory already multiplies that by well over two, and both
     * applied in full puts a hub across most of the viewport - it stops being a
     * memory you opened and becomes a wall you are standing against. Rooted, so
     * the busiest memory still opens larger than a leaf, by a margin you read
     * as emphasis instead of as a zoom.
     */
    const lift = Math.sqrt(entry.weight);

    const focusScale =
      isFocus
        ? FOCUS_SCALE * lift
        : focusing && highlighted
          ? NEIGHBOUR_SCALE * lift
          : BASE_SCALE * entry.weight;
    const hoverScale = isHover
      ? HOVER_SCALE * lift
      : lit
        ? HOVER_NEIGHBOUR_SCALE * lift
        : BASE_SCALE * entry.weight;
    // The larger of the two, so hovering the open memory cannot shrink it.
    entry.targetScale = Math.max(focusScale, hoverScale);

    // Shared geometry, so this is a pointer swap rather than a rebuild.
    entry.wire.geometry = wireGeometries[wireTier(entry.weight)];
    entry.targetLabelOpacity = lit || !focusing || highlighted ? 1 : DIM_OPACITY;
  });

  const hovered = hoveredId ? objects.get(hoveredId) : undefined;
  if (hovered) {
    const sprite = haloSprite();
    sprite.material.map = ringTexture(colorForClass(hovered.type, spriteTheme));
    sprite.material.needsUpdate = true;
    // Parenting to the group rather than tracking the node's position: the
    // simulation moves the group every tick, and the halo comes along for free.
    hovered.group.add(sprite);
    haloTarget = HALO_OPACITY;
  } else {
    haloTarget = 0;
  }

  startFocusTween();
}

/**
 * Eases focus changes over a few frames.
 *
 * Snapping scale and opacity the instant a node is selected reads as a glitch
 * rather than a transition, so values are lerped toward their targets and the
 * loop stops once everything has arrived.
 */
const EASE = 0.18;
const EPSILON = 0.01;

let dimTarget = 1;
let haloTarget = 0;
let tweening = false;

function startFocusTween(): void {
  if (tweening) return;
  tweening = true;

  const step = () => {
    let settled = true;

    classMaterials.forEach((material) => {
      // Only the shared materials of non-highlighted nodes ride this value.
      const next = material.opacity + (dimTarget - material.opacity) * EASE;
      if (Math.abs(dimTarget - next) > EPSILON) settled = false;
      material.opacity = next;
    });

    const wireWanted = dimTarget * WIRE_OPACITY;
    const nextWire =
      wireMaterial.opacity + (wireWanted - wireMaterial.opacity) * EASE;
    if (Math.abs(wireWanted - nextWire) > EPSILON * WIRE_OPACITY) settled = false;
    wireMaterial.opacity = nextWire;

    objects.forEach((entry) => {
      const scale = entry.sprite.scale.x;
      const nextScale = scale + (entry.targetScale - scale) * EASE;
      if (Math.abs(entry.targetScale - nextScale) > EPSILON) settled = false;
      entry.sprite.scale.set(nextScale, nextScale, 1);
      entry.wire.scale.setScalar(nextScale * VISIBLE_RATIO);
      entry.label.center.setY(labelAnchor(nextScale));

      if (entry.bright && entry.sprite.material === entry.bright) {
        const opacity = entry.bright.opacity;
        const next = opacity + (entry.targetOpacity - opacity) * EASE;
        if (Math.abs(entry.targetOpacity - next) > EPSILON) settled = false;
        entry.bright.opacity = next;
      }

      const labelOpacity = entry.label.material.opacity;
      const nextLabel =
        labelOpacity + (entry.targetLabelOpacity - labelOpacity) * EASE;
      if (Math.abs(entry.targetLabelOpacity - nextLabel) > EPSILON)
        settled = false;
      entry.label.material.opacity = nextLabel;
    });

    if (halo) {
      const opacity = halo.material.opacity;
      const next = opacity + (haloTarget - opacity) * EASE;
      if (Math.abs(haloTarget - next) > EPSILON) settled = false;
      halo.material.opacity = next;

      // Sized off the node it is behind, so it grows with the hover lift
      // instead of arriving at its final size before the node gets there.
      const host = hoveredId ? objects.get(hoveredId) : undefined;
      const spread = (host?.sprite.scale.x ?? BASE_SCALE) * HALO_RATIO;
      halo.scale.set(spread, spread, 1);

      // Faded out: unparent it rather than leave an invisible quad in the
      // scene for the renderer to keep sorting every frame.
      if (next <= EPSILON && haloTarget === 0) halo.removeFromParent();
    }

    if (settled) {
      tweening = false;
      return;
    }
    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

/**
 * Resize the memories whose connectedness has changed.
 *
 * Applied to what is already in the scene rather than rebuilt: an edge
 * arriving should grow the node it lands on, not scatter the layout around it.
 */
export function applyWeights(weightOf: (id: string) => number): void {
  let changed = false;
  objects.forEach((entry, id) => {
    const weight = weightOf(id);
    if (Math.abs(weight - entry.weight) < 0.01) return;
    entry.weight = weight;
    changed = true;
  });
  if (changed) restyle();
}

/** Frees GPU resources when the canvas unmounts. */
export function disposeSpriteCache(): void {
  wireGeometries.forEach((geometry) => geometry.dispose());
  classMaterials.forEach((material) => material.dispose());
  classTextures.forEach((texture) => texture.dispose());
  ringTextures.forEach((texture) => texture.dispose());
  thumbnailMaterials.forEach((material) => {
    material.map?.dispose();
    material.dispose();
  });
  objects.forEach((entry) => entry.bright?.dispose());
  halo?.removeFromParent();
  halo?.material.dispose();
  halo = null;
  objects.clear();
  classMaterials.clear();
  classTextures.clear();
  ringTextures.clear();
  thumbnailMaterials.clear();
}
