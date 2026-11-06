'use strict';
// The standalone server image keeps a deployment copy of the game's canonical rules.
const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '../scripts/data/street_groups.json');
const target = path.join(__dirname, 'street_groups.json');
if (fs.existsSync(source)) fs.copyFileSync(source, target);
if (!fs.existsSync(target)) throw new Error('Missing street_groups.json deployment copy');
const pvpSource = path.join(__dirname,'../scripts/data/pvp_rules.json');
if (fs.existsSync(pvpSource)) fs.copyFileSync(pvpSource,path.join(__dirname,'pvp_rules.json'));
if (!fs.existsSync(path.join(__dirname,'pvp_rules.json'))) throw new Error('Missing pvp_rules.json deployment copy');

const equipmentSource = require('path').join(__dirname, '../scripts/data/equipment.json');
if (require('fs').existsSync(equipmentSource)) require('fs').copyFileSync(equipmentSource, require('path').join(__dirname, 'equipment.json'));
if (!fs.existsSync(path.join(__dirname, 'equipment.json'))) throw new Error('Missing equipment.json deployment copy');
const expeditionSource = path.join(__dirname,'../scripts/data/forest_expedition.json');
if (fs.existsSync(expeditionSource)) fs.copyFileSync(expeditionSource,path.join(__dirname,'forest_expedition.json'));
if (!fs.existsSync(path.join(__dirname,'forest_expedition.json'))) throw new Error('Missing forest_expedition.json deployment copy');
const duelSource=path.join(__dirname,'../scripts/data/duel_balance.json');
if(fs.existsSync(duelSource))fs.copyFileSync(duelSource,path.join(__dirname,'duel_balance.json'));
if(!fs.existsSync(path.join(__dirname,'duel_balance.json')))throw new Error('Missing duel_balance.json deployment copy');
const typingSource=path.join(__dirname,'../scripts/data/typing_events.json');
if(fs.existsSync(typingSource))fs.copyFileSync(typingSource,path.join(__dirname,'typing_events.json'));
if(!fs.existsSync(path.join(__dirname,'typing_events.json')))throw new Error('Missing typing_events.json deployment copy');
const towerSource=path.join(__dirname,'../scripts/data/tower_defense.json');
if(fs.existsSync(towerSource))fs.copyFileSync(towerSource,path.join(__dirname,'tower_defense.json'));
if(!fs.existsSync(path.join(__dirname,'tower_defense.json')))throw new Error('Missing tower_defense.json deployment copy');
const royaleSource=path.join(__dirname,'../scripts/data/battle_royale.json');
if(fs.existsSync(royaleSource))fs.copyFileSync(royaleSource,path.join(__dirname,'battle_royale.json'));
if(!fs.existsSync(path.join(__dirname,'battle_royale.json')))throw new Error('Missing battle_royale.json deployment copy');
const racingSource=path.join(__dirname,'../scripts/data/notebook_racing.json');
if(fs.existsSync(racingSource))fs.copyFileSync(racingSource,path.join(__dirname,'notebook_racing.json'));
if(!fs.existsSync(path.join(__dirname,'notebook_racing.json')))throw new Error('Missing notebook_racing.json deployment copy');

const profileSource=path.join(__dirname,"../scripts/data/profile_contract.json");
if(fs.existsSync(profileSource))fs.copyFileSync(profileSource,path.join(__dirname,"profile_contract.json"));
if(!fs.existsSync(path.join(__dirname,"profile_contract.json")))throw new Error("Missing profile_contract.json deployment copy");

const shopSource=path.join(__dirname,"../scripts/data/shop_catalog.json");
if(fs.existsSync(shopSource))fs.copyFileSync(shopSource,path.join(__dirname,"shop_catalog.json"));
if(!fs.existsSync(path.join(__dirname,"shop_catalog.json")))throw new Error("Missing shop_catalog.json deployment copy");

const raidSource=path.join(__dirname,'../scripts/data/city_raids.json');
if(fs.existsSync(raidSource))fs.copyFileSync(raidSource,path.join(__dirname,'city_raids.json'));
if(!fs.existsSync(path.join(__dirname,'city_raids.json')))throw new Error('Missing city_raids.json deployment copy');
