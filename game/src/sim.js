// The simulation: one state store (entities, the charge, the round, noises), stepped at a fixed
// 64 Hz by main's accumulator. This module knows nothing about rendering: it reads a command
// snapshot for the player, runs the bot machines and the round machine, moves grenades, and
// queues events that main turns into effects, sounds and HUD. Everything random comes from one
// seeded generator, so a given seed always plays back the same way.
import { PLAYER, initBody, stepPlayer } from './player.js';
import { WEAPONS, giveWeapon, refillWeapon, tryFire, startReload, stepWeapon } from './weapon.js';
import { createGunplay } from './gunplay.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { ECONOMY, initEconomy, award, buy, botBuy, killReward } from './economy.js';
import { raycastWorld } from './collision.js';

export const FIXED_STEP = 1 / 64;
const WARDEN_BOTS = ['Kestrel', 'Halcyon', 'Onyx', 'Bolt'];
const RAIDER_BOTS = ['Scorch', 'Pyre', 'Char', 'Sable', 'Vandal'];

function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEntity(id, name, team, isPlayer) {
  return {
    id, name, team, isPlayer,
    alive: true, hp: 100, armor: 0, kills: 0, deaths: 0,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    eye: PLAYER.eye, height: PLAYER.height, halfWidth: PLAYER.halfWidth,
    crouch: false, grounded: false,
    weaponId: 'viper9', mag: 32, reserve: 128, fireTimer: 0, reloadTimer: 0,
    grenades: { furnace: 0, flare: 0 },
    money: ECONOMY.startMoney, lossStreak: 0,
    heat: 0, shotsFired: 0, lastShotTime: -1, lastHitTime: -1, lastHitFrom: null,
    recoilPitch: 0, recoilYaw: 0, viewKick: 0, blindTime: 0, zoomed: false,
  };
}

export function createSim({ map, seed = 1 }) {
  const random = mulberry32(seed);
  const state = {
    time: 0,
    entities: [],
    noises: [],
    charge: null,
    round: null,
    events: [],
  };
  const events = state.events;

  function pushNoise(x, y, z, radius, team) {
    state.noises.push({ x, y, z, radius, team, time: state.time });
    if (state.noises.length > 28) state.noises.splice(0, state.noises.length - 28);
  }

  function emit(e) {
    events.push(e);
    if (e.type === 'shot') pushNoise(e.x, e.y, e.z, e.loud, e.team);
    else if (e.type === 'footstep') pushNoise(e.x, e.y, e.z, e.loud, e.team);
    else if (e.type === 'explosion') pushNoise(e.x, e.y, e.z, 75, null);
    else if (e.type === 'death') award(e.attacker, killReward(e.weaponId));
  }

  // ---- the fighters
  const player = makeEntity('player', 'You', 'wardens', true);
  state.entities.push(player);
  for (let i = 0; i < WARDEN_BOTS.length; i++) {
    const bot = makeEntity('w' + i, WARDEN_BOTS[i], 'wardens', false);
    bot.sniper = i === 2;
    state.entities.push(bot);
  }
  for (let i = 0; i < RAIDER_BOTS.length; i++) {
    const bot = makeEntity('r' + i, RAIDER_BOTS[i], 'raiders', false);
    bot.sniper = i === 2;
    state.entities.push(bot);
  }
  for (const ent of state.entities) initBody(ent);
  for (const ent of state.entities) if (!ent.isPlayer) initEconomy(ent, ECONOMY.startMoney + 1200);
  initEconomy(player, ECONOMY.startMoney);

  const gunplay = createGunplay({ state, map, random, emit });
  const bots = createBots({ state, map, random, emit, gunplay });
  const rounds = createRounds({ state, map, random, emit, onRoundStart });

  // ---- grenades: a fixed pool of live projectiles
  const grenadePool = [];
  for (let i = 0; i < 12; i++) {
    grenadePool.push({ active: false, type: 'furnace', owner: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0 });
  }
  const gHit = { dist: 0, nx: 0, ny: 0, nz: 0 };
  const gHit2 = { dist: 0, nx: 0, ny: 0, nz: 0 };

  function throwGrenade(type) {
    const w = WEAPONS[type];
    if (player.grenades[type] <= 0 || !player.alive) return false;
    let slot = null;
    for (const g of grenadePool) {
      if (!g.active) {
        slot = g;
        break;
      }
    }
    if (slot === null) return false;
    player.grenades[type] -= 1;
    const aim = aimDir(player);
    slot.active = true;
    slot.type = type;
    slot.owner = player;
    slot.x = player.pos.x + aim.x * 0.6;
    slot.y = player.pos.y + player.eye - 0.12;
    slot.z = player.pos.z + aim.z * 0.6;
    slot.vx = aim.x * w.throwSpeed;
    slot.vy = aim.y * w.throwSpeed + 2.8;
    slot.vz = aim.z * w.throwSpeed;
    slot.fuse = w.fuse;
    emit({ type: 'throw', ent: player, grenade: type });
    return true;
  }

  function detonate(g) {
    const w = WEAPONS[g.type];
    if (g.type === 'furnace') {
      gunplay.explosion(g.x, g.y, g.z, w.radius, w.damage, g.owner, 'furnace');
    } else {
      gunplay.flashBlind(g.x, g.y, g.z, w.radius, w.flashTime);
      emit({ type: 'flashbang', x: g.x, y: g.y, z: g.z });
    }
  }

  function stepGrenades(dt) {
    for (const g of grenadePool) {
      if (!g.active) continue;
      g.fuse -= dt;
      const oldX = g.x;
      const oldY = g.y;
      const oldZ = g.z;
      g.vy -= 19 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      const dx = g.x - oldX;
      const dy = g.y - oldY;
      const dz = g.z - oldZ;
      const len = Math.hypot(dx, dy, dz);
      if (len > 0.001) {
        const inv = 1 / len;
        const t = raycastWorld(gHit, oldX, oldY, oldZ, dx * inv, dy * inv, dz * inv, len + 0.12, map.colliders);
        if (t !== Infinity) {
          g.x = oldX + dx * inv * t + gHit.nx * 0.035;
          g.y = oldY + dy * inv * t + gHit.ny * 0.035;
          g.z = oldZ + dz * inv * t + gHit.nz * 0.035;
          const dot = g.vx * gHit.nx + g.vy * gHit.ny + g.vz * gHit.nz;
          if (dot < 0) {
            g.vx -= 1.42 * dot * gHit.nx;
            g.vy -= 1.42 * dot * gHit.ny;
            g.vz -= 1.42 * dot * gHit.nz;
            g.vx *= 0.82;
            g.vy *= 0.82;
            g.vz *= 0.82;
          }
        }
      }
      // Ground snap so a grenade comes to rest on the floor instead of in it.
      const gt = raycastWorld(gHit2, g.x, g.y + 0.2, g.z, 0, -1, 0, 0.42, map.colliders);
      if (gt !== Infinity) {
        const floorY = g.y + 0.2 - gt;
        if (g.y < floorY + 0.07) {
          g.y = floorY + 0.04;
          if (g.vy < 0) g.vy = -g.vy * 0.28;
          g.vx *= 0.86;
          g.vz *= 0.86;
          if (Math.abs(g.vx) + Math.abs(g.vy) + Math.abs(g.vz) < 0.7) {
            g.vx = 0;
            g.vy = 0;
            g.vz = 0;
          }
        }
      }
      if (g.fuse <= 0) {
        g.active = false;
        detonate(g);
      }
    }
  }

  // ---- the player's command snapshot (main writes into this each frame)
  const cmd = {
    forward: false, back: false, left: false, right: false,
    jump: false, crouch: false, walk: false,
    fire: false, reload: false, use: false, zoom: false,
    throwHe: false, throwFlash: false,
  };
  let fireLatch = false;
  let throwHeLatch = false;
  let throwFlashLatch = false;

  // Reused aim vector: where the player's eyes point, recoil included.
  const aim = { x: 0, y: 0, z: -1 };
  function aimDir(ent) {
    const yaw = ent.yaw + ent.recoilYaw;
    const pitch = ent.pitch + ent.recoilPitch;
    const cp = Math.cos(pitch);
    aim.x = -Math.sin(yaw) * cp;
    aim.y = Math.sin(pitch);
    aim.z = -Math.cos(yaw) * cp;
    return aim;
  }

  function handlePlayerActions(dt) {
    if (!player.alive) return;
    player.zoomed = cmd.zoom && WEAPONS[player.weaponId].zoomFov > 0;
    if (cmd.reload && startReload(player)) emit({ type: 'reload', ent: player, byPlayer: true });
    if (cmd.fire) {
      const w = WEAPONS[player.weaponId];
      if ((w.auto || !fireLatch) && rounds.canFight() && player.reloadTimer <= 0 && player.fireTimer <= 0) {
        fireLatch = true;
        const hadAmmo = player.mag > 0;
        tryFire(player);
        if (hadAmmo) {
          const dir = aimDir(player);
          gunplay.fire(player, dir.x, dir.y, dir.z);
        } else {
          emit({ type: 'dryfire', ent: player });
        }
      }
    } else {
      fireLatch = false;
    }
    if (cmd.throwHe && !throwHeLatch) {
      throwHeLatch = true;
      throwGrenade('furnace');
    }
    if (!cmd.throwHe) throwHeLatch = false;
    if (cmd.throwFlash && !throwFlashLatch) {
      throwFlashLatch = true;
      throwGrenade('flare');
    }
    if (!cmd.throwFlash) throwFlashLatch = false;
    if (cmd.use) {
      if (rounds.canPlant() && player.team === rounds.round.attackSide) {
        rounds.plantTick(player, dt);
      } else if (state.charge.planted && player.team !== rounds.round.attackSide) {
        rounds.defuseTick(player, dt);
      }
    }
  }

  // ---- round lifecycle
  function placeAt(ent, spawn) {
    ent.pos.x = spawn.x;
    ent.pos.y = spawn.y;
    ent.pos.z = spawn.z;
    ent.vel.x = 0;
    ent.vel.y = 0;
    ent.vel.z = 0;
    ent.yaw = spawn.yaw;
    ent.pitch = 0;
  }

  function onRoundStart(attackSide, attackSiteIndex) {
    const wardenSpawns = map.spawns.wardens;
    const raiderSpawns = map.spawns.raiders;
    let wardenIndex = 1;
    let raiderIndex = 0;
    for (const ent of state.entities) {
      ent.alive = true;
      ent.hp = 100;
      ent.blindTime = 0;
      ent.heat = 0;
      ent.shotsFired = 0;
      ent.recoilPitch = 0;
      ent.recoilYaw = 0;
      ent.viewKick = 0;
      ent.fireTimer = 0;
      ent.reloadTimer = 0;
      ent.lastHitFrom = null;
      ent.crouch = false;
      if (ent.isPlayer) {
        placeAt(ent, wardenSpawns[0]);
        refillWeapon(ent);
      } else {
        const spawn = ent.team === 'wardens' ? wardenSpawns[wardenIndex++ % wardenSpawns.length] : raiderSpawns[raiderIndex++ % raiderSpawns.length];
        bots.resetAt(ent, spawn);
        refillWeapon(ent);
        botBuy(ent, ent.sniper);
      }
    }
    for (const g of grenadePool) g.active = false;
    bots.assignRoles(attackSide, attackSiteIndex);
    player.objective = player.team === attackSide ? 'attack' : 'defend';
  }

  function step(dt) {
    state.time += dt;
    rounds.step(dt);
    const phase = rounds.round.phase;
    if (phase === 'freeze' || phase === 'live' || phase === 'planted') {
      if (player.alive) {
        stepPlayer(player, cmd, dt, map.colliders);
        handlePlayerActions(dt);
      }
      stepWeapon(player, dt);
      if (phase !== 'freeze') {
        bots.step(dt);
        for (const bot of bots.bots) {
          if (!bot.alive) continue;
          if (bot.wantPlant) rounds.plantTick(bot, dt);
          if (bot.wantDefuse) rounds.defuseTick(bot, dt);
        }
      }
    }
    // Grenades in flight keep flying whatever the round machine is doing.
    stepGrenades(dt);
    gunplay.step(dt);
    if (state.noises.length > 0 && state.noises[0].time < state.time - 9) {
      state.noises.splice(0, state.noises.length);
    }
  }

  function buyItem(itemId) {
    if (!rounds.canBuy()) return false;
    const ok = buy(player, itemId);
    if (ok) emit({ type: 'buy', ent: player, itemId });
    return ok;
  }

  function restartMatch() {
    rounds.round.scores.wardens = 0;
    rounds.round.scores.raiders = 0;
    rounds.round.number = 0;
    rounds.round.matchOver = false;
    for (const ent of state.entities) {
      ent.kills = 0;
      ent.deaths = 0;
    }
    rounds.startRound();
  }

  return {
    state,
    events,
    cmd,
    map,
    random,
    player,
    bots,
    gunplay,
    rounds,
    step,
    buy: buyItem,
    throwGrenade,
    restartMatch,
    startFirstRound: () => rounds.startRound(),
    /** Apply mouse look: yaw and pitch in the entity, clamped so the camera never flips. */
    look(dx, dy, sensitivity) {
      player.yaw -= dx * sensitivity * (player.zoomed ? 0.45 : 1);
      player.pitch -= dy * sensitivity * (player.zoomed ? 0.45 : 1);
      if (player.pitch > 1.52) player.pitch = 1.52;
      if (player.pitch < -1.52) player.pitch = -1.52;
    },
  };
}
