'use strict';
const crypto=require('node:crypto');
const COLORS=['328f96','ba5964','8068ac','bf9140','4e9563','5979b0'];
const BUILDINGS={hall:{name:'Gathering Hall',cost:40},walls:{name:'Lantern Walls',cost:60},garden:{name:'Soul Garden',cost:35},monument:{name:'Victory Monument',cost:80}};
function fail(reason){const e=Error(reason);e.clanReason=reason;throw e;}
function member(c,id){return c?.members.find(m=>m.id===id);}
function officer(c,id){return ['leader','officer'].includes(member(c,id)?.role);}
function create(account,d,now){
 const name=typeof d.name==='string'?d.name.trim().replace(/\s+/g,' '):'',tag=typeof d.tag==='string'?d.tag.trim().toUpperCase():'';
 if(!/^[\p{L}\p{N} _'-]{3,24}$/u.test(name)||!/^[A-Z0-9]{2,5}$/.test(tag))fail('invalid_clan_name_or_tag');
 return {id:crypto.randomUUID(),name,tag,color:COLORS.includes(d.color)?d.color:COLORS[0],emblem:['soul','crown','leaf','bolt'].includes(d.emblem)?d.emblem:'soul',created:now,materials:0,xp:0,trophies:0,wins:0,wars:0,buildings:{hall:0,walls:0,garden:0,monument:0},members:[{id:account.id,name:account.display_name,role:'leader',contribution:0}],invites:[],daily:{},history:[]};
}
function daily(c,id,now){const day=new Date(now).toISOString().slice(0,10);if(c.daily.day!==day)c.daily={day};return c.daily[id] ||= {words:0,practice:0};}
function apply(c,account,d,now){
 const me=member(c,account.id);if(!me)fail('join_a_clan_first');
 switch(d.action){
 case 'invite':
  if(!officer(c,account.id))fail('officer_required');
  if(c.members.length>=12)fail('clan_full');
  if(!d.targetAccount||member(c,d.targetAccount.id))fail('player_unavailable');
  c.invites=c.invites.filter(i=>i.until>now&&i.id!==d.targetAccount.id);
  if(c.invites.length>=24)fail('too_many_invitations');
  c.invites.push({id:d.targetAccount.id,name:d.targetAccount.display_name,until:now+86400000});break;
 case 'kick':
  if(!officer(c,account.id))fail('officer_required');
  {const target=member(c,d.member);if(!target||target.id===account.id||target.role==='leader'||(me.role!=='leader'&&target.role==='officer'))fail('cannot_remove_member');c.members=c.members.filter(m=>m.id!==target.id);}break;
 case 'role':
  if(me.role!=='leader')fail('leader_required');
  {const target=member(c,d.member);if(!target||target.id===me.id||!['member','officer','leader'].includes(d.role))fail('invalid_role');target.role=d.role;if(d.role==='leader')me.role='officer';}break;
 case 'leave':
  if(me.role==='leader'&&c.members.length>1)fail('transfer_leadership_first');
  c.members=c.members.filter(m=>m.id!==account.id);break;
 case 'build':
  if(!officer(c,account.id))fail('officer_required');
  {const b=BUILDINGS[d.building];if(!b)fail('unknown_building');const level=c.buildings[d.building]||0;if(level>=3)fail('building_complete');const cost=b.cost*(level+1);if(c.materials<cost)fail('not_enough_materials');c.materials-=cost;c.buildings[d.building]=level+1;log(c,now,`${me.name} improved ${b.name} to ${level+1}.`);}break;
 default:fail('unknown_clan_action');
 }return c;
}
function log(c,now,text){c.history.unshift({at:now,text});c.history=c.history.slice(0,20);}
function credit(c,id,kind,now){
 const m=member(c,id);if(!m)return false;const day=daily(c,id,now);
 const cap=kind==='words'?20:3;if(day[kind]>=cap)return false;
 day[kind]++;const amount=kind==='words'?3:12;c.materials+=amount;c.xp+=amount;m.contribution+=amount;return true;
}
function publicClan(c,id){if(!c)return null;const v=structuredClone(c);delete v.daily;v.invites=officer(c,id)?v.invites:[];return v;}
class PgClans{
 constructor(pool){this.pool=pool;}
 async transact(fn){const db=await this.pool.connect();try{await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(42810424)');const value=await fn(db);await db.query('COMMIT');return value;}catch(e){await db.query('ROLLBACK');if(e.code==='23505')fail('clan_name_tag_or_membership_taken');throw e;}finally{db.release();}}
 async own(db,id){return (await db.query('SELECT c.state FROM sw_clans c JOIN sw_clan_members m ON m.clan_id=c.id WHERE m.account_id=$1',[id])).rows[0]?.state||null;}
 async save(db,c){
  await db.query('DELETE FROM sw_clan_members WHERE clan_id=$1',[c.id]);
  if(!c.members.length){await db.query('DELETE FROM sw_clans WHERE id=$1',[c.id]);return;}
  await db.query('INSERT INTO sw_clans(id,name,tag,state) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()',[c.id,c.name,c.tag,JSON.stringify(c)]);
  for(const m of c.members)await db.query('INSERT INTO sw_clan_members(account_id,clan_id) VALUES($1,$2)',[m.id,c.id]);
 }
 async snapshot(id){
  const c=await this.own(this.pool,id);
  const directory=(await this.pool.query("SELECT id,name,tag,state->>'color' AS color,state->>'emblem' AS emblem,jsonb_array_length(state->'members') AS members,(state->>'trophies')::int AS trophies FROM sw_clans ORDER BY (state->>'trophies')::int DESC,lower(name) LIMIT 50")).rows;
  const invites=(await this.pool.query("SELECT id,name,tag FROM sw_clans WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(state->'invites') i WHERE i->>'id'=$1 AND (i->>'until')::bigint>$2) LIMIT 24",[id,Date.now()])).rows;
  return {clan:publicClan(c,id),directory,invites};
 }
 async change(account,d,now){return this.transact(async db=>{
  let c=await this.own(db,account.id);
  if(d.action==='create'){if(c)fail('already_in_a_clan');c=create(account,d,now);}
  else if(d.action==='accept'){
   if(c)fail('already_in_a_clan');if(typeof d.clan!=='string'||!/^[0-9a-f-]{36}$/.test(d.clan))fail('invitation_expired');
   c=(await db.query('SELECT state FROM sw_clans WHERE id=$1',[d.clan])).rows[0]?.state;
   if(!c?.invites.some(i=>i.id===account.id&&i.until>now))fail('invitation_expired');
   if(c.members.length>=12)fail('clan_full');c.members.push({id:account.id,name:account.display_name,role:'member',contribution:0});c.invites=c.invites.filter(i=>i.id!==account.id);log(c,now,`${account.display_name} joined the clan.`);
  }else{
   if(d.action==='invite'){
    const name=String(d.name||'').trim().toLowerCase();
    d={...d,targetAccount:(await db.query('SELECT id,display_name FROM sw_accounts WHERE username=$1 AND NOT disabled',[name])).rows[0]};
    if(d.targetAccount&&(await db.query('SELECT 1 FROM sw_clan_members WHERE account_id=$1',[d.targetAccount.id])).rows.length)fail('player_already_in_clan');
   }
   apply(c,account,d,now);
  }
  await this.save(db,c);return c.id;
 });}
 async contribute(id,clanId,kind,now){return this.transact(async db=>{const c=await this.own(db,id);if(!c||c.id!==clanId)fail('clan_changed');const ok=credit(c,id,kind,now);if(ok)await this.save(db,c);return ok;});}
 async war(result){return this.transact(async db=>{
  const added=await db.query('INSERT INTO sw_clan_war_results(id,result) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING id',[result.id,JSON.stringify(result)]);if(!added.rows.length)return;
  for(let team=0;team<2;team++){
   const c=(await db.query('SELECT state FROM sw_clans WHERE id=$1',[result.clans[team]])).rows[0]?.state;if(!c)continue;
   c.wars++;const won=result.winner===team,draw=result.winner===null;c.wins+=won?1:0;c.trophies+=won?25:draw?5:0;c.materials+=won?40:draw?20:12;c.xp+=won?60:20;
   log(c,result.at,`${won?'Victory':draw?'Draw':'Defeat'} against ${result.names[1-team]}.`);await this.save(db,c);
  }
 });}
 async practice(result){return this.transact(async db=>{
  const added=await db.query('INSERT INTO sw_clan_war_results(id,result) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING id',[result.id,JSON.stringify(result)]);if(!added.rows.length)return;
  const c=(await db.query('SELECT state FROM sw_clans WHERE id=$1',[result.clan])).rows[0]?.state;if(!c)return;
  for(const id of result.players)credit(c,id,'practice',result.at);await this.save(db,c);
 });}
}
module.exports={PgClans,COLORS,BUILDINGS,create,apply,credit,member,officer,publicClan,fail};
