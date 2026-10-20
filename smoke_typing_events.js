'use strict';
const {spawn}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict'),WS=require('ws');
const target=process.argv[2]||'ws://127.0.0.1:18227',observe=process.argv.includes('--observe-only'),peers=[];
const child=process.argv[2]?null:spawn(process.execPath,['server/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'18227'},windowsHide:true});
let log='',checks=0;const delay=ms=>new Promise(r=>setTimeout(r,ms));
if(child){child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);}
const check=(ok,text)=>{assert.ok(ok,text);checks++;};
async function wait(fn){for(let i=0;i<500;i++){const value=fn();if(value)return value;await delay(15);}throw Error('Timeout '+log.slice(-1000));}
async function peer(name){
 const ws=new WS(target),p={ws,messages:[],send:v=>ws.send(JSON.stringify(v))};peers.push(p);
 ws.on('message',raw=>{const m=JSON.parse(raw);p.messages.push(m);if(m.type==='typing_event'){if(m.self)p.self=m.self;if(m.boss)p.boss=m.boss;p.last=m;}});
 await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
 p.send({type:'join',zone:'city',name,class:'Banker',level:3,duel_protocol:1,soul:120,max_soul:155});
 p.welcome=await wait(()=>p.messages.find(m=>m.type==='welcome'));p.id=p.welcome.id;
 p.send({type:'pos',x:9950,y:7660,soul:120,max_soul:155,vx:0,vy:0,anim:'idle',flip:false});
 p.action=(action,extra={})=>p.send({type:'typing_event',action,boss:'first_drawn',...extra});
 p.sys=extra=>p.send({type:'chat',msg:'__SYS__:'+JSON.stringify(extra)});
 return p;
}
(async()=>{try{
 if(child)await wait(()=>log.includes('starting on port'));
 const a=await peer('TextQAObserver');
 check(a.welcome.server_version==='0.6.8'&&a.welcome.typing_events===1,'running server advertises text-event support');
 a.action('snapshot');const snapshot=await wait(()=>a.messages.find(m=>m.type==='typing_event'&&m.bosses));
 check(snapshot.bosses.length===2,'both public street bosses exist');
 check(new Set(snapshot.bosses.map(b=>b.id)).size===2,'boss instances have distinct IDs');
 if(!observe){
  const b=await peer('TextQARival');
  a.action('join');await wait(()=>a.self?.active);
  a.send({type:'pos',x:9950,y:7660,soul:99999,max_soul:99999});
  b.sys({ev:'pvp_incoming',target_id:a.id});await wait(()=>a.last?.reason==='pvp_challenge');
  check(!a.self.active,'real PvP challenge pauses the writing session');
  check(a.self.soul===120&&a.self.max_soul===155,'position packets cannot refill active event reserves');
  b.sys({ev:'pvp_cancel',target_id:a.id});await delay(80);
  a.action('join');await wait(()=>a.self?.active&&a.boss?.phase==='active');
  const cycle=a.boss.cycle;
  a.action('key',{cycle,seq:a.self.seq+1,target:'story',key:'b'});await wait(()=>a.last?.correct===false);
  check(a.self.index===0,'real protocol preserves case sensitivity');
  a.action('key',{cycle,seq:a.self.seq+1,target:'story',key:'B'});await wait(()=>a.self.index===1);
  await wait(()=>b.boss?.progress===1);
  check(b.boss.cycle===cycle&&b.boss.progress===a.boss.progress,'shared progress reaches the other socket');
  const seq=a.self.seq;a.action('key',{cycle,seq,target:'story',key:'e'});await wait(()=>a.last?.rejected);
  check(a.self.index===1&&a.self.seq===seq,'replayed input has no extra damage');
  a.action('leave');await wait(()=>!a.self.active);
  check(a.self.index===a.self.checkpoint,'explicit leave rewinds only the unfinished sentence');
 }
 console.log(`TYPING EVENT PROTOCOL: ${checks} checks; 0 failures`);
}catch(e){console.error(e.stack);process.exitCode=1;}finally{for(const p of peers)p.ws.terminate();if(child)child.kill();}})();
