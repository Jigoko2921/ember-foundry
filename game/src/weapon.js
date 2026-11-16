// The armoury: one definition per gun, one mutable instance per shooter, and the
// first-person rig that draws the player's gun. Bullets are main.js's job; this module
// only owns magazines, cadence and the view model, so the numbers stay in one table.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Recoil values are in radians applied per shot; spread values are cone half-angles.
export const WEAPONS = {
  rifle: {
    id: 'rifle',
    name: 'VK-47',
    slot: 1,
    price: 2700,
    blurb: 'Rifle · 34 dmg · 600 rpm',
    damage: 34,
    headMultiplier: 3.2,
    legMultiplier: 0.72,
    rpm: 600,
    magSize: 30,
    reserve: 90,
    reloadTime: 2.0,
    spreadStill: 0.0016,
    spreadMoving: 0.03,
    recoilPitch: 0.0115,
    recoilYaw: 0.0038,
    range: 90,
    automatic: true,
    killReward: 300,
    sound: 'rifle',
  },
  smg: {
    id: 'smg',
    name: 'PDW-9',
    slot: 2,
    price: 1250,
    blurb: 'SMG · 21 dmg · 800 rpm',
    damage: 21,
    headMultiplier: 2.6,
    legMultiplier: 0.8,
    rpm: 800,
    magSize: 25,
    reserve: 100,
    reloadTime: 1.7,
    spreadStill: 0.0024,
    spreadMoving: 0.02,
    recoilPitch: 0.0072,
    recoilYaw: 0.0034,
    range: 60,
    automatic: true,
    killReward: 600,
    sound: 'smg',
  },
  pistol: {
    id: 'pistol',
    name: 'P9',
    slot: 3,
    price: 0,
    blurb: 'Sidearm · 26 dmg · semi',
    damage: 26,
    headMultiplier: 2.8,
    legMultiplier: 0.78,
    rpm: 400,
    magSize: 12,
    reserve: 36,
    reloadTime: 1.4,
    spreadStill: 0.0026,
    spreadMoving: 0.018,
    recoilPitch: 0.0105,
    recoilYaw: 0.003,
    range: 55,
    automatic: false,
    killReward: 300,
    sound: 'pistol',
  },
};

export const GRENADE = {
  id: 'he',
  name: 'HE Grenade',
  price: 300,
  blurb: 'Area damage · 6 m',
  damage: 92,
  radius: 6.2,
  fuse: 1.6,
};

// How far the body absorbs a hit, mirrored by player.js's damage().
export const ARMOR_PRICE = 650;

function buildModel(kind) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d242a'), roughness: 0.55, metalness: 0.45 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a545e'), roughness: 0.42, metalness: 0.55 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const model = new THREE.Group();

  if (kind === 'rifle') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.082, 0.34), steel);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.2), dark);
    handguard.position.set(0, 0.004, -0.24);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.2, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.012, -0.42);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.062, 0.2), dark);
    stock.position.set(0, -0.006, 0.25);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.13, 0.075), dark);
    mag.position.set(0, -0.095, -0.02);
    mag.rotation.x = 0.14;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.03, 0.05), steel);
    sight.position.set(0, 0.058, -0.02);
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.004), glow);
    dot.position.set(0, 0.062, -0.046);
    model.add(receiver, handguard, barrel, stock, mag, sight, dot);
  } else if (kind === 'smg') {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.072, 0.24), steel);
    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.046, 0.14), dark);
    shroud.position.set(0, 0.006, -0.18);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.1, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -0.28);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.17, 0.06), dark);
    mag.position.set(0, -0.115, 0.0);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), dark);
    brace.position.set(0, -0.01, 0.17);
    model.add(receiver, shroud, barrel, mag, brace);
  } else {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.19), steel);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.03, 0.14), dark);
    frame.position.set(0, -0.035, 0.015);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.1, 0.05), dark);
    grip.position.set(0, -0.085, 0.055);
    grip.rotation.x = -0.22;
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.003), glow);
    dot.position.set(0, 0.028, -0.088);
    model.add(slide, frame, grip, dot);
  }

  // Right-handed hold: low and right of the eye, so the barrel points down the camera axis.
  model.position.set(0.17, -0.155, -0.42);
  model.rotation.y = 0.045;
  return model;
}

// A soft four-point star rather than a flat quad: an additive square reads as a bug,
// a gradient star reads as a muzzle flash.
function flashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255,252,238,1)');
  glow.addColorStop(0.22, 'rgba(255,214,130,0.85)');
  glow.addColorStop(0.55, 'rgba(255,128,44,0.3)');
  glow.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255,246,226,0.85)';
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2;
    ctx.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
    ctx.lineTo(64 + Math.cos(a + Math.PI / 4) * 12, 64 + Math.sin(a + Math.PI / 4) * 12);
  }
  ctx.closePath();
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWeaponRig(camera) {
  const models = {};
  for (const kind of Object.keys(WEAPONS)) {
    const model = buildModel(kind);
    model.visible = false;
    model.traverse((mesh) => { if (mesh.isMesh) mesh.frustumCulled = false; });
    camera.add(model);
    models[kind] = model;
  }

  const muzzle = new THREE.Mesh(
    new THREE.PlaneGeometry(0.13, 0.13),
    new THREE.MeshBasicMaterial({
      map: flashTexture(),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  muzzle.position.set(0.175, -0.152, -0.93);
  muzzle.visible = false;
  camera.add(muzzle);

  const muzzleLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 7, 2);
  muzzleLight.position.set(0.16, -0.1, -0.7);
  camera.add(muzzleLight);

  let visibleKind = null;

  function show(kind) {
    if (visibleKind === kind) return;
    for (const key of Object.keys(models)) models[key].visible = key === kind;
    visibleKind = kind;
  }

  function pose(state, time, speed) {
    const model = models[state.def.id];
    if (!model) return;
    // Kick pulls the gun back and up; the sway keeps a moving player from feeling rigid.
    const swayX = Math.sin(time * 2.1) * 0.004;
    const swayY = Math.sin(time * 2.9) * 0.003;
    const bob = Math.min(1, speed / 5.3) * 0.012;
    model.position.set(0.17 + swayX, -0.155 + swayY - bob * 0.4, -0.42 + state.kick * 0.6);
    model.rotation.x = state.kick * 1.9;
    model.rotation.z = swayX * 1.5;
    muzzle.visible = state.flash > 0;
    muzzle.rotation.z = state.flash * 42;
    muzzle.scale.setScalar(state.flash > 0 ? 1 : 0.001);
    muzzleLight.intensity = state.flash > 0 ? 12 : 0;
  }

  return { models, show, pose, muzzle, muzzleLight };
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
  if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);
  state.kick += (0 - state.kick) * Math.min(1, dt * 16);
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
  state.flash = 0.05;
  state.kick = 0.055;
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

// 0..1 for the HUD; 0 when not reloading.
export function reloadProgress(state) {
  if (state.reloadLeft <= 0) return 0;
  return 1 - state.reloadLeft / state.def.reloadTime;
}

export function weaponSpread(state, speed) {
  const def = state.def;
  return def.spreadStill + Math.min(1, speed / 5.3) * def.spreadMoving;
}
