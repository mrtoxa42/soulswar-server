'use strict';
const crypto=require('node:crypto'),{promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt),digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const MAX_PROFILE=131072,SESSION_MS=30*86400000;
class AccountError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
function username(value){return typeof value==='string'&&/^[A-Za-z0-9_]{3,18}$/.test(value)?value.toLowerCase():null;}
function password(value){return typeof value==='string'&&value.length>=10&&value.length<=128;}
function profile(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value))>MAX_PROFILE)return false;
 const allowed=['character','progress','coins','growth','owned','equipped','presets','consumables','hotbar_order','tutorial','city_intro','pending_death','last_death','dungeon','world','sanctuary','quests','outing'];
 if(Object.keys(value).some(k=>!allowed.includes(k)))return false;
 for(const k of ['character','progress','owned','equipped','quests'])if(!value[k]||typeof value[k]!=='object'||Array.isArray(value[k]))return false;
 const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 return typeof value.character.name==='string'&&value.character.name.length<=100&&['Banker','Vampire','Speedster','Politician'].includes(value.character.class)&&Number.isInteger(value.progress.level)&&finite(value.progress.level,1,100000)&&finite(value.progress.xp,0,1e12)&&finite(value.coins,0,1e12);
}
async function makeHash(value){const salt=crypto.randomBytes(16).toString('hex');const key=await scrypt(value,salt,64,{N:32768,r:8,p:3,maxmem:48*1024*1024});return `scrypt1:${salt}:${key.toString('hex')}`;}
async function verifyHash(value,stored){
 const parts=String(stored).split(':');if(parts.length!==3||parts[0]!=='scrypt1'||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;
 const actual=await scrypt(value,parts[1],64,{N:32768,r:8,p:3,maxmem:48*1024*1024});return crypto.timingSafeEqual(actual,Buffer.from(parts[2],'hex'));
}
function accountProfile(data,name){return {...data,character:{...data.character,name}};}
class PgAccounts {
 constructor(pool){this.pool=pool;}
 async transaction(fn){const db=await this.pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 async find(name){return (await this.pool.query('SELECT id,username,display_name,password_hash,recovery_hash,disabled FROM sw_accounts WHERE username=$1',[name])).rows[0];}
 async create(name,display,hash,recovery,data){return this.transaction(async db=>{
  let account;try{account=(await db.query('INSERT INTO sw_accounts(username,display_name,password_hash,recovery_hash) VALUES($1,$2,$3,$4) RETURNING id,username,display_name',[name,display,hash,recovery])).rows[0];}catch(e){if(e.code==='23505')throw new AccountError('username_taken',409);throw e;}
  await db.query('INSERT INTO sw_profiles(account_id,profile) VALUES($1,$2::jsonb)',[account.id,JSON.stringify(data)]);return account;
 });}
 async session(account,token){await this.pool.query('INSERT INTO sw_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)',[digest(token),account.id,new Date(Date.now()+SESSION_MS)]);await this.pool.query('UPDATE sw_accounts SET last_login_at=now() WHERE id=$1',[account.id]);}
 async load(token){return (await this.pool.query('SELECT a.id,a.username,a.display_name,p.profile,p.revision,p.schema_version FROM sw_sessions s JOIN sw_accounts a ON a.id=s.account_id JOIN sw_profiles p ON p.account_id=a.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT a.disabled',[digest(token)])).rows[0];}
 async save(token,revision,data){return this.transaction(async db=>{
  const row=(await db.query('SELECT p.account_id,p.revision,a.display_name FROM sw_sessions s JOIN sw_accounts a ON a.id=s.account_id JOIN sw_profiles p ON p.account_id=a.id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT a.disabled FOR UPDATE OF p,s',[digest(token)])).rows[0];
  if(!row)throw new AccountError('session_expired',401);if(Number(row.revision)!==revision)throw new AccountError('save_conflict',409);
  return (await db.query('UPDATE sw_profiles SET profile=$1::jsonb,revision=revision+1,updated_at=now() WHERE account_id=$2 RETURNING revision',[JSON.stringify(accountProfile(data,row.display_name)),row.account_id])).rows[0];
 });}
 async revoke(token){await this.pool.query('UPDATE sw_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL',[digest(token)]);}
 async recover(account,hash,recovery){await this.transaction(async db=>{const result=await db.query('UPDATE sw_accounts SET password_hash=$1,recovery_hash=$4,updated_at=now() WHERE id=$2 AND recovery_hash=$3 AND NOT disabled RETURNING id',[hash,account.id,account.recovery_hash,recovery]);if(!result.rows.length)throw new AccountError('invalid_credentials',401);await db.query('UPDATE sw_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',[account.id]);});}
}
class Accounts {
 constructor(store,{now=()=>Date.now(),origins=[]}={}){this.store=store;this.now=now;this.origins=new Set(origins);this.rates=new Map();this.hashing=0;this.dummy=makeHash(crypto.randomBytes(32).toString('hex'));}
 rate(key,limit){const now=this.now();let r=this.rates.get(key);if(!r||now>=r.until){if(this.rates.size>=5000){for(const [k,v]of this.rates)if(now>=v.until)this.rates.delete(k);if(this.rates.size>=5000)throw new AccountError('busy',429);}r={count:0,until:now+60000};this.rates.set(key,r);}if(++r.count>limit)throw new AccountError('too_many_attempts',429);}
 async kdf(fn){if(this.hashing>=2)throw new AccountError('busy',429);this.hashing++;try{return await fn();}finally{this.hashing--;}}
 async action(action,input,token,ip='local'){
  this.rate('ip:'+ip,60);if(!this.store)throw new AccountError('accounts_unavailable',503);
  if(['register','login','recover'].includes(action)){
   const name=username(input.username);if(!name||!password(input.password))throw new AccountError('invalid_credentials_format');
   this.rate('user:'+name,10);
   if(action==='register'){
    if(!profile(input.profile))throw new AccountError('invalid_profile');
    const recovery=crypto.randomBytes(24).toString('hex');const hash=await this.kdf(()=>makeHash(input.password));
    const account=await this.store.create(name,input.username,hash,digest(recovery),input.profile);
    const session=crypto.randomBytes(32).toString('hex');await this.store.session(account,session);return {...this.public(await this.store.load(session)),token:session,recovery_code:recovery};
   }
   const account=await this.store.find(name);
   if(action==='recover'){
    const code=typeof input.recovery_code==='string'?input.recovery_code.trim():'';
    if(!account||account.disabled||!account.recovery_hash||!/^[a-f0-9]{48}$/.test(code)||!crypto.timingSafeEqual(Buffer.from(digest(code)),Buffer.from(account.recovery_hash)))throw new AccountError('invalid_credentials',401);
    const recovery=crypto.randomBytes(24).toString('hex');
    await this.store.recover(account,await this.kdf(()=>makeHash(input.password)),digest(recovery));return {recovered:true,recovery_code:recovery};
   }
   const valid=await this.kdf(async()=>verifyHash(input.password,account?.password_hash||await this.dummy));
   if(!valid||!account||account.disabled)throw new AccountError('invalid_credentials',401);
   const session=crypto.randomBytes(32).toString('hex');await this.store.session(account,session);return {...this.public(await this.store.load(session)),token:session};
  }
  if(!/^[a-f0-9]{64}$/.test(token||''))throw new AccountError('session_expired',401);
  if(action==='resume'){const data=await this.store.load(token);if(!data)throw new AccountError('session_expired',401);return this.public(data);}
  if(action==='save'){
   if(!Number.isSafeInteger(input.revision)||input.revision<1||!profile(input.profile))throw new AccountError('invalid_profile');
   const saved=await this.store.save(token,input.revision,input.profile);return {revision:Number(saved.revision)};
  }
  if(action==='logout'){await this.store.revoke(token);return {logged_out:true};}
  throw new AccountError('invalid_action');
 }
 public(row){if(!row)throw new AccountError('session_expired',401);return {account:{id:row.id,username:row.display_name},profile:accountProfile(row.profile,row.display_name),revision:Number(row.revision),schema_version:row.schema_version};}
 async handle(req,res){
  const origin=req.headers.origin||'';const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(origin&&!this.origins.has(origin)&&!this.origins.has('*')){res.writeHead(403,headers);res.end('{"error":"origin_not_allowed"}');req.resume();return;}
  if(origin){headers['Access-Control-Allow-Origin']=this.origins.has('*')?'*':origin;headers.Vary='Origin';headers['Access-Control-Allow-Headers']='Content-Type, Authorization';headers['Access-Control-Allow-Methods']='POST, OPTIONS';}
  if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
  if(req.method!=='POST'){res.writeHead(405,headers);res.end('{"error":"method_not_allowed"}');req.resume();return;}
  let size=0,parts=[];
  try{
   if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AccountError('invalid_content_type',415);
   for await(const chunk of req){size+=chunk.length;if(size>MAX_PROFILE+16384)throw new AccountError('request_too_large',413);parts.push(chunk);}
   const input=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!input||typeof input!=='object'||Array.isArray(input))throw new AccountError('invalid_request');
   const action=req.url.split('?')[0].slice('/accounts/'.length),token=String(req.headers.authorization||'').replace(/^Bearer /,'');
   const result=await this.action(action,input,token,req.socket.remoteAddress||'unknown');res.writeHead(200,headers);res.end(JSON.stringify(result));
  }catch(e){const status=e instanceof AccountError?e.status:e instanceof SyntaxError?400:503;res.writeHead(status,headers);res.end(JSON.stringify({error:e instanceof AccountError?e.code:status===400?'invalid_request':'accounts_unavailable'}));}
 }
}
function createAccounts(){
 if(!process.env.DATABASE_URL)return new Accounts(null);
 const {Pool}=require('pg');const pool=new Pool({connectionString:require('./database_connection').connectionString(process.env.DATABASE_URL),max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});pool.on('error',()=>console.error('Account database connection unavailable.'));
 return new Accounts(new PgAccounts(pool),{origins:(process.env.ACCOUNT_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)});
}
module.exports={Accounts,PgAccounts,AccountError,createAccounts,makeHash,verifyHash,profile,username,password,MAX_PROFILE};
