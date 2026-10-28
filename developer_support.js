'use strict';
const crypto=require('node:crypto');
class DeveloperSupport {
 constructor(admin){this.admin=admin;this.commands=new Map();this.requests=new Map();this.last=new WeakMap();}
 result(ws,data){this.admin.send(ws,{type:'developer_support_result',...data});}
 tick(){const now=Date.now();for(const [id,c] of this.commands){if(c.status==='pending'&&now-c.at>30000){c.status='unknown';c.message='Delivery unconfirmed. Check the target before sending another grant.';this.result(c.senderWs,this.view(c));}if(now-c.at>300000){this.commands.delete(id);this.requests.delete(c.requestKey);}}}
 view(c){return {request_id:c.requestId,command_id:c.id,target_id:c.targetId,action:c.action,value:c.value,status:c.status,message:c.message||''};}
 handle(ws,data,id){
  const a=this.admin,found=a.player(id);
  if(!found||found.player.ws!==ws)return true;
  if(data.type==='developer_support_ready'){ws.supportProtocol=data.protocol===1?1:0;return true;}
  if(data.type==='developer_support_ack'){
   const c=this.commands.get(data.command_id);
   if(!c||c.targetWs!==ws||c.targetId!==id||c.status!=='pending')return true;
   if(typeof data.ok!=='boolean')return true;
   c.status=data.ok?'applied':'rejected';
   c.message=data.ok?'Saved on the target player.':String(data.reason||'Target could not apply the change.').slice(0,160);
   this.result(c.senderWs,this.view(c));return true;
  }
  if(!ws.developerRole){this.result(ws,{status:'rejected',message:'Server-authorized Developer access required.'});return true;}
  if(data.type==='developer_support_list'){
   const last=this.last.get(ws)||{};if(Date.now()-(last.list||0)<1000)return true;last.list=Date.now();this.last.set(ws,last);
   const players=a.snapshot().players.filter(p=>p.id!==id).map(p=>({id:p.id,name:p.name,class:p.class,level:p.level,zone:p.zone,supported:a.player(p.id)?.player.ws.supportProtocol===1}));
   a.send(ws,{type:'developer_support_players',players});return true;
  }
  if(data.type!=='developer_support_request')return true;
  const requestId=typeof data.request_id==='string'?data.request_id:'';
  if(!/^[a-f0-9]{32}$/.test(requestId)){this.result(ws,{status:'rejected',message:'Invalid request ID.'});return true;}
  const key=id+':'+requestId,old=this.commands.get(this.requests.get(key));
  if(old){this.result(ws,this.view(old));return true;}
  const last=this.last.get(ws)||{};
  if(Date.now()-(last.action||0)<500){this.result(ws,{request_id:requestId,status:'rejected',message:'Please wait before another command.'});return true;}
  const target=typeof data.target_id==='string'?a.player(data.target_id):null;
  const max=data.action==='coins'?1000000:data.action==='level'?100000:0;
  if(!max||!Number.isSafeInteger(data.value)||data.value<1||data.value>max||!target||target.player.ws.readyState!==1||target.player.id===id||target.player.is_shared_npc||target.player.ws.supportProtocol!==1){this.result(ws,{request_id:requestId,status:'rejected',message:'Invalid value, disconnected player, or target client needs an update.'});return true;}
  if(this.commands.size>=256){this.result(ws,{request_id:requestId,status:'rejected',message:'Command queue full. Retry later.'});return true;}
  last.action=Date.now();this.last.set(ws,last);
  const c={id:crypto.randomUUID(),requestId,requestKey:key,senderWs:ws,targetWs:target.player.ws,targetId:data.target_id,senderId:id,action:data.action,value:data.value,status:'pending',at:Date.now()};
  this.commands.set(c.id,c);this.requests.set(key,c.id);
  this.result(ws,this.view(c));
  a.send(c.targetWs,{type:'developer_support_command',command_id:c.id,action:c.action,value:c.value,from:String(found.player.name||'Developer').slice(0,40)});
  return true;
 }
 close(id){for(const c of this.commands.values())if(c.status==='pending'&&c.targetId===id){c.status='unknown';c.message='Target disconnected. Check their saved progress before retrying.';this.result(c.senderWs,this.view(c));}}
}
module.exports={DeveloperSupport};
