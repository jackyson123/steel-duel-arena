/** Pure mech catalogue shared by the scene, gameplay, and interface. */

export interface MechPalette {
  readonly primary: string;
  readonly secondary: string;
  readonly dark: string;
  readonly accent: string;
  readonly visor: string;
  readonly thruster: string;
}

export interface MechStats {
  readonly maxHp: number;
  readonly boostMax: number;
  readonly boostRegen: number;
  readonly speedGround: number;
  readonly speedAir: number;
  readonly beamDamage: number;
  readonly meleeDamage: number;
  readonly dashCost: number;
}

export type MechId = 'azure' | 'gale' | 'bastion';

export interface MechLoadout {
  readonly id: MechId;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly blurb: string;
  readonly palette: MechPalette;
  readonly stats: MechStats;
}

const AZURE: MechLoadout = {
  id: 'azure',
  code: 'RX-01',
  name: 'RX-01 蒼藍',
  role: '平衡型',
  blurb: '推進與火力均衡，適合先熟悉鎖定與取消節奏。',
  palette: {
    primary: '#e9eef8',
    secondary: '#2f55a8',
    dark: '#182033',
    accent: '#ffd24a',
    visor: '#6ef4ff',
    thruster: '#6fe6ff',
  },
  stats: {
    maxHp: 1000,
    boostMax: 100,
    boostRegen: 30,
    speedGround: 12.5,
    speedAir: 13.5,
    beamDamage: 70,
    meleeDamage: 170,
    dashCost: 18,
  },
};

const GALE: MechLoadout = {
  id: 'gale',
  code: 'RX-02',
  name: 'RX-02 疾風',
  role: '高機動型',
  blurb: '推進槽更大、移動更快，連續衝刺與空中纏鬥見長。',
  palette: {
    primary: '#eef8f4',
    secondary: '#1f7a6b',
    dark: '#11231f',
    accent: '#7cf7c4',
    visor: '#b4ffea',
    thruster: '#7cf7c4',
  },
  stats: {
    maxHp: 900,
    boostMax: 120,
    boostRegen: 36,
    speedGround: 14.5,
    speedAir: 16,
    beamDamage: 58,
    meleeDamage: 150,
    dashCost: 14,
  },
};

const BASTION: MechLoadout = {
  id: 'bastion',
  code: 'RX-03',
  name: 'RX-03 重裝',
  role: '重裝型',
  blurb: '耐久與火力最高，以推進槽換取正面壓制力。',
  palette: {
    primary: '#e6e2d8',
    secondary: '#8a5b2a',
    dark: '#241b12',
    accent: '#ffb347',
    visor: '#ffd79a',
    thruster: '#ffab4a',
  },
  stats: {
    maxHp: 1200,
    boostMax: 85,
    boostRegen: 26,
    speedGround: 10.5,
    speedAir: 11.5,
    beamDamage: 88,
    meleeDamage: 200,
    dashCost: 20,
  },
};

export const MECH_LOADOUTS: readonly MechLoadout[] = [AZURE, GALE, BASTION];

const BY_ID: Readonly<Record<MechId, MechLoadout>> = {
  azure: AZURE,
  gale: GALE,
  bastion: BASTION,
};

export const DEFAULT_MECH: MechLoadout = AZURE;

export function getMech(id: MechId): MechLoadout {
  return BY_ID[id];
}

export const ENEMY_PALETTE: MechPalette = {
  primary: '#a5303f',
  secondary: '#37233a',
  dark: '#160f1b',
  accent: '#ff9a45',
  visor: '#ff5d4a',
  thruster: '#ff8a45',
};
