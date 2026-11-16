// Bot brains. A bot walks the waypoint graph toward an objective, watches a cone in front
// of it, hears gunfire, holds an angle when it arrives, and fights in bursts with a reaction
// delay and aim error. It never teleports and never aims through a wall: every shot it takes
// is traced by main.js against the same map the player's shots are.
import * as THREE from 'three';
import { createBody } from './player.js';
import { createWeaponState, stepWeapon, weaponReady, pullTrigger, takeRound, startReload, weaponSpread } from './weapon.js';

const VISION_RANGE = 46;
const VISION_COS = Math.cos(THREE.MathUtils.degToRad(58));
const HEARING_RANGE = 30;
const REACTION_MIN = 0.16;
const REACTION_MAX = 0.34;
const TURN_RATE = 6.5;

let botSeq = 1;

export function createBot({ colliders, spawn, team, waypoints, role = 'rifle', skill = 0.5 }) {
  const ctl = createBody(colliders, spawn, team);
  const body = ctl.state;
  const weapon = createWeaponState(role === 'smg'
    ? { id: 'smg', name: 'PDW-9', damage: 21, headMultiplier: 2.6, legMultiplier: 0.8, rpm: 800, magSize: 25, reserve: 100, reloadTime: 1.7, spreadStill: 0.004, spreadMoving: 0.02, recoilPitch: 0, recoilYaw: 0, range: 60, automatic: true }
    : { id: 'rifle', name: 'VK-47', damage: 30, headMultiplier: 2.9, legMultiplier: 0.72, rpm: 560, magSize: 30, reserve: 90, reloadTime: 2.0, spreadStill: 0.006, spreadMoving: 0.03, recoilPitch: 0, recoilYaw: 0, range: 85, automatic: true });

  const brain = {
    id: botSeq++,
    name: `${team.toUpperCase()}-${botSeq - 1}`,
    state: 'route',
    target: null,
    lastSeen: new THREE.Vector3(),
    lastSeenAt: -99,
    reaction: 0,
    route: [],
    routeIndex: 0,
    goal: null,
    holdPoint: null,
    repathAt: 0,
    burst: 0,
    burstPause: 0,
    strafe: 0,
    strafeFlipAt: 0,
    stuck: 0,
    lastPos: new THREE.Vector3(),
    skill,
    alive: true,
  };

  const toTarget = new THREE.Vector3();
  const eye = new THREE.Vector3();
  body.name = brain.name;

  function pickRoute(goalId) {
    // Breadth-first over the waypoint graph, so a route is a real path and not a beeline.
    const byId = new Map(waypoints.map((w) => [w.id, w]));
    const start = waypoints.reduce((best, w) => (best && best.pos.distanceTo(body.position) <= w.pos.distanceTo(body.position) ? best : w), null);
    if (!start || !byId.has(goalId)) return [];
    const queue = [[start.id]];
    const seen = new Set([start.id]);
    while (queue.length) {
      const path = queue.shift();
      const last = path[path.length - 1];
      if (last === goalId) return path.map((id) => byId.get(id));
      for (const next of byId.get(last).next) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push([...path, next]);
      }
    }
    return [];
  }

  function setGoal(goalId, now) {
    brain.goal = goalId;
    brain.route = pickRoute(goalId);
    brain.routeIndex = 0;
    brain.repathAt = now + 6;
  }

  function canSee(enemy, shootables, raycaster) {
    if (!enemy.alive) return false;
    const dx = enemy.position.x - body.position.x;
    const dz = enemy.position.z - body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > VISION_RANGE) return false;
    const forwardX = -Math.sin(body.yaw);
    const forwardZ = -Math.cos(body.yaw);
    const dot = (dx * forwardX + dz * forwardZ) / Math.max(0.001, dist);
    if (dot < VISION_COS && dist > 6) return false;
    eye.set(body.position.x, body.position.y + body.eye, body.position.z);
    const target = new THREE.Vector3(enemy.position.x, enemy.position.y + 1.25, enemy.position.z);
    toTarget.copy(target).sub(eye);
    const len = toTarget.length();
    toTarget.normalize();
    raycaster.set(eye, toTarget);
    raycaster.far = len;
    const hit = raycaster.intersectObjects(shootables, false)[0];
    raycaster.far = 90;
    return !hit || hit.distance >= len - 0.4;
  }

  function turnToward(x, z, dt, rate = TURN_RATE) {
    const want = Math.atan2(-(x - body.position.x), -(z - body.position.z));
    let diff = want - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    body.yaw += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
    return Math.abs(diff);
  }

  function moveToward(x, z, dt, keys) {
    keys.clear();
    const dx = x - body.position.x;
    const dz = z - body.position.z;
    if (Math.hypot(dx, dz) < 0.7) return true;
    turnToward(x, z, dt);
    keys.add('KeyW');
    return false;
  }

  function moveKeys(dt, wishX, wishZ) {
    // Turn the body to the wish direction, then hold W: one movement rule for bots and player.
    const want = Math.atan2(-wishX, -wishZ);
    let diff = want - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    body.yaw += THREE.MathUtils.clamp(diff, -TURN_RATE * 1.6 * dt, TURN_RATE * 1.6 * dt);
    const keys = new Set();
    if (Math.abs(diff) < 1.1) keys.add('KeyW');
    return keys;
  }

  function think(dt, now, ctx) {
    if (!body.alive) return { keys: new Set(), fire: false, wantReload: false, plant: false, defuse: false };

    // --- senses
    let seen = null;
    let seenDist = Infinity;
    for (const enemy of ctx.enemies) {
      if (!enemy.alive || enemy.team === body.team) continue;
      if (!canSee(enemy, ctx.shootables, ctx.raycaster)) continue;
      const d = body.position.distanceTo(enemy.position);
      if (d < seenDist) {
        seen = enemy;
        seenDist = d;
      }
    }
    if (seen) {
      if (brain.target !== seen) brain.reaction = REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
      brain.target = seen;
      brain.lastSeen.copy(seen.position);
      brain.lastSeenAt = now;
      brain.state = 'engage';
    } else if (brain.state === 'engage' && now - brain.lastSeenAt > 2.2) {
      brain.target = null;
      brain.state = 'route';
    }

    // --- hearing: an enemy shot nearby is worth turning toward.
    if (!seen && ctx.sounds) {
      for (const sound of ctx.sounds) {
        if (sound.team === body.team) continue;
        if (now - sound.at > 1.4) continue;
        if (body.position.distanceTo(sound.pos) > HEARING_RANGE) continue;
        brain.lastSeen.copy(sound.pos);
        brain.lastSeenAt = now;
        if (brain.state === 'route') brain.state = 'listen';
      }
    }

    // --- engage
    if (brain.state === 'engage' && brain.target) {
      const enemy = brain.target;
      const aimY = enemy.position.y + (enemy.crouching ? 0.95 : 1.28);
      const dx = enemy.position.x - body.position.x;
      const dz = enemy.position.z - body.position.z;
      const wantYaw = Math.atan2(-dx, -dz);
      let diff = wantYaw - body.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      body.yaw += THREE.MathUtils.clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);
      const wantPitch = Math.atan2(aimY - (body.position.y + body.eye), Math.hypot(dx, dz));
      body.pitch += (wantPitch - body.pitch) * Math.min(1, dt * 9);

      const keys = new Set();
      // Hold still to shoot: strafe only while the burst is cooling down.
      if (brain.burstPause > 0) {
        if (now > brain.strafeFlipAt) {
          brain.strafe = brain.strafe === 0 ? (Math.random() < 0.5 ? -1 : 1) : -brain.strafe;
          brain.strafeFlipAt = now + 0.5 + Math.random() * 0.5;
        }
        const rightX = Math.cos(body.yaw) * brain.strafe;
        const rightZ = -Math.sin(body.yaw) * brain.strafe;
        const k = moveKeys(dt, rightX, rightZ);
        for (const key of k) keys.add(key);
      } else if (seenDist > 18) {
        const k = moveKeys(dt, dx, dz);
        for (const key of k) keys.add(key);
      }
      brain.reaction = Math.max(0, brain.reaction - dt);
      const aligned = Math.abs(diff) < 0.10;
      const ready = weaponReady(weapon) && brain.reaction <= 0 && aligned;
      if (weapon.mag === 0 && weapon.reloadLeft === 0) startReload(weapon);
      let fire = false;
      if (ready && brain.burstPause <= 0) {
        fire = true;
        brain.burst += 1;
        if (brain.burst >= 3 + Math.floor(brain.skill * 4)) {
          brain.burst = 0;
          brain.burstPause = 0.18 + Math.random() * 0.22;
        }
      }
      return { keys, fire, wantReload: weapon.mag === 0, plant: false, defuse: false };
    }

    // --- objective work
    const keys = new Set();
    if (body.team === 't' && ctx.bomb && ctx.bomb.carrier === body.id && ctx.bomb.state === 'carried') {
      const site = ctx.nearestSite(body.position);
      if (site && Math.hypot(site.x - body.position.x, site.z - body.position.z) < site.radius) {
        return { keys, fire: false, wantReload: false, plant: true, defuse: false };
      }
      if (now > brain.repathAt || brain.route.length === 0) setGoal(site ? (site.name === 'A' ? 'a-site' : 'b-site') : 'mid-center', now);
    } else if (body.team === 't' && ctx.bomb && ctx.bomb.state === 'carried') {
      if (now > brain.repathAt || brain.route.length === 0) {
        const site = ctx.bomb.siteName === 'A' ? 'a-site' : 'b-site';
        setGoal(site, now);
      }
    } else if (body.team === 'ct' && ctx.bomb && ctx.bomb.state === 'planted') {
      const bomb = ctx.bomb;
      if (Math.hypot(bomb.x - body.position.x, bomb.z - body.position.z) < 1.9) {
        return { keys, fire: false, wantReload: false, plant: false, defuse: true };
      }
      if (now > brain.repathAt || brain.route.length === 0) {
        const site = bomb.siteName === 'A' ? 'a-site' : 'b-site';
        setGoal(site, now);
      }
    } else if (body.team === 'ct') {
      if (!brain.holdPoint) brain.holdPoint = ctx.holdFor(body.id);
      if (now > brain.repathAt || brain.route.length === 0) setGoal(brain.holdPoint, now);
      if (body.position.distanceTo(new THREE.Vector3(...ctx.posOf(brain.holdPoint))) < 1.4) {
        // Hold the angle: settle, face the lane the attackers come from.
        keys.clear();
        turnToward(body.position.x + (body.team === 'ct' ? 0 : 0), body.position.z + 8, dt, 1.6);
        return { keys, fire: false, wantReload: weapon.mag === 0, plant: false, defuse: false };
      }
    } else if (now > brain.repathAt || brain.route.length === 0) {
      setGoal(ctx.bomb && ctx.bomb.state === 'carried' && ctx.bomb.carrier === body.id ? 'mid-center' : 'mid-center', now);
    }

    // --- walk the route
    if (brain.route.length) {
      const node = brain.route[Math.min(brain.routeIndex, brain.route.length - 1)];
      if (moveToward(node.x, node.z, dt, keys) && brain.routeIndex < brain.route.length - 1) {
        brain.routeIndex += 1;
      }
      return { keys, fire: false, wantReload: weapon.mag === 0, plant: false, defuse: false };
    }

    // --- listen: turn toward the last sound, otherwise scan a little.
    if (brain.state === 'listen' && now - brain.lastSeenAt < 3) {
      turnToward(brain.lastSeen.x, brain.lastSeen.z, dt, 2.2);
    } else {
      brain.state = 'route';
      body.yaw += Math.sin(now * 0.7 + brain.id) * dt * 0.5;
    }
    return { keys, fire: false, wantReload: weapon.mag === 0, plant: false, defuse: false };
  }

  return {
    body,
    weapon,
    brain,
    think,
    step(dt, keys, speedScale) {
      ctl.step(dt, keys, speedScale);
      stepWeapon(weapon, dt);
    },
    spread() {
      return weaponSpread(weapon, Math.hypot(body.velocity.x, body.velocity.z)) + (1 - brain.skill) * 0.012;
    },
    onFired() {
      pullTrigger(weapon);
      takeRound(weapon);
    },
    name: brain.name,
  };
}
