// Boot and the one loop: a fixed 64 Hz simulation (sim.js) feeding a render at the display's rate.
// The loop snapshots input, steps the world, routes the world's events into effects, sounds and
// HUD, then draws. ?shot=start|play|end with &seed=N builds a deterministic frame for a capture:
// entities and effects are staged directly, painted twice, then frozen with window.__shotReady.
import * as THREE from 'three';
import { PALETTE, applyCssPalette } from './palette.js';
import { buildMap } from './map.js';
import { createInput } from './input.js';
import { createSim, FIXED_STEP } from './sim.js';
import { createViewModel, WEAPONS } from './weapon.js';
import { createFx } from './fx.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

applyCssPalette();

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 320);
scene.add(camera);

const map = buildMap(scene);
const sim = createSim({ map, seed });
const hud = createHud();
const fx = createFx(scene, map, sim.random);
const audio = createAudio();
sim.bots.attachScene(scene);

// Captures must not spin up an AudioContext: every sound method becomes a no-op in shot mode.
if (shot) {
  for (const key of Object.keys(audio)) {
    if (key !== 'ensure') audio[key] = () => {};
  }
}

// ---- first-person view model, rebuilt when the loadout changes
let viewModel = createViewModel(sim.player.weaponId);
camera.add(viewModel.group);
const VIEW_POS = new THREE.Vector3(0.26, -0.22, -0.55);
const muzzleWorld = new THREE.Vector3();
let bobClock = 0;

function placeViewModel() {
  viewModel.group.position.copy(VIEW_POS);
  viewModel.group.rotation.set(0, 0, 0);
}
placeViewModel();

function ensureViewModel() {
  if (viewModel.name === sim.player.weaponId) return;
  camera.remove(viewModel.group);
  viewModel.group.traverse((node) => {
    if (node.isMesh) {
      node.geometry.dispose();
      node.material.dispose();
    }
  });
  viewModel = createViewModel(sim.player.weaponId);
  viewModel.name = sim.player.weaponId;
  camera.add(viewModel.group);
  placeViewModel();
}
viewModel.name = sim.player.weaponId;

// ---- HUD and round-flow plumbing
let bannerTimer = 0;
let buyOpen = false;

function openBuy() {
  if (!sim.rounds.canBuy()) return;
  buyOpen = true;
  hud.showBuy(sim.player.money, (id) => {
    if (sim.buy(id)) {
      audio.buy();
      hud.updateBuy(sim.player.money);
      ensureViewModel();
    }
  });
}
function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
}

const REASONS = {
  elimination: 'Enemy team eliminated',
  defused: 'Charge defused',
  detonation: 'Charge detonated',
  time: 'Time expired',
};

function routeEvent(e) {
  const player = sim.player;
  switch (e.type) {
    case 'shot': {
      const heavy = e.loud > 50;
      if (e.shooter === player) {
        viewModel.group.updateWorldMatrix(true, false);
        muzzleWorld.copy(viewModel.muzzle);
        viewModel.group.localToWorld(muzzleWorld);
        fx.muzzle(muzzleWorld.x, muzzleWorld.y, muzzleWorld.z, 0.5);
        audio.gunshot(0, heavy);
      } else {
        fx.muzzle(e.x + e.dx * 0.5, e.y + e.dy * 0.5 - 0.1, e.z + e.dz * 0.5, 0.42);
        audio.gunshot(Math.hypot(e.x - player.pos.x, e.y - player.pos.y, e.z - player.pos.z), heavy);
      }
      break;
    }
    case 'tracer':
      fx.tracer(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2);
      break;
    case 'impact':
      fx.impact(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.flesh);
      break;
    case 'hit':
      if (e.victim === player) hud.damageFlash();
      if (e.byPlayer) {
        hud.hitMarker(e.part === 'head');
        audio.hit(e.part === 'head');
      }
      break;
    case 'death':
      hud.killFeed(
        e.attackerName, e.victimName, WEAPONS[e.weaponId].name, e.headshot,
        e.attacker.team, e.victim.team,
      );
      audio.death();
      break;
    case 'explosion':
      fx.explosion(e.x, e.y, e.z, 7.5);
      audio.explosion(Math.hypot(e.x - player.pos.x, e.z - player.pos.z));
      break;
    case 'detonate':
      fx.explosion(e.x, e.y, e.z, 11);
      audio.explosion(Math.hypot(e.x - player.pos.x, e.z - player.pos.z));
      break;
    case 'flashbang':
      fx.flashbang(e.x, e.y, e.z);
      audio.flashbang(Math.hypot(e.x - player.pos.x, e.z - player.pos.z));
      break;
    case 'blind':
      if (e.ent === player) hud.flashOverlay(e.amount);
      break;
    case 'footstep':
      audio.footstep(Math.hypot(e.x - player.pos.x, e.z - player.pos.z));
      break;
    case 'reload':
      audio.reload(1);
      break;
    case 'dryfire':
      audio.dryClick();
      break;
    case 'throw':
      audio.reload(0);
      break;
    case 'beep':
      audio.beep(1 - e.urgency);
      fx.muzzle(e.x, e.y + 0.15, e.z, 0.22);
      break;
    case 'roundStart': {
      const side = e.attackSide === 'raiders' ? 'Raiders attack · Wardens defend' : 'Wardens attack · Raiders defend';
      hud.banner('ROUND ' + e.number, side, e.attackSide === 'raiders' ? 'ember' : 'teal');
      bannerTimer = 3.4;
      audio.roundStart();
      if (sim.rounds.canBuy()) openBuy();
      break;
    }
    case 'live':
      hud.banner('LIVE', '', '');
      bannerTimer = 1.4;
      closeBuy();
      break;
    case 'planted':
      hud.banner('CHARGE PLANTED', 'Site ' + (e.siteIndex === 0 ? 'A · Reactor Hall' : 'B · Turbine Hall'), 'ember');
      bannerTimer = 3.2;
      break;
    case 'defused':
      hud.banner('CHARGE DEFUSED', '', 'teal');
      bannerTimer = 3.2;
      break;
    case 'roundEnd': {
      const won = e.winner === 'wardens';
      hud.banner(won ? 'WARDENS WIN' : 'RAIDERS WIN', REASONS[e.reason] || '', won ? 'teal' : 'ember');
      bannerTimer = 4.2;
      audio.roundEnd(won);
      closeBuy();
      break;
    }
    case 'matchEnd':
      hud.showEnd(e.scores, e.winner);
      if (document.pointerLockElement) document.exitPointerLock();
      break;
    default:
      break;
  }
}

// ---- input
const input = createInput(renderer.domElement, {
  onLockChange(locked) {
    if (shot) return;
    if (locked) {
      hud.hideOverlay();
    } else if (!sim.rounds.round.matchOver) {
      hud.showPause();
    }
  },
  onKey(code, down) {
    if (shot || !down) return;
    if (code === 'KeyB') {
      if (buyOpen) closeBuy();
      else openBuy();
    }
  },
});

hud.onPlay(() => {
  if (shot) return;
  audio.ensure();
  if (sim.rounds.round.matchOver) {
    sim.restartMatch();
    hud.hideBanner();
  }
  input.requestLock();
});

// ---- per-render HUD snapshot
function updateHud() {
  const player = sim.player;
  const round = sim.rounds.round;
  const charge = sim.state.charge;
  hud.setHealth(player.hp);
  hud.setArmor(player.armor);
  hud.setMoney(player.money);
  hud.setAmmo(player.mag, player.reserve, WEAPONS[player.weaponId].name);
  hud.setGrenades(player.grenades.furnace, player.grenades.flare);
  hud.setScores(round.scores.wardens, round.scores.raiders);
  hud.setRoundLabel(round.number, player.objective === 'attack' ? 'ATTACK' : 'DEFEND');
  const clock = round.phase === 'planted' ? charge.timer : Math.max(0, round.timer);
  const minutes = Math.floor(clock / 60);
  const seconds = Math.floor(clock % 60);
  hud.setTimer(minutes + ':' + String(seconds).padStart(2, '0'), clock < 20);
  hud.setCrosshair(5 + sim.gunplay.spreadFor(player) * 300);
  if (charge.defuseProgress > 0) hud.setObjective('DEFUSING', charge.defuseProgress / 5.5);
  else if (charge.plantProgress > 0) hud.setObjective('PLANTING', charge.plantProgress / 3.2);
  else if (charge.planted) hud.setObjective('CHARGE ARMED · ' + Math.ceil(charge.timer) + 's', null);
  else if (round.phase === 'live' && player.alive && player.objective === 'attack') {
    hud.setObjective('PLANT AT SITE ' + (round.attackSiteIndex === 0 ? 'A' : 'B') + ' · HOLD [E]', null);
  } else hud.setObjective(null, null);
  if (!player.alive && (round.phase === 'live' || round.phase === 'planted')) {
    const ally = sim.state.entities.find((e) => e.team === 'wardens' && !e.isPlayer && e.alive);
    hud.setSpectate(ally ? 'ELIMINATED — spectating ' + ally.name : 'ELIMINATED');
  } else {
    hud.setSpectate('');
  }
  if (buyOpen) hud.updateBuy(player.money);
}

function syncCamera(dt) {
  const player = sim.player;
  camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
  camera.rotation.set(player.pitch + player.recoilPitch, player.yaw + player.recoilYaw, 0, 'YXZ');
  const targetFov = player.zoomed ? WEAPONS[player.weaponId].zoomFov : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 11);
    camera.updateProjectionMatrix();
  }
}

function animateViewModel(dt) {
  const player = sim.player;
  const speed = Math.hypot(player.vel.x, player.vel.z);
  bobClock += dt * speed * (player.grounded ? 1 : 0.3);
  const bob = Math.min(1, speed / 5.7);
  viewModel.group.position.set(
    VIEW_POS.x + Math.cos(bobClock * 1.7) * 0.012 * bob,
    VIEW_POS.y + Math.sin(bobClock * 3.4) * 0.009 * bob - (player.crouch ? 0.03 : 0),
    VIEW_POS.z + player.viewKick * 0.06,
  );
  viewModel.group.rotation.x = player.viewKick * 0.09;
  viewModel.group.rotation.z = Math.cos(bobClock * 1.7) * 0.01 * bob;
  if (player.reloadTimer > 0) {
    const w = WEAPONS[player.weaponId];
    const k = 1 - player.reloadTimer / w.reloadTime;
    viewModel.group.rotation.x += Math.sin(k * Math.PI) * 0.55;
  }
}

// ---- the loop
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (look.x !== 0 || look.y !== 0) sim.look(look.x, look.y, 0.0023);
    const keys = input.state.keys;
    const cmd = sim.cmd;
    cmd.forward = keys.has('KeyW');
    cmd.back = keys.has('KeyS');
    cmd.left = keys.has('KeyA');
    cmd.right = keys.has('KeyD');
    cmd.jump = keys.has('Space');
    cmd.crouch = keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight');
    cmd.walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    cmd.reload = keys.has('KeyR');
    cmd.use = keys.has('KeyE');
    cmd.fire = input.state.firing;
    cmd.zoom = input.state.aiming;
    cmd.throwHe = keys.has('KeyG');
    cmd.throwFlash = keys.has('KeyT');
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      sim.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) hud.hideBanner();
    }
    for (const e of sim.events) routeEvent(e);
    sim.events.length = 0;
    fx.update(dt);
    ensureViewModel();
    animateViewModel(dt);
  }
  syncCamera(frozen ? 0 : 0.016);
  sim.bots.syncMeshes();
  if (!frozen) {
    updateHud();
    hud.tick(dt);
  }
  renderer.render(scene, camera);
}

// ---- deterministic captures: stage a frame, paint it twice, freeze
function aimAt(x, y, z) {
  const player = sim.player;
  const dx = x - player.pos.x;
  const dy = y - (player.pos.y + player.eye);
  const dz = z - player.pos.z;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  player.recoilPitch = 0;
  player.recoilYaw = 0;
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) sim.step(FIXED_STEP);
}

function stageBot(id, x, y, z, yaw) {
  const bot = sim.state.entities.find((e) => e.id === id);
  bot.pos.x = x;
  bot.pos.y = y;
  bot.pos.z = z;
  bot.vel.x = 0;
  bot.vel.y = 0;
  bot.vel.z = 0;
  bot.yaw = yaw;
  bot.pitch = 0;
  return bot;
}

function runShot(name) {
  hud.hideOverlay();
  closeBuy();
  const player = sim.player;
  const round = sim.rounds.round;
  if (name === 'play') {
    // Mid-round firefight at the mid hub: the player holds the tower, raiders cross in the open.
    round.phase = 'live';
    round.number = 3;
    round.timer = 72;
    round.scores.wardens = 2;
    round.scores.raiders = 1;
    round.attackSide = 'raiders';
    player.objective = 'defend';
    player.pos.x = 2.6;
    player.pos.y = 0;
    player.pos.z = -2.4;
    player.hp = 73;
    player.armor = 46;
    player.money = 3150;
    player.weaponId = 'manticore';
    player.mag = 18;
    player.reserve = 56;
    player.grenades.furnace = 1;
    player.grenades.flare = 1;
    stageBot('r0', -6.5, 0, -9, -2.2);
    stageBot('r1', -12, 0.4, -12.5, -2.0);
    stageBot('r3', 7, 0, -13, 2.6);
    stageBot('w0', -1.5, 0, -5.5, 0.4);
    stageBot('w2', 4.5, 0, -6.5, -0.6);
    settle(2);
    aimAt(-6.5, 1.45, -9);
    sim.events.length = 0; // drop the settle noise; only the staged shots paint
    // Two rounds downrange: tracer and muzzle flash frozen in the capture.
    const dir = { x: -Math.sin(player.yaw) * 0.999, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * 0.999 };
    sim.gunplay.fire(player, dir.x, dir.y, dir.z);
    player.mag = 18;
    sim.gunplay.fire(player, dir.x, dir.y, dir.z);
    player.recoilPitch = 0.012;
    hud.killFeed('You', 'Char', 'Manticore', false, 'wardens', 'raiders');
    hud.killFeed('Kestrel', 'Sable', 'Viper-9', true, 'wardens', 'raiders');
    for (const e of sim.events) routeEvent(e);
    sim.events.length = 0;
  } else if (name === 'end') {
    // The round is over: banner, score and the feed of how it ended.
    round.phase = 'over';
    round.number = 4;
    round.timer = 4.8;
    round.scores.wardens = 3;
    round.scores.raiders = 1;
    round.winner = 'wardens';
    round.reason = 'elimination';
    player.objective = 'defend';
    player.pos.x = -13.5;
    player.pos.y = 0.4;
    player.pos.z = -9.6;
    player.hp = 61;
    player.armor = 22;
    player.money = 5400;
    player.weaponId = 'longshot7';
    player.mag = 3;
    player.reserve = 12;
    stageBot('w0', -17, 0.4, -11, 1.1);
    stageBot('w1', -9, 0, -13, 2.4);
    stageBot('w3', -12, 0, -7.5, 0.2);
    aimAt(16, 1.4, 12);
    player.pitch = -0.02;
    hud.banner('WARDENS WIN', 'Enemy team eliminated', 'teal');
    hud.killFeed('You', 'Vandal', 'Longshot-7', true, 'wardens', 'raiders');
    hud.killFeed('Halcyon', 'Pyre', 'Manticore', false, 'wardens', 'raiders');
    hud.killFeed('Onyx', 'Scorch', 'Longshot-7', true, 'wardens', 'raiders');
  } else {
    // The deploy screen: a dusk view over the Reactor Hall and its lava channel.
    round.phase = 'freeze';
    round.number = 1;
    round.timer = 8;
    round.scores.wardens = 0;
    round.scores.raiders = 0;
    player.objective = 'defend';
    player.pos.x = -3.5;
    player.pos.y = 0;
    player.pos.z = -5.5;
    player.weaponId = 'manticore';
    player.mag = 28;
    player.reserve = 84;
    player.money = 800;
    stageBot('w0', -7, 0, -3, 1.2);
    stageBot('w1', -5, 0, -8, 0.9);
    stageBot('w3', -2, 0, -8.5, 1.4);
    aimAt(-15, 2.2, -12.5);
    hud.showStart();
  }
  sim.bots.syncMeshes();
  updateHud();
  hud.tick(0.016);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera(0);
    sim.bots.syncMeshes();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

sim.startFirstRound();
syncCamera(0.016);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
