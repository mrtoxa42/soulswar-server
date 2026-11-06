'use strict';
const { PgClans, member, fail } = require('./clan_store');
const { ClanSiege, WORDS } = require('./clan_siege');
class Clans {
  constructor(
    accounts,
    send,
    {
      now = () => Date.now(),
      store = null,
      busy = () => false,
      safe = () => true,
      filter = () => true,
    } = {},
  ) {
    this.accounts = accounts;
    this.send = send;
    this.now = now;
    this.safe = safe;
    this.filter = filter;
    this.store = store || (accounts.store?.pool ? new PgClans(accounts.store.pool) : null);
    this.online = new Map();
    this.lastBroadcast = 0;
    this.siege = new ClanSiege({
      now,
      send,
      busy,
      persist: (r) => this.store.war(r),
      practice: (r) => this.store.practice(r),
    });
  }
  busy(p) {
    return this.siege.busy(p) || !!p.clanHQ;
  }
  action(p, d) {
    const now = this.now();
    p.clanRate ||= { at: now, count: 0 };
    if (now - p.clanRate.at >= 1000) p.clanRate = { at: now, count: 0 };
    if (++p.clanRate.count > 65) return;
    // Serialize account mutations and authentication; input packets are synchronous after authentication.
    if (['war_move', 'war_key', 'war_target', 'hq_move'].includes(d.action)) {
      try {
        this.authorized(p);
        if (d.action === 'hq_move') this.move(p, d);
        else this.siege.action(p, d, p.clanData);
      } catch (e) {
        this.error(p, e);
      }
      return;
    }
    if ((p.clanPending || 0) >= 4) return;
    p.clanPending = (p.clanPending || 0) + 1;
    p.clanChain = (p.clanChain || Promise.resolve())
      .then(() => this.perform(p, d))
      .catch((e) => this.error(p, e))
      .finally(() => {
        p.clanPending--;
      });
  }
  authorized(p) {
    if (!this.store) fail('clans_unavailable');
    if (!p.clanAccount || this.now() > p.clanUntil) fail('sign_in_required');
  }
  error(p, e) {
    this.send(p, { type: 'clan', event: 'error', reason: e.clanReason || 'clans_unavailable' });
  }
  async refresh(p) {
    const state = await this.store.snapshot(p.clanAccount.id);
    p.clanData = state.clan;
    this.send(p, { type: 'clan', event: 'state', ...state, account: p.clanAccount.id });
    return state;
  }
  async perform(p, d) {
    const now = this.now();
    if (d.action === 'auth') {
      if (!this.store || !this.accounts.store) fail('clans_unavailable');
      if (now - (p.clanAuthAt || 0) < 2000) fail('please_wait');
      p.clanAuthAt = now;
      if (typeof d.token !== 'string' || d.token.length > 256) fail('sign_in_required');
      const account = await this.accounts.store.load(d.token);
      if (!account) fail('sign_in_required');
      if (p.ws && p.ws.readyState !== 1) return;
      const old = this.online.get(account.id);
      if (old && old !== p) {
        this.siege.leave(account.id, false);
        old.clanHQ = false;
        old.clanUntil = 0;
        this.send(old, { type: 'clan', event: 'error', reason: 'session_replaced' });
      }
      if (p.clanAccount && p.clanAccount.id !== account.id) this.leave(p);
      p.clanAccount = { id: account.id, display_name: account.display_name };
      p.clanUntil = now + 65000;
      this.online.set(account.id, p);
      await this.refresh(p);
      const reserved = this.siege.squad(account.id);
      if (reserved && reserved.clan !== p.clanData?.id) this.siege.leave(account.id, true);
      else this.siege.reconnect(p);
      return;
    }
    this.authorized(p);
    if (d.action === 'snapshot') {
      if (now - (p.clanSnapshotAt || 0) < 2000) return;
      p.clanSnapshotAt = now;
      await this.refresh(p);
      this.siege.snapshot(p);
      return;
    }
    if (d.action === 'hq_leave') {
      p.clanHQ = false;
      this.send(p, { type: 'clan', event: 'headquarters', players: [] });
      return;
    }
    if (d.action === 'hq_enter') {
      if (!this.safe(p) || this.siege.busyOther(p)) fail('visit_the_clan_hall_in_the_city');
      await this.refresh(p);
      if (!p.clanData) fail('join_a_clan_first');
      if (this.siege.busy(p)) fail('leave_current_activity_first');
      p.clanHQ = true;
      p.clanX = 600;
      p.clanY = 650;
      p.clanMoveAt = now;
      this.headquarters(p);
      return;
    }
    if (d.action.startsWith('war_')) {
      if (['war_create', 'war_join', 'war_queue', 'war_practice'].includes(d.action)) {
        if (!this.safe(p)) fail('visit_the_clan_hall_in_the_city');
        await this.refresh(p);
        if (!p.clanData) fail('join_a_clan_first');
        p.clanHQ = false;
      }
      this.siege.action(p, d, p.clanData);
      return;
    }
    if (d.action === 'chat') {
      if (now - (p.clanChatAt || 0) < 1600) fail('chat_too_fast');
      p.clanChatAt = now;
      await this.refresh(p);
      if (!p.clanData) fail('join_a_clan_first');
      if (typeof d.text !== 'string') return;
      const text = d.text
        .replace(/[\x00-\x1f\x7f]/g, '')
        .trim()
        .slice(0, 200);
      if (!text) return;
      if (!this.filter(text)) fail('blocked_content');
      for (const peer of this.online.values())
        if (peer.clanData?.id === p.clanData.id)
          this.send(peer, { type: 'clan', event: 'chat', name: p.clanAccount.display_name, text });
      return;
    }
    if (d.action === 'commission') {
      if (!p.clanHQ || !p.clanData || Math.hypot(p.clanX - 600, p.clanY - 430) > 145)
        fail('approach_the_soul_shrine');
      if (!p.clanWord) {
        p.clanWord = WORDS[Math.floor(Math.random() * WORDS.length)];
        p.clanWordAt = now;
        this.send(p, { type: 'clan', event: 'commission', word: p.clanWord });
        return;
      }
      if (typeof d.word !== 'string' || d.word !== p.clanWord) fail('wrong_word');
      if (now - p.clanWordAt < p.clanWord.length * 90) fail('type_the_whole_word');
      if (!(await this.store.contribute(p.clanAccount.id, p.clanData.id, 'words', now)))
        fail('daily_commission_complete');
      p.clanWord = WORDS[Math.floor(Math.random() * WORDS.length)];
      p.clanWordAt = now;
      this.send(p, { type: 'clan', event: 'commission', word: p.clanWord, earned: 3 });
      await this.refresh(p);
      return;
    }
    if (now - (p.clanMutationAt || 0) < 1000) fail('please_wait');
    p.clanMutationAt = now;
    if (d.action === 'create' && !this.filter(String(d.name || '') + ' ' + String(d.tag || '')))
      fail('blocked_content');
    if (this.siege.busy(p)) fail('leave_the_squad_first');
    const oldClan = p.clanData?.id;
    await this.store.change(p.clanAccount, d, now);
    await this.refresh(p);
    for (const peer of this.online.values())
      if (peer !== p && (peer.clanData?.id === oldClan || peer.clanData?.id === p.clanData?.id)) {
        await this.refresh(peer);
        if (!peer.clanData) {
          peer.clanHQ = false;
          this.siege.leave(peer.clanAccount.id, true);
        }
      }
    if (!p.clanData) p.clanHQ = false;
  }
  move(p, d) {
    if (
      !p.clanHQ ||
      !Number.isFinite(d.x) ||
      !Number.isFinite(d.y) ||
      Math.abs(d.x) > 1 ||
      Math.abs(d.y) > 1
    )
      return;
    const now = this.now(),
      dt = Math.min(0.15, (now - p.clanMoveAt) / 1000);
    p.clanMoveAt = now;
    const length = Math.max(1, Math.hypot(d.x, d.y));
    const x = Math.max(120, Math.min(1080, p.clanX + (d.x / length) * 240 * dt)),
      y = Math.max(310, Math.min(740, p.clanY + (d.y / length) * 240 * dt));
    // Keep the hall, two workshops and the shrine plinth solid at their feet.
    const blocked = (x, y) =>
      [
        { x: 240, y: 420, w: 170, h: 60 },
        { x: 960, y: 420, w: 170, h: 60 },
        { x: 600, y: 430, w: 100, h: 45 },
      ].some((b) => Math.abs(x - b.x) < b.w / 2 + 16 && Math.abs(y - b.y) < b.h / 2 + 12);
    if (!blocked(x, p.clanY)) p.clanX = x;
    if (!blocked(p.clanX, y)) p.clanY = y;
  }
  headquarters(p) {
    if (!p.clanHQ || !p.clanData) return;
    const peers = [...this.online.values()]
      .filter((o) => o.clanHQ && o.clanData?.id === p.clanData.id && this.now() < o.clanUntil)
      .map((o) => ({
        id: o.clanAccount.id,
        name: o.clanAccount.display_name,
        class: o.class,
        x: o.clanX,
        y: o.clanY,
        look: Object.fromEntries(
          ['outfit', 'hat', 'face', 'shoes', 'accessory', 'weapon', 'skin'].map((k) => [
            k,
            o[k] || 'none',
          ]),
        ),
      }));
    this.send(p, { type: 'clan', event: 'headquarters', players: peers, now: this.now() });
  }
  tick() {
    const now = this.now();
    this.siege.tick();
    if (now - this.lastBroadcast < 100) return;
    this.lastBroadcast = now;
    for (const p of this.online.values()) {
      if (now >= p.clanUntil) {
        p.clanHQ = false;
        this.siege.leave(p.clanAccount.id, false);
        this.online.delete(p.clanAccount.id);
        continue;
      }
      this.headquarters(p);
    }
  }
  leave(p) {
    if (!p.clanAccount) return;
    if (this.online.get(p.clanAccount.id) !== p) return;
    this.online.delete(p.clanAccount.id);
    p.clanHQ = false;
    this.siege.leave(p.clanAccount.id, false);
  }
}
module.exports = { Clans };
