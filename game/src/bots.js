// The nine other fighters. Each bot is a finite-state machine — HOLD an angle, MOVE along a route
// to an objective, ENGAGE a visible enemy (with a strafe duel and bursts), INVESTIGATE the last
// noise it heard, RETREAT at low health, PLANT or DEFUSE the reactor charge. Perception is a
// staggered line-of-sight ray with a field of view; hearing is radius-based on the noise records
// the simulation keeps. Bodies move through the same physics as the player, and their meshes are
// simple part stacks posed from the entity state once per render.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, tryFire, startReload, stepWeapon } from './weapon.js';
import { stepCharacter, initBody } from './player.js';
import { raycastWorld } from './collision.js';

const BODY_HALF = 0.33;
const losHit = { dist: 0, nx: 0, ny: 0, nz: 0 };
const FOV_DOT = -0.34; // cos(110 degrees): anything closer to straight ahead is seen
const SIGHT_RANGE = 52;

export function createBots({ state, map, random, emit, gunplay }) {
  const colliders = map.colliders;
  const bots = state.entities.filter((e) => !e.isPlayer);

  // ---- meshes: shared geometry, two team material sets, a part stack per bot
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const legMat = new THREE.MeshStandardMaterial({ color: PALETTE.surfaceDark, roughness: 0.8, metalness: 0.2 });
  const gearMat = new THREE.MeshStandardMaterial({ color: PALETTE.surfaceLight, roughness: 0.6, metalness: 0.45 });
  const visorMat = new THREE.MeshStandardMaterial({
    color: PALETTE.tealDim, emissive: PALETTE.teal, emissiveIntensity: 0.8, roughness: 0.3,
  });
  const visorMatR = new THREE.MeshStandardMaterial({
    color: PALETTE.emberDim, emissive: PALETTE.ember, emissiveIntensity: 0.8, roughness: 0.3,
  });
  const teamMat = {
    wardens: new THREE.MeshStandardMaterial({ color: PALETTE.warden, roughness: 0.55, metalness: 0.35 }),
    raiders: new THREE.MeshStandardMaterial({ color: PALETTE.raider, roughness: 0.55, metalness: 0.35 }),
  };

  function part(group, w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(unit, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  function buildMesh(ent) {
    const group = new THREE.Group();
    const torso = part(group, 0.62, 0.66, 0.36, 0, 1.22, 0, teamMat[ent.team]);
    part(group, 0.22, 0.9, 0.24, -0.15, 0.45, 0, legMat);
    part(group, 0.22, 0.9, 0.24, 0.15, 0.45, 0, legMat);
    part(group, 0.5, 0.2, 0.3, 0, 0.92, 0, gearMat);
    part(group, 0.3, 0.32, 0.3, 0, 1.72, 0, gearMat);
    const visor = part(group, 0.26, 0.08, 0.03, 0, 1.75, -0.16, ent.team === 'wardens' ? visorMat : visorMatR);
    const gun = part(group, 0.08, 0.12, 0.78, 0.27, 1.18, -0.3, gearMat);
    part(group, 0.1, 0.16, 0.12, -0.34, 1.3, 0, teamMat[ent.team]); // shoulder pack
    group.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    sceneAdd(group);
    ent.mesh = { group, torso, visor, gun };
  }

  let scene = null;
  function sceneAdd(group) {
    if (scene !== null) scene.add(group);
  }

  // ---- setup: skills and roles
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    bot.skill = 0.72 + (i % 5) * 0.055 + random() * 0.03;
    bot.reaction = 0.24 + (1 - bot.skill) * 0.55;
    bot.shotError = 0.032 - bot.skill * 0.018;
    bot.thinkTimer = (i % 7) * 0.02;
    bot.ai = {
      state: 'hold', target: null, reactionTimer: 0,
      route: null, routeIdx: 0, holdX: 0, holdY: 0, holdZ: 0, holdYaw: null,
      posted: false, destSet: false, destX: 0, destY: 0, destZ: 0,
      alertX: 0, alertY: 0, alertZ: 0, alertUntil: -1,
      seenX: 0, seenY: 0, seenZ: 0,
      strafeDir: i % 2 === 0 ? 1 : -1, strafeTimer: 1 + random(),
      burst: 0, burstPause: 0, footTimer: random() * 0.4,
      wantPlant: false, wantDefuse: false, coverX: 0, coverY: 0, coverZ: 0,
    };
  }

  /** Line of sight from a bot's eye to a point, world only. */
  function los(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return true;
    const inv = 1 / dist;
    return raycastWorld(losHit, x1, y1, z1, dx * inv, dy * inv, dz * inv, dist - 0.45, colliders) === Infinity;
  }

  function canSee(bot, ent) {
    const dx = ent.pos.x - bot.pos.x;
    const dz = ent.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, ent.pos.y - bot.pos.y, dz);
    if (dist > SIGHT_RANGE) return false;
    const inv = dist > 0.001 ? 1 / dist : 0;
    const dot = -Math.sin(bot.yaw) * dx * inv - Math.cos(bot.yaw) * dz * inv;
    const alerted = bot.ai.alertUntil > state.time;
    if (dot < FOV_DOT && !alerted && dist > 12) return false;
    return los(bot.pos.x, bot.pos.y + bot.eye, bot.pos.z, ent.pos.x, ent.pos.y + ent.eye, ent.pos.z);
  }

  function nearestEnemy(bot) {
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (ent.team === bot.team || !ent.alive) continue;
      const dist = Math.hypot(ent.pos.x - bot.pos.x, ent.pos.y - bot.pos.y, ent.pos.z - bot.pos.z);
      if (dist > SIGHT_RANGE) continue;
      // Prefer the enemy that is shooting at us, then the closest one we can actually see.
      const grudge = ent === bot.lastHitFrom ? -18 : 0;
      if (dist + grudge >= bestDist) continue;
      if (!canSee(bot, ent)) continue;
      best = ent;
      bestDist = dist + grudge;
    }
    return best;
  }

  function hearNoise(bot) {
    for (let i = 0; i < state.noises.length; i++) {
      const n = state.noises[i];
      if (n.team === bot.team || state.time - n.time > 5) continue;
      const dist = Math.hypot(n.x - bot.pos.x, n.y - bot.pos.y, n.z - bot.pos.z);
      if (dist > n.radius) continue;
      bot.ai.alertX = n.x;
      bot.ai.alertY = n.y;
      bot.ai.alertZ = n.z;
      bot.ai.alertUntil = state.time + 7;
      return;
    }
  }

  // ---- decisions, on a slow tick
  function think(bot) {
    const ai = bot.ai;
    ai.wantPlant = false;
    ai.wantDefuse = false;
    if (!bot.alive) return;
    if (bot.blindTime > 0.25) {
      ai.state = 'blind';
      return;
    }
    hearNoise(bot);
    const enemy = nearestEnemy(bot);
    if (enemy !== null) {
      ai.target = enemy;
      ai.seenX = enemy.pos.x;
      ai.seenY = enemy.pos.y;
      ai.seenZ = enemy.pos.z;
      ai.alertUntil = state.time + 7;
      if (ai.state !== 'engage') {
        ai.state = 'engage';
        ai.reactionTimer = bot.reaction * (0.8 + random() * 0.6);
        ai.burst = 0;
        ai.burstPause = 0.15;
      }
      if (bot.hp < 32 && random() < 0.02 && state.time - bot.lastHitTime < 2.5) {
        ai.state = 'retreat';
        flee(bot);
      }
      return;
    }
    if (ai.state === 'engage') {
      ai.state = 'investigate';
      ai.alertX = ai.seenX;
      ai.alertY = ai.seenY;
      ai.alertZ = ai.seenZ;
    }
    if (ai.state === 'investigate') {
      const d = Math.hypot(ai.alertX - bot.pos.x, ai.alertZ - bot.pos.z);
      if (d < 2 || ai.alertUntil < state.time) ai.state = 'hold';
      return;
    }
    if (ai.state === 'retreat') {
      const d = Math.hypot(ai.coverX - bot.pos.x, ai.coverZ - bot.pos.z);
      if (d < 1.8 || bot.hp > 60) ai.state = 'hold';
      return;
    }
    // Objective behavior when nothing is visible.
    const charge = state.charge;
    if (bot.objective === 'attack') {
      if (bot.role === 'planter' && !charge.planted) {
        const site = map.sites[charge.siteIndex];
        const d = Math.hypot(site.plant.x - bot.pos.x, site.plant.z - bot.pos.z);
        if (d < 1.4) {
          ai.state = 'plant';
          ai.wantPlant = true;
          ai.destSet = false;
          return;
        }
        ai.destX = site.plant.x;
        ai.destY = site.plant.y;
        ai.destZ = site.plant.z;
        ai.destSet = true;
        ai.state = 'move';
        return;
      }
      if (ai.state !== 'move') ai.state = 'move';
    } else {
      if (charge.planted) {
        const d = Math.hypot(charge.x - bot.pos.x, charge.z - bot.pos.z);
        if (d < 1.6) {
          ai.state = 'defuse';
          ai.wantDefuse = true;
          ai.destSet = false;
          return;
        }
        ai.destX = charge.x;
        ai.destY = charge.y;
        ai.destZ = charge.z;
        ai.destSet = true;
        ai.state = 'move';
        return;
      }
      if (!ai.posted) ai.state = 'move';
      else if (ai.state !== 'hold') ai.state = 'hold';
    }
  }

  // ---- movement and fighting, every tick
  function steer(bot, tx, tz, speed, dt) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.001) {
      stepCharacter(bot, 0, 0, 0, dt, colliders);
      return;
    }
    const inv = 1 / dist;
    stepCharacter(bot, dx * inv, dz * inv, speed, dt, colliders);
    // Footsteps: audible to enemies unless this bot is creeping.
    const ai = bot.ai;
    ai.footTimer -= dt;
    if (ai.footTimer <= 0 && bot.grounded && speed > 3.4) {
      ai.footTimer = 0.44;
      emit({ type: 'footstep', x: bot.pos.x, y: bot.pos.y, z: bot.pos.z, team: bot.team, loud: 11 });
    }
  }

  function faceToward(bot, tx, tz, dt, fast) {
    const want = Math.atan2(-(tx - bot.pos.x), -(tz - bot.pos.z));
    let delta = want - bot.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const turn = (fast ? 9 : 4.5) * dt;
    bot.yaw += Math.max(-turn, Math.min(turn, delta));
  }

  function engage(bot, dt) {
    const ai = bot.ai;
    const enemy = ai.target;
    const w = WEAPONS[bot.weaponId];
    const dx = enemy.pos.x - bot.pos.x;
    const dy = enemy.pos.y + enemy.eye - (bot.pos.y + bot.eye);
    const dz = enemy.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    faceToward(bot, enemy.pos.x, enemy.pos.z, dt, true);
    bot.pitch += (Math.atan2(dy, Math.hypot(dx, dz)) - bot.pitch) * Math.min(1, dt * 8);

    // Duels are danced: strafe sideways, flip direction on a timer, hold the weapon's band.
    ai.strafeTimer -= dt;
    if (ai.strafeTimer <= 0) {
      ai.strafeTimer = 0.7 + random() * 1.1;
      ai.strafeDir = random() < 0.5 ? -1 : 1;
    }
    const band = w.klass === 'Sniper' ? 24 : w.klass === 'Rifle' ? 15 : 9;
    let tx = enemy.pos.x;
    let tz = enemy.pos.z;
    let speed = 3.1;
    if (dist > band + 7) {
      speed = 4.4;
    } else if (dist < band - 6) {
      tx = bot.pos.x - dx;
      tz = bot.pos.z - dz;
      speed = 3.4;
    } else {
      const inv = dist > 0.001 ? 1 / dist : 0;
      tx = bot.pos.x + -dz * inv * ai.strafeDir * 6;
      tz = bot.pos.z + dx * inv * ai.strafeDir * 6;
    }
    steer(bot, tx, tz, bot.grounded ? speed : speed * 0.5, dt);

    if (ai.reactionTimer > 0) {
      ai.reactionTimer -= dt;
      return;
    }
    // Aim error: how far this shot can stray, worse on the move.
    const movePenalty = Math.hypot(bot.vel.x, bot.vel.z) * 0.0035;
    const err = bot.shotError + movePenalty + (bot.crouch ? -0.006 : 0);
    const ex = dx + (random() * 2 - 1) * err * dist;
    const ey = dy + (random() * 2 - 1) * err * dist * 0.6;
    const ez = dz + (random() * 2 - 1) * err * dist;
    const aimDot = (dx * -Math.sin(bot.yaw) + dz * -Math.cos(bot.yaw)) / (dist || 1);

    if (ai.burstPause > 0) {
      ai.burstPause -= dt;
      return;
    }
    if (bot.mag <= 0) {
      if (startReload(bot)) emit({ type: 'reload', ent: bot, byPlayer: false });
      return;
    }
    if (aimDot < 0.985) return; // still swinging onto the target
    if (tryFire(bot)) {
      const elen = Math.hypot(ex, ey, ez) || 1;
      gunplay.fire(bot, ex / elen, ey / elen, ez / elen);
      ai.burst += 1;
      const burstLen = w.klass === 'Sniper' ? 1 : 3 + Math.floor(random() * 4);
      if (ai.burst >= burstLen) {
        ai.burst = 0;
        ai.burstPause = w.klass === 'Sniper' ? 1.4 + random() : 0.3 + random() * 0.5;
      }
    }
    if (bot.mag <= 0 && bot.reloadTimer <= 0 && startReload(bot)) {
      emit({ type: 'reload', ent: bot, byPlayer: false });
    }
  }

  function act(bot, dt) {
    const ai = bot.ai;
    switch (ai.state) {
      case 'engage':
        if (ai.target !== null && ai.target.alive && canSee(bot, ai.target)) engage(bot, dt);
        else {
          ai.state = 'investigate';
          ai.target = null;
          stepCharacter(bot, 0, 0, 0, dt, colliders);
        }
        break;
      case 'move': {
        if (ai.destSet) {
          const d = Math.hypot(ai.destX - bot.pos.x, ai.destZ - bot.pos.z);
          faceToward(bot, ai.destX, ai.destZ, dt, false);
          if (d < 1.6) ai.destSet = false;
          else steer(bot, ai.destX, ai.destZ, 5.1, dt);
        } else if (ai.route !== null && ai.routeIdx < ai.route.length) {
          const wp = ai.route[ai.routeIdx];
          const d = Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z);
          if (d < 1.7) ai.routeIdx += 1;
          faceToward(bot, wp.x, wp.z, dt, false);
          steer(bot, wp.x, wp.z, 5.1, dt);
        } else {
          // Route walked: settle into a guarding hold at the end of it.
          ai.posted = true;
          ai.state = 'hold';
          if (ai.holdYaw === null) {
            ai.holdYaw = bot.yaw;
            if (ai.route !== null) {
              const wp = ai.route[ai.route.length - 1];
              ai.holdX = wp.x;
              ai.holdY = wp.y;
              ai.holdZ = wp.z;
            }
          }
          stepCharacter(bot, 0, 0, 0, dt, colliders);
        }
        break;
      }
      case 'investigate':
      case 'retreat': {
        const tx = ai.state === 'retreat' ? ai.coverX : ai.alertX;
        const tz = ai.state === 'retreat' ? ai.coverZ : ai.alertZ;
        faceToward(bot, tx, tz, dt, false);
        steer(bot, tx, tz, ai.state === 'retreat' ? 5.4 : 4.6, dt);
        break;
      }
      case 'plant':
      case 'defuse':
        stepCharacter(bot, 0, 0, 0, dt, colliders);
        break;
      case 'blind':
        stepCharacter(bot, 0, 0, 0, dt, colliders);
        break;
      default: {
        // HOLD: stand the post, scan the lane, face the way the fight is expected.
        const yaw = ai.holdYaw === null ? 0 : ai.holdYaw;
        faceToward(bot, bot.pos.x - Math.sin(yaw) * 8, bot.pos.z - Math.cos(yaw) * 8, dt, false);
        stepCharacter(bot, 0, 0, 0, dt, colliders);
        if (bot.reloadTimer <= 0 && bot.mag < WEAPONS[bot.weaponId].magSize * 0.4 && startReload(bot)) {
          emit({ type: 'reload', ent: bot, byPlayer: false });
        }
      }
    }
  }

  /** One fixed step for every bot: slow thinking, fast acting. */
  function step(dt) {
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (!bot.alive) {
        stepWeapon(bot, dt);
        continue;
      }
      stepWeapon(bot, dt);
      bot.thinkTimer -= dt;
      if (bot.thinkTimer <= 0) {
        bot.thinkTimer = 0.12 + (i % 5) * 0.015;
        think(bot);
      }
      act(bot, dt);
    }
  }

  /** Roles and routes for a round: one planter, one defuser, everyone else a fighter. */
  function assignRoles(attackSide, attackSiteIndex) {
    const attackers = [];
    const defenders = [];
    for (const bot of bots) {
      (bot.team === attackSide ? attackers : defenders).push(bot);
    }
    const attackRoute = attackSiteIndex === 0 ? map.routes.toA : map.routes.toB;
    const wardenRoute = attackSiteIndex === 0 ? map.routes.wardenToA : map.routes.wardenToB;
    for (let i = 0; i < attackers.length; i++) {
      const bot = attackers[i];
      bot.objective = 'attack';
      bot.role = i === 0 ? 'planter' : 'fighter';
      bot.ai.route = i === 2 || i === 4 ? map.routes.mid : attackRoute;
    }
    for (let i = 0; i < defenders.length; i++) {
      const bot = defenders[i];
      bot.objective = 'defend';
      bot.role = i === 0 ? 'defuser' : 'fighter';
      bot.ai.route = i % 2 === 0 ? wardenRoute : map.routes.wardenMid;
      const holds = i < 2 ? map.holds[attackSiteIndex === 0 ? 'A' : 'B'] : i < 4 ? map.holds[attackSiteIndex === 0 ? 'B' : 'A'] : map.holds.mid;
      const hold = holds[i % holds.length];
      bot.ai.holdX = hold.x;
      bot.ai.holdY = hold.y;
      bot.ai.holdZ = hold.z;
      bot.ai.holdYaw = hold.yaw;
    }
    // Everyone walks their lane to start; the hold comes when the route is done.
    for (const bot of bots) {
      bot.ai.state = 'move';
      bot.ai.posted = false;
      bot.ai.destSet = false;
      bot.ai.routeIdx = 0;
    }
  }

  /** Pick a cover point away from the current trouble and run for it. */
  function flee(bot) {
    let best = null;
    let bestScore = -Infinity;
    for (const cover of map.covers) {
      const fromEnemy = Math.hypot(cover.x - bot.ai.seenX, cover.z - bot.ai.seenZ);
      const fromMe = Math.hypot(cover.x - bot.pos.x, cover.z - bot.pos.z);
      const score = fromEnemy - fromMe * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = cover;
      }
    }
    if (best !== null) {
      bot.ai.coverX = best.x;
      bot.ai.coverY = best.y;
      bot.ai.coverZ = best.z;
    }
  }

  /** Called every frame from the render loop: poses the meshes from the entity state. */
  function syncMeshes() {
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i];
      if (!bot.mesh) continue;
      const g = bot.mesh.group;
      if (bot.alive) {
        g.position.set(bot.pos.x, bot.pos.y + Math.abs(Math.sin(state.time * 8 + i)) * 0.02 * (Math.hypot(bot.vel.x, bot.vel.z) > 0.5 ? 1 : 0), bot.pos.z);
        g.rotation.set(0, bot.yaw, 0);
        const kick = 1 - Math.max(0, Math.min(1, bot.viewKick));
        bot.mesh.gun.position.z = -0.3 + kick * 0.07;
        bot.mesh.gun.rotation.x = -bot.pitch * 0.7;
      } else {
        g.rotation.x += (-1.52 - g.rotation.x) * 0.16;
        g.position.set(bot.pos.x, bot.pos.y - 0.32, bot.pos.z);
      }
    }
  }

  return {
    bots,
    step,
    syncMeshes,
    assignRoles,
    flee,
    attachScene(sceneRef) {
      scene = sceneRef;
      for (const bot of bots) buildMesh(bot);
    },
    /** Round reset: upright, at a spawn, default posture. */
    resetAt(bot, spawn) {
      bot.pos.x = spawn.x;
      bot.pos.y = spawn.y;
      bot.pos.z = spawn.z;
      bot.vel.x = 0;
      bot.vel.y = 0;
      bot.vel.z = 0;
      bot.yaw = spawn.yaw;
      bot.pitch = 0;
      bot.alive = true;
      bot.hp = 100;
      bot.blindTime = 0;
      bot.heat = 0;
      bot.shotsFired = 0;
      bot.recoilPitch = 0;
      bot.recoilYaw = 0;
      bot.viewKick = 0;
      bot.ai.state = 'hold';
      bot.ai.target = null;
      bot.ai.route = null;
      bot.ai.routeIdx = 0;
      bot.ai.alertUntil = -1;
      if (bot.mesh) {
        bot.mesh.group.rotation.set(0, spawn.yaw, 0);
        bot.mesh.group.position.set(spawn.x, spawn.y, spawn.z);
      }
    },
  };
}
