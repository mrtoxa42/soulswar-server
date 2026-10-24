'use strict';

const groups = require('./street_groups.json');
const pvp = require('./pvp_rules.json');

function citySafe(player) {
    if ((player.zone || 'city') !== 'city') return false;
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) return true;
    const [left,top,right,bottom] = pvp.city_safe_rect;
    return (player.x >= left && player.x <= right && player.y >= top && player.y <= bottom) ||
        pvp.city_safe_discs.some(c => Math.hypot(player.x-c.at[0],player.y-c.at[1]) <= c.radius);
}

function allied(first, second) {
    return ['Banker','Vampire','Speedster','Politician'].includes(first.class) && first.class === second.class;
}

function protectionReason(first, second) {
    if (citySafe(first) || citySafe(second)) return 'safe_zone';
    if (allied(first,second)) return 'same_class';
    return '';
}

function streetGroup(level) {
    if (!Number.isInteger(level) || level < 1) return 0;
    const group = groups.find(g => level >= g.min && (g.max === 0 || level <= g.max));
    return group ? group.id : 0;
}

function canDuel(first, second) {
    const group = streetGroup(first);
    return group !== 0 && group === streetGroup(second);
}

function pairKey(first, second) {
    return [first, second].sort().join(':');
}

module.exports = { streetGroup, canDuel, pairKey, citySafe, allied, protectionReason };
