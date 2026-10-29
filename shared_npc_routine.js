'use strict';
// Decisions belong to the room, not to individual viewers. No client-world scans.
const Equipment=require('./equipment_rules'),{canDuel,protectionReason}=require('./duel_rules');
const BOUNDS=[[9480,7160,1900,670],[11620,7160,2150,670],[14020,7160,2700,670],[7890,3920,1220,2580],[7890,850,1220,2830],[4020,6830,3470,1340],[650,6830,3130,1340],[7780,8530,1440,4700]];
function random(p){p.randomState=(Math.imul(p.randomState,1664525)+1013904223)>>>0;return p.randomState/4294967296;}
function pool(p,field){const category=Equipment.fields[field];return (Equipment.catalog.classes[p.class][category]||[]).filter(id=>id!=='none'&&Equipment.valid(category,id,p.class,p.level)&&['shop','parking','parking_craft','street_craft'].includes(Equipment.catalog.items[id].source||'shop'));}
function point(p){const [x,y,w,h]=p.bounds;return {x:x+90+random(p)*(w-180),y:y+90+random(p)*(h-180)};}
function clamp(p,at){const [x,y,w,h]=p.bounds;return {x:Math.max(x+90,Math.min(x+w-90,at.x)),y:Math.max(y+90,Math.min(y+h-90,at.y))};}
function approach(p,other){
    const dx=p.x-other.x,dy=p.y-other.y,length=Math.hypot(dx,dy);
    // Approach from our current side. A fixed positive offset makes a group
    // chase itself all the way into the east/south boundary over time.
    return clamp(p,{x:other.x+(length?dx/length:1)*105,y:other.y+(length?dy/length:0)*105});
}
function init(p,tier,seed,now){
    p.bounds=BOUNDS[tier];p.randomState=seed;p.decision=0;p.coins=35+Math.floor(random(p)*100);p.ownedGear=new Set(Object.keys(Equipment.fields).map(f=>p[f]));
    Object.assign(p,point(p));p.target=point(p);p.goal='roam';p.goalUntil=now+7000+random(p)*10000;p.lastMotionAt=now;
    p.vehiclePool=pool(p,'vehicle');p.ownedVehicle=p.vehiclePool[Math.floor(random(p)*p.vehiclePool.length)]||'none';
    p.ownedGear.add(p.ownedVehicle);p.vehicle=p.ownedVehicle;p.mounted=false;p.travelSpeed=145+random(p)*45;
}
function idle(p,now){p.lastMotionAt=now;p.mounted=false;p.vx=p.vy=0;p.anim='idle';}
function opponents(room,p,now){return [...room.npcs.values()].filter(other=>other!==p&&!other.busy&&!other.dead&&!other.retired&&!other.activity&&now>=(other.resumeAt||0)&&canDuel(p.level,other.level)&&!protectionReason(p,other)&&Math.hypot(other.x-p.x,other.y-p.y)<1000);}
function decide(room,p,now){
    p.decision++;p.targetId=null;p.arrived=false;
    const roll=random(p),social=p.id.endsWith(':3')?.12:0;
    p.goal=p.soul<p.max_soul*.45?'rest':roll<.10?'rest':roll<.24?'equipment':roll<.42?'collect':roll<.57?'hunt':roll<.70+social?'chat':roll<.88?'duel':'roam';
    p.target=point(p);
    if(p.goal==='duel'){
        const choices=opponents(room,p,now).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
        if(choices.length){p.targetId=choices[0].id;p.target=approach(p,choices[0]);}
        else p.goal='roam';
    }
    if(p.goal==='chat'){
        const other=[...room.npcs.values()].find(other=>other!==p&&!other.busy&&!other.activity&&!other.dead&&!other.retired&&Math.hypot(other.x-p.x,other.y-p.y)<650);
        if(other){p.targetId=other.id;p.target=approach(p,other);}
    }
    // Quieter roadside stops for wardrobe/recovery; keep within the same bracket.
    if(['equipment','rest'].includes(p.goal)){
        const [x,y,w,h]=p.bounds;
        p.target=clamp(p,w>h?{x:p.x+(random(p)-.5)*450,y:y+(random(p)<.5?100:h-100)}:{x:x+(random(p)<.5?100:w-100),y:p.y+(random(p)-.5)*450});
    }
    const distance=Math.hypot(p.target.x-p.x,p.target.y-p.y);
    p.mounted=distance>380&&p.ownedVehicle!=='none'&&random(p)<.65;
    p.vehicle=p.ownedVehicle;p.travelSpeed=145+random(p)*45;
    p.goalUntil=now+distance/(p.mounted?290:p.travelSpeed)*1000+9000;
    p.nextActivityAt=now+300+random(p)*1000;
}
function move(p,now,room){
    const dt=Math.max(0,Math.min(.5,(now-p.lastMotionAt)/1000));p.lastMotionAt=now;
    if(room&&(!p.target||now>=p.goalUntil))decide(room,p,now);
    if(!p.target){idle(p,now);return;}
    if(room&&p.targetId){
        const other=room.npcs.get(p.targetId);
        if(!other||other.busy||other.dead||other.retired){p.goalUntil=now;p.targetId=null;}
        else p.target=approach(p,other);
    }
    const dx=p.target.x-p.x,dy=p.target.y-p.y,distance=Math.hypot(dx,dy);
    if(distance<22){
        idle(p,now);
        if(['roam','duel'].includes(p.goal)){p.goalUntil=Math.min(p.goalUntil,now+1500);return;}
        p.arrived=true;return;
    }
    p.arrived=false;
    const speed=p.mounted?290:p.travelSpeed,step=Math.min(distance,speed*dt);
    p.x+=dx/distance*step;p.y+=dy/distance*step;p.vx=dx/distance*speed;p.vy=dy/distance*speed;
    if(Math.abs(p.vx)>8)p.flip=p.vx<0;
    p.anim=p.mounted?'mount:'+p.ownedVehicle:'walk_side';
}
function equip(p){
    const fields=['hat','outfit','shoes','face','accessory','weapon','vehicle'];
    const first=Math.floor(random(p)*fields.length);
    for(let i=0;i<fields.length;i++){
        const field=fields[(first+i)%fields.length],items=pool(p,field).filter(id=>id!==p[field]&&(p.ownedGear.has(id)||(Equipment.catalog.items[id].price||50)<=p.coins));
        if(!items.length)continue;
        const id=items[Math.floor(random(p)*items.length)];
        if(!p.ownedGear.has(id))p.coins-=Equipment.catalog.items[id].price||50;
        p.ownedGear.add(id);p[field]=id;if(field==='vehicle')p.ownedVehicle=id;
        Equipment.normalize(p);p.lookRevision=(p.lookRevision||0)+1;return true;
    }
    return false;
}
module.exports={BOUNDS,random,pool,init,idle,decide,move,equip,opponents};
