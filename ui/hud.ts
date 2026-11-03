import { hudElement } from 'wanaka-studio-engine/dom';
import type { LifetimeScope } from 'wanaka-studio-engine';
import { DEFAULT_MECH, getMech, MECH_LOADOUTS, type MechId } from '../mechs.js';
import { UI_LOOK } from './look.js';

export type MatchPhase = 'ready' | 'playing' | 'over';
export type LockState = 'locked' | 'occluded' | 'range';

export interface HudView {
  readonly timeLeft: number;
  readonly playerHp: number;
  readonly playerHpMax: number;
  readonly enemyHp: number;
  readonly boost: number;
  readonly boostMax: number;
  readonly overheated: boolean;
  readonly ammo: number;
  readonly lock: LockState;
  readonly damageFlash: number;
}

export interface HudResult {
  readonly win: boolean;
  readonly timeUsed: number;
  readonly damage: number;
  readonly hits: number;
  readonly shots: number;
}

export interface HudCallbacks {
  readonly onStart: () => void;
  readonly onReplay: () => void;
  readonly onTitle: () => void;
  readonly onSelectMech: (id: MechId) => void;
}

export interface TouchControlState {
  moveX: number;
  moveY: number;
  boostHeld: boolean;
  fireHeld: boolean;
  consumeDash(): boolean;
  consumeFire(): boolean;
  consumeMelee(): boolean;
  reset(): void;
}

export interface HudHandles {
  readonly root: HTMLElement;
  readonly touch: TouchControlState;
  setPhase(phase: MatchPhase): void;
  update(view: HudView): void;
  showResult(result: HudResult): void;
  toast(message: string): void;
}

const AMMO_MAX = 8;
const ENEMY_HP_MAX = 1000;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: HTMLElement,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  return hudElement(tag, {
    parent,
    className,
    ...(text !== undefined ? { text } : {}),
  });
}

function controlRow(parent: HTMLElement, label: string, body: string): void {
  const row = create('div', parent, 'mecha-control');
  create('b', row, '', label);
  create('span', row, '', body);
}

export function mountHud(
  parent: HTMLElement,
  scope: LifetimeScope,
  callbacks: HudCallbacks,
): HudHandles {
  const root = hudElement('div', {
    parent,
    className: 'wanaka-hud wk-root mecha-root',
    authoringId: 'ui/root',
  });
  hudElement('style', { parent: root, text: UI_LOOK.css });
  hudElement('style', { parent: root, text: HUD_CSS });
  scope.defer(() => root.remove());

  const signals = new AbortController();
  scope.defer(() => signals.abort());

  let selectedMech = DEFAULT_MECH;
  let readyScreen: 'title' | 'loadout' = 'title';
  let hudPhase: MatchPhase = 'ready';

  // --- Title screen ------------------------------------------------------
  const titleScreen = hudElement('section', {
    parent: root,
    className: 'wk-screen mecha-title',
    authoringId: 'ui/title',
  });
  const titleInner = create('div', titleScreen, 'mecha-title-inner');
  create('p', titleInner, 'mecha-kicker', 'ARCADE ARENA PROTOTYPE');
  const logo = create('h1', titleInner, 'wk-title mecha-logo', '機動競技場');
  create('span', logo, '', 'STEEL DUEL');
  create(
    'p',
    titleInner,
    'wk-body mecha-pitch',
    '強制鎖定、推進衝刺、取消收招。用光束步槍壓制對手，用突進斬擊把敵機打飛——先讓對手血條歸零的一方獲勝。',
  );
  const titleSelected = create('p', titleInner, 'mecha-current', '');
  const controls = create('div', titleInner, 'mecha-controls');
  controlRow(controls, '移動 WASD', '相對鎖定方向前後左右移動');
  controlRow(controls, '推進 SPACE', '按住上升飛行，落地後推進槽回復');
  controlRow(controls, '衝刺 SHIFT / 雙擊方向', '高速位移，可取消射擊後搖');
  controlRow(controls, '戰鬥 左鍵・J / 右鍵・K', '光束步槍 / 帶擊飛的近戰斬擊');
  const titleActions = create('div', titleInner, 'wk-actions mecha-title-actions');
  const startButton = hudElement('button', {
    parent: titleActions,
    className: 'wk-button wk-primary mecha-start',
    text: '出擊 START',
    authoringId: 'ui/title-start',
  });
  startButton.type = 'button';
  const loadoutButton = hudElement('button', {
    parent: titleActions,
    className: 'wk-button wk-ghost mecha-loadout-open',
    text: '機體選擇',
    authoringId: 'ui/title-loadout',
  });
  loadoutButton.type = 'button';
  create(
    'p',
    titleInner,
    'wk-muted mecha-foot',
    '手機：左搖桿移動，右側按鈕推進／衝刺／射擊／斬擊 · 無外部素材',
  );

  // --- Mech select screen ------------------------------------------------
  const loadoutScreen = hudElement('section', {
    parent: root,
    className: 'wk-screen mecha-loadout',
    authoringId: 'ui/loadout',
  });
  const loadoutPanel = create('div', loadoutScreen, 'wk-panel mecha-loadout-panel');
  create('p', loadoutPanel, 'mecha-kicker', 'MECH SELECT');
  create('h2', loadoutPanel, 'wk-title mecha-loadout-title', '選擇機體');
  create(
    'p',
    loadoutPanel,
    'wk-body mecha-loadout-sub',
    '三架機體各有不同的耐久、推進與火力。選定後按出擊。',
  );
  const cardRow = create('div', loadoutPanel, 'mecha-picks');
  const cards: { element: HTMLButtonElement; id: MechId }[] = [];
  const statRow = (parent: HTMLElement, label: string, value: string, percent: number, color: string): void => {
    const row = create('span', parent, 'mecha-pick-stat');
    create('span', row, 'mecha-pick-stat-label', label);
    const track = create('span', row, 'mecha-pick-track');
    const fill = create('span', track, 'mecha-pick-fill');
    fill.style.width = `${Math.round(Math.max(4, Math.min(100, percent)))}%`;
    fill.style.background = color;
    create('span', row, 'mecha-pick-stat-value', value);
  };
  for (const loadout of MECH_LOADOUTS) {
    const card = hudElement('button', {
      parent: cardRow,
      className: 'mecha-pick',
      authoringId: `ui/mech-${loadout.id}`,
    });
    card.type = 'button';
    card.setAttribute('aria-pressed', 'false');
    const swatch = create('span', card, 'mecha-pick-swatch');
    swatch.style.background = loadout.palette.primary;
    const accentBar = create('span', card, 'mecha-pick-accent');
    accentBar.style.background = loadout.palette.accent;
    create('span', card, 'mecha-pick-name', loadout.name);
    create('span', card, 'mecha-pick-role', `${loadout.role} · 推進 ${loadout.stats.boostMax}`);
    create('span', card, 'mecha-pick-blurb', loadout.blurb);
    const stats = create('span', card, 'mecha-pick-stats');
    statRow(stats, '耐久', String(loadout.stats.maxHp), (loadout.stats.maxHp / 1200) * 100, loadout.palette.accent);
    statRow(stats, '機動', loadout.stats.speedAir.toFixed(1), (loadout.stats.speedAir / 16) * 100, loadout.palette.visor);
    statRow(stats, '火力', String(loadout.stats.meleeDamage), (loadout.stats.meleeDamage / 200) * 100, loadout.palette.accent);
    card.addEventListener('click', () => applySelection(loadout.id, true), { signal: signals.signal });
    cards.push({ element: card, id: loadout.id });
  }
  const loadoutActions = create('div', loadoutPanel, 'wk-actions mecha-loadout-actions');
  const loadoutStart = hudElement('button', {
    parent: loadoutActions,
    className: 'wk-button wk-primary mecha-start',
    text: '出擊 START',
    authoringId: 'ui/loadout-start',
  });
  loadoutStart.type = 'button';
  const loadoutBack = hudElement('button', {
    parent: loadoutActions,
    className: 'wk-button wk-ghost',
    text: '返回',
    authoringId: 'ui/loadout-back',
  });
  loadoutBack.type = 'button';
  startButton.addEventListener('click', callbacks.onStart, { signal: signals.signal });
  loadoutStart.addEventListener('click', callbacks.onStart, { signal: signals.signal });
  loadoutButton.addEventListener('click', () => {
    readyScreen = 'loadout';
    refreshReadyScreens();
  }, { signal: signals.signal });
  loadoutBack.addEventListener('click', () => {
    readyScreen = 'title';
    refreshReadyScreens();
  }, { signal: signals.signal });

  // --- Battle HUD --------------------------------------------------------
  const hudScreen = hudElement('section', {
    parent: root,
    className: 'wk-screen mecha-hud',
    authoringId: 'ui/hud',
  });

  const top = create('div', hudScreen, 'mecha-top');

  const playerSide = create('div', top, 'mecha-side mecha-side--player');
  const playerNameEl = create('div', playerSide, 'mecha-name', selectedMech.name);
  const playerTrack = create('div', playerSide, 'wk-track mecha-hp');
  const playerGhost = create('span', playerTrack, 'mecha-hp-ghost');
  const playerFill = create('span', playerTrack, 'mecha-hp-fill');
  const playerNumbers = create('div', playerSide, 'mecha-hp-num');
  const playerHpValue = create('span', playerNumbers, 'wk-value', String(selectedMech.stats.maxHp));
  const playerHpMaxLabel = create('span', playerNumbers, 'wk-muted', `/ ${selectedMech.stats.maxHp}`);

  const clock = create('div', top, 'mecha-clock');
  const timerValue = create('div', clock, 'wk-timer mecha-timer', '99');
  const lockChip = create('div', clock, 'mecha-lock mecha-lock--red', 'LOCK ON');

  const enemySide = create('div', top, 'mecha-side mecha-side--enemy');
  create('div', enemySide, 'mecha-name', 'MS-666 緋紅');
  const enemyTrack = create('div', enemySide, 'wk-track mecha-hp mecha-hp--enemy');
  const enemyGhost = create('span', enemyTrack, 'mecha-hp-ghost');
  const enemyFill = create('span', enemyTrack, 'mecha-hp-fill');
  const enemyNumbers = create('div', enemySide, 'mecha-hp-num');
  const enemyHpValue = create('span', enemyNumbers, 'wk-value', '1000');
  create('span', enemyNumbers, 'wk-muted', '/ 1000');

  const bottom = create('div', hudScreen, 'mecha-bottom');

  const boostBlock = create('div', bottom, 'mecha-boost');
  create('div', boostBlock, 'mecha-label', 'BOOST 推進槽');
  const boostTrack = create('div', boostBlock, 'wk-track mecha-boost-track');
  const boostFill = create('span', boostTrack, 'wk-fill mecha-boost-fill');
  const boostRow = create('div', boostBlock, 'mecha-boost-row');
  const boostValue = create('span', boostRow, 'mecha-boost-num wk-value', '100');
  const boostState = create('span', boostRow, 'mecha-boost-state', 'READY');

  const hint = create(
    'div',
    bottom,
    'mecha-hint',
    'WASD 移動 · SPACE 推進 · SHIFT/雙擊 衝刺 · J 射擊 · K 斬擊',
  );
  void hint;

  const ammoBlock = create('div', bottom, 'mecha-ammo');
  create('div', ammoBlock, 'mecha-label', 'BEAM RIFLE 彈藥');
  const pipRow = create('div', ammoBlock, 'mecha-pips');
  const pips: HTMLSpanElement[] = [];
  for (let i = 0; i < AMMO_MAX; i += 1) {
    pips.push(create('span', pipRow, 'mecha-pip'));
  }
  const ammoRow = create('div', ammoBlock, 'mecha-ammo-row');
  const ammoValue = create('span', ammoRow, 'wk-value mecha-ammo-num', '8');
  create('span', ammoRow, 'wk-muted', '/ 8');
  const ammoState = create('span', ammoRow, 'mecha-ammo-state', 'AUTO');

  const overheat = create('div', hudScreen, 'mecha-overheat');
  create('span', overheat, '', 'OVERHEAT');
  create('small', overheat, '', '推進系統強制冷卻');

  const damageOverlay = create('div', hudScreen, 'mecha-damage');
  const toastEl = create('div', hudScreen, 'mecha-toast');
  toastEl.hidden = true;

  // --- Touch controls ----------------------------------------------------
  const touchLayer = hudElement('div', {
    parent: root,
    className: 'wk-touch mecha-touch',
    authoringId: 'ui/touch-controls',
  });
  touchLayer.hidden = true;
  const stick = hudElement('div', {
    parent: touchLayer,
    className: 'wk-stick mecha-stick',
    authoringId: 'ui/touch-stick',
  });
  const knob = create('span', stick, 'mecha-stick-knob');
  create('span', stick, 'mecha-stick-label', 'MOVE');
  const actionPad = create('div', touchLayer, 'mecha-actions');
  const actionButton = (label: string, authoringId: string, className: string): HTMLButtonElement => {
    const button = hudElement('button', {
      parent: actionPad,
      className: `wk-action ${className}`,
      text: label,
      authoringId,
    });
    button.type = 'button';
    return button;
  };
  const boostButton = actionButton('推進', 'ui/touch-boost', '');
  const dashButton = actionButton('衝刺', 'ui/touch-dash', '');
  const meleeButton = actionButton('斬擊', 'ui/touch-melee', '');
  const fireButton = actionButton('射擊', 'ui/touch-fire', 'wk-primary');

  let dashQueued = false;
  let fireQueued = false;
  let meleeQueued = false;
  let stickX = 0;
  let stickY = 0;
  const touch: TouchControlState = {
    moveX: 0,
    moveY: 0,
    boostHeld: false,
    fireHeld: false,
    consumeDash(): boolean {
      const value = dashQueued;
      dashQueued = false;
      return value;
    },
    consumeFire(): boolean {
      const value = fireQueued;
      fireQueued = false;
      return value;
    },
    consumeMelee(): boolean {
      const value = meleeQueued;
      meleeQueued = false;
      return value;
    },
    reset(): void {
      touch.moveX = 0;
      touch.moveY = 0;
      touch.boostHeld = false;
      touch.fireHeld = false;
      dashQueued = false;
      fireQueued = false;
      meleeQueued = false;
      stickX = 0;
      stickY = 0;
      knob.style.transform = 'translate(0px, 0px)';
      boostButton.classList.remove('is-held');
      fireButton.classList.remove('is-held');
    },
  };

  let touchMode = false;
  const enableTouchMode = (): void => {
    if (touchMode) return;
    touchMode = true;
    root.classList.add('is-touch');
  };
  if (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches) enableTouchMode();
  window.addEventListener('touchstart', enableTouchMode, { passive: true, signal: signals.signal });
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') enableTouchMode();
  }, { passive: true, signal: signals.signal });

  let stickPointer = -1;
  const applyStick = (): void => {
    const radius = Math.max(1, stick.clientWidth / 2);
    const nx = stickX / radius;
    const ny = stickY / radius;
    touch.moveX = Math.abs(nx) < 0.12 ? 0 : clamp(nx, -1, 1);
    touch.moveY = Math.abs(ny) < 0.12 ? 0 : clamp(-ny, -1, 1);
    knob.style.transform = `translate(${stickX}px, ${stickY}px)`;
  };
  const updateStick = (event: PointerEvent): void => {
    const rect = stick.getBoundingClientRect();
    const radius = rect.width / 2;
    if (radius <= 0) return;
    if (event.movementX !== 0 || event.movementY !== 0) {
      stickX = clamp(stickX + event.movementX, -radius, radius);
      stickY = clamp(stickY + event.movementY, -radius, radius);
    } else {
      stickX = clamp(event.clientX - (rect.left + radius), -radius, radius);
      stickY = clamp(event.clientY - (rect.top + radius), -radius, radius);
    }
    applyStick();
  };
  const releaseStick = (event: PointerEvent): void => {
    if (event.pointerId !== stickPointer) return;
    stickPointer = -1;
    stickX = 0;
    stickY = 0;
    touch.moveX = 0;
    touch.moveY = 0;
    knob.style.transform = 'translate(0px, 0px)';
  };
  stick.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (stickPointer !== -1) return;
    stickPointer = event.pointerId;
    try {
      stick.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional; dragging still works without it.
    }
    updateStick(event);
  }, { signal: signals.signal });
  stick.addEventListener('pointermove', (event) => {
    if (event.pointerId === stickPointer) {
      event.stopPropagation();
      updateStick(event);
    }
  }, { signal: signals.signal });
  stick.addEventListener('pointerup', (event) => {
    event.stopPropagation();
    releaseStick(event);
  }, { signal: signals.signal });
  stick.addEventListener('pointercancel', (event) => {
    event.stopPropagation();
    releaseStick(event);
  }, { signal: signals.signal });
  stick.addEventListener('lostpointercapture', releaseStick, { signal: signals.signal });

  const bindHold = (button: HTMLButtonElement, onDown: () => void, onUp: () => void): void => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onDown();
    }, { signal: signals.signal });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      button.addEventListener(type, (event) => {
        event.stopPropagation();
        onUp();
      }, { signal: signals.signal });
    }
  };
  bindHold(
    boostButton,
    () => {
      touch.boostHeld = true;
      boostButton.classList.add('is-held');
    },
    () => {
      touch.boostHeld = false;
      boostButton.classList.remove('is-held');
    },
  );
  bindHold(
    fireButton,
    () => {
      touch.fireHeld = true;
      fireQueued = true;
      fireButton.classList.add('is-held');
    },
    () => {
      touch.fireHeld = false;
      fireButton.classList.remove('is-held');
    },
  );
  dashButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dashQueued = true;
  }, { signal: signals.signal });
  meleeButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    meleeQueued = true;
  }, { signal: signals.signal });

  // --- Result screen -----------------------------------------------------
  const resultScreen = hudElement('section', {
    parent: root,
    className: 'wk-screen mecha-result',
    authoringId: 'ui/result',
  });
  const resultPanel = create('div', resultScreen, 'wk-panel mecha-result-panel');
  const resultTitle = create('h2', resultPanel, 'wk-title', 'MISSION COMPLETE');
  const resultSubtitle = create('p', resultPanel, 'wk-body mecha-result-sub', '敵機失去戰鬥能力。');
  const resultStats = create('div', resultPanel, 'mecha-stats');
  const statTime = create('div', resultStats, 'mecha-stat');
  const statTimeValue = create('b', statTime, '', '00:00');
  create('span', statTime, '', '戰鬥時間');
  const statDamage = create('div', resultStats, 'mecha-stat');
  const statDamageValue = create('b', statDamage, '', '0');
  create('span', statDamage, '', '造成傷害');
  const statAccuracy = create('div', resultStats, 'mecha-stat');
  const statAccuracyValue = create('b', statAccuracy, '', '0%');
  create('span', statAccuracy, '', '射擊命中率');
  const resultActions = create('div', resultPanel, 'wk-actions mecha-result-actions');
  const replayButton = create('button', resultActions, 'wk-button wk-primary', '再戰 RETRY');
  replayButton.type = 'button';
  const titleButton = create('button', resultActions, 'wk-button wk-ghost', '返回標題');
  titleButton.type = 'button';

  replayButton.addEventListener('click', callbacks.onReplay, { signal: signals.signal });
  titleButton.addEventListener('click', callbacks.onTitle, { signal: signals.signal });

  // --- Presenter ---------------------------------------------------------
  const cache = {
    playerHp: -1,
    playerHpMax: -1,
    enemyHp: -1,
    boost: -1,
    boostMax: -1,
    ammo: -1,
    time: -1,
    lock: '' as LockState | '',
    overheat: false,
    damage: -1,
  };
  let toastTimer = 0;
  scope.defer(() => window.clearTimeout(toastTimer));

  const setWidth = (element: HTMLElement, percent: number): void => {
    const value = `${Math.max(0, Math.min(100, percent))}%`;
    if (element.style.width !== value) element.style.width = value;
  };

  function refreshReadyScreens(): void {
    const ready = hudPhase === 'ready';
    titleScreen.hidden = !ready || readyScreen !== 'title';
    loadoutScreen.hidden = !ready || readyScreen !== 'loadout';
  }

  function applySelection(id: MechId, notify: boolean): void {
    selectedMech = getMech(id);
    playerNameEl.textContent = selectedMech.name;
    titleSelected.textContent = `目前機體：${selectedMech.name} · ${selectedMech.role}`;
    playerHpMaxLabel.textContent = `/ ${selectedMech.stats.maxHp}`;
    for (const card of cards) {
      const active = card.id === id;
      card.element.classList.toggle('is-selected', active);
      card.element.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (notify) callbacks.onSelectMech(id);
  }

  applySelection(DEFAULT_MECH.id, false);

  const setPhase = (phase: MatchPhase): void => {
    hudPhase = phase;
    if (phase === 'ready') readyScreen = 'title';
    refreshReadyScreens();
    hudScreen.hidden = phase === 'ready';
    resultScreen.hidden = phase !== 'over';
    lockChip.hidden = phase !== 'playing';
    touchLayer.hidden = phase !== 'playing';
    if (phase !== 'playing') touch.reset();
    if (phase !== 'over') {
      resultScreen.classList.remove('mecha-result--win', 'mecha-result--lose');
    }
    if (phase === 'playing') {
      cache.playerHp = -1;
      cache.playerHpMax = -1;
      cache.enemyHp = -1;
      cache.boost = -1;
      cache.boostMax = -1;
      cache.ammo = -1;
      cache.time = -1;
      cache.lock = '';
      cache.overheat = false;
      cache.damage = -1;
      toastEl.hidden = true;
    }
    if (phase === 'ready') {
      cache.playerHp = -1;
    }
  };

  const update = (view: HudView): void => {
    const playerHpMax = Math.max(1, Math.round(view.playerHpMax));
    if (playerHpMax !== cache.playerHpMax) {
      cache.playerHpMax = playerHpMax;
      playerHpMaxLabel.textContent = `/ ${playerHpMax}`;
      cache.playerHp = -1;
    }
    const playerHp = Math.max(0, Math.ceil(view.playerHp));
    if (playerHp !== cache.playerHp) {
      cache.playerHp = playerHp;
      playerHpValue.textContent = String(playerHp);
      setWidth(playerFill, (playerHp / playerHpMax) * 100);
      setWidth(playerGhost, (playerHp / playerHpMax) * 100);
    }
    const enemyHp = Math.max(0, Math.ceil(view.enemyHp));
    if (enemyHp !== cache.enemyHp) {
      cache.enemyHp = enemyHp;
      enemyHpValue.textContent = String(enemyHp);
      setWidth(enemyFill, (enemyHp / ENEMY_HP_MAX) * 100);
      setWidth(enemyGhost, (enemyHp / ENEMY_HP_MAX) * 100);
    }
    const boostMax = Math.max(1, Math.round(view.boostMax));
    if (boostMax !== cache.boostMax) {
      cache.boostMax = boostMax;
      cache.boost = -1;
    }
    const boost = Math.max(0, Math.round(view.boost));
    if (boost !== cache.boost) {
      cache.boost = boost;
      boostValue.textContent = String(boost);
      setWidth(boostFill, (boost / boostMax) * 100);
    }
    if (view.overheated !== cache.overheat) {
      cache.overheat = view.overheated;
      boostBlock.classList.toggle('is-overheated', view.overheated);
      overheat.classList.toggle('is-on', view.overheated);
      boostState.textContent = view.overheated ? 'OVERHEAT' : 'READY';
    }
    const ammo = Math.max(0, Math.min(AMMO_MAX, Math.round(view.ammo)));
    if (ammo !== cache.ammo) {
      cache.ammo = ammo;
      ammoValue.textContent = String(ammo);
      pips.forEach((pip, index) => {
        pip.classList.toggle('is-spent', index >= ammo);
      });
      ammoState.textContent = ammo <= 0 ? 'RELOADING' : 'AUTO';
      ammoBlock.classList.toggle('is-empty', ammo <= 0);
    }
    const time = Math.max(0, Math.ceil(view.timeLeft));
    if (time !== cache.time) {
      cache.time = time;
      timerValue.textContent = String(time).padStart(2, '0');
      clock.classList.toggle('is-urgent', time <= 10);
    }
    if (view.lock !== cache.lock) {
      cache.lock = view.lock;
      lockChip.classList.toggle('mecha-lock--red', view.lock === 'locked');
      lockChip.classList.toggle('mecha-lock--green', view.lock !== 'locked');
      lockChip.textContent = view.lock === 'locked'
        ? 'LOCK ON'
        : view.lock === 'occluded'
          ? 'LOCK 遮蔽'
          : 'LOCK 射程外';
    }
    const damage = Math.round(Math.max(0, Math.min(1, view.damageFlash)) * 100) / 100;
    if (damage !== cache.damage) {
      cache.damage = damage;
      damageOverlay.style.opacity = String(damage * 0.6);
    }
  };

  const showResult = (result: HudResult): void => {
    resultScreen.classList.toggle('mecha-result--win', result.win);
    resultScreen.classList.toggle('mecha-result--lose', !result.win);
    resultTitle.textContent = result.win ? 'MISSION COMPLETE' : 'MISSION FAILED';
    resultSubtitle.textContent = result.win
      ? '敵機失去戰鬥能力。競技場由你主宰。'
      : '機體嚴重受損。調整推進節奏，再來一次。';
    const minutes = Math.floor(result.timeUsed / 60);
    const seconds = Math.floor(result.timeUsed % 60);
    statTimeValue.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    statDamageValue.textContent = String(Math.max(0, Math.round(result.damage)));
    const accuracy = result.shots > 0 ? Math.min(100, Math.round((result.hits / result.shots) * 100)) : 0;
    statAccuracyValue.textContent = `${accuracy}%`;
    resultScreen.hidden = false;
  };

  const toast = (message: string): void => {
    toastEl.textContent = message;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.hidden = true;
    }, 1300);
  };

  setPhase('ready');

  return { root, touch, setPhase, update, showResult, toast };
}

export const HUD_CSS = `
.mecha-root { user-select: none; -webkit-user-select: none; }
.mecha-hud { position: absolute; inset: 0; pointer-events: none; }
.mecha-hud::before { content: ""; position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(4, 9, 22, .62) 0%, rgba(4, 9, 22, 0) 26%, rgba(4, 9, 22, 0) 70%, rgba(4, 9, 22, .62) 100%); pointer-events: none; }

.mecha-top { position: absolute; top: max(14px, env(safe-area-inset-top)); left: max(18px, env(safe-area-inset-left)); right: max(18px, env(safe-area-inset-right)); display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 18px; align-items: start; }
.mecha-side { display: grid; gap: 5px; min-width: 0; }
.mecha-side--enemy { justify-items: end; text-align: right; }
.mecha-name { font-family: var(--wk-font-display); font-size: 11px; font-weight: 700; letter-spacing: .2em; color: var(--wk-muted); text-transform: uppercase; }
.mecha-hp { width: 100%; max-width: 380px; height: 13px; border-radius: 2px; border: 1px solid rgba(255, 255, 255, .22); background: rgba(4, 9, 22, .82); position: relative; overflow: hidden; transform: skewX(-16deg); }
.mecha-hp-fill { position: absolute; top: 0; bottom: 0; left: 0; width: 100%; background: linear-gradient(90deg, #47b8ff, #96f2ff); box-shadow: 0 0 14px rgba(90, 210, 255, .75); transition: width .12s linear; }
.mecha-hp-ghost { position: absolute; top: 0; bottom: 0; left: 0; width: 100%; background: rgba(255, 255, 255, .82); transition: width .5s cubic-bezier(.2, .8, .2, 1) .1s; }
.mecha-hp--enemy .mecha-hp-fill, .mecha-hp--enemy .mecha-hp-ghost { left: auto; right: 0; }
.mecha-hp--enemy .mecha-hp-fill { background: linear-gradient(270deg, #ff4f5e, #ffb15c); box-shadow: 0 0 14px rgba(255, 80, 90, .7); }
.mecha-hp-num { display: flex; gap: 6px; align-items: baseline; font-size: 12px; }
.mecha-hp-num .wk-value { font-size: 17px; letter-spacing: .04em; }

.mecha-clock { display: grid; justify-items: center; gap: 3px; padding: 2px 20px 6px; background: linear-gradient(180deg, rgba(4, 9, 22, .88), rgba(4, 9, 22, 0)); border-bottom: 2px solid var(--wk-accent); }
.mecha-timer { font-family: var(--wk-font-display); font-size: clamp(26px, 3.6vw, 42px); font-weight: 800; line-height: .95; letter-spacing: .06em; color: #fff; text-shadow: 0 0 20px rgba(255, 216, 107, .45); }
.mecha-clock.is-urgent .mecha-timer { color: #ff6a74; text-shadow: 0 0 22px rgba(255, 70, 90, .75); animation: mecha-pulse .8s ease-in-out infinite; }
.mecha-lock { font-family: var(--wk-font-display); font-size: 10px; font-weight: 700; letter-spacing: .22em; padding: 2px 8px; border-radius: 2px; transition: color .12s, border-color .12s, background .12s; }
.mecha-lock--red { color: #ff6271; border: 1px solid rgba(255, 98, 113, .55); background: rgba(255, 60, 80, .14); }
.mecha-lock--green { color: #4ee6a5; border: 1px solid rgba(78, 230, 165, .5); background: rgba(40, 200, 130, .12); }

.mecha-bottom { position: absolute; left: max(18px, env(safe-area-inset-left)); right: max(18px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
.mecha-boost { width: min(34vw, 330px); display: grid; gap: 5px; }
.mecha-label { font-size: 10px; font-weight: 700; letter-spacing: .24em; color: var(--wk-muted); }
.mecha-boost-track { height: 12px; border-radius: 2px; border: 1px solid rgba(255, 255, 255, .22); background: rgba(4, 9, 22, .84); transform: skewX(-16deg); }
.mecha-boost-fill { background: linear-gradient(90deg, #ffd45e, #ff9a2e); box-shadow: 0 0 16px rgba(255, 185, 60, .8); transition: width .08s linear; }
.mecha-boost-row { display: flex; align-items: baseline; gap: 10px; }
.mecha-boost-num { font-size: 20px; }
.mecha-boost-state { font-size: 9px; font-weight: 700; letter-spacing: .2em; color: var(--wk-muted); }
.mecha-boost.is-overheated .mecha-boost-fill { background: linear-gradient(90deg, #ff4054, #ff8a49); box-shadow: 0 0 20px rgba(255, 60, 80, .9); animation: mecha-pulse .5s ease-in-out infinite; }
.mecha-boost.is-overheated .mecha-label, .mecha-boost.is-overheated .mecha-boost-state { color: #ff7280; }

.mecha-hint { flex: 1; padding-bottom: 4px; text-align: center; font-size: 10px; letter-spacing: .06em; color: rgba(240, 246, 255, .5); }
.mecha-ammo { width: min(30vw, 260px); display: grid; gap: 5px; justify-items: end; }
.mecha-pips { display: flex; gap: 4px; align-items: flex-end; }
.mecha-pip { width: 5px; height: 18px; background: linear-gradient(180deg, #9bf6ff, #3aa8ff); box-shadow: 0 0 8px rgba(90, 220, 255, .8); transform: skewX(-16deg); transition: background .12s, box-shadow .12s; }
.mecha-pip.is-spent { background: rgba(255, 255, 255, .13); box-shadow: none; }
.mecha-ammo-row { display: flex; align-items: baseline; gap: 8px; }
.mecha-ammo-num { font-size: 20px; }
.mecha-ammo-state { font-size: 9px; font-weight: 700; letter-spacing: .2em; color: var(--wk-muted); }
.mecha-ammo.is-empty .mecha-ammo-num { color: #ff7280; }

.mecha-overheat { position: absolute; left: 50%; top: 31%; transform: translate(-50%, -50%); display: grid; justify-items: center; gap: 3px; padding: 11px 30px; border: 1px solid rgba(255, 84, 96, .65); background: rgba(58, 6, 14, .78); color: #ff6b76; font-family: var(--wk-font-display); font-weight: 800; letter-spacing: .32em; font-size: clamp(18px, 2.4vw, 30px); opacity: 0; transition: opacity .15s; }
.mecha-overheat small { font-family: var(--wk-font-body); font-size: 10px; font-weight: 600; letter-spacing: .2em; color: #ffb4ba; }
.mecha-overheat.is-on { opacity: 1; animation: mecha-beat .55s ease-in-out infinite; }

.mecha-damage { position: absolute; inset: 0; background: radial-gradient(circle at 50% 58%, transparent 36%, rgba(255, 28, 50, .6) 100%); opacity: 0; pointer-events: none; }
.mecha-toast { position: absolute; left: 50%; bottom: 23%; transform: translateX(-50%); padding: 8px 20px; border-left: 2px solid var(--wk-accent); background: rgba(4, 9, 22, .82); color: #fff; font-family: var(--wk-font-display); font-size: 13px; font-weight: 700; letter-spacing: .2em; }

.mecha-title { display: grid; align-items: center; padding: clamp(24px, 6vw, 84px); background: linear-gradient(90deg, rgba(3, 7, 18, .94) 0%, rgba(3, 7, 18, .78) 38%, rgba(3, 7, 18, 0) 74%); }
.mecha-title-inner { max-width: 640px; display: grid; gap: 16px; justify-items: start; }
.mecha-kicker { margin: 0; font-family: var(--wk-font-display); font-size: 11px; font-weight: 700; letter-spacing: .4em; color: var(--wk-accent); }
.mecha-logo { margin: 0; font-size: clamp(40px, 7vw, 82px); line-height: .92; letter-spacing: -.02em; color: #fff; text-shadow: 0 8px 44px rgba(80, 160, 255, .42); }
.mecha-logo span { display: block; margin-top: 10px; font-size: .24em; letter-spacing: .42em; color: var(--wk-accent); text-shadow: none; }
.mecha-pitch { margin: 0; max-width: 46ch; color: #d3dcee; font-size: 14px; line-height: 1.65; }
.mecha-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; width: min(100%, 580px); }
.mecha-control { padding: 9px 12px; border-left: 2px solid rgba(255, 206, 74, .55); background: rgba(10, 18, 34, .66); }
.mecha-control b { display: block; margin-bottom: 3px; font-family: var(--wk-font-display); font-size: 10px; letter-spacing: .18em; color: var(--wk-accent); }
.mecha-control span { font-size: 12px; line-height: 1.4; color: #c6d1e4; }
.mecha-start { min-width: 200px; padding: .82rem 2.4rem; font-family: var(--wk-font-display); font-size: 16px; letter-spacing: .18em; white-space: nowrap; }
.mecha-foot { margin: 0; font-size: 11px; letter-spacing: .06em; }
.mecha-current { margin: 0; font-family: var(--wk-font-display); font-size: 12px; letter-spacing: .12em; color: var(--wk-accent); }
.mecha-title-actions { gap: 10px; }
.mecha-loadout-open { min-width: 140px; white-space: nowrap; }

/* Mech select */
.mecha-loadout { display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: radial-gradient(circle at 50% 42%, rgba(12, 22, 44, .6), rgba(3, 7, 18, .92)); }
.mecha-loadout-panel { width: min(94vw, 880px); max-height: 90vh; overflow-y: auto; display: grid; gap: 12px; padding: clamp(16px, 3vw, 28px); pointer-events: auto; }
.mecha-loadout-title { font-size: clamp(24px, 4vw, 38px); letter-spacing: .08em; }
.mecha-loadout-sub { margin: 0; font-size: 12px; color: var(--wk-muted); }
.mecha-picks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mecha-pick { display: grid; gap: 6px; padding: 12px; border: 1px solid rgba(255, 255, 255, .14); border-radius: 10px; background: rgba(10, 18, 34, .8); color: var(--wk-text); font: inherit; text-align: left; cursor: pointer; pointer-events: auto; transition: border-color .15s, transform .15s, box-shadow .15s; }
.mecha-pick:hover { border-color: rgba(255, 216, 107, .55); transform: translateY(-1px); }
.mecha-pick.is-selected { border-color: var(--wk-accent); box-shadow: 0 0 0 1px var(--wk-accent), 0 12px 30px rgba(0, 0, 0, .38); }
.mecha-pick-swatch { display: block; height: 8px; border-radius: 4px; }
.mecha-pick-accent { display: block; width: 54px; height: 3px; border-radius: 2px; }
.mecha-pick-name { font-family: var(--wk-font-display); font-weight: 700; font-size: 14px; letter-spacing: .06em; }
.mecha-pick-role { font-size: 10px; letter-spacing: .08em; color: var(--wk-muted); }
.mecha-pick-blurb { min-height: 32px; font-size: 11px; line-height: 1.45; color: #c6d1e4; }
.mecha-pick-stats { display: grid; gap: 4px; margin-top: 2px; }
.mecha-pick-stat { display: grid; grid-template-columns: 28px 1fr 34px; gap: 6px; align-items: center; font-size: 9px; color: var(--wk-muted); }
.mecha-pick-stat-label { letter-spacing: .1em; }
.mecha-pick-track { display: block; height: 4px; overflow: hidden; border-radius: 2px; background: rgba(255, 255, 255, .12); }
.mecha-pick-fill { display: block; height: 100%; border-radius: 2px; }
.mecha-pick-stat-value { text-align: right; font-variant-numeric: tabular-nums; color: #fff; }
.mecha-loadout-actions { justify-content: center; gap: 12px; }
.mecha-loadout-actions .wk-button { min-width: 150px; white-space: nowrap; }

/* Touch controls */
.mecha-touch { position: absolute; inset: 0; display: none; pointer-events: none; touch-action: none; }
.mecha-root.is-touch .mecha-touch { display: block; }
.mecha-stick { position: absolute; left: max(18px, env(safe-area-inset-left)); bottom: max(18px, env(safe-area-inset-bottom)); width: 126px; height: 126px; pointer-events: auto; }
.mecha-stick-knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; background: radial-gradient(circle at 38% 34%, rgba(255, 255, 255, .55), rgba(120, 190, 255, .24) 62%, rgba(10, 20, 40, .72)); border: 1px solid rgba(255, 216, 107, .65); box-shadow: 0 0 18px rgba(90, 200, 255, .35); pointer-events: none; }
.mecha-stick-label { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: 9px; letter-spacing: .2em; color: rgba(255, 255, 255, .5); pointer-events: none; }
.mecha-actions { position: absolute; right: max(14px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); display: grid; grid-template-columns: repeat(2, 74px); gap: 10px; pointer-events: none; }
.mecha-actions .wk-action { width: 74px; height: 74px; font-size: 12px; letter-spacing: .04em; touch-action: none; }
.mecha-actions .wk-action.is-held { transform: scale(.96); filter: brightness(1.2); }
.mecha-root.is-touch .mecha-bottom { bottom: calc(190px + env(safe-area-inset-bottom)); }
.mecha-root.is-touch .mecha-hint { display: none; }

.mecha-result { display: grid; place-items: center; background: rgba(3, 7, 18, .66); backdrop-filter: blur(2px); }
.mecha-result-panel { width: min(92vw, 500px); display: grid; gap: 16px; justify-items: center; text-align: center; padding: clamp(20px, 4vw, 34px); }
.mecha-result-panel .wk-title { font-size: clamp(26px, 4vw, 40px); letter-spacing: .05em; }
.mecha-result--win .wk-title { color: #9ff5ff; text-shadow: 0 0 26px rgba(80, 220, 255, .6); }
.mecha-result--lose .wk-title { color: #ff7c86; text-shadow: 0 0 26px rgba(255, 80, 100, .5); }
.mecha-result-sub { margin: 0; font-size: 13px; color: #c8d3e6; }
.mecha-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; width: 100%; }
.mecha-stat { padding: 9px 6px; background: rgba(255, 255, 255, .05); border: 1px solid rgba(255, 255, 255, .12); }
.mecha-stat b { display: block; font-family: var(--wk-font-display); font-size: 21px; color: #fff; font-variant-numeric: tabular-nums; }
.mecha-stat span { font-size: 9px; letter-spacing: .16em; color: var(--wk-muted); }
.mecha-result-actions { justify-content: center; gap: 12px; }
.mecha-result-actions .wk-button { min-width: 150px; white-space: nowrap; }

@keyframes mecha-beat { 0%, 100% { transform: translate(-50%, -50%) scale(1); } 50% { transform: translate(-50%, -50%) scale(1.035); } }
@keyframes mecha-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }

@media (max-width: 820px) {
  .mecha-hint { display: none; }
  .mecha-top { gap: 8px; }
  .mecha-name { font-size: 9px; letter-spacing: .14em; }
  .mecha-boost { width: 44vw; }
  .mecha-ammo { width: 38vw; }
  .mecha-controls { grid-template-columns: 1fr; }
  .mecha-title { background: linear-gradient(90deg, rgba(3, 7, 18, .95), rgba(3, 7, 18, .6)); }
  .mecha-picks { grid-template-columns: 1fr; }
  .mecha-pick-blurb { min-height: 0; }
  .mecha-loadout-panel { max-height: 92vh; }
}

@media (max-height: 700px) {
  .mecha-title { padding: 18px clamp(20px, 5vw, 56px); }
  .mecha-title-inner { gap: 10px; }
  .mecha-logo { font-size: clamp(36px, 6vw, 64px); }
  .mecha-pitch { font-size: 12px; line-height: 1.5; }
  .mecha-control { padding: 6px 10px; }
}

@media (max-height: 520px) {
  .mecha-pitch, .mecha-controls, .mecha-foot { display: none; }
  .mecha-logo { font-size: 38px; }
  .mecha-title-inner { gap: 8px; }
  .mecha-loadout-panel { gap: 8px; padding: 12px 18px; }
  .mecha-pick-blurb { display: none; }
  .mecha-loadout-title { font-size: 24px; }
}
`;
