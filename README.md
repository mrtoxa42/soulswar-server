# SoulsWarAI Server

WebSocket server for SoulsWarAI.

## Region multiplayer (0.6.5)

This repository is the standalone deployment source. Keep all root JavaScript and
JSON files together: region routing, equipment validation and expeditions require
their companion rule modules and data. `npm ci` installs dependencies and
`npm start` starts the service using Render's `PORT`. The welcome packet includes
`protocol: 2`, `server_version: "0.6.5"`, the accepted zone and the join revision.
Class districts/interiors support shared player visibility and regional chat;
class districts disable PvP. Raid instances remain private to their party.

Render should deploy this repository's `main` branch with the Dockerfile at its
root. Deploy this server with the matching 0.6.5 Poki client, then reload clients.
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
