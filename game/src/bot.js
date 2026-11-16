// Bot brains. A bot walks the waypoint graph toward an objective, watches a cone in front
// of it, hears gunfire, holds an angle when it arrives, and fights in bursts with a
// reaction delay and aim error. It never teleports and never shoots through a wall: every
// shot it takes is traced by main.js against the same map the player's shots are.
//
// The brain is a small state machine — route, engage, hunt, hold — plus one objective rule
// per team. It runs at the fixed step, so it never needs to know how fast the screen is.
import * as THREE from 'three';
import { createBody } from './player.js';
import {
  WEAPONS, createWeaponState, stepWeapon, weaponReady, pullTrigger, takeRound, startReload, weaponSpread,
} from './weapon.js';

const SIGHT_RANGE = 50;
const SIGHT_COS = Math.cos((55 * Math.PI) / 180);
const CLOSE_SIGHT = 6.0;
const HEAR_RANGE = 34;
const TURN_RATE = 6.2;
const SENSE_INTERVAL = 0.05;

let sequence = 1;
let graphSource = null;
let graphIndex = null;

// Every bot shares one waypoint array, so the lookup map is built once, not six times.
function graphFor(waypoints) {
  if (graphSource !== waypoints) {
    graphSource = waypoints;
    graphIndex = new Map(waypoints.map((w) => [w.id, w]));
  }
  return graphIndex;
}

function wrapAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const teamCount = { ct: 0, t: 0 };

export function createBot({ colliders, spawn, team, waypoints, role = 'rifle', skill = 0.5 }) {
  const byId = graphFor(waypoints);
  const ctl = createBody(colliders, spawn, team);
  const body = ctl.state;
  const weapon = createWeaponState(WEAPONS[role === 'smg' ? 'smg' : 'rifle']);
  teamCount[team] += 1;

  const brain = {
    id: sequence,
    name: `${team.toUpperCase()}-${teamCount[team]}`,
    team,
    skill,
    state: 'route',
    goalId: null,
    route: [],
    routeIndex: 0,
    repathAt: 0,
    target: null,
    lastSeen: new THREE.Vector3(),
    lastSeenAt: -99,
    heardX: 0,
    heardZ: 0,
    heardAt: -99,
    senseAt: 0,
    reaction: 0,
    burst: 0,
    burstPause: 0,
    strafe: 0,
    strafeFlipAt: 0,
    checkAt: 0,
    clock: 0,
    unstickUntil: 0,
    unstickDir: 0,
    lastDistance: Infinity,
    stuck: 0,
    holdPoint: null,
    lane: null,
    crouchHold: skill > 0.55,
  };
  sequence += 1;
  body.name = brain.name;

  const intent = { keys: new Set(), fire: false, wantReload: false, plant: false, defuse: false };
  const eye = new THREE.Vector3();
  const aim = new THREE.Vector3();

  // --- navigation ----------------------------------------------------------
  // A node across a wall is a node the body will grind against, so the closest node is
  // only accepted when the leg to it is actually clear; otherwise the nearest visible
  // one wins. Runs on repath, not per frame.
  function nearestNode(x, z) {
    let best = waypoints[0];
    let bestDist = Infinity;
    for (const node of waypoints) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    if (clearLeg(x, z, best.x, best.z)) return best.id;
    let fallback = best;
    let fallbackDist = bestDist * 2.25;
    for (const node of waypoints) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d >= fallbackDist) continue;
      if (!clearLeg(x, z, node.x, node.z)) continue;
      fallback = node;
      fallbackDist = d;
    }
    return fallback.id;
  }

  // Dijkstra over ~26 nodes: a linear scan for the cheapest open node is plenty here and
  // keeps the module dependency-free.
  function findPath(startId, goalId) {
    if (startId === goalId) return [startId];
    const cost = new Map([[startId, 0]]);
    const prev = new Map();
    const open = new Set([startId]);
    while (open.size) {
      let current = null;
      let best = Infinity;
      for (const id of open) {
        const c = cost.get(id);
        if (c < best) {
          best = c;
          current = id;
        }
      }
      if (current === null || current === goalId) break;
      open.delete(current);
      const node = byId.get(current);
      if (!node) break;
      for (const nextId of node.next) {
        const next = byId.get(nextId);
        if (!next) continue;
        const total = best + Math.hypot(next.x - node.x, next.z - node.z);
        if (total < (cost.get(nextId) ?? Infinity)) {
          cost.set(nextId, total);
          prev.set(nextId, current);
          open.add(nextId);
        }
      }
    }
    if (!prev.has(goalId)) return [];
    const path = [goalId];
    let cursor = goalId;
    while (cursor !== startId) {
      cursor = prev.get(cursor);
      if (cursor === undefined) return [];
      path.push(cursor);
    }
    return path.reverse();
  }

  function routeTo(goalId, now) {
    if (!goalId || !byId.has(goalId)) return;
    if (brain.goalId === goalId && brain.route.length > 1 && now < brain.repathAt) return;
    const path = findPath(nearestNode(body.position.x, body.position.z), goalId);
    brain.goalId = goalId;
    brain.route = path;
    brain.routeIndex = path.length > 1 ? 1 : 0;
    brain.repathAt = now + 7 + Math.random() * 3;
  }

  // A cheap walkability test for route smoothing: only runs when a route advances.
  function clearLeg(x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const steps = Math.ceil(Math.hypot(dx, dz) / 0.4);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = x1 + dx * t;
      const z = z1 + dz * t;
      for (const box of colliders) {
        if (box.max.y < 0.45) continue;
        if (x + 0.3 > box.min.x && x - 0.3 < box.max.x && z + 0.3 > box.min.z && z - 0.3 < box.max.z) return false;
      }
    }
    return true;
  }

  function steerTo(x, z, dt, rate = TURN_RATE) {
    const dx = x - body.position.x;
    const dz = z - body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) return 0;
    const diff = wrapAngle(Math.atan2(-dx, -dz) - body.yaw);
    body.yaw += THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
    if (Math.abs(diff) < 1.15) intent.keys.add('KeyW');
    // After a stuck report, slide sideways instead of grinding the same corner.
    if (brain.clock < brain.unstickUntil) intent.keys.add(brain.unstickDir > 0 ? 'KeyD' : 'KeyA');
    return Math.abs(diff);
  }

  // Walk the route. Returns true once the last node is reached.
  function followRoute(dt) {
    const route = brain.route;
    if (!route.length) return true;
    let index = Math.min(brain.routeIndex, route.length - 1);
    let node = byId.get(route[index]);
    if (!node) return true;
    if ((node.x - body.position.x) ** 2 + (node.z - body.position.z) ** 2 < 0.72) {
      if (index < route.length - 1) {
        index += 1;
        // Skip nodes the body can already see past, so routes cut corners naturally.
        while (index + 1 < route.length) {
          const skip = byId.get(route[index + 1]);
          if (!skip || !clearLeg(body.position.x, body.position.z, skip.x, skip.z)) break;
          index += 1;
        }
        brain.routeIndex = index;
        node = byId.get(route[index]);
      } else {
        brain.route = [];
        return true;
      }
    }
    steerTo(node.x, node.z, dt);
    return false;
  }

  // --- senses ---------------------------------------------------------------
  function lineOfSight(enemy, ctx) {
    eye.set(body.position.x, body.position.y + body.eye, body.position.z);
    aim.set(enemy.position.x, enemy.position.y + (enemy.crouching ? 0.9 : 1.2), enemy.position.z);
    aim.sub(eye);
    const distance = aim.length();
    aim.divideScalar(distance || 1);
    ctx.raycaster.set(eye, aim);
    ctx.raycaster.far = distance;
    const hit = ctx.raycaster.intersectObjects(ctx.shootables, false)[0];
    ctx.raycaster.far = 96;
    return !hit || hit.distance >= distance - 0.35;
  }

  function sense(now, ctx) {
    let best = null;
    let bestDist = Infinity;
    for (const enemy of ctx.enemies) {
      if (!enemy.alive || enemy.team === body.team || enemy === body) continue;
      const dx = enemy.position.x - body.position.x;
      const dz = enemy.position.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SIGHT_RANGE || dist >= bestDist) continue;
      if (dist > CLOSE_SIGHT) {
        const facing = (dx * -Math.sin(body.yaw) + dz * -Math.cos(body.yaw)) / dist;
        if (facing < SIGHT_COS) continue;
      }
      if (!lineOfSight(enemy, ctx)) continue;
      best = enemy;
      bestDist = dist;
    }
    if (best) {
      if (brain.target !== best) {
        brain.reaction = 0.13 + (1 - skill) * 0.3;
        brain.burst = 0;
      }
      brain.target = best;
      brain.lastSeen.copy(best.position);
      brain.lastSeenAt = now;
      brain.state = 'engage';
      // Call it out: the rest of the team turns toward the same contact.
      ctx.intel[team].x = best.position.x;
      ctx.intel[team].z = best.position.z;
      ctx.intel[team].at = now;
      return;
    }
    if (brain.target && now - brain.lastSeenAt > 0.4) brain.target = null;
  }

  function hear(now, ctx) {
    if (brain.target) return;
    for (const sound of ctx.sounds) {
      if (sound.team === team || now - sound.at > 1.1) continue;
      const d = Math.hypot(sound.x - body.position.x, sound.z - body.position.z);
      if (d > (sound.radius ?? HEAR_RANGE)) continue;
      brain.heardX = sound.x;
      brain.heardZ = sound.z;
      brain.heardAt = now;
      if (brain.state !== 'hunt') brain.state = 'hunt';
    }
    const call = ctx.intel[team];
    if (call.at > brain.heardAt && now - call.at < 4.5) {
      brain.heardX = call.x;
      brain.heardZ = call.z;
      brain.heardAt = call.at;
      if (brain.state === 'route' || brain.state === 'hold') brain.state = 'hunt';
    }
  }

  // --- objective ------------------------------------------------------------
  function siteNode(name) {
    return name === 'B' ? 'b-site' : 'a-site';
  }

  function objectiveNode(ctx) {
    const bomb = ctx.bomb;
    if (team === 't') {
      if (bomb.state === 'planted') return siteNode(bomb.siteName);
      if (bomb.carrier === body.id) return siteNode(ctx.attackSite);
      // A non-carrier pushes its lane first and joins the fight at the site.
      if (brain.lane) {
        const lane = byId.get(brain.lane);
        if (lane && (lane.x - body.position.x) ** 2 + (lane.z - body.position.z) ** 2 > 2.25) return brain.lane;
        brain.lane = null;
      }
      return siteNode(ctx.attackSite);
    }
    if (bomb.state === 'planted') return siteNode(bomb.siteName);
    return brain.holdPoint ?? ctx.holdFor(brain.id) ?? 'mid-center';
  }

  // --- states ---------------------------------------------------------------
  function engage(dt, now) {
    const enemy = brain.target;
    const dx = enemy.position.x - body.position.x;
    const dz = enemy.position.z - body.position.z;
    const dist = Math.hypot(dx, dz);
    const aimY = enemy.position.y + (enemy.crouching ? 0.92 : 1.24);
    const rate = TURN_RATE + skill * 2;
    intent.keys.clear();
    intent.plant = false;
    intent.defuse = false;

    const turn = wrapAngle(Math.atan2(-dx, -dz) - body.yaw);
    body.yaw += THREE.MathUtils.clamp(turn, -rate * dt, rate * dt);
    const wantPitch = Math.atan2(aimY - (body.position.y + body.eye), Math.max(0.3, dist));
    body.pitch += (wantPitch - body.pitch) * Math.min(1, dt * 10);

    if (brain.burstPause > 0) brain.burstPause = Math.max(0, brain.burstPause - dt);
    // Move only while a burst is cooling: standing still is what makes the next one land.
    if (brain.burstPause > 0 && dist > 4) {
      if (now > brain.strafeFlipAt) {
        brain.strafe = brain.strafe === 0 ? (Math.random() < 0.5 ? -1 : 1) : -brain.strafe;
        brain.strafeFlipAt = now + 0.45 + Math.random() * 0.5;
      }
      const strafeX = Math.cos(body.yaw) * brain.strafe;
      const strafeZ = -Math.sin(body.yaw) * brain.strafe;
      const side = wrapAngle(Math.atan2(-strafeX, -strafeZ) - body.yaw);
      body.yaw += THREE.MathUtils.clamp(side, -rate * dt, rate * dt);
      if (Math.abs(side) < 1.1) intent.keys.add('KeyW');
    } else if (dist > 24 && skill > 0.4) {
      steerTo(enemy.position.x, enemy.position.z, dt);
    }

    // Re-aim after the strafe turn, so the burst starts on target.
    const aimError = wrapAngle(Math.atan2(-dx, -dz) - body.yaw);
    body.yaw += THREE.MathUtils.clamp(aimError, -rate * dt, rate * dt);

    brain.reaction = Math.max(0, brain.reaction - dt);
    if (weapon.mag === 0 && weapon.reloadLeft === 0) startReload(weapon);
    intent.fire = false;
    if (weaponReady(weapon) && brain.reaction <= 0 && Math.abs(aimError) < 0.075 && brain.burstPause <= 0) {
      intent.fire = true;
      brain.burst += 1;
      if (brain.burst >= 3 + Math.floor(skill * 4)) {
        brain.burst = 0;
        brain.burstPause = 0.12 + Math.random() * 0.24;
      }
    }
    intent.wantReload = weapon.mag === 0;
    return intent;
  }

  function hunt(dt, now, ctx) {
    if (now - brain.heardAt > 6) {
      brain.state = 'route';
      brain.route = [];
      return null;
    }
    const dist = Math.hypot(brain.heardX - body.position.x, brain.heardZ - body.position.z);
    if (dist < 1.4) {
      // Arrived, nothing here: go back to the objective and let the route planner pick it
      // up again, rather than turning an investigation into a new home.
      brain.state = 'route';
      brain.route = [];
      brain.repathAt = 0;
      return null;
    }
    if (dist < 9) {
      steerTo(brain.heardX, brain.heardZ, dt);
    } else if (!brain.route.length || brain.repathAt < now) {
      routeTo(nearestNode(brain.heardX, brain.heardZ), now);
      followRoute(dt);
    } else {
      followRoute(dt);
    }
    intent.wantReload = weapon.mag < weapon.def.magSize * 0.3;
    return intent;
  }

  function hold(dt, node, crouch) {
    // Settle onto the angle: face the lane the attackers come from, crouch behind cover.
    if (node && node.look) {
      const diff = wrapAngle(Math.atan2(-(node.look[0] - body.position.x), -(node.look[1] - body.position.z)) - body.yaw);
      body.yaw += THREE.MathUtils.clamp(diff, -1.8 * dt, 1.8 * dt);
    }
    if (crouch) intent.keys.add('ControlLeft');
    intent.wantReload = weapon.mag < weapon.def.magSize;
    return intent;
  }

  function think(dt, now, ctx) {
    intent.keys.clear();
    intent.fire = false;
    intent.wantReload = false;
    intent.plant = false;
    intent.defuse = false;
    if (!body.alive) return intent;

    if (now >= brain.senseAt) {
      brain.senseAt = now + SENSE_INTERVAL;
      sense(now, ctx);
      hear(now, ctx);
    }

    if (brain.target && brain.target.alive) return engage(dt, now);
    if (brain.state === 'hunt') {
      const out = hunt(dt, now, ctx);
      if (out) return out;
    }

    // --- objective work ---
    const bomb = ctx.bomb;
    if (team === 't' && bomb.state === 'carried' && bomb.carrier === body.id) {
      const site = ctx.nearestSite(body.position);
      if (site && Math.hypot(site.x - body.position.x, site.z - body.position.z) < site.radius - 0.3) {
        intent.plant = true;
        intent.keys.clear();
        return intent;
      }
    }
    if (team === 'ct' && bomb.state === 'planted') {
      const dist = Math.hypot(bomb.x - body.position.x, bomb.z - body.position.z);
      if (dist < 1.9) {
        intent.defuse = true;
        intent.keys.clear();
        return intent;
      }
    }
    // A planted T holds the site rather than chasing the last defender.
    if (team === 't' && bomb.state === 'planted') {
      const node = byId.get(siteNode(bomb.siteName));
      if (node && Math.hypot(node.x - body.position.x, node.z - body.position.z) < 5.5) {
        return hold(dt, node, brain.crouchHold);
      }
    }

    const goal = objectiveNode(ctx);
    const goalNode = byId.get(goal);
    const arrived = goalNode
      && Math.hypot(goalNode.x - body.position.x, goalNode.z - body.position.z) < 1.3;
    if (!arrived) {
      if (goal !== brain.goalId || brain.route.length === 0) routeTo(goal, now);
      if (brain.route.length) followRoute(dt);
      intent.wantReload = weapon.mag < weapon.def.magSize * 0.3;
      return intent;
    }
    return hold(dt, goalNode, brain.crouchHold && team === 'ct');
  }

  return {
    body,
    weapon,
    brain,
    think,
    step(dt, keys, speedScale) {
      ctl.step(dt, keys, speedScale);
      stepWeapon(weapon, dt);
      // Stuck watchdog: a body that stops closing on its route for a second repaths.
      brain.clock += dt;
      if (brain.clock - brain.checkAt > 0.8) {
        brain.checkAt = brain.clock;
        const route = brain.route;
        const node = route.length ? byId.get(route[Math.min(brain.routeIndex, route.length - 1)]) : null;
        const distance = node ? Math.hypot(node.x - body.position.x, node.z - body.position.z) : Infinity;
        if (distance > brain.lastDistance - 0.12 && distance > 1) brain.stuck += 1;
        else brain.stuck = 0;
        brain.lastDistance = distance;
        if (brain.stuck >= 2) {
          brain.stuck = 0;
          brain.repathAt = 0;
          brain.route = [];
          brain.unstickUntil = brain.clock + 0.7;
          brain.unstickDir = Math.random() < 0.5 ? -1 : 1;
        }
      }
    },
    spread() {
      const speed = Math.hypot(body.velocity.x, body.velocity.z);
      return weaponSpread(weapon, speed) + (1 - brain.skill) * 0.011;
    },
    onFired() {
      pullTrigger(weapon);
      takeRound(weapon);
    },
    name: brain.name,
  };
}
