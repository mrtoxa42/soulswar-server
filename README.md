# SoulsWarAI Server

WebSocket server for SoulsWarAI.

## Shared street typing bosses (0.6.8)

`typing_events.js` owns both city events, their shared progress, gathering and
respawn timers, each writer's sentence checkpoint, personal nest creatures and
reward receipts. Ship `typing_events.json` alongside it. The matching client uses
`scripts/data/typing_events.json`; edit that canonical copy and sync before deploy.
Both bosses are soloable online. The initial writer count sets the text budget;
late joins and rejoining do not inflate it. Paused rounds keep their shared progress.

Story input validates exact case, punctuation, spaces, sequence, cycle, distance
and rate (25 characters/sec with a bounded burst). Creature words accept either
case. Position packets cannot overwrite Soul while writing. PvP remains enabled:
a valid real-player challenge pauses both writers before the duel is forwarded.
Only meaningful contributors receive personal reward receipts, which are retried
until acknowledged. Client-owned profile data persists the claim and journal.
No database or extra hosted service is required. Nearby public progress is
throttled; the acting writer receives direct input acknowledgements.

`node smoke_typing_events.js wss://soulswar-server.onrender.com --observe-only`
checks version/capability and both boss snapshots without entering an encounter.
Omit `--observe-only` to exercise input, shared progress and PvP interruption with
two temporary test players. Deploy with the matching 0.6.8 Poki client.

## Live Soul duels (0.6.7)

Clients advertising `duel_protocol: 1` use `live_duel.js` for a shared duel ratio
and Soul reserves. Valid, sequenced letters transfer Soul immediately; completed
words transfer more. A full attacker still drains the opponent. Live transfer
stops at 5% remaining Soul; the final result separately refills the winner by
60% of maximum Soul and removes 75% of the loser's maximum Soul. Both are capped.
The server validates words, letters, input rate and final victory, and ignores
position-packet Soul changes while a live duel is active. Account progression
outside combat remains client-owned. Older clients retain the legacy protocol.

Deploy `live_duel.js` and `duel_balance.json` alongside `server.js`. The JSON is
shared with the matching game client; reload both players after updating.
`node smoke_duel.js wss://soulswar-server.onrender.com` opens two temporary test
players and verifies live transfer, reversal and a single final settlement.

## Admin monitor and Developer sessions (0.6.6)

`admin_service.js` authenticates local dashboard connections using Ed25519 signed
single-use challenges. `admin_public_keys.json` contains only public verification
keys; never put a private signing key in this repository or image. Empty/missing
public keys disable access. `ADMIN_PUBLIC_KEYS_FILE` can select a separate key file.
The matching `admin-panel.html` runs on the owner's computer, polls every 5 seconds,
and authorizes a game pairing code that remains reusable for the lifetime of its game connection (no countdown). Authenticated player-row controls can grant or revoke Developer access at any time. Developer roles are server-owned,
survive region joins on the same socket and end on disconnect. Admin sockets do
not occupy game rooms. Snapshots are throttled to one per 3 seconds per panel;
they are generated only on authenticated requests. No database or extra service
is required. Restarting the server invalidates panel/game Developer sessions.

## Region multiplayer (0.6.5)

This repository is the standalone deployment source. Keep all root JavaScript and
JSON files together: region routing, equipment validation and expeditions require
their companion rule modules and data. `npm ci` installs dependencies and
`npm start` starts the service using Render's `PORT`. The welcome packet includes
`protocol: 2`, `server_version: "0.6.7"`, the accepted zone and the join revision.
Class districts/interiors support shared player visibility and regional chat;
class districts disable PvP. Raid instances remain private to their party.

Render should deploy this repository's `main` branch with the Dockerfile at its
root. Deploy this server with the matching 0.6.7 Poki client, then reload clients.
Verify the running service with `node smoke_regions.js wss://soulswar-server.onrender.com`.
This opens temporary peers in all four class districts and interiors and checks
the protocol, visibility, movement and regional chat without combat or rewards.

Kademe 1 adds server-side street level brackets and paired PvP cancellation.
The canonical bracket data is `../scripts/data/street_groups.json`; `npm start`
copies it into this standalone server folder with `sync_street_rules.js` when
the full game checkout is available. Include the committed `street_groups.json`,
`duel_rules.js` and `sync_street_rules.js` when deploying only this folder.
`node ../tests/stage1_server_tests.js` verifies that both copies match and checks
the protocol against a separate local server. Existing live servers need an
update before server-side enforcement is active.

## Deployment on Render.com (Free Tier)

1. Create a free account on [Render](https://render.com/).
2. Click "New" and select "Web Service".
3. Connect your GitHub repository containing this server code.
4. Render will automatically detect the `Dockerfile`.
5. Configure the service:
   - **Environment:** Docker
   - **Plan:** Free
   - **Branch:** main (or your default branch)
6. Add Environment Variable:
   - `PORT`: `8080` (Optional, default is 8080)
7. Click "Create Web Service".

Render handles SSL termination automatically, so your WebSocket URL will be available at `wss://<your-render-url>.onrender.com`.

## Kademe 2 equipment

Deploy `equipment.json` and `equipment_rules.js` together with this server and the matching Kademe 2 client. The canonical catalog is `scripts/data/equipment.json`; `npm` prestart copies it when the source checkout is present, and standalone deployments use the included copy. The server validates slot, class and minimum level, derives gear bonuses from item IDs, and recalculates new-client PvP pushes and beam ratios. Ownership and progression remain local profiles; there is no authenticated account inventory service in this build. Uploading only the client to an old server will not synchronize weapons correctly.

## Background presence and raid idle behavior (2026-10-24)

Ship `presence.js` with `server.js`. Open sockets use protocol ping/pong instead of position inactivity for disconnects (15-second probe, 60-second missing-pong cleanup). A new `presence_protocol: 1` client negotiates bounded background passive Soul reconciliation, with revisions preventing stale position Soul from overwriting away-time changes. Old clients retain their prior Soul protocol; deploy the matching client for background Soul accounting. Browser discard or device sleep can still close a socket.

Expedition camp regeneration uses elapsed seconds, not tick count. Nearby enemies attack players even without a selected target; typing no longer continually postpones their attack timer. Raid areas beyond the entrance drain 0.6 Soul/second. Kill loot requires contribution in the last minute; standing nearby does not grant loot or an XP receipt. Existing claimed-receipt protection and private party instances remain in place.

Admin snapshots add per-player presence, transport RTT, Soul, raid stage and carried shards. These are authenticated snapshots; no extra database, continuous metrics store or public player endpoint is added.

## PvP protection

Same-class players cannot fight each other, including in the forest's contested area. City duels check both participants against `pvp_rules.json`: the central plaza and dungeon entrances are safe. Challenges, acceptance, typing and results are validated server-side; moving into safety cancels an existing duel for both participants without a victory reward. The game owns the canonical manifest at `scripts/data/pvp_rules.json`; standalone deployments must include its server copy alongside `duel_rules.js`.


## Shared seasons and city NPCs (next client protocol)

`seasons.js` owns a global UTC-aligned 30-minute clock, faction wins, eligible
contributors and private reward receipts. Only completed authoritative typing
duels can score, including server-started NPC-versus-NPC fights and NPC victories
over active humans. Local bot claims, client finish claims and forfeits do not.
Ties share the winning reward; empty seasons issue no rewards. Ambient NPC
observers receive no participation credit. Rewards remain pending until the client saves its claim
ledger and acknowledges them. The browser identity token is private and is never
part of a roster. This is not a replacement for authenticated server inventory.

Set `SEASON_STATE_FILE` to a JSON file **inside persistent storage**, for example
`/var/data/seasons.json` with a Render disk mounted at `/var/data`. Default local
storage is `.state/seasons.json`, which survives a process restart only when the
underlying filesystem is retained. Render's ordinary filesystem is ephemeral;
using the default there does NOT preserve scores/receipts across restarts/deploys.
On Render, file-mode startup refuses to proceed without `SEASON_STATE_FILE`. Do not publish
a durability claim until the disk/database configuration is verified.
State writes use atomic replacement and fsync; an unreadable existing file fails
closed instead of silently resetting scores. Back up this private state separately
from source control. Run one server instance with this file-backed implementation;
multiple independent instances require a transactional shared datastore.

`shared_npcs.js` supplies 32 common city rivals (four factions in each of eight
level brackets), fixed identities/cosmetics, server movement and exclusive live
duels. A ten-second reservation freezes an NPC while its challenger types; it
expires automatically if abandoned. Nearby states are sent at 2 Hz, background tabs at most every 2 seconds;
clients interpolate briefly and stop predicting when packets stop. Distant NPCs
are not simulated by client AI. Death/respawn and busy state belong to the room.
Real player counts and room capacity exclude NPCs. Other regions, trash and
ordinary creatures keep their existing ownership. Older clients retain the old
local population; the new handshake explicitly opts into `shared_npcs: 1` and
`season_protocol: 1`.

Targeted checks: `node tests/shared_world_server_tests.js`,
`node tests/shared_world_network_tests.js` and the isolated-profile Godot
`tests/shared_world_client_tests.gd` / `tests/shared_npc_live_peer.gd` in a full
project checkout. Never run tests against the production season state file.


### Ambient NPC faction scoring (28 October 2026)
Server-started NPC-versus-NPC live duels now award one faction point to the
winner. NPC victories over active human opponents count too. Local client claims,
forfeits and duplicate results do not count. Ambient-only observers never become
eligible for season rewards. SharedNpcs starts at most one ambient encounter per
20 seconds across rooms, with one concurrent ambient duel per room and normal
class, street, proximity, safety, reservation and respawn restrictions.
Run `node tests/ambient_npc_season_tests.js` from the game checkout for the targeted
simulation; existing shared_world server/network/client tests cover persistence,
rewards, synchronized scores and client clock activation.
The live server probed on 28 October still lacked season capabilities. Deploy
this prepared server checkout with persistent storage and SEASON_STATE_FILE;
updating the game ZIP alone cannot activate shared seasons. No deployment was
performed as part of the source fix.


### Render Free without persistent disk
For explicitly disposable test sessions, set **SEASON_STORAGE=memory** in Render
Environment. Do not set SEASON_STATE_FILE to a temporary path and call it durable.
This mode needs no external database and works without a disk. A restart clears
server scores, identity mappings and undelivered season/raid receipts. UTC-aligned
season deadlines continue; browser-saved character profiles are separate.
Default `SEASON_STORAGE=file` retains the existing persistent-file guard.
Memory mode is not an account/password or cross-device save implementation.
Street raids permit solo entry, recommend 3–4 players, and retain team-sized base
HP. Up to 5 participants; late helpers can join an active fight. No minimum-three
quorum remains. Deployment was not performed by this source change.


## Independent guest and username/password accounts
Account data lives in PostgreSQL configured by the Render secret DATABASE_URL.
No database credential is shipped to the game. Optional HTTP endpoints share the
existing server port: /accounts/register, login, resume, save, logout and recover.
Names are case-insensitive ASCII letters/digits/underscore (3–18); passwords are
case-sensitive (10–128 UTF-16 units), salted scrypt, never plaintext. Sessions and
recovery codes are hashed. Recovery revokes sessions and rotates the code.
The game preserves guest and account saves separately; revision conflicts cannot
silently overwrite newer progress. This cloud-save transport does not make the
existing client-owned game economy server-authoritative.

npm prestart runs pending migrations from migrations/ in one transaction under
an advisory lock. A missing DATABASE_URL leaves guest gameplay available and the
account API unavailable; a configured but failing migration prevents new startup.
ACCOUNT_ALLOWED_ORIGINS is a comma-separated origin allowlist. Explicit * enables
the public bearer API for multiple game distribution hosts; no cookies are set.
SEASON_STORAGE=memory remains separate and disposable for season/raid runtime.
Do not run account tests against production. The game checkout contains real
Neon accounts-dev tests with two isolated Godot profiles. The Docker image uses
Node 24 LTS and a lockfile-based production install.
