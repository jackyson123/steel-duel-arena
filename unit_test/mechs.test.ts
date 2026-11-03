import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MECH, getMech, MECH_LOADOUTS } from '../mechs.js';

test('mech catalogue has three unique, playable loadouts', () => {
  assert.equal(MECH_LOADOUTS.length, 3);
  const ids = new Set(MECH_LOADOUTS.map((loadout) => loadout.id));
  assert.equal(ids.size, 3);
  assert.equal(DEFAULT_MECH.id, 'azure');
  for (const loadout of MECH_LOADOUTS) {
    assert.ok(loadout.stats.maxHp >= 900);
    assert.ok(loadout.stats.boostMax >= 80);
    assert.ok(loadout.stats.speedAir > loadout.stats.speedGround);
    assert.ok(loadout.stats.beamDamage > 0);
    assert.ok(loadout.stats.meleeDamage > loadout.stats.beamDamage);
    assert.match(loadout.palette.primary, /^#[0-9a-f]{6}$/i);
    assert.equal(getMech(loadout.id).name, loadout.name);
  }
});

test('loadouts trade mobility against durability and firepower', () => {
  const gale = getMech('gale');
  const bastion = getMech('bastion');
  assert.ok(gale.stats.speedAir > bastion.stats.speedAir);
  assert.ok(gale.stats.boostMax > bastion.stats.boostMax);
  assert.ok(bastion.stats.maxHp > gale.stats.maxHp);
  assert.ok(bastion.stats.meleeDamage > gale.stats.meleeDamage);
});
