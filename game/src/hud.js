// The DOM HUD: vitals, ammo, money, clock, score, kill feed, round banner, buy menu and
// scoreboard. It never touches the simulation — main.js pushes plain numbers in and the
// HUD only writes what actually changed, so a 60 Hz loop costs a handful of comparisons.
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
    action: $('action'),
    actionLabel: $('action-label'),
    actionBar: $('action-bar'),
    flash: $('flash'),
    blind: $('blind'),
    hud: $('hud'),
    radar: $('radar'),
    radarLabel: $('radar-label'),
    radio: $('radio'),
    equipment: $('equipment'),
    pipsCT: $('pips-ct'),
    pipsT: $('pips-t'),
    roundOf: $('round-of'),
  };

  const last = {};
  let bannerTimer = 0;
  let hitTimer = 0;
  let flashTimer = 0;
  let blindTimer = 0;
  let feedRows = [];
  let buyHandler = null;
  let closeHandler = null;
  let playHandler = null;

  // Screenshot mode freezes every transient: a banner that times out before the capture
  // is a banner the image never shows.
  const still = () => document.body.classList.contains('shot-mode');

  el.buyClose.addEventListener('click', () => { if (closeHandler) closeHandler(); });
  el.play.addEventListener('click', () => { if (playHandler) playHandler(); });

  function setVitals(health, armor) {
    if (health !== last.health) {
      last.health = health;
      const value = Math.max(0, Math.round(health));
      el.health.textContent = String(value);
      el.health.classList.toggle('low', value <= 30);
      el.healthBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
      el.healthBar.classList.toggle('low', value <= 30);
      el.vignette.classList.toggle('hurt', value > 0 && value <= 30);
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
    el.clock.classList.toggle('quiet', phase === 'buy');
  }

  function setRound(n, total) {
    if (n === last.round && total === last.roundTotal) return;
    last.round = n;
    last.roundTotal = total;
    el.roundLabel.textContent = `ROUND ${n}`;
    if (el.roundOf) el.roundOf.textContent = total ? `OF ${total}` : '';
  }

  function setScore(ct, t) {
    if (ct !== last.ct) {
      last.ct = ct;
      el.scoreCT.firstChild.textContent = String(ct);
    }
    if (t !== last.t) {
      last.t = t;
      el.scoreT.firstChild.textContent = String(t);
    }
  }

  // Crosshair gap in pixels from the weapon's real cone, so the reticle never lies.
  function setSpread(pixels) {
    const gap = Math.max(2, Math.min(18, pixels));
    if (Math.abs((last.gap ?? 0) - gap) < 0.4) return;
    last.gap = gap;
    el.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }

  function setAction(label, progress) {
    if (!label || progress <= 0) {
      if (last.action !== 0) {
        last.action = 0;
        el.action.classList.remove('on');
      }
      return;
    }
    last.action = progress;
    el.action.classList.add('on');
    el.actionLabel.textContent = label;
    el.actionBar.style.width = `${Math.min(100, progress * 100)}%`;
  }

  function killFeed(html) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = html;
    el.killfeed.appendChild(row);
    feedRows.push(row);
    while (feedRows.length > 5) feedRows.shift().remove();
    if (still()) return;
    setTimeout(() => {
      row.remove();
      feedRows = feedRows.filter((r) => r !== row);
    }, 5200);
  }

  function bombBanner(on, site) {
    el.bombBanner.classList.toggle('on', !!on);
    if (on) el.bombBanner.textContent = site ? `BOMB PLANTED · SITE ${site}` : 'BOMB PLANTED';
  }

  function banner(big, small, team) {
    el.banner.classList.remove('ct', 't');
    if (team) el.banner.classList.add(team);
    el.bannerBig.textContent = big;
    el.bannerSmall.textContent = small ?? '';
    el.banner.classList.add('on');
    clearTimeout(bannerTimer);
    if (still()) return;
    bannerTimer = setTimeout(() => el.banner.classList.remove('on'), 2600);
  }

  function hitMarker(killed) {
    el.hitmarker.classList.toggle('kill', !!killed);
    el.hitmarker.classList.add('on');
    el.crosshair.classList.add('hit');
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => {
      el.hitmarker.classList.remove('on');
      el.crosshair.classList.remove('hit');
    }, 110);
  }

  function flashDamage() {
    el.flash.classList.remove('on');
    // Force a reflow so the animation restarts even on back-to-back hits.
    void el.flash.offsetWidth;
    el.flash.classList.add('on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.flash.classList.remove('on'), 260);
  }

  // A flash: a white-out that fades, scaled by how close the canister landed.
  function blind(power) {
    if (!el.blind) return;
    el.blind.style.opacity = String(Math.max(0, Math.min(0.96, power)));
    el.blind.classList.add('on');
    clearTimeout(blindTimer);
    blindTimer = setTimeout(() => {
      el.blind.classList.remove('on');
      el.blind.style.opacity = '0';
    }, 180 + power * 700);
  }

  function showOverlay(mode) {
    if (mode === 'start') {
      el.overlayTitle.innerHTML = 'Ember<br><span>Foundry</span>';
      el.overlayCopy.textContent = 'Two teams. Short rounds. One bomb. Buy at the bell, take a site, hold the angle — accuracy beats speed.';
      el.play.textContent = 'Deploy';
    } else if (mode === 'paused') {
      el.overlayTitle.textContent = 'Paused';
      el.overlayCopy.textContent = 'The round is frozen. Click resume to take the mouse back.';
      el.play.textContent = 'Resume';
    } else if (mode === 'end') {
      el.overlayTitle.textContent = 'Match over';
      el.overlayCopy.textContent = `Final score ${last.ct ?? 0} — ${last.t ?? 0}. Refresh to play again.`;
      el.play.textContent = 'Play again';
    }
    el.overlay.hidden = false;
    if (el.hud) el.hud.style.opacity = '0';
  }

  function hideOverlay() {
    el.overlay.hidden = true;
    if (el.hud) el.hud.style.opacity = '1';
  }

  function openBuy(items, money, note) {
    el.buyGrid.textContent = '';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `buy-item${item.price > money ? ' cant' : ''}`;
      button.innerHTML = `${item.icon ? `<span class="ic">${item.icon}</span>` : ''}<span class="txt"><span class="nm">${item.name}</span>${item.sub ? `<span class="sub">${item.sub}</span>` : ''}</span><span class="price">$${item.price}</span>`;
      button.addEventListener('click', () => { if (buyHandler) buyHandler(item.id); });
      el.buyGrid.appendChild(button);
    }
    el.buyNote.textContent = note || `Balance $${money}`;
    el.buy.hidden = false;
  }

  function closeBuy() {
    el.buy.hidden = true;
  }

  function showBoard(rows) {
    el.boardBody.textContent = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      if (!row.alive) tr.className = 'dead';
      tr.innerHTML = `<td class="${row.team}">${row.name}</td><td>${row.kills}</td><td>${row.deaths}</td><td>${row.health}</td>`;
      el.boardBody.appendChild(tr);
    }
    el.board.hidden = false;
  }

  function hideBoard() {
    el.board.hidden = true;
  }

  // ---------- radar ----------
  // North-up minimap on a 2x canvas (crisp at 1080p). Redrawn only when a value that
  // matters changes, so a still frame costs one string compare.
  const radarCtx = el.radar ? el.radar.getContext('2d') : null;
  let radarStamp = '';

  function drawRadar(d) {
    if (!radarCtx) return;
    const stamp = `${d.player.x.toFixed(1)}|${d.player.z.toFixed(1)}|${d.player.yaw.toFixed(2)}|${d.bomb.on ? d.bomb.x.toFixed(0) + d.bomb.z.toFixed(0) : '-'}|${d.enemies.map((e) => (e.visible ? 1 : 0)).join('')}|${d.mates.map((m) => (m.alive ? 1 : 0)).join('')}|${d.tick}`;
    if (stamp === radarStamp) return;
    radarStamp = stamp;
    const W = el.radar.width;
    const H = el.radar.height;
    const half = d.half || 22;
    const sx = W / (half * 2);
    const sz = H / (half * 2);
    const px = (x) => (x + half) * sx;
    const py = (z) => (z + half) * sz;

    radarCtx.clearRect(0, 0, W, H);
    radarCtx.fillStyle = '#080c0fe6';
    radarCtx.fillRect(0, 0, W, H);

    radarCtx.strokeStyle = '#ffffff0d';
    radarCtx.lineWidth = 1;
    for (let g = -half; g <= half; g += 8) {
      radarCtx.beginPath(); radarCtx.moveTo(px(g), 0); radarCtx.lineTo(px(g), H); radarCtx.stroke();
      radarCtx.beginPath(); radarCtx.moveTo(0, py(g)); radarCtx.lineTo(W, py(g)); radarCtx.stroke();
    }

    radarCtx.fillStyle = '#2b3742';
    radarCtx.strokeStyle = '#4c5d6b';
    radarCtx.lineWidth = 1.5;
    for (const b of d.boxes) {
      const x = px(b.minX);
      const y = py(b.minZ);
      const w = (b.maxX - b.minX) * sx;
      const h = (b.maxZ - b.minZ) * sz;
      if (w < 1.5 || h < 1.5) continue;
      radarCtx.fillRect(x, y, w, h);
      radarCtx.strokeRect(x, y, w, h);
    }

    for (const s of d.sites) {
      const x = px(s.x);
      const y = py(s.z);
      radarCtx.strokeStyle = s.name === 'A' ? '#ff7a2f' : '#3ec9b0';
      radarCtx.lineWidth = 2;
      radarCtx.beginPath(); radarCtx.arc(x, y, 11, 0, Math.PI * 2); radarCtx.stroke();
      radarCtx.fillStyle = s.name === 'A' ? '#ff7a2f22' : '#3ec9b022';
      radarCtx.fill();
      radarCtx.fillStyle = s.name === 'A' ? '#ff7a2f' : '#3ec9b0';
      radarCtx.font = 'bold 13px ui-monospace, monospace';
      radarCtx.textAlign = 'center';
      radarCtx.textBaseline = 'middle';
      radarCtx.fillText(s.name, x, y + 0.5);
    }

    for (const m of d.mates) {
      if (!m.alive) continue;
      radarCtx.fillStyle = '#3ec9b0';
      radarCtx.beginPath(); radarCtx.arc(px(m.x), py(m.z), 3.2, 0, Math.PI * 2); radarCtx.fill();
    }

    // Enemies only while spotted: the radar must not become a wallhack.
    for (const e of d.enemies) {
      if (!e.alive || !e.visible) continue;
      radarCtx.fillStyle = '#ff5a3c';
      radarCtx.beginPath(); radarCtx.arc(px(e.x), py(e.z), 3.6, 0, Math.PI * 2); radarCtx.fill();
      radarCtx.strokeStyle = '#ff5a3c66';
      radarCtx.lineWidth = 2;
      radarCtx.beginPath(); radarCtx.arc(px(e.x), py(e.z), 7, 0, Math.PI * 2); radarCtx.stroke();
    }

    if (d.bomb.on) {
      const x = px(d.bomb.x);
      const y = py(d.bomb.z);
      radarCtx.fillStyle = '#ff7a2f';
      radarCtx.beginPath();
      radarCtx.arc(x, y, 4 + Math.sin(d.tick * 6) * 1.6, 0, Math.PI * 2);
      radarCtx.fill();
    }

    const cx = px(d.player.x);
    const cy = py(d.player.z);
    const ang = Math.atan2(-Math.cos(d.player.yaw), -Math.sin(d.player.yaw));
    const cone = radarCtx.createRadialGradient(cx, cy, 4, cx, cy, 46);
    cone.addColorStop(0, '#ffffff33');
    cone.addColorStop(1, '#ffffff00');
    radarCtx.fillStyle = cone;
    radarCtx.beginPath();
    radarCtx.moveTo(cx, cy);
    radarCtx.arc(cx, cy, 46, ang - 0.62, ang + 0.62);
    radarCtx.closePath();
    radarCtx.fill();

    radarCtx.save();
    radarCtx.translate(cx, cy);
    radarCtx.rotate(ang + Math.PI / 2);
    radarCtx.fillStyle = '#ffffff';
    radarCtx.beginPath();
    radarCtx.moveTo(0, -7);
    radarCtx.lineTo(5, 5);
    radarCtx.lineTo(0, 2.4);
    radarCtx.lineTo(-5, 5);
    radarCtx.closePath();
    radarCtx.fill();
    radarCtx.restore();
  }

  function setRadarLabel(text) {
    if (text === last.radarLabel) return;
    last.radarLabel = text;
    if (el.radarLabel) el.radarLabel.textContent = text;
  }

  // ---------- equipment ----------
  function setEquipment(state) {
    const key = `${state.slot}|${state.primary}|${state.secondary}|${state.frag}|${state.smoke}|${state.flash}|${state.kind}`;
    if (key === last.equipKey) return;
    last.equipKey = key;
    el.equipment.textContent = '';
    const slots = [
      { k: '1', name: state.primary || 'VK-47', on: state.slot === 1 },
      { k: '2', name: state.secondary || 'P9', on: state.slot === 2 },
      { k: '3', name: 'KNIFE', on: state.slot === 3 },
      { k: '4', name: `FRAG ×${state.frag}`, on: state.kind === 'he' && state.frag > 0, dim: state.frag <= 0 },
      { k: '5', name: `SMOKE ×${state.smoke}`, on: state.kind === 'smoke' && state.smoke > 0, dim: state.smoke <= 0 },
      { k: '6', name: `FLASH ×${state.flash}`, on: state.kind === 'flash' && state.flash > 0, dim: state.flash <= 0 },
    ];
    for (const s of slots) {
      const d = document.createElement('div');
      d.className = `eq${s.on ? ' on' : ''}${s.dim ? ' dim' : ''}`;
      d.innerHTML = `<b>${s.k}</b><span>${s.name}</span>`;
      el.equipment.appendChild(d);
    }
  }

  // ---------- radio ----------
  let radioTimer = 0;
  function radio(text, team) {
    if (!el.radio) return;
    el.radio.textContent = text;
    el.radio.className = team ? `on ${team}` : 'on';
    clearTimeout(radioTimer);
    if (still()) return;
    radioTimer = setTimeout(() => el.radio.classList.remove('on'), 4600);
  }

  // ---------- alive pips ----------
  function setAlive(ct, t, ctMax = 3, tMax = 3) {
    const key = `${ct}/${t}`;
    if (key === last.aliveKey) return;
    last.aliveKey = key;
    const draw = (host, n, max) => {
      if (!host) return;
      host.textContent = '';
      for (let i = 0; i < max; i += 1) {
        const pip = document.createElement('i');
        if (i < n) pip.className = 'up';
        host.appendChild(pip);
      }
    };
    draw(el.pipsCT, ct, ctMax);
    draw(el.pipsT, t, tMax);
  }

  return {
    setVitals, setAmmo, setMoney, setClock, setRound, setScore,
    killFeed, bombBanner, banner, hitMarker, flashDamage, blind,
    setSpread, setAction,
    showOverlay, hideOverlay,
    openBuy, closeBuy, showBoard, hideBoard,
    drawRadar, setRadarLabel, setEquipment, radio, setAlive,
    onPlay(handler) { playHandler = handler; },
    onBuy(handler) { buyHandler = handler; },
    onCloseBuy(handler) { closeHandler = handler; },
  };
}
