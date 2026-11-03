import * as THREE from 'three/webgpu';
import type { LifetimeScope } from 'wanaka-studio-engine';
import type { MechPalette } from '../mechs.js';

export interface MechRig {
  readonly root: THREE.Group;
  readonly hips: THREE.Group;
  readonly torso: THREE.Group;
  readonly head: THREE.Group;
  readonly armL: THREE.Group;
  readonly armR: THREE.Group;
  readonly elbowL: THREE.Group;
  readonly elbowR: THREE.Group;
  readonly legL: THREE.Group;
  readonly legR: THREE.Group;
  readonly kneeL: THREE.Group;
  readonly kneeR: THREE.Group;
  readonly rifle: THREE.Group;
  readonly muzzle: THREE.Object3D;
  readonly saber: THREE.Group;
  readonly thrusters: readonly THREE.Mesh[];
  readonly visorMaterial: THREE.MeshStandardMaterial;
  readonly thrusterMaterial: THREE.MeshBasicMaterial;
  readonly saberGlowMaterial: THREE.MeshBasicMaterial;
  readonly hullMaterials: readonly THREE.MeshStandardMaterial[];
}

const rigs = new WeakMap<THREE.Object3D, MechRig>();

/**
 * Builds one poseable prototype mech out of scaled unit boxes and a handful
 * of shared primitives. Every mesh and material is owned by the scene scope.
 */
export function createMechRig(
  name: string,
  palette: MechPalette,
  scope: LifetimeScope,
): MechRig {
  const boxGeo = scope.own(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeo = scope.own(new THREE.CylinderGeometry(1, 1, 1, 8));
  const coneGeo = scope.own(new THREE.ConeGeometry(1, 1, 8, 1, true));

  const primary = scope.own(new THREE.MeshStandardMaterial({ color: palette.primary, roughness: 0.48, metalness: 0.22 }));
  const secondary = scope.own(new THREE.MeshStandardMaterial({ color: palette.secondary, roughness: 0.52, metalness: 0.3 }));
  const dark = scope.own(new THREE.MeshStandardMaterial({ color: palette.dark, roughness: 0.62, metalness: 0.42 }));
  const accent = scope.own(new THREE.MeshStandardMaterial({
    color: palette.accent,
    roughness: 0.4,
    metalness: 0.3,
    emissive: palette.accent,
    emissiveIntensity: 0.22,
  }));
  const visorMaterial = scope.own(new THREE.MeshStandardMaterial({
    color: '#0a1018',
    roughness: 0.2,
    metalness: 0.4,
    emissive: palette.visor,
    emissiveIntensity: 3.2,
  }));
  const thrusterMaterial = scope.own(new THREE.MeshBasicMaterial({
    color: palette.thruster,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }));
  const bladeMaterial = scope.own(new THREE.MeshBasicMaterial({ color: '#d9fbff', toneMapped: false }));
  const bladeGlowMaterial = scope.own(new THREE.MeshBasicMaterial({
    color: palette.visor,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }));

  const root = new THREE.Group();
  root.name = name;

  const hips = new THREE.Group();
  hips.name = `${name}:hips`;
  hips.position.set(0, 1.72, 0);
  root.add(hips);

  const addBox = (
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(boxGeo, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
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
    axis: 'y' | 'z',
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(cylinderGeo, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Pelvis
  addBox(hips, secondary, 0, 0, 0, 0.96, 0.4, 0.62);
  addBox(hips, dark, 0, -0.2, 0.06, 0.56, 0.24, 0.5);
  addBox(hips, accent, 0, 0.1, 0.32, 0.24, 0.16, 0.06);

  // Torso
  const torso = new THREE.Group();
  torso.name = `${name}:torso`;
  torso.position.set(0, 0.2, 0);
  hips.add(torso);

  addBox(torso, dark, 0, 0.12, 0, 0.62, 0.3, 0.5);
  addBox(torso, primary, 0, 0.56, 0, 1.18, 0.78, 0.7);
  addBox(torso, secondary, -0.66, 0.56, 0, 0.2, 0.52, 0.6);
  addBox(torso, secondary, 0.66, 0.56, 0, 0.2, 0.52, 0.6);
  addBox(torso, dark, 0, 0.94, 0, 0.9, 0.18, 0.54);
  for (let i = 0; i < 3; i += 1) {
    addBox(torso, accent, 0.18 + i * 0.16, 0.56, 0.356, 0.07, 0.26, 0.012);
  }
  addBox(torso, secondary, 0, 0.48, -0.36, 0.86, 0.5, 0.16);

  // Head
  const head = new THREE.Group();
  head.name = `${name}:head`;
  head.position.set(0, 1.06, 0.03);
  torso.add(head);
  addBox(head, dark, 0, -0.04, 0, 0.24, 0.18, 0.24);
  addBox(head, primary, 0, 0.16, 0, 0.5, 0.4, 0.46);
  addBox(head, dark, 0, 0.05, 0.22, 0.26, 0.09, 0.04);
  const visor = addBox(head, visorMaterial, 0, 0.19, 0.236, 0.34, 0.1, 0.02);
  visor.castShadow = false;
  const finL = addBox(head, accent, -0.13, 0.35, 0.14, 0.05, 0.3, 0.05);
  finL.rotation.z = 0.62;
  const finR = addBox(head, accent, 0.13, 0.35, 0.14, 0.05, 0.3, 0.05);
  finR.rotation.z = -0.62;
  addBox(head, secondary, 0, 0.34, -0.18, 0.16, 0.14, 0.18);

  // Shoulder pads stay on the torso so the arms can swing beneath them.
  addBox(torso, secondary, 0.86, 0.72, 0, 0.42, 0.5, 0.72);
  addBox(torso, secondary, -0.86, 0.72, 0, 0.42, 0.5, 0.72);
  addBox(torso, accent, 0.86, 0.9, 0.16, 0.2, 0.1, 0.22);
  addBox(torso, accent, -0.86, 0.9, 0.16, 0.2, 0.1, 0.22);

  // Backpack and thrusters
  addBox(torso, dark, 0, 0.56, -0.48, 0.82, 0.66, 0.36);
  addBox(torso, accent, 0, 0.86, -0.48, 0.5, 0.08, 0.3);
  const thrusters: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    addCylinder(torso, secondary, side * 0.27, 0.34, -0.7, 0.13, 0.3, 'z');
    const flame = new THREE.Mesh(coneGeo, thrusterMaterial);
    flame.position.set(side * 0.27, 0.34, -1.02);
    flame.rotation.x = -Math.PI / 2;
    flame.scale.set(0.18, 0.7, 0.18);
    flame.visible = false;
    torso.add(flame);
    thrusters.push(flame);
  }

  const buildArm = (side: number): { arm: THREE.Group; elbow: THREE.Group } => {
    const arm = new THREE.Group();
    arm.name = `${name}:arm-${side > 0 ? 'l' : 'r'}`;
    arm.position.set(side * 0.84, 0.68, 0);
    arm.rotation.z = side * 0.08;
    torso.add(arm);
    addBox(arm, secondary, side * 0.02, -0.3, 0, 0.26, 0.6, 0.3);
    addBox(arm, primary, side * 0.02, -0.58, 0, 0.3, 0.16, 0.34);
    const elbow = new THREE.Group();
    elbow.name = `${name}:elbow-${side > 0 ? 'l' : 'r'}`;
    elbow.position.set(side * 0.02, -0.64, 0);
    arm.add(elbow);
    addBox(elbow, primary, 0, -0.28, 0, 0.3, 0.56, 0.34);
    addBox(elbow, dark, 0, -0.6, 0.02, 0.22, 0.2, 0.26);
    return { arm, elbow };
  };

  const left = buildArm(1);
  const right = buildArm(-1);
  const armL = left.arm;
  const armR = right.arm;
  const elbowL = left.elbow;
  const elbowR = right.elbow;

  // Right-hand beam rifle: the pivot counter-rotates so the barrel stays level.
  const rifle = new THREE.Group();
  rifle.name = `${name}:rifle`;
  rifle.position.set(0, -0.62, 0.08);
  elbowR.add(rifle);
  addBox(rifle, dark, 0, 0, 0.3, 0.16, 0.2, 0.92);
  addBox(rifle, secondary, 0, 0.12, 0.12, 0.18, 0.1, 0.5);
  addCylinder(rifle, dark, 0, 0, 0.92, 0.055, 0.66, 'z');
  addBox(rifle, accent, 0, 0.15, 0.34, 0.1, 0.06, 0.24);
  addBox(rifle, secondary, 0, -0.05, -0.26, 0.13, 0.26, 0.3);
  const muzzle = new THREE.Object3D();
  muzzle.name = `${name}:muzzle`;
  muzzle.position.set(0, 0, 1.28);
  rifle.add(muzzle);
  rifle.rotation.x = 0.5;

  // Beam saber, hidden until a melee swing starts.
  const saber = new THREE.Group();
  saber.name = `${name}:saber`;
  saber.position.set(0, -0.62, 0.08);
  saber.visible = false;
  elbowR.add(saber);
  addCylinder(saber, secondary, 0, 0, 0.04, 0.055, 0.3, 'z');
  const blade = new THREE.Mesh(boxGeo, bladeMaterial);
  blade.position.set(0, 0, 0.92);
  blade.scale.set(0.05, 0.05, 1.5);
  saber.add(blade);
  const bladeGlow = new THREE.Mesh(boxGeo, bladeGlowMaterial);
  bladeGlow.position.set(0, 0, 0.92);
  bladeGlow.scale.set(0.18, 0.18, 1.58);
  saber.add(bladeGlow);
  saber.rotation.x = 0.5;

  const buildLeg = (side: number): { leg: THREE.Group; knee: THREE.Group } => {
    const leg = new THREE.Group();
    leg.name = `${name}:leg-${side > 0 ? 'l' : 'r'}`;
    leg.position.set(side * 0.34, -0.14, 0);
    hips.add(leg);
    addBox(leg, secondary, 0, -0.36, 0, 0.42, 0.72, 0.44);
    addBox(leg, accent, side * 0.16, -0.24, 0.16, 0.12, 0.2, 0.1);
    const knee = new THREE.Group();
    knee.name = `${name}:knee-${side > 0 ? 'l' : 'r'}`;
    knee.position.set(0, -0.72, 0);
    leg.add(knee);
    addBox(knee, dark, 0, -0.02, 0.1, 0.3, 0.2, 0.34);
    addBox(knee, primary, 0, -0.36, 0, 0.38, 0.7, 0.42);
    addBox(knee, accent, 0, -0.2, 0.22, 0.16, 0.1, 0.03);
    addBox(knee, dark, 0, -0.72, 0.16, 0.42, 0.24, 0.72);
    return { leg, knee };
  };

  const legLeft = buildLeg(1);
  const legRight = buildLeg(-1);

  armL.rotation.x = -0.16;
  armR.rotation.x = -0.5;

  const rig: MechRig = {
    root,
    hips,
    torso,
    head,
    armL,
    armR,
    elbowL,
    elbowR,
    legL: legLeft.leg,
    legR: legRight.leg,
    kneeL: legLeft.knee,
    kneeR: legRight.knee,
    rifle,
    muzzle,
    saber,
    thrusters,
    visorMaterial,
    thrusterMaterial,
    saberGlowMaterial: bladeGlowMaterial,
    hullMaterials: [primary, secondary, dark, accent],
  };
  rigs.set(root, rig);
  return rig;
}

/** Recolours an existing rig in place, keeping all shared geometry. */
export function applyMechPalette(rig: MechRig, palette: MechPalette): void {
  const [primary, secondary, dark, accent] = rig.hullMaterials;
  if (primary) primary.color.set(palette.primary);
  if (secondary) secondary.color.set(palette.secondary);
  if (dark) dark.color.set(palette.dark);
  if (accent) {
    accent.color.set(palette.accent);
    accent.emissive.set(palette.accent);
    accent.emissiveIntensity = 0.22;
  }
  rig.visorMaterial.color.set('#0a1018');
  rig.visorMaterial.emissive.set(palette.visor);
  rig.thrusterMaterial.color.set(palette.thruster);
  rig.saberGlowMaterial.color.set(palette.visor);
}

export function findMechRig(root: THREE.Object3D): MechRig | null {
  return rigs.get(root) ?? null;
}
