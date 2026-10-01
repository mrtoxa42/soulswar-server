const WebSocket = require('ws');
const geoip = require('geoip-lite');
const crypto = require('crypto');

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

function getOrCreateRoom() {
    for (const [roomId, room] of rooms.entries()) {
        if (room.players.size < ROOM_MAX_PLAYERS) {
            return room;
        }
    }
    const newRoomId = crypto.randomUUID();
    const newRoom = {
        id: newRoomId,
        players: new Map(),
        botCount: TARGET_ENTITIES,
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
    const data = JSON.stringify(message);
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
        handleDisconnect(room, id);
    }

    if (stateUpdate.length > 0) {
        broadcast(room, { type: 'state', players: stateUpdate });
    }

    // Update bot count if needed
    const currentBotCount = calculateBotCount(room.players.size);
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

function handleDisconnect(room, playerId) {
    if (room.players.has(playerId)) {
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
                playerRoom = getOrCreateRoom();
                const newPlayer = {
                    ws: ws,
                    id: playerId,
                    name: safeUsername(data.name),
                    class: data.class,
                    level: data.level,
                    country: country,
                    outfit: data.outfit,
                    vehicle: data.vehicle,
                    hat: data.hat,
                    face: data.face,
                    shoes: data.shoes,
                    accessory: data.accessory,
                    skin: data.skin,
                    x: 0,
                    y: 0,
                    vx: 0,
                    vy: 0,
                    anim: 'idle',
                    flip: false,
                    lastUpdate: now,
                    chatTimestamps: []
                };

                playerRoom.players.set(playerId, newPlayer);
                console.log(`Player ${playerId} joined room ${playerRoom.id}`);

                // Send welcome to the new player
                const otherPlayers = [];
                for (const [id, p] of playerRoom.players.entries()) {
                    if (id !== playerId) {
                        otherPlayers.push({
                            id: id,
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
                            skin: p.skin
                        });
                    }
                }

                ws.send(JSON.stringify({
                    type: 'welcome',
                    id: playerId,
                    country: country,
                    players: otherPlayers,
                    botCount: playerRoom.botCount
                }));

                // Broadcast player_joined to others
                broadcast(playerRoom, {
                    type: 'player_joined',
                    id: playerId,
                    name: newPlayer.name,
                    class: data.class,
                    level: data.level,
                    country: country,
                    x: 0,
                    y: 0,
                    outfit: data.outfit,
                    vehicle: data.vehicle,
                    hat: data.hat,
                    face: data.face,
                    shoes: data.shoes,
                    accessory: data.accessory,
                    skin: data.skin
                }, playerId);

            } else if (playerRoom && playerRoom.players.has(playerId)) {
                const p = playerRoom.players.get(playerId);
                p.lastUpdate = now;

                if (data.type === 'pos') {
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
						broadcast(playerRoom, {
							type: 'chat', id: playerId, name: p.name,
							class: p.class, msg: data.msg, country: p.country
						});
						return;
					}
					const messageText = cleanText(data.msg, MAX_CHAT_LENGTH);
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
                    broadcast(playerRoom, {
                        type: 'chat',
                        id: playerId,
                        name: p.name,
                        class: p.class,
                        msg: messageText,
                        country: p.country
                    });
                } else if (data.type === 'update_info') {
                    p.level = data.level !== undefined ? data.level : p.level;
                    p.outfit = data.outfit !== undefined ? data.outfit : p.outfit;
                    p.vehicle = data.vehicle !== undefined ? data.vehicle : p.vehicle;
                    p.hat = data.hat !== undefined ? data.hat : p.hat;
                    p.face = data.face !== undefined ? data.face : p.face;
                    p.shoes = data.shoes !== undefined ? data.shoes : p.shoes;
                    p.accessory = data.accessory !== undefined ? data.accessory : p.accessory;
                    p.skin = data.skin !== undefined ? data.skin : p.skin;
                }
            }
        } catch (e) {
            console.error('Invalid message received:', e);
        }
    });

    ws.on('close', () => {
        if (playerRoom) {
            handleDisconnect(playerRoom, playerId);
        }
    });
    
    ws.on('error', (error) => {
        console.error(`WebSocket error for ${playerId}:`, error);
    });
});
