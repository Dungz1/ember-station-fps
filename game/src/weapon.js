// Weapon definitions and per-entity weapon state machines (ready -> firing cooldown -> reloading),
// plus the first-person view models built from boxes. Every number here is tuned so the three
// primaries feel distinct: the Viper-9 sprays and pays in money, the Manticore is the steady
// all-rounder, the Longshot-7 punishes movement and rewards holding an angle.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  viper9: {
    id: 'viper9', name: 'Viper-9', kind: 'primary', klass: 'SMG',
    damage: 24, headMult: 3.0, rpm: 900, magSize: 32, reserveMax: 128,
    reloadTime: 2.0, price: 1250, killReward: 600, auto: true, range: 55,
    spreadBase: 0.014, spreadMove: 0.05, spreadAir: 0.11, spreadCrouchMult: 0.65, spreadShot: 0.0075,
    recoilV: 0.55, recoilH: 0.32, noise: 34, zoomFov: 0,
  },
  manticore: {
    id: 'manticore', name: 'Manticore', kind: 'primary', klass: 'Rifle',
    damage: 34, headMult: 3.4, rpm: 640, magSize: 28, reserveMax: 84,
    reloadTime: 2.4, price: 2900, killReward: 300, auto: true, range: 75,
    spreadBase: 0.009, spreadMove: 0.06, spreadAir: 0.13, spreadCrouchMult: 0.6, spreadShot: 0.0085,
    recoilV: 0.72, recoilH: 0.42, noise: 44, zoomFov: 0,
  },
  longshot7: {
    id: 'longshot7', name: 'Longshot-7', kind: 'primary', klass: 'Sniper',
    damage: 118, headMult: 2.3, rpm: 42, magSize: 5, reserveMax: 20,
    reloadTime: 3.1, price: 4750, killReward: 100, auto: false, range: 120,
    spreadBase: 0.0022, spreadMove: 0.09, spreadAir: 0.2, spreadCrouchMult: 0.5, spreadShot: 0,
    recoilV: 1.6, recoilH: 0.55, noise: 60, zoomFov: 26,
  },
  furnace: {
    id: 'furnace', name: 'Furnace', kind: 'grenade', klass: 'HE',
    price: 300, maxCarry: 2, radius: 7.5, damage: 98, fuse: 2.0, throwSpeed: 17,
  },
  flare: {
    id: 'flare', name: 'Flare', kind: 'grenade', klass: 'Flashbang',
    price: 200, maxCarry: 2, radius: 17, flashTime: 2.8, fuse: 1.5, throwSpeed: 17,
  },
  kevlar: {
    id: 'kevlar', name: 'Kevlar Vest', kind: 'armor', klass: 'Gear',
    price: 650, armor: 100,
  },
};

/** The buy menu's order: three primaries, two grenades, the vest. */
export const BUY_ORDER = ['viper9', 'manticore', 'longshot7', 'furnace', 'flare', 'kevlar'];

export function fireInterval(weapon) {
  return 60 / weapon.rpm;
}

/** Give an entity a primary at full magazine and reserve. */
export function giveWeapon(ent, id) {
  const w = WEAPONS[id];
  ent.weaponId = id;
  ent.mag = w.magSize;
  ent.reserve = w.reserveMax;
  ent.reloadTimer = 0;
  ent.fireTimer = 0;
}

/** Round start top-up: full magazine, full reserve, no reload in progress. */
export function refillWeapon(ent) {
  const w = WEAPONS[ent.weaponId];
  ent.mag = w.magSize;
  ent.reserve = w.reserveMax;
  ent.reloadTimer = 0;
  ent.fireTimer = Math.min(ent.fireTimer, 0.15);
}

/**
 * The firing state machine's one gate: true and a round is spent when the weapon is loaded, cool
 * and not mid-reload. Empty guns dry-fire (the click is the player's problem).
 */
export function tryFire(ent) {
  if (ent.reloadTimer > 0 || ent.fireTimer > 0) return false;
  ent.fireTimer = fireInterval(WEAPONS[ent.weaponId]);
  if (ent.mag <= 0) return true; // dry fire: still swings the hammer
  ent.mag -= 1;
  return true;
}

export function startReload(ent) {
  const w = WEAPONS[ent.weaponId];
  if (ent.reloadTimer > 0 || ent.mag >= w.magSize || ent.reserve <= 0) return false;
  ent.reloadTimer = w.reloadTime;
  return true;
}

/** Tick the cooldowns; finishes a reload by moving rounds from reserve into the mag. */
export function stepWeapon(ent, dt) {
  if (ent.fireTimer > 0) ent.fireTimer -= dt;
  if (ent.reloadTimer > 0) {
    ent.reloadTimer -= dt;
    if (ent.reloadTimer <= 0) {
      ent.reloadTimer = 0;
      const w = WEAPONS[ent.weaponId];
      const need = w.magSize - ent.mag;
      const take = Math.min(need, ent.reserve);
      ent.mag += take;
      ent.reserve -= take;
    }
  }
}

// ---------------------------------------------------------------- view models

function part(group, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

/**
 * A first-person view model for one primary: a group whose forward is -Z, muzzle where the flash
 * and tracers start. Geometry is shared-box primitives; materials are the palette's.
 */
export function createViewModel(id) {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.surfaceDark, roughness: 0.55, metalness: 0.65 });
  const mid = new THREE.MeshStandardMaterial({ color: PALETTE.surfaceLight, roughness: 0.5, metalness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({
    color: PALETTE.emberDim, roughness: 0.4, metalness: 0.5,
    emissive: PALETTE.ember, emissiveIntensity: 0.55,
  });
  const grip = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.9, metalness: 0.1 });
  let muzzleZ = -0.7;
  if (id === 'viper9') {
    part(group, 0.075, 0.11, 0.5, 0, 0, -0.12, dark);            // receiver
    part(group, 0.05, 0.05, 0.34, 0, 0.012, -0.5, mid);          // barrel shroud
    part(group, 0.028, 0.028, 0.16, 0, 0.012, -0.72, accent);    // muzzle
    part(group, 0.06, 0.16, 0.09, 0, -0.11, -0.02, grip);        // magazine
    part(group, 0.055, 0.12, 0.1, 0, -0.09, 0.14, grip);         // grip
    part(group, 0.02, 0.045, 0.1, 0, 0.095, -0.16, accent);      // sight rail
    muzzleZ = -0.8;
  } else if (id === 'manticore') {
    part(group, 0.08, 0.12, 0.62, 0, 0, -0.1, dark);
    part(group, 0.055, 0.055, 0.5, 0, 0.015, -0.62, mid);
    part(group, 0.03, 0.03, 0.2, 0, 0.015, -0.92, accent);
    part(group, 0.062, 0.17, 0.1, 0, -0.115, -0.02, grip);
    part(group, 0.058, 0.125, 0.11, 0, -0.095, 0.18, grip);
    part(group, 0.022, 0.05, 0.16, 0, 0.1, -0.18, accent);
    part(group, 0.075, 0.09, 0.16, 0, -0.005, 0.28, dark);       // stock
    muzzleZ = -1.02;
  } else {
    part(group, 0.085, 0.13, 0.8, 0, 0, -0.06, dark);
    part(group, 0.05, 0.05, 0.72, 0, 0.02, -0.78, mid);
    part(group, 0.032, 0.032, 0.22, 0, 0.02, -1.18, accent);
    part(group, 0.06, 0.16, 0.1, 0, -0.115, 0.06, grip);
    part(group, 0.06, 0.12, 0.12, 0, -0.1, 0.26, grip);
    const scope = part(group, 0.06, 0.06, 0.3, 0, 0.135, -0.18, dark);
    scope.rotation.x = 0;
    part(group, 0.075, 0.1, 0.22, 0, 0, 0.36, dark);             // stock
    muzzleZ = -1.28;
  }
  const muzzle = new THREE.Vector3(0, 0.015, muzzleZ);
  return { group, muzzle };
}
