import * as THREE from 'three/webgpu';
import type { SceneFactory } from 'wanaka-studio-engine/scene';
import {
  ARENA_HALF_SIZE,
  ARENA_OBSTACLES,
  ENEMY_SPAWN,
  PLAYER_SPAWN,
  type ObstacleSpec,
} from '../arena.js';
import { DEFAULT_MECH, ENEMY_PALETTE } from '../mechs.js';
import { createMechRig } from './mech.js';

const WALL_HEIGHT = 2.8;
const WALL_THICKNESS = 1.4;
const CITY_GROUND = -4.6;
const PLATFORM_TOP = -0.98;
const PLATFORM_BOTTOM = CITY_GROUND + 0.04;

interface MassSpec {
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly baseY: number;
  readonly color: string;
  readonly litChance: number;
  readonly windows: boolean;
  readonly spacingX: number;
  readonly spacingY: number;
}

interface WindowInstance {
  readonly matrix: THREE.Matrix4;
  readonly color: THREE.Color;
}

interface BeaconPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface AntennaPlacement {
  readonly x: number;
  readonly z: number;
  readonly baseY: number;
  readonly height: number;
}

export const createScene = ((scope, renderer, { model3DLoader }) => {
  void renderer;
  void model3DLoader;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 420);
  camera.name = 'MainCamera';
  camera.position.set(46, 29, 54);
  camera.lookAt(0, 4, 0);
  scene.add(camera);

  const sun = new THREE.DirectionalLight();
  sun.name = 'Sun';
  // The Engine owns CSM for this bound key light. Configure shadow coverage in
  // game/rendering.ts via renderSettings.directionalShadow.
  sun.castShadow = true;
  scene.add(sun);

  const fill = new THREE.HemisphereLight('#829dd0', '#1a1d26', 0.7);
  fill.name = 'Fill';
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#ffb277', 0.35);
  rim.name = 'Rim';
  scene.add(rim);

  // --- Deterministic procedural helpers ----------------------------------
  let seed = 0x6d2b79f5;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const between = (min: number, max: number): number => min + rand() * (max - min);
  const pick = (colors: readonly string[]): string => {
    const index = Math.floor(rand() * colors.length);
    return colors[index] ?? '#7a808a';
  };

  const boxGeo = scope.own(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeo = scope.own(new THREE.CylinderGeometry(1, 1, 1, 10));
  const planeGeo = scope.own(new THREE.PlaneGeometry(1, 1));
  const ringGeo = scope.own(new THREE.TorusGeometry(9, 0.1, 8, 96));
  const discGeo = scope.own(new THREE.CircleGeometry(9.4, 64));
  const beaconGeo = scope.own(new THREE.SphereGeometry(0.28, 7, 5));
  const lampGeo = scope.own(new THREE.SphereGeometry(0.26, 6, 4));

  const concrete = scope.own(new THREE.MeshStandardMaterial({ color: '#767d88', roughness: 0.92, metalness: 0.04 }));
  const concreteDark = scope.own(new THREE.MeshStandardMaterial({ color: '#343b47', roughness: 0.9, metalness: 0.08 }));
  const concreteLight = scope.own(new THREE.MeshStandardMaterial({ color: '#969ca6', roughness: 0.86, metalness: 0.05 }));
  const glass = scope.own(new THREE.MeshStandardMaterial({ color: '#22334c', roughness: 0.2, metalness: 0.82 }));
  const glassLight = scope.own(new THREE.MeshStandardMaterial({ color: '#31496a', roughness: 0.16, metalness: 0.76 }));
  const metal = scope.own(new THREE.MeshStandardMaterial({ color: '#555d6b', roughness: 0.48, metalness: 0.72 }));
  const metalDark = scope.own(new THREE.MeshStandardMaterial({ color: '#232932', roughness: 0.55, metalness: 0.6 }));
  const floorMaterial = scope.own(new THREE.MeshStandardMaterial({ color: '#5c626c', roughness: 0.9, metalness: 0.08 }));
  const paintMaterial = scope.own(new THREE.MeshStandardMaterial({ color: '#cfc6b4', roughness: 0.8, metalness: 0.02 }));
  const accentMaterial = scope.own(new THREE.MeshStandardMaterial({
    color: '#ffb45e',
    emissive: '#ff8f2e',
    emissiveIntensity: 0.6,
    roughness: 0.5,
    metalness: 0.2,
  }));
  const hazardMaterial = scope.own(new THREE.MeshStandardMaterial({ color: '#c9903d', roughness: 0.72, metalness: 0.1 }));
  const roadMaterial = scope.own(new THREE.MeshStandardMaterial({ color: '#1a1d23', roughness: 0.96, metalness: 0.03 }));
  const cityMassMaterial = scope.own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0.14 }));
  const windowMaterial = scope.own(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const signMaterial = scope.own(new THREE.MeshBasicMaterial({ color: '#ffd59c', toneMapped: false }));
  const warmLightMaterial = scope.own(new THREE.MeshBasicMaterial({ color: '#ffd8a6', toneMapped: false }));
  const beaconMaterial = scope.own(new THREE.MeshBasicMaterial({ color: '#ff5644', toneMapped: false }));
  const streetLineMaterial = scope.own(new THREE.MeshBasicMaterial({ color: '#4a4237' }));
  const fenceMaterial = scope.own(new THREE.MeshBasicMaterial({
    color: '#6fc9ff',
    transparent: true,
    opacity: 0.035,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  }));
  const seamMaterial = scope.own(new THREE.MeshStandardMaterial({ color: '#3a3f48', roughness: 0.92, metalness: 0.05 }));

  const addBox = (
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    castShadow = true,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(boxGeo, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const addCylinder = (
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    axis: 'y' | 'z' = 'y',
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(cylinderGeo, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // --- Window instancing --------------------------------------------------
  const windows: WindowInstance[] = [];
  const windowDummy = new THREE.Object3D();
  const litWindowColors = ['#ffd9a6', '#ffc07a', '#fff0d2', '#bcdcff'];
  const darkWindowColors = ['#1c2637', '#243248', '#192434'];

  const addWindow = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    rotationY: number,
    lit: boolean,
  ): void => {
    windowDummy.position.set(x, y, z);
    windowDummy.rotation.set(0, rotationY, 0);
    windowDummy.scale.set(width, height, 1);
    windowDummy.updateMatrix();
    const color = new THREE.Color(lit ? pick(litWindowColors) : pick(darkWindowColors));
    windows.push({ matrix: windowDummy.matrix.clone(), color });
  };

  const addFaceWindows = (
    centerX: number,
    centerZ: number,
    rotationY: number,
    faceWidth: number,
    baseY: number,
    topY: number,
    litChance: number,
    spacingX: number,
    spacingY: number,
  ): void => {
    const usableWidth = faceWidth - 1.0;
    const usableHeight = topY - baseY;
    if (usableWidth < 1.4 || usableHeight < 1.2) return;
    const cols = Math.max(1, Math.floor(usableWidth / spacingX));
    const rows = Math.max(1, Math.floor(usableHeight / spacingY));
    const stepX = usableWidth / cols;
    const stepY = usableHeight / rows;
    const windowWidth = stepX * 0.55;
    const windowHeight = stepY * 0.44;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    for (let row = 0; row < rows; row += 1) {
      const rowLit = rand() < 0.18;
      for (let col = 0; col < cols; col += 1) {
        const offset = -usableWidth / 2 + stepX * 0.5 + col * stepX;
        const x = centerX + cos * offset;
        const z = centerZ - sin * offset;
        const y = baseY + stepY * 0.5 + row * stepY;
        const lit = rowLit ? rand() < 0.8 : rand() < litChance;
        addWindow(x, y, z, windowWidth, windowHeight, rotationY, lit);
      }
    }
  };

  const addBuildingWindows = (
    x: number,
    z: number,
    width: number,
    depth: number,
    baseY: number,
    topY: number,
    litChance: number,
    spacingX: number,
    spacingY: number,
  ): void => {
    addFaceWindows(x, z + depth / 2 + 0.05, 0, width - 0.4, baseY, topY, litChance, spacingX, spacingY);
    addFaceWindows(x, z - depth / 2 - 0.05, Math.PI, width - 0.4, baseY, topY, litChance, spacingX, spacingY);
    addFaceWindows(x + width / 2 + 0.05, z, Math.PI / 2, depth - 0.4, baseY, topY, litChance, spacingX, spacingY);
    addFaceWindows(x - width / 2 - 0.05, z, -Math.PI / 2, depth - 0.4, baseY, topY, litChance, spacingX, spacingY);
  };

  // --- City ground and arena platform ------------------------------------
  const cityGround = new THREE.Mesh(boxGeo, roadMaterial);
  cityGround.name = 'CityGround';
  cityGround.position.y = CITY_GROUND - 0.5;
  cityGround.scale.set(520, 1, 520);
  cityGround.receiveShadow = true;
  scene.add(cityGround);

  const arena = new THREE.Group();
  arena.name = 'Arena';
  scene.add(arena);

  const platformHeight = PLATFORM_TOP - PLATFORM_BOTTOM;
  const platform = addBox(
    arena,
    concreteDark,
    0,
    PLATFORM_TOP - platformHeight / 2,
    0,
    61.2,
    platformHeight,
    61.2,
  );
  platform.name = 'ArenaPlatform';
  platform.receiveShadow = true;

  for (let i = 0; i < 8; i += 1) {
    const offset = -28 + i * 8;
    addBox(arena, concrete, 30.45, PLATFORM_TOP - 1.8, offset, 0.5, 3.4, 0.7, false);
    addBox(arena, concrete, -30.45, PLATFORM_TOP - 1.8, offset, 0.5, 3.4, 0.7, false);
    addBox(arena, concrete, offset, PLATFORM_TOP - 1.8, 30.45, 0.7, 3.4, 0.5, false);
    addBox(arena, concrete, offset, PLATFORM_TOP - 1.8, -30.45, 0.7, 3.4, 0.5, false);
  }
  addBox(arena, metal, 0, PLATFORM_TOP - 0.12, 30.3, 61.2, 0.18, 0.3, false);
  addBox(arena, metal, 0, PLATFORM_TOP - 0.12, -30.3, 61.2, 0.18, 0.3, false);
  addBox(arena, metal, 30.3, PLATFORM_TOP - 0.12, 0, 0.3, 0.18, 61.2, false);
  addBox(arena, metal, -30.3, PLATFORM_TOP - 0.12, 0, 0.3, 0.18, 61.2, false);
  for (const side of [-1, 1]) {
    addBox(arena, warmLightMaterial, side * 30.52, PLATFORM_TOP - 3.9, 0, 0.04, 0.12, 52, false);
    addBox(arena, warmLightMaterial, 0, PLATFORM_TOP - 3.9, side * 30.52, 52, 0.12, 0.04, false);
  }

  // --- Floor -------------------------------------------------------------
  const floor = new THREE.Mesh(
    scope.own(new THREE.BoxGeometry(ARENA_HALF_SIZE * 2, 1, ARENA_HALF_SIZE * 2)),
    floorMaterial,
  );
  floor.name = 'ArenaFloor';
  floor.position.y = -0.5;
  floor.receiveShadow = true;
  scene.add(floor);

  const floorDetails = new THREE.Group();
  floorDetails.name = 'ArenaFloorDetails';
  scene.add(floorDetails);

  const metalDisc = new THREE.Mesh(discGeo, metalDark);
  metalDisc.name = 'CenterPlate';
  metalDisc.rotation.x = -Math.PI / 2;
  metalDisc.position.y = 0.012;
  metalDisc.receiveShadow = true;
  floorDetails.add(metalDisc);

  const ring = new THREE.Mesh(ringGeo, accentMaterial);
  ring.name = 'ArenaRing';
  ring.position.y = 0.035;
  ring.rotation.x = -Math.PI / 2;
  floorDetails.add(ring);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const tick = addBox(floorDetails, paintMaterial, Math.cos(angle) * 11.6, 0.02, Math.sin(angle) * 11.6, 0.18, 0.016, 1.8, false);
    tick.rotation.y = -angle;
  }

  for (let i = -3; i <= 3; i += 1) {
    const offset = i * 7.5;
    addBox(floorDetails, seamMaterial, offset, 0.008, 0, 0.08, 0.012, 58, false);
    addBox(floorDetails, seamMaterial, 0, 0.008, offset, 58, 0.012, 0.08, false);
  }
  addBox(floorDetails, paintMaterial, 0, 0.014, 25.6, 50, 0.012, 0.22, false);
  addBox(floorDetails, paintMaterial, 0, 0.014, -25.6, 50, 0.012, 0.22, false);
  addBox(floorDetails, paintMaterial, 25.6, 0.014, 0, 0.22, 0.012, 50, false);
  addBox(floorDetails, paintMaterial, -25.6, 0.014, 0, 0.22, 0.012, 50, false);

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBox(floorDetails, metal, sx * 13, 0.03, sz * 13, 2.6, 0.06, 2.0, false);
      addBox(floorDetails, accentMaterial, sx * 13, 0.065, sz * 13, 2.0, 0.02, 0.08, false);
    }
  }

  // --- Perimeter walls and gantries --------------------------------------
  const wallOffset = ARENA_HALF_SIZE + WALL_THICKNESS / 2;
  const wallLength = ARENA_HALF_SIZE * 2 + WALL_THICKNESS;
  for (const side of [-1, 1]) {
    addBox(arena, concreteDark, side * wallOffset, WALL_HEIGHT / 2 + 0.02, 0, WALL_THICKNESS, WALL_HEIGHT, wallLength);
    addBox(arena, concreteDark, 0, WALL_HEIGHT / 2 + 0.025, side * wallOffset, wallLength, WALL_HEIGHT, WALL_THICKNESS);
    addBox(arena, concrete, side * (wallOffset - 0.02), WALL_HEIGHT - 0.13, 0, WALL_THICKNESS + 0.22, 0.34, wallLength - 0.08);
    addBox(arena, concrete, 0, WALL_HEIGHT - 0.125, side * (wallOffset - 0.02), wallLength - 0.08, 0.34, WALL_THICKNESS + 0.22);
    addBox(arena, metal, side * (wallOffset - 0.72), WALL_HEIGHT + 0.4, 0, 0.12, 0.16, wallLength, false);
    addBox(arena, metal, 0, WALL_HEIGHT + 0.4, side * (wallOffset - 0.72), wallLength, 0.16, 0.12, false);

    const fence = new THREE.Mesh(planeGeo, fenceMaterial);
    fence.scale.set(ARENA_HALF_SIZE * 2 - 2, 10, 1);
    fence.position.set(side * (ARENA_HALF_SIZE + 0.35), 8.1, 0);
    fence.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    arena.add(fence);
    const fenceOther = new THREE.Mesh(planeGeo, fenceMaterial);
    fenceOther.scale.set(ARENA_HALF_SIZE * 2 - 2, 10, 1);
    fenceOther.position.set(0, 8.1, side * (ARENA_HALF_SIZE + 0.35));
    fenceOther.rotation.y = side > 0 ? Math.PI : 0;
    arena.add(fenceOther);

    for (let i = -3; i <= 3; i += 1) {
      const offset = i * 8;
      addBox(arena, concreteLight, side * (wallOffset - 0.75), WALL_HEIGHT / 2, offset, 0.3, WALL_HEIGHT - 0.2, 0.36);
      addBox(arena, concreteLight, offset, WALL_HEIGHT / 2, side * (wallOffset - 0.75), 0.36, WALL_HEIGHT - 0.2, 0.3);
      addBox(arena, warmLightMaterial, side * (wallOffset - 0.62), WALL_HEIGHT + 0.12, offset, 0.06, 0.1, 0.24, false);
      addBox(arena, warmLightMaterial, offset, WALL_HEIGHT + 0.12, side * (wallOffset - 0.62), 0.24, 0.1, 0.06, false);
    }
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const baseX = sx * (ARENA_HALF_SIZE - 1.1);
      const baseZ = sz * (ARENA_HALF_SIZE - 1.1);
      addBox(arena, concreteDark, baseX, 2.41, baseZ, 2.0, 4.78, 2.0);
      addCylinder(arena, metal, baseX, 7.4, baseZ, 0.3, 7.6);
      addBox(arena, metalDark, baseX, 11.4, baseZ, 1.8, 0.5, 1.8, false);
      addBox(arena, warmLightMaterial, baseX, 11.1, baseZ, 1.5, 0.08, 1.5, false);
      addBox(arena, warmLightMaterial, baseX, 11.7, baseZ, 0.7, 0.06, 0.7, false);
    }
  }

  // --- Obstacles as detailed city structures -----------------------------
  const beacons: BeaconPlacement[] = [];
  const antennae: AntennaPlacement[] = [];

  const buildObstacle = (spec: ObstacleSpec): void => {
    const group = new THREE.Group();
    group.name = `Obstacle-${spec.id}`;
    group.position.set(spec.x, 0, spec.z);
    arena.add(group);

    const width = spec.width;
    const depth = spec.depth;
    const height = spec.height;
    const isTower = spec.kind === 'tower';
    const isBlock = spec.kind === 'block';
    const isCover = spec.kind === 'cover';
    const isCrate = spec.kind === 'crate';

    const bodyMaterial = isTower ? glass : isBlock ? concrete : isCover ? concreteDark : metalDark;
    addBox(group, bodyMaterial, 0, height / 2, 0, width, height, depth);
    addBox(group, concreteDark, 0, 0.24, 0, width + 0.46, 0.48, depth + 0.46);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addBox(group, metalDark, sx * (width / 2 - 0.08), height / 2, sz * (depth / 2 - 0.08), 0.24, height + 0.08, 0.24);
      }
    }

    if (height >= 5) {
      for (let band = 3.0; band < height - 0.8; band += 3.0) {
        addBox(group, concreteDark, 0, band, 0, width + 0.2, 0.14, depth + 0.2);
      }
    }

    if (!isCover && !isCrate) {
      const litChance = isTower ? 0.46 : 0.32;
      addBuildingWindows(
        spec.x,
        spec.z,
        width,
        depth,
        3.0,
        height - 0.9,
        litChance,
        1.8,
        2.2,
      );
    }

    if (!isCover && !isCrate) {
      const capY = height + 0.18;
      addBox(group, concreteDark, 0, capY, depth / 2 - 0.1, width + 0.2, 0.32, 0.2);
      addBox(group, concreteDark, 0, capY, -depth / 2 + 0.1, width + 0.2, 0.32, 0.2);
      addBox(group, concreteDark, width / 2 - 0.1, capY, 0, 0.2, 0.32, depth - 0.2);
      addBox(group, concreteDark, -width / 2 + 0.1, capY, 0, 0.2, 0.32, depth - 0.2);

      addBox(group, metalDark, width * 0.28, height + 0.45, -depth * 0.24, Math.min(2.0, width * 0.3), 0.56, Math.min(1.5, depth * 0.3));
      addBox(group, metal, -width * 0.22, height + 0.4, depth * 0.2, Math.min(1.6, width * 0.24), 0.46, Math.min(1.3, depth * 0.24));
      if (isTower) {
        addCylinder(group, metalDark, width * 0.32, height + 2.0, -depth * 0.3, 0.07, 3.0);
        beacons.push({ x: spec.x + width * 0.32, y: height + 3.55, z: spec.z - depth * 0.3 });
      }

      addBox(group, metalDark, 0, 1.2, depth / 2 + 0.03, Math.min(2.0, width * 0.4), 2.4, 0.1);
      addBox(group, glassLight, 0, 1.6, depth / 2 + 0.09, Math.min(1.6, width * 0.32), 1.5, 0.04);
      addBox(group, metalDark, 0, 2.7, depth / 2 + 0.48, Math.min(2.9, width * 0.52), 0.16, 1.2);
      addBox(group, warmLightMaterial, 0, 2.6, depth / 2 + 0.48, Math.min(2.5, width * 0.46), 0.04, 0.96, false);
      addBox(group, concreteLight, 0, 0.1, depth / 2 + 0.42, Math.min(2.8, width * 0.5), 0.2, 0.8);
    }

    if (isTower) {
      addBox(group, metalDark, -width / 2 - 0.07, height * 0.62, 0, 0.1, height * 0.36, 0.75);
      addBox(group, signMaterial, -width / 2 - 0.13, height * 0.62, 0, 0.04, height * 0.3, 0.55, false);
    } else if (isBlock) {
      addBox(group, metalDark, 0, height + 1.5, -depth * 0.28, width * 0.68, 1.7, 0.18);
      addBox(group, signMaterial, 0, height + 1.5, -depth * 0.28 + 0.11, width * 0.58, 1.3, 0.04, false);
      addBox(group, metalDark, -width * 0.24, height + 0.85, -depth * 0.28, 0.1, 1.7, 0.1);
      addBox(group, metalDark, width * 0.24, height + 0.85, -depth * 0.28, 0.1, 1.7, 0.1);
      if (height > 7) beacons.push({ x: spec.x, y: height + 2.55, z: spec.z - depth * 0.28 });
    } else if (isCover) {
      addBox(group, metal, 0, height + 0.06, 0, width + 0.16, 0.12, depth + 0.16);
      for (let i = 0; i < 6; i += 1) {
        addBox(group, metalDark, 0, 0.8 + i * 0.2, depth / 2 + 0.03, width * 0.8, 0.07, 0.05);
      }
      addBox(group, hazardMaterial, 0, height + 0.13, depth / 2 + 0.02, width * 0.9, 0.14, 0.06);
      addBox(group, warmLightMaterial, -width * 0.35, 1.0, depth / 2 + 0.06, 0.22, 0.6, 0.04, false);
    } else if (isCrate) {
      addBox(group, metal, 0, height * 0.58, 0, width + 0.06, 0.2, depth + 0.06);
      addBox(group, hazardMaterial, 0, height * 0.58, depth / 2 + 0.04, width * 0.6, 0.18, 0.04);
      for (let i = 0; i < 4; i += 1) {
        addBox(group, metalDark, 0, 0.55 + i * 0.38, depth / 2 + 0.03, width * 0.68, 0.1, 0.04);
      }
      if (spec.id === 'crate-b') {
        addCylinder(group, metalDark, 0, height + 1.2, 0, 0.06, 2.2);
        beacons.push({ x: spec.x, y: height + 2.35, z: spec.z });
      }
    }
  };

  for (const spec of ARENA_OBSTACLES) buildObstacle(spec);

  // --- City skyline -------------------------------------------------------
  const masses: MassSpec[] = [];
  const nearColors = ['#6f7681', '#7d838d', '#5b6471', '#89909a', '#646d7b'];
  const mainColors = ['#59616e', '#6a7381', '#7d8592', '#4c5563', '#3a4658'];
  const glassColors = ['#2e4260', '#25354c', '#3a506c', '#2b3d55'];
  const darkColors = ['#1a202b', '#232a36', '#151a23'];

  const addMass = (spec: MassSpec): void => {
    masses.push(spec);
    if (!spec.windows) return;
    addBuildingWindows(
      spec.x,
      spec.z,
      spec.width,
      spec.depth,
      spec.baseY + 1.2,
      spec.baseY + spec.height - 0.8,
      spec.litChance,
      spec.spacingX,
      spec.spacingY,
    );
  };

  const base = CITY_GROUND + 0.02;

  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2 + between(-0.07, 0.07);
    const radius = between(40, 56);
    const width = between(7, 13);
    const depth = between(7, 13);
    const height = between(8, 22);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    addMass({
      x, z, width, depth, height, baseY: base,
      color: pick(nearColors), litChance: 0.42, windows: true,
      spacingX: 2.0, spacingY: 2.3,
    });
    if (height > 15 && rand() < 0.5) {
      const extra = height * 0.24;
      addMass({
        x, z, width: width * 0.66, depth: depth * 0.66, height: extra, baseY: base + height + 0.02,
        color: pick(nearColors), litChance: 0.3, windows: true,
        spacingX: 2.0, spacingY: 2.3,
      });
      beacons.push({ x, y: base + height + extra + 0.52, z });
    }
  }

  for (let i = 0; i < 34; i += 1) {
    const angle = (i / 34) * Math.PI * 2 + between(-0.05, 0.05);
    const radius = between(68, 140);
    const width = between(9, 22);
    const depth = between(9, 22);
    const height = between(20, 78);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const color = pick(mainColors);
    addMass({
      x, z, width, depth, height, baseY: base,
      color, litChance: 0.3, windows: true,
      spacingX: 3.4, spacingY: 3.6,
    });
    if (height > 44 && rand() < 0.6) {
      const extra = between(6, height * 0.3);
      const topWidth = width * 0.62;
      const topDepth = depth * 0.62;
      addMass({
        x, z, width: topWidth, depth: topDepth, height: extra, baseY: base + height + 0.02,
        color, litChance: 0.32, windows: true,
        spacingX: 3.0, spacingY: 3.2,
      });
      beacons.push({ x, y: base + height + extra + 0.47, z });
    } else if (height > 58) {
      beacons.push({ x, y: base + height + 0.45, z });
    }
  }

  const landmarkAngles = [0.35, 1.7, 2.95, 4.2, 5.45];
  for (const angle of landmarkAngles) {
    const radius = between(72, 108);
    const width = between(14, 20);
    const depth = between(14, 20);
    const height = between(82, 126);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const color = pick(glassColors);
    let top = base + height;
    addMass({
      x, z, width, depth, height, baseY: base,
      color, litChance: 0.36, windows: true,
      spacingX: 2.8, spacingY: 3.2,
    });
    let levelWidth = width;
    let levelDepth = depth;
    for (const shrink of [0.72, 0.5]) {
      const extra = height * (shrink === 0.72 ? 0.2 : 0.14);
      levelWidth *= shrink;
      levelDepth *= shrink;
      addMass({
        x, z, width: levelWidth, depth: levelDepth, height: extra, baseY: top + 0.02,
        color, litChance: 0.4, windows: true,
        spacingX: 2.6, spacingY: 3.0,
      });
      top += extra + 0.02;
    }
    antennae.push({ x, z, baseY: top, height: between(4, 9) });
  }

  for (let i = 0; i < 30; i += 1) {
    const angle = (i / 30) * Math.PI * 2 + between(-0.04, 0.04);
    const radius = between(165, 250);
    const width = between(12, 28);
    const depth = between(12, 28);
    const height = between(30, 115);
    addMass({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      width, depth, height, baseY: base,
      color: pick(darkColors), litChance: 0, windows: false,
      spacingX: 5, spacingY: 5,
    });
  }

  const cityDummy = new THREE.Object3D();
  const cityBuildings = new THREE.InstancedMesh(boxGeo, cityMassMaterial, masses.length);
  cityBuildings.name = 'CityBuildings';
  cityBuildings.castShadow = false;
  cityBuildings.receiveShadow = false;
  masses.forEach((spec, index) => {
    cityDummy.position.set(spec.x, spec.baseY + spec.height / 2, spec.z);
    cityDummy.rotation.set(0, 0, 0);
    cityDummy.scale.set(spec.width, spec.height, spec.depth);
    cityDummy.updateMatrix();
    cityBuildings.setMatrixAt(index, cityDummy.matrix);
    cityBuildings.setColorAt(index, new THREE.Color(spec.color));
  });
  cityBuildings.instanceMatrix.needsUpdate = true;
  if (cityBuildings.instanceColor) cityBuildings.instanceColor.needsUpdate = true;
  scene.add(cityBuildings);

  const windowMesh = new THREE.InstancedMesh(planeGeo, windowMaterial, windows.length);
  windowMesh.name = 'CityWindows';
  windowMesh.castShadow = false;
  windowMesh.receiveShadow = false;
  windows.forEach((instance, index) => {
    windowMesh.setMatrixAt(index, instance.matrix);
    windowMesh.setColorAt(index, instance.color);
  });
  windowMesh.instanceMatrix.needsUpdate = true;
  if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
  scene.add(windowMesh);

  for (const antenna of antennae) {
    const mast = new THREE.Mesh(cylinderGeo, metalDark);
    mast.name = `LandmarkMast-${antennae.indexOf(antenna)}`;
    mast.position.set(antenna.x, antenna.baseY + antenna.height / 2, antenna.z);
    mast.scale.set(0.12, antenna.height, 0.12);
    mast.castShadow = false;
    scene.add(mast);
    beacons.push({ x: antenna.x, y: antenna.baseY + antenna.height + 0.2, z: antenna.z });
  }

  const beaconDummy = new THREE.Object3D();
  const beaconMesh = new THREE.InstancedMesh(beaconGeo, beaconMaterial, beacons.length);
  beaconMesh.name = 'CityBeacons';
  beacons.forEach((beacon, index) => {
    beaconDummy.position.set(beacon.x, beacon.y, beacon.z);
    beaconDummy.scale.setScalar(1);
    beaconDummy.updateMatrix();
    beaconMesh.setMatrixAt(index, beaconDummy.matrix);
  });
  beaconMesh.instanceMatrix.needsUpdate = true;
  scene.add(beaconMesh);

  const streetGeo = scope.own(new THREE.BoxGeometry(1, 0.02, 1));
  const streets = new THREE.InstancedMesh(streetGeo, streetLineMaterial, 16);
  streets.name = 'CityStreets';
  const streetDummy = new THREE.Object3D();
  for (let i = 0; i < 8; i += 1) {
    const offset = -210 + i * 60;
    streetDummy.position.set(offset, CITY_GROUND + 0.04, 0);
    streetDummy.scale.set(1.8, 1, 430);
    streetDummy.updateMatrix();
    streets.setMatrixAt(i, streetDummy.matrix);
    streetDummy.position.set(0, CITY_GROUND + 0.04, offset);
    streetDummy.scale.set(430, 1, 1.8);
    streetDummy.updateMatrix();
    streets.setMatrixAt(8 + i, streetDummy.matrix);
  }
  streets.instanceMatrix.needsUpdate = true;
  scene.add(streets);

  const lamps: BeaconPlacement[] = [];
  for (let i = 0; i < 26; i += 1) {
    const angle = (i / 26) * Math.PI * 2;
    const radius = between(33.5, 39);
    lamps.push({ x: Math.cos(angle) * radius, y: CITY_GROUND + 0.4, z: Math.sin(angle) * radius });
  }
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2 + 0.2;
    const radius = between(58, 74);
    lamps.push({ x: Math.cos(angle) * radius, y: CITY_GROUND + 0.4, z: Math.sin(angle) * radius });
  }
  const lampMesh = new THREE.InstancedMesh(lampGeo, warmLightMaterial, lamps.length);
  lampMesh.name = 'CityLamps';
  const lampDummy = new THREE.Object3D();
  lamps.forEach((lamp, index) => {
    lampDummy.position.set(lamp.x, lamp.y, lamp.z);
    lampDummy.updateMatrix();
    lampMesh.setMatrixAt(index, lampDummy.matrix);
  });
  lampMesh.instanceMatrix.needsUpdate = true;
  scene.add(lampMesh);

  // --- Mechs -------------------------------------------------------------
  const playerRig = createMechRig('PlayerMech', DEFAULT_MECH.palette, scope);
  playerRig.root.position.set(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z);
  playerRig.root.rotation.y = Math.atan2(ENEMY_SPAWN.x - PLAYER_SPAWN.x, ENEMY_SPAWN.z - PLAYER_SPAWN.z);
  scene.add(playerRig.root);

  const enemyRig = createMechRig('EnemyMech', ENEMY_PALETTE, scope);
  enemyRig.root.position.set(ENEMY_SPAWN.x, 0, ENEMY_SPAWN.z);
  enemyRig.root.rotation.y = Math.atan2(PLAYER_SPAWN.x - ENEMY_SPAWN.x, PLAYER_SPAWN.z - ENEMY_SPAWN.z);
  scene.add(enemyRig.root);

  return {
    scene,
    nodes: {
      camera,
      sun,
      fill,
      floor,
      arena,
      playerMech: playerRig.root,
      enemyMech: enemyRig.root,
    },
    resources: {},
    visual: {
      lights: { key: sun, fill, rim },
      materials: {
        ground: [floorMaterial],
        accent: [accentMaterial],
      },
    },
  };
}) satisfies SceneFactory;

export type MainScene = Awaited<ReturnType<typeof createScene>>;
