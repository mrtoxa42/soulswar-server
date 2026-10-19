'use strict';
const catalog = require('./equipment.json');
const fields = {weapon: 'weapons', outfit: 'outfits', shoes: 'shoes', face: 'faces', hat: 'hats', accessory: 'accessories', vehicle: 'vehicles'};
function valid(category, id, cls, level) {
    if (id === 'none') return Object.values(fields).includes(category);
    const item = catalog.items[id];
    return !!item && item.category === category && item.classes.includes(cls) && level >= item.min_level;
}
function normalize(player) {
    if (!catalog.classes[player.class]) player.class = 'Banker';
    if (catalog.items[player.accessory]?.category === 'weapons') {
        if (!player.weapon || player.weapon === 'none') player.weapon = player.accessory;
        player.accessory = 'none';
    }
    for (const [field, category] of Object.entries(fields)) {
        if (!valid(category, player[field], player.class, player.level)) player[field] = 'none';
    }
    player.gear_stats = stats(player);
    return player;
}
function stats(player) {
    const result = Object.fromEntries(Object.keys(catalog.caps).map(key => [key, 0]));
    for (const [field, category] of Object.entries(fields)) {
        if (player[field] !== 'none' && valid(category, player[field], player.class, player.level)) {
            for (const [key, value] of Object.entries(catalog.items[player[field]].stats)) result[key] += value;
        }
    }
    for (const key of Object.keys(result)) result[key] = Math.min(catalog.caps[key], Math.max(0, result[key]));
    return result;
}
function combatPush(player, rival, length, completed, boost = 1) {
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    const classPower = {Banker: 1, Vampire: 1.25, Speedster: 1, Politician: 1.15}[player.class] || 1;
    const ratio = clamp((player.level + 20) / (rival.level + 20), .55, 1.60);
    const power = clamp(classPower * clamp(boost, 1, 1.85) * ratio, .5, 1.85);
    const gear = (1 + stats(player).attack) * (1 - stats(rival).defense);
    const push = (clamp(.17 / Math.max(6, length) * power, .008, .028) + (completed ? clamp(.13 * power, .07, .18) : 0)) * gear;
    return Math.round(push * 1000) / 1000;
}
module.exports = {catalog, fields, valid, normalize, stats, combatPush};
