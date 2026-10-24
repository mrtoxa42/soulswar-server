'use strict';
// Simulation may sleep in a hidden browser tab; transport liveness is independent.
const SOCKET_TIMEOUT=60000, IDLE_AFTER=2000;
class Presence {
 constructor(now=()=>Date.now()){this.now=now;}
 attach(ws){ws.lastPong=this.now();ws.lastProbe=0;ws.transportRtt=null;ws.on('pong',()=>{const now=this.now();if(ws.lastProbe)ws.transportRtt=Math.max(0,now-ws.lastProbe);ws.lastPong=now;});}
 probe(ws){const now=this.now();if(ws.readyState!==1)return;if(now-ws.lastPong>SOCKET_TIMEOUT){ws.terminate();return;}if(now-(ws.lastProbe||0)>=15000){ws.lastProbe=now;ws.ping();}}
 init(p,data){p.presenceProtocol=data.presence_protocol===1;p.awayRevision=0;p.lastPositionAt=this.now();p.awayAppliedAt=this.now();p.awaySentAt=0;this.policy(p,data);}
 policy(p,data){
  if(!p.presenceProtocol)return;
  p.background=data.background===true;
  // Progression remains client-owned; only the bounded passive context is retained.
  const ctx=data.away_soul;
  if(ctx&&typeof ctx==='object'){
   if(ctx.ad===true&&!p.awayAd)p.awayAdUntil=this.now()+125000;
   p.awayAd=ctx.ad===true;
   p.awaySafe=ctx.safe===true;p.awayDrain=Number.isFinite(ctx.drain)?Math.max(0,Math.min(2.8,ctx.drain)):2.8;
   p.awayHeal=p.awaySafe?Math.max(0,Math.min(30,Number(ctx.heal)||0)):0;
   p.awayImmuneUntil=this.now()+Math.max(0,Math.min(30,Number(ctx.immune_seconds)||0))*1000;
  }
 }
 status(p){return p.background?'background':this.now()-p.lastUpdate>IDLE_AFTER?'idle':'active';}
 send(p){if(p.ws.readyState===1)p.ws.send(JSON.stringify({type:'presence_soul',zone:p.zone,soul:p.soul,max_soul:p.max_soul,revision:p.awayRevision,dead:p.soul<=0,immune_remaining:Math.max(0,((p.awayImmuneUntil||0)-this.now())/1000)}));p.awaySentAt=this.now();}
 tick(p,locked=false){
  const now=this.now();if(!p.presenceProtocol||['forest_raid','unsealed_forest'].includes(p.zone)||p.dead)return;
  if(locked||(p.awayAd&&now<p.awayAdUntil)){p.awayAppliedAt=now;return;}
  if(!p.background&&now-p.lastPositionAt<IDLE_AFTER)return;
  const start=p.awayAppliedAt,seconds=Math.max(0,(now-start)/1000);p.awayAppliedAt=now;
  let change=0;
  if(p.awaySafe)change=(p.awayHeal||0)*seconds;
  else change=-(p.awayDrain??2.8)*Math.max(0,(now-Math.max(start,p.awayImmuneUntil||0))/1000);
  const before=p.soul;p.soul=Math.max(0,Math.min(p.max_soul,p.soul+change));
  if(p.soul!==before)p.awayRevision++;
  if(p.soul<=0)p.dead=true;
  if(now-p.awaySentAt>=1000)this.send(p);
 }
 position(p,data){
  const accept=!p.awayRevision||data.soul_revision===p.awayRevision;
  if(!accept)this.send(p);
  p.lastPositionAt=this.now();p.awayAppliedAt=this.now();this.policy(p,data);
  return accept;
 }
}
module.exports={Presence,SOCKET_TIMEOUT,IDLE_AFTER};
