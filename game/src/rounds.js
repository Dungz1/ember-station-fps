// Round flow: FREEZE (buy) -> LIVE (fight or plant) -> PLANTED (the charge ticks, the defenders
// scramble) -> OVER (banner, paychecks) -> the next round, until one team has taken enough rounds
// to win the match. The attack side alternates each round and the site is chosen fresh, so both
// teams see both roles. The timer expiring favors the defenders, always.
import { applyRoundResult } from './economy.js';

export const RULES = {
  freezeTime: 8,
  liveTime: 95,
  fuseTime: 40,
  plantTime: 3.2,
  defuseTime: 5.5,
  overTime: 5.5,
  roundsToWin: 8,
};

export function createRounds({ state, map, random, emit, onRoundStart }) {
  const round = {
    phase: 'freeze',
    timer: RULES.freezeTime,
    number: 0,
    scores: { wardens: 0, raiders: 0 },
    attackSide: 'raiders',
    attackSiteIndex: 0,
    winner: null,
    reason: '',
    matchOver: false,
  };
  state.round = round;
  state.charge = {
    planted: false,
    siteIndex: 0,
    x: 0,
    y: 0,
    z: 0,
    timer: 0,
    plantProgress: 0,
    defuseProgress: 0,
    beeper: 0,
    defused: false,
    detonated: false,
    progressing: false,
  };

  const charge = state.charge;

  function startRound() {
    round.number += 1;
    round.attackSide = round.number % 2 === 1 ? 'raiders' : 'wardens';
    round.attackSiteIndex = random() < 0.5 ? 0 : 1;
    round.phase = 'freeze';
    round.timer = RULES.freezeTime;
    round.winner = null;
    round.reason = '';
    charge.planted = false;
    charge.defused = false;
    charge.detonated = false;
    charge.timer = 0;
    charge.plantProgress = 0;
    charge.defuseProgress = 0;
    charge.siteIndex = round.attackSiteIndex;
    charge.beeper = 0;
    onRoundStart(round.attackSide, round.attackSiteIndex);
    emit({
      type: 'roundStart', number: round.number, attackSide: round.attackSide,
      attackSiteIndex: round.attackSiteIndex, scores: round.scores,
    });
  }

  function endRound(winner, reason) {
    if (round.phase === 'over' || round.matchOver) return;
    round.phase = 'over';
    round.timer = RULES.overTime;
    round.winner = winner;
    round.reason = reason;
    round.scores[winner] += 1;
    for (const ent of state.entities) applyRoundResult(ent, ent.team === winner);
    emit({ type: 'roundEnd', winner, reason, scores: { ...round.scores }, number: round.number });
    if (round.scores[winner] >= RULES.roundsToWin) {
      round.matchOver = true;
      emit({ type: 'matchEnd', winner, scores: { ...round.scores } });
    }
  }

  /** One fighter holding the plant key on the attack site. True while the progress runs. */
  function plantTick(ent, dt) {
    if (round.phase !== 'live' || charge.planted) return false;
    if (ent.team !== round.attackSide || !ent.alive) return false;
    const site = map.sites[round.attackSiteIndex];
    const inside =
      ent.pos.x > site.zone.minX && ent.pos.x < site.zone.maxX &&
      ent.pos.z > site.zone.minZ && ent.pos.z < site.zone.maxZ;
    if (!inside) return false;
    charge.progressing = true;
    charge.plantProgress += dt;
    if (charge.plantProgress >= RULES.plantTime) {
      charge.planted = true;
      charge.siteIndex = round.attackSiteIndex;
      charge.x = site.plant.x;
      charge.y = site.plant.y;
      charge.z = site.plant.z;
      charge.timer = RULES.fuseTime;
      charge.plantProgress = 0;
      round.phase = 'planted';
      round.timer = RULES.fuseTime;
      emit({ type: 'planted', siteIndex: charge.siteIndex, x: charge.x, y: charge.y, z: charge.z, by: ent });
    }
    return true;
  }

  /** One fighter holding the defuse key on the charge. */
  function defuseTick(ent, dt) {
    if (!charge.planted || round.phase !== 'planted') return false;
    if (ent.team === round.attackSide || !ent.alive) return false;
    const d = Math.hypot(ent.pos.x - charge.x, ent.pos.y - charge.y, ent.pos.z - charge.z);
    if (d > 1.9) return false;
    charge.progressing = true;
    charge.defuseProgress += dt;
    if (charge.defuseProgress >= RULES.defuseTime) {
      charge.defused = true;
      emit({ type: 'defused', by: ent });
      endRound(ent.team === 'wardens' ? 'wardens' : 'raiders', 'defused');
    }
    return true;
  }

  function countAlive(team) {
    let n = 0;
    for (const ent of state.entities) if (ent.team === team && ent.alive) n += 1;
    return n;
  }

  function step(dt) {
    if (round.matchOver && round.phase === 'over') return;
    round.timer -= dt;
    switch (round.phase) {
      case 'freeze':
        if (round.timer <= 0) {
          round.phase = 'live';
          round.timer = RULES.liveTime;
          emit({ type: 'live' });
        }
        break;
      case 'live':
        // Progress decays only while nobody is actually working the charge.
        if (!charge.progressing && charge.plantProgress > 0) charge.plantProgress = Math.max(0, charge.plantProgress - dt * 0.6);
        if (countAlive(round.attackSide) === 0) {
          endRound(round.attackSide === 'wardens' ? 'raiders' : 'wardens', 'elimination');
        } else if (countAlive(round.attackSide === 'wardens' ? 'raiders' : 'wardens') === 0) {
          endRound(round.attackSide, 'elimination');
        } else if (round.timer <= 0) {
          endRound(round.attackSide === 'wardens' ? 'raiders' : 'wardens', 'time');
        }
        break;
      case 'planted': {
        charge.timer -= dt;
        round.timer = charge.timer;
        if (!charge.progressing && charge.defuseProgress > 0) charge.defuseProgress = Math.max(0, charge.defuseProgress - dt * 0.6);
        charge.beeper -= dt;
        if (charge.beeper <= 0) {
          // The charge beeps faster as it approaches detonation.
          const urgency = charge.timer / RULES.fuseTime;
          charge.beeper = 0.35 + urgency * 1.15;
          emit({ type: 'beep', x: charge.x, y: charge.y, z: charge.z, urgency });
        }
        if (countAlive(round.attackSide === 'wardens' ? 'raiders' : 'wardens') === 0) {
          // The site is held and no one is left to defuse: the round ends on the spot.
          endRound(round.attackSide, 'elimination');
        }
        // Attackers wiped with the charge down: the clock is their only ally now.
        if (charge.timer <= 0) {
          charge.detonated = true;
          emit({ type: 'detonate', x: charge.x, y: charge.y, z: charge.z });
          endRound(round.attackSide, 'detonation');
        }
        break;
      }
      case 'over':
        if (round.timer <= 0 && !round.matchOver) startRound();
        break;
      default:
        break;
    }
    // Whoever worked the charge this tick sets the flag again after this reset.
    charge.progressing = false;
  }

  return {
    round,
    startRound,
    endRound,
    step,
    plantTick,
    defuseTick,
    canFight: () => round.phase === 'live' || round.phase === 'planted',
    canBuy: () => round.phase === 'freeze',
    canPlant: () => round.phase === 'live',
  };
}
