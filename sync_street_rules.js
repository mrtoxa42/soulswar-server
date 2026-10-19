'use strict';
// The standalone server image keeps a deployment copy of the game's canonical rules.
const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '../scripts/data/street_groups.json');
const target = path.join(__dirname, 'street_groups.json');
if (fs.existsSync(source)) fs.copyFileSync(source, target);
if (!fs.existsSync(target)) throw new Error('Missing street_groups.json deployment copy');

const equipmentSource = require('path').join(__dirname, '../scripts/data/equipment.json');
if (require('fs').existsSync(equipmentSource)) require('fs').copyFileSync(equipmentSource, require('path').join(__dirname, 'equipment.json'));
if (!fs.existsSync(path.join(__dirname, 'equipment.json'))) throw new Error('Missing equipment.json deployment copy');
const expeditionSource = path.join(__dirname,'../scripts/data/forest_expedition.json');
if (fs.existsSync(expeditionSource)) fs.copyFileSync(expeditionSource,path.join(__dirname,'forest_expedition.json'));
if (!fs.existsSync(path.join(__dirname,'forest_expedition.json'))) throw new Error('Missing forest_expedition.json deployment copy');
