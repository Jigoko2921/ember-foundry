// Match rules: freeze time, live rounds, the bomb, money and the score. The simulation
// calls tick() once per fixed step and reads one small state object; rendering never
// writes it, so a screenshot and a live round cannot disagree about the clock.
export const PHASE = { BUY: 'buy', LIVE: 'live', END: 'end' };

const FREEZE_SECONDS = 6;
const ROUND_SECONDS = 115;
const END_SECONDS = 5;
const BOMB_SECONDS = 40;
const PLANT_SECONDS = 3.2;
const DEFUSE_SECONDS = 6.0;
const DEFUSE_KIT_SECONDS = 3.5;

// The economy is what makes a lost round a choice: save, or buy and break the streak.
export const ECONOMY = {
  start: 800,
  max: 16000,
  win: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plant: 800,
  defuse: 300,
};

export function createMatch() {
  const state = {
    phase: PHASE.BUY,
    phaseLeft: FREEZE_SECONDS,
    round: 1,
    scoreCT: 0,
    scoreT: 0,
    lossStreak: { ct: 0, t: 0 },
    winner: null,
    reason: '',
    bomb: {
      state: 'carried',
      carrier: null,
      x: 0,
      z: 0,
      timer: BOMB_SECONDS,
      siteName: null,
      plantProgress: 0,
      defuseProgress: 0,
    },
    money: new Map(),
    teamOf: new Map(),
    events: [],
  };

  function emit(type, data = {}) {
    state.events.push({ type, ...data });
  }

  function drainEvents() {
    const out = state.events.slice();
    state.events.length = 0;
    return out;
  }

  function resetBomb() {
    state.bomb.state = 'carried';
    state.bomb.carrier = null;
    state.bomb.timer = BOMB_SECONDS;
    state.bomb.siteName = null;
    state.bomb.plantProgress = 0;
    state.bomb.defuseProgress = 0;
  }

  function startRound(roundNumber) {
    state.round = roundNumber;
    state.phase = PHASE.BUY;
    state.phaseLeft = FREEZE_SECONDS;
    state.winner = null;
    state.reason = '';
    resetBomb();
  }

  function endRound(winner, reason) {
    if (state.phase === PHASE.END) return;
    state.phase = PHASE.END;
    state.phaseLeft = END_SECONDS;
    state.winner = winner;
    state.reason = reason;
    if (winner === 'ct') {
      state.scoreCT += 1;
      state.lossStreak.ct = 0;
      state.lossStreak.t = Math.min(4, state.lossStreak.t + 1);
    } else if (winner === 't') {
      state.scoreT += 1;
      state.lossStreak.t = 0;
      state.lossStreak.ct = Math.min(4, state.lossStreak.ct + 1);
    }
    emit('roundEnd', { winner, reason });
  }

  function registerPlayer(id, team) {
    state.money.set(id, ECONOMY.start);
    state.teamOf.set(id, team);
  }

  function teamOf(id) {
    return state.teamOf.get(id) ?? null;
  }

  function addMoney(id, amount) {
    state.money.set(id, Math.min(ECONOMY.max, (state.money.get(id) ?? 0) + amount));
  }

  function moneyOf(id) {
    return state.money.get(id) ?? 0;
  }

  function spend(id, amount) {
    const have = moneyOf(id);
    if (have < amount) return false;
    state.money.set(id, have - amount);
    return true;
  }

  function payTeam(team, amount) {
    for (const [id, cash] of state.money) {
      if (teamOf(id) === team) state.money.set(id, Math.min(ECONOMY.max, cash + amount));
    }
  }

  function payRoundEnd() {
    if (state.winner === 'ct' || state.winner === 't') {
      payTeam(state.winner, ECONOMY.win);
      const loser = state.winner === 'ct' ? 't' : 'ct';
      const amount = Math.min(ECONOMY.lossMax, ECONOMY.lossBase + ECONOMY.lossStep * Math.max(0, state.lossStreak[loser] - 1));
      payTeam(loser, amount);
    } else {
      payTeam('ct', 1900);
      payTeam('t', 1900);
    }
  }

  function aliveCount(bodies, team) {
    let n = 0;
    for (let i = 0; i < bodies.length; i += 1) {
      const body = bodies[i];
      if (body.team === team && body.alive) n += 1;
    }
    return n;
  }

  function tick(dt, ctx) {
    // ctx: { bodies, playerBody, playerInput: {plant, defuse}, nearestSite, playerHasKit }
    state.phaseLeft = Math.max(0, state.phaseLeft - dt);

    if (state.phase === PHASE.BUY) {
      if (state.bomb.carrier === null) {
        const carrier = ctx.bodies.find((b) => b.team === 't' && b.alive);
        if (carrier) state.bomb.carrier = carrier.id;
      }
      if (state.phaseLeft <= 0) {
        state.phase = PHASE.LIVE;
        state.phaseLeft = ROUND_SECONDS;
        emit('live');
      }
      return;
    }

    if (state.phase === PHASE.END) {
      if (state.phaseLeft <= 0) {
        payRoundEnd();
        startRound(state.round + 1);
        emit('roundStart', { round: state.round });
      }
      return;
    }

    const bomb = state.bomb;
    const ctAlive = aliveCount(ctx.bodies, 'ct');
    const tAlive = aliveCount(ctx.bodies, 't');

    if (bomb.state === 'carried') {
      // The bomb changes hands rather than sitting on the floor: a dropped objective that
      // nobody can pick up is a round that stalls, and the bots have no pickup verb.
      const carrier = ctx.bodies.find((b) => b.id === bomb.carrier);
      if (!carrier || !carrier.alive) {
        const taker = ctx.bodies.find((b) => b.team === 't' && b.alive);
        bomb.carrier = taker ? taker.id : null;
      }
      const holder = ctx.bodies.find((b) => b.id === bomb.carrier && b.alive);
      if (holder) {
        const site = ctx.nearestSite(holder.position);
        const wantsPlant = holder.id === ctx.playerBody.id ? ctx.playerInput.plant : true;
        if (site && wantsPlant) {
          bomb.plantProgress += dt;
          if (bomb.plantProgress >= PLANT_SECONDS) {
            bomb.state = 'planted';
            bomb.x = holder.position.x;
            bomb.z = holder.position.z;
            bomb.siteName = site.name;
            bomb.carrier = null;
            bomb.timer = BOMB_SECONDS;
            bomb.plantProgress = 0;
            emit('planted', { site: site.name });
          }
        } else {
          bomb.plantProgress = 0;
        }
      }
    } else if (bomb.state === 'planted') {
      bomb.timer = Math.max(0, bomb.timer - dt);
      if (bomb.timer <= 0) {
        emit('exploded');
        endRound('t', 'The bomb detonated');
        return;
      }
      // Defusing: any CT in reach who is holding the use key (bots hold it by standing still).
      let defuser = null;
      for (const body of ctx.bodies) {
        if (body.team !== 'ct' || !body.alive) continue;
        if (Math.hypot(body.position.x - bomb.x, body.position.z - bomb.z) > 2.0) continue;
        if (body.id === ctx.playerBody.id && !ctx.playerInput.defuse) continue;
        defuser = body;
        break;
      }
      if (defuser) {
        const kit = defuser.id === ctx.playerBody.id && ctx.playerHasKit;
        bomb.defuseProgress += dt;
        if (bomb.defuseProgress >= (kit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS)) {
          bomb.state = 'defused';
          emit('defused');
          endRound('ct', 'Bomb defused');
          return;
        }
      } else {
        bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 2);
      }
    }

    if (ctAlive === 0 && bomb.state !== 'planted') {
      endRound('t', 'Counter-Terrorists eliminated');
      return;
    }
    if (tAlive === 0 && bomb.state !== 'planted') {
      endRound('ct', 'Terrorists eliminated');
      return;
    }
    if (state.phaseLeft <= 0 && bomb.state !== 'planted') {
      endRound('ct', 'Time ran out');
    }
  }

  return {
    state,
    tick,
    registerPlayer,
    teamOf,
    addMoney,
    moneyOf,
    spend,
    startRound,
    endRound,
    drainEvents,
    resetBomb,
    constants: { FREEZE_SECONDS, ROUND_SECONDS, BOMB_SECONDS, PLANT_SECONDS, DEFUSE_SECONDS },
  };
}
