'use strict';
const WebSocket=require('ws'),{AccountError,MAX_PROFILE}=require('./accounts');
function attachAccountSocket(httpServer,gameSockets,accounts,getIp){
 const sockets=new WebSocket.Server({noServer:true,maxPayload:MAX_PROFILE+16384});let active=0;
 httpServer.on('upgrade',(req,socket,head)=>{
  if(req.url.split('?')[0]!=='/accounts'){gameSockets.handleUpgrade(req,socket,head,ws=>gameSockets.emit('connection',ws,req));return;}
  const origin=req.headers.origin||'',ip=getIp(req);
  if(active>=100||(origin&&!accounts.origins.has('*')&&!accounts.origins.has(origin))){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  try{accounts.rate('account-connect:'+ip,30);}catch{socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws,req));
 });
 sockets.on('connection',(ws,req)=>{
  active++;let inflight=false;
  const timer=setTimeout(()=>ws.terminate(),30000);timer.unref();
  ws.on('close',()=>{active--;clearTimeout(timer);});ws.on('error',()=>{});
  ws.on('message',async raw=>{
   if(inflight){ws.close(1008,'One account request per connection');return;}
   inflight=true;let id='';
   try{
    const data=JSON.parse(raw);
    if(typeof data?.id==='string'&&/^[a-f0-9]{16}$/.test(data.id))id=data.id;
    if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.id!=='string'||!/^[a-f0-9]{16}$/.test(data.id)||!['poki_login','resume','save','logout'].includes(data.action)||!data.body||typeof data.body!=='object'||Array.isArray(data.body))throw new AccountError('invalid_request');
    id=data.id;const result=await accounts.action(data.action,data.body,data.token,getIp(req));
    if(ws.readyState===1)ws.send(JSON.stringify({type:'account_result',id,status:200,data:result}));
   }catch(error){if(ws.readyState===1)ws.send(JSON.stringify({type:'account_result',id,status:error instanceof AccountError?error.status:503,data:{error:error instanceof AccountError?error.code:'accounts_unavailable'}}));}
   // Replies stay on this private socket, never a room/chat broadcast. Clients
   // reconnect deliberately; an uncertain save must never be replayed blindly.
  });
 });
 return sockets;
}
module.exports={attachAccountSocket};
