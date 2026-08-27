/**
 * The ambient orbit's maths, checked without a browser.
 *
 * The rest of this suite drives a real page because rendering and physics have
 * no meaningful unit surface. This one does: the orbit is a pure function over
 * two points, and its failure modes — drifting radius, rolling over the pole,
 * jumping after a backgrounded tab — are far easier to pin down here than by
 * staring at a moving scene.
 */

import { expect, test } from "@playwright/test";

import { applyOrbit, azimuthRate, polarRate } from "../lib/ambient-orbit";

const TARGET = { x: 10, y: -4, z: 6 };

/** The top of the band the ambient elevation keeps to, as ambient-orbit has it. */
const MIN_POLAR = 1.02;

function cameraAt(distance: number) {
  return { x: TARGET.x, y: TARGET.y, z: TARGET.z + distance };
}

/** A viewpoint at `polar` radians off straight up, the way an orbit drag leaves one. */
function cameraTilted(distance: number, polar: number) {
  return {
    x: TARGET.x,
    y: TARGET.y + distance * Math.cos(polar),
    z: TARGET.z + distance * Math.sin(polar),
  };
}

function radiusFrom(position: { x: number; y: number; z: number }): number {
  return Math.hypot(
    position.x - TARGET.x,
    position.y - TARGET.y,
    position.z - TARGET.z,
  );
}

test.describe("ambient orbit", () => {
  test("turns the camera without changing how far away it is", () => {
    const position = cameraAt(300);

    for (let step = 0; step < 600; step += 1) {
      applyOrbit(position, TARGET, step / 60, 1 / 60);
    }

    // Zoom is the user's to set; the orbit only ever changes the angles.
    expect(radiusFrom(position)).toBeCloseTo(300, 6);
    // Ten seconds in, the viewpoint has visibly moved.
    expect(Math.abs(position.x - TARGET.x)).toBeGreaterThan(1);
  });

  test("never rolls over the pole", () => {
    const position = cameraAt(200);

    // Twenty minutes of frames: long enough for the elevation term to have
    // pushed past the top many times over were it not clamped. The extreme is
    // accumulated rather than asserted per step, which would dominate the
    // runtime of the whole suite.
    let steepest = 0;
    for (let step = 0; step < 72_000; step += 1) {
      applyOrbit(position, TARGET, step / 60, 1 / 60);
      const elevation = Math.abs((position.y - TARGET.y) / radiusFrom(position));
      if (elevation > steepest) steepest = elevation;
    }

    // cos of the clamped polar range, with room for rounding.
    expect(steepest).toBeLessThan(0.55);
  });

  test("does not yank a steeply orbited view back into range", () => {
    // Well above the band the ambient motion keeps to, the way an orbit drag
    // easily leaves it.
    const steep = cameraTilted(200, 0.4);
    const before = (steep.y - TARGET.y) / radiusFrom(steep);

    applyOrbit(steep, TARGET, 1, 1 / 60);
    const after = (steep.y - TARGET.y) / radiusFrom(steep);

    // A frame's worth of drift at most, not a jump to the edge of the band.
    expect(Math.abs(after - before)).toBeLessThan(0.001);
    // And still only turning, never moving in or out.
    expect(radiusFrom(steep)).toBeCloseTo(200, 6);
  });

  test("eases a steep view back towards the band rather than holding it", () => {
    const steep = cameraTilted(200, 0.4);

    // Five minutes of frames: the elevation term changes sign as it goes, so
    // the way home is a drift and not a correction.
    for (let step = 0; step < 18_000; step += 1) {
      applyOrbit(steep, TARGET, step / 60, 1 / 60);
    }

    const elevation = (steep.y - TARGET.y) / radiusFrom(steep);
    expect(elevation).toBeLessThan(Math.cos(MIN_POLAR) + 1e-6);
  });

  test("rotates at a varying rate, not a constant one", () => {
    const samples = Array.from({ length: 4000 }, (_, index) =>
      azimuthRate(index * 0.5),
    );

    const fastest = Math.max(...samples);
    const slowest = Math.min(...samples);

    // A turntable would have these equal. The point of the effect is that they
    // are not: the scene speeds up, slows almost to a stop, and drifts back.
    expect(fastest).toBeGreaterThan(0.03);
    expect(slowest).toBeLessThan(0);

    // The elevation wanders both ways rather than climbing steadily.
    const tilts = samples.map((_, index) => polarRate(index * 0.5));
    expect(Math.max(...tilts)).toBeGreaterThan(0);
    expect(Math.min(...tilts)).toBeLessThan(0);
  });

  test("holds still when the camera sits on its target", () => {
    const position = { ...TARGET };
    applyOrbit(position, TARGET, 1, 1 / 60);

    // Nothing to orbit, and the angles would be undefined.
    expect(position).toEqual(TARGET);
  });
});
