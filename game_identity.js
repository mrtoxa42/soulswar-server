'use strict';
const Equipment = require('./equipment_rules');
function classProfile(account, cls) {
  if (!account?.profile) return null;
  return (
    account.profile.roster?.classes?.[cls] ||
    (account.profile.character.class === cls ? account.profile : null)
  );
}
function bind(player, account, cls) {
  const saved = classProfile(account, cls);
  player.accountId = account.id;
  player.accountClass = cls;
  player.savedProfile = saved;
  player.name = account.display_name;
  normalize(player);
}
function normalize(player) {
  if (!player.accountId) return;
  const saved = player.savedProfile;
  player.class = player.accountClass;
  player.level = saved?.progress?.level || 1;
  for (const [field] of Object.entries(Equipment.fields))
    player[field] = saved?.equipped?.[field] || 'none';
  // Catalog validity alone is not proof of ownership.
  const owned = new Set([
    ...(saved?.owned?.items || []),
    ...(saved?.owned?.vehicles || []),
    'none',
  ]);
  for (const field of Object.keys(Equipment.fields))
    if (!owned.has(player[field])) player[field] = 'none';
  Equipment.normalize(player);
}
function reconnectKey(player) {
  return player.accountId
    ? 'account:' + player.accountId + ':' + player.class
    : player.seasonKey
      ? 'guest:' + player.seasonKey
      : '';
}
module.exports = { bind, normalize, classProfile, reconnectKey };
