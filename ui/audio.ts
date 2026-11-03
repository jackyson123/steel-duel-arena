import type { LifetimeScope } from 'wanaka-studio-engine';

export interface GameAudio {
  unlock(): void;
  rifle(enemy: boolean): void;
  melee(): void;
  hit(): void;
  dash(): void;
  overheat(): void;
  lock(valid: boolean): void;
  land(): void;
  dry(): void;
  finish(win: boolean): void;
}

/**
 * Tiny procedural arcade sound set. Nothing is loaded: every cue is a short
 * oscillator or filtered-noise envelope created on the fly.
 */
export function createGameAudio(scope: LifetimeScope): GameAudio {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let lastLockValid: boolean | null = null;

  const ensure = (): AudioContext | null => {
    if (context) return context;
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 0.26;
      gain.connect(ctx.destination);
      master = gain;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      noiseBuffer = buffer;
      context = ctx;
      return ctx;
    } catch {
      return null;
    }
  };

  scope.defer(() => {
    const ctx = context;
    context = null;
    master = null;
    noiseBuffer = null;
    if (ctx) void ctx.close().catch(() => undefined);
  });

  const unlock = (): void => {
    const ctx = ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  };

  const tone = (
    frequency: number,
    endFrequency: number,
    duration: number,
    wave: OscillatorType,
    level: number,
    delay = 0,
  ): void => {
    const ctx = context;
    const out = master;
    if (!ctx || !out || ctx.state !== 'running') return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(Math.max(20, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(out);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  };

  const noise = (
    duration: number,
    startHz: number,
    endHz: number,
    level: number,
    q: number,
    delay = 0,
  ): void => {
    const ctx = context;
    const out = master;
    const buffer = noiseBuffer;
    if (!ctx || !out || !buffer || ctx.state !== 'running') return;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(40, startHz), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endHz), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(start);
    source.stop(start + duration + 0.02);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  };

  return {
    unlock,
    rifle(enemy: boolean): void {
      if (enemy) {
        tone(460, 130, 0.18, 'sawtooth', 0.18);
        noise(0.12, 900, 300, 0.14, 1.4);
      } else {
        tone(980, 240, 0.16, 'square', 0.15);
        noise(0.1, 2200, 900, 0.12, 1.2);
      }
    },
    melee(): void {
      noise(0.28, 2400, 260, 0.2, 2.2);
      tone(240, 70, 0.24, 'sawtooth', 0.1);
    },
    hit(): void {
      tone(170, 48, 0.3, 'sine', 0.34);
      noise(0.16, 700, 140, 0.22, 0.9);
    },
    dash(): void {
      noise(0.3, 520, 2600, 0.16, 1.1);
      tone(300, 900, 0.16, 'triangle', 0.05);
    },
    overheat(): void {
      tone(660, 420, 0.16, 'square', 0.12);
      tone(500, 300, 0.22, 'square', 0.12, 0.16);
      noise(0.4, 3200, 400, 0.1, 1.6, 0.04);
    },
    lock(valid: boolean): void {
      if (lastLockValid === valid) return;
      lastLockValid = valid;
      if (valid) tone(1500, 1900, 0.05, 'sine', 0.045);
      else tone(420, 360, 0.07, 'triangle', 0.035);
    },
    land(): void {
      tone(130, 60, 0.14, 'sine', 0.12);
      noise(0.1, 500, 200, 0.07, 1);
    },
    dry(): void {
      tone(220, 180, 0.05, 'square', 0.05);
    },
    finish(win: boolean): void {
      if (win) {
        tone(620, 940, 0.2, 'triangle', 0.12);
        tone(940, 1320, 0.32, 'triangle', 0.1, 0.16);
        noise(0.34, 1400, 320, 0.08, 1.2, 0.04);
      } else {
        tone(320, 130, 0.42, 'sawtooth', 0.12);
        tone(210, 70, 0.55, 'sine', 0.14, 0.12);
      }
    },
  };
}
