'use strict';
const classes = {
    vampire_island:'Vampire',vampire_castle:'Vampire',
    banker_borough:'Banker',banker_vault:'Banker',
    civic_square:'Politician',civic_hall:'Politician',
    campus_corner:'Speedster',campus_school:'Speedster'
};
const outside = {vampire_castle:'vampire_island',banker_vault:'banker_borough',civic_hall:'civic_square',campus_school:'campus_corner'};
const family = zone => outside[zone] || zone;
const allowed = (zone,cls) => !classes[zone] || classes[zone] === cls;
const hears = (channel,from,to) => channel === 'global' || (channel === 'region' && family(from) === family(to));
const pvpAllowed = zone => !classes[zone] && zone !== 'forest_raid';
module.exports = {classes,family,allowed,hears,pvpAllowed};
