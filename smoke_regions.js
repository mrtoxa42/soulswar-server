'use strict';
// Temporary test players only; no combat, rewards or persistent profiles.
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const Regions = require('./region_rules');
const url = process.argv[2] || 'ws://127.0.0.1:18215';
const peers = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function check(ok, label) { assert.ok(ok, label); checks++; }
async function wait(predicate) {
    for (let i = 0; i < 400; i++) {
        const value = predicate();
        if (value) return value;
        await delay(20);
    }
    throw new Error('Timed out waiting for region protocol');
}
async function connect(name, level, cls) {
    const ws = new WebSocket(url, {handshakeTimeout: 70000});
    const peer = {ws, name, level, cls, messages: []};
    peers.push(peer);
    ws.on('message', data => peer.messages.push(JSON.parse(data)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    return peer;
}
async function join(peer, zone, revision) {
    peer.messages.length = 0;
    peer.ws.send(JSON.stringify({type:'join',zone,join_revision:revision,name:peer.name,class:peer.cls,level:peer.level,x:3000,y:3500}));
    const welcome = await wait(() => peer.messages.find(m => m.type === 'welcome' && m.join_revision === revision));
    check(welcome.zone === zone && welcome.protocol === 2 && welcome.server_version === '0.6.8', `${zone}: current protocol acknowledged`);
    return welcome;
}
(async () => {
    try {
        for (const [outside, inside] of [['banker_borough','banker_vault'],['vampire_island','vampire_castle'],['campus_corner','campus_school'],['civic_square','civic_hall']]) {
            const a = await connect('RegionCheckA',1,Regions.classes[outside]);
            const b = await connect('RegionCheckB',3,Regions.classes[outside]);
            for (const [index, zone] of [outside,inside].entries()) {
                const wa = await join(a,zone,index+1);
                const wb = await join(b,zone,index+1);
                check(wb.players.some(p => p.id === wa.id), `${zone}: players at different levels share the class area`);
                await wait(() => a.messages.some(m => m.type === 'player_joined' && m.id === wb.id));
                check(true, `${zone}: both directions receive peer presence`);
                a.ws.send(JSON.stringify({type:'pos',x:3100,y:3520,vx:0,vy:0,anim:'idle',flip:false}));
                await wait(() => b.messages.some(m => m.type === 'state' && m.players.some(p => p.id === wa.id && p.x === 3100)));
                check(true, `${zone}: movement broadcast`);
                const message = `region-check-${index}`;
                a.ws.send(JSON.stringify({type:'chat',channel:'region',msg:message}));
                await wait(() => b.messages.some(m => m.type === 'chat' && m.channel === 'region' && m.msg === message));
                check(true, `${zone}: region chat delivered`);
            }
            console.log(`PASS: ${outside} and ${inside}`);
            a.ws.close(); b.ws.close();
        }
        console.log(`REGION SMOKE: ${checks} checks; 0 failures`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        for (const peer of peers) peer.ws.terminate();
    }
})();
