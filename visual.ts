/** Project visual source shared by Edit, Preview, Play, and Publish. */
export interface ProjectVisualProfile {
  readonly schemaVersion: 1;
  readonly sky?: 'solid' | 'gradient';
  readonly presetId: 'neutral' | 'realistic' | 'stylized-toon' | 'graphic-ink' | 'ink-wash' | 'pixel-screen' | 'crosshatch' | 'one-bit' | 'phosphor' | 'retro-warm' | 'horror' | 'custom';
  readonly palette: {
    readonly sky: string;
    readonly ground: string;
    readonly road: string;
    readonly accent: string;
  };
  readonly lighting: {
    readonly key: { readonly color: string; readonly intensity: number; readonly azimuth: number; readonly elevation: number };
    readonly fill: { readonly color: string; readonly intensity: number };
    readonly rim: { readonly color: string; readonly intensity: number };
    readonly shadowMode: 'off' | 'hard' | 'soft';
  };
  readonly atmosphere: {
    readonly fog: { readonly enabled: boolean; readonly color: string; readonly near: number; readonly far: number };
    readonly weather: { readonly kind: 'clear' | 'rain' | 'snow'; readonly amount: number; readonly wind: number };
  };
  readonly environment: {
    readonly kind: 'color' | 'exr';
    readonly assetId: string | null;
    readonly intensity: number;
    readonly rotation: number;
  };
  readonly post: { readonly exposure: number; readonly bloom: number; readonly saturation: number; readonly contrast: number; readonly vignette: number; readonly hue?: number; readonly vibrance?: number; readonly cdlSlope?: number; readonly cdlOffset?: number; readonly cdlPower?: number; readonly sharpen?: number; readonly filmGrain?: number; readonly chromaticAberration?: number; readonly lutIntensity?: number; readonly lutAssetId?: string | null; readonly colorFilter?: string; readonly temperature?: number; readonly tint?: number; readonly contrastPivot?: number; readonly shadows?: string; readonly midtones?: string; readonly highlights?: string; readonly splitToneShadows?: string; readonly splitToneHighlights?: string; readonly splitToneBalance?: number; readonly channelMixer?: { readonly rr: number; readonly rg: number; readonly rb: number; readonly gr: number; readonly gg: number; readonly gb: number; readonly br: number; readonly bg: number; readonly bb: number } };
  readonly materialTheme: { readonly tintableRoles: readonly ('road' | 'ground' | 'accent')[] };
  readonly shading: { readonly model: 'standard' | 'cel'; readonly ink: boolean; readonly look?: 'none' | 'graphic' | 'wash' | 'pixel' | 'hatch' | 'dither' | 'crt'; readonly inkThickness?: number; readonly pixelResolution?: number };
}

export const visualProfile = {
  schemaVersion: 1,
  presetId: 'realistic',
  sky: 'gradient',
  palette: {
    sky: '#2b3d60',
    ground: '#6b727d',
    road: '#262a32',
    accent: '#ffb45e',
  },
  lighting: {
    key: {
      color: '#ffd2a1',
      intensity: 2.6,
      azimuth: 26,
      elevation: 34,
    },
    fill: {
      color: '#8aa6d6',
      intensity: 1.0,
    },
    rim: {
      color: '#ff9c5e',
      intensity: 0.6,
    },
    shadowMode: 'soft',
  },
  atmosphere: {
    fog: {
      enabled: true,
      color: '#243149',
      near: 90,
      far: 340,
    },
    weather: {
      kind: 'clear',
      amount: 0,
      wind: 0.06,
    },
  },
  environment: {
    kind: 'color',
    assetId: null,
    intensity: 1.0,
    rotation: 0,
  },
  post: {
    exposure: 0.26,
    bloom: 0,
    saturation: 1.04,
    contrast: 1.08,
    vignette: 0.18,
  },
  materialTheme: { tintableRoles: ['ground', 'accent'] },
  shading: {
    model: 'standard',
    ink: false,
    look: 'none',
  },
} satisfies ProjectVisualProfile;
