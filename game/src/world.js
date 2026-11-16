// Ember Foundry's yard. One industrial courtyard, two bomb sites, three lanes and a
// ring of connectors, built only from boxes and cylinders: every collider is an AABB the
// body code resolves cheaply and every surface can stop a bullet.
//
// The layout is meant to be read in this order: shell, lanes, sites, cover, dressing,
// light. Lane walls are 0.7 m thick, the perimeter 1 m, and every wall sits inside
// ±22 m so the map agrees with MAP_HALF.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP_HALF = 22;
export const WALL_HEIGHT = 5.2;

export const SITES = [
  { name: 'A', x: 12.0, z: -3.4, radius: 4.4, label: 'SITE A' },
  { name: 'B', x: -12.4, z: 2.6, radius: 4.4, label: 'SITE B' },
];

// Counter-Terrorists hold the south yard, Terrorists push from the north. Slot 0 is the
// player's spawn: centre and furthest back, looking straight down the mid doors.
export const SPAWNS = {
  ct: [
    { x: 0, z: -18.6, yaw: Math.PI },
    { x: -3.2, z: -18.1, yaw: Math.PI },
    { x: 3.2, z: -18.1, yaw: Math.PI },
  ],
  t: [
    { x: 0, z: 18.6, yaw: 0 },
    { x: -3.2, z: 18.1, yaw: 0 },
    { x: 3.2, z: 18.1, yaw: 0 },
  ],
};

// The bots' nav graph. `next` is undirected in practice (every edge is listed from both
// ends); `look` names the point a bot should face when it holds there, which is what
// turns a waypoint into an angle rather than a corner to stand in.
export const WAYPOINTS = [
  { id: 't-spawn', x: 0, z: 17.6, next: ['t-west', 't-east', 'mid-north'] },
  { id: 't-west', x: -8.5, z: 15.2, next: ['t-spawn', 'b-gate'] },
  { id: 't-east', x: 8.5, z: 15.2, next: ['t-spawn', 'a-long-gate'] },

  { id: 'mid-north', x: 0, z: 12.2, next: ['t-spawn', 'mid-center'] },
  { id: 'mid-center', x: 0, z: 2.6, next: ['mid-north', 'mid-block-w', 'mid-block-e', 'a-window', 'b-window'], look: [0, 12] },
  { id: 'mid-block-w', x: -3.6, z: -2.0, next: ['mid-center', 'mid-south', 'mid-west'] },
  { id: 'mid-block-e', x: 3.6, z: -2.0, next: ['mid-center', 'mid-south'] },
  { id: 'mid-south', x: 0, z: -9.2, next: ['mid-block-w', 'mid-block-e', 'mid-west', 'a-short', 'ct-door'], look: [0, 12] },
  { id: 'mid-west', x: -5.0, z: -7.0, next: ['mid-south', 'b-exit'] },
  { id: 'ct-door', x: 0, z: -14.2, next: ['mid-south', 'ct-spawn'] },
  { id: 'ct-spawn', x: 0, z: -17.6, next: ['ct-door', 'ct-yard'] },
  { id: 'ct-yard', x: -8.6, z: -15.2, next: ['ct-spawn', 'ct-west'] },
  { id: 'ct-west', x: -9.5, z: -10.6, next: ['ct-yard', 'b-exit'] },

  { id: 'b-gate', x: -18.4, z: 13.8, next: ['t-west', 'b-tunnel-north'] },
  { id: 'b-tunnel-north', x: -18.4, z: 10.0, next: ['b-gate', 'b-tunnel-mouth'] },
  { id: 'b-tunnel-mouth', x: -18.4, z: 4.8, next: ['b-tunnel-north', 'b-site'] },
  { id: 'b-site', x: -12.4, z: 2.6, next: ['b-tunnel-mouth', 'b-window', 'b-exit'], look: [-18.4, 4.8] },
  { id: 'b-window', x: -8.4, z: 4.0, next: ['b-site', 'mid-center'] },
  { id: 'b-exit', x: -9.8, z: -6.9, next: ['b-site', 'mid-west', 'ct-west'], look: [-12.4, 2.6] },

  { id: 'a-long-gate', x: 18.4, z: 14.0, next: ['t-east', 'a-long-north'] },
  { id: 'a-long-north', x: 18.4, z: 10.5, next: ['a-long-gate', 'a-long-mouth'] },
  { id: 'a-long-mouth', x: 18.4, z: 3.2, next: ['a-long-north', 'a-north'] },
  { id: 'a-north', x: 14.6, z: 1.6, next: ['a-long-mouth', 'a-window', 'a-site'] },
  { id: 'a-window', x: 8.4, z: 1.4, next: ['a-north', 'mid-center'] },
  { id: 'a-site', x: 12.0, z: -3.4, next: ['a-north', 'a-short'], look: [18.4, 3.2] },
  { id: 'a-short', x: 9.4, z: -9.2, next: ['a-site', 'mid-south'], look: [12.0, -3.4] },
];

// A deterministic little generator, so the texture grain is the same in every render.
let grain = 0x2f6e2b1;
function noise() {
  grain = (Math.imul(grain, 1664525) + 1013904223) >>> 0;
  return grain / 4294967296;
}

function paint(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// Near-grey maps that the material colour tints, so one canvas serves concrete, steel
// and the floor without a second colour table.
function createTextures() {
  const concrete = paint(256, (ctx, s) => {
    ctx.fillStyle = '#c6c6c6';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 18000; i += 1) {
      const v = 140 + Math.floor(noise() * 100);
      ctx.fillStyle = `rgba(${v},${v},${v},0.45)`;
      ctx.fillRect(noise() * s, noise() * s, 1 + noise() * 2, 1 + noise() * 2);
    }
    for (let i = 0; i < 6; i += 1) {
      const x = noise() * s;
      const y = noise() * s;
      const r = 10 + noise() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(88,88,88,0.20)');
      g.addColorStop(1, 'rgba(88,88,88,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });

  const steel = paint(256, (ctx, s) => {
    ctx.fillStyle = '#c9ced3';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 210; i += 1) {
      const y = noise() * s;
      ctx.fillStyle = `rgba(${90 + noise() * 60},${95 + noise() * 60},${100 + noise() * 60},0.18)`;
      ctx.fillRect(0, y, s, 0.6 + noise() * 1.2);
    }
    for (let i = 0; i < 110; i += 1) {
      ctx.fillStyle = 'rgba(70,76,82,0.35)';
      ctx.fillRect(noise() * s, noise() * s, 1.5, 1.5 + noise() * 6);
    }
    ctx.fillStyle = 'rgba(60,66,72,0.55)';
    for (const [x, y] of [[10, 10], [s - 10, 10], [10, s - 10], [s - 10, s - 10]]) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // 2 m slabs: the border lands on the tile edge, so the yard reads at a glance.
  const floor = paint(256, (ctx, s) => {
    ctx.fillStyle = '#c2c2c2';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 16000; i += 1) {
      const v = 150 + Math.floor(noise() * 80);
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(noise() * s, noise() * s, 1 + noise() * 2, 1 + noise() * 2);
    }
    ctx.strokeStyle = 'rgba(74,80,86,0.65)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
  });

  const hazard = paint(256, (ctx, s) => {
    ctx.fillStyle = '#d8d2c6';
    ctx.fillRect(0, 0, s, s);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#3a3f44';
    for (let x = -s * 1.5; x < s * 1.5; x += 34) ctx.fillRect(x, -s, 17, s * 2);
    ctx.restore();
  });

  // Planked timber for the crates: the yard's only warm surface, and the thing that stops
  // every box in the map reading as the same grey concrete.
  const wood = paint(256, (ctx, s) => {
    const planks = 4;
    const ph = s / planks;
    for (let p = 0; p < planks; p += 1) {
      const base = 176 + Math.floor(noise() * 34);
      ctx.fillStyle = `rgb(${base},${base - 26},${base - 58})`;
      ctx.fillRect(0, p * ph, s, ph);
      for (let i = 0; i < 26; i += 1) {
        const y = p * ph + noise() * ph;
        ctx.strokeStyle = `rgba(86,62,40,${0.06 + noise() * 0.13})`;
        ctx.lineWidth = 0.8 + noise() * 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(s * 0.33, y + (noise() - 0.5) * 7, s * 0.66, y + (noise() - 0.5) * 7, s, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(54,40,28,0.55)';
      ctx.fillRect(0, p * ph + ph - 2, s, 2);
    }
    ctx.strokeStyle = 'rgba(60,44,30,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
  });

  return { concrete, steel, floor, hazard, wood };
}

function createMaterials(textures) {
  return {
    floor: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.floor), map: textures.floor, roughness: 0.95, metalness: 0.04 }),
    surface: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), map: textures.concrete, roughness: 0.9, metalness: 0.06 }),
    hairline: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), map: textures.steel, roughness: 0.55, metalness: 0.3 }),
    wood: new THREE.MeshStandardMaterial({ color: new THREE.Color('#a8875f'), map: textures.wood, roughness: 0.86, metalness: 0.02 }),
    ink: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.1 }),
    muted: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.7, metalness: 0.15 }),
    accent: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.34, roughness: 0.4, metalness: 0.2 }),
    teal: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 0.4, roughness: 0.4, metalness: 0.2 }),
    pad: new THREE.MeshStandardMaterial({ color: new THREE.Color('#8d8377'), map: textures.hazard, roughness: 0.8, metalness: 0.05 }),
  };
}

// BoxGeometry's UVs are 0..1 per face, so a 9 m wall and a 1 m crate share a texture at
// wildly different scales. Scaling each face's UVs by its world size keeps texel density
// constant with one shared material.
function boxGeometry(w, h, d, tile) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv;
  const du = [d, d, w, w, w, w];
  const dv = [h, h, d, d, h, h];
  for (let face = 0; face < 6; face += 1) {
    for (let v = 0; v < 4; v += 1) {
      const i = face * 4 + v;
      uv.setXY(i, (uv.getX(i) * du[face]) / tile, (uv.getY(i) * dv[face]) / tile);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

function siteDecal(site) {
  const color = site.name === 'A' ? PALETTE.accent : PALETTE.teal;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  // A pale ring with one thin accent ring: the site must read as a place, never as a
  // saturated disc that swallows an orange body standing on it.
  ctx.strokeStyle = 'rgba(242,235,222,0.85)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(128, 128, 102, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f6efe3';
  ctx.font = 'bold 106px "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(site.name, 128, 116);
  ctx.fillStyle = 'rgba(246,239,227,0.8)';
  ctx.font = '600 15px Arial, sans-serif';
  ctx.fillText(site.label, 128, 186);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(site.radius * 2, site.radius * 2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.92, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(site.x, 0.025, site.z);
  return mesh;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  group.name = 'ember-foundry';
  scene.add(group);

  const materials = createMaterials(createTextures());
  const colliders = [];
  const shootables = [];

  // Fake ambient occlusion: a vertical gradient that darkens the first metre of every
  // wall. Without a post-processing pass this is what stops walls and crates from
  // looking pasted onto the floor.
  const aoTex = (() => {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 64, 0, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex, transparent: true, depthWrite: false, opacity: 0.9, side: THREE.DoubleSide,
  });

  function baseAO(w, d, x, z) {
    const along = w >= d;
    for (const side of [-1, 1]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(along ? w : d, 1.05), aoMat);
      if (along) {
        plane.position.set(x, 0.52, z + side * (d / 2 + 0.015));
        plane.rotation.y = side > 0 ? 0 : Math.PI;
      } else {
        plane.position.set(x + side * (w / 2 + 0.015), 0.52, z);
        plane.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      plane.renderOrder = 2;
      group.add(plane);
    }
  }

  // A box is the map's only primitive: y defaults to resting on the floor, and every
  // box is a collider and a bullet surface unless it says otherwise.
  function box(w, h, d, x, z, material, opts = {}) {
    const mesh = new THREE.Mesh(boxGeometry(w, h, d, opts.tile ?? 2), materials[material]);
    mesh.position.set(x, opts.y ?? h / 2, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (opts.collide !== false) {
      mesh.updateMatrixWorld(true);
      colliders.push(new THREE.Box3().setFromObject(mesh));
    }
    if (opts.shootable === true || (opts.collide !== false && opts.shootable !== false)) shootables.push(mesh);
    return mesh;
  }

  function wall(w, d, x, z, height = WALL_HEIGHT, material = 'hairline') {
    const mesh = box(w, height, d, x, z, material);
    baseAO(w, d, x, z);
    return mesh;
  }

  function crate(x, z, size, height = size, material = 'wood') {
    return box(size, height, size, x, z, material, { tile: 1.4 });
  }

  function barrel(x, z, height = 1.05) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, height, 14), materials.hairline);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    mesh.updateMatrixWorld(true);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Decoration: visible, but neither solid nor a bullet stop.
  function trim(w, h, d, x, y, z, material, rotY = 0) {
    const mesh = new THREE.Mesh(boxGeometry(w, h, d, 3), materials[material]);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    group.add(mesh);
    return mesh;
  }

  // --- shell ----------------------------------------------------------------
  box(MAP_HALF * 2 - 0.2, 0.4, MAP_HALF * 2 - 0.2, 0, 0, 'floor', { y: -0.2, castShadow: false, tile: 2 });
  wall(43.8, 1.0, 0, -21.4);
  wall(43.8, 1.0, 0, 21.4);
  wall(1.0, 43.8, -21.4, 0);
  wall(1.0, 43.8, 21.4, 0);

  // --- mid lane: walled on both sides, a door at each end and two windows ----
  // East wall, gaps at z 0.4..2.6 (A window) and z -10.4..-7.9 (A short door).
  wall(0.7, 10.4, 6.2, 7.8);
  wall(0.7, 8.3, 6.2, -3.75);
  wall(0.7, 2.8, 6.2, -11.8);
  // West wall, gaps at z 2.4..5.2 (B window) and z -8.5..-6.0 (B exit door).
  wall(0.7, 7.8, -6.2, 9.1);
  wall(0.7, 8.4, -6.2, -1.8);
  wall(0.7, 4.7, -6.2, -10.85);
  // Mid doors (north) and the CT door (south).
  wall(4.6, 0.7, -3.9, 13);
  wall(4.6, 0.7, 3.9, 13);
  wall(3.6, 0.7, -4.4, -13);
  wall(3.6, 0.7, 4.4, -13);

  // --- A side: long corridor, A short room --------------------------------
  wall(0.7, 7.0, 16.5, 9.5);        // long / A divider, open below z 6
  wall(9.8, 0.7, 11.1, 13);         // T yard wall, long entrance x 16..21
  wall(6.4, 0.7, 9.4, -10.6);       // A short, south
  wall(2.6, 0.7, 7.5, -7.9);        // A short, north (opening x 8.8..12.6)
  wall(0.7, 2.7, 12.6, -9.25);      // A short, east

  // --- B side: tunnel, B exit room ----------------------------------------
  wall(0.7, 7.0, -16.5, 9.5);       // tunnel wall, north half
  wall(0.7, 6.5, -16.5, -0.25);     // tunnel wall, south half (mouth at z 3..6)
  wall(9.8, 0.7, -11.1, 13);        // T yard wall, tunnel entrance x -21..-16
  wall(1.5, 0.7, -12.25, -8.6);     // B exit, south wall west stub
  wall(2.3, 0.7, -7.35, -8.6);      // B exit, south wall east stub (door x -11.5..-8.5)
  wall(2.6, 0.7, -7.5, -5.6);       // B exit, north wall (opening x -13..-8.8)
  wall(0.7, 3.0, -13.0, -7.1);      // B exit, east wall

  // --- yard masses: solid foundry blocks that shape the far corners --------
  box(7.5, 4.2, 7.5, 17.5, -17.0, 'surface', { tile: 3 });
  box(7.5, 3.8, 8.5, -17.5, -16.0, 'surface', { tile: 3 });
  box(6.5, 3.6, 5.5, 18.0, 18.2, 'surface', { tile: 3 });
  box(5.5, 3.4, 4.5, -18.5, 18.6, 'surface', { tile: 3 });

  // --- site A: containers, a low wall to plant behind, a crate to jump on --
  box(2.2, 2.6, 3.2, 15.0, -6.8, 'hairline');
  crate(10.2, -1.4, 1.6);
  wall(3.4, 0.8, 14.5, -8.4, 0.95, 'hairline');
  crate(8.6, -5.4, 1.2);
  wall(3.0, 0.9, 9.6, 0.4, 1.1, 'hairline');
  crate(18.6, 0.4, 1.4);

  // --- site B: pump hall ------------------------------------------------
  box(2.2, 2.6, 3.0, -14.6, 6.2, 'hairline');
  box(1.6, 1.5, 1.6, -9.6, 0.8, 'hairline');
  wall(3.0, 0.8, -14.6, -2.4, 0.95, 'hairline');
  crate(-8.2, 6.6, 1.3);
  box(1.4, 1.2, 2.4, -17.0, -1.0, 'surface');

  // --- mid: one block to play around, crates to peek from ----------------
  box(3.2, 2.6, 2.2, 0, -2.0, 'hairline');
  crate(4.6, 6.2, 1.4);
  crate(-4.6, 6.2, 1.4);
  box(2.0, 1.1, 2.0, 4.2, -6.4, 'surface');
  barrel(5.2, -8.0);
  barrel(10.6, 18.0);

  // --- long: one container leaves a 2.5 m gap to fight through ----------
  box(2.0, 2.6, 1.6, 20.2, 7.0, 'hairline');
  crate(20.0, 13.2, 1.3);

  // --- spawn cover: nobody is shot off the spawn at the bell -------------
  // Split cover leaves the middle of each spawn open, so the first thing a player sees
  // is the lane in front of them and not a wall two metres away.
  wall(2.6, 0.8, 3.4, -15.0, 1.15, 'surface');
  wall(2.6, 0.8, -3.4, -15.0, 1.15, 'surface');
  crate(-6.0, -17.8, 1.3);
  crate(5.6, -17.8, 1.3);
  wall(2.4, 0.8, 9.0, -14.6, 1.0, 'surface');
  crate(-11.4, -12.4, 1.3);

  wall(2.6, 0.8, 3.4, 15.0, 1.15, 'surface');
  wall(2.6, 0.8, -3.4, 15.0, 1.15, 'surface');
  crate(-6.0, 18.4, 1.3);
  crate(6.0, 18.4, 1.3);
  wall(2.4, 0.8, 13.0, 16.6, 1.0, 'surface');
  wall(2.4, 0.8, -12.5, 16.4, 1.0, 'surface');

  // --- dressing: pipes, lamp housings, chimney stacks -------------------
  for (const z of [8.4, 5.2, 1.0]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.2, 8), materials.muted);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-6.2, 3.6, z);
    pipe.rotation.y = Math.PI / 2;
    group.add(pipe);
  }
  for (const site of SITES) {
    // The lamp bar sits on the site's container instead of hanging from a ceiling that
    // does not exist; the point light below it still pools on the pad.
    const onA = site.name === 'A';
    const housing = trim(1.4, 0.18, 0.5, onA ? 15.0 : -14.6, 2.86, onA ? -6.8 : 6.2, onA ? 'accent' : 'teal');
    housing.castShadow = false;
  }
  for (const [x, z] of [[17.5, -17.0], [-17.5, -16.0]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 2.6, 10), materials.surface);
    stack.position.set(x, 5.3, z);
    stack.castShadow = true;
    group.add(stack);
  }
  // Floor guide strips: a faint lane hint, never a collider.
  for (const [x, z, w, d, material] of [[0, 5.0, 0.1, 14, 'accent'], [18.0, 8.0, 0.1, 9, 'accent'], [-18.0, 8.5, 0.1, 8, 'accent']]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE[material]), transparent: true, opacity: 0.22, depthWrite: false,
    }));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.012, z);
    group.add(strip);
  }
  // Door frames: a lit edge on the four chokepoints, so a dark gap reads as a way through
  // instead of a hole in a wall.
  for (const [x, z, span] of [[0, -13, 2.65], [0, 13, 1.65], [6.2, -9.2, 1.0], [-6.2, -7.2, 1.0]]) {
    const across = z === -13 || z === 13;
    for (const side of [-1, 1]) {
      const px = across ? x + side * span : x;
      const pz = across ? z : z + side * span;
      const strip = trim(0.08, 3.2, 0.08, px, 1.6, pz, 'accent');
      strip.castShadow = false;
    }
  }

  // --- sites: hazard pad plus a painted ring, both flat on the floor ----
  const siteMeshes = [];
  for (const site of SITES) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(site.radius * 1.9, site.radius * 1.9), materials.pad);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(site.x, 0.008, site.z);
    pad.receiveShadow = true;
    group.add(pad);
    const decal = siteDecal(site);
    group.add(decal);
    siteMeshes.push(decal);
  }

  // --- light: warm key from the south-east, cold fill, ember pools on site ----
  // A cool sky over a warm key keeps flat boxes reading as separate planes instead of
  // one brown mass, which is the whole trick of a texture-less blockout.
  scene.add(new THREE.AmbientLight(new THREE.Color('#93a7bd'), 0.95));
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8fa8c4'), new THREE.Color('#241f1b'), 1.45));

  const key = new THREE.DirectionalLight(new THREE.Color('#ffd0a2'), 2.7);
  key.position.set(18, 24, 14);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#7fa6c8'), 1.05);
  fill.position.set(-16, 14, -18);
  scene.add(fill);

  for (const site of SITES) {
    const lamp = new THREE.PointLight(new THREE.Color(site.name === 'A' ? PALETTE.accent : PALETTE.teal), 9, 20, 2);
    lamp.position.set(site.x, 3.9, site.z);
    scene.add(lamp);
  }

  // Spawn lamps: a wall-mounted floodlight at each bell, so the first second of a round
  // is readable and the light has something visible to come from.
  for (const z of [-18.6, 18.6]) {
    const lamp = new THREE.PointLight(new THREE.Color('#ffd9b0'), 16, 13, 2);
    lamp.position.set(0, 3.2, z);
    scene.add(lamp);
    const bar = trim(3.0, 0.14, 0.3, 0, 3.6, Math.sign(z) * 20.72, 'ink');
    bar.castShadow = false;
  }

  return { colliders, shootables, group, sites: SITES, siteMeshes, waypoints: WAYPOINTS, spawns: SPAWNS };
}
