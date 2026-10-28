'use strict';
const crypto = require('node:crypto');
const {DeveloperSupport}=require('./developer_support');

class AdminService {
    constructor({rooms, wss, keys = [], version = '0.6.8', playerDetails=()=>({}),activityPlayers=new Map()}) {
        this.rooms = rooms; this.wss = wss; this.version = version;
        this.playerDetails=playerDetails;
        this.activityPlayers=activityPlayers;
        this.keys = keys.map(k => crypto.createPublicKey({key:Buffer.from(k,'base64'),format:'der',type:'spki'}));
        this.sessions = new WeakMap(); this.pairs = new Map(); this.attempts = new Map();
        this.support=new DeveloperSupport(this);
        this.lag = 0; this.cpu = 0;
        let previousTime = process.hrtime.bigint(), previousCpu = process.cpuUsage();
        this.timer = setInterval(() => {
            const now = process.hrtime.bigint(), elapsed = Number(now-previousTime)/1e6;
            const usage = process.cpuUsage(previousCpu);
            this.lag = Math.max(0,elapsed-1000); this.cpu = (usage.user+usage.system)/(elapsed*10);
            previousTime = now; previousCpu = process.cpuUsage();
            for (const [ip,attempt] of this.attempts) if(attempt.until<Date.now()) this.attempts.delete(ip);
            this.support.tick();
        },1000);
        this.timer.unref();
    }
    send(ws,data) { if(ws.readyState===1) ws.send(JSON.stringify(data)); }
    player(id) {
        for(const room of this.rooms.values()) if(room.players.has(id)) return {room,player:room.players.get(id)};
        if(this.activityPlayers.has(id))return {room:null,player:this.activityPlayers.get(id)};
        return null;
    }
    setRole(id,role) {
        const found = this.player(id);
        if(!found) return false;
        found.player.role = role;
        found.player.ws.developerRole = role === 'Developer';
        const activity=this.activityPlayers.get(id);
        if(activity)activity.role=role;
        found.player.info_revision=(found.player.info_revision||1)+1;
        const message = {type:'role_update',id,role,info_revision:found.player.info_revision};
        if(found.room)message.zone=found.room.zone;
        this.send(found.player.ws,message);
        if(found.room)for(const player of found.room.players.values())if(player.id!==id)this.send(player.ws,message);
        return true;
    }
    limited(ip) {
        let entry = this.attempts.get(ip);
        if(!entry || entry.until<Date.now()) {
            if(this.attempts.size>=1000 && !entry) return true;
            entry = {count:0,until:Date.now()+60000}; this.attempts.set(ip,entry);
        }
        return ++entry.count > 10;
    }
    handle(ws,data,id,ip) {
        if(!data || typeof data.type!=='string') return false;
        if(data.type.startsWith('developer_support_'))return this.support.handle(ws,data,id);
        if(data.type==='developer_pair') {
            const found=this.player(id);
            if(!found) return true;
            if(!this.keys.length) {this.send(ws,{type:'developer_pair',error:'Developer access is not configured.'});return true;}
            for(const [code,pair] of this.pairs) if(pair.id===id) {
                this.send(ws,{type:'developer_pair',code,expires_in:0}); return true;
            }
            if(ws.lastPair && Date.now()-ws.lastPair<10000) return true;
            ws.lastPair=Date.now();
            for(const [code,pair] of this.pairs) if(pair.id===id) this.pairs.delete(code);
            if(this.pairs.size>=1000) return true;
            const code=crypto.randomBytes(6).toString('hex').toUpperCase();
            this.pairs.set(code,{id});
            this.send(ws,{type:'developer_pair',code,expires_in:0});
            return true;
        }
        if(data.type==='developer_logout') {this.setRole(id,''); return true;}
        if(!data.type.startsWith('admin_')) return false;
        let session=this.sessions.get(ws);
        if(!session) {session={authenticated:false,challenge:'',expires:0,lastHello:0,lastSnapshot:0,lastPing:0,lastPair:0};this.sessions.set(ws,session);}
        if(data.type==='admin_hello') {
            if(Date.now()-session.lastHello<1000) return true;
            session.lastHello=Date.now();
            if(this.player(id) || !this.keys.length || this.limited(ip)) {this.send(ws,{type:'admin_error',reason:'Access unavailable or rate limited.'});return true;}
            session.challenge='soulswar-admin-v1:'+crypto.randomBytes(32).toString('hex');
            session.expires=Date.now()+30000; session.authenticated=false;
            this.send(ws,{type:'admin_challenge',challenge:session.challenge}); return true;
        }
        if(data.type==='admin_auth') {
            const challenge=session.challenge; session.challenge='';
            const signature=typeof data.signature==='string' && data.signature.length<200 ? Buffer.from(data.signature,'base64') : Buffer.alloc(0);
            session.authenticated=Boolean(challenge && session.expires>Date.now() && signature.length===64 && this.keys.some(key=>crypto.verify(null,Buffer.from(challenge),key,signature)));
            session.expires=Date.now()+8*60*60*1000;
            this.send(ws,{type:session.authenticated?'admin_ready':'admin_error',reason:session.authenticated?undefined:'Authentication failed.'});
            return true;
        }
        if(!session.authenticated || session.expires<Date.now()) {this.send(ws,{type:'admin_error',reason:'Authentication required.'});return true;}
        if(data.type==='admin_ping' && Date.now()-session.lastPing>=1000) {
            session.lastPing=Date.now();this.send(ws,{type:'admin_pong',nonce:String(data.nonce).slice(0,40)});
        }
        if(data.type==='admin_snapshot' && Date.now()-session.lastSnapshot>=3000) {
            session.lastSnapshot=Date.now();this.send(ws,{type:'admin_snapshot',...this.snapshot()});
        }
        if(data.type==='admin_pair' && Date.now()-session.lastPair>=1000) {
            session.lastPair=Date.now();
            const code=String(data.code||'').replace(/[\s-]/g,'').toUpperCase();
            const pair=this.pairs.get(code);
            const ok=Boolean(pair && this.setRole(pair.id,'Developer'));
            this.send(ws,{type:'admin_pair_result',ok,message:ok?'Developer session enabled. F6 is ready in the game.':'Code not found. The game may have disconnected.'});
        }
        if(data.type==='admin_set_developer' && Date.now()-session.lastPair>=1000) {
            session.lastPair=Date.now();
            const ok=typeof data.id==='string' && typeof data.enabled==='boolean' && this.setRole(data.id,data.enabled?'Developer':'');
            this.send(ws,{type:'admin_role_result',ok:Boolean(ok),enabled:data.enabled===true,id:data.id});
        }
        return true;
    }
    isAdminSocket(ws) { return this.sessions.has(ws); }
    close(id) {this.support.close(id);for(const [code,pair] of this.pairs) if(pair.id===id) this.pairs.delete(code);}
    snapshot() {
        const now=Date.now(), players=[], rooms=[];
        const joined=new Set();
        for(const room of this.rooms.values()) {
            rooms.push({id:room.id,zone:room.zone,players:room.players.size,capacity:room.zone==='forest_raid'?4:30,bots:room.botCount,private:room.zone==='forest_raid'});
            for(const p of room.players.values()) {
                joined.add(p.id);
                const context=this.activityPlayers.get(p.id);
                players.push({id:p.id,name:p.name,class:p.class,level:p.level,role:p.role||'',zone:p.zone,room:room.id,x:Math.round(p.x||0),y:Math.round(p.y||0),dead:p.dead,country:p.country,connected_seconds:Math.round((now-(p.connectedAt||now))/1000),last_seen_seconds:Math.max(0,Math.round((now-p.lastUpdate)/1000)),presence:p.background?'background':now-p.lastUpdate>2000?'idle':'active',rtt_ms:Number.isFinite(p.ws.transportRtt)?Math.round(p.ws.transportRtt):null,soul:Math.round(p.soul||0),max_soul:Math.round(p.max_soul||100),mode:'online',activity:context?.zone===p.zone?context.activity:'playing',stage:context?.zone===p.zone?context.stage:0,detail:context?.zone===p.zone?context.detail:'',client_fps:context?.client_fps??null,client_frame_ms:context?.client_frame_ms??null,build:context?.build||'',context_age_seconds:context?Math.max(0,Math.round((now-context.lastActivity)/1000)):null,client_reported:false,...this.playerDetails(p)});
            }
        }
        for(const p of this.activityPlayers.values()) {
            if(joined.has(p.id)||p.ws.readyState!==1)continue;
            const age=Math.max(0,Math.round((now-p.lastActivity)/1000));
            players.push({id:p.id,name:p.name,class:p.class,level:p.level,role:p.ws.developerRole?'Developer':'',zone:p.zone,room:'',x:p.x,y:p.y,dead:p.activity==='dead',country:p.country,connected_seconds:Math.round((now-p.connectedAt)/1000),last_seen_seconds:age,presence:p.background?'background':age>30?'idle':'active',rtt_ms:Number.isFinite(p.ws.transportRtt)?Math.round(p.ws.transportRtt):null,soul:p.soul,max_soul:p.max_soul,mode:p.mode==='online'?'connecting':p.mode,activity:p.activity,stage:p.stage,area:p.area,detail:p.detail,client_fps:p.client_fps,client_frame_ms:p.client_frame_ms,build:p.build,context_age_seconds:age,client_reported:true});
        }
        return {at:now,version:this.version,activity_protocol:1,uptime_seconds:Math.floor(process.uptime()),memory_mb:Math.round(process.memoryUsage().rss/1048576),cpu_percent:Math.round(this.cpu*10)/10,event_loop_lag_ms:Math.round(this.lag),connections:this.wss.clients.size,players,rooms};
    }
}
module.exports={AdminService};
