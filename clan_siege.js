'use strict';
const crypto=require('node:crypto');
const {fail}=require('./clan_store');
const WORDS=['SOUL','GUARD','SPIRIT','LANTERN','CASTLE','BRAVE','SHIELD','BANNER','GARDEN','RALLY','CROWN','TOGETHER','DEFEND','QUILL','VICTORY','ECHO'];
const RULES={width:2400,height:1400,speed:250,range:235,minutes:8,respawn:6000,gateWindow:40000};
const ALTAR={x:1200,y:700},BASES=[{x:220,y:700},{x:2180,y:700}],GATES=[520,1880];
const BLOCKS=[{x:520,y:220,w:70,h:600},{x:520,y:1180,w:70,h:600},{x:1880,y:220,w:70,h:600},{x:1880,y:1180,w:70,h:600},{x:930,y:380,w:160,h:100},{x:1470,y:1020,w:160,h:100}];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function walkable(r,x,y){return x>55&&x<2345&&y>70&&y<1330&&!BLOCKS.some(b=>Math.abs(x-b.x)<b.w/2+19&&Math.abs(y-b.y)<b.h/2+19)&&!GATES.some((g,i)=>r.gates[i]<=r.now&&Math.abs(x-g)<53&&Math.abs(y-700)<199);}
function sight(r,a,b){const count=Math.ceil(distance(a,b)/22);for(let i=1;i<count;i++)if(!walkable(r,a.x+(b.x-a.x)*i/count,a.y+(b.y-a.y)*i/count))return false;return true;}
class ClanSiege{
 constructor({now=()=>Date.now(),send=()=>{},persist=async()=>{},practice=async()=>{},busy=()=>false}={}){this.now=now;this.send=send;this.persist=persist;this.practiceReward=practice;this.busyOther=busy;this.squads=new Map();this.members=new Map();this.matches=new Map();this.last=now();this.broadcast=0;}
 squad(id){return this.squads.get(this.members.get(id));}
 busy(p){return !!p.clanAccount&&!!this.squad(p.clanAccount.id);}
 action(p,d,c){
  const id=p.clanAccount.id;let s=this.squad(id);const now=this.now();
  if(d.action==='war_leave'){this.leave(id,true);return;}
  if(d.action==='war_snapshot'){this.snapshot(p);return;}
  if(['war_create','war_join'].includes(d.action)){
   if(s||this.busyOther(p)||p.dead)fail('leave_current_activity_first');if(!c)fail('join_a_clan_first');
   if(d.action==='war_create'){
    s={code:crypto.randomBytes(3).toString('hex').toUpperCase(),clan:c.id,name:c.name,color:c.color,tag:c.tag,host:id,players:new Map(),ready:new Set(),phase:'lobby',match:null,created:now};this.squads.set(s.code,s);
   }else{s=this.squads.get(String(d.code||'').toUpperCase());if(!s||s.clan!==c.id||s.phase!=='lobby')fail('squad_not_found');if(s.players.size>=4)fail('squad_full');}
   s.players.set(id,p);this.members.set(id,s.code);this.publishSquad(s);return;
  }
  if(!s)fail('join_a_squad_first');
  if(d.action==='war_ready'&&s.phase==='lobby'){s.ready.has(id)?s.ready.delete(id):s.ready.add(id);this.publishSquad(s);return;}
  if(d.action==='war_cancel'&&s.phase==='queued'){if(id!==s.host)fail('captain_required');s.phase='lobby';this.publishSquad(s);return;}
  if(['war_practice','war_queue'].includes(d.action)&&s.phase==='lobby'){
   if(id!==s.host)fail('captain_required');if([...s.players.keys()].some(k=>!s.ready.has(k)))fail('all_members_must_be_ready');
   if(d.action==='war_practice'){this.start([s],true);return;}
   if(s.players.size!==4)fail('four_real_members_required');
   s.phase='queued';s.queued=now;this.publishSquad(s);
   const opponent=[...this.squads.values()].find(o=>o!==s&&o.clan!==s.clan&&o.phase==='queued');if(opponent)this.start([opponent,s],false);return;
  }
  const r=this.matches.get(s.match),a=r?.actors.get(id);if(!r||!a||r.phase!=='battle')return;
  if(d.action==='war_move'){
   if(!Number.isFinite(d.x)||!Number.isFinite(d.y)||Math.abs(d.x)>1||Math.abs(d.y)>1)return;
   const length=Math.hypot(d.x,d.y);a.dx=length>1?d.x/length:d.x;a.dy=length>1?d.y/length:d.y;a.moveAt=now;return;
  }
  if(d.action==='war_target'){if(typeof d.target!=='string'||d.target.length>60)return;a.target=d.target;a.buffer='';a.wordSince=now;this.snapshot(p);return;}
  if(d.action==='war_key')this.key(r,a,d);
 }
 actor(id,p,team,index){const base=BASES[team];return {id,p,team,npc:!p,name:p?.clanAccount.display_name||['Quill Guard','Moss Guard','Nora Guard','Pip Guard'][index%4],class:p?.class||['Banker','Vampire','Speedster','Politician'][index%4],look:p?Object.fromEntries(['outfit','hat','face','shoes','accessory','weapon','skin'].map(k=>[k,p[k]||'none'])):{},x:base.x+(team===0?60:-60),y:560+index*88,hp:100,dx:0,dy:0,moveAt:0,respawn:0,safeUntil:this.now()+3000,target:'altar',buffer:'',seq:0,wordIndex:index,wordSince:this.now(),lastWord:0,correct:0,kills:0,damage:0,objective:0,aiAt:this.now()+1200+index*180,leftAt:0};}
 start(squads,practice){
  const now=this.now(),r={id:crypto.randomUUID(),phase:'countdown',practice,start:now+4000,end:now+4000+RULES.minutes*60000,now,clans:[squads[0].clan,squads[1]?.clan||null],names:[squads[0].name,squads[1]?.name||'Quill’s Castle Guard'],colors:[squads[0].color,squads[1]?.color||'ba5964'],tags:[squads[0].tag,squads[1]?.tag||'GUARD'],squads:squads.map(s=>s.code),actors:new Map(),cores:[300,300],gates:[0,0],capture:0,owner:-1,energy:[0,0],spirits:[],events:[],winner:null,persistence:'none'};
  squads.forEach((s,team)=>{s.phase='match';s.match=r.id;let i=0;for(const [id,p]of s.players)r.actors.set(id,this.actor(id,p,team,i++));});
  if(practice)for(let team=0;team<2;team++){let count=[...r.actors.values()].filter(a=>a.team===team).length;while(count<4){const id='guard:'+team+':'+count;r.actors.set(id,this.actor(id,null,team,count++));}}
  this.matches.set(r.id,r);this.publish(r);
 }
 word(a,offset=0){return WORDS[(a.wordIndex+offset)%WORDS.length];}
 key(r,a,d){
  if(a.hp<=0||a.leftAt||!Number.isSafeInteger(d.seq)||d.seq<=a.seq||d.seq>a.seq+64)return;
  if(typeof d.key!=='string'||!(/^[A-Z]$/.test(d.key)||d.key==='BACKSPACE'))return;
  a.seq=d.seq;
  if(d.key==='BACKSPACE'){a.buffer=a.buffer.slice(0,-1);return;}
  a.buffer+=d.key;const word=this.word(a);if(a.buffer.length<word.length)return;
  if(a.buffer===word&&r.now-a.lastWord>=500&&r.now-a.wordSince>=word.length*45){this.cast(r,a);a.correct++;a.lastWord=r.now;}
  else this.event(r,a.x,a.y,'TRY AGAIN','miss');
  a.buffer='';a.wordIndex++;a.wordSince=r.now;
 }
 targets(r,a){
  if(a.hp<=0)return [];
  const list=[];
  for(const b of r.actors.values())if(b.team!==a.team&&b.hp>0&&!b.leftAt&&r.now>=b.safeUntil&&distance(a,b)<=RULES.range&&sight(r,a,b))list.push({id:b.id,name:b.name,x:b.x,y:b.y,kind:'enemy'});
  if(distance(a,ALTAR)<190)list.push({id:'altar',name:r.owner===a.team?'CHARGE SIEGE SPIRIT':'CLAIM SOUL SHRINE',...ALTAR,kind:'altar'});
  const enemy=1-a.team;
  if(r.gates[enemy]>r.now&&distance(a,BASES[enemy])<RULES.range)list.push({id:'core',name:'BREAK SOUL CORE',...BASES[enemy],kind:'core'});
  for(const spirit of r.spirits)if(distance(a,spirit)<RULES.range)list.push({id:spirit.id,name:spirit.team===a.team?'MEND SIEGE SPIRIT':'STOP SIEGE SPIRIT',x:spirit.x,y:spirit.y,kind:'spirit'});
  return list;
 }
 cast(r,a){
  const targets=this.targets(r,a),target=targets.find(t=>t.id===a.target)||targets[0];if(!target){this.event(r,a.x,a.y,'MOVE CLOSER','hint');return;}
  if(target.kind==='enemy'){
   const b=r.actors.get(target.id);b.hp=Math.max(0,b.hp-22);a.damage+=22;this.event(r,b.x,b.y,'−22','hit',a.x,a.y);
   if(!b.hp){b.respawn=r.now+RULES.respawn;b.dx=b.dy=0;a.kills++;this.event(r,b.x,b.y,'SOUL RETURNS','death');}
  }else if(target.kind==='altar'){
   const contested=[...r.actors.values()].some(b=>b.team!==a.team&&b.hp>0&&!b.leftAt&&distance(b,ALTAR)<190);
   if(contested){this.event(r,1200,620,'SHRINE CONTESTED','hint');return;}
   if(r.owner===a.team){r.energy[a.team]=Math.min(100,r.energy[a.team]+14);this.event(r,1200,630,'+14 ENERGY','charge');}
   else{r.capture=Math.max(-100,Math.min(100,r.capture+(a.team===0?25:-25)));if((a.team===0&&r.capture===100)||(a.team===1&&r.capture===-100)){r.owner=a.team;r.energy[1-a.team]=0;this.event(r,1200,620,'SHRINE CLAIMED','charge');}}
   a.objective++;
  }else if(target.kind==='core'){
   const team=1-a.team;r.cores[team]=Math.max(0,r.cores[team]-18);a.objective++;this.event(r,BASES[team].x,650,'−18 CORE','hit',a.x,a.y);if(!r.cores[team])this.finish(r,a.team);
  }else{
   const spirit=r.spirits.find(s=>s.id===target.id);if(spirit){spirit.hp=Math.min(140,spirit.hp+(spirit.team===a.team?18:-24));a.objective++;this.event(r,spirit.x,spirit.y,spirit.team===a.team?'+18':'−24','charge',a.x,a.y);}
  }
 }
 event(r,x,y,text,kind,fromX=null,fromY=null){r.events.push({id:crypto.randomUUID(),x,y,text,kind,at:r.now,fromX,fromY});r.events=r.events.slice(-30);}
 ai(r,a,dt){
  const enemies=[...r.actors.values()].filter(b=>b.team!==a.team&&b.hp>0&&!b.leftAt&&r.now>=b.safeUntil).sort((x,y)=>distance(a,x)-distance(a,y));
  let goal=ALTAR;
  const enemy=1-a.team;
  if(r.gates[enemy]>r.now)goal=BASES[enemy];
  else if(r.spirits.some(s=>s.team===a.team))goal=r.spirits.find(s=>s.team===a.team);
  if(enemies[0]&&distance(a,enemies[0])<330)goal=enemies[0];
  const dist=distance(a,goal);a.dx=dist>145?(goal.x-a.x)/dist:0;a.dy=dist>145?(goal.y-a.y)/dist:0;
  if(dist>145&&!walkable(r,a.x+a.dx*40,a.y+a.dy*40)){a.dy=a.y<700?1:-1;a.dx=0;}
  if(r.now>=a.aiAt){const options=this.targets(r,a);a.target=options.find(t=>t.kind==='enemy')?.id||options.find(t=>t.kind==='core')?.id||options[0]?.id||'altar';this.cast(r,a);a.aiAt=r.now+(r.practice?1500:1300);a.correct++;}
 }
 tick(){
  const now=this.now(),dt=Math.max(0,Math.min(.1,(now-this.last)/1000));this.last=now;
  for(const s of [...this.squads.values()])if(s.phase==='lobby'&&now-s.created>1800000)for(const id of [...s.players.keys()])this.leave(id,true);
  for(const r of [...this.matches.values()]){
   r.now=now;r.events=r.events.filter(e=>now-e.at<1800);
   if(r.phase==='finished'){if(r.persistence==='retry'&&now>=(r.retryAt||0))this.persistResult(r);if(now-r.finished>120000&&r.persistence!=='saving'&&r.persistence!=='retry'){for(const code of r.squads){const s=this.squads.get(code);if(s)for(const id of [...s.players.keys()])this.leave(id,true);}this.matches.delete(r.id);}continue;}
   if(now<r.start)continue;r.phase='battle';
   for(const a of r.actors.values()){
    if(a.leftAt){if(now-a.leftAt>60000)a.hp=0;continue;}
    if(a.hp<=0){if(now>=a.respawn){const base=BASES[a.team];a.x=base.x+(a.team===0?70:-70);a.y=700;a.hp=100;a.safeUntil=now+3000;a.buffer='';a.wordSince=now;}continue;}
    if(a.npc)this.ai(r,a,dt);else if(now-a.moveAt>450)a.dx=a.dy=0;
    const x=a.x+a.dx*RULES.speed*dt,y=a.y+a.dy*RULES.speed*dt;
    if(walkable(r,x,a.y))a.x=x;if(walkable(r,a.x,y))a.y=y;
   }
   if(r.owner>=0){const team=r.owner,opposition=[...r.actors.values()].some(a=>a.team!==team&&a.hp>0&&!a.leftAt&&distance(a,ALTAR)<190);if(!opposition)r.energy[team]=Math.min(100,r.energy[team]+dt*2);
    if(r.energy[team]>=100&&!r.spirits.some(s=>s.team===team)){r.energy[team]=0;r.spirits.push({id:'spirit:'+crypto.randomUUID(),team,x:1200,y:700,hp:140});this.event(r,1200,650,'SIEGE SPIRIT AWAKENS','charge');}}
   for(const spirit of r.spirits){if(spirit.hp<=0)continue;const enemy=1-spirit.team,goal=GATES[enemy];spirit.x+=Math.sign(goal-spirit.x)*70*dt;if(Math.abs(goal-spirit.x)<16){r.gates[enemy]=now+RULES.gateWindow;spirit.hp=0;this.event(r,goal,630,'GATE OPEN • 40 SECONDS','charge');}}
   r.spirits=r.spirits.filter(s=>s.hp>0);
   // An occupied gate stays passable until players step out; closing never traps actors inside stone.
   for(let team=0;team<2;team++)if(r.gates[team]>0&&r.gates[team]<=now){for(const a of r.actors.values())if(Math.abs(a.x-GATES[team])<65&&Math.abs(a.y-700)<210)a.x=GATES[team]+(a.team===team?(team===0?-75:75):(team===0?75:-75));r.gates[team]=0;}
   if(!r.practice){const present=[0,1].map(team=>[...r.actors.values()].some(a=>a.team===team&&!a.npc&&(!a.leftAt||now-a.leftAt<60000)));if(!present[0]&&!present[1])this.finish(r,null);else if(!present[0])this.finish(r,1);else if(!present[1])this.finish(r,0);}
   if(now>=r.end&&r.phase==='battle')this.finish(r,r.cores[0]===r.cores[1]?null:r.cores[0]>r.cores[1]?0:1);
  }
  if(now-this.broadcast>=100){this.broadcast=now;for(const r of this.matches.values())this.publish(r);}
 }
 finish(r,winner){if(r.phase==='finished')return;r.phase='finished';r.winner=winner;r.finished=r.now;r.persistence='retry';this.persistResult(r);}
 async persistResult(r){
  if(r.persistence==='saving')return;r.persistence='saving';
  try{
   if(r.practice)await this.practiceReward({id:r.id,clan:r.clans[0],players:[...r.actors.values()].filter(a=>!a.npc&&(a.correct>=3||a.objective>0)).map(a=>a.id),at:r.finished,practice:true});
   else await this.persist({id:r.id,clans:r.clans,names:r.names,winner:r.winner,at:r.finished,cores:r.cores});
   r.persistence='saved';
  }catch{r.persistence='retry';r.retryAt=this.now()+5000;}
 }
 snapshot(p){const s=this.squad(p.clanAccount?.id);if(!s){this.send(p,{type:'clan',event:'war',state:{}});return;}const r=this.matches.get(s.match);if(!r){this.send(p,{type:'clan',event:'war',state:{phase:s.phase,code:s.code,clan:s.clan,host:s.host,players:[...s.players].map(([id,p])=>({id,name:p.clanAccount.display_name,ready:s.ready.has(id)}))}});return;}
  const a=r.actors.get(p.clanAccount.id),actors=[...r.actors.values()].map(b=>({id:b.id,name:b.name,class:b.class,look:b.look,team:b.team,npc:b.npc,x:b.x,y:b.y,hp:b.hp,respawn:b.respawn,safeUntil:b.safeUntil,dx:b.dx,dy:b.dy,kills:b.kills,objective:b.objective,correct:b.correct,disconnected:!!b.leftAt}));
  this.send(p,{type:'clan',event:'war',state:{id:r.id,phase:r.phase,practice:r.practice,now:r.now,start:r.start,end:r.end,names:r.names,tags:r.tags,colors:r.colors,cores:r.cores,gates:r.gates,capture:r.capture,owner:r.owner,energy:r.energy,spirits:r.spirits,players:actors,events:r.events,winner:r.winner,persistence:r.persistence,me:{id:a.id,team:a.team,hp:a.hp,seq:a.seq,word:this.word(a),upcoming:[1,2,3,4].map(i=>this.word(a,i)),buffer:a.buffer,target:a.target,targets:this.targets(r,a)}}});
 }
 publishSquad(s){for(const p of s.players.values())this.snapshot(p);}
 publish(r){for(const code of r.squads){const s=this.squads.get(code);if(s)this.publishSquad(s);}}
 reconnect(p){const id=p.clanAccount.id,s=this.squad(id);if(!s)return;s.players.set(id,p);const r=this.matches.get(s.match),a=r?.actors.get(id);if(a){a.p=p;a.leftAt=0;a.moveAt=0;}this.snapshot(p);}
 leave(id,explicit=false){const s=this.squad(id);if(!s)return;const p=s.players.get(id),r=this.matches.get(s.match),a=r?.actors.get(id);
  if(a&&r.phase!=='finished'&&!explicit){a.leftAt=this.now();a.dx=a.dy=0;return;}
  if(a){a.leftAt=this.now()-60001;a.hp=0;a.p=null;}
  s.players.delete(id);s.ready.delete(id);this.members.delete(id);
  if(!s.players.size)this.squads.delete(s.code);else{if(s.host===id)s.host=s.players.keys().next().value;if(s.phase==='queued')s.phase='lobby';this.publishSquad(s);}
  if(p)this.send(p,{type:'clan',event:'war',state:{}});
 }
}
module.exports={ClanSiege,RULES,WORDS,BLOCKS,GATES,BASES,walkable};
