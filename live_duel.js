'use strict';
const crypto=require('node:crypto'),Equipment=require('./equipment_rules'),Balance=require('./duel_balance.json');
const {normalizeLetter}=require('./typing_input');
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function tier(level){return level>=120?5:level>=80?4:level>=40?3:level>=15?2:1;}
function syncSoul(player,data){
    const base=100+({Banker:20,Politician:15}[player.class]||0)+(player.level-1)*15+Equipment.stats(player).max_soul;
    player.max_soul=Number.isFinite(data.max_soul)?clamp(data.max_soul,base,base+60):(player.max_soul||base);
    player.soul=Number.isFinite(data.soul)?clamp(data.soul,0,player.max_soul):clamp(player.soul??player.max_soul,0,player.max_soul);
}
class LiveDuel {
    constructor(onFinish=()=>{}){this.onFinish=onFinish;}
    actor(room,id){return room.players.get(id)||room.npcs?.get(id);}
    start(room,duel){
        const a=this.actor(room,duel.first),b=this.actor(room,duel.second);
        if(!a||!b||a.duel_protocol!==1||b.duel_protocol!==1)return;
        duel.live=true;duel.id=crypto.randomUUID();duel.revision=0;duel.lastTick=Date.now();duel.pulse=0;
        duel.inputs=new Map([a,b].map(p=>[p.id,{seq:0,word:'',index:0,tokens:8,lastToken:Date.now(),lastTyped:0}]));
        this.send(room,duel);
    }
    send(room,duel,extra={}){
        duel.revision++;
        for(const id of [duel.first,duel.second]){
            const p=this.actor(room,id),r=this.actor(room,id===duel.first?duel.second:duel.first);
            if(!p||!r||p.ws.readyState!==1)continue;
            const input=duel.inputs.get(id);
            p.ws.send(JSON.stringify({type:'duel_state',zone:room.zone,room_id:room.id,duel_id:duel.id,revision:duel.revision,other_id:r.id,ratio:id===duel.first?duel.ratio:1-duel.ratio,self_soul:p.soul,self_max:p.max_soul,rival_soul:r.soul,rival_max:r.max_soul,ack_seq:input.seq,input_word:input.word,input_index:input.index,pulse:duel.pulse,...extra}));
        }
    }
    transfer(winner,loser,amount){
        // A full attacker can still drain; excess soul disperses instead of
        // making an opponent immune. Live flow cannot kill before the result.
        const drained=Math.min(Math.max(0,loser.soul-loser.max_soul*.05),Math.max(0,amount));
        loser.soul-=drained;winner.soul=Math.min(winner.max_soul,winner.soul+drained);
        return drained;
    }
    input(room,duel,player,rival,payload){
        if(duel.pendingResult){this.send(room,duel,{input_rejected:player.id,settlement_pending:true});return;}
        const state=duel.inputs.get(player.id),now=Date.now();
        state.tokens=Math.min(8,state.tokens+(now-state.lastToken)*.030);state.lastToken=now;
        const word=payload.word,letter=payload.letter;
        const pool=Balance.words[tier(Math.max(player.level,rival.level))];
        if(payload.duel_id!==duel.id||payload.seq!==state.seq+1||typeof word!=='string'||!pool.includes(word)||typeof letter!=='string'||letter.length!==1||state.tokens<1) {this.send(room,duel,{input_rejected:player.id});return;}
        if(state.word&&state.word!==word){this.send(room,duel,{input_rejected:player.id});return;}
        if(normalizeLetter(letter)!==normalizeLetter(word[state.index])){
            state.tokens--;state.seq++;state.word=word;
            player.soul=Math.max(Math.min(player.soul,player.max_soul*.05),player.soul-Math.max(2,player.max_soul*.015));
            this.send(room,duel,{mistake_id:player.id,recovery_ms:0});return;
        }
        state.tokens--;state.word=word;state.index++;state.seq++;state.lastTyped=now;
        const completed=state.index===word.length;
        const push=Equipment.combatPush(player,rival,word.length,completed,Number.isFinite(payload.beam_boost)?clamp(payload.beam_boost,1,1.85):1);
        duel.ratio=clamp(duel.ratio+(player.id===duel.first?push:-push),0,1);
        const gear=(1+Equipment.stats(player).siphon)*(1-Equipment.stats(rival).defense);
        const amount=Math.min(player.max_soul,rival.max_soul)*(Balance.letter_soul+(completed?Balance.word_soul:0))*gear*(player.class==='Vampire'?1.25:1);
        this.transfer(player,rival,amount);duel.pulse++;
        if(completed){state.word='';state.index=0;}
        if(duel.ratio>=.98||duel.ratio<=.02){this.finish(room,duel,duel.ratio>=.98?duel.first:duel.second,'overpowered');return;}
        this.send(room,duel,{actor_id:player.id,completed});
    }
    tick(room,duel){
        if(!duel.live)return;
        if(duel.pendingResult){
            if(Date.now()>=(duel.retryAt||0))this.finish(room,duel,duel.pendingResult.winnerId,duel.pendingResult.reason);
            return;
        }
        const now=Date.now(),delta=Math.min(.2,(now-duel.lastTick)/1000);duel.lastTick=now;
        const lead=duel.ratio>.5?duel.first:duel.second;
        if(Math.abs(duel.ratio-.5)<.04||now-duel.inputs.get(lead).lastTyped>900)return;
        const winner=this.actor(room,lead),loser=this.actor(room,lead===duel.first?duel.second:duel.first);
        if(winner&&loser&&this.transfer(winner,loser,Math.min(winner.max_soul,loser.max_soul)*Balance.lead_soul_per_second*Math.abs(duel.ratio-.5)*2*delta)>0)this.send(room,duel);
    }
    finish(room,duel,winnerId,reason){
        if(!duel.live||duel.finished)return;
        const winner=this.actor(room,winnerId),loser=this.actor(room,winnerId===duel.first?duel.second:duel.first);
        if(!winner||!loser)return;
        try{this.onFinish({room,duel,winner,loser,reason});}
        catch(error){
            duel.pendingResult={winnerId,reason};duel.retryAt=Date.now()+1000;
            console.error('Season settlement failed; result will retry:',error.message);
            this.send(room,duel,{settlement_pending:true});return;
        }
        delete duel.pendingResult;
        winner.soul=Math.min(winner.max_soul,winner.soul+winner.max_soul*Balance.victory_refill);
        loser.soul=Math.max(0,loser.soul-loser.max_soul*Balance.defeat_loss);
        loser.dead=loser.soul<=0;
        winner.soul_lock_until=loser.soul_lock_until=Date.now()+1000;
        duel.finished=true;this.send(room,duel,{finished:true,winner_id:winnerId,reason});
        for(const [key,value] of room.duels)if(value===duel)room.duels.delete(key);
    }
}
module.exports={LiveDuel,syncSoul,Balance};
