'use strict';
const { reconnectKey } = require('./game_identity');
const GRACE_MS = 60000;
function disconnect(game, player, kind) {
  const key = reconnectKey(player),
    room = game.room(player);
  const match = kind === 'br' ? game.matches.get(room?.match) : room;
  const actor = kind === 'br' ? match?.actors.get(player.id) : match?.racers.get(player.id);
  if (
    !key ||
    !actor ||
    !['bus', 'battle', 'countdown', 'racing', 'finished'].includes(match.phase)
  ) {
    game.leave(player);
    return;
  }
  game.reserved ||= new Map();
  actor.connectionUntil = game.now() + GRACE_MS;
  actor.reservedPlayer = player;
  actor.p = null;
  actor.dx = 0;
  actor.dy = 0;
  actor.speed = 0;
  game.reserved.set(key, { actor, room, match, kind });
}
function reconnect(game, player) {
  const key = reconnectKey(player),
    slot = game.reserved?.get(key);
  if (!slot || slot.actor.connectionUntil <= game.now()) return false;
  const { actor, room, match, kind } = slot,
    old = actor.id;
  if (kind === 'br') {
    room.players.delete(old);
    room.players.set(player.id, player);
    match.actors.delete(old);
    match.actors.set(player.id, actor);
    for (const other of match.actors.values())
      if (typeof other.target === 'string' && other.target.startsWith(old + ':'))
        other.target = other.target.replace(old, player.id);
  } else {
    room.racers.delete(old);
    room.racers.set(player.id, actor);
    room.finishers = room.finishers.map((id) => (id === old ? player.id : id));
  }
  if (room.host === old) room.host = player.id;
  game.members.delete(old);
  game.members.set(player.id, room.code);
  actor.id = player.id;
  actor.p = player;
  actor.connectionUntil = 0;
  actor.reservedPlayer = null;
  game.reserved.delete(key);
  game.snapshot(player);
  return true;
}
function expire(game) {
  for (const [key, slot] of game.reserved || []) {
    const active =
      slot.kind === 'br' ? game.matches.has(slot.match.id) : game.rooms.has(slot.room.code);
    if (!active || slot.actor.connectionUntil <= game.now()) {
      game.reserved.delete(key);
      if (active) game.leave(slot.actor.reservedPlayer);
      slot.actor.reservedPlayer = null;
    }
  }
}
module.exports = { disconnect, reconnect, expire, GRACE_MS };
