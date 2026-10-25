'use strict';
const SOLO = new Set(['menu','character_select','tutorial','loading','parking','metro','tunnel','reactor']);
const text = (value,max) => typeof value==='string' ? value.replace(/[\x00-\x1f]/g,'').slice(0,max) : '';
const number = (value,low,high) => Number.isFinite(value) ? Math.min(high,Math.max(low,value)) : null;
class SessionActivity {
    constructor(allowed=()=>false) {this.players=new Map();this.allowed=allowed;}
    update(ws,id,data,{country,connectedAt,name}) {
        const now=Date.now(), old=this.players.get(id);
        if(old && now-old.lastActivity<900)return null;
        if(!SOLO.has(data.zone) && !this.allowed(data.zone))return null;
        const p={ws,id,country,connectedAt,name,zone:data.zone,
            class:['Banker','Vampire','Speedster','Politician'].includes(data.class)?data.class:'',
            level:Math.round(number(data.level,1,100000)||1),role:ws.developerRole?'Developer':'',
            mode:['menu','solo','online','connecting'].includes(data.mode)?data.mode:'solo',
            activity:['playing','menu','connecting','combat','paused','dead','ad'].includes(data.activity)?data.activity:'playing',
            stage:Math.round(number(data.stage,0,100)||0),area:text(data.area,64),detail:text(data.detail,48),build:text(data.build,24),
            x:number(data.x,-100000,100000),y:number(data.y,-100000,100000),
            soul:number(data.soul,0,2000000),max_soul:number(data.max_soul,0,2000000),
            client_fps:Math.round(number(data.fps,0,1000)||0),client_frame_ms:number(data.frame_ms,0,10000),
            background:data.background===true,lastActivity:now,lastUpdate:now};
        this.players.set(id,p);
        return {first:!old,player:p};
    }
    close(id) {this.players.delete(id);}
}
module.exports={SessionActivity};
