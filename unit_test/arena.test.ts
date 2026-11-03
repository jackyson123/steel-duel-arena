import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARENA_OBSTACLES,
  clampPlayArea,
  firstBoxHitFraction,
  groundHeightAt,
  hasLineOfSight,
  pointInsideObstacle,
  resolveObstacles,
} from '../arena.js';

test('ground query finds the tower top only from above', () => {
  const tower = ARENA_OBSTACLES.find((obstacle) => obstacle.id === 'core-tower');
  assert.ok(tower);
  const top = groundHeightAt(tower.x, tower.z, 0.85, tower.height);
  assert.equal(top.height, tower.height);
  assert.equal(top.onStructure, true);

  const atFloor = groundHeightAt(tower.x, tower.z, 0.85, 0);
  assert.equal(atFloor.height, 0);
  assert.equal(atFloor.onStructure, false);
});

test('obstacle resolution pushes a mech out of a block', () => {
  const block = ARENA_OBSTACLES.find((obstacle) => obstacle.id === 'west-block');
  assert.ok(block);
  const resolved = resolveObstacles(block.x, block.z, 0, 3.35, 0.85);
  const insideX = resolved.x > block.x - block.width / 2 && resolved.x < block.x + block.width / 2;
  const insideZ = resolved.z > block.z - block.depth / 2 && resolved.z < block.z + block.depth / 2;
  assert.equal(insideX && insideZ, false);
});

test('line of sight is blocked by the west block but clears above it', () => {
  const block = ARENA_OBSTACLES.find((obstacle) => obstacle.id === 'west-block');
  assert.ok(block);
  assert.equal(hasLineOfSight(-22, 2, block.z, -6, 2, block.z), false);
  assert.equal(hasLineOfSight(-22, block.height + 2, block.z, -6, block.height + 2, block.z), true);
  assert.ok(firstBoxHitFraction(-22, 2, block.z, -6, 2, block.z) < 1);
});

test('point and arena bound helpers agree with the layout', () => {
  const tower = ARENA_OBSTACLES.find((obstacle) => obstacle.id === 'core-tower');
  assert.ok(tower);
  assert.equal(pointInsideObstacle(tower.x, 4, tower.z), true);
  assert.equal(pointInsideObstacle(tower.x, tower.height + 1, tower.z), false);

  assert.deepEqual(clampPlayArea(0, 0), { x: 0, z: 0 });
  assert.deepEqual(clampPlayArea(120, -120), { x: 29.1, z: -29.1 });
});
