'use strict';
const Equipment = require('./equipment_rules');
function level(player, rival) {
  return !player.npc && !rival.npc && !player.accountId ? 1 : player.level;
}
function guestActor(player, rival) {
  if (player.npc || rival.npc || player.accountId) return player;
  const max = 100 + ({ Banker: 20, Politician: 15 }[player.class] || 0);
  const actor = {
    ...player,
    level: 1,
    max_soul: max,
    soul: max * Math.max(0, Math.min(1, player.soul / Math.max(1, player.max_soul))),
  };
  for (const field of Object.keys(Equipment.fields)) actor[field] = 'none';
  actor.guestPower = true;
  return actor;
}
module.exports = { level, guestActor };
