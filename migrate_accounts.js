'use strict';
const fs=require('node:fs'),path=require('node:path');
async function migrate(pool){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  // Transaction-scoped: another deploy cannot apply the same migration concurrently.
  await db.query('SELECT pg_advisory_xact_lock(42810421)');
  await db.query('CREATE TABLE IF NOT EXISTS sw_schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for(const file of fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>/^\d+_[a-z_]+\.sql$/.test(n)).sort()){
   const version=Number(file.split('_')[0]);
   if((await db.query('SELECT 1 FROM sw_schema_migrations WHERE version=$1',[version])).rows.length)continue;
   await db.query(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8').replace(/^\uFEFF/,''));
  }
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
if(require.main===module)(async()=>{
 if(!process.env.DATABASE_URL)return;
 const {Pool}=require('pg'),pool=new Pool({connectionString:require('./database_connection').connectionString(process.env.DATABASE_URL),max:1,connectionTimeoutMillis:15000});
 try{await migrate(pool);console.log('Account database migrations ready.');}catch(e){console.error('Account migration failed; server was not started.');process.exitCode=1;}finally{await pool.end();}
})();
module.exports={migrate};
