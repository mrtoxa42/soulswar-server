'use strict';
const Equipment=require('./equipment_rules'),catalog=require('./equipment.json'),groups=require('./street_groups.json');
const {syncSoul,Balance}=require('./live_duel');
const {canDuel,pairKey,protectionReason}=require('./duel_rules');
const CLASSES=['Banker','Vampire','Speedster','Politician'];
const hash=text=>{let value=2166136261;for(const letter of text)value=Math.imul(value^letter.charCodeAt(0),16777619);return value>>>0;};
const QUOTES={Banker:['Interest never sleeps. I do, occasionally.','These receipts will not collect themselves.'],Vampire:['Night shift. No biting before tea.','That cat has stolen my dramatic entrance.'],Speedster:['One more word, then a snack break.','Racing the tram again. Bad idea?'],Politician:['Cleaner streets. That is my campaign.','A fair duel settles a loud debate.']};
// Four fixed identities per level bracket; movement stays in clear street lanes.
const LANES=[[9800,7500,11100,7500],[11900,7500,13400,7500],[14400,7500,16300,7500],[8500,4300,8500,6200],[8500,1300,8500,3300],[4400,7500,7100,7500],[1000,7500,3400,7500],[8500,9000,8500,12500]];
class SharedNpcs {
    constructor({now=Date.now()}={}){this.nextAmbientAt=now+20000;this.ambientCursor=0;}
    startAmbient(room,duels,now){
        // One start per 20 seconds across rooms, never simulate points per client.
        if(room.zone!=='city'||!room.players.size||now<this.nextAmbientAt||[...room.duels.values()].some(d=>d.ambient))return;
        const candidates=[...room.npcs.values()];
        const offset=this.ambientCursor%candidates.length;
        const free=candidates.slice(offset).concat(candidates.slice(0,offset)).filter(p=>!p.busy&&!p.activity&&!p.dead&&!p.retired&&now>=(p.resumeAt||0)&&![...room.duels.values()].some(d=>[d.first,d.second].includes(p.id)));
        for(let i=0;i<free.length;i++)for(let j=i+1;j<free.length;j++){
            const a=free[i],b=free[j];
            if(protectionReason(a,b)||!canDuel(a.level,b.level)||a.id.split(':')[1]!==b.id.split(':')[1]||Math.hypot(a.x-b.x,a.y-b.y)>260)continue;
            const duel={first:a.id,second:b.id,phase:'active',ratio:.5,ambient:true};
            room.duels.set(pairKey(a.id,b.id),duel);
            a.busy=b.busy=true;a.pauseAt=b.pauseAt=now;
            a.vx=a.vy=b.vx=b.vy=0;a.anim=b.anim='idle';
            duels.start(room,duel);this.nextAmbientAt=now+20000;this.ambientCursor+=5;
            return;
        }
    }
    ensure(room,now=Date.now()){
        if(room.npcs)return room.npcs;
        room.npcs=new Map();if(room.zone!=='city')return room.npcs;
        for(let tier=0;tier<groups.length;tier++)for(let cls=0;cls<4;cls++){
            const p={id:`npc:${tier+1}:${cls}`,npc:true,name:['Ledger','Nightshade','Quickstep','Councillor'][cls]+' '+(tier+1),class:CLASSES[cls],level:Math.min(groups[tier].spawn_max,groups[tier].min+cls),zone:'city',duel_protocol:1,country:'UN',skin:'classic',vehicle:'none',weapon:'none',hat:'none',face:'none',shoes:'none',accessory:'none',outfit:'none',ws:{readyState:0},born:now-cls*5000,lane:LANES[tier],dead:false,busy:false,vx:0,vy:0,anim:'idle',flip:false};
            // Stable per identity/slot, shared by all viewers. Respect the same
            // class/level and ordinary loot sources as the previous local bots.
            for(const [field,category] of Object.entries(Equipment.fields)){
                const pool=(catalog.classes[p.class][category]||[]).filter(id=>id!=='none'&&Equipment.valid(category,id,p.class,p.level)&&['shop','parking','parking_craft','street_craft'].includes(catalog.items[id].source||'shop'));
                p[field]=pool.length?pool[hash(p.id+field)%pool.length]:'none';
            }
            p.vehicle='none'; // Own gear, walk on foot; mounting remains explicit.
            p.activitySeq=0;p.nextActivityAt=now+5000+hash(p.id)%18000;
            Equipment.normalize(p);syncSoul(p,{});this.move(p,now);room.npcs.set(p.id,p);
        }
        return room.npcs;
    }
    move(p,now){
        const [ax,ay,bx,by]=p.lane,length=Math.hypot(bx-ax,by-ay),phase=((now-p.born)*.075/length)%2,t=phase<1?phase:2-phase,sign=phase<1?1:-1;
        p.x=ax+(bx-ax)*t;p.y=ay+(by-ay)*t;p.vx=(bx-ax)/length*75*sign;p.vy=(by-ay)/length*75*sign;p.flip=p.vx<0;p.anim='walk_side';
    }
    resume(p,now){if(p.pauseAt!==undefined){p.born+=now-p.pauseAt;delete p.pauseAt;}this.move(p,now);}
    activity(p,now){
        if(!p.activity&&now>=p.nextActivityAt){
            const seq=++p.activitySeq,kind=['collect','hunt','chat','rest'][(hash(p.id)+seq)%4];
            const word=kind==='hunt'?['PAW','TAIL','BARK'][seq%3]:kind==='collect'?['PAPER','BOTTLE','RECYCLE'][seq%3]:'';
            p.activity={seq,kind,word,typed:0,species:hash(p.id+seq)%2,quote:kind==='chat'?QUOTES[p.class][seq%2]:kind==='hunt'?'Found a street challenger!':kind==='collect'?'A cleaner street, one word at a time.':'Catching my breath.'};
            p.activityStarted=now;p.pauseAt=now;
        }
        if(!p.activity)return false;
        const elapsed=now-p.activityStarted,a=p.activity;
        a.typed=Math.min(a.word.length,Math.floor(elapsed/700));
        if(elapsed>=(a.word.length? a.word.length*700+1500:4500)){
            p.activityCounts ||= {};p.activityCounts[a.kind]=(p.activityCounts[a.kind]||0)+1;
            if(a.kind==='hunt'||a.kind==='collect'||a.kind==='rest')p.soul=Math.min(p.max_soul,p.soul+p.max_soul*.1);
            delete p.activity;p.nextActivityAt=now+12000+hash(p.id+p.activitySeq)%14000;
            this.resume(p,now);return true;
        }
        p.vx=p.vy=0;p.anim='idle';return true;
    }
    roster(room){return [...this.ensure(room).values()].map(p=>this.public(p,true));}
    public(p,full=false){
        const result={id:p.id,x:Math.round(p.x),y:Math.round(p.y),vx:Math.round(p.vx),vy:Math.round(p.vy),anim:p.anim,flip:p.flip,dead:!!(p.dead||p.retired),busy:p.busy};
        result.activity=p.activity?{...p.activity}:{};
        result.spectator=p.spectator?{...p.spectator}:{};
        if(full)for(const key of ['npc','name','class','level','country','duel_protocol','outfit','skin','vehicle','weapon','hat','face','shoes','accessory'])result[key]=p[key];
        return result;
    }
    finish(room,duel,winner,loser,now=Date.now()){
        for(const p of [winner,loser])if(p.npc){delete p.spectator;p.busy=false;p.retired=p===loser;p.resumeAt=now+(p.retired?30000:6000);p.vx=p.vy=0;p.anim='idle';}
    }
    tick(room,duels,now=Date.now()){
        this.ensure(room,now);
        this.startAmbient(room,duels,now);
        for(const p of room.npcs.values()){
            const duel=[...room.duels.values()].find(d=>[d.first,d.second].includes(p.id));
            delete p.spectator;
            if(duel?.ambient&&duel.live&&p.id===duel.first){
                const other=room.npcs.get(duel.second);
                if(other)p.spectator={other_id:other.id,nx:other.x,ny:other.y,npc_name:other.name,npc_class:other.class,ratio:Math.round(duel.ratio*1000)/1000};
            }
            if(duel?.reservedUntil&&now>duel.reservedUntil){
                for(const [key,value] of room.duels)if(value===duel)room.duels.delete(key);
                const human=room.players.get(duel.first);
                if(human?.ws.readyState===1)human.ws.send(JSON.stringify({type:'duel_rejected',reason:'challenge_expired'}));
                p.busy=false;this.resume(p,now);continue;
            }
            p.busy=!!duel;
            if(!duel){
                if(now<(p.resumeAt||0))continue;
                if(p.dead||p.retired){p.dead=false;p.retired=false;p.soul=p.max_soul;}
                if(!room.players.size||!this.activity(p,now))this.resume(p,now);continue;
            }
            delete p.activity; // A real challenge always interrupts street chores.
            if(p.pauseAt===undefined)p.pauseAt=now;
            p.vx=p.vy=0;p.anim='idle';
            if(!duel.live||duel.pendingResult)continue;
            duel.npcNextById ||= {};
            if(now<(duel.npcNextById[p.id]??duel.npcNext??0))continue;
            duel.npcNextById[p.id]=now+(duel.ambient?450+Math.floor(Math.random()*300):(p.level<6?650:400));
            const otherId=duel.first===p.id?duel.second:duel.first;
            const human=room.players.get(otherId)||room.npcs.get(otherId),state=duel.inputs.get(p.id);
            if(!human||!state)continue;
            const level=Math.max(p.level,human.level),tier=level>=120?5:level>=80?4:level>=40?3:level>=15?2:1;
            const word=state.word||Balance.words[tier][Math.floor((now/1000))%Balance.words[tier].length];
            duels.input(room,duel,p,human,{duel_id:duel.id,seq:state.seq+1,word,letter:word[state.index]});
        }
    }
    sendStates(room,now=Date.now()){
        if(now-(room.lastNpcs||0)<500)return;
        room.lastNpcs=now;
        for(const player of room.players.values()){
            if(!player.shared_npcs||player.ws.readyState!==1||player.ws.bufferedAmount>65536)continue;
            if(player.background&&now-(player.lastNpcState||0)<2000)continue;
            player.lastNpcState=now;
            const npcs=[...room.npcs.values()].filter(p=>Math.hypot(p.x-player.x,p.y-player.y)<2600||[...room.duels.values()].some(d=>[d.first,d.second].includes(player.id)&&[d.first,d.second].includes(p.id))).map(p=>this.public(p));
            if(npcs.length)player.ws.send(JSON.stringify({type:'npc_state',zone:room.zone,room_id:room.id,npcs}));
        }
    }
}
module.exports={SharedNpcs,LANES};
