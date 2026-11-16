// One body model for the player and the bots: acceleration, friction, gravity, jump,
// crouch, and a box resolved against the map one axis at a time. The same module drives
// both sides of the fight, so "stop moving to shoot straight" holds for everyone.
//
// Two details earn their keep: a StepUp lets a 0.4 m lip be walked over instead of
// stopping the body dead, and a landing snaps to the highest surface underfoot rather
// than to whichever collider happens to come first in the list.
import * as THREE from 'three';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.56;
export const CROUCH_EYE = 0.98;

const WALK_SPEED = 5.3;
const CROUCH_SPEED = 2.3;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.0;
const STEP_UP = 0.42;
const ARMOR_ABSORB = 0.45;

let nextId = 1;

export function createBody(colliders, spawn, team) {
  const body = {
    id: nextId++,
    team,
    name: '',
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armor: 0,
    alive: true,
    kills: 0,
    deaths: 0,
    lastHitAt: -99,
    lastHitX: 0,
    lastHitZ: 0,
  };

  const probe = new THREE.Box3();

  function overlaps(x, y, z, height) {
    probe.min.set(x - RADIUS, y + 0.02, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - 0.02, z + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  // The highest surface whose top is at or below `ceiling` under the body's footprint.
  function topUnder(x, z, ceiling) {
    let top = -Infinity;
    for (let i = 0; i < colliders.length; i += 1) {
      const c = colliders[i];
      if (c.max.y > ceiling || c.max.y <= top) continue;
      if (x + RADIUS <= c.min.x || x - RADIUS >= c.max.x) continue;
      if (z + RADIUS <= c.min.z || z - RADIUS >= c.max.z) continue;
      top = c.max.y;
    }
    return top;
  }

  // Move on one axis and step a low ledge if it is the only thing in the way.
  function shift(dx, dz) {
    const x = body.position.x + dx;
    const z = body.position.z + dz;
    if (!overlaps(x, body.position.y, z, body.height)) {
      body.position.x = x;
      body.position.z = z;
      return true;
    }
    if (body.onGround) {
      const top = topUnder(x, z, body.position.y + STEP_UP);
      if (top > body.position.y + 0.02 && !overlaps(x, top, z, body.height)) {
        body.position.set(x, top, z);
        return true;
      }
    }
    return false;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys, speedScale = 1) {
    if (!body.alive) return;

    const wantsCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantsCrouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!wantsCrouch && body.crouching
      && !overlaps(body.position.x, body.position.y, body.position.z, STAND_HEIGHT)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward !== 0 || strafe !== 0) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const len = Math.hypot(wishX, wishZ);
      wishX /= len;
      wishZ /= len;
    }

    const speed = (body.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
    const accel = body.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const blend = Math.min(1, accel * dt / Math.max(0.1, speed));
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y = Math.max(-30, body.velocity.y - GRAVITY * dt);

    if (!shift(body.velocity.x * dt, 0)) body.velocity.x = 0;
    if (!shift(0, body.velocity.z * dt)) body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    if (body.position.y <= 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height);
    if (hit) {
      if (body.velocity.y <= 0) {
        body.position.y = topUnder(body.position.x, body.position.z, body.position.y + 0.4);
        body.velocity.y = 0;
        body.onGround = true;
      } else {
        body.position.y = hit.min.y - body.height;
        body.velocity.y = 0;
      }
    }
  }

  // Armour eats part of every hit, so a vest roughly doubles the shots a body survives.
  function damage(amount) {
    if (!body.alive) return false;
    let dealt = amount;
    if (body.armor > 0) {
      const absorbed = Math.min(body.armor, dealt * ARMOR_ABSORB);
      body.armor -= absorbed;
      dealt -= absorbed;
    }
    body.health -= dealt;
    if (body.health <= 0) {
      body.health = 0;
      body.armor = 0;
      body.alive = false;
      body.deaths += 1;
      return true;
    }
    return false;
  }

  function respawn(at) {
    body.position.set(at.x, 0, at.z);
    body.velocity.set(0, 0, 0);
    body.yaw = at.yaw ?? 0;
    body.pitch = 0;
    body.health = 100;
    body.armor = 0;
    body.alive = true;
    body.crouching = false;
    body.height = STAND_HEIGHT;
    body.eye = STAND_EYE;
    body.onGround = true;
  }

  // Other modules act on the raw body, so the two verbs live on it too.
  body.hurt = damage;
  body.place = respawn;

  return {
    state: body,
    step,
    look,
    recoil,
    damage,
    respawn,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    eyePosition(target) {
      return target.set(body.position.x, body.position.y + body.eye, body.position.z);
    },
  };
}
