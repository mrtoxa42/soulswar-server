'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const CLASSES=['Banker','Vampire','Speedster','Politician'],DURATION=30*60*1000;
const scores=()=>Object.fromEntries(CLASSES.map(c=>[c,0]));
const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
class Seasons {
    constructor(file,{now=()=>Date.now(),duration=DURATION}={}) {
        this.file=file;this.now=now;this.duration=duration;
        this.persistent=typeof file==='string'&&file.length>0;
        this.state=this.persistent&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,round:Math.floor(now()/duration),scores:scores(),participants:{},seen:{},accounts:{}};
        if(this.state.version!==1||!this.state.accounts||!this.state.scores)throw Error('Invalid season state; refusing to reset it');
        this.tick();
    }
    persist(){
        if(!this.persistent)return; // Explicit session-only mode; restart resets pending state.
        fs.mkdirSync(path.dirname(this.file),{recursive:true});
        const temp=this.file+'.tmp',fd=fs.openSync(temp,'w',0o600);
        try{fs.writeFileSync(fd,JSON.stringify(this.state));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        fs.renameSync(temp,this.file);
    }
    transaction(action){
        const before=JSON.stringify(this.state);
        try{const result=action();this.persist();return result;}
        catch(error){this.state=JSON.parse(before);throw error;}
    }
    attach(player,token){
        this.tick();
        if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!this.state.accounts[hash(token)]) {
            token=crypto.randomBytes(32).toString('hex');
            this.transaction(()=>{this.state.accounts[hash(token)]={pending:[],lastSeen:this.now()};});
        }
        player.seasonKey=hash(token);
        return token; // Only returned privately to this connection, never in a roster.
    }
    tick(){
        const round=Math.floor(this.now()/this.duration);
        if(round<=this.state.round)return false;
        this.transaction(()=>{
            const top=Math.max(...Object.values(this.state.scores));
            const winners=top>0?CLASSES.filter(c=>this.state.scores[c]===top):[];
            for(const [key,participant] of Object.entries(this.state.participants)) {
                const account=this.state.accounts[key];if(!account||!winners.length)continue;
                const won=winners.includes(participant.class);
                account.pending.push({id:'season:'+this.state.round,round:this.state.round,winning_class:winners.join(' / '),player_class:participant.class,player_won:won,winner_wins:top,player_wins:this.state.scores[participant.class],reward_coins:won?250:60,all_scores:{...this.state.scores},supplies:won?['item_coffee','item_drink']:['item_coffee']});
                account.pending=account.pending.slice(-48);
            }
            this.state.round=round;this.state.scores=scores();this.state.participants={};this.state.seen={};
        });
        return true;
    }
    record({duel,winner,loser,reason}){
        this.tick();
        // Only server-resolved duels count; ambient NPC fights grant no player participation.
        const participants=[winner,loser].filter(p=>!p.npc&&p.seasonKey&&duel.inputs?.get(p.id)?.seq>0);
        const ambient=duel.live===true&&duel.ambient===true&&winner.npc&&loser.npc&&duel.inputs?.get(winner.id)?.seq>0&&duel.inputs?.get(loser.id)?.seq>0;
        if(reason!=='overpowered'||(!participants.length&&!ambient)||!CLASSES.includes(winner.class)||!CLASSES.includes(loser.class)||typeof duel.id!=='string'||!duel.id||winner.class===loser.class||this.state.seen[duel.id])return false;
        return this.transaction(()=>{
            this.state.seen[duel.id]=true;
            this.state.scores[winner.class]++;
            for(const p of participants) {
                this.state.participants[p.seasonKey] ||= {class:p.class};
                this.state.accounts[p.seasonKey].lastSeen=this.now();
            }
            return true;
        });
    }
    snapshot(player){
        return {type:'season_state',season_protocol:1,round:this.state.round,ends_at:(this.state.round+1)*this.duration,server_time:this.now(),scores:{...this.state.scores},rewards:player?.seasonKey?(this.state.accounts[player.seasonKey]?.pending||[]):[]};
    }
    ack(player,id){
        const account=this.state.accounts[player.seasonKey];
        if(!account?.pending.some(r=>r.id===id))return false;
        return this.transaction(()=>{account.pending=account.pending.filter(r=>r.id!==id);return true;});
    }
}
module.exports={Seasons,CLASSES,DURATION};
