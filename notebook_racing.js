'use strict';
const crypto=require('node:crypto'),RULES=require('./notebook_racing.json');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function look(value){const result={};for(const [key,options]of Object.entries(RULES.catalog))result[key]=options.some(o=>o.id===value?.[key])?value[key]:RULES.defaultLook[key];return result;}
class NotebookRacing{
 constructor(send,{now=()=>Date.now(),random=Math.random,busy=()=>false}={}){this.send=send;this.now=now;this.random=random;this.busyOther=busy;this.rooms=new Map();this.members=new Map();this.pending=new Map();this.last=now();this.broadcastAt=0;}
 room(p){return this.rooms.get(this.members.get(p.id));}
 busy(p){return !!this.room(p);}
 error(p,reason){this.send(p,{type:'notebook_racing',event:'error',reason});}
 action(p,d){
  if(p.zone!=='minigame_hub')return this.error(p,'enter_minigame_hub');
  const now=this.now();p.raceRate ||= {at:now,count:0};if(now-p.raceRate.at>=1000)p.raceRate={at:now,count:0};if(++p.raceRate.count>60)return;
  if(d.action==='snapshot'){this.snapshot(p);return;}
  if(d.action==='ack'){const receipts=(this.pending.get(p.seasonKey)||[]).filter(r=>r.id!==d.id);if(receipts.length)this.pending.set(p.seasonKey,receipts);else this.pending.delete(p.seasonKey);return;}
  if(d.action==='leave'){this.leave(p);this.snapshot(p);return;}
  if(['create','quick','join'].includes(d.action)){
   if(this.room(p)||this.busyOther(p)||p.dead)return this.error(p,'leave_current_game_first');
   let room;
   if(d.action==='join'){
    room=this.rooms.get(typeof d.code==='string'?d.code.trim().toUpperCase():'');
    if(!room||!room.private)return this.error(p,'room_not_found');
    if(!['lobby','queued'].includes(room.phase)||room.racers.size>=RULES.capacity)return this.error(p,'room_full_or_started');
   }else if(d.action==='quick')room=[...this.rooms.values()].find(r=>!r.private&&r.phase==='queued'&&r.racers.size<RULES.capacity);
   if(!room){if(this.rooms.size>=100)return this.error(p,'server_busy');let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase();}while(this.rooms.has(code));room={id:crypto.randomUUID(),code,private:d.action==='create',host:p.id,phase:d.action==='create'?'lobby':'queued',createdAt:now,queuedAt:now,startedAt:0,endedAt:0,racers:new Map(),words:[],finishers:[]};this.rooms.set(code,room);}
   const racer={id:p.id,p,npc:false,name:p.name,class:p.class,look:look(d.look),lane:room.racers.size,distance:0,speed:0,seq:0,lastKey:0,buffer:'',wordIndex:0,correct:0,chars:0,errors:0,strokes:0,events:[],penaltyUntil:0,finishAt:0,place:0,left:false,rewarded:false,aiAt:0,aiMistake:false};
   room.racers.set(p.id,racer);this.members.set(p.id,room.code);
   if(room.phase==='queued'&&room.racers.size===RULES.capacity)this.start(room);
   this.publish(room);return;
  }
  const room=this.room(p),m=room?.racers.get(p.id);if(!room||!m||m.left)return;
  if(d.action==='start'&&room.phase==='lobby'){
   if(room.host!==p.id)return this.error(p,'only_host_can_start');
   room.phase='queued';room.queuedAt=now;if(room.racers.size===RULES.capacity)this.start(room);this.publish(room);return;
  }
  if(d.action==='key')this.key(room,m,d,now);
 }
 start(r){if(r.phase!=='queued')return;
  while(r.racers.size<RULES.capacity){const i=r.racers.size,id='racebot:'+crypto.randomUUID();const colors=RULES.catalog.color;r.racers.set(id,{id,p:null,npc:true,name:['Pip','Sprig','Nora','Fenn','Lumi','Ash','Moss','Echo'][i]+' • AI',class:['Banker','Vampire','Speedster','Politician'][i%4],look:{body:RULES.catalog.body[i%4].id,color:colors[i%colors.length].id,wheels:RULES.catalog.wheels[i%4].id,decal:RULES.catalog.decal[i%4].id,spoiler:RULES.catalog.spoiler[i%3].id},lane:i,distance:0,speed:0,seq:0,lastKey:0,buffer:'',wordIndex:0,correct:0,chars:0,errors:0,strokes:0,events:[],penaltyUntil:0,finishAt:0,place:0,left:false,rewarded:false,aiAt:0,aiMistake:false,aiInterval:150+this.random()*190});}
  let lane=0;for(const m of r.racers.values())m.lane=lane++;
  for(let i=0;i<600;i++)r.words.push(RULES.words[Math.floor(this.random()*RULES.words.length)]);
  r.phase='countdown';r.startedAt=this.now()+RULES.countdownSeconds*1000;this.publish(r);
 }
 word(r,m){return r.words[m.wordIndex%r.words.length]||'';}
 key(r,m,d,now){
  if(r.phase!=='racing'||m.left||m.finishAt||!Number.isInteger(d.seq)||d.seq!==m.seq+1||typeof d.key!=='string'||!(/^[A-Z]$/.test(d.key)||['BACKSPACE','SUBMIT'].includes(d.key)))return;
  m.seq=d.seq;
  // A TCP frame may deliver several legitimate keystrokes together. Bound the
  // average input rate while allowing a short burst instead of losing letters.
  m.inputBudget=Math.min(12,(m.inputBudget??12)+Math.max(0,now-(m.budgetAt??now))/RULES.keyInterval);m.budgetAt=now;
  if(m.inputBudget<1)return;m.inputBudget--;m.lastKey=now;m.strokes++;
  if(d.key==='BACKSPACE'){m.buffer=m.buffer.slice(0,-1);return;}
  if(d.key==='SUBMIT'){
   if(!m.buffer)return;
   if(m.buffer===this.word(r,m)){m.correct++;m.chars+=m.buffer.length+1;m.events.push({at:now,chars:m.buffer.length+1});m.wordIndex++;}
   else{m.errors++;m.speed*=.55;m.penaltyUntil=now+3000;}
   m.buffer='';return;
  }
  if(m.buffer.length<24)m.buffer+=d.key;
 }
 bot(r,m){const now=this.now();if(now<m.aiAt||m.finishAt)return;
  const word=this.word(r,m),index=m.buffer.length;
  if(index===0)m.aiMistake=this.random()<.14;
  const key=index>=word.length?'SUBMIT':m.aiMistake&&index===1?'Z':word[index];
  this.key(r,m,{seq:m.seq+1,key},now);m.aiAt=now+m.aiInterval*(.8+this.random()*.4);
 }
 tick(){const now=this.now(),dt=Math.min(.15,Math.max(0,(now-this.last)/1000));this.last=now;
  for(const r of [...this.rooms.values()]){
   if(r.phase==='lobby'&&now-r.createdAt>30*60000){for(const m of [...r.racers.values()])if(m.p)this.leave(m.p);continue;}
   if(r.phase==='queued'&&now-r.queuedAt>=RULES.queueSeconds*1000)this.start(r);
   if(r.phase==='countdown'&&now>=r.startedAt)r.phase='racing';
   if(r.phase==='racing'){
    const crossings=[];
    for(const m of r.racers.values()){
     if(m.finishAt||m.left)continue;if(m.npc)this.bot(r,m);
     m.events=m.events.filter(e=>now-e.at<8000);
     const chars=m.events.reduce((n,e)=>n+e.chars,0),window=Math.max(2,Math.min(8,(now-r.startedAt)/1000));
     const recent=m.events.length?now-m.events.at(-1).at:Infinity;
     const target=recent<8000?clamp((8+chars/window*12)*(now<m.penaltyUntil?.6:1)*clamp((8000-recent)/4000,0,1),0,RULES.maxSpeed):0;
     m.speed+=(target-m.speed)*(1-Math.exp(-dt*3));const before=m.distance;m.distance=Math.min(RULES.length,m.distance+m.speed*dt);
     if(m.distance>=RULES.length){m.finishAt=now-dt*1000+(RULES.length-before)/Math.max(.001,m.speed)*1000;crossings.push(m);m.speed=0;}
    }
    crossings.sort((a,b)=>a.finishAt-b.finishAt||a.id.localeCompare(b.id));
    for(const m of crossings){r.finishers.push(m.id);m.place=r.finishers.length;this.award(r,m);}
    if([...r.racers.values()].every(m=>m.finishAt||m.left)||now-r.startedAt>=RULES.maxSeconds*1000){r.phase='finished';r.endedAt=now;for(const m of r.racers.values())m.speed=0;}
   }
   if(r.phase==='finished'&&now-r.endedAt>120000){for(const m of r.racers.values())if(m.p){this.members.delete(m.id);this.snapshot(m.p);}this.rooms.delete(r.code);}
  }
  if(now-this.broadcastAt>=100){this.broadcastAt=now;for(const r of this.rooms.values())if(r.phase!=='lobby')this.publish(r);}
 }
 award(r,m){if(m.rewarded||m.npc||m.left||!m.p?.seasonKey||m.correct<3)return;m.rewarded=true;const podium=RULES.podium[m.place-1]||{xp:0,medals:0},id='rc:'+r.id,receipts=this.pending.get(m.p.seasonKey)||[];if(!receipts.some(v=>v.id===id)&&receipts.length<64)receipts.push({id,place:m.place,xp:podium.xp,medals:podium.medals});this.pending.set(m.p.seasonKey,receipts);}
 publicRacer(m){return {id:m.id,name:m.name,class:m.class,npc:m.npc,lane:m.lane,look:m.look,distance:m.distance,speed:m.speed,correct:m.correct,errors:m.errors,place:m.place,finishAt:m.finishAt,left:m.left};}
 view(r,p){const m=r.racers.get(p.id);return {id:r.id,code:r.private?r.code:'',private:r.private,host:r.host,phase:r.phase,length:RULES.length,left:Math.max(0,RULES.queueSeconds-(this.now()-r.queuedAt)/1000),countdown:Math.max(0,(r.startedAt-this.now())/1000),elapsed:r.startedAt?Math.max(0,(this.now()-r.startedAt)/1000):0,humans:[...r.racers.values()].filter(a=>!a.npc).length,bots:[...r.racers.values()].filter(a=>a.npc).length,players:[...r.racers.values()].map(a=>this.publicRacer(a)),me:m?{...this.publicRacer(m),seq:m.seq,buffer:m.buffer,word:this.word(r,m),upcoming:r.words.slice(m.wordIndex+1,m.wordIndex+5),penalty:this.now()<m.penaltyUntil,wpm:r.startedAt?m.chars/5/Math.max(1/60,(this.now()-r.startedAt)/60000):0}:null};}
 snapshot(p){const r=this.room(p);this.send(p,{type:'notebook_racing',event:'state',state:r?this.view(r,p):{},receipts:this.pending.get(p.seasonKey)||[]});}
 publish(r){for(const m of r.racers.values())if(m.p&&!m.left)this.snapshot(m.p);}
 previews(p){this.send(p,{type:'notebook_racing',event:'previews',matches:[...this.rooms.values()].filter(r=>['countdown','racing'].includes(r.phase)).slice(0,3).map(r=>({game:'race',phase:r.phase,map:0,length:RULES.length,finished:r.finishers.length,players:[...r.racers.values()].map(m=>this.publicRacer(m))}))});}
 leave(p){const r=this.room(p);this.members.delete(p.id);if(!r)return;const m=r.racers.get(p.id);if(['lobby','queued'].includes(r.phase))r.racers.delete(p.id);else if(m){m.left=true;m.speed=0;m.p=null;}
  const people=[...r.racers.values()].filter(a=>a.p&&!a.left);if(!people.length){this.rooms.delete(r.code);return;}if(r.host===p.id)r.host=people[0].id;this.publish(r);
 }
}
module.exports={NotebookRacing,RULES,look};
