// Weapons and the buy menu's catalogue. Each definition owns its numbers; a runtime
// instance owns the magazine, the cooldown and the view model. main.js owns the ray.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'VK-47',
    slot: 1,
    price: 2700,
    damage: 34,
    headMultiplier: 3.2,
    legMultiplier: 0.72,
    rpm: 600,
    magSize: 30,
    reserve: 90,
    reloadTime: 2.0,
    spreadStill: 0.0018,
    spreadMoving: 0.032,
    recoilPitch: 0.0125,
    recoilYaw: 0.004,
    range: 90,
    automatic: true,
    killReward: 300,
  },
  smg: {
    id: 'smg',
    name: 'PDW-9',
    slot: 2,
    price: 1250,
    damage: 21,
    headMultiplier: 2.6,
    legMultiplier: 0.8,
    rpm: 800,
    magSize: 25,
    reserve: 100,
    reloadTime: 1.7,
    spreadStill: 0.0026,
    spreadMoving: 0.022,
    recoilPitch: 0.008,
    recoilYaw: 0.0038,
    range: 60,
    automatic: true,
    killReward: 600,
  },
  pistol: {
    id: 'pistol',
    name: 'P9',
    slot: 3,
    price: 0,
    damage: 26,
    headMultiplier: 2.8,
    legMultiplier: 0.78,
    rpm: 400,
    magSize: 12,
    reserve: 36,
    reloadTime: 1.4,
    spreadStill: 0.003,
    spreadMoving: 0.02,
    recoilPitch: 0.011,
    recoilYaw: 0.003,
    range: 55,
    automatic: false,
    killReward: 300,
  },
};

export const GRENADE = {
  id: 'he',
  name: 'HE Grenade',
  price: 300,
  damage: 88,
  radius: 6.2,
  fuse: 1.6,
};

function buildModel(kind) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.3 });
  const light = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const model = new THREE.Group();
  if (kind === 'rifle') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.44), light);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.042, 0.42), dark);
    barrel.position.set(0, 0.026, -0.4);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.085, 0.24), dark);
    stock.position.set(0, -0.02, 0.31);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.1), dark);
    mag.position.set(0, -0.12, 0.02);
    model.add(receiver, barrel, stock, mag);
  } else if (kind === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.3), light);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.036, 0.22), dark);
    barrel.position.set(0, 0.02, -0.24);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.08), dark);
    mag.position.set(0, -0.14, 0);
    model.add(receiver, barrel, mag);
  } else {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.06, 0.24), light);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), dark);
    grip.position.set(0, -0.09, 0.06);
    model.add(slide, grip);
  }
  model.position.set(0.26, -0.24, -0.5);
  model.scale.setScalar(1.7);
  return model;
}

export function createWeaponRig(camera) {
  const models = {};
  for (const kind of Object.keys(WEAPONS)) {
    const model = buildModel(kind);
    model.visible = false;
    camera.add(model);
    models[kind] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.23, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.23, -0.16, -0.6);
  camera.add(flashLight);

  let visibleKind = null;

  function show(kind) {
    if (visibleKind === kind) return;
    for (const key of Object.keys(models)) models[key].visible = key === kind;
    visibleKind = kind;
  }

  return { models, show, flash, flashLight };
}

export function createWeaponState(def) {
  return {
    def,
    mag: def.magSize,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };
}

export function stepWeapon(state, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.flash = Math.max(0, state.flash - dt);
  state.kick += (0 - state.kick) * Math.min(1, dt * 14);
  if (state.reloadLeft > 0) {
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    if (state.reloadLeft === 0) {
      const need = state.def.magSize - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
}

export function weaponReady(state) {
  return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
}

export function pullTrigger(state) {
  state.cooldown = 60 / state.def.rpm;
  state.flash = 0.055;
  state.kick = 0.05;
}

export function takeRound(state) {
  if (state.mag <= 0) return false;
  state.mag -= 1;
  return true;
}

export function startReload(state) {
  if (state.reloadLeft > 0 || state.mag === state.def.magSize || state.reserve === 0) return false;
  state.reloadLeft = state.def.reloadTime;
  return true;
}

export function weaponSpread(state, speed) {
  const def = state.def;
  return def.spreadStill + Math.min(1, speed / 5.4) * def.spreadMoving;
}
