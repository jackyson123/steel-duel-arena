/**
 * Pure arena layout and kinematic collision helpers.
 * Kept free of Three imports so the rules can be unit tested.
 */

export interface ObstacleSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly kind: 'tower' | 'block' | 'cover' | 'crate';
}

export interface Aabb {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface Point2 {
  readonly x: number;
  readonly z: number;
}

export interface GroundQuery {
  readonly height: number;
  /** True when the object is standing on arena geometry rather than the floor. */
  readonly onStructure: boolean;
}

export const ARENA_HALF_SIZE = 30;
/** Inner face of the containment wall; play space clamps here. */
export const PLAY_BOUND = 29.1;
export const MAX_ALTITUDE = 24;
export const PLAYER_SPAWN: Point2 = { x: -11, z: 9 };
export const ENEMY_SPAWN: Point2 = { x: 11, z: -9 };
export const LOCK_RANGE = 46;

export const ARENA_OBSTACLES: readonly ObstacleSpec[] = [
  { id: 'core-tower', x: 0, z: -12, width: 8, depth: 8, height: 14, kind: 'tower' },
  { id: 'west-block', x: -14, z: -1, width: 7, depth: 7, height: 9, kind: 'block' },
  { id: 'east-block', x: 15, z: 4, width: 8, depth: 8, height: 6.5, kind: 'block' },
  { id: 'low-cover', x: 5, z: 8, width: 8, depth: 4, height: 2.2, kind: 'cover' },
  { id: 'crate-a', x: 9, z: 12, width: 3.4, depth: 3.4, height: 3.4, kind: 'crate' },
  { id: 'crate-b', x: 12.4, z: 14.2, width: 2.8, depth: 2.8, height: 5, kind: 'crate' },
];

function toAabb(spec: ObstacleSpec): Aabb {
  return {
    minX: spec.x - spec.width / 2,
    maxX: spec.x + spec.width / 2,
    minZ: spec.z - spec.depth / 2,
    maxZ: spec.z + spec.depth / 2,
    minY: 0,
    maxY: spec.height,
  };
}

export const OBSTACLE_BOXES: readonly Aabb[] = ARENA_OBSTACLES.map(toAabb);

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Highest surface under a mech at this horizontal position. */
export function groundHeightAt(
  x: number,
  z: number,
  radius: number,
  feetY: number,
  boxes: readonly Aabb[] = OBSTACLE_BOXES,
): GroundQuery {
  let height = 0;
  let onStructure = false;
  const margin = radius * 0.6;
  for (const box of boxes) {
    if (x < box.minX - margin || x > box.maxX + margin) continue;
    if (z < box.minZ - margin || z > box.maxZ + margin) continue;
    if (feetY < box.maxY - 0.6) continue;
    if (box.maxY > height) {
      height = box.maxY;
      onStructure = true;
    }
  }
  return { height, onStructure };
}

/**
 * Pushes a vertical capsule out of every obstacle it overlaps horizontally.
 * Mechs standing on a box top are left alone so they can walk on it.
 */
export function resolveObstacles(
  x: number,
  z: number,
  feetY: number,
  height: number,
  radius: number,
  boxes: readonly Aabb[] = OBSTACLE_BOXES,
): Point2 {
  let px = x;
  let pz = z;
  for (const box of boxes) {
    if (feetY >= box.maxY - 0.08) continue;
    if (feetY + height <= box.minY + 0.02) continue;
    const cx = clamp(px, box.minX, box.maxX);
    const cz = clamp(pz, box.minZ, box.maxZ);
    const dx = px - cx;
    const dz = pz - cz;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= radius * radius) continue;
    if (distanceSq > 1e-6) {
      const distance = Math.sqrt(distanceSq);
      px = cx + (dx / distance) * radius;
      pz = cz + (dz / distance) * radius;
      continue;
    }
    const left = px - box.minX + radius;
    const right = box.maxX - px + radius;
    const near = pz - box.minZ + radius;
    const far = box.maxZ - pz + radius;
    const smallest = Math.min(left, right, near, far);
    if (smallest === left) px = box.minX - radius;
    else if (smallest === right) px = box.maxX + radius;
    else if (smallest === near) pz = box.minZ - radius;
    else pz = box.maxZ + radius;
  }
  return { x: px, z: pz };
}

export function clampPlayArea(x: number, z: number): Point2 {
  return {
    x: clamp(x, -PLAY_BOUND, PLAY_BOUND),
    z: clamp(z, -PLAY_BOUND, PLAY_BOUND),
  };
}

/** Slab test returning the first hit fraction in [0, 1], or 1 when clear. */
export function firstBoxHitFraction(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: readonly Aabb[] = OBSTACLE_BOXES,
): number {
  let best = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (const box of boxes) {
    let tMin = 0;
    let tMax = 1;
    let hit = true;
    const axes: readonly [number, number, number, number][] = [
      [ax, dx, box.minX, box.maxX],
      [ay, dy, box.minY, box.maxY],
      [az, dz, box.minZ, box.maxZ],
    ];
    for (const [origin, delta, min, max] of axes) {
      if (Math.abs(delta) < 1e-6) {
        if (origin < min || origin > max) {
          hit = false;
          break;
        }
        continue;
      }
      let t1 = (min - origin) / delta;
      let t2 = (max - origin) / delta;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) {
        hit = false;
        break;
      }
    }
    if (hit && tMin < best) best = tMin;
  }
  return best;
}

export function hasLineOfSight(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  boxes: readonly Aabb[] = OBSTACLE_BOXES,
): boolean {
  return firstBoxHitFraction(ax, ay, az, bx, by, bz, boxes) >= 1;
}

export function pointInsideObstacle(
  x: number,
  y: number,
  z: number,
  padding = 0,
  boxes: readonly Aabb[] = OBSTACLE_BOXES,
): boolean {
  for (const box of boxes) {
    if (
      x >= box.minX - padding &&
      x <= box.maxX + padding &&
      y >= box.minY - padding &&
      y <= box.maxY + padding &&
      z >= box.minZ - padding &&
      z <= box.maxZ + padding
    ) {
      return true;
    }
  }
  return false;
}

/** True when a point is inside the floor footprint, ignoring height. */
export function insidePlayArea(x: number, z: number): boolean {
  return Math.abs(x) <= PLAY_BOUND && Math.abs(z) <= PLAY_BOUND;
}
