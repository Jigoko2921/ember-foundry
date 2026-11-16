// Match rules: freeze time, live rounds, the bomb, money and the score. The simulation
// calls tick() once per fixed step and reads one small state object; rendering never writes it.
import * as THREE from 'three';

export const PHASE = { BUY: 'buy', LIVE: 'live', END: 'end' };

const FREEZE_SECONDS = 7;
const ROUND_SECONDS = 115;
const END_SECONDS = 5;
const BOMB_SECONDS = 40;
const PLANT_SECONDS = 3.2;
const DEFUSE_SECONDS = 6.0;
const DEFUSE_WITH_KIT = 3.5;

const START_MONEY = 800;
const MAX_MONEY = 16000;
const WIN_REWARD = 3250;
const LOSS_BASE = 1400;
const LOSS_STEP = 500;
const LOSS_MAX = 3400;

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
      plantedAt: 0,
      defuseProgress: 0,
      plantProgress: 0,
    },
    money: new Map(),
    events: [],
  };

  const temp = new THREE.Vector3();

  function emit(type, data = {}) {
    state.events.push({ type, ...data, at: state.round });
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

  function rewardTeam(team, amount) {
    for (const [id, money] of state.money) {
      if (state.teamOf && state.teamOf(id) === team) state.money.set(id, Math.min(MAX_MONEY, money + amount));
    }
  }

  function payRoundEnd() {
    const winner = state.winner;
    if (winner === 'ct' || winner === 't') {
      rewardTeam(winner, WIN_REWARD);
      const loser = winner === 'ct' ? 't' : 'ct';
      const streak = state.lossStreak[loser];
      rewardTeam(loser, Math.min(LOSS_MAX, LOSS_BASE + LOSS_STEP * Math.max(0, streak - 1)));
    } else {
      rewardTeam('ct', 1900);
      rewardTeam('t', 1900);
    }
  }

  function registerPlayer(id, team) {
    state.money.set(id, START_MONEY);
    if (!state.teamOf) state.teamOf = new Map();
    state.teamOf.set(id, team);
  }

  function teamOf(id) {
    return state.teamOf ? state.teamOf.get(id) : null;
  }

  function addMoney(id, amount) {
    state.money.set(id, Math.min(MAX_MONEY, (state.money.get(id) ?? 0) + amount));
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

  function aliveCount(bodies, team) {
    let n = 0;
    for (const body of bodies) if (body.team === team && body.alive) n += 1;
    return n;
  }

  function tick(dt, ctx) {
    // ctx: { bodies, playerBody, bombCarrier, sites, playerInput:{plant,defuse}, playerHasKit }
    state.phaseLeft = Math.max(0, state.phaseLeft - dt);

    if (state.phase === PHASE.BUY) {
      // Assign the bomb to a living T at the bell.
      if (state.bomb.carrier === null) {
        const carriers = ctx.bodies.filter((b) => b.team === 't' && b.alive);
        if (carriers.length) state.bomb.carrier = carriers[0].id;
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

    // --- live
    const ctAlive = aliveCount(ctx.bodies, 'ct');
    const tAlive = aliveCount(ctx.bodies, 't');

    // Bomb carried: if the carrier dies, the bomb drops and a living T can pick it up.
    if (state.bomb.state === 'carried') {
      const carrier = ctx.bodies.find((b) => b.id === state.bomb.carrier);
      if (!carrier || !carrier.alive) {
        const taker = ctx.bodies.find((b) => b.team === 't' && b.alive);
        state.bomb.carrier = taker ? taker.id : null;
      }

      // Planting: the player holds E on a site, or a T bot with the bomb stands on one.
      const holder = ctx.bodies.find((b) => b.id === state.bomb.carrier && b.alive);
      if (holder) {
        const site = ctx.nearestSite(holder.position);
        if (site) {
          const wantsPlant = holder.id === ctx.playerBody.id ? ctx.playerInput.plant : holder.team === 't';
          if (wantsPlant) {
            state.bomb.plantProgress += dt;
            if (state.bomb.plantProgress >= PLANT_SECONDS) {
              state.bomb.state = 'planted';
              state.bomb.x = holder.position.x;
              state.bomb.z = holder.position.z;
              state.bomb.siteName = site.name;
              state.bomb.carrier = null;
              state.bomb.timer = BOMB_SECONDS;
              state.bomb.plantProgress = 0;
              emit('planted', { site: site.name });
            }
          } else {
            state.bomb.plantProgress = 0;
          }
        } else {
          state.bomb.plantProgress = 0;
        }
      }
    } else if (state.bomb.state === 'planted') {
      state.bomb.timer = Math.max(0, state.bomb.timer - dt);
      if (state.bomb.timer <= 0) {
        emit('exploded');
        endRound('t', 'The bomb detonated');
        return;
      }
      // Defusing: player or bot within reach, holding E.
      const defusers = ctx.bodies.filter((b) => b.team === 'ct' && b.alive
        && Math.hypot(b.position.x - state.bomb.x, b.position.z - state.bomb.z) < 2.0);
      let anyDefusing = false;
      for (const body of defusers) {
        const wants = body.id === ctx.playerBody.id ? ctx.playerInput.defuse : true;
        if (!wants) continue;
        anyDefusing = true;
        const need = body.id === ctx.playerBody.id && ctx.playerHasKit ? DEFUSE_WITH_KIT : DEFUSE_SECONDS;
        state.bomb.defuseProgress += dt;
        if (state.bomb.defuseProgress >= need) {
          state.bomb.state = 'defused';
          emit('defused');
          endRound('ct', 'Bomb defused');
          return;
        }
      }
      if (!anyDefusing) state.bomb.defuseProgress = Math.max(0, state.bomb.defuseProgress - dt * 2);
    }

    if (ctAlive === 0 && state.bomb.state !== 'planted') {
      endRound('t', 'Counter-Terrorists eliminated');
      return;
    }
    if (tAlive === 0) {
      if (state.bomb.state === 'planted') {
        // The bomb still has to be defused: the round goes on.
      } else {
        endRound('ct', 'Terrorists eliminated');
        return;
      }
    }
    if (state.phaseLeft <= 0) {
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
