'use strict';
// A socket ACK proves local delivery only. Rows are confirmed by the profile
// transaction after the receipt is present in the account's cloud revision.
class DurableRewards {
  constructor(pool, { now = () => Date.now() } = {}) {
    this.pool = pool;
    this.now = now;
    this.cached = new Map();
    this.writing = new Map();
    this.remembered = new Map();
  }
  async list(accountId, playerClass) {
    const key = accountId + ':' + playerClass,
      cached = this.cached.get(key);
    if (cached && this.now() - cached.at < 4000) return cached.rewards;
    const result = await this.pool.query(
      'SELECT reward FROM sw_reward_receipts WHERE account_id=$1 AND player_class=$2 AND confirmed_at IS NULL ORDER BY created_at,id LIMIT 64',
      [accountId, playerClass],
    );
    const rewards = result.rows.map((row) => row.reward);
    this.cached.set(key, { at: this.now(), rewards });
    if (this.cached.size > 5000)
      for (const [k, v] of this.cached) if (this.now() - v.at > 60000) this.cached.delete(k);
    return rewards;
  }
  async remember(player, reward) {
    const key = player.accountId + ':' + reward.id;
    if (this.remembered.has(key)) return;
    if (this.writing.has(key)) return this.writing.get(key);
    const pending = this.pool
      .query(
        'INSERT INTO sw_reward_receipts(account_id,id,player_class,reward) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',
        [player.accountId, reward.id, player.class, JSON.stringify(reward)],
      )
      .then(() => {
        this.cached.delete(player.accountId + ':' + player.class);
        this.remembered.set(key, this.now());
        if (this.remembered.size > 5000)
          for (const [k, at] of this.remembered)
            if (this.now() - at > 600000) this.remembered.delete(k);
      })
      .finally(() => this.writing.delete(key));
    this.writing.set(key, pending);
    return pending;
  }
  async deliver(player, message, send) {
    if (!player.accountId || !Array.isArray(message.receipts)) {
      send(player, message);
      return;
    }
    player.rewardDeliverySerial ||= {};
    const serial = (player.rewardDeliverySerial[message.type] =
      (player.rewardDeliverySerial[message.type] || 0) + 1);
    const originalSend = send;
    send = (p, data) => {
      if (p.rewardDeliverySerial[message.type] === serial) originalSend(p, data);
    };
    // Preserve state delivery if persistence is temporarily unavailable. Never
    // claim reward delivery before its durable insert succeeds; later ticks retry.
    try {
      for (const reward of message.receipts) await this.remember(player, reward);
      const receipts = await this.list(player.accountId, player.class);
      const prefix = { tower_defense: 'td:', battle_royale: 'br:', notebook_racing: 'rc:' }[
        message.type
      ];
      send(player, { ...message, receipts: receipts.filter((r) => r.id.startsWith(prefix)) });
    } catch {
      send(player, { ...message, receipts: [], reward_pending: true });
    }
  }
}
module.exports = { DurableRewards };
