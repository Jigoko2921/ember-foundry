// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// The simulation owns every number; this file only wires the modules together and traces
// shots against the same world the bots walk.
//
// Order inside a step matters and is deliberate: move bodies, sync the hitboxes to those
// bodies, then resolve every shot against the fresh positions. Shooting first would let a
// bullet hit where a body was last frame.
import * as THREE from 'three';
import { PALETTE, TEAM_COLOR } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createBody } from './player.js';
import {
  createWeaponRig, createWeaponState, stepWeapon, weaponReady, pullTrigger, takeRound,
  startReload, weaponSpread, reloadProgress, WEAPONS, GRENADE, ARMOR_PRICE,
} from './weapon.js';
import { createBot } from './bot.js';
import { createMatch, PHASE } from './round.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 5;
const HUD_INTERVAL = 0.05;

const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
// Screenshots are captured a frame after load, so CSS animations would be caught mid-way
// in (a banner at 10% opacity, a feed row half slid in). Shot mode renders final states.
if (shotMode) document.body.classList.add('shot-mode');

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// --- renderer, scene, camera -------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color('#6b5a58'), 26, 92);

// A dusk dome instead of a flat clear colour: the horizon burns, the zenith cools, and
// every silhouette in the yard gains a rim. One draw call, no texture, no light cost.
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(240, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color('#16233b') },
        haze: { value: new THREE.Color('#7c6370') },
        ember: { value: new THREE.Color('#e8975a') },
      },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 zenith; uniform vec3 haze; uniform vec3 ember; varying vec3 vDir;',
        'void main() {',
        '  float h = normalize(vDir).y;',
        '  vec3 c = h > 0.0 ? mix(haze, zenith, pow(h, 0.55)) : mix(haze, ember, pow(-h, 0.75));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}',
      ].join('\n'),
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);
}

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 180);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const match = createMatch();
const audio = createAudio();

// --- bodies, models and hitboxes ---------------------------------------------
const bodies = [];
const rigs = new Map();
const shotTargets = [];
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();

const kits = new Map();
function teamKit(team) {
  let kit = kits.get(team);
  if (kit) return kit;
  const base = new THREE.Color(TEAM_COLOR[team]);
  kit = {
    cloth: new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.3), roughness: 0.9, metalness: 0.04 }),
    plate: new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.55), roughness: 0.6, metalness: 0.25 }),
    trim: new THREE.MeshStandardMaterial({ color: base, emissive: base, emissiveIntensity: 0.32, roughness: 0.45 }),
    skin: new THREE.MeshStandardMaterial({ color: new THREE.Color('#7d6a58'), roughness: 0.92 }),
    steel: new THREE.MeshStandardMaterial({ color: new THREE.Color('#20262c'), roughness: 0.55, metalness: 0.4 }),
  };
  kits.set(team, kit);
  return kit;
}

function buildSoldier(team) {
  const kit = teamKit(team);
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.28), kit.cloth);
  torso.position.y = 1.16;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.38, 0.34), kit.plate);
  vest.position.y = 1.21;
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.3), kit.trim);
  shoulders.position.y = 1.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 10), kit.skin);
  head.position.y = 1.61;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), kit.plate);
  helmet.position.y = 1.63;
  const legs = [];
  const arms = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.82, 0.22), kit.cloth);
    leg.position.set(side * 0.12, 0.41, 0);
    // Arms in plate, not cloth: at range the lighter sleeves are what make the silhouette
    // read as a soldier instead of a rounded block.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.15), kit.plate);
    arm.position.set(side * 0.31, 1.16, 0);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.19), kit.plate);
    pad.position.set(side * 0.3, 1.41, 0);
    legs.push(leg);
    arms.push(arm, pad);
    group.add(leg, arm, pad);
  }
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.1), kit.trim);
  brim.position.set(0, 1.66, -0.14);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.12), kit.steel);
  pack.position.set(0, 1.2, 0.2);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), kit.steel);
  gun.position.set(0.24, 1.16, -0.26);
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.3), kit.steel);
  bootL.position.set(-0.12, 0.05, -0.04);
  const bootR = bootL.clone();
  bootR.position.x = 0.12;
  group.add(torso, vest, shoulders, head, helmet, brim, pack, gun, bootL, bootR);
  // A crouch bends the legs and drops everything above the hips, so the model keeps its
  // proportions instead of being squashed by a scale on the whole group.
  group.userData.legs = legs;
  group.userData.upper = [torso, vest, shoulders, head, helmet, brim, pack, gun, ...arms];
  for (const part of [...group.userData.upper, ...legs]) part.userData.baseY = part.position.y;
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return group;
}

// Hitboxes are real meshes so main can raycast them, but they never write a pixel.
const hitMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

function buildHitboxes(body) {
  const group = new THREE.Group();
  const parts = [
    ['torso', new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.8, 0.4), hitMaterial), 1.12],
    ['head', new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), hitMaterial), 1.62],
    ['legs', new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.74, 0.3), hitMaterial), 0.4],
  ].map(([part, mesh, y]) => {
    mesh.position.y = y;
    mesh.userData = { body, part, baseY: y };
    group.add(mesh);
    return mesh;
  });
  scene.add(group);
  return { group, parts };
}

function registerBody(body) {
  bodies.push(body);
  const rig = { model: buildSoldier(body.team), hitbox: buildHitboxes(body), crouched: false };
  rigs.set(body.id, rig);
  shotTargets.push(...rig.hitbox.parts);
  match.registerPlayer(body.id, body.team);
}

// The player holds the south yard with two CT bots; three T bots push from the north.
const playerCtl = createBody(world.colliders, world.spawns.ct[0], 'ct');
const playerBody = playerCtl.state;
playerBody.name = 'YOU';
registerBody(playerBody);

const ctBots = [
  createBot({ colliders: world.colliders, spawn: world.spawns.ct[1], team: 'ct', waypoints: world.waypoints, role: 'rifle', skill: 0.64 }),
  createBot({ colliders: world.colliders, spawn: world.spawns.ct[2], team: 'ct', waypoints: world.waypoints, role: 'smg', skill: 0.52 }),
];
const tBots = [
  createBot({ colliders: world.colliders, spawn: world.spawns.t[0], team: 't', waypoints: world.waypoints, role: 'rifle', skill: 0.6 }),
  createBot({ colliders: world.colliders, spawn: world.spawns.t[1], team: 't', waypoints: world.waypoints, role: 'rifle', skill: 0.46 }),
  createBot({ colliders: world.colliders, spawn: world.spawns.t[2], team: 't', waypoints: world.waypoints, role: 'smg', skill: 0.68 }),
];
const bots = [...ctBots, ...tBots];
for (const bot of bots) registerBody(bot.body);
shotTargets.push(...world.shootables);

// --- the player's kit --------------------------------------------------------
const rig = createWeaponRig(camera);
// Each owned gun keeps its own magazine, so switching pistols never refills a rifle.
const inventory = { pistol: createWeaponState(WEAPONS.pistol), rifle: null, smg: null };
let playerWeapon = inventory.pistol;
let grenades = 0;
let smokeCount = 0;
let flashCount = 0;
let grenadeKind = 'he';
rig.show('pistol');

// --- input -------------------------------------------------------------------
let started = false;
let paused = false;
let buyOpen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();

const input = createInput(renderer.domElement, {
  onLockChange(locked) {
    if (shotMode) return;
    if (locked) {
      paused = false;
      hud.hideOverlay();
    } else if (started && !buyOpen && match.state.phase !== PHASE.END) {
      paused = true;
      hud.showOverlay('paused');
    }
  },
  onKey(code) {
    if (shotMode) return;
    if (code === 'KeyB') toggleBuy();
    if (code === 'KeyG') throwGrenade();
    if (code === 'Digit1') selectWeapon('rifle');
    if (code === 'Digit2') selectWeapon('smg');
    if (code === 'Digit3') selectWeapon('pistol');
    if (code === 'Digit4') {
      grenadeKind = grenadeKind === 'he' ? 'smoke' : grenadeKind === 'smoke' ? 'flash' : 'he';
      hud.radio(`Utility ready: ${grenadeKind === 'he' ? 'frag' : grenadeKind}`, null);
    }
    if (code === 'Tab') hud.showBoard(scoreRows());
  },
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Tab') hud.hideBoard();
});

// --- combat ------------------------------------------------------------------
function partMultiplier(def, part) {
  if (part === 'head') return def.headMultiplier;
  if (part === 'legs') return def.legMultiplier;
  return 1;
}

const traceResult = { body: null, part: 'torso', point: new THREE.Vector3(), distance: 0 };

// Nearest hit wins: a body part stops the bullet, and so does the first piece of world
// geometry. A dead body or the shooter itself is passed through, not blocked.
function traceShot(origin, direction, range, shooter) {
  raycaster.set(origin, direction);
  raycaster.far = range;
  const hits = raycaster.intersectObjects(shotTargets, false);
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    const data = hit.object.userData;
    if (data.body) {
      if (data.body === shooter || !data.body.alive) continue;
      traceResult.body = data.body;
      traceResult.part = data.part;
      traceResult.point.copy(hit.point);
      traceResult.distance = hit.distance;
      return traceResult;
    }
    traceResult.body = null;
    traceResult.point.copy(hit.point);
    traceResult.distance = hit.distance;
    return traceResult;
  }
  return null;
}

function awardKill(shooter, victim, reward) {
  shooter.kills += 1;
  victim.deaths += 1;
  match.addMoney(shooter.id, reward);
  const shooterName = shooter.id === playerBody.id ? 'YOU' : shooter.name;
  const victimName = victim.id === playerBody.id ? 'YOU' : victim.name;
  hud.killFeed(`<span class="${shooter.team}">${shooterName}</span> ▸ <span class="${victim.team}">${victimName}</span>`);
  if (shooter.id === playerBody.id) audio.kill();
  if (victim.id === playerBody.id) {
    hud.banner('ELIMINATED', 'You are out until the next round', 't');
    hud.setAction(null, 0);
  }
}

// Returns 0 for a miss, 1 for a wall, 2 for a body hit, 3 for a kill.
function applyShot(shooter, def, spread) {
  const origin = tempA.set(shooter.position.x, shooter.position.y + shooter.eye, shooter.position.z);
  const direction = tempB.set(
    -Math.sin(shooter.yaw) * Math.cos(shooter.pitch),
    Math.sin(shooter.pitch),
    -Math.cos(shooter.yaw) * Math.cos(shooter.pitch),
  );
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();

  const hit = traceShot(origin, direction, def.range, shooter);
  if (!hit) return 0;
  if (hit.point) spark(hit.point);
  if (!hit.body) return 1;

  const victim = hit.body;
  victim.lastHitAt = elapsed;
  victim.lastHitX = shooter.position.x;
  victim.lastHitZ = shooter.position.z;
  const killed = victim.hurt(def.damage * partMultiplier(def, hit.part));
  if (victim.id === playerBody.id) hud.flashDamage();
  if (killed) awardKill(shooter, victim, def.killReward);
  else if (shooter.id === playerBody.id) audio.hit();
  return killed ? 3 : 2;
}

function playerShoot() {
  if (!playerBody.alive || !weaponReady(playerWeapon)) return false;
  if (!takeRound(playerWeapon)) {
    audio.empty();
    return false;
  }
  pullTrigger(playerWeapon);
  const def = playerWeapon.def;
  const speed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
  const result = applyShot(playerBody, def, weaponSpread(playerWeapon, speed));
  playerBody.pitch = Math.min(1.45, playerBody.pitch + def.recoilPitch);
  playerBody.yaw += (random() * 2 - 1) * def.recoilYaw;
  audio.shot(def.sound);
  if (result >= 2) hud.hitMarker(result === 3);
  pushSound(playerBody.position.x, playerBody.position.z, 'ct', 44);
  return true;
}

function botShoot(bot) {
  if (!weaponReady(bot.weapon)) return;
  bot.onFired();
  applyShot(bot.body, bot.weapon.def, bot.spread());
  pushSound(bot.body.position.x, bot.body.position.z, bot.body.team, bot.weapon.def.range * 0.5);
}

// --- sparks: a pooled impact flash, so a firefight costs no allocations -----------
const sparkTexture = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,236,200,1)');
  gradient.addColorStop(0.4, 'rgba(255,150,60,0.7)');
  gradient.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
})();

const sparks = [];
for (let i = 0; i < 8; i += 1) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: sparkTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  mesh.visible = false;
  scene.add(mesh);
  sparks.push({ mesh, born: -9 });
}
let sparkCursor = 0;

function spark(point) {
  const item = sparks[sparkCursor];
  sparkCursor = (sparkCursor + 1) % sparks.length;
  item.born = elapsed;
  item.mesh.position.copy(point);
  item.mesh.visible = true;
}

function updateSparks() {
  for (const item of sparks) {
    const life = elapsed - item.born;
    if (life > 0.2) {
      if (item.mesh.visible) item.mesh.visible = false;
      continue;
    }
    item.mesh.scale.setScalar(0.6 + life * 5);
    item.mesh.material.opacity = 1 - life / 0.2;
    item.mesh.quaternion.copy(camera.quaternion);
  }
}

// --- grenades ----------------------------------------------------------------
const grenadeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.13, 10, 8),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3 }),
);
const liveGrenades = [];
const blastMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 14, 10),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
);
blastMesh.visible = false;
scene.add(blastMesh);
let blastAt = -9;

function blockedAt(x, y, z, radius) {
  for (const box of world.colliders) {
    if (x + radius > box.min.x && x - radius < box.max.x
      && y + radius > box.min.y && y - radius < box.max.y
      && z + radius > box.min.z && z - radius < box.max.z) return true;
  }
  return false;
}

function throwGrenade() {
  if (shotMode || !playerBody.alive || buyOpen) return;
  if (match.state.phase !== PHASE.LIVE) return;
  let kind = grenadeKind;
  if (kind === 'he' && grenades <= 0) kind = smokeCount > 0 ? 'smoke' : flashCount > 0 ? 'flash' : 'he';
  if (kind === 'smoke' && smokeCount <= 0) kind = grenades > 0 ? 'he' : flashCount > 0 ? 'flash' : 'smoke';
  if (kind === 'flash' && flashCount <= 0) kind = grenades > 0 ? 'he' : smokeCount > 0 ? 'smoke' : 'flash';
  if (kind === 'he' && grenades <= 0) return;
  if (kind === 'smoke' && smokeCount <= 0) return;
  if (kind === 'flash' && flashCount <= 0) return;
  if (kind === 'he') grenades -= 1;
  else if (kind === 'smoke') smokeCount -= 1;
  else flashCount -= 1;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const mesh = grenadeMesh.clone();
  if (kind === 'smoke') {
    mesh.material = smokeShellMaterial;
  } else if (kind === 'flash') {
    mesh.material = flashShellMaterial;
  }
  mesh.position.copy(camera.position).addScaledVector(direction, 0.55);
  scene.add(mesh);
  liveGrenades.push({
    mesh,
    kind,
    vx: direction.x * 17,
    vy: direction.y * 17 + 3.4,
    vz: direction.z * 17,
    fuse: kind === 'smoke' ? GRENADE.fuse * 0.75 : kind === 'flash' ? GRENADE.fuse * 0.85 : GRENADE.fuse,
  });
}

function explodeGrenade(grenade) {
  const { x, y, z } = grenade.mesh.position;
  scene.remove(grenade.mesh);
  blastMesh.position.set(x, y, z);
  blastMesh.visible = true;
  blastAt = elapsed;
  audio.explode();
  pushSound(x, z, playerBody.team, 60);
  for (const body of bodies) {
    if (!body.alive || (body.team === playerBody.team && body !== playerBody)) continue;
    const distance = Math.hypot(body.position.x - x, body.position.z - z);
    if (distance > GRENADE.radius) continue;
    const falloff = 1 - distance / GRENADE.radius;
    const killed = body.hurt(GRENADE.damage * falloff);
    if (body.id === playerBody.id) hud.flashDamage();
    if (killed) awardKill(playerBody, body, 300);
  }
}

function stepGrenades(dt) {
  for (let i = liveGrenades.length - 1; i >= 0; i -= 1) {
    const grenade = liveGrenades[i];
    grenade.fuse -= dt;
    grenade.vy -= 18 * dt;
    const nextX = grenade.mesh.position.x + grenade.vx * dt;
    const nextY = grenade.mesh.position.y + grenade.vy * dt;
    const nextZ = grenade.mesh.position.z + grenade.vz * dt;
    if (blockedAt(nextX, grenade.mesh.position.y, grenade.mesh.position.z, 0.13)) grenade.vx *= -0.45;
    else grenade.mesh.position.x = nextX;
    if (blockedAt(grenade.mesh.position.x, grenade.mesh.position.y, nextZ, 0.13)) grenade.vz *= -0.45;
    else grenade.mesh.position.z = nextZ;
    if (nextY < 0.14) {
      grenade.mesh.position.y = 0.14;
      grenade.vy *= -0.35;
      grenade.vx *= 0.72;
      grenade.vz *= 0.72;
    } else if (blockedAt(grenade.mesh.position.x, nextY, grenade.mesh.position.z, 0.13)) {
      grenade.vy *= -0.4;
    } else {
      grenade.mesh.position.y = nextY;
    }
    if (grenade.fuse <= 0) {
      if (grenade.kind === 'smoke') {
        const { x, y, z } = grenade.mesh.position;
        scene.remove(grenade.mesh);
        spawnSmoke(x, y, z);
        audio.explode();
        pushSound(x, z, playerBody.team, 26);
      } else if (grenade.kind === 'flash') {
        const { x, y, z } = grenade.mesh.position;
        scene.remove(grenade.mesh);
        popFlash(x, y, z);
      } else {
        explodeGrenade(grenade);
      }
      liveGrenades.splice(i, 1);
    }
  }
}

// --- smoke -------------------------------------------------------------------
// A smoke is seven soft spheres that grow, drift and fade. It is also a real occluder:
// smokeBlocks() tests the segment a bot is looking along, so the cloud breaks sight the
// same way a wall does. One puff count, one material each, no per-frame allocation.
const SMOKE_LIFE = 14;
const SMOKE_RADIUS = 3.6;
const smokes = [];
const smokeShellMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#cfd6d9'),
  emissive: new THREE.Color('#8fa0a6'),
  emissiveIntensity: 0.25,
  roughness: 0.9,
});

// A soft round falloff, painted once into a canvas: sprite puffs then read as smoke
// instead of a pile of grey spheres, and every puff is still one billboard draw.
function smokeTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const SMOKE_TEX = smokeTexture();

const flashShellMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#e9e5dd'),
  emissive: new THREE.Color('#ffffff'),
  emissiveIntensity: 0.55,
  roughness: 0.35,
  metalness: 0.25,
});

const FLASH_RADIUS = 10;

// A flash does not damage: it takes the eyes away. The player gets a white-out scaled by
// distance, a bot loses its firing and its push for a second or three.
function popFlash(x, y, z) {
  audio.explode();
  pushSound(x, z, playerBody.team, 44);
  const pd = Math.hypot(playerBody.position.x - x, playerBody.position.z - z);
  if (pd < FLASH_RADIUS) hud.blind(Math.min(0.96, 1 - pd / FLASH_RADIUS + 0.15));
  for (const bot of bots) {
    const d = Math.hypot(bot.body.position.x - x, bot.body.position.z - z);
    if (d < FLASH_RADIUS) bot.body.flashUntil = elapsed + 1.1 + (1 - d / FLASH_RADIUS) * 2.4;
  }
}

function spawnSmoke(x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, Math.max(1.3, y + 0.2), z);
  const puffs = [];
  for (let i = 0; i < 9; i += 1) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({
      map: SMOKE_TEX,
      color: new THREE.Color(i % 2 ? '#d9d4cb' : '#b3ada6'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    const angle = (i / 9) * Math.PI * 2;
    const ring = 0.6 + (i % 3) * 0.5;
    puff.position.set(Math.cos(angle) * ring, (i % 4) * 0.34, Math.sin(angle) * ring);
    group.add(puff);
    puffs.push(puff);
  }
  scene.add(group);
  smokes.push({ group, puffs, born: elapsed, x, y: group.position.y, z, drift: (smokes.length % 5) * 0.7 });
}

function updateSmoke() {
  for (let i = smokes.length - 1; i >= 0; i -= 1) {
    const cloud = smokes[i];
    const age = elapsed - cloud.born;
    if (age > SMOKE_LIFE) {
      scene.remove(cloud.group);
      for (const puff of cloud.puffs) puff.material.dispose();
      smokes.splice(i, 1);
      continue;
    }
    const grow = Math.min(1, age / 1.3);
    const fade = age > SMOKE_LIFE - 2.2 ? (SMOKE_LIFE - age) / 2.2 : 1;
    const scale = (1.2 + grow * 2.4) * (1 + age * 0.035);
    cloud.group.rotation.y = age * 0.12 + cloud.drift;
    for (let p = 0; p < cloud.puffs.length; p += 1) {
      const puff = cloud.puffs[p];
      const wobble = 0.86 + 0.14 * Math.sin(age * 0.9 + p);
      puff.scale.set(scale * wobble, scale * wobble, 1);
      puff.material.opacity = 0.44 * grow * fade;
    }
  }
}

// Distance from the cloud centre to the ray, not a sphere overlap: a bot behind the smoke
// stays blind even when its eye is technically outside the sphere's radius.
function smokeBlocks(eye, dir, distance) {
  for (const cloud of smokes) {
    const px = cloud.x - eye.x;
    const py = cloud.y - eye.y;
    const pz = cloud.z - eye.z;
    const t = Math.max(0, Math.min(distance, px * dir.x + py * dir.y + pz * dir.z));
    const cx = px - dir.x * t;
    const cy = py - dir.y * t;
    const cz = pz - dir.z * t;
    if (cx * cx + cy * cy + cz * cz < SMOKE_RADIUS * SMOKE_RADIUS) return true;
  }
  return false;
}

// --- buy menu ----------------------------------------------------------------
const ICON = {
  rifle: '<svg viewBox="0 0 24 24"><path d="M2 10.6h11.1l2.6-1.9H22v2.7h-3.1l-2.2 2.2h-3.2l-1.6 3.4H9.1l1.3-3.4H7.4L6 16.1H3.8l1.5-3.7H2z"/></svg>',
  smg: '<svg viewBox="0 0 24 24"><path d="M3.4 10.8h8.9l2.4-1.7h5.7v2.5h-3.2l-1.9 2.1h-2.8l-1.2 3.6H9.1l1-3.6H6.6l-1.1 3.6H3.4l1.3-4H3.4z"/></svg>',
  he: '<svg viewBox="0 0 24 24"><circle cx="11" cy="14" r="5.2"/><rect x="9.7" y="5.2" width="2.6" height="3.4" rx=".6"/><rect x="14.4" y="6.6" width="4.2" height="1.6" rx=".6"/><rect x="15.6" y="8.2" width="1.6" height="2.2" rx=".5"/></svg>',
  smoke: '<svg viewBox="0 0 24 24"><rect x="8.2" y="7.4" width="7.6" height="11.4" rx="2.4"/><rect x="10.4" y="3.8" width="3.2" height="3.2" rx=".7"/><rect x="9.4" y="10.6" width="5.2" height="1.4" rx=".6" opacity=".55"/><rect x="9.4" y="13.2" width="5.2" height="1.4" rx=".6" opacity=".55"/></svg>',
  flash: '<svg viewBox="0 0 24 24"><path d="M12 2.6l1.9 5.1 5.2-1.8-1.9 5.1 5.1 2-5.1 1.9 1.8 5.2-5.1-1.9-1.9 5.1-1.9-5.1-5.1 1.9 1.8-5.2-5.1-1.9 5.1-2-1.9-5.1 5.2 1.8z"/></svg>',
  armor: '<svg viewBox="0 0 24 24"><path d="M8.2 3.6L12 5.2l3.8-1.6 3.4 4-1.9 3.2v8.6H6.7v-8.6L4.8 7.6z"/></svg>',
};

const BUY_ITEMS = [
  { id: 'rifle', name: WEAPONS.rifle.name, sub: WEAPONS.rifle.blurb, price: WEAPONS.rifle.price, icon: ICON.rifle },
  { id: 'smg', name: WEAPONS.smg.name, sub: WEAPONS.smg.blurb, price: WEAPONS.smg.price, icon: ICON.smg },
  { id: 'grenade', name: GRENADE.name, sub: GRENADE.blurb, price: GRENADE.price, icon: ICON.he },
  { id: 'flash', name: 'Flash Grenade', sub: 'Flash · blinds 2.5s · $200', price: 200, icon: ICON.flash },
  { id: 'smoke', name: 'Smoke Grenade', sub: 'Smoke · 14s cloud · breaks sight', price: 300, icon: ICON.smoke },
  { id: 'armor', name: 'Kevlar Vest', sub: 'Absorbs 45% of every hit', price: ARMOR_PRICE, icon: ICON.armor },
];

function toggleBuy() {
  if (match.state.phase !== PHASE.BUY || !playerBody.alive) return;
  if (buyOpen) closeBuy();
  else openBuy();
}

function openBuy() {
  buyOpen = true;
  hud.openBuy(BUY_ITEMS, match.moneyOf(playerBody.id), `Balance $${match.moneyOf(playerBody.id)} · buy phase`);
  input.releaseLock();
}

function closeBuy() {
  buyOpen = false;
  hud.closeBuy();
  if (!shotMode) input.requestLock();
}

function buy(item) {
  const id = playerBody.id;
  if (item === 'rifle' && match.spend(id, WEAPONS.rifle.price)) {
    inventory.rifle = createWeaponState(WEAPONS.rifle);
    playerWeapon = inventory.rifle;
    rig.show('rifle');
  } else if (item === 'smg' && match.spend(id, WEAPONS.smg.price)) {
    inventory.smg = createWeaponState(WEAPONS.smg);
    playerWeapon = inventory.smg;
    rig.show('smg');
  } else if (item === 'grenade' && match.spend(id, GRENADE.price)) {
    grenades += 1;
  } else if (item === 'smoke' && match.spend(id, 300)) {
    smokeCount += 1;
    grenadeKind = 'smoke';
  } else if (item === 'flash' && match.spend(id, 200)) {
    flashCount += 1;
    grenadeKind = 'flash';
  } else if (item === 'armor' && match.spend(id, ARMOR_PRICE)) {
    playerBody.armor = 100;
  }
  openBuy();
}

function selectWeapon(kind) {
  if (buyOpen || match.state.phase === PHASE.BUY) return;
  const weapon = inventory[kind];
  if (!weapon || weapon === playerWeapon) return;
  playerWeapon = weapon;
  rig.show(kind);
}

hud.onBuy(buy);
hud.onCloseBuy(closeBuy);
hud.onPlay(() => {
  audio.unlock();
  hud.hideOverlay();
  started = true;
  paused = false;
  if (!shotMode) input.requestLock();
});

// --- round wiring ------------------------------------------------------------
function nearestSite(position) {
  for (const site of world.sites) {
    if (Math.hypot(site.x - position.x, site.z - position.z) <= site.radius) return site;
  }
  return null;
}

let attackSite = 'A';

function respawnAll() {
  const ctSpawns = world.spawns.ct;
  const tSpawns = world.spawns.t;
  playerCtl.respawn(ctSpawns[0]);
  inventory.pistol = createWeaponState(WEAPONS.pistol);
  inventory.rifle = null;
  inventory.smg = null;
  playerWeapon = inventory.pistol;
  grenades = 0;
  smokeCount = 0;
  flashCount = 0;
  grenadeKind = 'he';
  rig.show('pistol');

  ctBots[0].body.place(ctSpawns[1]);
  ctBots[1].body.place(ctSpawns[2]);
  tBots.forEach((bot, i) => bot.body.place(tSpawns[i % tSpawns.length]));

  for (const bot of bots) {
    bot.weapon.mag = bot.weapon.def.magSize;
    bot.weapon.reserve = bot.weapon.def.reserve;
    bot.weapon.reloadLeft = 0;
    bot.weapon.cooldown = 0;
    bot.brain.route = [];
    bot.brain.goalId = null;
    bot.brain.repathAt = 0;
    bot.brain.target = null;
    bot.brain.state = 'route';
    bot.brain.lane = null;
  }
  ctBots[0].brain.holdPoint = 'a-site';
  ctBots[1].brain.holdPoint = 'b-site';
  attackSite = random() < 0.5 ? 'A' : 'B';
  // The entry pushes the lane nearest the attack; the second T takes mid and pinches.
  tBots[0].brain.lane = attackSite === 'A' ? 'a-long-gate' : 'b-gate';
  tBots[1].brain.lane = 'mid-center';
  match.resetBomb();
  hud.bombBanner(false);
  hud.setAction(null, 0);
}

function scoreRows() {
  const rows = [{
    name: 'YOU',
    team: 'ct',
    kills: playerBody.kills,
    deaths: playerBody.deaths,
    health: Math.round(playerBody.health),
    alive: playerBody.alive,
  }];
  for (const bot of bots) {
    rows.push({
      name: bot.name,
      team: bot.body.team,
      kills: bot.body.kills,
      deaths: bot.body.deaths,
      health: Math.round(bot.body.health),
      alive: bot.body.alive,
    });
  }
  return rows;
}

// --- sounds: a fixed pool, so a firefight allocates nothing -------------------
const soundPool = [];
const activeSounds = [];
let soundCount = 0;

function pushSound(x, z, team, radius) {
  const sound = soundPool[soundCount] ?? (soundPool[soundCount] = { x: 0, z: 0, team: '', at: 0, radius: 0 });
  sound.x = x;
  sound.z = z;
  sound.team = team;
  sound.at = elapsed;
  sound.radius = radius;
  soundCount += 1;
  activeSounds.push(sound);
}

// --- the simulation ----------------------------------------------------------
const botFires = new Array(bots.length).fill(false);
const botKeys = bots.map(() => new Set());
const ctx = {
  enemies: bodies,
  shootables: world.shootables,
  raycaster,
  smokeBlocks,
  sounds: activeSounds,
  intel: { ct: { x: 0, z: 0, at: -99 }, t: { x: 0, z: 0, at: -99 } },
  bomb: match.state.bomb,
  playerBody,
  attackSite: 'A',
  nearestSite,
  holdFor(id) {
    // Fallback for a bot that has not been assigned a round yet: split the two CT bots
    // across the sites instead of stacking both on mid.
    const index = ctBots.findIndex((bot) => bot.body.id === id);
    if (index === 0) return 'a-site';
    if (index === 1) return 'b-site';
    return 'mid-center';
  },
};

function syncRigs() {
  for (const body of bodies) {
    const rigged = rigs.get(body.id);
    const crouched = body.crouching;
    if (rigged.crouched !== crouched) {
      rigged.crouched = crouched;
      const drop = crouched ? 0.44 : 0;
      const model = rigged.model;
      for (const part of model.userData.upper) part.position.y = part.userData.baseY - drop;
      for (const leg of model.userData.legs) {
        leg.scale.y = crouched ? 0.46 : 1;
        leg.position.y = crouched ? 0.19 : leg.userData.baseY;
      }
      for (const part of rigged.hitbox.parts) {
        part.position.y = crouched ? part.userData.baseY * 0.62 : part.userData.baseY;
      }
    }
    rigged.model.position.copy(body.position);
    rigged.model.rotation.y = body.yaw;
    // Never draw the local player: the camera sits inside that head.
    rigged.model.visible = body.alive && body.id !== playerBody.id;
    rigged.hitbox.group.position.copy(body.position);
    rigged.hitbox.group.rotation.y = body.yaw;
    rigged.hitbox.group.visible = body.alive;
  }
}

function handleEvents() {
  const events = match.drainEvents();
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event.type === 'roundEnd') {
      hud.banner(event.winner === 'ct' ? 'WARDENS WIN' : 'KINDLERS WIN', event.reason, event.winner);
      hud.radio(event.winner === 'ct' ? 'Wardens take the round' : 'Kindlers take the round', event.winner);
      hud.bombBanner(false);
      hud.setAction(null, 0);
    } else if (event.type === 'roundStart') {
      respawnAll();
      hud.setRound(match.state.round, MATCH_ROUNDS);
      hud.banner(`ROUND ${match.state.round}`, 'Buy time — B opens the menu', null);
      hud.radio(`Round ${match.state.round} — buy phase`, null);
    } else if (event.type === 'planted') {
      hud.bombBanner(true, event.site);
      hud.banner('BOMB PLANTED', `Site ${event.site} — hold it`, 't');
      hud.radio(`Bomb down at ${event.site} — ${Math.ceil(match.state.bomb.timer)}s`, 't');
    } else if (event.type === 'defused' || event.type === 'exploded') {
      hud.bombBanner(false);
    } else if (event.type === 'live') {
      hud.banner('LIVE', 'Round is live', null);
      hud.radio('Weapons free — hold your angle', null);
    }
  }
}

function simulate(dt) {
  elapsed += dt;
  soundCount = 0;
  activeSounds.length = 0;
  ctx.attackSite = attackSite;

  const phase = match.state.phase;
  const frozenInput = phase === PHASE.BUY || buyOpen || !playerBody.alive;

  // 1. the player
  if (!frozenInput) {
    const look = input.takeLook();
    playerCtl.look(look.x, look.y);
  } else {
    input.takeLook();
  }
  playerCtl.step(dt, frozenInput ? emptyKeys : input.state.keys, phase === PHASE.BUY ? 0.55 : 1);
  stepWeapon(playerWeapon, dt);
  if (input.state.keys.has('KeyR') && !frozenInput) startReload(playerWeapon);

  // 2. the bots think and move
  for (let i = 0; i < bots.length; i += 1) {
    const bot = bots[i];
    const keys = botKeys[i];
    keys.clear();
    if (bot.body.alive && phase !== PHASE.BUY) {
      const intent = bot.think(dt, elapsed, ctx);
      const blinded = (bot.body.flashUntil || 0) > elapsed;
      for (const key of intent.keys) if (!blinded || key !== 'KeyW') keys.add(key);
      botFires[i] = intent.fire && !blinded;
      if (intent.wantReload) startReload(bot.weapon);
    } else {
      botFires[i] = false;
    }
    bot.step(dt, keys, phase === PHASE.BUY ? 0.4 : 1);
  }

  // 3. hitboxes follow the bodies, then bullets are traced against them
  syncRigs();
  if (input.state.firing && !frozenInput) playerShoot();
  for (let i = 0; i < bots.length; i += 1) if (botFires[i]) botShoot(bots[i]);

  // 4. grenades, rules, presentation state
  stepGrenades(dt);
  match.tick(dt, {
    bodies,
    playerBody,
    playerInput: { plant: input.state.keys.has('KeyE'), defuse: input.state.keys.has('KeyE') },
    nearestSite,
    playerHasKit: false,
  });
  handleEvents();

  const bomb = match.state.bomb;
  if (bomb.state === 'planted') {
    const second = Math.ceil(bomb.timer);
    if (second !== lastBeep && second > 0) {
      lastBeep = second;
      audio.beep(bomb.timer < 10);
    }
    hud.setAction(bomb.defuseProgress > 0 ? 'DEFUSING' : null, bomb.defuseProgress / match.constants.DEFUSE_SECONDS);
  } else if (bomb.plantProgress > 0) {
    hud.setAction('PLANTING', bomb.plantProgress / match.constants.PLANT_SECONDS);
  } else {
    lastBeep = -1;
    hud.setAction(null, 0);
  }
}

const emptyKeys = new Set();
let lastBeep = -1;

// --- presentation ------------------------------------------------------------
function syncCamera() {
  const eye = playerBody.alive ? playerBody.eye : 0.55;
  camera.position.set(playerBody.position.x, playerBody.position.y + eye, playerBody.position.z);
  camera.rotation.set(playerBody.alive ? playerBody.pitch : -0.35, playerBody.yaw, 0, 'YXZ');
}

function updateBombProp() {
  const bomb = match.state.bomb;
  const active = bomb.state === 'planted';
  bombProp.visible = active;
  if (!active) return;
  bombProp.position.set(bomb.x, 0.13, bomb.z);
  bombProp.rotation.y = elapsed * 0.6;
  bombLight.intensity = 0.6 + Math.abs(Math.sin(elapsed * 6)) * 1.6;
}

const bombProp = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.36), new THREE.MeshStandardMaterial({ color: new THREE.Color('#20262c'), roughness: 0.6, metalness: 0.35 }));
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.4, roughness: 0.4 }));
  panel.position.y = 0.125;
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.03, 0.08), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.8 }));
  strap.position.y = 0.12;
  bombProp.add(body, panel, strap);
  bombProp.visible = false;
  scene.add(bombProp);
}
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5, 2);
bombLight.position.y = 0.4;
bombProp.add(bombLight);

// --- air ---------------------------------------------------------------------
// Dust in the light and a low sun on the horizon. Both are one draw call, neither casts a
// shadow: they exist so a still frame has depth and the sky has a direction.
let dustSeed = 0x51f3a7;
const dustRandom = () => {
  dustSeed = (Math.imul(dustSeed, 1664525) + 1013904223) >>> 0;
  return dustSeed / 4294967296;
};
const DUST_COUNT = 280;
const dust = (() => {
  const positions = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    positions[i * 3] = (dustRandom() - 0.5) * 42;
    positions[i * 3 + 1] = dustRandom() * 7 + 0.4;
    positions[i * 3 + 2] = (dustRandom() - 0.5) * 42;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: new THREE.Color('#ffd9b0'),
    size: 0.055,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }));
  scene.add(points);
  return points;
})();

// The sun sprite is decorative: no handle is kept.
(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 2, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255,244,225,1)');
  grad.addColorStop(0.18, 'rgba(255,206,150,0.85)');
  grad.addColorStop(0.45, 'rgba(255,150,90,0.28)');
  grad.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  sprite.position.set(108, 132, 84);
  sprite.scale.setScalar(72);
  scene.add(sprite);
})();

function render() {
  updateSparks();
  updateSmoke();
  updateBombProp();
  dust.rotation.y = elapsed * 0.008;
  dust.position.y = Math.sin(elapsed * 0.18) * 0.08;
  if (blastAt > elapsed - 0.32) {
    const t = (elapsed - blastAt) / 0.32;
    blastMesh.visible = true;
    blastMesh.scale.setScalar(0.7 + t * 5.2);
    blastMesh.material.opacity = 0.85 * (1 - t);
  } else if (blastMesh.visible) {
    blastMesh.visible = false;
  }
  const speed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
  rig.pose(playerWeapon, elapsed, speed);
  syncCamera();
  renderer.render(scene, camera);
}

let hudAccumulator = 0;
const MATCH_ROUNDS = 12;
const RADAR_BOXES = world.colliders.map((b) => ({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z }));
const RADAR_SITES = world.sites.map((s) => ({ name: s.name, x: s.x, z: s.z }));

// "Spotted" for the radar: close and inside the view cone. The radar must never show a
// body the player could not have seen, or the minimap becomes a wallhack.
function spotted(body) {
  const dx = body.position.x - playerBody.position.x;
  const dz = body.position.z - playerBody.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 18) return false;
  const fx = -Math.sin(playerBody.yaw);
  const fz = -Math.cos(playerBody.yaw);
  return (dx * fx + dz * fz) / Math.max(0.001, dist) > 0.35;
}

function pushHud(dt, force = false) {
  hudAccumulator += dt;
  if (!force && hudAccumulator < HUD_INTERVAL) return;
  hudAccumulator = 0;
  const bomb = match.state.bomb;
  hud.setVitals(playerBody.health, playerBody.armor);
  hud.setAmmo(playerWeapon.def.name, playerWeapon.mag, playerWeapon.reserve, grenades);
  hud.setMoney(match.moneyOf(playerBody.id));
  hud.setClock(bomb.state === 'planted' ? bomb.timer : match.state.phaseLeft, match.state.phase);
  hud.setScore(match.state.scoreCT, match.state.scoreT);
  hud.setRound(match.state.round, MATCH_ROUNDS);
  hud.setAlive(
    ctBots.filter((b) => b.body.alive).length + (playerBody.alive ? 1 : 0),
    tBots.filter((b) => b.body.alive).length,
    3,
    3,
  );
  const primaryName = playerWeapon.def.id === 'pistol' ? 'VK-47' : playerWeapon.def.name;
  hud.setEquipment({
    slot: playerWeapon.def.id === 'pistol' ? 2 : 1,
    primary: primaryName,
    secondary: 'P9',
    frag: grenades,
    smoke: smokeCount,
    flash: flashCount,
    kind: grenadeKind,
  });
  hud.drawRadar({
    half: 22,
    boxes: RADAR_BOXES,
    sites: RADAR_SITES,
    player: { x: playerBody.position.x, z: playerBody.position.z, yaw: playerBody.yaw },
    mates: ctBots.map((b) => ({ x: b.body.position.x, z: b.body.position.z, alive: b.body.alive })),
    enemies: tBots.map((b) => ({ x: b.body.position.x, z: b.body.position.z, alive: b.body.alive, visible: spotted(b.body) })),
    bomb: { on: bomb.state === 'planted', x: bomb.x || 0, z: bomb.z || 0 },
    tick: match.state.round,
  });
  const speed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
  hud.setSpread(2 + weaponSpread(playerWeapon, speed) * 620 + reloadProgress(playerWeapon) * 6);
}

// --- loop --------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < MAX_STEPS) {
      simulate(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * MAX_STEPS) accumulator = 0;
    pushHud(dt);
  }
  render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- deterministic screenshots ----------------------------------------------
function placeBot(bot, x, z, yaw, health = 100) {
  bot.body.position.set(x, 0, z);
  bot.body.velocity.set(0, 0, 0);
  bot.body.yaw = yaw;
  bot.body.pitch = 0;
  bot.body.health = health;
  bot.body.alive = true;
  bot.body.crouching = false;
  bot.body.height = 1.72;
  bot.body.eye = 1.56;
}

function placePlayer(x, z, yaw, pitch = -0.03) {
  playerBody.position.set(x, 0, z);
  playerBody.velocity.set(0, 0, 0);
  playerBody.yaw = yaw;
  playerBody.pitch = pitch;
  playerBody.alive = true;
}

// Two paints, then the flag: Playwright's screenshot needs the GPU to have drawn the
// frame it is about to capture, and one paint is not a guarantee.
function paintAndReady() {
  let painted = 0;
  function paint() {
    render();
    painted += 1;
    if (painted === 2) window.__shotReady = true;
    else requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}

const SHOT_SETUP = {
  menu() {
    placePlayer(9.4, 7.8, -0.16, -0.02);
    placeBot(tBots[0], 13.2, -2.4, 2.5);
    placeBot(tBots[1], 15.6, -5.4, 2.2);
    placeBot(ctBots[0], 9.4, -6.2, 3.2);
    hud.showOverlay('start');
  },
  fight() {
    match.state.phase = PHASE.LIVE;
    match.state.phaseLeft = 47;
    match.state.scoreCT = 3;
    match.state.scoreT = 2;
    match.state.round = 6;
    match.state.money.set(playerBody.id, 2900);
    placePlayer(14.2, 3.4, 0.38, -0.04);
    playerBody.health = 78;
    playerBody.armor = 100;
    inventory.rifle = createWeaponState(WEAPONS.rifle);
    inventory.rifle.mag = 17;
    inventory.rifle.flash = 0.05;
    playerWeapon = inventory.rifle;
    rig.show('rifle');
    grenades = 1;
    smokeCount = 2;
    flashCount = 1;
    grenadeKind = 'smoke';
    placeBot(tBots[0], 12.0, -2.2, 2.9, 100);
    placeBot(tBots[1], 15.4, -6.0, 2.4, 62);
    placeBot(tBots[2], 8.2, -1.6, 2.2, 100);
    placeBot(ctBots[0], 6.4, 1.6, 0.6, 100);
    placeBot(ctBots[1], 10.2, 6.0, 0.9, 100);
    hud.killFeed('<span class="ct">YOU</span> ▸ <span class="t">T-2</span>');
    hud.killFeed('<span class="t">T-1</span> ▸ <span class="ct">CT-2</span>');
    hud.radio('Sable: two contacts, A long', 'ct');
    // A smoke already grown, off the left lane: it sells the utility without hiding the fight.
    spawnSmoke(6.6, 0.2, -3.4);
    smokes[smokes.length - 1].born = elapsed - 4;
  },
  plant() {
    match.state.phase = PHASE.LIVE;
    match.state.phaseLeft = 21;
    match.state.bomb.state = 'planted';
    match.state.bomb.x = 12.0;
    match.state.bomb.z = -3.4;
    match.state.bomb.siteName = 'A';
    match.state.bomb.timer = 24;
    match.state.bomb.defuseProgress = 0.35;
    match.state.scoreCT = 4;
    match.state.scoreT = 4;
    placePlayer(12.6, 1.2, 0.12, -0.13);
    playerBody.health = 64;
    playerBody.armor = 100;
    inventory.rifle = createWeaponState(WEAPONS.rifle);
    inventory.rifle.mag = 22;
    playerWeapon = inventory.rifle;
    rig.show('rifle');
    grenades = 1;
    smokeCount = 1;
    flashCount = 1;
    grenadeKind = 'he';
    match.state.round = 8;
    placeBot(tBots[0], 15.0, -6.6, 2.4, 88);
    placeBot(ctBots[0], 12.85, -2.55, 0.84, 40);
    // The defusing bot kneels, so the pose matches the progress bar.
    ctBots[0].body.crouching = true;
    ctBots[0].body.height = 1.12;
    ctBots[0].body.eye = 0.98;
    hud.bombBanner(true, 'A');
    hud.setAction('DEFUSING', 0.35);
    hud.radio('Bomb down at A — 24s, defusing', 't');
  },
  buy() {
    match.state.phase = PHASE.BUY;
    match.state.round = 4;
    match.state.phaseLeft = 5;
    match.state.scoreCT = 2;
    match.state.scoreT = 1;
    match.state.money.set(playerBody.id, 4350);
    placePlayer(0, -16.2, Math.PI, 0);
    playerBody.health = 100;
    playerBody.armor = 0;
    hud.openBuy(BUY_ITEMS, 4350, 'Balance $4350 · round 4 · buy phase');
  },
  end() {
    match.state.phase = PHASE.END;
    match.state.winner = 'ct';
    match.state.scoreCT = 7;
    match.state.scoreT = 4;
    match.state.round = 12;
    placePlayer(0, -11.5, Math.PI, 0);
    placeBot(ctBots[0], -2.4, -6.0, 3.0);
    placeBot(tBots[0], 2.6, -4.4, 0.2, 0);
    tBots[0].body.alive = false;
    hud.banner('WARDENS WIN', 'Bomb defused', 'ct');
    hud.setScore(7, 4);
  },
};

const SHOT_ALIASES = { start: 'menu', play: 'fight' };

function runShot(name) {
  const mode = SHOT_ALIASES[name] ?? name;
  hud.hideOverlay();
  hud.hideBoard();
  hud.closeBuy();
  match.startRound(1);
  respawnAll();

  if (SHOT_SETUP[mode]) SHOT_SETUP[mode]();

  syncRigs();
  pushHud(1, true);
  syncCamera();
  updateBombProp();
  renderer.render(scene, camera);
  paintAndReady();
}

// --- boot --------------------------------------------------------------------
syncRigs();
syncCamera();
hud.setRound(1, MATCH_ROUNDS);
hud.setScore(0, 0);
hud.setVitals(100, 0);
hud.setAmmo(playerWeapon.def.name, playerWeapon.mag, playerWeapon.reserve, grenades);
hud.setMoney(match.moneyOf(playerBody.id));
hud.setClock(match.state.phaseLeft, match.state.phase);

if (shotMode) {
  runShot(shotMode);
} else {
  // Set the first round up exactly like every later one: hold points, lanes, the attack
  // site. Without this the opening round is the only one with no assignments.
  respawnAll();
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
