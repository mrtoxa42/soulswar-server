'use strict';

const groups = require('./street_groups.json');

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

module.exports = { streetGroup, canDuel, pairKey };
