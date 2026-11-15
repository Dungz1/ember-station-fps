// The money game. A fighter earns credits for kills with the weapon that scored them, a flat
// purse for winning the round, and a loss purse that grows with a losing streak so a team that is
// bleeding can still buy back into the fight. Buying is the only spending: a primary replaces what
// is carried, grenades stack to two, the vest tops armor to 100.
import { WEAPONS, giveWeapon } from './weapon.js';

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 16000,
  winReward: 3250,
  lossBase: 1400,
  lossStep: 500,
  maxLossBonus: 3,
};

export function initEconomy(ent, start = ECONOMY.startMoney) {
  ent.money = start;
  ent.lossStreak = 0;
}

export function award(ent, amount) {
  ent.money = Math.min(ECONOMY.maxMoney, ent.money + amount);
}

/** End-of-round purse: the winner's flat reward, the loser's streak-scaled consolation. */
export function applyRoundResult(ent, won) {
  if (won) {
    award(ent, ECONOMY.winReward);
    ent.lossStreak = 0;
  } else {
    ent.lossStreak = Math.min(ECONOMY.maxLossBonus, ent.lossStreak + 1);
    award(ent, ECONOMY.lossBase + ECONOMY.lossStep * (ent.lossStreak - 1));
  }
}

/** The kill bounty: weapons that cost less pay more per kill; a grenade pays a flat bounty. */
export function killReward(weaponId) {
  return WEAPONS[weaponId].killReward || 300;
}

/**
 * Buy one item for an entity: true when the purchase landed. A primary replaces the current one,
 * grenades stack up to their carry limit, and the vest is only worth buying once.
 */
export function buy(ent, itemId) {
  const item = WEAPONS[itemId];
  if (ent.money < item.price) return false;
  if (item.kind === 'primary') {
    if (ent.weaponId === itemId && ent.mag === item.magSize && ent.reserve === item.reserveMax) return false;
  } else if (item.kind === 'grenade') {
    if ((ent.grenades[itemId] || 0) >= item.maxCarry) return false;
  } else if (item.kind === 'armor') {
    if (ent.armor >= item.armor) return false;
  }
  ent.money -= item.price;
  if (item.kind === 'primary') giveWeapon(ent, itemId);
  else if (item.kind === 'grenade') ent.grenades[itemId] = (ent.grenades[itemId] || 0) + 1;
  else ent.armor = item.armor;
  return true;
}

/** A bot's shopping list: the sniper kit for the designated marksman, else the best rifle. */
export function botBuy(ent, isSniper) {
  const order = isSniper ? ['longshot7', 'manticore', 'viper9'] : ['manticore', 'viper9'];
  for (const id of order) {
    if (ent.money >= WEAPONS[id].price + (isSniper ? 0 : 650)) {
      if (buy(ent, id)) return;
    }
  }
}
