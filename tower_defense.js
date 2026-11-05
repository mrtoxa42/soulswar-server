'use strict';
const crypto=require('node:crypto');
const RULES=require('./tower_defense.json');
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function point(path,progress){for(let i=1;i<path.length;i++){const len=distance(path[i-1],path[i]);if(progress<=len){const t=Math.max(0,progress/len);return path[i].map((n,j)=>path[i-1][j]+(n-path[i-1][j])*t);}progress-=len;}return path.at(-1).slice();}
const length=path=>path.slice(1).reduce((n,p,i)=>n+distance(p,path[i]),0);
function cellAt(cell){return [RULES.gridOrigin[0]+cell%RULES.columns*RULES.cell,RULES.gridOrigin[1]+Math.floor(cell/RULES.columns)*RULES.cell];}
function validCell(map,cell){if(!Number.isInteger(cell)||cell<0||cell>=RULES.columns*RULES.rows)return false;const p=cellAt(cell),path=RULES.maps[map].path;return path.slice(1).every((b,i)=>{const a=path[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return distance(p,[a[0]+dx*t,a[1]+dy*t])>55;});}
class TowerDefense {
 constructor(send,{now=()=>Date.now(),busy=()=>false}={}){this.send=send;this.now=now;this.busy=busy;this.rooms=new Map();this.members=new Map();this.pending=new Map();this.clients=new Map();this.last=now();this.broadcastAt=0;}
 error(p,reason){this.send(p,{type:'tower_defense',event:'error',reason});}
 member(p){return this.members.get(p.id);}
 room(p){return this.rooms.get(this.member(p));}
 action(p,d){
  if(p.zone!=='minigame_hub')return this.error(p,'enter_minigame_hub');
  this.clients.set(p.id,p);
  const now=this.now();p.tdRate ||= {at:now,count:0};if(now-p.tdRate.at>=1000)p.tdRate={at:now,count:0};if(++p.tdRate.count>55)return;
  if(d.action==='snapshot'){this.snapshot(p);return;}
  if(d.action==='ack'){const rewards=this.pending.get(p.seasonKey)||[];this.pending.set(p.seasonKey,rewards.filter(r=>r.id!==d.id));return;}
  if(d.action==='leave'){this.leave(p);this.snapshot(p);return;}
  if(['solo','create','quick','join'].includes(d.action)){
   if(this.room(p))return this.error(p,'leave_current_room_first');
   if(this.busy(p)||p.dead)return this.error(p,'finish_current_encounter');
   let room;
   if(d.action==='join')room=this.rooms.get(typeof d.code==='string'?d.code.trim().toUpperCase():'');
   else if(d.action==='quick')room=[...this.rooms.values()].find(r=>r.quick&&r.phase==='lobby'&&r.players.size<4);
   if(d.action==='join'&&!room)return this.error(p,'room_not_found');
   if(room&&(room.phase!=='lobby'||room.players.size>=4))return this.error(p,'room_full_or_started');
   if(!room){if(this.rooms.size>=200)return this.error(p,'server_busy');let code;do{code=crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(this.rooms.has(code));room={code,id:crypto.randomUUID(),host:p.id,quick:d.action==='quick',solo:d.action==='solo',players:new Map(),phase:'lobby',map:0,chapter:1,wave:0,hp:RULES.baseHealth,enemies:[],shots:[],nextEnemy:0,spawn:0,remaining:0,wait:0,started:now,activity:now};this.rooms.set(code,room);}
   if(room.solo&&room.players.size)return this.error(p,'private_solo_room');
   room.players.set(p.id,{p,cell:-1,ready:false,typed:'',target:0,seq:0,lastKey:0,hits:0});this.members.set(p.id,room.code);this.publish(room);return;
  }
  const r=this.room(p),m=r?.players.get(p.id);if(!m)return this.error(p,'join_a_room_first');r.activity=now;
  if(d.action==='start'&&r.host===p.id&&r.phase==='lobby'){r.phase='placement';this.publish(r);return;}
  if(d.action==='place'&&r.phase==='placement'){
   if(!validCell(r.map,d.cell)||[...r.players.values()].some(o=>o!==m&&o.cell===d.cell))return this.error(p,'choose_an_empty_build_grid');
   m.cell=d.cell;m.ready=false;this.publish(r);return;
  }
  if(d.action==='ready'&&r.phase==='placement'){
   if(!validCell(r.map,m.cell))return this.error(p,'place_your_tower_first');m.ready=true;
   if([...r.players.values()].every(o=>o.ready)){r.wave=1;this.wave(r);}this.publish(r);return;
  }
  if(d.action==='reset'){m.typed='';m.target=0;return;}
  if(d.action==='key'&&r.phase==='wave')this.key(r,m,d,now);
 }
 wave(r){r.phase='wave';r.remaining=5+Math.floor((r.chapter-1)/2)+r.map*2+Math.ceil(r.players.size*1.5)+r.wave;r.spawn=0;r.enemies=[];r.shots=[];for(const m of r.players.values()){m.typed='';m.target=0;}r.bossPending=r.wave===5;}
 word(r){const tier=Math.min(2,r.map+(r.chapter>=4?1:0));const words=RULES.words[tier];const used=new Set(r.enemies.map(e=>e.word));const free=words.filter(w=>!used.has(w));return free.length?free[(r.nextEnemy+r.wave+r.chapter)%free.length]:null;}
 spawn(r,boss=false){const word=this.word(r);if(!word)return false;const hp=boss?4+r.map*2+r.chapter+Math.max(0,r.players.size-1)*3:1+((r.map===2&&r.chapter>=4)?1:0);r.enemies.push({id:++r.nextEnemy,word,hp,maxHp:hp,boss,progress:0,x:RULES.maps[r.map].path[0][0],y:RULES.maps[r.map].path[0][1]});return true;}
 key(r,m,d,now){
  if(!Number.isInteger(d.seq)||d.seq!==m.seq+1||typeof d.key!=='string'||!/^[A-Z]$/.test(d.key))return;
  m.seq=d.seq; // Consume even rejected keys; retransmission cannot duplicate damage.
  if(now-m.lastKey<30)return;m.lastKey=now;
  const e=r.enemies.find(e=>e.id===d.target);if(!e||m.cell<0||distance(cellAt(m.cell),[e.x,e.y])>RULES.range){m.typed='';m.target=0;return;}
  if(m.target!==e.id){m.target=e.id;m.typed='';}
  if(d.key!==e.word[m.typed.length]){m.typed='';return;}
  m.typed+=d.key;
  if(m.typed===e.word){m.typed='';m.target=0;m.hits++;const at=cellAt(m.cell);r.shots.push({id:crypto.randomUUID(),owner:m.p.id,target:e.id,from:at,to:[e.x,e.y],time:.24});}
 }
 tick(){
  const now=this.now(),dt=Math.min(.25,Math.max(0,(now-this.last)/1000));this.last=now;
  for(const r of this.rooms.values()){
   if(now-r.activity>45*60000||now-r.started>2*3600000){for(const m of [...r.players.values()]){this.error(m.p,'room_expired');this.leave(m.p);}continue;}
   if(r.phase==='wave'){
    r.spawn-=dt;if(r.remaining>0&&r.spawn<=0&&r.enemies.length<16){if(this.spawn(r)){r.remaining--;r.spawn=Math.max(.8,2.8-r.map*.25-r.chapter*.1-r.wave*.08)/Math.sqrt(r.players.size);}}
    if(!r.remaining&&r.bossPending&&r.enemies.length<16){if(this.spawn(r,true))r.bossPending=false;}
    for(const s of r.shots){s.time-=dt;if(s.time<=0){const e=r.enemies.find(e=>e.id===s.target);if(e){e.hp--;if(e.hp<=0)r.enemies=r.enemies.filter(o=>o!==e);else{e.word=this.word(r)||e.word;for(const m of r.players.values())if(m.target===e.id){m.target=0;m.typed='';}}}}}
    r.shots=r.shots.filter(s=>s.time>0);
    for(const e of r.enemies){e.progress+=dt*(e.boss?24:31+r.map*3+r.chapter*1.2+r.wave*1.1);[e.x,e.y]=point(RULES.maps[r.map].path,e.progress);if(e.progress>=length(RULES.maps[r.map].path)){r.hp-=e.boss?8:1;e.hp=0;}}
    r.enemies=r.enemies.filter(e=>e.hp>0);
    if(r.hp<=0){r.hp=0;r.phase='defeat';r.shots=[];}
    else if(!r.remaining&&!r.bossPending&&!r.enemies.length&&!r.shots.length){r.phase='break';r.wait=3;}
   }else if(r.phase==='break'){
    r.wait-=dt;if(r.wait<=0){if(r.wave<5){r.wave++;this.wave(r);}else if(r.map===2&&r.chapter===5){r.phase='victory';this.reward(r);}else{r.chapter++;if(r.chapter>5){r.chapter=1;r.map++;}r.phase='placement';r.wave=0;for(const m of r.players.values()){m.ready=false;if(!validCell(r.map,m.cell))m.cell=-1;}}}
   }
  }
  if(now-this.broadcastAt>=100){this.broadcastAt=now;for(const r of this.rooms.values())if(r.phase!=='lobby')this.publish(r);}
 }
 reward(r){for(const m of r.players.values())if(m.hits>0&&m.p.seasonKey){const rewards=this.pending.get(m.p.seasonKey)||[];const id='td:'+r.id;if(!rewards.some(a=>a.id===id)&&rewards.length<64)rewards.push({id,...RULES.rewards});this.pending.set(m.p.seasonKey,rewards);}}
 view(r){return {code:r.code,host:r.host,quick:r.quick,phase:r.phase,map:r.map,chapter:r.chapter,wave:r.wave,hp:r.hp,remaining:r.remaining+(r.bossPending?1:0),wait:r.wait,enemies:r.enemies.map(e=>({...e})),shots:r.shots.map(s=>({...s})),players:[...r.players.values()].map(m=>({id:m.p.id,name:m.p.name,class:m.p.class,skin:m.p.skin,cell:m.cell,ready:m.ready,typed:m.typed,target:m.target,seq:m.seq,hits:m.hits}))};}
 snapshot(p){const r=this.room(p);this.send(p,{type:'tower_defense',event:'state',state:r?this.view(r):{},receipts:this.pending.get(p.seasonKey)||[]});}
 publish(r){for(const m of r.players.values())this.snapshot(m.p);}
 previews(p){this.send(p,{type:'tower_defense',event:'previews',matches:[...this.rooms.values()].filter(r=>['wave','break','placement'].includes(r.phase)).slice(0,6).map(r=>this.view(r))});}
 leave(p){const r=this.room(p);this.members.delete(p.id);this.clients.delete(p.id);if(!r)return;r.players.delete(p.id);if(!r.players.size){this.rooms.delete(r.code);return;}if(r.host===p.id)r.host=r.players.keys().next().value;if(r.phase==='placement'&&[...r.players.values()].every(m=>m.ready)){r.wave=1;this.wave(r);}this.publish(r);}
}
module.exports={TowerDefense,RULES,point,length,cellAt,validCell};
