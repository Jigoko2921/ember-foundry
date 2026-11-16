// The DOM HUD: vitals, ammo, money, clock, score, kill feed, the round banner, the buy
// menu and the scoreboard. It never touches the simulation; main.js pushes numbers in.
const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    health: $('health-num'),
    healthBar: $('health-bar'),
    vignette: $('vignette'),
    armor: $('armor-num'),
    ammo: $('ammo'),
    mag: $('ammo-mag'),
    reserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    grenades: $('grenade-row'),
    money: $('money'),
    clock: $('clock'),
    roundLabel: $('round-label'),
    scoreCT: $('score-ct'),
    scoreT: $('score-t'),
    killfeed: $('killfeed'),
    bombBanner: $('bomb-banner'),
    banner: $('banner'),
    bannerBig: $('banner-big'),
    bannerSmall: $('banner-small'),
    hitmarker: $('hitmarker'),
    crosshair: $('crosshair'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    buy: $('buy'),
    buyGrid: $('buy-grid'),
    buyNote: $('buy-note'),
    buyClose: $('buy-close'),
    board: $('board'),
    boardBody: $('board-body'),
  };

  let last = {};
  let hitTimer = 0;
  let bannerTimer = 0;
  let feedRows = [];
  let buyHandler = null;
  let closeHandler = null;
  let playHandler = null;

  el.buyClose.addEventListener('click', () => { if (closeHandler) closeHandler(); });
  el.play.addEventListener('click', () => { if (playHandler) playHandler(); });

  function setVitals(health, armor) {
    if (health !== last.health) {
      last.health = health;
      const pct = Math.max(0, Math.min(100, health));
      el.health.textContent = String(Math.max(0, Math.round(health)));
      el.health.classList.toggle('low', health <= 30);
      el.healthBar.style.width = `${pct}%`;
      el.healthBar.classList.toggle('low', health <= 30);
      el.vignette.classList.toggle('hurt', health <= 30);
    }
    if (armor !== last.armor) {
      last.armor = armor;
      el.armor.textContent = String(Math.max(0, Math.round(armor)));
    }
  }

  function setAmmo(name, mag, reserve, grenades) {
    const key = `${name}|${mag}|${reserve}|${grenades}`;
    if (key === last.ammoKey) return;
    last.ammoKey = key;
    el.weaponName.textContent = name;
    el.mag.textContent = String(mag);
    el.reserve.textContent = `/ ${reserve}`;
    el.ammo.classList.toggle('empty', mag === 0);
    el.grenades.textContent = `HE × ${grenades}`;
  }

  function setMoney(value) {
    if (value === last.money) return;
    last.money = value;
    el.money.textContent = `$${value}`;
  }

  function setClock(seconds, phase) {
    const s = Math.max(0, Math.ceil(seconds));
    if (s === last.clock && phase === last.phase) return;
    last.clock = s;
    last.phase = phase;
    el.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.clock.classList.toggle('urgent', phase === 'live' && s <= 10);
    el.clock.style.color = phase === 'buy' ? 'var(--muted)' : '';
  }

  function setRound(n) {
    if (n === last.round) return;
    last.round = n;
    el.roundLabel.textContent = `ROUND ${n}`;
  }

  function setScore(ct, t) {
    if (ct !== last.ct) { last.ct = ct; el.scoreCT.textContent = String(ct); }
    if (t !== last.t) { last.t = t; el.scoreT.textContent = String(t); }
  }

  function killFeed(html) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = html;
    el.killfeed.appendChild(row);
    feedRows.push(row);
    while (feedRows.length > 5) feedRows.shift().remove();
    setTimeout(() => { row.remove(); feedRows = feedRows.filter((r) => r !== row); }, 5000);
  }

  function bombBanner(on) {
    el.bombBanner.classList.toggle('on', !!on);
  }

  function banner(big, small, team) {
    el.banner.classList.remove('ct', 't');
    if (team) el.banner.classList.add(team);
    el.bannerBig.textContent = big;
    el.bannerSmall.textContent = small;
    el.banner.classList.add('on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove('on'), 2600);
  }

  function hitMarker(killed) {
    el.hitmarker.classList.add('on');
    el.hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : 'translate(-50%, -50%) rotate(45deg)';
    el.crosshair.classList.add('hit');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => {
      el.hitmarker.classList.remove('on');
      el.hitmarker.style.transform = 'translate(-50%, -50%) rotate(45deg)';
      el.crosshair.classList.remove('hit');
    }, 90);
  }

  function showOverlay(mode) {
    if (mode === 'start') {
      el.overlayCopy.textContent = 'Two teams. Short rounds. One bomb. Buy at the bell, take a site, hold the angle — accuracy beats speed.';
      el.play.textContent = 'Deploy';
    } else if (mode === 'paused') {
      el.overlayTitle.textContent = 'Paused';
      el.overlayCopy.textContent = 'The round is frozen. Click to resume.';
      el.play.textContent = 'Resume';
    } else if (mode === 'end') {
      el.overlayTitle.textContent = 'Match over';
      el.overlayCopy.textContent = 'Refresh to play again.';
      el.play.textContent = 'Play again';
    }
    el.overlay.hidden = false;
  }

  function hideOverlay() { el.overlay.hidden = true; }

  function openBuy(items, money, note) {
    el.buyGrid.innerHTML = '';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item' + (item.price > money ? ' cant' : '');
      button.innerHTML = `<span><span class="nm">${item.name}</span>${item.sub ? `<span class="sub">${item.sub}</span>` : ''}</span><span class="price">$${item.price}</span>`;
      button.addEventListener('click', () => { if (buyHandler) buyHandler(item.id); });
      el.buyGrid.appendChild(button);
    }
    el.buyNote.textContent = note || `Balance $${money}`;
    el.buy.hidden = false;
  }

  function closeBuy() { el.buy.hidden = true; }

  function showBoard(rows) {
    el.boardBody.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (!row.alive) tr.className = 'dead';
      tr.innerHTML = `<td class="${row.team}">${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${row.health}</td>`;
      el.boardBody.appendChild(tr);
    }
    el.board.hidden = false;
  }

  function hideBoard() { el.board.hidden = true; }

  return {
    setVitals, setAmmo, setMoney, setClock, setRound, setScore,
    killFeed, bombBanner, banner, hitMarker,
    showOverlay, hideOverlay,
    openBuy, closeBuy, showBoard, hideBoard,
    onPlay(handler) { playHandler = handler; },
    onBuy(handler) { buyHandler = handler; },
    onCloseBuy(handler) { closeHandler = handler; },
  };
}
