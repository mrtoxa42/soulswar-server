const WebSocket = require('ws');
const geoip = require('geoip-lite');
const crypto = require('crypto');
const { canDuel, pairKey } = require('./duel_rules');
const Equipment = require('./equipment_rules');
const Regions = require('./region_rules');
const {Expeditions, WORLD:EXPEDITION_WORLD, RAID:EXPEDITION_RAID} = require('./expedition_rules');
const expeditions = new Expeditions((player,message) => {if(player.ws.readyState===WebSocket.OPEN)player.ws.send(JSON.stringify(message));});
const expeditionTimer = setInterval(()=>expeditions.tick(),100);
expeditionTimer.unref();

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

console.log(`WebSocket server starting on port ${PORT}`);

// Configuration
const ROOM_MAX_PLAYERS = 30;
const TARGET_ENTITIES = 25;
const MIN_BOTS = 5;
const STALE_TIMEOUT = 30000;
const TICK_RATE = 100; // 10Hz
const MAX_USERNAME_LENGTH = 18;
const MAX_CHAT_LENGTH = 64;
const CHAT_WINDOW_MS = 10000;
const MAX_CHAT_MESSAGES_PER_WINDOW = 4;
const INTERNAL_MESSAGE_PREFIX = '__SYS__:';
const BLOCKED_TERMS = [
    'amk', 'aq', 'sik', 'siker', 'siktir', 'sikik', 'orospu', 'orospucocu',
    'ibne', 'pic', 'piç', 'yarrak', 'gavat', 'kahpe', 'pezevenk',
    'fuck', 'fucker', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'pussy',
    'nigger', 'faggot', 'retard', 'kys'
];

const rooms = new Map();

function rejectDuel(player, reason) {
    if (player && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify({ type: 'duel_rejected', reason }));
    }
}

function cancelPlayerDuels(room, playerId, reason, onlyIncompatible = false) {
    for (const [key, duel] of room.duels) {
        if (duel.first !== playerId && duel.second !== playerId) continue;
        const first = room.players.get(duel.first);
        const second = room.players.get(duel.second);
        if (onlyIncompatible && first && second && canDuel(first.level, second.level)) continue;
        room.duels.delete(key);
        rejectDuel(first, reason);
        rejectDuel(second, reason);
    }
}

function updatePlayerInfo(room, player, data) {
    if (Number.isInteger(data.level) && data.level >= 1 && data.level <= 100000) {
        player.level = data.level;
    }
    data.level = player.level;
    for (const field of ['outfit', 'vehicle', 'hat', 'face', 'shoes', 'accessory', 'skin', 'weapon']) {
        if (typeof data[field] === 'string') player[field] = data[field];
    }
    Equipment.normalize(player);
    data.class = player.class;
    for (const field of Object.keys(Equipment.fields)) data[field] = player[field];
    data.gear_stats = player.gear_stats;
    cancelPlayerDuels(room, player.id, 'street_group_changed', true);
}

function validateSystemEvent(room, player, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    if (payload.ev === 'update_info') updatePlayerInfo(room, player, payload);
    if (payload.ev === 'player_dead') {
        player.dead = true;
        cancelPlayerDuels(room, player.id, 'opponent_died');
    }
    if (payload.ev === 'player_respawn' || payload.ev === 'player_revive') player.dead = false;
    if (!String(payload.ev).startsWith('pvp_')) return true;
	if (!Regions.pvpAllowed(player.zone) && player.zone !== EXPEDITION_RAID) {rejectDuel(player,'class_region_is_pve');return false;}
    if ([EXPEDITION_WORLD,EXPEDITION_RAID].includes(player.zone)) {rejectDuel(player,'use_expedition_combat');return false;}
    const rival = room.players.get(payload.target_id);
    if (!rival || rival.id === player.id) {
        rejectDuel(player, 'opponent_unavailable');
        return false;
    }
    const key = pairKey(player.id, rival.id);
    if (!canDuel(player.level, rival.level)) {
        cancelPlayerDuels(room, player.id, 'different_street_group', true);
        rejectDuel(player, 'different_street_group');
        return false;
    }
    if (player.dead || rival.dead) {
        rejectDuel(player, 'opponent_unavailable');
        return false;
    }
    if (payload.ev === 'pvp_incoming') {
        const busy = [...room.duels.values()].some(d => [d.first, d.second].includes(player.id) || [d.first, d.second].includes(rival.id));
        if (busy) {
            rejectDuel(player, 'opponent_in_combat');
            return false;
        }
        room.duels.set(key, { first: player.id, second: rival.id, phase: 'pending', ratio: 0.5 });
        return true;
    }
    const duel = room.duels.get(key);
    if (!duel) return false;
    if (payload.ev === 'pvp_engage') {
        if (duel.phase !== 'pending' || player.id !== duel.second) return false;
        duel.phase = 'active';
        return true;
    }
    if (payload.ev === 'pvp_push') {
        if (duel.phase !== 'active') return false;
        if (Number.isInteger(payload.word_length) && payload.word_length >= 6 && payload.word_length <= 64 && typeof payload.completed === 'boolean') {
            const boost = Number.isFinite(payload.beam_boost) ? payload.beam_boost : 1;
            payload.push = Equipment.combatPush(player, rival, payload.word_length, payload.completed, boost);
            duel.ratio = Math.max(0, Math.min(1, duel.ratio + (player.id === duel.first ? payload.push : -payload.push)));
            payload.ratio = player.id === duel.first ? duel.ratio : 1 - duel.ratio;
            return true;
        }
        // Older clients remain compatible within the bounded pre-equipment push range.
        if (!Number.isFinite(payload.push) || payload.push < 0 || payload.push > 0.208) return false;
        duel.ratio = Math.max(0, Math.min(1, duel.ratio + (player.id === duel.first ? payload.push : -payload.push)));
        payload.ratio = player.id === duel.first ? duel.ratio : 1 - duel.ratio;
        return true;
    }
    if (payload.ev === 'pvp_dodged' || payload.ev === 'pvp_cancel' || payload.ev === 'pvp_finish') {
        if (payload.ev === 'pvp_dodged' && duel.phase !== 'pending') return false;
        if (payload.ev === 'pvp_finish' && duel.phase !== 'active') return false;
        room.duels.delete(key);
        return true;
    }
    return false;
}

function cleanText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/[\[\]]/g, '')
        .trim()
        .slice(0, maxLength);
}

function normalizeForModeration(value) {
    return value
        .toLocaleLowerCase('tr-TR')
        .replace(/[@4]/g, 'a')
        .replace(/0/g, 'o')
        .replace(/[1!]/g, 'i')
        .replace(/\$/g, 's')
        .replace(/[^a-zçğıöşü]/g, '')
        .replace(/(.)\1+/g, '$1');
}

function containsBlockedTerm(value) {
    const normalized = normalizeForModeration(value);
    return BLOCKED_TERMS.some((term) => normalized.includes(term));
}

function safeUsername(value) {
    const cleaned = cleanText(value, MAX_USERNAME_LENGTH);
    return cleaned && !containsBlockedTerm(cleaned) ? cleaned : 'ShadowTyper';
}

function sendChatError(ws, reason) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat_error', reason }));
    }
}

const WORLD_ZONES = new Set(['city','ink_forest','simulation','medieval','dustlands','orbit','underworld','archive','forest_hut']);
WORLD_ZONES.add(EXPEDITION_WORLD); WORLD_ZONES.add(EXPEDITION_RAID);
for (const zone of Object.keys(Regions.classes)) WORLD_ZONES.add(zone);

function getOrCreateRoom(zone = 'city', instance = '') {
    for (const [roomId, room] of rooms.entries()) {
        if (room.zone === zone && room.instance === instance && room.players.size < (zone===EXPEDITION_RAID?4:ROOM_MAX_PLAYERS)) {
            return room;
        }
    }
    const newRoomId = crypto.randomUUID();
    const newRoom = {
        id: newRoomId,
        zone,
        instance,
        players: new Map(),
        duels: new Map(),
        botCount: Regions.classes[zone] || [EXPEDITION_WORLD,EXPEDITION_RAID].includes(zone) ? 0 : TARGET_ENTITIES,
        interval: null
    };
    rooms.set(newRoomId, newRoom);
    
    // Start tick loop for this room
    newRoom.interval = setInterval(() => tickRoom(newRoom), TICK_RATE);
    return newRoom;
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
}

function getCountry(ip) {
    // Localhost fallback
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return 'US';
    const geo = geoip.lookup(ip);
    return geo ? geo.country : 'US';
}

function calculateBotCount(playerCount) {
    return Math.max(MIN_BOTS, TARGET_ENTITIES - playerCount);
}

function broadcast(room, message, excludeId = null) {
    const data = JSON.stringify({...message, zone: room.zone});
    for (const [id, player] of room.players.entries()) {
        if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(data);
        }
    }
}

function tickRoom(room) {
    const now = Date.now();
    const stateUpdate = [];
    const staleIds = [];

    for (const [id, player] of room.players.entries()) {
        if (now - player.lastUpdate > STALE_TIMEOUT) {
            staleIds.push(id);
        } else {
            stateUpdate.push({
                id: id,
                x: player.x,
                y: player.y,
                vx: player.vx,
                vy: player.vy,
                anim: player.anim,
                flip: player.flip
            });
        }
    }

    // Handle stale players
    for (const id of staleIds) {
        const p = room.players.get(id);
        if (p.ws.readyState === WebSocket.OPEN) p.ws.close();
        handleDisconnect(room, id, true);
    }

    if (stateUpdate.length > 0) {
        broadcast(room, { type: 'state', zone: room.zone, players: stateUpdate });
    }

    // Update bot count if needed
    const currentBotCount = Regions.classes[room.zone] || [EXPEDITION_WORLD,EXPEDITION_RAID].includes(room.zone) ? 0 : calculateBotCount(room.players.size);
    if (currentBotCount !== room.botCount) {
        room.botCount = currentBotCount;
        broadcast(room, { type: 'bot_count', count: currentBotCount });
    }
    
    // Cleanup empty room
    if (room.players.size === 0) {
        clearInterval(room.interval);
        rooms.delete(room.id);
        console.log(`Room ${room.id} deleted (empty)`);
    }
}

function handleDisconnect(room, playerId, disconnect = false) {
    if (room.players.has(playerId)) {
        cancelPlayerDuels(room, playerId, 'opponent_disconnected');
        expeditions.leave(room.players.get(playerId),disconnect);
        room.players.delete(playerId);
        console.log(`Player ${playerId} left room ${room.id}`);
        broadcast(room, { type: 'player_left', id: playerId });
    }
}

wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);
    const country = getCountry(ip);
    const playerId = crypto.randomUUID();
    let playerRoom = null;

    console.log(`New connection from ${ip} (${country}), assigned ID: ${playerId}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const now = Date.now();

            if (data.type === 'join') {
                const zone = data.zone === undefined ? 'city' : data.zone;
                if (!WORLD_ZONES.has(zone)) { ws.send(JSON.stringify({type:'join_error',reason:'unknown_zone'})); return; }
                if (!Regions.allowed(zone,data.class)) { ws.send(JSON.stringify({type:'join_error',reason:'class_restricted'})); return; }
                if(zone===EXPEDITION_RAID&&!expeditions.authorize(playerId,data.expedition_ticket)){ws.send(JSON.stringify({type:'expedition',event:'error',reason:'raid_ticket_required'}));return;}
                if (playerRoom) handleDisconnect(playerRoom, playerId);
                playerRoom = getOrCreateRoom(zone,zone===EXPEDITION_RAID?data.expedition_ticket:'');
                const newPlayer = {
                    ws: ws,
                    id: playerId,
                    zone,
                    name: safeUsername(data.name),
                    class: data.class,
                    level: Number.isInteger(data.level) && data.level >= 1 && data.level <= 100000 ? data.level : 1,
                    dead: false,
                    country: country,
                    outfit: data.outfit,
                    vehicle: data.vehicle,
                    hat: data.hat,
                    face: data.face,
                    shoes: data.shoes,
                    accessory: data.accessory,
                    weapon: data.weapon,
                    skin: data.skin,
                    x: Number.isFinite(data.x) ? data.x : 0,
                    y: Number.isFinite(data.y) ? data.y : 0,
                    vx: 0,
                    vy: 0,
                    anim: 'idle',
                    flip: false,
                    lastUpdate: now,
                    chatTimestamps: []
                };

                Equipment.normalize(newPlayer);
                playerRoom.players.set(playerId, newPlayer);
                expeditions.join(newPlayer,playerRoom);
                console.log(`Player ${playerId} joined room ${playerRoom.id}`);

                // Send welcome to the new player
                const otherPlayers = [];
                for (const [id, p] of playerRoom.players.entries()) {
                    if (id !== playerId) {
                        otherPlayers.push({
                            id: id,
                            zone: p.zone,
                            name: p.name,
                            class: p.class,
                            level: p.level,
                            country: p.country,
                            x: p.x,
                            y: p.y,
                            outfit: p.outfit,
                            vehicle: p.vehicle,
                            hat: p.hat,
                            face: p.face,
                            shoes: p.shoes,
                            accessory: p.accessory,
                            weapon: p.weapon,
                            gear_stats: p.gear_stats,
                            skin: p.skin
                        });
                    }
                }

                ws.send(JSON.stringify({
                    type: 'welcome',
                    protocol: 2,
                    server_version: '0.6.5',
                    join_revision: data.join_revision,
                    zone,
                    id: playerId,
                    country: country,
                    players: otherPlayers,
                    serverTime: Date.now(),
                    botCount: playerRoom.botCount
                }));

                // Broadcast player_joined to others
                broadcast(playerRoom, {
                    type: 'player_joined',
                    id: playerId,
                    zone,
                    name: newPlayer.name,
                    class: newPlayer.class,
                    level: newPlayer.level,
                    country: country,
                    x: newPlayer.x,
                    y: newPlayer.y,
                    outfit: newPlayer.outfit,
                    vehicle: newPlayer.vehicle,
                    hat: newPlayer.hat,
                    face: newPlayer.face,
                    shoes: newPlayer.shoes,
                    accessory: newPlayer.accessory,
                    weapon: newPlayer.weapon,
                    gear_stats: newPlayer.gear_stats,
                    skin: newPlayer.skin
                }, playerId);

            } else if (playerRoom && playerRoom.players.has(playerId)) {
                const p = playerRoom.players.get(playerId);
                p.lastUpdate = now;

                if (data.type === 'expedition') {
                    if([EXPEDITION_WORLD,EXPEDITION_RAID].includes(p.zone)) expeditions.action(p,data);
                } else if (data.type === 'pos') {
                    if([EXPEDITION_WORLD,EXPEDITION_RAID].includes(p.zone)) {
                        const width=p.zone===EXPEDITION_RAID?5800:6000,height=p.zone===EXPEDITION_RAID?2200:4800;
                        if(!Number.isFinite(data.x)||!Number.isFinite(data.y)||data.x<150||data.y<200||data.x>width-100||data.y>height-100) return;
                        const stage=expeditions.state(p)?.stage||0;
                        if(p.zone===EXPEDITION_RAID&&((stage===0&&data.x>1850)||(stage===1&&data.x>3850)))return;
                    }
                    p.x = data.x;
                    p.y = data.y;
                    p.vx = data.vx;
                    p.vy = data.vy;
                    p.anim = data.anim;
                    p.flip = data.flip;
                } else if (data.type === 'chat') {
					// Internal state messages are not displayed as chat by clients.
					// All human-written messages are validated and rate limited here,
					// not just in the client, so modified clients cannot bypass it.
					if (typeof data.msg !== 'string') {
						sendChatError(ws, 'invalid_message');
						return;
					}
					if (data.msg.startsWith(INTERNAL_MESSAGE_PREFIX)) {
						if (data.msg.length > 4096) return;
						const payload = JSON.parse(data.msg.slice(INTERNAL_MESSAGE_PREFIX.length));
						if (!validateSystemEvent(playerRoom, p, payload)) return;
						broadcast(playerRoom, {
							type: 'chat', id: playerId, name: p.name,
							class: p.class, msg: INTERNAL_MESSAGE_PREFIX + JSON.stringify(payload), country: p.country
						});
						return;
					}
					const messageText = cleanText(data.msg, MAX_CHAT_LENGTH);
					const channel = data.channel === undefined ? 'global' : data.channel;
					if (!['global','region','team'].includes(channel) || (channel==='team'&&!expeditions.account(p.id).party)) {
						sendChatError(ws,channel === 'team' ? 'team_unavailable' : 'invalid_channel');
						return;
					}
					if (!messageText || containsBlockedTerm(messageText)) {
						sendChatError(ws, 'blocked_content');
						return;
					}
					p.chatTimestamps = p.chatTimestamps.filter((timestamp) => now - timestamp < CHAT_WINDOW_MS);
					if (p.chatTimestamps.length >= MAX_CHAT_MESSAGES_PER_WINDOW) {
						sendChatError(ws, 'rate_limited');
						return;
					}
					p.chatTimestamps.push(now);
                    const chatMessage = {
                        type: 'chat',
                        channel,
                        zone: p.zone,
                        id: playerId,
                        name: p.name,
                        class: p.class,
                        msg: messageText,
                        country: p.country
                    };
                    const encoded = JSON.stringify(chatMessage);
                    for (const room of rooms.values()) {
                        if (channel!=='team'&&!Regions.hears(channel,p.zone,room.zone)) continue;
                        for (const recipient of room.players.values()) {
                            if(channel==='team'&&expeditions.account(recipient.id).party!==expeditions.account(p.id).party)continue;
                            if (recipient.ws.readyState === WebSocket.OPEN) recipient.ws.send(encoded);
                        }
                    }
                } else if (data.type === 'update_info') {
                    updatePlayerInfo(playerRoom, p, data);
                }
            }
        } catch (e) {
            console.error('Invalid message received:', e);
        }
    });

    ws.on('close', () => {
        if (playerRoom) {
            handleDisconnect(playerRoom, playerId, true);
        }
    });
    
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${playerId}:`, error);
    });
});
