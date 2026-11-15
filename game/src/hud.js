// The HUD: health, armor, money, ammo, the round clock and score, a kill feed, the buy menu, the
// plant/defuse progress bar, banners and the overlays. Pure DOM — the simulation state is read
// once per render, so there is nothing here to allocate per frame either.
import { WEAPONS, BUY_ORDER } from './weapon.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const refs = {
    hpNum: el('hp-num'), hpBar: el('hp-fill'), armorNum: el('armor-num'), armorBar: el('armor-fill'),
    money: el('money'), weaponName: el('weapon-name'), ammoMag: el('ammo-mag'), ammoReserve: el('ammo-reserve'),
    grenades: el('grenade-list'), timer: el('timer'), roundLabel: el('round-label'),
    scoreW: el('score-w'), scoreR: el('score-r'), killfeed: el('killfeed'),
    banner: el('banner'), bannerTitle: el('banner-title'), bannerSub: el('banner-sub'),
    objective: el('objective'), objectiveText: el('objective-text'), objectiveFill: el('objective-fill'),
    crosshair: el('crosshair'), hitmarker: el('hitmarker'),
    damageFlash: el('damage-flash'), flashOverlay: el('flash-overlay'),
    buy: el('buy'), buyRows: el('buy-rows'), buyMoney: el('buy-money'),
    overlay: el('overlay'), overlayTitle: el('overlay-title'), overlayCopy: el('overlay-copy'),
    overlayPlay: el('play'), spectate: el('spectate'),
  };
  let buyHandler = null;
  let hitTimer = 0;
  let flashLevel = 0;
  let damageLevel = 0;
  const feedRows = [];

  // The buy menu is built once; each row buys its item on click.
  for (const id of BUY_ORDER) {
    const item = WEAPONS[id];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.dataset.item = id;
    row.innerHTML =
      `<span class="buy-key">${BUY_ORDER.indexOf(id) + 1}</span>` +
      `<span class="buy-name">${item.name}</span>` +
      `<span class="buy-class">${item.klass}</span>` +
      `<span class="buy-price">$${item.price}</span>`;
    row.addEventListener('click', () => {
      if (buyHandler) buyHandler(id);
    });
    refs.buyRows.appendChild(row);
  }

  function setHealth(v) {
    refs.hpNum.textContent = String(Math.max(0, Math.ceil(v)));
    refs.hpBar.style.width = Math.max(0, Math.min(100, v)) + '%';
    refs.hpBar.classList.toggle('low', v < 35);
  }
  function setArmor(v) {
    refs.armorNum.textContent = String(Math.max(0, Math.ceil(v)));
    refs.armorBar.style.width = Math.max(0, Math.min(100, v)) + '%';
  }
  function setMoney(v) {
    refs.money.textContent = '$' + Math.max(0, Math.round(v));
  }
  function setAmmo(mag, reserve, name) {
    refs.ammoMag.textContent = String(mag);
    refs.ammoReserve.textContent = '/ ' + reserve;
    refs.weaponName.textContent = name;
  }
  function setGrenades(he, flash) {
    refs.grenades.textContent = (he > 0 ? 'Furnace ×' + he + '  ' : '') + (flash > 0 ? 'Flare ×' + flash : '') || '—';
  }
  function setTimer(text, urgent) {
    refs.timer.textContent = text;
    refs.timer.classList.toggle('urgent', !!urgent);
  }
  function setScores(wardens, raiders) {
    refs.scoreW.textContent = String(wardens);
    refs.scoreR.textContent = String(raiders);
  }
  function setRoundLabel(number, role) {
    refs.roundLabel.textContent = 'ROUND ' + number + ' · ' + role;
  }
  function killFeed(attacker, victim, weaponName, headshot, attackerTeam, victimTeam) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML =
      `<span class="feed-${attackerTeam}">${attacker}</span>` +
      `<span class="feed-weapon">${headshot ? '⌖ ' : ''}${weaponName}</span>` +
      `<span class="feed-${victimTeam}">${victim}</span>`;
    refs.killfeed.prepend(row);
    feedRows.push(row);
    while (feedRows.length > 5) {
      const old = feedRows.shift();
      old.remove();
    }
  }
  function banner(title, sub, tone) {
    refs.bannerTitle.textContent = title;
    refs.bannerSub.textContent = sub;
    refs.banner.className = 'show' + (tone ? ' ' + tone : '');
  }
  function hideBanner() {
    refs.banner.className = '';
  }
  function setObjective(text, progress) {
    if (text === null) {
      refs.objective.className = '';
      return;
    }
    refs.objective.className = 'show';
    refs.objectiveText.textContent = text;
    refs.objectiveFill.style.width = (progress === null ? 100 : Math.max(0, Math.min(100, progress * 100))) + '%';
  }
  function setCrosshair(gap) {
    refs.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
  }
  function hitMarker(headshot) {
    refs.hitmarker.className = 'show' + (headshot ? ' head' : '');
    hitTimer = 0.12;
  }
  function flashOverlay(amount) {
    flashLevel = Math.min(1, flashLevel + amount);
  }
  function damageFlash() {
    damageLevel = 1;
  }

  function showBuy(money, handler) {
    buyHandler = handler;
    refs.buyMoney.textContent = '$' + money;
    for (const row of refs.buyRows.children) {
      const item = WEAPONS[row.dataset.item];
      row.classList.toggle('too-pricey', item.price > money);
    }
    refs.buy.className = 'show';
  }
  function hideBuy() {
    refs.buy.className = '';
    buyHandler = null;
  }
  function updateBuy(money) {
    refs.buyMoney.textContent = '$' + money;
    for (const row of refs.buyRows.children) {
      const item = WEAPONS[row.dataset.item];
      row.classList.toggle('too-pricey', item.price > money);
    }
  }

  function showStart() {
    refs.overlay.className = '';
    refs.overlayTitle.textContent = 'EMBER STATION';
    refs.overlayCopy.textContent =
      'A geothermal station at dusk. Two teams of five, one reactor charge. Plant it, hold it, or wipe the other side out.';
    refs.overlayPlay.textContent = 'Click to deploy';
  }
  function showPause() {
    refs.overlay.className = '';
    refs.overlayTitle.textContent = 'PAUSED';
    refs.overlayCopy.textContent = 'The round is still running without you. Click back in.';
    refs.overlayPlay.textContent = 'Resume';
  }
  function showEnd(scores, winner) {
    refs.overlay.className = '';
    refs.overlayTitle.textContent = winner === 'wardens' ? 'WARDENS TAKE THE STATION' : 'RAIDERS TAKE THE STATION';
    refs.overlayCopy.textContent = `Final score ${scores.wardens} — ${scores.raiders}. Click to run it back.`;
    refs.overlayPlay.textContent = 'Play again';
  }
  function hideOverlay() {
    refs.overlay.className = 'hidden';
  }
  function setSpectate(text) {
    refs.spectate.textContent = text;
    refs.spectate.className = text === '' ? '' : 'show';
  }

  /** Called once per render: advances the small decaying overlays. */
  function tick(dt) {
    if (hitTimer > 0) {
      hitTimer -= dt;
      if (hitTimer <= 0) refs.hitmarker.className = '';
    }
    if (flashLevel > 0) {
      flashLevel = Math.max(0, flashLevel - dt * 0.8);
      refs.flashOverlay.style.opacity = (flashLevel * 0.95).toFixed(3);
    }
    if (damageLevel > 0) {
      damageLevel = Math.max(0, damageLevel - dt * 1.8);
      refs.damageFlash.style.opacity = (damageLevel * 0.5).toFixed(3);
    }
  }

  return {
    setHealth, setArmor, setMoney, setAmmo, setGrenades, setTimer, setScores, setRoundLabel,
    killFeed, banner, hideBanner, setObjective, setCrosshair, hitMarker, flashOverlay, damageFlash,
    showBuy, hideBuy, updateBuy, showStart, showPause, showEnd, hideOverlay, setSpectate, tick,
    onPlay(handler) {
      refs.overlayPlay.addEventListener('click', handler);
    },
  };
}
