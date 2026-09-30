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

const rooms = new Map();

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
                    name: data.name,
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
                    lastUpdate: now
                };

                playerRoom.players.set(playerId, newPlayer);
                console.log(`Player ${data.name} joined room ${playerRoom.id}`);

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
                    name: data.name,
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
                    broadcast(playerRoom, {
                        type: 'chat',
                        id: playerId,
                        name: p.name,
                        class: p.class,
                        msg: data.msg,
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
