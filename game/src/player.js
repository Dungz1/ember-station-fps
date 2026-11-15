// The player body: how a fighter moves through the station. Acceleration and friction are the
// classic ground model (fast to start, faster to stop), gravity and jumping are plain, crouching
// shrinks the collision box and the eye, and walking trades speed for silence. stepCharacter is
// the shared half — the bots drive their bodies through the very same physics.
import { moveBody } from './collision.js';

export const PLAYER = {
  halfWidth: 0.34,
  height: 1.78,
  crouchHeight: 1.25,
  eye: 1.62,
  crouchEye: 1.06,
  runSpeed: 5.7,
  walkSpeed: 2.7,
  crouchSpeed: 2.4,
  accel: 13,
  friction: 9.5,
  gravity: 22,
  jumpSpeed: 7.1,
  maxFall: -26,
};

/** Fill in the movement fields every fighter carries. */
export function initBody(ent) {
  ent.halfWidth = PLAYER.halfWidth;
  ent.height = PLAYER.height;
  ent.eye = PLAYER.eye;
  ent.crouch = false;
  ent.grounded = false;
}

function applyFriction(vel, dt) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 0.02) {
    vel.x = 0;
    vel.z = 0;
    return;
  }
  const keep = Math.max(0, speed - speed * PLAYER.friction * dt) / speed;
  vel.x *= keep;
  vel.z *= keep;
}

function accelerate(vel, wishX, wishZ, wishSpeed, dt) {
  const current = vel.x * wishX + vel.z * wishZ;
  const add = wishSpeed - current;
  if (add <= 0) return;
  let push = PLAYER.accel * dt * wishSpeed;
  if (push > add) push = add;
  vel.x += push * wishX;
  vel.z += push * wishZ;
}

/**
 * Move one fighter one timestep: ground friction, acceleration toward (wishX, wishZ), gravity and
 * collision resolution. (wishX, wishZ) must be unit or zero.
 */
export function stepCharacter(ent, wishX, wishZ, wishSpeed, dt, colliders) {
  if (ent.grounded) applyFriction(ent.vel, dt);
  if (wishSpeed > 0) accelerate(ent.vel, wishX, wishZ, wishSpeed, dt);
  ent.vel.y = Math.max(PLAYER.maxFall, ent.vel.y - PLAYER.gravity * dt);
  moveBody(ent.pos, ent.vel, dt, ent.halfWidth, ent.height, colliders, ent);
}

/**
 * The player's step: crouch reshapes the body, the walk key trades speed for silence, and jump is
 * only answered on the ground. `cmd` is the render loop's snapshot of the input state.
 */
export function stepPlayer(ent, cmd, dt, colliders) {
  ent.crouch = !!cmd.crouch;
  const targetHeight = ent.crouch ? PLAYER.crouchHeight : PLAYER.height;
  const targetEye = ent.crouch ? PLAYER.crouchEye : PLAYER.eye;
  const blend = Math.min(1, dt * 14);
  ent.height += (targetHeight - ent.height) * blend;
  ent.eye += (targetEye - ent.eye) * blend;

  const speed = ent.crouch ? PLAYER.crouchSpeed : cmd.walk ? PLAYER.walkSpeed : PLAYER.runSpeed;
  let f = 0;
  let s = 0;
  if (cmd.forward) f += 1;
  if (cmd.back) f -= 1;
  if (cmd.right) s += 1;
  if (cmd.left) s -= 1;
  let wishX = 0;
  let wishZ = 0;
  if (f !== 0 || s !== 0) {
    const sin = Math.sin(ent.yaw);
    const cos = Math.cos(ent.yaw);
    // Forward is (-sin, -cos) and right is (cos, -sin) in three.js' yaw convention.
    wishX = -sin * f + cos * s;
    wishZ = -cos * f - sin * s;
    const len = Math.hypot(wishX, wishZ);
    wishX /= len;
    wishZ /= len;
  }
  if (cmd.jump && ent.grounded) ent.vel.y = PLAYER.jumpSpeed;
  stepCharacter(ent, wishX, wishZ, f !== 0 || s !== 0 ? speed : 0, dt, colliders);
}
