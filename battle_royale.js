'use strict';
const crypto = require('node:crypto'),
  RULES = require('./battle_royale.json');
const CLASSES = ['Banker', 'Vampire', 'Speedster', 'Politician'];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function geometry(index) {
  let seed = RULES.maps[index].seed;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const sites = [];
  for (let row = 0; row < 10; row++)
    for (let col = 0; col < 12; col++) {
      const x = Math.round(380 + col * 790 + (rnd() - 0.5) * 200);
      let y = Math.round(380 + row * 700 + (rnd() - 0.5) * 180);
      if (Math.abs(y - RULES.maps[index].busY) < 200) y += 240;
      const kind = RULES.maps[index].kinds[(col + row * 3) % RULES.maps[index].kinds.length];
      const small = ['graves', 'rubble', 'fountain', 'fence', 'haunted_tree'].includes(kind),
        w = small ? 125 : 205,
        h = small ? 65 : 110;
      sites.push({ x, y, w, h, kind });
    }
  return sites;
}
const GEOMETRY = RULES.maps.map((_, i) => geometry(i));
function walkable(map, x, y, pad = 18) {
  return (
    x >= pad &&
    y >= pad &&
    x <= RULES.width - pad &&
    y <= RULES.height - pad &&
    !GEOMETRY[map].some(
      (o) =>
        x > o.x - o.w / 2 - pad &&
        x < o.x + o.w / 2 + pad &&
        y > o.y - o.h / 2 - pad &&
        y < o.y + o.h / 2 + pad,
    )
  );
}
function sight(map, a, b) {
  return !GEOMETRY[map].some((o) => {
    let lo = 0,
      hi = 1;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, o.x - o.w / 2, o.x + o.w / 2],
      [a.y, b.y - a.y, o.y - o.h / 2, o.y + o.h / 2],
    ]) {
      if (Math.abs(delta) < 0.00001) {
        if (start < min || start > max) return false;
      } else {
        let t1 = (min - start) / delta,
          t2 = (max - start) / delta;
        if (t1 > t2) [t1, t2] = [t2, t1];
        lo = Math.max(lo, t1);
        hi = Math.min(hi, t2);
        if (lo > hi) return false;
      }
    }
    return hi >= 0 && lo <= 1;
  });
}
class BattleRoyale {
  disconnect(p) {
    require('./minigame_reconnect').disconnect(this, p, 'br');
  }
  reconnect(p) {
    return require('./minigame_reconnect').reconnect(this, p);
  }

  constructor(send, { now = () => Date.now(), random = Math.random, busy = () => false } = {}) {
    this.send = send;
    this.now = now;
    this.random = random;
    this.busyOther = busy;
    this.parties = new Map();
    this.members = new Map();
    this.matches = new Map();
    this.pending = new Map();
    this.last = now();
    this.broadcastAt = 0;
    this.nextMap = 0;
  }
  error(p, reason) {
    this.send(p, { type: 'battle_royale', event: 'error', reason });
  }
  room(p) {
    return this.parties.get(this.members.get(p.id));
  }
  busy(p) {
    return !!this.room(p);
  }
  action(p, d) {
    if (p.zone !== 'minigame_hub') return this.error(p, 'enter_minigame_hub');
    const now = this.now();
    p.brRate ||= { at: now, count: 0 };
    if (now - p.brRate.at >= 1000) p.brRate = { at: now, count: 0 };
    if (++p.brRate.count > 65) return;
    if (d.action === 'ack') {
      const receipts = (this.pending.get(p.seasonKey) || []).filter((r) => r.id !== d.id);
      if (receipts.length) this.pending.set(p.seasonKey, receipts);
      else this.pending.delete(p.seasonKey);
      return;
    }
    if (d.action === 'snapshot') {
      this.snapshot(p);
      return;
    }
    if (d.action === 'leave') {
      this.leave(p);
      this.snapshot(p);
      return;
    }
    if (['solo', 'squad', 'create', 'join'].includes(d.action)) {
      if (this.room(p) || this.busyOther(p) || p.dead)
        return this.error(p, 'leave_current_game_first');
      let party;
      if (d.action === 'join') {
        party = this.parties.get(typeof d.code === 'string' ? d.code.trim().toUpperCase() : '');
        if (!party) return this.error(p, 'room_not_found');
        if (
          party.phase !== 'lobby' ||
          party.players.size >= RULES.teamSize ||
          party.mode !== 'squad'
        )
          return this.error(p, 'room_full_or_started');
      } else {
        if (this.parties.size >= 200) return this.error(p, 'server_busy');
        let code;
        do {
          code = crypto.randomBytes(3).toString('hex').toUpperCase();
        } while (this.parties.has(code));
        party = {
          code,
          host: p.id,
          players: new Map(),
          mode: d.action === 'solo' ? 'solo' : 'squad',
          phase: d.action === 'create' ? 'lobby' : 'queued',
          queuedAt: now,
          createdAt: now,
          match: null,
        };
        this.parties.set(code, party);
      }
      party.players.set(p.id, p);
      this.members.set(p.id, party.code);
      this.publishParty(party);
      this.matchmake();
      return;
    }
    const party = this.room(p);
    if (!party) return this.error(p, 'join_a_room_first');
    if (d.action === 'start' && party.phase === 'lobby') {
      if (party.host !== p.id) return this.error(p, 'only_host_can_start');
      party.phase = 'queued';
      party.queuedAt = now;
      this.publishParty(party);
      this.matchmake();
      return;
    }
    const match = this.matches.get(party.match),
      m = match?.actors.get(p.id);
    if (!match || !m || m.left) return;
    if (d.action === 'jump' && match.phase === 'bus' && m.status === 'bus') {
      this.jump(match, m);
      return;
    }
    if (d.action === 'move') {
      if (!Number.isFinite(d.dx) || !Number.isFinite(d.dy)) return;
      const len = Math.hypot(d.dx, d.dy);
      m.dx = len > 1 ? d.dx / len : d.dx;
      m.dy = len > 1 ? d.dy / len : d.dy;
      m.moveAt = now;
      return;
    }
    if (d.action === 'reset') {
      m.target = '';
      m.typed = '';
      return;
    }
    if (d.action === 'key') this.key(match, m, d, now);
  }
  matchmake() {
    for (const mode of ['solo', 'squad']) {
      const queue = [...this.parties.values()]
        .filter((p) => p.phase === 'queued' && p.mode === mode)
        .sort((a, b) => a.queuedAt - b.queuedAt);
      while (queue.length && this.matches.size < 30) {
        const selected = [];
        let count = 0;
        for (const p of queue)
          if (count + p.players.size <= RULES.capacity) {
            selected.push(p);
            count += p.players.size;
          }
        if (count < RULES.capacity && this.now() - queue[0].queuedAt < RULES.queueSeconds * 1000)
          break;
        this.launch(selected, mode);
        for (const p of selected) queue.splice(queue.indexOf(p), 1);
      }
    }
  }
  actor(p, team, npc, index) {
    const gear = npc
      ? {
          outfit: ['suit', 'gothic_coat', 'hoodie', 'politician_suit'][index % 4],
          hat: ['top_hat', 'aristocrat_crown', 'cap', 'fedora_pres'][index % 4],
          face: 'none',
          shoes: 'none',
          accessory: 'none',
          weapon: 'none',
          skin: 'classic',
        }
      : Object.fromEntries(
          ['outfit', 'hat', 'face', 'shoes', 'accessory', 'weapon', 'skin'].map((k) => [
            k,
            p[k] || 'none',
          ]),
        );
    return {
      ...gear,
      id: p.id,
      name: p.name,
      class: p.class,
      npc,
      p: npc ? null : p,
      team,
      x: 100,
      y: 1800,
      hp: 100,
      shield: 35,
      power: 0,
      boots: false,
      status: 'bus',
      dx: 0,
      dy: 0,
      moveAt: 0,
      seq: 0,
      lastKey: 0,
      target: '',
      typed: '',
      word: RULES.words[index % RULES.words.length],
      wordIndex: index,
      damage: 0,
      kills: 0,
      pickups: 0,
      revives: 0,
      bleed: 0,
      fall: 0,
      dropAt: 1 + ((index + 0.25 + this.random() * 0.5) / RULES.capacity) * (RULES.busSeconds - 2),
      dropLane: ((index % 7) - 3) / 3,
      think: 0,
      aiKeyAt: 0,
      aim: null,
      rank: 0,
      left: false,
    };
  }
  launch(parties, mode) {
    const now = this.now(),
      index = this.nextMap++ % RULES.maps.length;
    const r = {
      id: crypto.randomUUID(),
      mode,
      map: index,
      actors: new Map(),
      loot: [],
      phase: 'bus',
      start: now,
      battleAt: now + RULES.busSeconds * 1000,
      zone: {
        x: RULES.width / 2,
        y: RULES.height / 2,
        r: RULES.zoneRadii[0],
        fromX: RULES.width / 2,
        fromY: RULES.height / 2,
        fromR: RULES.zoneRadii[0],
        toX: RULES.width / 2,
        toY: RULES.height / 2,
        toR: RULES.zoneRadii[1],
        stage: 0,
        start: now + RULES.busSeconds * 1000,
        duration: RULES.zoneSeconds[0] * 1000,
      },
      bus: { x: 100, y: RULES.maps[index].busY },
      events: [],
      winner: null,
      endedAt: 0,
      parties: parties.map((p) => p.code),
    };
    let n = 0;
    const teams = [];
    const allocate = (count) => {
      let team = mode === 'solo' ? -1 : teams.findIndex((size) => size + count <= RULES.teamSize);
      if (team < 0) {
        team = teams.length;
        teams.push(0);
      }
      teams[team] += count;
      return team;
    };
    // Keep invited groups intact; automatic groups fill around them without splits.
    const ordered = parties.slice().sort((a, b) => b.players.size - a.players.size);
    for (const party of ordered) {
      const team = allocate(party.players.size);
      for (const p of party.players.values()) {
        const actor = this.actor(p, team, false, n++);
        actor.y = r.bus.y;
        r.actors.set(p.id, actor);
      }
      party.phase = 'match';
      party.match = r.id;
    }
    while (n < RULES.capacity) {
      const team = allocate(1),
        id = 'brbot:' + crypto.randomUUID(),
        cls = CLASSES[n % 4];
      const actor = this.actor(
        {
          id,
          name:
            ['Quill', 'Moss', 'Pip', 'Nora', 'Bram', 'Fenn', 'Lumi', 'Ash', 'Clover', 'Echo'][
              n % 10
            ] +
            '-' +
            (n + 1),
          class: cls,
        },
        team,
        true,
        n++,
      );
      actor.y = r.bus.y;
      r.actors.set(id, actor);
    }
    // Loot is fixed per match, server-owned and always on reachable ground.
    for (let i = 0; i < 480; i++) {
      let x = 180 + (i % 24) * 390 + (this.random() - 0.5) * 160,
        y = 180 + Math.floor(i / 24) * 350 + (this.random() - 0.5) * 120;
      const at = this.free(r.map, x, y);
      r.loot.push({ id: 'loot:' + i, x: at.x, y: at.y, ...RULES.loot[i % RULES.loot.length] });
    }
    this.matches.set(r.id, r);
    this.setZoneTarget(r);
    this.publish(r);
  }
  free(map, x, y) {
    x = clamp(x, 30, RULES.width - 30);
    y = clamp(y, 30, RULES.height - 30);
    if (walkable(map, x, y)) return { x, y };
    for (let radius = 50; radius <= 350; radius += 50)
      for (let i = 0; i < 8; i++) {
        const at = {
          x: clamp(x + Math.cos((i * Math.PI) / 4) * radius, 30, RULES.width - 30),
          y: clamp(y + Math.sin((i * Math.PI) / 4) * radius, 30, RULES.height - 30),
        };
        if (walkable(map, at.x, at.y)) return at;
      }
    return { x: RULES.width / 2, y: RULES.height / 2 };
  }
  jump(r, m) {
    // Stratified route positions survive a delayed tick; bots cannot pile onto the final stop.
    const x = m.npc ? 100 + (m.dropAt / RULES.busSeconds) * (RULES.width - 200) : r.bus.x;
    const y = m.npc ? r.bus.y + m.dropLane * RULES.height * 0.32 : r.bus.y;
    const at = this.free(r.map, x + (this.random() - 0.5) * 70, y);
    m.x = at.x;
    m.y = at.y;
    m.status = 'falling';
    m.fall = 2;
    m.dx = 0;
    m.dy = 0;
  }
  move(r, m, dt) {
    if (!['alive', 'down', 'falling'].includes(m.status)) return;
    if (this.now() - m.moveAt > 400) {
      m.dx = 0;
      m.dy = 0;
    }
    const speed = m.status === 'down' ? RULES.crawlSpeed : RULES.speed + (m.boots ? 25 : 0);
    const x = m.x + m.dx * speed * dt,
      y = m.y + m.dy * speed * dt;
    if (walkable(r.map, x, m.y)) m.x = x;
    if (walkable(r.map, m.x, y)) m.y = y;
  }
  target(r, m, id, verb = '') {
    if (m.status !== 'alive') return null;
    const other = r.actors.get(id);
    if (other) {
      if (
        other.id === m.id ||
        other.left ||
        !['alive', 'down'].includes(other.status) ||
        !sight(r.map, m, other)
      )
        return null;
      if (other.status === 'down') {
        if (
          dist(m, other) > RULES.reviveRange ||
          !['KILL', 'REVIVE'].includes(verb) ||
          (verb === 'KILL' && other.team === m.team)
        )
          return null;
        return { kind: verb, object: other, word: verb };
      }
      if (
        other.team === m.team ||
        dist(m, other) > RULES.range ||
        this.now() < (other.safeUntil || 0) ||
        this.now() < (m.safeUntil || 0)
      )
        return null;
      return { kind: 'attack', object: other, word: other.word };
    }
    const loot = r.loot.find((l) => l.id === id);
    if (loot && dist(m, loot) <= RULES.lootRange && sight(r.map, m, loot))
      return { kind: 'loot', object: loot, word: loot.word };
    return null;
  }
  key(r, m, d, now) {
    if (
      !['bus', 'battle'].includes(r.phase) ||
      !Number.isInteger(d.seq) ||
      d.seq !== m.seq + 1 ||
      typeof d.key !== 'string' ||
      !/^[A-Z]$/.test(d.key)
    )
      return;
    m.seq = d.seq;
    m.inputBudget = Math.min(
      12,
      (m.inputBudget ?? 12) + Math.max(0, now - (m.budgetAt ?? now)) / RULES.keyInterval,
    );
    m.budgetAt = now;
    if (m.inputBudget < 1) return;
    m.inputBudget--;
    m.lastKey = now;
    const t = this.target(r, m, d.target, d.verb);
    if (!t) {
      m.target = '';
      m.typed = '';
      return;
    }
    const signature = t.object.id + ':' + t.kind + ':' + t.word;
    if (m.target !== signature) {
      m.target = signature;
      m.typed = '';
    }
    require('./typing_stats').tap(m, d.key === t.word[m.typed.length]);
    if (d.key !== t.word[m.typed.length]) {
      m.typed = '';
      return;
    }
    m.typed += d.key;
    if (m.typed === t.word) {
      require('./typing_stats').word(m);
      m.target = '';
      m.typed = '';
      this.complete(r, m, t);
    }
  }
  complete(r, m, t) {
    const target = t.object;
    if (t.kind === 'attack') {
      const damage = RULES.baseDamage + m.power * 10;
      this.hurt(r, target, damage, m);
      target.wordIndex = (target.wordIndex + 7) % RULES.words.length;
      target.word = RULES.words[target.wordIndex];
      r.events.push({
        kind: 'shot',
        x: m.x,
        y: m.y,
        tx: target.x,
        ty: target.y,
        at: this.now(),
        id: crypto.randomUUID(),
      });
    } else if (t.kind === 'loot') {
      if (target.kind === 'power') m.power = Math.min(RULES.maxPower, m.power + 1);
      if (target.kind === 'shield') m.shield = Math.min(75, m.shield + 40);
      if (target.kind === 'heal') m.hp = Math.min(100, m.hp + 40);
      if (target.kind === 'boots') {
        m.boots = true;
        m.shoes = 'boots';
      }
      if (target.kind === 'weapon') m.weapon = target.item;
      if (target.kind === 'outfit') m.outfit = target.item;
      r.events.push({ kind: 'pickup', x: m.x, y: m.y, at: this.now(), id: crypto.randomUUID() });
      m.pickups++;
      r.loot = r.loot.filter((l) => l !== target);
    } else if (t.kind === 'REVIVE') {
      target.status = 'alive';
      target.hp = RULES.reviveHealth;
      target.bleed = 0;
      target.safeUntil = this.now() + 1500;
      target.target = '';
      target.typed = '';
      m.revives++;
      r.events.push({
        kind: 'revive',
        x: target.x,
        y: target.y,
        at: this.now(),
        id: crypto.randomUUID(),
      });
    } else if (t.kind === 'KILL') this.eliminate(r, target, m);
  }
  hurt(r, target, amount, attacker = null) {
    if (!['alive', 'down'].includes(target.status) || this.now() < (target.safeUntil || 0)) return;
    if (attacker && target.team === attacker.team) return;
    if (target.status === 'down') {
      target.bleed -= amount * 0.25;
      if (target.bleed <= 0) this.eliminate(r, target, attacker);
      return;
    }
    if (attacker) attacker.damage += Math.min(amount, target.hp + target.shield);
    const shield = Math.min(amount, target.shield);
    target.shield -= shield;
    target.hp -= amount - shield;
    if (target.hp <= 0) {
      target.hp = 0;
      target.status = 'down';
      target.bleed = RULES.bleedSeconds;
      target.target = '';
      target.typed = '';
      target.downedBy = attacker?.id || null;
    }
  }
  eliminate(r, m, attacker = null) {
    if (m.status === 'dead') return;
    m.status = 'dead';
    m.hp = 0;
    m.rank = [...r.actors.values()].filter((a) => a.status !== 'dead').length + 1;
    m.dx = m.dy = 0;
    m.target = '';
    m.typed = '';
    const killer = attacker || r.actors.get(m.downedBy);
    if (killer && killer.team !== m.team) killer.kills++;
    if (r.loot.length < 600)
      for (let i = 0; i < 2; i++) {
        const at = this.free(r.map, m.x + (i * 2 - 1) * 26, m.y + 16);
        r.loot.push({
          id: 'drop:' + crypto.randomUUID(),
          ...at,
          ...RULES.loot[(m.wordIndex + i) % 4],
        });
      }
  }
  bot(r, m, dt) {
    if (m.status === 'bus') {
      if ((this.now() - r.start) / 1000 >= m.dropAt) this.jump(r, m);
      return;
    }
    if (!['alive', 'down', 'falling'].includes(m.status)) return;
    const now = this.now();
    m.think -= dt;
    if (m.think <= 0) {
      m.think = 0.3 + this.random() * 0.25;
      const outside = dist(m, r.zone) > r.zone.r - 140;
      let goal = null,
        aim = null;
      if (!outside && m.status === 'alive') {
        const down = [...r.actors.values()]
          .filter((o) => o !== m && o.status === 'down' && dist(m, o) < 420 && sight(r.map, m, o))
          .sort(
            (a, b) =>
              (a.team === m.team ? -500 : 0) +
              dist(m, a) -
              ((b.team === m.team ? -500 : 0) + dist(m, b)),
          )[0];
        const enemy = [...r.actors.values()]
          .filter(
            (o) =>
              o.status === 'alive' &&
              now >= (o.safeUntil || 0) &&
              now >= (m.safeUntil || 0) &&
              o.team !== m.team &&
              dist(m, o) < RULES.sight &&
              sight(r.map, m, o),
          )
          .sort((a, b) => dist(m, a) - dist(m, b))[0];
        const loot = r.loot
          .filter(
            (l) =>
              dist(m, l) < 550 &&
              (l.kind === 'heal'
                ? m.hp < 70
                : l.kind === 'shield'
                  ? m.shield < 40
                  : l.kind === 'power'
                    ? m.power < 2
                    : l.kind === 'weapon'
                      ? m.weapon !== l.item
                      : l.kind === 'outfit'
                        ? m.outfit !== l.item
                        : !m.boots),
          )
          .sort((a, b) => dist(m, a) - dist(m, b))[0];
        if (down) {
          goal = down;
          aim = { target: down.id, verb: down.team === m.team ? 'REVIVE' : 'KILL' };
        } else if (enemy) {
          goal = enemy;
          aim = { target: enemy.id, verb: '' };
        } else if (loot) {
          goal = loot;
          aim = { target: loot.id, verb: '' };
        }
      }
      if (!goal) {
        goal = outside
          ? { x: r.zone.x, y: r.zone.y }
          : {
              x: clamp(
                r.zone.toX +
                  Math.cos(m.wordIndex * 2.4 + now * 0.0001) * Math.min(1800, r.zone.r * 0.65),
                30,
                RULES.width - 30,
              ),
              y: clamp(
                r.zone.toY +
                  Math.sin(m.wordIndex * 2.4 + now * 0.0001) * Math.min(1800, r.zone.r * 0.65),
                30,
                RULES.height - 30,
              ),
            };
      }
      const distance = dist(m, goal),
        stop = aim
          ? r.actors.has(aim.target)
            ? r.actors.get(aim.target).status === 'down'
              ? 75
              : 270
            : 70
          : 35;
      m.dx = distance > stop ? (goal.x - m.x) / distance : 0;
      m.dy = distance > stop ? (goal.y - m.y) / distance : 0;
      m.aim = aim;
      if (m.dx || m.dy) {
        const probe = 60;
        if (!walkable(r.map, m.x + m.dx * probe, m.y + m.dy * probe)) {
          const angle = Math.atan2(m.dy, m.dx);
          let found = false;
          for (const turn of [0.8, -0.8, 1.5, -1.5, 2.4, -2.4, Math.PI]) {
            const dx = Math.cos(angle + turn),
              dy = Math.sin(angle + turn);
            if (walkable(r.map, m.x + dx * probe, m.y + dy * probe)) {
              m.dx = dx;
              m.dy = dy;
              found = true;
              break;
            }
          }
          if (!found) {
            m.dx = 0;
            m.dy = 0;
          }
        }
      }
    }
    m.moveAt = now;
    if (m.aim && m.status === 'alive' && now >= m.aiKeyAt) {
      const t = this.target(r, m, m.aim.target, m.aim.verb);
      if (t) {
        const signature = t.object.id + ':' + t.kind + ':' + t.word,
          index = m.target === signature ? m.typed.length : 0;
        const key = this.random() < 0.9 ? t.word[index] : 'Z';
        this.key(r, m, { seq: m.seq + 1, key, target: m.aim.target, verb: m.aim.verb }, now);
      }
      m.aiKeyAt = now + 180 + this.random() * 170;
    }
  }
  setZoneTarget(r) {
    const z = r.zone;
    z.fromX = z.x;
    z.fromY = z.y;
    z.fromR = z.r;
    z.toR = RULES.zoneRadii[Math.min(z.stage + 1, RULES.zoneRadii.length - 1)];
    const drift = (z.r - z.toR) * 0.25,
      angle = this.random() * Math.PI * 2;
    z.toX = clamp(z.x + Math.cos(angle) * drift, 350, RULES.width - 350);
    z.toY = clamp(z.y + Math.sin(angle) * drift, 350, RULES.height - 350);
  }
  tick() {
    require('./minigame_reconnect').expire(this);
    const now = this.now(),
      dt = Math.min(0.15, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.matchmake();
    for (const party of [...this.parties.values()])
      if (party.phase === 'lobby' && now - party.createdAt > 30 * 60000)
        for (const p of [...party.players.values()]) this.leave(p);
    for (const r of [...this.matches.values()]) {
      if (r.phase === 'finished') {
        if (now - r.endedAt > 120000) {
          for (const code of r.parties) {
            const party = this.parties.get(code);
            if (party)
              for (const p of [...party.players.values()]) {
                this.members.delete(p.id);
                this.snapshot(p);
              }
            this.parties.delete(code);
          }
          this.matches.delete(r.id);
        }
        continue;
      }
      const busProgress = clamp((now - r.start) / (RULES.busSeconds * 1000), 0, 1);
      r.bus.x = 100 + busProgress * (RULES.width - 200);
      if (r.phase === 'bus' && busProgress >= 1) {
        r.phase = 'battle';
        for (const m of r.actors.values()) if (m.status === 'bus') this.jump(r, m);
      }
      const z = r.zone;
      if (now >= r.battleAt) {
        const t = clamp((now - z.start) / z.duration, 0, 1);
        z.x = z.fromX + (z.toX - z.fromX) * t;
        z.y = z.fromY + (z.toY - z.fromY) * t;
        z.r = z.fromR + (z.toR - z.fromR) * t;
        if (t >= 1 && z.stage < RULES.zoneSeconds.length - 1) {
          z.stage++;
          z.start = now;
          z.duration = RULES.zoneSeconds[z.stage] * 1000;
          this.setZoneTarget(r);
        }
      }
      for (const m of r.actors.values()) {
        if (m.status === 'bus') {
          m.x = r.bus.x;
          m.y = r.bus.y;
        }
        if (m.npc) this.bot(r, m, dt);
        this.move(r, m, dt);
        if (m.status === 'falling') {
          m.fall -= dt;
          if (m.fall <= 0) {
            m.status = 'alive';
            m.safeUntil = now + RULES.landingShieldSeconds * 1000;
          }
        }
        if (m.status === 'down') {
          m.bleed -= dt;
          if (m.bleed <= 0) this.eliminate(r, m);
        }
        if (now >= r.battleAt && ['alive', 'down'].includes(m.status) && dist(m, z) > z.r)
          this.hurt(r, m, (4 + z.stage * 2) * dt);
      }
      r.events = r.events.filter((e) => now - e.at < 550).slice(-18);
      const living = [...r.actors.values()].filter((m) => m.status !== 'dead'),
        teams = new Set(living.map((m) => m.team));
      if (
        r.phase === 'battle' &&
        (teams.size === 0 || (teams.size === 1 && living.some((m) => m.status === 'alive')))
      )
        this.finish(r, teams.size ? [...teams][0] : null);
      else if (now - r.start > 10 * 60000) this.finish(r, null);
    }
    if (now - this.broadcastAt >= 100) {
      this.broadcastAt = now;
      for (const party of this.parties.values())
        if (party.phase === 'queued') this.publishParty(party);
      for (const r of this.matches.values()) this.publish(r);
    }
  }
  finish(r, team) {
    if (r.phase === 'finished') return;
    r.phase = 'finished';
    r.winner = team;
    r.endedAt = this.now();
    for (const m of r.actors.values())
      if (
        m.team === team &&
        !m.npc &&
        !m.left &&
        (m.p || m.reservedPlayer)?.seasonKey &&
        (m.damage > 0 || m.pickups > 0 || m.revives > 0)
      ) {
        const recipient = m.p || m.reservedPlayer;
        const receipts = this.pending.get(recipient.seasonKey) || [],
          id = 'br:' + r.id;
        if (!receipts.some((v) => v.id === id) && receipts.length < 64)
          receipts.push({ id, ...RULES.rewards });
        this.pending.set(recipient.seasonKey, receipts);
      }
    for (const m of r.actors.values()) if (m.reservedPlayer) this.snapshot(m.reservedPlayer);
    this.publish(r);
  }
  publicActor(m) {
    return Object.fromEntries(
      [
        'id',
        'name',
        'class',
        'npc',
        'team',
        'x',
        'y',
        'hp',
        'shield',
        'power',
        'boots',
        'status',
        'word',
        'bleed',
        'fall',
        'outfit',
        'hat',
        'face',
        'shoes',
        'accessory',
        'weapon',
        'skin',
        'kills',
        'rank',
        'dx',
        'dy',
        'safeUntil',
      ].map((k) => [k, m[k]]),
    );
  }
  view(r, m) {
    let camera = m;
    if (m.status === 'dead') {
      camera =
        [...r.actors.values()].find((a) => a.team === m.team && a.status !== 'dead') ||
        [...r.actors.values()].find((a) => a.status === 'alive') ||
        m;
    }
    const players = [...r.actors.values()]
      .filter(
        (a) =>
          a.id === m.id ||
          (a.status !== 'bus' && dist(a, camera) <= RULES.sight && sight(r.map, camera, a)),
      )
      .map((a) => this.publicActor(a));
    const squad = [...r.actors.values()]
      .filter((a) => a.team === m.team)
      .map((a) => this.publicActor(a));
    return {
      phase: r.phase,
      map: r.map,
      mode: r.mode,
      match: r.id,
      now: this.now(),
      bus: r.bus,
      busLeft: Math.max(0, RULES.busSeconds - (this.now() - r.start) / 1000),
      zone: { ...r.zone, left: Math.max(0, (r.zone.start + r.zone.duration - this.now()) / 1000) },
      players,
      squad,
      elapsedSeconds: Math.max(0, ((r.endedAt || this.now()) - r.start) / 1000),
      me: {
        ...this.publicActor(m),
        typing: require('./typing_stats').summary(
          m,
          Math.max(0, ((r.endedAt || this.now()) - r.start) / 1000),
        ),
        seq: m.seq,
        target: m.target,
        typed: m.typed,
        damage: m.damage,
        pickups: m.pickups,
        revives: m.revives,
      },
      camera: { id: camera.id, x: camera.x, y: camera.y },
      loot: r.loot.filter((l) => dist(l, camera) < RULES.sight && sight(r.map, camera, l)),
      events: r.events.filter((e) => Math.hypot(e.x - camera.x, e.y - camera.y) < RULES.sight),
      alive: [...r.actors.values()].filter((a) => a.status !== 'dead').length,
      teams: new Set([...r.actors.values()].filter((a) => a.status !== 'dead').map((a) => a.team))
        .size,
      humans: [...r.actors.values()].filter((a) => !a.npc).length,
      bots: [...r.actors.values()].filter((a) => a.npc).length,
      winner: r.winner,
    };
  }
  snapshot(p) {
    const party = this.room(p),
      r = this.matches.get(party?.match),
      m = r?.actors.get(p.id);
    let state = {};
    if (r && m) state = this.view(r, m);
    else if (party) {
      const queue = [...this.parties.values()].filter(
        (v) => v.phase === 'queued' && v.mode === party.mode,
      );
      const earliest = queue.length ? Math.min(...queue.map((v) => v.queuedAt)) : party.queuedAt;
      state = {
        phase: party.phase,
        mode: party.mode,
        code: party.code,
        host: party.host,
        players: [...party.players.values()].map((v) => ({
          id: v.id,
          name: v.name,
          class: v.class,
        })),
        queued: queue.reduce((n, v) => n + v.players.size, 0),
        left: Math.max(0, RULES.queueSeconds - (this.now() - earliest) / 1000),
      };
    }
    this.send(p, {
      type: 'battle_royale',
      event: 'state',
      state,
      receipts: this.pending.get(p.seasonKey) || [],
    });
  }
  publishParty(party) {
    for (const p of party.players.values()) this.snapshot(p);
  }
  publish(r) {
    for (const m of r.actors.values()) if (m.p && !m.left) this.snapshot(m.p);
  }
  previews(p) {
    this.send(p, {
      type: 'battle_royale',
      event: 'previews',
      matches: [...this.matches.values()]
        .filter((r) => r.phase !== 'finished')
        .slice(0, 3)
        .map((r) => ({
          game: 'br',
          map: r.map,
          phase: r.phase,
          alive: [...r.actors.values()].filter((m) => m.status !== 'dead').length,
          zone: { x: r.zone.x, y: r.zone.y, r: r.zone.r },
          players: [...r.actors.values()]
            .filter((a) => a.status !== 'dead')
            .map((a) => ({
              x: Math.round(a.x / 400) * 400,
              y: Math.round(a.y / 400) * 400,
              name: a.name,
              npc: a.npc,
            })),
        })),
    });
  }
  leave(p) {
    const party = this.room(p);
    this.members.delete(p.id);
    if (!party) return;
    party.players.delete(p.id);
    const r = this.matches.get(party.match),
      m = r?.actors.get(p.id);
    if (m)
      this.send(p, {
        type: 'battle_royale',
        event: 'state',
        state: {},
        metric_exit: {
          ...this.view(r, m),
          phase: r.phase === 'finished' ? 'finished' : 'abandoned',
        },
      });
    if (m) {
      m.left = true;
      this.eliminate(r, m);
      m.p = null;
    }
    if (!party.players.size) this.parties.delete(party.code);
    else {
      if (party.host === p.id) party.host = party.players.keys().next().value;
      this.publishParty(party);
    }
    if (r && ![...r.actors.values()].some((a) => (a.p || a.reservedPlayer) && !a.left)) {
      this.matches.delete(r.id);
      for (const code of r.parties) {
        const group = this.parties.get(code);
        if (group && !group.players.size) this.parties.delete(code);
      }
    }
  }
}
module.exports = { BattleRoyale, RULES, GEOMETRY, geometry, walkable, sight };
