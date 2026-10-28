'use strict';
const rules=require('./city_raids.json');
const {normalizeLetter}=require('./typing_input');
const POSITIONS=rules.bosses.map(b=>b.at);
const ms=n=>n*1000;

// The season identity/store supplies persistent reward deduplication across
// reconnects, room changes and process restarts. It grants no season score.
class CityRaids {
 constructor(ledger,{now=()=>Date.now(),busy=()=>false}={}){this.ledger=ledger;this.now=now;this.busy=busy;}
 account(p){return this.ledger.state.accounts[p.seasonKey];}
 active(room,p){return room.zone==='city'&&!!p.cityRaidActive&&[...this.states(room).values()].some(s=>s.phase==='active'&&s.members.get(p.seasonKey)?.id===p.id);}
 send(room,p,extra={}){
  if(p.ws.readyState!==1)return;
  const bosses=[...this.states(room).values()].map(s=>this.public(room,s));
  const owned=[...this.states(room).values()].filter(s=>s.members.get(p.seasonKey)?.id===p.id);
  const state=owned.find(s=>['gathering','active'].includes(s.phase))||owned[0];
  const r=state?.members.get(p.seasonKey);
  p.ws.send(JSON.stringify({type:'city_raid',zone:'city',room_id:room.id,server_time:this.now(),bosses,soul:p.soul,max_soul:p.max_soul,
   self:r?{boss:state.def.id,cycle:state.cycle,seq:r.seq,word:r.word,typed:r.typed,soul:p.soul,max_soul:p.max_soul,damage:r.damage,words:r.words}:null,
   rewards:this.account(p)?.cityRaidRewards||[],...extra}));
 }
 states(room){
  if(!room.cityRaids)room.cityRaids=new Map(rules.bosses.map((def,i)=>[def.id,{def,at:POSITIONS[i],cycle:'',phase:'scheduled',members:new Map(),hazards:[],revision:0,lastSend:0}]));
  return room.cityRaids;
 }
 present(room,s,r){
  const p=room.players.get(r.id);
  return p&&p.seasonKey===r.key&&!p.npc&&!p.dead&&p.soul>0&&p.ws.readyState===1&&p.level>=s.def.level&&Math.hypot(p.x-s.at[0],p.y-s.at[1])<=rules.radius;
 }
 participants(room,s){return [...s.members.values()].filter(r=>this.present(room,s,r));}
 typers(room,s){return this.participants(room,s).filter(r=>this.now()-r.lastInput<=15000);}
 public(room,s){
  return {id:s.def.id,cycle:s.cycle,phase:s.phase,hp:s.hp??s.def.hp,max_hp:s.maxHp??s.def.hp,
   starts_at:s.startsAt||0,ends_at:s.endsAt||0,next_at:s.nextAt||0,until:s.until||0,quorum:s.quorumSince>0,
   participants:this.participants(room,s).map(r=>{const p=room.players.get(r.id);return {id:p.id,name:p.name,x:p.x,y:p.y,damage:r.damage,last_input:r.lastInput};}),
   hazards:s.hazards.map(h=>({x:h.x,y:h.y,radius:85,at:h.at}))};
 }
 newWord(s,r){r.word=s.def.words[r.words%s.def.words.length];r.typed=0;}
 action(room,p,m){
  if(room.zone!=='city'||p.city_raid_protocol!==1||!p.seasonKey||!this.account(p))return;
  if(m.action==='ack'){
   const account=this.account(p);
   if((account.cityRaidRewards||[]).some(r=>r.id===m.receipt))this.ledger.transaction(()=>{account.cityRaidRewards=account.cityRaidRewards.filter(r=>r.id!==m.receipt);});
   this.send(room,p);return;
  }
  this.tick(room,false);
  if(m.action==='snapshot'){this.send(room,p);return;}
  const s=this.states(room).get(m.boss);if(!s)return;
  if(m.action==='leave'){this.leave(room,p);this.send(room,p);return;}
  if(m.action==='join'){
   const previous=s.members.get(p.seasonKey);
   if(p.npc||p.dead||p.soul<=0||p.level<s.def.level||Math.hypot(p.x-s.at[0],p.y-s.at[1])>rules.radius||this.busy(room,p)||
      !['gathering','active'].includes(s.phase)||(!previous&&s.members.size>=rules.maximum_players)){this.send(room,p,{error:'Raid needs 3–5 real players at the required level, inside the arena. Join during gathering.'});return;}
   if((this.account(p).cityRaidCycles||[]).includes(s.cycle)){this.send(room,p,{error:'This raid cycle was already rewarded.'});return;}
   if(previous&&previous.id!==p.id){const displaced=room.players.get(previous.id);if(displaced)displaced.cityRaidActive=false;}
   this.leave(room,p);
   const r=previous||{id:p.id,key:p.seasonKey,seq:0,words:0,damage:0,typed:0,lastInput:this.now(),lastToken:this.now(),tokens:3,joined:this.now()};
   r.id=p.id;this.newWord(s,r);s.members.set(p.seasonKey,r);p.cityRaidActive=true;
   if(s.phase==='active'){
    const targetHp=Math.round(s.def.hp*(1+.2*Math.max(0,this.participants(room,s).length-3)));
    if(targetHp>s.maxHp){s.hp+=targetHp-s.maxHp;s.maxHp=targetHp;}
   }
   this.send(room,p);return;
  }
  const r=s.members.get(p.seasonKey);
  if(m.action!=='key'||m.cycle!==s.cycle||s.phase!=='active'||!r||r.id!==p.id||!this.present(room,s,r))return;
  if(!Number.isInteger(m.seq)||m.seq!==r.seq+1){this.send(room,p,{reset_seq:true});return;}
  r.seq=m.seq;
  if(typeof m.letter!=='string'||Array.from(m.letter).length!==1||!/^\p{L}$/u.test(m.letter)){this.send(room,p);return;}
  r.tokens=Math.min(3,r.tokens+(this.now()-r.lastToken)/100);r.lastToken=this.now();
  if(r.tokens<1){this.send(room,p);return;}r.tokens--;
  r.lastInput=this.now();
  // No damage can be dealt while a member has disconnected or stopped typing.
  if(this.typers(room,s).length<rules.minimum_players){this.send(room,p);return;}
  if(normalizeLetter(m.letter)!==normalizeLetter(r.word[r.typed])){
   this.damagePlayer(p,Math.min(6,p.max_soul*.01));this.send(room,p);return;
  }
  r.typed++;let damage=rules.letter_damage;
  if(r.typed===r.word.length){r.words++;damage+=rules.word_damage;this.newWord(s,r);}
  const applied=Math.min(s.hp,damage);r.damage+=applied;s.hp-=applied;
  if(s.hp<=0)this.finish(room,s);
  this.send(room,p);
 }
 damagePlayer(p,amount){p.soul=Math.max(0,p.soul-amount);if(p.soul<=0)p.dead=true;}
 leave(room,p){
  if(room.cityRaids)for(const s of room.cityRaids.values()){
   const r=s.members.get(p.seasonKey);
   if(r?.id===p.id){if(s.phase==='gathering')s.members.delete(p.seasonKey);else r.id='';}
  }
  p.cityRaidActive=false;p.soul_lock_until=this.now()+2000;
 }
 finish(room,s){
  const eligible=this.participants(room,s).filter(r=>r.words>=6&&r.damage>=s.maxHp*.02&&this.now()-r.lastInput<=15000&&this.now()-r.joined>=20000);
  // Commit rewards before announcing victory; on disk failure remain failed,
  // never allow an uncommitted success or repeat kill to mint another reward.
  try{this.ledger.transaction(()=>{
   for(const r of eligible){const a=this.ledger.state.accounts[r.key];if((a.cityRaidCycles||[]).includes(s.cycle))continue;
    a.cityRaidCycles=[...(a.cityRaidCycles||[]),s.cycle].slice(-64);
    a.cityRaidRewards=[...(a.cityRaidRewards||[]),{id:s.cycle,boss:s.def.id,xp:s.def.xp,coins:s.def.coins}].slice(-12);
   }
  });s.phase='defeated';}catch(error){s.phase='failed';}
  for(const r of s.members.values()){const p=room.players.get(r.id);if(p){p.cityRaidActive=false;p.soul_lock_until=this.now()+2000;}}
  s.hazards=[];s.until=s.nextAt;
 }
 tick(room,broadcast=true){
  if(room.zone!=='city')return;
  const now=this.now();
  for(const s of this.states(room).values()){
   const start=(Math.floor((now-ms(s.def.offset_seconds))/ms(rules.period_seconds))*ms(rules.period_seconds))+ms(s.def.offset_seconds);
   const cycle=`cityraid:${s.def.id}:${start}`;
   if(s.cycle!==cycle){
    for(const r of s.members.values()){const p=room.players.get(r.id);if(p){p.cityRaidActive=false;p.soul_lock_until=this.now()+2000;}}
    Object.assign(s,{cycle,phase:'scheduled',members:new Map(),hp:s.def.hp,maxHp:s.def.hp,hazards:[],startsAt:start,endsAt:start+ms(rules.window_seconds),nextAt:start+ms(rules.period_seconds),until:0,quorumSince:0,attackAt:0,readyAt:0,attackIndex:0});
   }
   if(s.phase==='scheduled'&&now<s.endsAt){s.phase='gathering';s.until=s.endsAt-ms(rules.fight_seconds);}
   if(s.phase==='gathering'){
    for(const [key,r]of s.members)if(!this.present(room,s,r)){const p=room.players.get(r.id);if(p){p.cityRaidActive=false;p.soul_lock_until=this.now()+2000;}s.members.delete(key);}
    const count=this.participants(room,s).length;
    if(now>=s.endsAt-ms(rules.fight_seconds)){s.phase='failed';}
    else if(count>=rules.minimum_players){
     if(!s.readyAt)s.readyAt=now+ms(rules.ready_seconds);
     s.until=s.readyAt;
     if(now>=s.readyAt){s.phase='active';s.maxHp=Math.round(s.def.hp*(1+.2*Math.max(0,count-3)));s.hp=s.maxHp;s.until=now+ms(rules.fight_seconds);s.attackAt=now+4000;for(const r of s.members.values())r.lastInput=now;}
    }else{s.readyAt=0;s.until=s.endsAt-ms(rules.fight_seconds);}
   }
   if(s.phase==='active'){
    if(now>=s.until)s.phase='failed';
    else if(this.typers(room,s).length<rules.minimum_players){
     if(!s.quorumSince)s.quorumSince=now;
     s.hazards=[];
     if(now-s.quorumSince>=ms(rules.quorum_grace_seconds))s.phase='failed';
    }else{
     s.quorumSince=0;
     for(const h of s.hazards)if(now>=h.at){for(const r of this.participants(room,s)){const p=room.players.get(r.id);if(Math.hypot(p.x-h.x,p.y-h.y)<=85)this.damagePlayer(p,p.max_soul*.22);}}
     s.hazards=s.hazards.filter(h=>h.at>now);
     if(now>=s.attackAt){const targets=this.participants(room,s);const r=targets[(s.attackIndex||0)%targets.length];const p=room.players.get(r.id);s.attackIndex=(s.attackIndex||0)+1;s.attackAt=now+4000;s.hazards.push({x:p.x,y:p.y,at:now+1600});}
    }
   }
   if(s.phase==='failed'||s.phase==='defeated'){for(const r of s.members.values()){const p=room.players.get(r.id);if(p){p.cityRaidActive=false;p.soul_lock_until=this.now()+2000;}}s.hazards=[];s.until=s.nextAt;}
  }
  const interval=[...room.cityRaids.values()].some(s=>s.phase==='active')?200:1000;
  if(broadcast&&now-(room.lastCityRaidSend||0)>=interval){room.lastCityRaidSend=now;for(const p of room.players.values())if(p.city_raid_protocol===1)this.send(room,p);}
 }
}
module.exports={CityRaids,rules,POSITIONS};
