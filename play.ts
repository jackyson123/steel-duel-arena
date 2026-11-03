import * as THREE from 'three/webgpu';
import type { LifetimeScope } from 'wanaka-studio-engine';
import type { PlatformBridge } from 'wanaka-studio-engine/platform-bridge';
import type { SceneContextForCatalog } from 'wanaka-studio-engine/scene';
import { InputSession, type FixedInputConsumer } from 'wanaka-studio-engine/input';
import { scenes } from './scenes.js';
import { applyMechPalette, findMechRig, type MechRig } from './scenes/mech.js';
import {
  ENEMY_SPAWN,
  LOCK_RANGE,
  MAX_ALTITUDE,
  PLAY_BOUND,
  PLAYER_SPAWN,
  clampPlayArea,
  firstBoxHitFraction,
  groundHeightAt,
  hasLineOfSight,
  pointInsideObstacle,
  resolveObstacles,
} from './arena.js';
import { DEFAULT_MECH, getMech, type MechId, type MechLoadout } from './mechs.js';
import { mountHud, type HudHandles, type HudView, type LockState, type MatchPhase } from './ui/hud.js';
import { createGameAudio } from './ui/audio.js';

const ENEMY_HP = 1000;
const AMMO_MAX = 8;
const MATCH_SECONDS = 99;

const THRUST_DRAIN = 23;
const DASH_DRAIN = 13;
const OVERHEAT_SECONDS = 2.2;
const DASH_SPEED = 34;
const DASH_SECONDS = 0.23;
const DOUBLE_TAP_WINDOW = 0.28;

const PLAYER_ACCEL = 38;
const GRAVITY = 30;
const THRUST_ACCEL = 52;
const MAX_RISE = 11;
const MAX_FALL = 24;

const BEAM_SPEED = 92;
const PLAYER_MELEE_RANGE = 5.2;
const PLAYER_FIRE_COOLDOWN = 0.38;
const PLAYER_FIRE_RECOVERY = 0.3;
const PLAYER_MELEE_COOLDOWN = 1.05;
const MELEE_SECONDS = 0.5;
const AMMO_REGEN_SECONDS = 1.35;

const ENEMY_BEAM_DAMAGE = 62;
const ENEMY_MELEE_DAMAGE = 110;
const ENEMY_SPEED = 9.5;

type LockView = LockState;

interface TapTimers {
  forward: number;
  back: number;
  left: number;
  right: number;
}

interface PlayerState {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  yaw: number;
  hp: number;
  boost: number;
  overheat: number;
  grounded: boolean;
  groundY: number;
  thrusting: boolean;
  ammo: number;
  ammoTimer: number;
  fireCooldown: number;
  recovery: number;
  recoil: number;
  meleeTimer: number;
  meleeHit: boolean;
  meleeCooldown: number;
  lungeTimer: number;
  readonly lungeDir: THREE.Vector3;
  dashTimer: number;
  readonly dashDir: THREE.Vector3;
  stagger: number;
  hitFlash: number;
  walkPhase: number;
  readonly taps: TapTimers;
  shots: number;
  hits: number;
  damageDealt: number;
}

interface EnemyState {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  yaw: number;
  hp: number;
  grounded: boolean;
  groundY: number;
  stagger: number;
  hitFlash: number;
  walkPhase: number;
  thrusting: boolean;
  thinkTimer: number;
  strafeDir: number;
  dashTimer: number;
  readonly dashDir: THREE.Vector3;
  dashCooldown: number;
  fireCooldown: number;
  telegraph: number;
  meleeTimer: number;
  meleeHit: boolean;
  meleeCooldown: number;
  lungeTimer: number;
  readonly lungeDir: THREE.Vector3;
  defeated: boolean;
}

interface PoseState {
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  yaw: number;
  grounded: boolean;
  hitFlash: number;
  dashTimer: number;
  meleeTimer: number;
  stagger: number;
  walkPhase: number;
}

interface Projectile {
  active: boolean;
  owner: 'player' | 'enemy';
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  life: number;
  damage: number;
  readonly mesh: THREE.Mesh;
}

interface Burst {
  active: boolean;
  life: number;
  duration: number;
  size: number;
  readonly pos: THREE.Vector3;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
}

interface Match {
  readonly scope: LifetimeScope;
  readonly input: FixedInputConsumer;
  readonly loadout: MechLoadout;
  readonly player: PlayerState;
  readonly enemy: EnemyState;
  readonly projectiles: Projectile[];
  readonly bursts: Burst[];
  readonly effects: THREE.Group;
  readonly reticle: THREE.Group;
  readonly reticleMaterial: THREE.MeshBasicMaterial;
  readonly playerBeamMaterial: THREE.MeshBasicMaterial;
  readonly enemyBeamMaterial: THREE.MeshBasicMaterial;
  readonly muzzlePlayer: THREE.Mesh;
  readonly muzzleEnemy: THREE.Mesh;
  timeLeft: number;
  elapsed: number;
  lockValid: boolean;
  lockInRange: boolean;
  damageFlash: number;
  shake: number;
  playerMuzzleTimer: number;
  enemyMuzzleTimer: number;
  ended: boolean;
  win: boolean;
  endTimer: number;
  resultSent: boolean;
}

interface PoseOptions {
  aimPitch: number;
  aimAmount: number;
  overheat: boolean;
  thrusting: boolean;
  dead: boolean;
  visorPulse: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const vForward = new THREE.Vector3();
const vRight = new THREE.Vector3();
const vWish = new THREE.Vector3();
const vOrigin = new THREE.Vector3();
const vAim = new THREE.Vector3();
const vDir = new THREE.Vector3();
const vTmp = new THREE.Vector3();
const vTmp2 = new THREE.Vector3();
const vCamDesired = new THREE.Vector3();
const vCamLook = new THREE.Vector3();
const vCamAnchor = new THREE.Vector3();
const vLook = new THREE.Vector3();
const vProjectileDir = new THREE.Vector3();
const quat = new THREE.Quaternion();
const camPosition = new THREE.Vector3();
const camLookAt = new THREE.Vector3();

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function yawToward(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Muzzle offset in world space: forward along facing, offset to the right arm. */
function muzzleWorld(state: PoseState, out: THREE.Vector3): THREE.Vector3 {
  const sin = Math.sin(state.yaw);
  const cos = Math.cos(state.yaw);
  return out.set(
    state.pos.x + sin * 1.15 - cos * 0.45,
    state.pos.y + 2.05,
    state.pos.z + cos * 1.15 + sin * 0.45,
  );
}

function createPlayer(loadout: MechLoadout): PlayerState {
  return {
    pos: new THREE.Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z),
    vel: new THREE.Vector3(),
    yaw: yawToward(
      new THREE.Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z),
      new THREE.Vector3(ENEMY_SPAWN.x, 0, ENEMY_SPAWN.z),
    ),
    hp: loadout.stats.maxHp,
    boost: loadout.stats.boostMax,
    overheat: 0,
    grounded: true,
    groundY: 0,
    thrusting: false,
    ammo: AMMO_MAX,
    ammoTimer: 0,
    fireCooldown: 0.4,
    recovery: 0,
    recoil: 0,
    meleeTimer: 0,
    meleeHit: false,
    meleeCooldown: 0,
    lungeTimer: 0,
    lungeDir: new THREE.Vector3(),
    dashTimer: 0,
    dashDir: new THREE.Vector3(),
    stagger: 0,
    hitFlash: 0,
    walkPhase: 0,
    taps: { forward: 9, back: 9, left: 9, right: 9 },
    shots: 0,
    hits: 0,
    damageDealt: 0,
  };
}

function createEnemy(): EnemyState {
  return {
    pos: new THREE.Vector3(ENEMY_SPAWN.x, 0, ENEMY_SPAWN.z),
    vel: new THREE.Vector3(),
    yaw: yawToward(
      new THREE.Vector3(ENEMY_SPAWN.x, 0, ENEMY_SPAWN.z),
      new THREE.Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z),
    ),
    hp: ENEMY_HP,
    grounded: true,
    groundY: 0,
    stagger: 0,
    hitFlash: 0,
    walkPhase: 0,
    thrusting: false,
    thinkTimer: 1.4,
    strafeDir: 1,
    dashTimer: 0,
    dashDir: new THREE.Vector3(),
    dashCooldown: 2.6,
    fireCooldown: 1.2,
    telegraph: 0,
    meleeTimer: 0,
    meleeHit: false,
    meleeCooldown: 1.4,
    lungeTimer: 0,
    lungeDir: new THREE.Vector3(),
    defeated: false,
  };
}

function captureEmissive(rig: MechRig): { color: number; intensity: number }[] {
  return rig.hullMaterials.map((material) => ({
    color: material.emissive.getHex(),
    intensity: material.emissiveIntensity,
  }));
}

export async function activateGame(
  context: SceneContextForCatalog<typeof scenes>,
  platform?: PlatformBridge,
): Promise<void> {
  void platform;

  const foundPlayerRig = findMechRig(context.managed.nodes.playerMech);
  const foundEnemyRig = findMechRig(context.managed.nodes.enemyMech);
  if (!foundPlayerRig || !foundEnemyRig) throw new Error('Prototype mech rigs are missing from the main scene.');
  const playerRig: MechRig = foundPlayerRig;
  const enemyRig: MechRig = foundEnemyRig;

  const scene = context.managed.scene;
  const camera = context.managed.nodes.camera;
  let selectedMech: MechLoadout = DEFAULT_MECH;
  let playerBaseEmissive = captureEmissive(playerRig);
  const enemyBaseEmissive = captureEmissive(enemyRig);

  const audio = createGameAudio(context.scope);
  const inputSession = InputSession.create(context.scope, context.session.scheduler, window);

  let phase: MatchPhase = 'ready';
  let match: Match | null = null;
  let orbitAngle = 0.6;
  let cameraInitialized = false;

  const hud: HudHandles = mountHud(context.viewport.overlayContainer, context.scope, {
    onStart: () => startMatch(),
    onReplay: () => startMatch(),
    onTitle: () => returnToTitle(),
    onSelectMech: (id) => selectMech(id),
  });

  function selectMech(id: MechId): void {
    selectedMech = getMech(id);
    applyMechPalette(playerRig, selectedMech.palette);
    playerBaseEmissive = captureEmissive(playerRig);
    applyHullFlash(playerRig, playerBaseEmissive, 0);
  }

  // --- Scene reset -------------------------------------------------------
  const resetSceneMechs = (): void => {
    playerRig.root.position.set(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z);
    playerRig.root.rotation.set(0, Math.atan2(ENEMY_SPAWN.x - PLAYER_SPAWN.x, ENEMY_SPAWN.z - PLAYER_SPAWN.z), 0);
    playerRig.hips.rotation.set(0, 0, 0);
    playerRig.hips.position.y = 1.72;
    enemyRig.root.position.set(ENEMY_SPAWN.x, 0, ENEMY_SPAWN.z);
    enemyRig.root.rotation.set(0, Math.atan2(PLAYER_SPAWN.x - ENEMY_SPAWN.x, PLAYER_SPAWN.z - ENEMY_SPAWN.z), 0);
    enemyRig.hips.rotation.set(0, 0, 0);
    enemyRig.hips.position.y = 1.72;
    applyHullFlash(playerRig, playerBaseEmissive, 0);
    applyHullFlash(enemyRig, enemyBaseEmissive, 0);
  };

  // --- Match lifecycle ---------------------------------------------------
  function startMatch(): void {
    audio.unlock();
    hud.touch.reset();
    match?.scope.dispose();
    const scope = context.scope.child('run');
    const created = createMatch(scope);
    match = created;
    phase = 'playing';
    hud.setPhase('playing');
    orbitAngle = 0.6;
    cameraInitialized = false;
    resetSceneMechs();
  }

  function returnToTitle(): void {
    match?.scope.dispose();
    match = null;
    phase = 'ready';
    hud.setPhase('ready');
    resetSceneMechs();
  }

  function createMatch(scope: LifetimeScope): Match {
    const effects = new THREE.Group();
    effects.name = 'MatchEffects';
    scene.add(effects);
    scope.defer(() => scene.remove(effects));

    const beamGeometry = scope.own(new THREE.CylinderGeometry(0.085, 0.085, 2.6, 6, 1, true));
    const playerBeamMaterial = scope.own(new THREE.MeshBasicMaterial({ color: '#7df4ff', toneMapped: false }));
    const enemyBeamMaterial = scope.own(new THREE.MeshBasicMaterial({ color: '#ffb066', toneMapped: false }));

    const projectiles: Projectile[] = [];
    for (let i = 0; i < 20; i += 1) {
      const mesh = new THREE.Mesh(beamGeometry, playerBeamMaterial);
      mesh.visible = false;
      effects.add(mesh);
      projectiles.push({
        active: false,
        owner: 'player',
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        damage: 0,
        mesh,
      });
    }

    const burstGeometry = scope.own(new THREE.SphereGeometry(1, 8, 6));
    const bursts: Burst[] = [];
    for (let i = 0; i < 10; i += 1) {
      const material = scope.own(new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }));
      const mesh = new THREE.Mesh(burstGeometry, material);
      mesh.visible = false;
      effects.add(mesh);
      bursts.push({ active: false, life: 0, duration: 0.24, size: 1, pos: new THREE.Vector3(), mesh, material });
    }

    const reticle = new THREE.Group();
    reticle.name = 'LockReticle';
    const reticleMaterial = scope.own(new THREE.MeshBasicMaterial({
      color: '#ff4050',
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }));
    const ringGeo = scope.own(new THREE.TorusGeometry(0.86, 0.045, 6, 40));
    const ring = new THREE.Mesh(ringGeo, reticleMaterial);
    ring.renderOrder = 30;
    reticle.add(ring);
    const tickGeo = scope.own(new THREE.BoxGeometry(1, 1, 1));
    const ticks: readonly [number, number, number, number][] = [
      [0, 1.18, 0.05, 0.3],
      [0, -1.18, 0.05, 0.3],
      [1.18, 0, 0.3, 0.05],
      [-1.18, 0, 0.3, 0.05],
    ];
    for (const [x, y, sx, sy] of ticks) {
      const tick = new THREE.Mesh(tickGeo, reticleMaterial);
      tick.position.set(x, y, 0);
      tick.scale.set(sx, sy, 0.02);
      tick.renderOrder = 30;
      reticle.add(tick);
    }
    const dot = new THREE.Mesh(tickGeo, reticleMaterial);
    dot.scale.set(0.12, 0.12, 0.02);
    dot.renderOrder = 30;
    reticle.add(dot);
    reticle.visible = false;
    scene.add(reticle);
    scope.defer(() => scene.remove(reticle));

    const muzzleGeometry = scope.own(new THREE.SphereGeometry(0.34, 8, 6));
    const muzzlePlayer = new THREE.Mesh(muzzleGeometry, scope.own(new THREE.MeshBasicMaterial({
      color: '#c8fbff',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })));
    muzzlePlayer.visible = false;
    scene.add(muzzlePlayer);
    scope.defer(() => scene.remove(muzzlePlayer));
    const muzzleEnemy = new THREE.Mesh(muzzleGeometry, scope.own(new THREE.MeshBasicMaterial({
      color: '#ffd2a0',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })));
    muzzleEnemy.visible = false;
    scene.add(muzzleEnemy);
    scope.defer(() => scene.remove(muzzleEnemy));

    const created: Match = {
      scope,
      input: inputSession.fixed(scope),
      loadout: selectedMech,
      player: createPlayer(selectedMech),
      enemy: createEnemy(),
      projectiles,
      bursts,
      effects,
      reticle,
      reticleMaterial,
      playerBeamMaterial,
      enemyBeamMaterial,
      muzzlePlayer,
      muzzleEnemy,
      timeLeft: MATCH_SECONDS,
      elapsed: 0,
      lockValid: true,
      lockInRange: true,
      damageFlash: 0,
      shake: 0,
      playerMuzzleTimer: 0,
      enemyMuzzleTimer: 0,
      ended: false,
      win: false,
      endTimer: 0,
      resultSent: false,
    };

    scope.defer(context.session.scheduler.on('fixedUpdate', (step) => {
      if (phase === 'playing' && match === created) updateMatch(created, step.deltaSeconds);
    }));

    return created;
  }

  // --- Input -------------------------------------------------------------
  const tapDirection = (m: Match, pressed: boolean, dir: 'forward' | 'back' | 'left' | 'right', dt: number): void => {
    const taps = m.player.taps;
    taps[dir] = Math.min(9, taps[dir] + dt);
    if (!pressed) return;
    const quick = taps[dir] <= DOUBLE_TAP_WINDOW;
    taps[dir] = 0;
    if (!quick) return;
    setDashBasis(m);
    const forward = vForward;
    const right = vRight;
    const dash = vWish.set(0, 0, 0);
    if (dir === 'forward') dash.add(forward);
    if (dir === 'back') dash.sub(forward);
    if (dir === 'right') dash.add(right);
    if (dir === 'left') dash.sub(right);
    triggerDash(m, dash);
  };

  const setDashBasis = (m: Match): void => {
    vForward.set(m.enemy.pos.x - m.player.pos.x, 0, m.enemy.pos.z - m.player.pos.z);
    if (vForward.lengthSq() < 0.0001) vForward.set(Math.sin(m.player.yaw), 0, Math.cos(m.player.yaw));
    vForward.normalize();
    vRight.set(-vForward.z, 0, vForward.x);
  };

  const triggerDash = (m: Match, direction: THREE.Vector3): void => {
    const p = m.player;
    if (p.dashTimer > 0 || p.overheat > 0 || p.stagger > 0 || p.boost < m.loadout.stats.dashCost) return;
    const cancelled = p.recovery > 0;
    p.boost = Math.max(0, p.boost - m.loadout.stats.dashCost);
    p.dashTimer = DASH_SECONDS;
    if (direction.lengthSq() < 0.0001) {
      direction.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    }
    p.dashDir.copy(direction).normalize();
    p.recovery = 0;
    p.meleeTimer = 0;
    m.shake = Math.max(m.shake, 0.16);
    audio.dash();
    if (cancelled) hud.toast('CANCEL!');
    if (p.boost <= 0) startOverheat(m);
  };

  const startOverheat = (m: Match): void => {
    const p = m.player;
    if (p.overheat > 0) return;
    p.overheat = OVERHEAT_SECONDS;
    p.dashTimer = 0;
    audio.overheat();
    hud.toast('OVERHEAT');
  };

  const useBoost = (m: Match, amount: number): void => {
    const p = m.player;
    p.boost = Math.max(0, p.boost - amount);
    if (p.boost <= 0) startOverheat(m);
  };

  // --- Player ------------------------------------------------------------
  const updatePlayer = (m: Match, dt: number): void => {
    const p = m.player;
    const e = m.enemy;
    const input = m.input;
    const touch = hud.touch;
    const touchDash = touch.consumeDash();
    const touchFire = touch.consumeFire();
    const touchMelee = touch.consumeMelee();

    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.recovery = Math.max(0, p.recovery - dt);
    p.recoil = Math.max(0, p.recoil - dt);
    p.meleeCooldown = Math.max(0, p.meleeCooldown - dt);
    p.stagger = Math.max(0, p.stagger - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt * 3);
    p.lungeTimer = Math.max(0, p.lungeTimer - dt);
    if (p.meleeTimer > 0) p.meleeTimer = Math.max(0, p.meleeTimer - dt);
    if (p.overheat > 0) {
      p.overheat = Math.max(0, p.overheat - dt);
      if (p.overheat === 0) hud.toast('COOL DOWN');
    }

    setDashBasis(m);
    tapDirection(m, input.wasPressed('KeyW'), 'forward', dt);
    tapDirection(m, input.wasPressed('KeyS'), 'back', dt);
    tapDirection(m, input.wasPressed('KeyA'), 'left', dt);
    tapDirection(m, input.wasPressed('KeyD'), 'right', dt);

    if (input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight')) {
      const dash = vWish.set(0, 0, 0);
      if (input.isDown('KeyW')) dash.add(vForward);
      if (input.isDown('KeyS')) dash.sub(vForward);
      if (input.isDown('KeyD')) dash.add(vRight);
      if (input.isDown('KeyA')) dash.sub(vRight);
      if (dash.lengthSq() < 0.0001) dash.copy(vForward);
      triggerDash(m, dash);
    }
    if (touchDash) {
      const dash = vWish.set(0, 0, 0)
        .addScaledVector(vRight, touch.moveX)
        .addScaledVector(vForward, touch.moveY);
      if (dash.lengthSq() < 0.04) dash.copy(vForward);
      triggerDash(m, dash);
    }

    if (input.wasPressed('KeyJ') || input.wasPointerPressed(1) || touchFire || touch.fireHeld) tryFire(m);
    if (input.wasPressed('KeyK') || input.wasPointerPressed(2) || touchMelee) tryMelee(m);

    const targetYaw = yawToward(p.pos, e.pos);
    p.yaw = dampAngle(p.yaw, targetYaw, 18, dt);

    const keyForward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const keyRight = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const forwardAxis = clamp(keyForward + touch.moveY, -1, 1);
    const rightAxis = clamp(keyRight + touch.moveX, -1, 1);
    const wish = vWish.set(0, 0, 0).addScaledVector(vForward, forwardAxis).addScaledVector(vRight, rightAxis);
    if (wish.lengthSq() > 1) wish.normalize();

    if (p.dashTimer > 0) {
      p.dashTimer = Math.max(0, p.dashTimer - dt);
      p.vel.x = p.dashDir.x * DASH_SPEED;
      p.vel.z = p.dashDir.z * DASH_SPEED;
      useBoost(m, DASH_DRAIN * dt);
    } else if (p.lungeTimer > 0) {
      // The melee lunge homes toward the locked target, including its altitude.
      p.lungeDir.set(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z);
      if (p.lungeDir.lengthSq() > 0.0001) p.lungeDir.normalize();
      p.vel.x = p.lungeDir.x * 26;
      p.vel.z = p.lungeDir.z * 26;
      p.vel.y = clamp((e.pos.y - p.pos.y) / 0.26, -8, 16);
    } else {
      const groundedSpeed = p.stagger > 0 ? 0.25 : p.overheat > 0 ? 0.42 : p.recovery > 0 ? 0.55 : 1;
      const speed = (p.grounded ? m.loadout.stats.speedGround : m.loadout.stats.speedAir) * groundedSpeed;
      const accel = p.stagger > 0 ? 10 : PLAYER_ACCEL;
      const step = accel * dt;
      const targetX = wish.x * speed;
      const targetZ = wish.z * speed;
      p.vel.x += clamp(targetX - p.vel.x, -step, step);
      p.vel.z += clamp(targetZ - p.vel.z, -step, step);
    }

    const canThrust = (input.isDown('Space') || touch.boostHeld) && p.overheat <= 0 && p.boost > 0 && p.stagger <= 0;
    p.thrusting = canThrust;
    if (canThrust) {
      p.vel.y = Math.min(MAX_RISE, p.vel.y + THRUST_ACCEL * dt);
      useBoost(m, THRUST_DRAIN * dt);
      if (p.grounded) p.grounded = false;
    } else {
      p.vel.y -= GRAVITY * dt;
      if (p.vel.y < -MAX_FALL) p.vel.y = -MAX_FALL;
    }

    p.pos.addScaledVector(p.vel, dt);
    integrateActor(p, 0.85, 3.35, true);

    if (p.grounded && !canThrust && p.overheat <= 0 && p.dashTimer <= 0) {
      p.boost = Math.min(m.loadout.stats.boostMax, p.boost + m.loadout.stats.boostRegen * dt);
    }

    p.ammoTimer += dt;
    if (p.ammoTimer >= AMMO_REGEN_SECONDS) {
      p.ammoTimer -= AMMO_REGEN_SECONDS;
      if (p.ammo < AMMO_MAX) p.ammo += 1;
    }

    p.walkPhase += Math.hypot(p.vel.x, p.vel.z) * dt * 0.85;

    if (p.meleeTimer > 0 && !p.meleeHit) {
      const swing = MELEE_SECONDS - p.meleeTimer;
      if (swing >= 0.11 && swing <= 0.31) checkPlayerMelee(m);
    }

    m.damageFlash = Math.max(0, m.damageFlash - dt * 2.4);
    m.playerMuzzleTimer = Math.max(0, m.playerMuzzleTimer - dt);
    m.enemyMuzzleTimer = Math.max(0, m.enemyMuzzleTimer - dt);
  };

  const tryFire = (m: Match): void => {
    const p = m.player;
    if (p.overheat > 0 || p.stagger > 0 || p.recovery > 0 || p.meleeTimer > 0 || p.fireCooldown > 0) return;
    if (p.ammo <= 0) {
      audio.dry();
      return;
    }
    const e = m.enemy;
    const origin = muzzleWorld(p, vOrigin);
    const distance = origin.distanceTo(vTmp.set(e.pos.x, e.pos.y + 1.9, e.pos.z));
    const lead = (distance / BEAM_SPEED) * 0.9;
    const aim = vAim.set(e.pos.x, e.pos.y + 1.9, e.pos.z).addScaledVector(e.vel, lead);
    const dir = vDir.copy(aim).sub(origin).normalize();
    spawnBeam(m, 'player', origin, dir, BEAM_SPEED, m.loadout.stats.beamDamage);
    p.ammo -= 1;
    p.ammoTimer = 0;
    p.shots += 1;
    p.fireCooldown = PLAYER_FIRE_COOLDOWN;
    p.recovery = PLAYER_FIRE_RECOVERY;
    p.recoil = 0.2;
    m.playerMuzzleTimer = 0.09;
    m.shake = Math.max(m.shake, 0.08);
    audio.rifle(false);
  };

  const tryMelee = (m: Match): void => {
    const p = m.player;
    const e = m.enemy;
    if (p.overheat > 0 || p.stagger > 0 || p.dashTimer > 0 || p.meleeTimer > 0 || p.meleeCooldown > 0) return;
    p.meleeTimer = MELEE_SECONDS;
    p.meleeHit = false;
    p.meleeCooldown = PLAYER_MELEE_COOLDOWN;
    p.recovery = 0;
    p.lungeTimer = 0.26;
    p.lungeDir.set(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z);
    if (p.lungeDir.lengthSq() < 0.0001) p.lungeDir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    else p.lungeDir.normalize();
    p.vel.y = Math.max(p.vel.y, clamp((e.pos.y - p.pos.y) / 0.26, 0, 16));
    audio.melee();
  };

  const checkPlayerMelee = (m: Match): void => {
    const p = m.player;
    const e = m.enemy;
    if (e.defeated) return;
    const dx = e.pos.x - p.pos.x;
    const dz = e.pos.z - p.pos.z;
    const dy = e.pos.y - p.pos.y;
    const flat = Math.hypot(dx, dz);
    const reach = Math.hypot(flat, dy);
    if (reach > PLAYER_MELEE_RANGE) return;
    const facing = vTmp.set(dx, 0, dz).normalize();
    const forward = vTmp2.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (flat > 1.4 && facing.dot(forward) < 0.1) return;
    p.meleeHit = true;
    p.damageDealt += m.loadout.stats.meleeDamage;
    e.hp = Math.max(0, e.hp - m.loadout.stats.meleeDamage);
    e.hitFlash = 1;
    e.stagger = 0.65;
    vTmp.set(dx, 0, dz).normalize();
    e.vel.x += vTmp.x * 17;
    e.vel.z += vTmp.z * 17;
    e.vel.y = Math.max(e.vel.y, 8);
    spawnBurst(m, e.pos.x, e.pos.y + 1.9, e.pos.z, '#e8fbff', 2.1);
    m.shake = Math.max(m.shake, 0.7);
    audio.hit();
    if (e.hp <= 0) finishMatch(m, true);
  };

  // --- Enemy AI ----------------------------------------------------------
  const updateEnemy = (m: Match, dt: number): void => {
    const e = m.enemy;
    const p = m.player;

    e.hitFlash = Math.max(0, e.hitFlash - dt * 3);
    e.stagger = Math.max(0, e.stagger - dt);
    e.fireCooldown = Math.max(0, e.fireCooldown - dt);
    e.meleeCooldown = Math.max(0, e.meleeCooldown - dt);
    e.lungeTimer = Math.max(0, e.lungeTimer - dt);
    e.dashCooldown = Math.max(0, e.dashCooldown - dt);
    if (e.telegraph > 0) {
      e.telegraph = Math.max(0, e.telegraph - dt);
      if (e.telegraph === 0) enemyFire(m);
    }
    if (e.meleeTimer > 0) e.meleeTimer = Math.max(0, e.meleeTimer - dt);

    if (e.defeated) {
      e.vel.y -= GRAVITY * dt;
      e.vel.x *= 1 - Math.min(1, dt * 1.5);
      e.vel.z *= 1 - Math.min(1, dt * 1.5);
      e.pos.addScaledVector(e.vel, dt);
      integrateActor(e, 1.0, 3.35, false);
      return;
    }

    const dx = p.pos.x - e.pos.x;
    const dz = p.pos.z - e.pos.z;
    const distance = Math.hypot(dx, dz);
    e.yaw = dampAngle(e.yaw, Math.atan2(dx, dz), 10, dt);

    if (e.stagger > 0) {
      e.vel.y -= GRAVITY * dt;
      e.vel.x *= 1 - Math.min(1, dt * 2.2);
      e.vel.z *= 1 - Math.min(1, dt * 2.2);
      e.pos.addScaledVector(e.vel, dt);
      integrateActor(e, 1.0, 3.35, false);
      return;
    }

    e.thinkTimer -= dt;
    if (e.thinkTimer <= 0) {
      e.thinkTimer = 1.8 + Math.random() * 2.4;
      if (Math.random() < 0.5) e.strafeDir *= -1;
    }

    const flat = vForward.set(dx, 0, dz);
    if (flat.lengthSq() < 0.0001) flat.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    flat.normalize();
    const right = vRight.set(-flat.z, 0, flat.x);

    let desiredX = 0;
    let desiredZ = 0;
    if (distance > 21) {
      desiredX += flat.x * ENEMY_SPEED;
      desiredZ += flat.z * ENEMY_SPEED;
    } else if (distance < 11) {
      desiredX -= flat.x * ENEMY_SPEED * 0.8;
      desiredZ -= flat.z * ENEMY_SPEED * 0.8;
    }
    desiredX += right.x * e.strafeDir * ENEMY_SPEED * 0.72;
    desiredZ += right.z * e.strafeDir * ENEMY_SPEED * 0.72;
    if (e.telegraph > 0) {
      desiredX *= 0.25;
      desiredZ *= 0.25;
    }
    if (e.meleeTimer > 0) {
      desiredX = 0;
      desiredZ = 0;
    }

    if (e.lungeTimer > 0) {
      e.vel.x = e.lungeDir.x * 18;
      e.vel.z = e.lungeDir.z * 18;
    } else if (e.dashTimer > 0) {
      e.dashTimer = Math.max(0, e.dashTimer - dt);
      e.vel.x = e.dashDir.x * 27;
      e.vel.z = e.dashDir.z * 27;
    } else {
      const step = 16 * dt;
      e.vel.x += clamp(desiredX - e.vel.x, -step, step);
      e.vel.z += clamp(desiredZ - e.vel.z, -step, step);
    }

    const blocked = !hasLineOfSight(
      e.pos.x, e.pos.y + 2.1, e.pos.z,
      p.pos.x, p.pos.y + 1.8, p.pos.z,
    );
    let targetAltitude = 2.8 + Math.sin(m.elapsed * 0.8 + 0.7) * 1.4;
    if (blocked) targetAltitude = 9.5;
    if (e.pos.y < 1.2) targetAltitude = Math.max(targetAltitude, 3.4);
    const altitudeDelta = targetAltitude - e.pos.y;
    e.vel.y = clamp(altitudeDelta * 2.6, -7, 7);
    e.thrusting = altitudeDelta > 0.4 || distance > 12;

    if (e.dashCooldown <= 0 && distance > 9 && e.telegraph <= 0) {
      e.dashTimer = 0.24;
      e.dashCooldown = 4 + Math.random() * 2.5;
      e.dashDir.copy(right).multiplyScalar(e.strafeDir).addScaledVector(flat, 0.15).normalize();
      audio.dash();
    }

    if (e.telegraph <= 0 && e.fireCooldown <= 0 && distance < 42 && !blocked && e.meleeTimer <= 0) {
      e.telegraph = 0.55;
      e.fireCooldown = 2.1;
    }

    if (distance < 5.4 && e.meleeCooldown <= 0 && e.meleeTimer <= 0 && e.telegraph <= 0) {
      e.meleeTimer = MELEE_SECONDS;
      e.meleeHit = false;
      e.meleeCooldown = 2.3;
      e.lungeTimer = 0.22;
      e.lungeDir.copy(flat);
      audio.melee();
    }

    if (e.meleeTimer > 0 && !e.meleeHit) {
      const swing = MELEE_SECONDS - e.meleeTimer;
      if (swing >= 0.1 && swing <= 0.3) {
        const reach = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z, p.pos.y - e.pos.y);
        if (reach < 5.2) {
          e.meleeHit = true;
          damagePlayer(m, ENEMY_MELEE_DAMAGE, e.pos);
        }
      }
    }

    e.pos.addScaledVector(e.vel, dt);
    integrateActor(e, 1.0, 3.35, false);
    e.walkPhase += Math.hypot(e.vel.x, e.vel.z) * dt * 0.8;
  };

  const enemyFire = (m: Match): void => {
    const e = m.enemy;
    const p = m.player;
    if (e.defeated) return;
    const origin = muzzleWorld(e, vOrigin);
    const distance = origin.distanceTo(vTmp.set(p.pos.x, p.pos.y + 1.7, p.pos.z));
    const lead = (distance / 74) * 0.85;
    const aim = vAim.set(p.pos.x, p.pos.y + 1.7, p.pos.z).addScaledVector(p.vel, lead);
    const dir = vTmp2.copy(aim).sub(origin).normalize();
    dir.x += (Math.random() - 0.5) * 0.045;
    dir.y += (Math.random() - 0.5) * 0.03;
    dir.z += (Math.random() - 0.5) * 0.045;
    dir.normalize();
    spawnBeam(m, 'enemy', origin, dir, 74, ENEMY_BEAM_DAMAGE);
    m.enemyMuzzleTimer = 0.1;
    audio.rifle(true);
  };

  // --- Beam projectiles --------------------------------------------------
  const spawnBeam = (
    m: Match,
    owner: 'player' | 'enemy',
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    damage: number,
  ): void => {
    const projectile = m.projectiles.find((item) => !item.active);
    if (!projectile) return;
    projectile.active = true;
    projectile.owner = owner;
    projectile.life = 2.4;
    projectile.damage = damage;
    projectile.pos.copy(origin);
    projectile.vel.copy(direction).multiplyScalar(speed);
    projectile.mesh.visible = true;
    projectile.mesh.position.copy(origin);
    projectile.mesh.material = owner === 'player' ? m.playerBeamMaterial : m.enemyBeamMaterial;
  };

  const updateProjectiles = (m: Match, dt: number): void => {
    const p = m.player;
    const e = m.enemy;
    for (const projectile of m.projectiles) {
      if (!projectile.active) continue;
      projectile.life -= dt;
      if (projectile.life <= 0) {
        deactivateProjectile(projectile);
        continue;
      }
      const steps = 2;
      const sub = dt / steps;
      let consumed = false;
      for (let step = 0; step < steps && !consumed; step += 1) {
        projectile.pos.addScaledVector(projectile.vel, sub);
        if (pointInsideObstacle(projectile.pos.x, projectile.pos.y, projectile.pos.z, 0.12)) {
          spawnBurst(m, projectile.pos.x, projectile.pos.y, projectile.pos.z, projectile.owner === 'player' ? '#a9f8ff' : '#ffb066', 0.9);
          consumed = true;
          break;
        }
        if (projectile.owner === 'player') {
          if (e.defeated) continue;
          const dx = projectile.pos.x - e.pos.x;
          const dy = projectile.pos.y - (e.pos.y + 1.8);
          const dz = projectile.pos.z - e.pos.z;
          if (dx * dx + dy * dy + dz * dz < 4.2) {
            e.hp = Math.max(0, e.hp - projectile.damage);
            e.hitFlash = 1;
            e.stagger = Math.max(e.stagger, 0.12);
            e.vel.x += projectile.vel.x * 0.03;
            e.vel.z += projectile.vel.z * 0.03;
            p.hits += 1;
            p.damageDealt += projectile.damage;
            spawnBurst(m, projectile.pos.x, projectile.pos.y, projectile.pos.z, '#c8fbff', 1.5);
            m.shake = Math.max(m.shake, 0.3);
            audio.hit();
            consumed = true;
            if (e.hp <= 0) finishMatch(m, true);
            break;
          }
        } else {
          const dx = projectile.pos.x - p.pos.x;
          const dy = projectile.pos.y - (p.pos.y + 1.7);
          const dz = projectile.pos.z - p.pos.z;
          if (dx * dx + dy * dy + dz * dz < 3.4) {
            damagePlayer(m, projectile.damage, projectile.pos);
            spawnBurst(m, projectile.pos.x, projectile.pos.y, projectile.pos.z, '#ffc38a', 1.4);
            consumed = true;
            break;
          }
        }
      }
      if (consumed) deactivateProjectile(projectile);
    }
  };

  const deactivateProjectile = (projectile: Projectile): void => {
    projectile.active = false;
    projectile.life = 0;
    projectile.mesh.visible = false;
  };

  const spawnBurst = (m: Match, x: number, y: number, z: number, color: string, size: number): void => {
    const burst = m.bursts.find((item) => !item.active);
    if (!burst) return;
    burst.active = true;
    burst.life = burst.duration;
    burst.size = size;
    burst.pos.set(x, y, z);
    burst.material.color.set(color);
    burst.material.opacity = 0.95;
    burst.mesh.visible = true;
    burst.mesh.position.copy(burst.pos);
    burst.mesh.scale.setScalar(size * 0.35);
  };

  const damagePlayer = (m: Match, amount: number, source: THREE.Vector3): void => {
    const p = m.player;
    if (p.hp <= 0 || m.ended) return;
    p.hp = Math.max(0, p.hp - amount);
    p.hitFlash = 1;
    p.stagger = Math.max(p.stagger, 0.2);
    p.recovery = Math.max(p.recovery, 0.12);
    p.vel.x += (p.pos.x - source.x) * 0.25;
    p.vel.z += (p.pos.z - source.z) * 0.25;
    p.vel.y = Math.max(p.vel.y, 2.4);
    m.damageFlash = 1;
    m.shake = Math.max(m.shake, 0.8);
    audio.hit();
    if (p.hp <= 0) finishMatch(m, false);
  };

  // --- Collision ---------------------------------------------------------
  const integrateActor = (
    state: PlayerState | EnemyState,
    radius: number,
    height: number,
    isPlayer: boolean,
  ): void => {
    const clamped = clampPlayArea(state.pos.x, state.pos.z);
    if (clamped.x !== state.pos.x) {
      state.pos.x = clamped.x;
      state.vel.x = 0;
    }
    if (clamped.z !== state.pos.z) {
      state.pos.z = clamped.z;
      state.vel.z = 0;
    }
    if (state.pos.y > MAX_ALTITUDE) {
      state.pos.y = MAX_ALTITUDE;
      if (state.vel.y > 0) state.vel.y = 0;
    }

    const ground = groundHeightAt(state.pos.x, state.pos.z, radius, state.pos.y);
    if (state.pos.y <= ground.height + 0.02 && state.pos.y >= ground.height - 0.72) {
      const landed = !state.grounded;
      state.pos.y = ground.height;
      if (state.vel.y < 0) state.vel.y = 0;
      state.grounded = true;
      state.groundY = ground.height;
      if (landed && isPlayer) audio.land();
    } else {
      state.grounded = false;
      if (state.pos.y < 0) {
        state.pos.y = 0;
        if (state.vel.y < 0) state.vel.y = 0;
        state.grounded = true;
      }
    }

    const resolved = resolveObstacles(state.pos.x, state.pos.z, state.pos.y, height, radius);
    state.pos.x = resolved.x;
    state.pos.z = resolved.z;
  };

  // --- Lock-on -----------------------------------------------------------
  const updateLock = (m: Match): void => {
    const p = m.player;
    const e = m.enemy;
    const distance = vTmp.set(p.pos.x, p.pos.y + 2.2, p.pos.z).distanceTo(vTmp2.set(e.pos.x, e.pos.y + 1.9, e.pos.z));
    const inRange = distance <= LOCK_RANGE;
    const clear = hasLineOfSight(
      p.pos.x, p.pos.y + 2.2, p.pos.z,
      e.pos.x, e.pos.y + 1.9, e.pos.z,
    );
    m.lockInRange = inRange;
    m.lockValid = inRange && clear && !e.defeated;
    audio.lock(m.lockValid);
  };

  // --- Match update ------------------------------------------------------
  const updateMatch = (m: Match, dt: number): void => {
    m.elapsed += dt;

    if (m.ended) {
      m.endTimer -= dt;
      updateProjectiles(m, dt);
      const p = m.player;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.y -= GRAVITY * dt;
      p.vel.x *= 1 - Math.min(1, dt * 2);
      p.vel.z *= 1 - Math.min(1, dt * 2);
      integrateActor(p, 0.85, 3.35, true);
      const e = m.enemy;
      if (e.defeated) {
        e.pos.addScaledVector(e.vel, dt);
        e.vel.y -= GRAVITY * dt;
        integrateActor(e, 1.0, 3.35, false);
      }
      m.damageFlash = Math.max(0, m.damageFlash - dt * 2.4);
      m.playerMuzzleTimer = Math.max(0, m.playerMuzzleTimer - dt);
      m.enemyMuzzleTimer = Math.max(0, m.enemyMuzzleTimer - dt);
      if (m.endTimer <= 0 && !m.resultSent) {
        m.resultSent = true;
        phase = 'over';
        hud.setPhase('over');
        hud.showResult({
          win: m.win,
          timeUsed: MATCH_SECONDS - m.timeLeft,
          damage: m.player.damageDealt,
          hits: m.player.hits,
          shots: m.player.shots,
        });
      }
      return;
    }

    m.timeLeft = Math.max(0, m.timeLeft - dt);
    updatePlayer(m, dt);
    updateEnemy(m, dt);
    updateProjectiles(m, dt);
    updateLock(m);

    if (!m.ended && m.timeLeft <= 0) {
      finishMatch(m, m.enemy.hp < m.player.hp);
    }
  };

  const finishMatch = (m: Match, win: boolean): void => {
    if (m.ended) return;
    m.ended = true;
    m.win = win;
    m.endTimer = 1.2;
    m.shake = Math.max(m.shake, 0.9);
    m.enemy.defeated = win;
    hud.toast(win ? 'TARGET DESTROYED' : 'SYSTEM DOWN');
    audio.finish(win);
  };

  // --- Presentation ------------------------------------------------------
  function applyHullFlash(
    rig: MechRig,
    base: readonly { color: number; intensity: number }[],
    flash: number,
  ): void {
    rig.hullMaterials.forEach((material, index) => {
      const source = base[index];
      if (flash > 0.02) {
        material.emissive.setHex(0xffffff);
        material.emissiveIntensity = 1.6 * flash;
      } else if (source) {
        material.emissive.setHex(source.color);
        material.emissiveIntensity = source.intensity;
      }
    });
  }

  function poseActor(
    rig: MechRig,
    actor: PoseState,
    dt: number,
    elapsed: number,
    options: PoseOptions,
  ): void {
    rig.root.position.copy(actor.pos);
    rig.root.rotation.set(0, actor.yaw, 0);

    const speed = Math.hypot(actor.vel.x, actor.vel.z);
    const moving = actor.grounded ? clamp(speed / 8, 0, 1) : 0;
    const swing = Math.sin(actor.walkPhase) * moving * 0.55;
    const dashing = actor.dashTimer > 0;
    const meleeProgress = actor.meleeTimer > 0 ? 1 - actor.meleeTimer / MELEE_SECONDS : 0;
    const airborne = !actor.grounded;

    const legLTarget = dashing ? 0.85 : swing + (airborne ? 0.35 : 0);
    const legRTarget = dashing ? 0.7 : -swing + (airborne ? 0.2 : 0);
    rig.legL.rotation.x = THREE.MathUtils.damp(rig.legL.rotation.x, legLTarget, 12, dt);
    rig.legR.rotation.x = THREE.MathUtils.damp(rig.legR.rotation.x, legRTarget, 12, dt);
    const kneeTarget = airborne ? -0.95 : Math.max(0, -swing) * 0.9 + 0.06;
    rig.kneeL.rotation.x = THREE.MathUtils.damp(rig.kneeL.rotation.x, kneeTarget, 12, dt);
    rig.kneeR.rotation.x = THREE.MathUtils.damp(rig.kneeR.rotation.x, airborne ? -0.7 : 0.06, 12, dt);

    let armRTarget = -0.55 - options.aimAmount * 0.85;
    if (meleeProgress > 0) {
      if (meleeProgress < 0.36) {
        armRTarget = -0.55 - (meleeProgress / 0.36) * 1.95;
      } else {
        armRTarget = -2.5 + Math.min(1, (meleeProgress - 0.36) / 0.5) * 2.6;
      }
    }
    rig.armR.rotation.x = THREE.MathUtils.damp(rig.armR.rotation.x, armRTarget, 16, dt);
    rig.armR.rotation.z = THREE.MathUtils.damp(rig.armR.rotation.z, -0.06, 10, dt);
    rig.elbowR.rotation.x = THREE.MathUtils.damp(rig.elbowR.rotation.x, meleeProgress > 0 ? 0.02 : 0.16, 12, dt);
    rig.armL.rotation.x = THREE.MathUtils.damp(rig.armL.rotation.x, dashing ? -0.9 : airborne ? -0.55 : -0.18, 10, dt);
    rig.armL.rotation.z = THREE.MathUtils.damp(rig.armL.rotation.z, 0.08, 10, dt);
    rig.elbowL.rotation.x = THREE.MathUtils.damp(rig.elbowL.rotation.x, airborne ? -0.45 : -0.16, 10, dt);

    rig.rifle.rotation.x = -rig.armR.rotation.x - options.aimPitch;
    rig.saber.rotation.x = -rig.armR.rotation.x - options.aimPitch;
    rig.saber.visible = meleeProgress > 0;
    rig.rifle.visible = !rig.saber.visible;

    const lean = options.dead
      ? 0.55
      : options.overheat
        ? 0.3
        : dashing
          ? 0.36
          : actor.stagger > 0
            ? -0.24
            : 0.07 + moving * 0.06;
    rig.torso.rotation.x = THREE.MathUtils.damp(rig.torso.rotation.x, lean, 9, dt);
    const twist = meleeProgress > 0 ? -Math.sin(meleeProgress * Math.PI) * 0.7 : 0;
    rig.torso.rotation.y = THREE.MathUtils.damp(rig.torso.rotation.y, twist, 10, dt);
    rig.head.rotation.x = THREE.MathUtils.damp(rig.head.rotation.x, -options.aimPitch * 0.55, 9, dt);

    if (options.dead) {
      rig.hips.rotation.x = THREE.MathUtils.damp(rig.hips.rotation.x, 1.25, 4, dt);
      rig.hips.position.y = THREE.MathUtils.damp(rig.hips.position.y, 0.55, 4, dt);
    } else {
      rig.hips.rotation.x = THREE.MathUtils.damp(rig.hips.rotation.x, 0, 8, dt);
      rig.hips.position.y = THREE.MathUtils.damp(rig.hips.position.y, 1.72, 8, dt);
    }

    const flameOn = !options.dead && (options.thrusting || dashing);
    const flicker = 1 + Math.sin(elapsed * 42) * 0.14 + Math.sin(elapsed * 23) * 0.08;
    for (const flame of rig.thrusters) {
      flame.visible = flameOn;
      if (flameOn) {
        flame.scale.set(0.18 * flicker, 0.75 * flicker, 0.18 * flicker);
      }
    }

    rig.visorMaterial.emissiveIntensity = 3 + options.visorPulse * 4;
    applyHullFlash(rig, rig === playerRig ? playerBaseEmissive : enemyBaseEmissive, actor.hitFlash);
  }

  function poseMatch(m: Match, dt: number): void {
    const p = m.player;
    const e = m.enemy;
    const playerAimPitch = clamp(
      Math.atan2(
        e.pos.y + 1.8 - (p.pos.y + 2.1),
        Math.max(0.001, Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)),
      ),
      -0.7,
      0.7,
    );
    const enemyAimPitch = clamp(
      Math.atan2(
        p.pos.y + 1.7 - (e.pos.y + 2.1),
        Math.max(0.001, Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z)),
      ),
      -0.7,
      0.7,
    );

    poseActor(playerRig, p, dt, m.elapsed, {
      aimPitch: playerAimPitch,
      aimAmount: p.recovery > 0 || p.recoil > 0 ? 1 : 0.25,
      overheat: p.overheat > 0,
      thrusting: p.thrusting,
      dead: p.hp <= 0,
      visorPulse: p.recoil > 0 ? 1 : 0,
    });
    poseActor(enemyRig, e, dt, m.elapsed, {
      aimPitch: enemyAimPitch,
      aimAmount: e.telegraph > 0 ? 1 : 0.3,
      overheat: false,
      thrusting: e.thrusting,
      dead: e.defeated,
      visorPulse: e.telegraph > 0 ? 1 : 0,
    });
  }

  function updateEffects(m: Match, dt: number): void {
    for (const projectile of m.projectiles) {
      if (!projectile.active) {
        projectile.mesh.visible = false;
        continue;
      }
      vProjectileDir.copy(projectile.vel).normalize();
      projectile.mesh.visible = true;
      projectile.mesh.position.copy(projectile.pos).addScaledVector(vProjectileDir, -1.15);
      quat.setFromUnitVectors(UP, vProjectileDir);
      projectile.mesh.quaternion.copy(quat);
    }

    for (const burst of m.bursts) {
      if (!burst.active) {
        burst.mesh.visible = false;
        continue;
      }
      burst.life = Math.max(0, burst.life - dt);
      const progress = 1 - burst.life / burst.duration;
      burst.mesh.visible = true;
      burst.mesh.position.copy(burst.pos);
      burst.mesh.scale.setScalar(burst.size * (0.35 + progress * 1.1));
      burst.material.opacity = (1 - progress) * 0.9;
      if (burst.life <= 0) {
        burst.active = false;
        burst.mesh.visible = false;
      }
    }

    if (m.playerMuzzleTimer > 0) {
      muzzleWorld(m.player, vTmp);
      m.muzzlePlayer.visible = true;
      m.muzzlePlayer.position.copy(vTmp);
      m.muzzlePlayer.scale.setScalar(0.6 + m.playerMuzzleTimer * 6);
    } else {
      m.muzzlePlayer.visible = false;
    }
    if (m.enemyMuzzleTimer > 0) {
      muzzleWorld(m.enemy, vTmp);
      m.muzzleEnemy.visible = true;
      m.muzzleEnemy.position.copy(vTmp);
      m.muzzleEnemy.scale.setScalar(0.6 + m.enemyMuzzleTimer * 6);
    } else {
      m.muzzleEnemy.visible = false;
    }
  }

  function updateReticle(m: Match): void {
    const visible = phase === 'playing' && !m.ended;
    m.reticle.visible = visible;
    if (!visible) return;
    m.reticle.position.set(m.enemy.pos.x, m.enemy.pos.y + 3.95, m.enemy.pos.z);
    m.reticle.quaternion.copy(camera.quaternion);
    const distance = camera.position.distanceTo(m.reticle.position);
    const pulse = m.lockValid ? 1 + Math.sin(m.elapsed * 7) * 0.035 : 1;
    m.reticle.scale.setScalar(clamp(distance * 0.05, 0.8, 3.1) * pulse);
    m.reticleMaterial.color.setHex(m.lockValid ? 0xff4050 : 0x45e49b);
  }

  function updateCamera(dt: number): void {
    if (phase === 'playing' && match && !match.ended) {
      const p = match.player;
      const e = match.enemy;
      const flat = vForward.set(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z);
      const distance = flat.length();
      if (distance < 0.001) flat.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      else flat.normalize();
      const right = vRight.set(-flat.z, 0, flat.x);
      const verticalGap = Math.abs(p.pos.y - e.pos.y);
      const back = clamp(6 + distance * 0.2 + verticalGap * 0.55, 9, 24);
      vCamDesired.set(p.pos.x, p.pos.y, p.pos.z)
        .addScaledVector(flat, -back)
        .addScaledVector(right, 1.55);
      vCamDesired.y += 3 + Math.min(distance * 0.06, 2.2) + verticalGap * 0.16;

      vCamAnchor.set(p.pos.x, p.pos.y + 2.4, p.pos.z);
      const hit = firstBoxHitFraction(
        vCamAnchor.x, vCamAnchor.y, vCamAnchor.z,
        vCamDesired.x, vCamDesired.y, vCamDesired.z,
      );
      if (hit < 1) {
        const keep = Math.max(0.28, hit - 0.05);
        vCamDesired.sub(vCamAnchor).multiplyScalar(keep).add(vCamAnchor);
      }
      vCamDesired.x = clamp(vCamDesired.x, -PLAY_BOUND + 1.5, PLAY_BOUND - 1.5);
      vCamDesired.z = clamp(vCamDesired.z, -PLAY_BOUND + 1.5, PLAY_BOUND - 1.5);
      vCamDesired.y = Math.max(1.3, vCamDesired.y);

      vCamLook.set(
        THREE.MathUtils.lerp(p.pos.x, e.pos.x, 0.54),
        THREE.MathUtils.lerp(p.pos.y + 1.9, e.pos.y + 1.4, 0.48) + 0.15,
        THREE.MathUtils.lerp(p.pos.z, e.pos.z, 0.54),
      );
    } else if (match && match.ended) {
      const p = match.player;
      const e = match.enemy;
      vCamDesired.set((p.pos.x + e.pos.x) * 0.5, 10, (p.pos.z + e.pos.z) * 0.5);
      vCamDesired.x += 14;
      vCamDesired.z += 14;
      vCamLook.set((p.pos.x + e.pos.x) * 0.5, 2.5, (p.pos.z + e.pos.z) * 0.5);
    } else {
      orbitAngle += dt * 0.1;
      vCamDesired.set(Math.sin(orbitAngle) * 40, 19 + Math.sin(orbitAngle * 0.6) * 3, Math.cos(orbitAngle) * 40);
      vCamLook.set(0, 4, 0);
    }

    if (!cameraInitialized) {
      cameraInitialized = true;
      camPosition.copy(vCamDesired);
      camLookAt.copy(vCamLook);
    } else {
      camPosition.lerp(vCamDesired, 1 - Math.exp(-10 * dt));
      camLookAt.lerp(vCamLook, 1 - Math.exp(-12 * dt));
    }

    const shake = match ? match.shake : 0;
    if (match) match.shake = Math.max(0, match.shake - dt * 1.9);
    const jitter = shake * 0.5;
    camera.position.set(
      camPosition.x + (Math.random() - 0.5) * jitter,
      camPosition.y + (Math.random() - 0.5) * jitter,
      camPosition.z + (Math.random() - 0.5) * jitter,
    );
    vLook.copy(camLookAt);
    vLook.x += (Math.random() - 0.5) * jitter * 0.4;
    vLook.y += (Math.random() - 0.5) * jitter * 0.4;
    camera.lookAt(vLook);
  }

  const buildView = (m: Match | null): HudView => {
    if (!m) {
      return {
        timeLeft: MATCH_SECONDS,
        playerHp: selectedMech.stats.maxHp,
        playerHpMax: selectedMech.stats.maxHp,
        enemyHp: ENEMY_HP,
        boost: selectedMech.stats.boostMax,
        boostMax: selectedMech.stats.boostMax,
        overheated: false,
        ammo: AMMO_MAX,
        lock: 'locked',
        damageFlash: 0,
      };
    }
    const lock: LockView = m.lockValid ? 'locked' : m.lockInRange ? 'occluded' : 'range';
    return {
      timeLeft: m.timeLeft,
      playerHp: m.player.hp,
      playerHpMax: m.loadout.stats.maxHp,
      enemyHp: m.enemy.hp,
      boost: m.player.boost,
      boostMax: m.loadout.stats.boostMax,
      overheated: m.player.overheat > 0,
      ammo: m.player.ammo,
      lock,
      damageFlash: m.damageFlash,
    };
  };

  const updatePresentation = (dt: number): void => {
    const m = match;
    updateCamera(dt);
    if (m) {
      poseMatch(m, dt);
      updateReticle(m);
      updateEffects(m, dt);
    }
    hud.update(buildView(m));
  };

  // --- Hooks -------------------------------------------------------------
  context.scope.defer(context.session.scheduler.on('preRender', (step) => {
    updatePresentation(step.deltaSeconds);
  }));

  const onKeyDown = (event: KeyboardEvent): void => {
    audio.unlock();
    if (event.code === 'Space') event.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown, { passive: false });
  context.scope.defer(() => window.removeEventListener('keydown', onKeyDown));

  context.scope.defer(context.session.scheduler.on('update', () => {
    if ((phase === 'ready' || phase === 'over') && inputSession.frame.wasPressed('Enter')) {
      startMatch();
    }
  }));

  const surface = context.viewport.surface;
  const blockContextMenu = (event: Event): void => event.preventDefault();
  surface.addEventListener('contextmenu', blockContextMenu);
  context.scope.defer(() => surface.removeEventListener('contextmenu', blockContextMenu));

  resetSceneMechs();
}
