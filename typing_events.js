'use strict';
const crypto=require('node:crypto'),data=require('./typing_events.json');
const distance=(p,d)=>Number.isFinite(p.x)&&Number.isFinite(p.y)?Math.hypot(p.x-d.at[0],p.y-d.at[1]):Infinity;
class TypingEvents {
 constructor(){this.pending=new Map();}
 states(room){
  if(!room.typingEvents)room.typingEvents=new Map(data.bosses.map(d=>[d.id,{def:d,phase:'ready',cycle:crypto.randomUUID(),chapter:0,progress:0,total:0,records:new Map(),revision:0,dirty:true}]));
  return room.typingEvents;
 }
 active(room,p){return room.zone==='city'&&[...this.states(room).values()].some(s=>s.records.get(p.id)?.active);}
 public(s){return {id:s.def.id,phase:s.phase,cycle:s.cycle,chapter:s.chapter,progress:s.progress,total:s.total,until:s.until||0,participants:[...s.records.values()].filter(r=>r.active).length};}
 send(p,message){if(p.ws.readyState===1)p.ws.send(JSON.stringify({type:'typing_event',zone:'city',...message}));}
 self(s,p,extra={}){
  const r=s.records.get(p.id);
  this.send(p,{boss:this.public(s),self:r?{boss:s.def.id,active:r.active,index:r.index,seq:r.seq,checkpoint:r.checkpoint,completed:r.completed,threats:r.threats,soul:p.soul,max_soul:p.max_soul,contribution:r.contribution}:null,...extra});
 }
 snapshot(room,p){if(room.zone!=='city')return;this.send(p,{bosses:[...this.states(room).values()].map(s=>this.public(s)),result:(this.pending.get(p.id)||[])[0]||null});}
 leave(room,p,reason='paused',disconnect=false){
  if(room.zone==='city')for(const s of this.states(room).values()){
   const r=s.records.get(p.id);if(!r)continue;
   if(!r.active){if(disconnect)s.records.delete(p.id);continue;}
   r.active=false;r.index=r.checkpoint;r.threats=[];s.dirty=true;
   this.self(s,p,{reason});
   if(disconnect)s.records.delete(p.id);
  }
  if(disconnect)this.pending.delete(p.id);
 }
 action(room,p,msg){
  if(room.zone!=='city')return;
  if(msg.action==='ack'){
   const queue=this.pending.get(p.id)||[];
   this.pending.set(p.id,queue.filter(r=>r.id!==msg.receipt));
   this.snapshot(room,p);return;
  }
  if(msg.action==='snapshot'){this.snapshot(room,p);return;}
  const s=this.states(room).get(msg.boss);if(!s)return;
  if(msg.action==='leave'){this.leave(room,p);return;}
  if(msg.action==='join'){
   if(p.dead||p.level<s.def.min_level||distance(p,s.def)>260||s.phase==='cooldown'||[...room.duels.values()].some(d=>[d.first,d.second].includes(p.id))) {this.send(p,{error:'Approach this boss at the required level, outside a duel.'});return;}
   this.leave(room,p);
   if(s.phase==='ready'){s.phase=s.total>0?'active':'gathering';s.until=Date.now()+data.gather_seconds*1000;}
   const previous=s.records.get(p.id);
   let index=previous?.checkpoint||0;
   const text=s.def.chapters[s.chapter].text;
   if(!previous&&msg.chapter===s.def.chapters[s.chapter].id&&Number.isInteger(msg.checkpoint)&&msg.checkpoint>0&&msg.checkpoint<text.length&&text[msg.checkpoint-1]===' '&&/[.!?]/.test(text[msg.checkpoint-2]))index=msg.checkpoint;
   s.records.set(p.id,{active:true,index,checkpoint:index,seq:previous?.seq||0,contribution:previous?.contribution||0,completed:previous?.completed||false,threats:[],nextThreat:Date.now()+s.def.spawn_seconds*1000,lastInput:Date.now(),lastToken:Date.now(),tokens:12});
   s.dirty=true;this.self(s,p);return;
  }
  const r=s.records.get(p.id);if(!r?.active||s.phase!=='active')return;
  if(p.dead||distance(p,s.def)>400){this.leave(room,p,'out_of_range');return;}
  if(msg.action!=='key')return;
  const now=Date.now();r.tokens=Math.min(12,r.tokens+(now-r.lastToken)*.025);r.lastToken=now;
  if(msg.cycle!==s.cycle||msg.seq!==r.seq+1||typeof msg.key!=='string'||Array.from(msg.key).length!==1||r.tokens<1){this.self(s,p,{rejected:true});return;}
  r.tokens--;r.seq=msg.seq;
  let correct=false;
  if(msg.target==='story'){
   const text=s.def.chapters[s.chapter].text;
   if(msg.key===text[r.index]){
    r.index++;correct=true;
    if(msg.key===' '&&/[.!?]/.test(text[r.index-2]||''))r.checkpoint=r.index;
    if(r.index===text.length){r.completed=true;r.index=0;r.checkpoint=0;}
   }
  }else{
   const threat=r.threats.find(t=>t.id===msg.target);
   if(threat&&msg.key.toUpperCase()===threat.word[threat.index]){
    threat.index++;correct=true;
    if(threat.index===threat.word.length){r.threats=r.threats.filter(t=>t!==threat);s.progress+=12;r.contribution+=12;}
   }
  }
  if(correct){r.lastInput=now;r.contribution++;s.progress++;s.dirty=true;}
  if(s.progress>=s.total){this.finish(room,s);return;}
  this.self(s,p,{correct});
 }
 finish(room,s){
  if(s.phase!=='active')return;
  s.progress=s.total;s.phase='cooldown';s.until=Date.now()+data.respawn_seconds*1000;s.dirty=true;
  for(const [id,r] of s.records){
   const p=room.players.get(id);if(!p)continue;
   r.active=false;r.threats=[];
   if(r.contribution>=Math.min(60,Math.ceil(s.def.chapters[s.chapter].text.length*.15))&&distance(p,s.def)<1800){
    const result={id:s.cycle+':'+id,boss:s.def.id,chapter:s.def.chapters[s.chapter].id,completed:r.completed,xp:s.def.xp,coins:s.def.coins,fragments:s.def.fragments,item:crypto.randomInt(10)===0?data.item:'',contribution:r.contribution};
    const queue=this.pending.get(id)||[];queue.push(result);this.pending.set(id,queue.slice(-8));
   }
   this.self(s,p,{result:(this.pending.get(id)||[])[0]||null,reason:'finished'});
  }
 }
 tick(room,now=Date.now()){
  if(room.zone!=='city')return;
  for(const s of this.states(room).values()){
   for(const [id,r] of s.records)if(!r.active&&(!room.players.has(id)||now-r.lastInput>600000))s.records.delete(id);
   if(s.phase==='cooldown'&&now>=s.until){s.phase='ready';s.cycle=crypto.randomUUID();s.chapter=(s.chapter+1)%s.def.chapters.length;s.records.clear();s.progress=0;s.total=0;s.dirty=true;}
   if(s.phase==='gathering'&&now>=s.until){
    const count=[...s.records.values()].filter(r=>r.active).length;
    s.phase=count?'active':'ready';if(!s.total)s.total=s.def.chapters[s.chapter].text.length*Math.max(1,Math.min(4,count));s.dirty=true;
   }
   if(s.phase==='active')for(const [id,r] of s.records){
    const p=room.players.get(id);
    if(!r.active||!p)continue;
    if(p.dead||distance(p,s.def)>400||now-r.lastInput>data.idle_seconds*1000){this.leave(room,p,'paused');continue;}
    let changed=false;
    for(const threat of r.threats)if(now>=threat.due){p.soul=Math.max(0,p.soul-p.max_soul*.08);p.soul_lock_until=now+1000;changed=true;}
    r.threats=r.threats.filter(t=>now<t.due);
    if(s.def.kind==='nest'&&r.threats.length<2&&now>=r.nextThreat){
     const text=s.def.chapters[s.chapter].text;
     const used=new Set(r.threats.map(t=>t.word[0]));used.add(text[r.index]?.toUpperCase());
     const words=s.def.threat_words.filter(w=>!used.has(w[0]));
     if(words.length)r.threats.push({id:crypto.randomUUID(),word:words[crypto.randomInt(words.length)],index:0,born:now,due:now+s.def.threat_seconds*1000});
     r.nextThreat=now+s.def.spawn_seconds*1000;changed=true;
    }
    if(changed){this.self(s,p);if(p.soul<=0){p.dead=true;this.leave(room,p,'soul_empty');}}
   }
   if(s.phase==='active'&&![...s.records.values()].some(r=>r.active)){s.phase='ready';s.dirty=true;}
   if(s.dirty&&now-(s.lastBroadcast||0)>=300){
    for(const p of room.players.values())if(s.phase==='ready'||s.phase==='cooldown'||distance(p,s.def)<1800)this.send(p,{boss:this.public(s)});
    s.lastBroadcast=now;s.dirty=false;
   }
  }
 }
}
module.exports={TypingEvents,data};
