/**
 * A stable number in [0, 1) from a string.
 *
 * For decisions that need to look arbitrary but must not change between
 * frames — per-edge layout jitter being the case that motivated it. Drawing
 * from Math.random() there would re-roll on every tick and the graph would
 * shimmer in place, so the variation is derived from identity instead.
 *
 * FNV-1a: not for anything where collisions matter, only for spreading values
 * that would otherwise be identical.
 */
export function hashUnit(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // The FNV prime, via imul so the multiply stays in 32 bits.
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 reads the bits back as unsigned; imul yields a signed result.
  return (hash >>> 0) / 0x100000000;
}
