'use strict';
const crypto = require('crypto');
const rules = require('./forest_expedition.json');
const WORLD = 'unsealed_forest', RAID = 'forest_raid';
const distance = (a,b) => Math.hypot(a.x-b[0],a.y-b[1]);
const inPvp = p => p.zone === WORLD && distance(p,rules.source) < rules.pvp_radius;

// Shared public enemies, private group instances, typed challenges and rewards
// are resolved here. Clients send intentions, never damage/loot/party size.
class Expeditions {
  constructor(send, now=()=>Date.now()) {
    this.send=send; this.now=now; this.players=new Map(); this.accounts=new Map();
    this.worlds=new Map(); this.runs=new Map(); this.parties=new Map(); this.queue=[];
  }
  account(id) {
    if(!this.accounts.has(id)) this.accounts.set(id,{hp:100,carried:0,target:'',word:0,typed:0,lastLetter:0,protection:0,receipts:[],party:'',ticket:'',harvest:0,nextHarvest:0,raidClaimed:false});
    return this.accounts.get(id);
  }
  tell(p,payload) { this.send(p,{type:'expedition',...payload}); }
  error(p,reason) {this.tell(p,{event:'error',reason});return false;}
  makeEnemies(raid,size=1) {
    return (raid?rules.raid_enemies:rules.world_enemies).map(e=>({...e,home:[...e.at],at:[...e.at],hp:Math.round(e.hp*(raid?1+(size-1)*.55:1)),max:Math.round(e.hp*(raid?1+(size-1)*.55:1)),cycle:0,respawn:0,attack:0,contributors:new Set()}));
  }
  authorize(id,ticket) {
    const a=this.account(id), run=this.runs.get(ticket);
    return !!run && a.ticket===ticket && run.members.includes(id) && this.now()-run.created<45*60*1000;
  }
  join(p,room) {
    this.players.set(p.id,p); p.expeditionRoom=room.id;
    const a=this.account(p.id); a.target=''; a.harvest=0;
    if(p.zone===WORLD && !this.worlds.has(room.id)) this.worlds.set(room.id,{enemies:this.makeEnemies(false),stage:0});
    this.snapshot(p);
  }
  leave(p,disconnect=false) {
    const a=this.accounts.get(p.id);
    if(a) {a.target='';a.harvest=0;}
    this.queue=this.queue.filter(id=>id!==p.id);
    this.players.delete(p.id);
    if(disconnect && a) {
      const run=this.runs.get(a.ticket);
      if(run){
        run.members=run.members.filter(id=>id!==p.id);
        if(run.members.length===1){
          run.solo=true;run.runes=[];run.runeUsers=[];
          for(const e of run.enemies){const ratio=e.hp/e.max;e.max=rules.raid_enemies.find(base=>base.id===e.id).hp;e.hp=Math.ceil(e.max*ratio);}
        }
      }
      const party=this.parties.get(a.party);
      if(party) {party.members=party.members.filter(id=>id!==p.id);if(party.members.length) party.leader=party.members[0];else this.parties.delete(a.party);}
      this.accounts.delete(p.id);
    }
  }
  state(p) {return p.zone===RAID?this.runs.get(this.account(p.id).ticket):this.worlds.get(p.expeditionRoom);}
  partyView(a) {
    const party=this.parties.get(a.party);
    return party?{code:a.party,leader:party.leader,members:party.members.map(id=>({id,name:this.players.get(id)?.name||'Travelling',hp:this.account(id).hp}))}:{};
  }
  snapshot(p) {
    if(![WORLD,RAID].includes(p.zone)) return;
    const a=this.account(p.id),s=this.state(p); if(!s)return;
    this.tell(p,{event:'state',zone:p.zone,hp:a.hp,carried:a.carried,target:a.target,word:rules.words[a.word%rules.words.length],typed:a.typed,
      party:this.partyView(a),queued:this.queue.includes(p.id),receipts:a.receipts,stage:s.stage||0,runes:s.runes||[],
      solo:s.solo??true,sourceRemaining:a.harvest?Math.max(0,(a.harvest+rules.source_channel*1000-this.now())/1000):0,
      protection:Math.max(0,(a.protection-this.now())/1000),enemies:s.enemies.map(e=>({id:e.id,at:e.at,hp:e.hp,max:e.max,cycle:e.cycle,attack:e.attack?Math.max(0,(e.attack-this.now())/1000):0}))});
  }
  available(p) {return p.zone===WORLD && distance(p,rules.raid_gate)<230 && !this.account(p.id).target;}
  startRun(ids,solo) {
    const ticket=crypto.randomUUID(),run={ticket,members:[...ids],solo,created:this.now(),stage:0,runes:[],runeUsers:[],runeUntil:0,enemies:this.makeEnemies(true,ids.length),contributors:new Set()};
    this.runs.set(ticket,run);
    for(const id of ids){const p=this.players.get(id),a=this.account(id);a.ticket=ticket;a.raidClaimed=false;a.target='';this.queue=this.queue.filter(x=>x!==id);if(p)this.tell(p,{event:'raid_ready',ticket,solo,size:ids.length});}
  }
  knockOut(p) {
    const a=this.account(p.id);a.carried=Math.floor(a.carried*.5);a.hp=100;a.target='';a.harvest=0;a.protection=this.now()+8000;
    this.tell(p,{event:'knockout',at:p.zone===RAID?[500,1650]:rules.camp,carried:a.carried});
    [p.x,p.y]=p.zone===RAID?[500,1650]:rules.camp;
  }
  damage(p,n) {const a=this.account(p.id);if(a.protection>this.now())return;a.hp=Math.max(0,a.hp-n);if(!a.hp)this.knockOut(p);}
  action(p,m) {
    const a=this.account(p.id),s=this.state(p),now=this.now();
    if(!s)return this.error(p,'expedition_unavailable');
    if(m.action==='ack'){a.receipts=a.receipts.filter(r=>r.id!==m.id);return true;}
    if(m.action==='cancel'){a.target='';a.harvest=0;return true;}
    if(m.action==='bank') {
      if(p.zone!==WORLD||distance(p,rules.camp)>300||!a.carried)return this.error(p,'return_to_camp');
      a.receipts.push({id:crypto.randomUUID(),shards:a.carried,xp:a.carried*3});a.carried=0;return true;
    }
    if(m.action==='harvest') {
      if(!inPvp(p)||distance(p,rules.source)>170||a.target||now<a.nextHarvest)return this.error(p,'source_not_ready');
      a.harvest=now;return true;
    }
    if(m.action==='solo'||m.action==='queue'||m.action==='party_create'||m.action==='party_join'||m.action==='party_start') {
      if(!this.available(p))return this.error(p,'stand_at_raid_gate');
      if(m.action==='solo'){this.startRun([p.id],true);return true;}
      if(m.action==='queue') {if(a.party)return this.error(p,'leave_party_first');if(!this.queue.includes(p.id))this.queue.push(p.id);this.match();return true;}
      if(m.action==='party_create'){if(a.party)return this.error(p,'already_in_party');a.party=crypto.randomBytes(3).toString('hex').toUpperCase();this.parties.set(a.party,{leader:p.id,members:[p.id]});return true;}
      if(m.action==='party_join') {
        const party=this.parties.get(String(m.code).toUpperCase());
        if(a.party||!party||party.members.length>=4)return this.error(p,'party_unavailable');
        a.party=String(m.code).toUpperCase();party.members.push(p.id);return true;
      }
      const party=this.parties.get(a.party);
      if(!party||party.leader!==p.id||party.members.length<2||!party.members.every(id=>this.players.has(id)&&this.available(this.players.get(id))))return this.error(p,'need_2_to_4_at_gate');
      this.startRun(party.members,false);return true;
    }
    if(m.action==='queue_cancel'){this.queue=this.queue.filter(id=>id!==p.id);return true;}
    if(m.action==='party_leave'){const party=this.parties.get(a.party);if(party){party.members=party.members.filter(id=>id!==p.id);if(!party.members.length)this.parties.delete(a.party);else party.leader=party.members[0];}a.party='';return true;}
    if(m.action==='rune') {
      if(p.zone!==RAID||s.stage!==1||![0,1].includes(m.index)||distance(p,rules.runes[m.index])>180)return this.error(p,'rune_unavailable');
      if(s.enemies.some(e=>e.room===1&&e.hp>0))return this.error(p,'clear_crypt_guards_first');
      if(s.runes.includes(m.index))return false;
      if(!s.solo&&s.runeUsers.includes(p.id))return this.error(p,'another_teammate_needed');
      s.runes.push(m.index);s.runeUsers.push(p.id);s.contributors.add(p.id);s.runeUntil=now+(s.solo?30000:12000);
      if(s.runes.length===2)s.stage=2;return true;
    }
    if(m.action==='raid_claim') {
      if(p.zone!==RAID||s.stage!==3||a.raidClaimed||distance(p,rules.chest)>200||!s.contributors.has(p.id))return this.error(p,'raid_reward_unavailable');
      a.raidClaimed=true;a.receipts.push({id:s.ticket+':'+p.id,shards:s.solo?75:110,xp:s.solo?250:380});return true;
    }
    if(m.action==='engage') {
      const e=s.enemies.find(e=>e.id===m.target);
      if(!e||e.hp<=0||distance(p,e.at)>240||(p.zone===RAID&&(e.room??0)!==s.stage))return this.error(p,'target_unavailable');
      a.target=e.id;a.word=(a.word+1)%rules.words.length;a.typed=0;a.harvest=0;if(!e.attack)e.attack=now+4000;return true;
    }
    if(m.action==='pvp') {
      const rival=this.players.get(m.target);
      if(!rival||rival.id===p.id||rival.expeditionRoom!==p.expeditionRoom||!inPvp(p)||!inPvp(rival)||distance(p,[rival.x,rival.y])>230||a.protection>now||this.account(rival.id).protection>now||(a.party&&a.party===this.account(rival.id).party))return this.error(p,'pvp_only_in_red_area');
      const other=this.account(rival.id);if(a.target||other.target)return this.error(p,'opponent_busy');
      a.target='pvp:'+rival.id;other.target='pvp:'+p.id;a.typed=other.typed=0;a.harvest=other.harvest=0;return true;
    }
    if(m.action==='letter') {
      if(typeof m.letter!=='string'||m.letter.length!==1||now-a.lastLetter<35||!a.target)return false;
      a.lastLetter=now;
      let e=s.enemies.find(e=>e.id===a.target), rival=a.target.startsWith('pvp:')?this.players.get(a.target.slice(4)):null;
      if(rival){if(!inPvp(p)||!inPvp(rival)||rival.expeditionRoom!==p.expeditionRoom||distance(p,[rival.x,rival.y])>600){a.target='';return false;}}
      else if(!e||e.hp<=0||distance(p,e.at)>850){a.target='';return false;}
      if(e&&distance(p,e.at)>(e.boss?420:240))return false;
      if(m.letter.toUpperCase()!==rules.words[a.word%rules.words.length][a.typed]){this.damage(p,2);return false;}
      a.typed++;if(a.typed<rules.words[a.word%rules.words.length].length)return true;
      a.typed=0;a.word=(a.word+1)%rules.words.length;a.hp=Math.min(100,a.hp+rules.word_heal);
      if(rival){this.damage(rival,17);if(this.account(rival.id).target==='')a.target='';return true;}
      e.hp=Math.max(0,e.hp-rules.attack_damage);e.contributors.add(p.id);if(p.zone===RAID)s.contributors.add(p.id);
      if(!e.boss)e.attack=now+4000;
      if(!e.hp){
        e.attack=0;e.respawn=now+(e.boss?rules.boss_respawn:rules.mob_respawn)*1000;
        for(const id of e.contributors){const member=this.players.get(id);if(member&&member.expeditionRoom===p.expeditionRoom&&distance(member,e.at)<1200){const receiver=this.account(id);receiver.carried+=e.loot;if(receiver.target===e.id)receiver.target='';}}
        if(p.zone===RAID){if(e.id==='king')s.stage=3;else if(s.stage===0&&s.enemies.filter(e=>(e.room??0)===0).every(e=>e.hp===0))s.stage=1;}
      }
      return true;
    }
    return this.error(p,'unknown_action');
  }
  match() {
    this.queue=this.queue.filter(id=>this.players.has(id)&&this.available(this.players.get(id)));
    while(this.queue.length>=3){const ids=this.queue.slice(0,4);const code=crypto.randomBytes(3).toString('hex').toUpperCase();this.parties.set(code,{leader:ids[0],members:ids});for(const id of ids)this.account(id).party=code;this.startRun(ids,false);}
  }
  tick() {
    const now=this.now();this.match();
    for(const [key,s] of [...this.worlds,...this.runs]){
      const members=[...this.players.values()].filter(p=>this.state(p)===s);
      if(!members.length){if(s.created&&now-s.created>45*60*1000)this.runs.delete(key);else if(!s.created)this.worlds.delete(key);continue;}
      if(s.stage===1&&s.runes?.length&&now>s.runeUntil){s.runes=[];s.runeUsers=[];}
      for(const e of s.enemies){
        if(e.hp>0&&!e.boss&&!members.some(p=>this.account(p.id).target===e.id))e.at=[e.home[0]+Math.sin(now/1700+e.home[1]) *65,e.home[1]+Math.cos(now/2000+e.home[0])*22];
        if(!e.hp&&e.respawn&&now>e.respawn&&!s.created){e.hp=e.max;e.cycle++;e.respawn=0;e.contributors.clear();}
        if(e.attack&&now>=e.attack&&e.hp>0){for(const p of members){if(this.account(p.id).target===e.id&&distance(p,e.at)<(e.boss?420:240))this.damage(p,e.boss?rules.boss_hit_damage:rules.hit_damage);}e.attack=members.some(p=>this.account(p.id).target===e.id)?now+4000:0;}
      }
    }
    for(const p of this.players.values()){
      const a=this.account(p.id);if(![WORLD,RAID].includes(p.zone))continue;
      if(p.zone===WORLD&&distance(p,rules.camp)<300)a.hp=Math.min(100,a.hp+1.2);
      if(a.target.startsWith('pvp:')){const rival=this.players.get(a.target.slice(4));if(!inPvp(p)||!rival||!inPvp(rival)||rival.expeditionRoom!==p.expeditionRoom||distance(p,[rival.x,rival.y])>600)a.target='';}
      if(a.harvest){
        if(distance(p,rules.source)>180||a.target||[...this.players.values()].some(other=>other.id!==p.id&&other.expeditionRoom===p.expeditionRoom&&inPvp(other)&&(!a.party||a.party!==this.account(other.id).party))){a.harvest=0;this.tell(p,{event:'error',reason:'source_contested_or_left'});}
        else if(now-a.harvest>=rules.source_channel*1000){a.harvest=0;a.nextHarvest=now+rules.source_cooldown*1000;a.carried+=15;}
      }
      this.snapshot(p);
    }
  }
}
module.exports={Expeditions,WORLD,RAID,inPvp,rules};
