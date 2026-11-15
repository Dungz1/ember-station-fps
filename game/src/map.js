// EMBER STATION: a geothermal power station at dusk. The layout is a loop worth learning — two
// bomb sites (the Reactor Hall in the north-west, the Turbine Hall in the south-east), a covered
// mid hub, two catwalks for elevation, and lanes on the north and south edges that wrap the map.
// Everything visible is built from shared primitives; every solid thing also hands out an AABB
// collider, and the same file carries the spawn zones, plant zones, patrol routes and hold angles
// the bots fight over.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeBox } from './collision.js';

// [x1, y1, z1, x2, y2, z2, kind]. Kinds pick the material: 'floor', 'wall', 'metal', 'dais',
// 'crate', 'dark'. Anything with kind !== 'decor' also becomes a collider.
const STRUCTURES = [
  // The yard floor and the station shell.
  [-32, -1, -26, 32, 0, 26, 'floor'],
  [-32, 0, -26, 32, 9, -25, 'wall'],
  [-32, 0, 25, 32, 9, 26, 'wall'],
  [-32, 0, -26, -31, 9, 26, 'wall'],
  [31, 0, -26, 32, 9, 26, 'wall'],

  // Site A — the Reactor Hall, north-west: a dais, two reactor columns, a control console.
  [-22, 0, -16, -10, 0.4, -8, 'dais'],
  [-21, 0.4, -15, -18.4, 5.6, -12.4, 'metal'],
  [-13.6, 0.4, -15, -11, 5.6, -12.4, 'metal'],
  [-18, 0.4, -9.6, -14, 1.5, -8.4, 'dark'],

  // Site B — the Turbine Hall, south-east: a dais, two turbine blocks, a control console.
  [10, 0, 8, 22, 0.4, 16, 'dais'],
  [12, 0.4, 9.2, 19, 2.6, 11, 'metal'],
  [13, 0.4, 13, 20, 2.6, 14.8, 'metal'],
  [10.6, 0.4, 14.4, 12.4, 1.5, 15.8, 'dark'],

  // The mid hub: a turbine tower with four cover blocks around it.
  [-1.6, 0, -1.6, 1.6, 5, 1.6, 'dark'],
  [-5.7, 0, -4.7, -3.3, 2, -2.3, 'crate'],
  [3.3, 0, -4.7, 5.7, 2, -2.3, 'crate'],
  [-5.7, 0, 2.3, -3.3, 2, 4.7, 'crate'],
  [3.3, 0, 2.3, 5.7, 2, 4.7, 'crate'],

  // North catwalk (1.6 high) with stepped ramps at its east end, north and south.
  [-6, 0, -17, 6, 1.6, -13, 'metal'],
  [3.4, 0, -13, 6, 1.2, -11.6, 'metal'],
  [3.4, 0, -11.6, 6, 0.8, -10.2, 'metal'],
  [3.4, 0, -10.2, 6, 0.4, -8.8, 'metal'],
  [3.4, 0, -17, 6, 1.2, -18.4, 'metal'],
  [3.4, 0, -18.4, 6, 0.8, -19.8, 'metal'],
  [3.4, 0, -19.8, 6, 0.4, -21.2, 'metal'],

  // South catwalk with stepped ramps at its west end.
  [-6, 0, 13, 6, 1.6, 17, 'metal'],
  [-6, 0, 13, -3.4, 1.2, 11.6, 'metal'],
  [-6, 0, 11.6, -3.4, 0.8, 10.2, 'metal'],
  [-6, 0, 10.2, -3.4, 0.4, 8.8, 'metal'],
  [-6, 0, 17, -3.4, 1.2, 18.4, 'metal'],
  [-6, 0, 18.4, -3.4, 0.8, 19.8, 'metal'],
  [-6, 0, 19.8, -3.4, 0.4, 21.2, 'metal'],

  // Crates and cover in the lanes.
  [-8.4, 0, -6.4, -6.4, 1.2, -4.4, 'crate'],
  [6.4, 0, -6.4, 8.4, 1.2, -4.4, 'crate'],
  [-8.4, 0, 4.4, -6.4, 1.2, 6.4, 'crate'],
  [6.4, 0, 4.4, 8.4, 1.2, 6.4, 'crate'],
  [-13, 0, -2.5, -11, 1.8, -0.5, 'crate'],
  [10, 0, 2, 12, 1.8, 4, 'crate'],
  [-3, 0, -21, -1, 1.4, -19, 'crate'],
  [12, 0, -19, 14, 1.4, -17, 'crate'],
  [-14, 0, 17, -12, 1.4, 19, 'crate'],
  [1, 0, 19, 3, 1.4, 21, 'crate'],
  [-19, 0, -9, -17, 1.2, -7, 'crate'],
  [-19, 0, 7, -17, 1.2, 9, 'crate'],
  [17, 0, -9, 19, 1.2, -7, 'crate'],
  [17, 0, 7, 19, 1.2, 9, 'crate'],
  [-27, 0, -12, -25, 1.2, -10, 'crate'],
  [25, 0, -12, 27, 1.2, -10, 'crate'],

  // Decor (no collision): the glowing lava channels and pools that give the station its name.
  [-26, 0, -20.6, -8, 0.06, -19.4, 'decor'],
  [8, 0, 19.4, 26, 0.06, 20.6, 'decor'],
  [-27, 0, -16, -23, 0.06, -10, 'decor'],
  [23, 0, 10, 27, 0.06, 16, 'decor'],
];

// Teal accent strips on the shell walls and ember window slits on the hub tower (decor).
const STRIPS = [
  [-31.4, 3, -25.9, 31.4, 3.5, -25.7, 'teal'],
  [-31.4, 3, 25.7, 31.4, 3.5, 25.9, 'teal'],
  [-1.9, 3.2, -1.2, -1.65, 3.6, 1.2, 'ember'],
  [1.65, 3.2, -1.2, 1.9, 3.6, 1.2, 'ember'],
];

const SPAWNS = {
  wardens: [
    { x: -25, y: 0, z: -4, yaw: -Math.PI / 2 },
    { x: -25, y: 0, z: 0, yaw: -Math.PI / 2 },
    { x: -25, y: 0, z: 4, yaw: -Math.PI / 2 },
    { x: -23, y: 0, z: -2, yaw: -Math.PI / 2 },
    { x: -23, y: 0, z: 2, yaw: -Math.PI / 2 },
  ],
  raiders: [
    { x: 25, y: 0, z: -4, yaw: Math.PI / 2 },
    { x: 25, y: 0, z: 0, yaw: Math.PI / 2 },
    { x: 25, y: 0, z: 4, yaw: Math.PI / 2 },
    { x: 23, y: 0, z: -2, yaw: Math.PI / 2 },
    { x: 23, y: 0, z: 2, yaw: Math.PI / 2 },
  ],
};

// Attacker lanes and defender responses, as walkable waypoint lists (y = 0.4 on a dais).
const ROUTES = {
  toA: [
    { x: 22, y: 0, z: 0 }, { x: 16, y: 0, z: -6 }, { x: 10, y: 0, z: -10 }, { x: 2, y: 0, z: -12 },
    { x: -4, y: 0, z: -11 }, { x: -9, y: 0, z: -10 }, { x: -11, y: 0.4, z: -11 },
    { x: -16, y: 0.4, z: -12 }, { x: -20, y: 0.4, z: -10 },
  ],
  toB: [
    { x: 22, y: 0, z: 2 }, { x: 16, y: 0, z: 5 }, { x: 10, y: 0, z: 7 }, { x: 8, y: 0, z: 10 },
    { x: 10.5, y: 0.4, z: 11 }, { x: 15, y: 0.4, z: 12 }, { x: 18, y: 0.4, z: 12.5 }, { x: 20, y: 0.4, z: 10 },
  ],
  mid: [
    { x: 22, y: 0, z: 0 }, { x: 14, y: 0, z: 1 }, { x: 8, y: 0, z: 0.5 }, { x: 6.2, y: 0, z: -0.5 },
    { x: 3, y: 0, z: -1 }, { x: 0, y: 0, z: -2.6 }, { x: -3, y: 0, z: -1.2 }, { x: -7, y: 0, z: -2 },
    { x: -11, y: 0, z: -3 }, { x: -15, y: 0, z: -4 }, { x: -13, y: 0.4, z: -11 },
  ],
  wardenToA: [
    { x: -22, y: 0, z: 0 }, { x: -20, y: 0, z: -5 }, { x: -16, y: 0, z: -6.5 }, { x: -13, y: 0.4, z: -9.5 },
    { x: -16, y: 0.4, z: -12 }, { x: -19, y: 0.4, z: -10 },
  ],
  wardenToB: [
    { x: -22, y: 0, z: 2 }, { x: -16, y: 0, z: 3 }, { x: -10, y: 0, z: 5 }, { x: -4, y: 0, z: 7 },
    { x: 2, y: 0, z: 9 }, { x: 9, y: 0, z: 11 }, { x: 12, y: 0.4, z: 12 }, { x: 16, y: 0.4, z: 12 },
  ],
  wardenMid: [
    { x: -22, y: 0, z: 0 }, { x: -16, y: 0, z: 0 }, { x: -10, y: 0, z: 0.5 }, { x: -6, y: 0, z: 0 },
    { x: -2.5, y: 0, z: 0 }, { x: 2.5, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, { x: 10, y: 0, z: 0 },
    { x: 14, y: 0, z: 0 }, { x: 18, y: 0, z: 0 }, { x: 22, y: 0, z: 0 },
  ],
};

// Defender angles: where a Warden plants himself and which way he stares.
const HOLDS = {
  A: [
    { x: -16, y: 0.4, z: -10, yaw: Math.PI },
    { x: -12, y: 0.4, z: -9, yaw: 2.6 },
    { x: -20, y: 0, z: -7, yaw: -0.6 },
    { x: -8, y: 0, z: -12, yaw: 2.2 },
  ],
  B: [
    { x: 11, y: 0.4, z: 12, yaw: -Math.PI / 2 },
    { x: 12, y: 0.4, z: 13, yaw: -0.6 },
    { x: 20, y: 0, z: 7, yaw: 0.6 },
    { x: 8, y: 0, z: 12, yaw: 2.6 },
  ],
  mid: [
    { x: 2.8, y: 0, z: -2.6, yaw: -Math.PI / 2 },
    { x: -2.8, y: 0, z: 2.6, yaw: Math.PI / 2 },
  ],
};

// Cover a bot runs to when the fight turns bad.
const COVERS = [
  { x: -21, y: 0, z: -4 }, { x: -9, y: 0, z: -14 }, { x: 21, y: 0, z: 4 },
  { x: 9, y: 0, z: 14 }, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 },
];

function buildSky() {
  const geo = new THREE.SphereGeometry(240, 20, 12);
  const colors = [];
  const pos = geo.attributes.position;
  const zenith = new THREE.Color(0x1a1e2e);
  const horizon = new THREE.Color(0x4c3350);
  const low = new THREE.Color(0x2c2733);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 240;
    if (y > 0) c.copy(horizon).lerp(zenith, Math.min(1, y * 1.7));
    else c.copy(horizon).lerp(low, Math.min(1, -y * 2.4));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

/** Build the station: scene dressing, lights, and every datum the simulation needs. */
export function buildMap(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 46, 165);
  scene.add(buildSky());

  const unit = new THREE.BoxGeometry(1, 1, 1);
  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.94, metalness: 0.04 }),
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.surface, roughness: 0.85, metalness: 0.12 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.surfaceLight, roughness: 0.55, metalness: 0.55 }),
    dais: new THREE.MeshStandardMaterial({ color: PALETTE.surfaceDark, roughness: 0.8, metalness: 0.2 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.emberDim, roughness: 0.75, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.surfaceDark, roughness: 0.6, metalness: 0.4 }),
    decor: new THREE.MeshBasicMaterial({ color: PALETTE.lava }),
    teal: new THREE.MeshBasicMaterial({ color: PALETTE.tealDim }),
    ember: new THREE.MeshBasicMaterial({ color: PALETTE.ember }),
  };

  const colliders = [];
  const lava = [];
  for (const [x1, y1, z1, x2, y2, z2, kind] of STRUCTURES) {
    const mesh = new THREE.Mesh(unit, materials[kind]);
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    mesh.scale.set(x2 - x1, y2 - y1, z2 - z1);
    mesh.castShadow = kind !== 'floor' && kind !== 'decor';
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (kind === 'decor') {
      lava.push({ x: (x1 + x2) / 2, z: (z1 + z2) / 2 });
    } else {
      colliders.push(makeBox(x1, y1, z1, x2, y2, z2));
    }
  }
  for (const [x1, y1, z1, x2, y2, z2, kind] of STRIPS) {
    const mesh = new THREE.Mesh(unit, materials[kind]);
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    mesh.scale.set(x2 - x1, y2 - y1, z2 - z1);
    scene.add(mesh);
  }

  // Dusk: a cool hemisphere, a low warm sun with shadows, and point lights breathing off the lava.
  const hemi = new THREE.HemisphereLight(PALETTE.sunSky, PALETTE.sunGround, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
  sun.position.set(-52, 26, -28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46;
  sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 170;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);
  for (const l of lava) {
    const light = new THREE.PointLight(PALETTE.lava, 26, 17, 2);
    light.position.set(l.x, 1.6, l.z);
    scene.add(light);
  }

  // The sun's low disc on the horizon, straight down the sun vector.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(11, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.emberBright, fog: false }),
  );
  disc.position.set(-150, 40, -80);
  disc.lookAt(0, 6, 0);
  scene.add(disc);

  return {
    colliders,
    lava,
    sites: [
      {
        id: 'A', name: 'Reactor Hall',
        zone: makeBox(-22, 0, -16, -10, 2.4, -8),
        plant: { x: -16, y: 0.55, z: -12 },
      },
      {
        id: 'B', name: 'Turbine Hall',
        zone: makeBox(10, 0, 8, 22, 2.4, 16),
        plant: { x: 16, y: 0.55, z: 12 },
      },
    ],
    spawns: SPAWNS,
    routes: ROUTES,
    holds: HOLDS,
    covers: COVERS,
  };
}
