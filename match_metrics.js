'use strict';
const crypto = require('node:crypto');
const MODES = { tower_defense: 'td', battle_royale: 'br', notebook_racing: 'race' };
class MatchMetrics {
  constructor(pool) {
    this.pool = pool;
    this.saved = new Map();
  }
  async record(player, message) {
    const state = message.metric_exit || message.state,
      game = MODES[message.type];
    const terminal = ['victory', 'defeat', 'finished', 'abandoned'].includes(state?.phase);
    if (
      !state ||
      !game ||
      (!terminal &&
        !['wave', 'break', 'countdown', 'racing', 'bus', 'battle'].includes(state.phase))
    )
      return;
    const round = state.id || state.match,
      identity = player.accountId || player.seasonKey;
    if (!round || !identity) return;
    const id = crypto
      .createHash('sha256')
      .update([identity, player.class, game, round].join(':'))
      .digest('hex');
    const previous = this.saved.get(id);
    if (previous === 'terminal' || (previous === 'started' && !terminal)) return;
    this.saved.set(id, terminal ? 'terminal' : 'started');
    try {
      const me = state.me || state.players?.find((p) => p.id === player.id) || {},
        typing = me.typing || state.typing || {};
      let won = false,
        xp = 0,
        coins = 0;
      if (game === 'td') {
        won = state.phase === 'victory';
        if (won && me.hits > 0) {
          const reward = require('./tower_defense.json').rewards;
          xp = reward.xp;
          coins = reward.coins;
        }
      } else if (game === 'br') {
        won = state.winner === me.team;
        if (won && !me.left && (me.damage > 0 || me.pickups > 0 || me.revives > 0)) {
          const reward = require('./battle_royale.json').rewards;
          xp = reward.xp;
          coins = reward.coins;
        }
      } else {
        won = me.place === 1;
        if (me.correct >= 3 && me.place > 0)
          xp = require('./notebook_racing.json').podium[me.place - 1]?.xp || 0;
      }
      const result = !terminal
        ? 'started'
        : state.phase === 'abandoned'
          ? 'abandoned'
          : won
            ? 'win'
            : game === 'race' && !(me.place > 0)
              ? 'dnf'
              : 'loss';
      if (!terminal || result === 'abandoned') {
        xp = 0;
        coins = 0;
      }
      await this.pool.query(
        "INSERT INTO sw_match_metrics(id,game,result,seconds,correct_chars,errors,xp,coins) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET result=EXCLUDED.result,seconds=EXCLUDED.seconds,correct_chars=EXCLUDED.correct_chars,errors=EXCLUDED.errors,xp=EXCLUDED.xp,coins=EXCLUDED.coins WHERE sw_match_metrics.result='started'",
        [
          id,
          game,
          result,
          Math.max(0, Number(state.elapsedSeconds) || 0),
          Math.max(0, typing.correct || 0),
          Math.max(0, typing.errors || 0),
          xp,
          coins,
        ],
      );
      if (this.saved.size > 10000) this.saved.delete(this.saved.keys().next().value);
    } catch {
      this.saved.delete(id);
    }
  }
}
module.exports = { MatchMetrics };
