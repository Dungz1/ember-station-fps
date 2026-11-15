// Axis-aligned box colliders and the two queries the game runs against them: a slab raycast
// (bullets, line of sight, grenades) and a per-axis body move with step-up (player and bots).
// Colliders are plain {minX,minY,minZ,maxX,maxY,maxZ} objects so a map can hand out hundreds of
// them without touching three.js.

export const STEP_UP = 0.46;
const EPS = 1e-4;
const DOWN_PROBE = STEP_UP + 0.25;

/** An axis-aligned box collider. */
export function makeBox(minX, minY, minZ, maxX, maxY, maxZ) {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// Reusable ray results: valid until the next raycast, consumed immediately by callers.
const rayOut = { dist: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Slab raycast against one box. Returns the distance along the (unit) ray of the entry hit, or
 * Infinity. The hit normal (facing the ray) is left in `out`. Rays starting inside a box miss it.
 */
export function raycastBox(out, ox, oy, oz, dx, dy, dz, dist, b) {
  let tmin = 0;
  let tmax = dist;
  let axis = -1;
  let sign = 0;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    const lo = a === 0 ? b.minX : a === 1 ? b.minY : b.minZ;
    const hi = a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ;
    if (d > -1e-9 && d < 1e-9) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - o) * inv;
    let t2 = (hi - o) * inv;
    let s = -1;
    if (t1 > t2) {
      const t = t1;
      t1 = t2;
      t2 = t;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = a;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (axis < 0 || tmin >= dist) return Infinity;
  out.dist = tmin;
  out.nx = axis === 0 ? sign : 0;
  out.ny = axis === 1 ? sign : 0;
  out.nz = axis === 2 ? sign : 0;
  return tmin;
}

/**
 * Nearest world hit along a unit ray. Writes {dist, nx, ny, nz} into `out` and returns the
 * distance, or Infinity when the ray reaches `dist` without touching a collider.
 */
export function raycastWorld(out, ox, oy, oz, dx, dy, dz, dist, boxes) {
  let best = dist;
  let hit = false;
  out.dist = dist;
  out.nx = out.ny = out.nz = 0;
  for (let i = 0; i < boxes.length; i++) {
    const t = raycastBox(rayOut, ox, oy, oz, dx, dy, dz, best, boxes[i]);
    if (t < best) {
      best = t;
      out.dist = t;
      out.nx = rayOut.nx;
      out.ny = rayOut.ny;
      out.nz = rayOut.nz;
      hit = true;
    }
  }
  return hit ? best : Infinity;
}

/** Whether the body AABB at (pos, halfWidth, height) overlaps any collider. */
export function overlapsAny(pos, halfWidth, height, boxes) {
  const minX = pos.x - halfWidth + EPS;
  const maxX = pos.x + halfWidth - EPS;
  const minY = pos.y + EPS;
  const maxY = pos.y + height - EPS;
  const minZ = pos.z - halfWidth + EPS;
  const maxZ = pos.z + halfWidth - EPS;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (minX < b.maxX && maxX > b.minX && minY < b.maxY && maxY > b.minY && minZ < b.maxZ && maxZ > b.minZ) return true;
  }
  return false;
}

/**
 * Push the body out of every overlapping collider along one axis, always toward the face it
 * entered least deeply. Returns +1 / -1 for the push direction when it moved the body, else 0.
 */
function resolveAxis(pos, axis, halfWidth, height, boxes) {
  let moved = 0;
  for (let pass = 0; pass < 4; pass++) {
    const lo = axis === 'y' ? pos.y : pos[axis] - halfWidth;
    const hi = axis === 'y' ? pos.y + height : pos[axis] + halfWidth;
    let best = null;
    let bestDepth = Infinity;
    let bestSign = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const minX = pos.x - halfWidth;
      const maxX = pos.x + halfWidth;
      const minZ = pos.z - halfWidth;
      const maxZ = pos.z + halfWidth;
      if (maxX <= b.minX || minX >= b.maxX) continue;
      if (maxZ <= b.minZ || minZ >= b.maxZ) continue;
      if (axis !== 'y' && (pos.y + height <= b.minY || pos.y >= b.maxY)) continue;
      const blo = axis === 'y' ? b.minY : axis === 'x' ? b.minX : b.minZ;
      const bhi = axis === 'y' ? b.maxY : axis === 'x' ? b.maxX : b.maxZ;
      const depthHi = hi - blo; // how far the body reaches past the box's low face
      const depthLo = bhi - lo; // ...and past its high face
      if (depthHi <= 0 || depthLo <= 0) continue;
      const depth = depthHi < depthLo ? depthHi : depthLo;
      if (depth < bestDepth) {
        bestDepth = depth;
        best = b;
        // Leave through the face that was entered least deeply: past the high face when its
        // penetration (depthLo) is the smaller one, else past the low face.
        bestSign = depthLo < depthHi ? 1 : -1;
      }
    }
    if (best === null) break;
    if (bestSign > 0) {
      if (axis === 'y') pos.y = best.maxY + EPS;
      else pos[axis] = best[axis === 'x' ? 'maxX' : 'maxZ'] + halfWidth + EPS;
    } else {
      if (axis === 'y') pos.y = best.minY - height - EPS;
      else pos[axis] = best[axis === 'x' ? 'minX' : 'minZ'] - halfWidth - EPS;
    }
    moved = bestSign;
  }
  return moved;
}

const downHit = { dist: 0, nx: 0, ny: 0, nz: 0 };

/** Whether the floor lies close enough below (pos, halfWidth) to stand on after a step up. */
function groundBelow(pos, halfWidth, boxes) {
  return (
    raycastWorld(downHit, pos.x, pos.y + 0.05, pos.z, 0, -1, 0, DOWN_PROBE, boxes) !== Infinity ||
    raycastWorld(downHit, pos.x + halfWidth * 0.7, pos.y + 0.05, pos.z, 0, -1, 0, DOWN_PROBE, boxes) !== Infinity ||
    raycastWorld(downHit, pos.x - halfWidth * 0.7, pos.y + 0.05, pos.z, 0, -1, 0, DOWN_PROBE, boxes) !== Infinity
  );
}

/**
 * Move a body one timestep against the world: vertical first (gravity and landing), then the two
 * horizontal axes with a step-up assist so stairs and low ledges are climbed, never walls.
 * Mutates pos and vel (the axis that collided stops), sets flags.grounded.
 */
export function moveBody(pos, vel, dt, halfWidth, height, boxes, flags) {
  pos.y += vel.y * dt;
  const vy = vel.y;
  const pushY = resolveAxis(pos, 'y', halfWidth, height, boxes);
  if (pushY !== 0) {
    if (pushY > 0 && vy <= 0) flags.grounded = true;
    vel.y = 0;
  } else if (vy < 0) {
    flags.grounded = false;
  }
  for (let axis = 0; axis < 2; axis++) {
    const key = axis === 0 ? 'x' : 'z';
    const delta = vel[key] * dt;
    if (delta === 0) continue;
    pos[key] += delta;
    if (!overlapsAny(pos, halfWidth, height, boxes)) continue;
    let stepped = false;
    if (flags.grounded) {
      const saveY = pos.y;
      pos.y += STEP_UP;
      if (!overlapsAny(pos, halfWidth, height, boxes) && groundBelow(pos, halfWidth, boxes)) {
        stepped = true;
      } else {
        pos.y = saveY;
      }
    }
    if (!stepped) {
      resolveAxis(pos, key, halfWidth, height, boxes);
      vel[key] = 0;
    }
  }
}
