// Gunplay: what a bullet does. Hitscan traces against the world's AABBs and every fighter's two
// hitboxes (a head box on top of a body box), damage with falloff and a headshot multiplier,
// a recoil pattern that climbs and then kicks sideways, and a spread cone that punishes movement
// and rewards crouching and standing still. Also the blast rules for the Furnace and the blind
// rule for the Flare. Nothing here allocates in the hot path: traces and boxes are reused.
import { raycastWorld, raycastBox } from './collision.js';
import { WEAPONS } from './weapon.js';

const BODY_HALF = 0.33;
const BODY_HEIGHT = 1.55;
const HEAD_HALF = 0.17;
const HEAD_HEIGHT = 0.33;
// Bot rounds land softer than the player's so firefights breathe instead of ending in a blink.
const BOT_DAMAGE_SCALE = 0.78;

// Reused across every trace.
const worldHit = { dist: 0, nx: 0, ny: 0, nz: 0 };
const boxHit = { dist: 0, nx: 0, ny: 0, nz: 0 };
const bodyBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const headBox = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
const traceResult = { dist: 0, ent: null, part: '', nx: 0, ny: 0, nz: 0 };

function fillBodyBox(ent) {
  const top = ent.crouch ? ent.height - HEAD_HEIGHT : BODY_HEIGHT;
  bodyBox.minX = ent.pos.x - BODY_HALF;
  bodyBox.minY = ent.pos.y;
  bodyBox.minZ = ent.pos.z - BODY_HALF;
  bodyBox.maxX = ent.pos.x + BODY_HALF;
  bodyBox.maxY = ent.pos.y + top;
  bodyBox.maxZ = ent.pos.z + BODY_HALF;
}

function fillHeadBox(ent) {
  const base = ent.crouch ? ent.height - HEAD_HEIGHT : BODY_HEIGHT;
  headBox.minX = ent.pos.x - HEAD_HALF;
  headBox.minY = ent.pos.y + base;
  headBox.minZ = ent.pos.z - HEAD_HALF;
  headBox.maxX = ent.pos.x + HEAD_HALF;
  headBox.maxY = ent.pos.y + base + HEAD_HEIGHT;
  headBox.maxZ = ent.pos.z + HEAD_HALF;
}

export function eyeOf(ent, out) {
  out.x = ent.pos.x;
  out.y = ent.pos.y + (ent.crouch ? ent.eye : ent.eye);
  out.z = ent.pos.z;
  return out;
}

export function createGunplay({ state, map, random, emit }) {
  /**
   * Nearest thing along a unit ray: the world or a fighter's head/body box. `skip` is the
   * shooter. Result lives in a shared object, consumed before the next trace.
   */
  function trace(ox, oy, oz, dx, dy, dz, dist, skip) {
    const wt = raycastWorld(worldHit, ox, oy, oz, dx, dy, dz, dist, map.colliders);
    let best = wt;
    traceResult.dist = wt;
    traceResult.ent = null;
    traceResult.part = '';
    traceResult.nx = worldHit.nx;
    traceResult.ny = worldHit.ny;
    traceResult.nz = worldHit.nz;
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (ent === skip || !ent.alive) continue;
      fillBodyBox(ent);
      let t = raycastBox(boxHit, ox, oy, oz, dx, dy, dz, best, bodyBox);
      if (t < best) {
        best = t;
        traceResult.dist = t;
        traceResult.ent = ent;
        traceResult.part = 'body';
        traceResult.nx = boxHit.nx;
        traceResult.ny = boxHit.ny;
        traceResult.nz = boxHit.nz;
      }
      fillHeadBox(ent);
      t = raycastBox(boxHit, ox, oy, oz, dx, dy, dz, best, headBox);
      if (t < best) {
        best = t;
        traceResult.dist = t;
        traceResult.ent = ent;
        traceResult.part = 'head';
        traceResult.nx = boxHit.nx;
        traceResult.ny = boxHit.ny;
        traceResult.nz = boxHit.nz;
      }
    }
    return traceResult;
  }

  /** Damage at a distance: full close in, fading to 60% at the weapon's limit. */
  function damageFor(weapon, part, dist) {
    let damage = weapon.damage * (part === 'head' ? weapon.headMult : 1);
    if (dist > 25 && weapon.range > 25) {
      damage *= 1 - 0.4 * Math.min(1, (dist - 25) / (weapon.range - 25));
    }
    return damage;
  }

  /** Armor soaks half the blow but sheds faster than it soaks. Bots are tuned less lethal. */
  function applyDamage(target, amount, attacker, weaponId, part) {
    let dealt = attacker.isPlayer === true ? amount : amount * BOT_DAMAGE_SCALE;
    if (target.armor > 0) {
      dealt *= 0.55;
      target.armor = Math.max(0, target.armor - amount * 0.5);
    }
    target.hp -= dealt;
    target.lastHitTime = state.time;
    target.lastHitFrom = attacker;
    const killed = target.hp <= 0;
    if (killed) {
      target.alive = false;
      target.deaths += 1;
      attacker.kills += 1;
    }
    emit({
      type: 'hit', x: target.pos.x, y: target.pos.y + target.eye, z: target.pos.z,
      part, killed, byPlayer: attacker.isPlayer === true, victim: target, attacker,
    });
    if (killed) {
      emit({
        type: 'death', victim: target, attacker, weaponId, headshot: part === 'head',
        victimName: target.name, attackerName: attacker.name,
      });
    }
    return { killed, dealt };
  }

  /**
   * Fire one round along the unit aim (ax, ay, az): the spread cone is sampled here, the trace
   * runs, damage lands, and the shot's noise, tracer and recoil all come out with it.
   */
  function fire(ent, ax, ay, az) {
    const w = WEAPONS[ent.weaponId];
    // Sample a small disk around the aim direction and build a unit vector into it.
    const spread = spreadFor(ent);
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * spread;
    // Orthonormal basis around the aim.
    let ux = 0;
    let uy = 0;
    let uz = 0;
    if (Math.abs(ay) < 0.98) {
      ux = -az;
      uz = ax;
    } else {
      ux = 1;
    }
    const ulen = Math.hypot(ux, uy, uz) || 1;
    ux /= ulen;
    uz /= ulen;
    const vx = ay * uz - az * uy;
    const vy = az * ux - ax * uz;
    const vz = ax * uy - ay * ux;
    const c = Math.cos(angle) * radius;
    const s = Math.sin(angle) * radius;
    let dx = ax + ux * c + vx * s;
    let dy = ay + uy * c + vy * s;
    let dz = az + uz * c + vz * s;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    dx /= dlen;
    dy /= dlen;
    dz /= dlen;

    const ox = ent.pos.x;
    const oy = ent.pos.y + ent.eye;
    const oz = ent.pos.z;
    const hit = trace(ox, oy, oz, dx, dy, dz, w.range, ent);
    const endX = ox + dx * hit.dist;
    const endY = oy + dy * hit.dist;
    const endZ = oz + dz * hit.dist;

    ent.shotsFired += 1;
    ent.lastShotTime = state.time;
    ent.heat = Math.min(ent.heat + w.spreadShot, w.spreadShot * 9);
    recoilAdd(ent, w);
    emit({ type: 'shot', x: ox, y: oy, z: oz, dx, dy, dz, team: ent.team, byPlayer: ent.isPlayer === true, loud: w.noise, shooter: ent });
    emit({ type: 'tracer', x1: ox + dx * 0.6, y1: oy + dy * 0.6 - 0.08, z1: oz + dz * 0.6, x2: endX, y2: endY, z2: endZ });

    let result = null;
    if (hit.ent !== null) {
      const damage = damageFor(w, hit.part, hit.dist);
      const dealt = applyDamage(hit.ent, damage, ent, ent.weaponId, hit.part);
      emit({ type: 'impact', x: endX, y: endY, z: endZ, nx: hit.nx, ny: hit.ny, nz: hit.nz, flesh: true });
      result = { ent: hit.ent, part: hit.part, killed: dealt.killed };
    } else if (hit.dist < w.range) {
      emit({ type: 'impact', x: endX, y: endY, z: endZ, nx: hit.nx, ny: hit.ny, nz: hit.nz, flesh: false });
    }
    return result;
  }

  /** The Furnace's blast: distance falloff, partial cover, everyone in the open feels it. */
  function explosion(x, y, z, radius, maxDamage, owner, weaponId) {
    emit({ type: 'explosion', x, y, z, radius });
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive) continue;
      const cx = ent.pos.x - x;
      const cy = ent.pos.y + 1 - y;
      const cz = ent.pos.z - z;
      const dist = Math.hypot(cx, cy, cz);
      if (dist > radius) continue;
      const inv = dist > 0.001 ? 1 / dist : 0;
      const hit = trace(x, y, z, cx * inv, cy * inv, cz * inv, dist - 0.4, owner);
      const cover = hit.ent === ent ? 1 : 0.35;
      const damage = maxDamage * Math.pow(1 - dist / radius, 1.15) * cover;
      if (damage > 1) applyDamage(ent, damage, owner, weaponId, 'body');
    }
  }

  /** The Flare's flash: how blind someone is depends on distance and whether they faced it. */
  function flashBlind(x, y, z, radius, flashTime) {
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive) continue;
      const cx = ent.pos.x - x;
      const cy = ent.pos.y + ent.eye - y;
      const cz = ent.pos.z - z;
      const dist = Math.hypot(cx, cy, cz);
      if (dist > radius) continue;
      const inv = dist > 0.001 ? 1 / dist : 0;
      const hit = trace(x, y, z, cx * inv, cy * inv, cz * inv, dist - 0.4, null);
      if (hit.ent !== ent) continue; // a wall ate the flash
      const facing = -(cx * inv * Math.sin(ent.yaw) + cz * inv * Math.cos(ent.yaw));
      const amount = (1 - dist / radius) * Math.min(1, 0.35 + Math.max(0, facing) * 0.9);
      const blind = flashTime * amount;
      if (blind > 0.15) {
        ent.blindTime = Math.max(ent.blindTime, blind);
        emit({ type: 'blind', ent, amount });
      }
    }
  }

  /** Spread cone in radians: base accuracy, movement and air penalties, crouch and zoom bonuses. */
  function spreadFor(ent) {
    const w = WEAPONS[ent.weaponId];
    const speed = Math.hypot(ent.vel.x, ent.vel.z);
    let spread = w.spreadBase;
    if (!ent.grounded) spread += w.spreadAir;
    else spread += w.spreadMove * Math.min(1, speed / 5.7);
    if (ent.crouch) spread *= w.spreadCrouchMult;
    if (ent.zoomed) spread *= 0.35;
    spread += ent.heat * (ent.isPlayer === true ? 1 : 0.5);
    return spread;
  }

  /** Vertical climb first, then a sideways swing once the spray is past a few rounds. */
  function recoilAdd(ent, w) {
    const shot = Math.min(ent.shotsFired, 8);
    const climb = 1 + shot * 0.13;
    const side = ent.shotsFired > 3 ? Math.sin(ent.shotsFired * 1.75) : Math.sin(ent.shotsFired * 1.75) * 0.3;
    ent.recoilPitch += w.recoilV * 0.014 * climb;
    ent.recoilYaw += w.recoilH * 0.007 * side;
    ent.viewKick = 1;
  }

  /** Per-tick housekeeping: heat and view punch settle back toward zero. */
  function step(dt) {
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (ent.heat > 0) ent.heat = Math.max(0, ent.heat - dt * 0.045);
      const settle = Math.min(1, dt * 6.5);
      ent.recoilPitch -= ent.recoilPitch * settle;
      ent.recoilYaw -= ent.recoilYaw * settle;
      ent.viewKick -= ent.viewKick * Math.min(1, dt * 9);
      if (ent.blindTime > 0) ent.blindTime = Math.max(0, ent.blindTime - dt);
      if (state.time - ent.lastShotTime > 0.5) ent.shotsFired = 0;
    }
  }

  return { trace, fire, damageFor, applyDamage, explosion, flashBlind, spreadFor, step };
}
