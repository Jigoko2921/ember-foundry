// The map: Ember Foundry, an original two-site industrial yard built only from boxes,
// ramps and slabs. Every box is a collider for bodies and a surface a bullet stops on.
// The layout gives three lanes (Long A east, Mid centre, B Tunnel west), two bombsites,
// and cover that rewards stopping to aim.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP_HALF = 22;
export const WALL_HEIGHT = 5.2;

export const SITES = [
  { name: 'A', x: 13, z: -4, radius: 4.6, label: 'SITE A' },
  { name: 'B', x: -13, z: 2, radius: 4.6, label: 'SITE B' },
];

export const SPAWNS = {
  ct: [
    { x: -2.2, z: -18.4, yaw: 0 },
    { x: 2.2, z: -18.4, yaw: 0 },
    { x: 0, z: -19.4, yaw: 0 },
  ],
  t: [
    { x: -2.4, z: 18.4, yaw: Math.PI },
    { x: 2.4, z: 18.4, yaw: Math.PI },
    { x: 0, z: 19.2, yaw: Math.PI },
  ],
};

// Waypoints the bots walk between. Each names its neighbours, so a route is a path in
// this graph rather than a straight line through a wall.
export const WAYPOINTS = [
  { id: 't-spawn', x: 0, z: 17.5, next: ['t-west', 't-east', 'mid-south'] },
  { id: 't-west', x: -9, z: 15.5, next: ['t-spawn', 'b-tunnel-south'] },
  { id: 't-east', x: 9.5, z: 15.5, next: ['t-spawn', 'a-long-south'] },
  { id: 'b-tunnel-south', x: -17.5, z: 12.5, next: ['t-west', 'b-tunnel-mid'] },
  { id: 'b-tunnel-mid', x: -17.5, z: 5.5, next: ['b-tunnel-south', 'b-site'] },
  { id: 'b-site', x: -13, z: 2, next: ['b-tunnel-mid', 'b-exit', 'mid-west'] },
  { id: 'b-exit', x: -8, z: -1.5, next: ['b-site', 'mid-west'] },
  { id: 'a-long-south', x: 17.5, z: 13.5, next: ['t-east', 'a-long-mid'] },
  { id: 'a-long-mid', x: 17.5, z: 2.5, next: ['a-long-south', 'a-site'] },
  { id: 'a-site', x: 13, z: -4, next: ['a-long-mid', 'a-short', 'mid-east'] },
  { id: 'a-short', x: 6.5, z: -10.5, next: ['a-site', 'ct-mid'] },
  { id: 'mid-south', x: 0, z: 13.5, next: ['t-spawn', 'mid-center'] },
  { id: 'mid-center', x: 0, z: 3, next: ['mid-south', 'mid-east', 'mid-west', 'ct-mid'] },
  { id: 'mid-east', x: 5.5, z: -3.5, next: ['mid-center', 'a-site'] },
  { id: 'mid-west', x: -5.5, z: -2, next: ['mid-center', 'b-site', 'b-exit'] },
  { id: 'ct-mid', x: 0, z: -11.5, next: ['mid-center', 'a-short', 'ct-spawn'] },
  { id: 'ct-spawn', x: 0, z: -17.5, next: ['ct-mid'] },
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'teal' ? 0.5 : 0.9,
      metalness: name === 'hairline' ? 0.25 : 0.06,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (opts.collide !== false) {
      mesh.updateMatrixWorld(true);
      colliders.push(new THREE.Box3().setFromObject(mesh));
    }
    if (opts.shootable !== false) shootables.push(mesh);
    return mesh;
  }

  // Floor slab.
  box(MAP_HALF * 2, 0.4, MAP_HALF * 2, 0, -0.2, 0, 'floor', { castShadow: false });

  // --- Floor seams: a 4 m grid just above the slab, so the yard reads at a glance and
  // movement has a sense of scale. These are decoration only: no body and no bullet stops on them.
  for (let i = -20; i <= 20; i += 4) {
    box(0.07, 0.02, MAP_HALF * 2, i, 0.011, 0, 'hairline', { collide: false, shootable: false, castShadow: false });
    box(MAP_HALF * 2, 0.02, 0.07, 0, 0.011, i, 'hairline', { collide: false, shootable: false, castShadow: false });
  }
  // Lane stripes: two thin ember lines down mid and long, a visual guide to the three lanes.
  box(0.12, 0.02, 26, 0, 0.013, 2, 'accent', { collide: false, shootable: false, castShadow: false });
  box(0.12, 0.02, 26, 17.5, 0.013, 2, 'accent', { collide: false, shootable: false, castShadow: false });
  box(0.12, 0.02, 20, -17.5, 0.013, 8, 'accent', { collide: false, shootable: false, castShadow: false });

  // --- Perimeter.
  box(MAP_HALF * 2 + 0.8, WALL_HEIGHT, 0.8, 0, WALL_HEIGHT / 2, -MAP_HALF, 'surface');
  box(MAP_HALF * 2 + 0.8, WALL_HEIGHT, 0.8, 0, WALL_HEIGHT / 2, MAP_HALF, 'surface');
  box(0.8, WALL_HEIGHT, MAP_HALF * 2, -MAP_HALF, WALL_HEIGHT / 2, 0, 'surface');
  box(0.8, WALL_HEIGHT, MAP_HALF * 2, MAP_HALF, WALL_HEIGHT / 2, 0, 'surface');

  // --- Lane walls: mid is walled off from A and B, with two connectors each.
  // East wall of mid, gap at z = -9 (connector to A short) and z = 6.
  box(0.6, WALL_HEIGHT, 12, 6, WALL_HEIGHT / 2, 13, 'hairline');
  box(0.6, WALL_HEIGHT, 9, 6, WALL_HEIGHT / 2, 1, 'hairline');
  box(0.6, WALL_HEIGHT, 8, 6, WALL_HEIGHT / 2, -14, 'hairline');
  // West wall of mid, gap at z = -2 and z = 8.
  box(0.6, WALL_HEIGHT, 12, -6, WALL_HEIGHT / 2, 14, 'hairline');
  box(0.6, WALL_HEIGHT, 8, -6, WALL_HEIGHT / 2, 3, 'hairline');
  box(0.6, WALL_HEIGHT, 9, -6, WALL_HEIGHT / 2, -13, 'hairline');

  // --- Site A: raised dock on the east, two containers, a ramp.
  box(9, 0.9, 9, 13.5, 0.45, -4, 'surface');
  box(9, 0.35, 0.9, 13.5, 1.05, -8.2, 'hairline');
  box(2.2, 2.6, 6.2, 16.6, 2.2, -2.5, 'hairline');
  box(2.6, 2.4, 2.6, 10.2, 1.2, -1.2, 'accent');
  box(2.6, 2.4, 2.6, 10.2, 1.2, -6.8, 'hairline');
  box(3, 0.55, 1.4, 13.5, 0.27, -9.6, 'surface'); // ramp lip into A
  // Crate stack to jump on near long.
  box(1.5, 1.5, 1.5, 17.6, 0.75, 6.4, 'hairline');
  box(1.5, 1.5, 1.5, 17.6, 2.25, 6.4, 'surface');

  // --- Site B: pump hall on the west, low walls and a pipe cluster.
  box(10, 0.6, 10, -13.5, 0.3, 2, 'surface');
  box(3.2, 2.2, 3.2, -16.4, 1.1, 5.4, 'hairline');
  box(3.2, 2.2, 3.2, -16.4, 1.1, -1.4, 'accent');
  box(0.9, 1.4, 6.5, -10.6, 0.7, 2, 'hairline');
  box(6.5, 0.9, 0.9, -13.5, 0.45, -2.4, 'surface');
  box(1.2, 1.2, 1.2, -9.4, 0.6, 6.2, 'hairline');

  // --- Mid: containers and a central pillar, sightlines broken every few metres.
  box(3.4, 2.8, 1.6, 0, 1.4, 7.5, 'hairline');
  box(1.6, 2.8, 3.4, 0, 1.4, 0.5, 'surface');
  box(2.2, 1.1, 2.2, -2.6, 0.55, -5.5, 'hairline');
  box(2.2, 1.1, 2.2, 2.6, 0.55, -5.5, 'hairline');
  box(1.4, 1.4, 1.4, 0, 0.7, -16.5, 'hairline');

  // --- Connectors: short walls that make A short and B exit read as rooms, not gaps.
  box(5, WALL_HEIGHT, 0.6, 8.5, WALL_HEIGHT / 2, -10.2, 'hairline');
  box(0.6, WALL_HEIGHT, 4, 10.8, WALL_HEIGHT / 2, -12.2, 'hairline');
  box(5, WALL_HEIGHT, 0.6, -8.5, WALL_HEIGHT / 2, -8.6, 'hairline');

  // --- Spawn cover so neither side is shot from across the map at the bell.
  box(3.2, 1.2, 0.8, 0, 0.6, -15.2, 'surface');
  box(3.2, 1.2, 0.8, 0, 0.6, 15.2, 'surface');

  // --- Site markers: a flat quad on the floor with the site letter's colour.
  const siteMeshes = [];
  for (const site of SITES) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 40),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(site.name === 'A' ? PALETTE.accent : PALETTE.teal),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.9, site.z);
    group.add(ring);
    siteMeshes.push(ring);
  }

  // --- Light: a warm ember key from the south-east, a cold fill from the north,
  // a low hemisphere and a soft ambient so shadowed faces still read.
  const ambient = new THREE.AmbientLight(new THREE.Color('#9aacbb'), 1.05);
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(new THREE.Color('#7d8f9e'), new THREE.Color('#2a333c'), 1.5);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(new THREE.Color('#ffc79a'), 3.1);
  key.position.set(18, 24, 14);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 28;
  key.shadow.camera.bottom = -28;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0008;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#a8bccc'), 0.6);
  fill.position.set(-16, 14, -18);
  scene.add(fill);

  // Ember pools at each site, so the two objectives glow from a distance.
  for (const site of SITES) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 22, 16, 2);
    lamp.position.set(site.x, 3.4, site.z);
    scene.add(lamp);
  }

  const waypoints = WAYPOINTS.map((w) => ({ ...w, pos: new THREE.Vector3(w.x, 0, w.z) }));

  return { colliders, shootables, group, sites: SITES, siteMeshes, waypoints, spawns: SPAWNS };
}
