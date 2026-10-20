'use strict';
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),path=require('node:path'),WS=require('ws');
const port=18222,target=process.argv[2]||`ws://127.0.0.1:${port}`,peers=[],delay=ms=>new Promise(r=>setTimeout(r,ms));let checks=0,log='';
const child=process.argv[2]?null:spawn(process.execPath,['server/server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port)},windowsHide:true});
if(child){child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);}
function check(ok,label){assert.ok(ok,label);checks++;}
async function wait(fn){for(let i=0;i<250;i++){const value=fn();if(value)return value;await delay(15);}throw Error('Timeout '+log.slice(-1000));}
async function peer(name){const ws=new WS(target),p={ws,messages:[],seq:0,send:data=>ws.send(JSON.stringify(data))};ws.on('message',d=>{const m=JSON.parse(d);p.messages.push(m);if(m.type==='duel_state')p.state=m;});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});p.sys=data=>p.send({type:'chat',msg:'__SYS__:'+JSON.stringify(data)});p.send({type:'join',duel_protocol:1,zone:'city',name,class:'Banker',level:6,max_soul:195,soul:117});const w=await wait(()=>p.messages.find(m=>m.type==='welcome'));p.id=w.id;peers.push(p);return p;}
async function letter(p,r,word,index){p.seq++;p.sys({ev:'pvp_push',target_id:r.id,duel_id:p.state.duel_id,word,letter:word[index],seq:p.seq,push:999,completed:false});await wait(()=>p.state.ack_seq===p.seq);await delay(40);}
async function word(p,r,text='POWER'){for(let i=0;i<text.length;i++){if(p.state.finished)return;await letter(p,r,text,i);}}
(async()=>{try{
 if(child)await wait(()=>log.includes('starting on port'));
 const a=await peer('LiveAlpha'),b=await peer('LiveBeta');
 a.sys({ev:'pvp_incoming',target_id:b.id});await wait(()=>b.messages.some(m=>m.type==='chat'&&m.msg.includes('pvp_incoming')));
 b.sys({ev:'pvp_engage',target_id:a.id});await wait(()=>a.state&&b.state);
 check(a.state.duel_id===b.state.duel_id,'same server-owned duel instance');
 check(a.state.self_soul===117&&b.state.self_soul===117,'actual starting reserves, not assumed full');
 await letter(a,b,'POWER',0);await wait(()=>b.state.rival_soul>117);
 check(a.state.self_soul>117&&b.state.self_soul<117,'one valid letter increases attacker soul and drains opponent');
 check(Math.abs(a.state.ratio+b.state.ratio-1)<.00001,'both clients share mirrored beam position');
 check(a.state.ratio<.56,'client push 999 is ignored; bounded server push used');
 const before=a.state.self_soul,oldSeq=a.seq;
 a.sys({ev:'pvp_push',target_id:b.id,duel_id:a.state.duel_id,word:'POWER',letter:'P',seq:oldSeq});
 await wait(()=>a.state.input_rejected===a.id);check(a.state.ack_seq===oldSeq,'replayed sequence rejected');
 a.sys({ev:'pvp_finish',target_id:b.id,sender_won:true});await delay(70);check(!a.state.finished,'client cannot claim an early victory');
 b.send({type:'pos',x:8500,y:7500,soul:999999,max_soul:999999});
 for(let i=1;i<5;i++)await letter(a,b,'POWER',i);
 check(b.state.self_soul<117&&b.state.self_max===195,'position update cannot overwrite active duel soul');
 const afterAttack=a.state.self_soul,otherAfter=b.state.self_soul;
 await word(b,a);await word(b,a);
 check(a.state.self_soul<afterAttack&&b.state.self_soul>otherAfter,'opponent typing reverses soul transfer');
 check(b.state.ratio>.5,'faster counterattack reverses beam lead');
 let safety=0;while(!b.state.finished&&safety++<8)await word(b,a);
 await wait(()=>a.state.finished);
 check(b.state.finished&&b.state.winner_id===b.id&&a.state.winner_id===b.id,'one agreed final winner');
 check(b.state.self_soul>=b.state.self_max*.9,'separate large final victory refill');
 check(a.state.self_soul===0,'separate 75 percent defeat penalty applied');
 const finalCount=a.messages.filter(m=>m.type==='duel_state'&&m.finished).length;
 b.sys({ev:'pvp_finish',target_id:a.id,sender_won:true});await delay(70);check(a.messages.filter(m=>m.type==='duel_state'&&m.finished).length===finalCount,'result is not paid twice');
 console.log(`LIVE DUEL SERVER: ${checks} checks; 0 failures`);
}catch(error){console.error(error.stack);process.exitCode=1;}finally{for(const p of peers)p.ws.terminate();if(child)child.kill();}})();
