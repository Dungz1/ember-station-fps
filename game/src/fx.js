// Pooled effects: muzzle flashes, bullet tracers, impact sparks, explosions and the ambient embers
// that drift off the lava channels. Every pool is allocated once at startup; the update loop only
// writes into existing objects and typed arrays — no three.js object is created per frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 28;
const FLASHES = 12;
const SPARKS = 192;

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createFx(scene, map, random) {
  const glow = glowTexture();

  // ---- tracers: stretched additive boxes, oriented between two points
  const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: PALETTE.emberBright, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(tracerGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, mat, life: 0, maxLife: 0.085 });
  }
  let tracerAt = 0;

  // ---- flashes and puffs: sprites with their own fading material
  const flashes = [];
  for (let i = 0; i < FLASHES; i++) {
    const mat = new THREE.SpriteMaterial({
      map: glow, color: PALETTE.emberBright, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    scene.add(sprite);
    flashes.push({ sprite, mat, life: 0, maxLife: 0.12, grow: 3 });
  }
  let flashAt = 0;

  // ---- sparks: one points cloud, ring-buffered slots, per-particle velocity
  const sparkPositions = new Float32Array(SPARKS * 3);
  const sparkVelocity = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMat = new THREE.PointsMaterial({
    map: glow, color: PALETTE.ember, size: 0.16, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);
  let sparkAt = 0;

  // ---- ambient embers rising off the lava
  const EMBERS = 150;
  const emberPositions = new Float32Array(EMBERS * 3);
  const emberSpeed = new Float32Array(EMBERS);
  const emberPhase = new Float32Array(EMBERS);
  for (let i = 0; i < EMBERS; i++) {
    const source = map.lava.length > 0 ? map.lava[i % map.lava.length] : { x: 0, z: 0 };
    emberPositions[i * 3] = source.x + (random() * 2 - 1) * 7;
    emberPositions[i * 3 + 1] = random() * 3.4;
    emberPositions[i * 3 + 2] = source.z + (random() * 2 - 1) * 2.2;
    emberSpeed[i] = 0.22 + random() * 0.5;
    emberPhase[i] = random() * Math.PI * 2;
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberMat = new THREE.PointsMaterial({
    map: glow, color: PALETTE.ember, size: 0.11, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const emberPoints = new THREE.Points(emberGeo, emberMat);
  emberPoints.frustumCulled = false;
  scene.add(emberPoints);

  // One light does every pop: muzzle flashes, blasts, the charge going up.
  const pop = new THREE.PointLight(PALETTE.emberBright, 0, 16, 2);
  scene.add(pop);
  const target = new THREE.Vector3();

  function tracer(x1, y1, z1, x2, y2, z2) {
    const t = tracers[tracerAt];
    tracerAt = (tracerAt + 1) % TRACERS;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.2) return;
    t.mesh.visible = true;
    t.mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    target.set(x2, y2, z2);
    t.mesh.lookAt(target);
    t.mesh.scale.set(1, 1, len);
    t.life = t.maxLife;
    t.mat.opacity = 0.85;
  }

  function flash(x, y, z, scale, life, color) {
    const f = flashes[flashAt];
    flashAt = (flashAt + 1) % FLASHES;
    f.sprite.visible = true;
    f.sprite.position.set(x, y, z);
    f.sprite.scale.setScalar(scale);
    f.maxLife = life;
    f.life = life;
    f.mat.opacity = 1;
    f.grow = scale;
    f.mat.color.setHex(color);
  }

  function burst(x, y, z, nx, ny, nz, count, speed) {
    for (let n = 0; n < count; n++) {
      const i = sparkAt;
      sparkAt = (sparkAt + 1) % SPARKS;
      sparkPositions[i * 3] = x;
      sparkPositions[i * 3 + 1] = y;
      sparkPositions[i * 3 + 2] = z;
      sparkVelocity[i * 3] = nx * speed * 0.6 + (random() * 2 - 1) * speed;
      sparkVelocity[i * 3 + 1] = ny * speed * 0.6 + (random() * 2 - 1) * speed;
      sparkVelocity[i * 3 + 2] = nz * speed * 0.6 + (random() * 2 - 1) * speed;
      sparkLife[i] = 0.32 + random() * 0.38;
    }
  }

  return {
    /** A muzzle flash at the weapon, pushing a bright pop of light into the scene. */
    muzzle(x, y, z, scale = 0.55) {
      flash(x, y, z, scale, 0.055, PALETTE.emberBright);
      pop.position.set(x, y, z);
      pop.intensity = 26;
    },
    tracer,
    impact(x, y, z, nx, ny, nz, flesh) {
      flash(x, y, z, flesh ? 0.3 : 0.24, 0.07, flesh ? PALETTE.danger : PALETTE.emberBright);
      burst(x, y, z, nx, ny, nz, flesh ? 5 : 8, flesh ? 1.8 : 3.2);
    },
    explosion(x, y, z, radius) {
      flash(x, y, z, radius * 0.65, 0.32, PALETTE.ember);
      flash(x, y, z, radius * 0.32, 0.5, PALETTE.emberBright);
      burst(x, y, z, 0, 1, 0, 46, radius * 1.1);
      pop.position.set(x, y + 1, z);
      pop.intensity = 240;
    },
    flashbang(x, y, z) {
      flash(x, y, z, 1.6, 0.2, 0xffffff);
      pop.position.set(x, y + 0.5, z);
      pop.intensity = 120;
    },
    update(dt) {
      for (let i = 0; i < TRACERS; i++) {
        const t = tracers[i];
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) {
          t.mesh.visible = false;
          t.mat.opacity = 0;
        } else {
          t.mat.opacity = 0.85 * (t.life / t.maxLife);
        }
      }
      for (let i = 0; i < FLASHES; i++) {
        const f = flashes[i];
        if (f.life <= 0) continue;
        f.life -= dt;
        if (f.life <= 0) {
          f.sprite.visible = false;
          f.mat.opacity = 0;
        } else {
          const k = f.life / f.maxLife;
          f.mat.opacity = k;
          f.sprite.scale.setScalar(f.grow * (1.5 - 0.5 * k));
        }
      }
      if (pop.intensity > 0) pop.intensity = Math.max(0, pop.intensity - dt * 700);
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLife[i] <= 0) {
          if (sparkPositions[i * 3 + 1] > -400) sparkPositions[i * 3 + 1] = -500;
          continue;
        }
        sparkLife[i] -= dt;
        sparkVelocity[i * 3 + 1] -= 14 * dt;
        sparkPositions[i * 3] += sparkVelocity[i * 3] * dt;
        sparkPositions[i * 3 + 1] += sparkVelocity[i * 3 + 1] * dt;
        sparkPositions[i * 3 + 2] += sparkVelocity[i * 3 + 2] * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      // Embers: a slow climb out of the lava with a lazy sideways sway.
      const time = performance.now() * 0.001;
      for (let i = 0; i < EMBERS; i++) {
        let y = emberPositions[i * 3 + 1] + emberSpeed[i] * dt;
        if (y > 4.2) y = 0.05;
        emberPositions[i * 3 + 1] = y;
        emberPositions[i * 3] += Math.sin(time * 0.7 + emberPhase[i]) * dt * 0.35;
        emberPositions[i * 3 + 2] += Math.cos(time * 0.5 + emberPhase[i]) * dt * 0.22;
      }
      emberGeo.attributes.position.needsUpdate = true;
    },
  };
}
