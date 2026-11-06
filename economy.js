'use strict';
const crypto = require('node:crypto');
const equipment = require('./equipment_rules');
const catalog = require('./equipment.json');
const shop = require('./shop_catalog.json');
function fail(code) {
  const error = Error(code);
  error.economyReason = code;
  throw error;
}
function fingerprint(input) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([input.class, input.action, input.category, input.item]))
    .digest('hex');
}
function purchase(profile, input) {
  const result = structuredClone(profile);
  const cls = input.class;
  const active = result.roster?.classes?.[cls] || (result.character.class === cls ? result : null);
  if (!active) fail('class_not_saved');
  const owned = (active.owned ||= { items: [], vehicles: [], skins: [] });
  owned.items ||= [];
  owned.vehicles ||= [];
  owned.skins ||= [];
  active.equipped ||= {};
  active.presets ||= {};
  const field = Object.keys(equipment.fields).find(
    (key) => equipment.fields[key] === input.category,
  );
  const supplyIndex = shop.supplies.findIndex((item) => item.id === input.item);
  let cost = 0;
  if (input.action === 'supply') {
    if (supplyIndex < 0) fail('unknown_item');
    cost = shop.supplies[supplyIndex].price;
  } else {
    if (!field || !equipment.valid(input.category, input.item, cls, active.progress.level))
      fail('item_not_available');
    const list = input.category === 'vehicles' ? owned.vehicles : owned.items;
    const isOwned = input.item === 'none' || list.includes(input.item);
    if (input.action === 'equip' && !isOwned) fail('item_not_owned');
    if (input.action === 'buy' && !isOwned) {
      if (
        (catalog.items[input.item]?.source || 'shop') !== 'shop' ||
        !Object.hasOwn(shop.prices, input.item)
      )
        fail('item_not_for_sale');
      cost = shop.prices[input.item];
    } else if (!['buy', 'equip'].includes(input.action)) fail('invalid_action');
  }
  const loadout = { class: cls, level: active.progress.level, ...active.equipped };
  for (const key of Object.keys(equipment.fields))
    if (![...owned.items, ...owned.vehicles, 'none'].includes(loadout[key])) loadout[key] = 'none';
  equipment.normalize(loadout);
  const choices = active.growth?.classes?.[cls] || [];
  const growth = Math.min(
    0.15,
    choices
      .slice(0, Math.max(0, active.progress.level - 1))
      .reduce((n, id) => n + (shop.growth_bargain[id] || 0), 0),
  );
  cost = Math.max(
    0,
    Math.ceil(cost * (1 - Math.min(0.5, (loadout.gear_stats.bargain || 0) + growth)) - 0.000001),
  );
  if (active.coins < cost) fail('not_enough_coins');
  active.coins -= cost;
  if (input.action === 'supply') {
    active.consumables ||= [];
    while (active.consumables.length < shop.supplies.length) active.consumables.push(0);
    if (active.consumables[supplyIndex] >= 9999) fail('supply_limit');
    active.consumables[supplyIndex]++;
    active.hotbar_order ||= [];
    if (!active.hotbar_order.includes(input.item)) {
      const empty = active.hotbar_order.findIndex((id) => {
        const index = shop.supplies.findIndex((item) => item.id === id);
        return index < 0 || !active.consumables[index];
      });
      if (empty < 0) active.hotbar_order.push(input.item);
      else active.hotbar_order[empty] = input.item;
    }
  } else {
    const list = input.category === 'vehicles' ? owned.vehicles : owned.items;
    if (input.item !== 'none' && !list.includes(input.item)) list.push(input.item);
    active.equipped[field] = input.item;
    active.presets[cls] ||= {};
    active.presets[cls][field] = input.item;
  }
  if (result.roster) {
    result.roster.classes[cls] = structuredClone(active);
    if (result.character.class === cls) {
      for (const [key, value] of Object.entries(active)) result[key] = structuredClone(value);
    }
  }
  return { profile: result, cost };
}
function validOwnershipTransition(before, after) {
  const base = new Set([
    ...(before?.owned?.items || []),
    ...(before?.owned?.vehicles || []),
    'suit',
    'gothic_coat',
    'hoodie',
    'politician_suit',
    'skateboard',
    'none',
  ]);
  return [...(after.owned?.items || []), ...(after.owned?.vehicles || [])].every(
    (id) => base.has(id) || (catalog.items[id]?.source || 'shop') !== 'shop',
  );
}
module.exports = { purchase, fingerprint, validOwnershipTransition };
