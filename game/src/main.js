// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// The simulation owns every number; this file only wires modules together and traces shots
// against the same world the bots use.
import * as THREE from 'three';
import { PALETTE, TEAM_COLOR } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createBody, STAND_HEIGHT } from './player.js';
import {
  createWeaponRig, createWeaponState, stepWeapon, weaponReady, pullTrigger, takeRound,
  startReload, weaponSpread, WEAPONS, GRENADE,
} from './weapon.js';
import { createBot } from './bot.js';
import { createMatch, PHASE } from './round.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

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
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 62);

const camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const hud = createHud();
const match = createMatch();

// --- bodies, models and hitboxes ---------------------------------------------
const bodies = [];
const rigs = new Map();
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const tempVec = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();

function buildSoldier(team) {
  const group = new THREE.Group();
  const teamColor = new THREE.Color(TEAM_COLOR[team]);
  const cloth = new THREE.MeshStandardMaterial({ color: teamColor.clone().multiplyScalar(0.45), roughness: 0.86, metalness: 0.05 });
  const plate = new THREE.MeshStandardMaterial({ color: teamColor.clone().multiplyScalar(0.7), roughness: 0.68, metalness: 0.18 });
  const trim = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.45, metalness: 0.1, emissive: teamColor, emissiveIntensity: 0.3 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a6553'), roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.7, 0.32), cloth);
  torso.position.y = 1.12;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.46, 0.36), plate);
  vest.position.y = 1.2;
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.34), trim);
  shoulders.position.y = 1.46;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
  head.position.y = 1.66;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), trim);
  helmet.position.y = 1.68;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.76, 0.28), cloth);
  legs.position.y = 0.42;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.5), plate);
  gun.position.set(0.24, 1.18, -0.28);

  group.add(torso, vest, shoulders, head, helmet, legs, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return group;
}

function buildHitbox(body) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.82, 0.4), mat);
  torso.position.y = 1.16;
  torso.userData = { body, part: 'torso' };
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.185, 10, 8), mat);
  head.position.y = 1.66;
  head.userData = { body, part: 'head' };
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.76, 0.32), mat);
  legs.position.y = 0.42;
  legs.userData = { body, part: 'legs' };
  group.add(torso, head, legs);
  scene.add(group);
  return { group, parts: [torso, head, legs] };
}

function registerBody(body) {
  bodies.push(body);
  rigs.set(body.id, { model: buildSoldier(body.team), hitbox: buildHitbox(body) });
  match.registerPlayer(body.id, body.team);
}

// The player is a Counter-Terrorist; two CT bots hold with them and three T bots attack.
const playerCtl = createBody(world.colliders, world.spawns.ct[0], 'ct');
const playerBody = playerCtl.state;
playerBody.name = 'YOU';
registerBody(playerBody);

const ctBots = [
  createBot({ colliders: world.colliders, spawn: world.spawns.ct[1], team: 'ct', waypoints: world.waypoints, role: 'rifle', skill: 0.62 }),
  createBot({ colliders: world.colliders, spawn: world.spawns.ct[2], team: 'ct', waypoints: world.waypoints, role: 'smg', skill: 0.5 }),
];
const tBots = [
  createBot({ colliders: world.colliders, spawn: world.spawns.t[0], team: 't', waypoints: world.waypoints, role: 'rifle', skill: 0.58 }),
  createBot({ colliders: world.colliders, spawn: world.spawns.t[1], team: 't', waypoints: world.waypoints, role: 'rifle', skill: 0.45 }),
  createBot({ colliders: world.colliders, spawn: world.spawns.t[2], team: 't', waypoints: world.waypoints, role: 'smg', skill: 0.66 }),
];
for (const bot of [...ctBots, ...tBots]) registerBody(bot.body);

// --- the player's gun ---------------------------------------------------------
const rig = createWeaponRig(camera);
let playerWeapon = createWeaponState(WEAPONS.rifle);
let grenades = 1;
rig.show('rifle');

const input = createInput(renderer.domElement, {
  onLockChange(locked) {
    if (shot) return;
    if (locked) hud.hideOverlay();
    else if (match.state.phase !== PHASE.END) hud.showOverlay(started ? 'paused' : 'start');
    started = started || locked;
  },
  onKey(code) {
    if (shot) return;
    if (code === 'KeyB') toggleBuy();
    if (code === 'KeyG') throwGrenade();
    if (code === 'Digit1') selectWeapon('rifle');
    if (code === 'Digit2') selectWeapon('smg');
    if (code === 'Digit3') selectWeapon('pistol');
    if (code === 'Tab') hud.showBoard(scoreRows());
  },
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Tab') hud.hideBoard();
});

let started = false;
let paused = false;
let buyOpen = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let frozen = false;

const grenadeProjectiles = [];
const grenadeGeo = new THREE.SphereGeometry(0.13, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

// --- combat ------------------------------------------------------------------
function bodyPartMultiplier(def, part) {
  if (part === 'head') return def.headMultiplier;
  if (part === 'legs') return def.legMultiplier;
  return 1;
}

function traceShot(origin, direction, range, shooter) {
  raycaster.set(origin, direction);
  raycaster.far = range;
  const candidates = world.shootables.concat(...[...rigs.values()].map((r) => r.hitbox.parts));
  const hits = raycaster.intersectObjects(candidates, false);
  for (const hit of hits) {
    const target = hit.object.userData.body;
    if (target) {
      if (target.id === shooter.id || !target.alive) continue;
      return { body: target, part: hit.object.userData.part || 'torso', point: hit.point, distance: hit.distance };
    }
    return { wall: true, point: hit.point, distance: hit.distance };
  }
  return null;
}

function awardKill(shooter, victim, def) {
  shooter.kills += 1;
  victim.deaths += 1;
  const reward = def.killReward ?? 300;
  match.addMoney(shooter.id, reward);
  const sName = shooter.id === playerBody.id ? 'YOU' : shooter.name || 'YOU';
  const vName = victim.id === playerBody.id ? 'YOU' : (victim.name || 'BOT');
  hud.killFeed(`<span class="${shooter.team}">${sName}</span> ▸ <span class="${victim.team}">${vName}</span>`);
}

function applyShot(shooter, def, spread) {
  const eye = tempVec.set(shooter.position.x, shooter.position.y + shooter.eye, shooter.position.z);
  const dir = tempVec2.set(
    -Math.sin(shooter.yaw) * Math.cos(shooter.pitch),
    Math.sin(shooter.pitch),
    -Math.cos(shooter.yaw) * Math.cos(shooter.pitch),
  ).normalize();
  dir.x += (random() * 2 - 1) * spread;
  dir.y += (random() * 2 - 1) * spread;
  dir.z += (random() * 2 - 1) * spread;
  dir.normalize();
  const hit = traceShot(eye, dir, def.range, shooter);
  if (!hit || !hit.body) return null;
  const damage = def.damage * bodyPartMultiplier(def, hit.part);
  const killed = hit.body.hurt(damage);
  if (killed) awardKill(shooter, hit.body, def);
  return { killed, part: hit.part };
}

function playerShoot() {
  if (!weaponReady(playerWeapon)) return;
  if (!takeRound(playerWeapon)) return;
  pullTrigger(playerWeapon);
  const def = playerWeapon.def;
  const result = applyShot(playerBody, def, weaponSpread(playerWeapon, Math.hypot(playerBody.velocity.x, playerBody.velocity.z)));
  playerBody.pitch = Math.min(1.45, playerBody.pitch + def.recoilPitch);
  playerBody.yaw += (random() * 2 - 1) * def.recoilYaw;
  if (result && result.killed) hud.hitMarker(true);
  else if (result) hud.hitMarker(false);
}

function botShoot(bot) {
  if (!weaponReady(bot.weapon)) return;
  bot.onFired();
  applyShot(bot.body, bot.weapon.def, bot.spread());
}

// --- grenades ----------------------------------------------------------------
function throwGrenade() {
  if (grenades <= 0 || frozen || match.state.phase !== PHASE.LIVE) return;
  grenades -= 1;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(camera.position).addScaledVector(dir, 0.6);
  mesh.castShadow = true;
  scene.add(mesh);
  grenadeProjectiles.push({
    mesh,
    velocity: dir.clone().multiplyScalar(18).add(new THREE.Vector3(0, 3.2, 0)),
    fuse: GRENADE.fuse,
    team: 'ct',
  });
}

function explodeGrenade(projectile) {
  const pos = projectile.mesh.position.clone();
  scene.remove(projectile.mesh);
  const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 14, 2);
  light.position.copy(pos);
  scene.add(light);
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.5 }));
  flash.position.copy(pos);
  scene.add(flash);
  setTimeout(() => { scene.remove(light); scene.remove(flash); }, 260);
  for (const body of bodies) {
    if (!body.alive || body.team === projectile.team) continue;
    const d = body.position.distanceTo(pos);
    if (d > GRENADE.radius) continue;
    const damage = GRENADE.damage * (1 - d / GRENADE.radius);
    if (body.hurt(damage) && projectile.shooter) awardKill(projectile.shooter, body, { killReward: 300 });
  }
}

function stepGrenades(dt) {
  for (let i = grenadeProjectiles.length - 1; i >= 0; i -= 1) {
    const g = grenadeProjectiles[i];
    g.fuse -= dt;
    g.velocity.y -= 18 * dt;
    g.mesh.position.addScaledVector(g.velocity, dt);
    if (g.mesh.position.y < 0.14) {
      g.mesh.position.y = 0.14;
      g.velocity.y *= -0.35;
      g.velocity.x *= 0.7;
      g.velocity.z *= 0.7;
    }
    if (g.fuse <= 0) {
      explodeGrenade(g);
      grenadeProjectiles.splice(i, 1);
    }
  }
}

// --- buy menu ----------------------------------------------------------------
function toggleBuy() {
  if (match.state.phase !== PHASE.BUY) return;
  if (buyOpen) closeBuy();
  else openBuy();
}

function openBuy() {
  buyOpen = true;
  hud.openBuy([
    { id: 'rifle', name: 'VK-47', sub: 'Rifle · 34 dmg · 600 rpm', price: WEAPONS.rifle.price },
    { id: 'smg', name: 'PDW-9', sub: 'SMG · 21 dmg · 800 rpm', price: WEAPONS.smg.price },
    { id: 'grenade', name: 'HE Grenade', sub: 'Area damage · 6 m', price: GRENADE.price },
    { id: 'armor', name: 'Kevlar Vest', sub: '100 armour', price: 650 },
  ], match.moneyOf(playerBody.id));
  input.releaseLock();
}

function closeBuy() {
  buyOpen = false;
  hud.closeBuy();
  if (!shot) input.requestLock();
}

function buy(item) {
  const id = item;
  if (id === 'rifle' && match.spend(playerBody.id, WEAPONS.rifle.price)) {
    playerWeapon = createWeaponState(WEAPONS.rifle);
    playerBody.armor = Math.max(playerBody.armor, 100);
    rig.show('rifle');
  } else if (id === 'smg' && match.spend(playerBody.id, WEAPONS.smg.price)) {
    playerWeapon = createWeaponState(WEAPONS.smg);
    rig.show('smg');
  } else if (id === 'grenade' && match.spend(playerBody.id, GRENADE.price)) {
    grenades += 1;
  } else if (id === 'armor' && match.spend(playerBody.id, 650)) {
    playerBody.armor = 100;
  }
  openBuy();
}

function selectWeapon(kind) {
  if (match.state.phase === PHASE.BUY) return;
  playerWeapon = createWeaponState(WEAPONS[kind]);
  rig.show(kind);
}

hud.onBuy(buy);
hud.onCloseBuy(closeBuy);
hud.onPlay(() => { if (!shot) input.requestLock(); });

// --- round wiring ------------------------------------------------------------
function respawnAll() {
  const ctSpawns = world.spawns.ct;
  const tSpawns = world.spawns.t;
  playerCtl.respawn(ctSpawns[0]);
  playerBody.armor = 0;
  playerWeapon = createWeaponState(WEAPONS.pistol);
  grenades = 0;
  rig.show('pistol');
  ctBots[0].body.place(ctSpawns[1]);
  ctBots[1].body.place(ctSpawns[2]);
  tBots.forEach((bot, i) => bot.body.place(tSpawns[i % tSpawns.length]));
  for (const bot of [...ctBots, ...tBots]) {
    bot.weapon.mag = bot.weapon.def.magSize;
    bot.weapon.reserve = bot.weapon.def.reserve;
    bot.weapon.reloadLeft = 0;
    bot.brain.holdPoint = null;
    bot.brain.route = [];
  }
  ctBots[0].brain.holdPoint = 'a-site';
  ctBots[1].brain.holdPoint = 'b-site';
  tBots[0].brain.route = [];
  tBots[1].brain.route = [];
  tBots[2].brain.route = [];
  match.resetBomb();
  hud.bombBanner(false);
}

function nearestSite(position) {
  for (const site of world.sites) {
    if (Math.hypot(site.x - position.x, site.z - position.z) <= site.radius) return site;
  }
  return null;
}

function scoreRows() {
  const rows = [{ name: 'YOU', team: 'ct', kills: playerBody.kills, deaths: playerBody.deaths, health: Math.round(playerBody.health), alive: playerBody.alive }];
  for (const bot of [...ctBots, ...tBots]) {
    rows.push({ name: bot.name, team: bot.body.team, kills: bot.body.kills, deaths: bot.body.deaths, health: Math.round(bot.body.health), alive: bot.body.alive });
  }
  return rows;
}

// --- simulation --------------------------------------------------------------
const keysForBots = ctBots.map(() => new Set());
const tKeys = tBots.map(() => new Set());

function simulate(dt) {
  elapsed += dt;

  const phase = match.state.phase;
  const locked = phase === PHASE.BUY;
  const speedScale = locked ? 0.55 : 1;

  if (!locked) {
    const look = input.takeLook();
    playerCtl.look(look.x, look.y);
    if (input.state.firing && !buyOpen) playerShoot();
    if (input.state.keys.has('KeyR')) startReload(playerWeapon);
    if (input.state.keys.has('KeyG')) { /* one-shot handled on keydown */ }
  }
  playerCtl.step(dt, locked ? new Set() : input.state.keys, speedScale);
  stepWeapon(playerWeapon, dt);

  const sounds = [];
  const ctx = {
    bodies,
    enemies: bodies,
    shootables: world.shootables,
    raycaster,
    sounds,
    bomb: match.state.bomb,
    playerBody,
    nearestSite,
    posOf(id) {
      const w = world.waypoints.find((p) => p.id === id);
      return w ? [w.x, w.z] : [0, 0];
    },
    holdFor(id) {
      const bot = ctBots.find((b, i) => i === id % 2);
      return bot && bot.brain.holdPoint ? bot.brain.holdPoint : 'ct-mid';
    },
  };

  if (!locked) {
    ctBots.forEach((bot, i) => {
      const intent = bot.think(dt, elapsed, ctx);
      bot.step(dt, intent.keys, 1);
      if (intent.fire) botShoot(bot);
      if (intent.wantReload && bot.weapon.reloadLeft === 0) startReload(bot.weapon);
      if (bot.weapon.flash > 0) sounds.push({ pos: bot.body.position.clone(), team: bot.body.team, at: elapsed });
    });
    tBots.forEach((bot) => {
      const intent = bot.think(dt, elapsed, ctx);
      bot.step(dt, intent.keys, 1);
      if (intent.fire) botShoot(bot);
      if (intent.wantReload && bot.weapon.reloadLeft === 0) startReload(bot.weapon);
      if (bot.weapon.flash > 0) sounds.push({ pos: bot.body.position.clone(), team: bot.body.team, at: elapsed });
    });
  } else {
    for (const bot of [...ctBots, ...tBots]) bot.step(dt, new Set(), 0.4);
  }

  stepGrenades(dt);

  const playerInput = {
    plant: input.state.keys.has('KeyE'),
    defuse: input.state.keys.has('KeyE'),
  };
  match.tick(dt, { bodies, playerBody, playerInput, nearestSite, playerHasKit: false });

  for (const event of match.drainEvents()) {
    if (event.type === 'roundEnd') {
      const win = event.winner === 'ct';
      hud.banner(win ? 'COUNTER-TERRORISTS WIN' : 'TERRORISTS WIN', event.reason, event.winner);
      hud.bombBanner(false);
    } else if (event.type === 'roundStart') {
      respawnAll();
      hud.setRound(match.state.round);
      hud.banner(`ROUND ${match.state.round}`, 'Buy now — B opens the menu', null);
    } else if (event.type === 'planted') {
      hud.bombBanner(true);
      hud.banner('BOMB PLANTED', `Site ${event.site} — defuse it`, 't');
    } else if (event.type === 'defused') {
      hud.bombBanner(false);
    } else if (event.type === 'exploded') {
      hud.bombBanner(false);
    }
  }

  syncVisuals();
}

function syncVisuals() {
  for (const body of bodies) {
    const rig = rigs.get(body.id);
    if (!rig) continue;
    rig.model.position.copy(body.position);
    rig.model.rotation.y = body.yaw;
    // Never draw the local player's own body: the camera sits inside its head.
    rig.model.visible = body.alive && body.id !== playerBody.id;
    rig.hitbox.group.position.copy(body.position);
    rig.hitbox.group.rotation.y = body.yaw;
    rig.hitbox.group.visible = body.alive;
  }
  const bob = Math.sin(elapsed * 9) * Math.min(1, Math.hypot(playerBody.velocity.x, playerBody.velocity.z) / 5) * 0.012;
  rig.models[playerWeapon.def.id].position.z = -0.42 + playerWeapon.kick + bob;
  rig.models[playerWeapon.def.id].rotation.x = playerWeapon.kick * 2.2;
  rig.flash.visible = playerWeapon.flash > 0;
  rig.flash.rotation.z = playerWeapon.flash * 30;
  rig.flashLight.intensity = playerWeapon.flash > 0 ? 16 : 0;
}

function syncCamera() {
  camera.position.set(playerBody.position.x, playerBody.position.y + playerBody.eye, playerBody.position.z);
  camera.rotation.set(playerBody.pitch, playerBody.yaw, 0, 'YXZ');
}

let hudAccumulator = 0;
function pushHud(dt) {
  hudAccumulator += dt;
  if (hudAccumulator < 0.05) return;
  hudAccumulator = 0;
  hud.setVitals(playerBody.health, playerBody.armor);
  hud.setAmmo(playerWeapon.def.name, playerWeapon.mag, playerWeapon.reserve, grenades);
  hud.setMoney(match.moneyOf(playerBody.id));
  hud.setClock(match.state.phaseLeft, match.state.phase);
  hud.setScore(match.state.scoreCT, match.state.scoreT);
  hud.setRound(match.state.round);
}

// --- loop --------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      simulate(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    pushHud(dt);
    syncCamera();
  }
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- deterministic screenshots ----------------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) simulate(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function placeBot(bot, x, z, yaw) {
  bot.body.position.set(x, 0, z);
  bot.body.yaw = yaw;
  bot.body.alive = true;
  bot.body.health = 100;
  bot.body.pitch = 0;
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBoard();
  hud.closeBuy();
  match.startRound(1);
  respawnAll();

  if (name === 'menu') {
    hud.showOverlay('start');
    playerBody.position.set(6.4, 0, 9.2);
    playerBody.yaw = -0.42;
    playerBody.pitch = -0.02;
    placeBot(tBots[0], 12.6, -2.4, 2.6);
    placeBot(tBots[1], 15.2, -6.0, 2.2);
    placeBot(ctBots[0], 7.8, -6.4, 3.2);
    syncVisuals();
  } else if (name === 'buy') {
    match.state.money.set(playerBody.id, 4350);
    hud.setMoney(4350);
    hud.openBuy([
      { id: 'rifle', name: 'VK-47', sub: 'Rifle · 34 dmg · 600 rpm', price: 2700 },
      { id: 'smg', name: 'PDW-9', sub: 'SMG · 21 dmg · 800 rpm', price: 1250 },
      { id: 'grenade', name: 'HE Grenade', sub: 'Area damage · 6 m', price: 300 },
      { id: 'armor', name: 'Kevlar Vest', sub: '100 armour', price: 650 },
    ], 4350, 'Balance $4350 · round 4 · buy phase');
    playerBody.position.set(0, 0, -16.5);
    syncVisuals();
  } else if (name === 'fight') {
    match.state.phase = PHASE.LIVE;
    match.state.phaseLeft = 47;
    match.state.scoreCT = 3;
    match.state.scoreT = 2;
    match.state.round = 6;
    match.state.money.set(playerBody.id, 2900);
    playerBody.position.set(1.2, 0, 6.5);
    playerBody.yaw = 0.06;
    playerBody.pitch = -0.02;
    playerBody.health = 78;
    playerBody.armor = 100;
    playerWeapon = createWeaponState(WEAPONS.rifle);
    playerWeapon.mag = 17;
    rig.show('rifle');
    placeBot(tBots[0], -0.4, -1.5, 0.15);
    placeBot(tBots[1], 3.4, -3.2, 0.3);
    placeBot(tBots[2], -4.6, 1.4, 0.1);
    placeBot(ctBots[0], -3.2, -8.5, 3.1);
    placeBot(ctBots[1], 4.4, -9.2, 3.0);
    hud.killFeed('<span class="ct">YOU</span> ▸ <span class="t">T-2</span>');
    hud.killFeed('<span class="t">T-1</span> ▸ <span class="ct">CT-2</span>');
    syncVisuals();
    pushHud(1);
  } else if (name === 'plant') {
    match.state.phase = PHASE.LIVE;
    match.state.phaseLeft = 21;
    match.state.bomb.state = 'planted';
    match.state.bomb.x = 13;
    match.state.bomb.z = -4;
    match.state.bomb.siteName = 'A';
    match.state.bomb.timer = 27;
    match.state.scoreCT = 4;
    match.state.scoreT = 4;
    playerBody.position.set(9.6, 0, -1.2);
    playerBody.yaw = -0.75;
    playerBody.pitch = -0.04;
    playerBody.health = 64;
    playerWeapon = createWeaponState(WEAPONS.rifle);
    rig.show('rifle');
    placeBot(tBots[0], 14.4, -6.2, 2.4);
    placeBot(ctBots[0], 7.4, -6.8, 3.4);
    const bombMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.34), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.8, roughness: 0.4 }));
    bombMesh.position.set(13, 0.99, -4);
    scene.add(bombMesh);
    hud.bombBanner(true);
    hud.banner('BOMB PLANTED', 'Site A — 27 seconds', 't');
    syncVisuals();
    pushHud(1);
  } else if (name === 'end') {
    match.state.phase = PHASE.END;
    match.state.winner = 'ct';
    match.state.scoreCT = 7;
    match.state.scoreT = 4;
    match.state.round = 12;
    playerBody.position.set(0, 0, -12);
    playerBody.yaw = 0;
    playerBody.health = 55;
    playerWeapon = createWeaponState(WEAPONS.rifle);
    rig.show('rifle');
    hud.banner('COUNTER-TERRORISTS WIN', 'Bomb defused', 'ct');
    syncVisuals();
    pushHud(1);
  }

  hud.setVitals(playerBody.health, playerBody.armor);
  hud.setAmmo(playerWeapon.def.name, playerWeapon.mag, playerWeapon.reserve, grenades);
  hud.setMoney(match.moneyOf(playerBody.id));
  hud.setClock(match.state.phaseLeft, match.state.phase);
  hud.setScore(match.state.scoreCT, match.state.scoreT);
  hud.setRound(match.state.round);

  syncCamera();
  renderer.render(scene, camera);
  paintTwiceThenReady();
}

// --- boot --------------------------------------------------------------------
syncVisuals();
syncCamera();
hud.setRound(1);
hud.setScore(0, 0);
hud.setVitals(100, 0);
hud.setAmmo(playerWeapon.def.name, playerWeapon.mag, playerWeapon.reserve, grenades);
hud.setMoney(800);

if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
